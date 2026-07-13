"""Business logic del módulo Retail Sell-out Analytics.

Diseño:
- CRUD de channels, stores y sellout reports.
- KPIs: sell-through %, WOS ponderado, tiendas críticas/sobreinventario.
- Replenishment engine: sugiere unidades a mandar para llegar al WOS target
  de la cadena. Prioridad urgent/high/normal según qué tan rojo esté.

WOS (Weeks of Supply) = on_hand / velocidad_semanal_promedio
- Se calcula con las últimas 4 semanas (ventana estándar en retail analytics).
- Si no hay ventas → WOS = ∞ (marcamos 999 y status="no_data").
- Se compara vs los umbrales de la cadena para dar el status:
    WOS < critical → critical
    critical <= WOS < target → replenish
    target <= WOS <= overstock → healthy
    WOS > overstock → overstock
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, delete, func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.customers import models as cust_models
from app.modules.inventory import models as inv_models

from . import models, schemas


# ── Constantes de análisis ───────────────────────────────────────────────

VELOCITY_WINDOW_DAYS = 28              # 4 semanas rolling
WOS_INFINITY = 999.0                    # marcador para "sin ventas"


def _clamp(x: float, lo: float = 0.0, hi: float = WOS_INFINITY) -> float:
    return max(lo, min(hi, x))


def _wos_status(wos: float, critical: float, target: float, overstock: float,
                has_sales: bool) -> str:
    if not has_sales:
        return "no_data"
    if wos < critical:
        return "critical"
    if wos < target:
        return "replenish"
    if wos <= overstock:
        return "healthy"
    return "overstock"


# ── Channels ─────────────────────────────────────────────────────────────

async def list_channels(db: AsyncSession) -> List[schemas.RetailChannelOut]:
    stmt = select(models.RetailChannel).order_by(models.RetailChannel.name.asc())
    rows = list((await db.execute(stmt)).scalars().all())
    # Enriquecer con nombre de customer y count de stores
    cust_ids = {r.customer_id for r in rows if r.customer_id}
    cust_names: Dict[int, str] = {}
    if cust_ids:
        cres = await db.execute(
            select(cust_models.Customer.id, cust_models.Customer.name)
            .where(cust_models.Customer.id.in_(cust_ids))
        )
        cust_names = {r.id: r.name for r in cres}
    counts_stmt = (
        select(models.RetailStore.channel_id, func.count(models.RetailStore.id))
        .group_by(models.RetailStore.channel_id)
    )
    counts = dict((await db.execute(counts_stmt)).all())
    out = []
    for r in rows:
        out.append(schemas.RetailChannelOut(
            id=r.id, name=r.name, code=r.code, customer_id=r.customer_id,
            target_wos_weeks=r.target_wos_weeks,
            critical_wos_weeks=r.critical_wos_weeks,
            overstock_wos_weeks=r.overstock_wos_weeks,
            is_active=r.is_active, notes=r.notes,
            customer_name=cust_names.get(r.customer_id or 0),
            stores_count=int(counts.get(r.id, 0)),
            created_at=r.created_at,
        ))
    return out


async def get_channel(db: AsyncSession, channel_id: int) -> Optional[models.RetailChannel]:
    return await db.get(models.RetailChannel, channel_id)


async def create_channel(db: AsyncSession, data: schemas.RetailChannelCreate) -> models.RetailChannel:
    ch = models.RetailChannel(**data.model_dump(exclude_unset=True))
    db.add(ch); await db.commit(); await db.refresh(ch)
    return ch


async def update_channel(db: AsyncSession, channel_id: int,
                          data: schemas.RetailChannelUpdate) -> Optional[models.RetailChannel]:
    ch = await db.get(models.RetailChannel, channel_id)
    if ch is None:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(ch, k, v)
    await db.commit(); await db.refresh(ch)
    return ch


async def delete_channel(db: AsyncSession, channel_id: int) -> bool:
    ch = await db.get(models.RetailChannel, channel_id)
    if ch is None:
        return False
    await db.delete(ch); await db.commit()
    return True


# ── Stores ───────────────────────────────────────────────────────────────

async def list_stores(db: AsyncSession, channel_id: Optional[int] = None,
                       active_only: bool = False) -> List[schemas.RetailStoreOut]:
    stmt = select(models.RetailStore, models.RetailChannel.name).join(
        models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id
    )
    if channel_id is not None:
        stmt = stmt.where(models.RetailStore.channel_id == channel_id)
    if active_only:
        stmt = stmt.where(models.RetailStore.is_active.is_(True))
    stmt = stmt.order_by(
        models.RetailChannel.name.asc(), models.RetailStore.name.asc()
    )
    rows = (await db.execute(stmt)).all()
    return [
        schemas.RetailStoreOut(
            id=s.id, channel_id=s.channel_id, channel_name=cname,
            name=s.name, code=s.code, external_code=s.external_code,
            city=s.city, state=s.state, region=s.region,
            store_format=s.store_format, address=s.address,
            contact_name=s.contact_name, contact_phone=s.contact_phone,
            is_active=s.is_active, notes=s.notes, created_at=s.created_at,
        ) for s, cname in rows
    ]


async def get_store(db: AsyncSession, store_id: int) -> Optional[models.RetailStore]:
    return await db.get(models.RetailStore, store_id)


async def create_store(db: AsyncSession, data: schemas.RetailStoreCreate) -> models.RetailStore:
    s = models.RetailStore(**data.model_dump(exclude_unset=True))
    db.add(s); await db.commit(); await db.refresh(s)
    return s


async def bulk_create_stores(db: AsyncSession, data: schemas.BulkStoresRequest
                              ) -> schemas.BulkStoresResponse:
    ch = await db.get(models.RetailChannel, data.channel_id)
    if ch is None:
        raise ValueError("Cadena no encontrada")

    # Skip duplicados por external_code + channel_id (o name)
    ext_codes = {s.external_code for s in data.stores if s.external_code}
    existing_ext: set = set()
    if ext_codes:
        res = await db.execute(
            select(models.RetailStore.external_code).where(
                models.RetailStore.channel_id == data.channel_id,
                models.RetailStore.external_code.in_(ext_codes),
            )
        )
        existing_ext = {r[0] for r in res}

    created: List[models.RetailStore] = []
    skipped = 0
    for st in data.stores:
        if st.external_code and st.external_code in existing_ext:
            skipped += 1
            continue
        obj = models.RetailStore(channel_id=data.channel_id, **st.model_dump(exclude_unset=True))
        db.add(obj); created.append(obj)
    await db.commit()
    for c in created:
        await db.refresh(c)
    return schemas.BulkStoresResponse(
        created=len(created), skipped=skipped,
        stores=[
            schemas.RetailStoreOut(
                id=c.id, channel_id=c.channel_id, channel_name=ch.name,
                name=c.name, code=c.code, external_code=c.external_code,
                city=c.city, state=c.state, region=c.region,
                store_format=c.store_format, address=c.address,
                contact_name=c.contact_name, contact_phone=c.contact_phone,
                is_active=c.is_active, notes=c.notes, created_at=c.created_at,
            ) for c in created
        ],
    )


async def update_store(db: AsyncSession, store_id: int,
                        data: schemas.RetailStoreUpdate) -> Optional[models.RetailStore]:
    s = await db.get(models.RetailStore, store_id)
    if s is None:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    await db.commit(); await db.refresh(s)
    return s


async def delete_store(db: AsyncSession, store_id: int) -> bool:
    s = await db.get(models.RetailStore, store_id)
    if s is None:
        return False
    await db.delete(s); await db.commit()
    return True


# ── Sell-out Reports ─────────────────────────────────────────────────────

async def _fill_variant_snapshot(db: AsyncSession, report: models.SellOutReport) -> None:
    if report.variant_id and (not report.product_name or not report.sku):
        v = await db.get(inv_models.ProductVariant, report.variant_id)
        if v:
            if not report.sku:
                report.sku = v.sku
            if not report.product_name and v.product_id:
                p = await db.get(inv_models.Product, v.product_id)
                if p:
                    report.product_name = p.name


async def list_sellout(db: AsyncSession,
                        channel_id: Optional[int] = None,
                        store_id: Optional[int] = None,
                        variant_id: Optional[int] = None,
                        period_start_gte: Optional[datetime] = None,
                        period_start_lt: Optional[datetime] = None,
                        limit: int = 500) -> List[schemas.SellOutReportOut]:
    stmt = (
        select(
            models.SellOutReport,
            models.RetailStore.name.label("store_name"),
            models.RetailStore.channel_id.label("channel_id"),
            models.RetailChannel.name.label("channel_name"),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .join(models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id)
    )
    conds = []
    if channel_id is not None:
        conds.append(models.RetailStore.channel_id == channel_id)
    if store_id is not None:
        conds.append(models.SellOutReport.store_id == store_id)
    if variant_id is not None:
        conds.append(models.SellOutReport.variant_id == variant_id)
    if period_start_gte is not None:
        conds.append(models.SellOutReport.period_start >= period_start_gte)
    if period_start_lt is not None:
        conds.append(models.SellOutReport.period_start < period_start_lt)
    if conds:
        stmt = stmt.where(and_(*conds))
    stmt = stmt.order_by(models.SellOutReport.period_start.desc(),
                          models.SellOutReport.id.desc()).limit(limit)
    rows = (await db.execute(stmt)).all()
    out = []
    for r, store_name, ch_id, ch_name in rows:
        out.append(schemas.SellOutReportOut(
            id=r.id, store_id=r.store_id, store_name=store_name,
            channel_id=ch_id, channel_name=ch_name,
            variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
            period_start=r.period_start, period_end=r.period_end,
            period_type=r.period_type,
            units_sold=r.units_sold, units_on_hand=r.units_on_hand,
            revenue=r.revenue, source=r.source, notes=r.notes,
            created_at=r.created_at,
        ))
    return out


async def create_sellout(db: AsyncSession, data: schemas.SellOutReportCreate,
                          user_id: Optional[int] = None) -> models.SellOutReport:
    # Upsert por (store, variant, period_start, period_type)
    existing_stmt = select(models.SellOutReport).where(
        models.SellOutReport.store_id == data.store_id,
        models.SellOutReport.variant_id == data.variant_id,
        models.SellOutReport.period_start == data.period_start,
        models.SellOutReport.period_type == data.period_type,
    )
    existing = (await db.execute(existing_stmt)).scalars().first()
    if existing:
        for k, v in data.model_dump(exclude_unset=True).items():
            if k in ("store_id", "variant_id", "period_start", "period_type"):
                continue
            setattr(existing, k, v)
        await _fill_variant_snapshot(db, existing)
        existing.uploaded_by_user_id = user_id or existing.uploaded_by_user_id
        await db.commit(); await db.refresh(existing)
        return existing
    r = models.SellOutReport(
        **data.model_dump(exclude_unset=True),
        uploaded_by_user_id=user_id,
    )
    await _fill_variant_snapshot(db, r)
    db.add(r); await db.commit(); await db.refresh(r)
    try:
        await evaluate_alerts(db)
    except Exception:
        pass
    return r


async def update_sellout(db: AsyncSession, report_id: int,
                          data: schemas.SellOutReportUpdate) -> Optional[models.SellOutReport]:
    r = await db.get(models.SellOutReport, report_id)
    if r is None:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    await db.commit(); await db.refresh(r)
    return r


async def delete_sellout(db: AsyncSession, report_id: int) -> bool:
    r = await db.get(models.SellOutReport, report_id)
    if r is None:
        return False
    await db.delete(r); await db.commit()
    return True


# ── Dashboard KPIs ───────────────────────────────────────────────────────

async def dashboard_kpis(db: AsyncSession, channel_id: Optional[int] = None,
                          days: int = 30) -> schemas.RetailKPIs:
    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=days)

    # Sell-out
    so_stmt = (
        select(
            func.coalesce(func.sum(models.SellOutReport.units_sold), 0).label("units"),
            func.coalesce(func.sum(models.SellOutReport.revenue), 0.0).label("revenue"),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .where(models.SellOutReport.period_start >= period_start)
    )
    if channel_id is not None:
        so_stmt = so_stmt.where(models.RetailStore.channel_id == channel_id)
    so = (await db.execute(so_stmt)).one()

    # Sell-in (facturación al customer vinculado a la cadena)
    from app.modules.sales import models as sales_models

    sell_in_units = 0
    sell_in_revenue = 0.0
    channel_ids: List[int] = []
    if channel_id is not None:
        channel_ids = [channel_id]
    else:
        cids = (await db.execute(
            select(models.RetailChannel.id).where(models.RetailChannel.is_active.is_(True))
        )).all()
        channel_ids = [c[0] for c in cids]

    if channel_ids:
        cust_map_stmt = select(models.RetailChannel.id, models.RetailChannel.customer_id).where(
            models.RetailChannel.id.in_(channel_ids)
        )
        cust_ids = [c for _, c in (await db.execute(cust_map_stmt)).all() if c]
        if cust_ids:
            si_stmt = (
                select(
                    func.coalesce(func.sum(sales_models.OrderItem.quantity), 0).label("units"),
                    func.coalesce(func.sum(sales_models.OrderItem.total), 0.0).label("revenue"),
                )
                .join(sales_models.Order, sales_models.OrderItem.order_id == sales_models.Order.id)
                .where(
                    sales_models.Order.customer_id.in_(cust_ids),
                    sales_models.Order.kind == "order",
                    sales_models.Order.status != "cancelled",
                    sales_models.Order.created_at >= period_start,
                )
            )
            si = (await db.execute(si_stmt)).one()
            sell_in_units = int(si.units or 0)
            sell_in_revenue = float(si.revenue or 0.0)

    # WOS por store (para agregado)
    stores_stmt = (
        select(models.RetailStore.id, models.RetailStore.channel_id,
                models.RetailChannel.critical_wos_weeks,
                models.RetailChannel.target_wos_weeks,
                models.RetailChannel.overstock_wos_weeks)
        .join(models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id)
        .where(models.RetailStore.is_active.is_(True))
    )
    if channel_id is not None:
        stores_stmt = stores_stmt.where(models.RetailStore.channel_id == channel_id)
    stores_rows = (await db.execute(stores_stmt)).all()

    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)
    # On-hand por store: sumar units_on_hand del último periodo reportado por store.
    on_hand_by_store: Dict[int, int] = {}
    last_periods = (await db.execute(
        select(
            models.SellOutReport.store_id,
            func.max(models.SellOutReport.period_start).label("last"),
        ).group_by(models.SellOutReport.store_id)
    )).all()
    for sid, last in last_periods:
        if last is None:
            continue
        oh = (await db.execute(
            select(func.coalesce(func.sum(models.SellOutReport.units_on_hand), 0))
            .where(models.SellOutReport.store_id == sid,
                    models.SellOutReport.period_start == last)
        )).scalar() or 0
        on_hand_by_store[int(sid)] = int(oh)

    # Velocidad semanal por store: units_sold en la ventana / (días/7)
    vel_rows = (await db.execute(
        select(
            models.SellOutReport.store_id,
            func.sum(models.SellOutReport.units_sold).label("units"),
        ).where(models.SellOutReport.period_start >= velocity_from)
         .group_by(models.SellOutReport.store_id)
    )).all()
    vel_by_store: Dict[int, float] = {
        int(sid): (float(units or 0) / (VELOCITY_WINDOW_DAYS / 7.0))
        for sid, units in vel_rows
    }

    critical_stores = 0
    overstock_stores = 0
    total_on_hand = 0
    weighted_wos_num = 0.0
    weighted_wos_den = 0.0

    for sid, _cid, crit_w, tgt_w, over_w in stores_rows:
        on_hand = on_hand_by_store.get(int(sid), 0)
        vel = vel_by_store.get(int(sid), 0.0)
        total_on_hand += on_hand
        if vel <= 0:
            continue
        wos = _clamp(on_hand / vel)
        if wos < float(crit_w or 2.0):
            critical_stores += 1
        if wos > float(over_w or 12.0):
            overstock_stores += 1
        # Ponderación por on_hand para el promedio
        weighted_wos_num += wos * on_hand
        weighted_wos_den += on_hand

    avg_wos = round(weighted_wos_num / weighted_wos_den, 2) if weighted_wos_den > 0 else 0.0

    # Skus activos en el periodo
    skus_count = int((await db.execute(
        select(func.count(func.distinct(models.SellOutReport.variant_id)))
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .where(models.SellOutReport.period_start >= period_start,
                *([models.RetailStore.channel_id == channel_id] if channel_id else []))
    )).scalar() or 0)

    stores_active = len(stores_rows)

    total_so = int(so.units or 0)
    sell_through = round((total_so / sell_in_units * 100.0), 2) if sell_in_units > 0 else 0.0

    channel_name = None
    if channel_id is not None:
        ch = await db.get(models.RetailChannel, channel_id)
        channel_name = ch.name if ch else None

    return schemas.RetailKPIs(
        channel_id=channel_id, channel_name=channel_name,
        period_start=period_start, period_end=now,
        total_sell_out_units=total_so,
        total_sell_out_revenue=round(float(so.revenue or 0.0), 2),
        total_sell_in_units=sell_in_units,
        total_sell_in_revenue=round(sell_in_revenue, 2),
        sell_through_pct=sell_through,
        total_on_hand=total_on_hand,
        avg_wos_weeks=avg_wos,
        critical_stores_count=critical_stores,
        overstock_stores_count=overstock_stores,
        stores_active_count=stores_active,
        skus_active_count=skus_count,
    )


# ── Store velocity list ─────────────────────────────────────────────────

async def stores_velocity(db: AsyncSession, channel_id: Optional[int] = None
                            ) -> List[schemas.StoreVelocityRow]:
    now = datetime.now(timezone.utc)
    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)

    stores_stmt = (
        select(models.RetailStore, models.RetailChannel)
        .join(models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id)
        .where(models.RetailStore.is_active.is_(True))
    )
    if channel_id is not None:
        stores_stmt = stores_stmt.where(models.RetailStore.channel_id == channel_id)
    stores = (await db.execute(stores_stmt)).all()

    # Sums por store en la ventana
    vel_map: Dict[int, Tuple[int, int]] = {}
    vel_rows = (await db.execute(
        select(
            models.SellOutReport.store_id,
            func.sum(models.SellOutReport.units_sold).label("units"),
        ).where(models.SellOutReport.period_start >= velocity_from)
         .group_by(models.SellOutReport.store_id)
    )).all()
    for sid, u in vel_rows:
        vel_map[int(sid)] = (int(u or 0), 0)

    # On-hand del último reporte de cada store (sum on-hand de la fecha más reciente por store)
    onhand_map: Dict[int, int] = {}
    last_periods = (await db.execute(
        select(
            models.SellOutReport.store_id,
            func.max(models.SellOutReport.period_start).label("last"),
        ).group_by(models.SellOutReport.store_id)
    )).all()
    for sid, last in last_periods:
        if last is None:
            continue
        s = (await db.execute(
            select(func.coalesce(func.sum(models.SellOutReport.units_on_hand), 0))
            .where(models.SellOutReport.store_id == sid,
                    models.SellOutReport.period_start == last)
        )).scalar() or 0
        onhand_map[int(sid)] = int(s)

    out: List[schemas.StoreVelocityRow] = []
    for store, ch in stores:
        units = vel_map.get(store.id, (0, 0))[0]
        avg_weekly = round(units / (VELOCITY_WINDOW_DAYS / 7.0), 2)
        on_hand = onhand_map.get(store.id, 0)
        wos = _clamp(on_hand / avg_weekly) if avg_weekly > 0 else WOS_INFINITY
        status = _wos_status(
            wos, ch.critical_wos_weeks, ch.target_wos_weeks,
            ch.overstock_wos_weeks, has_sales=avg_weekly > 0,
        )
        out.append(schemas.StoreVelocityRow(
            store_id=store.id, store_name=store.name,
            channel_name=ch.name,
            total_units_sold=units, avg_weekly_units=avg_weekly,
            total_on_hand=on_hand, wos_weeks=round(wos, 2),
            status=status,
        ))
    out.sort(key=lambda r: (
        0 if r.status == "critical" else 1 if r.status == "replenish"
        else 3 if r.status == "overstock" else 2 if r.status == "healthy" else 4,
        r.wos_weeks,
    ))
    return out


# ── SKU velocity ────────────────────────────────────────────────────────

async def skus_velocity(db: AsyncSession, channel_id: Optional[int] = None,
                          limit: int = 100) -> List[schemas.SKUVelocityRow]:
    now = datetime.now(timezone.utc)
    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)

    base_join = (
        select(
            models.SellOutReport.variant_id,
            func.max(models.SellOutReport.sku).label("sku"),
            func.max(models.SellOutReport.product_name).label("product_name"),
            func.count(func.distinct(models.SellOutReport.store_id)).label("stores"),
            func.coalesce(func.sum(models.SellOutReport.units_sold), 0).label("units"),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .where(models.SellOutReport.period_start >= velocity_from)
        .group_by(models.SellOutReport.variant_id)
        .order_by(func.sum(models.SellOutReport.units_sold).desc())
        .limit(limit)
    )
    if channel_id is not None:
        base_join = base_join.where(models.RetailStore.channel_id == channel_id)

    vel_rows = (await db.execute(base_join)).all()

    # On-hand por variant (último periodo por store, sumado)
    on_hand_by_variant: Dict[int, int] = {}
    for vid, *_ in vel_rows:
        if vid is None:
            continue
        oh_stmt = (
            select(
                models.SellOutReport.store_id,
                func.max(models.SellOutReport.period_start).label("last"),
            ).where(models.SellOutReport.variant_id == vid)
             .group_by(models.SellOutReport.store_id)
        )
        rows = (await db.execute(oh_stmt)).all()
        total = 0
        for sid, last in rows:
            oh = (await db.execute(
                select(func.coalesce(func.sum(models.SellOutReport.units_on_hand), 0))
                .where(models.SellOutReport.variant_id == vid,
                        models.SellOutReport.store_id == sid,
                        models.SellOutReport.period_start == last)
            )).scalar() or 0
            total += int(oh)
        on_hand_by_variant[int(vid)] = total

    # Umbrales globales (promedio) para status por SKU
    thresholds = (await db.execute(
        select(
            func.avg(models.RetailChannel.critical_wos_weeks),
            func.avg(models.RetailChannel.target_wos_weeks),
            func.avg(models.RetailChannel.overstock_wos_weeks),
        )
    )).one()
    crit = float(thresholds[0] or 2.0)
    tgt = float(thresholds[1] or 4.0)
    over = float(thresholds[2] or 12.0)

    out: List[schemas.SKUVelocityRow] = []
    for vid, sku, pname, stores, units in vel_rows:
        avg_weekly = round(float(units or 0) / (VELOCITY_WINDOW_DAYS / 7.0), 2)
        on_hand = on_hand_by_variant.get(int(vid) if vid else -1, 0)
        wos = _clamp(on_hand / avg_weekly) if avg_weekly > 0 else WOS_INFINITY
        status = _wos_status(wos, crit, tgt, over, has_sales=avg_weekly > 0)
        out.append(schemas.SKUVelocityRow(
            variant_id=int(vid) if vid else None,
            sku=sku, product_name=pname,
            stores_count=int(stores or 0),
            total_units_sold=int(units or 0),
            avg_weekly_units=avg_weekly,
            total_on_hand=on_hand,
            wos_weeks=round(wos, 2),
            status=status,
        ))
    return out


# ── Replenishment engine ────────────────────────────────────────────────

async def replenishment(db: AsyncSession, channel_id: Optional[int] = None
                          ) -> schemas.ReplenishmentResponse:
    now = datetime.now(timezone.utc)
    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)

    # Combos (store, variant) con último periodo y sums en la ventana
    stmt = (
        select(
            models.RetailStore.id.label("store_id"),
            models.RetailStore.name.label("store_name"),
            models.RetailChannel.id.label("channel_id"),
            models.RetailChannel.name.label("channel_name"),
            models.RetailChannel.target_wos_weeks,
            models.RetailChannel.critical_wos_weeks,
            models.SellOutReport.variant_id,
            models.SellOutReport.product_name,
            models.SellOutReport.sku,
            func.max(models.SellOutReport.period_start).label("last_period"),
            func.coalesce(func.sum(models.SellOutReport.units_sold), 0).label("units_sold"),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .join(models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id)
        .where(models.SellOutReport.period_start >= velocity_from,
                models.RetailStore.is_active.is_(True))
        .group_by(
            models.RetailStore.id, models.RetailStore.name,
            models.RetailChannel.id, models.RetailChannel.name,
            models.RetailChannel.target_wos_weeks,
            models.RetailChannel.critical_wos_weeks,
            models.SellOutReport.variant_id, models.SellOutReport.product_name,
            models.SellOutReport.sku,
        )
    )
    if channel_id is not None:
        stmt = stmt.where(models.RetailStore.channel_id == channel_id)

    rows = (await db.execute(stmt)).all()

    suggestions: List[schemas.ReplenishmentSuggestion] = []
    urgent = high = normal = 0

    for r in rows:
        # On-hand actual: último reporte de ese (store, variant)
        oh = (await db.execute(
            select(func.coalesce(func.sum(models.SellOutReport.units_on_hand), 0))
            .where(models.SellOutReport.store_id == r.store_id,
                    models.SellOutReport.variant_id == r.variant_id,
                    models.SellOutReport.period_start == r.last_period)
        )).scalar() or 0
        on_hand = int(oh)

        avg_weekly = float(r.units_sold or 0) / (VELOCITY_WINDOW_DAYS / 7.0)
        if avg_weekly <= 0:
            continue
        wos = on_hand / avg_weekly
        tgt = float(r.target_wos_weeks or 4.0)
        crit = float(r.critical_wos_weeks or 2.0)
        if wos >= tgt:
            continue

        # Cuánto mandar para llegar a target
        needed = int(round(avg_weekly * tgt - on_hand))
        if needed <= 0:
            continue

        if wos < crit:
            prio, reason = "urgent", f"Stock crítico: {wos:.1f} sem. < mín {crit:.0f}"
            urgent += 1
        elif wos < tgt * 0.7:
            prio, reason = "high", f"Debajo del objetivo: {wos:.1f} sem. de {tgt:.0f}"
            high += 1
        else:
            prio, reason = "normal", f"Reabasto rutinario para llegar a {tgt:.0f} sem."
            normal += 1

        suggestions.append(schemas.ReplenishmentSuggestion(
            store_id=r.store_id, store_name=r.store_name,
            channel_id=r.channel_id, channel_name=r.channel_name,
            variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
            current_on_hand=on_hand, avg_weekly_units=round(avg_weekly, 2),
            wos_weeks=round(wos, 2), suggested_units=needed,
            priority=prio, reason=reason,
        ))

    priority_order = {"urgent": 0, "high": 1, "normal": 2}
    suggestions.sort(key=lambda s: (priority_order[s.priority], s.wos_weeks))

    tgt_default = 4.0
    crit_default = 2.0
    if channel_id is not None:
        ch = await db.get(models.RetailChannel, channel_id)
        if ch:
            tgt_default = ch.target_wos_weeks
            crit_default = ch.critical_wos_weeks

    return schemas.ReplenishmentResponse(
        channel_id=channel_id, generated_at=now,
        target_wos_weeks=tgt_default, critical_wos_weeks=crit_default,
        suggestions=suggestions,
        urgent_count=urgent, high_count=high, normal_count=normal,
    )


# ── Store performance ───────────────────────────────────────────────────

async def store_performance(db: AsyncSession, store_id: int, weeks_back: int = 12
                              ) -> Optional[schemas.StorePerformanceOut]:
    store = await db.get(models.RetailStore, store_id)
    if store is None:
        return None
    channel = await db.get(models.RetailChannel, store.channel_id)

    now = datetime.now(timezone.utc)
    since = now - timedelta(weeks=weeks_back)

    rows = (await db.execute(
        select(
            models.SellOutReport.period_start,
            models.SellOutReport.period_end,
            func.sum(models.SellOutReport.units_sold).label("units"),
            func.sum(models.SellOutReport.units_on_hand).label("on_hand"),
            func.sum(models.SellOutReport.revenue).label("revenue"),
        )
        .where(models.SellOutReport.store_id == store_id,
                models.SellOutReport.period_start >= since)
        .group_by(models.SellOutReport.period_start, models.SellOutReport.period_end)
        .order_by(models.SellOutReport.period_start.asc())
    )).all()

    periods = [
        schemas.StorePerformancePeriod(
            period_start=ps, period_end=pe,
            units_sold=int(u or 0), on_hand_end=int(oh or 0),
            revenue=round(float(rev or 0.0), 2),
        ) for ps, pe, u, oh, rev in rows
    ]
    total_units = sum(p.units_sold for p in periods)
    total_rev = round(sum(p.revenue for p in periods), 2)
    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)

    def _ge(a: datetime, b: datetime) -> bool:
        # SQLite regresa datetimes naive; alinea antes de comparar.
        if a.tzinfo is None and b.tzinfo is not None:
            a = a.replace(tzinfo=b.tzinfo)
        elif b.tzinfo is None and a.tzinfo is not None:
            b = b.replace(tzinfo=a.tzinfo)
        return a >= b

    recent_units = sum(p.units_sold for p in periods if _ge(p.period_start, velocity_from))
    avg_weekly = round(recent_units / (VELOCITY_WINDOW_DAYS / 7.0), 2)
    latest_on_hand = periods[-1].on_hand_end if periods else 0
    wos = _clamp(latest_on_hand / avg_weekly) if avg_weekly > 0 else WOS_INFINITY
    status = _wos_status(
        wos,
        channel.critical_wos_weeks if channel else 2.0,
        channel.target_wos_weeks if channel else 4.0,
        channel.overstock_wos_weeks if channel else 12.0,
        has_sales=avg_weekly > 0,
    )
    return schemas.StorePerformanceOut(
        store_id=store.id, store_name=store.name,
        channel_name=channel.name if channel else "",
        periods=periods,
        total_units_sold=total_units, total_revenue=total_rev,
        avg_weekly_units=avg_weekly, latest_on_hand=latest_on_hand,
        wos_weeks=round(wos, 2), status=status,
    )


# ── Bulk import: plantilla + parser ─────────────────────────────────────

TEMPLATE_HEADERS = [
    "cadena_codigo", "cadena_nombre",
    "tienda_codigo", "tienda_nombre",
    "sku", "producto_nombre",
    "periodo_tipo", "periodo_inicio", "periodo_fin",
    "unidades_vendidas", "unidades_stock", "ingreso",
    "notas",
]


async def _template_hints(db: AsyncSession) -> Dict[str, List[dict]]:
    """Cadenas, tiendas y SKUs activos para las hojas de referencia."""
    chans = (await db.execute(
        select(models.RetailChannel).where(models.RetailChannel.is_active.is_(True))
        .order_by(models.RetailChannel.name).limit(500)
    )).scalars().all()

    stores = (await db.execute(
        select(models.RetailStore, models.RetailChannel.name)
        .join(models.RetailChannel, models.RetailStore.channel_id == models.RetailChannel.id)
        .where(models.RetailStore.is_active.is_(True))
        .order_by(models.RetailChannel.name, models.RetailStore.name)
        .limit(5000)
    )).all()

    variants = (await db.execute(
        select(inv_models.ProductVariant.sku, inv_models.ProductVariant.price,
                inv_models.Product.name)
        .join(inv_models.Product, inv_models.ProductVariant.product_id == inv_models.Product.id)
        .where(inv_models.ProductVariant.is_active.is_(True))
        .limit(3000)
    )).all()

    return {
        "cadenas": [{"nombre": c.name, "codigo": c.code or ""} for c in chans],
        "tiendas": [
            {
                "cadena": chn, "nombre": s.name, "codigo_interno": s.code or "",
                "codigo_externo": s.external_code or "",
                "ciudad": s.city or "", "estado": s.state or "",
            } for s, chn in stores
        ],
        "productos": [
            {"sku": v.sku, "nombre": v.name, "precio_sugerido": float(v.price or 0.0)}
            for v in variants
        ],
    }


async def build_sellout_template_xlsx(db: AsyncSession) -> bytes:
    """Plantilla profesional multi-hoja con instrucciones + referencias."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    hints = await _template_hints(db)

    wb = Workbook()
    ws = wb.active
    ws.title = "SellOut"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1E3A8A")
    center = Alignment(horizontal="center")

    ws.append(TEMPLATE_HEADERS)
    for col_idx, _h in enumerate(TEMPLATE_HEADERS, start=1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center

    widths = [14, 26, 14, 26, 16, 30, 12, 14, 14, 14, 14, 14, 30]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Fila-guía
    example_channel = hints["cadenas"][0]["nombre"] if hints["cadenas"] else "Walmart"
    example_channel_code = hints["cadenas"][0]["codigo"] if hints["cadenas"] and hints["cadenas"][0]["codigo"] else "WMT"
    example_store = hints["tiendas"][0]["nombre"] if hints["tiendas"] else "Sucursal Centro"
    example_store_code = hints["tiendas"][0]["codigo_externo"] if hints["tiendas"] and hints["tiendas"][0]["codigo_externo"] else "1001"
    example_sku = hints["productos"][0]["sku"] if hints["productos"] else "SKU-001"
    example_prod = hints["productos"][0]["nombre"] if hints["productos"] else "Producto de ejemplo"

    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)

    example_row = [
        example_channel_code, example_channel,
        example_store_code, example_store,
        example_sku, example_prod,
        "week", week_start.isoformat(), week_end.isoformat(),
        12, 45, 12 * 1290.0,
        "Ejemplo — puedes borrar esta fila",
    ]
    ws.append(example_row)
    grey = PatternFill("solid", fgColor="F1F5F9")
    italic = Font(italic=True, color="64748B")
    for col_idx in range(1, len(example_row) + 1):
        cell = ws.cell(row=2, column=col_idx)
        cell.fill = grey
        cell.font = italic
    ws.freeze_panes = "A2"

    def _add_ref_sheet(name: str, rows: List[dict], headers: List[str]):
        s = wb.create_sheet(name)
        s.append(headers)
        for c in s[1]:
            c.font = header_font
            c.fill = header_fill
        for r in rows:
            s.append([r.get(h.lower().replace(" ", "_"), "") for h in headers])
        for i, h in enumerate(headers, start=1):
            s.column_dimensions[get_column_letter(i)].width = max(14, len(h) + 4)

    _add_ref_sheet("Cadenas", hints["cadenas"], ["nombre", "codigo"])
    _add_ref_sheet(
        "Tiendas", hints["tiendas"],
        ["cadena", "nombre", "codigo_interno", "codigo_externo", "ciudad", "estado"],
    )
    _add_ref_sheet("Productos", hints["productos"], ["sku", "nombre", "precio_sugerido"])

    ws_i = wb.create_sheet("Instrucciones", 0)
    lines = [
        "Plantilla de Sell-out Retail",
        "",
        "Cómo llenarla:",
        "  1) Una fila = una venta reportada de UN SKU en UNA tienda en UN periodo.",
        "  2) Matcheo de cadena: por 'cadena_codigo' (recomendado); si no, por 'cadena_nombre' exacto.",
        "  3) Matcheo de tienda: por 'tienda_codigo' (el nº de tienda del cliente); si no, por nombre.",
        "  4) SKU: se busca en tu catálogo. Si no existe, se guarda como snapshot con el nombre que pongas.",
        "  5) 'periodo_tipo' acepta: day, week o month. Default: week.",
        "  6) Fechas en formato YYYY-MM-DD. Si dejas 'periodo_fin' vacío, se calcula según el tipo.",
        "  7) Si vuelves a subir una fila con el mismo (tienda, sku, periodo_inicio, periodo_tipo), se actualiza (no se duplica).",
        "  8) Consulta las hojas 'Cadenas', 'Tiendas' y 'Productos' para copiar los códigos exactos.",
    ]
    for row_ix, line in enumerate(lines, start=1):
        c = ws_i.cell(row=row_ix, column=1, value=line)
        if row_ix == 1:
            c.font = Font(bold=True, size=14, color="1E3A8A")
    ws_i.column_dimensions["A"].width = 110

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_sellout_template_csv() -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(TEMPLATE_HEADERS)
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    writer.writerow([
        "WMT", "Walmart",
        "1001", "Sucursal Centro",
        "SKU-001", "Producto de ejemplo",
        "week", week_start.isoformat(), week_end.isoformat(),
        12, 45, 12 * 1290.0,
        "Ejemplo — puedes borrar esta fila",
    ])
    return buf.getvalue().encode("utf-8-sig")


def _parse_int(v: Any) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _parse_float(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _parse_iso_date(v: Any) -> Optional[datetime]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=v.tzinfo or timezone.utc)
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc)
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _default_period_end(start: datetime, period_type: str) -> datetime:
    if period_type == "day":
        return start.replace(hour=23, minute=59, second=59)
    if period_type == "month":
        # último instante del mes calendario
        y, m = start.year, start.month
        if m == 12:
            nxt = datetime(y + 1, 1, 1, tzinfo=start.tzinfo)
        else:
            nxt = datetime(y, m + 1, 1, tzinfo=start.tzinfo)
        return nxt - timedelta(seconds=1)
    # week (default): 6 días completos
    return (start + timedelta(days=6)).replace(hour=23, minute=59, second=59)


async def _resolve_import_hints(
    db: AsyncSession,
) -> Tuple[Dict[str, int], Dict[Tuple[int, str], int], Dict[Tuple[int, str], int],
            Dict[str, Tuple[int, str, float]]]:
    """Índices para matcheo rápido:
      - chan_by_key: 'CODE' → channel_id, 'NAME::name lower' → channel_id
      - store_by_ext: (channel_id, external_code upper) → store_id
      - store_by_name: (channel_id, name lower) → store_id
      - variant_by_sku: sku upper → (variant_id, product_name, price)
    """
    chans = (await db.execute(select(models.RetailChannel))).scalars().all()
    chan_by_key: Dict[str, int] = {}
    for c in chans:
        if c.code:
            chan_by_key[c.code.strip().upper()] = c.id
        if c.name:
            chan_by_key[f"NAME::{c.name.strip().lower()}"] = c.id

    stores = (await db.execute(select(models.RetailStore))).scalars().all()
    store_by_ext: Dict[Tuple[int, str], int] = {}
    store_by_name: Dict[Tuple[int, str], int] = {}
    for s in stores:
        if s.external_code:
            store_by_ext[(s.channel_id, s.external_code.strip().upper())] = s.id
        if s.code:
            store_by_ext[(s.channel_id, s.code.strip().upper())] = s.id
        if s.name:
            store_by_name[(s.channel_id, s.name.strip().lower())] = s.id

    variants = (await db.execute(
        select(inv_models.ProductVariant.id, inv_models.ProductVariant.sku,
                inv_models.ProductVariant.price, inv_models.Product.name)
        .join(inv_models.Product, inv_models.ProductVariant.product_id == inv_models.Product.id)
    )).all()
    variant_by_sku: Dict[str, Tuple[int, str, float]] = {}
    for vid, sku, price, pname in variants:
        if sku:
            variant_by_sku[sku.strip().upper()] = (vid, pname or "", float(price or 0.0))

    return chan_by_key, store_by_ext, store_by_name, variant_by_sku


async def import_sellout(
    db: AsyncSession, file_bytes: bytes, filename: str,
    user_id: Optional[int] = None,
) -> schemas.ImportSellOutResponse:
    """Ingesta bulk de sell-out. Detecta xlsx/csv por extensión.

    - Matchea cadena por código, luego por nombre.
    - Matchea tienda por código externo/interno, luego por nombre.
    - Vincula SKU si existe en catálogo; si no, guarda snapshot con el nombre.
    - Upsert por (store, variant, period_start, period_type).
    - Fila con datos vacíos → skipped.
    - Fila con error → guarda en `errors`, sigue con las demás.
    """
    name_lower = (filename or "").lower()
    is_xlsx = name_lower.endswith(".xlsx") or name_lower.endswith(".xlsm")

    rows: List[Dict[str, Any]] = []
    if is_xlsx:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        target = "SellOut" if "SellOut" in wb.sheetnames else wb.active.title
        ws = wb[target]
        header: Optional[List[str]] = None
        for row in ws.iter_rows(values_only=True):
            if header is None:
                header = [str(c).strip().lower() if c is not None else "" for c in row]
                continue
            values = [c for c in row]
            if all(v is None or v == "" for v in values):
                continue
            rows.append(dict(zip(header, values)))
    else:
        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = file_bytes.decode("latin-1")
        reader = csv.DictReader(io.StringIO(text))
        for r in reader:
            data = {k.strip().lower(): v for k, v in r.items() if k}
            if all((v is None or str(v).strip() == "") for v in data.values()):
                continue
            rows.append(data)

    chan_by_key, store_by_ext, store_by_name, variant_by_sku = await _resolve_import_hints(db)

    created = 0
    updated = 0
    skipped = 0
    errors: List[schemas.ImportRowError] = []

    for row_idx, row in enumerate(rows, start=2):
        chan_code = str(row.get("cadena_codigo") or "").strip().upper()
        chan_name = str(row.get("cadena_nombre") or "").strip()
        store_code = str(row.get("tienda_codigo") or "").strip().upper()
        store_name = str(row.get("tienda_nombre") or "").strip()
        sku = str(row.get("sku") or "").strip().upper()
        product_name = str(row.get("producto_nombre") or "").strip()
        period_type = str(row.get("periodo_tipo") or "week").strip().lower()
        if period_type not in ("day", "week", "month"):
            period_type = "week"

        # Fila totalmente vacía → skip
        if not (chan_code or chan_name or store_code or store_name or sku or product_name):
            skipped += 1
            continue

        # Cadena
        chan_id: Optional[int] = chan_by_key.get(chan_code) if chan_code else None
        if chan_id is None and chan_name:
            chan_id = chan_by_key.get(f"NAME::{chan_name.lower()}")
        if chan_id is None:
            errors.append(schemas.ImportRowError(
                row=row_idx,
                reason=f"Cadena no encontrada (código='{chan_code}', nombre='{chan_name}')",
            ))
            continue

        # Tienda
        store_id: Optional[int] = None
        if store_code:
            store_id = store_by_ext.get((chan_id, store_code))
        if store_id is None and store_name:
            store_id = store_by_name.get((chan_id, store_name.lower()))
        if store_id is None:
            errors.append(schemas.ImportRowError(
                row=row_idx,
                reason=f"Tienda no encontrada en cadena {chan_id} (código='{store_code}', nombre='{store_name}')",
            ))
            continue

        # SKU (opcional en catálogo)
        variant_id: Optional[int] = None
        matched_pname: Optional[str] = None
        if sku and sku in variant_by_sku:
            variant_id, matched_pname, _price = variant_by_sku[sku]

        final_name = matched_pname or product_name or f"SKU {sku}" if sku else product_name
        if not final_name:
            errors.append(schemas.ImportRowError(
                row=row_idx, reason="Sin producto: pon SKU válido o producto_nombre.",
            ))
            continue

        # Fechas
        period_start = _parse_iso_date(row.get("periodo_inicio"))
        if period_start is None:
            errors.append(schemas.ImportRowError(
                row=row_idx, reason="periodo_inicio inválido o vacío (formato YYYY-MM-DD).",
            ))
            continue
        period_end = _parse_iso_date(row.get("periodo_fin"))
        if period_end is None:
            period_end = _default_period_end(period_start, period_type)

        units_sold = _parse_int(row.get("unidades_vendidas"))
        units_on_hand = _parse_int(row.get("unidades_stock"))
        revenue = _parse_float(row.get("ingreso"))
        notes = (str(row.get("notas") or "").strip() or None)

        # Upsert
        existing = (await db.execute(
            select(models.SellOutReport).where(
                models.SellOutReport.store_id == store_id,
                models.SellOutReport.variant_id == variant_id,
                models.SellOutReport.period_start == period_start,
                models.SellOutReport.period_type == period_type,
            )
        )).scalars().first()

        if existing:
            existing.period_end = period_end
            existing.units_sold = units_sold
            existing.units_on_hand = units_on_hand
            existing.revenue = revenue
            existing.notes = notes
            existing.product_name = final_name
            existing.sku = sku or existing.sku
            existing.source = "xlsx" if is_xlsx else "csv"
            existing.uploaded_by_user_id = user_id or existing.uploaded_by_user_id
            updated += 1
        else:
            r = models.SellOutReport(
                store_id=store_id, variant_id=variant_id,
                product_name=final_name, sku=sku or None,
                period_start=period_start, period_end=period_end,
                period_type=period_type,
                units_sold=units_sold, units_on_hand=units_on_hand,
                revenue=revenue, source="xlsx" if is_xlsx else "csv",
                uploaded_by_user_id=user_id, notes=notes,
            )
            db.add(r)
            created += 1

    await db.commit()

    # Auto-evalúa alertas para las cadenas tocadas
    try:
        touched_channels = set()
        # (Reutilizamos hint indirectamente; podríamos recorrer created rows, pero
        # basta con evaluar todo para simplicidad y consistencia global.)
        await evaluate_alerts(db)
    except Exception:
        pass

    return schemas.ImportSellOutResponse(
        total_rows=len(rows), created=created, updated=updated,
        skipped=skipped, errors=errors,
    )


# ── Alerts engine ───────────────────────────────────────────────────────

# Cuánto tiempo debe pasar para poder crear una alerta nueva del mismo
# tipo+store+variant tras cerrarse la anterior. Evita ruido de reapertura.
_ALERT_REOPEN_COOLDOWN = timedelta(hours=6)


def _severity_for_wos(wos: float, critical: float, target: float) -> str:
    if wos <= 0:
        return "urgent"
    if wos < critical:
        return "urgent"
    if wos < critical * 1.5 or wos < target * 0.5:
        return "high"
    return "medium"


def _is_wos_healthy(wos: float, critical: float, target: float, overstock: float) -> bool:
    return critical <= wos <= overstock


async def _summarize_alerts(db: AsyncSession, channel_id: Optional[int] = None
                              ) -> Tuple[int, int]:
    q = select(func.count(models.RetailAlert.id)).where(
        models.RetailAlert.status.in_(("open", "acknowledged"))
    )
    if channel_id is not None:
        q = q.where(models.RetailAlert.channel_id == channel_id)
    total_open = int((await db.execute(q)).scalar() or 0)

    q2 = q.where(models.RetailAlert.severity == "urgent")
    urgent = int((await db.execute(q2)).scalar() or 0)
    return total_open, urgent


async def evaluate_alerts(
    db: AsyncSession, channel_id: Optional[int] = None,
) -> schemas.EvaluateAlertsResponse:
    """Recorre stores × variants con sell-out reciente y genera / auto-resuelve
    alertas según las reglas de la cadena. Idempotente.
    """
    now = datetime.now(timezone.utc)
    velocity_from = now - timedelta(days=VELOCITY_WINDOW_DAYS)

    # Cadenas a considerar
    ch_stmt = select(models.RetailChannel).where(
        models.RetailChannel.alerts_enabled.is_(True),
        models.RetailChannel.is_active.is_(True),
    )
    if channel_id is not None:
        ch_stmt = ch_stmt.where(models.RetailChannel.id == channel_id)
    channels = list((await db.execute(ch_stmt)).scalars().all())
    if not channels:
        total_open, urgent = await _summarize_alerts(db, channel_id)
        return schemas.EvaluateAlertsResponse(
            created=0, auto_resolved=0, total_open=total_open, urgent_open=urgent,
        )

    channel_ids = [c.id for c in channels]

    # Combos (store, variant) con sell-out en ventana + último período por combo
    combos_stmt = (
        select(
            models.RetailStore.id.label("store_id"),
            models.RetailStore.name.label("store_name"),
            models.RetailStore.channel_id.label("channel_id"),
            models.SellOutReport.variant_id,
            models.SellOutReport.product_name,
            models.SellOutReport.sku,
            func.max(models.SellOutReport.period_start).label("last_period"),
            func.max(models.SellOutReport.period_end).label("last_period_end"),
            func.coalesce(func.sum(models.SellOutReport.units_sold), 0).label("units_window"),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .where(
            models.RetailStore.channel_id.in_(channel_ids),
            models.RetailStore.is_active.is_(True),
        )
        .group_by(
            models.RetailStore.id, models.RetailStore.name,
            models.RetailStore.channel_id,
            models.SellOutReport.variant_id,
            models.SellOutReport.product_name,
            models.SellOutReport.sku,
        )
    )
    combos = (await db.execute(combos_stmt)).all()

    # Para el sell-through: sell-out por cadena en ventana
    sell_out_by_channel: Dict[int, int] = {}
    for r in combos:
        # Únicamente sumamos ventas en la ventana
        # (Se recalcula abajo por precisión sobre period_start)
        pass

    from app.modules.sales import models as sales_models

    sellout_agg = (await db.execute(
        select(
            models.RetailStore.channel_id,
            func.coalesce(func.sum(models.SellOutReport.units_sold), 0),
        )
        .join(models.RetailStore, models.SellOutReport.store_id == models.RetailStore.id)
        .where(models.SellOutReport.period_start >= velocity_from,
                models.RetailStore.channel_id.in_(channel_ids))
        .group_by(models.RetailStore.channel_id)
    )).all()
    for cid, u in sellout_agg:
        sell_out_by_channel[int(cid)] = int(u or 0)

    # Sell-in por cadena (con customer vinculado)
    sell_in_by_channel: Dict[int, int] = {ch.id: 0 for ch in channels}
    cust_map = {ch.id: ch.customer_id for ch in channels if ch.customer_id}
    if cust_map:
        cust_ids = list(cust_map.values())
        si_rows = (await db.execute(
            select(
                sales_models.Order.customer_id,
                func.coalesce(func.sum(sales_models.OrderItem.quantity), 0),
            )
            .join(sales_models.OrderItem, sales_models.OrderItem.order_id == sales_models.Order.id)
            .where(
                sales_models.Order.customer_id.in_(cust_ids),
                sales_models.Order.kind == "order",
                sales_models.Order.status != "cancelled",
                sales_models.Order.created_at >= velocity_from,
            )
            .group_by(sales_models.Order.customer_id)
        )).all()
        cust_to_ch = {v: k for k, v in cust_map.items()}
        for cust_id, u in si_rows:
            ch_id = cust_to_ch.get(int(cust_id))
            if ch_id:
                sell_in_by_channel[ch_id] = int(u or 0)

    # Alertas abiertas actuales — para dedupe y auto-resolve
    open_alerts_rows = (await db.execute(
        select(models.RetailAlert).where(
            models.RetailAlert.channel_id.in_(channel_ids),
            models.RetailAlert.status.in_(("open", "acknowledged")),
        )
    )).scalars().all()
    open_by_key: Dict[Tuple[str, int, Optional[int]], models.RetailAlert] = {}
    for a in open_alerts_rows:
        open_by_key[(a.alert_type, a.store_id, a.variant_id)] = a

    # Índice por canal (config)
    ch_by_id: Dict[int, models.RetailChannel] = {c.id: c for c in channels}

    created = 0
    auto_resolved = 0
    seen_keys: set = set()
    now_dt = now

    async def _upsert(
        alert_type: str, store_id: int, variant_id: Optional[int],
        channel_id_val: int, message: str, severity: str,
        wos: Optional[float], on_hand: Optional[int], velocity: Optional[float],
        store_name: Optional[str], product_name: Optional[str], sku: Optional[str],
    ):
        nonlocal created
        key = (alert_type, store_id, variant_id)
        seen_keys.add(key)
        existing = open_by_key.get(key)
        if existing:
            # Update snapshot para reflejar el estado más reciente
            existing.severity = severity
            existing.message = message
            existing.wos_snapshot = wos
            existing.on_hand_snapshot = on_hand
            existing.weekly_velocity_snapshot = velocity
            existing.store_name = store_name
            existing.product_name = product_name
            existing.sku = sku
            return
        # Verifica cooldown: no reabrir si acabamos de cerrar la misma
        prev_stmt = (
            select(models.RetailAlert)
            .where(
                models.RetailAlert.alert_type == alert_type,
                models.RetailAlert.store_id == store_id,
                models.RetailAlert.variant_id == variant_id,
                models.RetailAlert.status.in_(("resolved", "dismissed")),
                models.RetailAlert.resolved_at.isnot(None),
            )
            .order_by(models.RetailAlert.resolved_at.desc())
            .limit(1)
        )
        prev = (await db.execute(prev_stmt)).scalars().first()
        if prev and prev.resolved_at and (now_dt - prev.resolved_at) < _ALERT_REOPEN_COOLDOWN:
            return
        a = models.RetailAlert(
            channel_id=channel_id_val, store_id=store_id, variant_id=variant_id,
            alert_type=alert_type, severity=severity, message=message,
            wos_snapshot=wos, on_hand_snapshot=on_hand,
            weekly_velocity_snapshot=velocity,
            store_name=store_name, product_name=product_name, sku=sku,
            status="open",
        )
        db.add(a)
        created += 1

    # Evaluación combo por combo
    for r in combos:
        ch = ch_by_id.get(int(r.channel_id))
        if ch is None:
            continue
        # On-hand actual: suma del último período de ese (store, variant)
        on_hand = int((await db.execute(
            select(func.coalesce(func.sum(models.SellOutReport.units_on_hand), 0))
            .where(
                models.SellOutReport.store_id == r.store_id,
                models.SellOutReport.variant_id == r.variant_id,
                models.SellOutReport.period_start == r.last_period,
            )
        )).scalar() or 0)

        # Solo la ventana de velocidad
        units_win_row = (await db.execute(
            select(func.coalesce(func.sum(models.SellOutReport.units_sold), 0))
            .where(
                models.SellOutReport.store_id == r.store_id,
                models.SellOutReport.variant_id == r.variant_id,
                models.SellOutReport.period_start >= velocity_from,
            )
        )).scalar() or 0
        units_win = int(units_win_row)
        velocity = units_win / (VELOCITY_WINDOW_DAYS / 7.0) if units_win > 0 else 0.0

        wos = (on_hand / velocity) if velocity > 0 else WOS_INFINITY

        product_name = r.product_name
        sku = r.sku
        store_name = r.store_name

        # Regla stockout puro
        if on_hand == 0 and velocity > 0:
            await _upsert(
                "stockout", r.store_id, r.variant_id, ch.id,
                message=(f"Sin stock en {store_name} · {product_name or sku or 'SKU'}. "
                        f"Velocidad {velocity:.1f} u/sem — venta detenida."),
                severity="urgent",
                wos=0.0, on_hand=0, velocity=velocity,
                store_name=store_name, product_name=product_name, sku=sku,
            )
        # Regla stockout_imminent
        elif velocity > 0 and wos < ch.critical_wos_weeks:
            sev = _severity_for_wos(wos, ch.critical_wos_weeks, ch.target_wos_weeks)
            await _upsert(
                "stockout_imminent", r.store_id, r.variant_id, ch.id,
                message=(f"WOS crítico {wos:.1f} sem en {store_name} · "
                        f"{product_name or sku or 'SKU'} (mín {ch.critical_wos_weeks:.0f})."),
                severity=sev,
                wos=round(wos, 2), on_hand=on_hand, velocity=velocity,
                store_name=store_name, product_name=product_name, sku=sku,
            )
        # Regla overstock
        if velocity > 0 and wos > ch.overstock_wos_weeks and wos < WOS_INFINITY:
            await _upsert(
                "overstock", r.store_id, r.variant_id, ch.id,
                message=(f"Sobreinventario {wos:.1f} sem en {store_name} · "
                        f"{product_name or sku or 'SKU'} (máx {ch.overstock_wos_weeks:.0f})."),
                severity="medium",
                wos=round(wos, 2), on_hand=on_hand, velocity=velocity,
                store_name=store_name, product_name=product_name, sku=sku,
            )
        # Regla no_movement (con on_hand > 0 y ventana sin ventas)
        no_move_days = int(ch.no_movement_days or 21)
        no_move_threshold = now - timedelta(days=no_move_days)
        if on_hand > 0 and velocity == 0 and r.last_period_end is not None:
            last_sale_stmt = (
                select(func.max(models.SellOutReport.period_end))
                .where(
                    models.SellOutReport.store_id == r.store_id,
                    models.SellOutReport.variant_id == r.variant_id,
                    models.SellOutReport.units_sold > 0,
                )
            )
            last_sale = (await db.execute(last_sale_stmt)).scalar()
            if last_sale is not None and last_sale.tzinfo is None:
                last_sale = last_sale.replace(tzinfo=timezone.utc)
            if last_sale is None or last_sale < no_move_threshold:
                await _upsert(
                    "no_movement", r.store_id, r.variant_id, ch.id,
                    message=(f"Sin ventas > {no_move_days} días en {store_name} · "
                            f"{product_name or sku or 'SKU'} · {on_hand} en stock."),
                    severity="high",
                    wos=None, on_hand=on_hand, velocity=0.0,
                    store_name=store_name, product_name=product_name, sku=sku,
                )

    # Regla a nivel cadena: sell_through_low
    for ch in channels:
        so = sell_out_by_channel.get(ch.id, 0)
        si = sell_in_by_channel.get(ch.id, 0)
        if si <= 0:
            continue
        pct = so / si * 100.0
        if pct < ch.sell_through_min_pct:
            # store_id/variant_id no aplican; usamos alguna tienda representativa
            rep_store = (await db.execute(
                select(models.RetailStore.id, models.RetailStore.name).where(
                    models.RetailStore.channel_id == ch.id,
                    models.RetailStore.is_active.is_(True),
                ).limit(1)
            )).first()
            if rep_store is None:
                continue
            store_id_val, store_name_val = int(rep_store[0]), rep_store[1]
            await _upsert(
                "sell_through_low", store_id_val, None, ch.id,
                message=(f"Sell-through de {ch.name} en {pct:.1f}% "
                        f"(mín {ch.sell_through_min_pct:.0f}%). Sell-in {si} u "
                        f"vs sell-out {so} u en {VELOCITY_WINDOW_DAYS} días."),
                severity="medium",
                wos=None, on_hand=None, velocity=None,
                store_name=store_name_val, product_name=None, sku=None,
            )

    # Auto-resolve: alertas abiertas cuya condición YA NO SE CUMPLE
    for key, alert in open_by_key.items():
        if key in seen_keys:
            continue
        # No la volvimos a levantar → auto-resolve
        alert.status = "resolved"
        alert.resolved_at = now
        alert.resolution_notes = "Condición vuelta a zona sana"
        auto_resolved += 1

    await db.commit()

    total_open, urgent = await _summarize_alerts(db, channel_id)
    return schemas.EvaluateAlertsResponse(
        created=created, auto_resolved=auto_resolved,
        total_open=total_open, urgent_open=urgent,
    )


# ── Consulta / acciones sobre alertas ────────────────────────────────────

async def list_alerts(
    db: AsyncSession, channel_id: Optional[int] = None,
    status: Optional[str] = None, severity: Optional[str] = None,
    limit: int = 500,
) -> List[schemas.RetailAlertOut]:
    stmt = (
        select(
            models.RetailAlert,
            models.RetailChannel.name.label("channel_name"),
        )
        .join(models.RetailChannel, models.RetailAlert.channel_id == models.RetailChannel.id)
    )
    if channel_id is not None:
        stmt = stmt.where(models.RetailAlert.channel_id == channel_id)
    if status:
        stmt = stmt.where(models.RetailAlert.status == status)
    if severity:
        stmt = stmt.where(models.RetailAlert.severity == severity)
    stmt = stmt.order_by(
        # Prioridad urgent primero, luego por fecha
        func.lower(models.RetailAlert.status) == "open",  # true (1) → open primero
        models.RetailAlert.severity == "urgent",
        models.RetailAlert.created_at.desc(),
    ).limit(limit)
    rows = (await db.execute(stmt)).all()
    return [
        schemas.RetailAlertOut(
            id=a.id, channel_id=a.channel_id, channel_name=cn,
            store_id=a.store_id, store_name=a.store_name,
            variant_id=a.variant_id, product_name=a.product_name, sku=a.sku,
            alert_type=a.alert_type, severity=a.severity, message=a.message,
            wos_snapshot=a.wos_snapshot,
            on_hand_snapshot=a.on_hand_snapshot,
            weekly_velocity_snapshot=a.weekly_velocity_snapshot,
            status=a.status,
            acknowledged_at=a.acknowledged_at,
            acknowledged_by_user_id=a.acknowledged_by_user_id,
            resolved_at=a.resolved_at,
            resolved_by_user_id=a.resolved_by_user_id,
            resolution_notes=a.resolution_notes,
            created_at=a.created_at,
        ) for a, cn in rows
    ]


async def alerts_summary(db: AsyncSession, channel_id: Optional[int] = None
                          ) -> schemas.AlertsSummary:
    def _count(cond) -> int:
        stmt = select(func.count(models.RetailAlert.id)).where(cond)
        if channel_id is not None:
            stmt = stmt.where(models.RetailAlert.channel_id == channel_id)
        # Ejecuta síncrono in-async via caller
        return stmt

    open_c = int((await db.execute(_count(models.RetailAlert.status == "open"))).scalar() or 0)
    ack_c = int((await db.execute(_count(models.RetailAlert.status == "acknowledged"))).scalar() or 0)

    def _sev(sev: str):
        return _count(and_(
            models.RetailAlert.status.in_(("open", "acknowledged")),
            models.RetailAlert.severity == sev,
        ))

    urgent = int((await db.execute(_sev("urgent"))).scalar() or 0)
    high = int((await db.execute(_sev("high"))).scalar() or 0)
    medium = int((await db.execute(_sev("medium"))).scalar() or 0)
    low = int((await db.execute(_sev("low"))).scalar() or 0)

    return schemas.AlertsSummary(
        open=open_c, urgent=urgent, high=high, medium=medium, low=low,
        acknowledged=ack_c,
    )


async def acknowledge_alert(db: AsyncSession, alert_id: int,
                              user_id: Optional[int], notes: Optional[str] = None
                              ) -> Optional[models.RetailAlert]:
    a = await db.get(models.RetailAlert, alert_id)
    if a is None:
        return None
    if a.status not in ("open", "acknowledged"):
        raise ValueError(f"La alerta ya está {a.status}")
    a.status = "acknowledged"
    a.acknowledged_at = datetime.now(timezone.utc)
    a.acknowledged_by_user_id = user_id
    if notes:
        a.resolution_notes = notes
    await db.commit()
    await db.refresh(a)
    return a


async def resolve_alert(db: AsyncSession, alert_id: int,
                          user_id: Optional[int], notes: Optional[str] = None
                          ) -> Optional[models.RetailAlert]:
    a = await db.get(models.RetailAlert, alert_id)
    if a is None:
        return None
    if a.status in ("resolved", "dismissed"):
        raise ValueError(f"La alerta ya está {a.status}")
    a.status = "resolved"
    a.resolved_at = datetime.now(timezone.utc)
    a.resolved_by_user_id = user_id
    if notes:
        a.resolution_notes = notes
    await db.commit()
    await db.refresh(a)
    return a


async def dismiss_alert(db: AsyncSession, alert_id: int,
                         user_id: Optional[int], notes: Optional[str] = None
                         ) -> Optional[models.RetailAlert]:
    a = await db.get(models.RetailAlert, alert_id)
    if a is None:
        return None
    if a.status in ("resolved", "dismissed"):
        raise ValueError(f"La alerta ya está {a.status}")
    a.status = "dismissed"
    a.resolved_at = datetime.now(timezone.utc)
    a.resolved_by_user_id = user_id
    if notes:
        a.resolution_notes = notes
    await db.commit()
    await db.refresh(a)
    return a


async def _alert_to_schema(db: AsyncSession, a: models.RetailAlert) -> schemas.RetailAlertOut:
    ch = await db.get(models.RetailChannel, a.channel_id)
    return schemas.RetailAlertOut(
        id=a.id, channel_id=a.channel_id,
        channel_name=ch.name if ch else None,
        store_id=a.store_id, store_name=a.store_name,
        variant_id=a.variant_id, product_name=a.product_name, sku=a.sku,
        alert_type=a.alert_type, severity=a.severity, message=a.message,
        wos_snapshot=a.wos_snapshot,
        on_hand_snapshot=a.on_hand_snapshot,
        weekly_velocity_snapshot=a.weekly_velocity_snapshot,
        status=a.status,
        acknowledged_at=a.acknowledged_at,
        acknowledged_by_user_id=a.acknowledged_by_user_id,
        resolved_at=a.resolved_at,
        resolved_by_user_id=a.resolved_by_user_id,
        resolution_notes=a.resolution_notes,
        created_at=a.created_at,
    )
