"""
Idempotent startup migrations — resilient.

Why this exists:
  `Base.metadata.create_all` only creates *missing tables*; it never alters a
  table that already exists. When we add columns to an existing model (e.g. the
  professional Customer fields, or the Sales `kind`/money breakdown), a live
  Postgres table needs ALTER statements.

  This runs those ALTERs automatically on every startup. Safe to repeat: every
  statement uses IF NOT EXISTS, so once applied each is a no-op.

Design choices for safety:
  - Postgres only. On SQLite (local dev) `create_all` builds the full table from
    the model and SQLite lacks `ADD COLUMN IF NOT EXISTS`, so we skip it.
  - Each statement runs in its OWN transaction, so one failing statement can't
    poison the rest (in Postgres an error aborts the whole surrounding tx).
  - Any error is logged, never raised. A migration hiccup must NOT take the API
    down — the server always boots.

For full version-controlled migrations (history, up/down), the next step up is
Alembic run as a Render pre-deploy command (`alembic upgrade head`).
"""

from sqlalchemy import text
from sqlalchemy.engine import Connection

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
    "UPDATE customers SET client_number = 'CLI-' || lpad(id::text, 5, '0') WHERE client_number IS NULL",
    "UPDATE customers SET client_type = 'Contado' WHERE client_type IS NULL",
    "UPDATE customers SET pais = 'México' WHERE pais IS NULL",
    "UPDATE customers SET uso_cfdi = 'G03' WHERE uso_cfdi IS NULL",
    "UPDATE customers SET cuenta_contable = '105-01-001' WHERE cuenta_contable IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_client_number ON customers (client_number)",
    "CREATE INDEX IF NOT EXISTS ix_customers_client_type ON customers (client_type)",
    "CREATE INDEX IF NOT EXISTS ix_customers_sucursal    ON customers (sucursal)",
    "CREATE INDEX IF NOT EXISTS ix_customers_rfc         ON customers (rfc)",
]

# ── Sales: columnas añadidas a `orders` después del esquema original ─────────
# El modelo unifica pedidos y cotizaciones con `kind`, guarda el desglose de
# dinero explícito, control de cobranza (paid_amount) y snapshot CFDI.
# Todas con IF NOT EXISTS → si la columna ya existe, es no-op.
_SALES_STATEMENTS = [
    # Clasificación pedido/cotización (la que causaba el 500)
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind            VARCHAR DEFAULT 'order'",
    # Relaciones / metadatos
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse_id    INTEGER",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method  VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel         VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency        VARCHAR DEFAULT 'MXN'",
    # Desglose de dinero
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type   VARCHAR DEFAULT 'amount'",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_value  DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount      DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount    DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount     DOUBLE PRECISION DEFAULT 0",
    # Fechas
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS due_date        TIMESTAMPTZ",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS valid_until     TIMESTAMPTZ",
    # Notas
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes           TEXT",
    # Snapshot CFDI / facturación
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_rfc        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_name       VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_use        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_regime     VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_zip        VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_uuid       VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS cfdi_status     VARCHAR",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoiced_at     TIMESTAMPTZ",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT now()",
    "ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ",
    # Backfill: filas viejas deben tener kind='order' y status coherente
    "UPDATE orders SET kind = 'order' WHERE kind IS NULL",
    "UPDATE orders SET currency = 'MXN' WHERE currency IS NULL",
    "UPDATE orders SET discount_type = 'amount' WHERE discount_type IS NULL",
    # Índices que el modelo declara
    "CREATE INDEX IF NOT EXISTS ix_orders_kind   ON orders (kind)",
    "CREATE INDEX IF NOT EXISTS ix_orders_status ON orders (status)",
    # order_items: columnas snapshot añadidas
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name    VARCHAR",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sku             VARCHAR",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tax_rate        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS subtotal        DOUBLE PRECISION DEFAULT 0",
    "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total           DOUBLE PRECISION DEFAULT 0",
]


def _apply(sync_conn: Connection) -> None:
    # Postgres only — SQLite already has the full schema from create_all.
    if sync_conn.dialect.name != "postgresql":
        return

    all_statements = [
        ("customers", _CUSTOMER_STATEMENTS),
        ("sales", _SALES_STATEMENTS),
    ]

    for label, statements in all_statements:
        applied, skipped = 0, 0
        for stmt in statements:
            try:
                with sync_conn.begin():  # own transaction; isolates failures
                    sync_conn.execute(text(stmt))
                applied += 1
            except Exception as e:  # noqa: BLE001 — never let a migration crash boot
                skipped += 1
                print(f"[startup migrations] skipped: {stmt[:70]} -> {e}")
        print(f"[startup migrations] {label}: {applied} applied, {skipped} skipped")


async def run_startup_migrations(engine) -> None:
    """Run on its OWN connection, fully isolated from create_all, and never raise."""
    try:
        async with engine.connect() as conn:
            await conn.run_sync(_apply)
    except Exception as e:  # noqa: BLE001
        print(f"[startup migrations] disabled (connection error): {e}")
