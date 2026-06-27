from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from .models import CompanyProfile, SystemIntegration, AuditLog, Branch
from .schemas import CompanyProfileCreate, CompanyProfileUpdate, SystemIntegrationCreate, SystemIntegrationUpdate, AuditLogBase, BranchCreate, BranchUpdate
import uuid


# -- Branches (Sucursales) --

async def get_branches(db: AsyncSession):
    result = await db.execute(select(Branch).order_by(Branch.is_primary.desc(), Branch.name))
    return result.scalars().all()


async def get_branch(db: AsyncSession, branch_id: int):
    result = await db.execute(select(Branch).where(Branch.id == branch_id))
    return result.scalars().first()


async def _clear_primary(db: AsyncSession, except_id: int | None = None):
    rows = (await db.execute(select(Branch).where(Branch.is_primary == True))).scalars().all()  # noqa: E712
    for b in rows:
        if except_id is None or b.id != except_id:
            b.is_primary = False


async def create_branch(db: AsyncSession, obj_in: BranchCreate):
    data = obj_in.model_dump()
    # La primera sucursal es matriz por defecto; si se marca matriz, se desmarca el resto.
    existing = (await db.execute(select(Branch))).scalars().first()
    if existing is None:
        data["is_primary"] = True
    if data.get("is_primary"):
        await _clear_primary(db)
    db_obj = Branch(**data)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def update_branch(db: AsyncSession, db_obj: Branch, obj_in: BranchUpdate):
    data = obj_in.model_dump(exclude_unset=True)
    if data.get("is_primary"):
        await _clear_primary(db, except_id=db_obj.id)
    for field, value in data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def delete_branch(db: AsyncSession, db_obj: Branch) -> bool:
    if db_obj.is_primary:
        raise ValueError("No se puede eliminar la sucursal matriz. Marca otra como matriz primero.")
    from app.modules.inventory.models import Warehouse
    from app.modules.auth.models import User
    for w in (await db.execute(select(Warehouse).where(Warehouse.branch_id == db_obj.id))).scalars().all():
        w.branch_id = None
    for u in (await db.execute(select(User).where(User.branch_id == db_obj.id))).scalars().all():
        u.branch_id = None
    await db.delete(db_obj)
    await db.commit()
    return True

# -- Company Profile --

async def get_company_profile(db: AsyncSession):
    result = await db.execute(select(CompanyProfile))
    return result.scalars().first()

async def create_company_profile(db: AsyncSession, obj_in: CompanyProfileCreate):
    db_obj = CompanyProfile(**obj_in.model_dump())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def update_company_profile(db: AsyncSession, db_obj: CompanyProfile, obj_in: CompanyProfileUpdate):
    update_data = obj_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

# -- System Integrations --

async def get_integrations(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(select(SystemIntegration).offset(skip).limit(limit))
    return result.scalars().all()

async def get_integration(db: AsyncSession, integration_id: str):
    result = await db.execute(select(SystemIntegration).filter(SystemIntegration.id == integration_id))
    return result.scalars().first()

async def create_integration(db: AsyncSession, obj_in: SystemIntegrationCreate):
    db_obj = SystemIntegration(**obj_in.model_dump())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def update_integration(db: AsyncSession, db_obj: SystemIntegration, obj_in: SystemIntegrationUpdate):
    update_data = obj_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_obj, field, value)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def delete_integration(db: AsyncSession, db_obj: SystemIntegration):
    await db.delete(db_obj)
    await db.commit()
    return db_obj

# -- Audit Logs --

async def create_audit_log(db: AsyncSession, *, user_id: int, action: str, module: str, description: str = None, details: dict = None):
    db_obj = AuditLog(user_id=user_id, action=action, module=module, description=description, details=details)
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def get_audit_logs(db: AsyncSession, skip: int = 0, limit: int = 100, module: str = None):
    query = select(AuditLog).order_by(AuditLog.timestamp.desc())
    if module:
        query = query.filter(AuditLog.module == module)
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()
