
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.api.v1.api import api_router

logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

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


# Unhandled exceptions otherwise escape CORSMiddleware (Starlette quirk), which
# makes the browser report a misleading "CORS blocked" instead of the real 500.
# Catching them here keeps the CORS headers and logs the real traceback.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."})


# Auto-create tables on startup (for immediate local dev)
from app.db.session import engine, Base

# Import all models to ensure registration
from app.modules.auth import models as auth_models
from app.modules.inventory import models as inventory_models
from app.modules.customers import models as customer_models
from app.modules.sales import models as sales_models
from app.modules.finance import models as finance_models
from app.modules.core_config import models as config_models


@app.on_event("startup")
async def startup():
    from app.db.migrations import run_startup_migrations
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Migrations run isolated (own connection) and can never crash startup.
    await run_startup_migrations(engine)

