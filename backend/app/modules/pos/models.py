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
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


# ── Denominaciones estándar México (billetes y monedas) ─────────────
DENOMINATIONS_MXN = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50]


class POSTerminal(Base):
    """Caja registradora física (o virtual). Puede haber varias por almacén.
    Multi-tenant: cada terminal pertenece a una empresa (company_id). El
    filtrado por tenant se hace EXPLICITAMENTE en el service (list_terminals),
    NO con el hook global @register_tenant_scoped — ese hook interfería con
    el flujo de cobro (SELECT interno tras flush del Order rompia con 500)."""
    __tablename__ = "pos_terminals"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(String, ForeignKey("company_profile.id", ondelete="CASCADE"),
                         nullable=True, index=True)
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
    company_id = Column(String, ForeignKey("company_profile.id"),
                          nullable=True, index=True)
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

    Reverso profesional de tarjeta (campos gateway_*, card_*, refund_*):
      Para transactions type='sale' con payment_method='card' guardamos la
      referencia del cobro (charge_id, auth_code, ultimos 4 de la tarjeta,
      referencia del voucher). Para type='refund' guardamos el estado del
      reverso (pending|sent|confirmed|failed|manual_ack|unknown) y el
      original_transaction_id para cerrar el ciclo auditable.

      PCI-DSS: NUNCA se guarda el PAN, CVV, ni pista magnetica.
    """
    __tablename__ = "pos_transactions"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(String, ForeignKey("company_profile.id"),
                          nullable=True, index=True)
    session_id = Column(Integer, ForeignKey("pos_sessions.id"), nullable=False, index=True)
    type = Column(String, nullable=False, index=True)  # sale|refund|cash_in|cash_out|opening|closing
    amount = Column(Float, nullable=False)
    payment_method = Column(String, nullable=True)   # cash|card|transfer|credit — en ventas
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # ── Reverso profesional de tarjeta ──────────────────────────────
    # Proveedor del cobro: 'stripe' | 'mercadopago' | 'manual' | 'legacy'.
    # 'manual' = terminal bancaria externa (Netpay/Prosa/etc), no hay API.
    # 'legacy' = ventas viejas sin captura de referencia (pre-migracion).
    gateway_provider = Column(String, nullable=True)
    gateway_charge_id = Column(String, nullable=True, index=True)  # id del cobro en la pasarela
    gateway_refund_id = Column(String, nullable=True)              # id del refund devuelto por la pasarela
    auth_code = Column(String, nullable=True)                      # codigo de autorizacion del voucher (5-6 digitos)
    card_last4 = Column(String, nullable=True)                     # ultimos 4 de la tarjeta — NUNCA el PAN
    card_brand = Column(String, nullable=True)                     # visa|mastercard|amex|otro
    terminal_reference = Column(String, nullable=True)             # folio de la terminal fisica
    batch_id = Column(String, nullable=True)                       # nro de lote de cierre bancario
    captured_at = Column(DateTime(timezone=True), nullable=True)   # cuando se capturo (vs autorizo)

    # ── Estado del reverso (solo aplica cuando type='refund') ───────
    # pending      : creado localmente, aun no enviado al gateway
    # sent         : gateway acepto la request, esperando confirmacion
    # confirmed    : gateway confirmo (via response o webhook)
    # failed       : gateway rechazo — falla queda en failed_reason
    # manual_ack   : reverso hecho en terminal externa, cajero capturo el auth_code
    # unknown      : timeout/error de red — necesita reconciliacion manual contra la pasarela
    refund_status = Column(String, nullable=True, index=True)
    # void (antes del batch settlement) | refund_full | refund_partial | manual_ack
    refund_type = Column(String, nullable=True)
    original_transaction_id = Column(Integer, ForeignKey("pos_transactions.id"), nullable=True, index=True)
    refund_reason = Column(String, nullable=True)
    failed_reason = Column(Text, nullable=True)
    # Idempotencia: si el cajero doble-clickea "Devolver" no genera doble refund.
    # UNIQUE(original_transaction_id, idempotency_key) via indice parcial en migracion.
    idempotency_key = Column(String, nullable=True)

    session = relationship("POSSession", back_populates="transactions")
    original_transaction = relationship("POSTransaction", remote_side=[id],
                                         foreign_keys=[original_transaction_id])


class POSCartReservation(Base):
    """Reserva de existencia mientras un cajero arma el carrito.

    Antes dos cajeros podian armar simultaneamente carritos con el mismo
    producto (5 unidades en piso, cada uno agregaba 5); el segundo revientaba
    al cobrar. Ahora cada 'agregar al carrito' incrementa
    StockLevel.reserved_quantity y crea/actualiza esta fila. Al cerrar carrito
    o completar venta se libera; un job periodico limpia reservas huerfanas.

    UNIQUE(session_id, variant_id): una fila por producto por sesion — el
    quantity se acumula ahi en lugar de crear multiples filas.
    """
    __tablename__ = "pos_cart_reservations"
    __table_args__ = (
        UniqueConstraint("session_id", "variant_id",
                          name="uq_pos_cart_reservation_session_variant"),
    )

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("pos_sessions.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"),
                          nullable=False, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                          onupdate=func.now())


# Multi-tenancy: POSSession y POSTransaction scoped por marca.
from app.core.tenancy import register_tenant_scoped  # noqa: E402
register_tenant_scoped(POSSession)
register_tenant_scoped(POSTransaction)
