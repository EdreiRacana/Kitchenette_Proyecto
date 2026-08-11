"""Kardex del empleado — expediente laboral completo.

Consolida en una sola vista todo el histórico laboral, de nómina y de
descuentos de un empleado. Es el documento estándar de RH en México
(equivalente al "expediente" que exige la STPS ante inspecciones).

Estructura:
  1. Datos personales + fiscales (Employee)
  2. Datos laborales actuales (puesto, depto, sueldo, contrato)
  3. Historial de nómina del año/rango: percepciones y deducciones
  4. Ausentismo: faltas, retardos, permisos
  5. Incapacidades: fechas, subtipo, folio IMSS
  6. Vacaciones: derecho, tomadas, saldo
  7. Créditos: INFONAVIT, FONACOT, pensión alimenticia, préstamos
  8. Antigüedad y prestaciones acumuladas
"""
from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hr import models as hr


def _iso_to_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except Exception:
        return None


def _antiguedad(hire: str) -> dict:
    d = _iso_to_date(hire)
    if not d:
        return {"years": 0, "months": 0, "days": 0, "text": "—"}
    today = date.today()
    y = today.year - d.year
    m = today.month - d.month
    dy = today.day - d.day
    if dy < 0:
        m -= 1
    if m < 0:
        y -= 1
        m += 12
    return {
        "years": y, "months": m, "days": max(dy, 0),
        "text": f"{y} año{'s' if y != 1 else ''}"
                + (f" {m} mes{'es' if m != 1 else ''}" if m else ""),
    }


async def build_kardex(
    db: AsyncSession, employee_id: int, year: Optional[int] = None,
) -> Optional[dict]:
    """Arma el kardex del empleado. Si `year` viene, filtra historiales al año.
    Si no, toma los últimos 12 meses."""
    # Empleado
    emp = (await db.execute(
        select(hr.Employee).where(hr.Employee.id == employee_id)
    )).scalars().first()
    if not emp:
        return None

    the_year = year or date.today().year
    year_start = f"{the_year}-01-01"
    year_end = f"{the_year}-12-31"

    # Nómina del año
    q_pay = (
        select(hr.PayrollDetail, hr.PayrollPeriod)
        .join(hr.PayrollPeriod, hr.PayrollDetail.period_id == hr.PayrollPeriod.id)
        .where(
            hr.PayrollDetail.employee_id == employee_id,
            hr.PayrollPeriod.start_date >= year_start,
            hr.PayrollPeriod.end_date <= year_end,
        )
        .order_by(hr.PayrollPeriod.start_date)
    )
    pay_rows = (await db.execute(q_pay)).all()

    payroll = []
    tot_gross = 0.0; tot_deductions = 0.0; tot_net = 0.0
    tot_isr = 0.0; tot_imss = 0.0; tot_infonavit = 0.0
    for d, p in pay_rows:
        payroll.append({
            "period_id": p.id, "period_name": p.name,
            "kind": p.kind, "start_date": p.start_date, "end_date": p.end_date,
            "payment_date": p.payment_date, "status": p.status,
            "days_worked": d.days_worked, "days_absent": d.days_absent,
            "days_incapacity": d.days_incapacity,
            "salary_earned": d.salary_earned,
            "overtime": (d.overtime_double or 0) + (d.overtime_triple or 0),
            "bonus": d.bonus, "aguinaldo": d.aguinaldo,
            "vacation_premium": d.vacation_premium,
            "food_vouchers": d.food_vouchers, "savings_fund": d.savings_fund,
            "subsidy_applied": d.subsidy_applied,
            "isr": d.isr, "imss_employee": d.imss_employee,
            "infonavit": d.infonavit, "fonacot": d.fonacot,
            "alimony": d.alimony, "loan_deduction": d.loan_deduction,
            "total_gross": d.total_gross, "total_deductions": d.total_deductions,
            "total_net": d.total_net,
        })
        tot_gross += d.total_gross or 0
        tot_deductions += d.total_deductions or 0
        tot_net += d.total_net or 0
        tot_isr += d.isr or 0
        tot_imss += d.imss_employee or 0
        tot_infonavit += d.infonavit or 0

    # Asistencia del año — resumen
    q_att = (
        select(hr.Attendance.type, func.count(hr.Attendance.id))
        .where(
            hr.Attendance.employee_id == employee_id,
            hr.Attendance.date >= year_start,
            hr.Attendance.date <= year_end,
        )
        .group_by(hr.Attendance.type)
    )
    att_summary = {t: int(c) for t, c in (await db.execute(q_att)).all()}

    # Incapacidades detalladas
    q_inc = (
        select(hr.Attendance)
        .where(
            hr.Attendance.employee_id == employee_id,
            hr.Attendance.type == "incapacidad",
            hr.Attendance.date >= year_start,
            hr.Attendance.date <= year_end,
        )
        .order_by(hr.Attendance.date)
    )
    incapacities = [{
        "date": a.date, "subtype": a.incapacity_subtype,
        "imss_folio": a.imss_folio, "notes": a.notes,
    } for a in (await db.execute(q_inc)).scalars().all()]

    # Contratos
    q_con = (
        select(hr.Contract)
        .where(hr.Contract.employee_id == employee_id)
        .order_by(hr.Contract.created_at.desc())
    )
    contracts = [{
        "id": c.id,
        "type": getattr(c, "contract_type", None),
        "start_date": getattr(c, "start_date", None),
        "end_date": getattr(c, "end_date", None),
        "status": getattr(c, "status", None),
    } for c in (await db.execute(q_con)).scalars().all()]

    ant = _antiguedad(emp.hire_date)

    return {
        "employee": {
            "id": emp.id, "employee_number": emp.employee_number,
            "full_name": f"{emp.name} {emp.last_name}".strip(),
            "email": emp.email, "phone": emp.phone,
            "curp": emp.curp, "rfc": emp.rfc, "nss": emp.nss,
            "birth_date": emp.birth_date, "nationality": emp.nationality,
            "gender": emp.gender, "marital_status": emp.marital_status,
            "address": emp.address,
            "department": emp.department, "position": emp.position,
            "cost_center": emp.cost_center,
            "contract_type": emp.contract_type, "status": emp.status,
            "hire_date": emp.hire_date, "contract_end": emp.contract_end,
            "trial_end": emp.trial_end,
            "bank": emp.bank, "clabe": emp.clabe,
            "base_salary": emp.base_salary, "sbc": emp.sbc,
            "pay_frequency": emp.pay_frequency, "tax_regime": emp.tax_regime,
            "photo": emp.photo,
            "antiguedad": ant,
        },
        "credits": {
            "infonavit_credit": emp.infonavit_credit,
            "infonavit_discount_type": emp.infonavit_discount_type,
            "infonavit_discount_value": emp.infonavit_discount_value,
            "fonacot_credit": emp.fonacot_credit,
            "fonacot_discount_value": emp.fonacot_discount_value,
            "alimony_type": emp.alimony_type,
            "alimony_value": emp.alimony_value,
            "alimony_beneficiary": emp.alimony_beneficiary,
            "alimony_court_order": emp.alimony_court_order,
        },
        "vacations": {
            "days_earned": emp.vacation_days,
            "days_used": emp.vacation_used,
            "days_available": max(0, (emp.vacation_days or 0) - (emp.vacation_used or 0)),
        },
        "year": the_year,
        "payroll": payroll,
        "payroll_totals": {
            "periods": len(payroll),
            "total_gross": round(tot_gross, 2),
            "total_deductions": round(tot_deductions, 2),
            "total_net": round(tot_net, 2),
            "total_isr": round(tot_isr, 2),
            "total_imss": round(tot_imss, 2),
            "total_infonavit": round(tot_infonavit, 2),
        },
        "attendance_summary": att_summary,
        "incapacities": incapacities,
        "contracts": contracts,
    }


def build_kardex_pdf(company: dict, kardex: dict) -> bytes:
    """PDF oficial del kardex del empleado. LETTER portrait."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    )

    def _mxn(n):
        return "$" + f"{(n or 0):,.2f}"

    def _s(v):
        return "" if v is None else str(v)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=18*mm, rightMargin=18*mm, topMargin=14*mm, bottomMargin=14*mm,
    )

    styles = getSampleStyleSheet()
    brand = colors.HexColor(company.get("brand_color") or "#33B2F5")
    story = []

    emp = kardex["employee"]
    totals = kardex["payroll_totals"]
    year = kardex["year"]

    # Header
    style_small = ParagraphStyle("s", parent=styles["Normal"], fontSize=8.5, leading=11)
    style_title = ParagraphStyle("t", parent=styles["Heading1"], fontSize=15,
                                  alignment=TA_RIGHT, textColor=brand, leading=18)
    style_sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9.5,
                                alignment=TA_RIGHT, textColor=colors.HexColor("#666"))

    emp_lines = []
    if company.get("commercial_name"):
        emp_lines.append(f"<b>{company['commercial_name']}</b>")
    if company.get("legal_name") and company.get("legal_name") != company.get("commercial_name"):
        emp_lines.append(company["legal_name"])
    if company.get("rfc"):
        emp_lines.append(f"RFC: {company['rfc']}")

    header = Table(
        [[Paragraph("<br/>".join(emp_lines) or "&nbsp;", style_small),
          [Paragraph("KARDEX DEL EMPLEADO", style_title),
           Paragraph(f"Ejercicio {year}", style_sub)]]],
        colWidths=[110*mm, 70*mm],
    )
    header.setStyle(TableStyle([("VALIGN", (0,0), (-1,-1), "TOP")]))
    story.append(header)
    story.append(Spacer(1, 4*mm))

    bar = Table([[""]], colWidths=[180*mm], rowHeights=[1.4*mm])
    bar.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), brand)]))
    story.append(bar)
    story.append(Spacer(1, 5*mm))

    # 1. Datos personales
    story.append(Paragraph("<b>Datos personales</b>",
                            ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
    personal = [
        ["No. empleado", emp["employee_number"], "Nombre", emp["full_name"]],
        ["CURP", _s(emp.get("curp")), "RFC", _s(emp.get("rfc"))],
        ["NSS", _s(emp.get("nss")), "Fecha nacimiento", _s(emp.get("birth_date"))],
        ["Género", _s(emp.get("gender")), "Estado civil", _s(emp.get("marital_status"))],
        ["Email", _s(emp.get("email")), "Teléfono", _s(emp.get("phone"))],
        ["Domicilio", _s(emp.get("address")), "", ""],
    ]
    t_pers = Table(personal, colWidths=[32*mm, 58*mm, 32*mm, 58*mm])
    t_pers.setStyle(_kv_style())
    story.append(t_pers)
    story.append(Spacer(1, 4*mm))

    # 2. Datos laborales
    story.append(Paragraph("<b>Datos laborales</b>",
                            ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
    laboral = [
        ["Departamento", _s(emp.get("department")), "Puesto", _s(emp.get("position"))],
        ["Tipo contrato", _s(emp.get("contract_type")), "Estado", _s(emp.get("status"))],
        ["Fecha ingreso", _s(emp.get("hire_date")), "Antigüedad", emp["antiguedad"]["text"]],
        ["Sueldo base", _mxn(emp.get("base_salary")), "SBC (diario)", _mxn(emp.get("sbc"))],
        ["Periodicidad pago", _s(emp.get("pay_frequency")), "Régimen fiscal", _s(emp.get("tax_regime"))],
        ["Banco", _s(emp.get("bank")), "CLABE", _s(emp.get("clabe"))],
    ]
    t_lab = Table(laboral, colWidths=[32*mm, 58*mm, 32*mm, 58*mm])
    t_lab.setStyle(_kv_style())
    story.append(t_lab)
    story.append(Spacer(1, 4*mm))

    # 3. Vacaciones
    vac = kardex["vacations"]
    story.append(Paragraph("<b>Vacaciones (Reforma LFT 2023)</b>",
                            ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
    t_vac = Table([
        ["Días con derecho", str(vac["days_earned"]),
         "Días tomados", str(vac["days_used"]),
         "Días disponibles", str(vac["days_available"])],
    ], colWidths=[36*mm, 24*mm, 30*mm, 20*mm, 36*mm, 24*mm])
    t_vac.setStyle(_kv_style())
    story.append(t_vac)
    story.append(Spacer(1, 4*mm))

    # 4. Créditos activos
    cred = kardex["credits"]
    if any(cred.values()):
        story.append(Paragraph("<b>Créditos y descuentos</b>",
                                ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
        cred_rows = []
        if cred.get("infonavit_credit"):
            cred_rows.append(["INFONAVIT",
                f"Crédito {cred['infonavit_credit']} · {cred.get('infonavit_discount_type','')} "
                f"{cred.get('infonavit_discount_value') or ''}"])
        if cred.get("fonacot_credit"):
            cred_rows.append(["FONACOT",
                f"Crédito {cred['fonacot_credit']} · descuento {cred.get('fonacot_discount_value') or 0}"])
        if cred.get("alimony_type"):
            cred_rows.append(["Pensión alimenticia (LFT 110-V)",
                f"{cred['alimony_type']} = {cred.get('alimony_value')} · "
                f"beneficiario: {cred.get('alimony_beneficiary','—')} · "
                f"exp: {cred.get('alimony_court_order','—')}"])
        if cred_rows:
            t_cred = Table(cred_rows, colWidths=[45*mm, 135*mm])
            t_cred.setStyle(_kv_style())
            story.append(t_cred)
            story.append(Spacer(1, 4*mm))

    # 5. Nómina del año
    story.append(Paragraph(f"<b>Historial de nómina {year}</b>",
                            ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
    if not kardex["payroll"]:
        story.append(Paragraph("Sin recibos de nómina en el ejercicio.",
                                ParagraphStyle("n", parent=styles["Normal"], fontSize=9,
                                                textColor=colors.HexColor("#999"))))
    else:
        head = ["Periodo", "Tipo", "Días", "Percepciones", "Deducciones", "Neto"]
        rows_pay = [head]
        for r in kardex["payroll"]:
            rows_pay.append([
                f"{r['start_date'][:10]} a {r['end_date'][:10]}",
                r["kind"][:10],
                f"{r['days_worked']:.0f}",
                _mxn(r["total_gross"]),
                _mxn(r["total_deductions"]),
                _mxn(r["total_net"]),
            ])
        # Totales fila
        rows_pay.append(["", "", "TOTAL",
                          _mxn(totals["total_gross"]),
                          _mxn(totals["total_deductions"]),
                          _mxn(totals["total_net"])])
        t_pay = Table(rows_pay, colWidths=[44*mm, 22*mm, 14*mm, 34*mm, 34*mm, 32*mm])
        t_pay.setStyle(TableStyle([
            ("FONTSIZE", (0,0), (-1,-1), 8.5),
            ("BACKGROUND", (0,0), (-1,0), brand),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("ALIGN", (3,0), (-1,-1), "RIGHT"),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E0E0E0")),
            ("FONTNAME", (0,-1), (-1,-1), "Helvetica-Bold"),
            ("BACKGROUND", (0,-1), (-1,-1), colors.HexColor("#F0F5FA")),
        ]))
        story.append(t_pay)
        story.append(Spacer(1, 3*mm))
        story.append(Paragraph(
            f"<font size='9'>Retenciones acumuladas — ISR: <b>{_mxn(totals['total_isr'])}</b> · "
            f"IMSS: <b>{_mxn(totals['total_imss'])}</b> · INFONAVIT: <b>{_mxn(totals['total_infonavit'])}</b></font>",
            ParagraphStyle("t", parent=styles["Normal"])))
        story.append(Spacer(1, 4*mm))

    # 6. Ausentismo
    att = kardex["attendance_summary"]
    if att:
        story.append(Paragraph(f"<b>Ausentismo {year}</b>",
                                ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
        att_rows = [["Tipo", "Días"]] + [[k, str(v)] for k, v in att.items()]
        t_att = Table(att_rows, colWidths=[80*mm, 30*mm])
        t_att.setStyle(TableStyle([
            ("FONTSIZE", (0,0), (-1,-1), 9),
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#F0F5FA")),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E0E0E0")),
            ("ALIGN", (1,0), (1,-1), "RIGHT"),
        ]))
        story.append(t_att)
        story.append(Spacer(1, 4*mm))

    # 7. Incapacidades detalladas
    if kardex["incapacities"]:
        story.append(Paragraph(f"<b>Incapacidades {year}</b>",
                                ParagraphStyle("h", parent=styles["Heading3"], textColor=brand)))
        inc_rows = [["Fecha", "Subtipo", "Folio IMSS", "Notas"]]
        for i in kardex["incapacities"]:
            inc_rows.append([i["date"], _s(i.get("subtype")), _s(i.get("imss_folio")), _s(i.get("notes"))[:60]])
        t_inc = Table(inc_rows, colWidths=[26*mm, 44*mm, 34*mm, 76*mm])
        t_inc.setStyle(TableStyle([
            ("FONTSIZE", (0,0), (-1,-1), 8.5),
            ("BACKGROUND", (0,0), (-1,0), brand),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E0E0E0")),
        ]))
        story.append(t_inc)
        story.append(Spacer(1, 4*mm))

    # 8. Firmas
    story.append(Spacer(1, 6*mm))
    sig = Table([
        ["_" * 30, "_" * 30, "_" * 30],
        ["Empleado", "Recursos Humanos", "Representante legal"],
    ], colWidths=[60*mm, 60*mm, 60*mm])
    sig.setStyle(TableStyle([
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("TEXTCOLOR", (0,0), (-1,0), colors.HexColor("#999")),
        ("FONTNAME", (0,1), (-1,1), "Helvetica-Bold"),
    ]))
    story.append(sig)

    story.append(Spacer(1, 5*mm))
    story.append(Paragraph(
        f"<font color='#999999' size='7.5'>Generado el "
        f"{datetime.utcnow().strftime('%d/%m/%Y %H:%M UTC')} · "
        f"Folio interno: KRDX-{emp['id']:06d}-{year}</font>",
        ParagraphStyle("f", parent=styles["Normal"], alignment=TA_CENTER)))

    doc.build(story)
    return buf.getvalue()


def _kv_style():
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle
    return TableStyle([
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BOX", (0,0), (-1,-1), 0.25, colors.HexColor("#D0D0D0")),
        ("INNERGRID", (0,0), (-1,-1), 0.2, colors.HexColor("#E8E8E8")),
        ("BACKGROUND", (0,0), (0,-1), colors.HexColor("#F5F8FB")),
        ("BACKGROUND", (2,0), (2,-1), colors.HexColor("#F5F8FB")),
        ("FONTNAME", (0,0), (0,-1), "Helvetica-Bold"),
        ("FONTNAME", (2,0), (2,-1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0,0), (0,-1), colors.HexColor("#555")),
        ("TEXTCOLOR", (2,0), (2,-1), colors.HexColor("#555")),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("TOPPADDING", (0,0), (-1,-1), 4),
    ])
