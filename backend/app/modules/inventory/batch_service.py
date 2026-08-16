"""Servicio de lotes y trazabilidad para productos perecederos.

Complementa fifo_service:
- Consulta lotes por caducidad (dashboard "Próximo a caducar")
- Retiro sanitario (recall) de un lote con lista de clientes afectados
- Cuarentena / liberación manual
- Auto-merma diaria de lotes que cruzan expiration_date
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional, List, Dict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func, and_

from app.modules.inventory import models


# Bucket de severidad para el dashboard
BUCKETS = {
    "expired": lambda days: days is not None and days <= 0,
    "critical": lambda days: days is not None and 1 <= days <= 7,
    "alert": lambda days: days is not None and 8 <= days <= 30,
    "ok": lambda days: days is not None and days > 30,
}


def _bucket_for(days_to_expire: Optional[int]) -> str:
    if days_to_expire is None:
        return "no_expiry"
    if days_to_expire <= 0:
        return "expired"
    if days_to_expire <= 7:
        return "critical"
    if days_to_expire <= 30:
        return "alert"
    return "ok"


async def list_expiring_lots(
    db: AsyncSession, *,
    days: int = 30,
    warehouse_id: Optional[int] = None,
    include_expired: bool = True,
    limit: int = 500,
) -> Dict:
    """Lista lotes activos con caducidad dentro de los próximos `days` días
    (por default 30 = alerta amarilla). Si include_expired, también los ya
    caducados que aún tienen stock (deben moverse a merma cuanto antes)."""
    today = date.today()
    horizon = today + timedelta(days=max(0, days))

    conds = [
        models.StockLot.quantity_remaining > 0,
        models.StockLot.expiration_date.isnot(None),
        models.StockLot.status.in_(("active", "quarantine")),
    ]
    if include_expired:
        # <= horizon captura tanto los ya caducados como los próximos
        conds.append(models.StockLot.expiration_date <= horizon)
    else:
        conds.append(models.StockLot.expiration_date > today)
        conds.append(models.StockLot.expiration_date <= horizon)
    if warehouse_id is not None:
        conds.append(models.StockLot.warehouse_id == warehouse_id)

    res = await db.execute(
        select(models.StockLot)
        .where(*conds)
        .options(
            selectinload(models.StockLot.variant).selectinload(models.ProductVariant.product),
            selectinload(models.StockLot.warehouse),
            selectinload(models.StockLot.supplier),
        )
        .order_by(models.StockLot.expiration_date.asc().nulls_last(), models.StockLot.id.asc())
        .limit(max(1, min(limit, 2000)))
    )
    lots = res.scalars().all()

    rows: List[dict] = []
    counters = {"expired": 0, "critical": 0, "alert": 0, "ok": 0, "no_expiry": 0}
    total_value_at_risk = 0.0

    for l in lots:
        days_left = (l.expiration_date - today).days if l.expiration_date else None
        bucket = _bucket_for(days_left)
        counters[bucket] = counters.get(bucket, 0) + 1
        risk = (l.quantity_remaining or 0) * (l.unit_cost or 0.0)
        if bucket in ("expired", "critical", "alert"):
            total_value_at_risk += risk
        p = l.variant.product if (l.variant and l.variant.product) else None
        rows.append({
            "lot_id": l.id,
            "variant_id": l.variant_id,
            "product_id": p.id if p else None,
            "product_name": p.name if p else "?",
            "sku": l.variant.sku if l.variant else None,
            "warehouse_id": l.warehouse_id,
            "warehouse_name": l.warehouse.name if l.warehouse else None,
            "batch_code": l.batch_code,
            "expiration_date": l.expiration_date.isoformat() if l.expiration_date else None,
            "manufacturing_date": l.manufacturing_date.isoformat() if l.manufacturing_date else None,
            "days_left": days_left,
            "bucket": bucket,
            "quantity_remaining": l.quantity_remaining,
            "unit_cost": round(l.unit_cost or 0.0, 4),
            "value_at_risk": round(risk, 2),
            "status": l.status,
            "supplier_id": l.supplier_id,
            "supplier_name": l.supplier.name if l.supplier else None,
        })

    return {
        "as_of": today.isoformat(),
        "horizon_days": days,
        "rows": rows,
        "summary": {
            **counters,
            "total_lots": len(rows),
            "total_value_at_risk": round(total_value_at_risk, 2),
        },
    }


async def ensure_expiry_warehouse(db: AsyncSession) -> models.Warehouse:
    """Almacén único donde caen los caducados — se auto-crea al primer uso.
    Misma idea que _ensure_returns_warehouse en retail."""
    res = await db.execute(
        select(models.Warehouse).where(models.Warehouse.name == "Merma · Caducados")
    )
    wh = res.scalars().first()
    if wh:
        return wh
    wh = models.Warehouse(name="Merma · Caducados", type="scrap", is_active=True)
    db.add(wh)
    await db.flush()
    return wh


async def sweep_expired_to_scrap(
    db: AsyncSession, *, user_id: Optional[int] = None
) -> Dict:
    """Barre los lotes con expiration_date <= hoy y quantity_remaining > 0.
    Marca status='expired' y registra un StockMovement de salida (OUT) por
    el residual — evita seguir contando ese stock como vendible sin borrar
    la historia. Devuelve resumen para logs / notificaciones."""
    today = date.today()
    res = await db.execute(
        select(models.StockLot).where(
            models.StockLot.quantity_remaining > 0,
            models.StockLot.expiration_date.isnot(None),
            models.StockLot.expiration_date <= today,
            models.StockLot.status == "active",
        )
    )
    lots = res.scalars().all()
    swept = 0
    total_value = 0.0
    for l in lots:
        qty = l.quantity_remaining or 0
        if qty <= 0:
            l.status = "consumed"
            continue
        cost = l.unit_cost or 0.0
        db.add(models.StockMovement(
            variant_id=l.variant_id, warehouse_id=l.warehouse_id,
            quantity=-qty, movement_type="out",
            unit_cost=cost, reference=f"expiry:{l.id}",
            notes=f"Auto-merma por caducidad (lote {l.batch_code or l.id})",
            user_id=user_id, stock_lot_id=l.id,
        ))
        # Ajustar StockLevel — quita del disponible el residual del lote
        lvl_res = await db.execute(select(models.StockLevel).where(
            models.StockLevel.variant_id == l.variant_id,
            models.StockLevel.warehouse_id == l.warehouse_id,
        ))
        lvl = lvl_res.scalars().first()
        if lvl:
            lvl.quantity = max(0, (lvl.quantity or 0) - qty)
        l.quantity_remaining = 0
        l.status = "expired"
        swept += 1
        total_value += qty * cost
    if swept:
        await db.commit()
    return {
        "date": today.isoformat(),
        "lots_expired": swept,
        "total_value_written_off": round(total_value, 2),
    }


async def recall_lot(
    db: AsyncSession, lot_id: int, *,
    reason: str, user_id: Optional[int] = None,
) -> Dict:
    """Retira sanitariamente un lote:
    1. Bloquea el lote (status='recalled') — deja de venderse aunque tenga stock.
    2. Regresa la lista de órdenes que consumieron unidades de ese lote.
    3. Deja rastro en audit log del motivo del retiro."""
    res = await db.execute(select(models.StockLot).where(models.StockLot.id == lot_id))
    lot = res.scalars().first()
    if not lot:
        return {"ok": False, "reason": "Lote no encontrado"}
    lot.status = "recalled"
    # Buscar movimientos de salida (OUT) con este stock_lot_id
    res_m = await db.execute(
        select(models.StockMovement)
        .where(
            models.StockMovement.stock_lot_id == lot_id,
            models.StockMovement.movement_type == "out",
        )
        .order_by(models.StockMovement.created_at.desc())
    )
    movements = res_m.scalars().all()
    # Extraer order_id de reference (formato "order:{id}")
    affected: Dict[int, dict] = {}
    for m in movements:
        ref = m.reference or ""
        oid = None
        if ref.startswith("order:"):
            try:
                oid = int(ref.split(":", 1)[1])
            except ValueError:
                pass
        if not oid:
            continue
        row = affected.setdefault(oid, {
            "order_id": oid, "units": 0,
            "last_delivered_at": m.created_at.isoformat() if m.created_at else None,
        })
        row["units"] += abs(m.quantity or 0)

    # Enriquecer con nombre de cliente si se puede
    if affected:
        try:
            from app.modules.sales.models import Order
            from app.modules.customers.models import Customer
            oids = list(affected.keys())
            res_o = await db.execute(
                select(Order, Customer)
                .join(Customer, Customer.id == Order.customer_id, isouter=True)
                .where(Order.id.in_(oids))
            )
            for o, c in res_o.all():
                affected[o.id]["folio"] = o.folio
                affected[o.id]["customer_id"] = o.customer_id
                affected[o.id]["customer_name"] = c.name if c else "Público general"
                affected[o.id]["customer_email"] = c.email if c else None
                affected[o.id]["customer_phone"] = c.phone if c else None
        except Exception:
            pass

    # Audit log
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(
            db, user_id=user_id, action="RECALL_STOCK_LOT",
            module="inventory",
            description=f"Retiro sanitario del lote {lot.batch_code or lot.id}",
            details={"lot_id": lot.id, "reason": reason,
                     "affected_orders": len(affected)},
        )
    except Exception:
        pass

    await db.commit()
    return {
        "ok": True,
        "lot_id": lot.id,
        "batch_code": lot.batch_code,
        "expiration_date": lot.expiration_date.isoformat() if lot.expiration_date else None,
        "affected_orders": list(affected.values()),
    }


async def set_lot_status(
    db: AsyncSession, lot_id: int, *,
    status: str, user_id: Optional[int] = None,
) -> Optional[models.StockLot]:
    """Cambia manualmente el status de un lote (cuarentena, reactivar, etc.)."""
    if status not in ("active", "quarantine", "recalled", "expired", "consumed"):
        raise ValueError(f"status inválido: {status}")
    res = await db.execute(select(models.StockLot).where(models.StockLot.id == lot_id))
    lot = res.scalars().first()
    if not lot:
        return None
    lot.status = status
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(
            db, user_id=user_id, action="UPDATE_STOCK_LOT_STATUS",
            module="inventory",
            description=f"Lote {lot.batch_code or lot.id} → {status}",
            details={"lot_id": lot.id, "status": status},
        )
    except Exception:
        pass
    await db.commit()
    await db.refresh(lot)
    return lot
