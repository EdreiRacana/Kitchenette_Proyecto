"""Pasarela de pagos con tarjeta — abstraccion multi-adaptador.

Provee una interfaz unica para operar reversos (void / refund) contra
distintos proveedores: Stripe, Mercado Pago o manual (terminal bancaria
externa). El adaptador se resuelve por company_id via SystemIntegration.
"""
from .base import PaymentGateway, RefundRequest, RefundResult, RefundStatus
from .factory import resolve_gateway

__all__ = [
    "PaymentGateway",
    "RefundRequest",
    "RefundResult",
    "RefundStatus",
    "resolve_gateway",
]
