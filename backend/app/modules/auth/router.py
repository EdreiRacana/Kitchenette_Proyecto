from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from typing import Annotated, List
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

from app.api import deps
from app.modules.auth import schemas, service
from app.core import security
from app.core.config import settings

router = APIRouter()

@router.post("/login", response_model=schemas.Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    print(f"DEBUG: Login Request Received. Username: '{form_data.username}'")
    print(f"DEBUG: Password length: {len(form_data.password)}")
    
    user = await service.authenticate_user(db, form_data.username, form_data.password)
    # Note: OAuth2PasswordRequestForm uses 'username' field, which maps to our email
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/signup", response_model=schemas.User)
async def create_user(
    user_in: schemas.UserCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    user = await service.get_user_by_email(db, user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system",
        )
    user = await service.create_user(db, user_in)
    return user

@router.get("/me", response_model=schemas.User)
async def read_users_me(
    current_user: Annotated[schemas.User, Depends(deps.get_current_active_user)]
):
    return current_user

# -- User & Role Management (Superuser only) --

@router.get("/users", response_model=List[schemas.User])
async def read_users(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_superuser)],
    skip: int = 0,
    limit: int = 100,
):
    return await service.get_users(db, skip=skip, limit=limit)

@router.get("/roles", response_model=List[schemas.Role])
async def read_roles(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_active_user)]
):
    return await service.get_roles(db)

@router.post("/roles", response_model=schemas.Role)
async def create_role(
    role_in: schemas.RoleCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_superuser)]
):
    return await service.create_role(db, role_in)

@router.get("/permissions", response_model=List[schemas.Permission])
async def read_permissions(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_active_user)]
):
    return await service.get_permissions(db)
