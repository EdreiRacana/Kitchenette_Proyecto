import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

class Base(DeclarativeBase):
    pass

# echo=True registra CADA sentencia SQL. En Render free (CPU limitada) ese
# flood de logging por request lo vuelve lento y llena los logs, dificultando
# ver los errores de verdad. Queda APAGADO por defecto (en cualquier entorno) y
# solo se activa a mano poniendo SQL_ECHO=1 para depurar.
_sql_echo = os.getenv("SQL_ECHO") in ("1", "true", "True")

engine = create_async_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=_sql_echo,
    pool_pre_ping=True,
    pool_recycle=300,
)
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

# Multi-tenancy: instala event listeners globales que filtran queries y
# auto-asignan company_id al crear. Los modelos declaran su participación
# con TenantScopedMixin — el resto es transparente. Ver app/core/tenancy.py.
from app.core.tenancy import install_tenancy as _install_tenancy  # noqa: E402
_install_tenancy(AsyncSession)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
