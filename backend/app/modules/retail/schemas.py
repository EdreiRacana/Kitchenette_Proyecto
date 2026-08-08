"""Pydantic v2 schemas para el módulo Retail."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Retail Channel ───────────────────────────────────────────────────────

class RetailChannelBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: Optional[str] = Field(default=None, max_length=50)
    customer_id: Optional[int] = None
    target_wos_weeks: float = Field(default=4.0, ge=0)
    critical_wos_weeks: float = Field(default=2.0, ge=0)
    overstock_wos_weeks: float = Field(default=12.0, ge=0)
    no_movement_days: int = Field(default=21, ge=1)
    sell_through_min_pct: float = Field(default=20.0, ge=0, le=100)
    return_rate_max_pct: float = Field(default=5.0, ge=0, le=100)
    alerts_enabled: bool = True
    is_active: bool = True
    notes: Optional[str] = None


class RetailChannelCreate(RetailChannelBase):
    pass


class RetailChannelUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    customer_id: Optional[int] = None
    target_wos_weeks: Optional[float] = None
    critical_wos_weeks: Optional[float] = None
    overstock_wos_weeks: Optional[float] = None
    no_movement_days: Optional[int] = None
    sell_through_min_pct: Optional[float] = None
    return_rate_max_pct: Optional[float] = None
    alerts_enabled: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RetailChannelOut(RetailChannelBase):
    id: int
    customer_name: Optional[str] = None
    customer_logo_base64: Optional[str] = None
    stores_count: int = 0
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Retail Store ─────────────────────────────────────────────────────────

class RetailStoreBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: Optional[str] = None
    external_code: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    store_format: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    consignment_warehouse_id: Optional[int] = None
    is_active: bool = True
    notes: Optional[str] = None


class RetailStoreCreate(RetailStoreBase):
    channel_id: int


class RetailStoreUpdate(BaseModel):
    channel_id: Optional[int] = None
    name: Optional[str] = None
    code: Optional[str] = None
    external_code: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    store_format: Optional[str] = None
    address: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    consignment_warehouse_id: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RetailStoreOut(RetailStoreBase):
    id: int
    channel_id: int
    channel_name: Optional[str] = None
    consignment_warehouse_name: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class BulkStoresRequest(BaseModel):
    channel_id: int
    stores: List[RetailStoreBase]


class BulkStoresResponse(BaseModel):
    created: int
    skipped: int
    stores: List[RetailStoreOut]


# ── Sell-Out Reports ─────────────────────────────────────────────────────

class SellOutReportBase(BaseModel):
    # NOTA: quitamos ge=0 de los campos numéricos porque los datos
    # históricos pueden tener negativos legítimos (ajustes, devoluciones
    # netas que sobrepasan ventas, on_hand negativo por descuentos
    # de consignación mal reportados por la cadena). El listado NO debe
    # tronar por eso. La validación de negativos en captura se hace
    # en el endpoint create/update, no aquí.
    store_id: int
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    period_start: datetime
    period_end: datetime
    period_type: str = Field(default="week", pattern="^(day|week|month)$")
    units_sold: int = 0
    units_returned: int = 0
    units_on_hand: int = 0
    revenue: float = 0.0
    returns_amount: float = 0.0
    notes: Optional[str] = None


class SellOutReportCreate(SellOutReportBase):
    # En creación sí exigimos >= 0 (validación de entrada del usuario)
    units_sold: int = Field(default=0, ge=0)
    units_returned: int = Field(default=0, ge=0)
    units_on_hand: int = Field(default=0, ge=0)
    revenue: float = Field(default=0.0, ge=0)
    returns_amount: float = Field(default=0.0, ge=0)
    source: str = Field(default="manual", pattern="^(manual|csv|excel|edi|api)$")


class SellOutReportUpdate(BaseModel):
    units_sold: Optional[int] = Field(default=None, ge=0)
    units_returned: Optional[int] = Field(default=None, ge=0)
    units_on_hand: Optional[int] = Field(default=None, ge=0)
    revenue: Optional[float] = Field(default=None, ge=0)
    returns_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class SellOutReportOut(SellOutReportBase):
    id: int
    source: str
    store_name: Optional[str] = None
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Dashboard / KPIs ─────────────────────────────────────────────────────

class RetailKPIs(BaseModel):
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    period_start: datetime
    period_end: datetime
    total_sell_out_units: int
    total_sell_out_revenue: float
    total_sell_in_units: int
    total_sell_in_revenue: float
    sell_through_pct: float           # sell_out / sell_in
    total_returns_units: int = 0
    total_returns_amount: float = 0.0
    return_rate_pct: float = 0.0      # devoluciones / venta bruta × 100
    net_units: int = 0                 # unidades vendidas − devueltas
    net_revenue: float = 0.0           # ingreso − importe_devoluciones
    total_on_hand: int
    avg_wos_weeks: float              # promedio ponderado
    critical_stores_count: int        # tiendas con al menos 1 SKU en WOS < critical
    overstock_stores_count: int       # tiendas con al menos 1 SKU en WOS > overstock
    stores_active_count: int
    skus_active_count: int
    # v3: contadores adicionales para el dashboard rediseñado
    channels_count: int = 0
    stores_total_count: int = 0
    channel_logo_url: Optional[str] = None    # logo del cliente vinculado a la cadena


class StoreDashboardRow(BaseModel):
    """Una fila = una tienda con toda su info de un vistazo (v3)."""
    store_id: int
    store_name: str
    channel_id: int
    channel_name: Optional[str] = None
    city: Optional[str] = None
    # Inventario
    on_hand_units: int
    on_hand_value: float          # units × cost_price
    wos_weeks: float
    status: str                    # critical | replenish | healthy | overstock | no_data
    # Ventas en la ventana
    days_window: int
    units_sold: int
    revenue: float
    # Top / bottom SKU
    top_sku: Optional[str] = None
    top_sku_name: Optional[str] = None
    top_sku_units: int = 0
    bottom_sku: Optional[str] = None
    bottom_sku_name: Optional[str] = None
    bottom_sku_units: int = 0


class StoreVelocityRow(BaseModel):
    store_id: int
    store_name: str
    channel_name: Optional[str] = None
    total_units_sold: int
    avg_weekly_units: float
    total_on_hand: int
    wos_weeks: float                  # infinito → 999
    status: str                        # critical | replenish | healthy | overstock | no_data


class SKUVelocityRow(BaseModel):
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    stores_count: int                  # cuántas tiendas la venden
    total_units_sold: int
    avg_weekly_units: float
    total_on_hand: int
    wos_weeks: float
    status: str


# ── Replenishment ────────────────────────────────────────────────────────

class ReplenishmentSuggestion(BaseModel):
    store_id: int
    store_name: str
    channel_id: int
    channel_name: str
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    current_on_hand: int
    avg_weekly_units: float
    wos_weeks: float
    suggested_units: int               # cuánto mandar para llegar a WOS target
    priority: str                      # urgent | high | normal
    reason: str


class ReplenishmentResponse(BaseModel):
    channel_id: Optional[int] = None
    generated_at: datetime
    target_wos_weeks: float
    critical_wos_weeks: float
    suggestions: List[ReplenishmentSuggestion]
    urgent_count: int
    high_count: int
    normal_count: int


# ── Store Performance ────────────────────────────────────────────────────

class StorePerformancePeriod(BaseModel):
    period_start: datetime
    period_end: datetime
    units_sold: int
    on_hand_end: int
    revenue: float


class StorePerformanceOut(BaseModel):
    store_id: int
    store_name: str
    channel_name: str
    periods: List[StorePerformancePeriod]
    total_units_sold: int
    total_revenue: float
    avg_weekly_units: float
    latest_on_hand: int
    wos_weeks: float
    status: str


# ── Import bulk ─────────────────────────────────────────────────────────

class ImportRowError(BaseModel):
    row: int
    reason: str
    raw: Optional[dict] = None


class ImportSellOutResponse(BaseModel):
    total_rows: int
    created: int
    updated: int
    skipped: int
    errors: List[ImportRowError] = Field(default_factory=list)


# ── Alerts ──────────────────────────────────────────────────────────────

class RetailAlertOut(BaseModel):
    id: int
    channel_id: int
    channel_name: Optional[str] = None
    store_id: int
    store_name: Optional[str] = None
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    alert_type: str
    severity: str
    message: str
    wos_snapshot: Optional[float] = None
    on_hand_snapshot: Optional[int] = None
    weekly_velocity_snapshot: Optional[float] = None
    status: str
    acknowledged_at: Optional[datetime] = None
    acknowledged_by_user_id: Optional[int] = None
    resolved_at: Optional[datetime] = None
    resolved_by_user_id: Optional[int] = None
    resolution_notes: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class AlertActionRequest(BaseModel):
    notes: Optional[str] = None


class EvaluateAlertsResponse(BaseModel):
    created: int
    auto_resolved: int
    total_open: int
    urgent_open: int


class AlertsSummary(BaseModel):
    open: int
    urgent: int
    high: int
    medium: int
    low: int
    acknowledged: int


# ── Consignación ────────────────────────────────────────────────────────

class ConsignmentWarehouseOption(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    is_active: bool


class ConsignmentReconRow(BaseModel):
    store_id: int
    store_name: str
    channel_name: Optional[str] = None
    warehouse_id: int
    warehouse_name: str
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    reported_on_hand: int          # último on_hand reportado por la tienda
    reported_at: Optional[datetime] = None
    warehouse_stock: int           # stock actual en el almacén de consignación
    difference: int                # warehouse_stock - reported_on_hand
    status: str                    # match | over_at_warehouse | short_at_warehouse | no_data


class ConsignmentReconResponse(BaseModel):
    generated_at: datetime
    channel_id: Optional[int] = None
    total_rows: int
    matched: int
    with_diff: int
    rows: List[ConsignmentReconRow]


# ── Analytics: heatmap ──────────────────────────────────────────────────

class HeatmapCell(BaseModel):
    store_id: int
    variant_id: int
    value: Optional[float] = None
    on_hand: int = 0
    units_sold: int = 0
    status: str  # critical | replenish | healthy | overstock | no_data


class HeatmapStoreRef(BaseModel):
    id: int
    name: str
    channel_name: Optional[str] = None


class HeatmapVariantRef(BaseModel):
    id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None


class HeatmapResponse(BaseModel):
    channel_id: Optional[int] = None
    metric: str  # wos | units_sold | on_hand
    stores: List[HeatmapStoreRef]
    variants: List[HeatmapVariantRef]
    cells: List[HeatmapCell]
    # Paginación (para catálogos grandes)
    total_stores: int = 0
    total_variants: int = 0
    store_offset: int = 0
    store_limit: int = 0


class HeatmapFilters(BaseModel):
    """Facetas disponibles para filtrar el heatmap."""
    regions: List[str] = Field(default_factory=list)
    states: List[str] = Field(default_factory=list)
    formats: List[str] = Field(default_factory=list)


# ── Analytics: ABC ──────────────────────────────────────────────────────

class ABCRow(BaseModel):
    rank: int
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    stores_count: int
    total_units: int
    total_revenue: float
    revenue_pct: float
    cumulative_pct: float
    abc_class: str  # A | B | C


class ABCResponse(BaseModel):
    channel_id: Optional[int] = None
    total_revenue: float
    class_a_count: int
    class_b_count: int
    class_c_count: int
    rows: List[ABCRow]


# ── Analytics: ABC-XYZ (segmentación de surtido) ────────────────────────

class AbcXyzRow(BaseModel):
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    total_units: int
    total_revenue: float
    revenue_pct: float
    cumulative_pct: float
    avg_weekly_units: float
    cv: Optional[float] = None          # coef. de variación (None = sin ventas)
    abc_class: str                       # A | B | C
    xyz_class: str                       # X | Y | Z
    combined_class: str                  # AX, AY, … CZ
    strategy: str


class AbcXyzMatrixCell(BaseModel):
    combined: str                        # AX … CZ
    abc_class: str
    xyz_class: str
    count: int
    units: int
    revenue: float
    revenue_pct: float


class AbcXyzResponse(BaseModel):
    channel_id: Optional[int] = None
    days: int
    weeks: int
    total_revenue: float
    matrix: List[AbcXyzMatrixCell]       # 9 celdas (A/B/C × X/Y/Z)
    rows: List[AbcXyzRow]


# ── Analytics: inteligencia de precios ──────────────────────────────────

class PricingRow(BaseModel):
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    units_sold: int
    avg_price: float                     # ingreso / unidades (ponderado)
    min_price: float
    max_price: float
    price_volatility_pct: float          # CV del precio por periodo × 100
    price_change_pct: float              # último vs primer periodo
    list_price: Optional[float] = None   # precio de catálogo (referencia)
    elasticity: Optional[float] = None   # pendiente log(q)~log(p)
    elasticity_label: str                # elastic | inelastic | unit | n/a
    periods_count: int


class PricingResponse(BaseModel):
    channel_id: Optional[int] = None
    days: int
    rows: List[PricingRow]


class PriceHistoryPoint(BaseModel):
    label: str
    period_start: datetime
    avg_price: float
    units: int


class PriceHistoryResponse(BaseModel):
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    points: List[PriceHistoryPoint]
    elasticity: Optional[float] = None
    elasticity_label: str
    avg_price: float
    list_price: Optional[float] = None


# ── Analytics: tendencia (time-series) ──────────────────────────────────

class TrendPoint(BaseModel):
    period_start: datetime
    period_end: Optional[datetime] = None
    label: str                         # ej. "24 feb"
    units_sold: int
    units_returned: int
    net_units: int
    revenue: float
    returns_amount: float
    net_revenue: float
    on_hand: int                       # on-hand al cierre del periodo
    stores_reporting: int              # cuántas tiendas reportaron ese periodo


class TrendResponse(BaseModel):
    channel_id: Optional[int] = None
    variant_id: Optional[int] = None
    store_id: Optional[int] = None
    period_type: str                   # week | month
    points: List[TrendPoint]
    # Comparación primer vs último punto (deltas para flechas)
    total_units: int = 0
    total_revenue: float = 0.0
    wow_units_pct: Optional[float] = None      # variación último vs anterior
    wow_revenue_pct: Optional[float] = None


# ── Analytics: distribución numérica (voids) ────────────────────────────

class DistributionRow(BaseModel):
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    stores_selling: int                # tiendas con venta en la ventana
    stores_stocking: int               # tiendas con on-hand > 0
    total_stores: int                  # tiendas activas de la cadena
    distribution_pct: float            # stores_selling / total_stores × 100
    void_stores: int                   # total - stores_selling (oportunidad)
    total_units: int
    avg_units_per_store: float
    status: str                        # excellent | good | low | critical


class DistributionResponse(BaseModel):
    channel_id: Optional[int] = None
    total_stores: int
    rows: List[DistributionRow]


# ── Analytics: venta perdida por stockout ───────────────────────────────

class LostSalesRow(BaseModel):
    store_id: int
    store_name: str
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    avg_weekly_units: float            # velocidad histórica
    weeks_out_of_stock: float          # periodos recientes con on-hand 0
    lost_units: int                    # velocidad × semanas sin stock
    unit_price: float
    lost_revenue: float
    severity: str                      # urgent | high | medium


class LostSalesResponse(BaseModel):
    channel_id: Optional[int] = None
    generated_at: datetime
    total_lost_units: int
    total_lost_revenue: float
    affected_combos: int               # cuántos (tienda × SKU) en stockout
    rows: List[LostSalesRow]


# ── Analytics: rentabilidad (márgenes + GMROI) ──────────────────────────

class ProfitabilityRow(BaseModel):
    dimension_id: Optional[int] = None
    dimension_label: str               # SKU / categoría / tienda / cadena
    sku: Optional[str] = None
    product_name: Optional[str] = None
    units_sold: int
    revenue: float
    cogs: float                        # costo de lo vendido
    gross_margin: float                # revenue − cogs
    margin_pct: float                  # gross_margin / revenue × 100
    inventory_cost: float              # inventario promedio valuado a costo
    gmroi: Optional[float] = None      # gross_margin / inventory_cost
    missing_cost: bool = False         # sin cost_price → margen no confiable


class ProfitabilityResponse(BaseModel):
    channel_id: Optional[int] = None
    group_by: str                      # sku | category | store | channel
    days: int
    total_units: int
    total_revenue: float
    total_cogs: float
    total_gross_margin: float
    total_margin_pct: float
    total_inventory_cost: float
    total_gmroi: Optional[float] = None
    variants_without_cost: int         # señal de calidad de dato
    rows: List[ProfitabilityRow]


# ── Analytics: exceso de inventario + rotación/DOH ──────────────────────

class ExcessInventoryRow(BaseModel):
    store_id: int
    store_name: str
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    on_hand: int
    avg_weekly_units: float
    wos_weeks: Optional[float] = None   # None = sin movimiento (dead stock)
    doh_days: Optional[float] = None    # días de inventario
    overstock_threshold_weeks: float
    excess_units: int                   # unidades por encima del umbral sano
    unit_cost: float
    excess_cost: float                  # dinero detenido en exceso
    is_dead_stock: bool                 # sin ventas y con stock
    severity: str                       # urgent | high | medium


class ExcessInventoryResponse(BaseModel):
    channel_id: Optional[int] = None
    generated_at: datetime
    # Salud global del inventario
    total_inventory_units: int
    total_inventory_cost: float         # inventario actual valuado a costo
    inventory_turnover: Optional[float] = None   # rotación anualizada
    days_of_inventory: Optional[float] = None     # 365 / rotación
    avg_doh_days: Optional[float] = None          # días de inventario promedio
    # Exceso
    total_excess_units: int
    total_excess_cost: float            # $ detenido en exceso
    dead_stock_cost: float              # $ en productos sin movimiento
    affected_combos: int
    rows: List[ExcessInventoryRow]


# ── Analytics: antigüedad de inventario (aging / obsolescencia) ─────────

class AgingRow(BaseModel):
    store_id: int
    store_name: str
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    variant_id: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    on_hand: int
    last_sale_date: Optional[datetime] = None
    days_since_last_sale: Optional[int] = None   # None = nunca vendió
    bucket: str                                   # 0-30 | 31-60 | 61-90 | 90+ | never
    unit_cost: float
    stock_value: float
    obsolescence_risk: bool                       # 90+ o never con stock


class AgingBucket(BaseModel):
    bucket: str
    label: str
    units: int
    value: float
    pct_of_value: float


class AgingResponse(BaseModel):
    channel_id: Optional[int] = None
    generated_at: datetime
    total_stock_units: int
    total_stock_value: float            # inventario a costo
    obsolete_value: float               # valor en riesgo (90+ / never)
    obsolete_pct: float
    buckets: List[AgingBucket]
    rows: List[AgingRow]


# ── Analytics: nivel de servicio / fill rate ────────────────────────────

class ServiceLevelRow(BaseModel):
    dimension_id: Optional[int] = None
    dimension_label: str               # tienda / SKU / cadena
    sku: Optional[str] = None
    product_name: Optional[str] = None
    total_periods: int                 # observaciones (combos × cortes)
    in_stock_periods: int
    in_stock_rate_pct: float           # OSA — disponibilidad en anaquel
    units_sold: int
    estimated_lost_units: int
    fill_rate_pct: float               # vendido / (vendido + perdido)
    status: str                        # excellent | good | low | critical


class ServiceLevelResponse(BaseModel):
    channel_id: Optional[int] = None
    generated_at: datetime
    weeks_back: int
    group_by: str                      # store | sku | channel
    overall_in_stock_rate_pct: float
    overall_stockout_rate_pct: float
    overall_fill_rate_pct: float
    total_units_sold: int
    total_estimated_lost: int
    combos_evaluated: int
    rows: List[ServiceLevelRow]


# ── Notificaciones de alertas (correo / WhatsApp) ───────────────────────

class NotifyAlertsRequest(BaseModel):
    email: Optional[str] = None
    whatsapp_to: Optional[str] = None
    send_email: bool = True
    send_whatsapp: bool = False
    channel_id: Optional[int] = None
    min_severity: str = Field(default="high", pattern="^(urgent|high|medium|low)$")


class NotifyAlertsResponse(BaseModel):
    alerts_included: int
    email_sent: bool = False
    email_error: Optional[str] = None
    whatsapp_sent: bool = False
    whatsapp_error: Optional[str] = None
    email_configured: bool = False
    whatsapp_configured: bool = False


# ── Replenishment: transfer ─────────────────────────────────────────────

class SourceWarehouseOption(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    type: str  # own, consignment, marketplace, etc.
    # Si viene de la consignación de una tienda, el id/nombre de la tienda
    # para que la UI pueda etiquetar "Tienda: Walmart Insurgentes"
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    channel_name: Optional[str] = None


class TransferItem(BaseModel):
    store_id: int
    variant_id: int
    units: int = Field(ge=1)
    notes: Optional[str] = None


class TransferRequest(BaseModel):
    source_warehouse_id: int
    items: List[TransferItem]


class TransferItemResult(BaseModel):
    store_id: int
    variant_id: int
    units_requested: int
    units_transferred: int
    status: str      # transferred | insufficient_stock | no_consignment | error
    message: Optional[str] = None
    out_movement_id: Optional[int] = None
    in_movement_id: Optional[int] = None


class TransferResponse(BaseModel):
    source_warehouse_id: int
    source_warehouse_name: str
    transferred_lines: int
    warnings: int
    total_units: int
    results: List[TransferItemResult]


# ── Traslados tienda↔tienda ─────────────────────────────────────────────

class StoreTransferItem(BaseModel):
    """Un item = mover N unidades de una variante de tienda A a tienda B."""
    from_store_id: int
    to_store_id: int
    variant_id: int
    units: int = Field(ge=1)
    notes: Optional[str] = None


class StoreTransferRequest(BaseModel):
    items: List[StoreTransferItem]


class StoreTransferItemResult(BaseModel):
    from_store_id: int
    to_store_id: int
    variant_id: int
    units_requested: int
    units_transferred: int
    status: str    # transferred | insufficient_stock | no_consignment | error
    message: Optional[str] = None
    out_movement_id: Optional[int] = None
    in_movement_id: Optional[int] = None


class StoreTransferResponse(BaseModel):
    transferred_lines: int
    warnings: int
    total_units: int
    results: List[StoreTransferItemResult]


class StoreTransferSuggestion(BaseModel):
    """Propuesta del motor: mover excedente de tienda_origen a tienda_destino."""
    from_store_id: int
    from_store_name: str
    from_channel_name: Optional[str] = None
    to_store_id: int
    to_store_name: str
    to_channel_name: Optional[str] = None
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    units_suggested: int
    from_wos: float
    from_on_hand: int
    from_velocity: float
    to_wos: float
    to_on_hand: int
    to_velocity: float
    priority: str    # urgent | high | normal
    reason: str


class StoreTransferSuggestionsResponse(BaseModel):
    suggestions: List[StoreTransferSuggestion]
    generated_at: datetime
    velocity_window_days: int
    target_wos_weeks: float
    critical_wos_weeks: float
    overstock_wos_weeks: float


class StoreTransferBulkRow(BaseModel):
    """Resultado por fila del bulk import (para reporte)."""
    row_number: int
    status: str    # ok | error
    message: Optional[str] = None
    from_store: Optional[str] = None
    to_store: Optional[str] = None
    sku: Optional[str] = None
    units: Optional[int] = None


class StoreTransferBulkResponse(BaseModel):
    total_rows: int
    valid_rows: int
    error_rows: int
    transfer: Optional[StoreTransferResponse] = None
    rows: List[StoreTransferBulkRow]


# ── Perfiles de importación por cadena ──────────────────────────────────

# Los campos estándar que el sistema entiende (los mismos de la plantilla).
STANDARD_FIELDS = [
    "cadena_codigo", "cadena_nombre",
    "tienda_codigo", "tienda_nombre",
    "sku", "producto_nombre",
    "periodo_tipo", "periodo_inicio", "periodo_fin",
    "unidades_vendidas", "unidades_devueltas", "unidades_stock",
    "ingreso", "importe_devoluciones",
    "notas",
]


class RetailImportProfileBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    notes: Optional[str] = None
    is_active: bool = True
    is_default: bool = False
    file_format: str = Field(default="xlsx", pattern="^(xlsx|csv)$")
    sheet_name: Optional[str] = None
    header_row: int = Field(default=1, ge=1, le=50)
    encoding: str = Field(default="utf-8")
    delimiter: str = Field(default=",", min_length=1, max_length=3)
    date_format: str = Field(
        default="auto",
        pattern="^(auto|YYYY-MM-DD|DD/MM/YYYY|MM/DD/YYYY|YYYY/MM/DD)$",
    )
    decimal_separator: str = Field(default=".", pattern="^[.,]$")
    thousands_separator: str = Field(default="", pattern="^(|,|\\.)$")
    units_multiplier: float = Field(default=1.0)
    revenue_multiplier: float = Field(default=1.0)
    default_period_type: str = Field(default="week", pattern="^(day|week|month)$")
    column_map: Dict[str, str] = Field(default_factory=dict)
    ignore_row_pattern: Optional[str] = None
    default_channel_code: Optional[str] = None


class RetailImportProfileCreate(RetailImportProfileBase):
    channel_id: int


class RetailImportProfileUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    file_format: Optional[str] = Field(default=None, pattern="^(xlsx|csv)$")
    sheet_name: Optional[str] = None
    header_row: Optional[int] = Field(default=None, ge=1, le=50)
    encoding: Optional[str] = None
    delimiter: Optional[str] = None
    date_format: Optional[str] = None
    decimal_separator: Optional[str] = None
    thousands_separator: Optional[str] = None
    units_multiplier: Optional[float] = None
    revenue_multiplier: Optional[float] = None
    default_period_type: Optional[str] = None
    column_map: Optional[Dict[str, str]] = None
    ignore_row_pattern: Optional[str] = None
    default_channel_code: Optional[str] = None


class RetailImportProfileOut(RetailImportProfileBase):
    id: int
    channel_id: int
    channel_name: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class DetectColumnsResponse(BaseModel):
    """Encabezados detectados en el archivo + propuesta de mapeo."""
    detected_columns: List[str]
    sheet_names: List[str] = Field(default_factory=list)
    active_sheet: Optional[str] = None
    proposed_map: Dict[str, str]  # standard_field → column_del_archivo
    standard_fields: List[str] = Field(default_factory=lambda: list(STANDARD_FIELDS))


class PreviewRow(BaseModel):
    row_number: int
    raw: Dict[str, Any] = Field(default_factory=dict)         # tal como viene del archivo
    normalized: Dict[str, Any] = Field(default_factory=dict)  # tras aplicar el mapeo
    errors: List[str] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    total_rows: int
    preview_rows: List[PreviewRow]
    unmapped_required_fields: List[str]  # campos esenciales no mapeados
    warnings: List[str] = Field(default_factory=list)


# ── Promociones ─────────────────────────────────────────────────────────

class RetailPromotionBase(BaseModel):
    channel_id: int
    store_id: Optional[int] = None
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    name: str = Field(min_length=1, max_length=200)
    mechanic: str = Field(default="descuento",
                          pattern="^(descuento|precio_especial|2x1|3x2|bundle|otro)$")
    discount_pct: Optional[float] = Field(default=None, ge=0, le=100)
    promo_price: Optional[float] = Field(default=None, ge=0)
    start_date: datetime
    end_date: datetime
    baseline_weeks: int = Field(default=4, ge=1, le=26)
    is_active: bool = True
    notes: Optional[str] = None


class RetailPromotionCreate(RetailPromotionBase):
    pass


class RetailPromotionUpdate(BaseModel):
    store_id: Optional[int] = None
    variant_id: Optional[int] = None
    name: Optional[str] = None
    mechanic: Optional[str] = Field(default=None,
                                    pattern="^(descuento|precio_especial|2x1|3x2|bundle|otro)$")
    discount_pct: Optional[float] = Field(default=None, ge=0, le=100)
    promo_price: Optional[float] = Field(default=None, ge=0)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    baseline_weeks: Optional[int] = Field(default=None, ge=1, le=26)
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RetailPromotionOut(RetailPromotionBase):
    id: int
    channel_name: Optional[str] = None
    store_name: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class PromotionEffectiveness(BaseModel):
    promotion_id: int
    name: str
    channel_name: Optional[str] = None
    store_name: Optional[str] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    start_date: datetime
    end_date: datetime
    promo_weeks: float
    measurable: bool                    # False si falta variant o datos
    reason: Optional[str] = None        # por qué no es medible
    baseline_weekly_units: float
    promo_weekly_units: float
    expected_units: int                 # baseline_weekly × promo_weeks
    actual_units: int
    incremental_units: int
    lift_pct: Optional[float] = None     # (actual − expected)/expected × 100
    baseline_avg_price: float
    promo_avg_price: float
    actual_revenue: float
    incremental_revenue: float
    promo_cost: Optional[float] = None   # margen/descuento sacrificado
    roi_pct: Optional[float] = None      # margen incremental / costo promo
    verdict: str                        # winner | neutral | loser | n/a


# ── Devoluciones físicas ────────────────────────────────────────────────

class RetailReturnBase(BaseModel):
    store_id: int
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    units_returned: int = Field(ge=1)
    reason: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None


class RetailReturnCreate(RetailReturnBase):
    source_sellout_id: Optional[int] = None
    status: str = "pending"


class RetailReturnReceive(BaseModel):
    """Marca la devolución como recibida y separa buen/mal estado."""
    units_good: int = Field(ge=0)
    units_damaged: int = Field(ge=0)
    good_warehouse_id: Optional[int] = None
    damaged_warehouse_id: Optional[int] = None
    unit_cost: Optional[float] = None
    notes: Optional[str] = None


class RetailReturnOut(RetailReturnBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    store_name: Optional[str] = None
    channel_id: Optional[int] = None
    channel_name: Optional[str] = None
    units_good: int
    units_damaged: int
    unit_cost: Optional[float] = None
    status: str
    source_sellout_id: Optional[int] = None
    received_good_warehouse_id: Optional[int] = None
    received_good_warehouse_name: Optional[str] = None
    received_damaged_warehouse_id: Optional[int] = None
    received_damaged_warehouse_name: Optional[str] = None
    good_movement_id: Optional[int] = None
    damaged_movement_id: Optional[int] = None
    reported_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class RetailReturnUpdate(BaseModel):
    status: Optional[str] = None
    reason: Optional[str] = None
    condition: Optional[str] = None
    notes: Optional[str] = None
    units_returned: Optional[int] = None


class RetailReturnsSummary(BaseModel):
    pending: int
    in_transit: int
    received: int
    total_pending_units: int
    total_good_units: int
    total_damaged_units: int


# ── Category Management ─────────────────────────────────────────────────

class RetailCategoryBase(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    parent_id: Optional[int] = None
    priority: str = Field(default="N", pattern="^(A|B|C|N)$")
    color: Optional[str] = None
    foda_strengths: Optional[str] = None
    foda_weaknesses: Optional[str] = None
    foda_opportunities: Optional[str] = None
    foda_threats: Optional[str] = None
    target_margin_pct: Optional[float] = Field(default=None, ge=0, le=100)
    target_wos_weeks: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None
    is_active: bool = True


class RetailCategoryCreate(RetailCategoryBase):
    pass


class RetailCategoryUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    parent_id: Optional[int] = None
    priority: Optional[str] = Field(default=None, pattern="^(A|B|C|N)$")
    color: Optional[str] = None
    foda_strengths: Optional[str] = None
    foda_weaknesses: Optional[str] = None
    foda_opportunities: Optional[str] = None
    foda_threats: Optional[str] = None
    target_margin_pct: Optional[float] = None
    target_wos_weeks: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class RetailCategoryOut(RetailCategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    parent_name: Optional[str] = None
    depth: int = 0
    # KPIs cacheados (calculados por el motor kpis_by_category)
    skus_count: int = 0
    stores_count: int = 0
    total_units_sold: int = 0
    total_revenue: float = 0.0
    total_returns_units: int = 0
    avg_wos_weeks: Optional[float] = None
    return_rate_pct: float = 0.0
    created_at: Optional[datetime] = None


class RetailCategoryTreeNode(RetailCategoryOut):
    children: List["RetailCategoryTreeNode"] = Field(default_factory=list)


class CategoryKPIs(BaseModel):
    category_id: int
    code: str
    name: str
    priority: str
    skus_count: int
    stores_count: int
    total_units_sold: int
    total_revenue: float
    total_returns_units: int
    return_rate_pct: float
    avg_wos_weeks: Optional[float] = None
    # Top 5 SKUs por revenue en la categoría (para drilldown)
    top_skus: List[dict] = Field(default_factory=list)


class CategoryDashboardResponse(BaseModel):
    generated_at: datetime
    days: int
    total_categories: int
    total_revenue: float
    priorities: dict     # {A: {revenue, units, ...}, B: {...}, C: {...}}
    categories: List[CategoryKPIs]


# ── Never Be Out (must-have) ────────────────────────────────────────────

class MustHaveSKU(BaseModel):
    """Un SKU marcado como must-have para retail."""
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    is_must_have: bool = True
    # Estado de servicio actual — por tienda con consignación
    stores_covered: int      # tiendas donde tenemos stock > 0
    stores_stockout: int     # tiendas donde stock = 0 con velocidad > 0
    coverage_pct: float      # stores_covered / total_stores × 100
    total_on_hand: int
    weekly_velocity: float
    wos_weeks: float


class MustHaveSummary(BaseModel):
    generated_at: datetime
    total_must_haves: int
    fully_covered: int              # todas las tiendas con stock
    partial_coverage: int           # algunas con stock, otras no
    stockout_critical: int          # 0 tiendas con stock y hay ventas
    avg_coverage_pct: float
    skus: List[MustHaveSKU]


class MustHaveToggle(BaseModel):
    variant_id: int
    is_must_have: bool


# ── Matriz Get Blue (velocity × margen) ─────────────────────────────────

class GetBlueRow(BaseModel):
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    units_sold: int
    weekly_velocity: float
    revenue: float
    cogs: float                    # costo total
    margin: float                  # revenue - cogs
    margin_pct: float              # margin / revenue × 100
    quadrant: str                  # star | cash_cow | question_mark | dog
    is_must_have: bool = False


class GetBlueQuadrant(BaseModel):
    key: str                       # star | cash_cow | question_mark | dog
    label: str
    action: str                    # qué hacer con estos SKUs
    color: str
    skus_count: int
    total_revenue: float
    total_margin: float
    avg_margin_pct: float
    avg_velocity: float


class GetBlueResponse(BaseModel):
    generated_at: datetime
    days: int
    channel_id: Optional[int] = None
    velocity_threshold: float      # cut point de velocity (mediana)
    margin_threshold: float        # cut point de margen (mediana)
    total_skus: int
    total_revenue: float
    total_margin: float
    quadrants: List[GetBlueQuadrant]
    rows: List[GetBlueRow]


# ── Diagnóstico de costos (Get Blue) ────────────────────────────────────

class CostMovementRow(BaseModel):
    movement_id: int
    warehouse_id: int
    warehouse_name: Optional[str] = None
    movement_type: str
    quantity: int
    unit_cost: Optional[float] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None


class CostLotRow(BaseModel):
    lot_id: int
    warehouse_id: int
    warehouse_name: Optional[str] = None
    quantity_received: int
    quantity_remaining: int
    unit_cost: float
    reference: Optional[str] = None
    received_at: Optional[datetime] = None
    weight_in_avg_pct: float     # cuánto pesa este lote en el promedio actual


class CostDiagnosticRow(BaseModel):
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    category: Optional[str] = None
    # Datos del catálogo
    current_cost_price: float
    manual_price: float           # precio de venta manual del variant
    # Datos del sell-out (agregado ventana)
    units_sold: int
    total_revenue: float
    unit_price_reported: float   # revenue / units_sold
    # Márgenes calculados
    margin_per_unit: float       # unit_price_reported - current_cost_price
    margin_pct: float
    # Suspechas identificadas automáticamente
    flags: List[str] = Field(default_factory=list)
    # Detalle para auditoría
    recent_ins: List[CostMovementRow] = Field(default_factory=list)
    live_lots: List[CostLotRow] = Field(default_factory=list)


class CostDiagnosticResponse(BaseModel):
    generated_at: datetime
    days: int
    channel_id: Optional[int] = None
    total_skus_analyzed: int
    skus_with_negative_margin: int
    skus_missing_cost: int
    skus_cost_higher_than_price: int
    rows: List[CostDiagnosticRow]
