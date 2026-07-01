"""Lógica compartida de borrado total de datos operativos, usada tanto por
`scripts/reset_prod_data.py` (CLI, con confirmaciones interactivas) como por
el endpoint protegido `POST /config/danger/reset-data` (botón de superusuario
en Configuración → Seguridad)."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import settings
from app.db.session import Base

# Configuración estructural de la empresa: se conserva, no es "dato de prueba".
KEEP_TABLES = {"company_profile", "branches", "system_integrations"}


def tables_to_wipe() -> list[str]:
    # Importar los routers registra todos los modelos en Base.metadata.
    from app.api.v1 import api as _api  # noqa: F401

    all_tables = [t.name for t in Base.metadata.sorted_tables]
    return [t for t in all_tables if t not in KEEP_TABLES]


async def wipe_operational_data(engine: AsyncEngine) -> list[str]:
    uri = settings.SQLALCHEMY_DATABASE_URI or ""
    if uri.startswith("sqlite"):
        raise ValueError(
            "Esto apunta a SQLite (base local de desarrollo), no a producción. Abortado."
        )
    tables = tables_to_wipe()
    quoted = ", ".join(f'"{t}"' for t in tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
    return tables


async def reseed_after_wipe() -> None:
    from app.db.session import AsyncSessionLocal
    from app.modules.auth.rbac import seed_rbac

    async with AsyncSessionLocal() as db:
        await seed_rbac(db)
        await db.commit()
