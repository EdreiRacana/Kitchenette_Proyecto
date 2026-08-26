"""Accounting module package.

The tenant bridge is imported here so JournalEntry is registered with the
same multi-company isolation layer before FastAPI creates the database schema.
"""
from app.modules.accounting import tenant_bridge as _tenant_bridge  # noqa: F401,E402
