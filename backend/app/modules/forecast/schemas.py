"""Pydantic v2 schemas para el módulo Forecast."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Planes ───────────────────────────────────────────────────────────────────

class ForecastPlanBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    year: int = Field(ge=2000, le=2100)
    growth_pct: float = Field(default=0.0)
    status: str = Field(default="draft", pattern="^(draft|active|closed)$")
    notes: Optional[str] = None


class ForecastPlanCreate(ForecastPlanBase):
    owner_user_id: Optional[int] = None


class ForecastPlanUpdate(BaseModel):
    name: Optional[str] = None
    year: Optional[int] = None
    growth_pct: Optional[float] = None
    status: Optional[str] = Field(default=None, pattern="^(draft|active|closed)$")
    notes: Optional[str] = None
    owner_user_id: Optional[int] = None


class ForecastPlanInDB(ForecastPlanBase):
    id: int
    owner_user_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Líneas ───────────────────────────────────────────────────────────────────

class ForecastLineBase(BaseModel):
    customer_id: Optional[int] = None
    variant_id: Optional[int] = None
    salesperson_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    customer_name: Optional[str] = None
    salesperson_name: Optional[str] = None
    unit_price: float = Field(default=0.0, ge=0)
    m1: int = Field(default=0, ge=0)
    m2: int = Field(default=0, ge=0)
    m3: int = Field(default=0, ge=0)
    m4: int = Field(default=0, ge=0)
    m5: int = Field(default=0, ge=0)
    m6: int = Field(default=0, ge=0)
    m7: int = Field(default=0, ge=0)
    m8: int = Field(default=0, ge=0)
    m9: int = Field(default=0, ge=0)
    m10: int = Field(default=0, ge=0)
    m11: int = Field(default=0, ge=0)
    m12: int = Field(default=0, ge=0)


class ForecastLineCreate(ForecastLineBase):
    pass


class ForecastLineUpdate(BaseModel):
    customer_id: Optional[int] = None
    variant_id: Optional[int] = None
    salesperson_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    customer_name: Optional[str] = None
    salesperson_name: Optional[str] = None
    unit_price: Optional[float] = Field(default=None, ge=0)
    m1: Optional[int] = None
    m2: Optional[int] = None
    m3: Optional[int] = None
    m4: Optional[int] = None
    m5: Optional[int] = None
    m6: Optional[int] = None
    m7: Optional[int] = None
    m8: Optional[int] = None
    m9: Optional[int] = None
    m10: Optional[int] = None
    m11: Optional[int] = None
    m12: Optional[int] = None


class ForecastLineInDB(ForecastLineBase):
    id: int
    plan_id: int
    # Totales derivados (calculados en el servicio)
    total_units: int = 0
    total_amount: float = 0.0
    model_config = ConfigDict(from_attributes=True)


# ── Baseline (desde historial real) ──────────────────────────────────────────

class BaselineRequest(BaseModel):
    plan_id: int
    year_source: Optional[int] = Field(
        default=None,
        description="Año calendario a leer del historial. Si es None se usa (year del plan)-1.",
    )
    growth_pct: Optional[float] = Field(
        default=None,
        description="Sobre-escribe el growth_pct del plan si viene aquí.",
    )
    customer_id: Optional[int] = None
    salesperson_id: Optional[int] = None
    replace: bool = Field(
        default=False,
        description=(
            "Si True borra todas las líneas del plan antes de generar. "
            "Si False solo agrega (comportamiento por defecto)."
        ),
    )


class BaselineResponse(BaseModel):
    plan_id: int
    year_source: int
    growth_pct: float
    lines_created: int
    lines_deleted: int
    lines: List[ForecastLineInDB]


# ── Rollup ───────────────────────────────────────────────────────────────────

class RollupRow(BaseModel):
    key: str                   # id o etiqueta ("cust:123", "var:45", "user:7", "text:Servicio")
    label: str
    units: int
    amount: float


class RollupResponse(BaseModel):
    plan_id: int
    by_customer: List[RollupRow]
    by_product: List[RollupRow]
    by_salesperson: List[RollupRow]
    monthly_amount: List[float]  # 12 posiciones
    monthly_units: List[int]     # 12 posiciones
    total_units: int
    total_amount: float


# ── Attainment (meta vs venta real) ──────────────────────────────────────────

class AttainmentMonth(BaseModel):
    month: int
    goal_amount: float
    real_amount: float
    attainment_pct: float


class AttainmentResponse(BaseModel):
    plan_id: int
    year: int
    months: List[AttainmentMonth]
    goal_year: float
    real_year: float
    attainment_year_pct: float


# ── Goal for range (usado por el tablero) ────────────────────────────────────

class GoalForRangeResponse(BaseModel):
    goal_amount: float
    plan_id: Optional[int] = None
    plan_name: Optional[str] = None
    plan_year: Optional[int] = None
    months_covered: List[str] = Field(default_factory=list)  # ["2026-01", "2026-02", ...]


# ── Bulk import ─────────────────────────────────────────────────────────────

class ImportRowError(BaseModel):
    row: int
    reason: str


class ImportResponse(BaseModel):
    plan_id: int
    lines_created: int
    lines_skipped: int
    errors: List[ImportRowError] = Field(default_factory=list)
    lines: List[ForecastLineInDB] = Field(default_factory=list)
