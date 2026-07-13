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
    KeepTogether, PageBreak,
)


def _mxn(n: float) -> str:
    return "$" + f"{n:,.2f}"


def _truncate(s: str, n: int) -> str:
    if not s: return ""
    return s if len(s) <= n else s[:n - 1] + "…"


def _company_logo_source(company: dict):
    """Devuelve un origen usable por reportlab (BytesIO o ruta local), o None.
    Prefiere `logo_bytes` (persistente en DB) sobre `logo_path` (efímero).
    Ignora SVG porque reportlab no lo renderiza sin extras."""
    mime = (company.get("logo_mime") or "").lower()
    if "svg" in mime:
        return None
    b = company.get("logo_bytes")
    if b:
        try:
            return BytesIO(b)
        except Exception:
            pass
    p = company.get("logo_path")
    if p and os.path.exists(p) and not p.lower().endswith(".svg"):
        return p
    return None


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
    # Logo (prefiere bytes en DB → sobrevive al deploy de Render)
    logo_src = _company_logo_source(company)
    if logo_src is not None:
        try:
            from reportlab.lib.utils import ImageReader
            reader = ImageReader(logo_src)
            logo_h = 14 * mm
            logo_w = 24 * mm
            c.drawImage(reader, (page_w - logo_w) / 2, y - logo_h,
                        width=logo_w, height=logo_h, preserveAspectRatio=True, mask="auto")
            y -= logo_h + 4
        except Exception as e:
            print(f"[pdf_ticket] logo render error: {e}")

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
    # En el POS los precios ya incluyen IVA, así que `subtotal` en la orden
    # es realmente el total-con-IVA. Para el desglose contable mostramos el
    # subtotal SIN IVA (total - IVA), IVA aparte y TOTAL con IVA.
    total_amount = order.get("total_amount") or 0.0
    tax = order.get("tax_amount") or 0.0
    discount = order.get("discount_amount") or 0.0
    shipping = order.get("shipping_amount") or 0.0
    subtotal_neto = round(total_amount - tax - shipping + discount, 2)
    line(f"Subtotal: {_mxn(subtotal_neto)}", size=8, align="right")
    if discount > 0:
        line(f"Descuento: -{_mxn(discount)}", size=8, align="right")
    if tax > 0:
        line(f"IVA (16%): {_mxn(tax)}", size=8, align="right")
    if shipping > 0:
        line(f"Envío: {_mxn(shipping)}", size=8, align="right")
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
    sales: Optional[List[dict]] = None,
) -> bytes:
    """Reporte Z (cierre de turno) o X (corte intermedio) del POS.

    Contenido:
      - Header con logo + datos empresa + badge X/Z.
      - Metadatos del turno (caja, cajero, apertura, cierre, estado).
      - Resumen: fondo, ventas, entradas/salidas, reembolsos, esperado/real/variance.
      - Ventas por método de pago.
      - Arqueo por denominación.
      - Reconciliación post-cierre (depósitos, floats, ajustes, cash_remaining_after).
      - Tickets/ventas del turno con folios.
      - Bitácora completa de movimientos.
      - Notas de apertura y cierre.
      - Firmas.
    """
    from reportlab.lib.pagesizes import LETTER

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title=f"Reporte {kind} · Turno {session.get('id')}",
    )
    styles = getSampleStyleSheet()
    story = []

    brand_hex = company.get("brand_color") or "#33B2F5"
    brand = colors.HexColor(brand_hex)
    grey_bg = colors.HexColor("#F0F3F8")
    grey_border = colors.HexColor("#CCCCCC")
    grey_grid = colors.HexColor("#EEEEEE")
    label_grey = colors.HexColor("#666666")

    h1 = ParagraphStyle("h1", parent=styles["Normal"], fontSize=10.5,
                        textColor=brand, spaceAfter=2, fontName="Helvetica-Bold")
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9)

    # ── Header: logo + empresa + badge X/Z ──────────────────────────────
    logo_cell = ""
    logo_src = _company_logo_source(company)
    if logo_src is not None:
        try:
            logo_cell = Image(logo_src, width=32 * mm, height=14 * mm, kind="proportional")
        except Exception:
            logo_cell = ""

    empresa_lines = []
    if company.get("commercial_name"):
        empresa_lines.append(f"<b>{company['commercial_name']}</b>")
    if company.get("legal_name"):
        empresa_lines.append(company["legal_name"])
    if company.get("tax_id"):
        empresa_lines.append(f"RFC: {company['tax_id']}")
    p_empresa = Paragraph(
        "<br/>".join(empresa_lines),
        ParagraphStyle("e", parent=styles["Normal"], fontSize=8.5, leading=11,
                       textColor=colors.HexColor("#333")))

    is_final = kind == "Z"
    badge_color = "#059669" if is_final else "#D97706"
    badge_label = "DEFINITIVO" if is_final else "PROVISIONAL"
    p_titulo = Paragraph(
        f"<font size='18' color='{brand_hex}'><b>REPORTE {kind}</b></font><br/>"
        f"<font size='9' color='#666'>Turno #{session.get('id')}</font><br/>"
        f"<font size='8' color='{badge_color}'><b>■ {badge_label}</b></font>",
        ParagraphStyle("t", parent=styles["Normal"], alignment=TA_RIGHT))

    header = Table([[logo_cell, p_empresa, p_titulo]],
                    colWidths=[38 * mm, 92 * mm, 50 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, brand),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
    ]))
    story.append(header)
    story.append(Spacer(1, 4 * mm))

    # ── Metadatos del turno ────────────────────────────────────────────
    def fmt_dt(s):
        if not s: return "—"
        try:
            d = s if isinstance(s, datetime) else datetime.fromisoformat(str(s).replace("Z", "+00:00"))
            return d.strftime("%d/%m/%Y %H:%M")
        except Exception:
            return str(s)

    state_label = {
        "open": "ABIERTO", "closed": "CERRADO", "reconciled": "RECONCILIADO",
    }.get(session.get("status"), (session.get("status") or "—").upper())

    meta = [
        ["Caja:", session.get("terminal_name") or "—", "Cajero:", session.get("cashier_name") or "—"],
        ["Apertura:", fmt_dt(session.get("opened_at")), "Cierre:", fmt_dt(session.get("closed_at"))],
        ["Estado:", state_label, "Emitido:", datetime.now().strftime("%d/%m/%Y %H:%M")],
    ]
    t_meta = Table(meta, colWidths=[22 * mm, 60 * mm, 22 * mm, 60 * mm])
    t_meta.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("TEXTCOLOR", (0, 0), (0, -1), label_grey),
        ("TEXTCOLOR", (2, 0), (2, -1), label_grey),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("FONTNAME", (3, 0), (3, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 5 * mm))

    def _std_table_style(header_bg=True, totals_row=None):
        st = [
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ("BOX", (0, 0), (-1, -1), 0.4, grey_border),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, grey_grid),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
        if header_bg:
            st += [("BACKGROUND", (0, 0), (-1, 0), grey_bg),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]
        if totals_row is not None:
            st += [("LINEABOVE", (0, totals_row), (-1, totals_row), 0.8, colors.HexColor("#999")),
                    ("FONTNAME", (0, totals_row), (-1, totals_row), "Helvetica-Bold")]
        return TableStyle(st)

    # ── Resumen del turno ──────────────────────────────────────────────
    variance = session.get("variance") or 0
    var_bg = (colors.HexColor("#FEE2E2") if variance < -0.01
              else colors.HexColor("#D1FAE5") if variance > 0.01
              else grey_bg)
    resumen = [
        ["Concepto", "Monto"],
        ["Fondo inicial (apertura)", _mxn(session.get("opening_balance") or 0)],
        ["+ Ventas totales", _mxn(session.get("total_sales_amount") or 0)],
        ["+ Depósitos manuales (cash-in)", _mxn(session.get("total_cash_in") or 0)],
        ["− Retiros manuales (cash-out)", "− " + _mxn(session.get("total_cash_out") or 0)],
        ["− Reembolsos", "− " + _mxn(session.get("total_refunds") or 0)],
        ["EFECTIVO ESPERADO (calculado)", _mxn(session.get("expected_cash") or 0)],
        ["EFECTIVO REAL (arqueo)", _mxn(session.get("actual_cash") or 0)],
        ["DIFERENCIA", ("+" if variance >= 0 else "") + _mxn(variance)],
    ]
    story.append(Paragraph("RESUMEN DEL TURNO", h1))
    t_res = Table(resumen, colWidths=[110 * mm, 60 * mm])
    st_res = _std_table_style(totals_row=6)
    st_res.add("BACKGROUND", (0, 8), (-1, 8), var_bg)
    st_res.add("FONTNAME", (0, 6), (-1, 8), "Helvetica-Bold")
    t_res.setStyle(st_res)
    story.append(KeepTogether(t_res))
    story.append(Spacer(1, 4 * mm))

    # ── Ventas por método de pago ──────────────────────────────────────
    by_method = report.get("sales_by_method") or {}
    if by_method:
        labels = {"cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia",
                  "credit": "Crédito", "unknown": "Otro"}
        rows = [["Método", "Monto"]]
        total = 0.0
        for k, v in by_method.items():
            rows.append([labels.get(k, k.title()), _mxn(v)])
            total += v
        rows.append(["TOTAL", _mxn(total)])
        story.append(Paragraph("VENTAS POR MÉTODO DE PAGO", h1))
        t_meth = Table(rows, colWidths=[110 * mm, 60 * mm])
        t_meth.setStyle(_std_table_style(totals_row=len(rows) - 1))
        story.append(KeepTogether(t_meth))
        story.append(Spacer(1, 4 * mm))

    # ── Arqueo por denominación ────────────────────────────────────────
    dens = session.get("denominations_json") or {}
    if dens:
        rows = [["Denominación", "Cantidad", "Subtotal"]]
        total = 0.0
        for d in sorted(dens.keys(), key=lambda x: -float(x)):
            try:
                qty = int(dens[d])
                sub = float(d) * qty
            except (ValueError, TypeError):
                continue
            if qty <= 0:
                continue
            total += sub
            rows.append([f"${d}", str(qty), _mxn(sub)])
        rows.append(["TOTAL CONTADO", "", _mxn(total)])
        story.append(Paragraph("ARQUEO POR DENOMINACIÓN", h1))
        t_den = Table(rows, colWidths=[60 * mm, 60 * mm, 50 * mm])
        t_den.setStyle(_std_table_style(totals_row=len(rows) - 1))
        story.append(KeepTogether(t_den))
        story.append(Spacer(1, 4 * mm))

    # ── Reconciliación post-cierre ─────────────────────────────────────
    total_dep = report.get("total_deposited") or 0
    total_flt = report.get("total_float_next") or 0
    total_adj = report.get("total_adjustments") or 0
    cash_rem = report.get("cash_remaining_after") or 0
    if total_dep or total_flt or total_adj or session.get("status") == "reconciled":
        rows = [
            ["Concepto", "Monto"],
            ["Depositado al banco", _mxn(total_dep)],
            ["Fondo del próximo turno", _mxn(total_flt)],
            ["Ajustes con motivo", _mxn(total_adj)],
            ["EFECTIVO PENDIENTE", _mxn(cash_rem)],
        ]
        story.append(Paragraph("RECONCILIACIÓN POST-CIERRE", h1))
        t_rec = Table(rows, colWidths=[110 * mm, 60 * mm])
        st_rec = _std_table_style(totals_row=4)
        pending_bg = (colors.HexColor("#D1FAE5") if cash_rem < 0.01
                       else colors.HexColor("#FEF3C7"))
        st_rec.add("BACKGROUND", (0, 4), (-1, 4), pending_bg)
        t_rec.setStyle(st_rec)
        story.append(KeepTogether(t_rec))
        story.append(Spacer(1, 4 * mm))

    # ── Tickets del turno ──────────────────────────────────────────────
    sales_list = sales or []
    if sales_list:
        rows = [["Folio", "Cliente", "Métodos", "Total"]]
        for s in sales_list[:40]:  # tope defensivo
            methods = ", ".join([labels.get(m, m) for m in (s.get("payment_methods") or [])]) if by_method else ", ".join(s.get("payment_methods") or [])
            rows.append([
                str(s.get("folio") or f"#{s.get('order_id')}"),
                _truncate(s.get("customer_name") or "Público en general", 30),
                _truncate(methods, 26),
                _mxn(s.get("total_amount") or 0),
            ])
        remaining = len(sales_list) - 40
        if remaining > 0:
            rows.append(["", f"(+{remaining} tickets más)", "", ""])
        story.append(Paragraph(f"TICKETS DEL TURNO ({len(sales_list)})", h1))
        t_sales = Table(rows, colWidths=[25 * mm, 65 * mm, 50 * mm, 30 * mm])
        st_sales = _std_table_style()
        st_sales.add("ALIGN", (0, 1), (2, -1), "LEFT")
        st_sales.add("ALIGN", (3, 0), (3, -1), "RIGHT")
        st_sales.add("FONTNAME", (0, 1), (0, -1), "Courier")
        t_sales.setStyle(st_sales)
        story.append(t_sales)
        story.append(Spacer(1, 4 * mm))

    # ── Bitácora de movimientos ────────────────────────────────────────
    tx_list = report.get("transactions") or []
    if tx_list:
        tx_labels = {
            "opening": "Apertura", "closing": "Cierre",
            "sale": "Venta", "refund": "Reembolso",
            "cash_in": "Fondo", "cash_out": "Retiro",
            "bank_deposit": "Depósito banco",
            "float_next_shift": "Fondo próximo turno",
            "adjustment": "Ajuste",
        }
        rows = [["Fecha/Hora", "Movimiento", "Nota", "Monto"]]
        for tx in tx_list:
            rows.append([
                fmt_dt(tx.get("created_at")),
                tx_labels.get(tx.get("type") or "", tx.get("type") or "—"),
                _truncate(tx.get("notes") or "", 42),
                _mxn(tx.get("amount") or 0),
            ])
        story.append(Paragraph(f"BITÁCORA DE MOVIMIENTOS ({len(tx_list)})", h1))
        t_tx = Table(rows, colWidths=[32 * mm, 32 * mm, 76 * mm, 30 * mm])
        st_tx = _std_table_style()
        st_tx.add("ALIGN", (0, 1), (2, -1), "LEFT")
        st_tx.add("ALIGN", (3, 0), (3, -1), "RIGHT")
        t_tx.setStyle(st_tx)
        story.append(t_tx)
        story.append(Spacer(1, 4 * mm))

    # ── Notas ──────────────────────────────────────────────────────────
    if session.get("closing_notes") or session.get("opening_notes"):
        notes_block = [Paragraph("NOTAS", h1)]
        if session.get("opening_notes"):
            notes_block.append(Paragraph(
                f"<b>Apertura:</b> {session['opening_notes']}", body))
        if session.get("closing_notes"):
            notes_block.append(Paragraph(
                f"<b>Cierre:</b> {session['closing_notes']}", body))
        story.append(KeepTogether(notes_block))
        story.append(Spacer(1, 4 * mm))

    # ── Firmas ─────────────────────────────────────────────────────────
    firmas = [
        ["_______________________", "_______________________"],
        ["Cajero", "Supervisor"],
    ]
    t_firm = Table(firmas, colWidths=[85 * mm, 85 * mm])
    t_firm.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TEXTCOLOR", (0, 1), (-1, 1), label_grey),
        ("TOPPADDING", (0, 0), (-1, 0), 14),
    ]))
    story.append(Spacer(1, 6 * mm))
    story.append(KeepTogether(t_firm))

    # ── Pie de página con hash de auditoría (número de folio interno) ──
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        f"<font size='7' color='#999'>Documento generado por STHENOVA ERP · "
        f"Turno {session.get('id')} · Reporte tipo {kind} "
        f"({'definitivo' if is_final else 'provisional'}) · "
        f"Emitido {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}</font>",
        ParagraphStyle("f", parent=styles["Normal"], alignment=TA_CENTER)))

    doc.build(story)
    return buf.getvalue()
