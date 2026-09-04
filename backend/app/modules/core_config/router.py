import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

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
    # Si el logo está persistido en la DB, expón la URL que sirve desde bytes
    # (sobrevive al deploy de Render). Si sólo hay logo_url apuntando al
    # filesystem efímero, el frontend seguirá viendo un placeholder cuando el
    # archivo ya no exista — el usuario debe re-subir el logo una vez.
    resp = schemas.CompanyProfileResponse.model_validate(profile)
    if getattr(profile, "logo_bytes", None):
        # Embebemos el logo como data URI base64 — el <img> se renderiza
        # instantáneo, sin request adicional, sin problemas de auth ni
        # cache ni cambio de marca.
        import base64
        mime = getattr(profile, "logo_mime", None) or "image/png"
        b64 = base64.b64encode(profile.logo_bytes).decode("ascii")
        resp.logo_url = f"data:{mime};base64,{b64}"
    return resp

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
        # Persistir bytes en DB — el filesystem de Render es efímero y
        # /uploads/ se pierde en cada deploy. Los PDFs leen de aquí.
        profile.logo_bytes = contents
        profile.logo_mime = file.content_type
        await db.commit()
        await db.refresh(profile)

    await service.create_audit_log(
        db, user_id=current_user.id, action="UPLOAD_COMPANY_LOGO",
        module="config", description=f"Logo actualizado: {filename}",
        details={"filename": filename, "size": len(contents)},
    )
    return {"logo_url": f"/static/company/{filename}", "size": len(contents)}


@router.get("/company/logo")
async def get_company_logo(
    db: AsyncSession = Depends(deps.get_db),
    company_id: Optional[str] = None,
):
    """Sirve el logo desde la DB (persistente cross-deploy).
    Usar como <img src='/config/company/logo'> — no requiere auth para que
    también funcione en tickets impresos y correos.

    Multi-marca: acepta ?company_id=xxx para forzar la marca específica
    (el endpoint es público, no tiene header X-Company-Id del switcher).
    Sin ese param, cae al fallback de get_company_profile(db)."""
    from fastapi.responses import Response
    from sqlalchemy import select as _select
    from app.modules.core_config.models import CompanyProfile as _CP
    profile = None
    if company_id:
        r = await db.execute(_select(_CP).where(_CP.id == company_id))
        profile = r.scalars().first()
    if profile is None:
        profile = await service.get_company_profile(db)
    if not profile or not profile.logo_bytes:
        raise HTTPException(404, "Logo no configurado")
    return Response(
        content=profile.logo_bytes,
        media_type=profile.logo_mime or "image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


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
    # Restringido a UUID para que rutas nombradas como
    # /integrations/sufactura o /integrations/shopify no colisionen con
    # este handler generico y NO pasen por schemas.SystemIntegrationUpdate
    # (cuyo enum IntegrationEnvironment solo acepta SANDBOX/PRODUCTION,
    # rechazando "mock").
    integration_id: str = Path(..., pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    db: AsyncSession = Depends(deps.get_db),
    integration_in: schemas.SystemIntegrationUpdate,
    current_user: User = Depends(deps.get_current_superuser)
):
    integration = await service.get_integration(db, integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail="System Integration not found")
    
    await service.create_audit_log(db, user_id=current_user.id, action="UPDATE_INTEGRATION", module="config", description=f"Updated integration: {integration.provider_name}")
    return await service.update_integration(db=db, db_obj=integration, obj_in=integration_in)


from pydantic import BaseModel, Field  # noqa: E402


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
    from app.core.email import _platform_provider, get_active_email_integration, send_test_email
    from email.utils import parseaddr
    import httpx
    to = payload.to if payload else None

    provider, api_key, mail_from = _platform_provider()
    smtp = await get_active_email_integration(db)
    sender_name, sender_email = parseaddr(mail_from) if mail_from else ("", "")

    # Ping a Brevo /v3/account para identificar A QUÉ CUENTA pertenece la API
    # key (solo aplica si provider=brevo).
    brevo_owner_email = None
    brevo_company_name = None
    brevo_account_error = None
    brevo_send_status = None
    brevo_send_body = None
    brevo_message_id = None
    if provider == "brevo" and api_key:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get("https://api.brevo.com/v3/account",
                                     headers={"api-key": api_key, "accept": "application/json"})
            if r.status_code == 200:
                data = r.json()
                brevo_owner_email = data.get("email")
                brevo_company_name = data.get("companyName")
            else:
                brevo_account_error = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as exc:
            brevo_account_error = f"{type(exc).__name__}: {exc}"

    dest = to or brevo_owner_email
    # ENVÍO REAL: pasa por send_test_email para cualquier provider (resend,
    # sendgrid, brevo, o SMTP fallback). Este es el path que usa el ERP en
    # producción; probar por acá garantiza paridad.
    ok, error = await send_test_email(db, to=dest)

    # PROBE ADICIONAL (solo brevo): direct call para capturar body + messageId
    # cuando el status es raro (2xx sin log). No aplica a resend/sendgrid
    # porque su API se comporta de forma más predecible.
    if provider == "brevo" and api_key and dest and sender_email:
        payload_json = {
            "sender": {"name": sender_name or "Sthenova ERP", "email": sender_email},
            "to": [{"email": dest}],
            "subject": "Prueba de correo — Sthenova ERP (probe)",
            "htmlContent": "<p>Probe directo desde /test endpoint.</p>",
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post("https://api.brevo.com/v3/smtp/email",
                                      headers={"api-key": api_key, "accept": "application/json",
                                               "content-type": "application/json"},
                                      json=payload_json)
            brevo_send_status = r.status_code
            brevo_send_body = r.text[:500]
            if r.status_code < 300:
                try:
                    brevo_message_id = r.json().get("messageId")
                except Exception:
                    pass
        except Exception:
            pass

    diag = {
        "route_taken": "http_api" if provider else ("smtp_integration" if smtp else "none"),
        "http_provider": provider,
        "http_api_key_last4": (api_key[-4:] if api_key else None),
        "http_mail_from_raw": mail_from,
        "http_sender_email_parsed": sender_email,
        "http_sender_name_parsed": sender_name,
        "brevo_account_owner": brevo_owner_email,
        "brevo_account_company": brevo_company_name,
        "brevo_account_probe_error": brevo_account_error,
        "brevo_send_status": brevo_send_status,
        "brevo_message_id": brevo_message_id,
        "brevo_send_body": brevo_send_body,
        "smtp_active": bool(smtp),
        "smtp_host": (smtp.meta_data or {}).get("host") if smtp else None,
        "smtp_from": (smtp.meta_data or {}).get("from_email") if smtp else None,
    }
    return {"ok": ok, "error": error, "to": dest, "diagnostic": diag}

class ShopifyConfigRequest(BaseModel):
    shop_domain: str = Field(min_length=3, max_length=255, description="p.ej. mi-tienda.myshopify.com")
    access_token: str = Field(min_length=8, max_length=255)
    is_active: bool = True


def _q_by_type_and_tenant(select_stmt, model, integration_type):
    """Helper: aplica filtro por integration_type + current_company_id.
    Cuando no hay tenant en el contexto (background jobs), no filtra por
    company_id — igual funciona pero solo debe usarse asi en admin tools."""
    from app.core.tenancy import get_company_context
    cid = get_company_context()
    stmt = select_stmt.where(model.integration_type == integration_type)
    if cid:
        stmt = stmt.where(model.company_id == cid)
    return stmt


@router.get("/integrations/shopify")
async def get_shopify_integration(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Devuelve la config actual de Shopify de LA EMPRESA ACTIVA. Cada
    empresa tiene sus propias credenciales — filtro explicito por company_id."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.MARKETPLACE_SHOPIFY)
    )
    intg = res.scalars().first()
    if not intg:
        return {"configured": False}
    meta = intg.meta_data or {}
    token = intg.api_key or ""
    return {
        "configured": True,
        "id": intg.id,
        "is_active": bool(intg.is_active),
        "shop_domain": meta.get("shop_domain", ""),
        "access_token_masked": ("•••••••••" + token[-4:]) if token else "",
    }


@router.put("/integrations/shopify")
async def upsert_shopify_integration(
    payload: ShopifyConfigRequest,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Crea o actualiza la integración Shopify (una por empresa). Guarda el
    access_token en api_key y el shop_domain en meta_data.shop_domain."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    domain = payload.shop_domain.strip().rstrip("/").replace("https://", "").replace("http://", "")
    if not domain.endswith(".myshopify.com") and "." not in domain:
        raise HTTPException(400, "El dominio debe ser tu-tienda.myshopify.com")

    from app.core.tenancy import get_company_context
    cid = get_company_context()
    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.MARKETPLACE_SHOPIFY)
    )
    intg = res.scalars().first()
    if intg:
        intg.api_key = payload.access_token
        intg.meta_data = {**(intg.meta_data or {}), "shop_domain": domain}
        intg.is_active = payload.is_active
    else:
        intg = SystemIntegration(
            name="Shopify",
            integration_type=IntegrationType.MARKETPLACE_SHOPIFY,
            api_key=payload.access_token,
            meta_data={"shop_domain": domain},
            is_active=payload.is_active,
            company_id=cid,
        )
        db.add(intg)
    await db.commit()
    await db.refresh(intg)
    return {"ok": True, "id": intg.id}


@router.post("/integrations/shopify/test")
async def test_shopify_integration(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Ping a Shopify Admin API con las credenciales guardadas — devuelve el
    nombre y plan de la tienda si OK, o el error legible si falla."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    import httpx
    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.MARKETPLACE_SHOPIFY)
    )
    intg = res.scalars().first()
    if not intg or not intg.api_key:
        return {"ok": False, "error": "Shopify no está configurado todavía."}
    domain = (intg.meta_data or {}).get("shop_domain")
    if not domain:
        return {"ok": False, "error": "Falta el dominio de la tienda."}
    url = f"https://{domain}/admin/api/2024-01/shop.json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"X-Shopify-Access-Token": intg.api_key})
        if r.status_code == 200:
            shop = r.json().get("shop", {})
            return {"ok": True, "shop_name": shop.get("name"), "plan": shop.get("plan_display_name"),
                    "email": shop.get("email"), "domain": shop.get("domain")}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


class SufacturaConfigRequest(BaseModel):
    # username/password son opcionales cuando environment == "mock" (pruebas
    # locales que no llaman al PAC). En production/sandbox el endpoint valida
    # que estén presentes y lanza 400 con mensaje legible.
    username: str = Field(default="", max_length=255, description="Usuario Sufactura")
    password: str = Field(default="", max_length=255, description="Contrasena / api key")
    rfc: str = Field(min_length=12, max_length=13)
    environment: str = Field(default="production", description="'sandbox', 'production' o 'mock'")
    is_active: bool = True


@router.get("/integrations/sufactura")
async def get_sufactura_integration(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Estado de la integracion Sufactura (PAC/facturacion CFDI 4.0).
    Devuelve solo campos publicos + password enmascarado."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.INVOICING_SUFACTURA)
    )
    intg = res.scalars().first()
    if not intg:
        return {"configured": False}
    meta = intg.meta_data or {}
    pwd = intg.api_secret or ""
    return {
        "configured": True,
        "id": intg.id,
        "is_active": bool(intg.is_active),
        "username": intg.api_key or "",
        "rfc": meta.get("rfc", ""),
        "environment": meta.get("environment", "production"),
        "password_masked": ("••••••" + pwd[-3:]) if pwd else "",
    }


@router.put("/integrations/sufactura")
async def upsert_sufactura_integration(
    payload: SufacturaConfigRequest,
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Crea o actualiza la integracion Sufactura (una por empresa). Guarda
    el usuario en api_key, la contrasena en api_secret y (rfc, environment)
    en meta_data."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    env = (payload.environment or "production").lower().strip()
    if env not in ("sandbox", "production", "mock"):
        raise HTTPException(400, "environment debe ser 'sandbox', 'production' o 'mock'.")
    # En modo mock aceptamos credenciales vacías (el MockPAC no las usa).
    # En production/sandbox son obligatorias.
    if env != "mock" and (not payload.username.strip() or not payload.password.strip()):
        raise HTTPException(400, "En sandbox/producción se requieren usuario y contraseña de Sufactura.")
    rfc = payload.rfc.upper().strip()

    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.INVOICING_SUFACTURA)
    )
    intg = res.scalars().first()
    if intg:
        intg.api_key = payload.username
        intg.api_secret = payload.password
        intg.meta_data = {**(intg.meta_data or {}), "rfc": rfc, "environment": env}
        intg.is_active = payload.is_active
    else:
        from app.core.tenancy import get_company_context
        cid = get_company_context()
        intg = SystemIntegration(
            name="Sufactura",
            integration_type=IntegrationType.INVOICING_SUFACTURA,
            api_key=payload.username,
            api_secret=payload.password,
            meta_data={"rfc": rfc, "environment": env},
            is_active=payload.is_active,
            company_id=cid,
        )
        db.add(intg)
    await db.commit()
    await db.refresh(intg)
    return {"ok": True, "id": intg.id}


@router.post("/integrations/sufactura/test")
async def test_sufactura_integration(
    db: AsyncSession = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_superuser),
):
    """Prueba la conexion con Sufactura. Hace un ping autenticado a su API
    para validar credenciales — sin timbrar nada, solo GET informativo."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    import httpx
    res = await db.execute(
        _q_by_type_and_tenant(select(SystemIntegration), SystemIntegration, IntegrationType.INVOICING_SUFACTURA)
    )
    intg = res.scalars().first()
    if not intg or not intg.api_key or not intg.api_secret:
        return {"ok": False, "error": "Sufactura no esta configurado todavia."}

    meta = intg.meta_data or {}
    env = (meta.get("environment") or "production").lower()
    rfc = meta.get("rfc", "")

    # Modo MOCK: retorna ok directo sin llamar al PAC (para pruebas locales).
    if env == "mock":
        return {
            "ok": True, "environment": "mock", "rfc": rfc,
            "plan": "Mock/Pruebas",
            "raw": "Modo mock activo — el timbrado usará un PAC simulado local. "
                   "Los CFDIs generados NO son válidos ante el SAT.",
        }

    # Sufactura tiene endpoints separados para sandbox y production.
    # Verifica credenciales pidiendo el saldo de la cuenta (endpoint GET
    # autenticado con Basic Auth username/password + header X-RFC).
    base = "https://sandbox.sufactura.com.mx" if env == "sandbox" else "https://sufactura.com.mx"
    url = f"{base}/api/v1/account/balance"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                url,
                auth=(intg.api_key, intg.api_secret),
                headers={"X-RFC": rfc, "Accept": "application/json"},
            )
        if r.status_code == 200:
            try:
                data = r.json()
            except Exception:
                data = {}
            return {
                "ok": True,
                "environment": env,
                "rfc": rfc,
                "balance": data.get("balance"),
                "plan": data.get("plan") or data.get("plan_name"),
                "raw": r.text[:400],
            }
        if r.status_code in (401, 403):
            return {"ok": False, "error": f"Credenciales invalidas (HTTP {r.status_code})."}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


@router.delete("/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    *,
    integration_id: str = Path(..., pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
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
