from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


class ConnectionCreate(BaseModel):
    platform: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    is_active: bool = True
    customer_id: Optional[int] = None
    default_warehouse_id: Optional[int] = None
    # Formato libre porque cada plataforma pide cosas distintas.
    # Shopify: {"shop_domain": "mi-tienda.myshopify.com", "access_token": "shpat_…"}
    # MercadoLibre: {"seller_id": "…", "access_token": "…", "refresh_token": "…"}
    credentials: Dict[str, Any] = Field(default_factory=dict)


class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    customer_id: Optional[int] = None
    default_warehouse_id: Optional[int] = None
    credentials: Optional[Dict[str, Any]] = None


class ConnectionOut(BaseModel):
    id: int
    platform: str
    name: str
    is_active: bool
    customer_id: Optional[int] = None
    default_warehouse_id: Optional[int] = None
    last_sync_at: Optional[datetime] = None
    last_sync_orders: int = 0
    last_error: Optional[str] = None
    has_credentials: bool = False
    # Se expone solo la lista de claves configuradas, NUNCA los valores.
    credential_keys: List[str] = []
    model_config = ConfigDict(from_attributes=True)


class SyncResult(BaseModel):
    connection_id: int
    platform: str
    orders_imported: int = 0
    orders_skipped_duplicate: int = 0
    error: Optional[str] = None
    since: Optional[datetime] = None
    until: Optional[datetime] = None


class PlatformInfo(BaseModel):
    key: str            # "shopify"
    label: str          # "Shopify"
    fields: List[Dict[str, Any]]   # [{"key":"shop_domain","label":"Dominio","type":"text","required":true}, ...]
    docs_url: Optional[str] = None
