"""Contrato del connector marketplace.

Cada plataforma implementa un connector con:
  - PLATFORM_KEY (str) — identificador único
  - LABEL (str) — nombre legible
  - FIELDS (List[dict]) — qué credenciales pide (para la UI)
  - DOCS_URL (str) — link a docs oficiales de la API
  - async sync_orders(db, conn, since=None) -> SyncResult
        Trae pedidos desde `since` (o el last_sync_at de la conexión) y los
        materializa como Order con channel=PLATFORM_KEY. Debe ser idempotente:
        si un pedido ya existe (mismo external_id), no se duplica.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Dict, Any
from abc import ABC, abstractmethod

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.marketplaces import models, schemas


class BaseConnector(ABC):
    PLATFORM_KEY: str = ""
    LABEL: str = ""
    FIELDS: List[Dict[str, Any]] = []
    DOCS_URL: Optional[str] = None

    @classmethod
    def info(cls) -> schemas.PlatformInfo:
        return schemas.PlatformInfo(
            key=cls.PLATFORM_KEY, label=cls.LABEL,
            fields=cls.FIELDS, docs_url=cls.DOCS_URL,
        )

    @abstractmethod
    async def sync_orders(self, db: AsyncSession, conn: models.MarketplaceConnection,
                          since: Optional[datetime] = None) -> schemas.SyncResult:
        raise NotImplementedError
