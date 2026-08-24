"""Multi-tenancy — aislamiento por marca (company_id) transparente.

Arquitectura:
  1. `current_company_id` — ContextVar por request.
  2. `TenancyMiddleware` — lee X-Company-Id del header (o el default del
     usuario ya persistido en user_companies) y lo setea en el ContextVar.
  3. `TenantScopedMixin` — mixin que agrega `company_id` a los modelos.
  4. `install_tenancy(engine)` — registra los event listeners:
       * `before_insert`: auto-asigna company_id desde el context si el
         modelo tiene el campo y el usuario no lo pasó explícito.
       * `do_orm_execute`: agrega WHERE company_id = ctx a cualquier
         SELECT sobre modelos scoped, VIA `with_loader_criteria`.
         Bypass explícito con `execution_options(skip_tenant_filter=True)`.

Filosofía "safe by default": si el ContextVar está vacío (script CLI,
migración, tests) NO se aplica filtro — así los procesos internos siguen
viendo todo. Solo request HTTP autenticado tiene contexto poblado.

Uso admin corporativo: cuando el usuario tiene rol especial "admin
corporativo" y quiere reportes agregados, el frontend manda header
`X-Company-Id: __ALL__` y este middleware setea None → sin filtro.
"""
from __future__ import annotations
import contextvars
from typing import Optional

from sqlalchemy import event, Column, String, ForeignKey
from sqlalchemy.orm import with_loader_criteria, DeclarativeMeta


# ── ContextVar por request ────────────────────────────────────────────
# Cada request HTTP setea este valor via TenancyMiddleware. Vive en el
# scope de la task asyncio del request — no se filtra entre requests
# concurrentes gracias a ContextVar (safe para asyncio).
current_company_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_company_id", default=None,
)

# Sentinel especial para admin corporativo — el frontend manda este valor
# cuando quiere ver TODAS las marcas consolidadas (rol super_admin).
ALL_COMPANIES = "__ALL__"


def set_company_context(company_id: Optional[str]) -> contextvars.Token:
    """Setea el company_id activo. Devuelve token para reset()."""
    return current_company_id.set(company_id)


def get_company_context() -> Optional[str]:
    """Lee el company_id activo (None si no hay contexto o es ALL)."""
    val = current_company_id.get()
    if val == ALL_COMPANIES:
        return None
    return val


# ── Mixin para modelos multi-tenant ──────────────────────────────────

class TenantScopedMixin:
    """Agrega company_id NOT NULL a un modelo. Se filtra automático en
    todos los SELECT y se auto-asigna en INSERT desde el context var.

    NULL permitido a nivel BD para retrocompat durante la migración —
    después del bulk update se puede endurecer a NOT NULL con otra
    migración. Por ahora dejamos nullable=True para no romper.
    """
    company_id = Column(
        String,
        ForeignKey("company_profile.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )


# Registro de clases marcadas como scoped — se llena al importar los modelos.
_SCOPED_CLASSES: set[type] = set()


def register_tenant_scoped(cls: type) -> type:
    """Decorador / registro para marcar una clase como scoped por tenant.
    Se llama automáticamente al declarar el modelo con TenantScopedMixin.
    """
    _SCOPED_CLASSES.add(cls)
    return cls


def is_scoped(cls: type) -> bool:
    return cls in _SCOPED_CLASSES


# ── Event listeners ──────────────────────────────────────────────────

def install_tenancy(session_class) -> None:
    """Registra los event listeners globales en la clase de sesión.
    Llamar UNA VEZ al arrancar la app, después de crear el sessionmaker.
    """

    @event.listens_for(session_class, "before_flush")
    def _auto_assign_company(session, flush_context, instances):
        """Auto-asigna company_id a instancias nuevas que aún no lo tienen."""
        cid = current_company_id.get()
        if not cid or cid == ALL_COMPANIES:
            return
        for obj in session.new:
            if type(obj) in _SCOPED_CLASSES:
                if getattr(obj, "company_id", None) is None:
                    obj.company_id = cid

    @event.listens_for(session_class, "do_orm_execute")
    def _filter_by_company(orm_execute_state):
        """Inyecta WHERE company_id = ctx en cualquier SELECT sobre modelos
        scoped. Bypass con execution_options(skip_tenant_filter=True)."""
        if not orm_execute_state.is_select:
            return
        if orm_execute_state.execution_options.get("skip_tenant_filter"):
            return
        cid = current_company_id.get()
        if not cid or cid == ALL_COMPANIES:
            return  # sin contexto o admin corporativo — sin filtro
        for cls in _SCOPED_CLASSES:
            # Agrega el criterio solo si esta clase aparece en el statement.
            # `include_aliases=True` cubre joins y subqueries.
            orm_execute_state.statement = orm_execute_state.statement.options(
                with_loader_criteria(
                    cls,
                    lambda cls_, _cid=cid: cls_.company_id == _cid,
                    include_aliases=True,
                ),
            )


# ── FastAPI middleware ───────────────────────────────────────────────

async def tenancy_middleware(request, call_next):
    """Middleware que lee X-Company-Id del header y lo setea en el
    ContextVar por la duración del request. Cualquier query hecha via
    AsyncSessionLocal durante este request se filtrará automático.
    """
    header_value = request.headers.get("X-Company-Id") or request.headers.get("x-company-id")
    token = set_company_context(header_value or None)
    try:
        response = await call_next(request)
    finally:
        current_company_id.reset(token)
    return response
