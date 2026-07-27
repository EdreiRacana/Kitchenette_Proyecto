"""REST API: /marketplaces

  GET    /platforms         → catálogo de conectores soportados
  GET    /connections       → lista de conexiones configuradas
  POST   /connections       → crea una conexión
  GET    /connections/{id}  → detalle
  PATCH  /connections/{id}  → actualiza (merge de credenciales)
  DELETE /connections/{id}  → borra
  POST   /connections/{id}/sync → dispara sync ahora
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.marketplaces import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.get("/platforms", response_model=List[schemas.PlatformInfo])
async def list_platforms(_: CurrentUser):
    return service.list_platforms()


@router.get("/connections", response_model=List[schemas.ConnectionOut])
async def list_connections(db: DB, _: CurrentUser):
    return await service.list_connections(db)


@router.post("/connections", response_model=schemas.ConnectionOut, status_code=201)
async def create_connection(data: schemas.ConnectionCreate, db: DB, _: CurrentUser):
    try:
        return await service.create_connection(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/connections/{cid}", response_model=schemas.ConnectionOut)
async def get_connection(cid: int, db: DB, _: CurrentUser):
    c = await service.get_connection(db, cid)
    if not c:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
    return c


@router.patch("/connections/{cid}", response_model=schemas.ConnectionOut)
async def update_connection(cid: int, data: schemas.ConnectionUpdate, db: DB, _: CurrentUser):
    c = await service.update_connection(db, cid, data)
    if not c:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")
    return c


@router.delete("/connections/{cid}", status_code=204)
async def delete_connection(cid: int, db: DB, _: CurrentUser):
    ok = await service.delete_connection(db, cid)
    if not ok:
        raise HTTPException(status_code=404, detail="Conexión no encontrada")


@router.post("/connections/{cid}/sync", response_model=schemas.SyncResult)
async def sync_now(cid: int, db: DB, _: CurrentUser, since: Optional[datetime] = None):
    try:
        return await service.sync_now(db, cid, since=since)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
