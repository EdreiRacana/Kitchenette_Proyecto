"""Endpoints de sistema: health check ampliado, info, backup.

/health           - público, sin auth (para UptimeRobot / Render probes)
/system/info      - protegido, retorna contadores agregados del negocio
/system/backup    - protegido, retorna ZIP con dumps JSON
"""
from __future__ import annotations
import io
import json
import time
import zipfile
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api import deps
from app.core.logging import get_logger
from app.modules.auth.models import User

log = get_logger(__name__)
router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]

# Timestamp de arranque del proceso — para reportar uptime
_STARTED_AT = time.time()
APP_VERSION = "1.0.0"


@router.get("/health")
async def health_check_extended(db: DB):
    """Health check ampliado. Verifica que la DB responde.
    Se puede monitorear con UptimeRobot, StatusCake, etc.
    Sin auth para que los health checkers externos puedan llegar."""
    started_iso = datetime.fromtimestamp(_STARTED_AT, tz=timezone.utc).isoformat()
    uptime_s = int(time.time() - _STARTED_AT)
    checks: dict = {"db": {"ok": False, "latency_ms": None}}
    try:
        t0 = time.time()
        await db.execute(text("SELECT 1"))
        checks["db"] = {"ok": True, "latency_ms": round((time.time() - t0) * 1000, 1)}
    except Exception as e:
        checks["db"] = {"ok": False, "error": str(e)[:200]}
        log.error("Health check DB failed", extra={"error": str(e)})
    overall_ok = all(c.get("ok") for c in checks.values())
    return {
        "status": "ok" if overall_ok else "degraded",
        "version": APP_VERSION,
        "started_at": started_iso,
        "uptime_seconds": uptime_s,
        "uptime_human": _format_uptime(uptime_s),
        "checks": checks,
    }


def _format_uptime(seconds: int) -> str:
    d, r = divmod(seconds, 86400)
    h, r = divmod(r, 3600)
    m, _ = divmod(r, 60)
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


@router.get("/info")
async def system_info(db: DB, _: CurrentUser):
    """Info agregada del sistema — contadores por módulo, útil para
    dashboard de admin y validación de estado."""
    from app.modules.customers import models as cust
    from app.modules.inventory import models as inv
    from app.modules.sales import models as sales
    from app.modules.pos import models as pos
    from app.modules.finance import models as fin
    from app.modules.accounting import models as acc

    async def _count(model) -> int:
        try:
            r = await db.execute(select(func.count()).select_from(model))
            return int(r.scalar() or 0)
        except Exception:
            return -1

    counts = {
        "customers":       await _count(cust.Customer),
        "products":        await _count(inv.Product),
        "variants":        await _count(inv.ProductVariant),
        "warehouses":      await _count(inv.Warehouse),
        "suppliers":       await _count(inv.Supplier),
        "purchase_orders": await _count(inv.PurchaseOrder),
        "orders":          await _count(sales.Order),
        "payments":        await _count(sales.Payment),
        "pos_terminals":   await _count(pos.POSTerminal),
        "pos_sessions":    await _count(pos.POSSession),
        "bank_accounts":   await _count(fin.BankAccount),
        "transactions":    await _count(fin.Transaction),
        "accounts":        await _count(acc.Account),
        "journal_entries": await _count(acc.JournalEntry),
        "period_closes":   await _count(acc.PeriodClose),
    }
    return {
        "version": APP_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "counts": counts,
        "total_records": sum(v for v in counts.values() if v > 0),
    }


@router.get("/backup")
async def system_backup(db: DB, current_user: CurrentUser):
    """Genera un ZIP con dumps JSON de las tablas principales.
    Sólo superusuario — es sensible (datos completos del negocio)."""
    if not current_user.is_superuser:
        raise HTTPException(403, "Sólo el superusuario puede descargar backups")

    from app.modules.customers import models as cust
    from app.modules.inventory import models as inv
    from app.modules.sales import models as sales
    from app.modules.pos import models as pos
    from app.modules.finance import models as fin
    from app.modules.accounting import models as acc

    tables = [
        ("customers",         cust.Customer),
        ("products",          inv.Product),
        ("product_variants",  inv.ProductVariant),
        ("warehouses",        inv.Warehouse),
        ("stock_lots",        inv.StockLot),
        ("stock_movements",   inv.StockMovement),
        ("suppliers",         inv.Supplier),
        ("purchase_orders",   inv.PurchaseOrder),
        ("orders",            sales.Order),
        ("order_items",       sales.OrderItem),
        ("payments",          sales.Payment),
        ("pos_terminals",     pos.POSTerminal),
        ("pos_sessions",      pos.POSSession),
        ("pos_transactions",  pos.POSTransaction),
        ("bank_accounts",     fin.BankAccount),
        ("bank_transactions", fin.BankTransaction),
        ("transactions",      fin.Transaction),
        ("accounting_accounts",       acc.Account),
        ("accounting_journal_entries", acc.JournalEntry),
        ("accounting_journal_lines",   acc.JournalLine),
        ("accounting_period_close",    acc.PeriodClose),
    ]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {"generated_at": datetime.now(timezone.utc).isoformat(),
                    "version": APP_VERSION, "tables": {}}
        for name, model in tables:
            try:
                res = await db.execute(select(model))
                rows = res.scalars().all()
                data = []
                for row in rows:
                    row_dict = {}
                    for col in row.__table__.columns:
                        val = getattr(row, col.name, None)
                        # Serializar tipos comunes (datetime, bytes)
                        if isinstance(val, (datetime,)):
                            row_dict[col.name] = val.isoformat()
                        elif isinstance(val, (bytes, bytearray)):
                            row_dict[col.name] = f"<binary:{len(val)}bytes>"
                        else:
                            row_dict[col.name] = val
                    data.append(row_dict)
                zf.writestr(f"{name}.json", json.dumps(data, indent=2, default=str, ensure_ascii=False))
                manifest["tables"][name] = len(data)
            except Exception as e:
                log.warning(f"Backup falló para {name}", extra={"error": str(e)})
                manifest["tables"][name] = {"error": str(e)[:200]}
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

    log.info("System backup generado", extra={"user_id": current_user.id, "tables": len(tables)})
    fname = f"sthenova_backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
