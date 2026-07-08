from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, date, timedelta
import csv
import io

from app.modules.hr import models, schemas


async def _log_audit(db: AsyncSession, user_id: Optional[int], action: str, description: str = None, details: dict = None):
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(db, user_id=user_id, action=action, module="hr", description=description, details=details)
    except Exception:
        pass


# ── Cálculo fiscal mexicano (ISR / IMSS / SAE) ──────────────────────────────
# Tablas MENSUALES (Anexo 8 RMF). Se prorratean a la frecuencia del período
# mediante la fracción `dias_periodo / 30` para respetar la ley fiscal.
# Fuente única de verdad — el frontend replica estos valores para vista previa.

_ISR_TABLE_MONTHLY = [
    {"li": 0.01,       "ls": 8952.49,     "fi": 0.00,      "pct": 0.0192},
    {"li": 8952.50,    "ls": 75984.55,    "fi": 171.88,    "pct": 0.0640},
    {"li": 75984.56,   "ls": 133536.07,   "fi": 4461.94,   "pct": 0.1088},
    {"li": 133536.08,  "ls": 155229.80,   "fi": 10723.55,  "pct": 0.1600},
    {"li": 155229.81,  "ls": 185852.57,   "fi": 14194.54,  "pct": 0.1792},
    {"li": 185852.58,  "ls": 374837.88,   "fi": 19682.13,  "pct": 0.2136},
    {"li": 374837.89,  "ls": 591492.85,   "fi": 60049.40,  "pct": 0.2352},
    {"li": 591492.86,  "ls": 1e12,        "fi": 110842.74, "pct": 0.3000},
]

# Subsidio al empleo mensual (Anexo 8 RMF 2026)
# Se aplica cuando el ISR calculado es menor que el subsidio: el remanente
# se entrega al empleado como "subsidio al empleo pagado" (crédito al salario).
_SAE_TABLE_MONTHLY = [
    {"li": 0.01,     "ls": 872.86,    "subsidio": 407.02},
    {"li": 872.87,   "ls": 1309.20,   "subsidio": 406.83},
    {"li": 1309.21,  "ls": 1713.60,   "subsidio": 406.62},
    {"li": 1713.61,  "ls": 1745.70,   "subsidio": 392.77},
    {"li": 1745.71,  "ls": 2193.75,   "subsidio": 382.46},
    {"li": 2193.76,  "ls": 2327.55,   "subsidio": 354.23},
    {"li": 2327.56,  "ls": 2632.65,   "subsidio": 324.87},
    {"li": 2632.66,  "ls": 3071.40,   "subsidio": 294.63},
    {"li": 3071.41,  "ls": 3510.15,   "subsidio": 253.54},
    {"li": 3510.16,  "ls": 3703.65,   "subsidio": 217.61},
    {"li": 3703.66,  "ls": 1e12,      "subsidio": 0.00},
]

UMA_2026 = 113.14
UMA_2026_MONTHLY = UMA_2026 * 30.4

_FREQ_DAYS = {"semanal": 7, "catorcenal": 14, "quincenal": 15, "mensual": 30}


def _period_fraction(frequency: str) -> float:
    """Fracción del mes cubierta por la frecuencia (para prorratear tablas mensuales)."""
    return _FREQ_DAYS.get(frequency, 30) / 30.0


def calc_isr(gravable: float, frequency: str = "quincenal") -> float:
    """ISR aplicando tabla mensual prorrateada a la frecuencia del período.

    Si no hay salario gravable (aguinaldo dentro de la exención de 30 UMAs,
    empleado sin días trabajados, etc.) no hay ISR."""
    if (gravable or 0.0) <= 0:
        return 0.0
    frac = _period_fraction(frequency)
    monthly_gravable = gravable / frac if frac else gravable
    row = next(
        (r for r in _ISR_TABLE_MONTHLY if r["li"] <= monthly_gravable <= r["ls"]),
        _ISR_TABLE_MONTHLY[-1],
    )
    monthly_isr = (monthly_gravable - row["li"]) * row["pct"] + row["fi"]
    return round(max(monthly_isr, 0.0) * frac, 2)


def calc_sae(gravable: float, frequency: str = "quincenal") -> float:
    """Subsidio al empleo aplicable al salario gravable del período.

    Sin salario gravable no aplica subsidio (el SAE es un crédito contra el
    ISR sobre salarios; sin salario no hay derecho)."""
    if (gravable or 0.0) <= 0:
        return 0.0
    frac = _period_fraction(frequency)
    monthly_gravable = gravable / frac if frac else gravable
    row = next(
        (r for r in _SAE_TABLE_MONTHLY if r["li"] <= monthly_gravable <= r["ls"]),
        _SAE_TABLE_MONTHLY[-1],
    )
    return round(row["subsidio"] * frac, 2)


def calc_isr_net(gravable: float, frequency: str = "quincenal") -> tuple[float, float, float]:
    """Devuelve (isr_retenido, subsidio_pagado, isr_bruto).

    - Si SAE > ISR: no se retiene ISR; el patrón entrega la diferencia al
      empleado como subsidio pagado (que se acredita contra ISR patronal
      posteriormente).
    - Si ISR > SAE: se retiene ISR - SAE.
    """
    isr_bruto = calc_isr(gravable, frequency)
    sae = calc_sae(gravable, frequency)
    if sae >= isr_bruto:
        return 0.0, round(sae - isr_bruto, 2), isr_bruto
    return round(isr_bruto - sae, 2), 0.0, isr_bruto


def calc_imss_employee(sbc: float, dias: int) -> float:
    """Cuota obrera IMSS.

    - Enfermedad y maternidad (prestaciones en especie): 0.40% del SBC en
      pensionados, 0.25% general.
    - Invalidez y vida: 0.625%.
    - Cesantía y vejez: 1.125%.
    Estas son las cuotas del trabajador (Art. 25, 106, 147, 168 LSS).
    """
    # Tope SBC = 25 UMAs diarias
    tope_sbc = 25 * UMA_2026
    sbc_topado = min(sbc, tope_sbc)
    diario = sbc_topado
    return round(diario * dias * (0.0025 + 0.00625 + 0.01125), 2)


def calc_imss_employer(sbc: float, dias: int) -> float:
    """Cuota patronal IMSS (Art. 106, 168 LSS). Simplificada:

    - Enfermedad y maternidad (prestaciones en especie):
        · Cuota fija 20.40% del SMDF por cada trabajador
        · Excedente: 1.10% sobre el SBC que exceda 3 SMDF
    - Enfermedad y maternidad (prestaciones en dinero): 0.70%
    - Invalidez y vida: 1.75%
    - Cesantía y vejez: 3.150%
    - Guarderías y prestaciones sociales: 1.00%
    - Retiro: 2.00%
    - Riesgo de trabajo: 0.54355% (prima media inicial de clase I; el
      patrón real la determina por Anexo 5.9 IMSS)
    """
    tope_sbc = 25 * UMA_2026
    sbc_topado = min(sbc, tope_sbc)
    smdf = UMA_2026  # el "SMDF" está indexado a la UMA desde 2016

    # E&M especie
    cuota_fija = 0.2040 * smdf * dias
    excedente_base = max(sbc_topado - 3 * smdf, 0)
    em_especie_excedente = 0.0110 * excedente_base * dias
    em_dinero = 0.0070 * sbc_topado * dias
    inv_vida = 0.0175 * sbc_topado * dias
    ces_vejez = 0.03150 * sbc_topado * dias
    guarderias = 0.0100 * sbc_topado * dias
    retiro = 0.0200 * sbc_topado * dias
    rt = 0.0054355 * sbc_topado * dias

    total = cuota_fija + em_especie_excedente + em_dinero + inv_vida + ces_vejez + guarderias + retiro + rt
    return round(total, 2)


def calc_infonavit_employer_amort(sbc: float, dias: int) -> float:
    """Aportación patronal INFONAVIT (5% del SBC topado a 25 UMAs, Art. 29 LINFONAVIT)."""
    tope_sbc = 25 * UMA_2026
    return round(min(sbc, tope_sbc) * dias * 0.05, 2)


def calc_state_payroll_tax(total_gross: float, rate_pct: float) -> float:
    """Impuesto Sobre Nómina (ISN) estatal — patronal. Se aplica al total de
    percepciones gravables por ISN de cada entidad. La tasa se lee del
    perfil de la empresa (CompanyProfile.state_payroll_tax_rate) y varía
    típicamente entre 2% y 4% según el estado (CDMX 3%, Jalisco 2%, etc.)."""
    if not rate_pct or rate_pct <= 0 or total_gross <= 0:
        return 0.0
    return round(total_gross * (rate_pct / 100.0), 2)


async def _get_state_payroll_tax_rate(db: AsyncSession) -> float:
    """Lee la tasa del ISN configurada en el perfil de la empresa; default 3%."""
    try:
        from app.modules.core_config import models as cfg_models
        res = await db.execute(select(cfg_models.CompanyProfile).limit(1))
        cp = res.scalars().first()
        if cp and cp.state_payroll_tax_rate is not None:
            return float(cp.state_payroll_tax_rate)
    except Exception:
        pass
    return 3.0


# Backward-compat: la firma anterior era calc_imss(sbc, frequency). Mantengo el
# alias para no romper llamadas externas.
def calc_imss(sbc: float, frequency: str) -> float:
    return calc_imss_employee(sbc, _FREQ_DAYS.get(frequency, 30))


def _full_name(e: models.Employee) -> str:
    return f"{e.name} {e.last_name}"


# ── Employees ───────────────────────────────────────────────────────────
async def _next_employee_number(db: AsyncSession) -> str:
    res = await db.execute(select(func.count()).select_from(models.Employee))
    count = res.scalar() or 0
    return f"EMP-{count + 1:03d}"


async def create_employee(db: AsyncSession, data: schemas.EmployeeCreate, user_id: Optional[int] = None) -> models.Employee:
    employee_number = await _next_employee_number(db)
    emp = models.Employee(employee_number=employee_number, **data.model_dump())
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    await _log_audit(db, user_id, "CREATE_EMPLOYEE", f"Alta de {_full_name(emp)} ({employee_number})", {"id": emp.id})
    return emp


async def update_employee(db: AsyncSession, employee_id: int, data: schemas.EmployeeUpdate, user_id: Optional[int] = None) -> Optional[models.Employee]:
    res = await db.execute(select(models.Employee).where(models.Employee.id == employee_id))
    emp = res.scalars().first()
    if not emp:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(emp, field, value)
    await db.commit()
    await db.refresh(emp)
    await _log_audit(db, user_id, "UPDATE_EMPLOYEE", f"Empleado #{employee_id} actualizado", {"id": employee_id})
    return emp


async def get_employees(db: AsyncSession, skip: int = 0, limit: int = 500) -> List[models.Employee]:
    res = await db.execute(select(models.Employee).order_by(models.Employee.id).offset(skip).limit(limit))
    return res.scalars().all()


async def get_employee(db: AsyncSession, employee_id: int) -> Optional[models.Employee]:
    res = await db.execute(select(models.Employee).where(models.Employee.id == employee_id))
    return res.scalars().first()


async def delete_employee(db: AsyncSession, employee_id: int, user_id: Optional[int] = None) -> bool:
    emp = await get_employee(db, employee_id)
    if not emp:
        return False
    await db.delete(emp)
    await db.commit()
    await _log_audit(db, user_id, "DELETE_EMPLOYEE", f"Empleado #{employee_id} eliminado", {"id": employee_id})
    return True


# ── Attendance ──────────────────────────────────────────────────────────
async def create_attendance(db: AsyncSession, data: schemas.AttendanceCreate, user_id: Optional[int] = None) -> models.Attendance:
    att = models.Attendance(**data.model_dump())
    db.add(att)
    await db.commit()
    await db.refresh(att)
    await _log_audit(db, user_id, "CREATE_ATTENDANCE", f"Incidencia {data.type} registrada para empleado #{data.employee_id}", {"id": att.id})
    return att


async def get_employee_attendance(
    db: AsyncSession, employee_id: int,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
) -> dict:
    """Regresa las asistencias de un empleado en un rango + el resumen agregado
    (faltas, retardos, incapacidades, vacaciones y horas extra)."""
    stmt = select(models.Attendance).where(models.Attendance.employee_id == employee_id)
    if start_date:
        stmt = stmt.where(models.Attendance.date >= start_date)
    if end_date:
        stmt = stmt.where(models.Attendance.date <= end_date)
    stmt = stmt.order_by(models.Attendance.date.desc(), models.Attendance.id.desc())
    res = await db.execute(stmt)
    rows = list(res.scalars().all())

    # Los tipos guardados son singulares ("falta", "retardo"); el summary
    # expone conteos con nombres consistentes que la UI reconoce.
    _COUNT_KEY = {
        "falta": "faltas",
        "retardo": "retardos",
        "incapacidad": "incapacidad",
        "vacacion": "vacacion",
        "permiso": "permiso",
        "extra": "extra",
    }
    summary = {v: 0 for v in _COUNT_KEY.values()}
    summary["extra_hours"] = 0.0
    items = []
    for a in rows:
        key = _COUNT_KEY.get(a.type)
        if key:
            summary[key] = summary.get(key, 0) + 1
        if a.type == "extra" and a.hours:
            summary["extra_hours"] += float(a.hours)
        items.append({
            "id": a.id, "date": a.date, "type": a.type,
            "time": a.time, "hours": a.hours, "notes": a.notes,
            "approved": a.approved, "channel": a.channel,
        })
    summary["extra_hours"] = round(summary["extra_hours"], 2)
    return {"items": items, "summary": summary}


async def get_attendance(db: AsyncSession, date_filter: Optional[str] = None) -> List[dict]:
    stmt = select(models.Attendance, models.Employee).join(models.Employee, models.Attendance.employee_id == models.Employee.id)
    if date_filter:
        stmt = stmt.where(models.Attendance.date == date_filter)
    stmt = stmt.order_by(models.Attendance.id.desc())
    res = await db.execute(stmt)
    rows = res.all()
    out = []
    for att, emp in rows:
        out.append({
            "id": att.id, "employee_id": att.employee_id, "employee_name": _full_name(emp),
            "date": att.date, "type": att.type, "time": att.time, "notes": att.notes,
            "approved": att.approved, "channel": att.channel, "created_at": att.created_at,
        })
    return out


# ── Alerts (calculadas de datos reales, no aleatorias) ─────────────────
def _days_until(iso_date: str) -> int:
    try:
        d = date.fromisoformat(iso_date)
    except ValueError:
        return 99999
    return (d - date.today()).days


async def get_alerts(db: AsyncSession) -> List[dict]:
    employees = await get_employees(db)
    alerts = []
    today = date.today()
    for e in employees:
        if not e.is_active:
            continue
        end = e.contract_end or e.trial_end
        if end:
            days = _days_until(end)
            if 0 <= days <= 30:
                kind = "danger" if days <= 7 else "warning"
                label = "Período de prueba" if e.trial_end and not e.contract_end else "Contrato"
                alerts.append({
                    "id": f"contract-{e.id}", "type": kind, "employee_id": e.id, "employee_name": _full_name(e),
                    "message": f"{label} vence en {days} días ({end})",
                    "date": today.isoformat(),
                    "action": "Renovar / Hacer fijo / Liquidar" if label == "Contrato" else "Evaluar para hacer fijo",
                })
            elif days < 0:
                alerts.append({
                    "id": f"expired-{e.id}", "type": "danger", "employee_id": e.id, "employee_name": _full_name(e),
                    "message": f"Contrato vencido desde {end}", "date": today.isoformat(),
                    "action": "Regularizar de inmediato",
                })
    return alerts


# ── Dashboard ────────────────────────────────────────────────────────────
async def get_dashboard(db: AsyncSession) -> dict:
    employees = await get_employees(db)
    active = [e for e in employees if e.status == "activo"]
    on_trial = [e for e in employees if e.contract_type in ("prueba", "capacitacion")]
    expiring_30 = [e for e in employees if (e.contract_end or e.trial_end) and 0 <= _days_until(e.contract_end or e.trial_end) <= 30]
    total_payroll = sum(e.base_salary for e in employees if e.is_active)
    by_department: dict = {}
    for e in employees:
        if e.is_active:
            by_department[e.department] = by_department.get(e.department, 0) + 1
    today_iso = date.today().isoformat()
    today_attendance = await get_attendance(db, today_iso)
    present_today = sum(1 for a in today_attendance if a["type"] == "entrada")
    absent_today = sum(1 for a in today_attendance if a["type"] == "falta")
    return {
        "total": len(employees), "active": len(active), "on_trial": len(on_trial),
        "expiring_30": len(expiring_30), "total_payroll_monthly": round(total_payroll * 2, 2),
        "by_department": by_department, "present_today": present_today, "absent_today": absent_today,
    }


# ── Payroll periods ──────────────────────────────────────────────────────
async def create_period(db: AsyncSession, data: schemas.PayrollPeriodCreate, user_id: Optional[int] = None) -> models.PayrollPeriod:
    period = models.PayrollPeriod(**data.model_dump(), status="draft")
    db.add(period)
    await db.commit()
    await db.refresh(period)
    await _log_audit(db, user_id, "CREATE_PERIOD", f"Período de nómina '{data.name}' creado", {"id": period.id})
    return period


async def get_periods(db: AsyncSession) -> List[dict]:
    res = await db.execute(select(models.PayrollPeriod).order_by(models.PayrollPeriod.id.desc()))
    periods = res.scalars().all()
    out = []
    for p in periods:
        out.append(await _period_summary(db, p))
    return out


async def _period_summary(db: AsyncSession, p: models.PayrollPeriod) -> dict:
    res = await db.execute(select(models.PayrollDetail).where(models.PayrollDetail.period_id == p.id))
    details = res.scalars().all()
    return {
        "id": p.id, "name": p.name, "frequency": p.frequency, "start_date": p.start_date,
        "end_date": p.end_date, "payment_date": p.payment_date, "status": p.status,
        "kind": p.kind,
        "total_employees": len(details),
        "total_gross": round(sum(d.total_gross for d in details), 2),
        "total_deductions": round(sum(d.total_deductions for d in details), 2),
        "total_net": round(sum(d.total_net for d in details), 2),
    }


async def get_period_detail(db: AsyncSession, period_id: int) -> Optional[dict]:
    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    p = res.scalars().first()
    if not p:
        return None
    summary = await _period_summary(db, p)
    res2 = await db.execute(
        select(models.PayrollDetail, models.Employee)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(models.PayrollDetail.period_id == period_id)
    )
    rows = res2.all()
    details = []
    for d, emp in rows:
        details.append({
            "employee_id": d.employee_id, "employee_name": _full_name(emp), "department": d.department,
            "base_salary": d.base_salary, "days_worked": d.days_worked,
            "days_absent": d.days_absent, "days_incapacity": d.days_incapacity,
            "salary_earned": d.salary_earned,
            "overtime_double": d.overtime_double, "overtime_triple": d.overtime_triple, "bonus": d.bonus,
            "vacation_premium": d.vacation_premium, "food_vouchers": d.food_vouchers, "savings_fund": d.savings_fund,
            "aguinaldo": d.aguinaldo, "subsidy_applied": d.subsidy_applied,
            "imss_employee": d.imss_employee, "isr": d.isr, "infonavit": d.infonavit, "fonacot": d.fonacot,
            "loan_deduction": d.loan_deduction,
            "imss_employer": d.imss_employer, "infonavit_employer": d.infonavit_employer,
            "total_gross": d.total_gross, "total_deductions": d.total_deductions,
            "total_net": d.total_net, "dispersion_status": d.dispersion_status, "bank": emp.bank, "clabe": emp.clabe,
            "state_payroll_tax": d.state_payroll_tax,
            "notes": d.notes, "edited_manually": d.edited_manually,
        })
    summary["details"] = details
    summary["kind"] = p.kind
    # Totales patronal (informativos)
    res_det = await db.execute(select(models.PayrollDetail).where(models.PayrollDetail.period_id == period_id))
    all_det = res_det.scalars().all()
    summary["total_imss_employer"] = round(sum(d.imss_employer for d in all_det), 2)
    summary["total_infonavit_employer"] = round(sum(d.infonavit_employer for d in all_det), 2)
    summary["total_state_payroll_tax"] = round(sum(d.state_payroll_tax for d in all_det), 2)
    summary["total_subsidy_applied"] = round(sum(d.subsidy_applied for d in all_det), 2)
    return summary


async def _attendance_summary_for_period(
    db: AsyncSession, employee_id: int, start: date, end: date
) -> dict:
    """Cuenta días de falta/incapacidad/vacación y horas extra por empleado
    en el rango del período. Se usa para ajustar el cálculo del recibo."""
    res = await db.execute(
        select(models.Attendance).where(
            models.Attendance.employee_id == employee_id,
            models.Attendance.date >= start.isoformat(),
            models.Attendance.date <= end.isoformat(),
        )
    )
    rows = res.scalars().all()

    days_absent = 0.0
    days_incapacity = 0.0
    days_vacation = 0.0
    # Horas extra por semana ISO para aplicar el tope de 9h/sem dobles
    extra_by_iso_week: dict = {}
    for a in rows:
        if a.type == "falta":
            days_absent += 1
        elif a.type == "incapacidad":
            days_incapacity += 1
        elif a.type == "vacacion":
            days_vacation += 1
        elif a.type == "extra" and a.hours:
            d = date.fromisoformat(a.date)
            iso = d.isocalendar()
            key = (iso[0], iso[1])
            extra_by_iso_week[key] = extra_by_iso_week.get(key, 0.0) + a.hours

    double_hours = 0.0
    triple_hours = 0.0
    for hrs in extra_by_iso_week.values():
        double_hours += min(hrs, 9)
        triple_hours += max(hrs - 9, 0)

    return {
        "days_absent": days_absent,
        "days_incapacity": days_incapacity,
        "days_vacation": days_vacation,
        "double_hours": double_hours,
        "triple_hours": triple_hours,
    }


def _hourly_rate(base_salary: float) -> float:
    """Salario por hora (jornada estándar 8h/día, 30 días/mes)."""
    return (base_salary or 0.0) / 30.0 / 8.0


async def calculate_period(db: AsyncSession, period_id: int, user_id: Optional[int] = None) -> Optional[dict]:
    """Calcula el recibo de nómina de cada empleado del período.

    Incluye (nivel mundial):
      - Faltas (descuento proporcional del salario).
      - Incapacidad: primeros 3 días descontados (Art. 42 LSS); a partir del
        4to día el IMSS paga el subsidio y el patrón no descuenta salario.
      - Horas extra tomadas de Asistencia (type=extra): dobles hasta 9h/sem,
        triples excedente (Art. 66-68 LFT).
      - Prima vacacional si hubo vacaciones tomadas en el período (25% Art. 80).
      - ISR con subsidio al empleo (crédito al salario).
      - IMSS obrero + patronal (para SUA y P&L de nómina).
      - INFONAVIT obrero + patronal (5% amortización habitación).
      - Aguinaldo si period.kind == 'aguinaldo' (proporcional 15 días LFT Art. 87).
    """
    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res.scalars().first()
    if not period:
        return None
    if period.status not in ("draft", "calculated"):
        raise ValueError("Solo se pueden calcular períodos en borrador o ya calculados. Una nómina aprobada ya no se puede recalcular.")

    # Recalcular: guarda las ediciones manuales previas (bonos, vales, ahorro,
    # préstamos y notas) para reaplicarlas al final. Así el operador que agregó
    # un empleado nuevo o corrigió una asistencia no pierde los ajustes hechos
    # antes en otros empleados.
    res_old = await db.execute(select(models.PayrollDetail).where(models.PayrollDetail.period_id == period_id))
    old_manual: dict[int, dict] = {}
    for old in res_old.scalars().all():
        if old.edited_manually:
            old_manual[old.employee_id] = {
                "bonus": old.bonus, "food_vouchers": old.food_vouchers,
                "savings_fund": old.savings_fund, "loan_deduction": old.loan_deduction,
                "notes": old.notes,
            }
        await db.delete(old)

    start = date.fromisoformat(period.start_date)
    end = date.fromisoformat(period.end_date)
    period_days = (end - start).days + 1

    employees = await get_employees(db)
    isn_rate = await _get_state_payroll_tax_rate(db)
    # Para aguinaldo se calcula independientemente de la frecuencia (una vez al año)
    if period.kind == "aguinaldo":
        eligible = [e for e in employees if e.is_active]
    else:
        eligible = [e for e in employees if e.is_active and e.pay_frequency == period.frequency]

    for e in eligible:
        att = await _attendance_summary_for_period(db, e.id, start, end)

        base_daily = (e.base_salary or 0.0) / 30.0

        if period.kind == "aguinaldo":
            # Aguinaldo proporcional (LFT Art. 87): mínimo 15 días de salario
            # por año trabajado, proporcional para menos de un año.
            try:
                hire = date.fromisoformat(e.hire_date) if e.hire_date else start
            except ValueError:
                hire = start
            year_start = date(start.year, 1, 1)
            worked_from = max(hire, year_start)
            worked_days = max((end - worked_from).days + 1, 0)
            worked_days = min(worked_days, 365)
            aguinaldo = round(base_daily * 15 * (worked_days / 365.0), 2)

            imss_employee = 0.0  # aguinaldo exento hasta 30 UMAs (Art. 93 LISR)
            imss_employer = 0.0
            infonavit_amt = 0.0
            infonavit_employer_amt = 0.0
            fonacot_amt = 0.0

            uma_exenta = 30 * UMA_2026
            gravable = max(aguinaldo - uma_exenta, 0.0)
            isr_ret, sae, _ = calc_isr_net(gravable, "mensual")

            state_isn = calc_state_payroll_tax(aguinaldo, isn_rate)
            detail = models.PayrollDetail(
                period_id=period.id, employee_id=e.id, department=e.department,
                base_salary=e.base_salary,
                days_worked=0, days_absent=0, days_incapacity=0,
                salary_earned=0.0, aguinaldo=aguinaldo,
                overtime_double=0.0, overtime_triple=0.0,
                bonus=0.0, vacation_premium=0.0, food_vouchers=0.0, savings_fund=0.0,
                subsidy_applied=sae,
                imss_employee=imss_employee, isr=isr_ret,
                infonavit=infonavit_amt, fonacot=fonacot_amt, loan_deduction=0.0,
                imss_employer=imss_employer, infonavit_employer=infonavit_employer_amt,
                state_payroll_tax=state_isn,
                total_gross=round(aguinaldo, 2),
                total_deductions=round(isr_ret, 2),
                total_net=round(aguinaldo - isr_ret + sae, 2),
                dispersion_status="pendiente",
            )
            db.add(detail)
            continue

        # ── Nómina regular ──────────────────────────────────────────────────
        # Faltas descontadas
        days_absent = att["days_absent"]
        # Incapacidad: primeros 3 días descontados, el resto lo paga IMSS
        days_incapacity = att["days_incapacity"]
        days_deducted_incap = min(days_incapacity, 3)
        # Vacaciones tomadas se pagan (no se descuentan)
        days_worked = max(period_days - days_absent - days_deducted_incap, 0)

        salary_earned = round(base_daily * days_worked, 2)

        # Horas extra
        hourly = _hourly_rate(e.base_salary or 0.0)
        overtime_double = round(att["double_hours"] * hourly * 2, 2)
        overtime_triple = round(att["triple_hours"] * hourly * 3, 2)

        # Prima vacacional (25% del salario correspondiente a los días de
        # vacaciones tomados en el período)
        vacation_premium = round(att["days_vacation"] * base_daily * 0.25, 2)

        gross_taxable = salary_earned + overtime_double + overtime_triple + vacation_premium

        # IMSS obrero + patronal sobre SBC × días cotizados (se restan
        # ausencias del período de cotización)
        dias_cotizados = max(_FREQ_DAYS.get(period.frequency, 30) - days_absent, 0)
        imss_employee = calc_imss_employee(e.sbc or 0.0, int(round(dias_cotizados)))
        imss_employer = calc_imss_employer(e.sbc or 0.0, int(round(dias_cotizados)))

        # INFONAVIT obrero (crédito habitación configurado en el empleado)
        infonavit_amt = calc_infonavit(e, salary_earned)
        # INFONAVIT patronal (5% SBC amortización habitación)
        infonavit_employer_amt = calc_infonavit_employer_amort(e.sbc or 0.0, int(round(dias_cotizados)))
        # FONACOT
        fonacot_amt = calc_fonacot(e)

        # ISR sobre gravable (salario + h.extra gravable + prima vac gravable)
        # Simplificación: aplicamos toda h.extra y prima vacacional como gravable
        # (los exentos por ley se declaran en el CFDI 4.0, aquí calculamos ISR
        # sobre el bruto para retención conservadora).
        gravable = max(gross_taxable - imss_employee, 0.0)
        isr_ret, sae, _ = calc_isr_net(gravable, period.frequency)

        total_gross = round(gross_taxable, 2)
        total_deductions = round(imss_employee + isr_ret + infonavit_amt + fonacot_amt, 2)
        total_net = round(total_gross - total_deductions + sae, 2)
        state_isn = calc_state_payroll_tax(total_gross, isn_rate)

        detail = models.PayrollDetail(
            period_id=period.id, employee_id=e.id, department=e.department,
            base_salary=e.base_salary,
            days_worked=days_worked, days_absent=days_absent, days_incapacity=days_incapacity,
            salary_earned=salary_earned,
            overtime_double=overtime_double, overtime_triple=overtime_triple,
            bonus=0.0, vacation_premium=vacation_premium,
            food_vouchers=0.0, savings_fund=0.0, aguinaldo=0.0,
            subsidy_applied=sae,
            imss_employee=imss_employee, isr=isr_ret,
            infonavit=infonavit_amt, fonacot=fonacot_amt, loan_deduction=0.0,
            imss_employer=imss_employer, infonavit_employer=infonavit_employer_amt,
            state_payroll_tax=state_isn,
            total_gross=total_gross,
            total_deductions=total_deductions, total_net=total_net,
            dispersion_status="pendiente",
        )
        db.add(detail)

    period.status = "calculated"
    await db.commit()

    # Reaplica ediciones manuales previas (bonos/vales/ahorro/préstamos/notas)
    # sobre los empleados que las tenían y siguen elegibles. Esto hace que el
    # botón "Recalcular" sea seguro: agrega empleados nuevos o reprocesa
    # asistencias sin perder los ajustes que ya había hecho el operador.
    reapplied = 0
    for emp_id, patch in old_manual.items():
        try:
            await update_payroll_detail(db, period_id, emp_id, patch, user_id=user_id)
            reapplied += 1
        except ValueError:
            # El empleado ya no está elegible (ej. se dio de baja). Se omite.
            pass

    await _log_audit(
        db, user_id, "CALCULATE_PAYROLL",
        f"Nómina calculada para período '{period.name}' ({len(eligible)} empleados"
        + (f", {reapplied} ediciones manuales preservadas" if reapplied else "")
        + ")",
        {"id": period_id, "employees": len(eligible), "reapplied_manual_edits": reapplied},
    )
    return await get_period_detail(db, period_id)


async def approve_period(db: AsyncSession, period_id: int, user_id: Optional[int] = None) -> Optional[dict]:
    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res.scalars().first()
    if not period:
        return None
    if period.status != "calculated":
        raise ValueError("Solo se pueden aprobar períodos ya calculados")
    period.status = "approved"
    period.approved_by_id = user_id
    period.approved_at = datetime.utcnow()
    await db.commit()
    await _log_audit(db, user_id, "APPROVE_PAYROLL", f"Período '{period.name}' aprobado", {"id": period_id})
    return await get_period_detail(db, period_id)


async def disperse_period(db: AsyncSession, period_id: int, user_id: Optional[int] = None) -> Optional[dict]:
    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res.scalars().first()
    if not period:
        return None
    if period.status != "approved":
        raise ValueError("Solo se pueden dispersar períodos aprobados")
    res2 = await db.execute(select(models.PayrollDetail).where(models.PayrollDetail.period_id == period_id))
    for d in res2.scalars().all():
        d.dispersion_status = "confirmado"
    period.status = "dispersed"
    period.dispersed_at = datetime.utcnow()
    await db.commit()
    await _log_audit(db, user_id, "DISPERSE_PAYROLL", f"Período '{period.name}' dispersado", {"id": period_id})
    return await get_period_detail(db, period_id)


async def _dispersion_rows_for_period(
    db: AsyncSession, period_id: int, bank: Optional[str] = None
):
    """Regresa (rows, employee_map, payment_date) listos para pasarse al
    generador de layouts bancarios."""
    from app.modules.hr.bank_layouts import DispersionRow

    res_p = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res_p.scalars().first()
    if not period:
        raise ValueError("Período no encontrado")

    res = await db.execute(
        select(models.PayrollDetail, models.Employee)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(models.PayrollDetail.period_id == period_id)
    )

    rows = []
    for d, emp in res.all():
        if bank and (emp.bank or "").strip().lower() != bank.strip().lower():
            continue
        rows.append(DispersionRow(
            employee_number=str(emp.employee_number or emp.id),
            full_name=_full_name(emp),
            rfc=emp.rfc or "",
            clabe=emp.clabe or "",
            amount=float(d.total_net or 0.0),
            reference=str(emp.employee_number or emp.id),
            concept=f"NOMINA {period.name}",
            bank=emp.bank or "",
        ))

    payment_date = None
    if period.payment_date:
        try:
            payment_date = date.fromisoformat(period.payment_date)
        except ValueError:
            payment_date = None

    return rows, period, payment_date


async def dispersion_summary(db: AsyncSession, period_id: int) -> dict:
    """Resumen de dispersión: totales por banco + validación de datos."""
    from app.modules.hr.bank_layouts import (
        SUPPORTED_BANKS, validate_rows, LAYOUT_META,
    )

    rows, period, _pd = await _dispersion_rows_for_period(db, period_id)
    validated = validate_rows(rows)

    # Totales por banco (agrupando bancos no soportados en "Otros")
    by_bank: dict = {}
    for v in validated:
        b = v.row.bank.strip() if v.row.bank else ""
        bucket = b if b in SUPPORTED_BANKS or b in ("Citibanamex",) else "Otros"
        if bucket == "Citibanamex":
            bucket = "Banamex"
        g = by_bank.setdefault(bucket, {
            "bank": bucket, "employees": 0, "amount": 0.0,
            "ready": 0, "with_errors": 0, "layout_supported": bucket in SUPPORTED_BANKS,
        })
        g["employees"] += 1
        g["amount"] += v.row.amount
        if v.ok:
            g["ready"] += 1
        else:
            g["with_errors"] += 1

    banks_out = sorted(by_bank.values(), key=lambda b: -b["amount"])
    for b in banks_out:
        b["amount"] = round(b["amount"], 2)

    return {
        "period_id": period.id,
        "period_name": period.name,
        "period_status": period.status,
        "payment_date": period.payment_date,
        "total_employees": len(validated),
        "total_amount": round(sum(v.row.amount for v in validated), 2),
        "ready_count": sum(1 for v in validated if v.ok),
        "error_count": sum(1 for v in validated if not v.ok),
        "banks": banks_out,
        "supported_banks": SUPPORTED_BANKS,
        "issues": [
            {
                "employee_name": v.row.full_name,
                "employee_number": v.row.employee_number,
                "bank": v.row.bank,
                "reasons": v.reasons,
                "amount": v.row.amount,
            }
            for v in validated if not v.ok
        ],
    }


async def generate_bank_layout(
    db: AsyncSession, period_id: int, bank: str,
    origin_account: str = "", lote_number: str = "1",
    skip_invalid: bool = True,
) -> tuple[str, str, str]:
    """Genera el layout del banco elegido. Devuelve (contenido, filename, mime).

    - `bank` puede ser "BBVA", "Banorte", "Santander", "HSBC", "Banamex", "SPEI"
      o "CSV" (fallback genérico).
    - `origin_account` es la CLABE de la cuenta cargo del cliente. Si el banco
      lo requiere y no viene, se usa un placeholder de 18 ceros que el operador
      debe reemplazar antes de subir (o corregirlo en el archivo).
    - `skip_invalid=True` excluye del layout las filas con CLABE inválida o
      datos faltantes; devuelve el archivo con solo las filas listas.
    """
    from app.modules.hr.bank_layouts import (
        generate_layout, validate_rows, LAYOUT_META, SUPPORTED_BANKS,
    )

    bank_key = (bank or "").strip()
    # Si el usuario pide un banco no soportado, cae a CSV
    if bank_key not in SUPPORTED_BANKS and bank_key.title() not in ("Banamex", "Citibanamex"):
        bank_key = "CSV"

    filter_bank = None if bank_key in ("SPEI", "CSV") else bank_key
    # Para 'Banamex' hay que filtrar tambien las cuentas marcadas 'Citibanamex'
    rows, period, payment_date = await _dispersion_rows_for_period(db, period_id, filter_bank)
    if bank_key.lower() == "banamex":
        rows_extra, _, _ = await _dispersion_rows_for_period(db, period_id, "Citibanamex")
        rows.extend(rows_extra)

    if skip_invalid:
        valid = validate_rows(rows)
        rows = [v.row for v in valid if v.ok]

    if not origin_account:
        origin_account = "0" * 18

    content = generate_layout(bank_key, rows, origin_account, lote_number, payment_date)

    meta = LAYOUT_META.get(bank_key, LAYOUT_META["CSV"])
    safe_bank = bank_key.replace(" ", "_").lower()
    filename = f"dispersion_{safe_bank}_periodo_{period_id}.{meta['extension']}"
    return content, filename, meta["content_type"]


# Compatibilidad hacia atrás: la implementación anterior devolvía CSV genérico.
async def generate_bank_layout_csv(db: AsyncSession, period_id: int, bank: Optional[str] = None) -> str:
    content, _fn, _mime = await generate_bank_layout(db, period_id, bank or "CSV")
    return content


async def generate_headcount_csv(db: AsyncSession) -> str:
    employees = await get_employees(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["No. empleado", "Nombre", "Departamento", "Puesto", "Tipo de contrato", "Estado", "Fecha de ingreso"])
    for e in employees:
        writer.writerow([e.employee_number, _full_name(e), e.department, e.position, e.contract_type, e.status, e.hire_date])
    return buf.getvalue()


async def generate_vacation_csv(db: AsyncSession) -> str:
    employees = await get_employees(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["No. empleado", "Nombre", "Días generados", "Días tomados", "Días disponibles"])
    for e in employees:
        writer.writerow([e.employee_number, _full_name(e), e.vacation_days, e.vacation_used, e.vacation_days - e.vacation_used])
    return buf.getvalue()


# ── Horas extra (LFT 2026, Art. 66-68) ──────────────────────────────────
# Primeras 9 horas extra por semana: dobles. Excedente: triples.
async def _overtime_by_employee(db: AsyncSession, start_date: str, end_date: str) -> List[dict]:
    res = await db.execute(
        select(models.Attendance, models.Employee)
        .join(models.Employee, models.Attendance.employee_id == models.Employee.id)
        .where(
            models.Attendance.type == "extra",
            models.Attendance.date >= start_date,
            models.Attendance.date <= end_date,
        )
    )
    rows = res.all()
    # Agrupa por empleado + semana ISO
    by_emp_week: dict = {}
    emp_lookup: dict = {}
    for att, emp in rows:
        emp_lookup[emp.id] = emp
        d = date.fromisoformat(att.date)
        iso_year, iso_week, _ = d.isocalendar()
        key = (emp.id, iso_year, iso_week)
        by_emp_week[key] = by_emp_week.get(key, 0.0) + (att.hours or 0.0)

    per_employee: dict = {}
    for (emp_id, iso_year, iso_week), hours in by_emp_week.items():
        emp = emp_lookup[emp_id]
        hourly_rate = (emp.base_salary / 30 / 8) if emp.base_salary else 0.0
        double_hours = min(hours, 9)
        triple_hours = max(hours - 9, 0)
        double_pay = round(double_hours * hourly_rate * 2, 2)
        triple_pay = round(triple_hours * hourly_rate * 3, 2)
        acc = per_employee.setdefault(emp_id, {
            "employee_id": emp_id, "employee_name": _full_name(emp), "department": emp.department,
            "total_hours": 0.0, "double_hours": 0.0, "triple_hours": 0.0, "double_pay": 0.0, "triple_pay": 0.0,
        })
        acc["total_hours"] += hours
        acc["double_hours"] += double_hours
        acc["triple_hours"] += triple_hours
        acc["double_pay"] += double_pay
        acc["triple_pay"] += triple_pay

    out = list(per_employee.values())
    for r in out:
        r["total_pay"] = round(r["double_pay"] + r["triple_pay"], 2)
    return sorted(out, key=lambda r: r["employee_name"])


async def generate_overtime_csv(db: AsyncSession, start_date: str, end_date: str) -> str:
    rows = await _overtime_by_employee(db, start_date, end_date)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "No. empleado", "Nombre", "Departamento", "Horas extra totales",
        "Horas dobles (hasta 9/sem)", "Horas triples (excedente)",
        "Pago horas dobles", "Pago horas triples", "Pago total",
    ])
    for r in rows:
        emp = await get_employee(db, r["employee_id"])
        writer.writerow([
            emp.employee_number if emp else "", r["employee_name"], r["department"],
            round(r["total_hours"], 2), round(r["double_hours"], 2), round(r["triple_hours"], 2),
            f"{r['double_pay']:.2f}", f"{r['triple_pay']:.2f}", f"{r['total_pay']:.2f}",
        ])
    return buf.getvalue()


# ── Acumulado anual ──────────────────────────────────────────────────────
async def get_annual_accumulated(db: AsyncSession, year: int) -> List[dict]:
    res = await db.execute(
        select(models.PayrollDetail, models.PayrollPeriod, models.Employee)
        .join(models.PayrollPeriod, models.PayrollDetail.period_id == models.PayrollPeriod.id)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(
            models.PayrollPeriod.start_date >= f"{year}-01-01",
            models.PayrollPeriod.start_date <= f"{year}-12-31",
            models.PayrollPeriod.status.in_(["calculated", "approved", "dispersed"]),
        )
    )
    rows = res.all()
    per_employee: dict = {}
    for d, p, emp in rows:
        acc = per_employee.setdefault(emp.id, {
            "employee_id": emp.id, "employee_name": _full_name(emp), "department": emp.department,
            "days_worked": 0.0, "salary_earned": 0.0, "overtime_double": 0.0, "overtime_triple": 0.0,
            "bonus": 0.0, "vacation_premium": 0.0, "food_vouchers": 0.0, "savings_fund": 0.0,
            "imss_employee": 0.0, "isr": 0.0, "infonavit": 0.0, "fonacot": 0.0, "loan_deduction": 0.0,
            "total_gross": 0.0, "total_deductions": 0.0, "total_net": 0.0, "periods_count": 0,
        })
        for field in (
            "days_worked", "salary_earned", "overtime_double", "overtime_triple", "bonus", "vacation_premium",
            "food_vouchers", "savings_fund", "imss_employee", "isr", "infonavit", "fonacot", "loan_deduction",
            "total_gross", "total_deductions", "total_net",
        ):
            acc[field] += getattr(d, field) or 0.0
        acc["periods_count"] += 1
    out = list(per_employee.values())
    for r in out:
        for k, v in list(r.items()):
            if isinstance(v, float):
                r[k] = round(v, 2)
    return sorted(out, key=lambda r: r["employee_name"])


async def generate_annual_accumulated_csv(db: AsyncSession, year: int) -> str:
    rows = await get_annual_accumulated(db, year)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "No. empleado", "Nombre", "Departamento", "Períodos pagados", "Días trabajados",
        "Salario percibido", "Extra dobles", "Extra triples", "Bonos", "Prima vacacional",
        "Vales de despensa", "Fondo de ahorro", "IMSS", "ISR", "INFONAVIT", "FONACOT",
        "Préstamos", "Total percepciones", "Total deducciones", "Total neto anual",
    ])
    for r in rows:
        emp = await get_employee(db, r["employee_id"])
        writer.writerow([
            emp.employee_number if emp else "", r["employee_name"], r["department"], r["periods_count"],
            r["days_worked"], r["salary_earned"], r["overtime_double"], r["overtime_triple"], r["bonus"],
            r["vacation_premium"], r["food_vouchers"], r["savings_fund"], r["imss_employee"], r["isr"],
            r["infonavit"], r["fonacot"], r["loan_deduction"], r["total_gross"], r["total_deductions"], r["total_net"],
        ])
    return buf.getvalue()


# ── PTU (Participación de los Trabajadores en las Utilidades) ──────────
# Reparto legal: 50% proporcional a días trabajados en el año, 50% proporcional al salario percibido.
async def calculate_ptu(db: AsyncSession, year: int, total_utilidad: float) -> List[dict]:
    accumulated = await get_annual_accumulated(db, year)
    total_days = sum(r["days_worked"] for r in accumulated)
    total_salary = sum(r["salary_earned"] for r in accumulated)
    monto_dias = total_utilidad * 0.5
    monto_salario = total_utilidad * 0.5
    out = []
    for r in accumulated:
        part_dias = round((r["days_worked"] / total_days) * monto_dias, 2) if total_days else 0.0
        part_salario = round((r["salary_earned"] / total_salary) * monto_salario, 2) if total_salary else 0.0
        out.append({
            "employee_id": r["employee_id"], "employee_name": r["employee_name"], "department": r["department"],
            "days_worked": r["days_worked"], "salary_earned": r["salary_earned"],
            "ptu_by_days": part_dias, "ptu_by_salary": part_salario, "ptu_total": round(part_dias + part_salario, 2),
        })
    return out


async def generate_ptu_csv(db: AsyncSession, year: int, total_utilidad: float) -> str:
    rows = await calculate_ptu(db, year, total_utilidad)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "No. empleado", "Nombre", "Departamento", "Días trabajados (año)", "Salario percibido (año)",
        "PTU por días (50%)", "PTU por salario (50%)", "PTU total",
    ])
    for r in rows:
        emp = await get_employee(db, r["employee_id"])
        writer.writerow([
            emp.employee_number if emp else "", r["employee_name"], r["department"],
            r["days_worked"], r["salary_earned"], f"{r['ptu_by_days']:.2f}", f"{r['ptu_by_salary']:.2f}", f"{r['ptu_total']:.2f}",
        ])
    return buf.getvalue()


# ── INFONAVIT / FONACOT ──────────────────────────────────────────────────
def calc_infonavit(employee: models.Employee, salary_earned: float) -> float:
    if not employee.infonavit_credit or not employee.infonavit_discount_type:
        return 0.0
    value = employee.infonavit_discount_value or 0.0
    if employee.infonavit_discount_type == "cuota_fija":
        return round(value, 2)
    if employee.infonavit_discount_type == "porcentaje":
        return round(salary_earned * (value / 100), 2)
    if employee.infonavit_discount_type == "factor_veces_salario":
        # Factor de descuento aplicado sobre el salario mínimo diario vigente (UMA como referencia)
        return round(value * UMA_2026, 2)
    return 0.0


def calc_fonacot(employee: models.Employee) -> float:
    if not employee.fonacot_credit:
        return 0.0
    return round(employee.fonacot_discount_value or 0.0, 2)


async def generate_infonavit_csv(db: AsyncSession) -> str:
    employees = await get_employees(db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "No. empleado", "Nombre", "Número de crédito INFONAVIT", "Tipo de descuento",
        "Valor configurado", "Descuento estimado por periodo", "Número de crédito FONACOT", "Descuento FONACOT",
    ])
    for e in employees:
        if not e.infonavit_credit and not e.fonacot_credit:
            continue
        salary_period = (e.base_salary / 30) * _FREQ_DAYS.get(e.pay_frequency, 30)
        infonavit_amount = calc_infonavit(e, salary_period)
        fonacot_amount = calc_fonacot(e)
        writer.writerow([
            e.employee_number, _full_name(e), e.infonavit_credit or "", e.infonavit_discount_type or "",
            e.infonavit_discount_value if e.infonavit_discount_value is not None else "",
            f"{infonavit_amount:.2f}", e.fonacot_credit or "", f"{fonacot_amount:.2f}",
        ])
    return buf.getvalue()


# ── SUA — IMSS ────────────────────────────────────────────────────────────
# Nota: este reporte es un archivo de apoyo con las cuotas obrero-patronales calculadas
# por el sistema (mismo motor que calc_imss). No sustituye al archivo de importación con
# el layout binario propietario del SUA (Sistema Único de Autodeterminación) del IMSS,
# el cual debe generarse o validarse directamente en el programa oficial del IMSS.
async def generate_sua_csv(db: AsyncSession, period_id: int) -> str:
    detail = await get_period_detail(db, period_id)
    if not detail:
        raise ValueError("Período no encontrado")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "No. empleado", "Nombre", "NSS", "SBC", "Días cotizados",
        "Cuota obrero IMSS", "Salario base período", "Observación",
    ])
    res = await db.execute(
        select(models.PayrollDetail, models.Employee)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(models.PayrollDetail.period_id == period_id)
    )
    for d, emp in res.all():
        writer.writerow([
            emp.employee_number, _full_name(emp), emp.nss or "", emp.sbc, d.days_worked,
            f"{d.imss_employee:.2f}", f"{d.base_salary:.2f}",
            "Archivo de apoyo - capturar/validar en programa SUA oficial del IMSS",
        ])
    return buf.getvalue()


# ── Recibos PDF ─────────────────────────────────────────────────────────────

async def _get_company_info(db: AsyncSession) -> tuple[str, Optional[str]]:
    try:
        from app.modules.core_config import models as cfg_models
        res = await db.execute(select(cfg_models.CompanyProfile).limit(1))
        cp = res.scalars().first()
        if cp:
            return (cp.name or "STHENOVA ERP", getattr(cp, "rfc", None))
    except Exception:
        pass
    return "STHENOVA ERP", None


def _employee_to_dict(emp: models.Employee) -> dict:
    return {
        "id": emp.id,
        "employee_number": emp.employee_number,
        "name": emp.name, "last_name": emp.last_name,
        "position": emp.position, "department": emp.department,
        "rfc": emp.rfc, "curp": emp.curp, "nss": emp.nss,
        "bank": emp.bank, "clabe": emp.clabe,
    }


async def build_employee_receipt(
    db: AsyncSession, period_id: int, employee_id: int
) -> tuple[bytes, str]:
    """Genera el PDF del recibo de un empleado en un período. Devuelve
    (bytes, filename)."""
    from app.modules.hr.receipts import build_receipt_pdf

    res = await db.execute(
        select(models.PayrollDetail, models.Employee, models.PayrollPeriod)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .join(models.PayrollPeriod, models.PayrollDetail.period_id == models.PayrollPeriod.id)
        .where(
            models.PayrollDetail.period_id == period_id,
            models.PayrollDetail.employee_id == employee_id,
        )
    )
    row = res.first()
    if not row:
        raise ValueError("No hay recibo para ese empleado en este período")

    d, emp, p = row
    period_dict = {
        "name": p.name, "frequency": p.frequency,
        "start_date": p.start_date, "end_date": p.end_date,
        "payment_date": p.payment_date, "kind": p.kind,
    }
    detail_dict = {
        "days_worked": d.days_worked, "days_absent": d.days_absent, "days_incapacity": d.days_incapacity,
        "salary_earned": d.salary_earned, "overtime_double": d.overtime_double, "overtime_triple": d.overtime_triple,
        "bonus": d.bonus, "vacation_premium": d.vacation_premium, "food_vouchers": d.food_vouchers,
        "savings_fund": d.savings_fund, "aguinaldo": d.aguinaldo, "subsidy_applied": d.subsidy_applied,
        "imss_employee": d.imss_employee, "isr": d.isr, "infonavit": d.infonavit,
        "fonacot": d.fonacot, "loan_deduction": d.loan_deduction,
        "imss_employer": d.imss_employer, "infonavit_employer": d.infonavit_employer,
        "state_payroll_tax": d.state_payroll_tax,
        "notes": d.notes,
        "total_net": d.total_net,
    }
    company_name, company_rfc = await _get_company_info(db)
    pdf = build_receipt_pdf(
        _employee_to_dict(emp), period_dict, detail_dict,
        company_name=company_name, company_rfc=company_rfc,
    )
    safe = _full_name(emp).replace(" ", "_")
    return pdf, f"recibo_{emp.employee_number}_{safe}_periodo_{period_id}.pdf"


async def build_period_receipts_zip(db: AsyncSession, period_id: int) -> tuple[bytes, str]:
    """Genera un ZIP con los recibos de todos los empleados del período."""
    from app.modules.hr.receipts import build_receipt_pdf, build_receipts_zip

    res = await db.execute(
        select(models.PayrollDetail, models.Employee, models.PayrollPeriod)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .join(models.PayrollPeriod, models.PayrollDetail.period_id == models.PayrollPeriod.id)
        .where(models.PayrollDetail.period_id == period_id)
    )
    rows = res.all()
    if not rows:
        raise ValueError("El período no tiene recibos calculados")

    company_name, company_rfc = await _get_company_info(db)
    files: List[tuple[str, bytes]] = []
    for d, emp, p in rows:
        period_dict = {
            "name": p.name, "frequency": p.frequency,
            "start_date": p.start_date, "end_date": p.end_date,
            "payment_date": p.payment_date, "kind": p.kind,
        }
        detail_dict = {
            "days_worked": d.days_worked, "days_absent": d.days_absent, "days_incapacity": d.days_incapacity,
            "salary_earned": d.salary_earned, "overtime_double": d.overtime_double, "overtime_triple": d.overtime_triple,
            "bonus": d.bonus, "vacation_premium": d.vacation_premium, "food_vouchers": d.food_vouchers,
            "savings_fund": d.savings_fund, "aguinaldo": d.aguinaldo, "subsidy_applied": d.subsidy_applied,
            "imss_employee": d.imss_employee, "isr": d.isr, "infonavit": d.infonavit,
            "fonacot": d.fonacot, "loan_deduction": d.loan_deduction,
            "imss_employer": d.imss_employer, "infonavit_employer": d.infonavit_employer,
            "total_net": d.total_net,
        }
        pdf = build_receipt_pdf(
            _employee_to_dict(emp), period_dict, detail_dict,
            company_name=company_name, company_rfc=company_rfc,
        )
        safe = _full_name(emp).replace(" ", "_")
        files.append((f"recibo_{emp.employee_number}_{safe}.pdf", pdf))

    zip_bytes = build_receipts_zip(files)
    return zip_bytes, f"recibos_periodo_{period_id}.zip"


async def create_aguinaldo_period(db: AsyncSession, year: int, payment_date: str, user_id: Optional[int] = None) -> models.PayrollPeriod:
    """Crea un período tipo aguinaldo para el año dado. Al calcularlo, se usa la
    fórmula proporcional (mínimo 15 días de salario) considerando los días
    trabajados en el año."""
    period = models.PayrollPeriod(
        name=f"Aguinaldo {year}",
        frequency="mensual",  # informativo; el cálculo del aguinaldo no usa la tabla mensual
        start_date=f"{year}-01-01",
        end_date=f"{year}-12-31",
        payment_date=payment_date,
        kind="aguinaldo",
        status="draft",
    )
    db.add(period)
    await db.commit()
    await db.refresh(period)
    await _log_audit(db, user_id, "CREATE_AGUINALDO_PERIOD", f"Aguinaldo {year} creado", {"id": period.id, "year": year})
    return period


# ── Edición manual del detalle (bonos, vales, préstamos, notas) ────────────

async def update_payroll_detail(
    db: AsyncSession, period_id: int, employee_id: int,
    data: dict, user_id: Optional[int] = None,
) -> Optional[dict]:
    """Permite editar la partida de un empleado antes de aprobar la nómina.

    Campos editables (todos opcionales):
      bonus, food_vouchers, savings_fund, loan_deduction, notes

    Reglas:
      - Solo se puede editar en status = 'calculated' (aún no aprobada).
      - Al editar se recalculan los totales, ISR y SAE respetando los nuevos
        montos gravables (bonos y vales suman al bruto; el fondo de ahorro
        es exento hasta 13% SBC anual — aquí lo tratamos como no gravable
        y el ISN estatal sí lo grava por default).
      - El ISN patronal se recalcula sobre el nuevo total_gross.
    """
    res = await db.execute(
        select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id)
    )
    period = res.scalars().first()
    if period is None:
        raise ValueError("Período no encontrado")
    if period.status != "calculated":
        raise ValueError("Solo se pueden editar períodos en estado 'calculated' (antes de aprobar)")

    res2 = await db.execute(
        select(models.PayrollDetail).where(
            models.PayrollDetail.period_id == period_id,
            models.PayrollDetail.employee_id == employee_id,
        )
    )
    detail = res2.scalars().first()
    if detail is None:
        raise ValueError("No hay recibo para ese empleado en este período")

    # Aplicar los cambios permitidos
    for key in ("bonus", "food_vouchers", "savings_fund", "loan_deduction"):
        if key in data and data[key] is not None:
            v = float(data[key])
            if v < 0:
                raise ValueError(f"El monto de '{key}' no puede ser negativo")
            setattr(detail, key, round(v, 2))
    if "notes" in data:
        detail.notes = (data["notes"] or "").strip() or None

    # Recomputar totales manteniendo el resto de percepciones/deducciones
    percepciones_gravables = (
        (detail.salary_earned or 0.0)
        + (detail.overtime_double or 0.0)
        + (detail.overtime_triple or 0.0)
        + (detail.vacation_premium or 0.0)
        + (detail.bonus or 0.0)
        + (detail.food_vouchers or 0.0)
        + (detail.aguinaldo or 0.0)
    )
    # Fondo de ahorro exento (Art. 93 LISR fracc XI); no se grava para ISR.
    total_gross = round(percepciones_gravables + (detail.savings_fund or 0.0), 2)

    # ISR/SAE se recomputan sobre gravable — IMSS obrero se mantiene (SBC no cambia)
    gravable = max(percepciones_gravables - (detail.imss_employee or 0.0), 0.0)
    isr_ret, sae, _ = calc_isr_net(gravable, period.frequency)
    detail.isr = isr_ret
    detail.subsidy_applied = sae

    total_deductions = round(
        (detail.imss_employee or 0.0) + isr_ret
        + (detail.infonavit or 0.0) + (detail.fonacot or 0.0)
        + (detail.loan_deduction or 0.0),
        2,
    )
    total_net = round(total_gross - total_deductions + sae, 2)

    detail.total_gross = total_gross
    detail.total_deductions = total_deductions
    detail.total_net = total_net

    isn_rate = await _get_state_payroll_tax_rate(db)
    detail.state_payroll_tax = calc_state_payroll_tax(total_gross, isn_rate)

    detail.edited_manually = True
    await db.commit()

    emp = await db.get(models.Employee, employee_id)
    await _log_audit(
        db, user_id, "EDIT_PAYROLL_DETAIL",
        f"Recibo editado de {_full_name(emp) if emp else '#'+str(employee_id)} en período '{period.name}'",
        {"period_id": period_id, "employee_id": employee_id},
    )
    return await get_period_detail(db, period_id)


# ── Carga a granel de bonos/vales/ahorro/préstamos/notas ────────────────────

async def _bulk_current_rows(db: AsyncSession, period_id: int) -> tuple[List[dict], str]:
    """Regresa los renglones actuales del período para pre-llenar la plantilla."""
    res = await db.execute(
        select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id)
    )
    period = res.scalars().first()
    if period is None:
        raise ValueError("Período no encontrado")

    res2 = await db.execute(
        select(models.PayrollDetail, models.Employee)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(models.PayrollDetail.period_id == period_id)
        .order_by(models.Employee.employee_number.asc())
    )
    rows = []
    for d, emp in res2.all():
        rows.append({
            "no_empleado": emp.employee_number or f"#{emp.id}",
            "rfc": emp.rfc or "",
            "nombre": _full_name(emp),
            "bono": d.bonus or 0.0,
            "vales": d.food_vouchers or 0.0,
            "ahorro": d.savings_fund or 0.0,
            "prestamo": d.loan_deduction or 0.0,
            "notas": d.notes or "",
        })
    return rows, period.name


async def build_bulk_template(db: AsyncSession, period_id: int, fmt: str) -> tuple[bytes, str, str]:
    """Devuelve (contenido, filename, mime) para la plantilla del período."""
    from app.modules.hr.bulk_detail import build_template_xlsx, build_template_csv
    rows, period_name = await _bulk_current_rows(db, period_id)
    safe = period_name.replace(" ", "_")
    if fmt == "csv":
        return (
            build_template_csv(rows),
            f"detalle_{safe}.csv",
            "text/csv; charset=utf-8",
        )
    return (
        build_template_xlsx(period_name, rows),
        f"detalle_{safe}.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


async def import_bulk_detail(
    db: AsyncSession, period_id: int, content: bytes, filename: str,
    user_id: Optional[int] = None,
) -> dict:
    """Aplica cambios en lote al PayrollDetail del período. Usa el mismo
    update_payroll_detail() por fila para heredar el recomputo automático."""
    from app.modules.hr.bulk_detail import parse_bulk_file, BulkImportError, BulkImportSummary

    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res.scalars().first()
    if period is None:
        raise ValueError("Período no encontrado")
    if period.status != "calculated":
        raise ValueError("Solo se puede cargar en lote cuando la nómina está 'Calculada'")

    parsed, parse_errors = parse_bulk_file(content, filename)
    summary = BulkImportSummary(errors=list(parse_errors))

    # Indexes para match rápido
    emps = await get_employees(db)
    by_num: dict[str, int] = {}
    by_rfc: dict[str, int] = {}
    for e in emps:
        if e.employee_number:
            by_num[e.employee_number.strip().upper()] = e.id
        if e.rfc:
            by_rfc[e.rfc.strip().upper()] = e.id

    for row in parsed:
        no_emp = (row.get("no_empleado") or "").strip().upper()
        rfc = (row.get("rfc") or "").strip().upper()
        emp_id = by_num.get(no_emp) or by_rfc.get(rfc)
        if emp_id is None:
            summary.errors.append(BulkImportError(
                row=row["row"],
                reason=f"No se encontró empleado con no_empleado='{row.get('no_empleado','')}' ni rfc='{row.get('rfc','')}'",
            ))
            continue

        # Solo mandamos los campos que el operador realmente escribió
        # (los None se ignoran en update_payroll_detail).
        patch: dict = {}
        for k_bulk, k_field in (
            ("bono", "bonus"), ("vales", "food_vouchers"),
            ("ahorro", "savings_fund"), ("prestamo", "loan_deduction"),
        ):
            v = row.get(k_bulk)
            if v is not None:
                patch[k_field] = v
        if row.get("notas") is not None:
            patch["notes"] = row["notas"]

        if not patch:
            summary.skipped += 1
            continue

        try:
            await update_payroll_detail(db, period_id, emp_id, patch, user_id=user_id)
            summary.applied += 1
        except ValueError as e:
            summary.errors.append(BulkImportError(row=row["row"], reason=str(e)))

    await _log_audit(
        db, user_id, "BULK_PAYROLL_DETAIL",
        f"Carga a granel en '{period.name}': {summary.applied} aplicados, "
        f"{summary.skipped} omitidos, {len(summary.errors)} errores",
        {"period_id": period_id, "applied": summary.applied,
         "skipped": summary.skipped, "errors": len(summary.errors)},
    )

    return {
        "applied": summary.applied,
        "skipped": summary.skipped,
        "errors": [{"row": e.row, "reason": e.reason} for e in summary.errors],
    }
