"""Pydantic v2 schemas for the Sales / CRM module."""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Order items ──────────────────────────────────────────────────────────────

class OrderItemBase(BaseModel):
    variant_id: Optional[int] = None
    product_name: Optional[str] = None
    sku: Optional[str] = None
    quantity: int = Field(default=1, ge=1)
    unit_price: float = Field(ge=0)
    discount_amount: float = Field(default=0.0, ge=0)
    tax_rate: float = Field(default=0.0, ge=0)


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemInDB(OrderItemBase):
    id: int
    order_id: int
    subtotal: float
    total: float
    model_config = ConfigDict(from_attributes=True)


# ── Payments ──────────────────────────────────────────────────────────────────

class PaymentCreate(BaseModel):
    amount: float = Field(gt=0)
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None


class PaymentInDB(PaymentCreate):
    id: int
    order_id: int
    user_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Events / audit ──────────────────────────────────────────────────────────

class OrderEventInDB(BaseModel):
    id: int
    event_type: str
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    message: Optional[str] = None
    user_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Billing (CFDI) ────────────────────────────────────────────────────────────

class BillingInfo(BaseModel):
    bill_rfc: Optional[str] = None
    bill_name: Optional[str] = None
    bill_use: Optional[str] = None
    bill_regime: Optional[str] = None
    bill_zip: Optional[str] = None


# ── Orders ──────────────────────────────────────────────────────────────────

class OrderBase(BaseModel):
    kind: Literal["order", "quote"] = "order"
    customer_id: Optional[int] = None
    warehouse_id: Optional[int] = None
    payment_method: Optional[str] = None
    channel: Optional[str] = None
    currency: str = "MXN"
    status: Optional[str] = None

    discount_type: Literal["amount", "percent"] = "amount"
    discount_value: float = Field(default=0.0, ge=0)
    tax_rate: float = Field(default=0.0, ge=0)
    shipping_amount: float = Field(default=0.0, ge=0)

    due_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    notes: Optional[str] = None

    # billing snapshot (optional)
    bill_rfc: Optional[str] = None
    bill_name: Optional[str] = None
    bill_use: Optional[str] = None
    bill_regime: Optional[str] = None
    bill_zip: Optional[str] = None


class OrderCreate(OrderBase):
    items: List[OrderItemCreate]

    @field_validator("items")
    @classmethod
    def _non_empty(cls, v):
        if not v:
            raise ValueError("An order must contain at least one item")
        return v


class OrderUpdate(BaseModel):
    """Full edit of an order header + (optionally) its items."""
    customer_id: Optional[int] = None
    warehouse_id: Optional[int] = None
    payment_method: Optional[str] = None
    channel: Optional[str] = None
    status: Optional[str] = None
    discount_type: Optional[Literal["amount", "percent"]] = None
    discount_value: Optional[float] = Field(default=None, ge=0)
    tax_rate: Optional[float] = Field(default=None, ge=0)
    shipping_amount: Optional[float] = Field(default=None, ge=0)
    due_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    notes: Optional[str] = None
    bill_rfc: Optional[str] = None
    bill_name: Optional[str] = None
    bill_use: Optional[str] = None
    bill_regime: Optional[str] = None
    bill_zip: Optional[str] = None
    items: Optional[List[OrderItemCreate]] = None


class StatusUpdate(BaseModel):
    status: str
    message: Optional[str] = None


class CustomerLite(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class SellerLite(BaseModel):
    id: int
    full_name: Optional[str] = None
    email: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class OrderInDB(BaseModel):
    id: int
    folio: Optional[str] = None
    kind: str
    customer_id: Optional[int] = None
    user_id: Optional[int] = None
    warehouse_id: Optional[int] = None
    status: str
    payment_method: Optional[str] = None
    channel: Optional[str] = None
    currency: str

    subtotal: float
    discount_type: str
    discount_value: float
    discount_amount: float
    tax_rate: float
    tax_amount: float
    shipping_amount: float
    total_amount: float
    paid_amount: float
    balance: float = 0.0

    due_date: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    notes: Optional[str] = None

    bill_rfc: Optional[str] = None
    bill_name: Optional[str] = None
    bill_use: Optional[str] = None
    bill_regime: Optional[str] = None
    bill_zip: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    cfdi_status: Optional[str] = None
    invoiced_at: Optional[datetime] = None

    created_at: datetime
    updated_at: Optional[datetime] = None

    items: List[OrderItemInDB] = []
    payments: List[PaymentInDB] = []
    customer: Optional[CustomerLite] = None
    seller: Optional[SellerLite] = None

    model_config = ConfigDict(from_attributes=True)


class OrderDetail(OrderInDB):
    events: List[OrderEventInDB] = []


# ── Listing / pagination ──────────────────────────────────────────────────────

class PaginatedOrders(BaseModel):
    items: List[OrderInDB]
    total: int
    skip: int
    limit: int


# ── Analytics ─────────────────────────────────────────────────────────────────

class SalesStats(BaseModel):
    total_sold: float          # paid revenue
    orders_count: int
    pending_orders: int
    pending_amount: float      # accounts receivable
    paid_rate: float           # % of orders fully paid
    avg_ticket: float
    quotes_count: int


class TrendPoint(BaseModel):
    period: str
    total: float
    count: int


class TopCustomer(BaseModel):
    customer_id: Optional[int] = None
    name: str
    total: float
    orders: int


class TopProduct(BaseModel):
    variant_id: Optional[int] = None
    name: str
    quantity: int
    total: float


class SalesBySeller(BaseModel):
    user_id: Optional[int] = None
    name: str
    total: float
    orders: int


class SalesByChannel(BaseModel):
    channel: str
    total: float
    orders: int


class Customer360(BaseModel):
    customer: CustomerLite
    total_spent: float
    orders_count: int
    open_balance: float
    avg_ticket: float
    last_order_at: Optional[datetime] = None
    recent_orders: List[OrderInDB] = []
