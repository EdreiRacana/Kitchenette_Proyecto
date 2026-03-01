from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from .models import CompanyProfile, SystemIntegration, AuditLog
from .schemas import CompanyProfileCreate, CompanyProfileUpdate, SystemIntegrationCreate, SystemIntegrationUpdate, AuditLogBase
import uuid

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

async def get_audit_logs(db: AsyncSession, skip: int = 0, limit: int = 100):
    result = await db.execute(select(AuditLog).order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit))
    return result.scalars().all()
