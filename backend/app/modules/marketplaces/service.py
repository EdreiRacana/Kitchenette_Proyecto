"""Marketplaces: registry + CRUD."""

from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional, Type, Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.marketplaces import models, schemas
from app.modules.marketplaces.connectors.base import BaseConnector
from app.modules.marketplaces.connectors.shopify import ShopifyConnector
from app.modules.marketplaces.connectors.stubs import (
    AmazonConnector, MercadoLibreConnector, LiverpoolConnector,
    CoppelConnector, WalmartConnector,
)


REGISTRY: Dict[str, Type[BaseConnector]] = {
    ShopifyConnector.PLATFORM_KEY:      ShopifyConnector,
    AmazonConnector.PLATFORM_KEY:       AmazonConnector,
    MercadoLibreConnector.PLATFORM_KEY: MercadoLibreConnector,
    LiverpoolConnector.PLATFORM_KEY:    LiverpoolConnector,
    CoppelConnector.PLATFORM_KEY:       CoppelConnector,
    WalmartConnector.PLATFORM_KEY:      WalmartConnector,
}


def list_platforms() -> List[schemas.PlatformInfo]:
    return [c.info() for c in REGISTRY.values()]


def get_connector(platform: str) -> BaseConnector:
    cls = REGISTRY.get(platform)
    if not cls:
        raise ValueError(f"Plataforma no soportada: {platform}")
    return cls()


# ── Serialización segura (nunca expone credenciales) ──────────────────────
def _serialize(c: models.MarketplaceConnection) -> schemas.ConnectionOut:
    creds = {}
    try:
        creds = json.loads(c.credentials) if c.credentials else {}
    except Exception:
        creds = {}
    return schemas.ConnectionOut(
        id=c.id, platform=c.platform, name=c.name, is_active=c.is_active,
        customer_id=c.customer_id, default_warehouse_id=c.default_warehouse_id,
        last_sync_at=c.last_sync_at, last_sync_orders=c.last_sync_orders,
        last_error=c.last_error,
        has_credentials=bool(creds),
        credential_keys=sorted(creds.keys()) if isinstance(creds, dict) else [],
    )


# ── CRUD ────────────────────────────────────────────────────────────────────
async def list_connections(db: AsyncSession) -> List[schemas.ConnectionOut]:
    rows = (await db.execute(
        select(models.MarketplaceConnection).order_by(models.MarketplaceConnection.name)
    )).scalars().all()
    return [_serialize(r) for r in rows]


async def get_connection(db: AsyncSession, cid: int) -> Optional[schemas.ConnectionOut]:
    r = (await db.execute(
        select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == cid)
    )).scalar_one_or_none()
    return _serialize(r) if r else None


async def _load(db: AsyncSession, cid: int) -> Optional[models.MarketplaceConnection]:
    return (await db.execute(
        select(models.MarketplaceConnection).where(models.MarketplaceConnection.id == cid)
    )).scalar_one_or_none()


async def create_connection(db: AsyncSession, data: schemas.ConnectionCreate) -> schemas.ConnectionOut:
    if data.platform not in REGISTRY:
        raise ValueError(f"Plataforma no soportada: {data.platform}")
    c = models.MarketplaceConnection(
        platform=data.platform, name=data.name, is_active=data.is_active,
        customer_id=data.customer_id, default_warehouse_id=data.default_warehouse_id,
        credentials=json.dumps(data.credentials or {}),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _serialize(c)


async def update_connection(db: AsyncSession, cid: int,
                             data: schemas.ConnectionUpdate) -> Optional[schemas.ConnectionOut]:
    c = await _load(db, cid)
    if not c:
        return None
    if data.name is not None: c.name = data.name
    if data.is_active is not None: c.is_active = data.is_active
    if data.customer_id is not None: c.customer_id = data.customer_id
    if data.default_warehouse_id is not None: c.default_warehouse_id = data.default_warehouse_id
    if data.credentials is not None:
        # Merge parcial: solo pisamos las claves que llegan. Esto permite que
        # el frontend mande solo el campo que cambió sin borrar los demás.
        existing = {}
        try:
            existing = json.loads(c.credentials) if c.credentials else {}
        except Exception:
            existing = {}
        merged = {**existing, **data.credentials}
        c.credentials = json.dumps(merged)
    await db.commit()
    await db.refresh(c)
    return _serialize(c)


async def delete_connection(db: AsyncSession, cid: int) -> bool:
    c = await _load(db, cid)
    if not c:
        return False
    await db.delete(c)
    await db.commit()
    return True


async def sync_now(db: AsyncSession, cid: int,
                   since: Optional[datetime] = None) -> schemas.SyncResult:
    c = await _load(db, cid)
    if not c:
        raise ValueError("Conexión no encontrada")
    if not c.is_active:
        raise ValueError("La conexión está deshabilitada")
    conn_cls = REGISTRY.get(c.platform)
    if not conn_cls:
        raise ValueError(f"Plataforma no soportada: {c.platform}")
    try:
        return await conn_cls().sync_orders(db, c, since=since)
    except Exception as e:
        # Persistimos el error para que la UI lo muestre incluso si la request cae.
        c.last_error = str(e)[:2000]
        await db.commit()
        return schemas.SyncResult(connection_id=c.id, platform=c.platform,
                                  orders_imported=0, error=str(e))
