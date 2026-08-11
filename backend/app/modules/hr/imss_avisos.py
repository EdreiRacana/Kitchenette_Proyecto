"""Avisos afiliatorios IMSS papel — formatos AFIL-02/04/08.

Movimientos que el patrón debe presentar al IMSS conforme al Reglamento
de la Ley del Seguro Social en materia de Afiliación:

  Alta (AFIL-02)          → art. 15 LSS · 5 días hábiles desde inicio
  Baja (AFIL-04)          → art. 37 LSS · 5 días hábiles desde término
  Modif. de salario       → art. 34 LSS · 5 días hábiles siguientes al cambio
                            (efectos bimestrales para IV/CV/GPS)

El canal electrónico oficial (IDSE) los reemplaza, pero muchas empresas
siguen requiriendo la versión papel para su expediente físico y/o
para presentar cuando el IDSE está caído.
"""
from __future__ import annotations

from datetime import datetime, date, timedelta
from io import BytesIO
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hr import models


BAJA_REASONS = {
    "1": "Término de contrato",
    "2": "Separación voluntaria (renuncia)",
    "3": "Abandono de trabajo",
    "4": "Defunción",
    "5": "Clausura del centro de trabajo",
    "6": "Otras causas",
    "7": "Ausentismo (arts. 47 / 517 LFT)",
    "8": "Rescisión de contrato (justificada patronal)",
    "9": "Jubilación / pensión",
}

MOVEMENT_LABELS = {
    "alta": "AFIL-02 · Aviso de Inscripción del Trabajador (Alta)",
    "baja": "AFIL-04 · Aviso de Baja del Trabajador",
    "modif_salario": "AFIL-08 · Aviso de Modificación de Salario",
}


# ─── Helpers ────────────────────────────────────────────────────────────


def _full_name(emp: models.Employee) -> str:
    return f"{emp.name} {emp.last_name}".strip()


def _deadline(movement_iso: str, business_days: int = 5) -> str:
    """Suma días hábiles al ISO date."""
    y, m, d = [int(x) for x in movement_iso.split("-")]
    cur = date(y, m, d); added = 0
    while added < business_days:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            added += 1
    return cur.isoformat()


# ─── CRUD ───────────────────────────────────────────────────────────────


async def create_movement(
    db: AsyncSession, *,
    employee_id: int,
    movement_type: str,
    movement_date: str,
    sbc_at_movement: Optional[float] = None,
    baja_reason_code: Optional[str] = None,
    baja_reason_text: Optional[str] = None,
    old_sbc: Optional[float] = None,
    new_sbc: Optional[float] = None,
    notes: Optional[str] = None,
    presented_date: Optional[str] = None,
    folio: Optional[str] = None,
    user_id: Optional[int] = None,
) -> dict:
    if movement_type not in ("alta", "baja", "modif_salario"):
        raise ValueError("movement_type debe ser: alta | baja | modif_salario")

    q_emp = select(models.Employee).where(models.Employee.id == employee_id)
    emp = (await db.execute(q_emp)).scalars().first()
    if not emp:
        raise ValueError("Empleado no encontrado")

    # Validaciones por tipo
    if movement_type == "baja":
        if not baja_reason_code or baja_reason_code not in BAJA_REASONS:
            raise ValueError("Motivo de baja obligatorio (código 1..9)")
    if movement_type == "modif_salario":
        if old_sbc is None or new_sbc is None:
            raise ValueError("Para modificación de salario captura old_sbc y new_sbc")
        if new_sbc <= 0:
            raise ValueError("new_sbc debe ser > 0")
    if movement_type == "alta":
        sbc_at_movement = sbc_at_movement or float(emp.sbc or 0.0)

    mov = models.IMSSMovement(
        employee_id=employee_id,
        movement_type=movement_type,
        movement_date=movement_date,
        sbc_at_movement=sbc_at_movement,
        baja_reason_code=baja_reason_code,
        baja_reason_text=baja_reason_text or (BAJA_REASONS.get(baja_reason_code or "") if baja_reason_code else None),
        old_sbc=old_sbc, new_sbc=new_sbc,
        notes=notes, presented_date=presented_date, folio=folio,
        created_by_id=user_id,
    )
    db.add(mov)
    await db.commit()
    await db.refresh(mov)
    return await get_movement(db, mov.id)


async def get_movement(db: AsyncSession, mov_id: int) -> Optional[dict]:
    q = (
        select(models.IMSSMovement, models.Employee)
        .join(models.Employee, models.IMSSMovement.employee_id == models.Employee.id)
        .where(models.IMSSMovement.id == mov_id)
    )
    row = (await db.execute(q)).first()
    if not row:
        return None
    m, emp = row
    return _serialize(m, emp)


def _serialize(m: models.IMSSMovement, emp: models.Employee) -> dict:
    return {
        "id": m.id,
        "employee_id": emp.id,
        "employee_number": emp.employee_number,
        "employee_name": _full_name(emp),
        "curp": emp.curp, "nss": emp.nss, "rfc": emp.rfc,
        "department": emp.department, "position": emp.position,
        "movement_type": m.movement_type,
        "movement_label": MOVEMENT_LABELS.get(m.movement_type, m.movement_type),
        "movement_date": m.movement_date,
        "deadline": _deadline(m.movement_date, 5),
        "presented_date": m.presented_date,
        "folio": m.folio,
        "sbc_at_movement": m.sbc_at_movement,
        "baja_reason_code": m.baja_reason_code,
        "baja_reason_text": m.baja_reason_text,
        "old_sbc": m.old_sbc, "new_sbc": m.new_sbc,
        "notes": m.notes,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


async def list_movements(
    db: AsyncSession,
    employee_id: Optional[int] = None,
    movement_type: Optional[str] = None,
    year: Optional[int] = None,
) -> List[dict]:
    q = (
        select(models.IMSSMovement, models.Employee)
        .join(models.Employee, models.IMSSMovement.employee_id == models.Employee.id)
        .order_by(models.IMSSMovement.movement_date.desc(), models.IMSSMovement.id.desc())
    )
    if employee_id:
        q = q.where(models.IMSSMovement.employee_id == employee_id)
    if movement_type:
        q = q.where(models.IMSSMovement.movement_type == movement_type)
    if year:
        q = q.where(
            models.IMSSMovement.movement_date >= f"{year:04d}-01-01",
            models.IMSSMovement.movement_date <= f"{year:04d}-12-31",
        )
    rows = (await db.execute(q)).all()
    return [_serialize(m, e) for m, e in rows]


async def update_movement(
    db: AsyncSession, mov_id: int, *,
    presented_date: Optional[str] = None,
    folio: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Solo actualiza los campos post-presentación (folio, fecha, notas)."""
    q = select(models.IMSSMovement).where(models.IMSSMovement.id == mov_id)
    m = (await db.execute(q)).scalars().first()
    if not m:
        raise ValueError("Movimiento no encontrado")
    if presented_date is not None:
        m.presented_date = presented_date
    if folio is not None:
        m.folio = folio
    if notes is not None:
        m.notes = notes
    await db.commit()
    return await get_movement(db, m.id)


async def delete_movement(db: AsyncSession, mov_id: int) -> bool:
    q = select(models.IMSSMovement).where(models.IMSSMovement.id == mov_id)
    m = (await db.execute(q)).scalars().first()
    if not m:
        return False
    await db.delete(m)
    await db.commit()
    return True


# ─── Detección de movimientos pendientes ────────────────────────────────


async def pending_movements(db: AsyncSession) -> dict:
    """Movimientos que deberían presentarse pero no tienen registro aún.

    - Empleados activos con hire_date dentro de los últimos 5 días hábiles
      y sin movimiento tipo 'alta' con esa fecha.
    - Empleados con status 'baja' (o is_active=False) sin movimiento 'baja'.
    - Los cambios de SBC se detectan comparando el SBC actual del empleado
      contra el último 'sbc_at_movement' o 'new_sbc' registrado — si difieren
      y no hay movimiento en la fecha del cambio, se sugiere modif_salario.
    """
    q_emps = select(models.Employee)
    all_emps = list((await db.execute(q_emps)).scalars().all())

    q_movs = select(models.IMSSMovement)
    all_movs = list((await db.execute(q_movs)).scalars().all())
    movs_by_emp: dict[int, list[models.IMSSMovement]] = {}
    for m in all_movs:
        movs_by_emp.setdefault(m.employee_id, []).append(m)

    today = date.today()
    pending = []
    for emp in all_emps:
        emp_movs = movs_by_emp.get(emp.id, [])
        has_alta = any(m.movement_type == "alta" for m in emp_movs)
        has_baja = any(m.movement_type == "baja" for m in emp_movs)

        # Alta pendiente
        if not has_alta and emp.hire_date:
            try:
                hire = date.fromisoformat(emp.hire_date)
                days_since = (today - hire).days
                if 0 <= days_since <= 60:
                    pending.append({
                        "employee_id": emp.id,
                        "employee_number": emp.employee_number,
                        "employee_name": _full_name(emp),
                        "type": "alta",
                        "suggested_date": emp.hire_date,
                        "sbc": float(emp.sbc or 0.0),
                        "deadline": _deadline(emp.hire_date, 5),
                        "overdue": today > date.fromisoformat(_deadline(emp.hire_date, 5)),
                    })
            except ValueError:
                pass

        # Baja pendiente
        is_baja_status = (emp.status or "") == "baja" or emp.is_active is False
        if is_baja_status and not has_baja:
            baja_date = emp.contract_end or today.isoformat()
            try:
                pending.append({
                    "employee_id": emp.id,
                    "employee_number": emp.employee_number,
                    "employee_name": _full_name(emp),
                    "type": "baja",
                    "suggested_date": baja_date,
                    "sbc": float(emp.sbc or 0.0),
                    "deadline": _deadline(baja_date, 5),
                    "overdue": today > date.fromisoformat(_deadline(baja_date, 5)),
                })
            except ValueError:
                pass

        # Modif salario pendiente: SBC actual difiere del último registrado
        if emp_movs and emp.sbc:
            latest = sorted(emp_movs, key=lambda x: x.movement_date, reverse=True)[0]
            last_sbc = (latest.new_sbc if latest.movement_type == "modif_salario"
                        else latest.sbc_at_movement)
            if last_sbc and abs(float(emp.sbc) - float(last_sbc)) > 0.01:
                pending.append({
                    "employee_id": emp.id,
                    "employee_number": emp.employee_number,
                    "employee_name": _full_name(emp),
                    "type": "modif_salario",
                    "suggested_date": today.isoformat(),
                    "old_sbc": float(last_sbc),
                    "new_sbc": float(emp.sbc),
                    "deadline": _deadline(today.isoformat(), 5),
                    "overdue": False,
                })

    return {"pending": pending, "total": len(pending)}


# ─── PDF ────────────────────────────────────────────────────────────────


def _kv_table(pairs: list, col1: int = 55, col2: int = 120):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    tbl = Table(pairs, colWidths=[col1 * mm, col2 * mm])
    tbl.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F1F5F9")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#E2E8F0")),
        ("PADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return tbl


def build_aviso_pdf(company: dict, movement: dict) -> bytes:
    """PDF del aviso IMSS (AFIL-02/04/08) LETTER portrait."""
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )
    from reportlab.lib.units import mm

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=15 * mm,
    )
    styles = getSampleStyleSheet()
    body = styles["BodyText"]; body.fontSize = 9
    small = ParagraphStyle("small", parent=body, fontSize=7.5, textColor=colors.grey)
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=13,
                        textColor=colors.HexColor("#0F172A"), spaceAfter=2)
    section = ParagraphStyle("section", parent=body, fontSize=10.5, spaceBefore=6,
                              spaceAfter=4, textColor=colors.HexColor("#0F172A"))

    story = []
    mtype = movement["movement_type"]
    label = movement.get("movement_label", MOVEMENT_LABELS.get(mtype, mtype))

    # ── Header
    company_name = (company or {}).get("legal_name") or "Empresa"
    company_rfc = (company or {}).get("rfc") or (company or {}).get("tax_id") or ""
    reg_patronal = (company or {}).get("imss_registro_patronal") or "________________"

    story.append(Paragraph(f"<b>Instituto Mexicano del Seguro Social</b>", body))
    story.append(Paragraph(label, h1))
    story.append(Paragraph("Formato para su presentación en papel ante ventanilla / expediente físico", small))
    story.append(Spacer(1, 8))

    # ── Datos del patrón
    story.append(Paragraph("<b>DATOS DEL PATRÓN</b>", section))
    story.append(_kv_table([
        ["Razón social", company_name],
        ["RFC", company_rfc],
        ["Registro patronal IMSS", reg_patronal],
        ["Domicilio del centro de trabajo", (company or {}).get("address") or ""],
    ]))
    story.append(Spacer(1, 6))

    # ── Datos del trabajador
    story.append(Paragraph("<b>DATOS DEL TRABAJADOR</b>", section))
    story.append(_kv_table([
        ["Nombre completo", movement.get("employee_name") or ""],
        ["No. empleado", movement.get("employee_number") or ""],
        ["CURP", movement.get("curp") or ""],
        ["NSS (No. de Seguridad Social)", movement.get("nss") or ""],
        ["RFC del trabajador", movement.get("rfc") or ""],
        ["Puesto / Departamento", f"{movement.get('position') or ''} — {movement.get('department') or ''}"],
    ]))
    story.append(Spacer(1, 6))

    # ── Datos del movimiento (varían por tipo)
    story.append(Paragraph("<b>DATOS DEL MOVIMIENTO</b>", section))

    if mtype == "alta":
        story.append(_kv_table([
            ["Tipo de movimiento", "ALTA (AFIL-02) · Inscripción del trabajador"],
            ["Fecha del movimiento", movement.get("movement_date") or ""],
            ["Fecha límite legal", movement.get("deadline") or ""],
            ["Salario Base de Cotización (diario)",
             f"${(movement.get('sbc_at_movement') or 0):,.2f} MXN"],
            ["Fundamento legal", "Art. 15 fracción I LSS + art. 45 Reglamento de Afiliación"],
        ]))
    elif mtype == "baja":
        story.append(_kv_table([
            ["Tipo de movimiento", "BAJA (AFIL-04) · Terminación de la relación"],
            ["Fecha de baja", movement.get("movement_date") or ""],
            ["Fecha límite legal", movement.get("deadline") or ""],
            ["Motivo (código IMSS)",
             f"{movement.get('baja_reason_code') or '—'} · {movement.get('baja_reason_text') or ''}"],
            ["Fundamento legal", "Art. 37 LSS + art. 57 Reglamento de Afiliación"],
        ]))
    elif mtype == "modif_salario":
        delta = (movement.get("new_sbc") or 0) - (movement.get("old_sbc") or 0)
        delta_pct = (delta / (movement.get("old_sbc") or 1) * 100
                      if (movement.get("old_sbc") or 0) > 0 else 0)
        story.append(_kv_table([
            ["Tipo de movimiento", "MODIFICACIÓN DE SALARIO (AFIL-08)"],
            ["Fecha efectiva del cambio", movement.get("movement_date") or ""],
            ["Fecha límite legal", movement.get("deadline") or ""],
            ["SBC anterior (diario)", f"${(movement.get('old_sbc') or 0):,.2f}"],
            ["SBC nuevo (diario)", f"${(movement.get('new_sbc') or 0):,.2f}"],
            ["Variación",
             f"${delta:,.2f} ({delta_pct:+.1f}%)"],
            ["Fundamento legal", "Art. 34 LSS + arts. 53 al 56 Reglamento de Afiliación"],
        ]))

    if movement.get("notes"):
        story.append(Spacer(1, 6))
        story.append(Paragraph(f"<b>Observaciones:</b> {movement['notes']}", body))

    # ── Datos de presentación (opcionales, si ya se presentó)
    if movement.get("presented_date") or movement.get("folio"):
        story.append(Spacer(1, 6))
        story.append(Paragraph("<b>DATOS DE PRESENTACIÓN (IDSE)</b>", section))
        story.append(_kv_table([
            ["Fecha de presentación", movement.get("presented_date") or "—"],
            ["Folio IDSE / acuse", movement.get("folio") or "—"],
        ]))

    # ── Firmas
    story.append(Spacer(1, 24))
    firms = Table([
        ["_____________________________", "", "_____________________________"],
        ["Patrón / Representante legal", "", "Trabajador (opcional)"],
        ["", "", ""],
        [company_name, "", movement.get("employee_name") or ""],
        [f"RFC {company_rfc}", "", f"CURP {movement.get('curp') or ''}"],
    ], colWidths=[70 * mm, 30 * mm, 70 * mm])
    firms.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.append(firms)

    doc.build(story)
    return buf.getvalue()
