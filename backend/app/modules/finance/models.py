from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String, nullable=False, index=True)  # income, expense
    amount = Column(Float, nullable=False)
    category = Column(String, nullable=True, index=True)  # sales, payroll, rent, supplies, etc.
    description = Column(Text, nullable=True)
    reference = Column(String, nullable=True)  # e.g. order:12, invoice:A-100
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    attachment_url = Column(Text, nullable=True)  # comprobante adjunto (factura/recibo)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)  # sucursal (aislamiento)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BankAccount(Base):
    __tablename__ = "bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    bank = Column(String, nullable=True)
    account_number = Column(String, nullable=True)
    type = Column(String, default="checking", nullable=False)  # checking, savings, credit
    balance = Column(Float, default=0.0, nullable=False)
    currency = Column(String, default="MXN", nullable=False)
    is_active = Column(Boolean, default=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)  # sucursal (aislamiento)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    movements = relationship("BankTransaction", back_populates="bank_account", cascade="all, delete-orphan")


class BankTransaction(Base):
    __tablename__ = "bank_transactions"

    id = Column(Integer, primary_key=True, index=True)
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
    type = Column(String, nullable=False)  # deposit, withdrawal, transfer_in, transfer_out
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    reference = Column(String, nullable=True)
    reconciled = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Conciliación bancaria
    bank_date = Column(DateTime(timezone=True), nullable=True, index=True)  # fecha del extracto
    matched_transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=True)
    source = Column(String, default="manual", nullable=False)  # manual | import:{bank}
    external_ref = Column(String, nullable=True)  # ID del extracto (para no duplicar)

    bank_account = relationship("BankAccount", back_populates="movements")


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False, index=True)
    type = Column(String, nullable=False, default="expense")  # income, expense
    period = Column(String, nullable=False, index=True)  # "YYYY-MM"
    amount = Column(Float, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)  # sucursal (aislamiento)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String, nullable=False)  # income, expense
    amount = Column(Float, nullable=False)
    category = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    frequency = Column(String, nullable=False, default="monthly")  # weekly, monthly
    next_run_date = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SupplierBill(Base):
    """Factura de proveedor (Accounts Payable / CxP).

    Diseño alineado con SAP/NetSuite: la Bill es la obligacion con vencimiento;
    los pagos (Transaction de egreso) se aplican mediante BillPayment y pueden
    ser 1:N (un pago liquida varias bills del mismo proveedor).
    """
    __tablename__ = "supplier_bills"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, unique=True, index=True, nullable=True)  # folio interno FAC-000001
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    supplier_name = Column(String, nullable=True)  # snapshot para que la fila siga legible

    supplier_folio = Column(String, nullable=True, index=True)  # folio de la factura del proveedor
    issue_date = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True, index=True)
    payment_terms = Column(String, nullable=True)  # "net_15", "net_30", "cash", "credit_60"...

    category = Column(String, nullable=True, index=True)  # renta, servicios, compras, otros
    description = Column(Text, nullable=True)

    currency = Column(String, default="MXN", nullable=False)
    subtotal = Column(Float, default=0.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    total_amount = Column(Float, default=0.0, nullable=False)
    paid_amount = Column(Float, default=0.0, nullable=False)

    status = Column(String, default="open", nullable=False, index=True)  # open, partial, paid, cancelled
    attachment_url = Column(Text, nullable=True)  # PDF/imagen de la factura

    reminder_sent_at = Column(DateTime(timezone=True), nullable=True)

    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)

    supplier = relationship("Supplier")
    payments = relationship(
        "BillPayment", back_populates="bill", cascade="all, delete-orphan",
        order_by="BillPayment.created_at",
    )


class BillPayment(Base):
    """Aplicación de un pago (Transaction egreso) a una factura de proveedor.

    Permite pagos consolidados (una transaccion aplicada a varias bills). El
    monto que se resta al saldo de la bill es `amount` — no confundir con el
    monto total de la Transaction, que puede repartirse entre varias.
    """
    __tablename__ = "bill_payments"

    id = Column(Integer, primary_key=True, index=True)
    bill_id = Column(Integer, ForeignKey("supplier_bills.id", ondelete="CASCADE"), nullable=False, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    method = Column(String, nullable=True)  # cash, transfer, card, check
    reference = Column(String, nullable=True)  # numero de transferencia, cheque, etc.
    note = Column(Text, nullable=True)
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=True)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    bill = relationship("SupplierBill", back_populates="payments")


class ScheduledPayment(Base):
    __tablename__ = "scheduled_payments"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String, nullable=False)  # cxc, cxp
    target_id = Column(Integer, nullable=False)  # order_id (cxc) o purchase_order_id (cxp)
    target_name = Column(String, nullable=True)  # snapshot del nombre para mostrarlo aunque cambie
    amount = Column(Float, nullable=False)
    method = Column(String, nullable=True)
    reference = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    scheduled_date = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, paid, cancelled, failed
    error = Column(Text, nullable=True)
    reminder_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
