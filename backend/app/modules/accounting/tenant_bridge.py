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

# Tables whose rows inherit ownership from the single company that already owns
# the journal. Journal lines are excluded: they inherit from their parent entry.
_INHERIT_FROM_OWNER = (
    "accounting_policies", "accounting_fixed_assets", "accounting_period_close",
    "accounting_budgets", "accounting_balance_sheets", "accounting_account_map",
)

# The schema work is idempotent but only needs to run once per process.
_schema_ready = False

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


def _run(cursor, connection, sql, params=None):
    """Run one statement in its own transaction.

    Each statement is committed independently so that a single failure can
    never roll back the work that already succeeded. The previous version
    wrapped every statement in one transaction with a single commit, so one
    bad statement silently discarded the whole schema upgrade — including the
    ALTER TABLEs that the ORM depends on.
    """
    try:
        cursor.execute(sql, params)
        connection.commit()
        return True
    except Exception as exc:
        try:
            connection.rollback()
        except Exception:
            pass
        print(f"[accounting tenancy] statement skipped: {str(exc).strip()[:160]}")
        return False


@event.listens_for(engine.sync_engine, "connect")
def _upgrade_accounting_schema(dbapi_connection, connection_record):
    """Make the physical schema match what the ORM maps.

    Every tenant-scoped accounting class carries a company_id attribute, so the
    matching column MUST exist in PostgreSQL or every query touching those
    tables fails with UndefinedColumn.

    Ownership rules:
      - Journal lines always inherit the company of their parent entry.
      - Other company-owned accounting rows that predate the isolation are
        attributed to the company that already owns the journal, and only when
        that company is unambiguous.
      - Rows that already have an owner are NEVER reassigned. Ownership is not
        inferred from folios: folios are numbered per company and are not
        unique across companies, so matching on them would move one company's
        documents into another company's books.
    """
    global _schema_ready
    if _schema_ready:
        return
    cursor = None
    try:
        if dbapi_connection.__class__.__module__.startswith("sqlite"):
            _schema_ready = True
            return
        cursor = dbapi_connection.cursor()

        # 1. Schema: the column the ORM maps must exist.
        for table in _ACCOUNTING_TABLES:
            _run(cursor, dbapi_connection,
                 f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS company_id VARCHAR "
                 "REFERENCES company_profile(id)")
            _run(cursor, dbapi_connection,
                 f"CREATE INDEX IF NOT EXISTS ix_{table}_company_id "
                 f"ON {table}(company_id)")

        # 2. AccountMap must be configurable per company. The old global unique
        #    index on role prevented two companies from each having their own
        #    'sales', 'clients', etc. mappings.
        _run(cursor, dbapi_connection, "DROP INDEX IF EXISTS ix_accounting_account_map_role")
        _run(cursor, dbapi_connection, "DROP INDEX IF EXISTS accounting_account_map_role_key")
        _run(cursor, dbapi_connection,
             "CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_account_map_company_role "
             "ON accounting_account_map(company_id, role)")

        # 3. Journal lines inherit from their parent entry. Deterministic and
        #    idempotent: only fills gaps, never reassigns an existing owner.
        _run(cursor, dbapi_connection, """
            UPDATE accounting_journal_lines jl
            SET company_id = je.company_id
            FROM accounting_journal_entries je
            WHERE jl.entry_id = je.id
              AND jl.company_id IS NULL
              AND je.company_id IS NOT NULL
        """)

        # 4. Remaining unowned accounting rows go to the company that owns the
        #    journal — but only when exactly one company does, so the result is
        #    never a guess.
        owner = None
        try:
            cursor.execute("""
                SELECT company_id FROM accounting_journal_entries
                WHERE company_id IS NOT NULL
                GROUP BY company_id
            """)
            owners = cursor.fetchall()
            dbapi_connection.commit()
            if len(owners) == 1:
                owner = owners[0][0]
            elif len(owners) > 1:
                print("[accounting tenancy] multiple companies own journal entries; "
                      "leaving unowned rows untouched")
        except Exception as exc:
            try:
                dbapi_connection.rollback()
            except Exception:
                pass
            print(f"[accounting tenancy] owner lookup skipped: {str(exc).strip()[:160]}")

        if owner:
            for table in _INHERIT_FROM_OWNER:
                _run(cursor, dbapi_connection,
                     f"UPDATE {table} SET company_id = %s WHERE company_id IS NULL",
                     (owner,))

        _schema_ready = True
    except Exception as exc:
        # Fresh databases may not have all tables yet. Never take Render offline.
        print(f"[accounting tenancy] schema upgrade deferred: {exc}")
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                pass
