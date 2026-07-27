"""Marketplaces / integraciones externas.

MarketplaceConnection guarda las credenciales y el estado de sync de cada
plataforma conectada (Shopify, Amazon, Mercado Libre, Liverpool, Coppel, …).
Un connector concreto vive en `connectors/<platform>.py` y expone
`sync_orders(db, conn)`; el registry en service.py lo despacha.

Diseño:
  - `credentials` es JSON opaco: cada plataforma decide qué guarda
    (access_token, shop_domain, refresh_token, seller_id, etc.).
  - `last_sync_at` marca hasta dónde ya sincronizamos (idempotencia).
  - `last_error` deja rastro del último fallo para la UI.
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from app.db.session import Base


class MarketplaceConnection(Base):
    __tablename__ = "marketplace_connections"

    id = Column(Integer, primary_key=True, index=True)
    platform = Column(String, nullable=False, index=True)   # shopify | amazon | mercadolibre | liverpool | coppel | walmart
    name = Column(String, nullable=False)                   # etiqueta legible: "Shopify - Tienda Principal"
    is_active = Column(Boolean, default=True, nullable=False)

    # Opcional: si esta conexión representa a un cliente/marketplace específico
    # del CRM (útil para chain_physical y consignment), lo enlazamos aquí para
    # que las ventas ingestadas se aten al customer_id correcto.
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)

    # Almacén por defecto para descontar/consumir stock de las órdenes que
    # entren por esta conexión. Nullable: si no se define, la orden queda sin
    # almacén (global) y no toca inventario.
    default_warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)

    # JSON serializado con las credenciales/config de la plataforma.
    # NUNCA se expone en las respuestas — el schema lo omite explícitamente.
    credentials = Column(Text, nullable=True)               # JSON

    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_orders = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
