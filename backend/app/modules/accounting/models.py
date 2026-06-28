"""Contabilidad (partida doble) — Fase 1.

Catálogo de cuentas + pólizas (asientos) con movimientos de cargo/abono. Todo
calculado de pólizas contabilizadas (status='posted'); las canceladas se
excluyen de saldos. Sin dependencias externas.
"""
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


ACCOUNT_TYPES = ("activo", "pasivo", "capital", "ingreso", "costo", "gasto", "orden")
ACCOUNT_NATURES = ("deudora", "acreedora")
ENTRY_TYPES = ("ingreso", "egreso", "diario")
ENTRY_STATUSES = ("posted", "cancelled")


class Account(Base):
    """Cuenta del catálogo. Las cuentas agrupadoras (is_postable=False) no reciben
    movimientos; solo las de detalle (is_postable=True)."""
    __tablename__ = "accounting_accounts"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True, nullable=False)        # número de cuenta (jerárquico)
    name = Column(String, nullable=False)
    account_type = Column(String, nullable=False)            # activo | pasivo | capital | ingreso | costo | gasto | orden
    nature = Column(String, default="deudora", nullable=False)  # deudora | acreedora
    level = Column(Integer, default=1, nullable=False)
    parent_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)
    sat_code = Column(String, nullable=True)                 # código agrupador SAT (Anexo 24)
    is_postable = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    parent = relationship("Account", remote_side=[id])


class JournalEntry(Base):
    """Póliza contable."""
    __tablename__ = "accounting_journal_entries"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, index=True, nullable=True)        # POL-000001
    date = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    entry_type = Column(String, default="diario", nullable=False)  # ingreso | egreso | diario
    concept = Column(Text, nullable=True)
    source = Column(String, default="manual", nullable=False)      # manual | venta:12 | compra:.. | nomina:.. | pago:..
    status = Column(String, default="posted", nullable=False, index=True)  # posted | cancelled
    total_debit = Column(Float, default=0.0, nullable=False)
    total_credit = Column(Float, default=0.0, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    lines = relationship("JournalLine", back_populates="entry", cascade="all, delete-orphan")


class AccountMap(Base):
    """Mapeo de 'rol contable' → cuenta, para generar pólizas automáticas desde
    la operación (ventas, cobros, compras, nómina…). p.ej. role='sales' → 4101."""
    __tablename__ = "accounting_account_map"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, unique=True, index=True, nullable=False)
    account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)

    account = relationship("Account")


class JournalLine(Base):
    """Movimiento (partida) de una póliza: cargo o abono a una cuenta."""
    __tablename__ = "accounting_journal_lines"

    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(Integer, ForeignKey("accounting_journal_entries.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=False, index=True)
    debit = Column(Float, default=0.0, nullable=False)
    credit = Column(Float, default=0.0, nullable=False)
    description = Column(String, nullable=True)

    entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("Account")
