"""BI / Reportes gerenciales.

Endpoints agregados que consolidan datos de múltiples módulos para dashboards
ejecutivos. Optimizados para renderizar toda la vista con 1-2 llamadas.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from calendar import monthrange

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, and_

from app.api import deps
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


def _month_bounds(dt: datetime) -> tuple[datetime, datetime]:
    start = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    _, last = monthrange(dt.year, dt.month)
    end = start.replace(day=last, hour=23, minute=59, second=59)
    return start, end


def _day_bounds(dt: datetime) -> tuple[datetime, datetime]:
    start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    end = dt.replace(hour=23, minute=59, second=59)
    return start, end


@router.get("/executive-summary")
async def executive_summary(db: DB, _: CurrentUser):
    """Resumen consolidado para el Dashboard Ejecutivo.

    Agrega en una sola llamada:
      - Ventas hoy, semana, mes, tendencia vs mes anterior
      - Utilidad estimada (con COGS real FIFO)
      - Cartera vencida / al corriente
      - CxP vencida / próxima
      - Cash disponible (bancos + caja)
      - Alertas críticas y de advertencia
      - Top productos, top clientes del mes
      - Stock crítico y agotados
    """
    from app.modules.sales import models as sales_models
    from app.modules.inventory import service as inv_service
    from app.modules.finance import service as fin_service
    from app.modules.notifications import service as notif_service

    now = datetime.now(timezone.utc)
    day_start, day_end = _day_bounds(now)
    month_start, month_end = _month_bounds(now)
    # Mes anterior para comparativo
    prev_month_end = month_start - timedelta(seconds=1)
    prev_month_start, _ = _month_bounds(prev_month_end)
    # Últimos 7 días para tendencia
    week_start = now - timedelta(days=7)

    O = sales_models.Order
    OI = sales_models.OrderItem
    P = sales_models.Payment

    async def _sum_sales(start: datetime, end: datetime) -> dict:
        res = await db.execute(
            select(
                func.coalesce(func.sum(O.total_amount), 0.0),
                func.count(O.id),
            )
            .where(
                O.kind == "order",
                O.status.notin_(["cancelled", "draft"]),
                O.created_at >= start, O.created_at <= end,
            )
        )
        total, count = res.one()
        return {"total": float(total or 0.0), "count": int(count or 0)}

    async def _sum_cogs(start: datetime, end: datetime) -> float:
        res = await db.execute(
            select(func.coalesce(func.sum(OI.quantity * OI.unit_cost), 0.0))
            .join(O, OI.order_id == O.id)
            .where(
                O.kind == "order",
                O.status.notin_(["cancelled", "draft"]),
                O.created_at >= start, O.created_at <= end,
            )
        )
        return float(res.scalar() or 0.0)

    async def _sum_paid(start: datetime, end: datetime) -> float:
        res = await db.execute(
            select(func.coalesce(func.sum(P.amount), 0.0))
            .where(P.created_at >= start, P.created_at <= end)
        )
        return float(res.scalar() or 0.0)

    sales_today = await _sum_sales(day_start, day_end)
    sales_month = await _sum_sales(month_start, month_end)
    sales_prev_month = await _sum_sales(prev_month_start, prev_month_end)
    sales_week = await _sum_sales(week_start, now)

    cogs_month = await _sum_cogs(month_start, month_end)
    paid_today = await _sum_paid(day_start, day_end)
    paid_month = await _sum_paid(month_start, month_end)

    gross_margin_month = sales_month["total"] - cogs_month
    margin_pct = (gross_margin_month / sales_month["total"] * 100) if sales_month["total"] > 0 else 0.0
    sales_delta = (
        (sales_month["total"] - sales_prev_month["total"]) / sales_prev_month["total"] * 100
        if sales_prev_month["total"] > 0 else 0.0
    )

    # ── Cartera ──────────────────────────────────
    cxc_items = await fin_service.get_cxc(db)
    cxp_items = await fin_service.get_cxp(db)
    cxc_total = sum(float(i.balance or 0.0) for i in cxc_items)
    cxc_overdue = sum(float(i.balance or 0.0) for i in cxc_items if i.status == "overdue")
    cxp_total = sum(float(i.balance or 0.0) for i in cxp_items)
    cxp_overdue = sum(float(i.balance or 0.0) for i in cxp_items if i.status == "overdue")

    # ── Cash disponible (bancos + caja) ─────────
    try:
        from app.modules.finance import models as fin_models
        res_bank = await db.execute(
            select(func.coalesce(func.sum(fin_models.BankAccount.current_balance), 0.0))
        )
        cash_available = float(res_bank.scalar() or 0.0)
    except Exception:
        cash_available = 0.0

    # ── Alertas ──────────────────────────────────
    digest = await notif_service.build_digest(db)

    # ── Top productos y clientes del mes ─────────
    res_top_prods = await db.execute(
        select(
            OI.product_name,
            func.sum(OI.quantity).label("qty"),
            func.sum(OI.total).label("total"),
        )
        .join(O, OI.order_id == O.id)
        .where(
            O.kind == "order",
            O.status.notin_(["cancelled", "draft"]),
            O.created_at >= month_start, O.created_at <= month_end,
        )
        .group_by(OI.product_name)
        .order_by(func.sum(OI.total).desc())
        .limit(5)
    )
    top_products = [
        {"name": r.product_name or "SKU", "quantity": int(r.qty or 0), "total": float(r.total or 0.0)}
        for r in res_top_prods.all()
    ]

    from app.modules.customers import models as cust_models
    C = cust_models.Customer
    res_top_cust = await db.execute(
        select(C.name, func.sum(O.total_amount).label("total"), func.count(O.id).label("orders"))
        .join(O, O.customer_id == C.id)
        .where(
            O.kind == "order",
            O.status.notin_(["cancelled", "draft"]),
            O.created_at >= month_start, O.created_at <= month_end,
        )
        .group_by(C.id, C.name)
        .order_by(func.sum(O.total_amount).desc())
        .limit(5)
    )
    top_customers = [
        {"name": r.name, "total": float(r.total or 0.0), "orders": int(r.orders or 0)}
        for r in res_top_cust.all()
    ]

    # ── Stock crítico ────────────────────────────
    try:
        reorder_alerts = await inv_service.get_reorder_alerts(db)
        stock_critical = sum(1 for a in reorder_alerts if a.available <= 0)
        stock_low = sum(1 for a in reorder_alerts if 0 < a.available <= (a.reorder_point or 0))
    except Exception:
        stock_critical = 0
        stock_low = 0

    # ── Tendencia diaria (últimos 14 días) ──────
    daily = []
    for i in range(13, -1, -1):
        d = (now - timedelta(days=i))
        ds, de = _day_bounds(d)
        row = await _sum_sales(ds, de)
        daily.append({"date": d.strftime("%Y-%m-%d"), "total": row["total"], "count": row["count"]})

    return {
        "generated_at": now.isoformat(),
        "sales": {
            "today": sales_today,
            "week": sales_week,
            "month": sales_month,
            "prev_month": sales_prev_month,
            "delta_pct": round(sales_delta, 1),
            "cogs_month": round(cogs_month, 2),
            "gross_margin_month": round(gross_margin_month, 2),
            "margin_pct": round(margin_pct, 1),
            "paid_today": round(paid_today, 2),
            "paid_month": round(paid_month, 2),
            "daily_trend": daily,
        },
        "receivables": {
            "total": round(cxc_total, 2),
            "overdue": round(cxc_overdue, 2),
            "overdue_pct": round(cxc_overdue / cxc_total * 100, 1) if cxc_total > 0 else 0.0,
            "count": len(cxc_items),
        },
        "payables": {
            "total": round(cxp_total, 2),
            "overdue": round(cxp_overdue, 2),
            "overdue_pct": round(cxp_overdue / cxp_total * 100, 1) if cxp_total > 0 else 0.0,
            "count": len(cxp_items),
        },
        "cash_available": round(cash_available, 2),
        "alerts": {
            "critical": digest.critical,
            "warning": digest.warning,
            "info": digest.info,
            "total": digest.total,
            "by_category": digest.by_category,
            "top": [n.model_dump() for n in digest.items[:8]],
        },
        "top_products": top_products,
        "top_customers": top_customers,
        "inventory": {
            "out_of_stock": stock_critical,
            "low_stock": stock_low,
        },
    }
