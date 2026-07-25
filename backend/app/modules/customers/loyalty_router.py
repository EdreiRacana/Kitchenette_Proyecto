from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api import deps
from app.modules.auth.models import User
from app.modules.customers import loyalty_service, loyalty_schemas
from app.modules.customers.models import Customer

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Configuración del programa ─────────────────────────────────────────────

@router.get("/program", response_model=loyalty_schemas.ProgramConfigOut)
async def get_program(db: DB, current_user: CurrentUser):
    return await loyalty_service.get_program_config(db)


@router.put("/program", response_model=loyalty_schemas.ProgramConfigOut)
async def update_program(data: loyalty_schemas.ProgramConfigUpdate, db: DB, current_user: CurrentUser):
    return await loyalty_service.update_program_config(db, data.model_dump(exclude_none=True))


# ── Tiers ──────────────────────────────────────────────────────────────────

@router.get("/tiers", response_model=List[loyalty_schemas.TierOut])
async def list_tiers(db: DB, current_user: CurrentUser, only_active: bool = False):
    return await loyalty_service.list_tiers(db, only_active=only_active)


@router.post("/tiers", response_model=loyalty_schemas.TierOut, status_code=201)
async def create_tier(data: loyalty_schemas.TierIn, db: DB, current_user: CurrentUser):
    return await loyalty_service.create_tier(db, data.model_dump())


@router.put("/tiers/{tier_id}", response_model=loyalty_schemas.TierOut)
async def update_tier(tier_id: int, data: loyalty_schemas.TierUpdate, db: DB, current_user: CurrentUser):
    t = await loyalty_service.update_tier(db, tier_id, data.model_dump(exclude_none=True))
    if not t:
        raise HTTPException(status_code=404, detail="Tier no encontrado")
    return t


@router.delete("/tiers/{tier_id}", status_code=204)
async def delete_tier(tier_id: int, db: DB, current_user: CurrentUser):
    ok = await loyalty_service.delete_tier(db, tier_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tier no encontrado")


# ── Lookup / historial / recomendaciones (usados por el POS) ───────────────

@router.get("/lookup")
async def lookup(q: str, db: DB, current_user: CurrentUser):
    """Búsqueda unificada: código de tarjeta > tel > email > número cliente > nombre."""
    res = await loyalty_service.lookup_customer(db, q)
    if not res:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return res


@router.get("/customers/{customer_id}/history")
async def history(customer_id: int, db: DB, current_user: CurrentUser, limit: int = 20):
    return await loyalty_service.get_customer_history(db, customer_id, limit=limit)


@router.get("/customers/{customer_id}/recommendations")
async def recommendations(customer_id: int, db: DB, current_user: CurrentUser, limit: int = 5):
    return await loyalty_service.get_customer_recommendations(db, customer_id, limit=limit)


@router.post("/customers/{customer_id}/recompute-tier")
async def recompute(customer_id: int, db: DB, current_user: CurrentUser):
    c = await loyalty_service.recompute_customer_tier(db, customer_id)
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {"ok": True, "tier_id": c.tier_id, "loyalty_code": c.loyalty_code,
            "loyalty_expires_at": c.loyalty_expires_at}


@router.post("/customers/{customer_id}/loyalty-card.pdf")
async def loyalty_card(customer_id: int, db: DB, current_user: CurrentUser):
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    pdf = await loyalty_service.generate_loyalty_card_pdf(db, customer_id, company)
    if pdf is None:
        raise HTTPException(status_code=404, detail="Cliente sin tarjeta emitida")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="tarjeta_{customer_id}.pdf"'})


# ── Registro rápido desde POS ──────────────────────────────────────────────

@router.post("/quick-register", status_code=201)
async def quick_register(data: loyalty_schemas.QuickRegisterPayload, db: DB, current_user: CurrentUser):
    """Crea (o recupera) un cliente desde el modo Registro Cliente del POS.
    Si ya existe uno con el email/tel dados, se reutiliza y se actualizan
    los campos que hayan cambiado. Se registra el consentimiento LFPDPPP."""
    email = (data.email or "").strip().lower() or None
    phone = (data.phone or "").strip() or None

    # ¿Ya existe?
    existing = None
    if email or phone:
        stmt = select(Customer).where(
            (Customer.email == email if email else False) |
            (Customer.phone == phone if phone else False)
        ).limit(1)
        existing = (await db.execute(stmt)).scalars().first()

    now = datetime.now(timezone.utc)
    if existing:
        c = existing
        # Actualizar solo campos que llegan no-vacíos y son distintos
        if data.name: c.name = data.name
        if data.date_of_birth: c.date_of_birth = data.date_of_birth
        if data.sex: c.sex = data.sex
        if data.codigo_postal: c.codigo_postal = data.codigo_postal
        if data.how_heard: c.how_heard = data.how_heard
        if data.rfc: c.rfc = data.rfc.upper()
        if data.accepts_marketing: c.accepts_marketing = True
        if data.privacy_accepted and not c.privacy_accepted_at:
            c.privacy_accepted_at = now
    else:
        c = Customer(
            name=data.name,
            email=email,
            phone=phone,
            date_of_birth=data.date_of_birth,
            sex=data.sex,
            codigo_postal=data.codigo_postal,
            how_heard=data.how_heard,
            rfc=(data.rfc or "").upper() or None,
            accepts_marketing=data.accepts_marketing,
            privacy_accepted_at=now if data.privacy_accepted else None,
            client_type="Contado",
            relationship_type="retail",
        )
        db.add(c)
        await db.flush()
        c.client_number = f"CLI-{c.id:05d}"

    await db.commit()
    await db.refresh(c)
    # Recomputar tier (asigna código y vigencia si el programa está activo)
    await loyalty_service.recompute_customer_tier(db, c.id)
    fresh = await loyalty_service.lookup_customer(db, str(c.id))
    return fresh or loyalty_service._serialize_customer_lite(c, None)


# ── Jobs ───────────────────────────────────────────────────────────────────

@router.post("/jobs/recompute-all-tiers")
async def job_recompute_all(db: DB, current_user: CurrentUser):
    return await loyalty_service.recompute_all_tiers(db)


@router.post("/jobs/birthday-emails")
async def job_birthday(db: DB, current_user: CurrentUser):
    return await loyalty_service.send_birthday_emails(db)


# ── Override manual de tier ────────────────────────────────────────────────

@router.put("/customers/{customer_id}/tier")
async def set_tier(customer_id: int, data: loyalty_schemas.SetTierPayload,
                    db: DB, current_user: CurrentUser):
    try:
        c = await loyalty_service.set_customer_tier(db, customer_id, data.tier_id, manual=data.manual)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not c:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    fresh = await loyalty_service.lookup_customer(db, str(customer_id))
    return fresh or {"ok": True, "tier_id": c.tier_id, "manual_tier": c.manual_tier}


# ── Enviar tarjeta por correo ──────────────────────────────────────────────

@router.post("/customers/{customer_id}/loyalty-card/email")
async def email_card(customer_id: int, data: loyalty_schemas.EmailCardPayload,
                      db: DB, current_user: CurrentUser):
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    result = await loyalty_service.email_loyalty_card(db, customer_id, company, extra_message=data.message)
    if not result.get("ok"):
        reason = result.get("reason", "error")
        detail = {
            "not_found": "Cliente no encontrado",
            "no_email": "El cliente no tiene correo registrado",
            "no_card": "Este cliente aún no tiene tarjeta emitida (verifica que el programa esté activo y que cumpla algún tier)",
            "pdf_error": "No se pudo generar el PDF de la tarjeta",
        }.get(reason, "No se pudo enviar el correo")
        raise HTTPException(status_code=400, detail=detail)
    return result


# ── Campañas y estadísticas ────────────────────────────────────────────────

@router.post("/segments/preview")
async def segment_preview(filters: loyalty_schemas.SegmentFilters, db: DB, current_user: CurrentUser):
    """Devuelve el listado (compacto) que caería en el segmento — sin enviar nada.
    Sirve para que la UI muestre 'X clientes serán contactados' antes de disparar."""
    people = await loyalty_service.query_segment(db, **filters.model_dump())
    return {
        "count": len(people),
        "sample": [
            {"id": c.id, "name": c.name, "email": c.email, "tier_id": c.tier_id}
            for c in people[:20]
        ],
    }


@router.post("/campaigns/send")
async def campaign_send(data: loyalty_schemas.CampaignPayload, db: DB, current_user: CurrentUser):
    try:
        return await loyalty_service.send_campaign(
            db,
            segment_filters=data.segment.model_dump(),
            subject=data.subject,
            body_html=data.body_html,
            discount_code=data.discount_code,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/stats")
async def stats(db: DB, current_user: CurrentUser):
    return await loyalty_service.get_program_stats(db)


# ── Opt-out público (sin auth) ─────────────────────────────────────────────

from fastapi import Query


@router.get("/unsubscribe")
async def unsubscribe(db: DB, token: str = Query(...)):
    """Endpoint sin auth — accesible por link en correo. Verifica el HMAC.
    Nota: se expone bajo /loyalty pero el guard general del módulo bloquea
    escrituras; este es GET así que pasa el guard."""
    c = await loyalty_service.opt_out_customer(db, token)
    if not c:
        raise HTTPException(status_code=400, detail="Token inválido o cliente no encontrado")
    return {"ok": True, "message": f"{c.name}, te hemos dado de baja de nuestras comunicaciones."}
