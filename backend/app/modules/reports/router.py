"""API — Reportes personalizables."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User
from app.modules.reports import datasets as ds_mod, engine, models

router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.get("/datasets")
async def list_datasets(_: CurrentUser, lang: str = Query("es")):
    """Catálogo de datasets con sus campos, tipos, filtros y agregaciones."""
    return ds_mod.all_datasets(lang=lang)


@router.post("/run")
async def run_ad_hoc(payload: dict, db: DB, _: CurrentUser):
    """Ejecuta un reporte ad-hoc sin guardarlo. Body = config completa."""
    try:
        return await engine.run_report(db, payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/run.xlsx")
async def run_ad_hoc_xlsx(payload: dict, db: DB, _: CurrentUser):
    try:
        result = await engine.run_report(db, payload)
        name = payload.get("name") or "Reporte"
        xlsx = engine.build_xlsx(result, name)
        fname = f"{name.replace(' ', '_')}.xlsx"
        return Response(
            content=xlsx,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ─── Reportes guardados ────────────────────────────────────────────────────

@router.get("/saved")
async def list_saved(
    db: DB, current_user: CurrentUser,
    only_mine: bool = Query(False),
):
    """Lista reportes: los del usuario + los compartidos por otros."""
    q = select(models.SavedReport)
    if only_mine:
        q = q.where(models.SavedReport.owner_id == current_user.id)
    else:
        from sqlalchemy import or_
        q = q.where(or_(
            models.SavedReport.owner_id == current_user.id,
            models.SavedReport.is_shared == True,  # noqa: E712
        ))
    q = q.order_by(
        models.SavedReport.is_favorite.desc(),
        models.SavedReport.updated_at.desc(),
    )
    rows = (await db.execute(q)).scalars().all()
    return [_serialize(r, current_user.id) for r in rows]


@router.get("/saved/{report_id}")
async def get_saved(report_id: int, db: DB, current_user: CurrentUser):
    r = await _get(db, report_id, current_user.id)
    if not r:
        raise HTTPException(404, "Reporte no encontrado")
    return _serialize(r, current_user.id)


@router.post("/saved", status_code=201)
async def create_saved(payload: dict, db: DB, current_user: CurrentUser):
    """Body: {name, description?, dataset, config, is_shared?, is_favorite?}"""
    name = (payload.get("name") or "").strip()
    dataset = payload.get("dataset")
    config = payload.get("config") or {}
    if not name or not dataset:
        raise HTTPException(400, "name y dataset son obligatorios")
    # Validar config
    try:
        engine._validate_config({**config, "dataset": dataset})
    except ValueError as e:
        raise HTTPException(400, str(e))
    r = models.SavedReport(
        name=name,
        description=payload.get("description"),
        dataset=dataset,
        config=config,
        is_shared=bool(payload.get("is_shared") or False),
        is_favorite=bool(payload.get("is_favorite") or False),
        owner_id=current_user.id,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return _serialize(r, current_user.id)


@router.put("/saved/{report_id}")
async def update_saved(report_id: int, payload: dict, db: DB, current_user: CurrentUser):
    r = await _get(db, report_id, current_user.id)
    if not r:
        raise HTTPException(404, "Reporte no encontrado")
    if r.owner_id != current_user.id:
        raise HTTPException(403, "Solo el dueño puede editar")
    if "name" in payload:
        r.name = (payload["name"] or "").strip() or r.name
    if "description" in payload:
        r.description = payload["description"]
    if "dataset" in payload:
        r.dataset = payload["dataset"]
    if "config" in payload:
        try:
            engine._validate_config({**payload["config"], "dataset": payload.get("dataset", r.dataset)})
        except ValueError as e:
            raise HTTPException(400, str(e))
        r.config = payload["config"]
    if "is_shared" in payload:
        r.is_shared = bool(payload["is_shared"])
    if "is_favorite" in payload:
        r.is_favorite = bool(payload["is_favorite"])
    await db.commit()
    await db.refresh(r)
    return _serialize(r, current_user.id)


@router.delete("/saved/{report_id}")
async def delete_saved(report_id: int, db: DB, current_user: CurrentUser):
    r = await _get(db, report_id, current_user.id)
    if not r:
        raise HTTPException(404, "No encontrado")
    if r.owner_id != current_user.id:
        raise HTTPException(403, "Solo el dueño puede eliminar")
    await db.delete(r)
    await db.commit()
    return {"deleted": True}


@router.post("/saved/{report_id}/run")
async def run_saved(report_id: int, db: DB, current_user: CurrentUser):
    r = await _get(db, report_id, current_user.id)
    if not r:
        raise HTTPException(404, "No encontrado")
    config = dict(r.config or {})
    config["dataset"] = r.dataset
    try:
        result = await engine.run_report(db, config)
    except ValueError as e:
        raise HTTPException(400, str(e))
    r.last_run_at = datetime.now(timezone.utc)
    await db.commit()
    return result


@router.get("/saved/{report_id}/run.xlsx")
async def run_saved_xlsx(report_id: int, db: DB, current_user: CurrentUser):
    r = await _get(db, report_id, current_user.id)
    if not r:
        raise HTTPException(404, "No encontrado")
    config = dict(r.config or {})
    config["dataset"] = r.dataset
    result = await engine.run_report(db, config)
    xlsx = engine.build_xlsx(result, r.name)
    fname = f"{r.name.replace(' ', '_')}.xlsx"
    r.last_run_at = datetime.now(timezone.utc)
    await db.commit()
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─── helpers ───────────────────────────────────────────────────────────────

async def _get(db: AsyncSession, report_id: int, user_id: int):
    from sqlalchemy import or_
    q = select(models.SavedReport).where(
        models.SavedReport.id == report_id,
        or_(
            models.SavedReport.owner_id == user_id,
            models.SavedReport.is_shared == True,  # noqa: E712
        ),
    )
    return (await db.execute(q)).scalars().first()


def _serialize(r: models.SavedReport, current_user_id: int) -> dict:
    return {
        "id": r.id, "name": r.name, "description": r.description,
        "dataset": r.dataset, "config": r.config or {},
        "is_shared": r.is_shared, "is_favorite": r.is_favorite,
        "owner_id": r.owner_id, "is_mine": r.owner_id == current_user_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "last_run_at": r.last_run_at.isoformat() if r.last_run_at else None,
    }
