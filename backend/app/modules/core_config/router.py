import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.api import deps
from . import service, schemas
from app.modules.auth.models import User
from app.core import security
from app.core.rate_limit import limiter

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

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


# -- Company Logo Upload --
import os
import uuid as _uuid
from fastapi import UploadFile, File
UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "company")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/company/logo")
async def upload_company_logo(
    *, db: AsyncSession = Depends(deps.get_db),
    file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Sube el logo de la empresa. Se usa en headers de PDFs (cotización,
    remisión, factura) y en el sidebar del sistema. Acepta PNG/JPG/SVG."""
    allowed = {"image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(400, f"Formato no soportado: {file.content_type}. Usa PNG, JPG, SVG o WebP.")
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
           "image/svg+xml": ".svg", "image/webp": ".webp"}.get(file.content_type, ".bin")
    filename = f"logo_{_uuid.uuid4().hex[:8]}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, "El logo excede 5MB")
    with open(path, "wb") as f:
        f.write(contents)

    profile = await service.get_company_profile(db)
    if profile:
        profile.logo_url = f"/static/company/{filename}"
        await db.commit()
        await db.refresh(profile)

    await service.create_audit_log(
        db, user_id=current_user.id, action="UPLOAD_COMPANY_LOGO",
        module="config", description=f"Logo actualizado: {filename}",
        details={"filename": filename, "size": len(contents)},
    )
    return {"logo_url": f"/static/company/{filename}", "size": len(contents)}


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


from pydantic import BaseModel  # noqa: E402


class EmailTestRequest(BaseModel):
    to: str | None = None


@router.post("/integrations/email/test")
async def test_email_integration(
    *,
    payload: EmailTestRequest | None = None,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Envía un correo de prueba con la integración EMAIL activa y devuelve el
    resultado real (ok / error legible) para diagnosticar la configuración."""
    from app.core.email import send_test_email
    to = payload.to if payload else None
    ok, error = await send_test_email(db, to=to)
    return {"ok": ok, "error": error, "to": to}

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


# -- Zona de peligro: reset total de datos operativos --

@router.post("/danger/reset-data", response_model=schemas.DataResetResponse)
@limiter.limit("5/hour")
async def reset_operational_data(
    request: Request,
    payload: schemas.DataResetRequest,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Borra todos los datos operativos (usuarios, clientes, ventas, RH,
    inventario, finanzas, contabilidad, ingesta), conservando la config. de
    empresa. Solo el superusuario, y solo con su contraseña + la frase de
    confirmación exacta. Registrado en el log del servidor porque la propia
    tabla de auditoría se vacía como parte del borrado."""
    if payload.confirm != "BORRAR TODO":
        raise HTTPException(status_code=400, detail='Debes escribir exactamente "BORRAR TODO" para confirmar.')
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Contraseña incorrecta.")

    from app.db.session import engine
    from app.db.reset import wipe_operational_data, reseed_after_wipe

    # La sesión de este request (abierta por la dependencia de autenticación,
    # que ya leyó de "users") debe cerrarse antes del TRUNCATE: si sigue
    # "idle in transaction" retiene un lock de lectura sobre esa tabla y el
    # TRUNCATE (que necesita lock exclusivo) se queda esperando para siempre.
    await db.close()

    logger.warning(
        "RESET TOTAL DE DATOS iniciado por %s (user_id=%s)", current_user.email, current_user.id
    )
    try:
        wiped = await wipe_operational_data(engine)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await reseed_after_wipe()
    logger.warning("RESET TOTAL DE DATOS completado: %d tablas vaciadas.", len(wiped))

    return schemas.DataResetResponse(
        wiped_tables=wiped,
        message="Datos borrados. Tu sesión ya no es válida — crea el primer administrador real en /auth/setup.",
    )
