"""Server-side notification digest.

Aggregates the operational alerts that matter across modules — low/out-of-stock
inventory, overdue & upcoming receivables/payables, and scheduled payments due —
into a single list the bell can show and that can be emailed as a digest. The
logic mirrors what the frontend bell already computes client-side, but having it
server-side lets us email it without the browser open.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from . import schemas

REMINDER_LEAD_DAYS = 2


def _money(v: float) -> str:
    return f"${(v or 0):,.2f}"


async def build_digest(db: AsyncSession) -> schemas.NotificationDigest:
    items: list[schemas.Notification] = []

    # ── Inventory: reorder / out-of-stock ──────────────────────────────
    try:
        from app.modules.inventory import service as inv_service
        for a in await inv_service.get_reorder_alerts(db):
            out = a.available <= 0
            items.append(schemas.Notification(
                kind="inventory",
                severity="critical" if out else "warning",
                title=a.product_name,
                detail=(f"Agotado · {a.warehouse_name}" if out
                        else f"Stock bajo: {a.available} disponibles · {a.warehouse_name}"),
                page="inventario", query=a.product_name,
            ))
    except Exception as exc:  # noqa: BLE001
        print(f"[notifications] inventory alerts failed: {exc}")

    horizon = (datetime.now(timezone.utc) + timedelta(days=REMINDER_LEAD_DAYS)).date()

    def _due_soon_or_overdue(aging_item) -> bool:
        if aging_item.status == "overdue":
            return True
        return bool(aging_item.due_date and aging_item.due_date.date() <= horizon)

    # ── Finance: receivables / payables ────────────────────────────────
    try:
        from app.modules.finance import service as fin_service
        for i in await fin_service.get_cxc(db):
            if not _due_soon_or_overdue(i):
                continue
            overdue = i.status == "overdue"
            items.append(schemas.Notification(
                kind="cxc", severity="critical" if overdue else "warning",
                title=i.name,
                detail=(f"Por cobrar {'vencido' if overdue else 'próximo'}: {_money(i.balance)} · {i.reference}"),
                page="finanzas", query=i.name,
            ))
        for i in await fin_service.get_cxp(db):
            if not _due_soon_or_overdue(i):
                continue
            overdue = i.status == "overdue"
            items.append(schemas.Notification(
                kind="cxp", severity="critical" if overdue else "warning",
                title=i.name,
                detail=(f"Por pagar {'vencido' if overdue else 'próximo'}: {_money(i.balance)} · {i.reference}"),
                page="finanzas", query=i.name,
            ))
    except Exception as exc:  # noqa: BLE001
        print(f"[notifications] finance alerts failed: {exc}")

    critical = sum(1 for n in items if n.severity == "critical")
    warning = sum(1 for n in items if n.severity == "warning")
    return schemas.NotificationDigest(total=len(items), critical=critical, warning=warning, items=items)


def _digest_html(digest: schemas.NotificationDigest, company_name: str) -> str:
    if not digest.items:
        return f"<p>{company_name}: no hay avisos pendientes. 🎉</p>"
    rows = []
    for n in digest.items:
        color = {"critical": "#e5484d", "warning": "#f5a623", "info": "#2563eb"}.get(n.severity, "#64748b")
        rows.append(
            f'<tr>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:{color};font-weight:700;">●</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;"><b>{n.title}</b><br>'
            f'<span style="color:#64748b;font-size:13px;">{n.detail}</span></td>'
            f'</tr>'
        )
    return (
        f'<h2 style="color:#1e293b;">Resumen de avisos · {company_name}</h2>'
        f'<p style="color:#64748b;">{digest.critical} críticos · {digest.warning} advertencias</p>'
        f'<table style="border-collapse:collapse;width:100%;max-width:560px;">{"".join(rows)}</table>'
    )


async def email_digest(db: AsyncSession, to: str) -> schemas.EmailDigestResult:
    from app.core.email import send_email
    from app.modules.core_config import service as config_service

    if not to:
        return schemas.EmailDigestResult(sent=False, to="", count=0)
    digest = await build_digest(db)
    company = await config_service.get_company_profile(db)
    company_name = getattr(company, "legal_name", None) or "Kitchenette"
    html = _digest_html(digest, company_name)
    sent = await send_email(db, to=to, subject=f"Resumen de avisos · {company_name}", body_html=html)
    return schemas.EmailDigestResult(sent=sent, to=to, count=digest.total)
