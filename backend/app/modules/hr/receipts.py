"""Recibos de nómina en PDF.

Generador profesional con reportlab. Incluye el desglose completo de
percepciones, deducciones, cuotas patronales (informativas para transparencia)
y firma. Usa el nombre de la empresa desde `core_config.CompanyProfile`.

Nota: este PDF NO sustituye al CFDI de nómina timbrado por un PAC — es el
recibo administrativo interno. Cuando se integre timbrado CFDI 4.0, este
mismo recibo llevará el UUID y el sello del SAT.
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
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle


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


def build_receipt_pdf(
    employee: dict,
    period: dict,
    detail: dict,
    company_name: str = "STHENOVA ERP",
    company_rfc: Optional[str] = None,
) -> bytes:
    """Genera el PDF del recibo de un empleado en un período dado."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    W, H = LETTER

    # ── Encabezado ─────────────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#0E1838"))
    c.rect(0, H - 25 * mm, W, 25 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(15 * mm, H - 13 * mm, company_name.upper())
    c.setFont("Helvetica", 9)
    if company_rfc:
        c.drawString(15 * mm, H - 19 * mm, f"RFC: {company_rfc}")
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 15 * mm, H - 13 * mm, "RECIBO DE NÓMINA")
    c.setFont("Helvetica", 9)
    kind = period.get("kind", "regular")
    kind_label = {
        "regular": "Ordinaria",
        "aguinaldo": "Aguinaldo",
        "prima_vacacional": "Prima vacacional",
        "finiquito": "Finiquito",
    }.get(kind, kind.title())
    c.drawRightString(W - 15 * mm, H - 19 * mm, f"Tipo: {kind_label}")

    # ── Datos del empleado y período ───────────────────────────────────────
    y = H - 35 * mm
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(15 * mm, y, "Datos del empleado")
    c.setFont("Helvetica", 9)
    y -= 5 * mm

    info_left = [
        ("No. empleado:", _safe(employee.get("employee_number"))),
        ("Nombre:", _safe(f"{employee.get('name', '')} {employee.get('last_name', '')}").strip() or "—"),
        ("Puesto:", _safe(employee.get("position"))),
        ("Departamento:", _safe(employee.get("department"))),
        ("RFC:", _safe(employee.get("rfc"))),
        ("CURP:", _safe(employee.get("curp"))),
        ("NSS:", _safe(employee.get("nss"))),
    ]
    info_right = [
        ("Período:", _safe(period.get("name"))),
        ("Frecuencia:", _safe(period.get("frequency")).title()),
        ("Fecha inicio:", _to_date(period.get("start_date"))),
        ("Fecha fin:", _to_date(period.get("end_date"))),
        ("Fecha pago:", _to_date(period.get("payment_date"))),
        ("Días trabajados:", f"{detail.get('days_worked', 0):g}"),
        ("Días faltas:", f"{detail.get('days_absent', 0):g}"),
    ]
    left_x = 15 * mm
    right_x = 108 * mm

    for i in range(max(len(info_left), len(info_right))):
        yy = y - i * 4.2 * mm
        if i < len(info_left):
            c.setFont("Helvetica-Bold", 8.5)
            c.drawString(left_x, yy, info_left[i][0])
            c.setFont("Helvetica", 9)
            c.drawString(left_x + 30 * mm, yy, info_left[i][1])
        if i < len(info_right):
            c.setFont("Helvetica-Bold", 8.5)
            c.drawString(right_x, yy, info_right[i][0])
            c.setFont("Helvetica", 9)
            c.drawString(right_x + 30 * mm, yy, info_right[i][1])
    y -= (max(len(info_left), len(info_right)) + 1) * 4.2 * mm

    # ── Tabla de percepciones y deducciones ──────────────────────────────
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
        ("Otros préstamos", detail.get("loan_deduction", 0.0)),
    ]

    percepciones = [(k, v) for k, v in percepciones if v]
    deducciones = [(k, v) for k, v in deducciones if v]

    total_perc = sum(v for _k, v in percepciones)
    total_ded = sum(v for _k, v in deducciones)

    styles = getSampleStyleSheet()
    header_style = ParagraphStyle(
        "hdr", parent=styles["Normal"],
        fontName="Helvetica-Bold", fontSize=9, textColor=colors.white,
        alignment=1,
    )

    def _mk_table(title: str, rows: list, total_label: str, total_value: float, header_color: str):
        data = [[title, "Importe"]]
        for k, v in rows:
            data.append([k, _money(v)])
        data.append([total_label, _money(total_value)])
        tbl = Table(data, colWidths=[62 * mm, 26 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(header_color)),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
            ("TOPPADDING", (0, 0), (-1, 0), 5),
            ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F1F5F9")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ]))
        return tbl

    tbl_perc = _mk_table("Percepciones", percepciones, "Total percepciones", total_perc, "#0F9D70")
    tbl_ded = _mk_table("Deducciones", deducciones, "Total deducciones", total_ded, "#DC2626")

    tbl_perc.wrapOn(c, W, H)
    tbl_ded.wrapOn(c, W, H)
    tbl_perc.drawOn(c, 15 * mm, y - tbl_perc._height - 4 * mm)
    tbl_ded.drawOn(c, 108 * mm, y - tbl_ded._height - 4 * mm)

    y -= max(tbl_perc._height, tbl_ded._height) + 10 * mm

    # ── Neto a pagar ──────────────────────────────────────────────────────
    neto = float(detail.get("total_net", 0.0))
    c.setFillColor(colors.HexColor("#0F9D70"))
    c.rect(15 * mm, y - 18 * mm, W - 30 * mm, 15 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, y - 10 * mm, "NETO A DEPOSITAR")
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(W - 20 * mm, y - 11 * mm, _money(neto))

    y -= 25 * mm

    # ── Cuotas patronales (informativas) ─────────────────────────────────
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(15 * mm, y, "Cargas del patrón (informativas — no afectan el neto)")
    y -= 5 * mm
    c.setFont("Helvetica", 8.5)
    patronal = [
        f"IMSS patronal: {_money(detail.get('imss_employer', 0.0))}",
        f"INFONAVIT patronal (5% SBC): {_money(detail.get('infonavit_employer', 0.0))}",
    ]
    isn = detail.get("state_payroll_tax", 0.0)
    if isn:
        patronal.append(f"Impuesto sobre nómina estatal (ISN): {_money(isn)}")
    for line in patronal:
        c.drawString(15 * mm, y, line)
        y -= 4 * mm

    # Notas del capturista (justifica bonos, préstamos, etc.)
    note = (detail.get("notes") or "").strip()
    if note:
        y -= 2 * mm
        c.setFont("Helvetica-Bold", 8.5)
        c.setFillColor(colors.HexColor("#0E1838"))
        c.drawString(15 * mm, y, "Notas:")
        y -= 4 * mm
        c.setFont("Helvetica-Oblique", 8)
        c.setFillColor(colors.HexColor("#475569"))
        # Wrap sencillo a 100 chars
        for line in [note[i:i + 100] for i in range(0, len(note), 100)][:3]:
            c.drawString(15 * mm, y, line)
            y -= 3.5 * mm

    # ── Banco y CLABE ─────────────────────────────────────────────────────
    y -= 4 * mm
    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica-Bold", 8.5)
    bank = employee.get("bank") or "—"
    clabe = employee.get("clabe") or "—"
    c.drawString(15 * mm, y, f"Depósito: {bank}   ·   CLABE: {clabe}")

    # ── Firma ─────────────────────────────────────────────────────────────
    y_sign = 30 * mm
    c.setStrokeColor(colors.HexColor("#0E1838"))
    c.line(30 * mm, y_sign, 90 * mm, y_sign)
    c.line(120 * mm, y_sign, 180 * mm, y_sign)
    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 8.5)
    c.drawCentredString(60 * mm, y_sign - 4 * mm, "Recibí conforme (empleado)")
    c.drawCentredString(150 * mm, y_sign - 4 * mm, "Autoriza")

    # ── Pie ──────────────────────────────────────────────────────────────
    c.setFont("Helvetica-Oblique", 7.5)
    c.setFillColor(colors.HexColor("#94A3B8"))
    c.drawString(
        15 * mm, 15 * mm,
        "Este documento es el recibo administrativo interno. El CFDI 4.0 timbrado con "
        "sello SAT se emite por separado al integrarse un PAC autorizado.",
    )
    c.drawRightString(W - 15 * mm, 15 * mm, f"Generado: {datetime.now().strftime('%d/%m/%Y %H:%M')}")

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
