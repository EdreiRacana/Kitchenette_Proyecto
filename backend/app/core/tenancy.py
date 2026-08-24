"""Multi-tenancy — aislamiento por marca (company_id) transparente.

Arquitectura:
  1. `current_company_id` — ContextVar por request.
  2. `TenancyMiddleware` — lee X-Company-Id del header y lo setea.
  3. `register_tenant_scoped(cls)` — marca un modelo como scoped por marca.
  4. `install_tenancy()` — registra los event listeners en `Session`
     (sync — es donde SQLAlchemy dispara los ORM events, incluso al
     usar AsyncSession que corre sobre un Session sync interno):

       * `before_flush`: auto-asigna company_id a inserts nuevos
         desde el ContextVar.
       * `do_orm_execute`: inspecciona el SELECT, encuentra qué tablas
         scoped están en el FROM, y agrega WHERE company_id = ctx al
         statement. Funciona con queries ORM completas Y con queries
         de agregación pura (select(func.sum(Order.total_amount))).

Bypass explícito: `execution_options(skip_tenant_filter=True)`.

Safe-by-default: si el ContextVar está vacío (script CLI, migración,
tests), NO se aplica filtro — así los procesos internos siguen viendo
todo. Solo request HTTP autenticado tiene contexto poblado.

Admin corporativo: sentinel ALL_COMPANIES ('__ALL__') — el frontend
lo manda cuando el usuario quiere ver todo consolidado.
"""
from __future__ import annotations
import contextvars
from typing import Optional

from sqlalchemy import event, Column, String, ForeignKey
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select


# ── ContextVar por request ────────────────────────────────────────────
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


# ── Mixin (documental — no usado directamente) ───────────────────────

class TenantScopedMixin:
    """Documenta que un modelo lleva company_id.
    En la práctica cada modelo declara la columna directamente para
    no depender del orden de resolución de mixins.
    """
    company_id = Column(
        String,
        ForeignKey("company_profile.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )


# Registro de clases marcadas como scoped.
_SCOPED_CLASSES: list = []
_SCOPED_TABLE_NAMES: set[str] = set()


def register_tenant_scoped(cls: type) -> type:
    """Marca una clase como scoped por tenant. Los inserts se
    auto-asignan y los SELECT filtran automáticamente."""
    if cls not in _SCOPED_CLASSES:
        _SCOPED_CLASSES.append(cls)
        table = getattr(cls, "__table__", None)
        if table is not None:
            _SCOPED_TABLE_NAMES.add(table.name)
    return cls


def is_scoped(cls: type) -> bool:
    return cls in _SCOPED_CLASSES


# ── Event listeners globales ─────────────────────────────────────────

_installed = False


def install_tenancy(_session_class=None) -> None:
    """Registra los event listeners UNA sola vez sobre la clase `Session`
    de SQLAlchemy sync (es donde se disparan los ORM events, incluso al
    usar AsyncSession que corre sobre un Session sync interno).
    Idempotente — al re-importar no duplica listeners.
    """
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
            if type(obj) in _SCOPED_CLASSES:
                if getattr(obj, "company_id", None) is None:
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

        # Detectar qué tablas scoped están en el FROM del SELECT.
        # Usar los froms visibles ya resueltos por SQLAlchemy.
        try:
            froms = stmt.get_final_froms()
        except Exception:
            return

        matched_classes = []
        seen_tables = set()
        for from_clause in froms:
            table_name = getattr(from_clause, "name", None)
            if not table_name or table_name in seen_tables:
                continue
            seen_tables.add(table_name)
            if table_name in _SCOPED_TABLE_NAMES:
                for cls in _SCOPED_CLASSES:
                    if getattr(cls, "__table__", None) is not None \
                       and cls.__table__.name == table_name:
                        matched_classes.append(cls)
                        break

        if not matched_classes:
            return

        # Agrega WHERE company_id = cid por cada tabla scoped presente.
        # Funciona con SELECT de entidades Y con SELECT de agregados.
        new_stmt = stmt
        for cls in matched_classes:
            new_stmt = new_stmt.where(cls.company_id == cid)
        orm_execute_state.statement = new_stmt


# ── FastAPI middleware ───────────────────────────────────────────────

async def tenancy_middleware(request, call_next):
    """Lee X-Company-Id del header y lo pone en el ContextVar por la
    duración del request. Cualquier query hecha por el request se
    filtra automático."""
    header_value = (
        request.headers.get("X-Company-Id")
        or request.headers.get("x-company-id")
    )
    token = set_company_context(header_value or None)
    try:
        response = await call_next(request)
    finally:
        current_company_id.reset(token)
    return response
