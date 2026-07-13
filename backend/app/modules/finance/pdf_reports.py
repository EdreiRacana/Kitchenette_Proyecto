"""PDFs ejecutivos de cartera (CxC / CxP) para cobranza y pagos.

Formato tamaño LETTER (8.5x11) landscape para caber columnas amplias:
  - Header con logo + datos empresa + título + rango + fecha de emisión
  - Tabla por cliente (o proveedor) con antigüedad por columnas
  - Totales generales al pie
  - Colores semáforo para vencidos

Uso desde el router:
    pdf = build_cxc_pdf(company, items, generated_at)
"""
from __future__ import annotations
from io import BytesIO
from typing import List, Optional
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak,
)


def _mxn(n: float) -> str:
    return "$" + f"{(n or 0):,.2f}"


def _logo_source(company: dict):
    """Devuelve BytesIO del logo si existe (persistido en DB)."""
    b = company.get("logo_bytes")
    if b:
        try:
            return BytesIO(b)
        except Exception:
            return None
    import os as _os
    p = company.get("logo_path")
    if p and _os.path.exists(p) and not p.lower().endswith(".svg"):
        return p
    return None


def _company_header(company: dict, title: str, subtitle: str) -> Table:
    """Header estándar con logo + empresa + título."""
    brand = colors.HexColor(company.get("brand_color") or "#33B2F5")
    logo_cell = ""
    src = _logo_source(company)
    if src is not None:
        try:
            logo_cell = Image(src, width=38 * mm, height=16 * mm, kind="proportional")
        except Exception:
            logo_cell = ""

    empresa_lines = []
    if company.get("commercial_name"):
        empresa_lines.append(f"<b>{company['commercial_name']}</b>")
    if company.get("legal_name") and company.get("legal_name") != company.get("commercial_name"):
        empresa_lines.append(company["legal_name"])
    if company.get("tax_id"):
        empresa_lines.append(f"RFC: {company['tax_id']}")

    p_empresa = Paragraph("<br/>".join(empresa_lines), ParagraphStyle(
        name="emp", fontName="Helvetica", fontSize=9, leading=11, textColor=colors.HexColor("#111827"),
    ))

    p_titulo = Paragraph(
        f"<font size='16' color='{company.get('brand_color') or '#33B2F5'}'><b>{title}</b></font>"
        f"<br/><font size='9' color='#64748B'>{subtitle}</font>",
        ParagraphStyle(name="tit", alignment=TA_RIGHT, leading=13),
    )
    header = Table([[logo_cell, p_empresa, p_titulo]], colWidths=[42 * mm, 100 * mm, 96 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, brand),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ]))
    return header


def build_aging_pdf(company: dict, items: list[dict], *,
                    title: str = "Estado de cartera — Cuentas por cobrar",
                    kind: str = "cxc",
                    generated_at: Optional[datetime] = None) -> bytes:
    """Genera PDF de aging de cartera (CxC o CxP).
    `items` es la lista que retorna get_cxc/get_cxp: cada item tiene
        {name, reference, total, paid, balance, due_date, aging, status}
    """
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(LETTER),
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title=title,
    )
    story = []

    gen_at = generated_at or datetime.utcnow()
    subtitle = ("Cuentas por cobrar" if kind == "cxc" else "Cuentas por pagar") + \
        " · Generado " + gen_at.strftime("%d/%m/%Y %H:%M")
    story.append(_company_header(company, title, subtitle))
    story.append(Spacer(1, 6 * mm))

    # Agrupar por cliente/proveedor
    by_name: dict = {}
    for it in items:
        key = it.get("name") or "Sin nombre"
        by_name.setdefault(key, []).append(it)

    # Totales por bucket
    bucket_totals = {"current": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    grand_total = 0.0

    # Cabecera de tabla
    headers = ["#", "Nombre", "Referencia", "Vence", "Total", "Pagado", "Saldo", "Antigüedad"]
    rows: list[list] = [headers]

    idx = 0
    for name in sorted(by_name.keys()):
        for it in by_name[name]:
            idx += 1
            balance = float(it.get("balance") or 0.0)
            grand_total += balance
            aging = it.get("aging") or "current"
            bucket_totals[aging] = bucket_totals.get(aging, 0.0) + balance
            due = it.get("due_date")
            due_str = due.strftime("%d/%m/%y") if hasattr(due, "strftime") else (due[:10] if isinstance(due, str) else "—")
            aging_label = {
                "current": "Al corriente", "1-30": "1-30 días", "31-60": "31-60 días",
                "61-90": "61-90 días", "90+": "+90 días",
            }.get(aging, aging)
            rows.append([
                str(idx),
                name[:38],
                (it.get("reference") or "—")[:14],
                due_str,
                _mxn(float(it.get("total") or 0.0)),
                _mxn(float(it.get("paid") or 0.0)),
                _mxn(balance),
                aging_label,
            ])

    # Fila de totales por bucket
    rows.append([
        "", "", "", "TOTAL",
        "", "",
        _mxn(grand_total),
        f"Vencido: {_mxn(sum(v for k, v in bucket_totals.items() if k != 'current'))}",
    ])

    tbl = Table(rows, colWidths=[8*mm, 68*mm, 26*mm, 20*mm, 30*mm, 30*mm, 32*mm, 30*mm], repeatRows=1)
    ts = TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, 0), 9),
        ("ALIGN",      (0, 0), (-1, 0), "CENTER"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        # Body
        ("FONTSIZE",   (0, 1), (-1, -2), 8.5),
        ("VALIGN",     (0, 1), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F8FAFC")]),
        ("ALIGN",      (0, 1), (0, -1), "CENTER"),
        ("ALIGN",      (4, 1), (6, -1), "RIGHT"),
        ("FONTNAME",   (6, 1), (6, -2), "Helvetica-Bold"),
        # Totales
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME",   (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",   (0, -1), (-1, -1), 9.5),
        ("LINEABOVE",  (0, -1), (-1, -1), 1.2, colors.HexColor("#1E3A8A")),
        # Grid
        ("LINEBELOW",  (0, 0), (-1, 0), 0.4, colors.HexColor("#94A3B8")),
        ("LINEBELOW",  (0, 1), (-1, -2), 0.3, colors.HexColor("#E5E7EB")),
    ])
    # Colorear filas por antigüedad
    for i, r in enumerate(rows[1:-1], start=1):
        aging_label = r[7]
        if "+90" in aging_label:
            ts.add("BACKGROUND", (7, i), (7, i), colors.HexColor("#FEE2E2"))
            ts.add("TEXTCOLOR",  (7, i), (7, i), colors.HexColor("#B91C1C"))
        elif "61-90" in aging_label:
            ts.add("BACKGROUND", (7, i), (7, i), colors.HexColor("#FED7AA"))
            ts.add("TEXTCOLOR",  (7, i), (7, i), colors.HexColor("#C2410C"))
        elif "31-60" in aging_label or "1-30" in aging_label:
            ts.add("BACKGROUND", (7, i), (7, i), colors.HexColor("#FEF3C7"))
            ts.add("TEXTCOLOR",  (7, i), (7, i), colors.HexColor("#A16207"))
        else:
            ts.add("BACKGROUND", (7, i), (7, i), colors.HexColor("#D1FAE5"))
            ts.add("TEXTCOLOR",  (7, i), (7, i), colors.HexColor("#065F46"))
    tbl.setStyle(ts)
    story.append(tbl)
    story.append(Spacer(1, 8 * mm))

    # Resumen por antigüedad
    story.append(Paragraph(
        f"<font size='11' color='#1E3A8A'><b>Resumen por antigüedad</b></font>",
        ParagraphStyle(name="sect", fontSize=11, spaceAfter=6),
    ))
    summary_rows = [["Bucket", "Monto", "% del total"]]
    for k, label in [("current", "Al corriente"), ("1-30", "1-30 días"), ("31-60", "31-60 días"),
                     ("61-90", "61-90 días"), ("90+", "+90 días")]:
        amt = bucket_totals.get(k, 0.0)
        pct = (amt / grand_total * 100) if grand_total > 0 else 0
        summary_rows.append([label, _mxn(amt), f"{pct:.1f}%"])
    summary_rows.append(["TOTAL", _mxn(grand_total), "100.0%"])
    st = Table(summary_rows, colWidths=[50*mm, 40*mm, 30*mm])
    st.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("ALIGN",      (1, 0), (-1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME",   (0, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEBELOW",  (0, 0), (-1, -2), 0.3, colors.HexColor("#E5E7EB")),
    ]))
    story.append(st)

    # Footer
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        f"<font size='8' color='#94A3B8'>Documento generado por Sthenova ERP · "
        f"{len(items)} registros analizados · "
        f"{gen_at.strftime('%d/%m/%Y %H:%M')}</font>",
        ParagraphStyle(name="foot", alignment=TA_CENTER),
    ))

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf
