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

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

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
