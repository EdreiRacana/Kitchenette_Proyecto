"""Tools extra del asistente — segundo bloque, alta prioridad operativa.

Todas siguen el mismo contrato que tools.py:
  - async, reciben (db: AsyncSession, **params) y devuelven dict.
  - Nada de formateo textual (eso lo hace templates.py o el LLM).
  - Fallan suave: {"empty": True, "reason": "..."} si no hay datos.
  - Registro final en TOOLS_REGISTRY se hace desde tools.py.

Estos tools cubren huecos detectados por auditoría por rol:
  - Ventas/Forecast: meta del mes, cumplimiento por SKU, ventas por categoría.
  - POS: arqueos con diferencia, turnos por conciliar.
  - Retail: traslados pendientes, sell-in vs sell-out, devoluciones por recibir.
  - Inventario: ajustes del mes, stock por almacén.
  - Compras: compras del periodo, OC por recibir esta semana.
  - Finanzas: movimientos bancarios del día.
  - Contabilidad: mes cerrado, pólizas del día.
  - RH/Nómina: INFONAVIT del mes, FONACOT del mes, empleados por depto,
    avisos AFIL pendientes.
"""
from __future__ import annotations
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.assistant.tools import _period_bounds, _now, _money


# ══════════════════════════════════════════════════════════════════════
# FORECAST / META
# ══════════════════════════════════════════════════════════════════════

async def meta_ventas_mes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Meta del mes en curso (desde ForecastPlan × ForecastLine) vs. real
    facturado, con % de cumplimiento y días restantes."""
    from app.modules.forecast import models as fc
    from app.modules.sales import models as sm

    now = _now()
    year, month = now.year, now.month
    month_col = getattr(fc.ForecastLine, f"m{month}", None)
    if month_col is None:
        return {"tool": "meta_ventas_mes", "empty": True,
                "reason": "mes fuera de rango"}

    q_meta = (
        select(func.coalesce(
            func.sum(month_col * fc.ForecastLine.unit_price), 0.0))
        .join(fc.ForecastPlan, fc.ForecastLine.plan_id == fc.ForecastPlan.id)
        .where(fc.ForecastPlan.year == year)
    )
    meta = float((await db.execute(q_meta)).scalar() or 0.0)

    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    real_q = (
        select(func.coalesce(func.sum(sm.Order.total_amount), 0.0))
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < now,
        )
    )
    real = float((await db.execute(real_q)).scalar() or 0.0)

    # días transcurridos y restantes del mes
    if month == 12:
        end_month = start.replace(year=year + 1, month=1)
    else:
        end_month = start.replace(month=month + 1)
    dias_totales = (end_month - start).days
    dias_transcurridos = (now - start).days + 1
    dias_restantes = max(0, dias_totales - dias_transcurridos)

    pct = round(real / meta * 100.0, 1) if meta > 0 else 0.0
    ritmo_diario = real / dias_transcurridos if dias_transcurridos > 0 else 0.0
    proyeccion = ritmo_diario * dias_totales

    return {
        "tool": "meta_ventas_mes",
        "periodo": f"{_MONTH_ES[month]} {year}",
        "meta": _money(meta),
        "real": _money(real),
        "pct_cumplimiento": pct,
        "dias_transcurridos": dias_transcurridos,
        "dias_restantes": dias_restantes,
        "proyeccion_fin_mes": _money(proyeccion),
        "empty": meta == 0 and real == 0,
    }


_MONTH_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


async def cumplimiento_por_sku(db: AsyncSession, limite: int = 10, **k) -> Dict[str, Any]:
    """Top SKUs por desviación entre real vendido y forecast del mes actual."""
    from app.modules.forecast import models as fc
    from app.modules.sales import models as sm

    now = _now()
    year, month = now.year, now.month
    month_col = getattr(fc.ForecastLine, f"m{month}", None)
    if month_col is None:
        return {"tool": "cumplimiento_por_sku", "empty": True}

    # forecast unidades por SKU
    fc_q = (
        select(
            fc.ForecastLine.sku,
            fc.ForecastLine.product_name,
            func.sum(month_col).label("forecast_units"),
            func.sum(month_col * fc.ForecastLine.unit_price).label("forecast_amount"),
        )
        .join(fc.ForecastPlan, fc.ForecastLine.plan_id == fc.ForecastPlan.id)
        .where(fc.ForecastPlan.year == year, fc.ForecastLine.sku.isnot(None))
        .group_by(fc.ForecastLine.sku, fc.ForecastLine.product_name)
    )
    fc_rows = {r.sku: r for r in (await db.execute(fc_q)).all()}
    if not fc_rows:
        return {"tool": "cumplimiento_por_sku", "empty": True,
                "reason": "sin forecast del año"}

    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    real_q = (
        select(
            sm.OrderItem.sku,
            func.sum(sm.OrderItem.quantity).label("units"),
            func.sum(sm.OrderItem.subtotal).label("amount"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < now,
            sm.OrderItem.sku.in_(list(fc_rows.keys())),
        )
        .group_by(sm.OrderItem.sku)
    )
    real_rows = {r.sku: r for r in (await db.execute(real_q)).all()}

    items = []
    for sku, fr in fc_rows.items():
        rr = real_rows.get(sku)
        forecast_units = int(fr.forecast_units or 0)
        real_units = int(rr.units or 0) if rr else 0
        pct = round(real_units / forecast_units * 100.0, 1) if forecast_units > 0 else 0.0
        items.append({
            "sku": sku,
            "product_name": fr.product_name or sku,
            "forecast_units": forecast_units,
            "real_units": real_units,
            "pct_cumplimiento": pct,
            "diferencia": real_units - forecast_units,
        })
    # ordena por menor cumplimiento primero (más urgente)
    items.sort(key=lambda x: x["pct_cumplimiento"])
    return {
        "tool": "cumplimiento_por_sku",
        "periodo": f"{_MONTH_ES[month]} {year}",
        "items": items[:limite],
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# VENTAS
# ══════════════════════════════════════════════════════════════════════

async def ventas_por_categoria(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Ventas agrupadas por categoría del producto."""
    from app.modules.sales import models as sm
    from app.modules.inventory import models as im

    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.coalesce(im.Product.category, "Sin categoría").label("categoria"),
            func.sum(sm.OrderItem.subtotal).label("revenue"),
            func.sum(sm.OrderItem.quantity).label("qty"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .join(im.ProductVariant, im.ProductVariant.id == sm.OrderItem.variant_id, isouter=True)
        .join(im.Product, im.Product.id == im.ProductVariant.product_id, isouter=True)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        .group_by(func.coalesce(im.Product.category, "Sin categoría"))
        .order_by(func.sum(sm.OrderItem.subtotal).desc())
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "categoria": r.categoria,
        "revenue": _money(r.revenue),
        "unidades": int(r.qty or 0),
    } for r in rows]
    return {
        "tool": "ventas_por_categoria",
        "periodo": label, "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# POS
# ══════════════════════════════════════════════════════════════════════

async def arqueos_con_diferencia(db: AsyncSession, **k) -> Dict[str, Any]:
    """Sesiones POS cerradas cuyo arqueo tuvo diferencia (variance != 0)."""
    from app.modules.pos import models as pm

    stmt = (
        select(
            pm.POSSession.id,
            pm.POSSession.status,
            pm.POSSession.closed_at,
            pm.POSSession.variance,
        )
        .where(
            pm.POSSession.status.in_(["closed", "reconciled"]),
            pm.POSSession.variance != 0,
        )
        .order_by(pm.POSSession.closed_at.desc())
        .limit(20)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "session_id": r.id,
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "variance": _money(r.variance),
        "signo": "faltante" if (r.variance or 0) < 0 else "sobrante",
    } for r in rows]
    total_diff = sum(_money(r.variance) for r in rows)
    return {
        "tool": "arqueos_con_diferencia",
        "count": len(items),
        "diferencia_total": _money(total_diff),
        "items": items,
        "empty": len(items) == 0,
    }


async def turnos_por_conciliar(db: AsyncSession, **k) -> Dict[str, Any]:
    """Sesiones POS cerradas pero aún no conciliadas (falta depósito bancario)."""
    from app.modules.pos import models as pm

    stmt = (
        select(pm.POSSession.id, pm.POSSession.closed_at, pm.POSSession.variance)
        .where(pm.POSSession.status == "closed")
        .order_by(pm.POSSession.closed_at.desc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "session_id": r.id,
        "closed_at": r.closed_at.isoformat() if r.closed_at else None,
        "variance": _money(r.variance),
    } for r in rows]
    return {
        "tool": "turnos_por_conciliar",
        "count": len(items), "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# RETAIL
# ══════════════════════════════════════════════════════════════════════

async def traslados_pendientes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Traslados entre almacenes/tiendas que aún no se completaron."""
    from app.modules.inventory import models as im

    stmt = (
        select(
            im.StockTransfer.id,
            im.StockTransfer.status,
            im.StockTransfer.created_at,
            im.StockTransfer.notes,
        )
        .where(im.StockTransfer.status.in_(["draft", "requested", "in_transit"]))
        .order_by(im.StockTransfer.created_at.desc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "id": r.id,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    return {
        "tool": "traslados_pendientes",
        "count": len(items), "items": items,
        "empty": len(items) == 0,
    }


async def sell_in_vs_sell_out(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Sell-in (nuestras facturas a la cadena) vs. sell-out (lo que reportan que
    vendieron al consumidor). Devuelve totales del periodo y ratio."""
    from app.modules.retail import models as rm
    from app.modules.sales import models as sm

    start, end, label = _period_bounds(periodo)

    # sell-in: facturas a customers vinculados a un canal retail (RetailChannel.customer_id)
    sell_in_q = (
        select(func.coalesce(func.sum(sm.Order.total_amount), 0.0))
        .join(rm.RetailChannel, rm.RetailChannel.customer_id == sm.Order.customer_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
    )
    sell_in = float((await db.execute(sell_in_q)).scalar() or 0.0)

    # sell-out: SellOutReport del periodo
    sell_out_q = (
        select(func.coalesce(func.sum(rm.SellOutReport.revenue), 0.0))
        .where(
            rm.SellOutReport.period_start >= start,
            rm.SellOutReport.period_start < end,
        )
    )
    sell_out = float((await db.execute(sell_out_q)).scalar() or 0.0)

    ratio = round(sell_out / sell_in * 100.0, 1) if sell_in > 0 else 0.0
    return {
        "tool": "sell_in_vs_sell_out",
        "periodo": label,
        "sell_in": _money(sell_in),
        "sell_out": _money(sell_out),
        "sell_through_pct": ratio,
        "empty": sell_in == 0 and sell_out == 0,
    }


async def devoluciones_por_recibir(db: AsyncSession, **k) -> Dict[str, Any]:
    """Devoluciones físicas de retail que aún no llegan al almacén."""
    from app.modules.retail import models as rm

    stmt = (
        select(
            rm.RetailReturn.id,
            rm.RetailReturn.status,
            rm.RetailReturn.units_returned,
            rm.RetailReturn.product_name,
            rm.RetailReturn.sku,
            rm.RetailReturn.reason,
        )
        .where(rm.RetailReturn.status.in_(["pending", "in_transit"]))
        .order_by(rm.RetailReturn.id.desc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "id": r.id, "status": r.status,
        "product_name": r.product_name or r.sku or "?",
        "units": int(r.units_returned or 0),
        "reason": r.reason,
    } for r in rows]
    total_units = sum(x["units"] for x in items)
    return {
        "tool": "devoluciones_por_recibir",
        "count": len(items), "total_unidades": total_units,
        "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# INVENTARIO
# ══════════════════════════════════════════════════════════════════════

async def ajustes_inventario_mes(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Ajustes de inventario del periodo (StockMovement type ADJUSTMENT)."""
    from app.modules.inventory import models as im

    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.count(im.StockMovement.id).label("count"),
            func.coalesce(func.sum(im.StockMovement.quantity), 0).label("delta_units"),
            func.coalesce(
                func.sum(im.StockMovement.quantity * im.StockMovement.unit_cost), 0.0
            ).label("delta_value"),
        )
        .where(
            im.StockMovement.movement_type == "ADJUSTMENT",
            im.StockMovement.created_at >= start,
            im.StockMovement.created_at < end,
        )
    )
    row = (await db.execute(stmt)).one()
    count = int(row.count or 0)
    return {
        "tool": "ajustes_inventario_mes",
        "periodo": label,
        "count": count,
        "delta_unidades": int(row.delta_units or 0),
        "delta_valor": _money(row.delta_value),
        "empty": count == 0,
    }


async def stock_por_almacen(db: AsyncSession, **k) -> Dict[str, Any]:
    """Valor de inventario a costo agrupado por almacén."""
    from app.modules.inventory import models as im

    stmt = (
        select(
            im.Warehouse.id,
            im.Warehouse.name,
            im.Warehouse.type,
            func.coalesce(
                func.sum(im.StockLevel.quantity * im.ProductVariant.cost), 0.0
            ).label("value"),
            func.coalesce(func.sum(im.StockLevel.quantity), 0).label("units"),
        )
        .join(im.StockLevel, im.StockLevel.warehouse_id == im.Warehouse.id, isouter=True)
        .join(im.ProductVariant, im.ProductVariant.id == im.StockLevel.variant_id, isouter=True)
        .group_by(im.Warehouse.id, im.Warehouse.name, im.Warehouse.type)
        .order_by(func.coalesce(func.sum(im.StockLevel.quantity * im.ProductVariant.cost), 0.0).desc())
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "warehouse_id": r.id,
        "name": r.name,
        "type": r.type,
        "unidades": int(r.units or 0),
        "valor": _money(r.value),
    } for r in rows]
    total_value = sum(x["valor"] for x in items)
    return {
        "tool": "stock_por_almacen",
        "count": len(items),
        "valor_total": _money(total_value),
        "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# COMPRAS
# ══════════════════════════════════════════════════════════════════════

async def compras_periodo(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Total de compras (PurchaseOrder) creadas en el periodo."""
    from app.modules.inventory import models as im

    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.count(im.PurchaseOrder.id),
            func.coalesce(func.sum(im.PurchaseOrder.total_amount), 0.0),
        )
        .where(
            im.PurchaseOrder.status != "cancelled",
            im.PurchaseOrder.created_at >= start,
            im.PurchaseOrder.created_at < end,
        )
    )
    count, total = (await db.execute(stmt)).one()
    count = int(count or 0)
    total = _money(total)
    return {
        "tool": "compras_periodo",
        "periodo": label,
        "count": count, "total": total,
        "ticket_promedio": round(total / count, 2) if count > 0 else 0.0,
        "empty": count == 0,
    }


async def oc_por_recibir_semana(db: AsyncSession, **k) -> Dict[str, Any]:
    """Órdenes de compra 'ordered' cuya fecha esperada cae en los próximos 7 días."""
    from app.modules.inventory import models as im

    now = _now()
    horizonte = now + timedelta(days=7)
    stmt = (
        select(
            im.PurchaseOrder.id,
            im.PurchaseOrder.folio,
            im.PurchaseOrder.due_date,
            im.PurchaseOrder.total_amount,
            im.Supplier.name.label("supplier"),
        )
        .join(im.Supplier, im.Supplier.id == im.PurchaseOrder.supplier_id, isouter=True)
        .where(
            im.PurchaseOrder.status == "ordered",
            im.PurchaseOrder.due_date.isnot(None),
            im.PurchaseOrder.due_date >= now,
            im.PurchaseOrder.due_date <= horizonte,
        )
        .order_by(im.PurchaseOrder.due_date.asc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "id": r.id, "folio": r.folio,
        "supplier": r.supplier or "?",
        "due_date": r.due_date.isoformat() if r.due_date else None,
        "total": _money(r.total_amount),
    } for r in rows]
    total_monto = sum(x["total"] for x in items)
    return {
        "tool": "oc_por_recibir_semana",
        "count": len(items),
        "total": _money(total_monto),
        "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# FINANZAS
# ══════════════════════════════════════════════════════════════════════

async def movimientos_bancarios_dia(db: AsyncSession, **k) -> Dict[str, Any]:
    """Movimientos bancarios del día (deposits + withdrawals) agregados por cuenta."""
    from app.modules.finance import models as fm

    now = _now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(
            fm.BankAccount.id,
            fm.BankAccount.name,
            func.count(fm.BankTransaction.id).label("count"),
            func.coalesce(
                func.sum(
                    func.case(
                        (fm.BankTransaction.type.in_(["deposit", "transfer_in"]),
                         fm.BankTransaction.amount),
                        else_=0.0,
                    )
                ), 0.0,
            ).label("deposits"),
            func.coalesce(
                func.sum(
                    func.case(
                        (fm.BankTransaction.type.in_(["withdrawal", "transfer_out"]),
                         fm.BankTransaction.amount),
                        else_=0.0,
                    )
                ), 0.0,
            ).label("withdrawals"),
        )
        .join(fm.BankTransaction, fm.BankTransaction.bank_account_id == fm.BankAccount.id, isouter=True)
        .where(
            or_(
                and_(fm.BankTransaction.bank_date >= start, fm.BankTransaction.bank_date < now),
                and_(fm.BankTransaction.bank_date.is_(None),
                     fm.BankTransaction.created_at >= start,
                     fm.BankTransaction.created_at < now),
            )
        )
        .group_by(fm.BankAccount.id, fm.BankAccount.name)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "account_id": r.id, "account_name": r.name,
        "movimientos": int(r.count or 0),
        "entradas": _money(r.deposits),
        "salidas": _money(r.withdrawals),
        "neto": _money((r.deposits or 0) - (r.withdrawals or 0)),
    } for r in rows]
    total_neto = sum(x["neto"] for x in items)
    return {
        "tool": "movimientos_bancarios_dia",
        "count_cuentas": len(items),
        "neto_total": _money(total_neto),
        "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# CONTABILIDAD
# ══════════════════════════════════════════════════════════════════════

async def mes_cerrado(db: AsyncSession, **k) -> Dict[str, Any]:
    """Último mes contable cerrado."""
    from app.modules.accounting import models as am

    stmt = (
        select(am.PeriodClose.year, am.PeriodClose.month, am.PeriodClose.status)
        .where(am.PeriodClose.status == "closed")
        .order_by(am.PeriodClose.year.desc(), am.PeriodClose.month.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        return {"tool": "mes_cerrado", "empty": True,
                "reason": "aún no hay cierres registrados"}
    return {
        "tool": "mes_cerrado",
        "year": row.year, "month": row.month,
        "month_label": _MONTH_ES[row.month] if 1 <= row.month <= 12 else str(row.month),
        "status": row.status,
        "empty": False,
    }


async def polizas_dia(db: AsyncSession, **k) -> Dict[str, Any]:
    """Pólizas contables generadas hoy (count, débito y crédito totales)."""
    from app.modules.accounting import models as am

    now = _now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(
            func.count(am.JournalEntry.id),
            func.coalesce(func.sum(am.JournalEntry.total_debit), 0.0),
            func.coalesce(func.sum(am.JournalEntry.total_credit), 0.0),
        )
        .where(
            am.JournalEntry.status == "posted",
            am.JournalEntry.date >= start,
            am.JournalEntry.date < now,
        )
    )
    count, debit, credit = (await db.execute(stmt)).one()
    count = int(count or 0)
    return {
        "tool": "polizas_dia",
        "count": count,
        "total_debito": _money(debit),
        "total_credito": _money(credit),
        "empty": count == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# RH / NÓMINA
# ══════════════════════════════════════════════════════════════════════

async def _payroll_details_del_mes(db: AsyncSession):
    """Helper: PayrollDetail unido a PayrollPeriod donde payment_date cae
    en el mes en curso (ISO string)."""
    from app.modules.hr import models as hm

    now = _now()
    ym_prefix = now.strftime("%Y-%m")
    return (
        select(hm.PayrollDetail)
        .join(hm.PayrollPeriod, hm.PayrollPeriod.id == hm.PayrollDetail.period_id)
        .where(hm.PayrollPeriod.payment_date.like(f"{ym_prefix}%"))
    )


async def infonavit_mes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Total de INFONAVIT (retención del trabajador + 5% patronal) del mes."""
    from app.modules.hr import models as hm

    now = _now()
    ym_prefix = now.strftime("%Y-%m")
    stmt = (
        select(
            func.coalesce(func.sum(hm.PayrollDetail.infonavit), 0.0).label("empleado"),
            func.coalesce(func.sum(hm.PayrollDetail.infonavit_employer), 0.0).label("patronal"),
            func.count(func.distinct(hm.PayrollDetail.employee_id)).label("empleados"),
        )
        .join(hm.PayrollPeriod, hm.PayrollPeriod.id == hm.PayrollDetail.period_id)
        .where(hm.PayrollPeriod.payment_date.like(f"{ym_prefix}%"))
    )
    row = (await db.execute(stmt)).one()
    total_emp = _money(row.empleado)
    total_pat = _money(row.patronal)
    return {
        "tool": "infonavit_mes",
        "periodo": f"{_MONTH_ES[now.month]} {now.year}",
        "descontado_trabajador": total_emp,
        "aportacion_patronal_5pct": total_pat,
        "total": _money(total_emp + total_pat),
        "empleados_con_credito": int(row.empleados or 0),
        "empty": total_emp == 0 and total_pat == 0,
    }


async def fonacot_mes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Total de FONACOT descontado en el mes."""
    from app.modules.hr import models as hm

    now = _now()
    ym_prefix = now.strftime("%Y-%m")
    stmt = (
        select(
            func.coalesce(func.sum(hm.PayrollDetail.fonacot), 0.0).label("total"),
            func.count(func.distinct(hm.PayrollDetail.employee_id)).label("empleados"),
        )
        .join(hm.PayrollPeriod, hm.PayrollPeriod.id == hm.PayrollDetail.period_id)
        .where(
            hm.PayrollPeriod.payment_date.like(f"{ym_prefix}%"),
            hm.PayrollDetail.fonacot > 0,
        )
    )
    row = (await db.execute(stmt)).one()
    return {
        "tool": "fonacot_mes",
        "periodo": f"{_MONTH_ES[now.month]} {now.year}",
        "total": _money(row.total),
        "empleados_con_credito": int(row.empleados or 0),
        "empty": _money(row.total) == 0,
    }


async def empleados_por_departamento(db: AsyncSession, **k) -> Dict[str, Any]:
    """Conteo de empleados activos por departamento."""
    from app.modules.hr import models as hm

    stmt = (
        select(
            hm.Employee.department,
            func.count(hm.Employee.id).label("count"),
            func.coalesce(func.sum(hm.Employee.base_salary), 0.0).label("nomina_base"),
        )
        .where(hm.Employee.status == "activo")
        .group_by(hm.Employee.department)
        .order_by(func.count(hm.Employee.id).desc())
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "departamento": r.department or "Sin departamento",
        "empleados": int(r.count or 0),
        "nomina_base_total": _money(r.nomina_base),
    } for r in rows]
    total_empleados = sum(x["empleados"] for x in items)
    return {
        "tool": "empleados_por_departamento",
        "total_empleados": total_empleados,
        "count_departamentos": len(items),
        "items": items,
        "empty": len(items) == 0,
    }


async def mermas_por_motivo(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Mermas del periodo desglosadas por motivo tipificado (robo, daño,
    caducidad, conteo…). Solo suma ajustes NEGATIVOS — los ajustes
    positivos son sobrantes, no merma. Ordenado por valor de mayor a menor."""
    from app.modules.inventory import models as im
    from app.modules.inventory.models import STOCK_ADJUSTMENT_REASON_LABELS

    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            im.StockMovement.adjustment_reason,
            func.count(im.StockMovement.id).label("count"),
            func.coalesce(func.sum(im.StockMovement.quantity), 0).label("units"),
            func.coalesce(
                func.sum(im.StockMovement.quantity * im.StockMovement.unit_cost), 0.0
            ).label("valor"),
        )
        .where(
            im.StockMovement.movement_type == "adjustment",
            im.StockMovement.quantity < 0,
            im.StockMovement.created_at >= start,
            im.StockMovement.created_at < end,
        )
        .group_by(im.StockMovement.adjustment_reason)
        .order_by(func.coalesce(func.sum(im.StockMovement.quantity * im.StockMovement.unit_cost), 0.0).asc())
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for r in rows:
        motivo_key = r.adjustment_reason or ""
        motivo_label = STOCK_ADJUSTMENT_REASON_LABELS.get(motivo_key, "Sin motivo")
        items.append({
            "motivo": motivo_label,
            "motivo_key": motivo_key,
            "count": int(r.count or 0),
            "unidades": abs(int(r.units or 0)),
            "valor": _money(abs(r.valor or 0)),
        })
    total_valor = sum(it["valor"] for it in items)
    total_unidades = sum(it["unidades"] for it in items)
    return {
        "tool": "mermas_por_motivo",
        "periodo": label,
        "total_valor": _money(total_valor),
        "total_unidades": total_unidades,
        "items": items,
        "empty": len(items) == 0,
    }


async def avisos_afil_pendientes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Avisos AFIL (IMSS) que aún no se presentaron (presented_date NULL).
    Se marca 'overdue' si pasaron más de 5 días naturales desde el movimiento."""
    from app.modules.hr import models as hm

    stmt = (
        select(
            hm.IMSSMovement.id,
            hm.IMSSMovement.movement_type,
            hm.IMSSMovement.movement_date,
            hm.IMSSMovement.employee_id,
        )
        .where(hm.IMSSMovement.presented_date.is_(None))
        .order_by(hm.IMSSMovement.movement_date.asc())
        .limit(100)
    )
    rows = (await db.execute(stmt)).all()
    today = _now().date()
    items = []
    overdue = 0
    for r in rows:
        # movement_date es ISO string
        overdue_flag = False
        try:
            md = date.fromisoformat((r.movement_date or "")[:10])
            if (today - md).days > 5:
                overdue_flag = True
                overdue += 1
        except Exception:
            pass
        items.append({
            "id": r.id,
            "movement_type": r.movement_type,
            "movement_date": r.movement_date,
            "employee_id": r.employee_id,
            "overdue": overdue_flag,
        })
    return {
        "tool": "avisos_afil_pendientes",
        "count": len(items),
        "overdue_count": overdue,
        "items": items,
        "empty": len(items) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# REGISTRO
# ══════════════════════════════════════════════════════════════════════

TOOLS_EXTRA_REGISTRY = {
    # Ventas / Forecast
    "meta_ventas_mes": meta_ventas_mes,
    "cumplimiento_por_sku": cumplimiento_por_sku,
    "ventas_por_categoria": ventas_por_categoria,
    # POS
    "arqueos_con_diferencia": arqueos_con_diferencia,
    "turnos_por_conciliar": turnos_por_conciliar,
    # Retail
    "traslados_pendientes": traslados_pendientes,
    "sell_in_vs_sell_out": sell_in_vs_sell_out,
    "devoluciones_por_recibir": devoluciones_por_recibir,
    # Inventario
    "ajustes_inventario_mes": ajustes_inventario_mes,
    "stock_por_almacen": stock_por_almacen,
    # Compras
    "compras_periodo": compras_periodo,
    "oc_por_recibir_semana": oc_por_recibir_semana,
    # Finanzas
    "movimientos_bancarios_dia": movimientos_bancarios_dia,
    # Contabilidad
    "mes_cerrado": mes_cerrado,
    "polizas_dia": polizas_dia,
    # RH / Nómina
    "infonavit_mes": infonavit_mes,
    "fonacot_mes": fonacot_mes,
    "empleados_por_departamento": empleados_por_departamento,
    "avisos_afil_pendientes": avisos_afil_pendientes,
    # Inventario - Fase 18
    "mermas_por_motivo": mermas_por_motivo,
}
