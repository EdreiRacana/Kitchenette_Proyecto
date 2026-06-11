import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from typing import List, Annotated
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.customers import schemas, service
from app.modules.auth.models import User

router = APIRouter()

UPLOAD_DIR = "uploads/customers"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@router.post("/", response_model=schemas.CustomerInDB)
async def create_customer(
    customer_in: schemas.CustomerCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    return await service.create_customer(db, customer_in)

@router.get("/", response_model=List[schemas.CustomerInDB])
async def read_customers(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    skip: int = 0,
    limit: int = 100
):
    return await service.get_customers(db, skip=skip, limit=limit)

@router.get("/{customer_id}", response_model=schemas.CustomerInDB)
async def read_customer(
    customer_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    customer = await service.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

@router.post("/{customer_id}/documents", response_model=schemas.CustomerDocumentInDB)
async def upload_customer_document(
    customer_id: int,
    document_type: str,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    file: UploadFile = File(...),
):
    # Verify customer exists
    customer = await service.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    
    # Save file
    file_extension = os.path.splitext(file.filename)[1]
    safe_filename = f"{customer_id}_{document_type}_{int(datetime.now().timestamp())}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Store in DB
    doc_in = schemas.CustomerDocumentCreate(
        customer_id=customer_id,
        document_type=document_type,
        file_name=file.filename,
        file_path=f"customers/{safe_filename}", # Relative to uploads
        mime_type=file.content_type
    )
    
    return await service.create_document(db, doc_in)

@router.get("/{customer_id}/documents", response_model=List[schemas.CustomerDocumentInDB])
async def list_customer_documents(
    customer_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)]
):
    return await service.get_customer_documents(db, customer_id)

@router.patch("/documents/{doc_id}/status", response_model=schemas.CustomerDocumentInDB)
async def update_document_status(
    doc_id: int,
    status_update: schemas.CustomerDocumentUpdate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)]
):
    # Only verify/reject
    if status_update.status not in ["verificado", "rechazado", "pendiente"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    doc = await service.update_document_status(
        db, doc_id, status_update.status, verified_by_id=current_user.id
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
