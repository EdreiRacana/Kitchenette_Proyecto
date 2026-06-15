"""
Sales / CRM domain models.

Design goals (enterprise-grade):
  - One table for both Quotes (cotizaciones) and Orders (pedidos) via `kind`.
  - Money breakdown stored explicitly: subtotal, discount, tax, shipping, total.
  - Accounts receivable handled with `paid_amount` + a Payment ledger.
  - Full audit trail via OrderEvent (status changes, payments, edits).
  - Optional CFDI (Mexican e-invoice) billing snapshot on the order.

NOTE: columns are additive over the original schema, so existing rows keep
working. New tables (payments, order_events) are created automatically by
`Base.metadata.create_all` on startup; for an existing DB run the Alembic
migration shipped with this change.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Float,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


# ── Canonical vocab (kept as plain strings for SQLite friendliness) ──────────

ORDER_STATUSES = ("draft", "pending", "partial", "paid", "cancelled")
QUOTE_STATUSES = ("draft", "sent", "accepted", "rejected", "expired", "converted")
ORDER_KINDS = ("order", "quote")
PAYMENT_METHODS = ("cash", "card", "transfer", "credit", "check", "other")
DISCOUNT_TYPES = ("amount", "percent")


class Order(Base):
    """A sales document. `kind='order'` is a real sale, `kind='quote'` a cotización."""

    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, index=True, nullable=True)  # e.g. ORD-000123 / COT-000045
    kind = Column(String, default="order", nullable=False, index=True)  # order | quote

    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # seller
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)

    status = Column(String, default="pending", nullable=False, index=True)
    payment_method = Column(String, nullable=True)
    channel = Column(String, nullable=True)  # mostrador, telefono, whatsapp, web...
    currency = Column(String, default="MXN", nullable=False)

    # ── Money breakdown ──────────────────────────────────────────────────
    subtotal = Column(Float, default=0.0, nullable=False)
    discount_type = Column(String, default="amount", nullable=False)  # amount | percent
    discount_value = Column(Float, default=0.0, nullable=False)        # raw input
    discount_amount = Column(Float, default=0.0, nullable=False)       # resolved $
    tax_rate = Column(Float, default=0.0, nullable=False)              # e.g. 16 (%)
    tax_amount = Column(Float, default=0.0, nullable=False)
    shipping_amount = Column(Float, default=0.0, nullable=False)
    total_amount = Column(Float, default=0.0, nullable=False)
    paid_amount = Column(Float, default=0.0, nullable=False)

    # ── Dates ────────────────────────────────────────────────────────────
    due_date = Column(DateTime(timezone=True), nullable=True)      # for credit AR
    valid_until = Column(DateTime(timezone=True), nullable=True)   # for quotes

    notes = Column(Text, nullable=True)

    # ── CFDI / billing snapshot (timbrado happens via PAC, see service) ───
    bill_rfc = Column(String, nullable=True)
    bill_name = Column(String, nullable=True)
    bill_use = Column(String, nullable=True)        # uso CFDI: G01, G03, P01...
    bill_regime = Column(String, nullable=True)     # régimen fiscal
    bill_zip = Column(String, nullable=True)        # código postal
    cfdi_uuid = Column(String, nullable=True)       # folio fiscal once stamped
    cfdi_status = Column(String, nullable=True)     # none | pending | stamped | cancelled
    invoiced_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    items = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    payments = relationship(
        "Payment", back_populates="order", cascade="all, delete-orphan",
        order_by="Payment.created_at",
    )
    events = relationship(
        "OrderEvent", back_populates="order", cascade="all, delete-orphan",
        order_by="OrderEvent.created_at",
    )
    customer = relationship("Customer")
    seller = relationship("User")

    # Convenience (not persisted)
    @property
    def balance(self) -> float:
        return round((self.total_amount or 0.0) - (self.paid_amount or 0.0), 2)


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=True)

    # Snapshots so the line stays readable even if the catalog changes/deletes
    product_name = Column(String, nullable=True)
    sku = Column(String, nullable=True)

    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Float, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    tax_rate = Column(Float, default=0.0, nullable=False)
    subtotal = Column(Float, nullable=False)   # qty*unit_price - discount
    total = Column(Float, nullable=False)       # subtotal + line tax

    order = relationship("Order", back_populates="items")
    variant = relationship("ProductVariant")


class Payment(Base):
    """A single payment applied to an order (supports partial / installments)."""

    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    method = Column(String, nullable=True)        # cash, card, transfer...
    reference = Column(String, nullable=True)     # bank ref, auth code...
    note = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", back_populates="payments")


class OrderEvent(Base):
    """Audit log: status transitions, payments, edits, invoicing."""

    __tablename__ = "order_events"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    event_type = Column(String, nullable=False)   # status_change, payment, created, edited, invoiced
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=True)
    message = Column(String, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    order = relationship("Order", back_populates="events")
