from typing import Annotated, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from . import schemas, service

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


@router.get("/", response_model=schemas.NotificationDigest)
async def get_notifications(db: DB, _: CurrentUser):
    return await service.build_digest(db)


@router.post("/email-digest", response_model=schemas.EmailDigestResult)
async def email_digest(db: DB, current_user: CurrentUser, to: Optional[str] = None):
    recipient = to or current_user.email
    return await service.email_digest(db, recipient)
