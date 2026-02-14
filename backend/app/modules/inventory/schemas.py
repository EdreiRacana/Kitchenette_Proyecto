from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

# --- Media Schemas ---
class ProductMediaBase(BaseModel):
    file_url: str
    media_type: str = "image"
    is_primary: bool = False

class ProductMediaCreate(ProductMediaBase):
    pass

class ProductMediaInDB(ProductMediaBase):
    id: int
    product_id: int
    created_at: datetime

    class Config:
        from_attributes = True

# --- Product Schemas ---
class ProductBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    is_active: Optional[bool] = True

class ProductCreate(ProductBase):
    pass

class ProductUpdate(ProductBase):
    pass

class ProductInDB(ProductBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# --- Variant Schemas ---
class VariantBase(BaseModel):
    sku: str
    size: Optional[str] = None
    color: Optional[str] = None
    material: Optional[str] = None
    price: float
    cost_price: Optional[float] = None
    is_active: Optional[bool] = True

class VariantCreate(VariantBase):
    product_id: int

class VariantUpdate(VariantBase):
    pass

class VariantInDB(VariantBase):
    id: int
    product_id: int
    
    class Config:
        from_attributes = True

# --- Warehouse Schemas ---
class WarehouseBase(BaseModel):
    name: str
    location: Optional[str] = None
    is_active: Optional[bool] = True

class WarehouseCreate(WarehouseBase):
    pass

class WarehouseInDB(WarehouseBase):
    id: int
    
    class Config:
        from_attributes = True

# --- Stock Schemas ---
class StockLevelSchema(BaseModel):
    variant_id: int
    warehouse_id: int
    quantity: int

    class Config:
        from_attributes = True

class StockMovementCreate(BaseModel):
    variant_id: int
    warehouse_id: int
    quantity: int
    movement_type: str # in, out, adjustment
    reference: Optional[str] = None
    notes: Optional[str] = None

# --- Composite Response ---
class ProductWithVariants(ProductInDB):
    variants: List[VariantInDB] = []
    media: List[ProductMediaInDB] = []
