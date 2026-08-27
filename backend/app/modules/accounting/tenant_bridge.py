"""Multi-company isolation for the accounting module.

The chart of accounts is a shared system template, but accounting policies,
journal entries, journal lines, fixed assets, period closes, budgets, balance snapshots and
automatic account maps are company-owned data.
"""

from sqlalchemy import Column, ForeignKey, String, event

from app.core.tenancy import register_tenant_scoped
from app.db.session import engine
from app.modules.accounting.models import (
    JournalEntry, JournalLine, AccountingPolicy, FixedAsset, PeriodClose,
    AccountBudget, BalanceSheet, AccountMap,
)

_SCOPED = (
    JournalEntry, JournalLine, AccountingPolicy, FixedAsset, PeriodClose,
    AccountBudget, BalanceSheet, AccountMap,
)
_ACCOUNTING_TABLES = (
    "accounting_journal_entries", "accounting_journal_lines", "accounting_policies",
    "accounting_fixed_assets", "accounting_period_close",
    "accounting_budgets", "accounting_balance_sheets",
    "accounting_account_map",
)
_MIGRATION_MARKER = "accounting_company_isolation_v3"
_LEGACY_ELIAS_FOLIOS = (
    "POL-000011", "POL-000012", "POL-000013",
    "POL-000019", "POL-000027", "POL-000028",
)

# Add company_id to legacy mapped classes without destructive table recreation.
for _cls in _SCOPED:
    if not hasattr(_cls, "company_id"):
        _cls.company_id = Column(  # type: ignore[attr-defined]
            String,
            ForeignKey("company_profile.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        )
    register_tenant_scoped(_cls)


@event.listens_for(engine.sync_engine, "connect")
def _upgrade_accounting_schema(dbapi_connection, connection_record):
    """Upgrade old accounting schemas and repair known legacy ownership.

    IMPORTANT BUSINESS RULE:
      - Historical accounting belongs to Elias Jabari.
      - Nene Gardoqui and Twelve South are new companies and must start with
        zero accounting movements.
      - The six legacy demo/imported folios below must never remain attached to
        Twelve South. They are reassigned to Elias, together with their lines.
    """
    cursor = None
    try:
        if dbapi_connection.__class__.__module__.startswith("sqlite"):
            return
        cursor = dbapi_connection.cursor()

        # Schema upgrade.
        for table in _ACCOUNTING_TABLES:
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS company_id VARCHAR "
                "REFERENCES company_profile(id)"
            )
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_company_id "
                f"ON {table}(company_id)"
            )

        # AccountMap must be independently configurable per company. The old
        # schema had a global unique index on role, which prevents two companies
        # from having their own 'sales', 'clients', etc. mappings.
        cursor.execute("DROP INDEX IF EXISTS ix_accounting_account_map_role")
        cursor.execute("DROP INDEX IF EXISTS accounting_account_map_role_key")
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_account_map_company_role "
            "ON accounting_account_map(company_id, role)"
        )

        # One-time legacy cutover. The marker table makes this safe across all
        # future Render restarts: once the initial data has been classified,
        # new Nene/Twelve records are left untouched.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS accounting_tenancy_migrations (
                key VARCHAR PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
            )
        """)
        cursor.execute(
            "SELECT 1 FROM accounting_tenancy_migrations WHERE key = %s",
            (_MIGRATION_MARKER,),
        )
        already_applied = cursor.fetchone() is not None

        if not already_applied:
            cursor.execute("""
                SELECT id FROM company_profile
                WHERE lower(coalesce(legal_name, '')) LIKE '%elias jabari%'
                ORDER BY created_at ASC
                LIMIT 1
            """)
            row = cursor.fetchone()
            if row:
                elias_id = row[0]

                # Existing headers and lines form one historical accounting set.
                # First assign journal entries, then make each journal line inherit
                # exactly the same company as its parent entry.
                for table in _ACCOUNTING_TABLES:
                    if table == "accounting_journal_lines":
                        cursor.execute("""
                            UPDATE accounting_journal_lines jl
                            SET company_id = je.company_id
                            FROM accounting_journal_entries je
                            WHERE jl.entry_id = je.id
                              AND je.company_id IS NOT NULL
                        """)
                    else:
                        cursor.execute(
                            f"UPDATE {table} SET company_id = %s",
                            (elias_id,),
                        )

                cursor.execute(
                    "INSERT INTO accounting_tenancy_migrations(key) VALUES (%s)",
                    (_MIGRATION_MARKER,),
                )

        # Explicit repair for the six legacy folios that were created before
        # company isolation and are known to have been mis-assigned to Twelve
        # South. This block is intentionally idempotent and does not depend on
        # the one-time migration marker.
        cursor.execute("""
            SELECT id FROM company_profile
            WHERE lower(coalesce(legal_name, '')) LIKE '%elias jabari%'
            ORDER BY created_at ASC
            LIMIT 1
        """)
        row = cursor.fetchone()
        if row:
            elias_id = row[0]
            placeholders = ",".join(["%s"] * len(_LEGACY_ELIAS_FOLIOS))
            cursor.execute(
                f"UPDATE accounting_journal_entries "
                f"SET company_id = %s WHERE folio IN ({placeholders})",
                (elias_id, *_LEGACY_ELIAS_FOLIOS),
            )
            cursor.execute("""
                UPDATE accounting_journal_lines jl
                SET company_id = je.company_id
                FROM accounting_journal_entries je
                WHERE jl.entry_id = je.id
                  AND je.folio IN (%s, %s, %s, %s, %s, %s)
            """, _LEGACY_ELIAS_FOLIOS)

        dbapi_connection.commit()
    except Exception as exc:
        try:
            dbapi_connection.rollback()
        except Exception:
            pass
        # Fresh databases may not have all tables yet. Never take Render offline.
        print(f"[accounting tenancy] schema upgrade deferred: {exc}")
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
