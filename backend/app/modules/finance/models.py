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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    bank_account = relationship("BankAccount", back_populates="movements")
