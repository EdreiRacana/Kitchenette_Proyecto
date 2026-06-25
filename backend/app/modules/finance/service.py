from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timezone
from collections import OrderedDict
from app.modules.finance import models, schemas


async def _log_audit(db: AsyncSession, user_id: Optional[int], action: str, description: str = None, details: dict = None):
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(db, user_id=user_id, action=action, module="finance", description=description, details=details)
    except Exception:
        pass


async def create_transaction(
    db: AsyncSession, tx_in: schemas.TransactionCreate, user_id: Optional[int] = None
) -> models.Transaction:
    db_tx = models.Transaction(**tx_in.model_dump(), created_by_id=user_id)
    db.add(db_tx)
    await db.commit()
    await db.refresh(db_tx)
    await _log_audit(db, user_id, "CREATE_TRANSACTION", f"{tx_in.type} {tx_in.amount} ({tx_in.category or 's/cat'})", {"id": db_tx.id})
    return db_tx


async def update_transaction(db: AsyncSession, tx_id: int, data: schemas.TransactionUpdate, user_id: Optional[int] = None) -> Optional[models.Transaction]:
    res = await db.execute(select(models.Transaction).where(models.Transaction.id == tx_id))
    tx = res.scalars().first()
    if not tx:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(tx, field, value)
    await db.commit()
    await db.refresh(tx)
    await _log_audit(db, user_id, "UPDATE_TRANSACTION", f"Transacción #{tx_id} actualizada", {"id": tx_id})
    return tx


async def delete_transaction(db: AsyncSession, tx_id: int, user_id: Optional[int] = None) -> bool:
    res = await db.execute(select(models.Transaction).where(models.Transaction.id == tx_id))
    tx = res.scalars().first()
    if not tx:
        return False
    await db.delete(tx)
    await db.commit()
    await _log_audit(db, user_id, "DELETE_TRANSACTION", f"Transacción #{tx_id} eliminada", {"id": tx_id})
    return True


async def set_transaction_attachment(db: AsyncSession, tx_id: int, attachment_url: str, user_id: Optional[int] = None) -> Optional[models.Transaction]:
    res = await db.execute(select(models.Transaction).where(models.Transaction.id == tx_id))
    tx = res.scalars().first()
    if not tx:
        return None
    tx.attachment_url = attachment_url
    await db.commit()
    await db.refresh(tx)
    await _log_audit(db, user_id, "ATTACH_FILE", f"Comprobante adjuntado a transacción #{tx_id}", {"id": tx_id, "url": attachment_url})
    return tx


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

    bank_result = await db.execute(
        select(func.coalesce(func.sum(models.BankAccount.balance), 0.0)).where(models.BankAccount.is_active == True)  # noqa: E712
    )
    bank_balance = float(bank_result.scalar() or 0.0)

    cxc = await get_cxc(db)
    cxp = await get_cxp(db)
    cxc_balance = _r(sum(i.balance for i in cxc))
    cxp_balance = _r(sum(i.balance for i in cxp))
    projected_balance = _r(bank_balance + cxc_balance - cxp_balance)

    return schemas.FinanceDashboard(
        total_income=total_income,
        total_expenses=total_expenses,
        net_profit=total_income - total_expenses,
        transaction_count=int(count_result.scalar() or 0),
        projected_balance=projected_balance,
        bank_balance=_r(bank_balance),
        cxc_balance=cxc_balance,
        cxp_balance=cxp_balance,
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


LATE_FEE_MONTHLY_RATE = 0.02  # 2% mensual sobre saldo vencido


def _late_fee(balance: float, due_date, today=None) -> float:
    today = today or datetime.now(timezone.utc)
    if balance <= 0 or not due_date:
        return 0.0
    if due_date.tzinfo is None:
        due_date = due_date.replace(tzinfo=timezone.utc)
    days_late = (today - due_date).days
    if days_late <= 0:
        return 0.0
    months_late = days_late / 30.0
    return _r(balance * LATE_FEE_MONTHLY_RATE * months_late)


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
            late_fee=_late_fee(balance, o.due_date, today),
        ))
    return out


async def pay_cxc(db: AsyncSession, order_id: int, pay_in: schemas.PayDebtRequest, user_id: Optional[int] = None):
    from app.modules.sales import service as sales_service
    from app.modules.sales import schemas as sales_schemas

    result = await sales_service.register_payment(
        db, order_id,
        sales_schemas.PaymentCreate(amount=pay_in.amount, method=pay_in.method, reference=pay_in.reference, note=pay_in.note),
        user_id=user_id,
    )
    await _log_audit(db, user_id, "PAY_CXC", f"Pago de {pay_in.amount} a cuenta por cobrar #{order_id}", {"order_id": order_id, "amount": pay_in.amount})
    return result


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
            late_fee=_late_fee(balance, po.due_date, today),
        ))
    return out


async def pay_cxp(db: AsyncSession, po_id: int, pay_in: schemas.PayDebtRequest, user_id: Optional[int] = None):
    from app.modules.inventory import service as inv_service
    from app.modules.inventory import schemas as inv_schemas

    result = await inv_service.pay_purchase_order(
        db, po_id,
        inv_schemas.SupplierPaymentCreate(amount=pay_in.amount, method=pay_in.method, reference=pay_in.reference, note=pay_in.note),
        user_id=user_id,
    )
    await _log_audit(db, user_id, "PAY_CXP", f"Pago de {pay_in.amount} a cuenta por pagar #{po_id}", {"po_id": po_id, "amount": pay_in.amount})
    return result


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


async def toggle_reconciled(db: AsyncSession, movement_id: int, reconciled: bool) -> Optional[models.BankTransaction]:
    res = await db.execute(select(models.BankTransaction).where(models.BankTransaction.id == movement_id))
    mv = res.scalars().first()
    if not mv:
        return None
    mv.reconciled = reconciled
    await db.commit()
    await db.refresh(mv)
    return mv


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


def _strip_accents(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _find_col(columns, candidates) -> Optional[str]:
    for col in columns:
        norm = _strip_accents(col)
        if any(cand in norm for cand in candidates):
            return col
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


import re

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}")


def _parse_date(v):
    import pandas as pd
    try:
        # Las fechas ISO (YYYY-MM-DD, p.ej. las que vienen de Excel) son inequívocas;
        # dayfirst solo aplica a formatos ambiguos como DD/MM/YYYY.
        dayfirst = not _ISO_DATE_RE.match(str(v).strip())
        ts = pd.to_datetime(v, dayfirst=dayfirst, errors="coerce")
        if ts is None or ts is pd.NaT:
            return None
        return ts.to_pydatetime().replace(tzinfo=timezone.utc)
    except Exception:
        return None


_PDF_LINE_RE = re.compile(
    r"^(?P<date>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(?P<desc>.+?)\s+"
    r"(?P<amount>-?\$?[\d,]+\.\d{2})(?:\s+(?P<amount2>-?\$?[\d,]+\.\d{2}))?\s*$"
)


def _ocr_pdf_text(file_bytes: bytes) -> str:
    """Best-effort OCR para PDFs escaneados (imagen). Requiere tesseract-ocr y poppler-utils
    instalados en el sistema; si no están disponibles (p.ej. en el runtime nativo de Render
    sin Dockerfile), lanza una excepción clara en vez de fallar silenciosamente."""
    import pytesseract
    from pdf2image import convert_from_bytes

    images = convert_from_bytes(file_bytes)
    text_parts = []
    for img in images:
        text_parts.append(pytesseract.image_to_string(img, lang="spa+eng"))
    return "\n".join(text_parts)


def _open_pdf(file_bytes: bytes, password: Optional[str] = None):
    import pdfplumber
    from io import BytesIO

    try:
        return pdfplumber.open(BytesIO(file_bytes), password=password or "")
    except Exception as exc:
        msg = str(exc).lower()
        if "password" in msg or "encrypt" in msg:
            if password:
                raise ValueError("La contraseña del PDF es incorrecta. Verifica e inténtalo de nuevo.")
            raise ValueError("PDF_PASSWORD_REQUIRED")
        raise


def _read_pdf_text_fallback(file_bytes: bytes, password: Optional[str] = None):
    import pandas as pd

    records = []

    def _extract(lines):
        for line in lines:
            m = _PDF_LINE_RE.match(line.strip())
            if not m:
                continue
            amount = m.group("amount2") or m.group("amount")
            records.append({"fecha": m.group("date"), "descripcion": m.group("desc").strip(), "monto": amount})

    has_text = False
    with _open_pdf(file_bytes, password) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                has_text = True
            _extract(text.split("\n"))

    if not records and not has_text:
        try:
            ocr_text = _ocr_pdf_text(file_bytes)
            _extract(ocr_text.split("\n"))
        except Exception as exc:
            raise ValueError(
                "El PDF parece ser una imagen escaneada (sin texto seleccionable) y el "
                "reconocimiento OCR no está disponible en este servidor "
                f"({exc}). Sube el CSV/Excel del banco o un PDF con texto seleccionable."
            )

    if not records:
        raise ValueError(
            "No se pudieron extraer movimientos del PDF. Verifica que sea un estado de cuenta con "
            "texto seleccionable (no una imagen escaneada) o sube el CSV/Excel del banco."
        )
    return pd.DataFrame(records)


def _read_pdf_table(file_bytes: bytes, password: Optional[str] = None):
    import pandas as pd

    header_keywords = _DATE_COLS + _DESC_COLS + _AMOUNT_COLS + _DEBIT_COLS + _CREDIT_COLS
    rows: list = []
    header: Optional[list] = None

    with _open_pdf(file_bytes, password) as pdf:
        for page in pdf.pages:
            for table in (page.extract_tables() or []):
                for raw_row in table:
                    cells = [(c or "").strip() for c in raw_row]
                    norm = [c.lower() for c in cells]
                    if header is None and any(any(k in c for k in header_keywords) for c in norm):
                        header = norm
                        continue
                    if header is not None and any(cells):
                        rows.append(cells)

    if header is None or not rows:
        return _read_pdf_text_fallback(file_bytes, password)

    width = len(header)
    rows = [r[:width] + [""] * (width - len(r)) for r in rows]
    return pd.DataFrame(rows, columns=header)


def _find_header_row(raw: "pd.DataFrame") -> int:
    """Los estados de cuenta reales suelen tener filas de metadatos (cliente, cuenta,
    periodo) antes de la tabla de movimientos. Busca la primera fila cuyo contenido
    coincide con los nombres de columna esperados, en vez de asumir que es la fila 0."""
    header_keywords = _DATE_COLS + _DESC_COLS + _AMOUNT_COLS + _DEBIT_COLS + _CREDIT_COLS
    for idx, row in raw.iterrows():
        cells = [_strip_accents(str(c).strip().lower()) for c in row.tolist()]
        if any(any(k in c for k in header_keywords) for c in cells):
            return idx
    return 0


def _read_bank_table(file_bytes: bytes, filename: str, password: Optional[str] = None):
    import pandas as pd
    from io import BytesIO

    name = (filename or "").lower()
    if name.endswith(".pdf"):
        df = _read_pdf_table(file_bytes, password)
        df.columns = [str(c).strip().lower() for c in df.columns]
        return df

    if name.endswith(".csv"):
        raw = pd.read_csv(BytesIO(file_bytes), header=None, dtype=str, keep_default_na=False)
    else:
        raw = pd.read_excel(BytesIO(file_bytes), header=None, dtype=str, keep_default_na=False)

    header_row = _find_header_row(raw)
    df = raw.iloc[header_row + 1:].reset_index(drop=True)
    df.columns = [str(c).strip().lower() for c in raw.iloc[header_row].tolist()]
    df = df[df.apply(lambda r: any(str(v).strip() for v in r), axis=1)].reset_index(drop=True)
    return df


async def import_bank_statement(
    db: AsyncSession, bank_id: int, file_bytes: bytes, filename: str, password: Optional[str] = None
) -> Optional[schemas.BankImportResult]:
    res = await db.execute(select(models.BankAccount).where(models.BankAccount.id == bank_id))
    bank = res.scalars().first()
    if not bank:
        return None

    try:
        df = _read_bank_table(file_bytes, filename, password)
    except ValueError as exc:
        if str(exc) == "PDF_PASSWORD_REQUIRED":
            raise ValueError("PDF_PASSWORD_REQUIRED")
        raise

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


# --- Presupuestos (Budget vs. real) ---------------------------------------------

async def get_budgets(db: AsyncSession, period: Optional[str] = None) -> List[models.Budget]:
    stmt = select(models.Budget).order_by(models.Budget.period.desc(), models.Budget.category)
    if period:
        stmt = stmt.where(models.Budget.period == period)
    res = await db.execute(stmt)
    return res.scalars().all()


async def create_budget(db: AsyncSession, data: schemas.BudgetCreate) -> models.Budget:
    budget = models.Budget(**data.model_dump())
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    return budget


async def delete_budget(db: AsyncSession, budget_id: int) -> bool:
    res = await db.execute(select(models.Budget).where(models.Budget.id == budget_id))
    budget = res.scalars().first()
    if not budget:
        return False
    await db.delete(budget)
    await db.commit()
    return True


async def get_budget_comparison(db: AsyncSession, period: str) -> List[schemas.BudgetComparisonItem]:
    budgets = await get_budgets(db, period=period)
    year, month = (int(p) for p in period.split("-"))
    res = await db.execute(
        select(models.Transaction.category, models.Transaction.type, func.coalesce(func.sum(models.Transaction.amount), 0.0))
        .where(func.extract("year", models.Transaction.created_at) == year, func.extract("month", models.Transaction.created_at) == month)
        .group_by(models.Transaction.category, models.Transaction.type)
    )
    actuals = {(cat or "sin categoría", ttype): float(total or 0.0) for cat, ttype, total in res.all()}

    out = []
    for b in budgets:
        actual = actuals.get((b.category, b.type), 0.0)
        variance = _r(b.amount - actual) if b.type == "expense" else _r(actual - b.amount)
        percent_used = _r((actual / b.amount * 100) if b.amount else 0.0)
        out.append(schemas.BudgetComparisonItem(
            category=b.category, type=b.type, period=period,
            budgeted=_r(b.amount), actual=_r(actual), variance=variance, percent_used=percent_used,
        ))
    return out


# --- Transacciones recurrentes --------------------------------------------------

async def get_recurring_transactions(db: AsyncSession) -> List[models.RecurringTransaction]:
    res = await db.execute(select(models.RecurringTransaction).order_by(models.RecurringTransaction.next_run_date))
    return res.scalars().all()


async def create_recurring_transaction(db: AsyncSession, data: schemas.RecurringTransactionCreate) -> models.RecurringTransaction:
    rt = models.RecurringTransaction(**data.model_dump())
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return rt


async def update_recurring_transaction(db: AsyncSession, rt_id: int, data: schemas.RecurringTransactionUpdate) -> Optional[models.RecurringTransaction]:
    res = await db.execute(select(models.RecurringTransaction).where(models.RecurringTransaction.id == rt_id))
    rt = res.scalars().first()
    if not rt:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rt, field, value)
    await db.commit()
    await db.refresh(rt)
    return rt


async def delete_recurring_transaction(db: AsyncSession, rt_id: int) -> bool:
    res = await db.execute(select(models.RecurringTransaction).where(models.RecurringTransaction.id == rt_id))
    rt = res.scalars().first()
    if not rt:
        return False
    await db.delete(rt)
    await db.commit()
    return True


def _advance_next_run(current: datetime, frequency: str) -> datetime:
    if frequency == "weekly":
        days = 7
    else:
        days = 30
    from datetime import timedelta
    return current + timedelta(days=days)


async def process_due_recurring_transactions(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(models.RecurringTransaction).where(
            models.RecurringTransaction.is_active == True,  # noqa: E712
            models.RecurringTransaction.next_run_date <= now,
        )
    )
    due = res.scalars().all()
    created = 0
    for rt in due:
        db.add(models.Transaction(
            type=rt.type, amount=rt.amount, category=rt.category,
            description=f"{rt.description or ''} (recurrente)".strip(),
            reference=f"recurring:{rt.id}",
        ))
        next_run = rt.next_run_date
        while next_run <= now:
            next_run = _advance_next_run(next_run, rt.frequency)
        rt.next_run_date = next_run
        created += 1
    if created:
        await db.commit()
    return created


# --- Pagos programados (CXC/CXP a futuro) --------------------------------------

async def get_scheduled_payments(db: AsyncSession, status: Optional[str] = None) -> List[models.ScheduledPayment]:
    query = select(models.ScheduledPayment).order_by(models.ScheduledPayment.scheduled_date)
    if status:
        query = query.where(models.ScheduledPayment.status == status)
    res = await db.execute(query)
    return res.scalars().all()


async def create_scheduled_payment(
    db: AsyncSession, data: schemas.ScheduledPaymentCreate, user_id: Optional[int] = None
) -> models.ScheduledPayment:
    sp = models.ScheduledPayment(**data.model_dump(), created_by_id=user_id)
    db.add(sp)
    await db.commit()
    await db.refresh(sp)
    await _log_audit(db, user_id, "SCHEDULE_PAYMENT", f"Pago programado de {sp.amount} ({sp.kind} #{sp.target_id}) para {sp.scheduled_date}", {"id": sp.id})
    return sp


async def cancel_scheduled_payment(db: AsyncSession, sp_id: int, user_id: Optional[int] = None) -> Optional[models.ScheduledPayment]:
    res = await db.execute(select(models.ScheduledPayment).where(models.ScheduledPayment.id == sp_id))
    sp = res.scalars().first()
    if not sp:
        return None
    if sp.status == "pending":
        sp.status = "cancelled"
        await db.commit()
        await db.refresh(sp)
        await _log_audit(db, user_id, "CANCEL_SCHEDULED_PAYMENT", f"Pago programado #{sp_id} cancelado", {"id": sp_id})
    return sp


async def process_due_scheduled_payments(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(models.ScheduledPayment).where(
            models.ScheduledPayment.status == "pending",
            models.ScheduledPayment.scheduled_date <= now,
        )
    )
    due = res.scalars().all()
    processed = 0
    for sp in due:
        pay_in = schemas.PayDebtRequest(amount=sp.amount, method=sp.method, reference=sp.reference, note=sp.note)
        try:
            if sp.kind == "cxc":
                result = await pay_cxc(db, sp.target_id, pay_in, user_id=sp.created_by_id)
            else:
                result = await pay_cxp(db, sp.target_id, pay_in, user_id=sp.created_by_id)
            if not result:
                raise ValueError("No se encontró el registro a pagar (¿fue eliminado?).")
            sp.status = "paid"
        except Exception as exc:
            sp.status = "failed"
            sp.error = str(exc)
        processed += 1
    if processed:
        await db.commit()
    return processed


# --- Reportes P&L y comparativo de periodos -------------------------------------

async def get_pnl_report(db: AsyncSession, period_start: datetime, period_end: datetime) -> schemas.PnLReport:
    res = await db.execute(
        select(models.Transaction.category, models.Transaction.type, func.coalesce(func.sum(models.Transaction.amount), 0.0))
        .where(models.Transaction.created_at >= period_start, models.Transaction.created_at <= period_end)
        .group_by(models.Transaction.category, models.Transaction.type)
    )
    income_by_cat = []
    expenses_by_cat = []
    total_income = 0.0
    total_expenses = 0.0
    for cat, ttype, total in res.all():
        amount = _r(total)
        if ttype == "income":
            total_income += amount
            income_by_cat.append(schemas.PnLCategory(category=cat or "sin categoría", amount=amount))
        else:
            total_expenses += amount
            expenses_by_cat.append(schemas.PnLCategory(category=cat or "sin categoría", amount=amount))

    return schemas.PnLReport(
        period_start=period_start, period_end=period_end,
        total_income=_r(total_income), total_expenses=_r(total_expenses),
        net_profit=_r(total_income - total_expenses),
        income_by_category=income_by_cat, expenses_by_category=expenses_by_cat,
    )


def _pct_change(curr: float, prev: float) -> Optional[float]:
    if prev == 0:
        return None
    return _r((curr - prev) / abs(prev) * 100)


async def get_period_comparison(db: AsyncSession, period_start: datetime, period_end: datetime) -> schemas.PeriodComparison:
    from datetime import timedelta
    duration = period_end - period_start
    prev_end = period_start - timedelta(seconds=1)
    prev_start = prev_end - duration

    current = await get_pnl_report(db, period_start, period_end)
    previous = await get_pnl_report(db, prev_start, prev_end)

    return schemas.PeriodComparison(
        current=current, previous=previous,
        income_change_pct=_pct_change(current.total_income, previous.total_income),
        expenses_change_pct=_pct_change(current.total_expenses, previous.total_expenses),
        net_change_pct=_pct_change(current.net_profit, previous.net_profit),
    )


async def get_finance_audit_logs(db: AsyncSession, skip: int = 0, limit: int = 100):
    from app.modules.core_config.service import get_audit_logs
    return await get_audit_logs(db, skip=skip, limit=limit, module="finance")


def generate_pnl_pdf(report: schemas.PnLReport) -> bytes:
    from io import BytesIO
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter
    y = height - 50

    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "Estado de Resultados (P&L)")
    y -= 25
    c.setFont("Helvetica", 10)
    c.drawString(40, y, f"Periodo: {report.period_start.strftime('%Y-%m-%d')} a {report.period_end.strftime('%Y-%m-%d')}")
    y -= 30

    c.setFont("Helvetica-Bold", 12)
    c.drawString(40, y, f"Ingresos totales: ${report.total_income:,.2f}")
    y -= 18
    c.drawString(40, y, f"Gastos totales: ${report.total_expenses:,.2f}")
    y -= 18
    c.drawString(40, y, f"Utilidad neta: ${report.net_profit:,.2f}")
    y -= 30

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Ingresos por categoría")
    y -= 16
    c.setFont("Helvetica", 10)
    for item in report.income_by_category:
        c.drawString(50, y, f"{item.category}: ${item.amount:,.2f}")
        y -= 14
        if y < 60:
            c.showPage()
            y = height - 50

    y -= 10
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, y, "Gastos por categoría")
    y -= 16
    c.setFont("Helvetica", 10)
    for item in report.expenses_by_category:
        c.drawString(50, y, f"{item.category}: ${item.amount:,.2f}")
        y -= 14
        if y < 60:
            c.showPage()
            y = height - 50

    c.showPage()
    c.save()
    return buf.getvalue()
