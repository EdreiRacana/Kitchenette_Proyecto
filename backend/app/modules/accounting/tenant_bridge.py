"""Accounting tenant isolation bridge.

JournalEntry predates the multi-company tenancy layer. This module upgrades the
mapped class so accounting entries participate in the same X-Company-Id
isolation used by Sales/Finance, while keeping existing databases compatible.
"""

from sqlalchemy import Column, ForeignKey, String, event

from app.core.tenancy import register_tenant_scoped
from app.db.session import Base, engine
from app.modules.accounting.models import JournalEntry


# SQLAlchemy's DeclarativeMeta supports adding a Column to an already mapped
# declarative class. The mapper is updated automatically and the column becomes
# part of Base.metadata, so new databases get it through create_all().
if not hasattr(JournalEntry, "company_id"):
    JournalEntry.company_id = Column(  # type: ignore[attr-defined]
        String,
        ForeignKey("company_profile.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

# Same tenant isolation mechanism used by Sales/Finance.
register_tenant_scoped(JournalEntry)


@event.listens_for(engine.sync_engine, "connect")
def _upgrade_existing_accounting_schema(dbapi_connection, connection_record):
    """Upgrade old PostgreSQL databases before the first ORM operation.

    The listener runs before Base.metadata.create_all. On a fresh database the
    referenced company_profile table may not exist yet, so we defer to
    create_all. On an existing database the ALTER is applied immediately.
    """
    cursor = None
    try:
        if dbapi_connection.__class__.__module__.startswith("sqlite"):
            return
        cursor = dbapi_connection.cursor()
        cursor.execute(
            "ALTER TABLE accounting_journal_entries "
            "ADD COLUMN IF NOT EXISTS company_id VARCHAR "
            "REFERENCES company_profile(id)"
        )
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS ix_accounting_journal_entries_company_id "
            "ON accounting_journal_entries(company_id)"
        )
        # Existing sales already know their company. Use that authoritative
        # relationship for historical auto-generated sale/cogs/payment entries.
        cursor.execute("""
            UPDATE accounting_journal_entries je
            SET company_id = o.company_id
            FROM orders o
            WHERE je.company_id IS NULL
              AND o.company_id IS NOT NULL
              AND (
                je.source = 'venta:' || o.id::text
                OR je.source = 'cogs:' || o.id::text
                OR je.source LIKE 'cobro:' || o.id::text || ':%'
                OR je.source LIKE 'cobro_iva:' || o.id::text || ':%'
              )
        """)
        # Any remaining legacy/manual accounting entries belong to the original
        # tenant, matching the repository's existing tenancy backfill policy.
        cursor.execute("""
            UPDATE accounting_journal_entries
            SET company_id = (
                SELECT id FROM company_profile
                ORDER BY created_at ASC
                LIMIT 1
            )
            WHERE company_id IS NULL
        """)
        dbapi_connection.commit()
    except Exception as exc:
        try:
            dbapi_connection.rollback()
        except Exception:
            pass
        # Fresh DBs legitimately reach this point before company_profile exists.
        # Existing startup code is intentionally resilient; do not prevent boot.
        print(f"[accounting tenancy] schema upgrade deferred: {exc}")
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
