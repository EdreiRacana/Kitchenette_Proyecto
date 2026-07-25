from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict


class TierIn(BaseModel):
    name: str = Field(..., min_length=1)
    color_hex: Optional[str] = None
    rank: int = 0
    discount_pct: float = Field(0.0, ge=0.0, le=100.0)
    min_spend: float = Field(0.0, ge=0.0)
    min_orders: int = Field(0, ge=0)
    min_avg_ticket: float = Field(0.0, ge=0.0)
    perks: Optional[str] = None
    is_active: bool = True


class TierUpdate(BaseModel):
    name: Optional[str] = None
    color_hex: Optional[str] = None
    rank: Optional[int] = None
    discount_pct: Optional[float] = Field(None, ge=0.0, le=100.0)
    min_spend: Optional[float] = Field(None, ge=0.0)
    min_orders: Optional[int] = Field(None, ge=0)
    min_avg_ticket: Optional[float] = Field(None, ge=0.0)
    perks: Optional[str] = None
    is_active: Optional[bool] = None


class TierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color_hex: Optional[str] = None
    rank: int
    discount_pct: float
    min_spend: float
    min_orders: int
    min_avg_ticket: float
    perks: Optional[str] = None
    is_active: bool


class ProgramConfigUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    program_name: Optional[str] = None
    tagline: Optional[str] = None
    tier_lookback_months: Optional[int] = Field(None, ge=1, le=120)
    card_validity_days: Optional[int] = Field(None, ge=30, le=3650)
    recalc_on_each_sale: Optional[bool] = None
    card_bg_color: Optional[str] = None
    card_text_color: Optional[str] = None
    card_accent_color: Optional[str] = None
    privacy_policy_url: Optional[str] = None
    privacy_policy_text: Optional[str] = None
    birthday_email_enabled: Optional[bool] = None
    birthday_email_subject: Optional[str] = None
    birthday_email_body: Optional[str] = None


class ProgramConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    is_enabled: bool
    program_name: str
    tagline: Optional[str] = None
    tier_lookback_months: Optional[int] = None
    card_validity_days: int
    recalc_on_each_sale: bool
    card_bg_color: str
    card_text_color: str
    card_accent_color: str
    privacy_policy_url: Optional[str] = None
    privacy_policy_text: Optional[str] = None
    birthday_email_enabled: bool
    birthday_email_subject: str
    birthday_email_body: Optional[str] = None


class QuickRegisterPayload(BaseModel):
    """Registro rápido desde el POS (modo Registro Cliente)."""
    name: str = Field(..., min_length=1)
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[datetime] = None
    sex: Optional[str] = None
    codigo_postal: Optional[str] = None
    how_heard: Optional[str] = None
    rfc: Optional[str] = None
    accepts_marketing: bool = False
    privacy_accepted: bool = False
