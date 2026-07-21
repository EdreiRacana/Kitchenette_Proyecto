"""Pydantic v2 schemas — Contabilidad."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ── Cuentas ───────────────────────────────────────────────────────────────────

class AccountBase(BaseModel):
    code: str
    name: str
    account_type: Literal["activo", "pasivo", "capital", "ingreso", "costo", "gasto", "orden"]
    nature: Literal["deudora", "acreedora"] = "deudora"
    parent_id: Optional[int] = None
    sat_code: Optional[str] = None
    is_postable: bool = True
    is_active: bool = True


class AccountCreate(AccountBase):
    pass


class AccountUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    account_type: Optional[str] = None
    nature: Optional[str] = None
    parent_id: Optional[int] = None
    sat_code: Optional[str] = None
    is_postable: Optional[bool] = None
    is_active: Optional[bool] = None


class AccountInDB(AccountBase):
    id: int
    level: int
    branch_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ── Pólizas ───────────────────────────────────────────────────────────────────

class JournalLineCreate(BaseModel):
    account_id: int
    debit: float = Field(default=0.0, ge=0)
    credit: float = Field(default=0.0, ge=0)
    description: Optional[str] = None


class JournalEntryCreate(BaseModel):
    date: Optional[datetime] = None
    entry_type: Literal["ingreso", "egreso", "diario"] = "diario"
    concept: Optional[str] = None
    lines: List[JournalLineCreate] = Field(min_length=2)


class JournalLineInDB(BaseModel):
    id: int
    account_id: int
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    debit: float
    credit: float
    description: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class JournalEntryInDB(BaseModel):
    id: int
    folio: Optional[str] = None
    date: datetime
    entry_type: str
    concept: Optional[str] = None
    source: str
    status: str
    total_debit: float
    total_credit: float
    branch_id: Optional[int] = None
    user_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class JournalEntryDetail(JournalEntryInDB):
    lines: List[JournalLineInDB] = []


# ── Mayor / auxiliar ──────────────────────────────────────────────────────────

class LedgerMovement(BaseModel):
    entry_id: int
    folio: Optional[str] = None
    date: datetime
    concept: Optional[str] = None
    debit: float
    credit: float
    balance: float


class LedgerReport(BaseModel):
    account_id: int
    account_code: str
    account_name: str
    nature: str
    opening_balance: float
    total_debit: float
    total_credit: float
    closing_balance: float
    movements: List[LedgerMovement] = []


# ── Estados financieros (Fase 2) ──────────────────────────────────────────────

class ReportLine(BaseModel):
    account_id: int
    code: str
    name: str
    level: int = 1
    amount: float


class TrialBalanceRow(BaseModel):
    account_id: int
    code: str
    name: str
    level: int
    is_postable: bool
    nature: str
    saldo_inicial: float
    cargos: float
    abonos: float
    saldo_final: float


class TrialBalance(BaseModel):
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    rows: List[TrialBalanceRow] = []
    total_cargos: float
    total_abonos: float


class BalanceSheet(BaseModel):
    as_of: Optional[datetime] = None
    activo: List[ReportLine] = []
    total_activo: float
    pasivo: List[ReportLine] = []
    total_pasivo: float
    capital: List[ReportLine] = []
    resultado_ejercicio: float
    total_capital: float
    balanced: bool
    difference: float


class IncomeStatement(BaseModel):
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    ingresos: List[ReportLine] = []
    total_ingresos: float
    costos: List[ReportLine] = []
    total_costos: float
    gastos: List[ReportLine] = []
    total_gastos: float
    utilidad_bruta: float
    utilidad_neta: float


# ── Mapeo de cuentas (Fase 3) ─────────────────────────────────────────────────

class AccountMapItem(BaseModel):
    role: str
    label: str
    account_id: Optional[int] = None
    account_code: Optional[str] = None
    account_name: Optional[str] = None


class AccountMapUpdate(BaseModel):
    mapping: dict[str, Optional[int]]


# ── Políticas contables (Fase 4) ──────────────────────────────────────────────

class WithholdingRate(BaseModel):
    isr: float = 0.0
    iva: float = 0.0


class AccountingPolicyIn(BaseModel):
    """Payload para crear/actualizar la política vigente. Todos los campos son
    opcionales — se conservan los valores actuales cuando no se envían."""
    iva_acreditable_scheme: Optional[str] = None  # pending_payment | direct_paid
    iva_trasladado_scheme: Optional[str] = None   # pending_collection | direct_collected
    cogs_scheme: Optional[str] = None             # perpetual | analytic
    purchase_recognition: Optional[str] = None    # on_receive | on_bill | on_pay
    payroll_scheme: Optional[str] = None          # itemized | consolidated | admin_expense
    expense_basis: Optional[str] = None           # accrual | cash
    withholding_enabled: Optional[bool] = None
    withholding_rates: Optional[dict] = None      # {"honorarios": {"isr":10,"iva":10.67}, ...}
    fx_scheme: Optional[str] = None               # transaction_date | month_end_close
    labor_benefits_scheme: Optional[str] = None   # monthly_provision | at_payment
    depreciation_scheme: Optional[str] = None     # straight_line_monthly | manual
    effective_from: Optional[datetime] = None
    branch_id: Optional[int] = None
    notes: Optional[str] = None

    @field_validator("iva_acreditable_scheme")
    @classmethod
    def _v_iva_acr(cls, v):
        if v is not None and v not in ("pending_payment", "direct_paid"):
            raise ValueError("iva_acreditable_scheme debe ser 'pending_payment' o 'direct_paid'")
        return v

    @field_validator("iva_trasladado_scheme")
    @classmethod
    def _v_iva_tras(cls, v):
        if v is not None and v not in ("pending_collection", "direct_collected"):
            raise ValueError("iva_trasladado_scheme debe ser 'pending_collection' o 'direct_collected'")
        return v

    @field_validator("cogs_scheme")
    @classmethod
    def _v_cogs(cls, v):
        if v is not None and v not in ("perpetual", "analytic"):
            raise ValueError("cogs_scheme debe ser 'perpetual' o 'analytic'")
        return v

    @field_validator("purchase_recognition")
    @classmethod
    def _v_purchase(cls, v):
        if v is not None and v not in ("on_receive", "on_bill", "on_pay"):
            raise ValueError("purchase_recognition debe ser 'on_receive', 'on_bill' o 'on_pay'")
        return v

    @field_validator("payroll_scheme")
    @classmethod
    def _v_payroll(cls, v):
        if v is not None and v not in ("itemized", "consolidated", "admin_expense"):
            raise ValueError("payroll_scheme debe ser 'itemized', 'consolidated' o 'admin_expense'")
        return v

    @field_validator("expense_basis")
    @classmethod
    def _v_expense(cls, v):
        if v is not None and v not in ("accrual", "cash"):
            raise ValueError("expense_basis debe ser 'accrual' o 'cash'")
        return v

    @field_validator("fx_scheme")
    @classmethod
    def _v_fx(cls, v):
        if v is not None and v not in ("transaction_date", "month_end_close"):
            raise ValueError("fx_scheme debe ser 'transaction_date' o 'month_end_close'")
        return v

    @field_validator("labor_benefits_scheme")
    @classmethod
    def _v_labor(cls, v):
        if v is not None and v not in ("monthly_provision", "at_payment"):
            raise ValueError("labor_benefits_scheme debe ser 'monthly_provision' o 'at_payment'")
        return v

    @field_validator("depreciation_scheme")
    @classmethod
    def _v_dep(cls, v):
        if v is not None and v not in ("straight_line_monthly", "manual"):
            raise ValueError("depreciation_scheme debe ser 'straight_line_monthly' o 'manual'")
        return v


class AccountingPolicyInDB(BaseModel):
    id: int
    branch_id: Optional[int] = None
    iva_acreditable_scheme: str
    iva_trasladado_scheme: str
    cogs_scheme: str
    purchase_recognition: str
    payroll_scheme: str
    expense_basis: str
    withholding_enabled: bool
    withholding_rates: Optional[dict] = None
    fx_scheme: str
    labor_benefits_scheme: str
    depreciation_scheme: str
    effective_from: datetime
    status: str
    superseded_at: Optional[datetime] = None
    superseded_by_id: Optional[int] = None
    notes: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
