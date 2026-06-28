"""REST API for customer returns (devoluciones de cliente) — MVP.

Mounted at /sales/returns BEFORE the generic /sales router so the literal
`returns` path isn't swallowed by /sales/{order_id}. Writes are protected by the
sales module's write guard (same as the rest of /sales)."""

from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.sales import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


async def _branch_ids(db, user):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    return await visible_warehouse_ids(db, user)


@router.get("", response_model=List[schemas.ReturnDetail])
async def list_returns(db: DB, current_user: CurrentUser,
                       skip: int = 0, limit: int = Query(100, ge=1, le=500)):
    ids = await _branch_ids(db, current_user)
    return await service.list_returns(db, skip=skip, limit=limit, branch_warehouse_ids=ids)


@router.get("/returnable/{order_id}", response_model=schemas.ReturnableOrder)
async def returnable(order_id: int, db: DB, _: CurrentUser):
    """Partidas de un pedido con cuánto sigue siendo devolvible."""
    ro = await service.get_returnable_order(db, order_id)
    if not ro:
        raise HTTPException(status_code=404, detail="Pedido no encontrado o no es un pedido válido")
    return ro


@router.post("", response_model=schemas.ReturnDetail, status_code=201)
async def create_return(data: schemas.ReturnCreate, db: DB, user: CurrentUser):
    try:
        return await service.create_return(db, data, user_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{return_id}", response_model=schemas.ReturnDetail)
async def get_return(return_id: int, db: DB, _: CurrentUser):
    r = await service.get_return_detail(db, return_id)
    if not r:
        raise HTTPException(status_code=404, detail="Devolución no encontrada")
    return r


@router.post("/{return_id}/cancel", response_model=schemas.ReturnDetail)
async def cancel_return(return_id: int, db: DB, user: CurrentUser):
    r = await service.cancel_return(db, return_id, user_id=user.id)
    if not r:
        raise HTTPException(status_code=404, detail="Devolución no encontrada")
    return r
