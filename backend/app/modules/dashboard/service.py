"""Servicio del Dashboard Ejecutivo.

Agrega KPIs de sales, finance, forecast, retail, inventory sin duplicar
lógica. Nunca inventa datos: si un dato no está capturado, devuelve None
o marca available=False. Nunca crea tablas nuevas.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.customers import models as cust_models
from app.modules.finance import models as fin_models
from app.modules.inventory import models as inv_models
from app.modules.sales import models as sales_models

from . import schemas

log = get_logger(__name__)


# ── Catálogo de estados MX (para mapa + top 5) ──────────────────────────
# Coordenadas aproximadas (centroides) usadas por el frontend para posicionar
# los puntos en el mapa SVG. Se devuelven junto con las ventas para no
# hardcodear en el frontend.
MX_STATES: Dict[str, Dict[str, str]] = {
    "AGS": {"name": "Aguascalientes", "aliases": "aguascalientes"},
    "BC":  {"name": "Baja California", "aliases": "baja california|bc"},
    "BCS": {"name": "Baja California Sur", "aliases": "baja california sur|bcs"},
    "CAM": {"name": "Campeche", "aliases": "campeche"},
    "CHIS": {"name": "Chiapas", "aliases": "chiapas"},
    "CHIH": {"name": "Chihuahua", "aliases": "chihuahua"},
    "CDMX": {"name": "Ciudad de México",
              "aliases": "ciudad de mexico|cdmx|df|distrito federal|mexico city"},
    "COAH": {"name": "Coahuila", "aliases": "coahuila"},
    "COL": {"name": "Colima", "aliases": "colima"},
    "DGO": {"name": "Durango", "aliases": "durango"},
    "GTO": {"name": "Guanajuato", "aliases": "guanajuato"},
    "GRO": {"name": "Guerrero", "aliases": "guerrero"},
    "HGO": {"name": "Hidalgo", "aliases": "hidalgo"},
    "JAL": {"name": "Jalisco", "aliases": "jalisco"},
    "MEX": {"name": "Estado de México",
             "aliases": "estado de mexico|mexico|edomex|edo mex|edo. mex"},
    "MICH": {"name": "Michoacán", "aliases": "michoacan|michoacán"},
    "MOR": {"name": "Morelos", "aliases": "morelos"},
    "NAY": {"name": "Nayarit", "aliases": "nayarit"},
    "NL":  {"name": "Nuevo León", "aliases": "nuevo leon|nuevo león|nl"},
    "OAX": {"name": "Oaxaca", "aliases": "oaxaca"},
    "PUE": {"name": "Puebla", "aliases": "puebla"},
    "QRO": {"name": "Querétaro", "aliases": "queretaro|querétaro|qro"},
    "QROO": {"name": "Quintana Roo", "aliases": "quintana roo|qroo"},
    "SLP": {"name": "San Luis Potosí", "aliases": "san luis potosi|slp"},
    "SIN": {"name": "Sinaloa", "aliases": "sinaloa"},
    "SON": {"name": "Sonora", "aliases": "sonora"},
    "TAB": {"name": "Tabasco", "aliases": "tabasco"},
    "TAM": {"name": "Tamaulipas", "aliases": "tamaulipas"},
    "TLAX": {"name": "Tlaxcala", "aliases": "tlaxcala"},
    "VER": {"name": "Veracruz", "aliases": "veracruz"},
    "YUC": {"name": "Yucatán", "aliases": "yucatan|yucatán"},
    "ZAC": {"name": "Zacatecas", "aliases": "zacatecas"},
}


def _resolve_state_code(raw: Optional[str]) -> Optional[str]:
    """Normaliza un texto libre (ej. 'CDMX', 'Distrito Federal') a code.
    Match exacto contra código o alias.
    """
    if not raw:
        return None
    r = raw.strip().lower()
    if not r:
        return None
    for code, meta in MX_STATES.items():
        if r == code.lower():
            return code
        for alias in meta["aliases"].split("|"):
            if r == alias.strip():
                return code
    return None


# Índice pre-computado (alias -> code), ordenado por longitud descendente
# para que "ciudad de mexico" gane sobre "mexico".
_STATE_MATCH_TABLE: List[Tuple[str, str]] = []


def _build_state_match_table() -> List[Tuple[str, str]]:
    if _STATE_MATCH_TABLE:
        return _STATE_MATCH_TABLE
    entries: List[Tuple[str, str]] = []
    for code, meta in MX_STATES.items():
        entries.append((meta["name"].lower(), code))
        for alias in meta["aliases"].split("|"):
            a = alias.strip().lower()
            if len(a) >= 4:  # evita 'df', 'nl', 'bc' que dan falsos positivos
                entries.append((a, code))
    entries.sort(key=lambda x: -len(x[0]))
    _STATE_MATCH_TABLE.extend(entries)
    return _STATE_MATCH_TABLE


def _find_state_in_text(text: Optional[str]) -> Optional[str]:
    """Busca cualquier nombre/alias de estado dentro de un texto libre.
    Usa palabra completa (\\b) para evitar 'nuevo' matcheando 'nuevos'.
    """
    if not text:
        return None
    t = text.strip().lower()
    if not t:
        return None
    for alias, code in _build_state_match_table():
        if re.search(rf"\b{re.escape(alias)}\b", t):
            return code
    return None


def _resolve_customer_state(cust: Any) -> Optional[str]:
    """Solo campos geográficos reales: estado, municipio, localidad.

    NUNCA se busca en `calle`, `colonia` ni `address` libre — muchas
    calles y colonias mexicanas llevan nombre de estado o de héroe
    (Hidalgo, Juárez, Morelos, etc.) y darían falsos positivos.
    """
    code = _resolve_state_code(getattr(cust, "estado", None))
    if code:
        return code
    for field in ("municipio", "localidad"):
        code = _find_state_in_text(getattr(cust, field, None))
        if code:
            return code
    return None


def _month_bounds(d: date) -> Tuple[date, date]:
    first = d.replace(day=1)
    last_day = calendar.monthrange(d.year, d.month)[1]
    last = d.replace(day=last_day)
    return first, last


def _format_money(n: float) -> str:
    if abs(n) >= 1_000_000:
        return f"${n/1_000_000:.2f}M"
    if abs(n) >= 1_000:
        return f"${n/1_000:.1f}K"
    return f"${n:,.2f}"


def _pct_change(cur: float, prev: float) -> Optional[float]:
    if prev == 0:
        return None if cur == 0 else 100.0
    return round((cur - prev) / abs(prev) * 100.0, 1)


# ── Consultas atómicas ──────────────────────────────────────────────────

async def _sales_totals(
    db: AsyncSession, start: date, end: date,
) -> Tuple[float, int, float]:
    """Regresa (revenue, orders_count, cogs) del rango. Solo órdenes
    reales (kind=order) no canceladas."""
    q = (
        select(
            func.coalesce(func.sum(sales_models.Order.total_amount), 0.0).label("rev"),
            func.count(sales_models.Order.id).label("cnt"),
        )
        .where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
    )
    row = (await db.execute(q)).one()
    rev = float(row.rev or 0.0)
    cnt = int(row.cnt or 0)

    # COGS = suma de (qty × cost_price) del ProductVariant
    cogs_q = (
        select(
            func.coalesce(func.sum(
                sales_models.OrderItem.quantity
                * func.coalesce(inv_models.ProductVariant.cost_price, 0.0)
            ), 0.0)
        )
        .join(sales_models.Order, sales_models.OrderItem.order_id == sales_models.Order.id)
        .outerjoin(inv_models.ProductVariant,
                    sales_models.OrderItem.variant_id == inv_models.ProductVariant.id)
        .where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
    )
    cogs = float((await db.execute(cogs_q)).scalar() or 0.0)
    return rev, cnt, cogs


async def _forecast_month_target(
    db: AsyncSession, target_date: date,
) -> float:
    """Meta del mes completo (sum mN × unit_price del año)."""
    try:
        from app.modules.forecast import models as fc_models
    except Exception:
        return 0.0
    month_col = getattr(fc_models.ForecastLine, f"m{target_date.month}", None)
    if month_col is None:
        return 0.0
    try:
        q = (
            select(func.coalesce(
                func.sum(month_col * fc_models.ForecastLine.unit_price), 0.0
            ))
            .join(fc_models.ForecastPlan,
                  fc_models.ForecastLine.plan_id == fc_models.ForecastPlan.id)
            .where(fc_models.ForecastPlan.year == target_date.year)
        )
        return float((await db.execute(q)).scalar() or 0.0)
    except Exception as e:
        log.info("forecast target unavailable: %s", e)
        return 0.0


async def _forecast_period_target(
    db: AsyncSession, start: date, end: date,
) -> float:
    """Meta prorateada al periodo: para cada mes que toque el rango,
    suma (forecast_mes × días_del_periodo_en_ese_mes / días_del_mes).
    Así el KPI corresponde al periodo seleccionado (7d/30d/90d/1año).
    """
    total = 0.0
    cur = start
    while cur <= end:
        m_first = cur.replace(day=1)
        _, m_last = _month_bounds(cur)
        seg_start = max(cur, m_first)
        seg_end = min(end, m_last)
        seg_days = (seg_end - seg_start).days + 1
        month_days = (m_last - m_first).days + 1
        month_target = await _forecast_month_target(db, cur)
        if month_target > 0 and month_days > 0:
            total += month_target * (seg_days / month_days)
        cur = m_last + timedelta(days=1)
    return total


async def _daily_sales_series(
    db: AsyncSession, start: date, end: date,
) -> Dict[date, Tuple[float, int]]:
    """Serie diaria de ventas del rango. Retorna {fecha: (revenue, count)}."""
    q = (
        select(
            func.date(sales_models.Order.created_at).label("d"),
            func.coalesce(func.sum(sales_models.Order.total_amount), 0.0).label("rev"),
            func.count(sales_models.Order.id).label("cnt"),
        )
        .where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
        .group_by("d")
    )
    return {r.d: (float(r.rev or 0.0), int(r.cnt or 0)) for r in (await db.execute(q)).all()}


async def _daily_expenses(
    db: AsyncSession, start: date, end: date,
) -> Dict[date, float]:
    """Serie diaria de gastos del rango (finance.transactions type=expense)."""
    try:
        q = (
            select(
                func.date(fin_models.Transaction.created_at).label("d"),
                func.coalesce(func.sum(fin_models.Transaction.amount), 0.0).label("v"),
            )
            .where(
                fin_models.Transaction.type == "expense",
                func.date(fin_models.Transaction.created_at) >= start,
                func.date(fin_models.Transaction.created_at) <= end,
            )
            .group_by("d")
        )
        return {r.d: float(r.v or 0.0) for r in (await db.execute(q)).all()}
    except Exception as e:
        log.info("expenses unavailable: %s", e)
        return {}


async def _top_customers(
    db: AsyncSession, start: date, end: date, limit: int = 5,
) -> List[Tuple[Optional[int], str, float, int]]:
    q = (
        select(
            sales_models.Order.customer_id,
            cust_models.Customer.name.label("name"),
            func.coalesce(func.sum(sales_models.Order.total_amount), 0.0).label("total"),
            func.count(sales_models.Order.id).label("cnt"),
        )
        .outerjoin(cust_models.Customer,
                    sales_models.Order.customer_id == cust_models.Customer.id)
        .where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
        .group_by(sales_models.Order.customer_id, cust_models.Customer.name)
        .order_by(func.sum(sales_models.Order.total_amount).desc())
        .limit(limit)
    )
    return [
        (r.customer_id,
         r.name or (f"Cliente #{r.customer_id}" if r.customer_id else "Venta sin cliente"),
         float(r.total or 0.0), int(r.cnt or 0))
        for r in (await db.execute(q)).all()
    ]


async def _geographic_sales(
    db: AsyncSession, start: date, end: date,
) -> schemas.GeoResponse:
    """Agrupa ventas por estado usando las fuentes reales:

    1. **Sell-out de retail** (fuente principal): SellOutReport × RetailStore.state.
       Cada tienda física de cadena tiene su estado capturado y los reportes
       de sell-out traen revenue/units por tienda.
    2. **Ventas directas** (suplemento): Order × Customer.estado.
       Para pedidos B2B / mayoreo / etc. que no pasan por retail.

    Se combinan sumando por state_code. Nunca se inventa ubicación.
    """
    by_state: Dict[str, Dict[str, float]] = {}

    # 1) Sell-out de retail — la fuente autoritativa por tienda física
    try:
        from app.modules.retail import models as retail_models
        q = (
            select(
                retail_models.RetailStore.state.label("st"),
                func.coalesce(func.sum(retail_models.SellOutReport.revenue), 0.0).label("rev"),
                func.coalesce(func.sum(retail_models.SellOutReport.units_sold), 0).label("units"),
                func.count(func.distinct(retail_models.SellOutReport.id)).label("rows"),
            )
            .join(
                retail_models.RetailStore,
                retail_models.SellOutReport.store_id == retail_models.RetailStore.id,
            )
            .where(
                # overlap: reporte cae dentro (o cruza) el rango solicitado
                func.date(retail_models.SellOutReport.period_start) <= end,
                func.date(retail_models.SellOutReport.period_end) >= start,
                retail_models.RetailStore.state.is_not(None),
            )
            .group_by(retail_models.RetailStore.state)
        )
        for r in (await db.execute(q)).all():
            code = _resolve_state_code(r.st)
            if code is None:
                continue
            bucket = by_state.setdefault(
                code, {"revenue": 0.0, "units": 0, "orders_count": 0},
            )
            bucket["revenue"] += float(r.rev or 0.0)
            bucket["units"] += int(r.units or 0)
            bucket["orders_count"] += int(r.rows or 0)
    except Exception as e:
        log.info("geo sell-out skipped: %s", e)

    # 2) Ventas directas (Orders): agregamos por customer_id y luego
    # resolvemos su estado con TODAS las columnas de dirección disponibles
    # (estado, municipio, localidad, colonia, calle, address libre).
    try:
        rev_q = (
            select(
                sales_models.Order.customer_id.label("cid"),
                func.coalesce(func.sum(sales_models.Order.total_amount), 0.0).label("rev"),
                func.count(func.distinct(sales_models.Order.id)).label("orders"),
            )
            .where(
                sales_models.Order.kind == "order",
                sales_models.Order.status != "cancelled",
                func.date(sales_models.Order.created_at) >= start,
                func.date(sales_models.Order.created_at) <= end,
                sales_models.Order.customer_id.is_not(None),
            )
            .group_by(sales_models.Order.customer_id)
        )
        rev_by_cust = {
            int(r.cid): (float(r.rev or 0.0), int(r.orders or 0))
            for r in (await db.execute(rev_q)).all()
        }

        units_q = (
            select(
                sales_models.Order.customer_id.label("cid"),
                func.coalesce(func.sum(sales_models.OrderItem.quantity), 0).label("units"),
            )
            .join(
                sales_models.OrderItem,
                sales_models.OrderItem.order_id == sales_models.Order.id,
            )
            .where(
                sales_models.Order.kind == "order",
                sales_models.Order.status != "cancelled",
                func.date(sales_models.Order.created_at) >= start,
                func.date(sales_models.Order.created_at) <= end,
                sales_models.Order.customer_id.is_not(None),
            )
            .group_by(sales_models.Order.customer_id)
        )
        units_by_cust = {
            int(r.cid): int(r.units or 0)
            for r in (await db.execute(units_q)).all()
        }

        if rev_by_cust:
            cust_q = (
                select(
                    cust_models.Customer.id,
                    cust_models.Customer.estado,
                    cust_models.Customer.municipio,
                    cust_models.Customer.localidad,
                )
                .where(cust_models.Customer.id.in_(list(rev_by_cust.keys())))
            )
            for c in (await db.execute(cust_q)).all():
                code = _resolve_customer_state(c)
                if code is None:
                    continue
                rev, orders = rev_by_cust.get(int(c.id), (0.0, 0))
                units = units_by_cust.get(int(c.id), 0)
                bucket = by_state.setdefault(
                    code, {"revenue": 0.0, "units": 0, "orders_count": 0},
                )
                bucket["revenue"] += rev
                bucket["units"] += units
                bucket["orders_count"] += orders
    except Exception as e:
        log.info("geo direct sales skipped: %s", e)

    total_rev = sum(v["revenue"] for v in by_state.values())
    total_units = sum(v["units"] for v in by_state.values())

    rows = [
        schemas.GeoStateRow(
            state_code=code, state_name=MX_STATES[code]["name"],
            revenue=round(v["revenue"], 2),
            units=int(v["units"]),
            orders_count=int(v["orders_count"]),
            share_pct=round(v["revenue"] / total_rev * 100.0, 2) if total_rev > 0 else 0.0,
        )
        for code, v in by_state.items()
    ]
    rows.sort(key=lambda x: -x.revenue)
    return schemas.GeoResponse(
        total_revenue=round(total_rev, 2), total_units=total_units,
        by_state=rows, top5=rows[:5],
    )


async def _channel_sales(
    db: AsyncSession, start: date, end: date,
) -> schemas.ChannelSalesResponse:
    q = (
        select(
            func.coalesce(sales_models.Order.channel, "otro").label("ch"),
            func.coalesce(func.sum(sales_models.Order.total_amount), 0.0).label("rev"),
            func.count(sales_models.Order.id).label("cnt"),
        )
        .where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
        .group_by("ch")
    )
    rows = (await db.execute(q)).all()
    total = sum(float(r.rev or 0.0) for r in rows)
    labels = {
        "mostrador": "POS Mostrador", "pos": "POS", "web": "Web",
        "telefono": "Teléfono", "whatsapp": "WhatsApp",
        "retail": "Retail cadenas", "otro": "Otro",
    }
    channels = [
        schemas.ChannelSalesRow(
            channel=(r.ch or "otro").lower(),
            label=labels.get((r.ch or "otro").lower(), (r.ch or "Otro").title()),
            revenue=round(float(r.rev or 0.0), 2),
            orders=int(r.cnt or 0),
            share_pct=round(float(r.rev or 0.0) / total * 100, 2) if total > 0 else 0.0,
        )
        for r in rows
    ]
    channels.sort(key=lambda c: -c.revenue)
    return schemas.ChannelSalesResponse(
        total_revenue=round(total, 2), channels=channels,
    )


async def _alerts_top5(db: AsyncSession) -> List[schemas.AlertRow]:
    """Combina alertas de retail (si existen) + cartera vencida de finance
    + stock bajo de inventory. Solo trae 5 en total."""
    out: List[schemas.AlertRow] = []

    # 1) Cartera pendiente por cobrar (finance): órdenes con saldo > 0 y vencidas
    try:
        now = datetime.now(timezone.utc)
        q = (
            select(sales_models.Order, cust_models.Customer.name)
            .outerjoin(cust_models.Customer,
                        sales_models.Order.customer_id == cust_models.Customer.id)
            .where(
                sales_models.Order.kind == "order",
                sales_models.Order.status.in_(("pending", "partial", "delivered")),
            )
            .order_by(sales_models.Order.created_at.desc())
            .limit(20)
        )
        for o, cust_name in (await db.execute(q)).all():
            paid = getattr(o, "paid_amount", None) or 0.0
            total = float(o.total_amount or 0.0)
            balance = total - float(paid)
            if balance <= 0:
                continue
            out.append(schemas.AlertRow(
                severity="high", label="CARTERA",
                module="finance",
                title=f"Saldo pendiente {_format_money(balance)}",
                subtitle=f"{cust_name or 'Sin cliente'} · {o.folio or f'#{o.id}'}",
                reference=str(o.id),
                created_at=o.created_at,
            ))
            if len(out) >= 3:
                break
    except Exception as e:
        log.info("alerts finance skipped: %s", e)

    # 2) Alertas de retail (si tabla existe)
    try:
        from app.modules.retail import models as retail_models
        q = (
            select(retail_models.RetailAlert)
            .where(retail_models.RetailAlert.status == "open")
            .order_by(retail_models.RetailAlert.created_at.desc())
            .limit(5)
        )
        for a in (await db.execute(q)).scalars().all():
            if len(out) >= 5:
                break
            out.append(schemas.AlertRow(
                severity=a.severity or "medium",
                label="RETAIL",
                module="retail",
                title=a.message[:80] if a.message else "Alerta retail",
                subtitle=a.alert_type,
                reference=str(a.id),
                created_at=a.created_at,
            ))
    except Exception as e:
        log.info("alerts retail skipped: %s", e)

    # 3) Stock bajo (inventario) — variantes bajo reorder_point
    try:
        if len(out) < 5:
            q = (
                select(
                    inv_models.ProductVariant.id,
                    inv_models.ProductVariant.sku,
                    func.coalesce(func.sum(inv_models.StockLevel.quantity), 0).label("qty"),
                    inv_models.ProductVariant.reorder_point,
                )
                .outerjoin(inv_models.StockLevel,
                            inv_models.StockLevel.variant_id == inv_models.ProductVariant.id)
                .where(
                    inv_models.ProductVariant.is_active.is_(True),
                    inv_models.ProductVariant.reorder_point.is_not(None),
                )
                .group_by(inv_models.ProductVariant.id, inv_models.ProductVariant.sku,
                            inv_models.ProductVariant.reorder_point)
                .having(func.coalesce(func.sum(inv_models.StockLevel.quantity), 0)
                        <= inv_models.ProductVariant.reorder_point)
                .limit(10)
            )
            for r in (await db.execute(q)).all():
                if len(out) >= 5:
                    break
                out.append(schemas.AlertRow(
                    severity="medium", label="INVENTARIO",
                    module="inventory",
                    title=f"Stock bajo — reponer {r.sku or f'#{r.id}'}",
                    subtitle=f"Disponible {r.qty} / reorden {r.reorder_point}",
                    reference=str(r.id),
                ))
    except Exception as e:
        log.info("alerts inventory skipped: %s", e)

    return out[:5]


async def _financial_kpis(
    db: AsyncSession, start: date, end: date,
) -> List[schemas.FinancialKPIRow]:
    """KPIs financieros: si no hay estados capturados, marca available=False
    para que el frontend muestre placeholder 'sin datos'."""
    kpis: List[schemas.FinancialKPIRow] = []

    # Liquidez corriente = Activo circulante / Pasivo corto plazo
    # Sin estados financieros capturados por ahora — placeholder
    kpis.append(schemas.FinancialKPIRow(
        key="liquidity", label="Liquidez Corriente",
        display="—", value=None, status="pending",
        subtitle="Requiere balance capturado", available=False,
    ))
    kpis.append(schemas.FinancialKPIRow(
        key="debt_ratio", label="Endeudamiento",
        display="—", value=None, status="pending",
        subtitle="Requiere balance capturado", available=False,
    ))

    # Rotación de inventario (calculable con datos actuales):
    # COGS periodo / valor promedio de inventario. Si podemos calcularlo,
    # lo mostramos; si no, pending.
    try:
        rev, cnt, cogs = await _sales_totals(db, start, end)
        inv_val_q = (
            select(func.coalesce(func.sum(
                inv_models.StockLevel.quantity
                * func.coalesce(inv_models.ProductVariant.cost_price, 0.0)
            ), 0.0))
            .join(inv_models.ProductVariant,
                  inv_models.StockLevel.variant_id == inv_models.ProductVariant.id)
        )
        inv_val = float((await db.execute(inv_val_q)).scalar() or 0.0)
        if inv_val > 0 and cogs > 0:
            rotation = round(cogs / inv_val, 2)
            status = "good" if rotation >= 4 else "warn" if rotation >= 2 else "bad"
            kpis.append(schemas.FinancialKPIRow(
                key="inventory_turnover", label="Rotación de Inventario",
                display=f"{rotation:.2f}", value=rotation, status=status,
                subtitle="COGS / Inventario prom.", available=True,
            ))
        else:
            kpis.append(schemas.FinancialKPIRow(
                key="inventory_turnover", label="Rotación de Inventario",
                display="—", value=None, status="pending",
                subtitle="Sin COGS o inventario capturado", available=False,
            ))
    except Exception:
        kpis.append(schemas.FinancialKPIRow(
            key="inventory_turnover", label="Rotación de Inventario",
            display="—", value=None, status="pending",
            subtitle="Sin datos", available=False,
        ))

    # DSO — Days Sales Outstanding = (AR / Ventas del periodo) × días
    try:
        ar_q = (
            select(func.coalesce(func.sum(
                sales_models.Order.total_amount - func.coalesce(sales_models.Order.paid_amount, 0.0)
            ), 0.0))
            .where(
                sales_models.Order.kind == "order",
                sales_models.Order.status.in_(("pending", "partial", "delivered")),
            )
        )
        ar_total = float((await db.execute(ar_q)).scalar() or 0.0)
        rev, _, _ = await _sales_totals(db, start, end)
        days = (end - start).days or 1
        if rev > 0:
            dso = round(ar_total / rev * days, 1)
            status = "good" if dso <= 30 else "warn" if dso <= 60 else "bad"
            kpis.append(schemas.FinancialKPIRow(
                key="dso", label="Días de Cobranza",
                display=f"{dso:.0f}", value=dso, status=status,
                subtitle="AR / Ventas × días", available=True,
            ))
        else:
            kpis.append(schemas.FinancialKPIRow(
                key="dso", label="Días de Cobranza",
                display="—", value=None, status="pending",
                subtitle="Sin ventas en el periodo", available=False,
            ))
    except Exception:
        kpis.append(schemas.FinancialKPIRow(
            key="dso", label="Días de Cobranza",
            display="—", value=None, status="pending",
            subtitle="Sin datos", available=False,
        ))

    return kpis


# ── Entry point ─────────────────────────────────────────────────────────

async def executive_dashboard(
    db: AsyncSession, start: Optional[date] = None, end: Optional[date] = None,
) -> schemas.ExecutiveDashboardResponse:
    """KPIs ejecutivos consolidados del período."""
    today = date.today()
    if end is None:
        end = today
    if start is None:
        start = end - timedelta(days=30)

    days = (end - start).days or 1
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)

    # 1) Totales actual y anterior
    rev_cur, orders_cur, cogs_cur = await _sales_totals(db, start, end)
    rev_prev, orders_prev, cogs_prev = await _sales_totals(db, prev_start, prev_end)

    profit_cur = rev_cur - cogs_cur
    profit_prev = rev_prev - cogs_prev
    avg_ticket_cur = (rev_cur / orders_cur) if orders_cur > 0 else 0.0
    avg_ticket_prev = (rev_prev / orders_prev) if orders_prev > 0 else 0.0
    margin_pct_cur = (profit_cur / rev_cur * 100) if rev_cur > 0 else 0.0

    # 2) Meta prorateada al MISMO periodo seleccionado (no al mes calendario).
    # Así 30d/90d/1año siempre comparan manzanas con manzanas.
    goal_period = await _forecast_period_target(db, start, end)
    real_period = rev_cur
    meta_basis = "forecast" if goal_period > 0 else "none"

    # Fallback: si no hay forecast del periodo, usar ventas del periodo anterior.
    if goal_period <= 0:
        if rev_prev > 0:
            goal_period = rev_prev
            meta_basis = "previous_period"

    achieved_pct = (real_period / goal_period * 100.0) if goal_period > 0 else 0.0

    # 3) 6 KPIs principales
    def _color(delta: Optional[float]) -> str:
        if delta is None: return "neutral"
        return "good" if delta >= 0 else "bad"

    kpis = [
        schemas.ExecKPI(
            key="income_total", label="Ingresos Totales",
            value=round(rev_cur, 2), display=_format_money(rev_cur),
            sub="vs. periodo anterior",
            delta_pct=_pct_change(rev_cur, rev_prev),
            color_hint=_color(_pct_change(rev_cur, rev_prev)),
        ),
        schemas.ExecKPI(
            key="net_profit", label="Utilidad Neta",
            value=round(profit_cur, 2), display=_format_money(profit_cur),
            sub="vs. periodo anterior",
            delta_pct=_pct_change(profit_cur, profit_prev),
            color_hint=_color(_pct_change(profit_cur, profit_prev)),
        ),
        schemas.ExecKPI(
            key="orders", label="Pedidos",
            value=orders_cur, display=f"{orders_cur:,}",
            sub="vs. periodo anterior",
            delta_pct=_pct_change(orders_cur, orders_prev),
            color_hint=_color(_pct_change(orders_cur, orders_prev)),
        ),
        schemas.ExecKPI(
            key="avg_ticket", label="Ticket Promedio",
            value=round(avg_ticket_cur, 2), display=_format_money(avg_ticket_cur),
            sub="vs. periodo anterior",
            delta_pct=_pct_change(avg_ticket_cur, avg_ticket_prev),
            color_hint=_color(_pct_change(avg_ticket_cur, avg_ticket_prev)),
        ),
        schemas.ExecKPI(
            key="margin_pct", label="Margen de Ganancia",
            value=round(margin_pct_cur, 2),
            display=f"{margin_pct_cur:.1f}%",
            sub="Utilidad / Ingresos",
            delta_pct=None,
            color_hint="good" if margin_pct_cur >= 20
                        else "warn" if margin_pct_cur >= 10 else "bad",
        ),
    ]

    # Cuentas por cobrar (reemplaza el KPI de meta — la esfera ya la muestra)
    try:
        ar_q = (
            select(
                func.coalesce(func.sum(
                    sales_models.Order.total_amount
                    - func.coalesce(sales_models.Order.paid_amount, 0.0)
                ), 0.0).label("balance"),
                func.count(func.distinct(sales_models.Order.id)).label("cnt"),
            )
            .where(
                sales_models.Order.kind == "order",
                sales_models.Order.status.in_(("pending", "partial", "delivered")),
            )
        )
        ar_row = (await db.execute(ar_q)).one()
        ar_balance = float(ar_row.balance or 0.0)
        ar_count = int(ar_row.cnt or 0)
    except Exception as e:
        log.info("receivables kpi skipped: %s", e)
        ar_balance, ar_count = 0.0, 0

    kpis.append(schemas.ExecKPI(
        key="receivables",
        label="Cuentas por Cobrar",
        value=round(ar_balance, 2),
        display=_format_money(ar_balance),
        sub=(f"{ar_count} orden{'es' if ar_count != 1 else ''} con saldo"
             if ar_count > 0 else "Sin cartera vencida"),
        delta_pct=None,
        color_hint=("bad" if ar_balance > rev_cur * 0.5
                    else "warn" if ar_balance > rev_cur * 0.2
                    else "good") if rev_cur > 0 else "neutral",
    ))

    # 4) Serie temporal (ventas actuales vs anteriores mismo dia hace X)
    series_cur = await _daily_sales_series(db, start, end)
    series_prev = await _daily_sales_series(db, prev_start, prev_end)
    trend_sales: List[schemas.TrendPoint] = []
    for i in range(days):
        d_cur = start + timedelta(days=i)
        d_prev = prev_start + timedelta(days=i)
        rev_d, _ = series_cur.get(d_cur, (0.0, 0))
        rev_d_prev, _ = series_prev.get(d_prev, (0.0, 0))
        trend_sales.append(schemas.TrendPoint(
            period=d_cur.isoformat(),
            label=d_cur.strftime("%d-%b"),
            revenue=round(rev_d, 2),
            prev_revenue=round(rev_d_prev, 2),
        ))

    # 5) Ingresos vs gastos
    exp_by_day = await _daily_expenses(db, start, end)
    trend_ie: List[schemas.TrendPoint] = []
    for i in range(days):
        d = start + timedelta(days=i)
        rev_d, _ = series_cur.get(d, (0.0, 0))
        trend_ie.append(schemas.TrendPoint(
            period=d.isoformat(), label=d.strftime("%d-%b"),
            revenue=round(rev_d, 2),
            expenses=round(exp_by_day.get(d, 0.0), 2),
        ))

    # 6) Top clientes
    tops = await _top_customers(db, start, end, limit=5)
    tops_prev = await _top_customers(db, prev_start, prev_end, limit=20)
    prev_by_id = {cid: total for cid, _, total, _ in tops_prev if cid}
    top_customers = [
        schemas.TopCustomerRow(
            customer_id=cid, name=name, total=round(total, 2), orders=orders,
            delta_pct=_pct_change(total, prev_by_id.get(cid, 0.0)) if cid else None,
        )
        for cid, name, total, orders in tops
    ]

    # 7) Geográfico
    geographic = await _geographic_sales(db, start, end)

    # 8) KPIs operativos
    goal_pct = achieved_pct if goal_period > 0 else 0.0
    operational_kpis = [
        schemas.OperationalKPIRow(
            key="goal_completion", label="Cumplimiento de meta",
            value_pct=round(min(goal_pct, 100.0), 1),
            color_hint="good" if goal_pct >= 90 else "warn" if goal_pct >= 60 else "bad",
            hint="Real vs forecast del mes",
        ),
        schemas.OperationalKPIRow(
            key="margin_vs_target", label="Margen neto vs objetivo",
            value_pct=round(min(margin_pct_cur * 100 / 25.0, 100.0), 1) if margin_pct_cur > 0 else 0.0,
            color_hint="good" if margin_pct_cur >= 20 else "warn" if margin_pct_cur >= 10 else "bad",
            hint="Objetivo 25% margen",
        ),
    ]
    # Cobranza = ventas cobradas / ventas totales del periodo
    try:
        paid_q = select(func.coalesce(
            func.sum(sales_models.Order.paid_amount), 0.0
        )).where(
            sales_models.Order.kind == "order",
            sales_models.Order.status != "cancelled",
            func.date(sales_models.Order.created_at) >= start,
            func.date(sales_models.Order.created_at) <= end,
        )
        paid_total = float((await db.execute(paid_q)).scalar() or 0.0)
        # Cap: si por alguna razón hay overpayment, no rebasar 100%
        cobranza_pct = round(min(paid_total, rev_cur) / rev_cur * 100.0, 1) if rev_cur > 0 else 0.0
    except Exception:
        cobranza_pct = 0.0
    operational_kpis.append(schemas.OperationalKPIRow(
        key="cobranza", label="Cobranza del período",
        value_pct=min(cobranza_pct, 100.0),
        color_hint="good" if cobranza_pct >= 85 else "warn" if cobranza_pct >= 60 else "bad",
        hint="Pagado / Vendido",
    ))
    # Salud del inventario: % de SKUs sobre punto de reorden
    try:
        total_skus_q = select(func.count(inv_models.ProductVariant.id)).where(
            inv_models.ProductVariant.is_active.is_(True),
            inv_models.ProductVariant.reorder_point.is_not(None),
        )
        low_skus_q = (
            select(func.count(func.distinct(inv_models.ProductVariant.id)))
            .join(inv_models.StockLevel,
                  inv_models.StockLevel.variant_id == inv_models.ProductVariant.id, isouter=True)
            .where(
                inv_models.ProductVariant.is_active.is_(True),
                inv_models.ProductVariant.reorder_point.is_not(None),
            )
            .group_by(inv_models.ProductVariant.id, inv_models.ProductVariant.reorder_point)
            .having(func.coalesce(func.sum(inv_models.StockLevel.quantity), 0)
                    <= inv_models.ProductVariant.reorder_point)
        )
        total_tracked = int((await db.execute(total_skus_q)).scalar() or 0)
        low_ct = len((await db.execute(low_skus_q)).all())
        health_pct = round(((total_tracked - low_ct) / total_tracked * 100.0), 1) if total_tracked > 0 else 100.0
    except Exception:
        health_pct = 0.0
    operational_kpis.append(schemas.OperationalKPIRow(
        key="inventory_health", label="Salud del inventario",
        value_pct=health_pct,
        color_hint="good" if health_pct >= 85 else "warn" if health_pct >= 60 else "bad",
        hint="% SKUs sobre punto de reorden",
    ))

    # 9) Canales
    channels = await _channel_sales(db, start, end)

    # 10) Alertas
    alerts = await _alerts_top5(db)

    # 11) Financial KPIs
    fin_kpis = await _financial_kpis(db, start, end)

    return schemas.ExecutiveDashboardResponse(
        generated_at=datetime.now(timezone.utc),
        period_start=start, period_end=end,
        prev_period_start=prev_start, prev_period_end=prev_end,
        kpis=kpis,
        meta_vs_real=schemas.MetaVsRealPoint(
            period=f"{start.isoformat()}..{end.isoformat()}",
            goal=round(goal_period, 2), real=round(real_period, 2),
            achieved_pct=round(achieved_pct, 2),
            basis=meta_basis,
        ),
        trend_sales=trend_sales,
        trend_income_expenses=trend_ie,
        top_customers=top_customers,
        geographic=geographic,
        operational_kpis=operational_kpis,
        channel_sales=channels,
        alerts=alerts,
        financial_kpis=fin_kpis,
    )
