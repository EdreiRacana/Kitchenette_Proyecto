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


@router.get("/session/previous")
async def previous_session(
    db: DB, current_user: CurrentUser,
    terminal_id: Optional[int] = Query(
        None,
        description="Si se manda, devuelve el último turno cerrado en ese terminal (útil "
                    "cuando un cajero llega a una caja para revisar qué dejó el turno "
                    "previo). Si se omite, se usa el último turno cerrado del usuario.",
    ),
    scope: str = Query(
        "auto",
        pattern="^(auto|me|terminal|any)$",
        description="auto: si viene terminal_id filtra por terminal, si no por usuario. "
                    "me: fuerza filtro por cajero actual. terminal: fuerza filtro por terminal. "
                    "any: el último turno cerrado global (requiere admin/manager).",
    ),
):
    """Reporte completo del último turno cerrado (arqueo, ventas por método, movimientos)."""
    if scope == "any":
        if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
            raise HTTPException(403, "scope=any requiere rol admin/manager")
        r = await service.get_previous_session(db)
    elif scope == "me":
        r = await service.get_previous_session(db, cashier_id=current_user.id)
    elif scope == "terminal":
        if terminal_id is None:
            raise HTTPException(400, "scope=terminal requiere terminal_id")
        r = await service.get_previous_session(db, terminal_id=terminal_id)
    else:
        r = await service.get_previous_session(
            db,
            cashier_id=None if terminal_id else current_user.id,
            terminal_id=terminal_id,
        )
    if not r:
        raise HTTPException(404, "No hay turnos cerrados anteriores")
    return r


@router.get("/sessions")
async def list_sessions(
    db: DB, current_user: CurrentUser,
    status: Optional[str] = Query(None, description="open | closed | reconciled | all"),
    pending: bool = Query(False, description="Solo turnos cerrados sin conciliar (pendientes)"),
    terminal_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Historial de turnos (arqueos) para el panel de conciliación, con resumen
    de pendientes: total por depositar y saldo acumulado a favor/en contra."""
    return await service.list_sessions(
        db, status=status, pending_only=pending, terminal_id=terminal_id, limit=limit,
    )


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


@router.get("/session/{session_id}/sales")
async def session_sales(session_id: int, db: DB, _: CurrentUser):
    """Historial de ventas de un turno POS (para reimprimir tickets)."""
    return await service.list_session_sales(db, session_id)


# ── Reconciliación post-cierre ────────────────────────────────────────────
def _can_reconcile(session: dict, user: User) -> bool:
    """El propio cajero del turno, admin, manager o superuser pueden reconciliar."""
    if user.is_superuser:
        return True
    if (user.role or "user") in ("admin", "manager"):
        return True
    return session.get("cashier_id") == user.id


@router.get("/bank-accounts")
async def list_bank_accounts_for_pos(db: DB, _: CurrentUser):
    """Cuentas bancarias activas para el select de depósito en el UI."""
    return await service.list_active_bank_accounts(db)


@router.post("/session/{session_id}/reconcile")
async def add_reconciliation(
    session_id: int,
    data: schemas.ReconcileMovementRequest,
    db: DB,
    current_user: CurrentUser,
):
    """Registra depósito bancario, efectivo dejado para el siguiente turno,
    o un ajuste con motivo, sobre un turno YA CERRADO. Se guarda en la
    bitácora del turno y, para depósitos, crea el movimiento bancario."""
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    if not _can_reconcile(s, current_user):
        raise HTTPException(403, "No autorizado para reconciliar este turno")
    try:
        return await service.add_reconciliation_movement(
            db, session_id=session_id,
            type=data.type, amount=data.amount, notes=data.notes,
            bank_account_id=data.bank_account_id,
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/session/{session_id}/notes")
async def update_session_notes(
    session_id: int,
    data: schemas.UpdateSessionNotesRequest,
    db: DB,
    current_user: CurrentUser,
):
    """Editar notas de apertura/cierre de un turno (para corregir errores)."""
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    if not _can_reconcile(s, current_user):
        raise HTTPException(403, "No autorizado")
    r = await service.update_session_notes(
        db, session_id,
        closing_notes=data.closing_notes,
        opening_notes=data.opening_notes,
        user_id=current_user.id,
    )
    return r


@router.post("/session/{session_id}/mark-reconciled")
async def mark_reconciled(session_id: int, db: DB, current_user: CurrentUser):
    """Marca el turno como reconciliado (status = reconciled) una vez que
    todos los movimientos post-cierre están registrados."""
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    if not _can_reconcile(s, current_user):
        raise HTTPException(403, "No autorizado")
    try:
        return await service.mark_session_reconciled(
            db, session_id, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/session/{session_id}/recount")
async def recount_session(
    session_id: int,
    data: schemas.RecountRequest,
    db: DB,
    current_user: CurrentUser,
):
    """Corrige el arqueo tras el cierre — cuando el cajero olvidó contar
    el efectivo, se equivocó al capturar denominaciones o encontró el
    dinero después. Recalcula actual_cash y variance con audit log."""
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    if not _can_reconcile(s, current_user):
        raise HTTPException(403, "No autorizado para corregir este turno")
    try:
        return await service.recount_session_cash(
            db, session_id, denominations=data.denominations,
            notes=data.notes, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/session/{session_id}/unmark-reconciled")
async def unmark_reconciled(session_id: int, db: DB, current_user: CurrentUser):
    """Revierte un turno reconciliado a 'closed' para permitir editar más
    movimientos post-cierre. Deja rastro en el audit log."""
    s = await service.get_session(db, session_id)
    if not s:
        raise HTTPException(404, "Sesión no encontrada")
    if not _can_reconcile(s, current_user):
        raise HTTPException(403, "No autorizado")
    try:
        return await service.unmark_session_reconciled(
            db, session_id, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


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
    sales = await service.list_session_sales(db, session_id)
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    pdf = pdf_ticket.build_session_z_report(
        company, session, report, kind=kind, sales=sales,
    )
    fname = f"reporte_{kind}_turno_{session_id}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})
