"""Interfaz comun para todas las pasarelas de pago.

Diseno:
  Cada adaptador implementa `refund()` y `void()`. Reciben dinero y una
  referencia opaca del cobro original, devuelven un RefundResult con el
  estado alcanzado y el id del refund en la pasarela (para auditoria).

  Los adaptadores NUNCA lanzan excepciones al service — el caller no debe
  romper por un error de red o del gateway. En su lugar devuelven
  RefundResult(status=FAILED|UNKNOWN, failed_reason=...) para que el
  service decida si hay retry o notificacion al cajero.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class RefundStatus(str, Enum):
    """Maquina de estados del refund.

    pending     : creada localmente, aun no enviada al gateway
    sent        : gateway acepto la request, esperando confirmacion
    confirmed   : gateway confirmo el reverso — cliente ya recibio el dinero
    failed      : gateway rechazo (fuera de ventana, saldo, tarjeta cancelada)
    manual_ack  : reverso hecho en terminal fisica externa, con auth_code capturado
    unknown     : timeout/error de red — necesita reconciliacion contra la pasarela
    """
    PENDING = "pending"
    SENT = "sent"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    MANUAL_ACK = "manual_ack"
    UNKNOWN = "unknown"


@dataclass
class RefundRequest:
    """Datos necesarios para pedir un reverso a la pasarela.

    idempotency_key: UUID por click del cajero. Si el mismo key llega dos veces,
      la pasarela debe responder con el mismo resultado en lugar de crear
      un segundo refund (Stripe, MP y otros lo soportan nativo via header).
    """
    original_charge_id: str            # id del cobro original en la pasarela
    amount: float                      # monto a reversar (permite parcial)
    currency: str = "MXN"
    idempotency_key: Optional[str] = None
    reason: Optional[str] = None
    # Para reverso manual (terminal externa): el cajero capturo el auth_code
    # del voucher de reverso — no hay llamada a API pero si trazabilidad.
    manual_auth_code: Optional[str] = None
    manual_terminal_reference: Optional[str] = None


@dataclass
class RefundResult:
    """Resultado de un intento de refund.

    Un status=CONFIRMED significa que la pasarela ACK final; SENT significa
    que acepto la request pero el reverso puede tardar dias en cuadrar
    (batch settlement). UNKNOWN indica que la request pudo o no haber
    llegado — reconciliacion manual necesaria.
    """
    status: RefundStatus
    gateway_refund_id: Optional[str] = None
    provider: Optional[str] = None
    failed_reason: Optional[str] = None
    raw_response: Optional[dict] = None


class PaymentGateway(ABC):
    """Contrato que todo adaptador de pasarela debe cumplir."""

    provider_name: str = "abstract"

    @abstractmethod
    async def refund(self, req: RefundRequest) -> RefundResult:
        """Solicita reverso a la pasarela. NO lanza — devuelve resultado."""
        ...

    async def void(self, req: RefundRequest) -> RefundResult:
        """Void = cancelar antes del batch settlement (sin comision).

        Por defecto delega en refund. Adaptadores que distinguen void
        (Stripe cuando `charge.captured=false`) lo sobrescriben.
        """
        return await self.refund(req)

    async def get_status(self, gateway_refund_id: str) -> RefundStatus:
        """Consulta el estado actual de un refund previamente enviado.

        Usado por el job de reconciliacion para pasar refunds 'sent' o
        'unknown' a 'confirmed' cuando el settlement se completa.
        Default: UNKNOWN — cada adaptador implementa segun su API.
        """
        return RefundStatus.UNKNOWN
