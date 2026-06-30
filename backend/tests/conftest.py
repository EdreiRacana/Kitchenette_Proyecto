import os
import asyncio
import tempfile

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Base de datos SQLite aislada y desechable para los tests, nunca la de
# desarrollo/producción. Debe fijarse ANTES de importar app.main, porque
# app.core.config.Settings resuelve la URL de conexión al importarse.
_TMP_DB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP_DB.name}"
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")

from app.main import app  # noqa: E402
from app.db.session import engine, Base  # noqa: E402


@pytest_asyncio.fixture(autouse=True, scope="session")
async def _create_schema():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
