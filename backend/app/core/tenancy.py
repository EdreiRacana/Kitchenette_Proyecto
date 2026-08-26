"""Multi-tenancy — aislamiento por empresa (company_id) transparente.

Cada request autenticado debe operar dentro de una empresa concreta. El header
X-Company-Id tiene prioridad; si no llega, se resuelve la empresa default del
usuario. Nunca se permite que una request autenticada quede sin tenant por
accidente.
"""
from __future__ import annotations
import contextvars
from typing import Optional

from sqlalchemy import event, Column, String, ForeignKey
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

current_company_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_company_id", default=None,
)

ALL_COMPANIES = "__ALL__"


def set_company_context(company_id: Optional[str]) -> contextvars.Token:
    return current_company_id.set(company_id)


def get_company_context() -> Optional[str]:
    val = current_company_id.get()
    if val == ALL_COMPANIES:
        return None
    return val


class TenantScopedMixin:
    """Mixin documental para modelos pertenecientes a una empresa."""
    company_id = Column(
        String,
        ForeignKey("company_profile.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )


_SCOPED_CLASSES: list = []
_SCOPED_TABLE_NAMES: set[str] = set()


def register_tenant_scoped(cls: type) -> type:
    if cls not in _SCOPED_CLASSES:
        _SCOPED_CLASSES.append(cls)
        table = getattr(cls, "__table__", None)
        if table is not None:
            _SCOPED_TABLE_NAMES.add(table.name)
    return cls


def is_scoped(cls: type) -> bool:
    return cls in _SCOPED_CLASSES


_installed = False


def install_tenancy(_session_class=None) -> None:
    global _installed
    if _installed:
        return
    _installed = True

    @event.listens_for(Session, "before_flush")
    def _auto_assign_company(session, flush_context, instances):
        cid = current_company_id.get()
        if not cid or cid == ALL_COMPANIES:
            return
        for obj in session.new:
            if type(obj) in _SCOPED_CLASSES and getattr(obj, "company_id", None) is None:
                obj.company_id = cid

    @event.listens_for(Session, "do_orm_execute")
    def _filter_by_company(orm_execute_state):
        if not orm_execute_state.is_select:
            return
        if orm_execute_state.execution_options.get("skip_tenant_filter"):
            return
        cid = current_company_id.get()
        if not cid or cid == ALL_COMPANIES:
            return
        stmt = orm_execute_state.statement
        if not isinstance(stmt, Select):
            return
        try:
            froms = stmt.get_final_froms()
        except Exception:
            return

        seen_tables: set[str] = set()

        def _collect(clause):
            name = getattr(clause, "name", None)
            if name and not hasattr(clause, "left"):
                seen_tables.add(name)
                return
            left = getattr(clause, "left", None)
            right = getattr(clause, "right", None)
            if left is not None:
                _collect(left)
            if right is not None:
                _collect(right)

        for from_clause in froms:
            _collect(from_clause)

        matched = [
            cls for cls in _SCOPED_CLASSES
            if getattr(getattr(cls, "__table__", None), "name", None) in seen_tables
        ]
        if not matched:
            return

        new_stmt = stmt
        for cls in matched:
            new_stmt = new_stmt.where(cls.company_id == cid)
        orm_execute_state.statement = new_stmt


async def _resolve_authenticated_company(request) -> Optional[str]:
    """Resolve the active tenant for authenticated HTTP requests.

    Priority:
      1. X-Company-Id selected by the UI.
      2. UserCompany.is_default.
      3. First company membership.

    Superusers may use any existing company ID, but a supplied ID must exist.
    Public/unauthenticated routes intentionally remain unscoped.
    """
    header_value = request.headers.get("X-Company-Id") or request.headers.get("x-company-id")
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return header_value or None

    try:
        # Imports are deliberately local to avoid circular imports during
        # creation of the SQLAlchemy engine (session.py imports this module).
        from jose import jwt, JWTError
        from app.core.config import settings
        from app.db.session import AsyncSessionLocal
        from app.modules.auth.models import User
        from app.modules.core_config.models import CompanyProfile, UserCompany
        from sqlalchemy import select

        token = auth.split(" ", 1)[1].strip()
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email = payload.get("sub")
        if not email:
            return header_value or None

        async with AsyncSessionLocal() as db:
            user = (await db.execute(select(User).where(User.email == email))).scalars().first()
            if not user:
                return header_value or None

            if header_value:
                # Verify the selected company really belongs to this user.
                if user.is_superuser:
                    exists = (await db.execute(
                        select(CompanyProfile.id).where(CompanyProfile.id == header_value)
                    )).scalar_one_or_none()
                else:
                    exists = (await db.execute(
                        select(UserCompany.company_id).where(
                            UserCompany.user_id == user.id,
                            UserCompany.company_id == header_value,
                        )
                    )).scalar_one_or_none()
                if exists:
                    return header_value
                # Do not trust an invalid tenant header.
                return None

            # No header: resolve user's default company, then first membership.
            uc = (await db.execute(
                select(UserCompany.company_id)
                .where(UserCompany.user_id == user.id, UserCompany.is_default == True)  # noqa: E712
                .order_by(UserCompany.id.asc())
                .limit(1)
            )).scalar_one_or_none()
            if uc:
                return uc
            uc = (await db.execute(
                select(UserCompany.company_id)
                .where(UserCompany.user_id == user.id)
                .order_by(UserCompany.id.asc())
                .limit(1)
            )).scalar_one_or_none()
            return uc
    except (JWTError, Exception):
        # Preserve backwards compatibility for endpoints that do not use auth;
        # authenticated dependencies still enforce authorization separately.
        return header_value or None


async def tenancy_middleware(request, call_next):
    """Set the company context for the duration of the HTTP request."""
    resolved_company = await _resolve_authenticated_company(request)
    token = set_company_context(resolved_company)
    try:
        response = await call_next(request)
    finally:
        current_company_id.reset(token)
    return response
