"""Reportes personalizables — modelo persistente de reportes guardados.

Los reportes se definen como configuración JSON sobre datasets predefinidos
(nunca SQL crudo del usuario). El motor de queries en `engine.py` valida
que todos los campos, filtros y agregaciones estén dentro de lo permitido
por el dataset elegido.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class SavedReport(Base):
    """Reporte guardado por un usuario. Puede marcarse como compartido para
    que otros usuarios del mismo tenant lo vean y usen."""
    __tablename__ = "saved_reports"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    dataset = Column(String, nullable=False, index=True)  # accounting_movements | sales_orders | transactions | ...

    # Configuración completa: columns, filters, group_by, aggregations, sort
    config = Column(JSON, nullable=False, default=dict)

    is_shared = Column(Boolean, default=False, nullable=False, index=True)
    is_favorite = Column(Boolean, default=False, nullable=False)

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_run_at = Column(DateTime(timezone=True), nullable=True)
