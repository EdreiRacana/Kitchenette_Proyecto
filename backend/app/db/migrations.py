"""
Idempotent startup migrations.

Why this exists:
  `Base.metadata.create_all` only creates *missing tables*; it never alters a
  table that already exists. When we add columns to an existing model (e.g. the
  professional Customer fields), a live Postgres table needs ALTER statements.

  This module applies those ALTERs automatically on every startup. It is safe to
  run repeatedly because every statement uses IF NOT EXISTS, so once a column or
  index exists the statement is a no-op.

  Postgres only: on SQLite (local dev) `create_all` already builds the table with
  every column from the model, and SQLite doesn't support `ADD COLUMN IF NOT
  EXISTS`, so we skip it there.

Note: this is a lightweight, pragmatic migration mechanism that fits the app's
current "create_all on startup" approach. For full version-controlled migrations
(up/down, history), the next step up is Alembic run as a Render pre-deploy
command — see the notes shipped with the customers module.
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Each entry is a single, idempotent DDL/DML statement.
_CUSTOMER_STATEMENTS = [
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_number    VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS client_type      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS razon_social     VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS nombre_comercial VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc              VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS regimen_fiscal   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS uso_cfdi         VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuenta_contable  VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS sucursal         VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list       VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_days      INTEGER DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_amount    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS discount_pact    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_number   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_agent      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_agent     VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS how_heard        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phones           TEXT",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS pais             VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS estado           VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS municipio        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS localidad        VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS calle            VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS colonia          VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_postal    VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_exterior      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_interior      VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_colonia   VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS codigo_localidad VARCHAR",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS referencia       TEXT",
    "ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes            TEXT",
    # Backfill existing rows.
    "UPDATE customers SET client_number = 'CLI-' || lpad(id::text, 5, '0') WHERE client_number IS NULL",
    "UPDATE customers SET client_type = 'Contado' WHERE client_type IS NULL",
    "UPDATE customers SET pais = 'México' WHERE pais IS NULL",
    "UPDATE customers SET uso_cfdi = 'G03' WHERE uso_cfdi IS NULL",
    "UPDATE customers SET cuenta_contable = '105-01-001' WHERE cuenta_contable IS NULL",
    # Indexes for search/filter.
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_client_number ON customers (client_number)",
    "CREATE INDEX IF NOT EXISTS ix_customers_client_type ON customers (client_type)",
    "CREATE INDEX IF NOT EXISTS ix_customers_sucursal    ON customers (sucursal)",
    "CREATE INDEX IF NOT EXISTS ix_customers_rfc         ON customers (rfc)",
]


def _apply(sync_conn: Connection) -> None:
    # Postgres only — SQLite already has the full schema from create_all.
    if sync_conn.dialect.name != "postgresql":
        return
    for stmt in _CUSTOMER_STATEMENTS:
        sync_conn.execute(text(stmt))


async def run_startup_migrations(conn) -> None:
    """Call inside the same `engine.begin()` block as create_all.

    `conn` is an AsyncConnection; we hop to a sync Connection via run_sync so the
    DDL executes with normal sync semantics.
    """
    await conn.run_sync(_apply)
