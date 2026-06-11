from pydantic import BaseModel, EmailStr, ConfigDict
from typing import Optional, List
from datetime import datetime

class CustomerDocumentBase(BaseModel):
    document_type: str
    status: Optional[str] = "pendiente"

class CustomerDocumentCreate(CustomerDocumentBase):
    file_name: str
    file_path: str
    mime_type: str
    customer_id: int

class CustomerDocumentUpdate(BaseModel):
    status: Optional[str] = None

class CustomerDocumentInDB(CustomerDocumentBase):
    id: int
    customer_id: int
    file_name: str
    file_path: str
    mime_type: str
    upload_date: datetime
    verified_at: Optional[datetime] = None
    verified_by_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class CustomerBase(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = True

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(CustomerBase):
    name: Optional[str] = None

class CustomerInDB(CustomerBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    documents: List[CustomerDocumentInDB] = []

    model_config = ConfigDict(from_attributes=True)
