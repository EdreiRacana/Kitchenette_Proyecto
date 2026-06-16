"""Business logic for the Customer / CRM module."""

from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy import case, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.modules.customers import models, schemas


# ── Helpers ───────────────────────────────────────────────────────────────────

def _derive_client_type(data: schemas.CustomerBase) -> str:
    """Auto-assign a sensible client type when the user didn't pick one."""
    if data.client_type:
        return data.client_type
    pl = (data.price_list or "").upper()
    if "VIP" in pl:
        return "VIP"
    if (data.credit_days or 0) > 0 or (data.credit_amount or 0) > 0:
        return "Crédito"
    if pl in ("MATRIZ",):
        return "Mayorista"
    return "Contado"


def _display_name(data: schemas.CustomerBase) -> str:
    return (data.name or data.nombre_comercial or data.razon_social or "Cliente").strip()


def _scalar_payload(data: schemas.CustomerBase) -> dict:
    """Model-ready dict: drops `phones` (handled separately) and None-only keys
    we don't want to overwrite blindly on update are handled by the caller."""
    payload = data.model_dump(exclude_unset=True)
    payload.pop("phones", None)
    # EmailStr serializes fine; ensure str
    if payload.get("email") is not None:
        payload["email"] = str(payload["email"])
    return payload


_LOAD = (selectinload(models.Customer.documents),)


# ── Create / update ───────────────────────────────────────────────────────────

async def create_customer(db: AsyncSession, customer_in: schemas.CustomerCreate) -> models.Customer:
    payload = _scalar_payload(customer_in)
    payload["name"] = _display_name(customer_in)
    payload["client_type"] = _derive_client_type(customer_in)
    if customer_in.phones is not None:
        payload["phones"] = json.dumps(customer_in.phones, ensure_ascii=False)

    customer = models.Customer(**payload)
    db.add(customer)
    await db.flush()  # get the id (race-free numbering)

    if not customer.client_number:
        customer.client_number = f"CLI-{customer.id:05d}"

    await db.commit()
    return await get_customer(db, customer.id)


async def update_customer(db: AsyncSession, customer_id: int,
                          data: schemas.CustomerUpdate) -> Optional[models.Customer]:
    customer = await get_customer(db, customer_id)
    if not customer:
        return None

    payload = _scalar_payload(data)
    for field, value in payload.items():
        setattr(customer, field, value)

    if data.phones is not None:
        customer.phones = json.dumps(data.phones, ensure_ascii=False)

    # keep display name + type coherent
    if data.name or data.nombre_comercial or data.razon_social:
        customer.name = _display_name(
            schemas.CustomerBase(
                name=customer.name, nombre_comercial=customer.nombre_comercial,
                razon_social=customer.razon_social,
            )
        )
    if data.client_type is None and (data.price_list is not None
                                     or data.credit_days is not None
                                     or data.credit_amount is not None):
        customer.client_type = _derive_client_type(schemas.CustomerBase(
            client_type=None, price_list=customer.price_list,
            credit_days=customer.credit_days, credit_amount=customer.credit_amount,
        ))

    await db.commit()
    return await get_customer(db, customer_id)


# ── Queries ────────────────────────────────────────────────────────────────────

async def get_customer(db: AsyncSession, customer_id: int) -> Optional[models.Customer]:
    res = await db.execute(
        select(models.Customer).where(models.Customer.id == customer_id).options(*_LOAD)
    )
    return res.scalars().first()


async def get_customers(db: AsyncSession, skip: int = 0, limit: int = 100) -> List[models.Customer]:
    """Plain list (kept for the Sales dropdown / backward compatibility)."""
    res = await db.execute(
        select(models.Customer).order_by(models.Customer.name).offset(skip).limit(limit).options(*_LOAD)
    )
    return res.scalars().all()


async def search_customers(
    db: AsyncSession, *,
    skip: int = 0, limit: int = 20,
    q: Optional[str] = None,
    sucursal: Optional[str] = None,
    client_type: Optional[str] = None,
    price_list: Optional[str] = None,
    is_active: Optional[bool] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> Tuple[List[models.Customer], int]:
    base = select(models.Customer)
    count_q = select(func.count(models.Customer.id))

    conds = []
    if q:
        like = f"%{q}%"
        conds.append(or_(
            models.Customer.name.ilike(like),
            models.Customer.razon_social.ilike(like),
            models.Customer.nombre_comercial.ilike(like),
            models.Customer.rfc.ilike(like),
            models.Customer.client_number.ilike(like),
            models.Customer.email.ilike(like),
        ))
    if sucursal:
        conds.append(models.Customer.sucursal == sucursal)
    if client_type:
        conds.append(models.Customer.client_type == client_type)
    if price_list:
        conds.append(models.Customer.price_list == price_list)
    if is_active is not None:
        conds.append(models.Customer.is_active == is_active)

    for c in conds:
        base = base.where(c)
        count_q = count_q.where(c)

    sortable = {
        "created_at": models.Customer.created_at,
        "name": models.Customer.name,
        "client_number": models.Customer.client_number,
        "credit_amount": models.Customer.credit_amount,
    }
    col = sortable.get(sort_by, models.Customer.created_at)
    base = base.order_by(col.asc() if sort_dir == "asc" else col.desc())

    total = (await db.execute(count_q)).scalar() or 0
    res = await db.execute(base.offset(skip).limit(limit).options(*_LOAD))
    return res.scalars().unique().all(), total


async def get_stats(db: AsyncSession) -> dict:
    C = models.Customer
    row = (await db.execute(select(
        func.count(C.id).label("total"),
        func.count(case((C.is_active == True, 1))).label("active"),  # noqa: E712
        func.count(case((C.client_type == "Crédito", 1))).label("credit"),
        func.coalesce(func.sum(C.credit_amount), 0.0).label("credit_exposure"),
    ))).one()
    return dict(total=row.total or 0, active=row.active or 0,
                credit=row.credit or 0, credit_exposure=round(row.credit_exposure or 0.0, 2))


# ── Documents (unchanged behavior) ──────────────────────────────────────────────

async def create_document(db: AsyncSession, doc_in: schemas.CustomerDocumentCreate) -> models.CustomerDocument:
    db_doc = models.CustomerDocument(**doc_in.model_dump())
    db.add(db_doc)
    await db.commit()
    await db.refresh(db_doc)
    return db_doc


async def get_document(db: AsyncSession, doc_id: int) -> Optional[models.CustomerDocument]:
    res = await db.execute(select(models.CustomerDocument).where(models.CustomerDocument.id == doc_id))
    return res.scalars().first()


async def get_customer_documents(db: AsyncSession, customer_id: int) -> List[models.CustomerDocument]:
    res = await db.execute(
        select(models.CustomerDocument).where(models.CustomerDocument.customer_id == customer_id)
    )
    return res.scalars().all()


async def update_document_status(db: AsyncSession, doc_id: int, status: str,
                                 verified_by_id: Optional[int] = None) -> Optional[models.CustomerDocument]:
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
