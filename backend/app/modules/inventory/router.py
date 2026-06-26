import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import List, Annotated
from io import BytesIO
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.inventory import schemas, service, models
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]

UPLOAD_DIR = "uploads/inventory"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# --- Products ---
@router.post("/products", response_model=schemas.ProductInDB)
async def create_product(product_in: schemas.ProductCreate, db: DB, current_user: CurrentUser):
    return await service.create_product(db, product_in)

@router.get("/products", response_model=List[schemas.ProductWithVariants])
async def read_products(db: DB, skip: int = 0, limit: int = 200, item_type: str | None = None):
    return await service.get_products(db, skip, limit, item_type=item_type)

@router.post("/products/upload-image")
async def upload_product_image(db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read()
    url = service.save_compressed_image(content, file.filename, UPLOAD_DIR, "inventory")
    return {"url": url}

# --- Carga masiva (Excel/CSV) ---
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

@router.get("/products/bulk-import/template")
async def download_products_template(current_user: CurrentUser):
    content = service.generate_products_template()
    return StreamingResponse(
        BytesIO(content), media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=plantilla_productos_insumos.xlsx"},
    )

@router.post("/products/bulk-import", response_model=schemas.BulkImportResult)
async def upload_products_bulk_import(db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read()
    try:
        return await service.bulk_import_products(db, content, file.filename, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/recipes/bulk-import/template")
async def download_recipes_template(current_user: CurrentUser):
    content = service.generate_recipes_template()
    return StreamingResponse(
        BytesIO(content), media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=plantilla_recetas_bom.xlsx"},
    )

@router.post("/recipes/bulk-import", response_model=schemas.BulkImportResult)
async def upload_recipes_bulk_import(db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read()
    try:
        return await service.bulk_import_recipes(db, content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/products/{product_id}", response_model=schemas.ProductWithVariants)
async def read_product(product_id: int, db: DB, current_user: CurrentUser):
    product = await service.get_product(db, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

@router.put("/products/{product_id}", response_model=schemas.ProductInDB)
async def update_product(product_id: int, product_in: schemas.ProductUpdate, db: DB, current_user: CurrentUser):
    product = await service.update_product(db, product_id, product_in)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# --- Variants ---
@router.post("/variants", response_model=schemas.VariantInDB)
async def create_variant(variant_in: schemas.VariantCreate, db: DB, current_user: CurrentUser):
    return await service.create_variant(db, variant_in)

@router.put("/variants/{variant_id}", response_model=schemas.VariantInDB)
async def update_variant(variant_id: int, variant_in: schemas.VariantUpdate, db: DB, current_user: CurrentUser):
    variant = await service.update_variant(db, variant_id, variant_in)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")
    return variant

# --- Suppliers ---
@router.post("/suppliers", response_model=schemas.SupplierInDB)
async def create_supplier(supplier_in: schemas.SupplierCreate, db: DB, current_user: CurrentUser):
    return await service.create_supplier(db, supplier_in)

@router.get("/suppliers", response_model=List[schemas.SupplierInDB])
async def read_suppliers(db: DB, current_user: CurrentUser):
    return await service.get_suppliers(db)

@router.put("/suppliers/{supplier_id}", response_model=schemas.SupplierInDB)
async def update_supplier(supplier_id: int, supplier_in: schemas.SupplierUpdate, db: DB, current_user: CurrentUser):
    supplier = await service.update_supplier(db, supplier_id, supplier_in)
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier

def _require_inventory_manager(current_user: User) -> None:
    role = (current_user.role or "").lower()
    role_name = (current_user.role_obj.name.lower() if current_user.role_obj else "")
    allowed = current_user.is_superuser or role in ("admin", "administrador", "inventario") or role_name in ("administrador", "inventario")
    if not allowed:
        raise HTTPException(status_code=403, detail="Solo el encargado de inventarios o el administrador general pueden eliminar proveedores")

@router.delete("/suppliers/{supplier_id}", status_code=204)
async def delete_supplier(supplier_id: int, db: DB, current_user: CurrentUser):
    _require_inventory_manager(current_user)
    try:
        deleted = await service.delete_supplier(db, supplier_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Supplier not found")

@router.post("/suppliers/{supplier_id}/documents", response_model=schemas.SupplierDocumentInDB)
async def upload_supplier_document(supplier_id: int, db: DB, current_user: CurrentUser, doc_type: str, file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1]
    safe = f"sup{supplier_id}_{doc_type}_{int(datetime.now().timestamp())}{ext}"
    path = os.path.join(UPLOAD_DIR, safe)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    doc = await service.add_supplier_document(db, supplier_id, doc_type, f"inventory/{safe}", file.filename)
    if not doc:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return doc

@router.delete("/suppliers/{supplier_id}/documents/{document_id}", status_code=204)
async def delete_supplier_document(supplier_id: int, document_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_supplier_document(db, supplier_id, document_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Document not found")

# --- Warehouses ---
@router.post("/warehouses", response_model=schemas.WarehouseInDB)
async def create_warehouse(warehouse_in: schemas.WarehouseCreate, db: DB, current_user: CurrentUser):
    return await service.create_warehouse(db, warehouse_in)

@router.get("/warehouses", response_model=List[schemas.WarehouseInDB])
async def read_warehouses(db: DB, current_user: CurrentUser):
    return await service.get_warehouses(db)

@router.put("/warehouses/{warehouse_id}", response_model=schemas.WarehouseInDB)
async def update_warehouse(warehouse_id: int, warehouse_in: schemas.WarehouseUpdate, db: DB, current_user: CurrentUser):
    warehouse = await service.update_warehouse(db, warehouse_id, warehouse_in)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse

# --- Stock ---
@router.post("/stock/adjust", response_model=schemas.StockMovementInDB)
async def adjust_stock(movement_in: schemas.StockMovementCreate, db: DB, current_user: CurrentUser):
    return await service.adjust_stock(db, movement_in, user_id=current_user.id)

@router.get("/stock/{variant_id}", response_model=List[schemas.StockLevelSchema])
async def read_stock_levels(variant_id: int, db: DB, current_user: CurrentUser):
    return await service.get_stock_levels(db, variant_id)

@router.get("/movements", response_model=List[schemas.StockMovementOut])
async def read_movements(db: DB, current_user: CurrentUser, skip: int = 0, limit: int = 200):
    return await service.get_movements(db, skip, limit)

# --- Stats ---
@router.get("/stats", response_model=schemas.InventoryStats)
async def read_inventory_stats(db: DB, current_user: CurrentUser):
    return await service.get_inventory_stats(db)

# --- Reorder alerts ---
@router.get("/reorder-alerts", response_model=List[schemas.ReorderAlert])
async def read_reorder_alerts(db: DB, current_user: CurrentUser):
    return await service.get_reorder_alerts(db)

# --- Purchase Orders ---
@router.post("/purchase-orders", response_model=schemas.PurchaseOrderInDB)
async def create_purchase_order(po_in: schemas.PurchaseOrderCreate, db: DB, current_user: CurrentUser):
    return await service.create_purchase_order(db, po_in, user_id=current_user.id)

@router.get("/purchase-orders", response_model=List[schemas.PurchaseOrderInDB])
async def read_purchase_orders(db: DB, current_user: CurrentUser):
    return await service.get_purchase_orders(db)

@router.put("/purchase-orders/{po_id}", response_model=schemas.PurchaseOrderInDB)
async def update_purchase_order(po_id: int, po_in: schemas.PurchaseOrderUpdate, db: DB, current_user: CurrentUser):
    try:
        po = await service.update_purchase_order(db, po_id, po_in)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.post("/purchase-orders/{po_id}/receive", response_model=schemas.PurchaseOrderInDB)
async def receive_purchase_order(po_id: int, db: DB, current_user: CurrentUser):
    po = await service.receive_purchase_order(db, po_id, user_id=current_user.id)
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.post("/purchase-orders/{po_id}/cancel", response_model=schemas.PurchaseOrderInDB)
async def cancel_purchase_order(po_id: int, db: DB, current_user: CurrentUser):
    try:
        po = await service.cancel_purchase_order(db, po_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.post("/purchase-orders/{po_id}/pay", response_model=schemas.PurchaseOrderInDB)
async def pay_purchase_order(po_id: int, pay_in: schemas.SupplierPaymentCreate, db: DB, current_user: CurrentUser):
    try:
        po = await service.pay_purchase_order(db, po_id, pay_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

# --- BOM / Recipes ---
@router.post("/recipes", response_model=schemas.RecipeInDB)
async def create_recipe(recipe_in: schemas.RecipeCreate, db: DB, current_user: CurrentUser):
    return await service.create_recipe(db, recipe_in)

@router.get("/recipes", response_model=List[schemas.RecipeInDB])
async def read_recipes(db: DB, current_user: CurrentUser):
    return await service.get_recipes(db)

@router.put("/recipes/{recipe_id}", response_model=schemas.RecipeInDB)
async def update_recipe(recipe_id: int, recipe_in: schemas.RecipeUpdate, db: DB, current_user: CurrentUser):
    recipe = await service.update_recipe(db, recipe_id, recipe_in)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe

@router.get("/recipes/{recipe_id}/cost", response_model=schemas.RecipeCostBreakdown)
async def read_recipe_cost(recipe_id: int, db: DB, current_user: CurrentUser):
    cost = await service.get_recipe_cost(db, recipe_id)
    if not cost:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return cost

# --- Production Orders ---
@router.post("/production-orders", response_model=schemas.ProductionOrderInDB)
async def create_production_order(po_in: schemas.ProductionOrderCreate, db: DB, current_user: CurrentUser):
    try:
        return await service.create_production_order(db, po_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/production-orders", response_model=List[schemas.ProductionOrderInDB])
async def read_production_orders(db: DB, current_user: CurrentUser):
    return await service.get_production_orders(db)

@router.post("/production-orders/{prod_id}/complete", response_model=schemas.ProductionOrderInDB)
async def complete_production_order(prod_id: int, db: DB, current_user: CurrentUser):
    try:
        return await service.complete_production_order(db, prod_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
