from fastapi import APIRouter, Depends

from app.api.deps import module_write_guard

api_router = APIRouter()

from app.modules.auth.router import router as auth_router
from app.modules.inventory.router import router as inventory_router
from app.modules.customers.router import router as customers_router
from app.modules.sales.router import router as sales_router
from app.modules.sales.returns_router import router as returns_router
from app.modules.finance.router import router as finance_router
from app.modules.accounting.router import router as accounting_router
from app.modules.core_config.router import router as config_router
from app.modules.ingesta.router import router as ingesta_router
from app.modules.hr.router import router as hr_router
from app.modules.pos.router import router as pos_router
from app.modules.search.router import router as search_router
from app.modules.notifications.router import router as notifications_router
from app.modules.forecast.router import router as forecast_router

# Defensa en profundidad: las escrituras (POST/PUT/PATCH/DELETE) a cada módulo
# operativo exigen el permiso del rol (las lecturas quedan abiertas; el menú ya
# las oculta por rol). auth (login/setup) y config (con guards propios) no se
# envuelven aquí.
api_router.include_router(auth_router,      prefix="/auth",       tags=["auth"])
api_router.include_router(inventory_router, prefix="/inventory",  tags=["inventory"], dependencies=[Depends(module_write_guard("inventory"))])
api_router.include_router(customers_router, prefix="/customers",  tags=["customers"], dependencies=[Depends(module_write_guard("customers"))])
# Devoluciones: ANTES de /sales para que /sales/returns no choque con /sales/{order_id}
api_router.include_router(returns_router,    prefix="/sales/returns", tags=["sales"], dependencies=[Depends(module_write_guard("sales"))])
api_router.include_router(sales_router,     prefix="/sales",      tags=["sales"], dependencies=[Depends(module_write_guard("sales"))])
api_router.include_router(forecast_router,  prefix="/forecast",   tags=["forecast"], dependencies=[Depends(module_write_guard("sales"))])
api_router.include_router(finance_router,   prefix="/finance",    tags=["finance"], dependencies=[Depends(module_write_guard("finance"))])
api_router.include_router(accounting_router, prefix="/accounting", tags=["accounting"], dependencies=[Depends(module_write_guard("accounting"))])
api_router.include_router(config_router,    prefix="/config",     tags=["configuration"])
api_router.include_router(ingesta_router,   prefix="/ingesta",    tags=["ingesta"])
api_router.include_router(hr_router,        prefix="/hr",         tags=["hr"], dependencies=[Depends(module_write_guard("hr"))])
api_router.include_router(pos_router,       prefix="/pos",        tags=["pos"], dependencies=[Depends(module_write_guard("sales"))])
api_router.include_router(search_router,    prefix="/search",     tags=["search"])
api_router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])

@api_router.get("/")
async def root():
    return {"message": "Welcome to STHENOVA ERP API"}
