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


# ── Cálculo fiscal mexicano (ISR / IMSS) ───────────────────────────────────
# Tabla ISR 2026 quincenal (misma tabla usada en el frontend, fuente única de verdad)
_ISR_TABLE = [
    {"li": 0, "ls": 1768.96, "fi": 0, "pct": 0.0192},
    {"li": 1768.97, "ls": 15009.06, "fi": 33.96, "pct": 0.0640},
    {"li": 15009.07, "ls": 26385.47, "fi": 881.68, "pct": 0.1088},
    {"li": 26385.48, "ls": 30674.03, "fi": 2118.73, "pct": 0.1600},
    {"li": 30674.04, "ls": 36732.23, "fi": 2804.44, "pct": 0.1792},
    {"li": 36732.24, "ls": 74049.45, "fi": 3890.39, "pct": 0.2136},
    {"li": 74049.46, "ls": 116829.20, "fi": 11870.05, "pct": 0.2352},
    {"li": 116829.21, "ls": 999999999, "fi": 21927.38, "pct": 0.3000},
]

UMA_2026 = 113.14

_FREQ_DAYS = {"semanal": 7, "catorcenal": 14, "quincenal": 15, "mensual": 30}


def calc_isr(gravable: float) -> float:
    row = next((r for r in _ISR_TABLE if r["li"] <= gravable <= r["ls"]), _ISR_TABLE[-1])
    return round((gravable - row["li"]) * row["pct"] + row["fi"], 2)


def calc_imss(sbc: float, frequency: str) -> float:
    dias = _FREQ_DAYS.get(frequency, 30)
    sbc_diario = sbc / 30
    enfermedad_maternidad = sbc_diario * dias * 0.0025
    invalidez_vida = sbc_diario * dias * 0.00625
    cesantia_vejez = sbc_diario * dias * 0.01125
    return round(enfermedad_maternidad + invalidez_vida + cesantia_vejez, 2)


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
            "base_salary": d.base_salary, "days_worked": d.days_worked, "salary_earned": d.salary_earned,
            "overtime_double": d.overtime_double, "overtime_triple": d.overtime_triple, "bonus": d.bonus,
            "vacation_premium": d.vacation_premium, "food_vouchers": d.food_vouchers, "savings_fund": d.savings_fund,
            "imss_employee": d.imss_employee, "isr": d.isr, "infonavit": d.infonavit, "fonacot": d.fonacot,
            "loan_deduction": d.loan_deduction, "total_gross": d.total_gross, "total_deductions": d.total_deductions,
            "total_net": d.total_net, "dispersion_status": d.dispersion_status, "bank": emp.bank, "clabe": emp.clabe,
        })
    summary["details"] = details
    return summary


async def calculate_period(db: AsyncSession, period_id: int, user_id: Optional[int] = None) -> Optional[dict]:
    res = await db.execute(select(models.PayrollPeriod).where(models.PayrollPeriod.id == period_id))
    period = res.scalars().first()
    if not period:
        return None
    if period.status != "draft":
        raise ValueError("Solo se pueden calcular períodos en borrador")

    # Limpia cálculo previo si existiera
    res_old = await db.execute(select(models.PayrollDetail).where(models.PayrollDetail.period_id == period_id))
    for old in res_old.scalars().all():
        await db.delete(old)

    start = date.fromisoformat(period.start_date)
    end = date.fromisoformat(period.end_date)
    period_days = (end - start).days + 1

    employees = await get_employees(db)
    eligible = [e for e in employees if e.is_active and e.pay_frequency == period.frequency]

    for e in eligible:
        salary_earned = round((e.base_salary / 30) * period_days, 2)
        imss = calc_imss(e.sbc, period.frequency)
        isr = calc_isr(salary_earned - imss)
        total_gross = salary_earned
        total_deductions = round(imss + isr, 2)
        total_net = round(total_gross - total_deductions, 2)
        detail = models.PayrollDetail(
            period_id=period.id, employee_id=e.id, department=e.department,
            base_salary=e.base_salary, days_worked=period_days, salary_earned=salary_earned,
            imss_employee=imss, isr=isr, total_gross=total_gross,
            total_deductions=total_deductions, total_net=total_net, dispersion_status="pendiente",
        )
        db.add(detail)

    period.status = "calculated"
    await db.commit()
    await _log_audit(db, user_id, "CALCULATE_PAYROLL", f"Nómina calculada para período '{period.name}' ({len(eligible)} empleados)", {"id": period_id})
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


async def generate_bank_layout_csv(db: AsyncSession, period_id: int, bank: Optional[str] = None) -> str:
    detail = await get_period_detail(db, period_id)
    if not detail:
        raise ValueError("Período no encontrado")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["No. empleado", "Nombre", "Banco", "CLABE", "Importe neto"])
    res = await db.execute(
        select(models.PayrollDetail, models.Employee)
        .join(models.Employee, models.PayrollDetail.employee_id == models.Employee.id)
        .where(models.PayrollDetail.period_id == period_id)
    )
    for d, emp in res.all():
        if bank and emp.bank != bank:
            continue
        writer.writerow([emp.employee_number, _full_name(emp), emp.bank or "", emp.clabe or "", f"{d.total_net:.2f}"])
    return buf.getvalue()


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
