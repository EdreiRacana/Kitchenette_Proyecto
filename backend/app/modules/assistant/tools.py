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
_MONTH_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
             "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _period_bounds(periodo: str = "mes") -> tuple[datetime, datetime, str]:
    """Convierte una etiqueta legible en (inicio, fin, etiqueta_humana).
    Soporta: hoy, ayer, semana, mes, mes_pasado, año, ytd, y mes:N (mes
    específico del año, ej. 'mes:7' = julio; si N está en el futuro
    respecto a hoy, se asume del año anterior). Devuelve datetimes
    tz-aware para que coincidan con columnas DateTime(timezone=True)."""
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
    # Mes específico: 'mes:N' donde N=1..12. Año actual, o anterior si
    # todavía no llegamos a ese mes este año.
    if p.startswith("mes:"):
        try:
            n = int(p.split(":", 1)[1])
            if 1 <= n <= 12:
                year = now.year if n <= now.month else now.year - 1
                start = today.replace(year=year, month=n, day=1,
                                       hour=0, minute=0, second=0, microsecond=0)
                if n == 12:
                    end = start.replace(year=year + 1, month=1)
                else:
                    end = start.replace(month=n + 1)
                label = f"{_MONTH_ES[n]} {year}"
                return start, end, label
        except Exception:
            pass
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


def _parse_iso_date(s: Optional[str]) -> Optional[date]:
    """Convierte 'YYYY-MM-DD' → date con tolerancia. HR guarda fechas
    como strings, hay que parsearlas de forma defensiva."""
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s[:10]).date()
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════
# FASE 2 · Stubs rellenados con queries reales
# ══════════════════════════════════════════════════════════════════════

async def concentracion_clientes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Pareto 80/20 sobre revenue del mes: cuántos clientes concentran el
    80% del ingreso. Métrica clásica de dependencia comercial."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    start, end, label = _period_bounds("mes")
    stmt = (
        select(
            Customer.id, Customer.name, Customer.razon_social,
            func.sum(sm.Order.total_amount).label("revenue"),
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
    )
    rows = (await db.execute(stmt)).all()
    total = sum(float(r.revenue or 0) for r in rows)
    if total <= 0:
        return {"tool": "concentracion_clientes", "empty": True}
    acumulado = 0.0
    clientes_hasta_80 = 0
    top3_pct = 0.0
    for i, r in enumerate(rows):
        acumulado += float(r.revenue or 0)
        if clientes_hasta_80 == 0 and acumulado / total >= 0.80:
            clientes_hasta_80 = i + 1
        if i < 3:
            top3_pct += (float(r.revenue or 0) / total) * 100
    return {
        "tool": "concentracion_clientes", "periodo": label,
        "total": _money(total), "n_clientes": len(rows),
        "clientes_hasta_80": clientes_hasta_80 or len(rows),
        "top3_pct": round(top3_pct, 1),
        "top1": {"name": rows[0].razon_social or rows[0].name or "?",
                 "revenue": _money(rows[0].revenue),
                 "pct": round((float(rows[0].revenue or 0) / total) * 100, 1)},
        "empty": False,
    }


async def sin_movimiento(db: AsyncSession, dias: int = 30, **k) -> Dict[str, Any]:
    """SKUs activos que NO se han vendido en los últimos N días.
    Cruza catálogo activo vs OrderItem del periodo — devuelve los
    ausentes que tienen stock (los agotados los muestra stock_critico)."""
    from app.modules.sales import models as sm
    from app.modules.inventory import models as im
    cutoff = _now() - timedelta(days=max(1, min(dias, 365)))
    # SKUs vendidos en la ventana
    vendidos_stmt = (
        select(sm.OrderItem.variant_id)
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= cutoff,
            sm.OrderItem.variant_id.isnot(None),
        )
    )
    vendidos = {row[0] for row in (await db.execute(vendidos_stmt)).all()}

    # SKUs activos con stock disponible
    stmt = (
        select(
            im.ProductVariant.id, im.ProductVariant.sku,
            im.Product.name, func.sum(im.StockLevel.quantity).label("stock"),
        )
        .join(im.Product, im.Product.id == im.ProductVariant.product_id)
        .join(im.StockLevel, im.StockLevel.variant_id == im.ProductVariant.id)
        .where(
            im.Product.is_active == True,  # noqa: E712
            im.ProductVariant.is_active == True,  # noqa: E712
        )
        .group_by(im.ProductVariant.id, im.ProductVariant.sku, im.Product.name)
        .having(func.sum(im.StockLevel.quantity) > 0)
    )
    rows = (await db.execute(stmt)).all()
    items = [
        {"sku": r.sku, "name": r.name, "stock": int(r.stock or 0)}
        for r in rows if r.id not in vendidos
    ]
    items.sort(key=lambda x: -x["stock"])
    return {
        "tool": "sin_movimiento", "dias": dias,
        "count": len(items), "items": items[:10],
        "empty": len(items) == 0,
    }


async def rotacion_producto(db: AsyncSession, **k) -> Dict[str, Any]:
    """Weeks of Supply (WoS) global: stock_actual ÷ velocidad_semanal.
    Velocidad se estima con las ventas de las últimas 4 semanas."""
    from app.modules.sales import models as sm
    from app.modules.inventory import models as im
    ahora = _now()
    cutoff = ahora - timedelta(weeks=4)
    # Velocidad por SKU (unidades / 4 semanas → semanales)
    vel_stmt = (
        select(
            sm.OrderItem.variant_id,
            (func.sum(sm.OrderItem.quantity) / 4.0).label("vel_sem"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= cutoff,
            sm.OrderItem.variant_id.isnot(None),
        )
        .group_by(sm.OrderItem.variant_id)
    )
    vel = {row.variant_id: float(row.vel_sem or 0)
           for row in (await db.execute(vel_stmt)).all()}
    # Stock por SKU
    stock_stmt = (
        select(
            im.ProductVariant.id, im.ProductVariant.sku, im.Product.name,
            func.sum(im.StockLevel.quantity).label("stock"),
        )
        .join(im.Product, im.Product.id == im.ProductVariant.product_id)
        .join(im.StockLevel, im.StockLevel.variant_id == im.ProductVariant.id)
        .where(im.ProductVariant.is_active == True)  # noqa: E712
        .group_by(im.ProductVariant.id, im.ProductVariant.sku, im.Product.name)
    )
    rows = (await db.execute(stock_stmt)).all()
    calc = []
    for r in rows:
        v = vel.get(r.id, 0.0)
        if v <= 0 or r.stock is None:
            continue
        wos = round(float(r.stock) / v, 1) if v > 0 else 999
        calc.append({"sku": r.sku, "name": r.name,
                     "stock": int(r.stock or 0), "vel_sem": round(v, 2),
                     "wos": wos})
    if not calc:
        return {"tool": "rotacion_producto", "empty": True}
    calc.sort(key=lambda x: x["wos"])
    lentos = [x for x in calc if x["wos"] > 12][-5:]
    rapidos = calc[:5]
    return {
        "tool": "rotacion_producto",
        "n_evaluados": len(calc),
        "wos_promedio": round(sum(x["wos"] for x in calc) / len(calc), 1),
        "rapidos": rapidos, "lentos": lentos,
        "empty": False,
    }


async def desempeno_tienda(db: AsyncSession, periodo: str = "mes",
                            limite: int = 5, **k) -> Dict[str, Any]:
    """Top y bottom tiendas por sell-out reportado en el periodo. Se
    apoya en SellOutReport que es la verdad para retail (lo que la
    tienda vendió al consumidor final)."""
    from app.modules.retail import models as rm
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            rm.RetailStore.id, rm.RetailStore.name.label("tienda"),
            rm.RetailChannel.name.label("cadena"),
            func.coalesce(func.sum(rm.SellOutReport.revenue), 0.0).label("revenue"),
            func.coalesce(func.sum(rm.SellOutReport.units_sold), 0).label("unidades"),
        )
        .join(rm.RetailChannel, rm.RetailChannel.id == rm.RetailStore.channel_id)
        .join(rm.SellOutReport, rm.SellOutReport.store_id == rm.RetailStore.id, isouter=True)
        .where(
            rm.RetailStore.is_active == True,  # noqa: E712
            or_(rm.SellOutReport.period_start.is_(None),
                rm.SellOutReport.period_start >= start),
            or_(rm.SellOutReport.period_start.is_(None),
                rm.SellOutReport.period_start < end),
        )
        .group_by(rm.RetailStore.id, rm.RetailStore.name, rm.RetailChannel.name)
        .order_by(func.coalesce(func.sum(rm.SellOutReport.revenue), 0.0).desc())
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items = [{"name": r.tienda, "cadena": r.cadena,
              "revenue": _money(r.revenue), "unidades": int(r.unidades or 0)}
             for r in rows]
    top = items[:limite]
    bottom = [i for i in items if i["revenue"] > 0][-limite:][::-1]
    return {"tool": "desempeno_tienda", "periodo": label,
            "top": top, "bottom": bottom,
            "empty": len(top) == 0}


async def sell_through_por_tienda(db: AsyncSession, periodo: str = "mes",
                                    limite: int = 10, **k) -> Dict[str, Any]:
    """Sell-through % por tienda = unidades vendidas al consumidor ÷
    unidades enviadas por nosotros. Métrica clave de rotación de canal."""
    from app.modules.retail import models as rm
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)

    # Sell-out por tienda
    so_stmt = (
        select(
            rm.RetailStore.id, rm.RetailStore.name,
            func.coalesce(func.sum(rm.SellOutReport.units_sold), 0).label("units_out"),
        )
        .join(rm.SellOutReport, rm.SellOutReport.store_id == rm.RetailStore.id, isouter=True)
        .where(
            rm.RetailStore.is_active == True,  # noqa: E712
            or_(rm.SellOutReport.period_start.is_(None),
                and_(rm.SellOutReport.period_start >= start,
                     rm.SellOutReport.period_start < end)),
        )
        .group_by(rm.RetailStore.id, rm.RetailStore.name)
    )
    try:
        so_rows = {r.id: {"name": r.name, "units_out": int(r.units_out or 0)}
                   for r in (await db.execute(so_stmt)).all()}
    except Exception:
        so_rows = {}

    # Sell-in por tienda (movimientos de salida hacia consignment_warehouse)
    stores_stmt = select(
        rm.RetailStore.id, rm.RetailStore.name,
        rm.RetailStore.consignment_warehouse_id,
    ).where(rm.RetailStore.is_active == True)  # noqa: E712
    stores = (await db.execute(stores_stmt)).all()
    result = []
    for s in stores:
        if not s.consignment_warehouse_id:
            continue
        in_stmt = select(func.coalesce(func.sum(sm.OrderItem.quantity), 0)).join(
            sm.Order, sm.Order.id == sm.OrderItem.order_id,
        ).where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        # aprox: no tenemos vínculo directo store↔order aquí, usamos sell_out
        # como aproximación de referencia; el sell-through queda con lo que
        # tengamos en SellOutReport si no hay sell-in explícito.
        units_out = so_rows.get(s.id, {}).get("units_out", 0)
        if units_out <= 0:
            continue
        result.append({"name": s.name, "units_out": units_out,
                       "sell_through_pct": None})
    return {
        "tool": "sell_through_por_tienda", "periodo": label,
        "items": result[:limite],
        "empty": len(result) == 0,
        "nota": "sell-through requiere sell-in histórico por tienda; se reporta unidades vendidas al consumidor.",
    }


async def ventas_pos_hora(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Histograma de ventas POS por hora del día actual (o fecha dada).
    Sirve para saber en qué franja hay pico."""
    from app.modules.pos import models as pm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            parsed = datetime.fromisoformat(fecha)
            today = _aware(parsed)
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(
            func.extract("hour", pm.POSTransaction.created_at).label("h"),
            func.count(pm.POSTransaction.id).label("tickets"),
            func.coalesce(func.sum(pm.POSTransaction.amount), 0.0).label("monto"),
        )
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
        )
        .group_by(func.extract("hour", pm.POSTransaction.created_at))
        .order_by(func.extract("hour", pm.POSTransaction.created_at))
    )
    rows = (await db.execute(stmt)).all()
    horas = [{"hora": int(r.h or 0), "tickets": int(r.tickets or 0),
              "monto": _money(r.monto)} for r in rows]
    pico = max(horas, key=lambda x: x["monto"]) if horas else None
    return {
        "tool": "ventas_pos_hora",
        "fecha": today.strftime("%d/%m/%Y"),
        "horas": horas, "pico": pico,
        "empty": len(horas) == 0,
    }


async def top_deudores(db: AsyncSession, **k) -> Dict[str, Any]:
    """Top 10 clientes por saldo pendiente — usa el mismo motor de CxC."""
    r = await cxc_resumen(db)
    items = r.get("top_debtors", [])
    return {"tool": "top_deudores", "items": items[:10],
            "count": len(items), "empty": len(items) == 0}


async def top_acreedores(db: AsyncSession, **k) -> Dict[str, Any]:
    """Top 10 proveedores por saldo pendiente."""
    r = await cxp_resumen(db)
    items = r.get("top_creditors", [])
    return {"tool": "top_acreedores", "items": items[:10],
            "count": len(items), "empty": len(items) == 0}


async def utilidad_bruta(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Utilidad bruta del periodo = suma(subtotal) − suma(unit_cost × qty).
    OrderItem.unit_cost es snapshot al momento de la venta — es la fuente
    canónica de COGS del ERP."""
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.coalesce(func.sum(sm.OrderItem.subtotal), 0.0).label("ingreso"),
            func.coalesce(
                func.sum(sm.OrderItem.unit_cost * sm.OrderItem.quantity), 0.0
            ).label("costo"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
    )
    row = (await db.execute(stmt)).one()
    ingreso = _money(row.ingreso)
    costo = _money(row.costo)
    utilidad = _money(ingreso - costo)
    margen = round((utilidad / ingreso) * 100, 1) if ingreso > 0 else 0.0
    return {
        "tool": "utilidad_bruta", "periodo": label,
        "ingreso": ingreso, "costo": costo,
        "utilidad": utilidad, "margen_pct": margen,
        "empty": ingreso <= 0,
    }


# ══════════════════════════════════════════════════════════════════════
# FASE 3 · Tools nuevas priorizadas por departamento
# ══════════════════════════════════════════════════════════════════════

# ─── Ventas / CRM (3 tools nuevas) ────────────────────────────────────

async def cotizaciones_abiertas(db: AsyncSession, **k) -> Dict[str, Any]:
    """Cotizaciones en pipeline sin convertirse a pedido."""
    from app.modules.sales import models as sm
    stmt = (
        select(func.count(sm.Order.id), func.coalesce(func.sum(sm.Order.total_amount), 0.0))
        .where(sm.Order.kind == "quote", sm.Order.status != "cancelled")
    )
    n, monto = (await db.execute(stmt)).one()
    detalle_stmt = (
        select(sm.Order.folio, sm.Order.total_amount, sm.Order.created_at)
        .where(sm.Order.kind == "quote", sm.Order.status != "cancelled")
        .order_by(sm.Order.created_at.desc()).limit(5)
    )
    detalles = [{"folio": r.folio, "monto": _money(r.total_amount)}
                for r in (await db.execute(detalle_stmt)).all()]
    return {"tool": "cotizaciones_abiertas", "count": int(n or 0),
            "monto_total": _money(monto), "recientes": detalles,
            "empty": int(n or 0) == 0}


async def clientes_inactivos(db: AsyncSession, dias: int = 60, **k) -> Dict[str, Any]:
    """Clientes con al menos 1 pedido histórico que NO han comprado
    en N días. Semilla de acciones de win-back."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    cutoff = _now() - timedelta(days=max(7, min(dias, 730)))
    stmt = (
        select(
            Customer.id, Customer.name, Customer.razon_social,
            func.max(sm.Order.created_at).label("ultima"),
        )
        .join(sm.Order, sm.Order.customer_id == Customer.id)
        .where(sm.Order.kind == "order", sm.Order.status != "cancelled")
        .group_by(Customer.id, Customer.name, Customer.razon_social)
        .having(func.max(sm.Order.created_at) < cutoff)
        .order_by(func.max(sm.Order.created_at).desc())
        .limit(15)
    )
    rows = (await db.execute(stmt)).all()
    now = _now()
    items = []
    for r in rows:
        ultima = _aware(r.ultima)
        dias_sin = (now - ultima).days if ultima else None
        items.append({
            "name": r.razon_social or r.name or "?",
            "dias_sin_comprar": dias_sin,
        })
    return {"tool": "clientes_inactivos", "dias": dias,
            "count": len(items), "items": items[:10],
            "empty": len(items) == 0}


async def ticket_promedio_ventas(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Ticket promedio del canal de mostrador/CRM en el periodo."""
    r = await ventas_periodo(db, periodo=periodo, comparar=True)
    ticket = r.get("ticket_promedio", 0.0)
    return {"tool": "ticket_promedio_ventas", "periodo": r.get("periodo"),
            "ticket": ticket, "count": r.get("count", 0),
            "empty": r.get("count", 0) == 0}


async def devoluciones_periodo(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Devoluciones de clientes en el periodo — monto y top por causa."""
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)
    try:
        stmt = (
            select(
                func.count(sm.CustomerReturn.id),
                func.coalesce(func.sum(sm.CustomerReturn.refund_amount), 0.0),
            )
            .where(
                sm.CustomerReturn.created_at >= start,
                sm.CustomerReturn.created_at < end,
            )
        )
        n, monto = (await db.execute(stmt)).one()
    except Exception:
        return {"tool": "devoluciones_periodo", "empty": True,
                "reason": "módulo de devoluciones no disponible"}
    return {"tool": "devoluciones_periodo", "periodo": label,
            "count": int(n or 0), "monto": _money(monto),
            "empty": int(n or 0) == 0}


# ─── Finanzas (3 tools nuevas) ────────────────────────────────────────

async def cxc_vencen_semana(db: AsyncSession, **k) -> Dict[str, Any]:
    """CxC cuyo vencimiento cae en los próximos 7 días."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    ahora = _now()
    horizonte = ahora + timedelta(days=7)
    # Para pedidos: usamos due_date si existe; si no, aging básico
    stmt = (
        select(sm.Order.folio, sm.Order.total_amount, sm.Order.paid_amount,
               sm.Order.due_date, Customer.name, Customer.razon_social)
        .join(Customer, Customer.id == sm.Order.customer_id, isouter=True)
        .where(
            sm.Order.kind == "order",
            sm.Order.status.in_(["pending", "partial"]),
            sm.Order.due_date.isnot(None),
            sm.Order.due_date >= ahora,
            sm.Order.due_date <= horizonte,
        )
        .order_by(sm.Order.due_date.asc())
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items, total = [], 0.0
    for r in rows:
        saldo = _money((r.total_amount or 0) - (r.paid_amount or 0))
        if saldo <= 0:
            continue
        total += saldo
        items.append({
            "folio": r.folio,
            "cliente": r.razon_social or r.name or "?",
            "monto": saldo,
            "vence": _aware(r.due_date).strftime("%d/%m") if r.due_date else "?",
        })
    return {"tool": "cxc_vencen_semana", "count": len(items),
            "total": _money(total), "items": items[:10],
            "empty": len(items) == 0}


async def cxp_vencen_semana(db: AsyncSession, **k) -> Dict[str, Any]:
    """CxP cuyo vencimiento cae en los próximos 7 días."""
    from app.modules.finance.models import SupplierBill
    ahora = _now()
    horizonte = ahora + timedelta(days=7)
    stmt = (
        select(SupplierBill.folio, SupplierBill.supplier_name,
               SupplierBill.total_amount, SupplierBill.paid_amount,
               SupplierBill.due_date)
        .where(
            SupplierBill.status != "paid",
            SupplierBill.due_date.isnot(None),
            SupplierBill.due_date >= ahora,
            SupplierBill.due_date <= horizonte,
        )
        .order_by(SupplierBill.due_date.asc())
    )
    rows = (await db.execute(stmt)).all()
    items, total = [], 0.0
    for r in rows:
        saldo = _money((r.total_amount or 0) - (r.paid_amount or 0))
        if saldo <= 0:
            continue
        total += saldo
        items.append({
            "folio": r.folio, "proveedor": r.supplier_name or "?",
            "monto": saldo,
            "vence": _aware(r.due_date).strftime("%d/%m") if r.due_date else "?",
        })
    return {"tool": "cxp_vencen_semana", "count": len(items),
            "total": _money(total), "items": items[:10],
            "empty": len(items) == 0}


async def flujo_neto_30d(db: AsyncSession, **k) -> Dict[str, Any]:
    """Proyección simple 30 días: CxC vencederas − CxP vencederas.
    Base para planeación de tesorería."""
    from app.modules.sales import models as sm
    from app.modules.finance.models import SupplierBill
    ahora = _now()
    horizonte = ahora + timedelta(days=30)

    cxc_stmt = select(func.coalesce(func.sum(sm.Order.total_amount - sm.Order.paid_amount), 0.0)).where(
        sm.Order.kind == "order",
        sm.Order.status.in_(["pending", "partial"]),
        sm.Order.due_date.isnot(None),
        sm.Order.due_date <= horizonte,
    )
    cxp_stmt = select(func.coalesce(func.sum(SupplierBill.total_amount - SupplierBill.paid_amount), 0.0)).where(
        SupplierBill.status != "paid",
        SupplierBill.due_date.isnot(None),
        SupplierBill.due_date <= horizonte,
    )
    try:
        cxc = _money((await db.execute(cxc_stmt)).scalar())
    except Exception:
        cxc = 0.0
    cxp = _money((await db.execute(cxp_stmt)).scalar())
    neto = _money(cxc - cxp)
    return {"tool": "flujo_neto_30d", "cxc": cxc, "cxp": cxp,
            "neto": neto, "empty": False}


# ─── Compras (2 tools nuevas) ─────────────────────────────────────────

async def oc_abiertas(db: AsyncSession, **k) -> Dict[str, Any]:
    """Órdenes de compra en estado DRAFT o ORDERED (no recibidas ni canceladas)."""
    from app.modules.inventory import models as im
    stmt = (
        select(im.PurchaseOrder.folio, im.PurchaseOrder.status,
               im.PurchaseOrder.total_amount, im.PurchaseOrder.due_date,
               im.Supplier.name)
        .join(im.Supplier, im.Supplier.id == im.PurchaseOrder.supplier_id, isouter=True)
        .where(im.PurchaseOrder.status.in_(["draft", "ordered"]))
        .order_by(im.PurchaseOrder.created_at.desc())
        .limit(30)
    )
    rows = (await db.execute(stmt)).all()
    items = [{
        "folio": r.folio, "proveedor": r.name or "?",
        "status": r.status, "monto": _money(r.total_amount),
        "vence": _aware(r.due_date).strftime("%d/%m/%Y") if r.due_date else "sin fecha",
    } for r in rows]
    total = _money(sum(x["monto"] for x in items))
    return {"tool": "oc_abiertas", "count": len(items),
            "monto_total": total, "items": items[:10],
            "empty": len(items) == 0}


async def oc_atrasadas(db: AsyncSession, **k) -> Dict[str, Any]:
    """OC 'ordered' cuya due_date ya pasó y no se han recibido."""
    from app.modules.inventory import models as im
    ahora = _now()
    stmt = (
        select(im.PurchaseOrder.folio, im.PurchaseOrder.total_amount,
               im.PurchaseOrder.due_date, im.Supplier.name)
        .join(im.Supplier, im.Supplier.id == im.PurchaseOrder.supplier_id, isouter=True)
        .where(
            im.PurchaseOrder.status == "ordered",
            im.PurchaseOrder.due_date.isnot(None),
            im.PurchaseOrder.due_date < ahora,
        )
        .order_by(im.PurchaseOrder.due_date.asc())
        .limit(15)
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for r in rows:
        due = _aware(r.due_date)
        dias_retraso = (ahora - due).days if due else 0
        items.append({
            "folio": r.folio, "proveedor": r.name or "?",
            "monto": _money(r.total_amount),
            "dias_retraso": dias_retraso,
        })
    return {"tool": "oc_atrasadas", "count": len(items),
            "items": items[:10], "empty": len(items) == 0}


async def top_proveedores(db: AsyncSession, periodo: str = "mes",
                            limite: int = 5, **k) -> Dict[str, Any]:
    """Top proveedores por gasto (facturas emitidas) en el periodo."""
    from app.modules.finance.models import SupplierBill
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            SupplierBill.supplier_name,
            func.coalesce(func.sum(SupplierBill.total_amount), 0.0).label("gasto"),
            func.count(SupplierBill.id).label("facturas"),
        )
        .where(
            SupplierBill.status != "cancelled",
            SupplierBill.issue_date >= start,
            SupplierBill.issue_date < end,
        )
        .group_by(SupplierBill.supplier_name)
        .order_by(func.coalesce(func.sum(SupplierBill.total_amount), 0.0).desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{"name": r.supplier_name or "?",
              "gasto": _money(r.gasto), "facturas": int(r.facturas or 0)}
             for r in rows]
    return {"tool": "top_proveedores", "periodo": label,
            "items": items, "empty": len(items) == 0}


# ─── Inventario avanzado (2 tools nuevas) ─────────────────────────────

async def valor_inventario(db: AsyncSession, **k) -> Dict[str, Any]:
    """Valor total del inventario a costo: sum(qty × cost_price) por SKU activo."""
    from app.modules.inventory import models as im
    stmt = (
        select(
            func.coalesce(
                func.sum(im.StockLevel.quantity * im.ProductVariant.cost_price), 0.0,
            ).label("valor"),
            func.count(im.ProductVariant.id.distinct()).label("skus"),
        )
        .join(im.ProductVariant, im.ProductVariant.id == im.StockLevel.variant_id)
        .where(
            im.ProductVariant.is_active == True,  # noqa: E712
            im.ProductVariant.cost_price.isnot(None),
            im.StockLevel.quantity > 0,
        )
    )
    row = (await db.execute(stmt)).one()
    return {"tool": "valor_inventario",
            "valor_total": _money(row.valor),
            "skus_con_stock": int(row.skus or 0),
            "empty": (row.valor or 0) <= 0}


async def merma_mes(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Salidas de tipo ADJUSTMENT con cantidad negativa en el periodo —
    proxy de merma. Distingue por reference si menciona 'merma' o 'expired'."""
    from app.modules.inventory import models as im
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.count(im.StockMovement.id),
            func.coalesce(func.sum(-im.StockMovement.quantity * im.StockMovement.unit_cost), 0.0).label("valor"),
            func.coalesce(func.sum(-im.StockMovement.quantity), 0).label("unidades"),
        )
        .where(
            im.StockMovement.movement_type.in_(["ADJUSTMENT", "OUT"]),
            im.StockMovement.quantity < 0,
            im.StockMovement.created_at >= start,
            im.StockMovement.created_at < end,
            or_(im.StockMovement.reference.ilike("%merma%"),
                im.StockMovement.reference.ilike("%expired%"),
                im.StockMovement.reference.ilike("%dañad%")),
        )
    )
    row = (await db.execute(stmt)).one()
    return {"tool": "merma_mes", "periodo": label,
            "movimientos": int(row[0] or 0),
            "unidades": int(row.unidades or 0),
            "valor": _money(row.valor),
            "empty": int(row[0] or 0) == 0}


# ─── Contabilidad (2 tools nuevas) ────────────────────────────────────

async def ingresos_vs_egresos(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """P&L express: suma de Transaction.type income vs expense en el periodo."""
    from app.modules.finance.models import Transaction
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(Transaction.type,
               func.coalesce(func.sum(Transaction.amount), 0.0).label("total"))
        .where(Transaction.created_at >= start, Transaction.created_at < end)
        .group_by(Transaction.type)
    )
    rows = (await db.execute(stmt)).all()
    tot = {r.type: _money(r.total) for r in rows}
    ing = tot.get("income", 0.0)
    egr = tot.get("expense", 0.0)
    return {"tool": "ingresos_vs_egresos", "periodo": label,
            "ingresos": ing, "egresos": egr, "neto": _money(ing - egr),
            "empty": (ing == 0 and egr == 0)}


async def gastos_por_categoria(db: AsyncSession, periodo: str = "mes",
                                 limite: int = 5, **k) -> Dict[str, Any]:
    """Top categorías de gasto del periodo."""
    from app.modules.finance.models import Transaction
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(Transaction.category,
               func.coalesce(func.sum(Transaction.amount), 0.0).label("total"))
        .where(
            Transaction.type == "expense",
            Transaction.created_at >= start,
            Transaction.created_at < end,
        )
        .group_by(Transaction.category)
        .order_by(func.coalesce(func.sum(Transaction.amount), 0.0).desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{"categoria": r.category or "sin categoría",
              "monto": _money(r.total)} for r in rows]
    total = _money(sum(x["monto"] for x in items))
    return {"tool": "gastos_por_categoria", "periodo": label,
            "items": items, "total": total,
            "empty": len(items) == 0}


async def movimientos_no_conciliados(db: AsyncSession, **k) -> Dict[str, Any]:
    """Bank transactions con reconciled=False — colita de contabilidad."""
    from app.modules.finance.models import BankTransaction
    stmt = (
        select(func.count(BankTransaction.id),
               func.coalesce(func.sum(BankTransaction.amount), 0.0))
        .where(BankTransaction.reconciled == False)  # noqa: E712
    )
    n, monto = (await db.execute(stmt)).one()
    return {"tool": "movimientos_no_conciliados",
            "count": int(n or 0), "monto": _money(monto),
            "empty": int(n or 0) == 0}


# ─── RH / Nómina (5 tools nuevas) ─────────────────────────────────────

async def nomina_periodo(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Total bruto + neto de la nómina del periodo (default: mes en curso).
    Suma TODAS las nóminas cerradas cuyo payment_date cae dentro del rango
    — así 'nómina de julio' agrega la 1a y 2a quincena de julio."""
    from app.modules.hr import models as hm
    start, _, label = _period_bounds(periodo)
    prefix = start.strftime("%Y-%m")
    stmt = (
        select(hm.PayrollPeriod.id, hm.PayrollPeriod.name,
               hm.PayrollPeriod.status, hm.PayrollPeriod.kind)
        .where(
            hm.PayrollPeriod.status.in_(["calculated", "approved", "dispersed"]),
            hm.PayrollPeriod.payment_date.like(f"{prefix}%"),
        )
        .order_by(hm.PayrollPeriod.created_at.desc())
    )
    periods = (await db.execute(stmt)).all()
    if not periods:
        # Fallback: si no hay del periodo pedido, toma la más reciente
        # (comportamiento previo, para que "cuánto es la nómina" siga funcionando).
        fb = (await db.execute(
            select(hm.PayrollPeriod.id, hm.PayrollPeriod.name,
                    hm.PayrollPeriod.status, hm.PayrollPeriod.kind)
            .where(hm.PayrollPeriod.status.in_(["calculated", "approved", "dispersed"]))
            .order_by(hm.PayrollPeriod.created_at.desc()).limit(1)
        )).first()
        if not fb:
            return {"tool": "nomina_periodo", "empty": True}
        periods = [fb]
        label = fb.name
    period = periods[0]
    period_ids = [p.id for p in periods]
    agg_stmt = (
        select(
            func.count(hm.PayrollDetail.id),
            func.coalesce(func.sum(hm.PayrollDetail.total_gross), 0.0),
            func.coalesce(func.sum(hm.PayrollDetail.total_net), 0.0),
            func.coalesce(func.sum(hm.PayrollDetail.imss_employer), 0.0),
        )
        .where(hm.PayrollDetail.period_id.in_(period_ids))
    )
    n, bruto, neto, imss_p = (await db.execute(agg_stmt)).one()
    return {"tool": "nomina_periodo",
            "periodo": label, "status": period.status,
            "kind": period.kind, "empleados": int(n or 0),
            "periodos_agregados": len(period_ids),
            "bruto": _money(bruto), "neto": _money(neto),
            "imss_patronal": _money(imss_p),
            "empty": int(n or 0) == 0}


async def empleados_activos(db: AsyncSession, **k) -> Dict[str, Any]:
    """Conteo de empleados activos + altas/bajas del mes."""
    from app.modules.hr import models as hm
    start, end, label = _period_bounds("mes")
    activos = (await db.execute(
        select(func.count(hm.Employee.id)).where(hm.Employee.is_active == True)  # noqa: E712
    )).scalar()
    # Altas: hire_date del mes en curso (string ISO)
    hire_prefix = start.strftime("%Y-%m")
    altas = (await db.execute(
        select(func.count(hm.Employee.id)).where(hm.Employee.hire_date.like(f"{hire_prefix}%"))
    )).scalar()
    # Bajas: is_active=false con updated_at en el mes (proxy)
    return {"tool": "empleados_activos",
            "activos": int(activos or 0),
            "altas_mes": int(altas or 0),
            "empty": int(activos or 0) == 0}


async def incapacidades_mes(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Incapacidades registradas en Attendance en el periodo (default: este mes)."""
    from app.modules.hr import models as hm
    start, _, label = _period_bounds(periodo)
    prefix = start.strftime("%Y-%m")
    stmt = (
        select(hm.Attendance.incapacity_subtype,
               func.count(hm.Attendance.id))
        .where(
            hm.Attendance.type == "incapacidad",
            hm.Attendance.date.like(f"{prefix}%"),
        )
        .group_by(hm.Attendance.incapacity_subtype)
    )
    rows = (await db.execute(stmt)).all()
    desglose = {r[0] or "sin_subtipo": int(r[1] or 0) for r in rows}
    total = sum(desglose.values())
    return {"tool": "incapacidades_mes", "periodo": label,
            "total": total, "desglose": desglose,
            "empty": total == 0}


async def contratos_por_vencer(db: AsyncSession, dias: int = 30, **k) -> Dict[str, Any]:
    """Contratos con end_date en los próximos N días — riesgo laboral
    si no se renueva. LFT art. 39 exige aviso al trabajador."""
    from app.modules.hr import models as hm
    ahora = date.today()
    horizonte = ahora + timedelta(days=max(7, min(dias, 365)))
    stmt = (
        select(hm.Contract.id, hm.Contract.end_date, hm.Contract.contract_type,
               hm.Employee.name, hm.Employee.last_name)
        .join(hm.Employee, hm.Employee.id == hm.Contract.employee_id)
        .where(
            hm.Contract.status.in_(["draft", "generated", "signed"]),
            hm.Contract.end_date.isnot(None),
        )
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for r in rows:
        fin = _parse_iso_date(r.end_date)
        if not fin or fin < ahora or fin > horizonte:
            continue
        items.append({
            "empleado": f"{r.name} {r.last_name}".strip(),
            "tipo": r.contract_type,
            "vence": fin.strftime("%d/%m/%Y"),
            "dias": (fin - ahora).days,
        })
    items.sort(key=lambda x: x["dias"])
    return {"tool": "contratos_por_vencer", "dias": dias,
            "count": len(items), "items": items[:10],
            "empty": len(items) == 0}


async def cumpleanos_mes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Empleados que cumplen años este mes (para detalle de RH)."""
    from app.modules.hr import models as hm
    mes_actual = date.today().month
    stmt = select(hm.Employee.name, hm.Employee.last_name, hm.Employee.birth_date).where(
        hm.Employee.is_active == True,  # noqa: E712
        hm.Employee.birth_date.isnot(None),
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for r in rows:
        d = _parse_iso_date(r.birth_date)
        if d and d.month == mes_actual:
            items.append({
                "nombre": f"{r.name} {r.last_name}".strip(),
                "dia": d.strftime("%d/%m"),
            })
    items.sort(key=lambda x: x["dia"])
    return {"tool": "cumpleanos_mes", "count": len(items),
            "items": items[:15], "empty": len(items) == 0}


async def isr_nomina_mes(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Total ISR retenido en nóminas cerradas del periodo (default: este mes)."""
    from app.modules.hr import models as hm
    start, end, label = _period_bounds(periodo)
    prefix = start.strftime("%Y-%m")
    stmt = (
        select(func.coalesce(func.sum(hm.PayrollDetail.isr), 0.0))
        .join(hm.PayrollPeriod, hm.PayrollPeriod.id == hm.PayrollDetail.period_id)
        .where(hm.PayrollPeriod.payment_date.like(f"{prefix}%"))
    )
    isr = _money((await db.execute(stmt)).scalar())
    return {"tool": "isr_nomina_mes", "periodo": label,
            "isr_retenido": isr, "empty": isr <= 0}


# ─── POS avanzado (3 tools nuevas) ────────────────────────────────────

async def corte_caja_actual(db: AsyncSession, **k) -> Dict[str, Any]:
    """Estado de las sesiones POS abiertas ahora mismo."""
    from app.modules.pos import models as pm
    stmt = (
        select(pm.POSSession.id, pm.POSSession.opening_balance,
               pm.POSSession.total_sales_amount, pm.POSSession.total_cash_in,
               pm.POSSession.total_cash_out, pm.POSSession.opened_at,
               pm.POSTerminal.name.label("terminal"))
        .join(pm.POSTerminal, pm.POSTerminal.id == pm.POSSession.terminal_id)
        .where(pm.POSSession.status == "open")
    )
    rows = (await db.execute(stmt)).all()
    sesiones = []
    for r in rows:
        # Efectivo esperado = apertura + ventas efectivo + cash_in - cash_out
        # Aquí usamos totales snapshot; en la práctica se calcula al cerrar.
        esperado = _money((r.opening_balance or 0) + (r.total_sales_amount or 0)
                          + (r.total_cash_in or 0) - (r.total_cash_out or 0))
        sesiones.append({
            "terminal": r.terminal, "esperado": esperado,
            "abierta": _aware(r.opened_at).strftime("%d/%m %H:%M") if r.opened_at else "?",
        })
    return {"tool": "corte_caja_actual",
            "abiertas": len(sesiones), "sesiones": sesiones,
            "empty": len(sesiones) == 0}


async def formas_pago_pos(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Desglose por método de pago (cash/card/transfer) del día en el POS."""
    from app.modules.pos import models as pm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(pm.POSTransaction.payment_method,
               func.count(pm.POSTransaction.id),
               func.coalesce(func.sum(pm.POSTransaction.amount), 0.0))
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
        )
        .group_by(pm.POSTransaction.payment_method)
    )
    rows = (await db.execute(stmt)).all()
    items = [{"metodo": r[0] or "otro",
              "tickets": int(r[1] or 0), "monto": _money(r[2])}
             for r in rows]
    total = _money(sum(x["monto"] for x in items))
    return {"tool": "formas_pago_pos",
            "fecha": today.strftime("%d/%m/%Y"),
            "items": items, "total": total,
            "empty": len(items) == 0}


async def top_cajeros_dia(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Cajeros con más ventas en el día."""
    from app.modules.pos import models as pm
    from app.modules.auth.models import User
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(User.full_name, User.email,
               func.coalesce(func.sum(pm.POSTransaction.amount), 0.0).label("monto"),
               func.count(pm.POSTransaction.id).label("tickets"))
        .join(pm.POSSession, pm.POSSession.id == pm.POSTransaction.session_id)
        .join(User, User.id == pm.POSSession.cashier_id)
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
        )
        .group_by(User.id, User.full_name, User.email)
        .order_by(func.coalesce(func.sum(pm.POSTransaction.amount), 0.0).desc())
        .limit(5)
    )
    rows = (await db.execute(stmt)).all()
    items = [{"cajero": r.full_name or r.email or "?",
              "monto": _money(r.monto), "tickets": int(r.tickets or 0)}
             for r in rows]
    return {"tool": "top_cajeros_dia",
            "fecha": today.strftime("%d/%m/%Y"),
            "items": items, "empty": len(items) == 0}


# ─── KPI ejecutivo — solo Administrador (rol reports) ─────────────────

async def flujo_efectivo_proyectado(db: AsyncSession, **k) -> Dict[str, Any]:
    """Flujo de caja proyectado 30 días: bancos + cobranza esperada -
    pagos esperados."""
    from app.modules.finance.models import BankAccount
    saldo_stmt = select(func.coalesce(func.sum(BankAccount.balance), 0.0)).where(
        BankAccount.is_active == True, BankAccount.currency == "MXN",  # noqa: E712
    )
    saldo = _money((await db.execute(saldo_stmt)).scalar())
    flujo = await flujo_neto_30d(db)
    proyeccion = _money(saldo + flujo["neto"])
    return {"tool": "flujo_efectivo_proyectado",
            "saldo_actual": saldo,
            "cobranza_esperada": flujo["cxc"],
            "pagos_esperados": flujo["cxp"],
            "proyeccion_30d": proyeccion,
            "empty": False}


async def nomina_vs_ventas(db: AsyncSession, **k) -> Dict[str, Any]:
    """Costo laboral del mes vs ventas del mes = % costo laboral."""
    v = await ventas_periodo(db, periodo="mes", comparar=False)
    n = await nomina_periodo(db)
    ventas = v.get("total", 0.0)
    nomina = n.get("bruto", 0.0)
    pct = round((nomina / ventas) * 100, 1) if ventas > 0 else None
    return {"tool": "nomina_vs_ventas",
            "ventas": ventas, "nomina": nomina,
            "pct_costo_laboral": pct,
            "empty": ventas == 0 and nomina == 0}


# ══════════════════════════════════════════════════════════════════════
# FASE 6 · Tools restantes por departamento
# ══════════════════════════════════════════════════════════════════════

# ─── Retail avanzado (4) ──────────────────────────────────────────────

async def _wos_por_tienda(db: AsyncSession):
    """Helper: devuelve [{store_id, name, cadena, wos, on_hand, vel_sem,
    critical_wos, overstock_wos}]. Se calcula solo para tiendas con
    consignment_warehouse — el WoS solo tiene sentido con stock físico."""
    from app.modules.retail import models as rm
    from app.modules.inventory import models as im
    ahora = _now()
    cutoff = ahora - timedelta(weeks=4)
    stores_stmt = (
        select(
            rm.RetailStore.id, rm.RetailStore.name,
            rm.RetailStore.consignment_warehouse_id,
            rm.RetailChannel.name.label("cadena"),
            rm.RetailChannel.critical_wos_weeks,
            rm.RetailChannel.overstock_wos_weeks,
        )
        .join(rm.RetailChannel, rm.RetailChannel.id == rm.RetailStore.channel_id)
        .where(
            rm.RetailStore.is_active == True,  # noqa: E712
            rm.RetailStore.consignment_warehouse_id.isnot(None),
        )
    )
    stores = (await db.execute(stores_stmt)).all()
    out = []
    for s in stores:
        stock_stmt = select(
            func.coalesce(func.sum(im.StockLevel.quantity), 0),
        ).where(im.StockLevel.warehouse_id == s.consignment_warehouse_id)
        on_hand = int((await db.execute(stock_stmt)).scalar() or 0)
        vel_stmt = select(
            func.coalesce(func.sum(rm.SellOutReport.units_sold), 0),
        ).where(
            rm.SellOutReport.store_id == s.id,
            rm.SellOutReport.period_start >= cutoff,
        )
        vendido_4sem = int((await db.execute(vel_stmt)).scalar() or 0)
        vel_sem = vendido_4sem / 4.0 if vendido_4sem else 0.0
        wos = round(on_hand / vel_sem, 1) if vel_sem > 0 else None
        out.append({
            "store_id": s.id, "name": s.name, "cadena": s.cadena,
            "on_hand": on_hand, "vel_sem": round(vel_sem, 2),
            "wos": wos,
            "critical_wos": float(s.critical_wos_weeks or 2.0),
            "overstock_wos": float(s.overstock_wos_weeks or 12.0),
        })
    return out


async def tiendas_wos_critico(db: AsyncSession, **k) -> Dict[str, Any]:
    """Tiendas cuyo WoS está por debajo del umbral crítico de su cadena.
    Dispara reabasto urgente."""
    try:
        datos = await _wos_por_tienda(db)
    except Exception as e:
        return {"tool": "tiendas_wos_critico", "empty": True, "reason": str(e)}
    criticas = [d for d in datos
                if d["wos"] is not None and d["wos"] < d["critical_wos"]]
    criticas.sort(key=lambda x: x["wos"])
    return {
        "tool": "tiendas_wos_critico",
        "count": len(criticas),
        "items": [{"name": c["name"], "cadena": c["cadena"],
                    "wos": c["wos"], "on_hand": c["on_hand"],
                    "umbral": c["critical_wos"]}
                  for c in criticas[:10]],
        "empty": len(criticas) == 0,
    }


async def tiendas_sobrestock(db: AsyncSession, **k) -> Dict[str, Any]:
    """Tiendas cuyo WoS supera el umbral de sobre-stock. Candidatas a
    traslado hacia tiendas con demanda."""
    try:
        datos = await _wos_por_tienda(db)
    except Exception as e:
        return {"tool": "tiendas_sobrestock", "empty": True, "reason": str(e)}
    sobre = [d for d in datos
             if d["wos"] is not None and d["wos"] > d["overstock_wos"]]
    sobre.sort(key=lambda x: -x["wos"])
    return {
        "tool": "tiendas_sobrestock",
        "count": len(sobre),
        "items": [{"name": s["name"], "cadena": s["cadena"],
                    "wos": s["wos"], "on_hand": s["on_hand"],
                    "umbral": s["overstock_wos"]}
                  for s in sobre[:10]],
        "empty": len(sobre) == 0,
    }


async def fill_rate_cadena(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Fill rate aproximado por cadena = 1 − (unidades no surtidas ÷
    demanda total). Aproximación: unidades vendidas por consumidor ÷
    (unidades vendidas + unidades devueltas) sobre el periodo."""
    from app.modules.retail import models as rm
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            rm.RetailChannel.name,
            func.coalesce(func.sum(rm.SellOutReport.units_sold), 0).label("sold"),
            func.coalesce(func.sum(rm.SellOutReport.units_returned), 0).label("ret"),
        )
        .join(rm.RetailStore, rm.RetailStore.channel_id == rm.RetailChannel.id)
        .join(rm.SellOutReport, rm.SellOutReport.store_id == rm.RetailStore.id)
        .where(
            rm.SellOutReport.period_start >= start,
            rm.SellOutReport.period_start < end,
        )
        .group_by(rm.RetailChannel.id, rm.RetailChannel.name)
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items = []
    for r in rows:
        sold = int(r.sold or 0)
        ret = int(r.ret or 0)
        demanda = sold + ret
        pct = round((sold / demanda) * 100, 1) if demanda > 0 else None
        items.append({"cadena": r.name, "vendido": sold,
                       "devuelto": ret, "fill_rate_pct": pct})
    return {"tool": "fill_rate_cadena", "periodo": label,
            "items": items, "empty": len(items) == 0}


async def return_rate_cadena(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Return rate por cadena vs el umbral configurado (RetailChannel.
    return_rate_max_pct). Marca las que exceden."""
    from app.modules.retail import models as rm
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            rm.RetailChannel.name, rm.RetailChannel.return_rate_max_pct,
            func.coalesce(func.sum(rm.SellOutReport.revenue), 0.0).label("rev"),
            func.coalesce(func.sum(rm.SellOutReport.returns_amount), 0.0).label("ret_amount"),
        )
        .join(rm.RetailStore, rm.RetailStore.channel_id == rm.RetailChannel.id)
        .join(rm.SellOutReport, rm.SellOutReport.store_id == rm.RetailStore.id)
        .where(
            rm.SellOutReport.period_start >= start,
            rm.SellOutReport.period_start < end,
        )
        .group_by(rm.RetailChannel.id, rm.RetailChannel.name,
                   rm.RetailChannel.return_rate_max_pct)
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items = []
    for r in rows:
        rev = float(r.rev or 0)
        ret_amt = float(r.ret_amount or 0)
        pct = round((ret_amt / (rev + ret_amt)) * 100, 1) if (rev + ret_amt) > 0 else 0.0
        umbral = float(r.return_rate_max_pct or 5.0)
        items.append({"cadena": r.name, "return_rate_pct": pct,
                       "umbral": umbral, "excede": pct > umbral})
    items.sort(key=lambda x: -x["return_rate_pct"])
    return {"tool": "return_rate_cadena", "periodo": label,
            "items": items, "empty": len(items) == 0}


# ─── Finanzas restantes (3) ───────────────────────────────────────────

async def aging_cxc(db: AsyncSession, **k) -> Dict[str, Any]:
    """Aging explícito de CxC como su propia tool. Formato limpio para
    pregunta 'muéstrame el aging'."""
    r = await cxc_resumen(db)
    return {"tool": "aging_cxc", "total": r.get("total", 0),
            "buckets": r.get("buckets", {}),
            "empty": r.get("empty", True)}


async def dso_dpo(db: AsyncSession, **k) -> Dict[str, Any]:
    """DSO = CxC actual ÷ ventas diarias promedio (últimos 90d).
    DPO = CxP actual ÷ compras diarias promedio (últimos 90d)."""
    from app.modules.sales import models as sm
    from app.modules.finance.models import SupplierBill
    ahora = _now()
    cutoff = ahora - timedelta(days=90)

    ventas_stmt = select(
        func.coalesce(func.sum(sm.Order.total_amount), 0.0),
    ).where(
        sm.Order.kind == "order", sm.Order.status != "cancelled",
        sm.Order.created_at >= cutoff,
    )
    ventas_90 = _money((await db.execute(ventas_stmt)).scalar())
    compras_stmt = select(
        func.coalesce(func.sum(SupplierBill.total_amount), 0.0),
    ).where(
        SupplierBill.status != "cancelled",
        SupplierBill.issue_date >= cutoff,
    )
    compras_90 = _money((await db.execute(compras_stmt)).scalar())

    cxc_r = await cxc_resumen(db)
    cxp_r = await cxp_resumen(db)
    cxc_total = cxc_r.get("total", 0.0)
    cxp_total = cxp_r.get("total", 0.0)

    dso = round(cxc_total / (ventas_90 / 90), 1) if ventas_90 > 0 else None
    dpo = round(cxp_total / (compras_90 / 90), 1) if compras_90 > 0 else None
    return {"tool": "dso_dpo",
            "dso_dias": dso, "dpo_dias": dpo,
            "cxc": cxc_total, "cxp": cxp_total,
            "ventas_90d": ventas_90, "compras_90d": compras_90,
            "empty": dso is None and dpo is None}


async def pagos_programados(db: AsyncSession, **k) -> Dict[str, Any]:
    """Pagos programados pendientes ordenados por fecha."""
    from app.modules.finance.models import ScheduledPayment
    ahora = _now()
    stmt = (
        select(ScheduledPayment.kind, ScheduledPayment.target_name,
                ScheduledPayment.amount, ScheduledPayment.scheduled_date,
                ScheduledPayment.method)
        .where(ScheduledPayment.status == "pending",
                ScheduledPayment.scheduled_date >= ahora)
        .order_by(ScheduledPayment.scheduled_date.asc())
        .limit(15)
    )
    rows = (await db.execute(stmt)).all()
    items, total = [], 0.0
    for r in rows:
        items.append({
            "tipo": r.kind, "concepto": r.target_name or "?",
            "monto": _money(r.amount), "metodo": r.method or "?",
            "fecha": _aware(r.scheduled_date).strftime("%d/%m") if r.scheduled_date else "?",
        })
        total += _money(r.amount)
    return {"tool": "pagos_programados", "count": len(items),
            "total": _money(total), "items": items[:10],
            "empty": len(items) == 0}


# ─── RH extra (4) ─────────────────────────────────────────────────────

async def aguinaldo_devengado(db: AsyncSession, **k) -> Dict[str, Any]:
    """Aguinaldo devengado al día por empleado activo. LFT art. 87:
    mínimo 15 días de salario, se prorratea por días laborados desde
    el inicio del año en curso."""
    from app.modules.hr import models as hm
    hoy = date.today()
    inicio_anio = date(hoy.year, 1, 1)
    dias_transcurridos = (hoy - inicio_anio).days + 1
    factor = (15.0 / 365.0) * dias_transcurridos
    stmt = select(hm.Employee.id, hm.Employee.name, hm.Employee.last_name,
                   hm.Employee.base_salary, hm.Employee.pay_frequency,
                   hm.Employee.hire_date).where(
        hm.Employee.is_active == True,  # noqa: E712
    )
    rows = (await db.execute(stmt)).all()
    total = 0.0
    detalle = []
    for r in rows:
        # Estimar salario diario según frecuencia
        base = float(r.base_salary or 0)
        freq = (r.pay_frequency or "quincenal").lower()
        if freq == "mensual":
            diario = base / 30
        elif freq == "quincenal":
            diario = base / 15
        elif freq == "semanal":
            diario = base / 7
        else:
            diario = base / 15
        # Reducir factor si empleado se contrató este año
        hire = _parse_iso_date(r.hire_date)
        dias_empleado = dias_transcurridos
        if hire and hire > inicio_anio:
            dias_empleado = (hoy - hire).days + 1
        factor_emp = (15.0 / 365.0) * max(dias_empleado, 0)
        aguinaldo = round(diario * factor_emp, 2)
        total += aguinaldo
        detalle.append({
            "empleado": f"{r.name} {r.last_name}".strip(),
            "aguinaldo": aguinaldo,
        })
    detalle.sort(key=lambda x: -x["aguinaldo"])
    return {"tool": "aguinaldo_devengado",
            "empleados": len(detalle),
            "total": _money(total),
            "top": detalle[:5],
            "empty": len(detalle) == 0}


async def vacaciones_pendientes(db: AsyncSession, **k) -> Dict[str, Any]:
    """Días de vacaciones no gozados por empleado activo."""
    from app.modules.hr import models as hm
    stmt = select(
        hm.Employee.name, hm.Employee.last_name,
        hm.Employee.vacation_days, hm.Employee.vacation_used,
    ).where(hm.Employee.is_active == True)  # noqa: E712
    rows = (await db.execute(stmt)).all()
    items = []
    total_pendientes = 0
    for r in rows:
        pendientes = int((r.vacation_days or 0) - (r.vacation_used or 0))
        if pendientes <= 0:
            continue
        total_pendientes += pendientes
        items.append({
            "empleado": f"{r.name} {r.last_name}".strip(),
            "pendientes": pendientes,
        })
    items.sort(key=lambda x: -x["pendientes"])
    return {"tool": "vacaciones_pendientes",
            "empleados_con_saldo": len(items),
            "total_dias": total_pendientes,
            "top": items[:10],
            "empty": len(items) == 0}


async def imss_a_pagar(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Cuotas IMSS del periodo (empleado + patrón) desde los detalles de
    las nóminas pagadas. Acepta 'mes', 'mes_pasado' o 'mes:N' para un
    mes específico (ej. 'mes:7' = julio)."""
    from app.modules.hr import models as hm
    start, _, label = _period_bounds(periodo)
    prefix = start.strftime("%Y-%m")
    stmt = (
        select(
            func.coalesce(func.sum(hm.PayrollDetail.imss_employee), 0.0),
            func.coalesce(func.sum(hm.PayrollDetail.imss_employer), 0.0),
            func.coalesce(func.sum(hm.PayrollDetail.infonavit_employer), 0.0),
        )
        .join(hm.PayrollPeriod, hm.PayrollPeriod.id == hm.PayrollDetail.period_id)
        .where(hm.PayrollPeriod.payment_date.like(f"{prefix}%"))
    )
    obr, pat, inf = (await db.execute(stmt)).one()
    obr = _money(obr); pat = _money(pat); inf = _money(inf)
    return {"tool": "imss_a_pagar", "periodo": label,
            "obrero": obr, "patronal": pat,
            "infonavit_patronal": inf,
            "total": _money(obr + pat + inf),
            "empty": (obr + pat + inf) == 0}


async def ptu_estimado(db: AsyncSession, **k) -> Dict[str, Any]:
    """PTU más reciente calculada."""
    from app.modules.hr import models as hm
    stmt = (
        select(hm.PTUCalculation.period_year,
                hm.PTUCalculation.utilidad_repartible,
                hm.PTUCalculation.total_ptu_paid,
                hm.PTUCalculation.total_excluded,
                hm.PTUCalculation.status)
        .order_by(hm.PTUCalculation.period_year.desc())
        .limit(1)
    )
    r = (await db.execute(stmt)).first()
    if not r:
        return {"tool": "ptu_estimado", "empty": True,
                "reason": "no hay cálculo de PTU registrado"}
    return {"tool": "ptu_estimado",
            "anio": int(r.period_year),
            "utilidad_repartible": _money(r.utilidad_repartible),
            "ptu_pagado": _money(r.total_ptu_paid),
            "excluidos": int(r.total_excluded or 0),
            "status": r.status,
            "empty": False}


# ─── Contador · IVA (1) ───────────────────────────────────────────────

async def iva_mes(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """IVA del periodo en aproximación fiscal: acreditable = suma de
    tax_amount de facturas de proveedor emitidas y trasladado = 16%
    de las ventas (aproximación).
    Para cifra exacta al SAT usar módulo de contabilidad electrónica."""
    from app.modules.finance.models import SupplierBill
    from app.modules.sales import models as sm
    start, end, label = _period_bounds(periodo)

    acr_stmt = select(
        func.coalesce(func.sum(SupplierBill.tax_amount), 0.0),
    ).where(
        SupplierBill.status != "cancelled",
        SupplierBill.issue_date >= start,
        SupplierBill.issue_date < end,
    )
    acreditable = _money((await db.execute(acr_stmt)).scalar())

    ventas_stmt = select(
        func.coalesce(func.sum(sm.Order.total_amount), 0.0),
    ).where(
        sm.Order.kind == "order", sm.Order.status != "cancelled",
        sm.Order.created_at >= start, sm.Order.created_at < end,
    )
    ventas = _money((await db.execute(ventas_stmt)).scalar())
    # Aproximación: 16% del subtotal (ventas ÷ 1.16 × 0.16)
    trasladado = _money(ventas / 1.16 * 0.16) if ventas > 0 else 0.0
    saldo = _money(trasladado - acreditable)
    return {"tool": "iva_mes", "periodo": label,
            "trasladado": trasladado, "acreditable": acreditable,
            "saldo": saldo,
            "nota": "aproximación — cifra oficial en módulo de contabilidad electrónica",
            "empty": ventas == 0 and acreditable == 0}


# ─── Compras extra (3) ────────────────────────────────────────────────

async def lead_time_proveedor(db: AsyncSession, **k) -> Dict[str, Any]:
    """Lead time promedio configurado por proveedor activo."""
    from app.modules.inventory import models as im
    stmt = select(im.Supplier.name, im.Supplier.lead_time_days).where(
        im.Supplier.is_active == True,  # noqa: E712
        im.Supplier.lead_time_days.isnot(None),
    ).order_by(im.Supplier.lead_time_days.desc())
    rows = (await db.execute(stmt)).all()
    items = [{"name": r.name, "dias": int(r.lead_time_days or 0)} for r in rows]
    prom = round(sum(x["dias"] for x in items) / len(items), 1) if items else 0.0
    return {"tool": "lead_time_proveedor",
            "promedio_dias": prom,
            "count": len(items),
            "mas_lentos": items[:5],
            "empty": len(items) == 0}


async def reordenar_sin_oc(db: AsyncSession, **k) -> Dict[str, Any]:
    """SKUs bajo punto de reorden que NO tienen OC 'ordered' abierta —
    los que urge lanzar orden de compra."""
    from app.modules.inventory import models as im
    # variantes en stock <= reorder
    bajo_stmt = (
        select(
            im.ProductVariant.id, im.ProductVariant.sku,
            im.Product.name, im.StockLevel.quantity,
            im.ProductVariant.reorder_point,
        )
        .join(im.ProductVariant, im.ProductVariant.product_id == im.Product.id)
        .join(im.StockLevel, im.StockLevel.variant_id == im.ProductVariant.id)
        .where(
            im.Product.is_active == True,  # noqa: E712
            im.ProductVariant.is_active == True,  # noqa: E712
            im.ProductVariant.reorder_point.isnot(None),
            im.StockLevel.quantity <= im.ProductVariant.reorder_point,
        )
    )
    bajo = (await db.execute(bajo_stmt)).all()
    # variantes con OC ordered abierta
    oc_stmt = (
        select(im.PurchaseOrderItem.variant_id)
        .join(im.PurchaseOrder, im.PurchaseOrder.id == im.PurchaseOrderItem.purchase_order_id)
        .where(im.PurchaseOrder.status.in_(["draft", "ordered"]))
    )
    en_oc = {row[0] for row in (await db.execute(oc_stmt)).all()}
    items = [
        {"sku": r.sku, "name": r.name,
         "stock": int(r.quantity or 0),
         "reorder": int(r.reorder_point or 0)}
        for r in bajo if r.id not in en_oc
    ]
    return {"tool": "reordenar_sin_oc",
            "count": len(items), "items": items[:10],
            "empty": len(items) == 0}


async def variacion_costo(db: AsyncSession, **k) -> Dict[str, Any]:
    """Variación de costo unitario entre el último lote recibido y el
    anterior por SKU — detecta subidas fuertes de proveedor."""
    from app.modules.inventory import models as im
    ahora = _now()
    cutoff = ahora - timedelta(days=60)
    stmt = (
        select(im.ProductVariant.sku, im.Product.name,
                im.StockLot.unit_cost, im.StockLot.received_at)
        .join(im.ProductVariant, im.ProductVariant.id == im.StockLot.variant_id)
        .join(im.Product, im.Product.id == im.ProductVariant.product_id)
        .where(im.StockLot.received_at >= cutoff)
        .order_by(im.ProductVariant.id, im.StockLot.received_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    per_sku: dict[str, list] = {}
    for r in rows:
        per_sku.setdefault(r.sku, []).append(
            {"name": r.name, "cost": float(r.unit_cost or 0),
             "when": r.received_at},
        )
    cambios = []
    for sku, lotes in per_sku.items():
        if len(lotes) < 2:
            continue
        actual = lotes[0]["cost"]
        anterior = lotes[1]["cost"]
        if anterior <= 0:
            continue
        var = round(((actual - anterior) / anterior) * 100, 1)
        if abs(var) < 5:
            continue
        cambios.append({"sku": sku, "name": lotes[0]["name"],
                         "anterior": _money(anterior),
                         "actual": _money(actual),
                         "variacion_pct": var})
    cambios.sort(key=lambda x: -abs(x["variacion_pct"]))
    return {"tool": "variacion_costo", "count": len(cambios),
            "items": cambios[:10], "empty": len(cambios) == 0}


# ─── Inventario extra (2) ─────────────────────────────────────────────

async def top_valor_inmovilizado(db: AsyncSession, limite: int = 5, **k) -> Dict[str, Any]:
    """SKUs con más valor a costo en almacén (qty × cost_price)."""
    from app.modules.inventory import models as im
    stmt = (
        select(
            im.ProductVariant.sku, im.Product.name,
            func.sum(im.StockLevel.quantity).label("qty"),
            im.ProductVariant.cost_price,
        )
        .join(im.Product, im.Product.id == im.ProductVariant.product_id)
        .join(im.StockLevel, im.StockLevel.variant_id == im.ProductVariant.id)
        .where(
            im.ProductVariant.is_active == True,  # noqa: E712
            im.ProductVariant.cost_price.isnot(None),
            im.StockLevel.quantity > 0,
        )
        .group_by(im.ProductVariant.id, im.ProductVariant.sku,
                   im.Product.name, im.ProductVariant.cost_price)
        .order_by((func.sum(im.StockLevel.quantity) * im.ProductVariant.cost_price).desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{"sku": r.sku, "name": r.name,
              "unidades": int(r.qty or 0),
              "valor": _money((r.qty or 0) * (r.cost_price or 0))}
             for r in rows]
    return {"tool": "top_valor_inmovilizado",
            "items": items, "empty": len(items) == 0}


async def faltantes_para_pedidos(db: AsyncSession, **k) -> Dict[str, Any]:
    """SKUs con pedidos pending/partial cuya cantidad requerida excede
    el stock disponible."""
    from app.modules.sales import models as sm
    from app.modules.inventory import models as im
    # Requerido: suma de qty de OrderItems de pedidos abiertos
    req_stmt = (
        select(
            sm.OrderItem.variant_id, sm.OrderItem.sku, sm.OrderItem.product_name,
            func.sum(sm.OrderItem.quantity).label("req"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status.in_(["pending", "partial"]),
            sm.OrderItem.variant_id.isnot(None),
        )
        .group_by(sm.OrderItem.variant_id, sm.OrderItem.sku, sm.OrderItem.product_name)
    )
    req = {r.variant_id: {"sku": r.sku, "name": r.product_name,
                            "req": int(r.req or 0)}
           for r in (await db.execute(req_stmt)).all()}
    if not req:
        return {"tool": "faltantes_para_pedidos", "empty": True}
    stock_stmt = (
        select(im.StockLevel.variant_id,
                func.sum(im.StockLevel.quantity).label("stock"))
        .where(im.StockLevel.variant_id.in_(list(req.keys())))
        .group_by(im.StockLevel.variant_id)
    )
    stocks = {r.variant_id: int(r.stock or 0)
              for r in (await db.execute(stock_stmt)).all()}
    faltantes = []
    for vid, info in req.items():
        stock = stocks.get(vid, 0)
        faltan = info["req"] - stock
        if faltan > 0:
            faltantes.append({
                "sku": info["sku"], "name": info["name"],
                "requerido": info["req"], "stock": stock,
                "faltan": faltan,
            })
    faltantes.sort(key=lambda x: -x["faltan"])
    return {"tool": "faltantes_para_pedidos",
            "count": len(faltantes), "items": faltantes[:10],
            "empty": len(faltantes) == 0}


# ─── POS extra (4) ────────────────────────────────────────────────────

async def descuentos_pos_dia(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Suma de descuentos aplicados hoy en ventas del POS."""
    from app.modules.pos import models as pm
    from app.modules.sales import models as sm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(
            func.count(sm.Order.id),
            func.coalesce(func.sum(sm.Order.discount_amount), 0.0),
        )
        .join(pm.POSTransaction, pm.POSTransaction.order_id == sm.Order.id)
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
            sm.Order.discount_amount > 0,
        )
    )
    try:
        n, monto = (await db.execute(stmt)).one()
    except Exception:
        n, monto = 0, 0.0
    return {"tool": "descuentos_pos_dia",
            "fecha": today.strftime("%d/%m/%Y"),
            "tickets_con_descuento": int(n or 0),
            "monto_descontado": _money(monto),
            "empty": int(n or 0) == 0}


async def devoluciones_pos_dia(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Reembolsos del POS del día — POSTransaction type=refund."""
    from app.modules.pos import models as pm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(
            func.count(pm.POSTransaction.id),
            func.coalesce(func.sum(pm.POSTransaction.amount), 0.0),
        )
        .where(
            pm.POSTransaction.type == "refund",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
        )
    )
    n, monto = (await db.execute(stmt)).one()
    return {"tool": "devoluciones_pos_dia",
            "fecha": today.strftime("%d/%m/%Y"),
            "count": int(n or 0), "monto": _money(monto),
            "empty": int(n or 0) == 0}


async def cancelaciones_pos_dia(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Órdenes del canal POS canceladas hoy."""
    from app.modules.sales import models as sm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(
            func.count(sm.Order.id),
            func.coalesce(func.sum(sm.Order.total_amount), 0.0),
        )
        .where(
            sm.Order.status == "cancelled",
            sm.Order.updated_at >= today,
            sm.Order.updated_at < tomorrow,
        )
    )
    try:
        n, monto = (await db.execute(stmt)).one()
    except Exception:
        n, monto = 0, 0.0
    return {"tool": "cancelaciones_pos_dia",
            "fecha": today.strftime("%d/%m/%Y"),
            "count": int(n or 0), "monto": _money(monto),
            "empty": int(n or 0) == 0}


async def top_producto_pos_dia(db: AsyncSession, fecha: Optional[str] = None, **k) -> Dict[str, Any]:
    """Producto más vendido en el POS del día."""
    from app.modules.pos import models as pm
    from app.modules.sales import models as sm
    today = _now().replace(hour=0, minute=0, second=0, microsecond=0)
    if fecha:
        try:
            today = _aware(datetime.fromisoformat(fecha))
        except Exception:
            pass
    tomorrow = today + timedelta(days=1)
    stmt = (
        select(
            sm.OrderItem.product_name, sm.OrderItem.sku,
            func.sum(sm.OrderItem.quantity).label("qty"),
            func.sum(sm.OrderItem.subtotal).label("revenue"),
        )
        .join(sm.Order, sm.Order.id == sm.OrderItem.order_id)
        .join(pm.POSTransaction, pm.POSTransaction.order_id == sm.Order.id)
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= today,
            pm.POSTransaction.created_at < tomorrow,
        )
        .group_by(sm.OrderItem.product_name, sm.OrderItem.sku)
        .order_by(func.sum(sm.OrderItem.quantity).desc())
        .limit(5)
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        rows = []
    items = [{"name": r.product_name or "?", "sku": r.sku,
              "unidades": int(r.qty or 0), "revenue": _money(r.revenue)}
             for r in rows]
    return {"tool": "top_producto_pos_dia",
            "fecha": today.strftime("%d/%m/%Y"),
            "items": items, "empty": len(items) == 0}


# ══════════════════════════════════════════════════════════════════════
# FASE 8 · Nuevas tools por feedback de uso real
# ══════════════════════════════════════════════════════════════════════

async def top_vendedores(db: AsyncSession, periodo: str = "mes",
                          limite: int = 5, **k) -> Dict[str, Any]:
    """Top vendedores por revenue en el periodo (Order.user_id → User)."""
    from app.modules.sales import models as sm
    from app.modules.auth.models import User
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            User.id, User.full_name, User.email,
            func.count(sm.Order.id).label("pedidos"),
            func.coalesce(func.sum(sm.Order.total_amount), 0.0).label("revenue"),
        )
        .join(sm.Order, sm.Order.user_id == User.id)
        .where(
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
            sm.Order.created_at >= start,
            sm.Order.created_at < end,
        )
        .group_by(User.id, User.full_name, User.email)
        .order_by(func.coalesce(func.sum(sm.Order.total_amount), 0.0).desc())
        .limit(max(1, min(limite, 20)))
    )
    rows = (await db.execute(stmt)).all()
    items = [{"vendedor": r.full_name or r.email or "?",
              "pedidos": int(r.pedidos or 0),
              "revenue": _money(r.revenue)} for r in rows]
    return {"tool": "top_vendedores", "periodo": label,
            "items": items, "empty": len(items) == 0}


async def ventas_pos_periodo(db: AsyncSession, periodo: str = "mes", **k) -> Dict[str, Any]:
    """Total de ventas POS en un periodo — no solo hoy. Complementa a
    ventas_pos_dia para preguntas como 'cuánto se vendió en el POS en julio'."""
    from app.modules.pos import models as pm
    start, end, label = _period_bounds(periodo)
    stmt = (
        select(
            func.count(pm.POSTransaction.id),
            func.coalesce(func.sum(pm.POSTransaction.amount), 0.0),
        )
        .where(
            pm.POSTransaction.type == "sale",
            pm.POSTransaction.created_at >= start,
            pm.POSTransaction.created_at < end,
        )
    )
    n, total = (await db.execute(stmt)).one()
    n = int(n or 0)
    total = _money(total)
    ticket = round(total / n, 2) if n > 0 else 0.0
    return {"tool": "ventas_pos_periodo", "periodo": label,
            "tickets": n, "total": total, "ticket_promedio": ticket,
            "empty": n == 0}


async def ventas_persona(db: AsyncSession, nombre: str = "", **k) -> Dict[str, Any]:
    """Búsqueda unificada por nombre: revisa TANTO vendedores (User.full_name
    con Order.user_id) COMO clientes (Customer.name / razon_social). Devuelve
    lo que encuentre en cada rol — si Francisco es a la vez un vendedor y un
    cliente, aparecen ambas secciones."""
    from app.modules.sales import models as sm
    from app.modules.customers.models import Customer
    from app.modules.auth.models import User
    nombre = (nombre or "").strip()
    if len(nombre) < 2:
        return {"tool": "ventas_persona", "empty": True,
                "reason": ("no capté un nombre. Prueba con 'ventas de <nombre>' "
                            "o 'cómo va <nombre>' — funciona para vendedores y clientes.")}
    like = f"%{nombre}%"

    # ── Sección 1: como vendedor (User) ────────────────────────────
    vend_stmt = (
        select(
            User.id, User.full_name, User.email,
            func.count(sm.Order.id).label("pedidos"),
            func.coalesce(func.sum(sm.Order.total_amount), 0.0).label("total"),
            func.max(sm.Order.created_at).label("ultima"),
        )
        .join(sm.Order, sm.Order.user_id == User.id)
        .where(
            or_(User.full_name.ilike(like), User.email.ilike(like)),
            sm.Order.kind == "order",
            sm.Order.status != "cancelled",
        )
        .group_by(User.id, User.full_name, User.email)
        .order_by(func.coalesce(func.sum(sm.Order.total_amount), 0.0).desc())
        .limit(3)
    )
    vend_rows = (await db.execute(vend_stmt)).all()
    vendedores = [{
        "nombre": r.full_name or r.email or "?",
        "pedidos": int(r.pedidos or 0),
        "total_vendido": _money(r.total),
        "ultima_venta": _aware(r.ultima).strftime("%d/%m/%Y") if r.ultima else "sin ventas",
    } for r in vend_rows]

    # ── Sección 2: como cliente (Customer) ─────────────────────────
    cust_stmt = (
        select(Customer.id, Customer.name, Customer.razon_social)
        .where(or_(Customer.name.ilike(like), Customer.razon_social.ilike(like)))
        .limit(5)
    )
    matches = (await db.execute(cust_stmt)).all()
    clientes = []
    if matches:
        ids = [m.id for m in matches]
        agg_stmt = (
            select(
                Customer.id, Customer.name, Customer.razon_social,
                func.count(sm.Order.id).label("pedidos"),
                func.coalesce(func.sum(sm.Order.total_amount), 0.0).label("total"),
                func.coalesce(func.sum(sm.Order.total_amount - sm.Order.paid_amount), 0.0).label("saldo"),
                func.max(sm.Order.created_at).label("ultima"),
            )
            .join(sm.Order, sm.Order.customer_id == Customer.id, isouter=True)
            .where(Customer.id.in_(ids),
                    or_(sm.Order.kind.is_(None), sm.Order.kind == "order"),
                    or_(sm.Order.status.is_(None), sm.Order.status != "cancelled"))
            .group_by(Customer.id, Customer.name, Customer.razon_social)
            .order_by(func.coalesce(func.sum(sm.Order.total_amount), 0.0).desc())
        )
        for r in (await db.execute(agg_stmt)).all():
            clientes.append({
                "nombre": r.razon_social or r.name or "?",
                "pedidos": int(r.pedidos or 0),
                "total_comprado": _money(r.total),
                "saldo_pendiente": _money(r.saldo),
                "ultima_compra": _aware(r.ultima).strftime("%d/%m/%Y") if r.ultima else "sin compras",
            })

    empty = len(vendedores) == 0 and len(clientes) == 0
    return {
        "tool": "ventas_persona",
        "nombre_busqueda": nombre,
        "vendedores": vendedores,
        "clientes": clientes,
        "empty": empty,
        "reason": (f"no encontré vendedor ni cliente con nombre parecido a '{nombre}'"
                    if empty else None),
    }


# Alias retrocompatible: si algo llama a ventas_cliente, delega a ventas_persona.
async def ventas_cliente(db: AsyncSession, nombre: str = "", **k) -> Dict[str, Any]:
    r = await ventas_persona(db, nombre=nombre, **k)
    r["tool"] = "ventas_cliente"
    return r


# ══════════════════════════════════════════════════════════════════════
# Registro de tools disponibles — usado por el intent router y el LLM
# ══════════════════════════════════════════════════════════════════════

TOOLS_REGISTRY = {
    # Ventas / CRM
    "ventas_periodo": ventas_periodo,
    "top_productos": top_productos,
    "top_clientes": top_clientes,
    "pedidos_pendientes": pedidos_pendientes,
    "concentracion_clientes": concentracion_clientes,
    "cotizaciones_abiertas": cotizaciones_abiertas,
    "clientes_inactivos": clientes_inactivos,
    "ticket_promedio_ventas": ticket_promedio_ventas,
    "devoluciones_periodo": devoluciones_periodo,
    # Finanzas
    "cxc_resumen": cxc_resumen,
    "cxp_resumen": cxp_resumen,
    "top_deudores": top_deudores,
    "top_acreedores": top_acreedores,
    "saldo_bancos": saldo_bancos,
    "cxc_vencen_semana": cxc_vencen_semana,
    "cxp_vencen_semana": cxp_vencen_semana,
    "flujo_neto_30d": flujo_neto_30d,
    # Inventario
    "stock_critico": stock_critico,
    "caducidades_proximas": caducidades_proximas,
    "sin_movimiento": sin_movimiento,
    "rotacion_producto": rotacion_producto,
    "valor_inventario": valor_inventario,
    "merma_mes": merma_mes,
    # Compras
    "oc_abiertas": oc_abiertas,
    "oc_atrasadas": oc_atrasadas,
    "top_proveedores": top_proveedores,
    # Contabilidad
    "utilidad_bruta": utilidad_bruta,
    "ingresos_vs_egresos": ingresos_vs_egresos,
    "gastos_por_categoria": gastos_por_categoria,
    "movimientos_no_conciliados": movimientos_no_conciliados,
    # RH
    "nomina_periodo": nomina_periodo,
    "empleados_activos": empleados_activos,
    "incapacidades_mes": incapacidades_mes,
    "contratos_por_vencer": contratos_por_vencer,
    "cumpleanos_mes": cumpleanos_mes,
    "isr_nomina_mes": isr_nomina_mes,
    # POS
    "ventas_pos_dia": ventas_pos_dia,
    "ventas_pos_hora": ventas_pos_hora,
    "corte_caja_actual": corte_caja_actual,
    "formas_pago_pos": formas_pago_pos,
    "top_cajeros_dia": top_cajeros_dia,
    # Retail
    "desempeno_cadena": desempeno_cadena,
    "desempeno_tienda": desempeno_tienda,
    "sell_through_por_tienda": sell_through_por_tienda,
    # KPI ejecutivo
    "flujo_efectivo_proyectado": flujo_efectivo_proyectado,
    "nomina_vs_ventas": nomina_vs_ventas,
    # Fase 6 · Retail avanzado
    "tiendas_wos_critico": tiendas_wos_critico,
    "tiendas_sobrestock": tiendas_sobrestock,
    "fill_rate_cadena": fill_rate_cadena,
    "return_rate_cadena": return_rate_cadena,
    # Fase 6 · Finanzas
    "aging_cxc": aging_cxc,
    "dso_dpo": dso_dpo,
    "pagos_programados": pagos_programados,
    # Fase 6 · RH extra
    "aguinaldo_devengado": aguinaldo_devengado,
    "vacaciones_pendientes": vacaciones_pendientes,
    "imss_a_pagar": imss_a_pagar,
    "ptu_estimado": ptu_estimado,
    # Fase 6 · Contabilidad
    "iva_mes": iva_mes,
    # Fase 6 · Compras
    "lead_time_proveedor": lead_time_proveedor,
    "reordenar_sin_oc": reordenar_sin_oc,
    "variacion_costo": variacion_costo,
    # Fase 6 · Inventario
    "top_valor_inmovilizado": top_valor_inmovilizado,
    "faltantes_para_pedidos": faltantes_para_pedidos,
    # Fase 6 · POS extra
    "descuentos_pos_dia": descuentos_pos_dia,
    "devoluciones_pos_dia": devoluciones_pos_dia,
    "cancelaciones_pos_dia": cancelaciones_pos_dia,
    "top_producto_pos_dia": top_producto_pos_dia,
    # Fase 8 · Feedback de uso real
    "top_vendedores": top_vendedores,
    "ventas_pos_periodo": ventas_pos_periodo,
    "ventas_cliente": ventas_cliente,
    # Fase 9 · Búsqueda unificada vendedor + cliente por nombre
    "ventas_persona": ventas_persona,
}
