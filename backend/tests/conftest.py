"""Fixtures compartidos para todos los tests.

Estrategia:
  - DB SQLite en memoria por test (async), aislada — no toca la DB real.
  - Al iniciar se crean TODAS las tablas del proyecto vía Base.metadata.
  - Fixtures: db, user, company, warehouse, product, variant, terminal, session, bank_account.
  - Cada test empieza limpio.

No hacemos matching contra Postgres específico (no usamos JSON, ARRAY,
BYTEA en tests). Los pocos módulos que dependen de PG los saltamos con
pytest.mark.skip.
"""
import os
import sys
import asyncio
from pathlib import Path

# Asegurar que el paquete `app` sea importable desde tests
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Configurar env ANTES de importar cualquier cosa de `app`
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-only-32chars")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker


@pytest.fixture(scope="session")
def event_loop():
    """Un solo event loop para toda la sesión — evita conflicts con asyncpg."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def engine():
    """Engine SQLite in-memory por test."""
    from app.db.session import Base
    # Importar todos los modelos para que se registren en Base.metadata
    from app.modules.auth import models as _auth  # noqa: F401
    from app.modules.core_config import models as _cfg  # noqa: F401
    from app.modules.inventory import models as _inv  # noqa: F401
    from app.modules.customers import models as _cust  # noqa: F401
    from app.modules.sales import models as _sales  # noqa: F401
    from app.modules.pos import models as _pos  # noqa: F401
    from app.modules.finance import models as _fin  # noqa: F401
    from app.modules.accounting import models as _acc  # noqa: F401
    from app.modules.forecast import models as _fc  # noqa: F401
    try:
        from app.modules.hr import models as _hr  # noqa: F401
    except Exception:
        pass

    eng = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False, future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture(scope="function")
async def db(engine) -> AsyncSession:
    """AsyncSession lista para usar en el test."""
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="function")
async def company(db):
    """CompanyProfile mínimo."""
    from app.modules.core_config import models as cfg
    cp = cfg.CompanyProfile(
        legal_name="Empresa Test SA de CV",
        commercial_name="Empresa Test",
        tax_id="AAA010101AAA",
        brand_color="#33B2F5",
    )
    db.add(cp)
    await db.commit()
    await db.refresh(cp)
    return cp


@pytest_asyncio.fixture(scope="function")
async def user(db):
    """Usuario para pruebas."""
    from app.modules.auth import models as auth_models
    u = auth_models.User(
        full_name="Test User",
        email="test@example.com",
        hashed_password="$2b$12$abcdefghijklmnopqrstuv",
        is_active=True,
        is_superuser=True,
        role="admin",
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest_asyncio.fixture(scope="function")
async def warehouse(db):
    """Almacén."""
    from app.modules.inventory import models as inv
    w = inv.Warehouse(name="Almacén Principal", type="own", is_active=True)
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


@pytest_asyncio.fixture(scope="function")
async def product(db):
    """Producto + variant básico."""
    from app.modules.inventory import models as inv
    p = inv.Product(name="Producto Test", is_active=True, item_type="finished_good")
    db.add(p)
    await db.flush()
    v = inv.ProductVariant(
        product_id=p.id, sku="TEST-001", barcode="7501234567890",
        price=116.0, cost_price=80.0, is_active=True,
    )
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return v


@pytest_asyncio.fixture(scope="function")
async def terminal(db, warehouse):
    """Terminal POS."""
    from app.modules.pos import models as pos_models
    t = pos_models.POSTerminal(
        name="Caja 1", code="CJ-01", warehouse_id=warehouse.id, is_active=True,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@pytest_asyncio.fixture(scope="function")
async def bank_account(db):
    """Cuenta bancaria."""
    from app.modules.finance import models as fin
    b = fin.BankAccount(name="BBVA Cheques", bank="BBVA", account_number="1234567890",
                        type="checking", balance=0.0, currency="MXN", is_active=True)
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b
