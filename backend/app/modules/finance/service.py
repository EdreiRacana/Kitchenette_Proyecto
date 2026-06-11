from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List, Optional
from app.modules.finance import models, schemas


async def create_transaction(
    db: AsyncSession, tx_in: schemas.TransactionCreate
) -> models.Transaction:
    db_tx = models.Transaction(**tx_in.model_dump())
    db.add(db_tx)
    await db.commit()
    await db.refresh(db_tx)
    return db_tx


async def get_transactions(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    type: Optional[str] = None,
) -> List[models.Transaction]:
    stmt = select(models.Transaction).order_by(models.Transaction.id.desc())
    if type:
        stmt = stmt.where(models.Transaction.type == type)
    result = await db.execute(stmt.offset(skip).limit(limit))
    return result.scalars().all()


async def get_dashboard(db: AsyncSession) -> schemas.FinanceDashboard:
    income_result = await db.execute(
        select(func.coalesce(func.sum(models.Transaction.amount), 0.0)).where(
            models.Transaction.type == "income"
        )
    )
    expense_result = await db.execute(
        select(func.coalesce(func.sum(models.Transaction.amount), 0.0)).where(
            models.Transaction.type == "expense"
        )
    )
    count_result = await db.execute(select(func.count(models.Transaction.id)))

    total_income = float(income_result.scalar() or 0.0)
    total_expenses = float(expense_result.scalar() or 0.0)

    return schemas.FinanceDashboard(
        total_income=total_income,
        total_expenses=total_expenses,
        net_profit=total_income - total_expenses,
        transaction_count=int(count_result.scalar() or 0),
    )
