"""Lógica de Contabilidad — Fase 1: catálogo, pólizas (partida doble) y mayor."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.accounting import models, schemas


def _r(x) -> float:
    return round(float(x or 0.0), 2)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Catálogo base (estándar mexicano, código agrupador SAT — editable) ────────
# Cada fila: (code, name, account_type, nature, sat_code, is_postable, parent_code)
DEFAULT_CHART = [
    # ACTIVO
    ("1000", "ACTIVO", "activo", "deudora", None, False, None),
    ("1100", "Activo circulante", "activo", "deudora", None, False, "1000"),
    ("1101", "Caja", "activo", "deudora", "100", True, "1100"),
    ("1102", "Bancos", "activo", "deudora", "102", True, "1100"),
    ("1103", "Clientes", "activo", "deudora", "105", True, "1100"),
    ("1104", "Deudores diversos", "activo", "deudora", "107", True, "1100"),
    ("1105", "IVA acreditable pagado", "activo", "deudora", "118", True, "1100"),
    ("1106", "IVA acreditable pendiente de pago", "activo", "deudora", "119", True, "1100"),
    ("1107", "Inventarios", "activo", "deudora", "115", True, "1100"),
    ("1108", "Anticipo a proveedores", "activo", "deudora", "113", True, "1100"),
    ("1200", "Activo fijo", "activo", "deudora", None, False, "1000"),
    ("1201", "Mobiliario y equipo de oficina", "activo", "deudora", "154", True, "1200"),
    ("1202", "Equipo de cómputo", "activo", "deudora", "157", True, "1200"),
    ("1203", "Equipo de transporte", "activo", "deudora", "155", True, "1200"),
    ("1204", "Depreciación acumulada", "activo", "acreedora", "172", True, "1200"),
    # PASIVO
    ("2000", "PASIVO", "pasivo", "acreedora", None, False, None),
    ("2100", "Pasivo a corto plazo", "pasivo", "acreedora", None, False, "2000"),
    ("2101", "Proveedores", "pasivo", "acreedora", "201", True, "2100"),
    ("2102", "Acreedores diversos", "pasivo", "acreedora", "205", True, "2100"),
    ("2103", "IVA trasladado cobrado", "pasivo", "acreedora", "213", True, "2100"),
    ("2104", "IVA trasladado pendiente de cobro", "pasivo", "acreedora", "214", True, "2100"),
    ("2105", "Impuestos por pagar", "pasivo", "acreedora", "216", True, "2100"),
    ("2106", "Impuestos retenidos por pagar", "pasivo", "acreedora", "219", True, "2100"),
    ("2107", "Anticipo de clientes", "pasivo", "acreedora", "209", True, "2100"),
    # CAPITAL
    ("3000", "CAPITAL", "capital", "acreedora", None, False, None),
    ("3101", "Capital social", "capital", "acreedora", "301", True, "3000"),
    ("3102", "Resultado de ejercicios anteriores", "capital", "acreedora", "314", True, "3000"),
    ("3103", "Resultado del ejercicio", "capital", "acreedora", "315", True, "3000"),
    # INGRESOS
    ("4000", "INGRESOS", "ingreso", "acreedora", None, False, None),
    ("4101", "Ventas y/o servicios", "ingreso", "acreedora", "401", True, "4000"),
    ("4102", "Devoluciones y descuentos sobre ventas", "ingreso", "deudora", "404", True, "4000"),
    ("4103", "Productos financieros", "ingreso", "acreedora", "702", True, "4000"),
    ("4104", "Otros ingresos", "ingreso", "acreedora", "751", True, "4000"),
    # COSTOS
    ("5000", "COSTOS", "costo", "deudora", None, False, None),
    ("5101", "Costo de ventas", "costo", "deudora", "501", True, "5000"),
    # GASTOS
    ("6000", "GASTOS", "gasto", "deudora", None, False, None),
    ("6101", "Gastos de administración", "gasto", "deudora", "601", True, "6000"),
    ("6102", "Gastos de venta", "gasto", "deudora", "601", True, "6000"),
    ("6103", "Gastos financieros", "gasto", "deudora", "701", True, "6000"),
    ("6104", "Otros gastos", "gasto", "deudora", "750", True, "6000"),
]


async def seed_default_chart(db: AsyncSession) -> int:
    """Crea el catálogo base si no hay cuentas. Idempotente: si ya existen, no toca."""
    existing = (await db.execute(select(func.count(models.Account.id)))).scalar() or 0
    if existing:
        return 0
    by_code: dict[str, models.Account] = {}
    # Insertar respetando jerarquía (los códigos cortos primero).
    for code, name, atype, nature, sat, postable, parent_code in sorted(DEFAULT_CHART, key=lambda r: len(r[0])):
        level = 1 if parent_code is None else (by_code[parent_code].level + 1)
        acc = models.Account(
            code=code, name=name, account_type=atype, nature=nature, sat_code=sat,
            is_postable=postable, is_active=True, level=level,
            parent_id=by_code[parent_code].id if parent_code else None,
        )
        db.add(acc)
        await db.flush()
        by_code[code] = acc
    await db.commit()
    return len(by_code)


# ── Cuentas ───────────────────────────────────────────────────────────────────

async def list_accounts(db: AsyncSession, only_active: bool = False) -> List[models.Account]:
    stmt = select(models.Account)
    if only_active:
        stmt = stmt.where(models.Account.is_active == True)  # noqa: E712
    stmt = stmt.order_by(models.Account.code)
    return (await db.execute(stmt)).scalars().all()


async def get_account(db: AsyncSession, account_id: int) -> Optional[models.Account]:
    return await db.get(models.Account, account_id)


async def create_account(db: AsyncSession, data: schemas.AccountCreate) -> models.Account:
    existing = (await db.execute(select(models.Account).where(models.Account.code == data.code))).scalars().first()
    if existing:
        raise ValueError(f"Ya existe una cuenta con el número {data.code}")
    level = 1
    if data.parent_id:
        parent = await db.get(models.Account, data.parent_id)
        if not parent:
            raise ValueError("La cuenta padre no existe")
        level = (parent.level or 1) + 1
    acc = models.Account(
        code=data.code, name=data.name, account_type=data.account_type, nature=data.nature,
        parent_id=data.parent_id, sat_code=data.sat_code, is_postable=data.is_postable,
        is_active=data.is_active, level=level,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc


async def update_account(db: AsyncSession, account_id: int, data: schemas.AccountUpdate) -> Optional[models.Account]:
    acc = await db.get(models.Account, account_id)
    if not acc:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(acc, k, v)
    if data.parent_id is not None:
        parent = await db.get(models.Account, data.parent_id) if data.parent_id else None
        acc.level = (parent.level + 1) if parent else 1
    await db.commit()
    await db.refresh(acc)
    return acc


async def delete_account(db: AsyncSession, account_id: int) -> bool:
    acc = await db.get(models.Account, account_id)
    if not acc:
        return False
    has_lines = (await db.execute(
        select(func.count(models.JournalLine.id)).where(models.JournalLine.account_id == account_id)
    )).scalar() or 0
    if has_lines:
        raise ValueError("No se puede eliminar: la cuenta tiene movimientos. Desactívala en su lugar.")
    has_children = (await db.execute(
        select(func.count(models.Account.id)).where(models.Account.parent_id == account_id)
    )).scalar() or 0
    if has_children:
        raise ValueError("No se puede eliminar: la cuenta tiene subcuentas.")
    await db.delete(acc)
    await db.commit()
    return True


# ── Pólizas ───────────────────────────────────────────────────────────────────

async def _generate_folio(db: AsyncSession) -> str:
    n = (await db.execute(select(func.count(models.JournalEntry.id)))).scalar() or 0
    return f"POL-{n + 1:06d}"


def _serialize_entry(e: models.JournalEntry) -> schemas.JournalEntryDetail:
    return schemas.JournalEntryDetail(
        id=e.id, folio=e.folio, date=e.date, entry_type=e.entry_type, concept=e.concept,
        source=e.source, status=e.status, total_debit=e.total_debit, total_credit=e.total_credit,
        branch_id=e.branch_id, user_id=e.user_id, created_at=e.created_at,
        lines=[schemas.JournalLineInDB(
            id=l.id, account_id=l.account_id,
            account_code=(l.account.code if l.account else None),
            account_name=(l.account.name if l.account else None),
            debit=l.debit, credit=l.credit, description=l.description,
        ) for l in e.lines],
    )


async def create_entry(db: AsyncSession, data: schemas.JournalEntryCreate,
                       user_id: Optional[int] = None, branch_id: Optional[int] = None) -> schemas.JournalEntryDetail:
    # Validar partidas
    total_debit = _r(sum(l.debit for l in data.lines))
    total_credit = _r(sum(l.credit for l in data.lines))
    if total_debit <= 0:
        raise ValueError("La póliza no tiene importes.")
    if total_debit != total_credit:
        raise ValueError(f"La póliza no cuadra: cargos ${total_debit:,.2f} vs abonos ${total_credit:,.2f} (deben ser iguales)")
    # Validar cuentas
    acc_ids = {l.account_id for l in data.lines}
    accounts = {a.id: a for a in (await db.execute(
        select(models.Account).where(models.Account.id.in_(acc_ids))
    )).scalars().all()}
    for l in data.lines:
        if (l.debit or 0) > 0 and (l.credit or 0) > 0:
            raise ValueError("Cada partida debe ser cargo O abono, no ambos.")
        if (l.debit or 0) == 0 and (l.credit or 0) == 0:
            raise ValueError("Hay una partida sin importe.")
        acc = accounts.get(l.account_id)
        if not acc:
            raise ValueError(f"Cuenta {l.account_id} no existe.")
        if not acc.is_postable:
            raise ValueError(f"La cuenta {acc.code} {acc.name} es agrupadora; usa una cuenta de detalle.")
        if not acc.is_active:
            raise ValueError(f"La cuenta {acc.code} {acc.name} está inactiva.")

    entry = models.JournalEntry(
        folio=await _generate_folio(db),
        date=data.date or _now(), entry_type=data.entry_type, concept=data.concept,
        source="manual", status="posted", total_debit=total_debit, total_credit=total_credit,
        branch_id=branch_id, user_id=user_id,
    )
    db.add(entry)
    await db.flush()
    for l in data.lines:
        db.add(models.JournalLine(
            entry_id=entry.id, account_id=l.account_id,
            debit=_r(l.debit), credit=_r(l.credit), description=l.description,
        ))
    await db.commit()
    return await get_entry(db, entry.id)


async def get_entry(db: AsyncSession, entry_id: int) -> Optional[schemas.JournalEntryDetail]:
    e = (await db.execute(
        select(models.JournalEntry).where(models.JournalEntry.id == entry_id)
        .options(selectinload(models.JournalEntry.lines).selectinload(models.JournalLine.account))
    )).scalars().first()
    return _serialize_entry(e) if e else None


async def list_entries(db: AsyncSession, *, skip: int = 0, limit: int = 100,
                       status: Optional[str] = None, entry_type: Optional[str] = None,
                       date_from: Optional[datetime] = None, date_to: Optional[datetime] = None
                       ) -> List[schemas.JournalEntryInDB]:
    stmt = select(models.JournalEntry)
    if status:
        stmt = stmt.where(models.JournalEntry.status == status)
    if entry_type:
        stmt = stmt.where(models.JournalEntry.entry_type == entry_type)
    if date_from:
        stmt = stmt.where(models.JournalEntry.date >= date_from)
    if date_to:
        stmt = stmt.where(models.JournalEntry.date <= date_to)
    stmt = stmt.order_by(models.JournalEntry.date.desc(), models.JournalEntry.id.desc()).offset(skip).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [schemas.JournalEntryInDB.model_validate(r) for r in rows]


async def cancel_entry(db: AsyncSession, entry_id: int) -> Optional[schemas.JournalEntryDetail]:
    e = await db.get(models.JournalEntry, entry_id)
    if not e:
        return None
    if e.status != "cancelled":
        e.status = "cancelled"
        e.cancelled_at = _now()
        await db.commit()
    return await get_entry(db, entry_id)


# ── Mayor / auxiliar ──────────────────────────────────────────────────────────

async def ledger(db: AsyncSession, account_id: int, *, date_from: Optional[datetime] = None,
                 date_to: Optional[datetime] = None) -> Optional[schemas.LedgerReport]:
    acc = await db.get(models.Account, account_id)
    if not acc:
        return None
    deudora = acc.nature == "deudora"

    def saldo(debit: float, credit: float) -> float:
        return _r((debit - credit) if deudora else (credit - debit))

    # Saldo inicial: movimientos contabilizados antes de date_from
    opening = 0.0
    if date_from:
        op = (await db.execute(
            select(func.coalesce(func.sum(models.JournalLine.debit), 0.0),
                   func.coalesce(func.sum(models.JournalLine.credit), 0.0))
            .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
            .where(models.JournalLine.account_id == account_id,
                   models.JournalEntry.status == "posted",
                   models.JournalEntry.date < date_from)
        )).one()
        opening = saldo(op[0], op[1])

    # Movimientos del periodo
    stmt = (
        select(models.JournalLine, models.JournalEntry)
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .where(models.JournalLine.account_id == account_id, models.JournalEntry.status == "posted")
    )
    if date_from:
        stmt = stmt.where(models.JournalEntry.date >= date_from)
    if date_to:
        stmt = stmt.where(models.JournalEntry.date <= date_to)
    stmt = stmt.order_by(models.JournalEntry.date, models.JournalEntry.id)
    rows = (await db.execute(stmt)).all()

    running = opening
    total_debit = 0.0
    total_credit = 0.0
    movements: List[schemas.LedgerMovement] = []
    for line, entry in rows:
        running = _r(running + (saldo(line.debit, line.credit)))
        total_debit = _r(total_debit + (line.debit or 0))
        total_credit = _r(total_credit + (line.credit or 0))
        movements.append(schemas.LedgerMovement(
            entry_id=entry.id, folio=entry.folio, date=entry.date, concept=entry.concept,
            debit=_r(line.debit), credit=_r(line.credit), balance=running,
        ))

    return schemas.LedgerReport(
        account_id=acc.id, account_code=acc.code, account_name=acc.name, nature=acc.nature,
        opening_balance=_r(opening), total_debit=total_debit, total_credit=total_credit,
        closing_balance=_r(running), movements=movements,
    )


# ── Estados financieros (Fase 2) ──────────────────────────────────────────────
# Naturaleza normal por SECCIÓN (tipo de cuenta) para agregar estados: las cuentas
# de contra (p. ej. Depreciación acumulada en activo, Devoluciones en ingresos) se
# netean solas porque su saldo queda con signo contrario dentro de su sección.
SECTION_NORMAL = {"activo": "d", "pasivo": "c", "capital": "c",
                  "ingreso": "c", "costo": "d", "gasto": "d", "orden": "d"}


def _section_amount(account_type: str, debit: float, credit: float) -> float:
    return (debit - credit) if SECTION_NORMAL.get(account_type, "d") == "d" else (credit - debit)


def _eod(d: Optional[datetime]) -> Optional[datetime]:
    """Fin de día exclusivo: para incluir las pólizas del propio día 'hasta'."""
    return (d + timedelta(days=1)) if d else None


async def _account_sums(db: AsyncSession, *, lt: Optional[datetime] = None,
                        gte: Optional[datetime] = None) -> dict:
    """{account_id: (suma_cargos, suma_abonos)} de pólizas contabilizadas."""
    stmt = (
        select(models.JournalLine.account_id,
               func.coalesce(func.sum(models.JournalLine.debit), 0.0),
               func.coalesce(func.sum(models.JournalLine.credit), 0.0))
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .where(models.JournalEntry.status == "posted")
    )
    if lt is not None:
        stmt = stmt.where(models.JournalEntry.date < lt)
    if gte is not None:
        stmt = stmt.where(models.JournalEntry.date >= gte)
    stmt = stmt.group_by(models.JournalLine.account_id)
    return {r[0]: (float(r[1] or 0.0), float(r[2] or 0.0)) for r in (await db.execute(stmt)).all()}


async def trial_balance(db: AsyncSession, date_from: Optional[datetime] = None,
                        date_to: Optional[datetime] = None) -> schemas.TrialBalance:
    accounts = await list_accounts(db)
    by_id = {a.id: a for a in accounts}
    opening = await _account_sums(db, lt=date_from) if date_from else {}
    period = await _account_sums(db, gte=date_from, lt=_eod(date_to))

    od, oc, pd_, pc = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
    for a in accounts:
        if not a.is_postable:
            continue
        o = opening.get(a.id, (0.0, 0.0))
        p = period.get(a.id, (0.0, 0.0))
        node = a
        while node is not None:  # acumular en la cuenta y sus padres (subtotales)
            od[node.id] += o[0]; oc[node.id] += o[1]; pd_[node.id] += p[0]; pc[node.id] += p[1]
            node = by_id.get(node.parent_id)

    rows, tot_cargos, tot_abonos = [], 0.0, 0.0
    for a in sorted(accounts, key=lambda x: x.code):
        o_d, o_c, p_d, p_c = od[a.id], oc[a.id], pd_[a.id], pc[a.id]
        if round(o_d + o_c + p_d + p_c, 2) == 0:
            continue
        deudora = a.nature == "deudora"
        si = _r((o_d - o_c) if deudora else (o_c - o_d))
        sf = _r(((o_d + p_d) - (o_c + p_c)) if deudora else ((o_c + p_c) - (o_d + p_d)))
        rows.append(schemas.TrialBalanceRow(
            account_id=a.id, code=a.code, name=a.name, level=a.level, is_postable=a.is_postable,
            nature=a.nature, saldo_inicial=si, cargos=_r(p_d), abonos=_r(p_c), saldo_final=sf,
        ))
        if a.is_postable:
            tot_cargos += p_d; tot_abonos += p_c
    return schemas.TrialBalance(date_from=date_from, date_to=date_to, rows=rows,
                                total_cargos=_r(tot_cargos), total_abonos=_r(tot_abonos))


async def balance_sheet(db: AsyncSession, as_of: Optional[datetime] = None) -> schemas.BalanceSheet:
    accounts = await list_accounts(db)
    closing = await _account_sums(db, lt=_eod(as_of)) if as_of else await _account_sums(db)

    activo, pasivo, capital = [], [], []
    tot_a = tot_p = tot_c = tot_ing = tot_cos = tot_gas = 0.0
    for a in sorted(accounts, key=lambda x: x.code):
        if not a.is_postable:
            continue
        d, c = closing.get(a.id, (0.0, 0.0))
        amt = _r(_section_amount(a.account_type, d, c))
        line = schemas.ReportLine(account_id=a.id, code=a.code, name=a.name, level=a.level, amount=amt)
        if a.account_type == "activo":
            tot_a += amt
            if amt != 0: activo.append(line)
        elif a.account_type == "pasivo":
            tot_p += amt
            if amt != 0: pasivo.append(line)
        elif a.account_type == "capital":
            tot_c += amt
            if amt != 0: capital.append(line)
        elif a.account_type == "ingreso":
            tot_ing += amt
        elif a.account_type == "costo":
            tot_cos += amt
        elif a.account_type == "gasto":
            tot_gas += amt

    resultado = _r(tot_ing - tot_cos - tot_gas)
    total_capital = _r(tot_c + resultado)
    total_activo, total_pasivo = _r(tot_a), _r(tot_p)
    diff = _r(total_activo - (total_pasivo + total_capital))
    return schemas.BalanceSheet(
        as_of=as_of, activo=activo, total_activo=total_activo, pasivo=pasivo, total_pasivo=total_pasivo,
        capital=capital, resultado_ejercicio=resultado, total_capital=total_capital,
        balanced=abs(diff) < 0.01, difference=diff,
    )


async def income_statement(db: AsyncSession, date_from: Optional[datetime] = None,
                           date_to: Optional[datetime] = None) -> schemas.IncomeStatement:
    accounts = await list_accounts(db)
    period = await _account_sums(db, gte=date_from, lt=_eod(date_to))

    ingresos, costos, gastos = [], [], []
    tot_ing = tot_cos = tot_gas = 0.0
    for a in sorted(accounts, key=lambda x: x.code):
        if not a.is_postable:
            continue
        d, c = period.get(a.id, (0.0, 0.0))
        amt = _r(_section_amount(a.account_type, d, c))
        if amt == 0:
            continue
        line = schemas.ReportLine(account_id=a.id, code=a.code, name=a.name, level=a.level, amount=amt)
        if a.account_type == "ingreso":
            ingresos.append(line); tot_ing += amt
        elif a.account_type == "costo":
            costos.append(line); tot_cos += amt
        elif a.account_type == "gasto":
            gastos.append(line); tot_gas += amt

    utilidad_bruta = _r(tot_ing - tot_cos)
    utilidad_neta = _r(tot_ing - tot_cos - tot_gas)
    return schemas.IncomeStatement(
        date_from=date_from, date_to=date_to, ingresos=ingresos, total_ingresos=_r(tot_ing),
        costos=costos, total_costos=_r(tot_cos), gastos=gastos, total_gastos=_r(tot_gas),
        utilidad_bruta=utilidad_bruta, utilidad_neta=utilidad_neta,
    )
