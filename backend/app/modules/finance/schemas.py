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
    created_by_id: Optional[int] = None
    attachment_url: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FinanceDashboard(BaseModel):
    total_income: float
    total_expenses: float
    net_profit: float
    transaction_count: int
    projected_balance: Optional[float] = None
    bank_balance: Optional[float] = None
    cxc_balance: Optional[float] = None
    cxp_balance: Optional[float] = None


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
    late_fee: float = 0.0


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
    reconciled: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReconcileRequest(BaseModel):
    reconciled: bool = True


class FlowPoint(BaseModel):
    period: str
    income: float
    expenses: float
    net: float


# --- Importación de estados de cuenta ---
class BankImportRowError(BaseModel):
    row: int
    error: str


class BankImportResult(BaseModel):
    total_rows: int
    imported: int
    skipped_duplicates: int
    errors: List[BankImportRowError] = []
    new_balance: float


# --- Presupuestos ---
class BudgetBase(BaseModel):
    category: str
    type: str = "expense"  # income, expense
    period: str  # "YYYY-MM"
    amount: float


class BudgetCreate(BudgetBase):
    pass


class BudgetInDB(BudgetBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BudgetComparisonItem(BaseModel):
    category: str
    type: str
    period: str
    budgeted: float
    actual: float
    variance: float
    percent_used: float


# --- Transacciones recurrentes ---
class RecurringTransactionBase(BaseModel):
    type: str  # income, expense
    amount: float
    category: Optional[str] = None
    description: Optional[str] = None
    frequency: str = "monthly"  # weekly, monthly
    next_run_date: datetime
    is_active: bool = True


class RecurringTransactionCreate(RecurringTransactionBase):
    pass


class RecurringTransactionUpdate(BaseModel):
    type: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    frequency: Optional[str] = None
    next_run_date: Optional[datetime] = None
    is_active: Optional[bool] = None


class RecurringTransactionInDB(RecurringTransactionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Reportes ---
class PnLCategory(BaseModel):
    category: str
    amount: float


class PnLReport(BaseModel):
    period_start: datetime
    period_end: datetime
    total_income: float
    total_expenses: float
    net_profit: float
    income_by_category: List[PnLCategory] = []
    expenses_by_category: List[PnLCategory] = []


class PeriodComparison(BaseModel):
    current: PnLReport
    previous: PnLReport
    income_change_pct: Optional[float] = None
    expenses_change_pct: Optional[float] = None
    net_change_pct: Optional[float] = None


# --- Auditoría ---
class AuditLogItem(BaseModel):
    id: str
    action: str
    description: Optional[str] = None
    details: Optional[dict] = None
    user_id: Optional[int] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
