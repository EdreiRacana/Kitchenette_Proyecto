"""Lógica de Contabilidad — Fase 1: catálogo, pólizas (partida doble) y mayor."""
from __future__ import annotations

import json
from calendar import monthrange
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
    # Validar período cerrado — no permitir pólizas en meses ya cerrados
    entry_date = data.date or _now()
    period_res = await db.execute(
        select(models.PeriodClose).where(
            models.PeriodClose.year == entry_date.year,
            models.PeriodClose.month == entry_date.month,
            models.PeriodClose.status == "closed",
        )
    )
    if period_res.scalars().first():
        raise ValueError(
            f"El período {entry_date.year}-{entry_date.month:02d} está cerrado. "
            f"Reábrelo desde Contabilidad → Cierres si necesitas editarlo."
        )
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


# ── Pólizas automáticas (Fase 3): mapeo de cuentas + generación desde operación ─
ROLE_DEFAULTS = {
    "bank": "1102", "cash": "1101", "clients": "1103", "sales": "4101",
    "iva_trasladado": "2103", "iva_trasladado_pending": "2104",
    "iva_acreditable": "1105", "iva_acreditable_pending": "1106",
    "suppliers": "2101", "inventory": "1107", "cogs": "5101", "expenses": "6101",
    "payroll_payable": "2102", "taxes_withheld": "2106",
    # Diferencia cambiaria (política #8)
    "fx_gain": "4103", "fx_loss": "6103",
}
ROLE_LABELS = {
    "bank": "Bancos (cobros/pagos)", "cash": "Caja", "clients": "Clientes", "sales": "Ventas",
    "iva_trasladado": "IVA trasladado (cobrado)",
    "iva_trasladado_pending": "IVA trasladado pendiente de cobro",
    "iva_acreditable": "IVA acreditable (pagado)",
    "iva_acreditable_pending": "IVA acreditable pendiente de pago",
    "suppliers": "Proveedores", "inventory": "Inventarios", "cogs": "Costo de ventas",
    "expenses": "Gastos", "payroll_payable": "Sueldos por pagar", "taxes_withheld": "Impuestos retenidos",
    "fx_gain": "Ganancia cambiaria", "fx_loss": "Pérdida cambiaria",
}
ROLE_ORDER = ["bank", "cash", "clients", "sales", "iva_trasladado", "iva_trasladado_pending",
              "iva_acreditable", "iva_acreditable_pending", "suppliers", "inventory", "cogs",
              "expenses", "payroll_payable", "taxes_withheld", "fx_gain", "fx_loss"]


async def get_account_map(db: AsyncSession) -> dict:
    rows = (await db.execute(select(models.AccountMap))).scalars().all()
    return {r.role: r.account_id for r in rows if r.account_id}


async def ensure_default_map(db: AsyncSession) -> int:
    """Crea los mapeos faltantes apuntando a las cuentas del catálogo base por su
    número. Idempotente: no pisa lo que ya esté configurado."""
    existing = {r.role for r in (await db.execute(select(models.AccountMap))).scalars().all()}
    by_code = {a.code: a.id for a in await list_accounts(db)}
    created = 0
    for role, code in ROLE_DEFAULTS.items():
        if role in existing:
            continue
        db.add(models.AccountMap(role=role, account_id=by_code.get(code)))
        created += 1
    if created:
        await db.commit()
    return created


async def set_account_map(db: AsyncSession, mapping: dict) -> None:
    rows = {r.role: r for r in (await db.execute(select(models.AccountMap))).scalars().all()}
    for role, acc_id in mapping.items():
        if role in rows:
            rows[role].account_id = acc_id
        else:
            db.add(models.AccountMap(role=role, account_id=acc_id))
    await db.commit()


async def list_account_map(db: AsyncSession) -> List[schemas.AccountMapItem]:
    current = {r.role: r.account_id for r in (await db.execute(select(models.AccountMap))).scalars().all()}
    by_id = {a.id: a for a in await list_accounts(db)}
    out = []
    for role in ROLE_ORDER:
        acc_id = current.get(role)
        acc = by_id.get(acc_id) if acc_id else None
        out.append(schemas.AccountMapItem(
            role=role, label=ROLE_LABELS[role], account_id=acc_id,
            account_code=acc.code if acc else None, account_name=acc.name if acc else None,
        ))
    return out


async def _auto_entry(db: AsyncSession, *, source: str, entry_type: str, concept: str,
                      specs: list, branch_id=None, user_id=None) -> None:
    """Crea una póliza automática (NO hace commit; lo hace el flujo anfitrión).
    specs: lista de (account_id, cargo, abono). Idempotente por 'source';
    si no cuadra o falta cuenta, no hace nada (nunca rompe la operación)."""
    if any(s[0] is None for s in specs):
        return
    exists = (await db.execute(
        select(models.JournalEntry.id).where(
            models.JournalEntry.source == source, models.JournalEntry.status != "cancelled")
    )).first()
    if exists:
        return
    td = _r(sum(s[1] for s in specs))
    tc = _r(sum(s[2] for s in specs))
    if td <= 0 or td != tc:
        return
    entry = models.JournalEntry(
        folio=await _generate_folio(db), date=_now(), entry_type=entry_type, concept=concept,
        source=source, status="posted", total_debit=td, total_credit=tc,
        branch_id=branch_id, user_id=user_id,
    )
    db.add(entry)
    await db.flush()
    for acc_id, d, c in specs:
        db.add(models.JournalLine(entry_id=entry.id, account_id=acc_id, debit=_r(d), credit=_r(c)))


async def record_sale(db: AsyncSession, *, order_id: int, total: float, tax: float,
                      concept: str, branch_id=None, user_id=None) -> None:
    """Devengo de la venta: cargo Clientes / abono Ventas (+ IVA trasladado).
    La cuenta de IVA (2103 cobrado directo vs 2104 pendiente de cobro) depende
    de la política contable vigente (#2 iva_trasladado_scheme)."""
    policy = await get_active_policy(db, branch_id=branch_id)
    m = await get_account_map(db)
    clients, sales = m.get("clients"), m.get("sales")
    iva_role = _pick_iva_trasladado_role(policy)
    iva = m.get(iva_role)
    if not clients or not sales:
        return
    total = _r(total)
    tax = _r(tax or 0)
    if total <= 0:
        return
    specs = [(clients, total, 0.0)]
    if iva and tax > 0:
        specs.append((sales, 0.0, _r(total - tax)))
        specs.append((iva, 0.0, tax))
    else:
        specs.append((sales, 0.0, total))
    await _auto_entry(db, source=f"venta:{order_id}", entry_type="ingreso", concept=concept,
                      specs=specs, branch_id=branch_id, user_id=user_id)


async def record_payment(db: AsyncSession, *, order_id: int, paid_cumulative: float,
                         amount: float, concept: str, branch_id=None, user_id=None,
                         tax_portion: float = 0.0) -> None:
    """Cobro: cargo Bancos / abono Clientes.
    Si política #2 = pending_collection, además genera un pase de IVA:
    Cargo IVA trasladado cobrado (2103) / Abono IVA pendiente cobro (2104).
    tax_portion: parte del pago que corresponde a IVA (se calcula upstream).
    """
    policy = await get_active_policy(db, branch_id=branch_id)
    m = await get_account_map(db)
    bank, clients = m.get("bank"), m.get("clients")
    if not bank or not clients:
        return
    amount = _r(amount)
    tax_portion = _r(tax_portion or 0)
    if amount <= 0:
        return
    await _auto_entry(db, source=f"cobro:{order_id}:{_r(paid_cumulative)}", entry_type="ingreso",
                      concept=concept, specs=[(bank, amount, 0.0), (clients, 0.0, amount)],
                      branch_id=branch_id, user_id=user_id)

    # Pase de IVA pendiente → cobrado si aplica
    if policy.iva_trasladado_scheme == "pending_collection" and tax_portion > 0:
        iva_col = m.get("iva_trasladado")
        iva_pend = m.get("iva_trasladado_pending")
        if iva_col and iva_pend:
            await _auto_entry(
                db, source=f"cobro_iva:{order_id}:{_r(paid_cumulative)}", entry_type="diario",
                concept=f"Traslado IVA cobrado — {concept}",
                specs=[(iva_pend, tax_portion, 0.0), (iva_col, 0.0, tax_portion)],
                branch_id=branch_id, user_id=user_id,
            )


async def void_order(db: AsyncSession, *, order_id: int) -> None:
    """Cancela las pólizas automáticas (venta y cobros) de un pedido (NO commit)."""
    res = await db.execute(
        select(models.JournalEntry).where(
            or_(models.JournalEntry.source == f"venta:{order_id}",
                models.JournalEntry.source.like(f"cobro:{order_id}:%")),
            models.JournalEntry.status != "cancelled")
    )
    for e in res.scalars().all():
        e.status = "cancelled"
        e.cancelled_at = _now()


# ── Cierre de período contable ──────────────────────────────────────────

async def is_period_closed(db: AsyncSession, date: datetime) -> bool:
    """Devuelve True si el mes de la fecha dada está cerrado."""
    res = await db.execute(
        select(models.PeriodClose).where(
            models.PeriodClose.year == date.year,
            models.PeriodClose.month == date.month,
            models.PeriodClose.status == "closed",
        )
    )
    return res.scalars().first() is not None


async def list_period_closes(db: AsyncSession) -> list[dict]:
    """Historial de cierres, más recientes primero."""
    res = await db.execute(
        select(models.PeriodClose).order_by(
            models.PeriodClose.year.desc(), models.PeriodClose.month.desc()
        )
    )
    out = []
    for pc in res.scalars().all():
        out.append({
            "id": pc.id,
            "year": pc.year, "month": pc.month,
            "period": f"{pc.year}-{pc.month:02d}",
            "status": pc.status,
            "closed_at": pc.closed_at.isoformat() if pc.closed_at else None,
            "reopened_at": pc.reopened_at.isoformat() if pc.reopened_at else None,
            "closed_by_id": pc.closed_by_id,
            "notes": pc.notes,
        })
    return out


async def close_period(db: AsyncSession, year: int, month: int,
                       user_id: Optional[int] = None, notes: Optional[str] = None) -> dict:
    """Cierra un período mensual.
    - Valida que no esté ya cerrado.
    - Congela: genera snapshot del trial balance del mes.
    - Persiste PeriodClose con snapshot_json.
    """
    if month < 1 or month > 12:
        raise ValueError("Mes inválido")
    # ¿Ya cerrado?
    existing = (await db.execute(
        select(models.PeriodClose).where(
            models.PeriodClose.year == year,
            models.PeriodClose.month == month,
            models.PeriodClose.status == "closed",
        )
    )).scalars().first()
    if existing:
        raise ValueError(f"El período {year}-{month:02d} ya está cerrado")

    # Rango del mes
    period_start = datetime(year, month, 1, tzinfo=timezone.utc)
    _, last_day = monthrange(year, month)
    period_end = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    # Snapshot del trial balance y estado de resultados del mes
    tb = await trial_balance(db, date_from=period_start, date_to=period_end)
    try:
        is_ = await income_statement(db, date_from=period_start, date_to=period_end)
        is_dict = is_.model_dump() if hasattr(is_, "model_dump") else dict(is_)
    except Exception:
        is_dict = None
    try:
        bs = await balance_sheet(db, as_of=period_end)
        bs_dict = bs.model_dump() if hasattr(bs, "model_dump") else dict(bs)
    except Exception:
        bs_dict = None
    snapshot = {
        "period": f"{year}-{month:02d}",
        "trial_balance": tb.model_dump() if hasattr(tb, "model_dump") else None,
        "income_statement": is_dict,
        "balance_sheet": bs_dict,
    }

    pc = models.PeriodClose(
        year=year, month=month, status="closed",
        closed_by_id=user_id, notes=notes,
        snapshot_json=json.dumps(snapshot, default=str),
    )
    db.add(pc)
    await db.commit()
    await db.refresh(pc)
    return {
        "id": pc.id, "year": pc.year, "month": pc.month,
        "period": f"{pc.year}-{pc.month:02d}",
        "status": pc.status, "closed_at": pc.closed_at.isoformat() if pc.closed_at else None,
        "message": f"Período {year}-{month:02d} cerrado exitosamente",
    }


async def reopen_period(db: AsyncSession, year: int, month: int,
                        user_id: Optional[int] = None, reason: Optional[str] = None) -> dict:
    """Reabre un período cerrado (auditable — deja rastro con reopened_at)."""
    pc = (await db.execute(
        select(models.PeriodClose).where(
            models.PeriodClose.year == year,
            models.PeriodClose.month == month,
            models.PeriodClose.status == "closed",
        )
    )).scalars().first()
    if not pc:
        raise ValueError(f"No hay cierre activo para {year}-{month:02d}")
    pc.status = "reopened"
    pc.reopened_at = _now()
    pc.reopened_by_id = user_id
    if reason:
        pc.notes = (pc.notes or "") + f"\n\n[REAPERTURA]: {reason}"
    await db.commit()
    return {"period": f"{year}-{month:02d}", "status": "reopened",
            "reopened_at": pc.reopened_at.isoformat()}


# ═════════════════════════════════════════════════════════════════════════════
# POLÍTICAS CONTABLES — versionadas por effective_from
# ═════════════════════════════════════════════════════════════════════════════
#
# Cada hook automático consulta la política vigente al momento de la operación,
# no la última. Esto garantiza que una venta de junio genere pólizas conforme
# a la política que estaba activa en junio, aunque el contador cambie la
# política en julio.
#
# Tasas de retención por defecto — 2026, LISR/LIVA vigentes. Editables sin
# migración porque viven en la columna JSON `withholding_rates`.
#   - honorarios (persona física servicios profesionales): ISR 10%, IVA 10.6667%
#   - arrendamiento (persona física): ISR 10%, IVA 10.6667%
#   - autotransporte de carga: IVA 4%
#   - fletes (persona moral autotransporte): IVA 4%
DEFAULT_WITHHOLDING_RATES = {
    "honorarios":       {"isr": 10.0,  "iva": 10.6667},
    "arrendamiento":    {"isr": 10.0,  "iva": 10.6667},
    "autotransporte":   {"isr": 0.0,   "iva": 4.0},
    "servicios":        {"isr": 0.0,   "iva": 0.0},        # PM general: sin retención
    "productos":        {"isr": 0.0,   "iva": 0.0},        # PM general: sin retención
}


async def get_active_policy(db: AsyncSession, at_date: Optional[datetime] = None,
                            branch_id: Optional[int] = None) -> models.AccountingPolicy:
    """Devuelve la política vigente al momento `at_date`. Si no hay ninguna,
    crea (y regresa) la política default. NUNCA falla por 'sin config'."""
    at_date = at_date or _now()
    stmt = (
        select(models.AccountingPolicy)
        .where(models.AccountingPolicy.effective_from <= at_date)
        .order_by(models.AccountingPolicy.effective_from.desc(),
                  models.AccountingPolicy.id.desc())
    )
    if branch_id is not None:
        # Prioridad: política de la sucursal → política global (branch_id NULL)
        stmt = stmt.where(
            or_(models.AccountingPolicy.branch_id == branch_id,
                models.AccountingPolicy.branch_id.is_(None))
        )
    else:
        stmt = stmt.where(models.AccountingPolicy.branch_id.is_(None))
    row = (await db.execute(stmt)).scalars().first()
    if row is not None:
        return row
    # Ninguna política registrada — crear default y regresarla
    default = models.AccountingPolicy(
        effective_from=at_date, status="active",
        withholding_rates=DEFAULT_WITHHOLDING_RATES,
    )
    db.add(default)
    await db.flush()
    return default


async def upsert_policy(db: AsyncSession, data: dict, user_id: Optional[int] = None,
                        branch_id: Optional[int] = None) -> models.AccountingPolicy:
    """Guarda una política nueva con `effective_from`. Si ya hay política
    vigente con esa misma fecha, la actualiza in-place; si no, crea nueva y
    marca la anterior como superseded para dejar rastro auditable."""
    effective_from = data.get("effective_from") or _now()
    if isinstance(effective_from, str):
        effective_from = datetime.fromisoformat(effective_from.replace("Z", "+00:00"))
    if effective_from.tzinfo is None:
        effective_from = effective_from.replace(tzinfo=timezone.utc)

    # Bloqueo: no permitir efectivo en un período ya cerrado
    if await is_period_closed(db, effective_from):
        raise ValueError(
            f"No puedes fijar la política vigente en un período ya cerrado "
            f"({effective_from.year}-{effective_from.month:02d}). Elige una fecha posterior."
        )

    # ¿Ya existe una política EXACTAMENTE con esa fecha? → update in-place
    same_day = (await db.execute(
        select(models.AccountingPolicy).where(
            models.AccountingPolicy.effective_from == effective_from,
            models.AccountingPolicy.branch_id == branch_id,
        )
    )).scalars().first()
    target = same_day
    if target is None:
        # Marca la política vigente anterior como superseded
        prev = await get_active_policy(db, effective_from, branch_id)
        if prev.id is not None:  # no marcar el default recién creado in-memory
            prev.status = "superseded"
            prev.superseded_at = _now()
        target = models.AccountingPolicy(
            effective_from=effective_from, status="active",
            branch_id=branch_id, created_by_id=user_id,
        )
        db.add(target)
        if prev.id is not None:
            await db.flush()
            prev.superseded_by_id = target.id

    _POLICY_FIELDS = (
        "iva_acreditable_scheme", "iva_trasladado_scheme", "cogs_scheme",
        "purchase_recognition", "payroll_scheme", "expense_basis",
        "withholding_enabled", "withholding_rates", "fx_scheme",
        "labor_benefits_scheme", "depreciation_scheme", "notes",
    )
    for f in _POLICY_FIELDS:
        if f in data:
            setattr(target, f, data[f])
    if target.withholding_rates is None:
        target.withholding_rates = DEFAULT_WITHHOLDING_RATES

    await db.commit()
    await db.refresh(target)
    return target


async def list_policies(db: AsyncSession, branch_id: Optional[int] = None) -> list:
    """Historial de políticas, más recientes primero. Para auditoría."""
    stmt = select(models.AccountingPolicy).order_by(
        models.AccountingPolicy.effective_from.desc(),
        models.AccountingPolicy.id.desc(),
    )
    if branch_id is not None:
        stmt = stmt.where(
            or_(models.AccountingPolicy.branch_id == branch_id,
                models.AccountingPolicy.branch_id.is_(None))
        )
    return (await db.execute(stmt)).scalars().all()


# ═════════════════════════════════════════════════════════════════════════════
# HOOKS DE POLÍTICAS APLICADAS — record_sale / record_payment ajustadas
# ═════════════════════════════════════════════════════════════════════════════

def _pick_iva_trasladado_role(policy: models.AccountingPolicy) -> str:
    """Devuelve el ROL del AccountMap que corresponde según política #2."""
    if policy.iva_trasladado_scheme == "direct_collected":
        return "iva_trasladado"
    return "iva_trasladado_pending"


def _pick_iva_acreditable_role(policy: models.AccountingPolicy) -> str:
    """Devuelve el ROL del AccountMap que corresponde según política #1."""
    if policy.iva_acreditable_scheme == "direct_paid":
        return "iva_acreditable"
    return "iva_acreditable_pending"


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 3 — Recepción de OC (compra):
#   Cargo: Inventarios (con landed cost)
#   Cargo: IVA acreditable (pendiente o pagado según política #1)
#   Abono: Proveedores
#   [Opcional] Abono: Impuestos retenidos por pagar (si política #7 activa)
# ═════════════════════════════════════════════════════════════════════════════

async def record_purchase_receipt(db: AsyncSession, *, po_id: int,
                                  goods_total: float, tax_total: float,
                                  withholding_isr: float = 0.0,
                                  withholding_iva: float = 0.0,
                                  concept: str, branch_id=None, user_id=None) -> None:
    """Devengo de la compra al recibir la OC.
    goods_total: total mercancía a costo (incluye landed cost prorrateado)
    tax_total:   IVA trasladado por el proveedor (16% típicamente)
    withholding_*: retenciones al proveedor (política #7, ya calculadas)
    """
    policy = await get_active_policy(db, branch_id=branch_id)
    if policy.purchase_recognition != "on_receive":
        # Si el cliente usa on_bill / on_pay, el hook se dispara desde otro flujo
        return
    m = await get_account_map(db)
    inv, sup = m.get("inventory"), m.get("suppliers")
    iva_role = _pick_iva_acreditable_role(policy)
    iva_acc = m.get(iva_role)
    if not inv or not sup:
        return
    goods_total = _r(goods_total)
    tax_total = _r(tax_total or 0)
    withholding_isr = _r(withholding_isr or 0)
    withholding_iva = _r(withholding_iva or 0)
    if goods_total <= 0:
        return
    specs = [(inv, goods_total, 0.0)]
    if iva_acc and tax_total > 0:
        specs.append((iva_acc, tax_total, 0.0))
    supplier_credit = goods_total + tax_total - withholding_isr - withholding_iva
    specs.append((sup, 0.0, supplier_credit))
    if withholding_isr > 0 or withholding_iva > 0:
        tw = m.get("taxes_withheld")
        if tw:
            if withholding_isr > 0:
                specs.append((tw, 0.0, withholding_isr))
            if withholding_iva > 0:
                specs.append((tw, 0.0, withholding_iva))
    await _auto_entry(db, source=f"compra:{po_id}", entry_type="egreso",
                      concept=concept, specs=specs, branch_id=branch_id, user_id=user_id)


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 4 — Pago a proveedor:
#   Cargo: Proveedores
#   Abono: Bancos
#   [Opcional] Cargo: IVA acreditable pagado / Abono: IVA acreditable pendiente
#             (pase por política #1 = pending_payment)
# ═════════════════════════════════════════════════════════════════════════════

async def record_supplier_payment(db: AsyncSession, *, po_id: int, payment_id: int,
                                  amount: float, tax_portion: float = 0.0,
                                  concept: str, branch_id=None, user_id=None) -> None:
    """Pago (parcial o total) a proveedor.
    amount: importe pagado en pesos
    tax_portion: fracción del pago que corresponde a IVA (para pase pendiente→pagado)
    """
    policy = await get_active_policy(db, branch_id=branch_id)
    m = await get_account_map(db)
    bank, sup = m.get("bank"), m.get("suppliers")
    if not bank or not sup:
        return
    amount = _r(amount)
    tax_portion = _r(tax_portion or 0)
    if amount <= 0:
        return

    # Póliza principal: Cargo Proveedores / Abono Bancos
    await _auto_entry(
        db, source=f"pago_prov:{po_id}:{payment_id}", entry_type="egreso",
        concept=concept, specs=[(sup, amount, 0.0), (bank, 0.0, amount)],
        branch_id=branch_id, user_id=user_id,
    )

    # Pase de IVA pendiente → pagado (solo si política #1 = pending_payment)
    if policy.iva_acreditable_scheme == "pending_payment" and tax_portion > 0:
        iva_paid = m.get("iva_acreditable")
        iva_pending = m.get("iva_acreditable_pending")
        if iva_paid and iva_pending:
            await _auto_entry(
                db, source=f"pago_prov_iva:{po_id}:{payment_id}", entry_type="diario",
                concept=f"Traslado IVA acreditable — {concept}",
                specs=[(iva_paid, tax_portion, 0.0), (iva_pending, 0.0, tax_portion)],
                branch_id=branch_id, user_id=user_id,
            )


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 5 — Costo de ventas al vender (política #3 = perpetual):
#   Cargo: Costo de ventas
#   Abono: Inventarios
# El costo unitario ya viene del FIFO integrado (con landed cost) por partida.
# ═════════════════════════════════════════════════════════════════════════════

async def record_cogs_at_sale(db: AsyncSession, *, order_id: int, total_cost: float,
                              concept: str, branch_id=None, user_id=None) -> None:
    """Registro perpetuo del costo de ventas al momento de la venta. Se llama
    desde sales._apply_stock_for_items después de consumir stock por FIFO."""
    policy = await get_active_policy(db, branch_id=branch_id)
    if policy.cogs_scheme != "perpetual":
        return  # analítico → se hace al cierre mensual, no aquí
    m = await get_account_map(db)
    cogs, inv = m.get("cogs"), m.get("inventory")
    if not cogs or not inv:
        return
    total_cost = _r(total_cost)
    if total_cost <= 0:
        return
    await _auto_entry(
        db, source=f"cogs:{order_id}", entry_type="egreso", concept=concept,
        specs=[(cogs, total_cost, 0.0), (inv, 0.0, total_cost)],
        branch_id=branch_id, user_id=user_id,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Cancelación en cascada — cuando se cancela una operación con pólizas hijas,
# también se cancelan las asociadas (COGS y pase de IVA).
# ═════════════════════════════════════════════════════════════════════════════

async def void_sale_cascade(db: AsyncSession, *, order_id: int) -> None:
    """Cancela la póliza principal, la de COGS y el pase de IVA (si existieran).
    NO hace commit — el flujo anfitrión lo hace."""
    res = await db.execute(
        select(models.JournalEntry).where(
            or_(
                models.JournalEntry.source == f"venta:{order_id}",
                models.JournalEntry.source == f"cogs:{order_id}",
                models.JournalEntry.source.like(f"cobro:{order_id}:%"),
            ),
            models.JournalEntry.status != "cancelled",
        )
    )
    for e in res.scalars().all():
        e.status = "cancelled"
        e.cancelled_at = _now()


async def void_purchase_cascade(db: AsyncSession, *, po_id: int) -> None:
    """Cancela la póliza de compra y sus pagos + pases de IVA."""
    res = await db.execute(
        select(models.JournalEntry).where(
            or_(
                models.JournalEntry.source == f"compra:{po_id}",
                models.JournalEntry.source.like(f"pago_prov:{po_id}:%"),
                models.JournalEntry.source.like(f"pago_prov_iva:{po_id}:%"),
            ),
            models.JournalEntry.status != "cancelled",
        )
    )
    for e in res.scalars().all():
        e.status = "cancelled"
        e.cancelled_at = _now()


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 6 — NÓMINA (al aprobar el período)
#
# Genera póliza según payroll_scheme:
#   itemized      → 4 cargos separados (Sueldos + IMSS patronal + ISN patronal +
#                   INFONAVIT patronal) y N abonos (net + cada retención + cada
#                   pasivo por pagar patronal). Nivel profesional.
#   consolidated  → 1 cargo (Sueldos y salarios) con TODO, mismos abonos
#                   desglosados.
#   admin_expense → 1 cargo (Gastos de administración), mismos abonos.
#
# Al DISPERSAR (pago real al banco), se genera una segunda póliza:
#   Cargo Sueldos por pagar / Abono Bancos
# ═════════════════════════════════════════════════════════════════════════════

def _sum_payroll_details(details: list) -> dict:
    """Suma los importes de todas las partidas de nómina en el período.
    Devuelve un dict con los agregados listos para armar la póliza."""
    total_salary_earned = 0.0
    total_overtime = 0.0
    total_bonus = 0.0
    total_food_vouchers = 0.0
    total_vacation_premium = 0.0
    total_aguinaldo = 0.0
    total_savings_fund = 0.0
    total_subsidy = 0.0
    total_isr = 0.0
    total_imss_obrero = 0.0
    total_infonavit = 0.0
    total_fonacot = 0.0
    total_loan = 0.0
    total_imss_patronal = 0.0
    total_infonavit_patronal = 0.0
    total_isn = 0.0
    total_net = 0.0

    for d in details:
        total_salary_earned += float(getattr(d, "salary_earned", 0.0) or 0.0)
        total_overtime += float(getattr(d, "overtime_double", 0.0) or 0.0) + float(getattr(d, "overtime_triple", 0.0) or 0.0)
        total_bonus += float(getattr(d, "bonus", 0.0) or 0.0)
        total_food_vouchers += float(getattr(d, "food_vouchers", 0.0) or 0.0)
        total_vacation_premium += float(getattr(d, "vacation_premium", 0.0) or 0.0)
        total_aguinaldo += float(getattr(d, "aguinaldo", 0.0) or 0.0)
        total_savings_fund += float(getattr(d, "savings_fund", 0.0) or 0.0)
        total_subsidy += float(getattr(d, "subsidy_applied", 0.0) or 0.0)
        total_isr += float(getattr(d, "isr", 0.0) or 0.0)
        total_imss_obrero += float(getattr(d, "imss_employee", 0.0) or 0.0)
        total_infonavit += float(getattr(d, "infonavit", 0.0) or 0.0)
        total_fonacot += float(getattr(d, "fonacot", 0.0) or 0.0)
        total_loan += float(getattr(d, "loan_deduction", 0.0) or 0.0)
        total_imss_patronal += float(getattr(d, "imss_employer", 0.0) or 0.0)
        total_infonavit_patronal += float(getattr(d, "infonavit_employer", 0.0) or 0.0)
        total_isn += float(getattr(d, "state_payroll_tax", 0.0) or 0.0)
        total_net += float(getattr(d, "total_net", 0.0) or 0.0)

    gross_perceptions = (
        total_salary_earned + total_overtime + total_bonus + total_food_vouchers
        + total_vacation_premium + total_aguinaldo + total_savings_fund
    )
    # ISR retenido se reduce por el subsidio al empleo pagado (que la empresa
    # acredita contra ISR según art. 8 LSSE, LISR): el patrón adelanta el
    # subsidio y luego lo acredita a su ISR retenido a pagar.
    isr_neto_pagar = max(0.0, total_isr - total_subsidy)

    return {
        "gross_perceptions": _r(gross_perceptions),
        "imss_patronal": _r(total_imss_patronal),
        "infonavit_patronal": _r(total_infonavit_patronal),
        "isn": _r(total_isn),
        "isr_neto_pagar": _r(isr_neto_pagar),
        "imss_obrero": _r(total_imss_obrero),
        "infonavit_obrero": _r(total_infonavit),
        "fonacot": _r(total_fonacot),
        "loan_deduction": _r(total_loan),
        "subsidy": _r(total_subsidy),
        "net_paid": _r(total_net),
    }


async def record_payroll_period(db: AsyncSession, *, period_id: int, period_name: str,
                                 details: list, branch_id=None, user_id=None) -> None:
    """Genera la póliza de nómina al aprobar el período según payroll_scheme.
    Cubre percepciones, patronales, retenciones y provisiones.
    Idempotente por source='nomina:{period_id}'."""
    policy = await get_active_policy(db, branch_id=branch_id)
    m = await get_account_map(db)
    expenses = m.get("expenses")           # 6101 Gastos de administración
    payroll_payable = m.get("payroll_payable")  # 2102 Sueldos por pagar
    taxes_withheld = m.get("taxes_withheld")     # 2106 Impuestos retenidos
    # Impuestos patronales por pagar → mismo rol taxes_payable si existe,
    # o payroll_payable como fallback (para que cuadre).
    if not expenses or not payroll_payable:
        return

    sums = _sum_payroll_details(details)
    total_charges = (
        sums["gross_perceptions"] + sums["imss_patronal"]
        + sums["infonavit_patronal"] + sums["isn"]
    )
    if total_charges <= 0:
        return

    specs = []
    # ── Cargos (según scheme) ────────────────────────────────────────────
    if policy.payroll_scheme == "itemized":
        # 4 cargos separados — máximo detalle para el Estado de Resultados
        specs.append((expenses, sums["gross_perceptions"], 0.0))
        if sums["imss_patronal"] > 0:
            specs.append((expenses, sums["imss_patronal"], 0.0))
        if sums["infonavit_patronal"] > 0:
            specs.append((expenses, sums["infonavit_patronal"], 0.0))
        if sums["isn"] > 0:
            specs.append((expenses, sums["isn"], 0.0))
    else:
        # consolidated y admin_expense: un solo cargo con TODO
        specs.append((expenses, total_charges, 0.0))

    # ── Abonos (siempre desglosados para trazabilidad) ────────────────────
    # Neto a pagar al trabajador
    if sums["net_paid"] > 0:
        specs.append((payroll_payable, 0.0, sums["net_paid"]))
    # Retenciones
    if sums["isr_neto_pagar"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["isr_neto_pagar"]))
    if sums["imss_obrero"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["imss_obrero"]))
    if sums["infonavit_obrero"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["infonavit_obrero"]))
    if sums["fonacot"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["fonacot"]))
    if sums["loan_deduction"] > 0 and payroll_payable:
        specs.append((payroll_payable, 0.0, sums["loan_deduction"]))
    # Patronales por pagar (usa taxes_withheld como cuenta genérica de pasivo
    # laboral por pagar; si el catálogo tiene 2105 separado, cae ahí)
    if sums["imss_patronal"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["imss_patronal"]))
    if sums["infonavit_patronal"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["infonavit_patronal"]))
    if sums["isn"] > 0 and taxes_withheld:
        specs.append((taxes_withheld, 0.0, sums["isn"]))

    # Verificación: cargos - abonos deben ser 0 (partida doble)
    td = _r(sum(s[1] for s in specs))
    tc = _r(sum(s[2] for s in specs))
    if abs(td - tc) > 0.01:
        # La póliza no cuadra — típicamente porque taxes_withheld no está
        # configurado. NO grabamos una póliza descuadrada, mejor que no se
        # genere y quede aviso en el log.
        return

    await _auto_entry(
        db, source=f"nomina:{period_id}", entry_type="egreso",
        concept=f"Nómina — período {period_name}",
        specs=specs, branch_id=branch_id, user_id=user_id,
    )


async def record_payroll_dispersion(db: AsyncSession, *, period_id: int,
                                     period_name: str, total_net: float,
                                     branch_id=None, user_id=None) -> None:
    """Al dispersar (pago real al banco):
       Cargo Sueldos por pagar / Abono Bancos"""
    m = await get_account_map(db)
    payroll_payable = m.get("payroll_payable")
    bank = m.get("bank")
    if not payroll_payable or not bank:
        return
    total_net = _r(total_net)
    if total_net <= 0:
        return
    await _auto_entry(
        db, source=f"nomina_pago:{period_id}", entry_type="egreso",
        concept=f"Pago de nómina — período {period_name}",
        specs=[(payroll_payable, total_net, 0.0), (bank, 0.0, total_net)],
        branch_id=branch_id, user_id=user_id,
    )


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 7 — GASTOS OPERATIVOS DE FINANZAS
#
# Trigger: al crear una Transaction de tipo 'expense' desde el módulo Finanzas.
# Se registra en momento distinto según expense_basis:
#   accrual → al crear la transacción (aunque no se pague aún)
#   cash    → al crear también (asumiendo que Transaction en Finanzas ya
#             representa la salida real del efectivo — no hay estado 'pending')
#
# Para gastos con IVA acreditable, mejor usar SupplierBill (con su propio hook)
# porque Transaction no desglosa impuesto. Aquí generamos póliza sin IVA.
# ═════════════════════════════════════════════════════════════════════════════

async def record_expense_transaction(db: AsyncSession, *, transaction_id: int,
                                     amount: float, category: Optional[str],
                                     description: str, branch_id=None, user_id=None) -> None:
    """Cargo Gastos / Abono Bancos. Simple, sin IVA — el importe capturado
    en Finanzas debe ya incluir todo (concepto neto)."""
    m = await get_account_map(db)
    expenses = m.get("expenses")
    bank = m.get("bank")
    if not expenses or not bank:
        return
    amount = _r(amount)
    if amount <= 0:
        return
    concept = f"Gasto — {category or 'general'}: {description}"[:200]
    await _auto_entry(
        db, source=f"gasto:{transaction_id}", entry_type="egreso",
        concept=concept,
        specs=[(expenses, amount, 0.0), (bank, 0.0, amount)],
        branch_id=branch_id, user_id=user_id,
    )


async def record_income_transaction(db: AsyncSession, *, transaction_id: int,
                                    amount: float, category: Optional[str],
                                    description: str, branch_id=None, user_id=None) -> None:
    """Ingreso manual desde Finanzas (no relacionado con una venta): p.ej.
    intereses ganados, ingresos por rentas, otros ingresos.
    Cargo Bancos / Abono Otros ingresos (4104 vía rol 'sales' como fallback
    si no hay 'other_income' configurado — en fase 4C se separan)."""
    m = await get_account_map(db)
    bank = m.get("bank")
    # No hay rol 'other_income' aún; usa 'sales' como fallback. En fase 4C
    # agregamos una cuenta y rol separado.
    income = m.get("sales")
    if not bank or not income:
        return
    amount = _r(amount)
    if amount <= 0:
        return
    concept = f"Ingreso — {category or 'general'}: {description}"[:200]
    await _auto_entry(
        db, source=f"ingreso:{transaction_id}", entry_type="ingreso",
        concept=concept,
        specs=[(bank, amount, 0.0), (income, 0.0, amount)],
        branch_id=branch_id, user_id=user_id,
    )


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 10 — CIERRE ANUAL DEL EJERCICIO
#
# Al terminar el año fiscal (o cuando el contador lo dispare):
#   1. Suma ingresos, costos y gastos del año.
#   2. Genera póliza de cierre:
#         Cargo:  Ingresos (todos)                total ingresos
#         Abono:  Costos (todos)                        total costos
#         Abono:  Gastos (todos)                        total gastos
#         Abono:  Resultado del ejercicio (3103)        utilidad neta
#      Si es pérdida, se invierten los movimientos (Cargo Resultado / Abono
#      cuentas de resultado no se hace en la práctica; se maneja con signo).
#   3. Deja las cuentas de resultado en cero para arrancar el siguiente año.
#
# NO se hace el traspaso 3103 → 3102 aquí — eso lo dispara el contador al
# inicio del ejercicio siguiente, cuando decide qué hacer con la utilidad
# (retenida, dividendo, aplicación a pérdidas anteriores, etc.).
# ═════════════════════════════════════════════════════════════════════════════

async def close_year(db: AsyncSession, *, year: int, branch_id=None, user_id=None) -> dict:
    """Genera la póliza de cierre anual del ejercicio. Idempotente por año."""
    from datetime import datetime as _dt

    # Bloqueo: no se puede cerrar si ya hay una póliza de cierre para el año
    existing = (await db.execute(
        select(models.JournalEntry).where(
            models.JournalEntry.source == f"cierre_anual:{year}",
            models.JournalEntry.status != "cancelled",
        )
    )).scalars().first()
    if existing:
        raise ValueError(f"El ejercicio {year} ya fue cerrado (póliza {existing.folio}).")

    date_from = _dt(year, 1, 1, tzinfo=timezone.utc)
    date_to = _dt(year + 1, 1, 1, tzinfo=timezone.utc)
    # Suma por cuenta desde JournalLines contabilizadas
    stmt = (
        select(models.JournalLine.account_id,
               func.coalesce(func.sum(models.JournalLine.debit), 0.0),
               func.coalesce(func.sum(models.JournalLine.credit), 0.0))
        .join(models.JournalEntry, models.JournalLine.entry_id == models.JournalEntry.id)
        .where(
            models.JournalEntry.status == "posted",
            models.JournalEntry.date >= date_from,
            models.JournalEntry.date < date_to,
        )
        .group_by(models.JournalLine.account_id)
    )
    sums = {r[0]: (float(r[1] or 0.0), float(r[2] or 0.0)) for r in (await db.execute(stmt)).all()}
    if not sums:
        raise ValueError(f"No hay pólizas contabilizadas en {year} — nada que cerrar.")

    accounts = {a.id: a for a in await list_accounts(db)}
    # Netos por tipo de cuenta (naturaleza)
    ingresos_netos = defaultdict(float)   # {acc_id: neto acreedor}
    costos_gastos_netos = defaultdict(float)  # {acc_id: neto deudor}
    for acc_id, (d, c) in sums.items():
        acc = accounts.get(acc_id)
        if not acc or not acc.is_postable:
            continue
        if acc.account_type == "ingreso":
            neto = c - d  # ingresos: neto acreedor
            if abs(neto) >= 0.01:
                ingresos_netos[acc_id] = _r(neto)
        elif acc.account_type in ("costo", "gasto"):
            neto = d - c  # costos/gastos: neto deudor
            if abs(neto) >= 0.01:
                costos_gastos_netos[acc_id] = _r(neto)

    total_ingresos = _r(sum(ingresos_netos.values()))
    total_costos_gastos = _r(sum(costos_gastos_netos.values()))
    utilidad_neta = _r(total_ingresos - total_costos_gastos)

    # Buscar cuenta 3103 Resultado del ejercicio en el catálogo
    resultado_acc = next((a for a in accounts.values() if a.code == "3103"), None)
    if not resultado_acc:
        raise ValueError(
            "No se encontró la cuenta 3103 'Resultado del ejercicio' en el catálogo. "
            "Créala antes de cerrar el ejercicio."
        )

    # Armar la póliza: cargo a ingresos (reversar), abono a costos/gastos (reversar),
    # y contrapartida en 3103 con el resultado neto.
    specs = []
    for acc_id, neto in ingresos_netos.items():
        # Reversar el saldo acreedor → cargo
        specs.append((acc_id, neto, 0.0))
    for acc_id, neto in costos_gastos_netos.items():
        # Reversar el saldo deudor → abono
        specs.append((acc_id, 0.0, neto))
    # Contrapartida
    if utilidad_neta > 0:
        specs.append((resultado_acc.id, 0.0, utilidad_neta))
    elif utilidad_neta < 0:
        specs.append((resultado_acc.id, abs(utilidad_neta), 0.0))
    # (si utilidad_neta == 0 la póliza cuadra sin contrapartida)

    td = _r(sum(s[1] for s in specs))
    tc = _r(sum(s[2] for s in specs))
    if abs(td - tc) > 0.01:
        raise ValueError(
            f"Póliza de cierre no cuadra: cargos ${td:,.2f} vs abonos ${tc:,.2f}. "
            f"Revisa saldos antes de cerrar."
        )

    await _auto_entry(
        db, source=f"cierre_anual:{year}", entry_type="diario",
        concept=f"Cierre anual del ejercicio {year}",
        specs=specs, branch_id=branch_id, user_id=user_id,
    )
    return {
        "year": year,
        "total_ingresos": total_ingresos,
        "total_costos_gastos": total_costos_gastos,
        "utilidad_neta": utilidad_neta,
        "cuentas_cerradas": len(ingresos_netos) + len(costos_gastos_netos),
    }


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 8 — DIFERENCIA CAMBIARIA (operaciones en moneda extranjera)
#
# Al pagar una OC en USD (o EUR), el TC del día del pago puede diferir del
# TC del día de la recepción. La diferencia se contabiliza:
#   - TC subió (peso más débil): pierdes → 6103 Pérdida cambiaria
#   - TC bajó (peso más fuerte): ganas  → 4103 Ganancia cambiaria
# NIF B-15 · política #8 fx_scheme = transaction_date
# ═════════════════════════════════════════════════════════════════════════════

async def record_fx_difference(db: AsyncSession, *, source_ref: str,
                                original_mxn: float, paid_mxn: float,
                                concept: str, branch_id=None, user_id=None) -> None:
    """Registra la diferencia cambiaria entre lo que se debía (original_mxn,
    convertido al TC del día de la operación) y lo que efectivamente se pagó
    en pesos al TC del día del pago (paid_mxn).
    Si abs(diff) < 0.01, no genera póliza."""
    policy = await get_active_policy(db, branch_id=branch_id)
    if policy.fx_scheme != "transaction_date":
        return  # month_end_close se maneja en cierre mensual, no aquí
    m = await get_account_map(db)
    fx_gain = m.get("fx_gain")
    fx_loss = m.get("fx_loss")
    suppliers = m.get("suppliers")
    if not suppliers:
        return
    diff = round(paid_mxn - original_mxn, 2)
    if abs(diff) < 0.01:
        return
    if diff > 0:
        # Se pagó más pesos de los que se debía → pérdida cambiaria
        if not fx_loss:
            return
        specs = [(fx_loss, diff, 0.0), (suppliers, 0.0, diff)]
    else:
        # Se pagó menos pesos de los que se debía → ganancia cambiaria
        gain = abs(diff)
        if not fx_gain:
            return
        specs = [(suppliers, gain, 0.0), (fx_gain, 0.0, gain)]
    await _auto_entry(
        db, source=f"dif_cambio:{source_ref}", entry_type="diario",
        concept=concept, specs=specs, branch_id=branch_id, user_id=user_id,
    )


# ═════════════════════════════════════════════════════════════════════════════
# HOOK 9 — DEPRECIACIÓN MENSUAL AUTOMÁTICA (línea recta, LISR art. 34)
#
# Al final de cada mes calendario, para cada activo activo:
#   monthly_depr = (acquisition_cost - salvage_value) × annual_rate_pct / 100 / 12
# Y se genera póliza:
#   Cargo Gasto de depreciación / Abono Depreciación acumulada
# Se detiene automáticamente cuando accumulated_depreciation >= (cost - salvage).
# ═════════════════════════════════════════════════════════════════════════════

def _monthly_depreciation(asset: models.FixedAsset) -> float:
    """Depreciación mensual usando línea recta. Considera:
    - No exceder el valor depreciable (cost - salvage)
    - No depreciar activos dados de baja
    - Máximo (annual_rate_pct / 12) del costo depreciable
    """
    if not asset.is_active or asset.disposed_at is not None:
        return 0.0
    depreciable_base = float(asset.acquisition_cost or 0.0) - float(asset.salvage_value or 0.0)
    if depreciable_base <= 0:
        return 0.0
    already = float(asset.accumulated_depreciation or 0.0)
    remaining = depreciable_base - already
    if remaining <= 0:
        return 0.0
    monthly = depreciable_base * float(asset.annual_rate_pct or 0.0) / 100.0 / 12.0
    # No pasarnos del remanente en el último mes
    return round(min(monthly, remaining), 2)


async def record_monthly_depreciation(db: AsyncSession, *, year: int, month: int,
                                       branch_id=None, user_id=None) -> dict:
    """Corre la depreciación de TODOS los activos activos para el mes dado.
    Genera UNA póliza consolidada (Cargo Depreciación / Abono Depr. acumulada)
    para todos los activos, más filas separadas si usan cuentas distintas.
    Idempotente por source='depreciacion:{year}-{month}'."""
    from calendar import monthrange
    last_day = monthrange(year, month)[1]
    posting_date = datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    policy = await get_active_policy(db, at_date=posting_date, branch_id=branch_id)
    if policy.depreciation_scheme != "straight_line_monthly":
        return {"skipped": True, "reason": "policy is not straight_line_monthly"}

    # Guardia: no duplicar
    existing = (await db.execute(
        select(models.JournalEntry).where(
            models.JournalEntry.source == f"depreciacion:{year}-{month:02d}",
            models.JournalEntry.status != "cancelled",
        )
    )).scalars().first()
    if existing:
        return {"skipped": True, "reason": f"ya existe póliza {existing.folio}"}

    # Cargar activos activos
    assets = (await db.execute(
        select(models.FixedAsset).where(
            models.FixedAsset.is_active == True,  # noqa: E712
            models.FixedAsset.acquisition_date <= posting_date,
        )
    )).scalars().all()

    m = await get_account_map(db)
    default_expense = m.get("expenses")
    # Buscamos cuenta 1204 Depreciación acumulada por default
    accounts_by_code = {a.code: a for a in await list_accounts(db)}
    default_accum = accounts_by_code.get("1204")

    # Agregar cargos y abonos por cuenta (para consolidar si varios activos usan
    # las mismas cuentas)
    charges = defaultdict(float)   # {account_id: monto de cargo}
    credits = defaultdict(float)   # {account_id: monto de abono}
    total_monthly = 0.0
    depreciated_assets: list[dict] = []

    for asset in assets:
        monthly = _monthly_depreciation(asset)
        if monthly <= 0:
            continue
        expense_acc = asset.expense_account_id or (default_expense if default_expense else None)
        accum_acc = asset.accumulated_depr_account_id or (default_accum.id if default_accum else None)
        if not expense_acc or not accum_acc:
            continue
        charges[expense_acc] += monthly
        credits[accum_acc] += monthly
        # Actualizar snapshot del activo
        asset.accumulated_depreciation = round(float(asset.accumulated_depreciation or 0.0) + monthly, 2)
        total_monthly += monthly
        depreciated_assets.append({"asset_id": asset.id, "name": asset.name, "amount": monthly})

    if total_monthly <= 0:
        return {"skipped": True, "reason": "no hay depreciación para el mes"}

    specs = []
    for acc_id, amt in charges.items():
        specs.append((acc_id, round(amt, 2), 0.0))
    for acc_id, amt in credits.items():
        specs.append((acc_id, 0.0, round(amt, 2)))

    await _auto_entry(
        db, source=f"depreciacion:{year}-{month:02d}", entry_type="diario",
        concept=f"Depreciación mensual — {year}-{month:02d} ({len(depreciated_assets)} activos)",
        specs=specs, branch_id=branch_id, user_id=user_id,
    )
    return {
        "year": year, "month": month, "total": round(total_monthly, 2),
        "assets_depreciated": depreciated_assets,
    }


# ═════════════════════════════════════════════════════════════════════════════
# CRUD de activos fijos (Hook 9 apoyo)
# ═════════════════════════════════════════════════════════════════════════════

async def create_fixed_asset(db: AsyncSession, data: dict,
                              user_id: Optional[int] = None) -> models.FixedAsset:
    annual_rate = float(data.get("annual_rate_pct") or 0.0)
    useful_life_months = int(round(1200.0 / annual_rate)) if annual_rate > 0 else 120
    asset = models.FixedAsset(
        name=data["name"],
        category=data.get("category"),
        acquisition_date=data["acquisition_date"],
        acquisition_cost=data["acquisition_cost"],
        salvage_value=data.get("salvage_value", 0.0),
        annual_rate_pct=annual_rate,
        useful_life_months=useful_life_months,
        asset_account_id=data.get("asset_account_id"),
        accumulated_depr_account_id=data.get("accumulated_depr_account_id"),
        expense_account_id=data.get("expense_account_id"),
        branch_id=data.get("branch_id"),
        notes=data.get("notes"),
        created_by_id=user_id,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


async def list_fixed_assets(db: AsyncSession, only_active: bool = True) -> list:
    stmt = select(models.FixedAsset).order_by(
        models.FixedAsset.acquisition_date.desc(), models.FixedAsset.id.desc()
    )
    if only_active:
        stmt = stmt.where(models.FixedAsset.is_active == True)  # noqa: E712
    return (await db.execute(stmt)).scalars().all()


async def dispose_fixed_asset(db: AsyncSession, asset_id: int,
                               user_id: Optional[int] = None) -> Optional[models.FixedAsset]:
    asset = await db.get(models.FixedAsset, asset_id)
    if not asset:
        return None
    asset.is_active = False
    asset.disposed_at = _now()
    await db.commit()
    await db.refresh(asset)
    return asset
