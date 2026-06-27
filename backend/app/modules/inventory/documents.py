"""Professional PDF documents for purchasing & production.

Renders a purchase order (OC) or production order as a clean, branded PDF
using reportlab's platypus layout engine (tables, headers, totals). The
company header is pulled from the configured CompanyProfile so every
document carries the tenant's legal name / RFC / contact data.
"""
from io import BytesIO
from datetime import datetime
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)

ACCENT = colors.HexColor("#2563eb")
DARK = colors.HexColor("#1e293b")
LIGHT = colors.HexColor("#f1f5f9")
MUTED = colors.HexColor("#64748b")


def _money(v: float) -> str:
    return f"${(v or 0):,.2f}"


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("DocTitle", parent=ss["Title"], fontSize=20, textColor=DARK, spaceAfter=2))
    ss.add(ParagraphStyle("Company", parent=ss["Normal"], fontSize=11, textColor=DARK, leading=14))
    ss.add(ParagraphStyle("Muted", parent=ss["Normal"], fontSize=8.5, textColor=MUTED, leading=12))
    ss.add(ParagraphStyle("SectionH", parent=ss["Normal"], fontSize=9, textColor=ACCENT, spaceAfter=3, fontName="Helvetica-Bold"))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=9.5, textColor=DARK, leading=13))
    return ss


def _header(company, ss, doc_label: str, folio: str, created_at: Optional[datetime], status: str):
    company_name = getattr(company, "legal_name", None) or "Kitchenette"
    lines = [f"<b>{company_name}</b>"]
    if getattr(company, "tax_id", None):
        lines.append(f"RFC: {company.tax_id}")
    if getattr(company, "address", None):
        lines.append(company.address)
    contact = " · ".join(filter(None, [getattr(company, "contact_phone", None), getattr(company, "contact_email", None)]))
    if contact:
        lines.append(contact)
    left = Paragraph("<br/>".join(lines), ss["Company"])

    date_str = created_at.strftime("%Y-%m-%d") if created_at else datetime.now().strftime("%Y-%m-%d")
    right = Paragraph(
        f'<para align="right"><font size="16" color="#1e293b"><b>{doc_label}</b></font><br/>'
        f'<font size="10" color="#2563eb"><b>{folio}</b></font><br/>'
        f'<font size="8.5" color="#64748b">Fecha: {date_str}<br/>Estatus: {status}</font></para>',
        ss["Body"],
    )
    t = Table([[left, right]], colWidths=[100 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _info_box(ss, title: str, rows: list[tuple[str, str]]):
    data = [[Paragraph(f"<b>{title}</b>", ss["SectionH"]), ""]]
    for k, v in rows:
        data.append([Paragraph(k, ss["Muted"]), Paragraph(v or "—", ss["Body"])])
    t = Table(data, colWidths=[28 * mm, 57 * mm])
    t.setStyle(TableStyle([
        ("SPAN", (0, 0), (1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _items_table(ss, headers: list[str], rows: list[list[str]], col_widths: list[float]):
    data = [[Paragraph(f"<b>{h}</b>", ss["Body"]) for h in headers]]
    for r in rows:
        data.append([Paragraph(str(c), ss["Body"]) for c in r])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
    ]))
    return t


def build_purchase_order_pdf(company, supplier, warehouse_name: str, po, item_rows: list[dict]) -> bytes:
    """item_rows: [{name, sku, quantity, unit_cost, subtotal}]"""
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm, title=f"OC {po.folio or po.id}")
    ss = _styles()
    elems = []
    elems.append(_header(company, ss, "ORDEN DE COMPRA", po.folio or f"OC-{po.id}", po.created_at, (po.status or "").upper()))
    elems.append(Spacer(1, 8 * mm))

    sup_rows = [
        ("Proveedor", getattr(supplier, "name", "—") if supplier else "—"),
        ("RFC", getattr(supplier, "rfc", None) if supplier else None),
        ("Contacto", getattr(supplier, "contact_name", None) if supplier else None),
        ("Email", getattr(supplier, "email", None) if supplier else None),
        ("Teléfono", getattr(supplier, "phone", None) if supplier else None),
    ]
    ship_rows = [
        ("Almacén destino", warehouse_name),
        ("Condiciones", getattr(supplier, "payment_terms", None) if supplier else None),
        ("Vencimiento", po.due_date.strftime("%Y-%m-%d") if getattr(po, "due_date", None) else None),
    ]
    two = Table([[_info_box(ss, "PROVEEDOR", sup_rows), _info_box(ss, "ENTREGA / CONDICIONES", ship_rows)]],
                colWidths=[85 * mm, 85 * mm])
    two.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    elems.append(two)
    elems.append(Spacer(1, 6 * mm))

    rows = [[r["name"], r["sku"], f'{r["quantity"]:g}', _money(r["unit_cost"]), _money(r["subtotal"])] for r in item_rows]
    elems.append(_items_table(ss, ["Producto", "SKU", "Cant.", "Costo unit.", "Importe"], rows,
                              [62 * mm, 32 * mm, 18 * mm, 28 * mm, 30 * mm]))
    elems.append(Spacer(1, 4 * mm))

    total = sum(r["subtotal"] for r in item_rows)
    tot = Table([["", "Total", _money(total)]], colWidths=[112 * mm, 28 * mm, 30 * mm])
    tot.setStyle(TableStyle([
        ("FONTNAME", (1, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (1, 0), (-1, 0), 11),
        ("TEXTCOLOR", (1, 0), (-1, 0), DARK),
        ("ALIGN", (1, 0), (-1, 0), "RIGHT"),
        ("BACKGROUND", (1, 0), (-1, 0), LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(tot)

    if getattr(po, "notes", None):
        elems.append(Spacer(1, 6 * mm))
        elems.append(Paragraph("<b>Notas</b>", ss["SectionH"]))
        elems.append(Paragraph(po.notes, ss["Body"]))

    elems.append(Spacer(1, 14 * mm))
    elems.append(Paragraph("Documento generado por el sistema. Autorización: ______________________", ss["Muted"]))

    doc.build(elems)
    return buf.getvalue()


def build_production_order_pdf(company, prod, recipe_name: str, warehouse_name: str, item_rows: list[dict]) -> bytes:
    """item_rows: [{name, sku, quantity}] — insumos consumidos por la corrida."""
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm, title=f"OP {prod.folio or prod.id}")
    ss = _styles()
    elems = []
    elems.append(_header(company, ss, "ORDEN DE PRODUCCIÓN", prod.folio or f"OP-{prod.id}", prod.created_at, (prod.status or "").upper()))
    elems.append(Spacer(1, 8 * mm))

    info_rows = [
        ("Producto / Receta", recipe_name),
        ("Almacén", warehouse_name),
        ("Corridas", str(prod.runs)),
        ("Costo unitario", _money(prod.unit_cost_result) if getattr(prod, "unit_cost_result", None) else "Pendiente"),
    ]
    elems.append(_info_box(ss, "DETALLE DE PRODUCCIÓN", info_rows))
    elems.append(Spacer(1, 6 * mm))

    elems.append(Paragraph("<b>Insumos requeridos</b>", ss["SectionH"]))
    rows = [[r["name"], r["sku"], f'{r["quantity"]:g}'] for r in item_rows]
    elems.append(_items_table(ss, ["Insumo", "SKU", "Cantidad"], rows, [88 * mm, 52 * mm, 30 * mm]))

    if getattr(prod, "notes", None):
        elems.append(Spacer(1, 6 * mm))
        elems.append(Paragraph("<b>Notas</b>", ss["SectionH"]))
        elems.append(Paragraph(prod.notes, ss["Body"]))

    elems.append(Spacer(1, 14 * mm))
    elems.append(Paragraph("Documento generado por el sistema. Responsable: ______________________", ss["Muted"]))

    doc.build(elems)
    return buf.getvalue()
