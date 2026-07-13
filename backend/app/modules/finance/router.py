import os
import shutil
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from typing import List, Annotated, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.api import deps
from app.modules.finance import schemas, service
from app.modules.auth.models import User

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]

UPLOAD_DIR = "uploads/finance"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _require_manager(current_user: User):
    from app.modules.auth.rbac import user_can
    # Acepta superusuario, el rol legacy admin/manager, o (RBAC moderno) un rol
    # con permiso de aprobar/editar en Finanzas (ej. Contador).
    if current_user.is_superuser:
        return
    if (current_user.role or "user") in ("admin", "manager"):
        return
    if user_can(current_user, "finance", "approve") or user_can(current_user, "finance", "edit"):
        return
    raise HTTPException(status_code=403, detail="Se requiere rol con permisos de Finanzas para esta acción")


def _finance_branch(current_user: User) -> Optional[int]:
    """Sucursal a la que se restringe Finanzas. None = ve todo (superusuario o
    usuario sin sucursal). Aplica a transacciones, bancos y presupuestos."""
    if getattr(current_user, "is_superuser", False):
        return None
    return getattr(current_user, "branch_id", None)


async def _finance_warehouse_ids(db, current_user: User):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    return await visible_warehouse_ids(db, current_user)


@router.get("/dashboard", response_model=schemas.FinanceDashboard)
async def read_dashboard(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    wh = await _finance_warehouse_ids(db, current_user)
    return await service.get_dashboard(db, branch_id=_finance_branch(current_user), branch_warehouse_ids=wh)


@router.post("/transactions", response_model=schemas.TransactionInDB)
async def create_transaction(
    tx_in: schemas.TransactionCreate,
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
):
    return await service.create_transaction(db, tx_in, user_id=current_user.id, branch_id=_finance_branch(current_user))


@router.get("/transactions", response_model=List[schemas.TransactionInDB])
async def read_transactions(
    db: Annotated[AsyncSession, Depends(deps.get_db)],
    current_user: Annotated[User, Depends(deps.get_current_active_user)],
    skip: int = 0,
    limit: int = 100,
    type: Optional[str] = None,
):
    return await service.get_transactions(db, skip=skip, limit=limit, type=type, branch_id=_finance_branch(current_user))


@router.put("/transactions/{tx_id}", response_model=schemas.TransactionInDB)
async def update_transaction(tx_id: int, tx_in: schemas.TransactionUpdate, db: DB, current_user: CurrentUser):
    tx = await service.update_transaction(db, tx_id, tx_in, user_id=current_user.id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx


@router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: int, db: DB, current_user: CurrentUser):
    _require_manager(current_user)
    ok = await service.delete_transaction(db, tx_id, user_id=current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return {"ok": True}


@router.post("/transactions/{tx_id}/attachment", response_model=schemas.TransactionInDB)
async def upload_transaction_attachment(tx_id: int, db: DB, current_user: CurrentUser, file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1]
    safe = f"{tx_id}_{int(datetime.now().timestamp())}{ext}"
    path = os.path.join(UPLOAD_DIR, safe)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    tx = await service.set_transaction_attachment(db, tx_id, f"finance/{safe}", user_id=current_user.id)
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx


# --- CXC ---
@router.get("/cxc", response_model=List[schemas.AgingItem])
async def read_cxc(db: DB, current_user: CurrentUser):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_cxc(db, branch_warehouse_ids=ids)


# ── Conciliación bancaria ──────────────────────────────────────────────
from fastapi import UploadFile, File, Form  # noqa: E402


@router.post("/reconciliation/import")
async def import_bank_statement(
    db: DB, current_user: CurrentUser,
    bank_account_id: int = Form(...),
    file: UploadFile = File(...),
):
    """Importa un extracto bancario (CSV o XLSX) y hace matching automático
    contra las transacciones del sistema. Marca reconciliadas las que hagan
    match por fecha (±3 días) + monto exacto + mismo signo."""
    from app.modules.finance import reconciliation
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "El archivo excede 10MB")
    try:
        return await reconciliation.import_statement(
            db, bank_account_id, contents, file.filename or "",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Error al procesar el extracto: {e}")


@router.get("/reconciliation/{bank_account_id}/unreconciled")
async def unreconciled_transactions(bank_account_id: int, db: DB, _: CurrentUser):
    """Lista transacciones bancarias no conciliadas de una cuenta."""
    from sqlalchemy.future import select
    from app.modules.finance import models as fin_models
    res = await db.execute(
        select(fin_models.BankTransaction).where(
            fin_models.BankTransaction.bank_account_id == bank_account_id,
            fin_models.BankTransaction.reconciled == False,  # noqa: E712
        ).order_by(fin_models.BankTransaction.bank_date.desc().nullslast())
    )
    return [{
        "id": bt.id, "type": bt.type, "amount": bt.amount,
        "description": bt.description, "reference": bt.reference,
        "bank_date": bt.bank_date.isoformat() if bt.bank_date else None,
        "external_ref": bt.external_ref,
    } for bt in res.scalars().all()]


@router.get("/cxc/aging-report.pdf")
async def cxc_aging_pdf(db: DB, current_user: CurrentUser):
    """PDF de aging de CxC listo para cobranza."""
    from fastapi.responses import Response
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    from app.modules.sales.universal_service import _get_company_dict
    from app.modules.finance import pdf_reports
    from datetime import datetime as _dt
    ids = await visible_warehouse_ids(db, current_user)
    items_raw = await service.get_cxc(db, branch_warehouse_ids=ids)
    items = [i.model_dump() if hasattr(i, "model_dump") else dict(i) for i in items_raw]
    company = await _get_company_dict(db)
    pdf = pdf_reports.build_aging_pdf(
        company, items, title="Estado de cartera — Cuentas por cobrar",
        kind="cxc", generated_at=_dt.utcnow(),
    )
    fname = f"cxc_{_dt.utcnow().strftime('%Y%m%d')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/cxp/aging-report.pdf")
async def cxp_aging_pdf(db: DB, current_user: CurrentUser):
    """PDF de aging de CxP listo para tesorería."""
    from fastapi.responses import Response
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    from app.modules.sales.universal_service import _get_company_dict
    from app.modules.finance import pdf_reports
    from datetime import datetime as _dt
    ids = await visible_warehouse_ids(db, current_user)
    items_raw = await service.get_cxp(db, branch_warehouse_ids=ids)
    items = [i.model_dump() if hasattr(i, "model_dump") else dict(i) for i in items_raw]
    company = await _get_company_dict(db)
    pdf = pdf_reports.build_aging_pdf(
        company, items, title="Cuentas por pagar — Programa de pagos",
        kind="cxp", generated_at=_dt.utcnow(),
    )
    fname = f"cxp_{_dt.utcnow().strftime('%Y%m%d')}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/cxc/aging-summary")
async def cxc_aging_summary(db: DB, current_user: CurrentUser):
    """Resumen ejecutivo de cartera vencida por antigüedad.
    Retorna: totales por bucket, top clientes vencidos, total al corriente vs vencido."""
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    items = await service.get_cxc(db, branch_warehouse_ids=ids)
    buckets = {"current": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    by_customer: dict = {}
    total = 0.0
    total_overdue = 0.0
    for i in items:
        b = i.aging or "current"
        buckets[b] = buckets.get(b, 0.0) + float(i.balance or 0.0)
        total += float(i.balance or 0.0)
        if b != "current":
            total_overdue += float(i.balance or 0.0)
        key = i.name or "Sin nombre"
        by_customer[key] = by_customer.get(key, 0.0) + float(i.balance or 0.0)
    top = sorted(by_customer.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        "buckets": [
            {"bucket": "Al corriente", "amount": round(buckets["current"], 2)},
            {"bucket": "1-30 días",   "amount": round(buckets["1-30"], 2)},
            {"bucket": "31-60 días",  "amount": round(buckets["31-60"], 2)},
            {"bucket": "61-90 días",  "amount": round(buckets["61-90"], 2)},
            {"bucket": "+90 días",    "amount": round(buckets["90+"], 2)},
        ],
        "total": round(total, 2),
        "total_overdue": round(total_overdue, 2),
        "overdue_pct": round((total_overdue / total * 100) if total else 0.0, 1),
        "top_debtors": [{"name": n, "balance": round(a, 2)} for n, a in top],
        "count": len(items),
    }


@router.get("/cxp/aging-summary")
async def cxp_aging_summary(db: DB, current_user: CurrentUser):
    """Resumen ejecutivo de cuentas por pagar vencidas."""
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    items = await service.get_cxp(db, branch_warehouse_ids=ids)
    buckets = {"current": 0.0, "1-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    by_supplier: dict = {}
    total = 0.0
    total_overdue = 0.0
    for i in items:
        b = i.aging or "current"
        buckets[b] = buckets.get(b, 0.0) + float(i.balance or 0.0)
        total += float(i.balance or 0.0)
        if b != "current":
            total_overdue += float(i.balance or 0.0)
        key = i.name or "Sin nombre"
        by_supplier[key] = by_supplier.get(key, 0.0) + float(i.balance or 0.0)
    top = sorted(by_supplier.items(), key=lambda x: x[1], reverse=True)[:10]
    return {
        "buckets": [
            {"bucket": "Al corriente", "amount": round(buckets["current"], 2)},
            {"bucket": "1-30 días",   "amount": round(buckets["1-30"], 2)},
            {"bucket": "31-60 días",  "amount": round(buckets["31-60"], 2)},
            {"bucket": "61-90 días",  "amount": round(buckets["61-90"], 2)},
            {"bucket": "+90 días",    "amount": round(buckets["90+"], 2)},
        ],
        "total": round(total, 2),
        "total_overdue": round(total_overdue, 2),
        "overdue_pct": round((total_overdue / total * 100) if total else 0.0, 1),
        "top_creditors": [{"name": n, "balance": round(a, 2)} for n, a in top],
        "count": len(items),
    }


LARGE_PAYMENT_THRESHOLD = 10000.0


@router.post("/cxc/{order_id}/pay")
async def pay_cxc(order_id: int, pay_in: schemas.PayDebtRequest, db: DB, current_user: CurrentUser):
    if pay_in.amount >= LARGE_PAYMENT_THRESHOLD:
        _require_manager(current_user)
    try:
        order = await service.pay_cxc(db, order_id, pay_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not order:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return {"ok": True, "balance": order.balance}


# --- CXP ---
@router.get("/cxp", response_model=List[schemas.AgingItem])
async def read_cxp(db: DB, current_user: CurrentUser):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_cxp(db, branch_warehouse_ids=ids)


@router.post("/cxp/{po_id}/pay")
async def pay_cxp(po_id: int, pay_in: schemas.PayDebtRequest, db: DB, current_user: CurrentUser):
    if pay_in.amount >= LARGE_PAYMENT_THRESHOLD:
        _require_manager(current_user)
    try:
        po = await service.pay_cxp(db, po_id, pay_in, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not po:
        raise HTTPException(status_code=404, detail="Orden de compra no encontrada")
    return {"ok": True, "balance": po.balance}


# --- Facturas de proveedor (CxP moderna) -----------------------------------
# Coexiste con /cxp (que combina bills + OCs). Estos endpoints permiten CRUD
# directo sobre la tabla de facturas.

@router.get("/bills", response_model=List[schemas.SupplierBillInDB])
async def list_bills(
    db: DB, current_user: CurrentUser,
    supplier_id: Optional[int] = None,
    status: Optional[str] = None,
    aging: Optional[str] = None,
    due_before: Optional[datetime] = None,
    due_after: Optional[datetime] = None,
):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.list_bills(
        db, supplier_id=supplier_id, status=status, aging=aging,
        due_before=due_before, due_after=due_after,
        branch_warehouse_ids=ids,
    )


@router.get("/bills/stats", response_model=schemas.BillsStats)
async def bills_stats(db: DB, _: CurrentUser):
    return await service.bills_stats(db)


@router.get("/bills/{bill_id}", response_model=schemas.SupplierBillInDB)
async def read_bill(bill_id: int, db: DB, _: CurrentUser):
    bill = await service.get_bill(db, bill_id)
    if bill is None:
        raise HTTPException(404, "Factura no encontrada")
    return bill


@router.post("/bills", response_model=schemas.SupplierBillInDB, status_code=201)
async def create_bill(data: schemas.SupplierBillCreate, db: DB, current_user: CurrentUser):
    return await service.create_bill(db, data, user_id=current_user.id, branch_id=_finance_branch(current_user))


@router.put("/bills/{bill_id}", response_model=schemas.SupplierBillInDB)
async def update_bill(bill_id: int, data: schemas.SupplierBillUpdate, db: DB, current_user: CurrentUser):
    bill = await service.update_bill(db, bill_id, data, user_id=current_user.id)
    if bill is None:
        raise HTTPException(404, "Factura no encontrada")
    return bill


@router.delete("/bills/{bill_id}", status_code=204)
async def delete_bill(bill_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_bill(db, bill_id, user_id=current_user.id)
    if not ok:
        raise HTTPException(404, "Factura no encontrada")


@router.post("/bills/pay", response_model=schemas.BillPayResponse)
async def pay_bills(req: schemas.BillPayRequest, db: DB, current_user: CurrentUser):
    """Pago consolidado. Un pago liquida una o varias bills del mismo proveedor
    (o de distintos proveedores si viene en el payload). Crea la Transaction y
    los BillPayment atomicamente."""
    if req.amount >= LARGE_PAYMENT_THRESHOLD:
        _require_manager(current_user)
    try:
        return await service.pay_bills(db, req, user_id=current_user.id, branch_id=_finance_branch(current_user))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/bills/{bill_id}/remind", response_model=schemas.BillReminderResult)
async def remind_bill(bill_id: int, db: DB, current_user: CurrentUser):
    return await service.remind_bill(db, bill_id, user_id=current_user.id)


# --- Bancos ---
@router.get("/banks", response_model=List[schemas.BankAccountInDB])
async def read_banks(db: DB, current_user: CurrentUser):
    return await service.get_banks(db, branch_id=_finance_branch(current_user))


@router.post("/banks", response_model=schemas.BankAccountInDB)
async def create_bank(bank_in: schemas.BankAccountCreate, db: DB, current_user: CurrentUser):
    return await service.create_bank(db, bank_in, branch_id=_finance_branch(current_user))


@router.put("/banks/{bank_id}", response_model=schemas.BankAccountInDB)
async def update_bank(bank_id: int, bank_in: schemas.BankAccountUpdate, db: DB, current_user: CurrentUser):
    bank = await service.update_bank(db, bank_id, bank_in)
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.delete("/banks/{bank_id}", response_model=schemas.BankAccountInDB)
async def deactivate_bank(bank_id: int, db: DB, current_user: CurrentUser):
    bank = await service.deactivate_bank(db, bank_id)
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.get("/banks/{bank_id}/transactions", response_model=List[schemas.BankTransactionInDB])
async def read_bank_transactions(bank_id: int, db: DB, current_user: CurrentUser):
    return await service.get_bank_transactions(db, bank_id)


@router.post("/banks/{bank_id}/transactions", response_model=schemas.BankAccountInDB)
async def create_bank_transaction(bank_id: int, data: schemas.BankTransactionCreate, db: DB, current_user: CurrentUser):
    bank = await service.create_bank_transaction(db, bank_id, data)
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.post("/banks/{bank_id}/transfer", response_model=schemas.BankAccountInDB)
async def transfer_bank(bank_id: int, data: schemas.BankTransferCreate, db: DB, current_user: CurrentUser):
    try:
        bank = await service.transfer_between_banks(db, bank_id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not bank:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return bank


@router.post("/banks/{bank_id}/import", response_model=schemas.BankImportResult)
async def import_bank_statement(
    bank_id: int,
    db: DB,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
):
    content = await file.read()
    try:
        result = await service.import_bank_statement(db, bank_id, content, file.filename, password)
    except ValueError as e:
        if str(e) == "PDF_PASSWORD_REQUIRED":
            raise HTTPException(status_code=422, detail="PDF_PASSWORD_REQUIRED")
        raise HTTPException(status_code=400, detail=str(e))
    if not result:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return result


# --- Flujo de caja ---
@router.get("/cash-flow", response_model=List[schemas.FlowPoint])
async def read_cash_flow(db: DB, current_user: CurrentUser, months: int = 6):
    return await service.get_cash_flow(db, months=months)


# --- Conciliación bancaria ---
@router.put("/bank-transactions/{movement_id}/reconcile", response_model=schemas.BankTransactionInDB)
async def reconcile_movement(movement_id: int, data: schemas.ReconcileRequest, db: DB, current_user: CurrentUser):
    mv = await service.toggle_reconciled(db, movement_id, data.reconciled)
    if not mv:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    return mv


# --- Presupuestos ---
@router.get("/budgets", response_model=List[schemas.BudgetInDB])
async def read_budgets(db: DB, current_user: CurrentUser, period: Optional[str] = None):
    return await service.get_budgets(db, period=period, branch_id=_finance_branch(current_user))


@router.post("/budgets", response_model=schemas.BudgetInDB)
async def create_budget(data: schemas.BudgetCreate, db: DB, current_user: CurrentUser):
    return await service.create_budget(db, data, branch_id=_finance_branch(current_user))


@router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_budget(db, budget_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Presupuesto no encontrado")
    return {"ok": True}


@router.get("/budgets/comparison", response_model=List[schemas.BudgetComparisonItem])
async def read_budget_comparison(db: DB, current_user: CurrentUser, period: str):
    return await service.get_budget_comparison(db, period)


# --- Transacciones recurrentes ---
@router.get("/recurring", response_model=List[schemas.RecurringTransactionInDB])
async def read_recurring(db: DB, current_user: CurrentUser):
    await service.process_due_recurring_transactions(db)
    return await service.get_recurring_transactions(db)


@router.post("/recurring", response_model=schemas.RecurringTransactionInDB)
async def create_recurring(data: schemas.RecurringTransactionCreate, db: DB, current_user: CurrentUser):
    return await service.create_recurring_transaction(db, data)


@router.put("/recurring/{rt_id}", response_model=schemas.RecurringTransactionInDB)
async def update_recurring(rt_id: int, data: schemas.RecurringTransactionUpdate, db: DB, current_user: CurrentUser):
    rt = await service.update_recurring_transaction(db, rt_id, data)
    if not rt:
        raise HTTPException(status_code=404, detail="Transacción recurrente no encontrada")
    return rt


@router.delete("/recurring/{rt_id}")
async def delete_recurring(rt_id: int, db: DB, current_user: CurrentUser):
    ok = await service.delete_recurring_transaction(db, rt_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transacción recurrente no encontrada")
    return {"ok": True}


# --- Pagos programados ---
@router.get("/scheduled-payments", response_model=List[schemas.ScheduledPaymentInDB])
async def read_scheduled_payments(db: DB, current_user: CurrentUser, status: Optional[str] = None):
    await service.process_due_scheduled_payments(db)
    try:
        await service.send_scheduled_payment_reminders(db)
    except Exception:
        pass
    return await service.get_scheduled_payments(db, status=status)


@router.post("/scheduled-payments/send-reminders")
async def send_payment_reminders(db: DB, current_user: CurrentUser, lead_days: int = 7):
    """Envía ahora, manualmente, los recordatorios de pagos próximos/vencidos
    al correo de contacto de la empresa. Devuelve cuántos se enviaron (0 si no
    hay correo configurado en Configuración > Integraciones)."""
    try:
        sent = await service.send_scheduled_payment_reminders(db, lead_days=lead_days)
        return {"sent": sent}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/scheduled-payments", response_model=schemas.ScheduledPaymentInDB)
async def create_scheduled_payment(data: schemas.ScheduledPaymentCreate, db: DB, current_user: CurrentUser):
    return await service.create_scheduled_payment(db, data, user_id=current_user.id)


@router.delete("/scheduled-payments/{sp_id}", response_model=schemas.ScheduledPaymentInDB)
async def cancel_scheduled_payment(sp_id: int, db: DB, current_user: CurrentUser):
    sp = await service.cancel_scheduled_payment(db, sp_id, user_id=current_user.id)
    if not sp:
        raise HTTPException(status_code=404, detail="Pago programado no encontrado")
    return sp


# --- Reportes P&L y comparativo ---
@router.get("/reports/pnl", response_model=schemas.PnLReport)
async def read_pnl(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    return await service.get_pnl_report(db, start, end, branch_id=_finance_branch(current_user))


@router.get("/reports/comparison", response_model=schemas.PeriodComparison)
async def read_period_comparison(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    return await service.get_period_comparison(db, start, end, branch_id=_finance_branch(current_user))


@router.get("/reports/pnl/export")
async def export_pnl_pdf(db: DB, current_user: CurrentUser, start: datetime, end: datetime):
    report = await service.get_pnl_report(db, start, end, branch_id=_finance_branch(current_user))
    pdf_bytes = service.generate_pnl_pdf(report)
    return Response(content=pdf_bytes, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=pnl_{start.date()}_{end.date()}.pdf"
    })


# --- Bitácora de auditoría ---
@router.get("/audit-logs", response_model=List[schemas.AuditLogItem])
async def read_finance_audit_logs(db: DB, current_user: CurrentUser, skip: int = 0, limit: int = 100):
    return await service.get_finance_audit_logs(db, skip=skip, limit=limit)
