"""Pydantic v2 schemas — Contabilidad."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, ConfigDict, Field


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
