from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
from io import BytesIO
import pandas as pd
from app.modules.inventory.models import (
    Product, ProductVariant, Warehouse, StockLevel, StockMovement, StockMovementType,
    Supplier, StockLot, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus,
    Recipe, RecipeItem, ProductionOrder, ProductionOrderStatus,
)
from app.modules.inventory import schemas

# --- Product Services ---
async def create_product(db: AsyncSession, product_in: schemas.ProductCreate) -> Product:
    db_product = Product(**product_in.model_dump())
    db.add(db_product)
    await db.commit()
    await db.refresh(db_product)
    return db_product

async def get_products(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[Product]:
    result = await db.execute(
        select(Product).offset(skip).limit(limit).options(
            selectinload(Product.variants).selectinload(ProductVariant.stock_levels).selectinload(StockLevel.warehouse),
            selectinload(Product.media),
        )
    )
    return result.scalars().all()

async def get_product(db: AsyncSession, product_id: int) -> Optional[Product]:
    result = await db.execute(
        select(Product).where(Product.id == product_id).options(
            selectinload(Product.variants).selectinload(ProductVariant.stock_levels).selectinload(StockLevel.warehouse),
            selectinload(Product.media),
        )
    )
    return result.scalars().first()

async def update_product(db: AsyncSession, product_id: int, product_in: schemas.ProductUpdate) -> Optional[Product]:
    product = await db.get(Product, product_id)
    if not product:
        return None
    for k, v in product_in.model_dump(exclude_unset=True).items():
        setattr(product, k, v)
    await db.commit()
    await db.refresh(product)
    return product

# --- Variant Services ---
async def create_variant(db: AsyncSession, variant_in: schemas.VariantCreate) -> ProductVariant:
    db_variant = ProductVariant(**variant_in.model_dump())
    db.add(db_variant)
    await db.commit()
    await db.refresh(db_variant)
    return db_variant

async def update_variant(db: AsyncSession, variant_id: int, variant_in: schemas.VariantUpdate) -> Optional[ProductVariant]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        return None
    for k, v in variant_in.model_dump(exclude_unset=True).items():
        setattr(variant, k, v)
    await db.commit()
    await db.refresh(variant)
    return variant

# --- Supplier Services ---
async def create_supplier(db: AsyncSession, supplier_in: schemas.SupplierCreate) -> Supplier:
    db_supplier = Supplier(**supplier_in.model_dump())
    db.add(db_supplier)
    await db.commit()
    await db.refresh(db_supplier)
    return db_supplier

async def get_suppliers(db: AsyncSession) -> List[Supplier]:
    result = await db.execute(select(Supplier).order_by(Supplier.name))
    return result.scalars().all()

async def update_supplier(db: AsyncSession, supplier_id: int, supplier_in: schemas.SupplierUpdate) -> Optional[Supplier]:
    supplier = await db.get(Supplier, supplier_id)
    if not supplier:
        return None
    for k, v in supplier_in.model_dump(exclude_unset=True).items():
        setattr(supplier, k, v)
    await db.commit()
    await db.refresh(supplier)
    return supplier

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

async def update_warehouse(db: AsyncSession, warehouse_id: int, warehouse_in: schemas.WarehouseUpdate) -> Optional[Warehouse]:
    warehouse = await db.get(Warehouse, warehouse_id)
    if not warehouse:
        return None
    for k, v in warehouse_in.model_dump(exclude_unset=True).items():
        setattr(warehouse, k, v)
    await db.commit()
    await db.refresh(warehouse)
    return warehouse


# --- Costeo FIFO -------------------------------------------------------------
async def _create_lot(db: AsyncSession, variant_id: int, warehouse_id: int, quantity: int, unit_cost: float, reference: Optional[str]) -> StockLot:
    lot = StockLot(
        variant_id=variant_id, warehouse_id=warehouse_id,
        quantity_received=quantity, quantity_remaining=quantity,
        unit_cost=unit_cost, reference=reference,
    )
    db.add(lot)
    return lot

async def _consume_fifo(db: AsyncSession, variant_id: int, warehouse_id: int, quantity: int) -> float:
    """Consume `quantity` unidades de los lotes más antiguos disponibles en ese
    almacén y devuelve el costo promedio ponderado de lo consumido (para
    registrar en el movimiento de salida). Si no hay lotes suficientes, el
    remanente se valúa al último costo conocido del lote más reciente (o 0)."""
    result = await db.execute(
        select(StockLot)
        .where(StockLot.variant_id == variant_id, StockLot.warehouse_id == warehouse_id, StockLot.quantity_remaining > 0)
        .order_by(StockLot.received_at.asc())
    )
    lots = result.scalars().all()
    remaining = quantity
    total_cost = 0.0
    total_consumed = 0
    last_cost = 0.0
    for lot in lots:
        if remaining <= 0:
            break
        take = min(remaining, lot.quantity_remaining)
        lot.quantity_remaining -= take
        total_cost += take * lot.unit_cost
        total_consumed += take
        last_cost = lot.unit_cost
        remaining -= take
    if remaining > 0:
        # No había lotes suficientes (datos históricos sin lote, ajuste, etc.)
        total_cost += remaining * last_cost
        total_consumed += remaining
    return (total_cost / total_consumed) if total_consumed else 0.0

async def _recalc_weighted_avg_cost(db: AsyncSession, variant_id: int) -> None:
    result = await db.execute(
        select(StockLot).where(StockLot.variant_id == variant_id, StockLot.quantity_remaining > 0)
    )
    lots = result.scalars().all()
    total_qty = sum(l.quantity_remaining for l in lots)
    if total_qty <= 0:
        return
    total_cost = sum(l.quantity_remaining * l.unit_cost for l in lots)
    variant = await db.get(ProductVariant, variant_id)
    if variant:
        variant.cost_price = round(total_cost / total_qty, 4)


# --- Stock Services ---
async def adjust_stock(db: AsyncSession, movement_in: schemas.StockMovementCreate, user_id: Optional[int] = None) -> StockMovement:
    result = await db.execute(
        select(StockLevel).where(
            StockLevel.variant_id == movement_in.variant_id,
            StockLevel.warehouse_id == movement_in.warehouse_id
        )
    )
    stock_level = result.scalars().first()
    if not stock_level:
        stock_level = StockLevel(variant_id=movement_in.variant_id, warehouse_id=movement_in.warehouse_id, quantity=0)
        db.add(stock_level)

    unit_cost = movement_in.unit_cost

    if movement_in.movement_type == StockMovementType.IN:
        cost = unit_cost if unit_cost is not None else 0.0
        await _create_lot(db, movement_in.variant_id, movement_in.warehouse_id, movement_in.quantity, cost, movement_in.reference)
        stock_level.quantity += movement_in.quantity
        await _recalc_weighted_avg_cost(db, movement_in.variant_id)
    elif movement_in.movement_type == StockMovementType.OUT:
        unit_cost = await _consume_fifo(db, movement_in.variant_id, movement_in.warehouse_id, movement_in.quantity)
        stock_level.quantity -= movement_in.quantity
        await _recalc_weighted_avg_cost(db, movement_in.variant_id)
    elif movement_in.movement_type == StockMovementType.ADJUSTMENT:
        # Delta de corrección. Si es positivo se trata como una entrada a costo
        # actual (no genera lote nuevo); si es negativo, se descuenta del costo
        # promedio vigente sin tocar lotes (merma/ajuste de conteo).
        stock_level.quantity += movement_in.quantity
        if unit_cost is None:
            variant = await db.get(ProductVariant, movement_in.variant_id)
            unit_cost = variant.cost_price if variant else 0.0

    db_movement = StockMovement(
        variant_id=movement_in.variant_id,
        warehouse_id=movement_in.warehouse_id,
        quantity=movement_in.quantity if movement_in.movement_type != StockMovementType.OUT else -abs(movement_in.quantity),
        movement_type=movement_in.movement_type,
        unit_cost=unit_cost,
        reference=movement_in.reference,
        notes=movement_in.notes,
        user_id=user_id
    )
    db.add(db_movement)

    await db.commit()
    await db.refresh(db_movement)
    return db_movement

async def get_stock_levels(db: AsyncSession, variant_id: Optional[int] = None) -> List[StockLevel]:
    query = select(StockLevel).options(selectinload(StockLevel.warehouse), selectinload(StockLevel.variant))
    if variant_id:
        query = query.where(StockLevel.variant_id == variant_id)
    result = await db.execute(query)
    return result.scalars().all()

async def get_movements(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[dict]:
    result = await db.execute(
        select(StockMovement)
        .options(selectinload(StockMovement.variant).selectinload(ProductVariant.product), selectinload(StockMovement.warehouse))
        .order_by(StockMovement.created_at.desc())
        .offset(skip).limit(limit)
    )
    movements = result.scalars().all()
    out = []
    for m in movements:
        out.append({
            "id": m.id, "variant_id": m.variant_id, "warehouse_id": m.warehouse_id,
            "quantity": m.quantity, "movement_type": m.movement_type, "unit_cost": m.unit_cost,
            "reference": m.reference, "notes": m.notes, "created_at": m.created_at,
            "product_name": m.variant.product.name if m.variant and m.variant.product else None,
            "sku": m.variant.sku if m.variant else None,
            "warehouse_name": m.warehouse.name if m.warehouse else None,
        })
    return out


# --- Reorder alerts -----------------------------------------------------------
async def get_reorder_alerts(db: AsyncSession) -> List[schemas.ReorderAlert]:
    result = await db.execute(
        select(StockLevel)
        .options(
            selectinload(StockLevel.variant).selectinload(ProductVariant.product),
            selectinload(StockLevel.variant).selectinload(ProductVariant.preferred_supplier),
            selectinload(StockLevel.warehouse),
        )
    )
    levels = result.scalars().all()
    alerts: List[schemas.ReorderAlert] = []
    for lvl in levels:
        v = lvl.variant
        if not v or v.reorder_point is None:
            continue
        available = lvl.quantity - lvl.reserved_quantity
        if available > v.reorder_point:
            continue
        safety = v.safety_stock or 0
        level = "red" if available <= safety else "yellow"
        alerts.append(schemas.ReorderAlert(
            variant_id=v.id, sku=v.sku, product_name=v.product.name if v.product else "",
            warehouse_id=lvl.warehouse_id, warehouse_name=lvl.warehouse.name if lvl.warehouse else "",
            available=available, reserved=lvl.reserved_quantity,
            reorder_point=v.reorder_point, safety_stock=safety, level=level,
            preferred_supplier_id=v.preferred_supplier_id,
            preferred_supplier_name=v.preferred_supplier.name if v.preferred_supplier else None,
            lead_time_days=v.lead_time_days,
        ))
    alerts.sort(key=lambda a: (a.level != "red", a.available))
    return alerts


# --- Purchase Orders -----------------------------------------------------------
async def _next_folio(db: AsyncSession, model, prefix: str) -> str:
    result = await db.execute(select(model.id).order_by(model.id.desc()).limit(1))
    last_id = result.scalar()
    return f"{prefix}-{(last_id or 0) + 1:05d}"

async def create_purchase_order(db: AsyncSession, po_in: schemas.PurchaseOrderCreate, user_id: Optional[int] = None) -> PurchaseOrder:
    folio = await _next_folio(db, PurchaseOrder, "OC")
    total_amount = round(sum(item.quantity * item.unit_cost for item in po_in.items), 2)
    po = PurchaseOrder(
        folio=folio, supplier_id=po_in.supplier_id, warehouse_id=po_in.warehouse_id,
        notes=po_in.notes, status=PurchaseOrderStatus.ORDERED.value, user_id=user_id,
        total_amount=total_amount, paid_amount=0.0, due_date=po_in.due_date,
    )
    db.add(po)
    await db.flush()
    for item in po_in.items:
        db.add(PurchaseOrderItem(purchase_order_id=po.id, variant_id=item.variant_id, quantity=item.quantity, unit_cost=item.unit_cost))
    await db.commit()
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po.id).options(selectinload(PurchaseOrder.items)))
    return result.scalars().first()

async def get_purchase_orders(db: AsyncSession) -> List[PurchaseOrder]:
    result = await db.execute(select(PurchaseOrder).options(selectinload(PurchaseOrder.items)).order_by(PurchaseOrder.created_at.desc()))
    return result.scalars().all()

async def receive_purchase_order(db: AsyncSession, po_id: int, user_id: Optional[int] = None) -> Optional[PurchaseOrder]:
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(selectinload(PurchaseOrder.items)))
    po = result.scalars().first()
    if not po or po.status == PurchaseOrderStatus.RECEIVED.value:
        return po
    for item in po.items:
        movement_in = schemas.StockMovementCreate(
            variant_id=item.variant_id, warehouse_id=po.warehouse_id, quantity=item.quantity,
            movement_type=StockMovementType.IN.value, unit_cost=item.unit_cost,
            reference=po.folio, notes=f"Recepción de orden de compra {po.folio}",
        )
        await adjust_stock(db, movement_in, user_id=user_id)
    po.status = PurchaseOrderStatus.RECEIVED.value
    po.received_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(po)
    return po

async def cancel_purchase_order(db: AsyncSession, po_id: int) -> Optional[PurchaseOrder]:
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(selectinload(PurchaseOrder.items)))
    po = result.scalars().first()
    if not po:
        return None
    if po.status == PurchaseOrderStatus.RECEIVED.value:
        raise ValueError("No se puede cancelar una orden ya recibida")
    po.status = PurchaseOrderStatus.CANCELLED.value
    await db.commit()
    await db.refresh(po)
    return po


async def pay_purchase_order(db: AsyncSession, po_id: int, pay_in: "schemas.SupplierPaymentCreate", user_id: Optional[int] = None) -> Optional[PurchaseOrder]:
    from app.modules.inventory.models import SupplierPayment
    result = await db.execute(select(PurchaseOrder).where(PurchaseOrder.id == po_id).options(selectinload(PurchaseOrder.items)))
    po = result.scalars().first()
    if not po:
        return None
    if po.status == PurchaseOrderStatus.CANCELLED.value:
        raise ValueError("No se puede pagar una orden cancelada")
    balance = round((po.total_amount or 0.0) - (po.paid_amount or 0.0), 2)
    if pay_in.amount > balance + 0.001:
        raise ValueError(f"El pago (${pay_in.amount:,.2f}) excede el saldo (${balance:,.2f})")
    db.add(SupplierPayment(
        purchase_order_id=po.id, amount=pay_in.amount, method=pay_in.method,
        reference=pay_in.reference, note=pay_in.note, user_id=user_id,
    ))
    po.paid_amount = round((po.paid_amount or 0.0) + pay_in.amount, 2)

    from app.modules.finance import models as fin
    db.add(fin.Transaction(
        type="expense", amount=round(pay_in.amount, 2), category="supplies",
        description=f"Pago a proveedor — OC {po.folio or '#' + str(po.id)}",
        reference=f"po:{po.id}",
    ))
    await db.commit()
    await db.refresh(po)
    return po


# --- BOM / Recipes -------------------------------------------------------------
async def create_recipe(db: AsyncSession, recipe_in: schemas.RecipeCreate) -> Recipe:
    recipe = Recipe(
        output_variant_id=recipe_in.output_variant_id, name=recipe_in.name,
        labor_cost=recipe_in.labor_cost, overhead_cost=recipe_in.overhead_cost,
        yield_quantity=recipe_in.yield_quantity,
    )
    db.add(recipe)
    await db.flush()
    for item in recipe_in.items:
        db.add(RecipeItem(recipe_id=recipe.id, input_variant_id=item.input_variant_id, quantity=item.quantity))
    product = await db.get(Product, (await db.get(ProductVariant, recipe_in.output_variant_id)).product_id)
    if product:
        product.is_manufactured = True
    await db.commit()
    result = await db.execute(select(Recipe).where(Recipe.id == recipe.id).options(selectinload(Recipe.items)))
    return result.scalars().first()

async def get_recipes(db: AsyncSession) -> List[Recipe]:
    result = await db.execute(select(Recipe).options(selectinload(Recipe.items)).order_by(Recipe.id.desc()))
    return result.scalars().all()

async def get_recipe(db: AsyncSession, recipe_id: int) -> Optional[Recipe]:
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id).options(selectinload(Recipe.items)))
    return result.scalars().first()

async def update_recipe(db: AsyncSession, recipe_id: int, recipe_in: schemas.RecipeUpdate) -> Optional[Recipe]:
    recipe = await get_recipe(db, recipe_id)
    if not recipe:
        return None
    recipe.name = recipe_in.name
    recipe.labor_cost = recipe_in.labor_cost
    recipe.overhead_cost = recipe_in.overhead_cost
    recipe.yield_quantity = recipe_in.yield_quantity
    recipe.is_active = recipe_in.is_active
    for old_item in list(recipe.items):
        await db.delete(old_item)
    await db.flush()
    for item in recipe_in.items:
        db.add(RecipeItem(recipe_id=recipe.id, input_variant_id=item.input_variant_id, quantity=item.quantity))
    await db.commit()
    return await get_recipe(db, recipe_id)

async def get_recipe_cost(db: AsyncSession, recipe_id: int) -> Optional[schemas.RecipeCostBreakdown]:
    recipe = await get_recipe(db, recipe_id)
    if not recipe:
        return None
    materials_cost = 0.0
    missing = []
    for item in recipe.items:
        variant = await db.get(ProductVariant, item.input_variant_id)
        if not variant or variant.cost_price is None:
            missing.append(variant.sku if variant else str(item.input_variant_id))
            continue
        materials_cost += item.quantity * variant.cost_price
    total = materials_cost + recipe.labor_cost + recipe.overhead_cost
    unit_cost = total / recipe.yield_quantity if recipe.yield_quantity else total
    return schemas.RecipeCostBreakdown(
        recipe_id=recipe.id, materials_cost=round(materials_cost, 4), labor_cost=recipe.labor_cost,
        overhead_cost=recipe.overhead_cost, total_cost=round(total, 4), unit_cost=round(unit_cost, 4),
        missing_cost_inputs=missing,
    )


# --- Production Orders ----------------------------------------------------------
async def create_production_order(db: AsyncSession, po_in: schemas.ProductionOrderCreate, user_id: Optional[int] = None) -> ProductionOrder:
    recipe = await get_recipe(db, po_in.recipe_id)
    if not recipe:
        raise ValueError("Receta no encontrada")
    folio = await _next_folio(db, ProductionOrder, "PROD")
    prod = ProductionOrder(
        folio=folio, recipe_id=po_in.recipe_id, warehouse_id=po_in.warehouse_id,
        runs=po_in.runs, notes=po_in.notes, user_id=user_id,
    )
    db.add(prod)
    await db.commit()
    await db.refresh(prod)
    return prod

async def get_production_orders(db: AsyncSession) -> List[ProductionOrder]:
    result = await db.execute(select(ProductionOrder).order_by(ProductionOrder.created_at.desc()))
    return result.scalars().all()

async def complete_production_order(db: AsyncSession, prod_id: int, user_id: Optional[int] = None) -> ProductionOrder:
    prod = await db.get(ProductionOrder, prod_id)
    if not prod or prod.status != ProductionOrderStatus.DRAFT.value:
        return prod
    recipe = await get_recipe(db, prod.recipe_id)
    if not recipe:
        raise ValueError("Receta no encontrada")

    total_materials_cost = 0.0
    # 1. Consumir insumos (FIFO) del almacén de producción
    for item in recipe.items:
        qty_needed = item.quantity * prod.runs
        out_move = schemas.StockMovementCreate(
            variant_id=item.input_variant_id, warehouse_id=prod.warehouse_id, quantity=int(qty_needed),
            movement_type=StockMovementType.OUT.value, reference=prod.folio,
            notes=f"Consumo de insumo para orden de producción {prod.folio}",
        )
        movement = await adjust_stock(db, out_move, user_id=user_id)
        total_materials_cost += (movement.unit_cost or 0) * qty_needed

    # 2. Dar de alta el producto terminado al costo real calculado
    output_qty = recipe.yield_quantity * prod.runs
    total_cost = total_materials_cost + (recipe.labor_cost + recipe.overhead_cost) * prod.runs
    unit_cost_result = total_cost / output_qty if output_qty else 0.0

    in_move = schemas.StockMovementCreate(
        variant_id=recipe.output_variant_id, warehouse_id=prod.warehouse_id, quantity=int(output_qty),
        movement_type=StockMovementType.IN.value, unit_cost=round(unit_cost_result, 4), reference=prod.folio,
        notes=f"Producto terminado de orden de producción {prod.folio}",
    )
    await adjust_stock(db, in_move, user_id=user_id)

    prod.status = ProductionOrderStatus.COMPLETED.value
    prod.unit_cost_result = round(unit_cost_result, 4)
    prod.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(prod)
    return prod


# --- Carga masiva (Excel/CSV) ---------------------------------------------------
PRODUCTS_TEMPLATE_COLUMNS = [
    "sku", "producto", "categoria", "fabricado_interno", "talla", "color", "material",
    "precio", "costo", "almacen", "stock_inicial", "punto_reorden", "stock_seguridad",
    "dias_entrega_proveedor",
]

RECIPES_TEMPLATE_COLUMNS = [
    "sku_producto_terminado", "nombre_receta", "sku_insumo", "cantidad_insumo",
    "costo_mano_obra_maquila", "costo_indirectos", "unidades_por_corrida",
]

def _build_xlsx(columns: List[str], example_rows: List[list], sheet_name: str) -> bytes:
    df = pd.DataFrame(example_rows, columns=columns)
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    return buffer.getvalue()

def generate_products_template() -> bytes:
    example = [
        ["CAM-001-AZ-CH", "Camisa de algodón", "Ropa", "no", "CH", "Azul", "Algodón",
         350.0, 180.0, "Almacén Principal", 50, 10, 5, 7],
        ["TEL-ALG-001", "Tela de algodón (insumo)", "Materia prima", "no", "", "", "Algodón",
         0, 45.0, "Almacén Principal", 500, 100, 50, 15],
    ]
    return _build_xlsx(PRODUCTS_TEMPLATE_COLUMNS, example, "productos")

def generate_recipes_template() -> bytes:
    example = [
        ["CAM-001-AZ-CH", "Camisa de algodón - receta", "TEL-ALG-001", 1.5, 30.0, 10.0, 1],
    ]
    return _build_xlsx(RECIPES_TEMPLATE_COLUMNS, example, "recetas")

def _read_table(file_bytes: bytes, filename: str) -> pd.DataFrame:
    name = (filename or "").lower()
    if name.endswith(".csv"):
        df = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(BytesIO(file_bytes), dtype=str, keep_default_na=False)
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df

def _to_float(v, default=None):
    v = (v or "").strip() if isinstance(v, str) else v
    if v in (None, ""):
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default

def _to_int(v, default=None):
    f = _to_float(v, None)
    return int(f) if f is not None else default

def _to_bool_si_no(v) -> bool:
    return str(v).strip().lower() in ("si", "sí", "true", "1", "yes")

async def bulk_import_products(db: AsyncSession, file_bytes: bytes, filename: str, user_id: Optional[int] = None) -> schemas.BulkImportResult:
    df = _read_table(file_bytes, filename)
    missing_cols = [c for c in ("sku", "producto", "precio") if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Faltan columnas requeridas en el archivo: {', '.join(missing_cols)}")

    products_by_name: dict[str, Product] = {}
    result_warehouses: dict[str, Warehouse] = {}
    created, updated = 0, 0
    errors: List[schemas.BulkImportRowError] = []

    for idx, row in df.iterrows():
        row_num = idx + 2  # +1 por encabezado, +1 porque idx es 0-based
        try:
            sku = str(row.get("sku", "")).strip()
            product_name = str(row.get("producto", "")).strip()
            if not sku or not product_name:
                errors.append(schemas.BulkImportRowError(row=row_num, message="sku y producto son obligatorios"))
                continue
            price = _to_float(row.get("precio"))
            if price is None:
                errors.append(schemas.BulkImportRowError(row=row_num, message="precio es obligatorio y debe ser numérico"))
                continue

            product = products_by_name.get(product_name.lower())
            if not product:
                result = await db.execute(select(Product).where(Product.name == product_name))
                product = result.scalars().first()
                if not product:
                    product = Product(
                        name=product_name,
                        category=str(row.get("categoria", "")).strip() or None,
                        is_manufactured=_to_bool_si_no(row.get("fabricado_interno", "no")),
                    )
                    db.add(product)
                    await db.flush()
                products_by_name[product_name.lower()] = product

            result = await db.execute(select(ProductVariant).where(ProductVariant.sku == sku))
            variant = result.scalars().first()
            cost_price = _to_float(row.get("costo"))
            if variant:
                variant.price = price
                if cost_price is not None:
                    variant.cost_price = cost_price
                variant.size = str(row.get("talla", "")).strip() or None
                variant.color = str(row.get("color", "")).strip() or None
                variant.material = str(row.get("material", "")).strip() or None
                variant.reorder_point = _to_int(row.get("punto_reorden"))
                variant.safety_stock = _to_int(row.get("stock_seguridad"))
                variant.lead_time_days = _to_int(row.get("dias_entrega_proveedor"))
                updated += 1
            else:
                variant = ProductVariant(
                    product_id=product.id, sku=sku, price=price, cost_price=cost_price,
                    size=str(row.get("talla", "")).strip() or None,
                    color=str(row.get("color", "")).strip() or None,
                    material=str(row.get("material", "")).strip() or None,
                    reorder_point=_to_int(row.get("punto_reorden")),
                    safety_stock=_to_int(row.get("stock_seguridad")),
                    lead_time_days=_to_int(row.get("dias_entrega_proveedor")),
                )
                db.add(variant)
                await db.flush()
                created += 1

            stock_inicial = _to_int(row.get("stock_inicial"))
            almacen_name = str(row.get("almacen", "")).strip()
            if stock_inicial and stock_inicial > 0 and almacen_name:
                warehouse = result_warehouses.get(almacen_name.lower())
                if not warehouse:
                    result = await db.execute(select(Warehouse).where(Warehouse.name == almacen_name))
                    warehouse = result.scalars().first()
                    if not warehouse:
                        warehouse = Warehouse(name=almacen_name)
                        db.add(warehouse)
                        await db.flush()
                    result_warehouses[almacen_name.lower()] = warehouse
                movement_in = schemas.StockMovementCreate(
                    variant_id=variant.id, warehouse_id=warehouse.id, quantity=stock_inicial,
                    movement_type=StockMovementType.IN.value, unit_cost=cost_price,
                    reference="CARGA-MASIVA", notes="Stock inicial por carga masiva de inventario",
                )
                await adjust_stock(db, movement_in, user_id=user_id)
        except Exception as e:
            errors.append(schemas.BulkImportRowError(row=row_num, message=str(e)))

    await db.commit()
    return schemas.BulkImportResult(total_rows=len(df), created=created, updated=updated, errors=errors)

async def bulk_import_recipes(db: AsyncSession, file_bytes: bytes, filename: str) -> schemas.BulkImportResult:
    df = _read_table(file_bytes, filename)
    missing_cols = [c for c in ("sku_producto_terminado", "sku_insumo", "cantidad_insumo") if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Faltan columnas requeridas en el archivo: {', '.join(missing_cols)}")

    grouped: dict[str, dict] = {}
    errors: List[schemas.BulkImportRowError] = []

    for idx, row in df.iterrows():
        row_num = idx + 2
        try:
            output_sku = str(row.get("sku_producto_terminado", "")).strip()
            input_sku = str(row.get("sku_insumo", "")).strip()
            quantity = _to_float(row.get("cantidad_insumo"))
            if not output_sku or not input_sku or quantity is None:
                errors.append(schemas.BulkImportRowError(
                    row=row_num, message="sku_producto_terminado, sku_insumo y cantidad_insumo son obligatorios"))
                continue

            result = await db.execute(select(ProductVariant).where(ProductVariant.sku == output_sku))
            output_variant = result.scalars().first()
            if not output_variant:
                errors.append(schemas.BulkImportRowError(row=row_num, message=f"SKU de producto terminado no encontrado: {output_sku}"))
                continue
            result = await db.execute(select(ProductVariant).where(ProductVariant.sku == input_sku))
            input_variant = result.scalars().first()
            if not input_variant:
                errors.append(schemas.BulkImportRowError(row=row_num, message=f"SKU de insumo no encontrado: {input_sku}"))
                continue

            entry = grouped.setdefault(output_sku, {
                "output_variant_id": output_variant.id,
                "name": str(row.get("nombre_receta", "")).strip() or None,
                "labor_cost": _to_float(row.get("costo_mano_obra_maquila"), 0) or 0,
                "overhead_cost": _to_float(row.get("costo_indirectos"), 0) or 0,
                "yield_quantity": _to_int(row.get("unidades_por_corrida"), 1) or 1,
                "items": [],
            })
            entry["items"].append(schemas.RecipeItemCreate(input_variant_id=input_variant.id, quantity=quantity))
        except Exception as e:
            errors.append(schemas.BulkImportRowError(row=row_num, message=str(e)))

    created, updated = 0, 0
    for output_sku, entry in grouped.items():
        try:
            result = await db.execute(select(Recipe).where(Recipe.output_variant_id == entry["output_variant_id"]))
            existing = result.scalars().first()
            recipe_in = schemas.RecipeCreate(
                output_variant_id=entry["output_variant_id"], name=entry["name"],
                labor_cost=entry["labor_cost"], overhead_cost=entry["overhead_cost"],
                yield_quantity=entry["yield_quantity"], items=entry["items"],
            )
            if existing:
                await update_recipe(db, existing.id, schemas.RecipeUpdate(**recipe_in.model_dump(), is_active=True))
                updated += 1
            else:
                await create_recipe(db, recipe_in)
                created += 1
        except Exception as e:
            errors.append(schemas.BulkImportRowError(row=0, message=f"Receta para {output_sku}: {e}"))

    return schemas.BulkImportResult(total_rows=len(df), created=created, updated=updated, errors=errors)
