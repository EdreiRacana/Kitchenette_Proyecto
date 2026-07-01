
from fastapi import APIRouter, Depends, HTTPException, Request, status
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
from app.core.rate_limit import limiter

router = APIRouter()


@router.post("/login", response_model=schemas.LoginResponse)
@limiter.limit("10/minute")
async def login_for_access_token(
    request: Request,
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
    if user.two_factor_enabled:
        # Token de corta vida (5 min) que solo sirve para completar /login/2fa;
        # NO concede acceso a la API (no es un access_token normal).
        login_token = security.create_access_token(
            data={"sub": user.email, "purpose": "2fa_pending"}, expires_delta=timedelta(minutes=5)
        )
        return {"requires_2fa": True, "login_token": login_token}
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "requires_2fa": False}


@router.post("/login/2fa", response_model=schemas.Token)
@limiter.limit("10/minute")
async def login_verify_2fa(
    request: Request,
    body: schemas.TwoFactorVerify,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
):
    """Segundo paso del login cuando el usuario tiene 2FA activo."""
    from jose import JWTError, jwt
    try:
        payload = jwt.decode(body.login_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("purpose") != "2fa_pending":
            raise HTTPException(status_code=401, detail="Token de login inválido")
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token de login expirado o inválido")
    user = await service.get_user_by_email(db, email)
    if not user or not user.two_factor_enabled:
        raise HTTPException(status_code=401, detail="Token de login inválido")
    if not await service.verify_two_factor_login(db, user, body.code):
        raise HTTPException(status_code=401, detail="Código de verificación incorrecto")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


# ── BOOTSTRAP: Primer administrador (solo funciona una vez) ──────────────────
# Resuelve el problema del "huevo y la gallina": necesitas un admin para crear
# usuarios, pero al inicio la base está vacía. Se auto-deshabilita en cuanto
# exista al menos un usuario, así que no es un hueco de seguridad permanente.
@router.get("/setup-status")
@limiter.limit("30/minute")
async def get_setup_status(
    request: Request,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
):
    """Público (sin auth): le dice al frontend si debe mostrar la pantalla de
    login normal o la de 'primer administrador' porque la base está vacía."""
    result = await db.execute(select(sqlfunc.count()).select_from(User))
    user_count = result.scalar_one()
    return {"needs_setup": user_count == 0}


@router.post("/setup", response_model=schemas.User)
@limiter.limit("5/hour")
async def setup_first_admin(
    request: Request,
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


@router.post("/me/password")
async def change_my_password(
    body: schemas.PasswordChange,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    """Cambiar la propia contraseña: exige la contraseña actual correcta."""
    if not security.verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta.")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres.")
    current_user.hashed_password = security.get_password_hash(body.new_password)
    db.add(current_user)
    await db.commit()
    return {"ok": True}


@router.get("/me/2fa/status", response_model=schemas.TwoFactorStatus)
async def read_my_2fa_status(
    current_user: Annotated[User, Depends(deps.get_current_active_user)]
):
    return {"enabled": current_user.two_factor_enabled}


@router.post("/me/2fa/setup", response_model=schemas.TwoFactorSetupResponse)
async def setup_my_2fa(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    """Genera un nuevo secreto TOTP (pendiente de confirmar) y su QR."""
    result = await service.start_two_factor_setup(db, current_user)
    return {"qr_data_uri": result["qr_data_uri"]}


@router.post("/me/2fa/enable", response_model=schemas.TwoFactorEnableResponse)
async def enable_my_2fa(
    body: schemas.TwoFactorEnableRequest,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    """Confirma el código del setup y activa 2FA. Devuelve códigos de respaldo (solo una vez)."""
    try:
        backup_codes = await service.confirm_two_factor_setup(db, current_user, body.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"backup_codes": backup_codes}


@router.post("/me/2fa/disable")
async def disable_my_2fa(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    await service.disable_two_factor(db, current_user)
    return {"ok": True}


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


