"""Adaptador Mercado Pago — refund via API REST.

Docs: https://www.mercadopago.com.mx/developers/es/reference/chargebacks/_payments_id_refunds/post
  POST https://api.mercadopago.com/v1/payments/{payment_id}/refunds
    Auth: Bearer <access_token>
    Body (JSON): { "amount": <float>, "metadata": {...} }
    Header: X-Idempotency-Key: <uuid>

Ventana: hasta 180 dias segun tipo de operacion. Refunds parciales OK.
Terminal Point (fisica): mismo endpoint, requiere el payment_id que
regresa la terminal al cerrar el cobro.
"""
from __future__ import annotations
from typing import Optional
import httpx

from .base import PaymentGateway, RefundRequest, RefundResult, RefundStatus


class MercadoPagoGateway(PaymentGateway):
    provider_name = "mercadopago"

    def __init__(self, access_token: str,
                  base_url: str = "https://api.mercadopago.com"):
        self._access_token = access_token
        self._base_url = base_url.rstrip("/")

    async def refund(self, req: RefundRequest) -> RefundResult:
        if not self._access_token:
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason="Mercado Pago: access_token no configurado.",
            )
        payment_id = (req.original_charge_id or "").strip()
        if not payment_id:
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason="Falta payment_id del cobro original.",
            )
        if req.amount <= 0:
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason="Monto de refund invalido (<= 0).",
            )

        # Refund total: MP acepta body vacio; refund parcial requiere amount.
        # Usamos siempre amount explicito para consistencia.
        payload = {"amount": round(req.amount, 2)}
        if req.reason:
            payload["metadata"] = {"reason": req.reason[:500]}

        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }
        if req.idempotency_key:
            headers["X-Idempotency-Key"] = req.idempotency_key

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self._base_url}/v1/payments/{payment_id}/refunds",
                    json=payload, headers=headers,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return RefundResult(
                status=RefundStatus.UNKNOWN, provider=self.provider_name,
                failed_reason=f"Timeout/red al contactar Mercado Pago: {e!s}",
            )

        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:500]}

        if resp.status_code >= 400:
            msg = body.get("message") if isinstance(body, dict) else None
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason=f"MP rechazo: {msg or resp.status_code}",
                raw_response=body if isinstance(body, dict) else None,
            )

        # MP devuelve el refund; status: 'approved' | 'in_process' | 'rejected'
        mp_status = (body.get("status") or "").lower()
        refund_id = body.get("id")
        refund_id_str = str(refund_id) if refund_id is not None else None
        if mp_status == "approved":
            mapped = RefundStatus.CONFIRMED
        elif mp_status in ("in_process", "pending"):
            mapped = RefundStatus.SENT
        elif mp_status == "rejected":
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                gateway_refund_id=refund_id_str,
                failed_reason=f"MP status={mp_status}",
                raw_response=body,
            )
        else:
            mapped = RefundStatus.SENT

        return RefundResult(
            status=mapped, provider=self.provider_name,
            gateway_refund_id=refund_id_str, raw_response=body,
        )

    async def get_status(self, gateway_refund_id: str) -> RefundStatus:
        if not (self._access_token and gateway_refund_id):
            return RefundStatus.UNKNOWN
        headers = {"Authorization": f"Bearer {self._access_token}"}
        # MP no expone GET directo por refund_id sin el payment; el status
        # actual del payment (refunded / partially_refunded / approved) es
        # la fuente. Sin payment_id contexto aqui, devolvemos UNKNOWN.
        # La reconciliacion diaria consulta por payment_id (guardado en
        # gateway_charge_id) y verifica refunds[] embebido.
        return RefundStatus.UNKNOWN
