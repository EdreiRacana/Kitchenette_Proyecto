from fastapi import APIRouter, Depends, HTTPException
from typing import List, Annotated
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.sales import schemas, service
from app.modules.auth.models import User

router = APIRouter()


@router.post("/", response_model=schemas.OrderInDB)
async def create_order(
    order_in: schemas.OrderCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    if not order_in.items:
        raise HTTPException(status_code=400, detail="An order must contain at least one item")
    return await service.create_order(db, order_in, user_id=current_user.id)


@router.get("/", response_model=List[schemas.OrderInDB])
async def read_orders(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    skip: int = 0,
    limit: int = 100,
):
    return await service.get_orders(db, skip=skip, limit=limit)


@router.get("/{order_id}", response_model=schemas.OrderInDB)
async def read_order(
    order_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    order = await service.get_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/{order_id}/status", response_model=schemas.OrderInDB)
async def update_order_status(
    order_id: int,
    status_update: schemas.OrderUpdate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    if not status_update.status:
        raise HTTPException(status_code=400, detail="status is required")
    order = await service.update_order_status(db, order_id, status_update.status)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
