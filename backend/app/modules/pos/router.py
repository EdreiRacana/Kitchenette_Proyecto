"""POS REST API."""
from __future__ import annotations
from typing import Annotated, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.pos import service, schemas

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Terminales ────────────────────────────────────────────────────────────
@router.get("/terminals")
async def list_terminals(db: DB, _: CurrentUser):
    return await service.list_terminals(db)


@router.post("/terminals")
async def create_terminal(data: schemas.POSTerminalCreate, db: DB, current_user: CurrentUser):
    if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
        raise HTTPException(403, "Se requiere rol admin/manager")
    t = await service.create_terminal(db, data, user_id=current_user.id)
    return {"id": t.id, "name": t.name, "code": t.code, "is_active": t.is_active}


@router.patch("/terminals/{terminal_id}")
async def update_terminal(terminal_id: int, data: schemas.POSTerminalUpdate, db: DB, current_user: CurrentUser):
    if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
        raise HTTPException(403, "Se requiere rol admin/manager")
    t = await service.update_terminal(db, terminal_id, data, user_id=current_user.id)
    if not t:
        raise HTTPException(404, "Terminal no encontrado")
    return {"id": t.id, "name": t.name, "is_active": t.is_active}


# ── Sesión / turno ────────────────────────────────────────────────────────
@router.get("/session/current")
async def current_session(db: DB, current_user: CurrentUser):
    """Regresa la sesión abierta del usuario actual, o null si no tiene."""
    s = await service.get_open_session_for_user(db, current_user.id)
    return s or {"session": None}


@router.post("/session/open")
async def open_session(data: schemas.OpenSessionRequest, db: DB, current_user: CurrentUser):
    try:
        result = await service.open_session(
            db, terminal_id=data.terminal_id, cashier_id=current_user.id,
            opening_balance=data.opening_balance, opening_notes=data.opening_notes,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.post("/session/close")
async def close_session(data: schemas.CloseSessionRequest, db: DB, current_user: CurrentUser):
    try:
        result = await service.close_session(
            db, session_id=data.session_id, denominations=data.denominations,
            closing_notes=data.closing_notes, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.get("/session/{session_id}")
async def get_session(session_id: int, db: DB, _: CurrentUser):
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    return s


@router.get("/session/{session_id}/report")
async def session_report(session_id: int, db: DB, _: CurrentUser):
    r = await service.get_session_report(db, session_id)
    if not r:
        raise HTTPException(404, "Sesión no encontrada")
    return r


@router.post("/session/cash-movement")
async def cash_movement(data: schemas.CashMovementRequest, db: DB, current_user: CurrentUser):
    try:
        return await service.add_cash_movement(
            db, session_id=data.session_id, type=data.type, amount=data.amount,
            notes=data.notes, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Venta POS ─────────────────────────────────────────────────────────────
@router.post("/sale")
async def register_sale(data: schemas.POSSaleRequest, db: DB, current_user: CurrentUser):
    try:
        return await service.register_sale(
            db, session_id=data.session_id, customer_id=data.customer_id,
            items=[it.model_dump() for it in data.items], payments=data.payments,
            discount_amount=data.discount_amount, tax_rate=data.tax_rate,
            shipping_amount=data.shipping_amount, notes=data.notes,
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Búsqueda rápida ───────────────────────────────────────────────────────
@router.get("/products/search")
async def search_products(db: DB, _: CurrentUser,
                          q: str = Query(..., min_length=1),
                          limit: int = Query(20, ge=1, le=100)):
    return await service.search_products(db, q, limit)


# ── PDFs: ticket térmico y reporte Z ──────────────────────────────────────
from fastapi.responses import Response
from app.modules.pos import pdf_ticket


@router.get("/sale/{order_id}/ticket.pdf")
async def download_ticket(order_id: int, db: DB, _: CurrentUser,
                          width: int = Query(80, description="58 o 80 mm")):
    if width not in (58, 80):
        raise HTTPException(400, "width debe ser 58 o 80")
    data = await service.prepare_ticket_data(db, order_id)
    if not data:
        raise HTTPException(404, "Venta no encontrada")
    pdf = pdf_ticket.build_thermal_ticket(
        company=data["company"], order=data["order"],
        items=data["items"], payments=data["payments"],
        session=data["session"], width_mm=width,
    )
    fname = f"ticket_{data['order'].get('folio') or order_id}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.get("/session/{session_id}/report.pdf")
async def download_session_report(session_id: int, db: DB, _: CurrentUser,
                                    kind: str = Query("Z", description="Z o X")):
    if kind not in ("Z", "X"):
        raise HTTPException(400, "kind debe ser Z (cierre) o X (corte)")
    session = await service.get_session(db, session_id)
    if not session:
        raise HTTPException(404, "Sesión no encontrada")
    report = await service.get_session_report(db, session_id)
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    pdf = pdf_ticket.build_session_z_report(company, session, report, kind=kind)
    fname = f"reporte_{kind}_turno_{session_id}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
