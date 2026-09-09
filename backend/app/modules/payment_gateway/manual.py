"""Adaptador manual — para terminales bancarias externas (Netpay, Prosa,
Getnet, Evertec, etc.) donde el reverso se hace fisicamente en la
terminal y el ERP solo captura el auth_code del voucher.

Este adaptador NO hace llamadas a API. Confirma inmediatamente con
status=MANUAL_ACK siempre que venga auth_code capturado por el cajero.
Sin auth_code el resultado es FAILED — la UI debe exigir la captura.
"""
from __future__ import annotations

from .base import PaymentGateway, RefundRequest, RefundResult, RefundStatus


class ManualGateway(PaymentGateway):
    provider_name = "manual"

    async def refund(self, req: RefundRequest) -> RefundResult:
        # Si el cajero capturo el auth_code del voucher de reverso, damos
        # por hecho el reverso. La responsabilidad es del cajero y queda
        # trazado con el codigo del voucher.
        if not req.manual_auth_code:
            return RefundResult(
                status=RefundStatus.FAILED,
                provider=self.provider_name,
                failed_reason=(
                    "Reverso manual requiere el codigo de autorizacion del "
                    "voucher de la terminal fisica."
                ),
            )
        return RefundResult(
            status=RefundStatus.MANUAL_ACK,
            provider=self.provider_name,
            gateway_refund_id=req.manual_auth_code,
        )
