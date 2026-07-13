
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.logging import configure_logging, get_logger
from app.api.v1.api import api_router

# Configurar logging ANTES de que se cree cualquier logger — así todos
# los módulos de la app comparten la misma configuración estructurada.
configure_logging()
logger = get_logger("app.main")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────────────────────
# IMPORTANTE: con allow_credentials=True NO se puede usar allow_origins=["*"].
# El estándar CORS lo prohíbe, y FastAPI entonces omite el header
# Access-Control-Allow-Origin → el navegador bloquea todo. Por eso listamos
# los orígenes explícitos del frontend (producción + desarrollo local).
ALLOWED_ORIGINS = [
    "https://sthenova-frontend.onrender.com",  # frontend en producción
    "http://localhost:5173",                   # Vite dev server
    "http://127.0.0.1:5173",
    "http://localhost:3000",                   # por si usas otro puerto
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.staticfiles import StaticFiles
from app.api.v1.endpoints import media

# Mount static directory for local file serving
app.mount("/static", StaticFiles(directory="uploads"), name="static")

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(media.router, prefix=f"{settings.API_V1_STR}/media", tags=["media"])


@app.get("/health")
def health_check():
    return {"status": "ok", "app_name": settings.PROJECT_NAME}


# Unhandled exceptions escape CORSMiddleware: el handler de Exception corre en
# ServerErrorMiddleware (la capa MÁS externa, por fuera de CORS), así que la
# respuesta 500 salía SIN Access-Control-Allow-Origin. El navegador la
# convertía en "Network Error" opaco y el frontend la reintentaba como si
# fuera un fallo de red. Por eso aquí agregamos las cabeceras CORS a mano.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url)
    headers = {}
    origin = request.headers.get("origin")
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."}, headers=headers)


# Auto-create tables on startup (for immediate local dev)
from app.db.session import engine, Base

# Import all models to ensure registration
from app.modules.auth import models as auth_models
from app.modules.inventory import models as inventory_models
from app.modules.customers import models as customer_models
from app.modules.sales import models as sales_models
from app.modules.finance import models as finance_models
from app.modules.accounting import models as accounting_models
from app.modules.core_config import models as config_models
from app.modules.hr import models as hr_models
from app.modules.forecast import models as forecast_models
from app.modules.retail import models as retail_models


@app.on_event("startup")
async def startup():
    from app.db.migrations import run_startup_migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Migrations run isolated (own connection) and can never crash startup.
    await run_startup_migrations(engine)

    # Seed RBAC (permisos + roles de sistema). Idempotente, nunca pisa datos.
    try:
        from app.db.session import AsyncSessionLocal
        from app.modules.auth.rbac import seed_rbac
        async with AsyncSessionLocal() as session:
            await seed_rbac(session)
    except Exception as e:
        logger.warning("RBAC seed skipped", extra={"error": str(e)})

    # Seed Contabilidad (catálogo de cuentas + mapeo para pólizas automáticas).
    # Sin esto, una venta no genera póliza contable (falla en silencio). Debe
    # existir out-of-the-box tras un reset o instalación nueva. Idempotente.
    try:
        from app.db.session import AsyncSessionLocal
        from app.modules.accounting import service as acc
        async with AsyncSessionLocal() as session:
            await acc.seed_default_chart(session)
            await acc.ensure_default_map(session)
    except Exception as e:
        logger.warning("Accounting seed skipped", extra={"error": str(e)})

    from app.core.scheduler import start_scheduler
    start_scheduler()


@app.on_event("shutdown")
async def shutdown():
    from app.core.scheduler import _scheduler
    if _scheduler.running:
        _scheduler.shutdown(wait=False)

