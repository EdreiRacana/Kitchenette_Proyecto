from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Enum, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.db.session import Base

class StockMovementType(str, enum.Enum):
    IN = "in"
    OUT = "out"
    ADJUSTMENT = "adjustment"

class WarehouseType(str, enum.Enum):
    OWN = "own"                   # bodega / tienda física propia
    MARKETPLACE = "marketplace"   # fulfillment de un marketplace (ML Full, FBA, etc.)
    CONSIGNMENT = "consignment"   # stock en poder de un tercero
    TRANSIT = "transit"           # en tránsito entre almacenes

class ProductItemType(str, enum.Enum):
    FINISHED_GOOD = "finished_good"   # producto terminado, listo para venta
    RAW_MATERIAL = "raw_material"     # insumo, usado en recetas/producción
    CONSUMABLE = "consumable"         # consumible (limpieza, empaque, etc.)
    SERVICE = "service"               # servicio (no tiene stock ni entra en inventario)
    OTHER = "other"

class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    contact_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    rfc = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    lead_time_days = Column(Integer, default=7)
    payment_terms = Column(String, nullable=True)  # ej. "Contado", "30 días"
    commercial_terms = Column(Text, nullable=True)  # condiciones comerciales
    extra_contacts = Column(JSON, nullable=True)    # [{name, role, phone, email}, ...]
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    purchase_orders = relationship("PurchaseOrder", back_populates="supplier")
    documents = relationship("SupplierDocument", back_populates="supplier", cascade="all, delete-orphan")


class SupplierDocument(Base):
    __tablename__ = "supplier_documents"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    doc_type = Column(String, nullable=False)  # rfc, acta_constitutiva, caratula_edo_cuenta, otro
    file_url = Column(String, nullable=False)
    file_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    supplier = relationship("Supplier", back_populates="documents")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, index=True, nullable=True)
    is_active = Column(Boolean, default=True)

    # is_manufactured=True -> el producto se fabrica internamente vía receta (BOM)
    is_manufactured = Column(Boolean, default=False)

    # Clasificación de inventario: producto terminado, insumo, consumible u otro
    item_type = Column(String, default=ProductItemType.FINISHED_GOOD.value, nullable=False)

    # Simple media support for now (URLs)
    image_url = Column(String, nullable=True)
    video_url = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    variants = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")
    media = relationship("ProductMedia", back_populates="product", cascade="all, delete-orphan")

class ProductMedia(Base):
    __tablename__ = "product_media"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    file_url = Column(String, nullable=False)
    media_type = Column(String, default="image") # image, video
    is_primary = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("Product", back_populates="media")

class ProductVariant(Base):
    __tablename__ = "product_variants"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    sku = Column(String, unique=True, index=True, nullable=False)
    barcode = Column(String, index=True, nullable=True)  # EAN/UPC para búsqueda por código

    # Attributes
    size = Column(String, nullable=True)
    color = Column(String, nullable=True)
    material = Column(String, nullable=True)

    # Pricing
    price = Column(Float, nullable=False)             # precio público
    cost_price = Column(Float, nullable=True)          # costo promedio ponderado vigente (se recalcula con cada entrada/lote)

    # Reabastecimiento
    reorder_point = Column(Integer, nullable=True)      # punto de reorden (disponible - reservado <= esto -> alerta)
    safety_stock = Column(Integer, nullable=True)       # stock de seguridad
    lead_time_days = Column(Integer, nullable=True)     # tiempo de entrega del proveedor preferido (días)
    preferred_supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)

    is_active = Column(Boolean, default=True)

    product = relationship("Product", back_populates="variants")
    stock_levels = relationship("StockLevel", back_populates="variant")
    preferred_supplier = relationship("Supplier")
    recipe = relationship("Recipe", back_populates="output_variant", uselist=False)

class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    location = Column(String, nullable=True)
    type = Column(String, default=WarehouseType.OWN.value, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)  # sucursal asignada
    is_active = Column(Boolean, default=True)

class StockLevel(Base):
    __tablename__ = "stock_levels"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Integer, default=0, nullable=False)            # disponible físicamente
    reserved_quantity = Column(Integer, default=0, nullable=False)   # comprometido en pedidos no surtidos

    variant = relationship("ProductVariant", back_populates="stock_levels")
    warehouse = relationship("Warehouse")

class StockLot(Base):
    """Lote de costeo FIFO: cada entrada (compra/producción) crea un lote con su
    costo unitario propio; las salidas consumen lotes en orden de llegada."""
    __tablename__ = "stock_lots"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity_received = Column(Integer, nullable=False)
    quantity_remaining = Column(Integer, nullable=False)
    unit_cost = Column(Float, nullable=False)
    reference = Column(String, nullable=True)  # OC-xxxx, PROD-xxxx
    received_at = Column(DateTime(timezone=True), server_default=func.now())

    variant = relationship("ProductVariant")
    warehouse = relationship("Warehouse")

class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Integer, nullable=False) # Positive or negative
    movement_type = Column(String, nullable=False) # IN, OUT, ADJUSTMENT
    unit_cost = Column(Float, nullable=True)   # costo aplicado (FIFO) en salidas, costo de entrada en IN
    reference = Column(String, nullable=True) # Order ID, Transfer ID, OC, Producción
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Linked to Auth module if user is logged in

    variant = relationship("ProductVariant")
    warehouse = relationship("Warehouse")


# ── Proveedores / Compras ───────────────────────────────────────────────────
class PurchaseOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    ORDERED = "ordered"
    RECEIVED = "received"
    CANCELLED = "cancelled"

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, index=True, nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    status = Column(String, default=PurchaseOrderStatus.DRAFT.value, nullable=False)
    notes = Column(Text, nullable=True)
    total_amount = Column(Float, default=0.0, nullable=False)
    paid_amount = Column(Float, default=0.0, nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    received_at = Column(DateTime(timezone=True), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    supplier = relationship("Supplier", back_populates="purchase_orders")
    warehouse = relationship("Warehouse")
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")
    supplier_payments = relationship("SupplierPayment", back_populates="purchase_order", cascade="all, delete-orphan")

    @property
    def balance(self) -> float:
        return round((self.total_amount or 0.0) - (self.paid_amount or 0.0), 2)

class SupplierPayment(Base):
    __tablename__ = "supplier_payments"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    method = Column(String, nullable=True)
    reference = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    purchase_order = relationship("PurchaseOrder", back_populates="supplier_payments")

class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_order_id = Column(Integer, ForeignKey("purchase_orders.id"), nullable=False)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_cost = Column(Float, nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")
    variant = relationship("ProductVariant")


# ── BOM / Construcción de producto ──────────────────────────────────────────
class Recipe(Base):
    """Receta (BOM): qué insumos y cuánta mano de obra/gastos indirectos
    componen una variante fabricada. 1 receta vigente por variante de salida,
    versionada para no alterar costos de pedidos ya facturados."""
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True, index=True)
    output_variant_id = Column(Integer, ForeignKey("product_variants.id"), unique=True, nullable=False)
    name = Column(String, nullable=True)
    labor_cost = Column(Float, default=0)
    overhead_cost = Column(Float, default=0)
    extra_costs = Column(JSON, nullable=True)  # [{description, amount}, ...] gastos extra (transporte, corte, maquila...)
    yield_quantity = Column(Integer, default=1)  # unidades de salida que produce 1 corrida
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    output_variant = relationship("ProductVariant", back_populates="recipe")
    items = relationship("RecipeItem", back_populates="recipe", cascade="all, delete-orphan")

class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id = Column(Integer, primary_key=True, index=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    input_variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    quantity = Column(Float, nullable=False)  # cantidad de insumo requerida por corrida (yield_quantity unidades)

    recipe = relationship("Recipe", back_populates="items")
    input_variant = relationship("ProductVariant", foreign_keys=[input_variant_id])

class ProductionOrderStatus(str, enum.Enum):
    DRAFT = "draft"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class ProductionOrder(Base):
    """Orden de producción: consume insumos del almacén (FIFO) y da de alta
    el producto terminado, usando el mismo motor de movimientos de stock."""
    __tablename__ = "production_orders"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, index=True, nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    runs = Column(Integer, default=1, nullable=False)  # número de corridas de la receta
    status = Column(String, default=ProductionOrderStatus.DRAFT.value, nullable=False)
    unit_cost_result = Column(Float, nullable=True)  # costo unitario calculado al completar
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    recipe = relationship("Recipe")
    warehouse = relationship("Warehouse")
