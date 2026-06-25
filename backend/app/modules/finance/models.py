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

    bank_account = relationship("BankAccount", back_populates="movements")


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False, index=True)
    type = Column(String, nullable=False, default="expense")  # income, expense
    period = Column(String, nullable=False, index=True)  # "YYYY-MM"
    amount = Column(Float, nullable=False)
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
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
