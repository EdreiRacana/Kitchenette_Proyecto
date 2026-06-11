from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime
from app.modules.customers import models, schemas

async def create_customer(db: AsyncSession, customer_in: schemas.CustomerCreate) -> models.Customer:
    db_customer = models.Customer(**customer_in.model_dump())
    db.add(db_customer)
    await db.commit()
    await db.refresh(db_customer)
    # Re-fetch with documents eagerly loaded to avoid async lazy-load on serialization
    return await get_customer(db, db_customer.id)

async def get_customers(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[models.Customer]:
    result = await db.execute(
        select(models.Customer)
        .offset(skip).limit(limit)
        .options(selectinload(models.Customer.documents))
    )
    return result.scalars().all()

async def get_customer(db: AsyncSession, customer_id: int) -> Optional[models.Customer]:
    result = await db.execute(
        select(models.Customer)
        .where(models.Customer.id == customer_id)
        .options(selectinload(models.Customer.documents))
    )
    return result.scalars().first()

async def create_document(db: AsyncSession, doc_in: schemas.CustomerDocumentCreate) -> models.CustomerDocument:
    db_doc = models.CustomerDocument(**doc_in.model_dump())
    db.add(db_doc)
    await db.commit()
    await db.refresh(db_doc)
    return db_doc

async def get_document(db: AsyncSession, doc_id: int) -> Optional[models.CustomerDocument]:
    result = await db.execute(select(models.CustomerDocument).where(models.CustomerDocument.id == doc_id))
    return result.scalars().first()

async def get_customer_documents(db: AsyncSession, customer_id: int) -> List[models.CustomerDocument]:
    result = await db.execute(
        select(models.CustomerDocument).where(models.CustomerDocument.customer_id == customer_id)
    )
    return result.scalars().all()

async def update_document_status(
    db: AsyncSession, 
    doc_id: int, 
    status: str, 
    verified_by_id: Optional[int] = None
) -> Optional[models.CustomerDocument]:
    db_doc = await get_document(db, doc_id)
    if db_doc:
        db_doc.status = status
        if status == "verificado":
            db_doc.verified_at = datetime.now()
            db_doc.verified_by_id = verified_by_id
        db.add(db_doc)
        await db.commit()
        await db.refresh(db_doc)
    return db_doc
