"""Business logic para el módulo Forecast.

Diseño:
- CRUD atómico para planes y líneas.
- baseline(): lee historial real (orders + order_items) del cliente/producto,
  agrupa las unidades por mes calendario para respetar estacionalidad, aplica
  el % de crecimiento del plan y crea una línea por combinación
  cliente/producto/vendedor detectada.
- rollup(): concentra las líneas del plan por cada dimensión.
- attainment(): compara la meta mensual del plan contra las ventas reales
  del año (calendario) del backend de sales.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.customers import models as cust_models
from app.modules.inventory import models as inv_models
from app.modules.sales import models as sales_models
from app.modules.auth import models as auth_models

from . import models, schemas


MONTH_COLS = ("m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12")


def _line_totals(line: models.ForecastLine) -> Tuple[int, float]:
    units = sum(int(getattr(line, c) or 0) for c in MONTH_COLS)
    amount = round(units * float(line.unit_price or 0.0), 2)
    return units, amount


def _line_to_schema(line: models.ForecastLine) -> schemas.ForecastLineInDB:
    units, amount = _line_totals(line)
    data = {c: int(getattr(line, c) or 0) for c in MONTH_COLS}
    return schemas.ForecastLineInDB(
        id=line.id,
        plan_id=line.plan_id,
        customer_id=line.customer_id,
        variant_id=line.variant_id,
        salesperson_id=line.salesperson_id,
        product_name=line.product_name,
        sku=line.sku,
        customer_name=line.customer_name,
        salesperson_name=line.salesperson_name,
        unit_price=float(line.unit_price or 0.0),
        total_units=units,
        total_amount=amount,
        **data,
    )


# ── Planes ───────────────────────────────────────────────────────────────────

async def list_plans(db: AsyncSession) -> List[models.ForecastPlan]:
    stmt = select(models.ForecastPlan).order_by(
        models.ForecastPlan.year.desc(), models.ForecastPlan.id.desc()
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())


async def get_plan(db: AsyncSession, plan_id: int) -> Optional[models.ForecastPlan]:
    return await db.get(models.ForecastPlan, plan_id)


async def create_plan(db: AsyncSession, data: schemas.ForecastPlanCreate) -> models.ForecastPlan:
    plan = models.ForecastPlan(**data.model_dump(exclude_unset=True))
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


async def update_plan(
    db: AsyncSession, plan_id: int, data: schemas.ForecastPlanUpdate
) -> Optional[models.ForecastPlan]:
    plan = await db.get(models.ForecastPlan, plan_id)
    if plan is None:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(plan, k, v)
    await db.commit()
    await db.refresh(plan)
    return plan


async def delete_plan(db: AsyncSession, plan_id: int) -> bool:
    plan = await db.get(models.ForecastPlan, plan_id)
    if plan is None:
        return False
    await db.delete(plan)
    await db.commit()
    return True


# ── Líneas ───────────────────────────────────────────────────────────────────

async def list_lines(db: AsyncSession, plan_id: int) -> List[schemas.ForecastLineInDB]:
    stmt = (
        select(models.ForecastLine)
        .where(models.ForecastLine.plan_id == plan_id)
        .order_by(models.ForecastLine.id.asc())
    )
    res = await db.execute(stmt)
    return [_line_to_schema(r) for r in res.scalars().all()]


async def _fill_snapshots(db: AsyncSession, line: models.ForecastLine) -> None:
    """Llena los nombres a partir de las FKs cuando el cliente no los mandó."""
    if line.customer_id and not line.customer_name:
        cust = await db.get(cust_models.Customer, line.customer_id)
        if cust:
            line.customer_name = cust.name
    if line.variant_id and (not line.product_name or not line.sku):
        variant = await db.get(inv_models.ProductVariant, line.variant_id)
        if variant:
            if not line.sku:
                line.sku = variant.sku
            if not line.product_name and variant.product_id:
                prod = await db.get(inv_models.Product, variant.product_id)
                if prod:
                    line.product_name = prod.name
            if not line.unit_price and variant.price:
                line.unit_price = float(variant.price)
    if line.salesperson_id and not line.salesperson_name:
        user = await db.get(auth_models.User, line.salesperson_id)
        if user:
            line.salesperson_name = user.full_name or user.email


async def create_line(
    db: AsyncSession, plan_id: int, data: schemas.ForecastLineCreate
) -> schemas.ForecastLineInDB:
    line = models.ForecastLine(plan_id=plan_id, **data.model_dump(exclude_unset=True))
    await _fill_snapshots(db, line)
    db.add(line)
    await db.commit()
    await db.refresh(line)
    return _line_to_schema(line)


async def update_line(
    db: AsyncSession, line_id: int, data: schemas.ForecastLineUpdate
) -> Optional[schemas.ForecastLineInDB]:
    line = await db.get(models.ForecastLine, line_id)
    if line is None:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(line, k, v)
    await _fill_snapshots(db, line)
    await db.commit()
    await db.refresh(line)
    return _line_to_schema(line)


async def delete_line(db: AsyncSession, line_id: int) -> bool:
    line = await db.get(models.ForecastLine, line_id)
    if line is None:
        return False
    await db.delete(line)
    await db.commit()
    return True


# ── Baseline ────────────────────────────────────────────────────────────────

async def build_baseline(
    db: AsyncSession, req: schemas.BaselineRequest
) -> schemas.BaselineResponse:
    """Genera líneas del plan a partir del historial real del año anterior."""
    plan = await db.get(models.ForecastPlan, req.plan_id)
    if plan is None:
        raise ValueError("Plan no encontrado")

    year_source = req.year_source if req.year_source is not None else (plan.year - 1)
    growth_pct = req.growth_pct if req.growth_pct is not None else float(plan.growth_pct or 0.0)
    factor = 1.0 + (growth_pct / 100.0)

    lines_deleted = 0
    if req.replace:
        # Recuento antes de borrar (para el reporte de la respuesta)
        cnt = await db.execute(
            select(func.count(models.ForecastLine.id)).where(
                models.ForecastLine.plan_id == plan.id
            )
        )
        lines_deleted = int(cnt.scalar() or 0)
        await db.execute(
            delete(models.ForecastLine).where(models.ForecastLine.plan_id == plan.id)
        )

    O = sales_models.Order
    OI = sales_models.OrderItem

    conds = [
        O.kind == "order",
        O.status != "cancelled",
        func.extract("year", O.created_at) == year_source,
    ]
    if req.customer_id is not None:
        conds.append(O.customer_id == req.customer_id)
    if req.salesperson_id is not None:
        conds.append(O.user_id == req.salesperson_id)

    month_expr = func.extract("month", O.created_at).label("month")

    stmt = (
        select(
            O.customer_id.label("customer_id"),
            OI.variant_id.label("variant_id"),
            O.user_id.label("salesperson_id"),
            func.coalesce(OI.product_name, "—").label("product_name"),
            func.coalesce(OI.sku, "").label("sku"),
            month_expr,
            func.coalesce(func.sum(OI.quantity), 0).label("units"),
            func.coalesce(func.avg(OI.unit_price), 0.0).label("unit_price"),
        )
        .join(O, OI.order_id == O.id)
        .where(and_(*conds))
        .group_by(
            O.customer_id,
            OI.variant_id,
            O.user_id,
            OI.product_name,
            OI.sku,
            month_expr,
        )
    )

    rows = (await db.execute(stmt)).all()

    # Agrupación por (customer, variant, salesperson, product_name, sku) para
    # construir una línea con las 12 columnas de mes.
    grouped: Dict[tuple, Dict] = {}
    for r in rows:
        key = (
            r.customer_id,
            r.variant_id,
            r.salesperson_id,
            r.product_name,
            r.sku,
        )
        g = grouped.setdefault(
            key,
            {
                "customer_id": r.customer_id,
                "variant_id": r.variant_id,
                "salesperson_id": r.salesperson_id,
                "product_name": r.product_name or "—",
                "sku": r.sku or "",
                "unit_price": float(r.unit_price or 0.0),
                "months": [0] * 12,
            },
        )
        m = int(r.month or 0)
        if 1 <= m <= 12:
            g["months"][m - 1] += int(r.units or 0)

    # Snapshots de nombres — cache local para no hacer N queries.
    cust_ids = {g["customer_id"] for g in grouped.values() if g["customer_id"]}
    user_ids = {g["salesperson_id"] for g in grouped.values() if g["salesperson_id"]}

    cust_name_by_id: Dict[int, str] = {}
    if cust_ids:
        cres = await db.execute(
            select(cust_models.Customer.id, cust_models.Customer.name).where(
                cust_models.Customer.id.in_(cust_ids)
            )
        )
        cust_name_by_id = {row.id: row.name for row in cres}

    user_name_by_id: Dict[int, str] = {}
    if user_ids:
        ures = await db.execute(
            select(
                auth_models.User.id,
                auth_models.User.full_name,
                auth_models.User.email,
            ).where(auth_models.User.id.in_(user_ids))
        )
        user_name_by_id = {row.id: (row.full_name or row.email) for row in ures}

    created_lines: List[models.ForecastLine] = []
    for g in grouped.values():
        months_grown = [max(0, int(round(u * factor))) for u in g["months"]]
        line = models.ForecastLine(
            plan_id=plan.id,
            customer_id=g["customer_id"],
            variant_id=g["variant_id"],
            salesperson_id=g["salesperson_id"],
            product_name=g["product_name"],
            sku=g["sku"] or None,
            customer_name=cust_name_by_id.get(g["customer_id"]) if g["customer_id"] else None,
            salesperson_name=user_name_by_id.get(g["salesperson_id"]) if g["salesperson_id"] else None,
            unit_price=g["unit_price"],
        )
        for i, col in enumerate(MONTH_COLS):
            setattr(line, col, months_grown[i])
        db.add(line)
        created_lines.append(line)

    await db.commit()
    for line in created_lines:
        await db.refresh(line)

    return schemas.BaselineResponse(
        plan_id=plan.id,
        year_source=year_source,
        growth_pct=growth_pct,
        lines_created=len(created_lines),
        lines_deleted=lines_deleted,
        lines=[_line_to_schema(l) for l in created_lines],
    )


# ── Rollup ───────────────────────────────────────────────────────────────────

async def rollup(db: AsyncSession, plan_id: int) -> schemas.RollupResponse:
    stmt = (
        select(models.ForecastLine)
        .where(models.ForecastLine.plan_id == plan_id)
        .order_by(models.ForecastLine.id.asc())
    )
    lines = list((await db.execute(stmt)).scalars().all())

    by_customer: Dict[str, Dict] = {}
    by_product: Dict[str, Dict] = {}
    by_salesperson: Dict[str, Dict] = {}
    monthly_amount = [0.0] * 12
    monthly_units = [0] * 12
    total_units = 0
    total_amount = 0.0

    for l in lines:
        units, amount = _line_totals(l)
        total_units += units
        total_amount += amount
        for i, col in enumerate(MONTH_COLS):
            u = int(getattr(l, col) or 0)
            monthly_units[i] += u
            monthly_amount[i] += u * float(l.unit_price or 0.0)

        cust_key = f"cust:{l.customer_id}" if l.customer_id else f"custname:{l.customer_name or 'Sin cliente'}"
        cust_label = l.customer_name or "Sin cliente"
        by_customer.setdefault(cust_key, {"label": cust_label, "units": 0, "amount": 0.0})
        by_customer[cust_key]["units"] += units
        by_customer[cust_key]["amount"] += amount

        prod_key = f"var:{l.variant_id}" if l.variant_id else f"text:{l.product_name or '—'}"
        prod_label = l.product_name or "—"
        if l.sku:
            prod_label = f"{prod_label} · {l.sku}"
        by_product.setdefault(prod_key, {"label": prod_label, "units": 0, "amount": 0.0})
        by_product[prod_key]["units"] += units
        by_product[prod_key]["amount"] += amount

        sp_key = f"user:{l.salesperson_id}" if l.salesperson_id else f"spname:{l.salesperson_name or 'Sin vendedor'}"
        sp_label = l.salesperson_name or "Sin vendedor"
        by_salesperson.setdefault(sp_key, {"label": sp_label, "units": 0, "amount": 0.0})
        by_salesperson[sp_key]["units"] += units
        by_salesperson[sp_key]["amount"] += amount

    def _sorted(d: Dict[str, Dict]) -> List[schemas.RollupRow]:
        rows = [
            schemas.RollupRow(
                key=k, label=v["label"], units=int(v["units"]), amount=round(v["amount"], 2)
            )
            for k, v in d.items()
        ]
        rows.sort(key=lambda r: r.amount, reverse=True)
        return rows

    monthly_amount_r = [round(x, 2) for x in monthly_amount]

    return schemas.RollupResponse(
        plan_id=plan_id,
        by_customer=_sorted(by_customer),
        by_product=_sorted(by_product),
        by_salesperson=_sorted(by_salesperson),
        monthly_amount=monthly_amount_r,
        monthly_units=monthly_units,
        total_units=total_units,
        total_amount=round(total_amount, 2),
    )


# ── Attainment (meta vs ventas reales) ──────────────────────────────────────

async def attainment(db: AsyncSession, plan_id: int) -> schemas.AttainmentResponse:
    plan = await db.get(models.ForecastPlan, plan_id)
    if plan is None:
        raise ValueError("Plan no encontrado")

    roll = await rollup(db, plan_id)

    O = sales_models.Order
    month_expr = func.extract("month", O.created_at).label("month")
    stmt = (
        select(
            month_expr,
            func.coalesce(func.sum(O.total_amount), 0.0).label("total"),
        )
        .where(
            O.kind == "order",
            O.status != "cancelled",
            func.extract("year", O.created_at) == plan.year,
        )
        .group_by(month_expr)
    )
    real_by_month = {int(r.month or 0): float(r.total or 0.0) for r in (await db.execute(stmt)).all()}

    months: List[schemas.AttainmentMonth] = []
    goal_year = 0.0
    real_year = 0.0
    for i in range(12):
        m = i + 1
        goal = float(roll.monthly_amount[i])
        real = float(real_by_month.get(m, 0.0))
        pct = round((real / goal * 100.0), 2) if goal > 0 else 0.0
        months.append(
            schemas.AttainmentMonth(
                month=m,
                goal_amount=round(goal, 2),
                real_amount=round(real, 2),
                attainment_pct=pct,
            )
        )
        goal_year += goal
        real_year += real

    att_year = round((real_year / goal_year * 100.0), 2) if goal_year > 0 else 0.0

    return schemas.AttainmentResponse(
        plan_id=plan_id,
        year=plan.year,
        months=months,
        goal_year=round(goal_year, 2),
        real_year=round(real_year, 2),
        attainment_year_pct=att_year,
    )
