from fastapi import APIRouter

api_router = APIRouter()

from app.modules.auth.router import router as auth_router
from app.modules.inventory.router import router as inventory_router

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])

@api_router.get("/")
async def root():
    return {"message": "Welcome to Nexus ERP API"}
