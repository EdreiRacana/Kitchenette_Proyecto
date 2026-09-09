"""Resuelve el adaptador de pasarela para una empresa (company_id).

Consulta SystemIntegration con integration_type=PAYMENT_GATEWAY, is_active=True
para la empresa dada. Elige el proveedor segun `provider_name`:

  STRIPE        -> StripeGateway con api_secret
  MERCADO_PAGO  -> MercadoPagoGateway con api_secret (access_token)
  cualquier otro -> ManualGateway (terminal externa, sin API)

Si no hay integracion configurada, retorna ManualGateway — permite operar
capturando el auth_code del voucher aunque no haya pasarela seteada.
"""
from __future__ import annotations
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.core_config import models as cfg_models
from .base import PaymentGateway
from .manual import ManualGateway
from .stripe_adapter import StripeGateway
from .mercadopago_adapter import MercadoPagoGateway


async def resolve_gateway(db: AsyncSession, company_id: Optional[str]) -> PaymentGateway:
    """Devuelve la instancia del adaptador activo para la empresa.

    Sin company_id o sin integracion: ManualGateway (safe default).
    """
    if not company_id:
        return ManualGateway()

    stmt = (
        select(cfg_models.SystemIntegration)
        .where(cfg_models.SystemIntegration.company_id == company_id)
        .where(cfg_models.SystemIntegration.integration_type
                == cfg_models.IntegrationType.PAYMENT_GATEWAY)
        .where(cfg_models.SystemIntegration.is_active == True)  # noqa: E712
    )
    res = await db.execute(stmt.execution_options(skip_tenant_filter=True))
    integration = res.scalars().first()

    if not integration:
        return ManualGateway()

    provider = integration.provider_name
    # api_secret guarda el token real (Bearer). api_key es el publishable/public.
    secret = (integration.api_secret or "").strip()

    if provider == cfg_models.IntegrationProvider.STRIPE and secret:
        return StripeGateway(api_key=secret)
    if provider == cfg_models.IntegrationProvider.MERCADO_PAGO and secret:
        return MercadoPagoGateway(access_token=secret)

    return ManualGateway()
