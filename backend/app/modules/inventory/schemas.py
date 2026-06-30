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

# --- Supplier Schemas ---
class SupplierBase(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    rfc: Optional[str] = None
    address: Optional[str] = None
    lead_time_days: Optional[int] = 7
    payment_terms: Optional[str] = None
    commercial_terms: Optional[str] = None
    extra_contacts: Optional[List[dict]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = True

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(SupplierBase):
    pass

class SupplierDocumentBase(BaseModel):
    doc_type: str
    file_url: str
    file_name: Optional[str] = None

class SupplierDocumentCreate(SupplierDocumentBase):
    pass

class SupplierDocumentInDB(SupplierDocumentBase):
    id: int
    supplier_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class SupplierInDB(SupplierBase):
    id: int
    created_at: datetime
    documents: List[SupplierDocumentInDB] = []

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
    is_manufactured: Optional[bool] = False
    item_type: Optional[str] = "finished_good"

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
    barcode: Optional[str] = None
    size: Optional[str] = None
    color: Optional[str] = None
    material: Optional[str] = None
    price: float
    cost_price: Optional[float] = None
    reorder_point: Optional[int] = None
    safety_stock: Optional[int] = None
    lead_time_days: Optional[int] = None
    preferred_supplier_id: Optional[int] = None
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
    type: Optional[str] = "own"
    branch_id: Optional[int] = None
    is_active: Optional[bool] = True

class WarehouseCreate(WarehouseBase):
    pass

class WarehouseUpdate(WarehouseBase):
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
    reserved_quantity: int = 0

    class Config:
        from_attributes = True

class StockMovementCreate(BaseModel):
    variant_id: int
    warehouse_id: int
    quantity: int
    movement_type: str # in, out, adjustment
    unit_cost: Optional[float] = None
    reference: Optional[str] = None
    notes: Optional[str] = None

class StockMovementInDB(BaseModel):
    id: int
    variant_id: int
    warehouse_id: int
    quantity: int
    movement_type: str
    unit_cost: Optional[float] = None
    reference: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class StockMovementOut(StockMovementInDB):
    product_name: Optional[str] = None
    sku: Optional[str] = None
    warehouse_name: Optional[str] = None

# --- Composite Response ---
class WarehouseNameOnly(BaseModel):
    name: str

    class Config:
        from_attributes = True

class StockLevelInVariant(BaseModel):
    warehouse_id: int
    quantity: int
    reserved_quantity: int = 0
    warehouse: WarehouseNameOnly

    class Config:
        from_attributes = True

class VariantWithStock(VariantInDB):
    stock_levels: List[StockLevelInVariant] = []

class ProductWithVariants(ProductInDB):
    variants: List[VariantWithStock] = []
    media: List[ProductMediaInDB] = []

# --- Reorder alerts ---
class ReorderAlert(BaseModel):
    variant_id: int
    sku: str
    product_name: str
    warehouse_id: int
    warehouse_name: str
    available: int
    reserved: int
    reorder_point: int
    safety_stock: int
    level: str  # "yellow" | "red"
    preferred_supplier_id: Optional[int] = None
    preferred_supplier_name: Optional[str] = None
    lead_time_days: Optional[int] = None

class CategoryValue(BaseModel):
    category: str
    value: float
    pct: float

class InventoryStats(BaseModel):
    total_value: float
    total_units: int
    out_of_stock: int
    low_stock: int
    by_category: List[CategoryValue]

# --- Purchase Orders ---
class PurchaseOrderItemCreate(BaseModel):
    variant_id: int
    quantity: int
    unit_cost: float

class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    warehouse_id: int
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    items: List[PurchaseOrderItemCreate]

class PurchaseOrderItemInDB(PurchaseOrderItemCreate):
    id: int

    class Config:
        from_attributes = True

class PurchaseOrderUpdate(BaseModel):
    supplier_id: Optional[int] = None
    warehouse_id: Optional[int] = None
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    items: Optional[List[PurchaseOrderItemCreate]] = None

class SupplierPaymentCreate(BaseModel):
    amount: float
    method: Optional[str] = None
    reference: Optional[str] = None
    note: Optional[str] = None

class SupplierPaymentInDB(SupplierPaymentCreate):
    id: int
    purchase_order_id: int
    user_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PurchaseOrderInDB(BaseModel):
    id: int
    folio: Optional[str] = None
    supplier_id: int
    warehouse_id: int
    status: str
    notes: Optional[str] = None
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance: float = 0.0
    due_date: Optional[datetime] = None
    created_at: datetime
    received_at: Optional[datetime] = None
    items: List[PurchaseOrderItemInDB] = []

    class Config:
        from_attributes = True

# --- BOM / Recipes ---
class RecipeItemCreate(BaseModel):
    input_variant_id: int
    quantity: float

class RecipeExtraCost(BaseModel):
    description: str
    amount: float

class RecipeCreate(BaseModel):
    output_variant_id: int
    name: Optional[str] = None
    labor_cost: float = 0
    overhead_cost: float = 0
    extra_costs: List[RecipeExtraCost] = []
    yield_quantity: int = 1
    items: List[RecipeItemCreate]

class RecipeUpdate(RecipeCreate):
    is_active: Optional[bool] = True

class RecipeItemInDB(RecipeItemCreate):
    id: int

    class Config:
        from_attributes = True

class RecipeInDB(BaseModel):
    id: int
    output_variant_id: int
    name: Optional[str] = None
    labor_cost: float
    overhead_cost: float
    extra_costs: List[RecipeExtraCost] = []
    yield_quantity: int
    is_active: bool
    items: List[RecipeItemInDB] = []

    class Config:
        from_attributes = True

class RecipeCostBreakdown(BaseModel):
    recipe_id: int
    materials_cost: float
    labor_cost: float
    overhead_cost: float
    extra_costs_total: float
    total_cost: float
    unit_cost: float  # total_cost / yield_quantity
    missing_cost_inputs: List[str] = []  # SKUs sin costo definido

# --- Production Orders ---
class ProductionOrderCreate(BaseModel):
    recipe_id: int
    warehouse_id: int
    runs: int = 1
    notes: Optional[str] = None

class ProductionOrderUpdate(ProductionOrderCreate):
    pass

class ProductionOrderInDB(BaseModel):
    id: int
    folio: Optional[str] = None
    recipe_id: int
    warehouse_id: int
    runs: int
    status: str
    unit_cost_result: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Bulk import (productos / insumos y recetas vía Excel/CSV) ---
class BulkImportRowError(BaseModel):
    row: int
    message: str

class BulkImportResult(BaseModel):
    total_rows: int
    created: int
    updated: int
    errors: List[BulkImportRowError] = []
