from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.modules.inventory.models import Product, ProductVariant, Warehouse, StockLevel, StockMovement, StockMovementType
from app.modules.inventory import schemas

# --- Product Services ---
async def create_product(db: AsyncSession, product_in: schemas.ProductCreate) -> Product:
    db_product = Product(**product_in.model_dump())
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    return db_product

async def get_products(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[Product]:
    result = await db.execute(select(Product).offset(skip).limit(limit).options(selectinload(Product.variants)))
    return result.scalars().all()

async def get_product(db: AsyncSession, product_id: int) -> Optional[Product]:
    result = await db.execute(select(Product).where(Product.id == product_id).options(selectinload(Product.variants)))
    return result.scalars().first()

# --- Variant Services ---
async def create_variant(db: AsyncSession, variant_in: schemas.VariantCreate) -> ProductVariant:
    db_variant = ProductVariant(**variant_in.model_dump())
    db.add(db_variant)
    await db.commit()
    await db.refresh(db_variant)
    return db_variant

# --- Warehouse Services ---
async def create_warehouse(db: AsyncSession, warehouse_in: schemas.WarehouseCreate) -> Warehouse:
    db_warehouse = Warehouse(**warehouse_in.model_dump())
    db.add(db_warehouse)
    await db.commit()
    await db.refresh(db_warehouse)
    return db_warehouse

async def get_warehouses(db: AsyncSession) -> List[Warehouse]:
    result = await db.execute(select(Warehouse))
    return result.scalars().all()

# --- Stock Services ---
async def adjust_stock(db: AsyncSession, movement_in: schemas.StockMovementCreate, user_id: Optional[int] = None) -> StockMovement:
    # 1. Record Movement
    db_movement = StockMovement(
        variant_id=movement_in.variant_id,
        warehouse_id=movement_in.warehouse_id,
        quantity=movement_in.quantity,
        movement_type=movement_in.movement_type,
        reference=movement_in.reference,
        notes=movement_in.notes,
        user_id=user_id
    )
    db.add(db_movement)

    # 2. Update Stock Level
    # check if stock level exists
    result = await db.execute(
        select(StockLevel).where(
            StockLevel.variant_id == movement_in.variant_id,
            StockLevel.warehouse_id == movement_in.warehouse_id
        )
    )
    stock_level = result.scalars().first()

    if not stock_level:
        stock_level = StockLevel(
            variant_id=movement_in.variant_id,
            warehouse_id=movement_in.warehouse_id,
            quantity=0
        )
        db.add(stock_level)
    
    # Calculate new quantity
    if movement_in.movement_type == StockMovementType.IN:
        stock_level.quantity += movement_in.quantity
    elif movement_in.movement_type == StockMovementType.OUT:
        stock_level.quantity -= movement_in.quantity
    elif movement_in.movement_type == StockMovementType.ADJUSTMENT:
         # For adjustment, we assume the quantity passed IS the adjustment amount (delta), 
         # or we could implement 'set to absolute value'. 
         # For simplicity here, let's treat it as a delta correction.
        stock_level.quantity += movement_in.quantity

    await db.commit()
    await db.refresh(db_movement)
    return db_movement

async def get_stock_levels(db: AsyncSession, variant_id: Optional[int] = None) -> List[StockLevel]:
    query = select(StockLevel).options(selectinload(StockLevel.warehouse), selectinload(StockLevel.variant))
    if variant_id:
        query = query.where(StockLevel.variant_id == variant_id)
    result = await db.execute(query)
    return result.scalars().all()
