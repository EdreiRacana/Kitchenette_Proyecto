"""
Servicio del planificador de promociones.

Núcleo funcional: `compute_suggestions()` toma una promoción capturada y para
cada (variante × tienda destino) proyecta la demanda esperada durante la
ventana y sugiere cuántas unidades traspasar desde el CEDIS/almacén con más
disponibilidad. El resultado se persiste en PromotionSuggestion y puede
convertirse en traspasos reales con `materialize_suggestions()`.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Optional

from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.modules.inventory.models import (
    ProductVariant, StockLevel, Warehouse, WarehouseType,
)
from app.modules.sales.models import Order, OrderItem
from app.modules.promotions.models import (
    PromotionPlan, PromotionPlanItem, PromotionTargetStore,
    PromotionSuggestion, PromotionStatus,
)


# ── helpers ────────────────────────────────────────────────────────────────

async def _next_folio(db: AsyncSession) -> str:
    n = (await db.execute(select(func.count(PromotionPlan.id)))).scalar() or 0
    return f"PRM-{n + 1:06d}"


def _serialize(p: PromotionPlan) -> dict:
    """Serializa una promoción con items/tiendas/sugerencias resueltos."""
    return {
        "id": p.id,
        "folio": p.folio,
        "name": p.name,
        "description": p.description,
        "start_date": p.start_date,
        "end_date": p.end_date,
        "expected_uplift_pct": p.expected_uplift_pct,
        "baseline_lookback_days": p.baseline_lookback_days,
        "lead_time_days": p.lead_time_days,
        "status": p.status,
        "notes": p.notes,
        "created_at": p.created_at,
        "items": [
            {
                "id": it.id,
                "variant_id": it.variant_id,
                "sku": it.variant.sku if it.variant else None,
                "product_name": (
                    it.variant.product.name if it.variant and it.variant.product else None
                ),
                "promo_price": it.promo_price,
                "discount_pct": it.discount_pct,
            }
            for it in (p.items or [])
        ],
        "stores": [
            {
                "id": s.id,
                "warehouse_id": s.warehouse_id,
                "warehouse_name": s.warehouse.name if s.warehouse else None,
            }
            for s in (p.stores or [])
        ],
        "suggestions": [
            {
                "id": s.id,
                "variant_id": s.variant_id,
                "source_warehouse_id": s.source_warehouse_id,
                "destination_warehouse_id": s.destination_warehouse_id,
                "baseline_daily_velocity": s.baseline_daily_velocity,
                "expected_units_during_promo": s.expected_units_during_promo,
                "current_stock": s.current_stock,
                "quantity_suggested": s.quantity_suggested,
                "shortage_flag": s.shortage_flag,
                "note": s.note,
                "transfer_id": s.transfer_id,
                "computed_at": s.computed_at,
            }
            for s in (p.suggestions or [])
        ],
    }


async def _load_plan(db: AsyncSession, promotion_id: int) -> Optional[PromotionPlan]:
    res = await db.execute(
        select(PromotionPlan).where(PromotionPlan.id == promotion_id).options(
            selectinload(PromotionPlan.items).selectinload(PromotionPlanItem.variant).selectinload(ProductVariant.product),
            selectinload(PromotionPlan.stores).selectinload(PromotionTargetStore.warehouse),
            selectinload(PromotionPlan.suggestions),
        )
    )
    return res.scalars().first()


# ── CRUD básico ────────────────────────────────────────────────────────────

async def create_promotion(db: AsyncSession, data: dict, user_id: Optional[int] = None) -> dict:
    folio = await _next_folio(db)
    p = PromotionPlan(
        folio=folio,
        name=data["name"],
        description=data.get("description"),
        start_date=data["start_date"],
        end_date=data["end_date"],
        expected_uplift_pct=float(data.get("expected_uplift_pct") or 50.0),
        baseline_lookback_days=int(data.get("baseline_lookback_days") or 30),
        lead_time_days=int(data.get("lead_time_days") or 5),
        status=PromotionStatus.PLANNED.value,
        notes=data.get("notes"),
        created_by_id=user_id,
    )
    db.add(p)
    await db.flush()

    for it in (data.get("items") or []):
        db.add(PromotionPlanItem(
            promotion_id=p.id,
            variant_id=int(it["variant_id"]),
            promo_price=it.get("promo_price"),
            discount_pct=it.get("discount_pct"),
        ))
    for wid in (data.get("warehouse_ids") or []):
        db.add(PromotionTargetStore(promotion_id=p.id, warehouse_id=int(wid)))

    await db.commit()
    return _serialize(await _load_plan(db, p.id))


async def list_promotions(db: AsyncSession, status: Optional[str] = None,
                           limit: int = 100) -> List[dict]:
    stmt = select(PromotionPlan).options(
        selectinload(PromotionPlan.items).selectinload(PromotionPlanItem.variant).selectinload(ProductVariant.product),
        selectinload(PromotionPlan.stores).selectinload(PromotionTargetStore.warehouse),
        selectinload(PromotionPlan.suggestions),
    ).order_by(PromotionPlan.start_date.desc()).limit(limit)
    if status:
        stmt = stmt.where(PromotionPlan.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize(p) for p in rows]


async def get_promotion(db: AsyncSession, promotion_id: int) -> Optional[dict]:
    p = await _load_plan(db, promotion_id)
    return _serialize(p) if p else None


async def update_promotion(db: AsyncSession, promotion_id: int, data: dict) -> Optional[dict]:
    p = await db.get(PromotionPlan, promotion_id)
    if not p:
        return None
    for field in ("name", "description", "start_date", "end_date",
                  "expected_uplift_pct", "baseline_lookback_days",
                  "lead_time_days", "status", "notes"):
        if field in data and data[field] is not None:
            setattr(p, field, data[field])
    await db.commit()
    return await get_promotion(db, promotion_id)


async def cancel_promotion(db: AsyncSession, promotion_id: int) -> Optional[dict]:
    p = await db.get(PromotionPlan, promotion_id)
    if not p:
        return None
    p.status = PromotionStatus.CANCELLED.value
    await db.commit()
    return await get_promotion(db, promotion_id)


# ── Motor de sugerencias ───────────────────────────────────────────────────

async def _velocity_by_variant_warehouse(
    db: AsyncSession, *, variant_ids: List[int], warehouse_ids: List[int],
    lookback_days: int,
) -> dict[tuple[int, int], float]:
    """Devuelve un mapa (variant_id, warehouse_id) → velocidad diaria (unidades/día)
    calculada con las ventas de los últimos N días."""
    if not variant_ids or not warehouse_ids:
        return {}
    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    stmt = (
        select(
            OrderItem.variant_id.label("vid"),
            Order.warehouse_id.label("wid"),
            func.coalesce(func.sum(OrderItem.quantity), 0).label("units"),
        )
        .join(Order, OrderItem.order_id == Order.id)
        .where(
            Order.kind == "order",
            Order.status.notin_(["cancelled", "draft"]),
            Order.created_at >= since,
            OrderItem.variant_id.in_(variant_ids),
            Order.warehouse_id.in_(warehouse_ids),
        )
        .group_by(OrderItem.variant_id, Order.warehouse_id)
    )
    rows = (await db.execute(stmt)).all()
    out: dict[tuple[int, int], float] = {}
    for r in rows:
        units = int(r.units or 0)
        if units <= 0:
            continue
        out[(int(r.vid), int(r.wid))] = units / max(1, lookback_days)
    return out


async def _velocity_global_by_variant(
    db: AsyncSession, *, variant_ids: List[int], lookback_days: int,
) -> dict[int, float]:
    """Fallback: velocidad promedio de la variante en TODOS los almacenes.
    Se usa cuando una tienda destino no tiene historial propio de esa variante
    (típico de una tienda nueva o un SKU recién lanzado)."""
    if not variant_ids:
        return {}
    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    stmt = (
        select(
            OrderItem.variant_id.label("vid"),
            func.coalesce(func.sum(OrderItem.quantity), 0).label("units"),
            func.count(func.distinct(Order.warehouse_id)).label("wh_count"),
        )
        .join(Order, OrderItem.order_id == Order.id)
        .where(
            Order.kind == "order",
            Order.status.notin_(["cancelled", "draft"]),
            Order.created_at >= since,
            OrderItem.variant_id.in_(variant_ids),
        )
        .group_by(OrderItem.variant_id)
    )
    rows = (await db.execute(stmt)).all()
    out: dict[int, float] = {}
    for r in rows:
        units = int(r.units or 0)
        wh_count = max(1, int(r.wh_count or 1))
        # Promedio por tienda para no sobreestimar
        out[int(r.vid)] = units / (max(1, lookback_days) * wh_count)
    return out


async def _stock_map(
    db: AsyncSession, *, variant_ids: List[int], warehouse_ids: List[int],
) -> dict[tuple[int, int], int]:
    if not variant_ids or not warehouse_ids:
        return {}
    stmt = select(StockLevel).where(
        StockLevel.variant_id.in_(variant_ids),
        StockLevel.warehouse_id.in_(warehouse_ids),
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: dict[tuple[int, int], int] = {}
    for lvl in rows:
        available = max(0, int(lvl.quantity or 0) - int(lvl.reserved_quantity or 0))
        out[(int(lvl.variant_id), int(lvl.warehouse_id))] = available
    return out


async def _all_warehouse_stock_map(
    db: AsyncSession, *, variant_ids: List[int],
) -> dict[int, list[tuple[int, int]]]:
    """Mapa variant_id → [(warehouse_id, available), ...] ordenado por
    available desc. Usado para elegir el mejor origen (CEDIS con más stock)."""
    if not variant_ids:
        return {}
    stmt = select(StockLevel).where(StockLevel.variant_id.in_(variant_ids))
    rows = (await db.execute(stmt)).scalars().all()
    grouped: dict[int, list[tuple[int, int]]] = {}
    for lvl in rows:
        available = max(0, int(lvl.quantity or 0) - int(lvl.reserved_quantity or 0))
        if available <= 0:
            continue
        grouped.setdefault(int(lvl.variant_id), []).append((int(lvl.warehouse_id), available))
    for k in grouped:
        grouped[k].sort(key=lambda t: -t[1])
    return grouped


async def compute_suggestions(db: AsyncSession, promotion_id: int) -> dict:
    """Motor central: proyecta demanda y genera sugerencias de traspaso.

    Algoritmo:
      1. Para cada (variante × tienda-destino) calcular velocidad base histórica
         (ventas del almacén / N días). Si es cero, usar promedio global.
      2. Demanda esperada durante la promo = velocidad × días_promo × (1+uplift/100)
      3. Déficit = max(0, demanda − stock_actual)
      4. Elegir origen: almacén con más stock disponible que NO sea la tienda
         destino y que tenga tipo 'own' (preferencia por el CEDIS).
      5. Si el origen total no alcanza para todos los destinos, se prorratea y
         se marca `shortage_flag='partial'` (o 'no_source' si no hay dónde
         sacarlo).

    Cada corrida borra las sugerencias previas de la promo y regenera desde cero,
    excepto aquellas ya materializadas en un traspaso real (para no perder
    trazabilidad del histórico)."""
    p = await _load_plan(db, promotion_id)
    if not p:
        return {}

    # Borrar sugerencias previas NO materializadas
    for s in list(p.suggestions):
        if s.transfer_id is None:
            await db.delete(s)
    await db.flush()

    variant_ids = [it.variant_id for it in p.items]
    dest_wh_ids = [s.warehouse_id for s in p.stores]
    if not variant_ids or not dest_wh_ids:
        await db.commit()
        return await get_promotion(db, promotion_id)

    promo_days = max(1, (p.end_date.date() - p.start_date.date()).days + 1)
    uplift = 1.0 + (float(p.expected_uplift_pct or 0.0) / 100.0)

    # Velocidades y stocks
    velocity_map = await _velocity_by_variant_warehouse(
        db, variant_ids=variant_ids, warehouse_ids=dest_wh_ids,
        lookback_days=int(p.baseline_lookback_days or 30),
    )
    velocity_global = await _velocity_global_by_variant(
        db, variant_ids=variant_ids, lookback_days=int(p.baseline_lookback_days or 30),
    )
    stock_map = await _stock_map(db, variant_ids=variant_ids, warehouse_ids=dest_wh_ids)
    all_stock = await _all_warehouse_stock_map(db, variant_ids=variant_ids)

    # Presupuesto por variante: cuánto stock queda disponible en orígenes conforme
    # vamos asignando a los destinos.
    remaining_source_stock: dict[int, dict[int, int]] = {}
    for vid, sources in all_stock.items():
        remaining_source_stock[vid] = {wh_id: qty for wh_id, qty in sources}

    for it in p.items:
        vid = it.variant_id
        for store in p.stores:
            dest_wid = store.warehouse_id
            velocity = velocity_map.get((vid, dest_wid))
            used_fallback = False
            if not velocity or velocity <= 0:
                velocity = velocity_global.get(vid, 0.0)
                used_fallback = True

            expected = velocity * promo_days * uplift
            current = int(stock_map.get((vid, dest_wid), 0))
            deficit = max(0, int(round(expected)) - current)

            # Elegir origen: descartar el propio destino, preferir CEDIS ('own'
            # type) con más stock. Si no hay CEDIS, cualquier almacén con stock.
            source_wid: Optional[int] = None
            shortage_flag: Optional[str] = None
            allocated = 0
            note_bits: List[str] = []
            if used_fallback:
                note_bits.append("Velocidad estimada con promedio global (sin historial en esta tienda)")

            if deficit > 0:
                # Ordenar candidatos por stock restante
                candidates = [
                    (wid, qty) for wid, qty in remaining_source_stock.get(vid, {}).items()
                    if wid != dest_wid and qty > 0
                ]
                candidates.sort(key=lambda t: -t[1])
                if not candidates:
                    shortage_flag = "no_source"
                    note_bits.append("Sin stock disponible en ningún almacén origen")
                else:
                    source_wid, avail = candidates[0]
                    allocated = min(deficit, avail)
                    if allocated < deficit:
                        shortage_flag = "partial"
                        note_bits.append(f"Origen alcanza solo {allocated} de {deficit} requeridas")
                    remaining_source_stock[vid][source_wid] = avail - allocated

            db.add(PromotionSuggestion(
                promotion_id=p.id,
                variant_id=vid,
                source_warehouse_id=source_wid,
                destination_warehouse_id=dest_wid,
                baseline_daily_velocity=round(velocity, 4),
                expected_units_during_promo=round(expected, 2),
                current_stock=current,
                quantity_suggested=allocated,
                shortage_flag=shortage_flag,
                note="; ".join(note_bits) or None,
            ))

    await db.commit()
    return await get_promotion(db, promotion_id)


# ── Materialización: sugerencias → traspasos reales ────────────────────────

async def materialize_suggestions(db: AsyncSession, promotion_id: int,
                                    suggestion_ids: Optional[List[int]] = None,
                                    user_id: Optional[int] = None) -> dict:
    """Convierte sugerencias en StockTransfer reales.

    Agrupa por (origen, destino): todas las variantes que van del mismo origen
    al mismo destino se juntan en UN solo traspaso (menos folios, menos ruido
    operativo). Cada sugerencia procesada queda ligada al transfer creado
    (transfer_id) para trazabilidad.

    Se ignoran las sugerencias sin source_warehouse_id o sin quantity_suggested,
    y las que ya tienen transfer_id (idempotente)."""
    from app.modules.inventory import service as inventory_service

    p = await _load_plan(db, promotion_id)
    if not p:
        return {}

    to_process = [s for s in p.suggestions if s.source_warehouse_id is not None
                  and s.quantity_suggested > 0
                  and s.transfer_id is None
                  and (suggestion_ids is None or s.id in suggestion_ids)]

    # Agrupar por (origen, destino)
    grouped: dict[tuple[int, int], list[PromotionSuggestion]] = {}
    for s in to_process:
        key = (s.source_warehouse_id, s.destination_warehouse_id)
        grouped.setdefault(key, []).append(s)

    created_transfers: list[dict] = []
    for (src, dst), sugs in grouped.items():
        transfer_data = {
            "source_warehouse_id": src,
            "destination_warehouse_id": dst,
            "expected_delivery_date": p.start_date - timedelta(days=int(p.lead_time_days or 0))
                if p.lead_time_days else p.start_date,
            "notes": f"Reposición para promoción {p.folio} — {p.name}",
            "items": [
                {"variant_id": s.variant_id, "quantity_requested": s.quantity_suggested}
                for s in sugs
            ],
        }
        transfer = await inventory_service.create_stock_transfer(
            db, transfer_data, user_id=user_id,
        )
        transfer_id = transfer.get("id") if transfer else None
        if transfer_id:
            for s in sugs:
                s.transfer_id = transfer_id
            created_transfers.append(transfer)

    await db.commit()
    result = await get_promotion(db, promotion_id)
    if result:
        result["created_transfers"] = created_transfers
    return result
