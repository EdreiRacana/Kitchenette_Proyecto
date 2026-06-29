
import secrets
import base64
from io import BytesIO

import pyotp
import qrcode
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.modules.auth.models import User, Role, Permission, role_permissions
from app.modules.auth.schemas import UserCreate, UserUpdate, RoleCreate, RoleUpdate
from app.core.security import get_password_hash, verify_password


async def get_user_by_email(db: AsyncSession, email: str):
    # Carga ansiosa del rol y sus permisos: necesario para la verificación RBAC
    # en cada request (require_permission) y para devolver permisos en /me.
    result = await db.execute(
        select(User).where(User.email == email).options(
            selectinload(User.role_obj).selectinload(Role.permissions)
        )
    )
    return result.scalars().first()


async def create_user(db: AsyncSession, user_in: UserCreate):
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
        role=user_in.role,
        role_id=user_in.role_id,
        branch_id=user_in.branch_id,
        is_active=user_in.is_active,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return await get_user(db, db_user.id)


async def get_users(db: AsyncSession, skip: int = 0, limit: int = 100):
    # Carga el rol Y sus permisos: el schema de respuesta User incluye
    # role_obj.permissions; sin esta carga ansiosa, la serialización dispara un
    # lazy-load sobre la sesión async y revienta (ResponseValidationError).
    result = await db.execute(
        select(User).options(selectinload(User.role_obj).selectinload(Role.permissions))
        .offset(skip).limit(limit)
    )
    return result.scalars().all()


async def authenticate_user(db: AsyncSession, email: str, password: str):
    user = await get_user_by_email(db, email)
    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user


async def get_roles(db: AsyncSession):
    result = await db.execute(select(Role).options(selectinload(Role.permissions)))
    return result.scalars().all()


async def get_permissions(db: AsyncSession):
    result = await db.execute(select(Permission))
    return result.scalars().all()


async def create_role(db: AsyncSession, role_in: RoleCreate):
    db_obj = Role(name=role_in.name, description=role_in.description)
    if role_in.permission_ids:
        perms = await db.execute(
            select(Permission).where(Permission.id.in_(role_in.permission_ids))
        )
        db_obj.permissions = list(perms.scalars().all())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_role(db: AsyncSession, role_id: int):
    result = await db.execute(
        select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    )
    return result.scalars().first()


async def update_role(db: AsyncSession, db_obj: Role, role_in: RoleUpdate):
    update_data = role_in.model_dump(exclude_unset=True)
    # Roles de sistema: no se renombran (sí se pueden ajustar sus permisos).
    if db_obj.is_system:
        update_data.pop("name", None)
    if "permission_ids" in update_data:
        perm_ids = update_data.pop("permission_ids") or []
        perms = await db.execute(
            select(Permission).where(Permission.id.in_(perm_ids))
        )
        db_obj.permissions = list(perms.scalars().all())
    for field, value in update_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    return await get_role(db, db_obj.id)


async def delete_role(db: AsyncSession, db_obj: Role) -> bool:
    """Elimina un rol no-sistema. Reasigna a NULL los usuarios que lo tuvieran."""
    if db_obj.is_system:
        raise ValueError("Los roles de sistema no se pueden eliminar")
    users = (await db.execute(select(User).where(User.role_id == db_obj.id))).scalars().all()
    for u in users:
        u.role_id = None
    await db.delete(db_obj)
    await db.commit()
    return True


async def get_user(db: AsyncSession, user_id: int):
    result = await db.execute(
        select(User).where(User.id == user_id).options(
            selectinload(User.role_obj).selectinload(Role.permissions)
        )
    )
    return result.scalars().first()


async def update_user(db: AsyncSession, db_obj: User, user_in: UserUpdate):
    update_data = user_in.model_dump(exclude_unset=True)
    password = update_data.pop("password", None)
    if password:
        db_obj.hashed_password = get_password_hash(password)
    for field, value in update_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    return await get_user(db, db_obj.id)


async def delete_user(db: AsyncSession, db_obj: User) -> bool:
    await db.delete(db_obj)
    await db.commit()
    return True


# ── Autenticación de dos factores (TOTP, RFC 6238) ──────────────────────────
# El secreto se genera y se devuelve junto a un QR para que el usuario lo
# escanee con Google Authenticator/Authy, pero NO se persiste como activo
# hasta que confirme un código válido en `enable_two_factor` — así un setup
# abandonado a medias nunca bloquea el login.
_BACKUP_CODE_COUNT = 8


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def build_totp_qr_data_uri(email: str, secret: str) -> str:
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name="STHENOVA ERP")
    img = qrcode.make(uri)
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def verify_totp_code(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def _generate_backup_codes() -> list[str]:
    return [secrets.token_hex(4) for _ in range(_BACKUP_CODE_COUNT)]


async def start_two_factor_setup(db: AsyncSession, user: User) -> dict:
    """Genera (o regenera) el secreto pendiente de confirmación y su QR."""
    secret = generate_totp_secret()
    user.two_factor_secret = secret
    user.two_factor_enabled = False
    db.add(user)
    await db.commit()
    return {"secret": secret, "qr_data_uri": build_totp_qr_data_uri(user.email, secret)}


async def confirm_two_factor_setup(db: AsyncSession, user: User, code: str) -> list[str]:
    """Verifica el primer código y activa 2FA. Devuelve los códigos de respaldo (texto plano, una sola vez)."""
    if not user.two_factor_secret or not verify_totp_code(user.two_factor_secret, code):
        raise ValueError("Código inválido")
    backup_codes = _generate_backup_codes()
    user.two_factor_enabled = True
    user.two_factor_backup_codes = ",".join(get_password_hash(c) for c in backup_codes)
    db.add(user)
    await db.commit()
    return backup_codes


async def disable_two_factor(db: AsyncSession, user: User) -> None:
    user.two_factor_enabled = False
    user.two_factor_secret = None
    user.two_factor_backup_codes = None
    db.add(user)
    await db.commit()


async def verify_two_factor_login(db: AsyncSession, user: User, code: str) -> bool:
    """Acepta un código TOTP vigente o un código de respaldo (de un solo uso)."""
    if user.two_factor_secret and verify_totp_code(user.two_factor_secret, code):
        return True
    if user.two_factor_backup_codes:
        hashes = user.two_factor_backup_codes.split(",")
        for h in hashes:
            if verify_password(code, h):
                hashes.remove(h)
                user.two_factor_backup_codes = ",".join(hashes)
                db.add(user)
                await db.commit()
                return True
    return False


