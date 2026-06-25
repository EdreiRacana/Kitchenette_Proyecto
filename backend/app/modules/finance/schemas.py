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


class TransactionUpdate(BaseModel):
    type: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    reference: Optional[str] = None


class TransactionInDB(TransactionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FinanceDashboard(BaseModel):
    total_income: float
    total_expenses: float
    net_profit: float
    transaction_count: int


# --- CXC / CXP ---
class AgingItem(BaseModel):
    id: int
    name: str          # customer or supplier
    reference: str     # folio / concept
    total: float
    paid: float
    balance: float
    due_date: Optional[datetime] = None
    aging: str          # current | 1-30 | 31-60 | 61-90 | 90+
    status: str          # pending | partial | overdue | paid


class PayDebtRequest(BaseModel):
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None


# --- Bank accounts ---
class BankAccountBase(BaseModel):
    name: str
    bank: Optional[str] = None
    account_number: Optional[str] = None
    type: str = "checking"
    balance: float = 0.0
    currency: str = "MXN"
    is_active: Optional[bool] = True


class BankAccountCreate(BankAccountBase):
    pass


class BankAccountInDB(BankAccountBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BankTransactionCreate(BaseModel):
    type: str  # deposit, withdrawal
    amount: float
    description: Optional[str] = None
    reference: Optional[str] = None


class BankTransferCreate(BaseModel):
    to_account_id: int
    amount: float
    description: Optional[str] = None


class BankTransactionInDB(BaseModel):
    id: int
    bank_account_id: int
    type: str
    amount: float
    description: Optional[str] = None
    reference: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FlowPoint(BaseModel):
    period: str
    income: float
    expenses: float
    net: float
