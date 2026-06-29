"""Pydantic v2 schemas for the Customer / CRM module."""

from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


# RFC: persona moral = 12 chars, persona física = 13 chars (SAT format).
_RFC_RE = re.compile(r"^([A-ZÑ&]{3,4})\d{6}[A-Z0-9]{3}$", re.IGNORECASE)


# ── Documents (unchanged) ────────────────────────────────────────────────────

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


class CustomerDocumentSignRequest(BaseModel):
    file_name: str
    mime_type: str = "application/octet-stream"


class CustomerDocumentSignResponse(BaseModel):
    upload_url: str
    path: str


class CustomerDocumentFinalize(BaseModel):
    document_type: str
    file_name: str
    path: str
    mime_type: str = "application/octet-stream"


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


# ── Customer ─────────────────────────────────────────────────────────────────

class CustomerBase(BaseModel):
    # Identity
    razon_social: Optional[str] = None
    nombre_comercial: Optional[str] = None
    name: Optional[str] = None  # display; auto-filled if omitted
    client_type: Optional[str] = None

    # Tax / CFDI
    rfc: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    uso_cfdi: Optional[str] = "G03"
    cuenta_contable: Optional[str] = "105-01-001"

    # Commercial
    sucursal: Optional[str] = None
    price_list: Optional[str] = None
    credit_days: Optional[int] = 0
    credit_amount: Optional[float] = 0.0
    discount_pact: Optional[float] = 0.0
    account_number: Optional[str] = None
    sales_agent: Optional[str] = None
    credit_agent: Optional[str] = None
    how_heard: Optional[str] = None

    # Contact
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    phones: Optional[List[str]] = None

    # Fiscal address
    pais: Optional[str] = "México"
    estado: Optional[str] = None
    municipio: Optional[str] = None
    localidad: Optional[str] = None
    calle: Optional[str] = None
    colonia: Optional[str] = None
    codigo_postal: Optional[str] = None
    no_exterior: Optional[str] = None
    no_interior: Optional[str] = None
    codigo_colonia: Optional[str] = None
    codigo_localidad: Optional[str] = None
    referencia: Optional[str] = None
    address: Optional[str] = None

    is_active: Optional[bool] = True
    notes: Optional[str] = None

    @field_validator("rfc")
    @classmethod
    def _check_rfc(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        v = v.strip().upper()
        if not _RFC_RE.match(v):
            raise ValueError("RFC inválido (formato SAT: 12 caracteres para moral, 13 para física)")
        return v


class CustomerCreate(CustomerBase):
    # at least one human-readable name must be present
    @field_validator("razon_social", "nombre_comercial", "name")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class CustomerUpdate(CustomerBase):
    pass


class CustomerInDB(CustomerBase):
    id: int
    client_number: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    documents: List[CustomerDocumentInDB] = []
    model_config = ConfigDict(from_attributes=True)

    @field_validator("phones", mode="before")
    @classmethod
    def _phones_from_json(cls, v):
        # DB stores phones as a JSON string; expose as a list.
        import json
        if v is None or isinstance(v, list):
            return v
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else None
            except Exception:
                return None
        return None


class CustomerLite(BaseModel):
    """Compact shape for dropdowns / the Sales module."""
    id: int
    name: str
    client_number: Optional[str] = None
    rfc: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class PaginatedCustomers(BaseModel):
    items: List[CustomerInDB]
    total: int
    skip: int
    limit: int
