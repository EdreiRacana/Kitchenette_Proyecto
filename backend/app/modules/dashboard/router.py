"""REST API del Dashboard Ejecutivo."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User

from . import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.get("/executive", response_model=schemas.ExecutiveDashboardResponse)
async def executive_dashboard(
    db: DB, _: CurrentUser,
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
):
    """KPIs ejecutivos consolidados del período (default: últimos 30 días)."""
    return await service.executive_dashboard(db, start=start, end=end)
