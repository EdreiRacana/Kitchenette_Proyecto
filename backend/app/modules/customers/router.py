"""REST API for the Customer / CRM module."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.storage import upload_bytes
from app.modules.auth.models import User
from app.modules.customers import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Search / stats (declared before /{id} so paths don't collide) ─────────────
# NOTE: open (no auth) to match the original customers module behavior and the
# rest of the read endpoints. Document verification stays authenticated below.

@router.get("/search", response_model=schemas.PaginatedCustomers)
async def search_customers(
    db: DB,
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=200),
    q: Optional[str] = None,
    sucursal: Optional[str] = None,
    client_type: Optional[str] = None,
    price_list: Optional[str] = None,
    is_active: Optional[bool] = None,
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
):
    items, total = await service.search_customers(
        db, skip=skip, limit=limit, q=q, sucursal=sucursal, client_type=client_type,
        price_list=price_list, is_active=is_active, sort_by=sort_by, sort_dir=sort_dir,
    )
    return schemas.PaginatedCustomers(items=items, total=total, skip=skip, limit=limit)


@router.get("/stats")
async def customer_stats(db: DB):
    return await service.get_stats(db)


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("/", response_model=schemas.CustomerInDB, status_code=201)
async def create_customer(customer_in: schemas.CustomerCreate, db: DB):
    return await service.create_customer(db, customer_in)


@router.get("/", response_model=List[schemas.CustomerInDB])
async def read_customers(db: DB, skip: int = 0, limit: int = 100):
    # Plain list kept for the Sales dropdown / backward compatibility.
    return await service.get_customers(db, skip=skip, limit=limit)


@router.get("/{customer_id}", response_model=schemas.CustomerInDB)
async def read_customer(customer_id: int, db: DB):
    customer = await service.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(404, "Cliente no encontrado")
    return customer


@router.put("/{customer_id}", response_model=schemas.CustomerInDB)
async def update_customer(customer_id: int, data: schemas.CustomerUpdate, db: DB):
    customer = await service.update_customer(db, customer_id, data)
    if not customer:
        raise HTTPException(404, "Cliente no encontrado")
    return customer


# ── Documents (authenticated, as in the original module) ────────────────────

@router.post("/{customer_id}/documents", response_model=schemas.CustomerDocumentInDB)
async def upload_customer_document(
    customer_id: int, document_type: str, db: DB, current_user: CurrentUser,
    file: UploadFile = File(...),
):
    customer = await service.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(404, "Cliente no encontrado")

    content = await file.read()
    safe_name = f"cli{customer_id}_{document_type}_{int(datetime.now().timestamp())}_{file.filename or 'documento'}"
    url = await upload_bytes(content, safe_name, folder="clientes")

    doc_in = schemas.CustomerDocumentCreate(
        customer_id=customer_id, document_type=document_type,
        file_name=file.filename or safe_name, file_path=url,
        mime_type=file.content_type or "application/octet-stream",
    )
    return await service.create_document(db, doc_in)


@router.get("/{customer_id}/documents", response_model=List[schemas.CustomerDocumentInDB])
async def list_customer_documents(customer_id: int, db: DB, _: CurrentUser):
    return await service.get_customer_documents(db, customer_id)


@router.delete("/{customer_id}/documents/{doc_id}", status_code=204)
async def delete_customer_document(customer_id: int, doc_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_document(db, customer_id, doc_id)
    if not ok:
        raise HTTPException(404, "Documento no encontrado")


@router.patch("/documents/{doc_id}/status", response_model=schemas.CustomerDocumentInDB)
async def update_document_status(
    doc_id: int, status_update: schemas.CustomerDocumentUpdate, db: DB, current_user: CurrentUser,
):
    if status_update.status not in ("verificado", "rechazado", "pendiente"):
        raise HTTPException(400, "Estatus inválido")
    doc = await service.update_document_status(db, doc_id, status_update.status, verified_by_id=current_user.id)
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    return doc
