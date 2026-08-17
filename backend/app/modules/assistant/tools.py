"""Tools deterministas del asistente — puro Python + SQL, cero IA.

Cada función:
  - Recibe (db: AsyncSession, params) y devuelve un dict con datos crudos.
  - No formatea texto — de eso se encarga templates.py.
  - No falla ambiguamente: retorna {"empty": True, "reason": "..."} si no
    hay datos para responder.
  - Es idempotente y rápida (<500ms típico).

Sprint 1: implemento las 8 tools con mayor valor / riesgo bajo. El resto
quedan stubbed devolviendo "en construcción" — se van agregando en la
práctica sin romper el contrato del asistente.
"""
from __future__ import annotations
from datetime import datetime, timedelta, date, timezone


def _now() -> datetime:
    """Timestamp aware (con zona horaria) — para comparar con columnas
    DateTime(timezone=True) del ERP sin errores 'naive vs aware'."""
    return datetime.now(timezone.utc)


def _aware(dt):
    """Garantiza que un datetime cargado de DB tenga tzinfo. Si ya es aware
    lo devuelve tal cual; si es naive lo asume UTC."""
    if dt is None:
        return None
    if getattr(dt, "tzinfo", None) is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
from typing import Optional, List, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_


# ── Helpers de periodo ────────────────────────────────────────────────
def _period_bounds(periodo: str = "mes") -> tuple[datetime, datetime, str]:
    """Convierte una etiqueta legible en (inicio, fin, etiqueta_humana).
    Soporta: hoy, ayer, semana, mes, mes_pasado, año, ytd. Devuelve
    datetimes tz-aware para que coincidan con columnas DateTime(timezone=True)."""
    now = _now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    p = (periodo or "mes").lower().strip()
    if p in ("hoy", "today"):
        return today, now, "hoy"
    if p in ("ayer", "yesterday"):
        return today - timedelta(days=1), today, "ayer"
    if p in ("semana", "week", "esta semana"):
        return today - timedelta(days=now.weekday()), now, "esta semana"
    if p in ("mes_pasado", "last_month"):
        first_this = today.replace(day=1)
        end = first_this - timedelta(seconds=1)
        start = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, end, "mes pasado"
    if p in ("año", "year", "ytd"):
        return today.replace(month=1, day=1), now, "este año"
    # default: mes en curso
    return today.replace(day=1), now, "este mes"


def _money(v: float | None) -> float:
    return round(float(v or 0), 2)


# ══════════════════════════════════════════════════════════════════════
# VENTAS Y CRM
# ══════════════════════════════════════════════════════════════════════

async def ventas_periodo(db: AsyncSession, periodo: str = "mes", comparar: bool = True) -> Dict[str, Any]:
    """Total facturado, count de pedidos, ticket promedio + variación vs
    periodo equivalente anterior."""
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)

    async def _agg(a: datetime, b: datetime):
        res = await db.execute(
            select(
                func.count(sm.Order.id),
                func.coalesce(func.sum(sm.Order.total_amount), 0.0),
            ).where(
                sm.Order.kind == "order",
                sm.Order.status != "cancelled",
                sm.Order.created_at >= a,
                sm.Order.created_at < b,
            )
        )
        count, total = res.one()
        return int(count or 0), _money(total)

    count, total = await _agg(start, end)
    ticket = round(total / count, 2) if count > 0 else 0.0

    comparativa = None
    if comparar:
        span = end - start
        prev_start = start - span
        prev_end = start
        prev_count, prev_total = await _agg(prev_start, prev_end)
        var_total_pct = _delta_pct(total, prev_total)
        var_count_pct = _delta_pct(count, prev_count)
        comparativa = {
            "prev_count": prev_count, "prev_total": prev_total,
            "var_total_pct": var_total_pct, "var_count_pct": var_count_pct,
            "prev_label": "periodo anterior",
        }
    return {
        "tool": "ventas_periodo",
        "periodo": label,
        "count": count, "total": total, "ticket_promedio": ticket,
        "comparativa": comparativa,
    }


async def top_productos(db: AsyncSession, periodo: str = "mes",
                         por: str = "revenue", limite: int = 5) -> Dict[str, Any]:
    """Top N productos por revenue o unidades vendidas en el periodo."""
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)
    metric_col = func.sum(sm.OrderItem.subtotal).label("m") if por == "revenue" \
        else func.sum(sm.OrderItem.quantity).label("m")
    stmt = (
        select(
            sm.OrderItem.product_name,
            sm.OrderItem.sku,
            func.sum(sm.OrderItem.quantity).label("qty"),
            func.sum(sm.OrderItem.subtotal).label("revenue"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        .group_by(sm.OrderItem.product_name, sm.OrderItem.sku)
        .order_by(metric_col.desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "product_name": r.product_name or "?",
        "sku": r.sku,
        "quantity": int(r.qty or 0),
        "revenue": _money(r.revenue),
    } for r in rows]
    return {
        "tool": "top_productos",
        "periodo": label, "por": por, "items": items,
        "empty": len(items) == 0,
    }


async def top_clientes(db: AsyncSession, periodo: str = "mes",
                        limite: int = 5) -> Dict[str, Any]:
    """Top N clientes por revenue del periodo."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            Customer.id, Customer.name, Customer.razon_social,
            func.sum(sm.Order.total_amount).label("revenue"),
            func.count(sm.Order.id).label("pedidos"),
        )
        .join(sm.Order, sm.Order.customer_id == Customer.id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        .group_by(Customer.id, Customer.name, Customer.razon_social)
        .order_by(func.sum(sm.Order.total_amount).desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "customer_id": r.id,
        "name": r.razon_social or r.name or "?",
        "pedidos": int(r.pedidos or 0),
        "revenue": _money(r.revenue),
    } for r in rows]
    return {"tool": "top_clientes", "periodo": label, "items": items,
            "empty": len(items) == 0}


async def pedidos_pendientes(db: AsyncSession) -> Dict[str, Any]:
    """Pedidos abiertos o parcialmente pagados (excluye cancelados y pagados)."""
    from app.modules.sales import models as sm
    stmt = (
        select(
            sm.Order.id, sm.Order.folio, sm.Order.status,
            sm.Order.total_amount, sm.Order.paid_amount,
            sm.Order.created_at,
        )
        .where(
            sm.Order.kind == "order",
            sm.Order.status.in_(["pending", "partial"]),
        )
        .order_by(sm.Order.created_at.asc())
        .limit(50)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    total_saldo = 0.0
    now = _now()
    for r in rows:
        saldo = _money((r.total_amount or 0) - (r.paid_amount or 0))
        total_saldo += saldo
        created = _aware(r.created_at)
        dias = (now - created).days if created else 0
        items.append({
            "order_id": r.id, "folio": r.folio,
            "status": r.status, "saldo": saldo, "dias": dias,
        })
    return {"tool": "pedidos_pendientes", "count": len(items),
            "total_saldo": _money(total_saldo), "items": items[:10],
            "empty": len(items) == 0}


# ══════════════════════════════════════════════════════════════════════
# FINANZAS
# ══════════════════════════════════════════════════════════════════════

async def cxc_resumen(db: AsyncSession) -> Dict[str, Any]:
    """Cuentas por cobrar: total + aging (al día, 1-30, 31-60, +60)."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    stmt = (
        select(
            sm.Order.id, sm.Order.total_amount, sm.Order.paid_amount,
            sm.Order.created_at, Customer.name.label("cliente"),
            Customer.razon_social,
        )
        .join(Customer, Customer.id == sm.Order.customer_id, isouter=True)
        .where(
            sm.Order.kind == "order",
            sm.Order.status.in_(["pending", "partial"]),
            sm.Order.total_amount > sm.Order.paid_amount,
        )
    )
    rows = (await db.execute(stmt)).all()

    now = _now()
    buckets = {"al_dia": 0.0, "1_30": 0.0, "31_60": 0.0, "mas_60": 0.0}
    top_debtors: Dict[int, Dict[str, Any]] = {}
    total = 0.0
    for r in rows:
        saldo = _money((r.total_amount or 0) - (r.paid_amount or 0))
        if saldo <= 0:
            continue
        total += saldo
        created = _aware(r.created_at)
        dias = (now - created).days if created else 0
        if dias <= 0:
            buckets["al_dia"] += saldo
        elif dias <= 30:
            buckets["1_30"] += saldo
        elif dias <= 60:
            buckets["31_60"] += saldo
        else:
            buckets["mas_60"] += saldo
        name = (r.razon_social or r.cliente or "?")
        cid = r.id  # aproximado — 1 fila por orden
        if name not in [v["name"] for v in top_debtors.values()]:
            top_debtors[cid] = {"name": name, "saldo": 0.0}
        for v in top_debtors.values():
            if v["name"] == name:
                v["saldo"] = _money(v["saldo"] + saldo)
                break

    debtors_sorted = sorted(top_debtors.values(), key=lambda x: x["saldo"], reverse=True)[:5]
    return {
        "tool": "cxc_resumen",
        "total": _money(total),
        "buckets": {k: _money(v) for k, v in buckets.items()},
        "top_debtors": debtors_sorted,
        "empty": total <= 0,
    }


async def cxp_resumen(db: AsyncSession) -> Dict[str, Any]:
    """Cuentas por pagar: total + aging por vencimiento."""
    from app.modules.finance.models import SupplierBill
    stmt = select(
        SupplierBill.id, SupplierBill.total_amount, SupplierBill.paid_amount,
        SupplierBill.due_date, SupplierBill.supplier_name,
    ).where(SupplierBill.status != "paid")
    rows = (await db.execute(stmt)).all()

    now = _now()
    buckets = {"vigente": 0.0, "1_30": 0.0, "31_60": 0.0, "mas_60": 0.0}
    total = 0.0
    top_creditors: Dict[str, float] = {}
    for r in rows:
        saldo = _money((r.total_amount or 0) - (r.paid_amount or 0))
        if saldo <= 0:
            continue
        total += saldo
        due = _aware(r.due_date)
        if due:
            days_overdue = (now - due).days if due < now else 0
        else:
            days_overdue = 0
        if days_overdue <= 0:
            buckets["vigente"] += saldo
        elif days_overdue <= 30:
            buckets["1_30"] += saldo
        elif days_overdue <= 60:
            buckets["31_60"] += saldo
        else:
            buckets["mas_60"] += saldo
        name = r.supplier_name or "?"
        top_creditors[name] = top_creditors.get(name, 0.0) + saldo

    top = [{"name": k, "saldo": _money(v)} for k, v in
           sorted(top_creditors.items(), key=lambda x: x[1], reverse=True)[:5]]
    return {
        "tool": "cxp_resumen",
        "total": _money(total),
        "buckets": {k: _money(v) for k, v in buckets.items()},
        "top_creditors": top,
        "empty": total <= 0,
    }


async def saldo_bancos(db: AsyncSession) -> Dict[str, Any]:
    """Saldos de cuentas bancarias activas."""
    from app.modules.finance.models import BankAccount
    stmt = select(BankAccount.id, BankAccount.name, BankAccount.balance,
                   BankAccount.currency).where(BankAccount.is_active == True)  # noqa: E712
    rows = (await db.execute(stmt)).all()
    accounts = [{"name": r.name, "balance": _money(r.balance),
                 "currency": r.currency or "MXN"} for r in rows]
    total = sum(a["balance"] for a in accounts if a["currency"] == "MXN")
    return {
        "tool": "saldo_bancos",
        "total_mxn": _money(total),
        "accounts": accounts,
        "empty": len(accounts) == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# INVENTARIO
# ══════════════════════════════════════════════════════════════════════

async def stock_critico(db: AsyncSession) -> Dict[str, Any]:
    """SKUs bajo el punto de reorden o agotados."""
    from app.modules.inventory import models as im
    stmt = (
        select(
            im.Product.name, im.ProductVariant.sku,
            im.ProductVariant.reorder_point,
            im.StockLevel.quantity, im.Warehouse.name.label("warehouse"),
        )
        .join(im.ProductVariant, im.ProductVariant.product_id == im.Product.id)
        .join(im.StockLevel, im.StockLevel.variant_id == im.ProductVariant.id)
        .join(im.Warehouse, im.Warehouse.id == im.StockLevel.warehouse_id)
        .where(
            im.Product.is_active == True,  # noqa: E712
            im.ProductVariant.is_active == True,  # noqa: E712
            im.ProductVariant.reorder_point.isnot(None),
            im.StockLevel.quantity <= im.ProductVariant.reorder_point,
        )
        .order_by(im.StockLevel.quantity.asc())
        .limit(30)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "name": r.name, "sku": r.sku, "warehouse": r.warehouse,
        "stock": int(r.quantity or 0), "reorder": int(r.reorder_point or 0),
        "agotado": (r.quantity or 0) <= 0,
    } for r in rows]
    return {
        "tool": "stock_critico",
        "count": len(items),
        "agotados": sum(1 for i in items if i["agotado"]),
        "items": items[:10],
        "empty": len(items) == 0,
    }


async def caducidades_proximas(db: AsyncSession, dias: int = 30) -> Dict[str, Any]:
    """Lotes por caducar — reutiliza batch_service ya existente."""
    try:
        from app.modules.inventory import batch_service
        data = await batch_service.list_expiring_lots(
            db, days=dias, include_expired=True, limit=30,
        )
        rows = data.get("rows", [])
        summary = data.get("summary", {})
        return {
            "tool": "caducidades_proximas",
            "dias": dias,
            "count": len(rows),
            "summary": summary,
            "items": rows[:8],
            "empty": len(rows) == 0,
        }
    except Exception as e:
        return {"tool": "caducidades_proximas", "empty": True,
                "reason": f"módulo perecederos no disponible: {e}"}


# ══════════════════════════════════════════════════════════════════════
# RETAIL
# ══════════════════════════════════════════════════════════════════════

async def desempeno_cadena(db: AsyncSession, periodo: str = "mes",
                            limite: int = 5) -> Dict[str, Any]:
    """Top cadenas de retail por revenue en el periodo. Se apoya en el
    Customer vinculado al channel (sell-in)."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    from app.modules.retail.models import RetailChannel
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            RetailChannel.name.label("cadena"),
            func.sum(sm.Order.total_amount).label("revenue"),
            func.count(sm.Order.id).label("pedidos"),
        )
        .join(Customer, Customer.id == RetailChannel.customer_id)
        .join(sm.Order, sm.Order.customer_id == Customer.id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        .group_by(RetailChannel.id, RetailChannel.name)
        .order_by(func.sum(sm.Order.total_amount).desc())
        .limit(max(1, min(limite, 20)))
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items = [{"name": r.cadena, "pedidos": int(r.pedidos or 0),
              "revenue": _money(r.revenue)} for r in rows]
    return {"tool": "desempeno_cadena", "periodo": label, "items": items,
            "empty": len(items) == 0}


# ══════════════════════════════════════════════════════════════════════
# POS
# ══════════════════════════════════════════════════════════════════════

async def ventas_pos_dia(db: AsyncSession, fecha: Optional[str] = None) -> Dict[str, Any]:
    """Corte del día del POS: monto total, tickets, ticket promedio,
    diferencias de arqueo en sesiones cerradas."""
    from app.modules.pos import models as pm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            parsed = datetime.fromisoformat(fecha)
            today = _aware(parsed)
        except Exception: pass
    tomorrow = today + timedelta(days=1)

    # Sumar ventas registradas en el POS via POSTransaction type=sale
    stmt_sales = select(
        func.count(pm.POSTransaction.id),
        func.coalesce(func.sum(pm.POSTransaction.amount), 0.0),
    ).where(
        pm.POSTransaction.type == "sale",
        pm.POSTransaction.created_at >= today,
        pm.POSTransaction.created_at < tomorrow,
    )
    n_tx, total = (await db.execute(stmt_sales)).one()
    n_tx = int(n_tx or 0)
    total = _money(total)
    ticket = round(total / n_tx, 2) if n_tx > 0 else 0.0

    # Sesiones cerradas del día con diferencias
    stmt_sess = select(
        pm.POSSession.terminal_id, pm.POSSession.variance,
        pm.POSSession.expected_cash, pm.POSSession.actual_cash,
    ).where(
        pm.POSSession.closed_at.isnot(None),
        pm.POSSession.closed_at >= today,
        pm.POSSession.closed_at < tomorrow,
    )
    sessions = (await db.execute(stmt_sess)).all()
    total_variance = _money(sum((s.variance or 0) for s in sessions))
    return {
        "tool": "ventas_pos_dia",
        "fecha": today.strftime("%d/%m/%Y"),
        "tickets": n_tx, "total": total, "ticket_promedio": ticket,
        "sesiones_cerradas": len(sessions),
        "diferencia_arqueo_total": total_variance,
        "empty": n_tx == 0,
    }


# ══════════════════════════════════════════════════════════════════════
# UTILIDADES
# ══════════════════════════════════════════════════════════════════════

def _delta_pct(current: float, previous: float) -> Optional[float]:
    if previous == 0:
        return None if current == 0 else 100.0
    return round(((current - previous) / abs(previous)) * 100, 1)


# ══════════════════════════════════════════════════════════════════════
# STUBS — se implementarán conforme el usuario los use
# ══════════════════════════════════════════════════════════════════════

async def _stub(nombre: str) -> Dict[str, Any]:
    return {
        "tool": nombre,
        "empty": True,
        "reason": "en construcción — se activa en la próxima ronda del asistente",
    }

async def concentracion_clientes(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("concentracion_clientes")

async def sin_movimiento(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("sin_movimiento")

async def rotacion_producto(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("rotacion_producto")

async def desempeno_tienda(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("desempeno_tienda")

async def sell_through_por_tienda(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("sell_through_por_tienda")

async def ventas_pos_hora(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("ventas_pos_hora")

async def top_deudores(db: AsyncSession, **k) -> Dict[str, Any]:
    r = await cxc_resumen(db)
    return {"tool": "top_deudores", "items": r.get("top_debtors", []),
            "empty": r.get("empty", True)}

async def top_acreedores(db: AsyncSession, **k) -> Dict[str, Any]:
    r = await cxp_resumen(db)
    return {"tool": "top_acreedores", "items": r.get("top_creditors", []),
            "empty": r.get("empty", True)}

async def utilidad_bruta(db: AsyncSession, **k) -> Dict[str, Any]:
    return await _stub("utilidad_bruta")


# Registro de tools disponibles — usado por el intent router
TOOLS_REGISTRY = {
    "ventas_periodo": ventas_periodo,
    "top_productos": top_productos,
    "top_clientes": top_clientes,
    "pedidos_pendientes": pedidos_pendientes,
    "cxc_resumen": cxc_resumen,
    "cxp_resumen": cxp_resumen,
    "saldo_bancos": saldo_bancos,
    "stock_critico": stock_critico,
    "caducidades_proximas": caducidades_proximas,
    "desempeno_cadena": desempeno_cadena,
    "ventas_pos_dia": ventas_pos_dia,
    "concentracion_clientes": concentracion_clientes,
    "sin_movimiento": sin_movimiento,
    "rotacion_producto": rotacion_producto,
    "desempeno_tienda": desempeno_tienda,
    "sell_through_por_tienda": sell_through_por_tienda,
    "ventas_pos_hora": ventas_pos_hora,
    "top_deudores": top_deudores,
    "top_acreedores": top_acreedores,
    "utilidad_bruta": utilidad_bruta,
}
