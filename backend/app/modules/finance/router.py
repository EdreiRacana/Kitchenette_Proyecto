from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List, Annotated, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.finance import schemas, service
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


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
    tx = await service.update_transaction(db, tx_id, tx_in)
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx


@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_transaction(db, tx_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"ok": True}


# --- CXC ---
@router.get("/cxc", response_model=List[schemas.AgingItem])
async def read_cxc(db: DB, current_user: CurrentUser):
    return await service.get_cxc(db)


@router.post("/cxc/{order_id}/pay")
async def pay_cxc(order_id: int, pay_in: schemas.PayDebtRequest, db: DB, current_user: CurrentUser):
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
