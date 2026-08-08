"""Pydantic v2 schemas para el Dashboard Ejecutivo."""
from __future__ import annotations

from datetime import datetime, date
from typing import List, Optional

from pydantic import BaseModel


class ExecKPI(BaseModel):
    """Un tile principal del dashboard."""
    key: str          # income_total, net_profit, orders, avg_ticket, margin_pct, revenue_target
    label: str
    value: float
    display: str      # texto formateado (ej. "$2.04M")
    sub: Optional[str] = None
    delta_pct: Optional[float] = None    # cambio vs período anterior
    color_hint: Optional[str] = None     # good | warn | bad | neutral


class MetaVsRealPoint(BaseModel):
    period: str      # "2025-08"
    goal: float      # forecast del mes (o mes anterior si no hay forecast)
    real: float      # ventas cargadas del mes
    achieved_pct: float
    # forecast | previous_period | none — el frontend lo usa para el subtítulo
    basis: str = "forecast"


class TrendPoint(BaseModel):
    period: str      # ISO date (día o mes)
    label: str
    revenue: float
    prev_revenue: float = 0.0    # mismo periodo hace X (día/mes)
    expenses: float = 0.0


class TopCustomerRow(BaseModel):
    customer_id: Optional[int] = None
    name: str
    total: float
    orders: int
    delta_pct: Optional[float] = None


class GeoStateRow(BaseModel):
    state_code: str          # AGS, BC, BCS, ...
    state_name: str
    revenue: float
    units: int
    share_pct: float
    orders_count: int


class GeoResponse(BaseModel):
    total_revenue: float
    total_units: int
    by_state: List[GeoStateRow]
    # Top 5 estados por revenue (para la lista lateral)
    top5: List[GeoStateRow]


class ChannelSalesRow(BaseModel):
    channel: str          # WEB | POS | RETAIL | OTHER
    label: str
    revenue: float
    orders: int
    share_pct: float


class ChannelSalesResponse(BaseModel):
    total_revenue: float
    channels: List[ChannelSalesRow]


class AlertRow(BaseModel):
    severity: str         # urgent | high | medium | low
    label: str            # "CRITICO" | "AVISO"
    module: str           # finance | retail | inventory | pos
    title: str
    subtitle: Optional[str] = None
    reference: Optional[str] = None      # id o folio para deep-link
    created_at: Optional[datetime] = None


class OperationalKPIRow(BaseModel):
    key: str              # goal_completion | margin_vs_target | cobranza | inventory_health
    label: str
    value_pct: float      # 0..100
    color_hint: str       # good | warn | bad
    hint: Optional[str] = None


class FinancialKPIRow(BaseModel):
    key: str              # liquidity | debt_ratio | inventory_turnover | dso
    label: str
    display: str
    value: Optional[float] = None
    status: str           # good | warn | bad | pending
    subtitle: Optional[str] = None
    available: bool = False      # False si no hay estado financiero capturado


class ExecutiveDashboardResponse(BaseModel):
    generated_at: datetime
    period_start: date
    period_end: date
    prev_period_start: date
    prev_period_end: date
    # 6 KPIs principales
    kpis: List[ExecKPI]
    # Meta vs Real (mes actual)
    meta_vs_real: MetaVsRealPoint
    # Serie temporal: ventas del período vs período anterior
    trend_sales: List[TrendPoint]
    # Serie temporal: ingresos vs gastos
    trend_income_expenses: List[TrendPoint]
    # Top 5 clientes del período
    top_customers: List[TopCustomerRow]
    # Distribución geográfica por estado
    geographic: GeoResponse
    # KPIs Operativos (barras)
    operational_kpis: List[OperationalKPIRow]
    # Ventas por canal (donut)
    channel_sales: ChannelSalesResponse
    # Alertas tempranas (top 5)
    alerts: List[AlertRow]
    # KPIs financieros (placeholders si no hay estados financieros)
    financial_kpis: List[FinancialKPIRow]
