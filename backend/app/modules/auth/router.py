
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from typing import Annotated, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func as sqlfunc
from datetime import timedelta

from app.api import deps
from app.modules.auth import schemas, service
from app.modules.auth.models import User
from app.core import security
from app.core.config import settings

router = APIRouter()


@router.post("/login", response_model=schemas.Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    # OAuth2PasswordRequestForm usa el campo 'username', que mapeamos a email.
    user = await service.authenticate_user(db, form_data.username, form_data.password)
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


# ── BOOTSTRAP: Primer administrador (solo funciona una vez) ──────────────────
# Resuelve el problema del "huevo y la gallina": necesitas un admin para crear
# usuarios, pero al inicio la base está vacía. Se auto-deshabilita en cuanto
# exista al menos un usuario, así que no es un hueco de seguridad permanente.
@router.post("/setup", response_model=schemas.User)
async def setup_first_admin(
    user_in: schemas.UserCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)]
):
    result = await db.execute(select(sqlfunc.count()).select_from(User))
    user_count = result.scalar_one()
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El sistema ya tiene usuarios. La configuración inicial está deshabilitada.",
        )
    existing = await service.get_user_by_email(db, user_in.email)
    if existing:
        raise HTTPException(status_code=400, detail="Ese email ya está registrado.")
    hashed_password = security.get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name or "Administrador",
        role="admin",
        is_active=True,
        is_superuser=True,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user


@router.post("/signup", response_model=schemas.User)
async def create_user(
    user_in: schemas.UserCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_superuser)],
):
    # Protegido: solo un superusuario puede crear cuentas nuevas.
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


@router.get("/me/permissions")
async def read_my_permissions(
    current_user: Annotated[User, Depends(deps.get_current_active_user)]
):
    """Permisos efectivos del usuario actual: {modulo: {accion: bool}} + flags.
    El frontend lo usa para adaptar la interfaz (ocultar/inhabilitar acciones)."""
    from app.modules.auth.rbac import effective_permissions, MODULES
    return {
        "is_superuser": bool(current_user.is_superuser),
        "role": current_user.role_obj.name if current_user.role_obj else None,
        "modules": [{"key": k, "label": label} for k, label in MODULES],
        "permissions": effective_permissions(current_user),
    }


# ── Administración de usuarios y roles (solo gestores de Configuración) ───────
ConfigManager = Annotated[User, Depends(deps.require_permission("config", "edit"))]
ConfigViewer = Annotated[User, Depends(deps.require_permission("config", "view"))]


@router.get("/users", response_model=List[schemas.User])
async def read_users(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigViewer,
    skip: int = 0,
    limit: int = 100,
):
    return await service.get_users(db, skip=skip, limit=limit)


@router.post("/users", response_model=schemas.User)
async def create_user_admin(
    user_in: schemas.UserCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigManager,
):
    existing = await service.get_user_by_email(db, user_in.email)
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un usuario con ese correo.")
    return await service.create_user(db, user_in)


@router.put("/users/{user_id}", response_model=schemas.User)
async def update_user_admin(
    user_id: int,
    user_in: schemas.UserUpdate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigManager,
):
    user = await service.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user_in.email and user_in.email != user.email:
        clash = await service.get_user_by_email(db, user_in.email)
        if clash:
            raise HTTPException(status_code=400, detail="Ya existe un usuario con ese correo.")
    return await service.update_user(db, user, user_in)


@router.delete("/users/{user_id}")
async def delete_user_admin(
    user_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigManager,
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta.")
    user = await service.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.is_superuser:
        supers = [u for u in await service.get_users(db, limit=1000) if u.is_superuser]
        if len(supers) <= 1:
            raise HTTPException(status_code=400, detail="No puedes eliminar al único superusuario.")
    await service.delete_user(db, user)
    return {"ok": True}


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
    current_user: ConfigManager,
):
    return await service.create_role(db, role_in)


@router.put("/roles/{role_id}", response_model=schemas.Role)
async def update_role_endpoint(
    role_id: int,
    role_in: schemas.RoleUpdate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigManager,
):
    role = await service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    return await service.update_role(db, role, role_in)


@router.delete("/roles/{role_id}")
async def delete_role_endpoint(
    role_id: int,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: ConfigManager,
):
    role = await service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Rol no encontrado")
    try:
        await service.delete_role(db, role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.get("/permissions", response_model=List[schemas.Permission])
async def read_permissions(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[schemas.User, Depends(deps.get_current_active_user)]
):
    return await service.get_permissions(db)


