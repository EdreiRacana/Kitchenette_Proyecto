from fastapi import APIRouter

api_router = APIRouter()

from app.modules.auth.router import router as auth_router
from app.modules.inventory.router import router as inventory_router

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["inventory"])

from app.modules.customers.router import router as customers_router
from app.modules.sales.router import router as sales_router
from app.modules.finance.router import router as finance_router
from app.modules.core_config.router import router as config_router

api_router.include_router(customers_router, prefix="/customers", tags=["customers"])
api_router.include_router(sales_router, prefix="/sales", tags=["sales"])
api_router.include_router(finance_router, prefix="/finance", tags=["finance"])
api_router.include_router(config_router, prefix="/config", tags=["configuration"])

@api_router.get("/")
async def root():
    return {"message": "Welcome to Nexus ERP API"}
