from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class OrderItemBase(BaseModel):
    variant_id: int
    quantity: int = 1
    unit_price: float


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemInDB(OrderItemBase):
    id: int
    order_id: int
    subtotal: float

    model_config = ConfigDict(from_attributes=True)


class OrderBase(BaseModel):
    customer_id: Optional[int] = None
    payment_method: Optional[str] = None
    status: Optional[str] = "completed"
    notes: Optional[str] = None


class OrderCreate(OrderBase):
    items: List[OrderItemCreate]


class OrderUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None


class OrderInDB(OrderBase):
    id: int
    total_amount: float
    user_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    items: List[OrderItemInDB] = []

    model_config = ConfigDict(from_attributes=True)
