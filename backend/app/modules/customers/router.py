from fastapi import APIRouter, Depends, HTTPException
from typing import List, Annotated
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.customers import schemas, service

router = APIRouter()

@router.post("/", response_model=schemas.CustomerInDB)
async def create_customer(
    customer_in: schemas.CustomerCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    return await service.create_customer(db, customer_in)

@router.get("/", response_model=List[schemas.CustomerInDB])
async def read_customers(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    skip: int = 0,
    limit: int = 100
):
    return await service.get_customers(db, skip=skip, limit=limit)

@router.get("/{customer_id}", response_model=schemas.CustomerInDB)
async def read_customer(
    customer_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    customer = await service.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer
