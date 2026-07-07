"""REST API para el módulo Forecast de ventas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
import io

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


# ── Goal for range (usado por el tablero) ───────────────────────────────────

def _to_date(v: Optional[str]) -> Optional[date]:
    if not v:
        return None
    # acepta ISO datetime o YYYY-MM-DD
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).date()
    except ValueError:
        return date.fromisoformat(v)


@router.get("/goal-for-range", response_model=schemas.GoalForRangeResponse)
async def goal_for_range(
    db: DB, _: CurrentUser,
    start: str = Query(..., description="Fecha inicio (ISO)"),
    end: str = Query(..., description="Fecha fin (ISO)"),
):
    s = _to_date(start)
    e = _to_date(end)
    if s is None or e is None:
        raise HTTPException(400, "Rango de fechas inválido")
    if s > e:
        s, e = e, s
    return await service.goal_for_range(db, s, e)


# ── Plantilla + export + import bulk ────────────────────────────────────────

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/template")
async def download_template(
    db: DB, _: CurrentUser,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
    year: int = Query(default=None, description="Año del plan (para el título)"),
):
    y = year or date.today().year
    if format == "csv":
        content = service.build_template_csv()
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="forecast_plantilla_{y}.csv"'},
        )
    content = await service.build_template_xlsx(db, y)
    return StreamingResponse(
        io.BytesIO(content),
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="forecast_plantilla_{y}.xlsx"'},
    )


@router.get("/plans/{plan_id}/export")
async def export_plan(
    plan_id: int, db: DB, _: CurrentUser,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
):
    try:
        if format == "csv":
            # CSV usa el mismo formato que la plantilla pero con datos.
            plan = await service.get_plan(db, plan_id)
            if plan is None:
                raise HTTPException(404, "Plan no encontrado")
            lines = await service.list_lines(db, plan_id)
            buf = io.StringIO()
            import csv as _csv
            w = _csv.writer(buf)
            w.writerow(service.TEMPLATE_HEADERS + ["total_unidades", "total_importe"])
            for l in lines:
                w.writerow([
                    "", l.customer_name or "",
                    l.sku or "", l.product_name or "",
                    "",
                    l.unit_price,
                    l.m1, l.m2, l.m3, l.m4, l.m5, l.m6,
                    l.m7, l.m8, l.m9, l.m10, l.m11, l.m12,
                    l.total_units, l.total_amount,
                ])
            content = buf.getvalue().encode("utf-8-sig")
            return StreamingResponse(
                io.BytesIO(content),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="forecast_{plan_id}.csv"'},
            )
        content = await service.export_plan_xlsx(db, plan_id)
        return StreamingResponse(
            io.BytesIO(content),
            media_type=_XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="forecast_{plan_id}.xlsx"'},
        )
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.post("/plans/{plan_id}/import", response_model=schemas.ImportResponse)
async def import_plan(
    plan_id: int,
    db: DB,
    _: CurrentUser,
    file: UploadFile = File(...),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")
    try:
        return await service.import_lines(db, plan_id, content, file.filename or "")
    except ValueError as e:
        raise HTTPException(404, str(e))
