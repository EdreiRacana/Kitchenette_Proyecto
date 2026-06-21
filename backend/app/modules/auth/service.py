
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.modules.auth.models import User, Role, Permission, role_permissions
from app.modules.auth.schemas import UserCreate, UserUpdate, RoleCreate, RoleUpdate
from app.core.security import get_password_hash, verify_password


async def get_user_by_email(db: AsyncSession, email: str):
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()


async def create_user(db: AsyncSession, user_in: UserCreate):
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
        role=user_in.role,
        role_id=user_in.role_id,
        is_active=user_in.is_active,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user


async def get_users(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(User).options(selectinload(User.role_obj)).offset(skip).limit(limit)
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


async def update_role(db: AsyncSession, db_obj: Role, role_in: RoleUpdate):
    update_data = role_in.model_dump(exclude_unset=True)
    if "permission_ids" in update_data:
        perm_ids = update_data.pop("permission_ids")
        perms = await db.execute(
            select(Permission).where(Permission.id.in_(perm_ids))
        )
        db_obj.permissions = list(perms.scalars().all())
    for field, value in update_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


