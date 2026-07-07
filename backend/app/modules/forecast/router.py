"""REST API para el módulo Forecast de ventas."""

from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User

from . import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Planes ───────────────────────────────────────────────────────────────────

@router.get("/plans", response_model=List[schemas.ForecastPlanInDB])
async def list_plans(db: DB, _: CurrentUser):
    return await service.list_plans(db)


@router.post("/plans", response_model=schemas.ForecastPlanInDB, status_code=201)
async def create_plan(payload: schemas.ForecastPlanCreate, db: DB, current_user: CurrentUser):
    if payload.owner_user_id is None:
        payload.owner_user_id = current_user.id
    return await service.create_plan(db, payload)


@router.get("/plans/{plan_id}", response_model=schemas.ForecastPlanInDB)
async def get_plan(plan_id: int, db: DB, _: CurrentUser):
    plan = await service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan no encontrado")
    return plan


@router.put("/plans/{plan_id}", response_model=schemas.ForecastPlanInDB)
async def update_plan(plan_id: int, payload: schemas.ForecastPlanUpdate, db: DB, _: CurrentUser):
    plan = await service.update_plan(db, plan_id, payload)
    if plan is None:
        raise HTTPException(404, "Plan no encontrado")
    return plan


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(plan_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_plan(db, plan_id)
    if not ok:
        raise HTTPException(404, "Plan no encontrado")


# ── Líneas ───────────────────────────────────────────────────────────────────

@router.get("/plans/{plan_id}/lines", response_model=List[schemas.ForecastLineInDB])
async def list_lines(plan_id: int, db: DB, _: CurrentUser):
    plan = await service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan no encontrado")
    return await service.list_lines(db, plan_id)


@router.post("/plans/{plan_id}/lines", response_model=schemas.ForecastLineInDB, status_code=201)
async def create_line(plan_id: int, payload: schemas.ForecastLineCreate, db: DB, _: CurrentUser):
    plan = await service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan no encontrado")
    return await service.create_line(db, plan_id, payload)


@router.put("/lines/{line_id}", response_model=schemas.ForecastLineInDB)
async def update_line(line_id: int, payload: schemas.ForecastLineUpdate, db: DB, _: CurrentUser):
    line = await service.update_line(db, line_id, payload)
    if line is None:
        raise HTTPException(404, "Línea no encontrada")
    return line


@router.delete("/lines/{line_id}", status_code=204)
async def delete_line(line_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_line(db, line_id)
    if not ok:
        raise HTTPException(404, "Línea no encontrada")


# ── Baseline desde historial ────────────────────────────────────────────────

@router.post("/baseline", response_model=schemas.BaselineResponse)
async def baseline(payload: schemas.BaselineRequest, db: DB, _: CurrentUser):
    try:
        return await service.build_baseline(db, payload)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ── Rollup / concentrado ────────────────────────────────────────────────────

@router.get("/plans/{plan_id}/rollup", response_model=schemas.RollupResponse)
async def plan_rollup(plan_id: int, db: DB, _: CurrentUser):
    plan = await service.get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan no encontrado")
    return await service.rollup(db, plan_id)


# ── Attainment (meta vs venta real) ─────────────────────────────────────────

@router.get("/plans/{plan_id}/attainment", response_model=schemas.AttainmentResponse)
async def plan_attainment(plan_id: int, db: DB, _: CurrentUser):
    try:
        return await service.attainment(db, plan_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
