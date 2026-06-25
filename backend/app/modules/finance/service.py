from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timezone
from collections import OrderedDict
from app.modules.finance import models, schemas


async def create_transaction(
    db: AsyncSession, tx_in: schemas.TransactionCreate, user_id: Optional[int] = None
) -> models.Transaction:
    db_tx = models.Transaction(**tx_in.model_dump(), created_by_id=user_id)
    db.add(db_tx)
    await db.commit()
    await db.refresh(db_tx)
    return db_tx


async def update_transaction(db: AsyncSession, tx_id: int, data: schemas.TransactionUpdate) -> Optional[models.Transaction]:
    res = await db.execute(select(models.Transaction).where(models.Transaction.id == tx_id))
    tx = res.scalars().first()
    if not tx:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(tx, field, value)
    await db.commit()
    await db.refresh(tx)
    return tx


async def delete_transaction(db: AsyncSession, tx_id: int) -> bool:
    res = await db.execute(select(models.Transaction).where(models.Transaction.id == tx_id))
    tx = res.scalars().first()
    if not tx:
        return False
    await db.delete(tx)
    await db.commit()
    return True


async def get_transactions(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 100,
    type: Optional[str] = None,
) -> List[models.Transaction]:
    stmt = select(models.Transaction).order_by(models.Transaction.id.desc())
    if type:
        stmt = stmt.where(models.Transaction.type == type)
    result = await db.execute(stmt.offset(skip).limit(limit))
    return result.scalars().all()


async def get_dashboard(db: AsyncSession) -> schemas.FinanceDashboard:
    income_result = await db.execute(
        select(func.coalesce(func.sum(models.Transaction.amount), 0.0)).where(
            models.Transaction.type == "income"
        )
    )
    expense_result = await db.execute(
        select(func.coalesce(func.sum(models.Transaction.amount), 0.0)).where(
            models.Transaction.type == "expense"
        )
    )
    count_result = await db.execute(select(func.count(models.Transaction.id)))

    total_income = float(income_result.scalar() or 0.0)
    total_expenses = float(expense_result.scalar() or 0.0)

    return schemas.FinanceDashboard(
        total_income=total_income,
        total_expenses=total_expenses,
        net_profit=total_income - total_expenses,
        transaction_count=int(count_result.scalar() or 0),
    )


def _r(x: float) -> float:
    return round(float(x or 0.0), 2)


def _aging_bucket(due_date, balance: float, today=None) -> str:
    today = today or datetime.now(timezone.utc)
    if balance <= 0:
        return "current"
    if not due_date:
        return "current"
    if due_date.tzinfo is None:
        due_date = due_date.replace(tzinfo=timezone.utc)
    days_late = (today - due_date).days
    if days_late <= 0:
        return "current"
    if days_late <= 30:
        return "1-30"
    if days_late <= 60:
        return "31-60"
    if days_late <= 90:
        return "61-90"
    return "90+"


def _status_for(paid: float, balance: float, due_date, today=None) -> str:
    today = today or datetime.now(timezone.utc)
    if balance <= 0.001:
        return "paid"
    if due_date:
        d = due_date if due_date.tzinfo else due_date.replace(tzinfo=timezone.utc)
        if d < today:
            return "overdue"
    if paid > 0:
        return "partial"
    return "pending"


# --- CXC (cuentas por cobrar) ------------------------------------------------

async def get_cxc(db: AsyncSession) -> List[schemas.AgingItem]:
    from app.modules.sales import models as sales_models

    res = await db.execute(
        select(sales_models.Order)
        .where(sales_models.Order.kind == "order", sales_models.Order.status.notin_(["cancelled", "draft"]))
        .options(selectinload(sales_models.Order.customer))
    )
    orders = res.scalars().unique().all()
    today = datetime.now(timezone.utc)
    out = []
    for o in orders:
        balance = _r((o.total_amount or 0.0) - (o.paid_amount or 0.0))
        if balance <= 0.001:
            continue
        out.append(schemas.AgingItem(
            id=o.id,
            name=o.customer.name if o.customer else "Cliente sin nombre",
            reference=o.folio or f"#{o.id}",
            total=_r(o.total_amount), paid=_r(o.paid_amount), balance=balance,
            due_date=o.due_date,
            aging=_aging_bucket(o.due_date, balance, today),
            status=_status_for(o.paid_amount, balance, o.due_date, today),
        ))
    return out


async def pay_cxc(db: AsyncSession, order_id: int, pay_in: schemas.PayDebtRequest, user_id: Optional[int] = None):
    from app.modules.sales import service as sales_service
    from app.modules.sales import schemas as sales_schemas

    return await sales_service.register_payment(
        db, order_id,
        sales_schemas.PaymentCreate(amount=pay_in.amount, method=pay_in.method, reference=pay_in.reference, note=pay_in.note),
        user_id=user_id,
    )


# --- CXP (cuentas por pagar) --------------------------------------------------

async def get_cxp(db: AsyncSession) -> List[schemas.AgingItem]:
    from app.modules.inventory import models as inv_models

    res = await db.execute(
        select(inv_models.PurchaseOrder)
        .where(inv_models.PurchaseOrder.status.notin_(["cancelled", "draft"]))
        .options(selectinload(inv_models.PurchaseOrder.supplier))
    )
    pos = res.scalars().unique().all()
    today = datetime.now(timezone.utc)
    out = []
    for po in pos:
        balance = _r((po.total_amount or 0.0) - (po.paid_amount or 0.0))
        if balance <= 0.001:
            continue
        out.append(schemas.AgingItem(
            id=po.id,
            name=po.supplier.name if po.supplier else "Proveedor",
            reference=po.folio or f"#{po.id}",
            total=_r(po.total_amount), paid=_r(po.paid_amount), balance=balance,
            due_date=po.due_date,
            aging=_aging_bucket(po.due_date, balance, today),
            status=_status_for(po.paid_amount, balance, po.due_date, today),
        ))
    return out


async def pay_cxp(db: AsyncSession, po_id: int, pay_in: schemas.PayDebtRequest, user_id: Optional[int] = None):
    from app.modules.inventory import service as inv_service
    from app.modules.inventory import schemas as inv_schemas

    return await inv_service.pay_purchase_order(
        db, po_id,
        inv_schemas.SupplierPaymentCreate(amount=pay_in.amount, method=pay_in.method, reference=pay_in.reference, note=pay_in.note),
        user_id=user_id,
    )


# --- Bank accounts -------------------------------------------------------------

async def get_banks(db: AsyncSession) -> List[models.BankAccount]:
    res = await db.execute(select(models.BankAccount).where(models.BankAccount.is_active == True).order_by(models.BankAccount.id))  # noqa: E712
    return res.scalars().all()


async def create_bank(db: AsyncSession, data: schemas.BankAccountCreate) -> models.BankAccount:
    bank = models.BankAccount(**data.model_dump())
    db.add(bank)
    await db.commit()
    await db.refresh(bank)
    return bank


async def deactivate_bank(db: AsyncSession, bank_id: int) -> Optional[models.BankAccount]:
    res = await db.execute(select(models.BankAccount).where(models.BankAccount.id == bank_id))
    bank = res.scalars().first()
    if not bank:
        return None
    bank.is_active = False
    await db.commit()
    await db.refresh(bank)
    return bank


async def get_bank_transactions(db: AsyncSession, bank_id: int) -> List[models.BankTransaction]:
    res = await db.execute(
        select(models.BankTransaction)
        .where(models.BankTransaction.bank_account_id == bank_id)
        .order_by(models.BankTransaction.created_at.desc())
    )
    return res.scalars().all()


async def create_bank_transaction(db: AsyncSession, bank_id: int, data: schemas.BankTransactionCreate) -> Optional[models.BankAccount]:
    res = await db.execute(select(models.BankAccount).where(models.BankAccount.id == bank_id))
    bank = res.scalars().first()
    if not bank:
        return None
    delta = data.amount if data.type == "deposit" else -data.amount
    bank.balance = _r((bank.balance or 0.0) + delta)
    db.add(models.BankTransaction(
        bank_account_id=bank_id, type=data.type, amount=_r(data.amount),
        description=data.description, reference=data.reference,
    ))
    await db.commit()
    await db.refresh(bank)
    return bank


async def transfer_between_banks(db: AsyncSession, from_id: int, data: schemas.BankTransferCreate) -> Optional[models.BankAccount]:
    res = await db.execute(select(models.BankAccount).where(models.BankAccount.id.in_([from_id, data.to_account_id])))
    accounts = {a.id: a for a in res.scalars().all()}
    src = accounts.get(from_id)
    dst = accounts.get(data.to_account_id)
    if not src or not dst:
        return None
    if data.amount <= 0:
        raise ValueError("El monto debe ser mayor a cero")
    src.balance = _r((src.balance or 0.0) - data.amount)
    dst.balance = _r((dst.balance or 0.0) + data.amount)
    db.add(models.BankTransaction(bank_account_id=src.id, type="transfer_out", amount=_r(data.amount), description=data.description))
    db.add(models.BankTransaction(bank_account_id=dst.id, type="transfer_in", amount=_r(data.amount), description=data.description))
    await db.commit()
    await db.refresh(src)
    return src


# --- Cash flow -----------------------------------------------------------------

async def get_cash_flow(db: AsyncSession, months: int = 6) -> List[schemas.FlowPoint]:
    res = await db.execute(
        select(models.Transaction.created_at, models.Transaction.type, models.Transaction.amount)
        .order_by(models.Transaction.created_at)
    )
    rows = res.all()

    buckets: "OrderedDict[str, dict]" = OrderedDict()
    for created_at, ttype, amount in rows:
        if not created_at:
            continue
        period = created_at.strftime("%Y-%m")
        if period not in buckets:
            buckets[period] = {"income": 0.0, "expenses": 0.0}
        if ttype == "income":
            buckets[period]["income"] += float(amount or 0.0)
        else:
            buckets[period]["expenses"] += float(amount or 0.0)

    points = [
        schemas.FlowPoint(period=p, income=_r(v["income"]), expenses=_r(v["expenses"]), net=_r(v["income"] - v["expenses"]))
        for p, v in buckets.items()
    ]
    return points[-months:]


# --- Importación de estados de cuenta (CSV/Excel) -------------------------------

_DATE_COLS = ("fecha", "date", "fecha de operacion", "fecha operacion")
_DESC_COLS = ("descripcion", "concepto", "description", "detalle")
_AMOUNT_COLS = ("monto", "amount", "importe")
_DEBIT_COLS = ("cargo", "debito", "debit", "retiro")
_CREDIT_COLS = ("abono", "credito", "credit", "deposito")
_REF_COLS = ("referencia", "reference", "folio")


def _find_col(columns, candidates) -> Optional[str]:
    for c in candidates:
        if c in columns:
            return c
    return None


def _parse_amount(v) -> float:
    if v is None:
        return 0.0
    s = str(v).strip().replace("$", "").replace(",", "")
    if s in ("", "-", "nan"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date(v):
    import pandas as pd
    try:
        ts = pd.to_datetime(v, dayfirst=True, errors="coerce")
        if ts is None or ts is pd.NaT:
            return None
        return ts.to_pydatetime().replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def import_bank_statement(
    db: AsyncSession, bank_id: int, file_bytes: bytes, filename: str
) -> Optional[schemas.BankImportResult]:
    import pandas as pd
    from io import BytesIO

    res = await db.execute(select(models.BankAccount).where(models.BankAccount.id == bank_id))
    bank = res.scalars().first()
    if not bank:
        return None

    name = (filename or "").lower()
    if name.endswith(".csv"):
        df = pd.read_csv(BytesIO(file_bytes), dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(BytesIO(file_bytes), dtype=str, keep_default_na=False)
    df.columns = [str(c).strip().lower() for c in df.columns]

    date_col = _find_col(df.columns, _DATE_COLS)
    desc_col = _find_col(df.columns, _DESC_COLS)
    amount_col = _find_col(df.columns, _AMOUNT_COLS)
    debit_col = _find_col(df.columns, _DEBIT_COLS)
    credit_col = _find_col(df.columns, _CREDIT_COLS)
    ref_col = _find_col(df.columns, _REF_COLS)

    if not date_col or not (amount_col or debit_col or credit_col):
        raise ValueError(
            "No se reconocen las columnas del estado de cuenta. Se espera una columna de fecha "
            "y una de monto (o cargo/abono)."
        )

    existing_res = await db.execute(
        select(models.BankTransaction.created_at, models.BankTransaction.amount, models.BankTransaction.description)
        .where(models.BankTransaction.bank_account_id == bank_id)
    )
    existing_keys = {(c.date(), round(float(a), 2), (d or "").strip()) for c, a, d in existing_res.all() if c}

    errors: List[schemas.BankImportRowError] = []
    imported = 0
    skipped = 0
    delta = 0.0

    for idx, row in df.iterrows():
        row_num = idx + 2  # 1-indexed + encabezado
        when = _parse_date(row.get(date_col))
        if not when:
            errors.append(schemas.BankImportRowError(row=row_num, error="Fecha inválida o vacía"))
            continue

        if amount_col:
            amt = _parse_amount(row.get(amount_col))
            mtype = "deposit" if amt >= 0 else "withdrawal"
            amt = abs(amt)
        else:
            credit = _parse_amount(row.get(credit_col)) if credit_col else 0.0
            debit = _parse_amount(row.get(debit_col)) if debit_col else 0.0
            if credit > 0:
                mtype, amt = "deposit", credit
            elif debit > 0:
                mtype, amt = "withdrawal", debit
            else:
                errors.append(schemas.BankImportRowError(row=row_num, error="Sin monto de cargo/abono"))
                continue

        if amt <= 0:
            errors.append(schemas.BankImportRowError(row=row_num, error="Monto en cero o inválido"))
            continue

        description = (row.get(desc_col) or "").strip() if desc_col else None
        reference = (row.get(ref_col) or "").strip() if ref_col else None

        key = (when.date(), round(amt, 2), (description or "").strip())
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)

        db.add(models.BankTransaction(
            bank_account_id=bank_id, type=mtype, amount=_r(amt),
            description=description or None, reference=reference or None, created_at=when,
        ))
        delta += amt if mtype == "deposit" else -amt
        imported += 1

    bank.balance = _r((bank.balance or 0.0) + delta)
    await db.commit()
    await db.refresh(bank)

    return schemas.BankImportResult(
        total_rows=len(df), imported=imported, skipped_duplicates=skipped,
        errors=errors, new_balance=bank.balance,
    )
