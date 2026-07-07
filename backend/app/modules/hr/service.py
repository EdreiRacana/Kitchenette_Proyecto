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
        infonavit = calc_infonavit(e, salary_earned)
        fonacot = calc_fonacot(e)
        isr = calc_isr(salary_earned - imss)
        total_gross = salary_earned
        total_deductions = round(imss + isr + infonavit + fonacot, 2)
        total_net = round(total_gross - total_deductions, 2)
        detail = models.PayrollDetail(
            period_id=period.id, employee_id=e.id, department=e.department,
            base_salary=e.base_salary, days_worked=period_days, salary_earned=salary_earned,
            imss_employee=imss, isr=isr, infonavit=infonavit, fonacot=fonacot, total_gross=total_gross,
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
