"""REST API del módulo Retail Sell-out Analytics."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User

from . import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Channels ─────────────────────────────────────────────────────────────

@router.get("/channels", response_model=List[schemas.RetailChannelOut])
async def list_channels(db: DB, _: CurrentUser):
    return await service.list_channels(db)


@router.post("/channels", response_model=schemas.RetailChannelOut, status_code=201)
async def create_channel(payload: schemas.RetailChannelCreate, db: DB, _: CurrentUser):
    ch = await service.create_channel(db, payload)
    return schemas.RetailChannelOut(
        id=ch.id, name=ch.name, code=ch.code, customer_id=ch.customer_id,
        target_wos_weeks=ch.target_wos_weeks,
        critical_wos_weeks=ch.critical_wos_weeks,
        overstock_wos_weeks=ch.overstock_wos_weeks,
        is_active=ch.is_active, notes=ch.notes,
        stores_count=0, created_at=ch.created_at,
    )


@router.patch("/channels/{channel_id}", response_model=schemas.RetailChannelOut)
async def update_channel(channel_id: int, payload: schemas.RetailChannelUpdate,
                          db: DB, _: CurrentUser):
    ch = await service.update_channel(db, channel_id, payload)
    if ch is None:
        raise HTTPException(404, "Cadena no encontrada")
    return schemas.RetailChannelOut(
        id=ch.id, name=ch.name, code=ch.code, customer_id=ch.customer_id,
        target_wos_weeks=ch.target_wos_weeks,
        critical_wos_weeks=ch.critical_wos_weeks,
        overstock_wos_weeks=ch.overstock_wos_weeks,
        is_active=ch.is_active, notes=ch.notes,
        stores_count=0, created_at=ch.created_at,
    )


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(channel_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_channel(db, channel_id)
    if not ok:
        raise HTTPException(404, "Cadena no encontrada")


# ── Stores ───────────────────────────────────────────────────────────────

@router.get("/stores", response_model=List[schemas.RetailStoreOut])
async def list_stores(db: DB, _: CurrentUser,
                       channel_id: Optional[int] = Query(None),
                       active_only: bool = Query(False)):
    return await service.list_stores(db, channel_id=channel_id, active_only=active_only)


@router.post("/stores", response_model=schemas.RetailStoreOut, status_code=201)
async def create_store(payload: schemas.RetailStoreCreate, db: DB, _: CurrentUser):
    ch = await service.get_channel(db, payload.channel_id)
    if ch is None:
        raise HTTPException(400, "Cadena no encontrada")
    s = await service.create_store(db, payload)
    return schemas.RetailStoreOut(
        id=s.id, channel_id=s.channel_id, channel_name=ch.name,
        name=s.name, code=s.code, external_code=s.external_code,
        city=s.city, state=s.state, region=s.region,
        store_format=s.store_format, address=s.address,
        contact_name=s.contact_name, contact_phone=s.contact_phone,
        is_active=s.is_active, notes=s.notes, created_at=s.created_at,
    )


@router.post("/stores/bulk", response_model=schemas.BulkStoresResponse, status_code=201)
async def bulk_create_stores(payload: schemas.BulkStoresRequest, db: DB, _: CurrentUser):
    try:
        return await service.bulk_create_stores(db, payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/stores/{store_id}", response_model=schemas.RetailStoreOut)
async def update_store(store_id: int, payload: schemas.RetailStoreUpdate,
                        db: DB, _: CurrentUser):
    s = await service.update_store(db, store_id, payload)
    if s is None:
        raise HTTPException(404, "Tienda no encontrada")
    ch = await service.get_channel(db, s.channel_id)
    return schemas.RetailStoreOut(
        id=s.id, channel_id=s.channel_id, channel_name=ch.name if ch else None,
        name=s.name, code=s.code, external_code=s.external_code,
        city=s.city, state=s.state, region=s.region,
        store_format=s.store_format, address=s.address,
        contact_name=s.contact_name, contact_phone=s.contact_phone,
        is_active=s.is_active, notes=s.notes, created_at=s.created_at,
    )


@router.delete("/stores/{store_id}", status_code=204)
async def delete_store(store_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_store(db, store_id)
    if not ok:
        raise HTTPException(404, "Tienda no encontrada")


@router.get("/stores/{store_id}/performance", response_model=schemas.StorePerformanceOut)
async def store_performance(store_id: int, db: DB, _: CurrentUser,
                              weeks_back: int = Query(12, ge=1, le=52)):
    r = await service.store_performance(db, store_id, weeks_back=weeks_back)
    if r is None:
        raise HTTPException(404, "Tienda no encontrada")
    return r


# ── Sell-out reports ────────────────────────────────────────────────────

@router.get("/sellout", response_model=List[schemas.SellOutReportOut])
async def list_sellout(db: DB, _: CurrentUser,
                        channel_id: Optional[int] = Query(None),
                        store_id: Optional[int] = Query(None),
                        variant_id: Optional[int] = Query(None),
                        period_start_gte: Optional[datetime] = Query(None),
                        period_start_lt: Optional[datetime] = Query(None),
                        limit: int = Query(500, ge=1, le=5000)):
    return await service.list_sellout(
        db, channel_id=channel_id, store_id=store_id, variant_id=variant_id,
        period_start_gte=period_start_gte, period_start_lt=period_start_lt,
        limit=limit,
    )


@router.post("/sellout", response_model=schemas.SellOutReportOut, status_code=201)
async def create_sellout(payload: schemas.SellOutReportCreate, db: DB, current_user: CurrentUser):
    store = await service.get_store(db, payload.store_id)
    if store is None:
        raise HTTPException(400, "Tienda no encontrada")
    r = await service.create_sellout(db, payload, user_id=current_user.id)
    from . import models as m
    ch = await service.get_channel(db, store.channel_id)
    return schemas.SellOutReportOut(
        id=r.id, store_id=r.store_id, store_name=store.name,
        channel_id=store.channel_id, channel_name=ch.name if ch else None,
        variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
        period_start=r.period_start, period_end=r.period_end,
        period_type=r.period_type,
        units_sold=r.units_sold, units_on_hand=r.units_on_hand,
        revenue=r.revenue, source=r.source, notes=r.notes,
        created_at=r.created_at,
    )


@router.patch("/sellout/{report_id}", response_model=schemas.SellOutReportOut)
async def update_sellout(report_id: int, payload: schemas.SellOutReportUpdate,
                          db: DB, _: CurrentUser):
    r = await service.update_sellout(db, report_id, payload)
    if r is None:
        raise HTTPException(404, "Reporte no encontrado")
    store = await service.get_store(db, r.store_id)
    ch = await service.get_channel(db, store.channel_id) if store else None
    return schemas.SellOutReportOut(
        id=r.id, store_id=r.store_id, store_name=store.name if store else None,
        channel_id=store.channel_id if store else None,
        channel_name=ch.name if ch else None,
        variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
        period_start=r.period_start, period_end=r.period_end,
        period_type=r.period_type,
        units_sold=r.units_sold, units_on_hand=r.units_on_hand,
        revenue=r.revenue, source=r.source, notes=r.notes,
        created_at=r.created_at,
    )


@router.delete("/sellout/{report_id}", status_code=204)
async def delete_sellout(report_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_sellout(db, report_id)
    if not ok:
        raise HTTPException(404, "Reporte no encontrado")


# ── Dashboard / KPIs ────────────────────────────────────────────────────

@router.get("/dashboard", response_model=schemas.RetailKPIs)
async def dashboard(db: DB, _: CurrentUser,
                     channel_id: Optional[int] = Query(None),
                     days: int = Query(30, ge=1, le=365)):
    return await service.dashboard_kpis(db, channel_id=channel_id, days=days)


@router.get("/stores-velocity", response_model=List[schemas.StoreVelocityRow])
async def stores_velocity(db: DB, _: CurrentUser,
                            channel_id: Optional[int] = Query(None)):
    return await service.stores_velocity(db, channel_id=channel_id)


@router.get("/skus-velocity", response_model=List[schemas.SKUVelocityRow])
async def skus_velocity(db: DB, _: CurrentUser,
                          channel_id: Optional[int] = Query(None),
                          limit: int = Query(100, ge=1, le=500)):
    return await service.skus_velocity(db, channel_id=channel_id, limit=limit)


# ── Replenishment engine ────────────────────────────────────────────────

@router.get("/replenishment", response_model=schemas.ReplenishmentResponse)
async def replenishment(db: DB, _: CurrentUser,
                          channel_id: Optional[int] = Query(None)):
    return await service.replenishment(db, channel_id=channel_id)
