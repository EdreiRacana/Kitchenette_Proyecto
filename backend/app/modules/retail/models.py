"""Retail Sell-out Analytics — modelos.

Cada empresa que use el ERP registra sus propias cadenas de retail
(clientes B2B con múltiples tiendas), sus tiendas físicas y captura
el sell-out (ventas del cliente al consumidor final) por tienda × SKU
× periodo. Esto habilita el cálculo de:
  - Sell-through % (sell-out / sell-in)
  - Weeks of Supply (WOS)
  - Sugerencias de reabasto por tienda
  - Alertas de stock-out y sobreinventario

Los umbrales de WOS (target, critical, overstock) son por cadena para
respetar la política comercial de cada cliente.
"""
from __future__ import annotations

from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


PERIOD_TYPES = ("day", "week", "month")
SELLOUT_SOURCES = ("manual", "csv", "excel", "edi", "api")


class RetailChannel(Base):
    """Cadena / cliente retail (Walmart, Costco, HEB, etc.)."""
    __tablename__ = "retail_channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True, unique=False)
    # Enlazar a Customer si esa cadena ya existe como cliente facturable
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    # Umbrales de WOS — política comercial por cadena
    target_wos_weeks = Column(Float, default=4.0, nullable=False)
    critical_wos_weeks = Column(Float, default=2.0, nullable=False)
    overstock_wos_weeks = Column(Float, default=12.0, nullable=False)
    # Reglas de alertas específicas
    no_movement_days = Column(Integer, default=21, nullable=False)
    sell_through_min_pct = Column(Float, default=20.0, nullable=False)
    alerts_enabled = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    customer = relationship("Customer")
    stores = relationship(
        "RetailStore", back_populates="channel", cascade="all, delete-orphan",
    )


class RetailStore(Base):
    """Tienda física de la cadena (ej. Walmart Culiacán Centro nº 4123)."""
    __tablename__ = "retail_stores"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(
        Integer, ForeignKey("retail_channels.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)             # nuestro código interno
    external_code = Column(String, nullable=True)    # nº de tienda del cliente
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    region = Column(String, nullable=True)
    store_format = Column(String, nullable=True)     # supercenter, express, sam's, etc.
    address = Column(Text, nullable=True)
    contact_name = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    # Almacén de consignación asociado. Si viene, cada sell-out reportado
    # descuenta stock de este warehouse. Debe ser un Warehouse con
    # type=CONSIGNMENT (validado en la UI, no forzado en DB).
    consignment_warehouse_id = Column(
        Integer, ForeignKey("warehouses.id"), nullable=True, index=True,
    )
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    channel = relationship("RetailChannel", back_populates="stores")
    sellout_reports = relationship(
        "SellOutReport", back_populates="store", cascade="all, delete-orphan",
    )


class SellOutReport(Base):
    """Fila = ventas y on-hand de UN SKU en UNA tienda en UN periodo.

    Se persiste snapshot del nombre del producto y SKU para preservar
    histórico legible aunque el catálogo cambie.
    """
    __tablename__ = "retail_sellout_reports"
    __table_args__ = (
        UniqueConstraint(
            "store_id", "variant_id", "period_start", "period_type",
            name="uq_sellout_store_variant_period",
        ),
        Index("ix_sellout_store_period", "store_id", "period_start"),
        Index("ix_sellout_variant_period", "variant_id", "period_start"),
    )

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(
        Integer, ForeignKey("retail_stores.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    variant_id = Column(
        Integer, ForeignKey("product_variants.id"),
        nullable=True, index=True,
    )
    # Snapshots para histórico
    product_name = Column(String, nullable=True)
    sku = Column(String, nullable=True)

    period_start = Column(DateTime(timezone=True), nullable=False, index=True)
    period_end = Column(DateTime(timezone=True), nullable=False)
    period_type = Column(String, default="week", nullable=False)  # day | week | month

    units_sold = Column(Integer, default=0, nullable=False)
    units_on_hand = Column(Integer, default=0, nullable=False)
    revenue = Column(Float, default=0.0, nullable=False)

    source = Column(String, default="manual", nullable=False)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    # Tracking de consignación — cuántas unidades ya se descontaron del
    # almacén de consignación. Permite reimportar sin doble descuento y
    # calcular deltas cuando el reporte se actualiza.
    stock_consumed = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    store = relationship("RetailStore", back_populates="sellout_reports")
    variant = relationship("ProductVariant")
    uploaded_by = relationship("User")


ALERT_TYPES = (
    "stockout_imminent",   # WOS < critical
    "stockout",             # on_hand == 0 con ventas recientes
    "overstock",            # WOS > overstock
    "no_movement",          # sin ventas por N días con on_hand > 0
    "sell_through_low",     # sell_out/sell_in < umbral
)
ALERT_SEVERITIES = ("urgent", "high", "medium", "low")
ALERT_STATUSES = ("open", "acknowledged", "resolved", "dismissed")


class RetailAlert(Base):
    """Alertas persistentes con dedupe + resolución automática.

    Cada regla genera a lo más una alerta abierta por (type, store, variant).
    Cuando la condición vuelve a la zona sana, se auto-resuelve.
    """
    __tablename__ = "retail_alerts"
    __table_args__ = (
        Index("ix_retail_alerts_status", "status"),
        Index(
            "ix_retail_alerts_type_store_variant",
            "alert_type", "store_id", "variant_id",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(
        Integer, ForeignKey("retail_channels.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    store_id = Column(
        Integer, ForeignKey("retail_stores.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    variant_id = Column(
        Integer, ForeignKey("product_variants.id"),
        nullable=True, index=True,
    )
    alert_type = Column(String, nullable=False)
    severity = Column(String, default="medium", nullable=False)
    message = Column(Text, nullable=False)
    # Snapshot en el momento de la creación
    wos_snapshot = Column(Float, nullable=True)
    on_hand_snapshot = Column(Integer, nullable=True)
    weekly_velocity_snapshot = Column(Float, nullable=True)
    # Snapshots textuales para preservar contexto tras cambios de catálogo
    store_name = Column(String, nullable=True)
    product_name = Column(String, nullable=True)
    sku = Column(String, nullable=True)

    status = Column(String, default="open", nullable=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    channel = relationship("RetailChannel")
    store = relationship("RetailStore")
    variant = relationship("ProductVariant")
