from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.api import deps
from . import service, schemas
from app.modules.auth.models import User

router = APIRouter()

# -- Branches (Sucursales) --
from typing import Annotated  # noqa: E402
ConfigViewer = Annotated[User, Depends(deps.require_permission("config", "view"))]
ConfigManager = Annotated[User, Depends(deps.require_permission("config", "edit"))]


@router.get("/branches", response_model=List[schemas.BranchResponse])
async def read_branches(db: AsyncSession = Depends(deps.get_db),
                        current_user: User = Depends(deps.get_current_active_user)):
    return await service.get_branches(db)


@router.post("/branches", response_model=schemas.BranchResponse, status_code=status.HTTP_201_CREATED)
async def create_branch(branch_in: schemas.BranchCreate, db: AsyncSession = Depends(deps.get_db),
                        current_user: ConfigManager = None):
    return await service.create_branch(db, branch_in)


@router.put("/branches/{branch_id}", response_model=schemas.BranchResponse)
async def update_branch(branch_id: int, branch_in: schemas.BranchUpdate,
                        db: AsyncSession = Depends(deps.get_db), current_user: ConfigManager = None):
    branch = await service.get_branch(db, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    return await service.update_branch(db, branch, branch_in)


@router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: int, db: AsyncSession = Depends(deps.get_db),
                        current_user: ConfigManager = None):
    branch = await service.get_branch(db, branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Sucursal no encontrada")
    try:
        await service.delete_branch(db, branch)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# -- Company Profile Endpoints --

@router.get("/company", response_model=schemas.CompanyProfileResponse)
async def read_company_profile(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user)
):
    profile = await service.get_company_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")
    return profile

@router.post("/company", response_model=schemas.CompanyProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_company_profile(
    *,
    db: AsyncSession = Depends(deps.get_db),
    profile_in: schemas.CompanyProfileCreate,
    current_user: User = Depends(deps.get_current_superuser)
):
    existing = await service.get_company_profile(db)
    if existing:
        raise HTTPException(status_code=400, detail="Company profile already exists. Update it instead.")
    return await service.create_company_profile(db=db, obj_in=profile_in)

@router.put("/company", response_model=schemas.CompanyProfileResponse)
async def update_company_profile(
    *,
    db: AsyncSession = Depends(deps.get_db),
    profile_in: schemas.CompanyProfileUpdate,
    current_user: User = Depends(deps.get_current_superuser)
):
    profile = await service.get_company_profile(db)
    if not profile:
        raise HTTPException(status_code=404, detail="Company profile not found")
    
    # Log the update
    await service.create_audit_log(
        db, 
        user_id=current_user.id, 
        action="UPDATE_COMPANY_PROFILE", 
        module="config",
        description=f"Updated company profile: {profile_in.legal_name}",
        details=profile_in.model_dump()
    )
    
    return await service.update_company_profile(db=db, db_obj=profile, obj_in=profile_in)

# -- System Integrations Endpoints --

@router.get("/integrations", response_model=List[schemas.SystemIntegrationResponse])
async def read_integrations(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser)
):
    return await service.get_integrations(db, skip=skip, limit=limit)

@router.post("/integrations", response_model=schemas.SystemIntegrationResponse, status_code=status.HTTP_201_CREATED)
async def create_integration(
    *,
    db: AsyncSession = Depends(deps.get_db),
    integration_in: schemas.SystemIntegrationCreate,
    current_user: User = Depends(deps.get_current_superuser)
):
    res = await service.create_integration(db=db, obj_in=integration_in)
    await service.create_audit_log(db, user_id=current_user.id, action="CREATE_INTEGRATION", module="config", description=f"Created integration: {integration_in.provider_name}")
    return res

@router.put("/integrations/{integration_id}", response_model=schemas.SystemIntegrationResponse)
async def update_integration(
    *,
    integration_id: str,
    db: AsyncSession = Depends(deps.get_db),
    integration_in: schemas.SystemIntegrationUpdate,
    current_user: User = Depends(deps.get_current_superuser)
):
    integration = await service.get_integration(db, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="System Integration not found")
    
    await service.create_audit_log(db, user_id=current_user.id, action="UPDATE_INTEGRATION", module="config", description=f"Updated integration: {integration.provider_name}")
    return await service.update_integration(db=db, db_obj=integration, obj_in=integration_in)

@router.delete("/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    *,
    integration_id: str,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser)
):
    integration = await service.get_integration(db, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="System Integration not found")
    
    await service.create_audit_log(db, user_id=current_user.id, action="DELETE_INTEGRATION", module="config", description=f"Deleted integration: {integration.provider_name}")
    await service.delete_integration(db=db, db_obj=integration)
    return None

# -- Audit Logs Endpoints --

@router.get("/audit-logs", response_model=List[schemas.AuditLogResponse])
async def read_audit_logs(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser)
):
    return await service.get_audit_logs(db, skip=skip, limit=limit)
