"""Aislamiento de datos por sucursal (capa 2 del modelo multi-empresa).

Regla, al estilo NetSuite OneWorld / SAP company codes:
  - Superusuario o usuario sin sucursal asignada  → ve TODO (consolidado).
  - Usuario con sucursal asignada                  → ve su sucursal + lo no asignado.

En Inventario la sucursal se ancla en el Almacén (Warehouse.branch_id). El resto
de entidades (stock, movimientos, alertas) se filtran por el almacén al que
pertenecen. Los almacenes sin sucursal se consideran globales/compartidos hasta
que se les asigne una, para no romper instalaciones existentes.
"""
from typing import Optional
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import Warehouse


def branch_scope(user) -> Optional[int]:
    """Devuelve la sucursal a la que se debe restringir, o None si ve todo."""
    if user is None or getattr(user, "is_superuser", False):
        return None
    return getattr(user, "branch_id", None)


async def visible_warehouse_ids(db: AsyncSession, user) -> Optional[list[int]]:
    """IDs de almacenes que el usuario puede ver. None = todos (sin filtro)."""
    scope = branch_scope(user)
    if scope is None:
        return None
    rows = await db.execute(
        select(Warehouse.id).where(
            or_(Warehouse.branch_id == scope, Warehouse.branch_id.is_(None))
        )
    )
    return [r[0] for r in rows.all()]
