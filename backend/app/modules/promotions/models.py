"""
Planificador de promociones + sugerencias de traspaso automático.

Reemplaza el Excel manual con el que se calculaban cuántas unidades enviar a
cada tienda antes de una promoción. Se compone de 4 entidades:

  * PromotionPlan       — la promoción (nombre, fechas, uplift esperado)
  * PromotionPlanItem   — qué variantes entran en la promoción
  * PromotionTargetStore — a qué almacenes/tiendas aplica
  * PromotionSuggestion — sugerencias de traspaso generadas por el motor

El motor de sugerencias corre bajo demanda: para cada (variante, tienda-destino)
proyecta la demanda esperada durante la promoción (velocidad histórica × uplift),
resta el stock actual y sugiere traspasar el déficit desde el CEDIS/almacén con
más disponibilidad. Cada sugerencia se puede materializar en un StockTransfer
real con un click en el frontend.
"""

from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.session import Base


class PromotionStatus(str, enum.Enum):
    PLANNED = "planned"      # capturada, aún no arranca
    ACTIVE = "active"        # en curso (start_date ≤ hoy ≤ end_date)
    FINISHED = "finished"    # terminada
    CANCELLED = "cancelled"  # cancelada antes de terminar


class PromotionPlan(Base):
    __tablename__ = "promotion_plans"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, index=True, nullable=True)  # PRM-000001
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    start_date = Column(DateTime(timezone=True), nullable=False, index=True)
    end_date = Column(DateTime(timezone=True), nullable=False, index=True)

    # Uplift esperado sobre la venta base histórica (%). Ej: 50 → se espera vender
    # 50% más de lo normal durante la promo. Editable por promoción; el operador
    # lo calibra con la experiencia de campañas previas.
    expected_uplift_pct = Column(Float, default=50.0, nullable=False)

    # Ventana histórica (días) usada para calcular la velocidad base. Default 30.
    baseline_lookback_days = Column(Integer, default=30, nullable=False)

    # Días de anticipación con los que se recomienda tener el stock ya en tienda
    # antes del arranque (para el motor de sugerencias). Default 5.
    lead_time_days = Column(Integer, default=5, nullable=False)

    status = Column(String, default=PromotionStatus.PLANNED.value, nullable=False, index=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    items = relationship("PromotionPlanItem", back_populates="promotion", cascade="all, delete-orphan")
    stores = relationship("PromotionTargetStore", back_populates="promotion", cascade="all, delete-orphan")
    suggestions = relationship("PromotionSuggestion", back_populates="promotion", cascade="all, delete-orphan")


class PromotionPlanItem(Base):
    __tablename__ = "promotion_plan_items"

    id = Column(Integer, primary_key=True, index=True)
    promotion_id = Column(Integer, ForeignKey("promotion_plans.id"), nullable=False, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)

    # Precio promocional o descuento. Solo informativo — el descuento efectivo
    # se aplica en el POS al capturar la venta (no automatizado en esta fase).
    promo_price = Column(Float, nullable=True)
    discount_pct = Column(Float, nullable=True)

    promotion = relationship("PromotionPlan", back_populates="items")
    variant = relationship("ProductVariant")


class PromotionTargetStore(Base):
    __tablename__ = "promotion_target_stores"

    id = Column(Integer, primary_key=True, index=True)
    promotion_id = Column(Integer, ForeignKey("promotion_plans.id"), nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)

    promotion = relationship("PromotionPlan", back_populates="stores")
    warehouse = relationship("Warehouse")


class PromotionSuggestion(Base):
    """Sugerencia de traspaso generada por el motor.

    Se calcula bajo demanda (endpoint /suggestions/compute). Puede ser
    materializada en un StockTransfer real (endpoint /suggestions/materialize)
    y ahí se registra `transfer_id` para trazabilidad."""
    __tablename__ = "promotion_suggestions"

    id = Column(Integer, primary_key=True, index=True)
    promotion_id = Column(Integer, ForeignKey("promotion_plans.id"), nullable=False, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False)
    source_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    destination_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)

    # Datos del cálculo — se guardan para trazabilidad y para que el usuario
    # entienda por qué se sugirió esa cantidad.
    baseline_daily_velocity = Column(Float, default=0.0, nullable=False)
    expected_units_during_promo = Column(Float, default=0.0, nullable=False)
    current_stock = Column(Integer, default=0, nullable=False)
    quantity_suggested = Column(Integer, default=0, nullable=False)

    # Aviso de riesgo si el origen no alcanza a cubrir todos los destinos.
    shortage_flag = Column(String, nullable=True)  # None | 'partial' | 'no_source'
    note = Column(Text, nullable=True)

    # Materialización: cuando se crea el traspaso real desde esta sugerencia.
    transfer_id = Column(Integer, ForeignKey("stock_transfers.id"), nullable=True)
    computed_at = Column(DateTime(timezone=True), server_default=func.now())

    promotion = relationship("PromotionPlan", back_populates="suggestions")
