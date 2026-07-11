"""Servicios del ERP Universal.

Contiene:
  - generate_document_pdf(): genera cotización/remisión/pre-factura como bytes PDF
  - import_marketplace_report(): procesa XLSX de reporte y crea órdenes/devoluciones
  - compute_customer_pnl(): estado de resultados por cliente con desglose completo
  - process_return_from_marketplace(): registra devolución + mueve inventario
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Dict
import json
import os

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.modules.sales import models, pdf_docs
from app.modules.customers import models as cust_models
from app.modules.core_config import models as cfg_models
from app.modules.sales.report_importers import (
    get_parser, NormalizedRow, ImportResult, PARSERS,
)


# ── PDF Documents ────────────────────────────────────────────────────────
async def _get_company_dict(db: AsyncSession) -> dict:
    res = await db.execute(select(cfg_models.CompanyProfile).limit(1))
    cp = res.scalars().first()
    if not cp:
        return {"legal_name": "Mi Empresa", "commercial_name": "Mi Empresa"}
    logo_path = None
    if cp.logo_url:
        # logo_url típicamente es "/static/uploads/logo.png"; resolvemos ruta local
        rel = cp.logo_url.lstrip("/")
        if rel.startswith("static/"):
            rel = rel[len("static/"):]
        candidate = os.path.join(os.getcwd(), "uploads", rel)
        if os.path.exists(candidate):
            logo_path = candidate
    return {
        "legal_name": cp.legal_name,
        "commercial_name": cp.commercial_name or cp.legal_name,
        "tax_id": cp.tax_id,
        "contact_email": cp.contact_email,
        "contact_phone": cp.contact_phone,
        "address": cp.address,
        "logo_path": logo_path,
        "brand_color": cp.brand_color or "#33B2F5",
        "document_footer": cp.document_footer,
    }


async def _get_order_dict(db: AsyncSession, order_id: int) -> Optional[dict]:
    res = await db.execute(
        select(models.Order).where(models.Order.id == order_id)
    )
    o = res.scalars().first()
    if not o:
        return None
    res_items = await db.execute(
        select(models.OrderItem).where(models.OrderItem.order_id == order_id)
    )
    items = [{
        "product_name": it.product_name, "sku": it.sku,
        "quantity": it.quantity, "unit_price": it.unit_price,
        "discount_amount": it.discount_amount, "total": it.total,
        "is_service": it.is_service,
    } for it in res_items.scalars().all()]
    cust = None
    if o.customer_id:
        res_c = await db.execute(select(cust_models.Customer).where(cust_models.Customer.id == o.customer_id))
        c = res_c.scalars().first()
        if c:
            addr_parts = [c.calle, c.no_exterior, c.colonia, c.municipio, c.estado, c.codigo_postal]
            addr = ", ".join([str(p) for p in addr_parts if p])
            cust = {
                "name": c.razon_social or c.name,
                "rfc": c.rfc,
                "email": c.email,
                "phone": c.phone,
                "address": addr or c.address,
                "client_number": c.client_number,
            }
    return {
        "id": o.id, "folio": o.folio, "kind": o.kind,
        "subtotal": o.subtotal, "discount_amount": o.discount_amount,
        "tax_rate": o.tax_rate, "tax_amount": o.tax_amount,
        "shipping_amount": o.shipping_amount, "total_amount": o.total_amount,
        "notes": o.notes, "valid_until": o.valid_until.isoformat() if o.valid_until else None,
        "items": items,
        "customer": cust or {"name": "Sin cliente"},
    }


async def generate_document_pdf(db: AsyncSession, order_id: int, kind: str = "quote") -> Optional[bytes]:
    """Genera bytes PDF del documento. kind ∈ {'quote', 'remission', 'proforma'}."""
    if kind not in ("quote", "remission", "proforma"):
        raise ValueError("kind debe ser quote, remission o proforma")
    order = await _get_order_dict(db, order_id)
    if not order:
        return None
    company = await _get_company_dict(db)
    return pdf_docs.build_document(
        kind=kind,
        company=company,
        customer=order["customer"],
        order=order,
        items=order["items"],
        valid_until=order.get("valid_until"),
    )


# ── Importador de reportes marketplace ────────────────────────────────────
async def _next_folio(db: AsyncSession) -> str:
    res = await db.execute(select(func.count()).select_from(models.Order))
    count = res.scalar() or 0
    return f"VTA-{count + 1:05d}"


async def import_marketplace_report(
    db: AsyncSession, customer_id: int, platform: str,
    file_bytes: bytes, filename: str,
    mapping: Optional[Dict[str, str]] = None,
    user_id: Optional[int] = None,
) -> dict:
    """Parsea el XLSX y crea/actualiza órdenes + devoluciones automáticamente.
    Regresa el resumen del import y persiste un SalesReportImport para auditoría.
    """
    parser = get_parser(platform, mapping)
    parsed_rows: List[NormalizedRow] = parser.parse(file_bytes)

    result = ImportResult(rows_read=len(parsed_rows))
    errors = []

    # Verificar que cliente existe
    res = await db.execute(select(cust_models.Customer).where(cust_models.Customer.id == customer_id))
    customer = res.scalars().first()
    if not customer:
        return {"error": "Cliente no encontrado", "customer_id": customer_id}

    for row in parsed_rows:
        try:
            if not row.external_order_id or row.external_order_id == "ERROR":
                if "error" in row.raw_row:
                    errors.append(row.raw_row)
                else:
                    errors.append({"reason": "sin_id_pedido", "row": row.raw_row})
                continue

            # Buscar orden existente por external_order_id
            res_o = await db.execute(
                select(models.Order).where(
                    models.Order.external_order_id == row.external_order_id,
                    models.Order.customer_id == customer_id,
                )
            )
            existing = res_o.scalars().first()

            if existing:
                # Actualizar solo si hay cambios de devolución
                if row.return_partial or row.return_total:
                    await _register_return(db, existing, row, customer)
                    result.returns_created += 1
                result.orders_updated += 1
            else:
                # Crear orden nueva. El canal proviene de la fila (marketplace o
                # chain_sellthrough) para que el reporte separe ingresos por modelo.
                order_channel = row.channel or "marketplace"
                order_note_prefix = "Sell-through" if order_channel == "chain_sellthrough" else "Reporte"
                new_order = models.Order(
                    folio=await _next_folio(db),
                    kind="order",
                    customer_id=customer_id,
                    status="paid",  # marketplace/cadena paga directo, se marca como pagada
                    channel=order_channel,
                    relationship_type=customer.relationship_type or ("chain_physical" if order_channel == "chain_sellthrough" else "marketplace"),
                    external_order_id=row.external_order_id,
                    subtotal=row.subtotal,
                    discount_amount=0.0,
                    tax_rate=16.0,
                    tax_amount=round(row.subtotal * 0.16 / 1.16, 2),
                    shipping_amount=0.0,
                    total_amount=row.subtotal,
                    paid_amount=row.net_to_seller,
                    notes=(
                        f"{order_note_prefix} {platform.title()} · "
                        f"Comisión: ${row.commission_amount:,.2f}"
                        + (f" · {row.delivery_status}" if row.delivery_status else "")
                    ),
                    created_at=row.created_at or datetime.now(),
                )
                db.add(new_order)
                await db.flush()

                # Item
                db.add(models.OrderItem(
                    order_id=new_order.id,
                    product_name=row.product_name or f"SKU {row.sku}",
                    sku=row.sku,
                    quantity=row.quantity,
                    unit_price=row.unit_price,
                    discount_amount=0.0,
                    tax_rate=16.0,
                    subtotal=row.subtotal,
                    total=row.subtotal,
                    is_service=False,
                    unit_cost=0.0,
                ))
                result.orders_created += 1

                # Si el mismo registro incluye devolución, procesarla
                if row.return_partial or row.return_total:
                    await _register_return(db, new_order, row, customer)
                    result.returns_created += 1
        except Exception as e:
            errors.append({"reason": str(e), "external_order_id": row.external_order_id})

    result.errors = errors

    # Guardar registro auditable
    imp = cust_models.SalesReportImport(
        customer_id=customer_id, platform=platform, file_name=filename,
        rows_read=result.rows_read, orders_created=result.orders_created,
        orders_updated=result.orders_updated, returns_created=result.returns_created,
        errors_count=len(errors),
        errors_detail=json.dumps(errors[:50]) if errors else None,
        uploaded_by_id=user_id,
    )
    db.add(imp)
    await db.commit()

    return {
        "import_id": imp.id,
        "rows_read": result.rows_read,
        "orders_created": result.orders_created,
        "orders_updated": result.orders_updated,
        "returns_created": result.returns_created,
        "errors_count": len(errors),
        "errors_sample": errors[:10],
    }


async def _register_return(db: AsyncSession, order: models.Order,
                            row: NormalizedRow, customer: cust_models.Customer):
    """Registra CustomerReturn y sus items a partir de la devolución reportada.
    La condición de la mercancía (sellable/damaged) se determina al recibirla
    físicamente en el almacén — por defecto se marca como 'unknown' y se
    espera revisión."""
    res_ret = await db.execute(
        select(models.CustomerReturn).where(
            models.CustomerReturn.order_id == order.id,
        )
    )
    if res_ret.scalars().first():
        return  # ya existe la devolución

    qty = row.returned_qty or (row.quantity if row.return_total else 1)
    ret = models.CustomerReturn(
        folio=f"DEV-{order.folio}" if order.folio else None,
        order_id=order.id,
        customer_id=customer.id,
        status="pending_reception",   # esperando llegada física al almacén
        reason="marketplace_return",
        settlement_type="refund",
        refund_amount=round(row.unit_price * qty, 2),
        notes=f"Devolución reportada desde marketplace ({row.channel}). "
              f"Esperando recepción física para determinar condición.",
    )
    db.add(ret)
    await db.flush()
    db.add(models.CustomerReturnItem(
        return_id=ret.id,
        product_name=row.product_name,
        sku=row.sku,
        quantity=qty,
        unit_price=row.unit_price,
        condition="unknown",   # se define al recibir en almacén
        subtotal=round(row.unit_price * qty, 2),
    ))


# ── P&L por cliente ──────────────────────────────────────────────────────
async def compute_customer_pnl(
    db: AsyncSession, customer_id: int,
    start: Optional[datetime] = None, end: Optional[datetime] = None,
) -> dict:
    """Estado de resultados del cliente con desglose completo.

    Fórmula (marketplace / cadena):
        Venta bruta (subtotal de órdenes)
        - Comisión de plataforma
        - Gastos logísticos
        - CEDIS (solo chain_physical)
        - Cuota portal
        - Descuentos comerciales
        - Devoluciones
        = Ingreso bruto
        - Retenciones ISR
        - Retenciones IVA
        = Ingreso neto (después de retención)
        - COGS (costo del producto vendido, snapshot en OrderItem.unit_cost)
        = Margen bruto
        Margen % = Margen bruto / Venta bruta
    """
    res = await db.execute(select(cust_models.Customer).where(cust_models.Customer.id == customer_id))
    customer = res.scalars().first()
    if not customer:
        return {"error": "Cliente no encontrado"}

    conds = [models.Order.customer_id == customer_id, models.Order.kind == "order",
             models.Order.status != "cancelled"]
    if start:
        conds.append(models.Order.created_at >= start)
    if end:
        conds.append(models.Order.created_at < end)

    # Ventas brutas
    res_o = await db.execute(select(models.Order).where(*conds))
    orders = res_o.scalars().all()
    venta_bruta = sum(o.subtotal or 0.0 for o in orders)

    # COGS (unit_cost × qty por partida)
    order_ids = [o.id for o in orders]
    if order_ids:
        res_items = await db.execute(
            select(models.OrderItem).where(models.OrderItem.order_id.in_(order_ids))
        )
        items = res_items.scalars().all()
        cogs = sum((it.unit_cost or 0.0) * (it.quantity or 0) for it in items)
    else:
        items = []
        cogs = 0.0

    # Devoluciones
    if order_ids:
        res_ret = await db.execute(
            select(models.CustomerReturn).where(models.CustomerReturn.order_id.in_(order_ids))
        )
        devoluciones = sum(r.refund_amount or 0.0 for r in res_ret.scalars().all())
    else:
        devoluciones = 0.0

    # Aplicar comisiones y gastos según config del cliente
    comm_pct = (customer.commission_base_pct or 0.0) / 100.0
    log_pct = (customer.logistics_pct or 0.0) / 100.0
    log_fixed = customer.logistics_fixed or 0.0
    cedis_pct = (customer.cedis_pct or 0.0) / 100.0 if customer.relationship_type == "chain_physical" else 0.0
    portal_pct = (customer.portal_pct or 0.0) / 100.0
    disc_pct = (customer.commercial_discount_pct or 0.0) / 100.0

    comisiones = round(venta_bruta * comm_pct, 2)
    logisticos = round(venta_bruta * log_pct + log_fixed * len(orders), 2)
    cedis = round(venta_bruta * cedis_pct, 2)
    portal = round(venta_bruta * portal_pct, 2)
    descuentos = round(venta_bruta * disc_pct, 2)

    ingreso_bruto = venta_bruta - comisiones - logisticos - cedis - portal - descuentos - devoluciones

    # Retenciones fiscales
    from app.modules.customers.models import WITHHOLDING_SCHEMES
    scheme_key = customer.withholding_scheme or "none"
    scheme = WITHHOLDING_SCHEMES.get(scheme_key, WITHHOLDING_SCHEMES["none"])
    if scheme_key == "custom":
        isr_pct = (customer.withholding_isr_pct or 0.0) / 100.0
        iva_pct = (customer.withholding_iva_pct or 0.0) / 100.0
    else:
        isr_pct = scheme["isr_pct"] / 100.0
        iva_pct = scheme["iva_pct"] / 100.0

    ret_isr = round(ingreso_bruto * isr_pct, 2)
    ret_iva = round(ingreso_bruto * iva_pct, 2)
    ingreso_neto = ingreso_bruto - ret_isr - ret_iva

    margen_bruto = ingreso_neto - cogs
    margen_pct = (margen_bruto / venta_bruta * 100.0) if venta_bruta > 0 else 0.0

    return {
        "customer_id": customer_id,
        "customer_name": customer.razon_social or customer.name,
        "relationship_type": customer.relationship_type,
        "period_start": start.isoformat() if start else None,
        "period_end": end.isoformat() if end else None,
        "orders_count": len(orders),
        "breakdown": {
            "venta_bruta":   round(venta_bruta, 2),
            "comisiones":    -comisiones,
            "logisticos":    -logisticos,
            "cedis":         -cedis,
            "portal":        -portal,
            "descuentos":    -descuentos,
            "devoluciones":  -round(devoluciones, 2),
            "ingreso_bruto": round(ingreso_bruto, 2),
            "ret_isr":       -ret_isr,
            "ret_iva":       -ret_iva,
            "ingreso_neto":  round(ingreso_neto, 2),
            "cogs":          -round(cogs, 2),
            "margen_bruto":  round(margen_bruto, 2),
            "margen_pct":    round(margen_pct, 2),
        },
        "config_applied": {
            "commission_base_pct": customer.commission_base_pct or 0.0,
            "logistics_pct": customer.logistics_pct or 0.0,
            "cedis_pct": customer.cedis_pct or 0.0,
            "portal_pct": customer.portal_pct or 0.0,
            "commercial_discount_pct": customer.commercial_discount_pct or 0.0,
            "withholding_scheme": scheme_key,
            "withholding_scheme_label": scheme["label"],
            "isr_pct_applied": scheme["isr_pct"] if scheme_key != "custom" else customer.withholding_isr_pct,
            "iva_pct_applied": scheme["iva_pct"] if scheme_key != "custom" else customer.withholding_iva_pct,
        },
    }


# ── Recepción de devolución en almacén ────────────────────────────────────
async def receive_return(
    db: AsyncSession, return_id: int, warehouse_id: int,
    items_condition: Dict[int, str],  # {item_id: 'sellable'|'damaged'}
    notes: Optional[str] = None,
    user_id: Optional[int] = None,
) -> Optional[dict]:
    """Marca la devolución como recibida en almacén. Para cada item se determina
    condition. Si es 'sellable', se puede reingresar a inventario (el flujo de
    stock lo maneja el módulo inventario separadamente)."""
    res = await db.execute(select(models.CustomerReturn).where(models.CustomerReturn.id == return_id))
    ret = res.scalars().first()
    if not ret:
        return None
    ret.warehouse_id = warehouse_id
    ret.status = "received"
    ret.completed_at = datetime.now()
    if notes:
        ret.notes = (ret.notes or "") + f"\n[Recepción] {notes}"

    res_items = await db.execute(select(models.CustomerReturnItem).where(
        models.CustomerReturnItem.return_id == return_id
    ))
    items = res_items.scalars().all()
    for it in items:
        if it.id in items_condition:
            it.condition = items_condition[it.id]

    await db.commit()
    return {
        "return_id": ret.id,
        "status": ret.status,
        "warehouse_id": warehouse_id,
        "items": [{"id": it.id, "sku": it.sku, "quantity": it.quantity,
                   "condition": it.condition} for it in items],
    }
