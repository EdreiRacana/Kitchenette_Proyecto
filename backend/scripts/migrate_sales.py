"""Idempotent schema upgrade for the Sales / CRM module.

Run once against an EXISTING database that still has the old `orders` /
`order_items` schema:

    python -m scripts.migrate_sales         # from the backend/ directory

What it does:
  1. create_all  → creates the brand-new tables (payments, order_events) and
     any other missing table, without touching existing ones.
  2. ALTER TABLE … ADD COLUMN for each new column that's missing on `orders`
     and `order_items` (safe on both SQLite and PostgreSQL; ADD COLUMN never
     rewrites existing rows and is re-runnable).

Fresh databases don't need this — `Base.metadata.create_all` on app startup
already builds the full schema.
"""

import asyncio

from sqlalchemy import inspect, text

from app.db.session import engine, Base
# Importing models registers every table on Base.metadata.
from app.modules.auth import models as _auth          # noqa: F401
from app.modules.inventory import models as _inv       # noqa: F401
from app.modules.customers import models as _cust      # noqa: F401
from app.modules.finance import models as _fin         # noqa: F401
from app.modules.sales import models as _sales         # noqa: F401

# column_name -> SQL DDL fragment (type + default) used for ADD COLUMN.
ORDERS_NEW = {
    "folio": "VARCHAR",
    "kind": "VARCHAR DEFAULT 'order'",
    "warehouse_id": "INTEGER",
    "channel": "VARCHAR",
    "currency": "VARCHAR DEFAULT 'MXN'",
    "subtotal": "FLOAT DEFAULT 0",
    "discount_type": "VARCHAR DEFAULT 'amount'",
    "discount_value": "FLOAT DEFAULT 0",
    "discount_amount": "FLOAT DEFAULT 0",
    "tax_rate": "FLOAT DEFAULT 0",
    "tax_amount": "FLOAT DEFAULT 0",
    "shipping_amount": "FLOAT DEFAULT 0",
    "paid_amount": "FLOAT DEFAULT 0",
    "due_date": "TIMESTAMP",
    "valid_until": "TIMESTAMP",
    "bill_rfc": "VARCHAR",
    "bill_name": "VARCHAR",
    "bill_use": "VARCHAR",
    "bill_regime": "VARCHAR",
    "bill_zip": "VARCHAR",
    "cfdi_uuid": "VARCHAR",
    "cfdi_status": "VARCHAR",
    "invoiced_at": "TIMESTAMP",
}

ORDER_ITEMS_NEW = {
    "product_name": "VARCHAR",
    "sku": "VARCHAR",
    "discount_amount": "FLOAT DEFAULT 0",
    "tax_rate": "FLOAT DEFAULT 0",
    "total": "FLOAT DEFAULT 0",
}


def _add_missing(sync_conn, table: str, specs: dict[str, str]) -> list[str]:
    insp = inspect(sync_conn)
    existing = {c["name"] for c in insp.get_columns(table)}
    added = []
    for col, ddl in specs.items():
        if col not in existing:
            sync_conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {col} {ddl}'))
            added.append(col)
    return added


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
        if "orders" in tables:
            added = await conn.run_sync(_add_missing, "orders", ORDERS_NEW)
            print(f"orders: +{len(added)} columnas {added or '(ninguna)'}")
        if "order_items" in tables:
            added = await conn.run_sync(_add_missing, "order_items", ORDER_ITEMS_NEW)
            print(f"order_items: +{len(added)} columnas {added or '(ninguna)'}")
    print("✅ Migración de Sales completada.")


if __name__ == "__main__":
    asyncio.run(main())
