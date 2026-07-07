"""
Forecast de ventas — modelos de dominio (estilo Skullcandy).

Cada vendedor proyecta, por cliente y por producto (SKU) o servicio de texto
libre, las unidades esperadas mes a mes de un año. La granularidad es la línea
(ForecastLine); un ForecastPlan agrupa muchas líneas para un año dado.

Notas de diseño:
- 12 columnas de unidades (m1..m12) en lugar de una tabla hija por mes: el UI
  edita como cuadrícula y el rollup es una simple suma; Skullcandy y otros
  ERPs de FMCG modelan igual el sheet anual.
- Los snapshots (product_name/sku/customer_name/salesperson_name) mantienen la
  línea legible aunque cambie el catálogo o el usuario.
- Guard rails: nullable=True en FKs para permitir servicios de texto libre
  (variant_id=None + product_name).
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


PLAN_STATUSES = ("draft", "active", "closed")


class ForecastPlan(Base):
    __tablename__ = "forecast_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    year = Column(Integer, nullable=False, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String, default="draft", nullable=False, index=True)
    growth_pct = Column(Float, default=0.0, nullable=False)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    lines = relationship(
        "ForecastLine",
        back_populates="plan",
        cascade="all, delete-orphan",
    )
    owner = relationship("User")


class ForecastLine(Base):
    __tablename__ = "forecast_lines"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(
        Integer,
        ForeignKey("forecast_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=True, index=True)
    salesperson_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    product_name = Column(String, nullable=True)
    sku = Column(String, nullable=True)
    customer_name = Column(String, nullable=True)
    salesperson_name = Column(String, nullable=True)

    unit_price = Column(Float, default=0.0, nullable=False)

    m1 = Column(Integer, default=0, nullable=False)
    m2 = Column(Integer, default=0, nullable=False)
    m3 = Column(Integer, default=0, nullable=False)
    m4 = Column(Integer, default=0, nullable=False)
    m5 = Column(Integer, default=0, nullable=False)
    m6 = Column(Integer, default=0, nullable=False)
    m7 = Column(Integer, default=0, nullable=False)
    m8 = Column(Integer, default=0, nullable=False)
    m9 = Column(Integer, default=0, nullable=False)
    m10 = Column(Integer, default=0, nullable=False)
    m11 = Column(Integer, default=0, nullable=False)
    m12 = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    plan = relationship("ForecastPlan", back_populates="lines")
    customer = relationship("Customer")
    variant = relationship("ProductVariant")
    salesperson = relationship("User")
