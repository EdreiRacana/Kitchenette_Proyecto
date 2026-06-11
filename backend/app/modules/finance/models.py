from sqlalchemy import Column, Integer, String, DateTime, Float, Text
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
