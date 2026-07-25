from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict, field_validator


class PromotionItemIn(BaseModel):
    variant_id: int
    promo_price: Optional[float] = None
    discount_pct: Optional[float] = None


class PromotionCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = None
    start_date: datetime
    end_date: datetime
    expected_uplift_pct: float = Field(50.0, ge=-100.0, le=1000.0)
    baseline_lookback_days: int = Field(30, ge=7, le=365)
    lead_time_days: int = Field(5, ge=0, le=60)
    notes: Optional[str] = None
    items: List[PromotionItemIn] = Field(default_factory=list)
    warehouse_ids: List[int] = Field(default_factory=list)

    @field_validator("end_date")
    @classmethod
    def _end_after_start(cls, v, info):
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("La fecha de fin no puede ser anterior a la fecha de inicio")
        return v

    @field_validator("items")
    @classmethod
    def _items_not_empty(cls, v):
        if not v:
            raise ValueError("Debe incluir al menos un producto en la promoción")
        return v

    @field_validator("warehouse_ids")
    @classmethod
    def _stores_not_empty(cls, v):
        if not v:
            raise ValueError("Debe incluir al menos una tienda destino")
        return v


class PromotionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    expected_uplift_pct: Optional[float] = Field(None, ge=-100.0, le=1000.0)
    baseline_lookback_days: Optional[int] = Field(None, ge=7, le=365)
    lead_time_days: Optional[int] = Field(None, ge=0, le=60)
    status: Optional[str] = None
    notes: Optional[str] = None


class MaterializePayload(BaseModel):
    suggestion_ids: Optional[List[int]] = None


class PromotionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    variant_id: int
    sku: Optional[str] = None
    product_name: Optional[str] = None
    promo_price: Optional[float] = None
    discount_pct: Optional[float] = None


class PromotionStoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    warehouse_id: int
    warehouse_name: Optional[str] = None


class PromotionSuggestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    variant_id: int
    source_warehouse_id: Optional[int] = None
    destination_warehouse_id: int
    baseline_daily_velocity: float
    expected_units_during_promo: float
    current_stock: int
    quantity_suggested: int
    shortage_flag: Optional[str] = None
    note: Optional[str] = None
    transfer_id: Optional[int] = None
    computed_at: Optional[datetime] = None


class PromotionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    folio: Optional[str] = None
    name: str
    description: Optional[str] = None
    start_date: datetime
    end_date: datetime
    expected_uplift_pct: float
    baseline_lookback_days: int
    lead_time_days: int
    status: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    items: List[PromotionItemOut] = Field(default_factory=list)
    stores: List[PromotionStoreOut] = Field(default_factory=list)
    suggestions: List[PromotionSuggestionOut] = Field(default_factory=list)
