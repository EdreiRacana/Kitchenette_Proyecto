from typing import Annotated
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from . import schemas, service

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.get("/", response_model=schemas.GlobalSearchResult)
async def search(db: DB, _: CurrentUser, q: str = Query(..., min_length=1), limit: int = Query(5, ge=1, le=20)):
    if not q.strip():
        return schemas.GlobalSearchResult()
    return await service.global_search(db, q.strip(), limit=limit)
