from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Annotated
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.inventory import schemas, service, models
from app.modules.auth.models import User

router = APIRouter()

# --- Products ---
@router.post("/products", response_model=schemas.ProductInDB)
async def create_product(
    product_in: schemas.ProductCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    return await service.create_product(db, product_in)

@router.get("/products", response_model=List[schemas.ProductWithVariants]) # Use schema to include variants
async def read_products(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    skip: int = 0,
    limit: int = 100,
):
    products = await service.get_products(db, skip, limit)
    # Pydantic's from_attributes should handle the conversion if relationships are loaded
    return products

@router.get("/products/{product_id}", response_model=schemas.ProductWithVariants)
async def read_product(
    product_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    product = await service.get_product(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# --- Variants ---
@router.post("/variants", response_model=schemas.VariantInDB)
async def create_variant(
    variant_in: schemas.VariantCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    return await service.create_variant(db, variant_in)

# --- Warehouses ---
@router.post("/warehouses", response_model=schemas.WarehouseInDB)
async def create_warehouse(
    warehouse_in: schemas.WarehouseCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    return await service.create_warehouse(db, warehouse_in)

@router.get("/warehouses", response_model=List[schemas.WarehouseInDB])
async def read_warehouses(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    return await service.get_warehouses(db)

# --- Stock ---
@router.post("/stock/adjust", response_model=dict)
async def adjust_stock(
    movement_in: schemas.StockMovementCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    movement = await service.adjust_stock(db, movement_in, user_id=current_user.id)
    return {"message": "Stock adjusted successfully", "movement_id": movement.id}

@router.get("/stock/{variant_id}", response_model=List[schemas.StockLevelSchema])
async def read_stock_levels(
    variant_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: User = Depends(deps.get_current_active_user)
):
    return await service.get_stock_levels(db, variant_id)
