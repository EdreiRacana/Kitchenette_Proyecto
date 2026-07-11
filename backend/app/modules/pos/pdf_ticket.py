"""Generador de tickets térmicos (58mm y 80mm) y reporte Z de turno.

Los tickets térmicos se imprimen en impresoras Epson TM-T20/T88, Xprinter,
Star Micronics, etc. Los formatos comunes son:
  - 58mm ancho utilizable ~48mm (272 pt en points)
  - 80mm ancho utilizable ~72mm (411 pt en points)

Todo se genera con reportlab y sale como PDF listo para imprimir.
"""
from __future__ import annotations
from io import BytesIO
from typing import Optional, List, Dict
from datetime import datetime
import os

from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)


def _mxn(n: float) -> str:
    return "$" + f"{n:,.2f}"


def _truncate(s: str, n: int) -> str:
    if not s: return ""
    return s if len(s) <= n else s[:n - 1] + "…"


def build_thermal_ticket(
    company: dict, order: dict, items: List[dict],
    payments: List[dict], session: Optional[dict] = None,
    width_mm: int = 80,
) -> bytes:
    """Ticket térmico (58 o 80mm ancho) para impresora POS.
    El alto crece según el número de partidas."""
    # Ancho: 58mm o 80mm → páginas verticales muy angostas
    page_w = width_mm * mm
    line_h = 10  # pt por línea aprox
    header_lines = 8
    footer_lines = 6
    body_lines = max(3, len(items) + len(payments) + 3)
    page_h = (header_lines + body_lines + footer_lines) * line_h + 40

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))

    margin = 4 * mm
    x0 = margin
    y = page_h - margin
    inner_w = page_w - 2 * margin

    def line(text: str, size: int = 8, align: str = "left", bold: bool = False, spacing: int = 3):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        if align == "center":
            c.drawCentredString(page_w / 2, y, text)
        elif align == "right":
            c.drawRightString(page_w - margin, y, text)
        else:
            c.drawString(x0, y, text)
        y -= size + spacing

    def separator(char: str = "-"):
        nonlocal y
        c.setFont("Helvetica", 7)
        # Cuantos caracteres caben aproximadamente
        chars = int(inner_w / 3.8)
        c.drawCentredString(page_w / 2, y, char * chars)
        y -= 10

    # ── Header ──────────────────────────────────
    # Logo si existe
    if company.get("logo_path") and os.path.exists(company["logo_path"]):
        try:
            logo_h = 12 * mm
            c.drawImage(company["logo_path"], (page_w - 20 * mm) / 2, y - logo_h,
                        width=20 * mm, height=logo_h, preserveAspectRatio=True, mask="auto")
            y -= logo_h + 4
        except Exception:
            pass

    line(company.get("commercial_name") or company.get("legal_name") or "MI EMPRESA",
         size=10, align="center", bold=True)
    if company.get("legal_name") and company.get("legal_name") != company.get("commercial_name"):
        line(_truncate(company["legal_name"], 40), size=7, align="center")
    if company.get("tax_id"):
        line(f"RFC: {company['tax_id']}", size=7, align="center")
    if company.get("address"):
        addr = company["address"]
        for chunk in [addr[i:i + 40] for i in range(0, len(addr), 40)][:2]:
            line(chunk, size=6, align="center", spacing=1)
    if company.get("contact_phone"):
        line(f"Tel: {company['contact_phone']}", size=7, align="center")

    separator()

    # ── Metadata orden ──────────────────────────
    line(f"Folio: {order.get('folio') or order.get('id')}", size=8, bold=True)
    line(f"Fecha: {datetime.now().strftime('%d/%m/%Y %H:%M')}", size=7)
    if session:
        line(f"Caja: {session.get('terminal_name', '')} · Cajero: {session.get('cashier_name', '')}",
             size=7)
    if order.get("customer_name"):
        line(f"Cliente: {_truncate(order['customer_name'], 38)}", size=7)

    separator()

    # ── Items ──────────────────────────────────
    line("PRODUCTO             CANT   IMPORTE", size=7, bold=True)
    for it in items:
        name = _truncate(it.get("product_name") or "-", 22)
        qty = str(int(it.get("quantity") or 0))
        total = _mxn(it.get("total") or it.get("subtotal") or 0.0)
        # Formato con padding manual — el font monoespaciado ayudaría pero Helvetica sirve
        line(f"{name}", size=7)
        line(f"  {qty} x {_mxn(it.get('unit_price') or 0)}", size=6, spacing=1)
        c.setFont("Helvetica", 7)
        c.drawRightString(page_w - margin, y + 8, total)

    separator()

    # ── Totales ────────────────────────────────
    subtotal = order.get("subtotal") or 0.0
    tax = order.get("tax_amount") or 0.0
    total_amount = order.get("total_amount") or 0.0
    line(f"Subtotal: {_mxn(subtotal)}", size=8, align="right")
    if tax > 0:
        line(f"IVA: {_mxn(tax)}", size=8, align="right")
    line(f"TOTAL: {_mxn(total_amount)}", size=11, align="right", bold=True)

    separator()

    # ── Pagos ──────────────────────────────────
    for p in payments:
        method_labels = {"cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia"}
        m = method_labels.get(p.get("method", ""), p.get("method", "Otro").title())
        line(f"{m}: {_mxn(p.get('amount') or 0)}", size=8, align="right")
    change = order.get("change") or 0.0
    if change > 0:
        line(f"Cambio: {_mxn(change)}", size=9, align="right", bold=True)

    separator()

    # ── Footer ─────────────────────────────────
    line("¡Gracias por su compra!", size=8, align="center", bold=True)
    if company.get("document_footer"):
        for chunk in [company["document_footer"][i:i + 44]
                      for i in range(0, len(company["document_footer"]), 44)][:3]:
            line(chunk, size=6, align="center", spacing=1)
    else:
        line("Conserve este ticket como comprobante.", size=6, align="center")

    c.showPage()
    c.save()
    return buf.getvalue()


def build_session_z_report(
    company: dict, session: dict, report: dict, kind: str = "Z",
) -> bytes:
    """Reporte Z (cierre de turno) o X (corte intermedio) del POS.
    Formato carta con desglose por método de pago y arqueo."""
    from reportlab.lib.pagesizes import LETTER

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm,
        title=f"Reporte {kind} · Turno {session.get('id')}",
    )
    styles = getSampleStyleSheet()
    story = []

    # ── Header con logo + datos empresa ───────
    logo_cell = ""
    if company.get("logo_path") and os.path.exists(company["logo_path"]):
        try:
            logo_cell = Image(company["logo_path"], width=32 * mm, height=14 * mm, kind="proportional")
        except Exception:
            logo_cell = ""

    empresa_lines = []
    if company.get("commercial_name"):
        empresa_lines.append(f"<b>{company['commercial_name']}</b>")
    if company.get("legal_name"):
        empresa_lines.append(company["legal_name"])
    if company.get("tax_id"):
        empresa_lines.append(f"RFC: {company['tax_id']}")
    p_empresa = Paragraph("<br/>".join(empresa_lines), ParagraphStyle(
        "e", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#333")))
    brand = colors.HexColor(company.get("brand_color") or "#33B2F5")
    p_titulo = Paragraph(f"<font size='16' color='{company.get('brand_color') or '#33B2F5'}'><b>REPORTE {kind}</b></font>"
                          f"<br/><font size='10'>Turno #{session.get('id')}</font>",
                          ParagraphStyle("t", parent=styles["Normal"], alignment=TA_RIGHT))
    header = Table([[logo_cell, p_empresa, p_titulo]], colWidths=[38 * mm, 90 * mm, 50 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, brand),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ]))
    story.append(header)
    story.append(Spacer(1, 6 * mm))

    # ── Datos del turno ───────────────────────
    def fmt_dt(s):
        if not s: return "—"
        try:
            d = s if isinstance(s, datetime) else datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            return d.strftime("%d/%m/%Y %H:%M")
        except Exception:
            return str(s)

    meta = [
        ["Caja:", session.get("terminal_name") or "—", "Cajero:", session.get("cashier_name") or "—"],
        ["Apertura:", fmt_dt(session.get("opened_at")), "Cierre:", fmt_dt(session.get("closed_at"))],
        ["Estado:", (session.get("status") or "—").upper(), "", ""],
    ]
    t_meta = Table(meta, colWidths=[22 * mm, 60 * mm, 22 * mm, 60 * mm])
    t_meta.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#666")),
        ("TEXTCOLOR", (2, 0), (2, -1), colors.HexColor("#666")),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("FONTNAME", (3, 0), (3, -1), "Helvetica-Bold"),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 6 * mm))

    # ── Resumen del turno ─────────────────────
    story.append(Paragraph("<b>RESUMEN DEL TURNO</b>",
                            ParagraphStyle("h", parent=styles["Normal"], fontSize=11, textColor=brand)))
    story.append(Spacer(1, 3 * mm))
    resumen = [
        ["Concepto", "Monto"],
        ["Fondo inicial (apertura)", _mxn(session.get("opening_balance") or 0)],
        ["+ Ventas totales", _mxn(session.get("total_sales_amount") or 0)],
        ["+ Depósitos manuales (cash-in)", _mxn(session.get("total_cash_in") or 0)],
        ["− Retiros manuales (cash-out)", "− " + _mxn(session.get("total_cash_out") or 0)],
        ["− Reembolsos", "− " + _mxn(session.get("total_refunds") or 0)],
        ["EFECTIVO ESPERADO (calculado)", _mxn(session.get("expected_cash") or 0)],
        ["EFECTIVO REAL (arqueo)", _mxn(session.get("actual_cash") or 0)],
        ["DIFERENCIA", ("+" if (session.get("variance") or 0) >= 0 else "") + _mxn(session.get("variance") or 0)],
    ]
    t_res = Table(resumen, colWidths=[110 * mm, 60 * mm])
    variance_row = 8
    t_res.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F3F8")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, 6), (-1, 6), 0.8, colors.HexColor("#999")),
        ("FONTNAME", (0, 6), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, variance_row), (-1, variance_row),
         colors.HexColor("#FEE2E2") if (session.get("variance") or 0) < 0
         else colors.HexColor("#D1FAE5") if (session.get("variance") or 0) > 0
         else colors.HexColor("#F0F3F8")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CCC")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#EEE")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t_res)
    story.append(Spacer(1, 6 * mm))

    # ── Ventas por método de pago ─────────────
    by_method = report.get("sales_by_method") or {}
    if by_method:
        story.append(Paragraph("<b>VENTAS POR MÉTODO DE PAGO</b>",
                                ParagraphStyle("h", parent=styles["Normal"], fontSize=11, textColor=brand)))
        story.append(Spacer(1, 3 * mm))
        labels = {"cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia"}
        rows = [["Método", "Monto"]]
        total = 0.0
        for k, v in by_method.items():
            rows.append([labels.get(k, k.title()), _mxn(v)])
            total += v
        rows.append(["TOTAL", _mxn(total)])
        t_meth = Table(rows, colWidths=[110 * mm, 60 * mm])
        t_meth.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F3F8")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.HexColor("#999")),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CCC")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#EEE")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(t_meth)
        story.append(Spacer(1, 6 * mm))

    # ── Arqueo por denominación ───────────────
    dens = session.get("denominations_json") or {}
    if dens:
        story.append(Paragraph("<b>ARQUEO POR DENOMINACIÓN</b>",
                                ParagraphStyle("h", parent=styles["Normal"], fontSize=11, textColor=brand)))
        story.append(Spacer(1, 3 * mm))
        rows = [["Denominación", "Cantidad", "Subtotal"]]
        total = 0.0
        for d in sorted(dens.keys(), key=lambda x: -float(x)):
            qty = int(dens[d])
            sub = float(d) * qty
            total += sub
            rows.append([f"${d}", str(qty), _mxn(sub)])
        rows.append(["TOTAL CONTADO", "", _mxn(total)])
        t_den = Table(rows, colWidths=[60 * mm, 60 * mm, 50 * mm])
        t_den.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 9.5),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F3F8")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.HexColor("#999")),
            ("ALIGN", (1, 0), (2, -1), "RIGHT"),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CCC")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#EEE")),
        ]))
        story.append(t_den)
        story.append(Spacer(1, 6 * mm))

    # ── Firmas ────────────────────────────────
    firmas = [
        ["", "", ""],
        ["_______________________", "_______________________", ""],
        ["Cajero", "Supervisor", ""],
    ]
    t_firm = Table(firmas, colWidths=[70 * mm, 70 * mm, 30 * mm])
    t_firm.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TEXTCOLOR", (0, 2), (-1, 2), colors.HexColor("#666")),
    ]))
    story.append(Spacer(1, 12 * mm))
    story.append(t_firm)

    # ── Notas ────────────────────────────────
    if session.get("closing_notes") or session.get("opening_notes"):
        story.append(Spacer(1, 8 * mm))
        story.append(Paragraph("<b>NOTAS</b>",
                                ParagraphStyle("h", parent=styles["Normal"], fontSize=10, textColor=brand)))
        if session.get("opening_notes"):
            story.append(Paragraph(f"<b>Apertura:</b> {session['opening_notes']}",
                                    ParagraphStyle("n", parent=styles["Normal"], fontSize=9)))
        if session.get("closing_notes"):
            story.append(Paragraph(f"<b>Cierre:</b> {session['closing_notes']}",
                                    ParagraphStyle("n", parent=styles["Normal"], fontSize=9)))

    doc.build(story)
    return buf.getvalue()
