
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.logging import configure_logging, get_logger
from app.core.tenancy import tenancy_middleware
from app.api.v1.api import api_router

configure_logging()
logger = get_logger("app.main")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ALLOWED_ORIGINS = [
    "https://sthenova-frontend.onrender.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(tenancy_middleware)

from fastapi.staticfiles import StaticFiles
from app.api.v1.endpoints import media

app.mount("/static", StaticFiles(directory="uploads"), name="static")

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(media.router, prefix=f"{settings.API_V1_STR}/media", tags=["media"])

@app.get("/health")
def health_check():
    return {"status": "ok", "app_name": settings.PROJECT_NAME}


@app.get("/health/audit")
async def audit_check(token: str = ""):
    """Diagnostico de integridad de datos multi-tenant. Devuelve conteos y
    filas sospechosas sin exponer detalle sensible. Protegido por token
    fijo en env HEALTH_AUDIT_TOKEN (si no esta seteado, requiere que el
    caller ya este autenticado como superuser — se hara chequeo en el flow)."""
    import os
    from sqlalchemy import text
    from app.db.session import AsyncSessionLocal
    expected = os.environ.get("HEALTH_AUDIT_TOKEN", "").strip()
    if not expected:
        # Sin token configurado: devuelve solo indicador basico, no detalles
        return {"status": "audit disabled", "reason": "set HEALTH_AUDIT_TOKEN env var"}
    if token != expected:
        return {"status": "forbidden"}

    async with AsyncSessionLocal() as db:
        # 1) Stock negativo (bug historico corregido en PR 293)
        r = await db.execute(text(
            "SELECT COUNT(*)::int AS c, COALESCE(MIN(quantity),0)::int AS min_q "
            "FROM stock_levels WHERE quantity < 0"))
        row = r.first()
        negative_stock = {"rows": row.c, "min_quantity": row.min_q}

        # 2) Ordenes timbradas sin company_id
        r = await db.execute(text(
            "SELECT COUNT(*)::int FROM orders "
            "WHERE cfdi_uuid IS NOT NULL AND company_id IS NULL"))
        stamped_no_tenant = r.scalar() or 0

        # 3) Duplicados de cfdi_uuid (deberian ser 0 con el UNIQUE del PR)
        r = await db.execute(text(
            "SELECT COUNT(*)::int FROM ("
            "  SELECT cfdi_uuid FROM orders WHERE cfdi_uuid IS NOT NULL "
            "  GROUP BY cfdi_uuid HAVING COUNT(*) > 1) t"))
        duplicate_uuids = r.scalar() or 0

        # 4) Clientes con company_id NULL (datos huerfanos)
        r = await db.execute(text(
            "SELECT COUNT(*)::int FROM customers WHERE company_id IS NULL"))
        orphan_customers = r.scalar() or 0

        # 5) StockLevels con company_id NULL
        r = await db.execute(text(
            "SELECT COUNT(*)::int FROM stock_levels WHERE company_id IS NULL"))
        orphan_stock = r.scalar() or 0

        # 6) Total empresas activas
        r = await db.execute(text(
            "SELECT COUNT(*)::int FROM company_profile WHERE is_active = true"))
        active_companies = r.scalar() or 0

        alerts = []
        if negative_stock["rows"] > 0:
            alerts.append(f"CRITICO: {negative_stock['rows']} filas de stock negativo "
                          f"(min={negative_stock['min_quantity']}). Investigar y corregir.")
        if stamped_no_tenant > 0:
            alerts.append(f"CRITICO: {stamped_no_tenant} facturas timbradas sin company_id. "
                          "Backfill urgente.")
        if duplicate_uuids > 0:
            alerts.append(f"CRITICO: {duplicate_uuids} UUIDs de CFDI duplicados en ordenes.")
        if orphan_customers > 0:
            alerts.append(f"AVISO: {orphan_customers} clientes sin company_id (huerfanos).")
        if orphan_stock > 0:
            alerts.append(f"AVISO: {orphan_stock} stock_levels sin company_id (huerfanos).")

        return {
            "status": "ok" if not alerts else "alerts",
            "companies_active": active_companies,
            "checks": {
                "negative_stock": negative_stock,
                "stamped_orders_no_tenant": stamped_no_tenant,
                "duplicate_cfdi_uuids": duplicate_uuids,
                "orphan_customers": orphan_customers,
                "orphan_stock_levels": orphan_stock,
            },
            "alerts": alerts,
        }

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url)
    headers = {}
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."}, headers=headers)

from app.db.session import engine, Base

# Import all models to ensure registration
from app.modules.auth import models as auth_models
from app.modules.inventory import models as inventory_models
from app.modules.customers import models as customer_models
from app.modules.sales import models as sales_models
from app.modules.sales import credit_notes_models as sales_credit_notes_models  # noqa: F401
from app.modules.finance import models as finance_models
from app.modules.accounting import models as accounting_models
# IMPORTANT: this import registers every company-owned accounting entity with
# the tenancy layer and installs the backwards-compatible DB upgrade listener.
from app.modules.accounting import tenant_bridge as accounting_tenant_bridge  # noqa: F401
from app.modules.core_config import models as config_models
from app.modules.hr import models as hr_models
from app.modules.forecast import models as forecast_models
from app.modules.retail import models as retail_models
from app.modules.promotions import models as promotions_models
from app.modules.marketplaces import models as marketplaces_models
from app.modules.reports import models as reports_models


@app.on_event("startup")
async def startup():
    from app.db.migrations import run_startup_migrations
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await run_startup_migrations(engine)
    except Exception as e:
        logger.error("Init de BD diferido en el arranque (¿BD en pausa?): %s", e)

    try:
        from app.db.session import AsyncSessionLocal
        from app.modules.auth.rbac import seed_rbac
        async with AsyncSessionLocal() as session:
            await seed_rbac(session)
    except Exception as e:
        logger.warning("RBAC seed skipped", extra={"error": str(e)})

    try:
        from app.db.session import AsyncSessionLocal
        from app.modules.inventory import batch_service
        async with AsyncSessionLocal() as session:
            r = await batch_service.sweep_expired_to_scrap(session, user_id=None)
            if r.get("lots_expired", 0) > 0:
                logger.info("Auto-merma perecederos al arranque: %s lote(s), $%s", r["lots_expired"], r.get("total_value_written_off", 0.0))
    except Exception as e:
        logger.warning("Sweep de caducados omitido: %s", e)

    try:
        import os, time
        marker = "/tmp/sthenova_expiry_alert.ts"
        should_run = True
        try:
            if os.path.exists(marker):
                last = float(open(marker).read().strip() or "0")
                if time.time() - last < 20 * 3600:
                    should_run = False
        except Exception:
            pass
        if should_run:
            from app.db.session import AsyncSessionLocal
            from app.modules.inventory import batch_service
            async with AsyncSessionLocal() as session:
                res = await batch_service.notify_expiring_by_email(session, only_critical=True, days=7)
                if res.get("sent"):
                    logger.info("Alerta perecederos enviada a %s (%s lotes)", res.get("to"), res.get("rows_notified"))
                    try:
                        open(marker, "w").write(str(time.time()))
                    except Exception:
                        pass
                elif res.get("reason") and res.get("reason") != "Sin lotes por avisar":
                    logger.warning("Alerta perecederos no enviada: %s", res.get("reason"))
    except Exception as e:
        logger.warning("Alerta diaria perecederos omitida: %s", e)

    try:
        from app.db.session import AsyncSessionLocal
        from app.modules.accounting import service as acc
        async with AsyncSessionLocal() as session:
            await acc.seed_default_chart(session)
            await acc.ensure_default_map(session)
    except Exception as e:
        logger.warning("Accounting seed skipped", extra={"error": str(e)})

    try:
        from app.db.session import AsyncSessionLocal
        from sqlalchemy import select as _sel
        from app.modules.core_config import models as _cfg
        from app.modules.auth.models import User as _User
        async with AsyncSessionLocal() as session:
            company = (await session.execute(_sel(_cfg.CompanyProfile).where(_cfg.CompanyProfile.is_active == True).limit(1))).scalars().first()
            if not company:
                company = (await session.execute(_sel(_cfg.CompanyProfile).limit(1))).scalars().first()
            if company:
                users = (await session.execute(_sel(_User.id))).all()
                for (uid,) in users:
                    existing = (await session.execute(_sel(_cfg.UserCompany).where(_cfg.UserCompany.user_id == uid, _cfg.UserCompany.company_id == company.id))).scalars().first()
                    if existing is None:
                        session.add(_cfg.UserCompany(user_id=uid, company_id=company.id, role_in_company="admin", is_default=True))
                await session.commit()
    except Exception as e:
        logger.warning("Multi-company seed skipped", extra={"error": str(e)})

    from app.core.scheduler import start_scheduler
    start_scheduler()


@app.on_event("shutdown")
async def shutdown():
    from app.core.scheduler import _scheduler
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
