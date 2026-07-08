from typing import List, Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.hr import schemas, service
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


def _require_manager(current_user: User):
    if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Se requiere rol admin o manager para esta acción")


# ── Dashboard ──────────────────────────────────────────────────────────
@router.get("/dashboard")
async def read_dashboard(db: DB, current_user: CurrentUser):
    return await service.get_dashboard(db)


@router.get("/alerts")
async def read_alerts(db: DB, current_user: CurrentUser):
    return await service.get_alerts(db)


# ── Employees ──────────────────────────────────────────────────────────
@router.get("/employees", response_model=List[schemas.EmployeeInDB])
async def read_employees(db: DB, current_user: CurrentUser):
    return await service.get_employees(db)


@router.post("/employees", response_model=schemas.EmployeeInDB)
async def create_employee(emp_in: schemas.EmployeeCreate, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    return await service.create_employee(db, emp_in, user_id=current_user.id)


@router.patch("/employees/{employee_id}", response_model=schemas.EmployeeInDB)
async def update_employee(employee_id: int, data: schemas.EmployeeUpdate, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    emp = await service.update_employee(db, employee_id, data, user_id=current_user.id)
    if not emp:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    return emp


@router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    ok = await service.delete_employee(db, employee_id, user_id=current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Empleado no encontrado")
    return {"ok": True}


# ── Attendance ─────────────────────────────────────────────────────────
@router.get("/attendance")
async def read_attendance(db: DB, current_user: CurrentUser, date: Optional[str] = None):
    return await service.get_attendance(db, date_filter=date)


@router.post("/attendance")
async def create_attendance(data: schemas.AttendanceCreate, db: DB, current_user: CurrentUser):
    att = await service.create_attendance(db, data, user_id=current_user.id)
    return {"id": att.id}


# ── Payroll periods ────────────────────────────────────────────────────
@router.get("/payroll/periods")
async def read_periods(db: DB, current_user: CurrentUser):
    return await service.get_periods(db)


@router.post("/payroll/periods")
async def create_period(data: schemas.PayrollPeriodCreate, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    period = await service.create_period(db, data, user_id=current_user.id)
    return {"id": period.id}


@router.get("/payroll/periods/{period_id}")
async def read_period_detail(period_id: int, db: DB, current_user: CurrentUser):
    detail = await service.get_period_detail(db, period_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Período no encontrado")
    return detail


@router.post("/payroll/periods/{period_id}/calculate")
async def calculate_period(period_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    try:
        detail = await service.calculate_period(db, period_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not detail:
        raise HTTPException(status_code=404, detail="Período no encontrado")
    return detail


@router.post("/payroll/periods/{period_id}/approve")
async def approve_period(period_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    try:
        detail = await service.approve_period(db, period_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not detail:
        raise HTTPException(status_code=404, detail="Período no encontrado")
    return detail


@router.post("/payroll/periods/{period_id}/disperse")
async def disperse_period(period_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    try:
        detail = await service.disperse_period(db, period_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not detail:
        raise HTTPException(status_code=404, detail="Período no encontrado")
    return detail


@router.get("/payroll/periods/{period_id}/bank-layout")
async def bank_layout(
    period_id: int, db: DB, current_user: CurrentUser,
    bank: Optional[str] = None,
    origin_account: Optional[str] = None,
    lote_number: str = "1",
    skip_invalid: bool = True,
):
    """Genera el archivo de dispersión listo para subir a la banca en línea.

    Parámetros:
      - bank: BBVA | Banorte | Santander | HSBC | Banamex | SPEI | CSV
      - origin_account: CLABE de cargo del cliente (18 dígitos). Si viene
        vacía, se rellena con ceros que el operador debe editar en el archivo.
      - skip_invalid: si es True (default), excluye del layout las filas con
        CLABE inválida, RFC faltante o importe cero.
    """
    try:
        content, filename, mime = await service.generate_bank_layout(
            db, period_id, bank or "CSV",
            origin_account=origin_account or "",
            lote_number=lote_number,
            skip_invalid=skip_invalid,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll/periods/{period_id}/dispersion-summary")
async def dispersion_summary(period_id: int, db: DB, current_user: CurrentUser):
    """Resumen previo a la dispersión: totales por banco, validación de datos,
    lista de empleados con problemas (CLABE inválida, RFC faltante, etc.)."""
    try:
        return await service.dispersion_summary(db, period_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Reports ────────────────────────────────────────────────────────────
@router.get("/reports/headcount")
async def report_headcount(db: DB, current_user: CurrentUser):
    csv_text = await service.generate_headcount_csv(db)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="plantilla_stps.csv"'})


@router.get("/reports/vacations")
async def report_vacations(db: DB, current_user: CurrentUser):
    csv_text = await service.generate_vacation_csv(db)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="control_vacaciones.csv"'})


@router.get("/reports/overtime")
async def report_overtime(db: DB, current_user: CurrentUser, start_date: str, end_date: str):
    csv_text = await service.generate_overtime_csv(db, start_date, end_date)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="horas_extra_{start_date}_a_{end_date}.csv"'})


@router.get("/reports/annual-accumulated")
async def report_annual_accumulated(db: DB, current_user: CurrentUser, year: int):
    csv_text = await service.generate_annual_accumulated_csv(db, year)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="acumulado_anual_{year}.csv"'})


@router.post("/reports/ptu")
async def report_ptu(data: schemas.PTURequest, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    csv_text = await service.generate_ptu_csv(db, data.year, data.total_utilidad)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="ptu_{data.year}.csv"'})


@router.get("/reports/infonavit")
async def report_infonavit(db: DB, current_user: CurrentUser):
    csv_text = await service.generate_infonavit_csv(db)
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="infonavit_fonacot.csv"'})


@router.get("/reports/sua/{period_id}")
async def report_sua(period_id: int, db: DB, current_user: CurrentUser):
    try:
        csv_text = await service.generate_sua_csv(db, period_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(content=csv_text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="sua_apoyo_{period_id}.csv"'})


# ── Recibo PDF por empleado + descarga bulk (ZIP) ───────────────────────────

@router.get("/payroll/periods/{period_id}/receipts/{employee_id}.pdf")
async def receipt_pdf(period_id: int, employee_id: int, db: DB, current_user: CurrentUser):
    try:
        pdf, filename = await service.build_employee_receipt(db, period_id, employee_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll/periods/{period_id}/receipts.zip")
async def receipts_zip(period_id: int, db: DB, current_user: CurrentUser):
    try:
        content, filename = await service.build_period_receipts_zip(db, period_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=content, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Aguinaldo helper (crea período tipo aguinaldo) ──────────────────────────

@router.post("/payroll/aguinaldo")
async def create_aguinaldo(data: schemas.AguinaldoRequest, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    period = await service.create_aguinaldo_period(db, data.year, data.payment_date, user_id=current_user.id)
    return {"id": period.id}
