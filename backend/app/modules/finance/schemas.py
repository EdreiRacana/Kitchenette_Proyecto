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


class BankAccountUpdate(BaseModel):
    name: Optional[str] = None
    bank: Optional[str] = None
    account_number: Optional[str] = None
    type: Optional[str] = None
    balance: Optional[float] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None


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


# --- Pagos programados (CXC/CXP a futuro) ---
class ScheduledPaymentCreate(BaseModel):
    kind: str  # cxc, cxp
    target_id: int
    target_name: Optional[str] = None
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    scheduled_date: datetime


class ScheduledPaymentInDB(BaseModel):
    id: int
    kind: str
    target_id: int
    target_name: Optional[str] = None
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    scheduled_date: datetime
    status: str
    error: Optional[str] = None
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


# --- Cuentas por Pagar / SupplierBill ---

class SupplierBillBase(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    supplier_folio: Optional[str] = None
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    payment_terms: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    currency: str = "MXN"
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total_amount: float = 0.0
    attachment_url: Optional[str] = None


class SupplierBillCreate(SupplierBillBase):
    pass


class SupplierBillUpdate(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    supplier_folio: Optional[str] = None
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    payment_terms: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    subtotal: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    attachment_url: Optional[str] = None
    status: Optional[str] = None


class BillPaymentInDB(BaseModel):
    id: int
    bill_id: int
    transaction_id: Optional[int] = None
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    bank_account_id: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupplierBillInDB(SupplierBillBase):
    id: int
    folio: Optional[str] = None
    paid_amount: float
    balance: float
    status: str
    aging: str                # current | 1-30 | 31-60 | 61-90 | 90+
    days_to_due: Optional[int] = None  # negativo si ya venció
    late_fee: float = 0.0
    reminder_sent_at: Optional[datetime] = None
    created_at: datetime
    paid_at: Optional[datetime] = None
    payments: List[BillPaymentInDB] = []

    model_config = ConfigDict(from_attributes=True)


class BillAllocation(BaseModel):
    bill_id: int
    amount: float


class BillPayRequest(BaseModel):
    """Un pago consolidado: se crea UNA Transaction de egreso y se reparte
    entre varias bills mediante `allocations`. Si el total de allocations es
    menor al `amount`, el remanente queda como egreso 'directo' sin bill."""
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    bank_account_id: Optional[int] = None
    payment_date: Optional[datetime] = None
    allocations: List[BillAllocation]


class BillPayResponse(BaseModel):
    transaction_id: Optional[int]
    total_paid: float
    bills: List[SupplierBillInDB]


class BillsStats(BaseModel):
    total_open: float          # saldo total abierto
    overdue: float             # saldo vencido
    upcoming_7d: float          # saldo que vence en <= 7 dias
    active_suppliers: int
    next_due_date: Optional[datetime] = None
    next_due_bill_id: Optional[int] = None
    next_due_bill_supplier: Optional[str] = None


class BillReminderResult(BaseModel):
    bill_id: int
    notified: bool
    reminder_sent_at: Optional[datetime] = None


# --- Auditoría ---
class AuditLogItem(BaseModel):
    id: str
    action: str
    description: Optional[str] = None
    details: Optional[dict] = None
    user_id: Optional[int] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
