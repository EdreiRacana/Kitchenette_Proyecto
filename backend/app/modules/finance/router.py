import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from typing import List, Annotated, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.finance import schemas, service
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]

UPLOAD_DIR = "uploads/finance"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _require_manager(current_user: User):
    if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Se requiere rol admin o manager para esta acción")


@router.get("/dashboard", response_model=schemas.FinanceDashboard)
async def read_dashboard(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    return await service.get_dashboard(db)


@router.post("/transactions", response_model=schemas.TransactionInDB)
async def create_transaction(
    tx_in: schemas.TransactionCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    return await service.create_transaction(db, tx_in, user_id=current_user.id)


@router.get("/transactions", response_model=List[schemas.TransactionInDB])
async def read_transactions(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    skip: int = 0,
    limit: int = 100,
    type: Optional[str] = None,
):
    return await service.get_transactions(db, skip=skip, limit=limit, type=type)


@router.put("/transactions/{tx_id}", response_model=schemas.TransactionInDB)
async def update_transaction(tx_id: int, tx_in: schemas.TransactionUpdate, db: DB, current_user: CurrentUser):
    tx = await service.update_transaction(db, tx_id, tx_in, user_id=current_user.id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx


@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    ok = await service.delete_transaction(db, tx_id, user_id=current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"ok": True}


@router.post("/transactions/{tx_id}/attachment", response_model=schemas.TransactionInDB)
async def upload_transaction_attachment(tx_id: int, db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1]
    safe = f"{tx_id}_{int(datetime.now().timestamp())}{ext}"
    path = os.path.join(UPLOAD_DIR, safe)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    tx = await service.set_transaction_attachment(db, tx_id, f"finance/{safe}", user_id=current_user.id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx


# --- CXC ---
@router.get("/cxc", response_model=List[schemas.AgingItem])
async def read_cxc(db: DB, current_user: CurrentUser):
    return await service.get_cxc(db)


LARGE_PAYMENT_THRESHOLD = 10000.0


@router.post("/cxc/{order_id}/pay")
async def pay_cxc(order_id: int, pay_in: schemas.PayDebtRequest, db: DB, current_user: CurrentUser):
    if pay_in.amount >= LARGE_PAYMENT_THRESHOLD:
        _require_manager(current_user)
    try:
        order = await service.pay_cxc(db, order_id, pay_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return {"ok": True, "balance": order.balance}


# --- CXP ---
@router.get("/cxp", response_model=List[schemas.AgingItem])
async def read_cxp(db: DB, current_user: CurrentUser):
    return await service.get_cxp(db)


@router.post("/cxp/{po_id}/pay")
async def pay_cxp(po_id: int, pay_in: schemas.PayDebtRequest, db: DB, current_user: CurrentUser):
    if pay_in.amount >= LARGE_PAYMENT_THRESHOLD:
        _require_manager(current_user)
    try:
        po = await service.pay_cxp(db, po_id, pay_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not po:
        raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
    return {"ok": True, "balance": po.balance}


# --- Bancos ---
@router.get("/banks", response_model=List[schemas.BankAccountInDB])
async def read_banks(db: DB, current_user: CurrentUser):
    return await service.get_banks(db)


@router.post("/banks", response_model=schemas.BankAccountInDB)
async def create_bank(bank_in: schemas.BankAccountCreate, db: DB, current_user: CurrentUser):
    return await service.create_bank(db, bank_in)


@router.delete("/banks/{bank_id}", response_model=schemas.BankAccountInDB)
async def deactivate_bank(bank_id: int, db: DB, current_user: CurrentUser):
    bank = await service.deactivate_bank(db, bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.get("/banks/{bank_id}/transactions", response_model=List[schemas.BankTransactionInDB])
async def read_bank_transactions(bank_id: int, db: DB, current_user: CurrentUser):
    return await service.get_bank_transactions(db, bank_id)


@router.post("/banks/{bank_id}/transactions", response_model=schemas.BankAccountInDB)
async def create_bank_transaction(bank_id: int, data: schemas.BankTransactionCreate, db: DB, current_user: CurrentUser):
    bank = await service.create_bank_transaction(db, bank_id, data)
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.post("/banks/{bank_id}/transfer", response_model=schemas.BankAccountInDB)
async def transfer_bank(bank_id: int, data: schemas.BankTransferCreate, db: DB, current_user: CurrentUser):
    try:
        bank = await service.transfer_between_banks(db, bank_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.post("/banks/{bank_id}/import", response_model=schemas.BankImportResult)
async def import_bank_statement(bank_id: int, db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read()
    try:
        result = await service.import_bank_statement(db, bank_id, content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return result


# --- Flujo de caja ---
@router.get("/cash-flow", response_model=List[schemas.FlowPoint])
async def read_cash_flow(db: DB, current_user: CurrentUser, months: int = 6):
    return await service.get_cash_flow(db, months=months)


# --- Conciliación bancaria ---
@router.put("/bank-transactions/{movement_id}/reconcile", response_model=schemas.BankTransactionInDB)
async def reconcile_movement(movement_id: int, data: schemas.ReconcileRequest, db: DB, current_user: CurrentUser):
    mv = await service.toggle_reconciled(db, movement_id, data.reconciled)
    if not mv:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    return mv


# --- Presupuestos ---
@router.get("/budgets", response_model=List[schemas.BudgetInDB])
async def read_budgets(db: DB, current_user: CurrentUser, period: Optional[str] = None):
    return await service.get_budgets(db, period=period)


@router.post("/budgets", response_model=schemas.BudgetInDB)
async def create_budget(data: schemas.BudgetCreate, db: DB, current_user: CurrentUser):
    return await service.create_budget(db, data)


@router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_budget(db, budget_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    return {"ok": True}


@router.get("/budgets/comparison", response_model=List[schemas.BudgetComparisonItem])
async def read_budget_comparison(db: DB, current_user: CurrentUser, period: str):
    return await service.get_budget_comparison(db, period)


# --- Transacciones recurrentes ---
@router.get("/recurring", response_model=List[schemas.RecurringTransactionInDB])
async def read_recurring(db: DB, current_user: CurrentUser):
    await service.process_due_recurring_transactions(db)
    return await service.get_recurring_transactions(db)


@router.post("/recurring", response_model=schemas.RecurringTransactionInDB)
async def create_recurring(data: schemas.RecurringTransactionCreate, db: DB, current_user: CurrentUser):
    return await service.create_recurring_transaction(db, data)


@router.put("/recurring/{rt_id}", response_model=schemas.RecurringTransactionInDB)
async def update_recurring(rt_id: int, data: schemas.RecurringTransactionUpdate, db: DB, current_user: CurrentUser):
    rt = await service.update_recurring_transaction(db, rt_id, data)
    if not rt:
        raise HTTPException(status_code=404, detail="Transacción recurrente no encontrada")
    return rt


@router.delete("/recurring/{rt_id}")
async def delete_recurring(rt_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_recurring_transaction(db, rt_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción recurrente no encontrada")
    return {"ok": True}


# --- Reportes P&L y comparativo ---
@router.get("/reports/pnl", response_model=schemas.PnLReport)
async def read_pnl(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    return await service.get_pnl_report(db, start, end)


@router.get("/reports/comparison", response_model=schemas.PeriodComparison)
async def read_period_comparison(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    return await service.get_period_comparison(db, start, end)


@router.get("/reports/pnl/export")
async def export_pnl_pdf(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    report = await service.get_pnl_report(db, start, end)
    pdf_bytes = service.generate_pnl_pdf(report)
    return Response(content=pdf_bytes, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=pnl_{start.date()}_{end.date()}.pdf"
    })


# --- Bitácora de auditoría ---
@router.get("/audit-logs", response_model=List[schemas.AuditLogItem])
async def read_finance_audit_logs(db: DB, current_user: CurrentUser, skip: int = 0, limit: int = 100):
    return await service.get_finance_audit_logs(db, skip=skip, limit=limit)
