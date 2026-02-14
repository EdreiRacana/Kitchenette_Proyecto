from fastapi import APIRouter

api_router = APIRouter()

from app.modules.auth.router import router as auth_router

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])

@api_router.get("/")
async def root():
    return {"message": "Welcome to Nexus ERP API"}
