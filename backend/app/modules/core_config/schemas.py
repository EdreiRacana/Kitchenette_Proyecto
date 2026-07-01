from pydantic import BaseModel, UUID4, EmailStr
from typing import Optional, Dict, Any
from datetime import datetime
from .models import IntegrationProvider, IntegrationType, IntegrationEnvironment

# -- Company Profile Schemas --

class CompanyProfileBase(BaseModel):
    legal_name: str
    tax_id: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    base_currency: Optional[str] = "MXN"
    timezone: Optional[str] = "America/Mexico_City"
    logo_url: Optional[str] = None

class CompanyProfileCreate(CompanyProfileBase):
    pass

class CompanyProfileUpdate(CompanyProfileBase):
    legal_name: Optional[str] = None

class CompanyProfileResponse(CompanyProfileBase):
    id: UUID4

    class Config:
        from_attributes = True

# -- Branch (Sucursal) Schemas --

class BranchBase(BaseModel):
    name: str
    code: Optional[str] = None
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_primary: Optional[bool] = False
    is_active: Optional[bool] = True

class BranchCreate(BranchBase):
    pass

class BranchUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    legal_name: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None

class BranchResponse(BranchBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# -- System Integration Schemas --

class SystemIntegrationBase(BaseModel):
    provider_name: IntegrationProvider
    integration_type: IntegrationType
    is_active: bool = False
    environment: IntegrationEnvironment = IntegrationEnvironment.SANDBOX
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    webhook_secret: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None

class SystemIntegrationCreate(SystemIntegrationBase):
    pass

class SystemIntegrationUpdate(BaseModel):
    is_active: Optional[bool] = None
    environment: Optional[IntegrationEnvironment] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    webhook_secret: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None

class SystemIntegrationResponse(SystemIntegrationBase):
    id: UUID4

    class Config:
        from_attributes = True# -- Audit Log Schemas --

class AuditLogBase(BaseModel):
    action: str
    module: str
    description: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    user_id: Optional[int] = None

class AuditLogResponse(AuditLogBase):
    id: UUID4
    timestamp: datetime

    class Config:
        from_attributes = True

# -- Reset total de datos (zona de peligro) --

class DataResetRequest(BaseModel):
    password: str
    confirm: str


class DataResetResponse(BaseModel):
    wiped_tables: list[str]
    message: str
