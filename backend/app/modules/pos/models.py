"""POS (Punto de Venta) — modelos.

Diseño:
  - Terminal física (caja registradora) asignada a un almacén.
  - Sesión de caja (turno) abierta por un usuario cajero con saldo inicial.
  - Movimientos de caja durante la sesión: ventas, retiros, depósitos.
  - Cierre de caja con arqueo (conteo físico por denominación) y cálculo
    de variance (esperado vs real).
  - Cada venta POS crea una Order normal con channel='pos' y
    pos_session_id apuntando a esta sesión — se reusa la infraestructura
    existente de órdenes/inventario.
"""
from __future__ import annotations
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


# ── Denominaciones estándar México (billetes y monedas) ─────────────
DENOMINATIONS_MXN = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50]


class POSTerminal(Base):
    """Caja registradora física (o virtual). Puede haber varias por almacén."""
    __tablename__ = "pos_terminals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # "Caja 1", "Caja Mostrador Sur"
    code = Column(String, nullable=True, index=True)  # "CJ-01"
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)
    printer_ip = Column(String, nullable=True)  # IP impresora térmica (opcional)
    default_price_list = Column(String, nullable=True)  # "General", "Mayoreo"
    is_active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    warehouse = relationship("Warehouse")


class POSSession(Base):
    """Turno de caja. Se abre con saldo inicial, se cierra con arqueo.
    Un cajero solo puede tener 1 sesión abierta a la vez por terminal."""
    __tablename__ = "pos_sessions"

    id = Column(Integer, primary_key=True, index=True)
    terminal_id = Column(Integer, ForeignKey("pos_terminals.id"), nullable=False, index=True)
    cashier_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    status = Column(String, default="open", nullable=False, index=True)  # open | closed | reconciled

    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    opening_balance = Column(Float, default=0.0, nullable=False)  # efectivo inicial
    opening_notes = Column(Text, nullable=True)

    closed_at = Column(DateTime(timezone=True), nullable=True)
    expected_cash = Column(Float, default=0.0, nullable=False)  # calculado al cerrar
    actual_cash = Column(Float, default=0.0, nullable=False)    # contado físico
    variance = Column(Float, default=0.0, nullable=False)        # actual - expected
    denominations_json = Column(JSON, nullable=True)             # {"1000":2,"500":5,"100":10,...}
    closing_notes = Column(Text, nullable=True)

    # Totales del turno (calculados al cerrar, se guardan como snapshot)
    total_sales_amount = Column(Float, default=0.0, nullable=False)
    total_sales_count = Column(Integer, default=0, nullable=False)
    total_cash_in = Column(Float, default=0.0, nullable=False)     # depósitos manuales
    total_cash_out = Column(Float, default=0.0, nullable=False)    # retiros manuales
    total_refunds = Column(Float, default=0.0, nullable=False)     # reembolsos

    terminal = relationship("POSTerminal")
    cashier = relationship("User")
    transactions = relationship(
        "POSTransaction", back_populates="session", cascade="all, delete-orphan",
    )


class POSTransaction(Base):
    """Movimiento de caja durante la sesión. Puede ser:
      - sale        : venta POS (con order_id)
      - refund      : reembolso (con order_id de la venta original)
      - cash_in     : depósito manual a la caja (fondo extra, cambio, etc.)
      - cash_out    : retiro manual (para banco, gastos, etc.)
      - opening     : registro de apertura (redundante con session.opening_balance, sirve para trace)
      - closing     : registro de cierre
    """
    __tablename__ = "pos_transactions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("pos_sessions.id"), nullable=False, index=True)
    type = Column(String, nullable=False, index=True)  # sale|refund|cash_in|cash_out|opening|closing
    amount = Column(Float, nullable=False)
    payment_method = Column(String, nullable=True)   # cash|card|transfer|credit — en ventas
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("POSSession", back_populates="transactions")
