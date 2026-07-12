"""Generador de PDFs para Ventas.

Documentos soportados:
  - Cotización (kind=quote)
  - Remisión (nota de embarque, sin CFDI timbrado)
  - Pro-forma de factura (para preview antes de timbrar)

Todos leen el CompanyProfile para inyectar logo, nombre comercial y colores.
Sin dependencias externas de red: usa reportlab (ya está en HR recibos).
"""
from __future__ import annotations
from io import BytesIO
from typing import Optional
from datetime import datetime

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak,
)


def _mxn(n: float) -> str:
    return "$" + f"{n:,.2f}"


def _accent(brand_color: Optional[str]) -> colors.Color:
    try:
        return colors.HexColor(brand_color or "#33B2F5")
    except Exception:
        return colors.HexColor("#33B2F5")


def _company_header(company: dict, doc_title: str, doc_folio: str, brand: colors.Color) -> Table:
    """Header con logo + datos empresa + folio grande a la derecha."""
    from io import BytesIO as _BytesIO
    import os as _os
    logo_cell = ""
    # Preferir bytes en DB (persistente) sobre archivo local (efímero en Render)
    logo_src = None
    mime = (company.get("logo_mime") or "").lower()
    if "svg" not in mime:
        b = company.get("logo_bytes")
        if b:
            logo_src = _BytesIO(b)
        elif company.get("logo_path") and _os.path.exists(company["logo_path"]) and not company["logo_path"].lower().endswith(".svg"):
            logo_src = company["logo_path"]
    if logo_src is not None:
        try:
            logo_cell = Image(logo_src, width=42 * mm, height=18 * mm, kind="proportional")
        except Exception as _e:
            print(f"[pdf_docs] logo render error: {_e}")
            logo_cell = ""

    empresa_lines = []
    if company.get("commercial_name"):
        empresa_lines.append(f"<b>{company['commercial_name']}</b>")
    if company.get("legal_name") and company.get("legal_name") != company.get("commercial_name"):
        empresa_lines.append(company["legal_name"])
    if company.get("tax_id"):
        empresa_lines.append(f"RFC: {company['tax_id']}")
    if company.get("address"):
        empresa_lines.append(company["address"])
    if company.get("contact_email"):
        empresa_lines.append(company["contact_email"])
    if company.get("contact_phone"):
        empresa_lines.append(company["contact_phone"])

    styles = getSampleStyleSheet()
    p_empresa = Paragraph("<br/>".join(empresa_lines) or " ", ParagraphStyle(
        "empresa", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#333333")
    ))
    p_titulo = Paragraph(f"<font size='14'><b>{doc_title}</b></font>", ParagraphStyle(
        "titulo", parent=styles["Normal"], alignment=TA_RIGHT, textColor=brand
    ))
    p_folio = Paragraph(f"<font size='11'><b>{doc_folio}</b></font>", ParagraphStyle(
        "folio", parent=styles["Normal"], alignment=TA_RIGHT, textColor=colors.HexColor("#111111")
    ))
    header = Table(
        [[logo_cell, p_empresa, [p_titulo, p_folio]]],
        colWidths=[45 * mm, 100 * mm, 40 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, brand),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ]))
    return header


def _customer_block(customer: dict) -> Table:
    styles = getSampleStyleSheet()
    lines = []
    lines.append(f"<b>Cliente:</b> {customer.get('name', 'Sin nombre')}")
    if customer.get("rfc"):
        lines.append(f"RFC: {customer['rfc']}")
    if customer.get("email"):
        lines.append(customer["email"])
    if customer.get("phone"):
        lines.append(customer["phone"])
    if customer.get("address"):
        lines.append(customer["address"])
    p = Paragraph("<br/>".join(lines), ParagraphStyle(
        "cust", parent=styles["Normal"], fontSize=9, leading=12
    ))
    t = Table([[p]], colWidths=[185 * mm])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#DDDDDD")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def _items_table(items: list, brand: colors.Color) -> Table:
    rows = [["#", "Descripción", "Cant.", "P. unit.", "Desc.", "Importe"]]
    for i, it in enumerate(items, 1):
        desc = it.get("product_name") or "—"
        if it.get("sku"):
            desc += f"  ({it['sku']})"
        rows.append([
            str(i), desc,
            str(int(it.get("quantity") or 0)),
            _mxn(it.get("unit_price") or 0.0),
            _mxn(it.get("discount_amount") or 0.0),
            _mxn(it.get("total") or 0.0),
        ])
    t = Table(rows, colWidths=[10 * mm, 78 * mm, 15 * mm, 25 * mm, 22 * mm, 35 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), brand),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#B0B7C3")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#DDDDDD")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _totals_block(order: dict) -> Table:
    rows = [
        ["Subtotal:", _mxn(order.get("subtotal") or 0.0)],
    ]
    if (order.get("discount_amount") or 0) > 0:
        rows.append(["Descuento:", "− " + _mxn(order["discount_amount"])])
    if (order.get("tax_amount") or 0) > 0:
        rows.append([f"IVA ({order.get('tax_rate') or 16:.0f}%):", _mxn(order["tax_amount"])])
    if (order.get("shipping_amount") or 0) > 0:
        rows.append(["Envío:", _mxn(order["shipping_amount"])])
    rows.append(["TOTAL:", _mxn(order.get("total_amount") or 0.0)])
    t = Table(rows, colWidths=[38 * mm, 40 * mm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, colors.HexColor("#333333")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 11.5),
        ("TOPPADDING", (0, -1), (-1, -1), 6),
    ]))
    return t


def build_document(
    kind: str,
    company: dict,
    customer: dict,
    order: dict,
    items: list,
    footer_note: Optional[str] = None,
    valid_until: Optional[str] = None,
) -> bytes:
    """Genera el PDF y regresa los bytes. kind ∈ {'quote','remission','proforma'}."""
    titulos = {
        "quote":     "COTIZACIÓN",
        "remission": "REMISIÓN",
        "proforma":  "PRE-FACTURA",
    }
    title = titulos.get(kind, "DOCUMENTO")
    folio = order.get("folio") or f"#{order.get('id')}"

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
        title=f"{title} {folio}",
    )
    brand = _accent(company.get("brand_color"))
    styles = getSampleStyleSheet()
    story = []

    story.append(_company_header(company, title, folio, brand))
    story.append(Spacer(1, 6 * mm))

    # Meta (fecha, vigencia, etc.)
    meta_rows = [["Fecha:", datetime.now().strftime("%d/%b/%Y").capitalize()]]
    if kind == "quote" and valid_until:
        meta_rows.append(["Vigencia:", valid_until])
    if customer.get("client_number"):
        meta_rows.append(["No. cliente:", customer["client_number"]])
    meta = Table(meta_rows, colWidths=[28 * mm, 60 * mm])
    meta.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9)]))
    story.append(meta)
    story.append(Spacer(1, 4 * mm))

    story.append(_customer_block(customer))
    story.append(Spacer(1, 6 * mm))

    story.append(_items_table(items, brand))
    story.append(Spacer(1, 6 * mm))

    # Totales alineados a la derecha
    tot_wrap = Table([[Paragraph(" ", styles["Normal"]), _totals_block(order)]],
                     colWidths=[100 * mm, 85 * mm])
    tot_wrap.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(tot_wrap)

    if order.get("notes"):
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(f"<b>Notas:</b> {order['notes']}", ParagraphStyle(
            "notes", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#333333")
        )))

    # Footer legal
    story.append(Spacer(1, 8 * mm))
    if kind == "quote":
        default_footer = ("Esta cotización no representa una factura. Sujeta a existencia y confirmación de pago. "
                          "Precios en pesos mexicanos. IVA incluido cuando aplique.")
    elif kind == "remission":
        default_footer = ("Este documento es únicamente una remisión de embarque y no substituye el CFDI. "
                          "Verifique la mercancía al momento de la recepción.")
    else:
        default_footer = ("Documento pre-factura para revisión previa al timbrado CFDI.")
    footer_text = footer_note or company.get("document_footer") or default_footer
    story.append(Paragraph(f"<font size='7' color='#666666'>{footer_text}</font>",
                           ParagraphStyle("foot", parent=styles["Normal"], alignment=TA_CENTER)))

    doc.build(story)
    return buf.getvalue()
