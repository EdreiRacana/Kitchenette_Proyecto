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

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
