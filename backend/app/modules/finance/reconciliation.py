"""Conciliación bancaria — importar extracto y matching automático.

Flujo:
  1. Usuario sube el CSV/XLSX del banco.
  2. Parser detecta columnas por sinónimos (fecha/concepto/cargo/abono/monto).
  3. Cada fila crea (o localiza) un `BankTransaction`.
  4. Se busca match automático contra `Transaction` (income/expense) del
     sistema por fecha (±3 días) + monto exacto.
  5. Se marca `reconciled=True` en las matcheadas.
  6. Se reporta resumen: importadas / matcheadas / sin match / duplicadas.

Formato mínimo del CSV/XLSX:
  Fecha, Concepto, Cargo, Abono
    ó
  Fecha, Descripción, Monto (positivo=abono, negativo=cargo)
"""
from __future__ import annotations
import io, csv
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_

from app.modules.finance import models as fin_models


COLUMN_ALIASES = {
    "date":        ("fecha", "date", "fecha operacion", "fecha operación", "f.oper", "fecha_valor"),
    "description": ("concepto", "descripcion", "descripción", "detalle", "referencia", "movimiento", "description"),
    "debit":       ("cargo", "cargos", "debe", "debit", "salida", "retiro"),
    "credit":      ("abono", "abonos", "haber", "credit", "entrada", "deposito", "depósito"),
    "amount":      ("monto", "importe", "amount"),
    "ref":         ("folio", "ref", "referencia banco", "id operacion", "id operación"),
}


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _find_col(headers: list[str], keys: tuple[str, ...]) -> Optional[int]:
    for i, h in enumerate(headers):
        if _norm(h) in keys:
            return i
    return None


def _to_float(v) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(str(v).replace(",", "").replace("$", "").strip() or 0.0)
    except Exception:
        return 0.0


def _to_date(v) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    s = str(v).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _parse_csv(file_bytes: bytes) -> list[dict]:
    """Retorna lista de dicts {date, description, amount, ref}. amount>0=abono, <0=cargo."""
    text = file_bytes.decode("utf-8", errors="replace")
    # Detectar delimitador
    sample = text[:1024]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    if not rows:
        return []
    headers = rows[0]
    col_date = _find_col(headers, COLUMN_ALIASES["date"])
    col_desc = _find_col(headers, COLUMN_ALIASES["description"])
    col_debit = _find_col(headers, COLUMN_ALIASES["debit"])
    col_credit = _find_col(headers, COLUMN_ALIASES["credit"])
    col_amount = _find_col(headers, COLUMN_ALIASES["amount"])
    col_ref = _find_col(headers, COLUMN_ALIASES["ref"])
    if col_date is None:
        raise ValueError("El CSV no tiene columna de fecha reconocible (Fecha, Date, etc.)")
    if col_debit is None and col_credit is None and col_amount is None:
        raise ValueError("El CSV no tiene columnas de importe (Cargo/Abono o Monto)")

    out: list[dict] = []
    for r in rows[1:]:
        if not r or all((c or "").strip() == "" for c in r):
            continue
        get = lambda i: (r[i] if (i is not None and i < len(r)) else None)
        date = _to_date(get(col_date))
        if not date:
            continue
        amt = 0.0
        if col_debit is not None and _to_float(get(col_debit)) > 0:
            amt = -_to_float(get(col_debit))
        elif col_credit is not None and _to_float(get(col_credit)) > 0:
            amt = _to_float(get(col_credit))
        elif col_amount is not None:
            amt = _to_float(get(col_amount))
        if amt == 0.0:
            continue
        out.append({
            "date": date,
            "description": (get(col_desc) or "").strip(),
            "amount": amt,
            "ref": (get(col_ref) or "").strip() or None,
        })
    return out


def _parse_xlsx(file_bytes: bytes) -> list[dict]:
    """Igual que _parse_csv pero para xlsx."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(c or "") for c in rows[0]]
    # Mismo mapeo
    col_date = _find_col(headers, COLUMN_ALIASES["date"])
    col_desc = _find_col(headers, COLUMN_ALIASES["description"])
    col_debit = _find_col(headers, COLUMN_ALIASES["debit"])
    col_credit = _find_col(headers, COLUMN_ALIASES["credit"])
    col_amount = _find_col(headers, COLUMN_ALIASES["amount"])
    col_ref = _find_col(headers, COLUMN_ALIASES["ref"])
    if col_date is None:
        raise ValueError("El XLSX no tiene columna de fecha reconocible")
    out: list[dict] = []
    for r in rows[1:]:
        if not r or all(c is None for c in r):
            continue
        get = lambda i: (r[i] if (i is not None and i < len(r)) else None)
        date = _to_date(get(col_date))
        if not date:
            continue
        amt = 0.0
        if col_debit is not None and _to_float(get(col_debit)) > 0:
            amt = -_to_float(get(col_debit))
        elif col_credit is not None and _to_float(get(col_credit)) > 0:
            amt = _to_float(get(col_credit))
        elif col_amount is not None:
            amt = _to_float(get(col_amount))
        if amt == 0.0:
            continue
        out.append({
            "date": date,
            "description": str(get(col_desc) or "").strip(),
            "amount": amt,
            "ref": str(get(col_ref) or "").strip() or None,
        })
    return out


async def import_statement(
    db: AsyncSession, bank_account_id: int, file_bytes: bytes,
    filename: str, match_window_days: int = 3,
) -> dict:
    """Importa extracto bancario y hace matching automático.

    Retorna {imported, matched, unmatched, duplicated, details[...]}.
    """
    account = await db.get(fin_models.BankAccount, bank_account_id)
    if not account:
        raise ValueError("Cuenta bancaria no encontrada")

    fname_lower = filename.lower()
    if fname_lower.endswith(".xlsx") or fname_lower.endswith(".xls"):
        rows = _parse_xlsx(file_bytes)
    else:
        rows = _parse_csv(file_bytes)

    if not rows:
        return {"imported": 0, "matched": 0, "unmatched": 0, "duplicated": 0,
                "details": [], "error": "No se detectaron movimientos en el archivo"}

    # Pre-cargar transacciones del sistema en el rango del extracto para matching
    min_date = min(r["date"] for r in rows) - timedelta(days=match_window_days)
    max_date = max(r["date"] for r in rows) + timedelta(days=match_window_days)
    res_tx = await db.execute(
        select(fin_models.Transaction).where(
            fin_models.Transaction.created_at >= min_date,
            fin_models.Transaction.created_at <= max_date,
        )
    )
    system_txs = list(res_tx.scalars().all())

    matched_ids: set[int] = set()  # ya usados
    imported = 0; matched = 0; unmatched = 0; duplicated = 0
    details: list[dict] = []

    for row in rows:
        ext_ref = row["ref"] or f"{row['date'].strftime('%Y%m%d')}_{int(row['amount']*100)}_{(row['description'] or '')[:20]}"
        # ¿Ya importado antes?
        dup = (await db.execute(
            select(fin_models.BankTransaction).where(
                fin_models.BankTransaction.bank_account_id == bank_account_id,
                fin_models.BankTransaction.external_ref == ext_ref,
            )
        )).scalars().first()
        if dup:
            duplicated += 1
            details.append({"status": "duplicated", "date": row["date"].isoformat(),
                            "amount": row["amount"], "desc": row["description"]})
            continue

        tx_type = "deposit" if row["amount"] > 0 else "withdrawal"
        bt = fin_models.BankTransaction(
            bank_account_id=bank_account_id,
            type=tx_type, amount=abs(row["amount"]),
            description=row["description"] or None,
            reference=row["ref"], reconciled=False,
            bank_date=row["date"], source=f"import:{account.bank or 'bank'}",
            external_ref=ext_ref,
        )
        # Match: mismo signo (income vs deposit; expense vs withdrawal) + monto exacto + ±window
        target_type = "income" if row["amount"] > 0 else "expense"
        target_amount = round(abs(row["amount"]), 2)
        best = None
        for t in system_txs:
            if t.id in matched_ids:
                continue
            if t.type != target_type:
                continue
            if round(t.amount or 0, 2) != target_amount:
                continue
            # Ventana de fechas
            t_date = t.created_at
            if t_date.tzinfo is None:
                t_date = t_date.replace(tzinfo=timezone.utc)
            if abs((t_date - row["date"]).days) <= match_window_days:
                best = t
                break
        if best:
            bt.reconciled = True
            bt.matched_transaction_id = best.id
            matched_ids.add(best.id)
            matched += 1
            details.append({"status": "matched", "date": row["date"].isoformat(),
                            "amount": row["amount"], "desc": row["description"],
                            "matched_tx_id": best.id})
        else:
            unmatched += 1
            details.append({"status": "unmatched", "date": row["date"].isoformat(),
                            "amount": row["amount"], "desc": row["description"]})
        db.add(bt)
        imported += 1

    await db.commit()
    return {
        "imported": imported, "matched": matched,
        "unmatched": unmatched, "duplicated": duplicated,
        "match_rate": round(matched / imported * 100, 1) if imported > 0 else 0.0,
        "details": details[:100],
    }
