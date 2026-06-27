from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from typing import Annotated
from sqlalchemy.ext.asyncio import AsyncSession
from jose import jwt, JWTError
from app.db.session import get_db
from app.core.config import settings
from app.modules.auth.models import User
from app.modules.auth.schemas import TokenData
from app.modules.auth.service import get_user_by_email

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Annotated[AsyncSession, Depends(get_db)]):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception
    
    user = await get_user_by_email(db, email=token_data.email)
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

async def get_current_superuser(current_user: Annotated[User, Depends(get_current_user)]):
    if not current_user.is_superuser:
        raise HTTPException(status_code=400, detail="The user doesn't have enough privileges")
    return current_user


def require_permission(module: str, action: str):
    """Fábrica de dependencias para verificar RBAC en un endpoint.

    Uso:  @router.post(...)  async def x(_: Annotated[User, Depends(require_permission("inventory", "create"))]): ...

    Los superusuarios pasan siempre. El resto debe tener el permiso (módulo, acción)
    vía su rol; si no, 403. Es la verificación real del lado del servidor.
    """
    async def checker(current_user: Annotated[User, Depends(get_current_active_user)]) -> User:
        from app.modules.auth.rbac import user_can
        if not user_can(current_user, module, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No tienes permiso para '{action}' en el módulo '{module}'.",
            )
        return current_user
    return checker


# Métodos HTTP de escritura → acción RBAC. Las lecturas (GET/HEAD/OPTIONS) no se
# bloquean aquí (el menú del frontend ya las oculta por rol); este guard cierra
# la puerta a ESCRITURAS por API directa a un módulo que el rol no permite.
_METHOD_ACTION = {"POST": "create", "PUT": "edit", "PATCH": "edit", "DELETE": "delete"}


def module_write_guard(module: str):
    """Dependencia a nivel de router: defensa en profundidad. Permite lecturas a
    cualquier usuario autenticado, pero exige el permiso del módulo para escribir
    (crear/editar/eliminar). Superusuario pasa siempre. Patrón estándar en ERPs
    de nivel mundial: la autorización vive en el servidor, no solo en la UI."""
    from fastapi import Request

    async def guard(request: Request, current_user: Annotated[User, Depends(get_current_active_user)]) -> User:
        action = _METHOD_ACTION.get(request.method.upper())
        if action is None:
            return current_user  # lectura → permitida
        from app.modules.auth.rbac import user_can
        if not user_can(current_user, module, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No tienes permiso para modificar el módulo '{module}'.",
            )
        return current_user
    return guard
