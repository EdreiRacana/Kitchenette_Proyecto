import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from typing import List, Annotated, Optional
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

@router.get("/products/export")
async def export_products(db: DB, current_user: CurrentUser,
                           formato: str = "csv", warehouse_id: Optional[int] = None):
    if formato == "xlsx":
        contenido = await service.export_inventory_xlsx(db, warehouse_id=warehouse_id)
        return StreamingResponse(
            BytesIO(contenido),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=inventario.xlsx"},
        )
    csv_text = await service.export_inventory_csv(db, warehouse_id=warehouse_id)
    from io import StringIO
    return StreamingResponse(
        StringIO(csv_text), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventario.csv"},
    )

@router.post("/products/upload-image")
async def upload_product_image(db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    content = await file.read()
    url = await service.save_compressed_image(content, file.filename, "inventory")
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
    from app.core.storage import upload_bytes
    content = await file.read()
    safe_name = f"sup{supplier_id}_{doc_type}_{int(datetime.now().timestamp())}_{file.filename or 'documento'}"
    url = await upload_bytes(content, safe_name, folder="proveedores")
    doc = await service.add_supplier_document(db, supplier_id, doc_type, url, file.filename)
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
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_warehouses(db, warehouse_ids=ids)

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
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_movements(db, skip, limit, warehouse_ids=ids)

# --- Stats ---
@router.get("/stats", response_model=schemas.InventoryStats)
async def read_inventory_stats(db: DB, current_user: CurrentUser):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_inventory_stats(db, warehouse_ids=ids)

# --- Reorder alerts ---
@router.get("/reorder-alerts", response_model=List[schemas.ReorderAlert])
async def read_reorder_alerts(db: DB, current_user: CurrentUser):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_reorder_alerts(db, warehouse_ids=ids)

# --- Purchase Orders ---
@router.post("/purchase-orders", response_model=schemas.PurchaseOrderInDB)
async def create_purchase_order(po_in: schemas.PurchaseOrderCreate, db: DB, current_user: CurrentUser):
    return await service.create_purchase_order(db, po_in, user_id=current_user.id)

@router.get("/purchase-orders", response_model=List[schemas.PurchaseOrderInDB])
async def read_purchase_orders(db: DB, current_user: CurrentUser):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_purchase_orders(db, warehouse_ids=ids)

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

@router.get("/purchase-orders/{po_id}/pdf")
async def purchase_order_pdf(po_id: int, db: DB, current_user: CurrentUser):
    pdf = await service.generate_purchase_order_pdf(db, po_id)
    if pdf is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="OC-{po_id}.pdf"'})

@router.post("/purchase-orders/{po_id}/email")
async def email_purchase_order(po_id: int, db: DB, current_user: CurrentUser, to: Optional[str] = None):
    result = await service.email_purchase_order(db, po_id, to=to)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if result.get("error") == "no_recipient":
        raise HTTPException(status_code=400, detail="El proveedor no tiene correo y no se indicó un destinatario")
    return result

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

@router.put("/production-orders/{prod_id}", response_model=schemas.ProductionOrderInDB)
async def update_production_order(prod_id: int, po_in: schemas.ProductionOrderUpdate, db: DB, current_user: CurrentUser):
    try:
        prod = await service.update_production_order(db, prod_id, po_in)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not prod:
        raise HTTPException(status_code=404, detail="Production order not found")
    return prod

@router.post("/production-orders/{prod_id}/complete", response_model=schemas.ProductionOrderInDB)
async def complete_production_order(prod_id: int, db: DB, current_user: CurrentUser):
    try:
        return await service.complete_production_order(db, prod_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/production-orders/{prod_id}/pdf")
async def production_order_pdf(prod_id: int, db: DB, current_user: CurrentUser):
    pdf = await service.generate_production_order_pdf(db, prod_id)
    if pdf is None:
        raise HTTPException(status_code=404, detail="Production order not found")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="OP-{prod_id}.pdf"'})


# ── Kardex FIFO / valuación de inventario ───────────────────────────────────
from datetime import datetime as _dt
from app.modules.inventory import fifo_service


@router.get("/kardex/{variant_id}")
async def get_kardex(variant_id: int, db: DB, current_user: CurrentUser,
                     warehouse_id: Optional[int] = None,
                     start: Optional[_dt] = None,
                     end: Optional[_dt] = None,
                     limit: int = 500):
    """Kardex FIFO: movimientos cronológicos con costo aplicado, saldo
    acumulado y costo promedio en cada punto. Es la base para el P&L real."""
    return await fifo_service.get_kardex(db, variant_id, warehouse_id, start, end, limit)


@router.get("/valuation/{variant_id}")
async def get_variant_valuation(variant_id: int, db: DB, current_user: CurrentUser,
                                warehouse_id: Optional[int] = None):
    """Costo promedio ponderado actual del variant (para calcular COGS
    al momento de vender). Regresa 0 si no hay stock disponible."""
    if warehouse_id:
        return {"variant_id": variant_id, "warehouse_id": warehouse_id,
                "unit_cost_current": await fifo_service.get_current_cost(db, variant_id, warehouse_id)}
    # Agregar por todos los almacenes
    from sqlalchemy.future import select
    from sqlalchemy import distinct
    from app.modules.inventory.models import StockLot
    res = await db.execute(select(distinct(StockLot.warehouse_id)).where(StockLot.variant_id == variant_id))
    warehouses = [r[0] for r in res.all()]
    per_wh = {}
    for wh in warehouses:
        per_wh[wh] = await fifo_service.get_current_cost(db, variant_id, wh)
    return {"variant_id": variant_id, "per_warehouse": per_wh}


# ── Lotes / trazabilidad (perecederos) ──────────────────────────────────
from app.modules.inventory import batch_service
from pydantic import BaseModel as _BM
from datetime import date as _date


class _ReceiveBatchIn(_BM):
    variant_id: int
    warehouse_id: int
    quantity: int
    unit_cost: float
    batch_code: Optional[str] = None
    expiration_date: Optional[_date] = None
    manufacturing_date: Optional[_date] = None
    supplier_id: Optional[int] = None
    reference: Optional[str] = None


@router.post("/stock/receive-batch")
async def receive_batch(data: _ReceiveBatchIn, db: DB, current_user: CurrentUser):
    """Recibe stock de un producto perecedero capturando el código de lote y
    la caducidad. Si el producto tiene default_shelf_life_days y no se pasa
    expiration_date, se calcula automáticamente."""
    try:
        lot = await fifo_service.receive_stock(
            db, variant_id=data.variant_id, warehouse_id=data.warehouse_id,
            quantity=data.quantity, unit_cost=data.unit_cost,
            reference=data.reference, user_id=current_user.id,
            batch_code=data.batch_code, expiration_date=data.expiration_date,
            manufacturing_date=data.manufacturing_date, supplier_id=data.supplier_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "lot_id": lot.id, "batch_code": lot.batch_code,
        "expiration_date": lot.expiration_date.isoformat() if lot.expiration_date else None,
        "quantity": lot.quantity_received,
    }


@router.get("/batches/expiring")
async def list_expiring(db: DB, current_user: CurrentUser,
                        days: int = 30, warehouse_id: Optional[int] = None,
                        include_expired: bool = True, limit: int = 500):
    """Dashboard 'Próximo a caducar' con buckets (expired/critical/alert/ok)
    y total del valor en riesgo. Base para el widget de Retail y las
    alertas por correo."""
    return await batch_service.list_expiring_lots(
        db, days=days, warehouse_id=warehouse_id,
        include_expired=include_expired, limit=limit,
    )


class _RecallLotIn(_BM):
    reason: str


@router.post("/batches/{lot_id}/recall")
async def recall_lot_endpoint(lot_id: int, data: _RecallLotIn,
                               db: DB, current_user: CurrentUser):
    """Retiro sanitario de un lote. Bloquea el lote y devuelve la lista de
    órdenes / clientes afectados para poder contactarlos."""
    if not data.reason.strip():
        raise HTTPException(400, "El motivo del retiro es obligatorio")
    res = await batch_service.recall_lot(db, lot_id, reason=data.reason,
                                          user_id=current_user.id)
    if not res.get("ok"):
        raise HTTPException(404, res.get("reason", "Lote no encontrado"))
    return res


class _LotStatusIn(_BM):
    status: str  # active | quarantine | recalled | expired | consumed


@router.patch("/batches/{lot_id}/status")
async def set_lot_status_endpoint(lot_id: int, data: _LotStatusIn,
                                    db: DB, current_user: CurrentUser):
    """Cambia manualmente el estado de un lote (cuarentena, reactivar, etc.)."""
    try:
        lot = await batch_service.set_lot_status(
            db, lot_id, status=data.status, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not lot:
        raise HTTPException(404, "Lote no encontrado")
    return {"lot_id": lot.id, "status": lot.status}


@router.post("/batches/sweep-expired")
async def sweep_expired_endpoint(db: DB, current_user: CurrentUser):
    """Barre lotes caducados hoy o antes: los mueve fuera del disponible
    y marca status='expired'. Manual — se llamará también desde un cron."""
    return await batch_service.sweep_expired_to_scrap(db, user_id=current_user.id)


class _NotifyExpiringIn(_BM):
    to: Optional[str] = None                 # correo destino (opcional; cae a accounting_email)
    days: int = 30
    warehouse_id: Optional[int] = None
    only_critical: bool = False              # true = solo expired + critical (cronjob diario)


@router.post("/batches/notify-email")
async def notify_expiring_email(data: _NotifyExpiringIn, db: DB, current_user: CurrentUser):
    """Manda por correo el resumen de lotes por caducar. Usado por el
    gerente para reenviar a un demostrador / comprador, y por el cronjob
    diario que llama con only_critical=true."""
    res = await batch_service.notify_expiring_by_email(
        db, to=data.to, days=data.days,
        warehouse_id=data.warehouse_id, only_critical=data.only_critical,
    )
    if not res.get("sent"):
        raise HTTPException(400, res.get("reason", "No se pudo enviar"))
    return res


@router.get("/batches/notify-text")
async def notify_expiring_text(db: DB, current_user: CurrentUser,
                                days: int = 30, warehouse_id: Optional[int] = None,
                                only_critical: bool = False):
    """Devuelve el resumen como texto plano para pegar en WhatsApp o SMS."""
    return await batch_service.build_expiring_whatsapp_text(
        db, days=days, warehouse_id=warehouse_id, only_critical=only_critical,
    )


@router.post("/batches/notify-store-demonstrator/{warehouse_id}")
async def notify_store_demonstrator(warehouse_id: int, db: DB, current_user: CurrentUser,
                                     days: int = 30, prefer: str = "whatsapp"):
    """Enrutamiento automático: notifica a la demostradora de la tienda cuyo
    warehouse de consignación es el `warehouse_id`. prefer=whatsapp devuelve
    el link wa.me listo para abrir; prefer=email envía correo directo."""
    if prefer not in ("whatsapp", "email"):
        raise HTTPException(400, "prefer debe ser whatsapp o email")
    res = await batch_service.notify_store_demonstrator(
        db, warehouse_id, days=days, prefer_channel=prefer,
    )
    if not res.get("ok"):
        raise HTTPException(400, res.get("reason", "Error"))
    return res


# ── Traspasos entre almacenes (Stock Transfer Orders) ────────────────────

@router.post("/transfers", response_model=schemas.StockTransferInDB, status_code=201)
async def create_transfer(data: schemas.StockTransferCreate, db: DB, current_user: CurrentUser):
    """Crea un nuevo traspaso en estado 'draft'."""
    try:
        return await service.create_stock_transfer(db, data.model_dump(), user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/transfers", response_model=List[schemas.StockTransferInDB])
async def list_transfers(db: DB, current_user: CurrentUser,
                          warehouse_id: Optional[int] = None,
                          status: Optional[str] = None,
                          limit: int = 100):
    """Lista traspasos. `warehouse_id` filtra tanto origen como destino."""
    return await service.list_stock_transfers(db, warehouse_id=warehouse_id, status=status, limit=limit)


@router.get("/transfers/{transfer_id}", response_model=schemas.StockTransferInDB)
async def get_transfer(transfer_id: int, db: DB, current_user: CurrentUser):
    t = await service.get_stock_transfer(db, transfer_id)
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.post("/transfers/{transfer_id}/approve", response_model=schemas.StockTransferInDB)
async def approve_transfer(transfer_id: int, db: DB, current_user: CurrentUser):
    """Aprueba un traspaso 'draft' → 'approved'."""
    try:
        t = await service.approve_stock_transfer(db, transfer_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.post("/transfers/{transfer_id}/start-preparation", response_model=schemas.StockTransferInDB)
async def start_preparation(transfer_id: int, db: DB, current_user: CurrentUser):
    """Marca el traspaso como 'in_preparation' — CEDIS empezó a armarlo."""
    try:
        t = await service.start_preparation(db, transfer_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.post("/transfers/{transfer_id}/ship", response_model=schemas.StockTransferInDB)
async def ship_transfer(transfer_id: int, data: schemas.StockTransferShipPayload,
                         db: DB, current_user: CurrentUser):
    """CEDIS confirma salida — consume stock del origen vía FIFO. Cambia a 'shipped'."""
    try:
        t = await service.ship_stock_transfer(
            db, transfer_id, [it.model_dump() for it in data.items], user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.post("/transfers/{transfer_id}/receive", response_model=schemas.StockTransferInDB)
async def receive_transfer(transfer_id: int, data: schemas.StockTransferReceivePayload,
                            db: DB, current_user: CurrentUser):
    """Destino confirma recepción — ingresa stock al destino. Cambia a 'received'.
    Si received != shipped, marca discrepancia."""
    try:
        t = await service.receive_stock_transfer(
            db, transfer_id, [it.model_dump() for it in data.items], user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.post("/transfers/{transfer_id}/cancel", response_model=schemas.StockTransferInDB)
async def cancel_transfer(transfer_id: int, db: DB, current_user: CurrentUser,
                           reason: str = ""):
    """Cancela un traspaso NO enviado. Motivo obligatorio para auditoría."""
    if not reason or not reason.strip():
        raise HTTPException(status_code=400, detail="La razón de cancelación es obligatoria")
    try:
        t = await service.cancel_stock_transfer(db, transfer_id, reason.strip(), user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not t:
        raise HTTPException(status_code=404, detail="Traspaso no encontrado")
    return t


@router.get("/scan/{code}")
async def scan_lookup(code: str, db: DB, current_user: CurrentUser):
    """Busca un producto por SKU o código de barras.
    Usado por la UI de traspasos para el escáner rápido."""
    v = await service.find_variant_by_code(db, code)
    if not v:
        raise HTTPException(status_code=404, detail=f"Producto no encontrado con código '{code}'")
    return v


@router.get("/overstock-alerts")
async def overstock_alerts(db: DB, current_user: CurrentUser,
                            lookback_days: int = 60, days_threshold: int = 90):
    """Alertas de sobreinventario. Variantes con más días de stock que el umbral,
    ordenadas por severidad. Solo incluye variantes con ventas en la ventana
    (no se puede estimar demanda de productos nuevos o descontinuados)."""
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_overstock_alerts(
        db, warehouse_ids=ids, lookback_days=lookback_days, days_threshold=days_threshold,
    )


# ══════════════════════════════════════════════════════════════════════
# Workflow: solicitud de eliminación de producto con aprobación jerárquica
# ══════════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field
from sqlalchemy import select as _select
from sqlalchemy.orm import selectinload as _selectinload


class DeletionRequestCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class DeletionRequestReject(BaseModel):
    rejection_reason: str = Field(min_length=3, max_length=500)


class DeletionRequestOut(BaseModel):
    id: int
    product_id: int
    product_name: Optional[str] = None
    reason: str
    status: str
    requested_by_user_id: int
    requested_by_name: Optional[str] = None
    approved_by_user_id: Optional[int] = None
    approved_by_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    executed_at: Optional[datetime] = None
    created_at: datetime


def _is_approver(user: User) -> bool:
    """Puede aprobar/rechazar eliminación: superuser o rol con permiso
    inventory.approve. Ajustable via RBAC en Configuración."""
    if getattr(user, "is_superuser", False):
        return True
    role = getattr(user, "role_obj", None)
    if not role or not role.permissions:
        return False
    return any(p.module == "inventory" and p.action == "approve"
               for p in role.permissions)


async def _serialize_req(db: AsyncSession, req: models.ProductDeletionRequest) -> dict:
    """Enriquece con nombres para no tener que pedir /users desde el frontend."""
    from app.modules.auth import service as auth_service
    prod = None
    if req.product_id:
        prod = (await db.execute(
            _select(models.Product).where(models.Product.id == req.product_id)
        )).scalars().first()
    requester = await auth_service.get_user(db, req.requested_by_user_id)
    approver = None
    if req.approved_by_user_id:
        approver = await auth_service.get_user(db, req.approved_by_user_id)
    return {
        "id": req.id, "product_id": req.product_id,
        "product_name": prod.name if prod else None,
        "reason": req.reason, "status": req.status,
        "requested_by_user_id": req.requested_by_user_id,
        "requested_by_name": (requester.full_name if requester else None) or (requester.email if requester else None),
        "approved_by_user_id": req.approved_by_user_id,
        "approved_by_name": (approver.full_name if approver else None) or (approver.email if approver else None) if approver else None,
        "approved_at": req.approved_at,
        "rejected_at": req.rejected_at,
        "rejection_reason": req.rejection_reason,
        "executed_at": req.executed_at,
        "created_at": req.created_at,
    }


@router.post("/products/{product_id}/deletion-request",
              response_model=DeletionRequestOut, status_code=201)
async def create_deletion_request(
    product_id: int, payload: DeletionRequestCreate,
    db: DB, current_user: CurrentUser,
):
    """Solicita eliminar un producto. Cualquier rol con inventory.edit
    puede solicitar; la aprobación queda pendiente para un rol autorizado.
    Superuser: puede saltarse esto y llamar DELETE /products/{id} directo."""
    prod = (await db.execute(
        _select(models.Product).where(models.Product.id == product_id)
    )).scalars().first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")
    # ¿ya hay una solicitud pending para este producto?
    existing = (await db.execute(
        _select(models.ProductDeletionRequest).where(
            models.ProductDeletionRequest.product_id == product_id,
            models.ProductDeletionRequest.status == "pending",
        )
    )).scalars().first()
    if existing:
        raise HTTPException(
            400, "Ya existe una solicitud pendiente para este producto."
        )
    req = models.ProductDeletionRequest(
        product_id=product_id,
        requested_by_user_id=current_user.id,
        reason=payload.reason.strip(),
        status="pending",
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return await _serialize_req(db, req)


@router.get("/products/deletion-requests",
             response_model=List[DeletionRequestOut])
async def list_deletion_requests(
    db: DB, current_user: CurrentUser,
    status_filter: str = "pending",
):
    """Lista solicitudes de eliminación. Por default solo las pending
    (lo que el aprobador necesita ver). Pasa ?status_filter=all para todas."""
    stmt = _select(models.ProductDeletionRequest)
    if status_filter != "all":
        stmt = stmt.where(models.ProductDeletionRequest.status == status_filter)
    stmt = stmt.order_by(models.ProductDeletionRequest.created_at.desc()).limit(100)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _serialize_req(db, r) for r in rows]


@router.post("/products/deletion-requests/{request_id}/approve",
              response_model=DeletionRequestOut)
async def approve_deletion_request(
    request_id: int, db: DB, current_user: CurrentUser,
):
    """Aprueba una solicitud y EJECUTA el soft-delete del producto
    (Product.is_active=False). Historial de ventas queda intacto para
    auditoría — no hay hard delete de productos con actividad."""
    if not _is_approver(current_user):
        raise HTTPException(
            403, "Solo un administrador puede aprobar eliminaciones."
        )
    req = (await db.execute(
        _select(models.ProductDeletionRequest).where(
            models.ProductDeletionRequest.id == request_id
        )
    )).scalars().first()
    if not req:
        raise HTTPException(404, "Solicitud no encontrada")
    if req.status != "pending":
        raise HTTPException(
            400, f"Solicitud ya está en estado '{req.status}'."
        )
    prod = (await db.execute(
        _select(models.Product).where(models.Product.id == req.product_id)
    )).scalars().first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")
    now = datetime.utcnow()
    prod.is_active = False  # soft delete
    req.status = "executed"  # una vez aprobada, la ejecutamos en el mismo paso
    req.approved_by_user_id = current_user.id
    req.approved_at = now
    req.executed_at = now
    await db.commit()
    await db.refresh(req)
    return await _serialize_req(db, req)


@router.post("/products/deletion-requests/{request_id}/reject",
              response_model=DeletionRequestOut)
async def reject_deletion_request(
    request_id: int, payload: DeletionRequestReject,
    db: DB, current_user: CurrentUser,
):
    """Rechaza la solicitud con un motivo obligatorio."""
    if not _is_approver(current_user):
        raise HTTPException(
            403, "Solo un administrador puede rechazar eliminaciones."
        )
    req = (await db.execute(
        _select(models.ProductDeletionRequest).where(
            models.ProductDeletionRequest.id == request_id
        )
    )).scalars().first()
    if not req:
        raise HTTPException(404, "Solicitud no encontrada")
    if req.status != "pending":
        raise HTTPException(
            400, f"Solicitud ya está en estado '{req.status}'."
        )
    req.status = "rejected"
    req.approved_by_user_id = current_user.id
    req.rejected_at = datetime.utcnow()
    req.rejection_reason = payload.rejection_reason.strip()
    await db.commit()
    await db.refresh(req)
    return await _serialize_req(db, req)


@router.delete("/products/{product_id}")
async def delete_product_direct(
    product_id: int, db: DB, current_user: CurrentUser,
):
    """DELETE directo — SOLO superuser. Roles normales deben usar el
    workflow de solicitud (/products/{id}/deletion-request).
    Hace soft delete (is_active=False) para preservar historial."""
    if not getattr(current_user, "is_superuser", False):
        raise HTTPException(
            403,
            "Solo un superusuario puede eliminar productos directo. "
            "Usa el botón 'Solicitar eliminación' para pedir aprobación.",
        )
    prod = (await db.execute(
        _select(models.Product).where(models.Product.id == product_id)
    )).scalars().first()
    if not prod:
        raise HTTPException(404, "Producto no encontrado")
    prod.is_active = False
    await db.commit()
    return {"ok": True, "deleted": "soft"}
