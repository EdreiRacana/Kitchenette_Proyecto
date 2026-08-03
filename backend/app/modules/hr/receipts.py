"""Recibos de nómina en PDF — diseño premium multi-empresa.

Header con gradiente vertical (color de marca abajo → transparente arriba),
logo alojado correctamente dentro del header, subfila con Tipo/Folio debajo
de la línea del header. Tablas con contorno sólido de color + fondo tenue
translúcido + esquinas redondeadas. Bloque de "NETO A DEPOSITAR" también
redondeado con acento lateral.

Nota: este PDF NO sustituye al CFDI 4.0 timbrado por un PAC — es el recibo
administrativo interno. Cuando se integre timbrado, este mismo recibo
llevará el UUID y sello del SAT.
"""

from __future__ import annotations

import io
import re
import zipfile
from datetime import date, datetime
from typing import List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle


# ── Utilidades ────────────────────────────────────────────────────────────
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


_HEX_RE = re.compile(r"^#?[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$")


def _safe_hex(value: Optional[str], fallback: str = "#0E1838") -> str:
    """Regresa un color hex válido (#RRGGBB) o el fallback."""
    if not value or not isinstance(value, str):
        return fallback
    v = value.strip()
    if not _HEX_RE.match(v):
        return fallback
    return v if v.startswith("#") else f"#{v}"


def _alpha(hex_color: str, alpha: float) -> colors.Color:
    """'#RRGGBB' → Color con alpha (0..1). Tolera hex inválido."""
    h = _safe_hex(hex_color).lstrip("#")
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
SLATE_400 = "#94A3B8"
SLATE_500 = "#64748B"
SLATE_600 = "#475569"
SLATE_700 = "#334155"
SLATE_900 = "#0F172A"


def _draw_gradient_band(c: canvas.Canvas, x: float, y_bottom: float,
                         w: float, h: float, hex_color: str,
                         alpha_bottom: float = 1.0, alpha_top: float = 0.0,
                         steps: int = 40) -> None:
    """Dibuja una banda con gradiente vertical (color abajo → transparente
    arriba). ReportLab no tiene gradientes nativos simples: aproximamos
    con `steps` bandas horizontales de alpha decreciente."""
    for i in range(steps):
        f = i / (steps - 1)
        a = alpha_bottom + (alpha_top - alpha_bottom) * f
        if a < 0.01:
            continue
        c.setFillColor(_alpha(hex_color, a))
        band_h = h / steps + 0.6   # solape para evitar líneas visibles
        c.rect(x, y_bottom + i * (h / steps), w, band_h, fill=1, stroke=0)


def _draw_logo(c: canvas.Canvas, logo_bytes: Optional[bytes],
                 x: float, y_bottom: float, box_w: float, box_h: float) -> float:
    """Dibuja el logo DENTRO del rectángulo (x, y_bottom, box_w, box_h)
    respetando aspect ratio y centrado verticalmente. Regresa el ancho
    real que ocupó (0 si no dibujó)."""
    if not logo_bytes:
        return 0.0
    try:
        img = ImageReader(io.BytesIO(logo_bytes))
        iw, ih = img.getSize()
        ratio = min(box_w / iw, box_h / ih)
        w = iw * ratio
        h = ih * ratio
        # Centrar verticalmente en la caja
        y = y_bottom + (box_h - h) / 2
        c.drawImage(img, x, y, width=w, height=h, mask="auto",
                    preserveAspectRatio=True)
        return w
    except Exception:
        return 0.0


def _rounded_border_box(c: canvas.Canvas, x: float, y_bottom: float,
                          w: float, h: float, radius: float,
                          border_color: colors.Color,
                          fill_color: Optional[colors.Color] = None,
                          border_width: float = 0.9) -> None:
    """Dibuja un rectángulo con esquinas redondeadas: borde sólido y fill
    opcional (traslúcido)."""
    if fill_color is not None:
        c.setFillColor(fill_color)
        c.setStrokeColor(border_color)
        c.setLineWidth(border_width)
        c.roundRect(x, y_bottom, w, h, radius, stroke=1, fill=1)
    else:
        c.setStrokeColor(border_color)
        c.setLineWidth(border_width)
        c.roundRect(x, y_bottom, w, h, radius, stroke=1, fill=0)


def _wrap(txt: str, width: int, max_lines: int = 2) -> List[str]:
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
    return lines[:max_lines]


def build_receipt_pdf(
    employee: dict,
    period: dict,
    detail: dict,
    company: Optional[dict] = None,
    company_name: Optional[str] = None,
    company_rfc: Optional[str] = None,
) -> bytes:
    """Genera el PDF del recibo de un empleado en un período dado."""
    if company is None:
        company = {}
    if company_name and not company.get("name"):
        company["name"] = company_name
    if company_rfc and not company.get("rfc"):
        company["rfc"] = company_rfc

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    W, H = LETTER

    brand = _safe_hex(company.get("brand_color"), NAVY)
    # Color gris institucional para el header (neutro, profesional, no invasivo)
    HDR_GREY = "#64748B"    # slate-500

    # ═══════════════════════════════════════════════════════════════════════
    # HEADER — Compacto, tipografía reducida a estándar profesional
    # ═══════════════════════════════════════════════════════════════════════
    HDR_H = 24 * mm                              # antes 34mm — más compacto
    hdr_y = H - HDR_H

    # Fondo gris uniforme translúcido (10% opaco = 90% traslúcido)
    c.setFillColor(_alpha(HDR_GREY, 0.08))
    c.rect(0, hdr_y, W, HDR_H, fill=1, stroke=0)

    # Línea sutil de separación abajo del header
    c.setStrokeColor(_alpha(HDR_GREY, 0.30))
    c.setLineWidth(0.5)
    c.line(0, hdr_y, W, hdr_y)

    # Fondo blanco opaco redondeado detrás del logo
    LOGO_BOX_W, LOGO_BOX_H = 18 * mm, HDR_H - 6 * mm
    LOGO_X, LOGO_Y = 12 * mm, hdr_y + 3 * mm
    if company.get("logo_bytes"):
        pad = 1.5 * mm
        c.setFillColor(colors.white)
        c.setStrokeColor(_alpha(HDR_GREY, 0.25))
        c.setLineWidth(0.4)
        c.roundRect(LOGO_X - pad, LOGO_Y - pad,
                    LOGO_BOX_W + 2 * pad, LOGO_BOX_H + 2 * pad,
                    2.5, stroke=1, fill=1)

    logo_w = _draw_logo(
        c, company.get("logo_bytes"),
        x=LOGO_X, y_bottom=LOGO_Y,
        box_w=LOGO_BOX_W, box_h=LOGO_BOX_H,
    )
    text_x = 12 * mm + (logo_w + 6 * mm if logo_w > 0 else 0)

    company_name_str = (company.get("commercial_name") or company.get("name") or "EMPRESA").upper()

    # Nombre / razón social — reducido de 15pt a 11pt
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(text_x, hdr_y + HDR_H - 8 * mm, company_name_str[:60])

    if (company.get("commercial_name") and company.get("name")
            and company["commercial_name"] != company["name"]):
        c.setFont("Helvetica", 8.5)
        c.setFillColor(colors.HexColor(SLATE_600))
        c.drawString(text_x, hdr_y + HDR_H - 16.5 * mm, company["name"][:80])

    contact_parts = []
    if company.get("rfc"):
        contact_parts.append(f"RFC: {company['rfc']}")
    if company.get("address"):
        addr = company["address"]
        contact_parts.append(addr[:70] + ("…" if len(addr) > 70 else ""))
    if company.get("email"):
        contact_parts.append(company["email"])
    if company.get("phone"):
        contact_parts.append(f"Tel. {company['phone']}")
    c.setFont("Helvetica", 6.8)
    c.setFillColor(colors.HexColor(SLATE_600))
    contact_line = "  ·  ".join(contact_parts)
    if contact_line:
        c.drawString(text_x, hdr_y + 3 * mm, contact_line[:150])

    # Título derecha — reducido de 13pt a 10.5pt
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 10.5)
    c.drawRightString(W - 12 * mm, hdr_y + HDR_H - 8 * mm, "RECIBO DE NÓMINA")

    # ═══════════════════════════════════════════════════════════════════════
    # SUBFILA DEBAJO DEL HEADER — Tipo · Folio
    # ═══════════════════════════════════════════════════════════════════════
    sub_y = hdr_y - 6 * mm
    kind = period.get("kind", "regular")
    kind_label = {
        "regular": "Ordinaria",
        "aguinaldo": "Aguinaldo",
        "prima_vacacional": "Prima vacacional",
        "finiquito": "Finiquito",
    }.get(kind, kind.title())

    # Chip TIPO reducido
    chip_w = 34 * mm
    _rounded_border_box(
        c, x=12 * mm, y_bottom=sub_y - 1.2 * mm, w=chip_w, h=5 * mm,
        radius=2, border_color=_alpha(HDR_GREY, 0.55),
        fill_color=None,
    )
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 6.8)
    c.drawString(12 * mm + 2.5 * mm, sub_y + 0.5 * mm, "TIPO")
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica", 7.8)
    c.drawString(12 * mm + 12 * mm, sub_y + 0.5 * mm, kind_label)

    # Folio a la derecha
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 6.8)
    c.drawRightString(W - 12 * mm, sub_y + 2.5 * mm, "FOLIO INTERNO")
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(W - 12 * mm, sub_y - 1 * mm, _safe(period.get("name"))[:60])

    y = sub_y - 10 * mm

    # ═══════════════════════════════════════════════════════════════════════
    # SECCIÓN: Datos del empleado y período
    # ═══════════════════════════════════════════════════════════════════════
    def _section_title(txt: str, yy: float):
        c.setFillColor(colors.HexColor(SLATE_700))
        c.setFont("Helvetica-Bold", 8)   # reducido de 9.5pt
        c.drawString(12 * mm, yy, txt.upper())
        c.setStrokeColor(_alpha(HDR_GREY, 0.35))
        c.setLineWidth(0.4)
        c.line(12 * mm, yy - 1.2 * mm, W - 12 * mm, yy - 1.2 * mm)

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

    row_h = 3.8 * mm
    label_col_w = 28 * mm
    left_x = 12 * mm
    right_x = W / 2 + 4 * mm

    for i in range(max(len(info_left), len(info_right))):
        yy = y - i * row_h
        if i < len(info_left):
            c.setFillColor(colors.HexColor(SLATE_500))
            c.setFont("Helvetica", 6.8)
            c.drawString(left_x, yy, info_left[i][0])
            c.setFillColor(colors.HexColor(SLATE_700))
            c.setFont("Helvetica-Bold", 7.8)
            c.drawString(left_x + label_col_w, yy, info_left[i][1])
        if i < len(info_right):
            c.setFillColor(colors.HexColor(SLATE_500))
            c.setFont("Helvetica", 6.8)
            c.drawString(right_x, yy, info_right[i][0])
            c.setFillColor(colors.HexColor(SLATE_700))
            c.setFont("Helvetica-Bold", 7.8)
            c.drawString(right_x + label_col_w, yy, info_right[i][1])
    y -= max(len(info_left), len(info_right)) * row_h + 5 * mm

    # ═══════════════════════════════════════════════════════════════════════
    # TABLAS de percepciones y deducciones
    # Diseño: rectángulo redondeado con contorno sólido de color + fondo
    # muy tenue traslúcido. Header sin fill sólido — solo texto colorido.
    # ═══════════════════════════════════════════════════════════════════════
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

    tbl_w = (W - 24 * mm) / 2 - 2 * mm    # dos tablas lado a lado con gap
    tbl_x_perc = 12 * mm
    tbl_x_ded = 12 * mm + tbl_w + 4 * mm

    def _mk_table(title: str, rows: list, total_label: str, total_value: float,
                    color_hex: str) -> Tuple[Table, float]:
        # Tabla interna con estilos SIN bordes (los bordes los dibujamos
        # como rounded rect afuera). Header: texto en color, fondo transparente.
        data = [[title, "IMPORTE"]]
        for k, v in rows:
            data.append([k, _money(v)])
        data.append([total_label, _money(total_value)])
        col1 = tbl_w * 0.65
        col2 = tbl_w - col1
        tbl = Table(data, colWidths=[col1, col2])
        style = TableStyle([
            # Header — sin fondo, solo texto colorido y negrita
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 7.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(color_hex)),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
            ("TOPPADDING", (0, 0), (-1, 0), 5),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, _alpha(color_hex, 0.35)),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            # Cuerpo
            ("FONTNAME", (0, 1), (-1, -2), "Helvetica"),
            ("FONTSIZE", (0, 1), (-1, -1), 7.2),
            ("TEXTCOLOR", (0, 1), (0, -2), colors.HexColor(SLATE_700)),
            ("TEXTCOLOR", (1, 1), (1, -2), colors.HexColor(SLATE_900)),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("BOTTOMPADDING", (0, 1), (-1, -2), 3),
            ("TOPPADDING", (0, 1), (-1, -2), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            # Total — separado con línea sutil, texto en color
            ("LINEABOVE", (0, -1), (-1, -1), 0.6, _alpha(color_hex, 0.40)),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, -1), (-1, -1), 8),
            ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor(color_hex)),
            ("TOPPADDING", (0, -1), (-1, -1), 4.5),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 5),
        ])
        # Sin filas alternas — solo texto sobre transparente
        tbl.setStyle(style)
        tbl.wrapOn(c, tbl_w, H)
        return tbl, tbl._height

    tbl_perc, h_perc = _mk_table("PERCEPCIONES", percepciones,
                                     "Total percepciones", total_perc, GREEN)
    tbl_ded, h_ded = _mk_table("DEDUCCIONES", deducciones,
                                   "Total deducciones", total_ded, RED)
    table_h = max(h_perc, h_ded)

    # Solo BORDE exterior redondeado — sin fondo interior
    _rounded_border_box(
        c, x=tbl_x_perc, y_bottom=y - table_h, w=tbl_w, h=table_h,
        radius=4, border_color=_alpha(GREEN, 0.65),
        fill_color=None, border_width=1.0,
    )
    _rounded_border_box(
        c, x=tbl_x_ded, y_bottom=y - table_h, w=tbl_w, h=table_h,
        radius=4, border_color=_alpha(RED, 0.65),
        fill_color=None, border_width=1.0,
    )
    tbl_perc.drawOn(c, tbl_x_perc, y - h_perc)
    tbl_ded.drawOn(c, tbl_x_ded, y - h_ded)
    y -= table_h + 6 * mm

    # ═══════════════════════════════════════════════════════════════════════
    # NETO A DEPOSITAR — patrón de puntos anti-falsificación + borde sólido
    # ═══════════════════════════════════════════════════════════════════════
    neto = float(detail.get("total_net", 0.0))
    neto_h = 13 * mm
    neto_x = 12 * mm
    neto_w = W - 24 * mm

    # Recuadro exterior con borde verde y SIN fondo (para poner puntos dentro)
    _rounded_border_box(
        c, x=neto_x, y_bottom=y - neto_h, w=neto_w, h=neto_h,
        radius=6, border_color=_alpha(GREEN, 0.6),
        fill_color=None, border_width=1.0,
    )

    # Patrón de puntos verdes tenues como marca anti-falsificación (guilloché).
    # Rejilla regular con offset alternado. Los puntos ocupan todo el
    # recuadro pero son suficientemente tenues para no estorbar la lectura.
    c.setFillColor(_alpha(GREEN, 0.28))
    dot_r = 0.4
    dot_spacing = 2.0 * mm
    rows_n = int(neto_h / dot_spacing)
    cols_n = int(neto_w / dot_spacing)
    for ri in range(rows_n + 1):
        for ci in range(cols_n + 1):
            offset = (dot_spacing / 2) if ri % 2 else 0
            px = neto_x + ci * dot_spacing + offset
            py = (y - neto_h) + ri * dot_spacing
            # Mantener dentro del recuadro (con margen para no encimar el borde)
            if (px < neto_x + 1 or px > neto_x + neto_w - 1 or
                    py < (y - neto_h) + 1 or py > y - 1):
                continue
            c.circle(px, py, dot_r, stroke=0, fill=1)

    # Acento vertical izquierdo (barra sólida) — sobrepintado encima de los puntos
    c.setFillColor(colors.HexColor(GREEN))
    c.roundRect(neto_x, y - neto_h, 2.4 * mm, neto_h, 1.2, stroke=0, fill=1)

    # Texto — se dibuja al final para que quede sobre los puntos y sea legible
    c.setFillColor(colors.HexColor(GREEN))
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(18 * mm, y - 5.5 * mm, "NETO A DEPOSITAR")
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 6.5)
    c.drawString(18 * mm, y - 9.5 * mm, "Cantidad transferida al trabajador")
    c.setFillColor(colors.HexColor(GREEN))
    c.setFont("Helvetica-Bold", 15)
    c.drawRightString(W - 15 * mm, y - 8.5 * mm, _money(neto))
    y -= neto_h + 5 * mm

    # ═══════════════════════════════════════════════════════════════════════
    # Método de pago + cargas del patrón
    # ═══════════════════════════════════════════════════════════════════════
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 6.8)
    c.drawString(12 * mm, y, "Método de pago")
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 7.5)
    bank = employee.get("bank") or "—"
    clabe = employee.get("clabe") or "—"
    c.drawString(12 * mm + 20 * mm, y,
                    f"Transferencia electrónica — {bank}  ·  CLABE: {clabe}")
    y -= 5 * mm

    _section_title("Cargas del patrón (informativas — no afectan el neto)", y)
    y -= 4.5 * mm
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica", 7.2)
    patronal = [
        f"IMSS patronal: {_money(detail.get('imss_employer', 0.0))}",
        f"INFONAVIT patronal (5% SBC): {_money(detail.get('infonavit_employer', 0.0))}",
    ]
    isn = detail.get("state_payroll_tax", 0.0)
    if isn:
        patronal.append(f"Impuesto sobre nómina estatal (ISN): {_money(isn)}")
    for line in patronal:
        c.drawString(12 * mm, y, line)
        y -= 3.3 * mm

    # Notas del capturista
    note = (detail.get("notes") or "").strip()
    if note:
        y -= 1.5 * mm
        c.setFillColor(colors.HexColor(brand))
        c.setFont("Helvetica-Bold", 7.2)
        c.drawString(12 * mm, y, "Notas:")
        y -= 3.3 * mm
        c.setFillColor(colors.HexColor(SLATE_700))
        c.setFont("Helvetica-Oblique", 6.8)
        for line in [note[i:i + 130] for i in range(0, len(note), 130)][:3]:
            c.drawString(12 * mm, y, line)
            y -= 3 * mm

    # ═══════════════════════════════════════════════════════════════════════
    # Firmas — por encima del pie con margen garantizado
    # ═══════════════════════════════════════════════════════════════════════
    y_sign = max(y - 13 * mm, 40 * mm)
    c.setStrokeColor(colors.HexColor(SLATE_400))
    c.setLineWidth(0.4)
    c.line(28 * mm, y_sign, 92 * mm, y_sign)
    c.line(118 * mm, y_sign, 182 * mm, y_sign)
    c.setFillColor(colors.HexColor(SLATE_700))
    c.setFont("Helvetica-Bold", 7.2)
    c.drawCentredString(60 * mm, y_sign - 3.3 * mm, "Recibí conforme (empleado)")
    c.drawCentredString(150 * mm, y_sign - 3.3 * mm, "Autoriza (patrón)")
    c.setFillColor(colors.HexColor(SLATE_500))
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(60 * mm, y_sign - 6.5 * mm,
                          f"{employee.get('name', '')} {employee.get('last_name', '')}".strip())
    c.drawCentredString(150 * mm, y_sign - 6.5 * mm, company_name_str.title())

    # ═══════════════════════════════════════════════════════════════════════
    # Pie — timestamp arriba, divider, texto legal debajo (sin encimados)
    # ═══════════════════════════════════════════════════════════════════════
    c.setFont("Helvetica", 6.2)
    c.setFillColor(colors.HexColor(SLATE_500))
    c.drawRightString(
        W - 12 * mm, 18 * mm,
        f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}   ·   Página 1 de 1",
    )
    c.setStrokeColor(_alpha(SLATE_500, 0.25))
    c.setLineWidth(0.35)
    c.line(12 * mm, 16 * mm, W - 12 * mm, 16 * mm)

    footer_note = (company.get("document_footer") or
                    "Este documento es el recibo administrativo interno. El CFDI 4.0 timbrado con "
                    "sello SAT se emite por separado al integrarse un PAC autorizado.")
    c.setFont("Helvetica-Oblique", 6.2)
    c.setFillColor(colors.HexColor(SLATE_500))
    for i, line in enumerate(_wrap(footer_note, 155, 2)):
        c.drawString(12 * mm, 13 * mm - i * 2.8 * mm, line)

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
