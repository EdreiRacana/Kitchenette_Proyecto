"""Recibos de nómina en PDF.

Generador profesional multi-empresa con reportlab. El encabezado toma los
datos del `CompanyProfile` (razón social, RFC, domicilio, contacto, logo)
para que cada empresa cliente del ERP vea los suyos. Colores institucionales
con transparencia para percepciones/deducciones, layout paginado que evita
sobreposición del contenido con las firmas y el pie.

Nota: este PDF NO sustituye al CFDI 4.0 timbrado por un PAC — es el recibo
administrativo interno. Cuando se integre timbrado, este mismo recibo
llevará el UUID y sello del SAT.
"""

from __future__ import annotations

import io
import zipfile
from datetime import date, datetime
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle


# ── Utilidades de formato ──────────────────────────────────────────────────
def _money(v: float) -> str:
    return f"${(v or 0.0):,.2f}"


def _safe(v) -> str:
    if v is None:
        return "—"
    return str(v)


def _to_date(v) -> str:
    if not v:
        return "—"
    if isinstance(v, (date, datetime)):
        return v.strftime("%d/%m/%Y")
    try:
        return datetime.fromisoformat(str(v)).strftime("%d/%m/%Y")
    except ValueError:
        return str(v)


def _alpha(hex_color: str, alpha: float) -> colors.Color:
    """Convierte '#RRGGBB' a Color con canal alpha (0..1)."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r = int(h[0:2], 16) / 255.0
    g = int(h[2:4], 16) / 255.0
    b = int(h[4:6], 16) / 255.0
    return colors.Color(r, g, b, alpha=alpha)


# Paleta institucional
NAVY = "#0E1838"
GREEN = "#0F9D70"
RED = "#DC2626"
BORDER = "#CBD5E1"
SLATE_500 = "#64748B"
SLATE_700 = "#334155"


def _draw_logo(c: canvas.Canvas, logo_bytes: Optional[bytes], x: float, y: float,
                 max_w: float, max_h: float) -> float:
    """Dibuja el logo desde bytes en (x,y) respetando aspect ratio.
    Devuelve el ancho realmente usado (0 si no se dibujó)."""
    if not logo_bytes:
        return 0.0
    try:
        img = ImageReader(io.BytesIO(logo_bytes))
        iw, ih = img.getSize()
        ratio = min(max_w / iw, max_h / ih)
        w = iw * ratio
        h = ih * ratio
        c.drawImage(img, x, y - h + max_h * 0.15, width=w, height=h,
                    mask="auto", preserveAspectRatio=True)
        return w
    except Exception:
        return 0.0


def build_receipt_pdf(
    employee: dict,
    period: dict,
    detail: dict,
    company: Optional[dict] = None,
    # Compatibilidad con firma antigua (kwargs)
    company_name: Optional[str] = None,
    company_rfc: Optional[str] = None,
) -> bytes:
    """Genera el PDF del recibo de un empleado en un período dado.

    `company` es un dict con: name, commercial_name, rfc, address, email,
    phone, logo_bytes, logo_mime, brand_color, document_footer.
    """
    if company is None:
        company = {}
    if company_name and not company.get("name"):
        company["name"] = company_name
    if company_rfc and not company.get("rfc"):
        company["rfc"] = company_rfc

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    W, H = LETTER

    brand = company.get("brand_color") or NAVY
    # ── Encabezado: banda superior con logo + datos de empresa ─────────────
    HDR_H = 32 * mm
    c.setFillColor(colors.HexColor(brand))
    c.rect(0, H - HDR_H, W, HDR_H, fill=1, stroke=0)

    # Sub-banda de acento (línea fina abajo del header)
    c.setFillColor(_alpha(brand, 0.6))
    c.rect(0, H - HDR_H - 1.2 * mm, W, 1.2 * mm, fill=1, stroke=0)

    # Logo a la izquierda (si existe)
    logo_w = _draw_logo(c, company.get("logo_bytes"),
                         x=12 * mm, y=H - HDR_H + 4 * mm,
                         max_w=24 * mm, max_h=22 * mm)
    text_x = 12 * mm + (logo_w + 6 * mm if logo_w > 0 else 0)

    # Nombre razón social
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 14)
    company_name_str = (company.get("commercial_name") or company.get("name") or "EMPRESA").upper()
    c.drawString(text_x, H - 12 * mm, company_name_str[:60])

    # Sub-línea con razón social (si commercial_name existe y es distinto)
    if company.get("commercial_name") and company.get("name") and company["commercial_name"] != company["name"]:
        c.setFont("Helvetica", 8.5)
        c.setFillColor(_alpha("#FFFFFF", 0.75))
        c.drawString(text_x, H - 16.5 * mm, company["name"][:80])

    # Línea de contacto (RFC · domicilio · email · phone)
    c.setFont("Helvetica", 8)
    c.setFillColor(_alpha("#FFFFFF", 0.85))
    contact_parts = []
    if company.get("rfc"):
        contact_parts.append(f"RFC: {company['rfc']}")
    if company.get("address"):
        addr = company["address"]
        contact_parts.append(addr[:80] + ("…" if len(addr) > 80 else ""))
    if company.get("email"):
        contact_parts.append(company["email"])
    if company.get("phone"):
        contact_parts.append(f"Tel. {company['phone']}")
    contact_line = "  ·  ".join(contact_parts)
    if contact_line:
        c.drawString(text_x, H - 22 * mm, contact_line[:140])

    # Título recibo (derecha)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(W - 12 * mm, H - 12 * mm, "RECIBO DE NÓMINA")
    c.setFont("Helvetica", 9)
    kind = period.get("kind", "regular")
    kind_label = {
        "regular": "Ordinaria",
        "aguinaldo": "Aguinaldo",
        "prima_vacacional": "Prima vacacional",
        "finiquito": "Finiquito",
    }.get(kind, kind.title())
    c.setFillColor(_alpha("#FFFFFF", 0.85))
    c.drawRightString(W - 12 * mm, H - 17.5 * mm, f"Tipo: {kind_label}")
    period_name = _safe(period.get("name"))[:40]
    c.drawRightString(W - 12 * mm, H - 22 * mm, f"Folio interno: {period_name}")

    # ── Sección: Datos del empleado y período ──────────────────────────────
    y = H - HDR_H - 10 * mm

    def _section_title(txt: str, yy: float):
        c.setFillColor(colors.HexColor(brand))
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(12 * mm, yy, txt.upper())
        # subrayado sutil
        c.setStrokeColor(_alpha(brand, 0.35))
        c.setLineWidth(0.6)
        c.line(12 * mm, yy - 1.5 * mm, W - 12 * mm, yy - 1.5 * mm)

    _section_title("Datos del empleado y período", y)
    y -= 6 * mm

    info_left = [
        ("No. empleado", _safe(employee.get("employee_number"))),
        ("Nombre", _safe(f"{employee.get('name', '')} {employee.get('last_name', '')}").strip() or "—"),
        ("Puesto", _safe(employee.get("position"))),
        ("Departamento", _safe(employee.get("department"))),
        ("RFC", _safe(employee.get("rfc"))),
        ("CURP", _safe(employee.get("curp"))),
        ("NSS", _safe(employee.get("nss"))),
    ]
    info_right = [
        ("Período", _safe(period.get("name"))),
        ("Frecuencia", _safe(period.get("frequency")).title()),
        ("Fecha inicio", _to_date(period.get("start_date"))),
        ("Fecha fin", _to_date(period.get("end_date"))),
        ("Fecha pago", _to_date(period.get("payment_date"))),
        ("Días trabajados", f"{detail.get('days_worked', 0):g}"),
        ("Días faltas", f"{detail.get('days_absent', 0):g}"),
    ]

    row_h = 4.6 * mm
    label_col_w = 32 * mm
    left_x = 12 * mm
    right_x = W / 2 + 4 * mm

    for i in range(max(len(info_left), len(info_right))):
        yy = y - i * row_h
        if i < len(info_left):
            c.setFillColor(colors.HexColor(SLATE_500))
            c.setFont("Helvetica", 8)
            c.drawString(left_x, yy, info_left[i][0])
            c.setFillColor(colors.HexColor(SLATE_700))
            c.setFont("Helvetica-Bold", 9)
            c.drawString(left_x + label_col_w, yy, info_left[i][1])
        if i < len(info_right):
            c.setFillColor(colors.HexColor(SLATE_500))
            c.setFont("Helvetica", 8)
            c.drawString(right_x, yy, info_right[i][0])
            c.setFillColor(colors.HexColor(SLATE_700))
            c.setFont("Helvetica-Bold", 9)
            c.drawString(right_x + label_col_w, yy, info_right[i][1])
    y -= max(len(info_left), len(info_right)) * row_h + 6 * mm

    # ── Tablas de percepciones y deducciones ───────────────────────────────
    percepciones = [
        ("Sueldo del período", detail.get("salary_earned", 0.0)),
        ("Horas extra dobles", detail.get("overtime_double", 0.0)),
        ("Horas extra triples", detail.get("overtime_triple", 0.0)),
        ("Prima vacacional", detail.get("vacation_premium", 0.0)),
        ("Bonos / incentivos", detail.get("bonus", 0.0)),
        ("Vales de despensa", detail.get("food_vouchers", 0.0)),
        ("Fondo de ahorro", detail.get("savings_fund", 0.0)),
        ("Aguinaldo", detail.get("aguinaldo", 0.0)),
        ("Subsidio al empleo pagado", detail.get("subsidy_applied", 0.0)),
    ]
    deducciones = [
        ("IMSS obrero", detail.get("imss_employee", 0.0)),
        ("ISR retenido", detail.get("isr", 0.0)),
        ("INFONAVIT (crédito habitación)", detail.get("infonavit", 0.0)),
        ("FONACOT", detail.get("fonacot", 0.0)),
        ("Pensión alimenticia (mandato judicial)", detail.get("alimony", 0.0)),
        ("Otros préstamos", detail.get("loan_deduction", 0.0)),
    ]
    percepciones = [(k, v) for k, v in percepciones if v]
    deducciones = [(k, v) for k, v in deducciones if v]
    total_perc = sum(v for _k, v in percepciones)
    total_ded = sum(v for _k, v in deducciones)

    def _mk_table(title: str, rows: list, total_label: str, total_value: float,
                    header_color_hex: str):
        data = [[title, "Importe"]]
        for k, v in rows:
            data.append([k, _money(v)])
        data.append([total_label, _money(total_value)])
        tbl = Table(data, colWidths=[62 * mm, 26 * mm])
        # Fila header sólida; filas con background alterno translúcido;
        # total con fondo tinte del color de sección (transparente).
        style = TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(header_color_hex)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
            ("TOPPADDING", (0, 1), (-1, -1), 4),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEBELOW", (0, 0), (-1, 0), 0, colors.transparent),
            ("LINEBELOW", (0, 1), (-1, -2), 0.3, colors.HexColor(BORDER)),
            ("BACKGROUND", (0, -1), (-1, -1), _alpha(header_color_hex, 0.14)),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor(header_color_hex)),
            ("LINEABOVE", (0, -1), (-1, -1), 0.6, _alpha(header_color_hex, 0.45)),
            ("TOPPADDING", (0, -1), (-1, -1), 6),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
        ])
        # Filas alternas con tinte muy suave del color de sección
        for i in range(1, len(data) - 1):
            if i % 2 == 0:
                style.add("BACKGROUND", (0, i), (-1, i), _alpha(header_color_hex, 0.05))
        tbl.setStyle(style)
        return tbl

    tbl_perc = _mk_table("Percepciones", percepciones, "Total percepciones", total_perc, GREEN)
    tbl_ded = _mk_table("Deducciones", deducciones, "Total deducciones", total_ded, RED)
    tbl_perc.wrapOn(c, W, H)
    tbl_ded.wrapOn(c, W, H)
    table_h = max(tbl_perc._height, tbl_ded._height)
    tbl_perc.drawOn(c, 12 * mm, y - tbl_perc._height)
    tbl_ded.drawOn(c, W / 2 + 4 * mm, y - tbl_ded._height)
    y -= table_h + 8 * mm

    # ── Neto a depositar (banda destacada, gradiente sólido + acento) ─────
    neto = float(detail.get("total_net", 0.0))
    neto_h = 17 * mm
    c.setFillColor(_alpha(GREEN, 0.12))
    c.rect(12 * mm, y - neto_h, W - 24 * mm, neto_h, fill=1, stroke=0)
    # Banda de acento izquierda
    c.setFillColor(colors.HexColor(GREEN))
    c.rect(12 * mm, y - neto_h, 3 * mm, neto_h, fill=1, stroke=0)
    c.setFillColor(colors.HexColor(GREEN))
    c.setFont("Helvetica-Bold", 11.5)
    c.drawString(20 * mm, y - 7 * mm, "NETO A DEPOSITAR")
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor(SLATE_500))
    c.drawString(20 * mm, y - 12 * mm, "Cantidad transferida al trabajador")
    c.setFillColor(colors.HexColor(GREEN))
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(W - 18 * mm, y - 11 * mm, _money(neto))
    y -= neto_h + 6 * mm

    # ── Datos de pago (banco/CLABE) — en su propia fila para que no se pierda ─
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 8)
    c.drawString(12 * mm, y, "Método de pago")
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 9)
    bank = employee.get("bank") or "—"
    clabe = employee.get("clabe") or "—"
    c.drawString(12 * mm + 22 * mm, y, f"Transferencia electrónica — {bank}  ·  CLABE: {clabe}")
    y -= 5 * mm

    # ── Cuotas patronales (secundario, informativo) ────────────────────────
    y -= 2 * mm
    _section_title("Cargas del patrón (informativas — no afectan el neto)", y)
    y -= 5.5 * mm
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica", 8.5)
    patronal = [
        f"IMSS patronal: {_money(detail.get('imss_employer', 0.0))}",
        f"INFONAVIT patronal (5% SBC): {_money(detail.get('infonavit_employer', 0.0))}",
    ]
    isn = detail.get("state_payroll_tax", 0.0)
    if isn:
        patronal.append(f"Impuesto sobre nómina estatal (ISN): {_money(isn)}")
    for line in patronal:
        c.drawString(12 * mm, y, line)
        y -= 4 * mm

    # Notas del capturista (si existen)
    note = (detail.get("notes") or "").strip()
    if note:
        y -= 2 * mm
        c.setFillColor(colors.HexColor(brand))
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(12 * mm, y, "Notas:")
        y -= 4 * mm
        c.setFillColor(colors.HexColor(SLATE_700))
        c.setFont("Helvetica-Oblique", 8)
        for line in [note[i:i + 110] for i in range(0, len(note), 110)][:3]:
            c.drawString(12 * mm, y, line)
            y -= 3.5 * mm

    # ── Firmas — SIEMPRE por encima del pie, con margen garantizado ────────
    # Nunca por debajo de 42mm (deja aire al footer que vive en 12mm).
    y_sign = max(y - 18 * mm, 42 * mm)
    c.setStrokeColor(colors.HexColor(SLATE_500))
    c.setLineWidth(0.6)
    c.line(28 * mm, y_sign, 92 * mm, y_sign)
    c.line(118 * mm, y_sign, 182 * mm, y_sign)
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 8.5)
    c.drawCentredString(60 * mm, y_sign - 4 * mm, "Recibí conforme (empleado)")
    c.drawCentredString(150 * mm, y_sign - 4 * mm, "Autoriza (patrón)")
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(60 * mm, y_sign - 8 * mm,
                          f"{employee.get('name', '')} {employee.get('last_name', '')}".strip())
    c.drawCentredString(150 * mm, y_sign - 8 * mm, company_name_str.title())

    # ── Pie: separado en DOS renglones para evitar el encimado ─────────────
    footer_note = (company.get("document_footer") or
                    "Este documento es el recibo administrativo interno. El CFDI 4.0 timbrado con "
                    "sello SAT se emite por separado al integrarse un PAC autorizado.")
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica-Oblique", 7)
    # Wrap manual a 130 chars para evitar overflow
    def _wrap(txt: str, width: int) -> List[str]:
        words = txt.split()
        lines, cur = [], ""
        for w in words:
            if len(cur) + len(w) + 1 <= width:
                cur = (cur + " " + w).strip()
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines[:2]  # máx 2 renglones

    wrapped = _wrap(footer_note, 130)
    footer_y = 15 * mm
    for i, line in enumerate(wrapped):
        c.drawString(12 * mm, footer_y - i * 3.2 * mm, line)
    # Timestamp abajo a la derecha
    c.setFont("Helvetica", 7)
    c.setFillColor(colors.HexColor(SLATE_500))
    c.drawRightString(W - 12 * mm, 15 * mm,
                        f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}   ·   Página 1 de 1")

    c.showPage()
    c.save()
    return buf.getvalue()


def build_receipts_zip(receipts: List[tuple[str, bytes]]) -> bytes:
    """Empaqueta múltiples PDFs en un ZIP. `receipts` = [(filename, bytes)]."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in receipts:
            zf.writestr(name, content)
    return buf.getvalue()
