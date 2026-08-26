"""Multi-company isolation for the accounting module.

The chart of accounts is a shared system template, but accounting policies,
journal entries, fixed assets, period closes, budgets, balance snapshots and
automatic account maps are company-owned data.
"""

from sqlalchemy import Column, ForeignKey, String, event

from app.core.tenancy import register_tenant_scoped
from app.db.session import engine
from app.modules.accounting.models import (
    JournalEntry, AccountingPolicy, FixedAsset, PeriodClose,
    AccountBudget, BalanceSheet, AccountMap,
)

_SCOPED = (
    JournalEntry, AccountingPolicy, FixedAsset, PeriodClose,
    AccountBudget, BalanceSheet, AccountMap,
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
    """Upgrade existing PostgreSQL accounting tables safely and idempotently."""
    cursor = None
    try:
        if dbapi_connection.__class__.__module__.startswith("sqlite"):
            return
        cursor = dbapi_connection.cursor()
        for table in (
            "accounting_journal_entries", "accounting_policies",
            "accounting_fixed_assets", "accounting_period_close",
            "accounting_budgets", "accounting_balance_sheets",
            "accounting_account_map",
        ):
            cursor.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS company_id VARCHAR "
                "REFERENCES company_profile(id)"
            )
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS ix_{table}_company_id "
                f"ON {table}(company_id)"
            )

        # Automatic sale-related entries have an authoritative company_id in Orders.
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

        # Existing accounting data belongs to Elias Jabari, the only company
        # with real activity. Do NOT use creation order as an accounting rule.
        for table in (
            "accounting_journal_entries", "accounting_policies",
            "accounting_fixed_assets", "accounting_period_close",
            "accounting_budgets", "accounting_balance_sheets",
            "accounting_account_map",
        ):
            cursor.execute(f"""
                UPDATE {table}
                SET company_id = (
                    SELECT id FROM company_profile
                    WHERE lower(coalesce(legal_name, '')) LIKE '%elias jabari%'
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
        # Fresh databases may not have all tables yet. Never take Render offline.
        print(f"[accounting tenancy] schema upgrade deferred: {exc}")
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
