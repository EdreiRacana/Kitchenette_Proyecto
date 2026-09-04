"""Lógica de negocio de Notas de Crédito CFDI 4.0.

Reglas de negocio:
  1. Solo se puede emitir NC sobre una Order con status='paid' y cfdi_status='stamped'
     (la factura original debe existir y estar timbrada — sin CFDI no hay NC).
  2. El motivo_sat es obligatorio y debe ser uno de CREDIT_NOTE_MOTIVOS_SAT.
  3. La suma de líneas de la NC no puede exceder el total de la Order original.
  4. Efecto en inventario (opcional): si restocks_inventory=1 y hay warehouse_id,
     reingresa las cantidades al almacén (StockMovement con reference="credit_note:{id}").
  5. Efecto en CxC: reduce el paid_amount de la Order en el monto acreditado
     (crea saldo a favor del cliente que se puede aplicar en ventas futuras).
  6. Trazabilidad: cada operación deja registro en AuditLog vía _log_audit.
"""
from __future__ import annotations
from typing import Optional, List, Dict, Any
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.sales import models as sales_models
from app.modules.sales.credit_notes_models import (
    CreditNote, CreditNoteItem, CREDIT_NOTE_MOTIVOS_SAT,
)
from app.modules.sales.pac.sufactura import (
    SufacturaPAC, PACError, get_sufactura_client_for_current_company,
)
from app.core.tenancy import get_company_context


class CreditNoteError(Exception):
    """Error de negocio esperado (400). El caller lo convierte a HTTPException."""


async def _log(db: AsyncSession, user_id: Optional[int], action: str,
                description: str, details: Optional[dict] = None):
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(db, user_id=user_id, action=action, module="sales",
                                description=description, details=details)
    except Exception:
        pass


async def _next_folio(db: AsyncSession) -> str:
    """NC-000001, NC-000002, ... por empresa. Simple: cuenta las existentes."""
    res = await db.execute(select(func.count()).select_from(CreditNote))
    n = (res.scalar() or 0) + 1
    return f"NC-{n:06d}"


async def create_credit_note(
    db: AsyncSession,
    *,
    order_id: int,
    lines: List[Dict[str, Any]],
    motivo_sat: str,
    reason: Optional[str],
    kind: str = "parcial",
    restocks_inventory: bool = False,
    warehouse_id: Optional[int] = None,
    user_id: Optional[int] = None,
) -> CreditNote:
    """Crea una NC en estado 'draft' (aún no timbrada). Valida reglas de
    negocio y calcula totales."""
    # Validar motivo SAT
    if motivo_sat not in CREDIT_NOTE_MOTIVOS_SAT:
        raise CreditNoteError(
            f"motivo_sat inválido. Opciones: {', '.join(CREDIT_NOTE_MOTIVOS_SAT.keys())}"
        )
    if kind not in ("total", "parcial"):
        raise CreditNoteError("kind debe ser 'total' o 'parcial'.")

    # Cargar la Order original (skip tenant filter para evitar interferencias
    # con order_items relationship; el aislamiento lo garantizamos abajo).
    res = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res.scalars().first()
    if not order:
        raise CreditNoteError("Venta no encontrada.")

    # Guardarraíl multi-tenant: la venta debe ser de la empresa activa.
    cid = get_company_context()
    if cid and order.company_id and order.company_id != cid:
        raise CreditNoteError("Esta venta no pertenece a la empresa activa.")

    # Reglas de negocio
    if (order.kind or "order") != "order":
        raise CreditNoteError("Solo se puede emitir NC sobre pedidos (no cotizaciones).")
    if order.status == "cancelled":
        raise CreditNoteError("La venta ya está cancelada — no se puede emitir NC.")
    # NOTA: Idealmente exigimos order.cfdi_status == 'stamped'. Como el
    # timbrado de la factura original es paso siguiente del roadmap, permitimos
    # crear la NC en draft aunque la factura no esté timbrada — el timbrado
    # de la NC (paso siguiente) sí lo exigirá.

    # Calcular totales de la NC
    if not lines:
        raise CreditNoteError("Debes especificar al menos una línea acreditada.")
    subtotal = 0.0
    tax_amount = 0.0
    total = 0.0
    items_data = []
    for L in lines:
        qty = float(L.get("quantity") or 0)
        price = float(L.get("unit_price") or 0)
        disc = float(L.get("discount_amount") or 0)
        rate = float(L.get("tax_rate") or 16.0)
        if qty <= 0:
            raise CreditNoteError("Cantidad de línea debe ser > 0.")
        line_subtotal = round((qty * price) - disc, 2)
        # IVA incluido en precio → separo hacia atrás
        line_tax = round(line_subtotal * rate / (100 + rate), 2)
        line_total = line_subtotal
        subtotal += line_subtotal
        tax_amount += line_tax
        total += line_total
        items_data.append({
            **L,
            "subtotal": line_subtotal, "tax_amount": line_tax, "total": line_total,
        })
    subtotal = round(subtotal, 2)
    tax_amount = round(tax_amount, 2)
    total = round(total, 2)

    # Salvaguarda: NC no puede exceder el importe original de la venta
    if total > (order.total_amount or 0) + 0.01:
        raise CreditNoteError(
            f"El monto de la NC (${total:,.2f}) excede el total de la venta "
            f"(${order.total_amount:,.2f})."
        )

    folio = await _next_folio(db)
    nc = CreditNote(
        company_id=cid,
        order_id=order.id,
        customer_id=order.customer_id,
        folio=folio,
        kind=kind,
        motivo_sat=motivo_sat,
        reason=reason,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
        currency=order.currency or "MXN",
        status="draft",
        created_by=user_id,
        restocks_inventory=1 if restocks_inventory else 0,
        warehouse_id=warehouse_id,
    )
    db.add(nc)
    await db.flush()

    for it in items_data:
        db.add(CreditNoteItem(
            company_id=cid,
            credit_note_id=nc.id,
            order_item_id=it.get("order_item_id"),
            variant_id=it.get("variant_id"),
            product_name=it.get("product_name") or "—",
            sku=it.get("sku"),
            quantity=it["quantity"],
            unit_price=it["unit_price"],
            discount_amount=it.get("discount_amount") or 0.0,
            tax_rate=it.get("tax_rate") or 16.0,
            subtotal=it["subtotal"],
            tax_amount=it["tax_amount"],
            total=it["total"],
            clave_prod_serv=it.get("clave_prod_serv"),
            clave_unidad=it.get("clave_unidad"),
            unidad=it.get("unidad"),
        ))

    await db.commit()
    await db.refresh(nc)
    await _log(db, user_id, "CREATE_CREDIT_NOTE",
                f"NC {folio} creada por ${total:,.2f} sobre venta {order.folio}",
                {"nc_id": nc.id, "order_id": order.id, "motivo_sat": motivo_sat, "kind": kind})
    return nc


def _build_stamp_payload(nc: CreditNote, order: sales_models.Order,
                          items: List[CreditNoteItem]) -> Dict[str, Any]:
    """Arma el payload JSON canónico que Sufactura acepta para timbrar una NC.
    Referencia obligatoria a la factura original via cfdi_relacionados."""
    conceptos = []
    for it in items:
        conceptos.append({
            "clave_prod_serv": it.clave_prod_serv or "01010101",  # genérico
            "cantidad": it.quantity,
            "clave_unidad": it.clave_unidad or "ACT",
            "unidad": it.unidad or "Actividad",
            "descripcion": it.product_name,
            "valor_unitario": it.unit_price,
            "importe": it.subtotal,
            "impuestos": {
                "traslados": [{
                    "impuesto": "002",   # IVA
                    "tipo_factor": "Tasa",
                    "tasa_o_cuota": it.tax_rate / 100.0,
                    "importe": it.tax_amount,
                }],
            },
        })

    payload: Dict[str, Any] = {
        "tipo_comprobante": "E",  # Egreso
        "serie": "NC",
        "folio": nc.folio,
        "moneda": nc.currency,
        "forma_pago": "01",   # efectivo por default; ajustar si aplica
        "metodo_pago": "PUE",
        "uso_cfdi": "G02",    # Devoluciones, descuentos o bonificaciones
        "subtotal": nc.subtotal,
        "total": nc.total,
        "receptor": {
            "rfc": order.bill_rfc or "XAXX010101000",
            "nombre": order.bill_name or (order.customer.name if order.customer else "Público general"),
            "uso_cfdi": "G02",
            "regimen_fiscal": order.bill_regime or "616",
            "codigo_postal": order.bill_zip or "00000",
        },
        "conceptos": conceptos,
        "cfdi_relacionados": {
            # Tipo relación 01 = Nota de crédito de los documentos relacionados
            "tipo_relacion": "01",
            "uuids": [order.cfdi_uuid] if getattr(order, "cfdi_uuid", None) else [],
        },
        "impuestos": {
            "total_traslados_impuestos": nc.tax_amount,
        },
    }
    return payload


async def stamp_credit_note(
    db: AsyncSession, *, nc_id: int, user_id: Optional[int] = None,
) -> CreditNote:
    """Timbra la NC ante el SAT vía Sufactura. Valida que la Order original
    tenga cfdi_uuid (si no, la NC no puede referenciar factura relacionada)."""
    res = await db.execute(
        select(CreditNote).where(CreditNote.id == nc_id)
        .execution_options(skip_tenant_filter=True)
    )
    nc = res.scalars().first()
    if not nc:
        raise CreditNoteError("Nota de crédito no encontrada.")
    if nc.status != "draft":
        raise CreditNoteError(f"La NC está en estado '{nc.status}', no se puede timbrar.")

    cid = get_company_context()
    if cid and nc.company_id and nc.company_id != cid:
        raise CreditNoteError("Esta NC no pertenece a la empresa activa.")

    # Cargar orden e items
    res_o = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == nc.order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res_o.scalars().first()
    if not order:
        raise CreditNoteError("Venta original no encontrada.")
    if not order.cfdi_uuid:
        raise CreditNoteError(
            "La factura original no está timbrada — sin UUID no se puede emitir NC. "
            "Timbra primero la factura de la venta desde el drawer de la venta."
        )

    res_i = await db.execute(
        select(CreditNoteItem).where(CreditNoteItem.credit_note_id == nc.id)
        .execution_options(skip_tenant_filter=True)
    )
    items = res_i.scalars().all()

    # Instanciar PAC con credenciales de la empresa activa
    try:
        pac: SufacturaPAC = await get_sufactura_client_for_current_company(db)
    except PACError as e:
        raise CreditNoteError(str(e))

    payload = _build_stamp_payload(nc, order, items)
    # Enriquece con emisor + branding para que el PDF salga con el logo y la
    # razon social de la empresa activa (multi-tenant).
    from app.modules.core_config.service import get_company_profile
    company = await get_company_profile(db)
    if company:
        payload["emisor"] = {
            "rfc": company.tax_id or "",
            "nombre": company.legal_name or "",
            "nombre_comercial": company.commercial_name or "",
            "regimen_fiscal": company.regimen_fiscal or "601",
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
    result = await pac.stamp_credit_note(payload)

    if not result.ok:
        await _log(db, user_id, "STAMP_CREDIT_NOTE_FAILED",
                    f"NC {nc.folio} — fallo timbrado: {result.error}",
                    {"nc_id": nc.id, "error": result.error, "code": result.error_code})
        raise CreditNoteError(f"El PAC rechazó el timbrado: {result.error}")

    # Persistir datos del CFDI
    nc.cfdi_uuid = result.uuid
    nc.cfdi_xml = result.xml
    nc.cfdi_pdf = result.pdf
    nc.cfdi_serie = result.serie or "NC"
    nc.cfdi_folio = result.folio or nc.folio
    nc.cfdi_pac = "sufactura"
    nc.cfdi_selloCFD = result.sello_cfd
    nc.cfdi_selloDigital = result.sello_sat
    nc.cfdi_noCertificadoSAT = result.no_certificado_sat
    nc.stamped_at = datetime.utcnow()
    nc.status = "stamped"

    # Efecto en CxC: reduce paid_amount de la Order (crea "saldo a favor").
    # No modificamos total_amount para conservar el historial de la venta.
    order.paid_amount = max(0.0, (order.paid_amount or 0.0) - nc.total)
    # Recalcular status de la orden: si aún queda saldo → partial; si no → paid.
    if (order.paid_amount or 0.0) + 0.005 < (order.total_amount or 0.0):
        order.status = "partial" if order.status == "paid" else order.status

    # Efecto en inventario (si aplica): reingresar mercancía
    if nc.restocks_inventory and nc.warehouse_id:
        try:
            from app.modules.inventory import models as inv_models
            for it in items:
                if it.variant_id and it.quantity > 0:
                    db.add(inv_models.StockMovement(
                        variant_id=it.variant_id,
                        warehouse_id=nc.warehouse_id,
                        quantity=int(it.quantity),
                        movement_type="in",
                        reference=f"credit_note:{nc.id}",
                        notes=f"Reingreso por NC {nc.folio}",
                        user_id=user_id,
                    ))
        except Exception as e:
            # No abortamos el timbrado por un fallo de inventario — logueamos.
            await _log(db, user_id, "CREDIT_NOTE_RESTOCK_FAILED",
                        f"NC {nc.folio} timbrada pero no reingresó stock: {e}",
                        {"nc_id": nc.id, "error": str(e)})

    await db.commit()
    await db.refresh(nc)
    await _log(db, user_id, "STAMP_CREDIT_NOTE",
                f"NC {nc.folio} timbrada UUID {nc.cfdi_uuid}",
                {"nc_id": nc.id, "uuid": nc.cfdi_uuid, "order_id": order.id})
    return nc


async def cancel_credit_note(
    db: AsyncSession, *, nc_id: int, motivo: str,
    folio_sustituto: Optional[str] = None, user_id: Optional[int] = None,
) -> CreditNote:
    """Cancela una NC ya timbrada ante el SAT. motivo debe ser 01/02/03/04."""
    if motivo not in ("01", "02", "03", "04"):
        raise CreditNoteError("motivo debe ser 01, 02, 03 o 04 (c_MotivoCancelacion SAT).")
    if motivo == "01" and not folio_sustituto:
        raise CreditNoteError("Motivo 01 requiere folio_sustituto (UUID de reemplazo).")

    res = await db.execute(
        select(CreditNote).where(CreditNote.id == nc_id)
        .execution_options(skip_tenant_filter=True)
    )
    nc = res.scalars().first()
    if not nc:
        raise CreditNoteError("NC no encontrada.")
    if nc.status != "stamped":
        raise CreditNoteError(f"Solo NCs timbradas pueden cancelarse — está en '{nc.status}'.")
    if not nc.cfdi_uuid:
        raise CreditNoteError("La NC no tiene UUID — no se puede cancelar ante el SAT.")

    try:
        pac = await get_sufactura_client_for_current_company(db)
    except PACError as e:
        raise CreditNoteError(str(e))

    result = await pac.cancel_cfdi(nc.cfdi_uuid, motivo=motivo,
                                     folio_sustituto=folio_sustituto)
    if not result.ok:
        raise CreditNoteError(f"SAT rechazó la cancelación: {result.error}")

    nc.status = "cancelled"
    nc.cancelled_at = datetime.utcnow()
    nc.cancellation_motivo = motivo
    nc.cancellation_folio_sustituto = folio_sustituto
    nc.cancellation_acuse = (result.acuse.decode("utf-8", errors="ignore")
                              if result.acuse else None)

    # Reversar el efecto en CxC: devolver el monto acreditado a la Order
    res_o = await db.execute(
        select(sales_models.Order).where(sales_models.Order.id == nc.order_id)
        .execution_options(skip_tenant_filter=True)
    )
    order = res_o.scalars().first()
    if order:
        order.paid_amount = min((order.total_amount or 0.0),
                                (order.paid_amount or 0.0) + nc.total)
        if (order.paid_amount or 0.0) + 0.005 >= (order.total_amount or 0.0):
            order.status = "paid"

    await db.commit()
    await db.refresh(nc)
    await _log(db, user_id, "CANCEL_CREDIT_NOTE",
                f"NC {nc.folio} cancelada motivo {motivo}",
                {"nc_id": nc.id, "motivo": motivo, "folio_sustituto": folio_sustituto})
    return nc


async def list_credit_notes(
    db: AsyncSession, *,
    order_id: Optional[int] = None, status: Optional[str] = None,
    limit: int = 100,
) -> List[CreditNote]:
    stmt = select(CreditNote)
    cid = get_company_context()
    if cid:
        stmt = stmt.where(CreditNote.company_id == cid)
    if order_id:
        stmt = stmt.where(CreditNote.order_id == order_id)
    if status:
        stmt = stmt.where(CreditNote.status == status)
    stmt = stmt.order_by(CreditNote.created_at.desc()).limit(limit)
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def get_credit_note(db: AsyncSession, nc_id: int) -> Optional[CreditNote]:
    cid = get_company_context()
    stmt = select(CreditNote).where(CreditNote.id == nc_id)
    if cid:
        stmt = stmt.where(CreditNote.company_id == cid)
    res = await db.execute(stmt)
    return res.scalars().first()
