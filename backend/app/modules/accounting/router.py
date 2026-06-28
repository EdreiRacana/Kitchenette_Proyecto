"""REST API — Contabilidad (Fase 1). Protegido por el write-guard de 'accounting'."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.accounting import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Catálogo de cuentas ───────────────────────────────────────────────────────

@router.get("/accounts", response_model=List[schemas.AccountInDB])
async def list_accounts(db: DB, _: CurrentUser, only_active: bool = False):
    return await service.list_accounts(db, only_active=only_active)


@router.post("/accounts/seed-default")
async def seed_default(db: DB, _: CurrentUser):
    created = await service.seed_default_chart(db)
    mapped = await service.ensure_default_map(db)
    return {"created": created, "mapped": mapped}


# ── Configuración contable: mapeo de cuentas para pólizas automáticas ──────────

@router.get("/config/account-map", response_model=List[schemas.AccountMapItem])
async def get_account_map(db: DB, _: CurrentUser):
    await service.ensure_default_map(db)
    return await service.list_account_map(db)


@router.put("/config/account-map")
async def update_account_map(data: schemas.AccountMapUpdate, db: DB, _: CurrentUser):
    await service.set_account_map(db, {k: v for k, v in data.mapping.items()})
    return {"ok": True}


@router.post("/accounts", response_model=schemas.AccountInDB, status_code=201)
async def create_account(data: schemas.AccountCreate, db: DB, _: CurrentUser):
    try:
        return await service.create_account(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/accounts/{account_id}", response_model=schemas.AccountInDB)
async def update_account(account_id: int, data: schemas.AccountUpdate, db: DB, _: CurrentUser):
    acc = await service.update_account(db, account_id, data)
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return acc


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: int, db: DB, _: CurrentUser):
    try:
        ok = await service.delete_account(db, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")


# ── Pólizas ───────────────────────────────────────────────────────────────────

@router.get("/entries", response_model=List[schemas.JournalEntryInDB])
async def list_entries(db: DB, _: CurrentUser, skip: int = 0, limit: int = Query(100, ge=1, le=500),
                       status: Optional[str] = None, entry_type: Optional[str] = None,
                       date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.list_entries(db, skip=skip, limit=limit, status=status,
                                      entry_type=entry_type, date_from=date_from, date_to=date_to)


@router.post("/entries", response_model=schemas.JournalEntryDetail, status_code=201)
async def create_entry(data: schemas.JournalEntryCreate, db: DB, user: CurrentUser):
    try:
        return await service.create_entry(db, data, user_id=user.id, branch_id=getattr(user, "branch_id", None))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/entries/{entry_id}", response_model=schemas.JournalEntryDetail)
async def get_entry(entry_id: int, db: DB, _: CurrentUser):
    e = await service.get_entry(db, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Póliza no encontrada")
    return e


@router.post("/entries/{entry_id}/cancel", response_model=schemas.JournalEntryDetail)
async def cancel_entry(entry_id: int, db: DB, _: CurrentUser):
    e = await service.cancel_entry(db, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Póliza no encontrada")
    return e


# ── Mayor / auxiliar ──────────────────────────────────────────────────────────

@router.get("/ledger/{account_id}", response_model=schemas.LedgerReport)
async def ledger(account_id: int, db: DB, _: CurrentUser,
                 date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    rep = await service.ledger(db, account_id, date_from=date_from, date_to=date_to)
    if not rep:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return rep


# ── Estados financieros (Fase 2) ──────────────────────────────────────────────

@router.get("/reports/trial-balance", response_model=schemas.TrialBalance)
async def trial_balance(db: DB, _: CurrentUser,
                        date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.trial_balance(db, date_from=date_from, date_to=date_to)


@router.get("/reports/balance-sheet", response_model=schemas.BalanceSheet)
async def balance_sheet(db: DB, _: CurrentUser, as_of: Optional[datetime] = None):
    return await service.balance_sheet(db, as_of=as_of)


@router.get("/reports/income-statement", response_model=schemas.IncomeStatement)
async def income_statement(db: DB, _: CurrentUser,
                           date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.income_statement(db, date_from=date_from, date_to=date_to)
