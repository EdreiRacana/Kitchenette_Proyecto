"""Connectors placeholders para plataformas cuya integración real requiere
onboarding específico (OAuth, aprobación del seller, etc.). Se listan en la
UI con `sync_orders` que lanza un mensaje claro para que el operador use la
ingesta manual (CSV/XLSX) mientras se completa el onboarding.

Cuando cada plataforma esté lista, se implementa el sync real y este stub
se retira. No inventamos datos: sync devuelve error explícito.
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.marketplaces import models, schemas
from app.modules.marketplaces.connectors.base import BaseConnector


class _ManualStub(BaseConnector):
    async def sync_orders(self, db: AsyncSession, conn: models.MarketplaceConnection,
                          since: Optional[datetime] = None) -> schemas.SyncResult:
        msg = (f"El conector automático de {self.LABEL} está en preparación. "
               "Por ahora usa la Carga de ventas del CRM con la plantilla o el "
               "reporte oficial de la plataforma; los pedidos entran igual y "
               "con el mismo canal.")
        return schemas.SyncResult(connection_id=conn.id, platform=self.PLATFORM_KEY,
                                  orders_imported=0, error=msg)


class AmazonConnector(_ManualStub):
    PLATFORM_KEY = "amazon"
    LABEL = "Amazon Seller Central"
    DOCS_URL = "https://developer-docs.amazon.com/sp-api/"
    FIELDS = [
        {"key": "seller_id",     "label": "Seller ID",     "type": "text",     "required": True},
        {"key": "refresh_token", "label": "SP-API refresh token", "type": "password", "required": True},
        {"key": "region",        "label": "Región",        "type": "select",   "required": True,
         "options": ["na", "eu", "fe"], "default": "na"},
    ]


class MercadoLibreConnector(_ManualStub):
    PLATFORM_KEY = "mercadolibre"
    LABEL = "Mercado Libre"
    DOCS_URL = "https://developers.mercadolibre.com.mx/es_ar/orders-management"
    FIELDS = [
        {"key": "seller_id",     "label": "Seller ID",       "type": "text",     "required": True},
        {"key": "access_token",  "label": "Access token",    "type": "password", "required": True},
        {"key": "refresh_token", "label": "Refresh token",   "type": "password", "required": True},
    ]


class LiverpoolConnector(_ManualStub):
    PLATFORM_KEY = "liverpool"
    LABEL = "Liverpool Marketplace"
    DOCS_URL = "https://sellercenter.liverpool.com.mx/"
    FIELDS = [
        {"key": "seller_id",  "label": "Seller ID Liverpool", "type": "text",     "required": True},
        {"key": "api_key",    "label": "API Key",             "type": "password", "required": True},
    ]


class CoppelConnector(_ManualStub):
    PLATFORM_KEY = "coppel"
    LABEL = "Coppel Marketplace"
    DOCS_URL = "https://sellercenter.coppel.com/"
    FIELDS = [
        {"key": "seller_id", "label": "Seller ID Coppel", "type": "text",     "required": True},
        {"key": "api_key",   "label": "API Key",          "type": "password", "required": True},
    ]


class WalmartConnector(_ManualStub):
    PLATFORM_KEY = "walmart"
    LABEL = "Walmart Marketplace"
    DOCS_URL = "https://developer.walmart.com/"
    FIELDS = [
        {"key": "client_id",     "label": "Client ID",     "type": "text",     "required": True},
        {"key": "client_secret", "label": "Client Secret", "type": "password", "required": True},
    ]
