"""Multi-empresa — CRUD de empresas (multi-tenant real) + asignaciones
de usuarios y selector de empresa activa por sesión.

Diseño:
- Cada fila en `company_profile` es una EMPRESA (tenant). Antes era singleton
  pero ahora permitimos múltiples RFC bajo el mismo sistema.
- `user_companies` enlaza usuarios ↔ empresas con rol e is_default.
- La empresa activa por request se envía en el header `X-Company-Id`; si no,
  se usa la default del usuario.
- Solo superuser puede crear/eliminar empresas. Los miembros con rol
  `admin`|`manager` en una empresa pueden invitar/quitar otros usuarios.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User
from app.modules.core_config import models as cfg


router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ─── Schemas ────────────────────────────────────────────────────────────

class CompanyOut(BaseModel):
    id: str
    legal_name: str
    commercial_name: Optional[str] = None
    tax_id: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    # ── Fase multi-marca ─────────────────────────────────────────
    business_model: str = "direct"          # direct | agency
    commission_default_pct: float = 0.0
    commission_base: str = "net"            # gross | subtotal | net
    is_demo: bool = False
    is_active: bool = True
    # Rol del usuario que consulta esta marca (viene del join user_companies)
    role_in_company: Optional[str] = None
    is_default: Optional[bool] = None
    model_config = ConfigDict(from_attributes=True)


class CompanyCreate(BaseModel):
    legal_name: str
    commercial_name: Optional[str] = None
    tax_id: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    brand_color: Optional[str] = "#33B2F5"
    logo_url: Optional[str] = None
    business_model: str = "direct"
    commission_default_pct: float = 0.0
    commission_base: str = "net"
    is_demo: bool = False


class CompanyUpdate(BaseModel):
    legal_name: Optional[str] = None
    commercial_name: Optional[str] = None
    tax_id: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    brand_color: Optional[str] = None
    logo_url: Optional[str] = None
    business_model: Optional[str] = None
    commission_default_pct: Optional[float] = None
    commission_base: Optional[str] = None
    is_demo: Optional[bool] = None
    is_active: Optional[bool] = None


class UserCompanyLinkIn(BaseModel):
    user_id: int
    company_id: str
    role_in_company: str = "member"
    is_default: bool = False


class SwitchCompanyIn(BaseModel):
    company_id: str


# ─── Helpers ────────────────────────────────────────────────────────────

async def _user_company_ids(db: AsyncSession, user: User) -> set[str]:
    """Empresas a las que pertenece el usuario. Superuser ve todas."""
    if getattr(user, "is_superuser", False):
        rows = (await db.execute(select(cfg.CompanyProfile.id))).all()
        return {r[0] for r in rows}
    rows = (await db.execute(
        select(cfg.UserCompany.company_id).where(cfg.UserCompany.user_id == user.id)
    )).all()
    return {r[0] for r in rows}


async def _my_role_in(db: AsyncSession, user_id: int, company_id: str) -> Optional[str]:
    r = (await db.execute(
        select(cfg.UserCompany.role_in_company).where(
            cfg.UserCompany.user_id == user_id,
            cfg.UserCompany.company_id == company_id,
        )
    )).scalars().first()
    return r


# ─── Endpoints ──────────────────────────────────────────────────────────

def _build_logo_url(profile) -> Optional[str]:
    """Si el CompanyProfile tiene logo_bytes en BD, devuelve un data URI
    base64 EMBEBIDO — así el <img src=...> del frontend NO depende de
    ninguna request adicional, ni de auth, ni de cache del navegador,
    ni de query params. Se renderiza instantáneo y siempre.

    Si no hay logo_bytes, devuelve el logo_url guardado (puede ser data
    URI, URL externa o filesystem antiguo)."""
    logo_bytes = getattr(profile, "logo_bytes", None)
    if logo_bytes:
        import base64
        mime = getattr(profile, "logo_mime", None) or "image/png"
        b64 = base64.b64encode(logo_bytes).decode("ascii")
        return f"data:{mime};base64,{b64}"
    return getattr(profile, "logo_url", None)


@router.get("/companies", response_model=List[CompanyOut])
async def list_companies(db: DB, current_user: CurrentUser):
    """Lista todas las empresas visibles para el usuario.
    Superuser ve todas; usuarios normales solo aquellas donde tienen link.
    Enriquece logo_url dinamicamente desde logo_bytes cuando la marca
    tiene su logo persistido en BD.
    """
    if getattr(current_user, "is_superuser", False):
        q = select(cfg.CompanyProfile).order_by(cfg.CompanyProfile.legal_name)
        rows = (await db.execute(q)).scalars().all()
        out = []
        for r in rows:
            d = CompanyOut.model_validate(r)
            d.logo_url = _build_logo_url(r)
            out.append(d)
        return out

    q = (
        select(cfg.CompanyProfile, cfg.UserCompany)
        .join(cfg.UserCompany, cfg.UserCompany.company_id == cfg.CompanyProfile.id)
        .where(cfg.UserCompany.user_id == current_user.id)
        .order_by(cfg.CompanyProfile.legal_name)
    )
    out = []
    for c, uc in (await db.execute(q)).all():
        d = CompanyOut.model_validate(c)
        d.logo_url = _build_logo_url(c)
        d.role_in_company = uc.role_in_company
        d.is_default = uc.is_default
        out.append(d)
    return out


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(
    data: CompanyCreate, db: DB, current_user: CurrentUser,
):
    """Crea una nueva empresa. Solo superuser puede crear."""
    if not getattr(current_user, "is_superuser", False):
        raise HTTPException(403, "Solo el superusuario puede crear empresas")
    if not data.legal_name.strip():
        raise HTTPException(400, "legal_name es obligatorio")

    company = cfg.CompanyProfile(
        id=str(uuid.uuid4()),
        legal_name=data.legal_name.strip(),
        commercial_name=data.commercial_name,
        tax_id=data.tax_id,
        regimen_fiscal=data.regimen_fiscal,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        address=data.address,
        brand_color=data.brand_color or "#33B2F5",
        logo_url=data.logo_url,
        business_model=data.business_model or "direct",
        commission_default_pct=data.commission_default_pct or 0.0,
        commission_base=data.commission_base or "net",
        is_demo=bool(data.is_demo),
        base_currency="MXN",
        timezone="America/Mexico_City",
        is_active=True,
    )
    db.add(company)
    await db.commit()
    await db.refresh(company)

    # El creador queda como admin de esta empresa
    link = cfg.UserCompany(
        user_id=current_user.id, company_id=company.id,
        role_in_company="admin", is_default=False,
    )
    db.add(link)
    await db.commit()

    return CompanyOut.model_validate(company)


@router.put("/companies/{company_id}", response_model=CompanyOut)
async def update_company(
    company_id: str, data: CompanyUpdate, db: DB, current_user: CurrentUser,
):
    """Edita una empresa. Requiere ser admin de ella o superuser."""
    role = await _my_role_in(db, current_user.id, company_id)
    if role not in ("admin",) and not getattr(current_user, "is_superuser", False):
        raise HTTPException(403, "Solo admins de la empresa pueden editar")
    q = select(cfg.CompanyProfile).where(cfg.CompanyProfile.id == company_id)
    c = (await db.execute(q)).scalars().first()
    if not c:
        raise HTTPException(404, "Empresa no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(c, field, value)
    await db.commit()
    await db.refresh(c)
    return CompanyOut.model_validate(c)


@router.delete("/companies/{company_id}")
async def delete_company(company_id: str, db: DB, current_user: CurrentUser):
    """Elimina una empresa. Solo superuser."""
    if not getattr(current_user, "is_superuser", False):
        raise HTTPException(403, "Solo el superusuario puede eliminar empresas")
    q = select(cfg.CompanyProfile).where(cfg.CompanyProfile.id == company_id)
    c = (await db.execute(q)).scalars().first()
    if not c:
        raise HTTPException(404, "Empresa no encontrada")
    # Contar empresas restantes — no permitir dejar el sistema sin empresas
    total = (await db.execute(select(cfg.CompanyProfile))).scalars().all()
    if len(total) <= 1:
        raise HTTPException(400, "No puedes eliminar la única empresa del sistema")
    await db.delete(c)
    await db.commit()
    return {"deleted": True}


# ─── Asignaciones usuario ↔ empresa ─────────────────────────────────────

@router.get("/companies/{company_id}/members")
async def list_members(company_id: str, db: DB, current_user: CurrentUser):
    """Miembros de una empresa. Requiere pertenecer a ella."""
    if not getattr(current_user, "is_superuser", False):
        role = await _my_role_in(db, current_user.id, company_id)
        if role is None:
            raise HTTPException(403, "No perteneces a esta empresa")
    from app.modules.auth.models import User as UserModel
    q = (
        select(UserModel, cfg.UserCompany)
        .join(cfg.UserCompany, cfg.UserCompany.user_id == UserModel.id)
        .where(cfg.UserCompany.company_id == company_id)
    )
    return [{
        "user_id": u.id, "email": u.email, "full_name": u.full_name,
        "role_in_company": uc.role_in_company, "is_default": uc.is_default,
    } for u, uc in (await db.execute(q)).all()]


@router.post("/companies/{company_id}/members", status_code=201)
async def add_member(
    company_id: str, payload: UserCompanyLinkIn, db: DB, current_user: CurrentUser,
):
    """Asigna un usuario a la empresa. Requiere ser admin de la empresa."""
    role = await _my_role_in(db, current_user.id, company_id)
    if role != "admin" and not getattr(current_user, "is_superuser", False):
        raise HTTPException(403, "Solo admins pueden agregar miembros")
    q = select(cfg.UserCompany).where(
        cfg.UserCompany.user_id == payload.user_id,
        cfg.UserCompany.company_id == company_id,
    )
    existing = (await db.execute(q)).scalars().first()
    if existing:
        existing.role_in_company = payload.role_in_company
        existing.is_default = payload.is_default
        await db.commit()
        return {"updated": True}
    link = cfg.UserCompany(
        user_id=payload.user_id, company_id=company_id,
        role_in_company=payload.role_in_company,
        is_default=payload.is_default,
    )
    db.add(link)
    await db.commit()
    return {"created": True}


@router.delete("/companies/{company_id}/members/{user_id}")
async def remove_member(
    company_id: str, user_id: int, db: DB, current_user: CurrentUser,
):
    role = await _my_role_in(db, current_user.id, company_id)
    if role != "admin" and not getattr(current_user, "is_superuser", False):
        raise HTTPException(403, "Solo admins pueden quitar miembros")
    q = select(cfg.UserCompany).where(
        cfg.UserCompany.user_id == user_id,
        cfg.UserCompany.company_id == company_id,
    )
    link = (await db.execute(q)).scalars().first()
    if not link:
        raise HTTPException(404, "El usuario no está en esta empresa")
    await db.delete(link)
    await db.commit()
    return {"removed": True}


# ─── Empresa activa del usuario ─────────────────────────────────────────

@router.get("/me/companies", response_model=List[CompanyOut])
async def my_companies(db: DB, current_user: CurrentUser):
    """Empresas donde tengo acceso, con role e is_default marcados."""
    return await list_companies(db, current_user)


@router.post("/me/switch-company")
async def switch_default_company(
    data: SwitchCompanyIn, db: DB, current_user: CurrentUser,
):
    """Marca `is_default=True` para la empresa elegida (y quita default de las demás)."""
    if getattr(current_user, "is_superuser", False):
        # Superuser sin link explícito: crea/actualiza uno para persistir default
        q = select(cfg.UserCompany).where(
            cfg.UserCompany.user_id == current_user.id,
        )
        rows = (await db.execute(q)).scalars().all()
        for r in rows:
            r.is_default = (r.company_id == data.company_id)
        # Si no tiene link, créalo
        if not any(r.company_id == data.company_id for r in rows):
            db.add(cfg.UserCompany(
                user_id=current_user.id, company_id=data.company_id,
                role_in_company="admin", is_default=True,
            ))
        await db.commit()
        return {"switched_to": data.company_id}

    q = select(cfg.UserCompany).where(cfg.UserCompany.user_id == current_user.id)
    rows = (await db.execute(q)).scalars().all()
    if not any(r.company_id == data.company_id for r in rows):
        raise HTTPException(403, "No perteneces a esa empresa")
    for r in rows:
        r.is_default = (r.company_id == data.company_id)
    await db.commit()
    return {"switched_to": data.company_id}


# ─── Dependencia: empresa activa por request ────────────────────────────

async def get_current_company_id(
    db: DB, current_user: CurrentUser,
    x_company_id: Annotated[Optional[str], Header(alias="X-Company-Id")] = None,
) -> Optional[str]:
    """Resuelve la empresa activa desde header X-Company-Id o, si no viene,
    desde la empresa marcada como default del usuario.

    Retorna None si el usuario no tiene ninguna empresa (compatibilidad
    con el modo single-tenant clásico).
    """
    if x_company_id:
        allowed = await _user_company_ids(db, current_user)
        if x_company_id in allowed:
            return x_company_id
        raise HTTPException(403, "No tienes acceso a esa empresa")
    # Default del usuario
    q = select(cfg.UserCompany).where(
        cfg.UserCompany.user_id == current_user.id,
        cfg.UserCompany.is_default == True,  # noqa: E712
    ).limit(1)
    r = (await db.execute(q)).scalars().first()
    if r:
        return r.company_id
    # Cualquier empresa del usuario (fallback)
    q2 = select(cfg.UserCompany.company_id).where(
        cfg.UserCompany.user_id == current_user.id,
    ).limit(1)
    r2 = (await db.execute(q2)).scalars().first()
    if r2:
        return r2
    # Sin empresas asignadas: si hay UNA sola en el sistema (single-tenant),
    # úsala para no romper.
    all_companies = (await db.execute(select(cfg.CompanyProfile.id))).all()
    if len(all_companies) == 1:
        return all_companies[0][0]
    return None
