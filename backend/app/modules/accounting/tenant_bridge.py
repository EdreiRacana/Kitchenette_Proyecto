"""Accounting tenant isolation bridge.

JournalEntry predates the multi-company tenancy layer. This module upgrades the
mapped class at import time so accounting entries participate in the same
X-Company-Id isolation used by Sales/Finance, while keeping the change
backwards-compatible with existing databases.
"""

from sqlalchemy import Column, ForeignKey, String, text

from app.core.tenancy import register_tenant_scoped
from app.db.session import Base
from app.modules.accounting.models import JournalEntry


# DeclarativeMeta supports adding mapped Columns after class declaration. The
# guard makes this safe across reloads/tests.
if not hasattr(JournalEntry, "company_id"):
    JournalEntry.company_id = Column(  # type: ignore[attr-defined]
        String,
        ForeignKey("company_profile.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

# This makes INSERTs receive the request company automatically and makes every
# SELECT involving accounting_journal_entries tenant-filtered automatically.
register_tenant_scoped(JournalEntry)


async def ensure_accounting_tenant_schema(engine) -> None:
    """Upgrade an existing PostgreSQL DB without breaking startup.

    New databases are handled by Base.metadata.create_all. Existing databases
    need the ALTER explicitly because create_all never changes an existing
    table. Historical entries are assigned to the first company, matching the
    project's existing tenancy migration policy for pre-multi-company data.
    """
    try:
        async with engine.begin() as conn:
            if conn.dialect.name != "postgresql":
                return
            await conn.execute(text(
                "ALTER TABLE accounting_journal_entries "
                "ADD COLUMN IF NOT EXISTS company_id VARCHAR "
                "REFERENCES company_profile(id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_accounting_journal_entries_company_id "
                "ON accounting_journal_entries(company_id)"
            ))
            # Preserve company attribution from sales where possible.
            await conn.execute(text("""
                UPDATE accounting_journal_entries je
                SET company_id = o.company_id
                FROM orders o
                WHERE je.company_id IS NULL
                  AND o.company_id IS NOT NULL
                  AND (
                    je.source = 'venta:' || o.id::text
                    OR je.source = 'cogs:' || o.id::text
                    OR je.source LIKE 'cobro:' || o.id::text || ':%'
                  )
            """))
            # Remaining historical accounting rows belong to the original
            # tenant in this installation, consistent with the existing
            # tenancy backfill policy.
            await conn.execute(text("""
                UPDATE accounting_journal_entries
                SET company_id = (
                    SELECT id FROM company_profile
                    ORDER BY created_at ASC
                    LIMIT 1
                )
                WHERE company_id IS NULL
            """))
    except Exception as exc:
        # Keep the same resilient startup philosophy used by db.migrations.py.
        print(f"[accounting tenancy] schema upgrade skipped: {exc}")
