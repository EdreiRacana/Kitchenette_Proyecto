"""Pydantic v2 schemas para el módulo Retail."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

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
    alerts_enabled: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RetailChannelOut(RetailChannelBase):
    id: int
    customer_name: Optional[str] = None
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
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RetailStoreOut(RetailStoreBase):
    id: int
    channel_id: int
    channel_name: Optional[str] = None
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
    store_id: int
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    period_start: datetime
    period_end: datetime
    period_type: str = Field(default="week", pattern="^(day|week|month)$")
    units_sold: int = Field(default=0, ge=0)
    units_on_hand: int = Field(default=0, ge=0)
    revenue: float = Field(default=0.0, ge=0)
    notes: Optional[str] = None


class SellOutReportCreate(SellOutReportBase):
    source: str = Field(default="manual", pattern="^(manual|csv|excel|edi|api)$")


class SellOutReportUpdate(BaseModel):
    units_sold: Optional[int] = Field(default=None, ge=0)
    units_on_hand: Optional[int] = Field(default=None, ge=0)
    revenue: Optional[float] = Field(default=None, ge=0)
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
    total_on_hand: int
    avg_wos_weeks: float              # promedio ponderado
    critical_stores_count: int        # tiendas con al menos 1 SKU en WOS < critical
    overstock_stores_count: int       # tiendas con al menos 1 SKU en WOS > overstock
    stores_active_count: int
    skus_active_count: int


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
