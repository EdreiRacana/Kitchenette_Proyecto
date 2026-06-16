from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.api import api_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
