from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.modules.sales import models, schemas


async def create_order(
    db: AsyncSession,
    order_in: schemas.OrderCreate,
    user_id: Optional[int] = None,
) -> models.Order:
    db_order = models.Order(
        customer_id=order_in.customer_id,
        payment_method=order_in.payment_method,
        status=order_in.status or "completed",
        notes=order_in.notes,
        user_id=user_id,
        total_amount=0.0,
    )
    db.add(db_order)
    await db.flush()  # get order id before adding items

    total = 0.0
    for item in order_in.items:
        subtotal = item.unit_price * item.quantity
        total += subtotal
        db.add(
            models.OrderItem(
                order_id=db_order.id,
                variant_id=item.variant_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=subtotal,
            )
        )

    db_order.total_amount = total

    # Record revenue in finance when the sale is completed
    if db_order.status == "completed" and total > 0:
        from app.modules.finance import models as finance_models

        db.add(
            finance_models.Transaction(
                type="income",
                amount=total,
                category="sales",
                description=f"Sale order #{db_order.id}",
                reference=f"order:{db_order.id}",
            )
        )

    await db.commit()
    await db.refresh(db_order)
    return await get_order(db, db_order.id)


async def get_orders(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[models.Order]:
    result = await db.execute(
        select(models.Order)
        .order_by(models.Order.id.desc())
        .offset(skip).limit(limit)
        .options(selectinload(models.Order.items))
    )
    return result.scalars().all()


async def get_order(db: AsyncSession, order_id: int) -> Optional[models.Order]:
    result = await db.execute(
        select(models.Order)
        .where(models.Order.id == order_id)
        .options(selectinload(models.Order.items))
    )
    return result.scalars().first()


async def update_order_status(
    db: AsyncSession, order_id: int, status: str
) -> Optional[models.Order]:
    db_order = await get_order(db, order_id)
    if db_order:
        db_order.status = status
        db.add(db_order)
        await db.commit()
        await db.refresh(db_order)
    return db_order
