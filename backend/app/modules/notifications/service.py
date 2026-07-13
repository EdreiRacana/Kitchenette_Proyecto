"""Motor de alertas del negocio.

Consolida alertas de todos los módulos operativos:
  - Inventario: agotados, bajo stock, punto de reorden
  - Cartera: CxC vencidas y próximas
  - CxP: facturas por pagar
  - POS: turnos abiertos mucho tiempo, arqueo con variance grande
  - RH: nómina próxima, impuestos (ISN/IMSS/INFONAVIT/FONACOT)
  - Forecast: metas del mes lejos de cumplirse
  - Finanzas: cash bajo/negativo

Las reglas se ejecutan on-demand cada vez que se pide /notifications/. No hay
tabla de Alerts persistida — las alertas SIEMPRE reflejan el estado real.
El frontend puede "dismiss" en localStorage por el `id` estable.
"""
from datetime import datetime, timedelta, timezone
from calendar import monthrange
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from . import schemas

REMINDER_LEAD_DAYS = 3
POS_SHIFT_MAX_HOURS = 14        # más de esto = alerta
POS_VARIANCE_THRESHOLD = 200.0  # $ pesos
CASH_MIN_THRESHOLD = 5000.0     # $ pesos por sucursal


def _money(v: float) -> str:
    return f"${(v or 0):,.2f}"


def _hours_ago(dt: datetime) -> float:
    if not dt:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 3600


async def build_digest(db: AsyncSession) -> schemas.NotificationDigest:
    items: list[schemas.Notification] = []

    # ── Inventario: agotados y bajo stock ─────────────────────────────
    try:
        from app.modules.inventory import service as inv_service
        for a in await inv_service.get_reorder_alerts(db):
            out = a.available <= 0
            items.append(schemas.Notification(
                kind="inventory",
                severity="critical" if out else "warning",
                title=a.product_name,
                detail=(f"Agotado · {a.warehouse_name}" if out
                        else f"Stock bajo: {a.available} disp. · {a.warehouse_name}"),
                page="inventario", query=a.product_name,
                id=f"inv_{a.variant_id}_{a.warehouse_id}",
            ))
    except Exception as exc:
        print(f"[notifications] inventory alerts failed: {exc}")

    horizon = (datetime.now(timezone.utc) + timedelta(days=REMINDER_LEAD_DAYS)).date()

    def _due_soon_or_overdue(aging_item) -> bool:
        if aging_item.status == "overdue":
            return True
        return bool(aging_item.due_date and aging_item.due_date.date() <= horizon)

    # ── Finance: CxC y CxP ────────────────────────────────────────────
    try:
        from app.modules.finance import service as fin_service
        for i in await fin_service.get_cxc(db):
            if not _due_soon_or_overdue(i):
                continue
            overdue = i.status == "overdue"
            items.append(schemas.Notification(
                kind="cxc", severity="critical" if overdue else "warning",
                title=i.name,
                detail=(f"Por cobrar {'VENCIDA' if overdue else 'próxima'}: "
                        f"{_money(i.balance)} · {i.reference}"),
                page="finanzas", query=i.name,
                amount=float(i.balance or 0),
                due_date=i.due_date,
                id=f"cxc_{i.reference}",
            ))
        for i in await fin_service.get_cxp(db):
            if not _due_soon_or_overdue(i):
                continue
            overdue = i.status == "overdue"
            items.append(schemas.Notification(
                kind="cxp", severity="critical" if overdue else "warning",
                title=i.name,
                detail=(f"Por pagar {'VENCIDA' if overdue else 'próxima'}: "
                        f"{_money(i.balance)} · {i.reference}"),
                page="finanzas", query=i.name,
                amount=float(i.balance or 0),
                due_date=i.due_date,
                id=f"cxp_{i.reference}",
            ))
    except Exception as exc:
        print(f"[notifications] finance alerts failed: {exc}")

    # ── POS: turno abierto demasiado tiempo + variance del último cierre
    try:
        from app.modules.pos import models as pos_models
        res = await db.execute(
            select(pos_models.POSSession)
            .where(pos_models.POSSession.status == "open")
        )
        for s in res.scalars().all():
            hrs = _hours_ago(s.opened_at)
            if hrs > POS_SHIFT_MAX_HOURS:
                items.append(schemas.Notification(
                    kind="pos", severity="warning",
                    title=f"Turno abierto {int(hrs)}h",
                    detail=(f"Sesión #{s.id} · cajero #{s.cashier_id} lleva "
                            f"{int(hrs)} horas — considera cerrar el turno."),
                    page="pos", id=f"pos_open_{s.id}",
                ))
        # Variance del último cierre
        res2 = await db.execute(
            select(pos_models.POSSession)
            .where(pos_models.POSSession.status.in_(("closed", "reconciled")))
            .order_by(pos_models.POSSession.closed_at.desc())
            .limit(3)
        )
        for s in res2.scalars().all():
            variance = float(s.variance or 0.0)
            if abs(variance) >= POS_VARIANCE_THRESHOLD:
                sign = "sobrante" if variance > 0 else "faltante"
                items.append(schemas.Notification(
                    kind="pos", severity="critical" if abs(variance) >= 500 else "warning",
                    title=f"Arqueo con {sign}",
                    detail=(f"Turno #{s.id}: {sign} de {_money(abs(variance))} "
                            f"en el arqueo. Revisar."),
                    page="pos", id=f"pos_var_{s.id}",
                    amount=abs(variance),
                ))
    except Exception as exc:
        print(f"[notifications] pos alerts failed: {exc}")

    # ── RH: nómina próxima + obligaciones patronales ──────────────────
    try:
        today = datetime.now(timezone.utc).date()
        _, last_day = monthrange(today.year, today.month)

        # ISN estatal — se paga los primeros 15 del mes siguiente
        if today.day <= 15:
            deadline = today.replace(day=15)
            days_left = (deadline - today).days
            if days_left <= 10:
                items.append(schemas.Notification(
                    kind="tax", severity="critical" if days_left <= 3 else "warning",
                    title="ISN estatal por pagar",
                    detail=f"Vence el 15 de este mes — quedan {days_left} días.",
                    page="rh", id=f"tax_isn_{today.year}_{today.month}",
                    due_date=datetime.combine(deadline, datetime.min.time(), tzinfo=timezone.utc),
                ))
        # IMSS mensual — se paga hasta el 17 del mes siguiente
        if today.day <= 17:
            deadline = today.replace(day=17)
            days_left = (deadline - today).days
            if days_left <= 10:
                items.append(schemas.Notification(
                    kind="tax", severity="critical" if days_left <= 3 else "warning",
                    title="Cuotas IMSS por pagar",
                    detail=f"Vencen el 17 de este mes — quedan {days_left} días.",
                    page="rh", id=f"tax_imss_{today.year}_{today.month}",
                    due_date=datetime.combine(deadline, datetime.min.time(), tzinfo=timezone.utc),
                ))
        # INFONAVIT/FONACOT bimestral (meses pares hasta el 17)
        if today.month % 2 == 1 and today.day <= 17:
            deadline = today.replace(day=17)
            days_left = (deadline - today).days
            if days_left <= 10:
                items.append(schemas.Notification(
                    kind="tax", severity="critical" if days_left <= 3 else "warning",
                    title="INFONAVIT/FONACOT bimestral",
                    detail=f"Vencen el 17 — quedan {days_left} días.",
                    page="rh", id=f"tax_infonavit_{today.year}_{today.month}",
                    due_date=datetime.combine(deadline, datetime.min.time(), tzinfo=timezone.utc),
                ))
        # Nómina quincenal: alertar 2 días antes del 15 y último día
        for target_day in (15, last_day):
            if today.day <= target_day:
                target = today.replace(day=target_day)
                days_left = (target - today).days
                if 0 <= days_left <= 2:
                    items.append(schemas.Notification(
                        kind="hr", severity="info" if days_left > 0 else "warning",
                        title=f"Nómina del {target_day}",
                        detail=(f"Programada para el {target_day} — {days_left} días. "
                                f"Revisar altas/bajas del período."),
                        page="rh", id=f"hr_payroll_{today.year}_{today.month}_{target_day}",
                        due_date=datetime.combine(target, datetime.min.time(), tzinfo=timezone.utc),
                    ))
    except Exception as exc:
        print(f"[notifications] hr/tax alerts failed: {exc}")

    # ── Forecast: metas del mes ──────────────────────────────────────
    try:
        from app.modules.forecast import service as fc_service
        from app.modules.forecast import models as fc_models
        res_plans = await db.execute(
            select(fc_models.ForecastPlan).where(fc_models.ForecastPlan.status == "active")
        )
        plans = res_plans.scalars().all()
        if plans:
            plan = plans[0]  # Plan activo principal
            rollup = await fc_service.rollup(db, plan.id)
            # rollup.total tiene: baseline / plan / actual (aprox)
            plan_total = float(getattr(rollup, "plan_total", 0) or 0)
            actual = float(getattr(rollup, "actual_total", 0) or 0)
            today = datetime.now(timezone.utc).date()
            days_in_year = 365 if not (today.year % 4 == 0) else 366
            day_of_year = (today - today.replace(month=1, day=1)).days + 1
            expected_progress = plan_total * day_of_year / days_in_year
            gap = expected_progress - actual
            if plan_total > 0 and gap > plan_total * 0.05:  # >5% atraso
                pct = actual / plan_total * 100 if plan_total else 0
                items.append(schemas.Notification(
                    kind="forecast", severity="warning" if gap < plan_total * 0.15 else "critical",
                    title=f"Ventas atrasadas vs meta ({pct:.0f}%)",
                    detail=(f"Real {_money(actual)} vs esperado {_money(expected_progress)}. "
                            f"Faltan {_money(gap)} para estar en línea."),
                    page="forecast", id=f"fc_{plan.id}",
                    amount=gap,
                ))
    except Exception as exc:
        print(f"[notifications] forecast alerts failed: {exc}")

    # ── Ordenar: critical > warning > info; luego por monto/due_date desc
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    items.sort(key=lambda n: (
        sev_rank.get(n.severity, 3),
        -(n.amount or 0),
        n.due_date or datetime.max.replace(tzinfo=timezone.utc),
    ))

    critical = sum(1 for n in items if n.severity == "critical")
    warning = sum(1 for n in items if n.severity == "warning")
    info = sum(1 for n in items if n.severity == "info")
    by_category: dict = {}
    for n in items:
        by_category[n.kind] = by_category.get(n.kind, 0) + 1
    return schemas.NotificationDigest(
        total=len(items), critical=critical, warning=warning, info=info,
        by_category=by_category, items=items,
    )


def _digest_html(digest: schemas.NotificationDigest, company_name: str) -> str:
    if not digest.items:
        return f"<p>{company_name}: no hay avisos pendientes. 🎉</p>"
    kind_labels = {
        "inventory": "Inventario", "cxc": "Cartera", "cxp": "Cuentas por pagar",
        "pos": "Punto de venta", "hr": "Recursos humanos", "tax": "Impuestos",
        "forecast": "Metas de venta", "finance": "Finanzas",
    }
    rows = []
    for n in digest.items[:40]:
        color = {"critical": "#e5484d", "warning": "#f5a623", "info": "#2563eb"}.get(n.severity, "#64748b")
        rows.append(
            f'<tr>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:{color};font-weight:700;vertical-align:top;">●</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">'
            f'<b style="color:#0f172a;">{n.title}</b>'
            f' <span style="color:#94a3b8;font-size:11px;">{kind_labels.get(n.kind, n.kind)}</span><br>'
            f'<span style="color:#475569;font-size:13px;">{n.detail}</span>'
            f'</td>'
            f'</tr>'
        )
    return (
        f'<h2 style="color:#1e293b;margin-bottom:4px;">Resumen de avisos · {company_name}</h2>'
        f'<p style="color:#64748b;margin-top:0;">'
        f'{digest.critical} críticos · {digest.warning} advertencias · {digest.info} informativos'
        f'</p>'
        f'<table style="border-collapse:collapse;width:100%;max-width:640px;">{"".join(rows)}</table>'
    )


async def email_digest(db: AsyncSession, to: str) -> schemas.EmailDigestResult:
    from app.core.email import send_email
    from app.modules.core_config import service as config_service

    if not to:
        return schemas.EmailDigestResult(sent=False, to="", count=0)
    digest = await build_digest(db)
    company = await config_service.get_company_profile(db)
    company_name = getattr(company, "legal_name", None) or "Sthenova"
    html = _digest_html(digest, company_name)
    sent = await send_email(db, to=to, subject=f"Resumen de avisos · {company_name}", body_html=html)
    return schemas.EmailDigestResult(sent=sent, to=to, count=digest.total)
