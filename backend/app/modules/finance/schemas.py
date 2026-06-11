from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


class TransactionBase(BaseModel):
    type: str  # income, expense
    amount: float
    category: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None


class TransactionCreate(TransactionBase):
    pass


class TransactionInDB(TransactionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FinanceDashboard(BaseModel):
    total_income: float
    total_expenses: float
    net_profit: float
    transaction_count: int
