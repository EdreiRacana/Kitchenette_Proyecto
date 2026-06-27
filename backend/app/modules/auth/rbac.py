"""RBAC: control de acceso basado en roles, al estilo de los ERPs líderes
(SAP, Oracle, NetSuite, Odoo, Dynamics 365).

Modelo:
  - Permiso = (módulo, acción).  Acciones canónicas: view, create, edit, delete, approve.
  - Rol     = conjunto de permisos.  Roles de "sistema" no se eliminan ni renombran.
  - Usuario = pertenece a un rol; los superusuarios saltan toda verificación.

La verificación se hace en el backend (no solo ocultando botones), que es lo que
distingue un ERP profesional de una maqueta. El frontend consulta los permisos
efectivos en /auth/me/permissions para además adaptar la interfaz.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import Permission, Role, User

# (clave_estable, etiqueta_visible)  — la clave se usa para verificar en el código,
# la etiqueta se muestra en la matriz de permisos de la UI.
MODULES: list[tuple[str, str]] = [
    ("dashboard", "Tablero"),
    ("sales", "Ventas / CRM"),
    ("customers", "Clientes"),
    ("inventory", "Inventario"),
    ("finance", "Finanzas"),
    ("hr", "RH / Nómina"),
    ("reports", "Reportes / BI"),
    ("config", "Configuración"),
]
MODULE_KEYS = [k for k, _ in MODULES]
ACTIONS = ["view", "create", "edit", "delete", "approve"]

ALL = {a: True for a in ACTIONS}
VIEW = {"view": True}


def _grant(view=False, create=False, edit=False, delete=False, approve=False):
    return {"view": view, "create": create, "edit": edit, "delete": delete, "approve": approve}


# Roles sembrados. is_system=True ⇒ no editable/eliminable.
SYSTEM_ROLES = {
    "Administrador": {
        "description": "Acceso total al sistema",
        "is_system": True, "color": "#33B2F5",
        "permissions": {k: ALL for k in MODULE_KEYS},
    },
    "Solo lectura": {
        "description": "Solo visualización de información",
        "is_system": True, "color": "#94A3B8",
        "permissions": {k: VIEW for k in MODULE_KEYS},
    },
    "Gerente Ventas": {
        "description": "Gestión completa de ventas y clientes",
        "is_system": False, "color": "#FBBF24",
        "permissions": {
            "dashboard": _grant(view=True),
            "sales": _grant(view=True, create=True, edit=True, approve=True),
            "customers": _grant(view=True, create=True, edit=True),
            "inventory": _grant(view=True),
            "reports": _grant(view=True),
        },
    },
    "Contador": {
        "description": "Finanzas, nómina y reportes",
        "is_system": False, "color": "#34D399",
        "permissions": {
            "dashboard": _grant(view=True),
            "finance": _grant(view=True, create=True, edit=True, approve=True),
            "hr": _grant(view=True, create=True, edit=True, approve=True),
            "reports": _grant(view=True),
        },
    },
    "Almacén": {
        "description": "Control de inventario y movimientos",
        "is_system": False, "color": "#A78BFA",
        "permissions": {
            "dashboard": _grant(view=True),
            "inventory": _grant(view=True, create=True, edit=True),
            "sales": _grant(view=True),
        },
    },
    "Ventas": {
        "description": "Crear pedidos y cotizaciones",
        "is_system": False, "color": "#F472B6",
        "permissions": {
            "dashboard": _grant(view=True),
            "sales": _grant(view=True, create=True, edit=True),
            "customers": _grant(view=True, create=True),
            "inventory": _grant(view=True),
        },
    },
}


async def seed_rbac(db: AsyncSession) -> None:
    """Crea permisos y roles de sistema que falten (idempotente). Nunca borra ni
    pisa permisos personalizados que el cliente haya configurado."""
    # 1. Permisos (módulo × acción).
    existing = {(p.module, p.action): p for p in (await db.execute(select(Permission))).scalars().all()}
    label_by_key = dict(MODULES)
    for key in MODULE_KEYS:
        for action in ACTIONS:
            if (key, action) not in existing:
                p = Permission(module=key, action=action, description=f"{label_by_key[key]} · {action}")
                db.add(p)
                existing[(key, action)] = p
    await db.flush()

    perm_by_pair = {(p.module, p.action): p for p in (await db.execute(select(Permission))).scalars().all()}

    # 2. Roles de sistema. Si ya existen, solo se asegura is_system/color y, para
    #    roles vacíos, se les puebla el set base (no se pisan personalizaciones).
    roles_by_name = {r.name: r for r in (await db.execute(
        select(Role).options(selectinload(Role.permissions))
    )).scalars().all()}

    for name, spec in SYSTEM_ROLES.items():
        role = roles_by_name.get(name)
        wanted_perms = []
        for mod, grants in spec["permissions"].items():
            for action, on in grants.items():
                if on:
                    wanted_perms.append(perm_by_pair[(mod, action)])
        if role is None:
            role = Role(name=name, description=spec["description"], is_system=spec["is_system"], color=spec["color"])
            role.permissions = wanted_perms
            db.add(role)
        else:
            if role.is_system != spec["is_system"]:
                role.is_system = spec["is_system"]
            if not role.color:
                role.color = spec["color"]
            # Solo poblar si el rol no tiene permisos todavía (recién migrado),
            # para no sobrescribir ajustes hechos por el cliente.
            if not role.permissions:
                role.permissions = wanted_perms
    await db.flush()

    # 3. El superusuario inicial queda ligado al rol Administrador si no tiene rol.
    admin_role = (await db.execute(select(Role).where(Role.name == "Administrador"))).scalars().first()
    if admin_role:
        supers = (await db.execute(select(User).where(User.is_superuser == True))).scalars().all()  # noqa: E712
        for u in supers:
            if u.role_id is None:
                u.role_id = admin_role.id
    await db.commit()


def effective_permissions(user: User) -> dict[str, dict[str, bool]]:
    """Devuelve {modulo: {accion: bool}} para el usuario. Superusuario = todo."""
    grid = {k: {a: False for a in ACTIONS} for k in MODULE_KEYS}
    if getattr(user, "is_superuser", False):
        return {k: {a: True for a in ACTIONS} for k in MODULE_KEYS}
    role = getattr(user, "role_obj", None)
    if role and role.permissions:
        for p in role.permissions:
            if p.module in grid and p.action in grid[p.module]:
                grid[p.module][p.action] = True
    return grid


def user_can(user: User, module: str, action: str) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    role = getattr(user, "role_obj", None)
    if not role or not role.permissions:
        return False
    return any(p.module == module and p.action == action for p in role.permissions)
