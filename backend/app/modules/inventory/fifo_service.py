"""Servicio de costeo FIFO (PEPS: Primeras Entradas, Primeras Salidas).

Cuando ocurre una SALIDA de inventario (venta, transferencia, ajuste
negativo), este módulo:
  1. Localiza los lotes con quantity_remaining > 0 del variant × warehouse
     ordenados por received_at ASC.
  2. Consume las unidades de cada lote hasta cubrir la cantidad requerida,
     acumulando el costo ponderado real.
  3. Actualiza quantity_remaining en cada lote.
  4. Retorna el COGS (costo de la venta) total.

Uso típico desde el módulo sales al procesar una orden:
    cost = await fifo_service.consume_stock(
        db, variant_id, warehouse_id, quantity, reference="ORD-123")
    order_item.unit_cost = cost / quantity
"""
from __future__ import annotations
from typing import Optional, List, Dict
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.modules.inventory import models


class InsufficientStockError(Exception):
    def __init__(self, variant_id: int, warehouse_id: int, requested: int, available: int):
        self.variant_id = variant_id
        self.warehouse_id = warehouse_id
        self.requested = requested
        self.available = available
        super().__init__(
            f"Stock insuficiente para variant {variant_id} en warehouse {warehouse_id}: "
            f"requerido {requested}, disponible {available}"
        )


async def receive_stock(
    db: AsyncSession, variant_id: int, warehouse_id: int,
    quantity: int, unit_cost: float,
    reference: Optional[str] = None,
    user_id: Optional[int] = None,
) -> models.StockLot:
    """Entrada de stock: crea un lote FIFO con su costo propio.
    También registra un StockMovement de tipo IN."""
    if quantity <= 0:
        raise ValueError("quantity debe ser positiva")
    lot = models.StockLot(
        variant_id=variant_id, warehouse_id=warehouse_id,
        quantity_received=quantity, quantity_remaining=quantity,
        unit_cost=unit_cost, reference=reference,
    )
    db.add(lot)
    db.add(models.StockMovement(
        variant_id=variant_id, warehouse_id=warehouse_id,
        quantity=quantity, movement_type="IN",
        unit_cost=unit_cost, reference=reference,
        user_id=user_id,
    ))
    # Actualizar StockLevel agregado
    await _adjust_stock_level(db, variant_id, warehouse_id, quantity)
    await db.commit()
    await db.refresh(lot)
    return lot


async def consume_stock(
    db: AsyncSession, variant_id: int, warehouse_id: int, quantity: int,
    reference: Optional[str] = None, user_id: Optional[int] = None,
    allow_negative: bool = False,
) -> Dict[str, float]:
    """Salida de stock con costeo FIFO.
    Consume los lotes más antiguos primero. Retorna:
      { total_cost, unit_cost_avg, lots_used: [{lot_id, qty, unit_cost}] }
    Si allow_negative=False y no hay stock suficiente, lanza InsufficientStockError.
    """
    if quantity <= 0:
        raise ValueError("quantity debe ser positiva")

    # Lotes con remanente ordenados por antigüedad
    res = await db.execute(
        select(models.StockLot)
        .where(
            models.StockLot.variant_id == variant_id,
            models.StockLot.warehouse_id == warehouse_id,
            models.StockLot.quantity_remaining > 0,
        )
        .order_by(models.StockLot.received_at.asc(), models.StockLot.id.asc())
    )
    lots = res.scalars().all()
    available = sum(l.quantity_remaining for l in lots)

    if available < quantity and not allow_negative:
        raise InsufficientStockError(variant_id, warehouse_id, quantity, available)

    to_consume = quantity
    total_cost = 0.0
    lots_used: List[dict] = []

    for lot in lots:
        if to_consume <= 0:
            break
        take = min(lot.quantity_remaining, to_consume)
        lot.quantity_remaining -= take
        total_cost += take * lot.unit_cost
        lots_used.append({
            "lot_id": lot.id, "qty": take, "unit_cost": lot.unit_cost,
        })
        to_consume -= take

    # Si allow_negative y quedó faltante, se registra con costo 0 (advertencia
    # explícita en el kardex)
    if to_consume > 0 and allow_negative:
        lots_used.append({
            "lot_id": None, "qty": to_consume, "unit_cost": 0.0,
            "warning": "sin_lote_disponible",
        })

    # Movement OUT con el costo unitario promedio real
    unit_cost_avg = round(total_cost / quantity, 4) if quantity > 0 else 0.0
    db.add(models.StockMovement(
        variant_id=variant_id, warehouse_id=warehouse_id,
        quantity=-quantity, movement_type="OUT",
        unit_cost=unit_cost_avg, reference=reference,
        user_id=user_id,
    ))
    await _adjust_stock_level(db, variant_id, warehouse_id, -quantity)
    await db.commit()

    return {
        "total_cost": round(total_cost, 2),
        "unit_cost_avg": unit_cost_avg,
        "lots_used": lots_used,
    }


async def _adjust_stock_level(
    db: AsyncSession, variant_id: int, warehouse_id: int, delta: int
):
    """Ajusta el StockLevel agregado (para consultas rápidas)."""
    res = await db.execute(select(models.StockLevel).where(
        models.StockLevel.variant_id == variant_id,
        models.StockLevel.warehouse_id == warehouse_id,
    ))
    lvl = res.scalars().first()
    if lvl is None:
        lvl = models.StockLevel(
            variant_id=variant_id, warehouse_id=warehouse_id,
            available=max(0, delta), reserved=0,
        )
        db.add(lvl)
    else:
        lvl.available = (lvl.available or 0) + delta


async def get_kardex(
    db: AsyncSession, variant_id: int, warehouse_id: Optional[int] = None,
    start: Optional[datetime] = None, end: Optional[datetime] = None,
    limit: int = 500,
) -> dict:
    """Kardex de un SKU: listado cronológico de todos los movimientos con
    saldo acumulado y costo promedio del inventario en cada punto."""
    conds = [models.StockMovement.variant_id == variant_id]
    if warehouse_id is not None:
        conds.append(models.StockMovement.warehouse_id == warehouse_id)
    if start:
        conds.append(models.StockMovement.created_at >= start)
    if end:
        conds.append(models.StockMovement.created_at < end)
    res = await db.execute(
        select(models.StockMovement)
        .where(*conds)
        .order_by(models.StockMovement.created_at.asc(), models.StockMovement.id.asc())
        .limit(limit)
    )
    movs = res.scalars().all()

    balance = 0
    inv_value = 0.0
    rows = []
    for m in movs:
        qty = m.quantity or 0
        cost = m.unit_cost or 0.0
        # Actualizar valor de inventario
        if qty > 0:
            inv_value += qty * cost
        elif qty < 0:
            # Salida: reduce valor por el costo aplicado FIFO
            inv_value -= abs(qty) * cost
        balance += qty
        avg_cost = (inv_value / balance) if balance > 0 else 0.0
        rows.append({
            "id": m.id,
            "created_at": m.created_at,
            "movement_type": m.movement_type,
            "quantity": qty,
            "unit_cost": round(cost, 4),
            "reference": m.reference,
            "notes": m.notes,
            "warehouse_id": m.warehouse_id,
            "balance": balance,
            "inv_value": round(inv_value, 2),
            "avg_cost": round(avg_cost, 4),
        })

    # Totales agregados
    total_in = sum(m.quantity for m in movs if (m.quantity or 0) > 0)
    total_out = sum(-m.quantity for m in movs if (m.quantity or 0) < 0)
    return {
        "variant_id": variant_id,
        "warehouse_id": warehouse_id,
        "movements": rows,
        "current_balance": balance,
        "current_inventory_value": round(inv_value, 2),
        "current_avg_cost": round((inv_value / balance) if balance > 0 else 0.0, 4),
        "total_received": total_in,
        "total_shipped": total_out,
    }


async def get_current_cost(db: AsyncSession, variant_id: int, warehouse_id: int) -> float:
    """Costo promedio ponderado actual del variant en el warehouse (para P&L)."""
    res = await db.execute(
        select(
            func.coalesce(func.sum(models.StockLot.quantity_remaining * models.StockLot.unit_cost), 0.0),
            func.coalesce(func.sum(models.StockLot.quantity_remaining), 0),
        )
        .where(
            models.StockLot.variant_id == variant_id,
            models.StockLot.warehouse_id == warehouse_id,
            models.StockLot.quantity_remaining > 0,
        )
    )
    total_value, total_qty = res.one()
    if total_qty > 0:
        return round(float(total_value) / float(total_qty), 4)
    return 0.0
