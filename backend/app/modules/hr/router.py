from typing import List, Annotated, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
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


@router.post("/employees/fix-sbc")
async def fix_all_employees_sbc(db: DB, current_user: CurrentUser):
    """Auto-corrige el SBC diario de todos los empleados cuyo SBC parece
    haberse capturado como MENSUAL en lugar de diario (bug anterior del form).

    Detecta cuando `sbc > 3 × ((salary/30) × 1.0452)` y lo reemplaza por
    el diario correcto. Regresa la lista de cambios aplicados."""
    _require_manager(current_user)
    return await service.fix_all_employees_sbc(db, user_id=current_user.id)


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


@router.get("/employees/{employee_id}/attendance")
async def read_employee_attendance(
    employee_id: int, db: DB, current_user: CurrentUser,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
):
    """Historial de asistencia de un empleado. Se usa en el drawer para mostrar
    faltas, retardos, incapacidades y horas extra recientes de ese trabajador."""
    return await service.get_employee_attendance(db, employee_id, start_date, end_date)


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


@router.post("/payroll/periods/{period_id}/reopen")
async def reopen_period(period_id: int, db: DB, current_user: CurrentUser):
    """Regresa un período aprobado a 'calculated' para permitir recalcular con
    datos corregidos (por ejemplo si se detectó un crédito INFONAVIT viejo,
    un salario mal capturado, etc.). No aplicable a nóminas ya dispersadas."""
    _require_manager(current_user)
    try:
        detail = await service.reopen_period(db, period_id, user_id=current_user.id)
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


# ── Preview de reportes (JSON) para verlos en la UI antes de descargar ─────

@router.get("/reports/headcount/data")
async def report_headcount_data(db: DB, current_user: CurrentUser):
    return await service.get_headcount_data(db)


@router.get("/reports/vacations/data")
async def report_vacations_data(db: DB, current_user: CurrentUser):
    return await service.get_vacation_data(db)


@router.get("/reports/overtime/data")
async def report_overtime_data(db: DB, current_user: CurrentUser, start_date: str, end_date: str):
    return await service.get_overtime_data(db, start_date, end_date)


@router.get("/reports/annual-accumulated/data")
async def report_annual_accumulated_data(db: DB, current_user: CurrentUser, year: int):
    return await service.get_annual_accumulated(db, year)


@router.post("/reports/ptu/data")
async def report_ptu_data(data: schemas.PTURequest, db: DB, current_user: CurrentUser):
    return await service.get_ptu_data(db, data.year, data.total_utilidad)


@router.get("/reports/infonavit/data")
async def report_infonavit_data(db: DB, current_user: CurrentUser):
    return await service.get_infonavit_data(db)


@router.get("/reports/sua/{period_id}/data")
async def report_sua_data(period_id: int, db: DB, current_user: CurrentUser):
    try:
        return await service.get_sua_data(db, period_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Recibo PDF por empleado + descarga bulk (ZIP) ───────────────────────────

@router.get("/payroll/periods/{period_id}/receipts/{employee_id}.pdf")
async def receipt_pdf(period_id: int, employee_id: int, db: DB, current_user: CurrentUser):
    try:
        pdf, filename = await service.build_employee_receipt(db, period_id, employee_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        # Cualquier otro crash del generador se propaga con detalle al cliente
        # en lugar de un 500 silencioso. Facilita depuración en producción.
        raise HTTPException(status_code=500, detail=f"Error generando recibo PDF: {type(e).__name__}: {e}")
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generando ZIP de recibos: {type(e).__name__}: {e}")
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


@router.get("/payroll/periods/{period_id}/bulk-template")
async def download_bulk_template(
    period_id: int, db: DB, current_user: CurrentUser,
    format: str = "xlsx",
):
    """Descarga la plantilla de carga en lote (bonos/vales/ahorro/préstamos/notas)
    pre-llenada con los empleados actuales del período."""
    fmt = "csv" if format.lower() == "csv" else "xlsx"
    try:
        content, filename, mime = await service.build_bulk_template(db, period_id, fmt)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=content, media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/payroll/periods/{period_id}/bulk-import")
async def upload_bulk_detail(
    period_id: int, db: DB, current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """Carga a granel bonos/vales/ahorro/préstamos/notas desde XLSX o CSV.
    Reutiliza update_payroll_detail para heredar el recomputo de ISR/ISN/neto."""
    _require_manager(current_user)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Archivo vacío")
    try:
        return await service.import_bulk_detail(
            db, period_id, content, file.filename or "",
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/payroll/periods/{period_id}/details/{employee_id}")
async def edit_payroll_detail(
    period_id: int, employee_id: int,
    data: schemas.PayrollDetailUpdate,
    db: DB, current_user: CurrentUser,
):
    """Edita bonos, vales, fondo de ahorro, préstamos y notas de un empleado
    dentro de una nómina calculada. Recomputa totales automáticamente."""
    _require_manager(current_user)
    try:
        detail = await service.update_payroll_detail(
            db, period_id, employee_id, data.model_dump(exclude_unset=True),
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if detail is None:
        raise HTTPException(status_code=404, detail="Recibo no encontrado")
    return detail


# ── Comunicación interna (Fase 2) ─────────────────────────────────────────
@router.post("/announcements", response_model=schemas.AnnouncementOut, status_code=201)
async def create_announcement(data: schemas.AnnouncementCreate, db: DB, current_user: CurrentUser):
    """RH envía un anuncio a todos, a un departamento o a empleados específicos.
    Requiere rol manager/admin."""
    _require_manager(current_user)
    try:
        ann = await service.create_announcement(db, data, sender_user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Serializar con métricas (usar la función de listado y tomar el primero)
    from sqlalchemy.future import select as _sel
    from app.modules.hr.models import Announcement, AnnouncementReceipt
    from sqlalchemy.orm import selectinload as _sl
    r = await db.execute(_sel(Announcement).options(_sl(Announcement.receipts))
                          .where(Announcement.id == ann.id))
    fresh = r.scalar_one()
    total = len(fresh.receipts or [])
    read = sum(1 for x in (fresh.receipts or []) if x.read_at is not None)
    return schemas.AnnouncementOut(
        id=fresh.id, sender_user_id=fresh.sender_user_id,
        sender_name=(current_user.full_name or current_user.email),
        title=fresh.title, body=fresh.body, priority=fresh.priority,
        target_type=fresh.target_type, target_department=fresh.target_department,
        also_email=fresh.also_email, email_sent_count=fresh.email_sent_count,
        email_error=fresh.email_error, created_at=fresh.created_at,
        total_recipients=total, read_count=read,
    )


@router.get("/announcements/sent", response_model=List[schemas.AnnouncementOut])
async def list_sent_announcements(db: DB, current_user: CurrentUser, limit: int = 50):
    """Historial de anuncios enviados con métricas de lectura."""
    _require_manager(current_user)
    return await service.list_announcements_sent(db, limit=limit)


@router.get("/announcements/inbox", response_model=List[schemas.InboxItem])
async def my_inbox(db: DB, current_user: CurrentUser, limit: int = 30):
    """Anuncios dirigidos al empleado logueado. Cualquier usuario puede leerlo."""
    return await service.inbox_for_user(db, user_email=current_user.email, limit=limit)


@router.get("/announcements/unread-count")
async def my_unread_count(db: DB, current_user: CurrentUser):
    """Contador para el badge de la campana en el header."""
    return {"unread": await service.unread_count_for_user(db, user_email=current_user.email)}


@router.post("/announcements/receipts/{receipt_id}/read", status_code=204)
async def mark_read(receipt_id: int, db: DB, current_user: CurrentUser):
    ok = await service.mark_receipt_read(db, receipt_id, user_email=current_user.email)
    if not ok:
        raise HTTPException(status_code=404, detail="Receipt no encontrado o no autorizado")


# ── Contratos (Fase 3) ─────────────────────────────────────────────────────
@router.post("/contracts", response_model=schemas.ContractOut, status_code=201)
async def create_contract(data: schemas.ContractCreate, db: DB, current_user: CurrentUser):
    """Crea un contrato (draft) para un empleado. Requiere rol manager/admin."""
    _require_manager(current_user)
    try:
        c = await service.create_contract(db, data, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    out = await service.get_contract(db, c.id)
    return out


@router.get("/contracts", response_model=List[schemas.ContractOut])
async def list_contracts(db: DB, current_user: CurrentUser,
                          employee_id: Optional[int] = None,
                          status: Optional[str] = None):
    """Lista contratos con filtros opcionales por empleado o estado."""
    return await service.list_contracts(db, employee_id=employee_id, status=status)


@router.get("/contracts/{contract_id}", response_model=schemas.ContractOut)
async def get_contract(contract_id: int, db: DB, current_user: CurrentUser):
    c = await service.get_contract(db, contract_id)
    if not c:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    return c


@router.patch("/contracts/{contract_id}", response_model=schemas.ContractOut)
async def update_contract(contract_id: int, data: schemas.ContractUpdate,
                            db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    try:
        c = await service.update_contract(db, contract_id, data, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not c:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    return c


@router.delete("/contracts/{contract_id}", status_code=204)
async def delete_contract(contract_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    ok = await service.delete_contract(db, contract_id, user_id=current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")


@router.get("/contracts/{contract_id}/pdf")
async def download_contract_pdf(contract_id: int, db: DB, current_user: CurrentUser):
    """Descarga el PDF del contrato listo para imprimir y firmar."""
    try:
        content, filename = await service.generate_contract_pdf_bytes(
            db, contract_id, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=content, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Liquidación / Finiquito (Fase 4) ─────────────────────────────────────
@router.post("/settlements/calculate", response_model=schemas.SettlementResponse)
async def calculate_settlement(data: schemas.SettlementRequest,
                                 db: DB, current_user: CurrentUser):
    """Calcula el finiquito o liquidación de un empleado conforme a la LFT.

    Devuelve el desglose por concepto (partes proporcionales, indemnización si
    aplica, prima de antigüedad) y la lista de artículos LFT invocados."""
    _require_manager(current_user)
    try:
        result = await service.calculate_settlement(db, data)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result


# ── Kardex del empleado ────────────────────────────────────────────────

@router.get("/employees/{employee_id}/kardex")
async def employee_kardex(
    employee_id: int, db: DB, _: CurrentUser,
    year: Optional[int] = None,
):
    """Devuelve el kardex estructurado JSON del empleado (para UI)."""
    from app.modules.hr.kardex import build_kardex
    r = await build_kardex(db, employee_id, year=year)
    if not r:
        raise HTTPException(404, "Empleado no encontrado")
    return r


@router.get("/employees/{employee_id}/kardex.pdf")
async def employee_kardex_pdf(
    employee_id: int, db: DB, _: CurrentUser,
    year: Optional[int] = None,
):
    """PDF oficial del kardex (para firma y expediente físico)."""
    from app.modules.hr.kardex import build_kardex, build_kardex_pdf
    from app.modules.sales.universal_service import _get_company_dict
    kardex = await build_kardex(db, employee_id, year=year)
    if not kardex:
        raise HTTPException(404, "Empleado no encontrado")
    company = await _get_company_dict(db)
    pdf = build_kardex_pdf(company, kardex)
    y = kardex["year"]
    fname = f"kardex_{kardex['employee']['employee_number']}_{y}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Presupuesto anual de nómina (B2) ───────────────────────────────────

@router.get("/payroll-budgets")
async def list_payroll_budgets(
    db: DB, current_user: CurrentUser, year: int,
):
    """Devuelve los presupuestos anuales de nómina del año indicado."""
    from app.modules.hr import payroll_budgets as pb
    return await pb.list_budgets(db, year)


@router.put("/payroll-budgets")
async def upsert_payroll_budget(
    payload: dict, db: DB, current_user: CurrentUser,
):
    """Crea o actualiza el presupuesto de un empleado/año.

    Body: { employee_id, period_year, m1..m12, notes? }.
    """
    _require_manager(current_user)
    from app.modules.hr import payroll_budgets as pb
    year = int(payload.get("period_year") or 0)
    emp_id = int(payload.get("employee_id") or 0)
    if not year or not emp_id:
        raise HTTPException(400, "period_year y employee_id son obligatorios")
    months = {c: payload.get(c) for c in pb.MONTH_COLS if c in payload}
    try:
        return await pb.upsert_budget(
            db, year=year, employee_id=emp_id, months=months,
            notes=payload.get("notes"), user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/payroll-budgets/{budget_id}")
async def delete_payroll_budget(
    budget_id: int, db: DB, current_user: CurrentUser,
):
    _require_manager(current_user)
    from app.modules.hr import payroll_budgets as pb
    ok = await pb.delete_budget(db, budget_id)
    if not ok:
        raise HTTPException(404, "Presupuesto no encontrado")
    return {"ok": True}


@router.post("/payroll-budgets/copy-from-year")
async def copy_payroll_budgets(
    payload: dict, db: DB, current_user: CurrentUser,
):
    """Copia presupuestos de un año a otro con factor opcional (aumentos).

    Body: { source_year, target_year, factor? } (factor default 1.0).
    """
    _require_manager(current_user)
    from app.modules.hr import payroll_budgets as pb
    src = int(payload.get("source_year") or 0)
    tgt = int(payload.get("target_year") or 0)
    factor = float(payload.get("factor") or 1.0)
    if not src or not tgt:
        raise HTTPException(400, "source_year y target_year son obligatorios")
    created = await pb.copy_from_year(
        db, src, tgt, factor=factor, user_id=current_user.id,
    )
    return {"created": created, "source_year": src, "target_year": tgt, "factor": factor}


@router.post("/payroll-budgets/seed")
async def seed_payroll_budgets(
    payload: dict, db: DB, current_user: CurrentUser,
):
    """Inicializa presupuesto en 0 para todos los empleados activos que aún
    no lo tengan capturado en el año. Body: { year }."""
    _require_manager(current_user)
    from app.modules.hr import payroll_budgets as pb
    year = int(payload.get("year") or 0)
    if not year:
        raise HTTPException(400, "year es obligatorio")
    created = await pb.seed_from_active_employees(db, year, user_id=current_user.id)
    return {"created": created, "year": year}


@router.get("/payroll-budgets/{year}/variance")
async def payroll_budget_variance(
    year: int, db: DB, current_user: CurrentUser,
):
    """Comparativo mes a mes presupuesto vs. costo real de nómina."""
    from app.modules.hr import payroll_budgets as pb
    return await pb.compute_variance(db, year)


@router.get("/payroll-budgets/{year}/variance.xlsx")
async def payroll_budget_variance_xlsx(
    year: int, db: DB, current_user: CurrentUser,
):
    """Descarga XLSX profesional del comparativo presupuesto vs real."""
    from app.modules.hr import payroll_budgets as pb
    variance = await pb.compute_variance(db, year)
    xlsx = pb.build_variance_xlsx(variance)
    fname = f"presupuesto_nomina_{year}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── PTU (Participación de Utilidades) v2 — LFT arts. 122-131 + reforma 2021

@router.post("/ptu/preview")
async def ptu_preview(payload: dict, db: DB, current_user: CurrentUser):
    """Preview del reparto sin persistir.

    Body: { year, utilidad_repartible, sindicato_max_daily? }.
    """
    _require_manager(current_user)
    from app.modules.hr import ptu as ptu_mod
    year = int(payload.get("year") or 0)
    util = float(payload.get("utilidad_repartible") or 0)
    smax = payload.get("sindicato_max_daily")
    smax = float(smax) if smax not in (None, "", 0) else None
    if not year or util <= 0:
        raise HTTPException(400, "year y utilidad_repartible (>0) son obligatorios")
    return await ptu_mod.calculate_ptu(db, year, util, smax)


@router.post("/ptu")
async def ptu_save(payload: dict, db: DB, current_user: CurrentUser):
    """Corre y persiste el cálculo como draft.

    Body: { year, utilidad_repartible, sindicato_max_daily?, payment_deadline?, notes? }
    """
    _require_manager(current_user)
    from app.modules.hr import ptu as ptu_mod
    year = int(payload.get("year") or 0)
    util = float(payload.get("utilidad_repartible") or 0)
    smax = payload.get("sindicato_max_daily")
    smax = float(smax) if smax not in (None, "", 0) else None
    if not year or util <= 0:
        raise HTTPException(400, "year y utilidad_repartible (>0) son obligatorios")
    try:
        return await ptu_mod.save_calculation(
            db, year=year, utilidad_repartible=util,
            sindicato_max_daily=smax,
            payment_deadline=payload.get("payment_deadline"),
            notes=payload.get("notes"),
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/ptu")
async def ptu_list(db: DB, current_user: CurrentUser):
    """Lista de cálculos PTU (todos los años, más recientes primero)."""
    from app.modules.hr import ptu as ptu_mod
    return await ptu_mod.list_calculations(db)


@router.get("/ptu/{calc_id}")
async def ptu_get(calc_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import ptu as ptu_mod
    r = await ptu_mod.get_calculation(db, calc_id)
    if not r:
        raise HTTPException(404, "Cálculo PTU no encontrado")
    return r


@router.delete("/ptu/{calc_id}")
async def ptu_delete(calc_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    from app.modules.hr import ptu as ptu_mod
    try:
        ok = await ptu_mod.delete_calculation(db, calc_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, "Cálculo no encontrado")
    return {"ok": True}


@router.post("/ptu/{calc_id}/approve")
async def ptu_approve(calc_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    from app.modules.hr import ptu as ptu_mod
    try:
        return await ptu_mod.approve_calculation(db, calc_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/ptu/{calc_id}/generate-payroll")
async def ptu_generate_payroll(
    calc_id: int, payload: dict, db: DB, current_user: CurrentUser,
):
    """Genera un PayrollPeriod tipo 'ptu' con un detalle por empleado.

    Body: { payment_date: 'YYYY-MM-DD' }.
    """
    _require_manager(current_user)
    from app.modules.hr import ptu as ptu_mod
    pay = payload.get("payment_date")
    if not pay:
        raise HTTPException(400, "payment_date es obligatorio")
    try:
        return await ptu_mod.generate_payroll_period(db, calc_id, pay)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/ptu/{calc_id}/xlsx")
async def ptu_xlsx(calc_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import ptu as ptu_mod
    calc = await ptu_mod.get_calculation(db, calc_id)
    if not calc:
        raise HTTPException(404, "Cálculo no encontrado")
    # Enriquecer con `totals` si viene del persistido (get_calculation no lo trae)
    if "totals" not in calc:
        rows = calc.get("rows", [])
        included = [r for r in rows if not r["excluded"]]
        calc["totals"] = {
            "total_employees": len(rows), "total_included": len(included),
            "total_excluded": len(rows) - len(included),
            "total_days": sum(r["days_worked_ptu"] for r in included),
            "total_salary_base": sum(r["salary_earned_ptu"] for r in included),
            "total_ptu_gross": sum(r["ptu_gross"] for r in rows),
            "total_ptu_paid": sum(r["ptu_final"] for r in rows),
            "total_cap_savings": sum(
                r["ptu_gross"] - r["ptu_final"] for r in rows if not r["excluded"]
            ),
        }
    xlsx = ptu_mod.build_ptu_xlsx(calc)
    fname = f"ptu_{calc['period_year']}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Ajuste Anual de ISR (B4) — LISR arts. 97 y 116 ──────────────────

@router.post("/annual-isr/preview")
async def annual_isr_preview(payload: dict, db: DB, current_user: CurrentUser):
    """Preview del ajuste anual (sin persistir). Body: { year }."""
    _require_manager(current_user)
    from app.modules.hr import annual_isr as ai
    year = int(payload.get("year") or 0)
    if not year:
        raise HTTPException(400, "year es obligatorio")
    return await ai.calculate_adjustment(db, year)


@router.post("/annual-isr")
async def annual_isr_save(payload: dict, db: DB, current_user: CurrentUser):
    """Corre y persiste como draft. Body: { year }."""
    _require_manager(current_user)
    from app.modules.hr import annual_isr as ai
    year = int(payload.get("year") or 0)
    if not year:
        raise HTTPException(400, "year es obligatorio")
    try:
        return await ai.save_adjustment(db, year, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/annual-isr")
async def annual_isr_list(db: DB, current_user: CurrentUser):
    from app.modules.hr import annual_isr as ai
    return await ai.list_adjustments(db)


@router.get("/annual-isr/{adj_id}")
async def annual_isr_get(adj_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import annual_isr as ai
    r = await ai.get_adjustment(db, adj_id)
    if not r:
        raise HTTPException(404, "Ajuste no encontrado")
    return r


@router.delete("/annual-isr/{adj_id}")
async def annual_isr_delete(adj_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    from app.modules.hr import annual_isr as ai
    try:
        ok = await ai.delete_adjustment(db, adj_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not ok:
        raise HTTPException(404, "Ajuste no encontrado")
    return {"ok": True}


@router.post("/annual-isr/{adj_id}/approve")
async def annual_isr_approve(adj_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    from app.modules.hr import annual_isr as ai
    try:
        return await ai.approve_adjustment(db, adj_id, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/annual-isr/{adj_id}/xlsx")
async def annual_isr_xlsx(adj_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import annual_isr as ai
    data = await ai.get_adjustment(db, adj_id)
    if not data:
        raise HTTPException(404, "Ajuste no encontrado")
    xlsx = ai.build_adjustment_xlsx(data)
    fname = f"ajuste_isr_{data['period_year']}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── B6 · Avisos IMSS papel (AFIL-02/04/08) ──────────────────────────

@router.get("/imss-movements")
async def imss_movements_list(
    db: DB, current_user: CurrentUser,
    employee_id: Optional[int] = None,
    movement_type: Optional[str] = None,
    year: Optional[int] = None,
):
    from app.modules.hr import imss_avisos as ia
    return await ia.list_movements(db, employee_id=employee_id,
                                    movement_type=movement_type, year=year)


@router.get("/imss-movements/pending")
async def imss_movements_pending(db: DB, current_user: CurrentUser):
    """Movimientos que faltan por registrar (alta/baja/modif detectados)."""
    from app.modules.hr import imss_avisos as ia
    return await ia.pending_movements(db)


@router.get("/imss-movements/{mov_id}")
async def imss_movement_get(mov_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import imss_avisos as ia
    r = await ia.get_movement(db, mov_id)
    if not r:
        raise HTTPException(404, "Movimiento no encontrado")
    return r


@router.post("/imss-movements")
async def imss_movement_create(
    payload: dict, db: DB, current_user: CurrentUser,
):
    _require_manager(current_user)
    from app.modules.hr import imss_avisos as ia
    try:
        return await ia.create_movement(
            db,
            employee_id=int(payload.get("employee_id") or 0),
            movement_type=payload.get("movement_type") or "",
            movement_date=payload.get("movement_date") or "",
            sbc_at_movement=payload.get("sbc_at_movement"),
            baja_reason_code=payload.get("baja_reason_code"),
            baja_reason_text=payload.get("baja_reason_text"),
            old_sbc=payload.get("old_sbc"),
            new_sbc=payload.get("new_sbc"),
            notes=payload.get("notes"),
            presented_date=payload.get("presented_date"),
            folio=payload.get("folio"),
            user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/imss-movements/{mov_id}")
async def imss_movement_update(
    mov_id: int, payload: dict, db: DB, current_user: CurrentUser,
):
    """Solo actualiza campos post-presentación: fecha, folio, notas."""
    _require_manager(current_user)
    from app.modules.hr import imss_avisos as ia
    try:
        return await ia.update_movement(
            db, mov_id,
            presented_date=payload.get("presented_date"),
            folio=payload.get("folio"),
            notes=payload.get("notes"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/imss-movements/{mov_id}")
async def imss_movement_delete(mov_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    from app.modules.hr import imss_avisos as ia
    ok = await ia.delete_movement(db, mov_id)
    if not ok:
        raise HTTPException(404, "Movimiento no encontrado")
    return {"ok": True}


@router.get("/imss-movements/{mov_id}/pdf")
async def imss_movement_pdf(mov_id: int, db: DB, current_user: CurrentUser):
    """PDF del aviso (AFIL-02/04/08 según el tipo)."""
    from app.modules.hr import imss_avisos as ia
    from app.modules.sales.universal_service import _get_company_dict
    mov = await ia.get_movement(db, mov_id)
    if not mov:
        raise HTTPException(404, "Movimiento no encontrado")
    company = await _get_company_dict(db)
    pdf = ia.build_aviso_pdf(company, mov)
    fmt_code = {"alta": "AFIL02", "baja": "AFIL04", "modif_salario": "AFIL08"}[mov["movement_type"]]
    fname = f"{fmt_code}_{mov['employee_number']}_{mov['movement_date']}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── B5 · Cédulas IMSS mensual + bimestral (SAR/INFONAVIT) ──────────

@router.get("/cedulas/imss/{year}/{month}")
async def cedula_imss_mensual(
    year: int, month: int, db: DB, current_user: CurrentUser,
    prima_rt: Optional[float] = None,
):
    """Cédula IMSS mensual (E y M especie/dinero + IV + GPS + RT)."""
    from app.modules.hr import imss_cedulas as ced
    if month < 1 or month > 12:
        raise HTTPException(400, "month debe ser 1-12")
    return await ced.cedula_mensual(db, year, month, prima_rt=prima_rt)


@router.get("/cedulas/imss/{year}/{month}.pdf")
async def cedula_imss_mensual_pdf(
    year: int, month: int, db: DB, current_user: CurrentUser,
    prima_rt: Optional[float] = None,
):
    from app.modules.hr import imss_cedulas as ced
    from app.modules.sales.universal_service import _get_company_dict
    if month < 1 or month > 12:
        raise HTTPException(400, "month debe ser 1-12")
    cedula = await ced.cedula_mensual(db, year, month, prima_rt=prima_rt)
    company = await _get_company_dict(db)
    pdf = ced.build_pdf(company, cedula, "mensual")
    fname = f"cedula_imss_{year}_{month:02d}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/cedulas/imss/{year}/{month}.xlsx")
async def cedula_imss_mensual_xlsx(
    year: int, month: int, db: DB, current_user: CurrentUser,
    prima_rt: Optional[float] = None,
):
    from app.modules.hr import imss_cedulas as ced
    if month < 1 or month > 12:
        raise HTTPException(400, "month debe ser 1-12")
    cedula = await ced.cedula_mensual(db, year, month, prima_rt=prima_rt)
    xlsx = ced.build_xlsx(cedula, "mensual")
    fname = f"cedula_imss_{year}_{month:02d}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/cedulas/bimestral/{year}/{bimester}")
async def cedula_bimestral_get(
    year: int, bimester: int, db: DB, current_user: CurrentUser,
):
    """Cédula bimestral SAR/INFONAVIT (Retiro + CV + INFONAVIT 5% + amortizaciones)."""
    from app.modules.hr import imss_cedulas as ced
    if bimester < 1 or bimester > 6:
        raise HTTPException(400, "bimester debe ser 1-6")
    return await ced.cedula_bimestral(db, year, bimester)


@router.get("/cedulas/bimestral/{year}/{bimester}.pdf")
async def cedula_bimestral_pdf(
    year: int, bimester: int, db: DB, current_user: CurrentUser,
):
    from app.modules.hr import imss_cedulas as ced
    from app.modules.sales.universal_service import _get_company_dict
    if bimester < 1 or bimester > 6:
        raise HTTPException(400, "bimester debe ser 1-6")
    cedula = await ced.cedula_bimestral(db, year, bimester)
    company = await _get_company_dict(db)
    pdf = ced.build_pdf(company, cedula, "bimestral")
    fname = f"cedula_bimestral_{year}_B{bimester}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/cedulas/bimestral/{year}/{bimester}.xlsx")
async def cedula_bimestral_xlsx(
    year: int, bimester: int, db: DB, current_user: CurrentUser,
):
    from app.modules.hr import imss_cedulas as ced
    if bimester < 1 or bimester > 6:
        raise HTTPException(400, "bimester debe ser 1-6")
    cedula = await ced.cedula_bimestral(db, year, bimester)
    xlsx = ced.build_xlsx(cedula, "bimestral")
    fname = f"cedula_bimestral_{year}_B{bimester}.xlsx"
    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/annual-isr/{year}/constancia/{employee_id}.pdf")
async def annual_isr_constancia(
    year: int, employee_id: int, db: DB, current_user: CurrentUser,
):
    """Constancia individual de retenciones (art. 99 LISR)."""
    from app.modules.hr import annual_isr as ai
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    pdf = await ai.build_constancia_pdf(db, company, year, employee_id)
    if not pdf:
        raise HTTPException(404, "Empleado sin nómina en el año")
    fname = f"constancia_isr_{year}_{employee_id}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/ptu/{calc_id}/pdf")
async def ptu_pdf(calc_id: int, db: DB, current_user: CurrentUser):
    from app.modules.hr import ptu as ptu_mod
    from app.modules.sales.universal_service import _get_company_dict
    calc = await ptu_mod.get_calculation(db, calc_id)
    if not calc:
        raise HTTPException(404, "Cálculo no encontrado")
    if "totals" not in calc:
        rows = calc.get("rows", [])
        included = [r for r in rows if not r["excluded"]]
        calc["totals"] = {
            "total_employees": len(rows), "total_included": len(included),
            "total_excluded": len(rows) - len(included),
            "total_days": sum(r["days_worked_ptu"] for r in included),
            "total_salary_base": sum(r["salary_earned_ptu"] for r in included),
            "total_ptu_gross": sum(r["ptu_gross"] for r in rows),
            "total_ptu_paid": sum(r["ptu_final"] for r in rows),
            "total_cap_savings": sum(
                r["ptu_gross"] - r["ptu_final"] for r in rows if not r["excluded"]
            ),
        }
    company = await _get_company_dict(db)
    pdf = ptu_mod.build_ptu_pdf(company, calc)
    fname = f"ptu_{calc['period_year']}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
