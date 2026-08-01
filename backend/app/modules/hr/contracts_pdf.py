"""Generador de PDFs de contratos laborales / de servicios (México).

Templates redactados conforme a la Ley Federal del Trabajo vigente (2024+):
  - Indeterminado (art. 35 LFT)
  - Determinado / temporal (art. 37 LFT)
  - Prueba (art. 39-A LFT — máx 30 días / 180 gerenciales)
  - Capacitación inicial (art. 39-B LFT — máx 3 meses / 6 gerenciales)
  - Obra determinada (art. 37 LFT)
  - Comisión mercantil (Código de Comercio arts. 273-308)
  - Prestación de servicios profesionales — honorarios (Código Civil Federal
    arts. 2606-2615)

Uso: generate_contract_pdf(contract, employee, company) -> bytes

Diseño: sobrio, blanco y negro, listo para firma manuscrita. Sin decoraciones
que estorben en fotocopiadora.
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether,
)


CONTRACT_LABELS = {
    "indeterminado":  "Contrato individual de trabajo por tiempo INDETERMINADO",
    "determinado":    "Contrato individual de trabajo por tiempo DETERMINADO",
    "prueba":         "Contrato individual de trabajo a PRUEBA",
    "capacitacion":   "Contrato individual de trabajo para CAPACITACIÓN INICIAL",
    "obra":           "Contrato individual de trabajo para OBRA DETERMINADA",
    "temporal":       "Contrato individual de trabajo TEMPORAL",
    "comisionista":   "Contrato de COMISIÓN MERCANTIL",
    "honorarios":     "Contrato de PRESTACIÓN DE SERVICIOS PROFESIONALES (Honorarios)",
}


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle(name="Title2", parent=ss["Title"], fontSize=14, spaceAfter=8, alignment=TA_CENTER))
    ss.add(ParagraphStyle(name="Just", parent=ss["Normal"], fontSize=10, leading=14, alignment=TA_JUSTIFY, spaceAfter=6))
    ss.add(ParagraphStyle(name="Clause", parent=ss["Normal"], fontSize=10, leading=14, alignment=TA_JUSTIFY, spaceBefore=6, spaceAfter=4, firstLineIndent=0))
    ss.add(ParagraphStyle(name="ClauseHead", parent=ss["Normal"], fontSize=10, leading=14, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=2))
    ss.add(ParagraphStyle(name="Small", parent=ss["Normal"], fontSize=8, leading=10, textColor=colors.grey))
    return ss


def _hdr_footer(canvas, doc):
    """Footer con página y fecha de generación."""
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillGray(0.5)
    txt = f"Documento generado el {datetime.now().strftime('%d/%m/%Y %H:%M')} — Página {doc.page}"
    canvas.drawCentredString(LETTER[0] / 2, 15 * mm, txt)
    canvas.restoreState()


def _fmt_currency(v: float) -> str:
    return f"${v:,.2f} MXN"


def _fmt_date(iso: str) -> str:
    if not iso:
        return "___________"
    try:
        d = datetime.strptime(iso, "%Y-%m-%d")
        meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        return f"{d.day} de {meses[d.month - 1]} de {d.year}"
    except Exception:
        return iso


def _clauses_indefinido(c, e, comp, ss) -> List:
    """Cláusulas para contrato indeterminado — el más común. Base: LFT arts.
    20, 21, 24, 25, 35, 47, 82-89, 132."""
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO DEL CONTRATO.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL PATRÓN contrata a EL TRABAJADOR para desempeñar el puesto de "
        f"<b>{c.get('position') or '_______________'}</b>, con las funciones descritas en la cláusula "
        f"segunda, con carácter de <b>por tiempo indeterminado</b> conforme al artículo "
        f"35 de la Ley Federal del Trabajo (LFT).",
        st["Clause"]))

    out.append(Paragraph("<b>SEGUNDA.</b> FUNCIONES.", st["ClauseHead"]))
    out.append(Paragraph(
        c.get("job_functions") or "Las inherentes al puesto, así como las demás que le sean asignadas por su superior jerárquico dentro del giro y actividades de la empresa.",
        st["Clause"]))

    out.append(Paragraph("<b>TERCERA.</b> DURACIÓN Y FECHA DE INICIO.", st["ClauseHead"]))
    out.append(Paragraph(
        f"El presente contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y tendrá vigencia "
        f"indeterminada, subsistiendo mientras exista la materia de trabajo, conforme "
        f"al artículo 35 de la LFT.",
        st["Clause"]))

    out.append(Paragraph("<b>CUARTA.</b> JORNADA Y HORARIO.", st["ClauseHead"]))
    h = c.get("hours_per_week") or 48
    sched = c.get("work_schedule") or "Lunes a Sábado, en horario que le asigne EL PATRÓN"
    out.append(Paragraph(
        f"EL TRABAJADOR desempeñará sus labores durante una jornada semanal de <b>{h} horas</b>, "
        f"conforme al siguiente horario: <b>{sched}</b>, con derecho a los descansos "
        f"semanales y anuales previstos por la LFT.",
        st["Clause"]))

    out.append(Paragraph("<b>QUINTA.</b> SALARIO.", st["ClauseHead"]))
    freq_map = {"semanal": "semanal", "quincenal": "quincenal", "mensual": "mensual"}
    freq = freq_map.get(c.get("salary_frequency", "mensual"), "mensual")
    out.append(Paragraph(
        f"EL PATRÓN pagará a EL TRABAJADOR un salario {freq} de <b>{_fmt_currency(c['salary_amount'])}</b>, "
        f"pagadero en el domicilio de la fuente de trabajo o mediante depósito bancario "
        f"a la cuenta que EL TRABAJADOR designe. Del salario se harán las deducciones legales "
        f"correspondientes (ISR, IMSS, INFONAVIT, etc.).",
        st["Clause"]))

    out.append(Paragraph("<b>SEXTA.</b> LUGAR DE PRESTACIÓN DE SERVICIOS.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL TRABAJADOR prestará sus servicios en: "
        f"<b>{c.get('workplace_address') or comp.get('address') or '___________'}</b>, "
        f"pudiendo ser reubicado dentro de la misma zona económica en caso de necesidad de la empresa.",
        st["Clause"]))

    out.append(Paragraph("<b>SÉPTIMA.</b> PRESTACIONES DE LEY.", st["ClauseHead"]))
    out.append(Paragraph(
        "EL TRABAJADOR gozará de las prestaciones mínimas de la LFT: aguinaldo (mínimo 15 días "
        "de salario), vacaciones conforme al artículo 76 de la LFT (12 días a partir del primer "
        "año trabajado, incrementándose 2 días por cada año subsecuente hasta llegar a 20 días), "
        "prima vacacional del 25% sobre los días de vacaciones, y demás prestaciones que la ley "
        "establece.",
        st["Clause"]))

    out.append(Paragraph("<b>OCTAVA.</b> SEGURIDAD SOCIAL.", st["ClauseHead"]))
    out.append(Paragraph(
        "EL PATRÓN inscribirá a EL TRABAJADOR ante el Instituto Mexicano del Seguro Social "
        "(IMSS), el Instituto del Fondo Nacional de la Vivienda para los Trabajadores (INFONAVIT) "
        "y el Sistema de Ahorro para el Retiro (SAR), cubriendo las cuotas obrero-patronales "
        "correspondientes.",
        st["Clause"]))

    if c.get("confidentiality"):
        out.append(Paragraph("<b>NOVENA.</b> CONFIDENCIALIDAD.", st["ClauseHead"]))
        out.append(Paragraph(
            "EL TRABAJADOR se obliga a guardar absoluta reserva y confidencialidad sobre "
            "cualquier información técnica, comercial, financiera, de clientes, procedimientos "
            "o cualquier otra propiedad intelectual de EL PATRÓN a la que tenga acceso con motivo "
            "de sus funciones, tanto durante la vigencia del contrato como después de su terminación.",
            st["Clause"]))

    if c.get("non_compete"):
        out.append(Paragraph("<b>DÉCIMA.</b> NO COMPETENCIA.", st["ClauseHead"]))
        out.append(Paragraph(
            "Durante la vigencia del presente contrato, EL TRABAJADOR se obliga a no prestar "
            "servicios ni participar directa o indirectamente en empresas competidoras de EL PATRÓN, "
            "salvo autorización expresa y por escrito.",
            st["Clause"]))

    out.append(Paragraph("<b>DÉCIMA PRIMERA.</b> CAUSAS DE RESCISIÓN.", st["ClauseHead"]))
    out.append(Paragraph(
        "Serán causa de rescisión sin responsabilidad para EL PATRÓN las señaladas en el "
        "artículo 47 de la LFT, y sin responsabilidad para EL TRABAJADOR las del artículo 51.",
        st["Clause"]))

    out.append(Paragraph("<b>DÉCIMA SEGUNDA.</b> LEY APLICABLE Y JURISDICCIÓN.", st["ClauseHead"]))
    out.append(Paragraph(
        "El presente contrato se rige por la Ley Federal del Trabajo. Cualquier controversia "
        "será competencia de los Tribunales Laborales Federales de la circunscripción donde se "
        "presten los servicios.",
        st["Clause"]))
    return out


def _clauses_determinado(c, e, comp, ss) -> List:
    """Contrato temporal — art. 37 LFT requiere causa justificada."""
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO Y CAUSA.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL PATRÓN contrata a EL TRABAJADOR para desempeñar el puesto de "
        f"<b>{c.get('position') or '_______________'}</b> por tiempo determinado. Se pacta esta "
        f"modalidad al amparo del artículo 37 de la LFT, en virtud de que "
        f"<i>{c.get('temporary_reason') or 'la naturaleza del trabajo así lo exige'}</i>.",
        st["Clause"]))

    out.append(Paragraph("<b>SEGUNDA.</b> DURACIÓN.", st["ClauseHead"]))
    out.append(Paragraph(
        f"El contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y concluye el "
        f"<b>{_fmt_date(c.get('end_date') or '')}</b>, sin necesidad de aviso previo, salvo pacto "
        f"expreso de renovación.",
        st["Clause"]))

    # Reutiliza las cláusulas de funciones, jornada, salario, prestaciones y ley aplicable
    tail = _clauses_indefinido(c, e, comp, ss)
    # Nos saltamos las 3 primeras del indefinido (objeto, funciones-1, duración) porque
    # ya las tenemos aquí. Tomamos desde la 2ª cláusula (funciones) en adelante.
    out.extend(tail[2:])  # segundo Paragraph = ClauseHead SEGUNDA(funciones)
    return out


def _clauses_prueba(c, e, comp, ss) -> List:
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO Y CARÁCTER A PRUEBA.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL PATRÓN contrata a EL TRABAJADOR para desempeñar el puesto de "
        f"<b>{c.get('position') or '_______________'}</b>, bajo la modalidad de CONTRATO A PRUEBA "
        f"conforme al artículo 39-A de la Ley Federal del Trabajo, con el fin de que EL PATRÓN "
        f"verifique que EL TRABAJADOR cumple con los requisitos y conocimientos necesarios para "
        f"el puesto.",
        st["Clause"]))
    out.append(Paragraph("<b>SEGUNDA.</b> DURACIÓN DE LA PRUEBA.", st["ClauseHead"]))
    out.append(Paragraph(
        f"El período de prueba inicia el <b>{_fmt_date(c['start_date'])}</b> y concluye el "
        f"<b>{_fmt_date(c.get('end_date') or '')}</b>, con duración máxima de treinta (30) días "
        f"conforme al artículo 39-A LFT, o hasta ciento ochenta (180) días para puestos de dirección, "
        f"gerenciales o técnicos especializados. De no acreditar los requisitos, la relación de "
        f"trabajo terminará SIN responsabilidad para EL PATRÓN, previa opinión de la Comisión Mixta "
        f"de Productividad, Capacitación y Adiestramiento.",
        st["Clause"]))
    tail = _clauses_indefinido(c, e, comp, ss)
    out.extend(tail[2:])
    return out


def _clauses_capacitacion(c, e, comp, ss) -> List:
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO — CAPACITACIÓN INICIAL.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL PATRÓN contrata a EL TRABAJADOR bajo la modalidad de CAPACITACIÓN INICIAL, "
        f"conforme al artículo 39-B de la Ley Federal del Trabajo, con el fin de que EL TRABAJADOR "
        f"adquiera los conocimientos y habilidades necesarios para desempeñar el puesto de "
        f"<b>{c.get('position') or '_______________'}</b>.",
        st["Clause"]))
    out.append(Paragraph("<b>SEGUNDA.</b> DURACIÓN.", st["ClauseHead"]))
    out.append(Paragraph(
        f"La capacitación inicial tiene duración máxima de tres (3) meses, o de seis (6) meses "
        f"para puestos de dirección, gerenciales o técnicos especializados. Inicia el "
        f"<b>{_fmt_date(c['start_date'])}</b> y concluye el <b>{_fmt_date(c.get('end_date') or '')}</b>.",
        st["Clause"]))
    tail = _clauses_indefinido(c, e, comp, ss)
    out.extend(tail[2:])
    return out


def _clauses_comisionista(c, e, comp, ss) -> List:
    """Comisión mercantil — Código de Comercio, NO laboral."""
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL COMITENTE encomienda a EL COMISIONISTA la promoción y venta de sus productos "
        f"y/o servicios, quien acepta desempeñar la comisión mercantil en términos de los "
        f"artículos 273 a 308 del Código de Comercio.",
        st["Clause"]))

    out.append(Paragraph("<b>SEGUNDA.</b> NATURALEZA MERCANTIL.", st["ClauseHead"]))
    out.append(Paragraph(
        "Las partes reconocen expresamente que el presente contrato es de naturaleza MERCANTIL "
        "y no laboral. EL COMISIONISTA actúa con independencia y libertad de horario, sin "
        "subordinación, y no forma parte del personal de EL COMITENTE.",
        st["Clause"]))

    out.append(Paragraph("<b>TERCERA.</b> COMISIÓN Y FORMA DE PAGO.", st["ClauseHead"]))
    pct = c.get("commission_pct") or 0
    out.append(Paragraph(
        f"EL COMISIONISTA recibirá una comisión equivalente al <b>{pct}%</b> sobre el monto "
        f"neto cobrado de las ventas efectivamente concretadas y liquidadas. La comisión se "
        f"cubrirá {c.get('salary_frequency', 'mensualmente')} contra emisión de recibo de honorarios "
        f"o factura por EL COMISIONISTA. No genera derecho a prestaciones laborales de ninguna especie.",
        st["Clause"]))

    out.append(Paragraph("<b>CUARTA.</b> VIGENCIA.", st["ClauseHead"]))
    if c.get("end_date"):
        out.append(Paragraph(
            f"El contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y concluye el "
            f"<b>{_fmt_date(c['end_date'])}</b>, prorrogable por acuerdo escrito de las partes.",
            st["Clause"]))
    else:
        out.append(Paragraph(
            f"El contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y tendrá vigencia "
            f"indefinida, pudiendo ser terminado por cualquiera de las partes con 30 días "
            f"naturales de aviso previo por escrito, sin responsabilidad ulterior.",
            st["Clause"]))

    out.append(Paragraph("<b>QUINTA.</b> OBLIGACIONES FISCALES.", st["ClauseHead"]))
    out.append(Paragraph(
        "EL COMISIONISTA cumplirá con sus obligaciones fiscales como persona física con "
        "actividad empresarial o régimen aplicable, siendo el único responsable del pago del "
        "ISR, IVA y demás impuestos derivados de sus ingresos. EL COMITENTE efectuará las "
        "retenciones aplicables cuando la ley así lo exija.",
        st["Clause"]))

    if c.get("confidentiality"):
        out.append(Paragraph("<b>SEXTA.</b> CONFIDENCIALIDAD.", st["ClauseHead"]))
        out.append(Paragraph(
            "EL COMISIONISTA se obliga a guardar reserva de la información de clientes, precios, "
            "descuentos y demás datos comerciales de EL COMITENTE, aún después de terminado el contrato.",
            st["Clause"]))
    return out


def _clauses_honorarios(c, e, comp, ss) -> List:
    """Prestación de servicios profesionales — Código Civil, NO laboral."""
    st = ss
    out = []
    out.append(Paragraph("<b>PRIMERA.</b> OBJETO.", st["ClauseHead"]))
    out.append(Paragraph(
        f"EL PROFESIONISTA se obliga a prestar a EL CLIENTE los siguientes servicios "
        f"profesionales: <i>{c.get('professional_service') or c.get('job_functions') or '_______________'}</i>, "
        f"con la debida diligencia y calidad profesional.",
        st["Clause"]))

    out.append(Paragraph("<b>SEGUNDA.</b> NATURALEZA CIVIL.", st["ClauseHead"]))
    out.append(Paragraph(
        "El presente contrato se rige por lo dispuesto en los artículos 2606 al 2615 del "
        "Código Civil Federal, es de naturaleza CIVIL y no laboral. EL PROFESIONISTA no está "
        "sujeto a subordinación, horario ni dirección de EL CLIENTE, y no forma parte del personal.",
        st["Clause"]))

    out.append(Paragraph("<b>TERCERA.</b> HONORARIOS Y FACTURACIÓN.", st["ClauseHead"]))
    freq = c.get("salary_frequency", "mensual")
    out.append(Paragraph(
        f"EL CLIENTE pagará a EL PROFESIONISTA la cantidad de "
        f"<b>{_fmt_currency(c['salary_amount'])}</b> con periodicidad {freq}, contra "
        f"expedición del CFDI (recibo de honorarios o factura) correspondiente. EL CLIENTE "
        f"efectuará las retenciones fiscales aplicables (ISR 10% y 2/3 partes del IVA).",
        st["Clause"]))

    out.append(Paragraph("<b>CUARTA.</b> VIGENCIA.", st["ClauseHead"]))
    if c.get("end_date"):
        out.append(Paragraph(
            f"El contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y concluye el "
            f"<b>{_fmt_date(c['end_date'])}</b>.",
            st["Clause"]))
    else:
        out.append(Paragraph(
            f"El contrato inicia el <b>{_fmt_date(c['start_date'])}</b> y tendrá vigencia "
            f"indefinida, dando por terminado por cualquiera de las partes con aviso previo "
            f"por escrito de al menos 15 días naturales.",
            st["Clause"]))

    out.append(Paragraph("<b>QUINTA.</b> OBLIGACIONES FISCALES.", st["ClauseHead"]))
    out.append(Paragraph(
        "EL PROFESIONISTA declara estar inscrito en el Registro Federal de Contribuyentes y "
        "es el único responsable del cumplimiento de sus obligaciones fiscales, laborales y "
        "de seguridad social. EL PROFESIONISTA cuenta con RFC "
        f"<b>{e.get('rfc') or '____________'}</b>.",
        st["Clause"]))

    if c.get("confidentiality"):
        out.append(Paragraph("<b>SEXTA.</b> CONFIDENCIALIDAD.", st["ClauseHead"]))
        out.append(Paragraph(
            "EL PROFESIONISTA se obliga a guardar absoluta reserva de la información a la que "
            "tenga acceso con motivo de la prestación de los servicios contratados.",
            st["Clause"]))
    return out


CLAUSE_MAP = {
    "indeterminado": _clauses_indefinido,
    "determinado":   _clauses_determinado,
    "temporal":      _clauses_determinado,
    "obra":          _clauses_determinado,
    "prueba":        _clauses_prueba,
    "capacitacion":  _clauses_capacitacion,
    "comisionista":  _clauses_comisionista,
    "honorarios":    _clauses_honorarios,
}


def generate_contract_pdf(contract: Dict[str, Any], employee: Dict[str, Any],
                            company: Dict[str, Any]) -> bytes:
    """Genera el PDF del contrato listo para imprimir y firmar.

    contract: dict con las llaves del ContractCreate + status/id
    employee: dict con name, last_name, rfc, curp, address, nss, etc.
    company:  dict con name, rfc, address, legal_rep (representante legal)
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=22 * mm, bottomMargin=22 * mm,
        title=f"Contrato — {employee.get('name', '')} {employee.get('last_name', '')}",
    )
    ss = _styles()
    story: List = []

    label = CONTRACT_LABELS.get(contract["contract_type"], "Contrato")
    story.append(Paragraph(label, ss["Title2"]))
    story.append(Spacer(1, 6 * mm))

    # Encabezado — partes
    is_civil = contract["contract_type"] in ("comisionista", "honorarios")
    if is_civil and contract["contract_type"] == "comisionista":
        role_emp, role_pat = "EL COMISIONISTA", "EL COMITENTE"
    elif is_civil and contract["contract_type"] == "honorarios":
        role_emp, role_pat = "EL PROFESIONISTA", "EL CLIENTE"
    else:
        role_emp, role_pat = "EL TRABAJADOR", "EL PATRÓN"

    intro = (
        f"En la ciudad de {company.get('city') or '__________'}, a los {_fmt_date(contract['start_date'])}, "
        f"comparecen por una parte <b>{company.get('name') or 'LA EMPRESA'}</b>, "
        f"con RFC <b>{company.get('rfc') or '____________'}</b>, con domicilio en "
        f"<b>{company.get('address') or '____________'}</b>, representada por "
        f"<b>{company.get('legal_rep') or '____________'}</b> en su carácter de representante legal, "
        f"en lo sucesivo <b>{role_pat}</b>; y por la otra parte "
        f"<b>{employee.get('name', '')} {employee.get('last_name', '')}</b>, "
        f"con CURP <b>{employee.get('curp') or '__________________'}</b>, "
        f"RFC <b>{employee.get('rfc') or '____________'}</b>"
        + (f", NSS <b>{employee.get('nss')}</b>" if employee.get('nss') else "")
        + f", con domicilio en <b>{employee.get('address') or '____________'}</b>, "
        f"en lo sucesivo <b>{role_emp}</b>, quienes de conformidad con las siguientes DECLARACIONES "
        f"y CLÁUSULAS acuerdan celebrar el presente contrato."
    )
    story.append(Paragraph(intro, ss["Just"]))
    story.append(Spacer(1, 4 * mm))

    # Declaraciones (breves)
    story.append(Paragraph("<b>DECLARACIONES</b>", ss["Just"]))
    story.append(Paragraph(
        f"I. Declara {role_pat} contar con capacidad legal y económica para obligarse en los términos "
        f"del presente contrato.", ss["Just"]))
    story.append(Paragraph(
        f"II. Declara {role_emp} ser mayor de edad, contar con la capacidad, aptitudes y "
        f"conocimientos necesarios para desempeñar las funciones materia del presente contrato, "
        f"y estar interesado en prestar sus servicios a {role_pat}.", ss["Just"]))
    story.append(Spacer(1, 2 * mm))

    # Cláusulas específicas por tipo
    story.append(Paragraph("<b>CLÁUSULAS</b>", ss["Just"]))
    clause_fn = CLAUSE_MAP.get(contract["contract_type"], _clauses_indefinido)
    story.extend(clause_fn(contract, employee, company, ss))

    # Cierre + firmas
    story.append(Spacer(1, 12 * mm))
    story.append(Paragraph(
        f"Leído que fue el presente contrato por las partes y enteradas de su contenido y "
        f"alcance legal, lo firman por duplicado en la fecha y lugar señalados al inicio.",
        ss["Just"]))
    story.append(Spacer(1, 20 * mm))

    firma_data = [
        ["_________________________________", "_________________________________"],
        [f"{role_pat}", f"{role_emp}"],
        [company.get("legal_rep") or "Representante legal",
         f"{employee.get('name', '')} {employee.get('last_name', '')}"],
    ]
    tbl = Table(firma_data, colWidths=[75 * mm, 75 * mm])
    tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, 0), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 2),
    ]))
    story.append(tbl)

    story.append(Spacer(1, 20 * mm))
    story.append(Paragraph(
        "<i>Este documento debe imprimirse por duplicado y ser firmado en cada página por ambas "
        "partes. Un ejemplar será conservado por cada parte contratante.</i>",
        ss["Small"]))

    doc.build(story, onFirstPage=_hdr_footer, onLaterPages=_hdr_footer)
    return buf.getvalue()
