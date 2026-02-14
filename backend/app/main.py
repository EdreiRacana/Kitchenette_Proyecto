from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.api import api_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
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
