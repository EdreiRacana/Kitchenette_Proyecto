"""Endpoints REST para Notas de Crédito CFDI 4.0.

Rutas:
  POST   /sales/credit-notes                  → crear NC en draft
  POST   /sales/credit-notes/{id}/stamp       → timbrar vía Sufactura
  POST   /sales/credit-notes/{id}/cancel      → cancelar ante el SAT
  GET    /sales/credit-notes                  → listar (filtro por order_id, status)
  GET    /sales/credit-notes/{id}             → detalle
  GET    /sales/credit-notes/{id}/pdf         → descarga PDF del PAC
  GET    /sales/credit-notes/{id}/xml         → descarga XML timbrado

Además:
  POST   /sales/orders/{id}/stamp             → timbra la factura ORIGINAL
"""
from __future__ import annotations
from typing import Optional, List, Any, Dict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.sales import models as sales_models
from app.modules.sales import credit_notes_service as svc
from app.modules.sales.credit_notes_models import CREDIT_NOTE_MOTIVOS_SAT
from app.modules.sales.pac.sufactura import (
    get_sufactura_client_for_current_company, PACError,
)


router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────

class CreditNoteLineIn(BaseModel):
    order_item_id: Optional[int] = None
    variant_id: Optional[int] = None
    product_name: str
    sku: Optional[str] = None
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)
    discount_amount: float = 0.0
    tax_rate: float = 16.0
    clave_prod_serv: Optional[str] = None
    clave_unidad: Optional[str] = None
    unidad: Optional[str] = None


class CreditNoteCreate(BaseModel):
    order_id: int
    lines: List[CreditNoteLineIn]
    motivo_sat: str = Field(pattern=r"^0[1-4]$")
    reason: Optional[str] = None
    kind: str = "parcial"
    restocks_inventory: bool = False
    warehouse_id: Optional[int] = None


class CreditNoteCancelRequest(BaseModel):
    motivo: str = Field(pattern=r"^0[1-4]$", description="c_MotivoCancelacion SAT")
    folio_sustituto: Optional[str] = None


class CreditNoteItemOut(BaseModel):
    id: int
    order_item_id: Optional[int]
    product_name: str
    sku: Optional[str]
    quantity: float
    unit_price: float
    subtotal: float
    tax_amount: float
    total: float


class CreditNoteOut(BaseModel):
    id: int
    folio: str
    order_id: int
    kind: str
    motivo_sat: str
    motivo_sat_label: str
    reason: Optional[str]
    subtotal: float
    tax_amount: float
    total: float
    currency: str
    status: str
    cfdi_uuid: Optional[str]
    cfdi_serie: Optional[str]
    cfdi_folio: Optional[str]
    stamped_at: Optional[datetime]
    cancelled_at: Optional[datetime]
    cancellation_motivo: Optional[str]
    created_at: Optional[datetime]
    items: List[CreditNoteItemOut] = []


def _serialize(nc, items=None) -> Dict[str, Any]:
    return {
        "id": nc.id, "folio": nc.folio, "order_id": nc.order_id,
        "kind": nc.kind, "motivo_sat": nc.motivo_sat,
        "motivo_sat_label": CREDIT_NOTE_MOTIVOS_SAT.get(nc.motivo_sat, nc.motivo_sat),
        "reason": nc.reason,
        "subtotal": nc.subtotal, "tax_amount": nc.tax_amount, "total": nc.total,
        "currency": nc.currency, "status": nc.status,
        "cfdi_uuid": nc.cfdi_uuid, "cfdi_serie": nc.cfdi_serie, "cfdi_folio": nc.cfdi_folio,
        "stamped_at": nc.stamped_at, "cancelled_at": nc.cancelled_at,
        "cancellation_motivo": nc.cancellation_motivo,
        "created_at": nc.created_at,
        "items": [
            {"id": it.id, "order_item_id": it.order_item_id,
             "product_name": it.product_name, "sku": it.sku,
             "quantity": it.quantity, "unit_price": it.unit_price,
             "subtotal": it.subtotal, "tax_amount": it.tax_amount, "total": it.total}
            for it in (items or getattr(nc, "items", None) or [])
        ],
    }


DB = Depends(deps.get_db)
CU = Depends(deps.get_current_active_user)


# ── Endpoints NC ─────────────────────────────────────────────────────────

@router.get("/credit-notes/motivos-sat")
async def list_motivos_sat(current_user: User = CU):
    """Códigos de motivo SAT válidos para crear una NC (referencia CFDI 4.0)."""
    return {"motivos": [{"codigo": k, "descripcion": v}
                         for k, v in CREDIT_NOTE_MOTIVOS_SAT.items()]}


@router.post("/credit-notes", response_model=Dict[str, Any])
async def create_credit_note(payload: CreditNoteCreate,
                              db: AsyncSession = DB, current_user: User = CU):
    try:
        nc = await svc.create_credit_note(
            db,
            order_id=payload.order_id,
            lines=[L.model_dump() for L in payload.lines],
            motivo_sat=payload.motivo_sat,
            reason=payload.reason,
            kind=payload.kind,
            restocks_inventory=payload.restocks_inventory,
            warehouse_id=payload.warehouse_id,
            user_id=current_user.id,
        )
    except svc.CreditNoteError as e:
        raise HTTPException(400, str(e))
    return _serialize(nc)


@router.post("/credit-notes/{nc_id}/stamp")
async def stamp_credit_note(nc_id: int, db: AsyncSession = DB, current_user: User = CU):
    try:
        nc = await svc.stamp_credit_note(db, nc_id=nc_id, user_id=current_user.id)
    except svc.CreditNoteError as e:
        raise HTTPException(400, str(e))
    return _serialize(nc)


@router.post("/credit-notes/{nc_id}/cancel")
async def cancel_credit_note(nc_id: int, body: CreditNoteCancelRequest,
                              db: AsyncSession = DB, current_user: User = CU):
    try:
        nc = await svc.cancel_credit_note(
            db, nc_id=nc_id, motivo=body.motivo,
            folio_sustituto=body.folio_sustituto, user_id=current_user.id,
        )
    except svc.CreditNoteError as e:
        raise HTTPException(400, str(e))
    return _serialize(nc)


@router.get("/credit-notes")
async def list_credit_notes(
    order_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = DB, current_user: User = CU,
):
    rows = await svc.list_credit_notes(db, order_id=order_id, status=status, limit=limit)
    return [_serialize(nc) for nc in rows]


@router.get("/credit-notes/{nc_id}")
async def get_credit_note(nc_id: int, db: AsyncSession = DB, current_user: User = CU):
    nc = await svc.get_credit_note(db, nc_id)
    if not nc:
        raise HTTPException(404, "NC no encontrada")
    return _serialize(nc)


@router.get("/credit-notes/{nc_id}/pdf")
async def download_credit_note_pdf(nc_id: int, db: AsyncSession = DB, current_user: User = CU):
    nc = await svc.get_credit_note(db, nc_id)
    if not nc or not nc.cfdi_pdf:
        raise HTTPException(404, "PDF no disponible (aún no timbrada)")
    return Response(content=nc.cfdi_pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{nc.folio}.pdf"'})


@router.get("/credit-notes/{nc_id}/xml")
async def download_credit_note_xml(nc_id: int, db: AsyncSession = DB, current_user: User = CU):
    nc = await svc.get_credit_note(db, nc_id)
    if not nc or not nc.cfdi_xml:
        raise HTTPException(404, "XML no disponible (aún no timbrada)")
    return Response(content=nc.cfdi_xml, media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{nc.folio}.xml"'})


# ── Timbrado de la factura ORIGINAL ─────────────────────────────────────

def _build_invoice_payload(order: sales_models.Order, items) -> Dict[str, Any]:
    """Arma el payload JSON para timbrar la factura original de una venta.
    CFDI 4.0 tipo Ingreso."""
    conceptos = []
    for it in items:
        # Fallbacks — en un ERP maduro estos vienen del catálogo de producto
        clave_ps = getattr(it, "clave_prod_serv", None) or "01010101"
        clave_u = "H87"
        unidad = "Pieza"
        conceptos.append({
            "clave_prod_serv": clave_ps,
            "cantidad": it.quantity,
            "clave_unidad": clave_u,
            "unidad": unidad,
            "descripcion": it.product_name or "Producto",
            "valor_unitario": it.unit_price,
            "importe": round(it.quantity * it.unit_price - (it.discount_amount or 0), 2),
            "impuestos": {
                "traslados": [{
                    "impuesto": "002", "tipo_factor": "Tasa",
                    "tasa_o_cuota": (it.tax_rate or 0) / 100.0,
                    "importe": round((it.subtotal or 0) * (it.tax_rate or 0) / (100 + (it.tax_rate or 0)), 2),
                }],
            },
        })
    return {
        "tipo_comprobante": "I",
        "serie": "F",
        "folio": order.folio or str(order.id),
        "moneda": order.currency or "MXN",
        "forma_pago": "01",
        "metodo_pago": "PUE",
        "uso_cfdi": order.bill_use or "G03",
        "subtotal": order.subtotal or 0,
        "total": order.total_amount or 0,
        "receptor": {
            "rfc": order.bill_rfc or "XAXX010101000",
            "nombre": order.bill_name or (order.customer.name if order.customer else "Público general"),
            "uso_cfdi": order.bill_use or "G03",
            "regimen_fiscal": order.bill_regime or "616",
            "codigo_postal": order.bill_zip or "00000",
        },
        "conceptos": conceptos,
        "impuestos": {"total_traslados_impuestos": order.tax_amount or 0},
    }


@router.post("/orders/{order_id}/stamp")
async def stamp_order_invoice(order_id: int, db: AsyncSession = DB, current_user: User = CU):
    """Timbra la factura original de una venta vía Sufactura. Guarda el
    UUID, XML y PDF en la Order — habilita después la emisión de NCs."""
    res = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res.scalars().first()
    if not order:
        raise HTTPException(404, "Venta no encontrada")
    if (order.kind or "order") != "order":
        raise HTTPException(400, "Solo pedidos pueden timbrarse (no cotizaciones)")
    if order.cfdi_uuid:
        raise HTTPException(400, f"Esta venta ya está timbrada (UUID {order.cfdi_uuid}).")
    if order.status == "cancelled":
        raise HTTPException(400, "No se puede timbrar una venta cancelada.")
    if not (order.bill_rfc or "").strip():
        raise HTTPException(400, "Agrega el RFC del cliente (datos de facturación) antes de timbrar.")

    res_i = await db.execute(
        select(sales_models.OrderItem).where(sales_models.OrderItem.order_id == order.id)
        .execution_options(skip_tenant_filter=True)
    )
    items = res_i.scalars().all()
    if not items:
        raise HTTPException(400, "La venta no tiene líneas — no hay nada que timbrar.")

    try:
        pac = await get_sufactura_client_for_current_company(db)
    except PACError as e:
        raise HTTPException(400, str(e))

    payload = _build_invoice_payload(order, items)
    # Enriquecer con emisor (para el PDF que genera el PAC/mock).
    from app.modules.core_config.service import get_company_profile
    company = await get_company_profile(db)
    if company:
        payload["emisor"] = {
            "rfc": company.tax_id or "",
            "nombre": company.legal_name or "",
            "nombre_comercial": company.commercial_name or "",
            "regimen_fiscal": company.regimen_fiscal or "601",
            "codigo_postal": "",
            "domicilio": company.address or "",
            "telefono": company.contact_phone or "",
            "email": company.contact_email or "",
        }
        payload["_branding"] = {
            "logo_bytes": bytes(company.logo_bytes) if company.logo_bytes else None,
            "logo_mime": company.logo_mime or "image/png",
            "brand_color": company.brand_color or "#33B2F5",
            "footer": company.document_footer or "",
        }
    result = await pac.stamp(payload)
    if not result.ok:
        raise HTTPException(400, f"El PAC rechazó el timbrado: {result.error}")

    order.cfdi_uuid = result.uuid
    order.cfdi_status = "stamped"
    order.cfdi_serie = result.serie or getattr(order, "cfdi_serie", None)
    order.cfdi_folio = result.folio or (str(order.id) if not getattr(order, "cfdi_folio", None) else order.cfdi_folio)
    if result.xml:
        order.cfdi_xml = result.xml
    if result.pdf:
        order.cfdi_pdf = result.pdf
    from datetime import datetime as _dt
    order.invoiced_at = _dt.utcnow()
    await db.commit()

    from app.modules.core_config.service import create_audit_log
    try:
        await create_audit_log(db, user_id=current_user.id, action="STAMP_INVOICE",
                                module="sales",
                                description=f"Factura {order.folio} timbrada UUID {result.uuid}",
                                details={"order_id": order.id, "uuid": result.uuid})
    except Exception:
        pass

    return {
        "ok": True, "order_id": order.id, "uuid": result.uuid,
        "serie": result.serie, "folio": result.folio, "stamped_at": result.stamped_at,
    }


@router.get("/orders/{order_id}/cfdi/pdf")
async def download_order_cfdi_pdf(order_id: int, db: AsyncSession = DB, current_user: User = CU):
    """Descarga el PDF de la factura CFDI 4.0 timbrada para esta venta."""
    res = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res.scalars().first()
    if not order:
        raise HTTPException(404, "Venta no encontrada")
    if not order.cfdi_uuid:
        raise HTTPException(400, "Esta venta no está timbrada todavía.")
    pdf = getattr(order, "cfdi_pdf", None)
    if not pdf:
        raise HTTPException(404, "No hay PDF guardado para esta factura. "
                                  "Vuelve a timbrar si el PAC lo permite, o descárgalo del portal del PAC.")
    fname = f"CFDI_{order.cfdi_serie or 'F'}-{order.cfdi_folio or order.id}_{(order.cfdi_uuid or '')[:8]}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                     headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/orders/{order_id}/cfdi/xml")
async def download_order_cfdi_xml(order_id: int, db: AsyncSession = DB, current_user: User = CU):
    """Descarga el XML timbrado (CFDI 4.0) para esta venta."""
    res = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res.scalars().first()
    if not order:
        raise HTTPException(404, "Venta no encontrada")
    if not order.cfdi_uuid:
        raise HTTPException(400, "Esta venta no está timbrada todavía.")
    xml = getattr(order, "cfdi_xml", None)
    if not xml:
        raise HTTPException(404, "No hay XML guardado para esta factura.")
    fname = f"CFDI_{order.cfdi_serie or 'F'}-{order.cfdi_folio or order.id}_{(order.cfdi_uuid or '')[:8]}.xml"
    return Response(content=xml, media_type="application/xml",
                     headers={"Content-Disposition": f'attachment; filename="{fname}"'})
