from fastapi import APIRouter, Depends
from typing import List, Annotated, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.finance import schemas, service
from app.modules.auth.models import User

router = APIRouter()


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
    return await service.create_transaction(db, tx_in)


@router.get("/transactions", response_model=List[schemas.TransactionInDB])
async def read_transactions(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    skip: int = 0,
    limit: int = 100,
    type: Optional[str] = None,
):
    return await service.get_transactions(db, skip=skip, limit=limit, type=type)
