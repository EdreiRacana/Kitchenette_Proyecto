"""Adaptador Stripe — llama a la API REST directamente via httpx.

Docs de refund: https://stripe.com/docs/api/refunds/create
  POST https://api.stripe.com/v1/refunds
    Auth: Bearer <secret_key>
    Body (application/x-www-form-urlencoded):
      charge=ch_xxx OR payment_intent=pi_xxx
      amount=NNN     (en centavos)
      reason=requested_by_customer
      metadata[<key>]=<value>
    Header: Idempotency-Key: <uuid>

Ventana: 180 dias desde el charge.
Batch settlement: los refunds via Stripe son casi instantaneos al ACK
pero pueden aparecer en el estado de cuenta 5-10 dias despues.

No requiere paquete stripe — usamos httpx (ya instalado). Nos evitamos
una dep extra y controlamos exactamente los timeouts.
"""
from __future__ import annotations
from typing import Optional
import httpx

from .base import PaymentGateway, RefundRequest, RefundResult, RefundStatus


class StripeGateway(PaymentGateway):
    provider_name = "stripe"

    def __init__(self, api_key: str, base_url: str = "https://api.stripe.com/v1"):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    async def refund(self, req: RefundRequest) -> RefundResult:
        if not self._api_key:
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason="Stripe: API key no configurada para esta empresa.",
            )

        # Stripe trabaja en centavos — jamas float directo.
        amount_cents = int(round(req.amount * 100))
        if amount_cents <= 0:
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason="Monto de refund invalido (<= 0).",
            )

        # Aceptamos ambas formas de referencia (payment_intent o charge id)
        charge_ref = (req.original_charge_id or "").strip()
        payload: dict = {"amount": amount_cents}
        if charge_ref.startswith("pi_"):
            payload["payment_intent"] = charge_ref
        elif charge_ref.startswith("ch_") or charge_ref.startswith("py_"):
            payload["charge"] = charge_ref
        else:
            # Sin prefijo asumimos charge id (Stripe legacy) — la propia API
            # respondera 404 si no existe, y lo mapeamos a FAILED con detalle.
            payload["charge"] = charge_ref
        if req.reason:
            payload["reason"] = "requested_by_customer"
            payload["metadata[reason]"] = req.reason[:500]

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if req.idempotency_key:
            headers["Idempotency-Key"] = req.idempotency_key

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self._base_url}/refunds", data=payload, headers=headers,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            # Timeout: la request pudo o no haber llegado — reconciliacion manual
            return RefundResult(
                status=RefundStatus.UNKNOWN, provider=self.provider_name,
                failed_reason=f"Timeout/red al contactar Stripe: {e!s}. Verificar en dashboard.",
            )

        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:500]}

        if resp.status_code >= 400:
            err = (body.get("error") or {}) if isinstance(body, dict) else {}
            reason = err.get("message") or f"HTTP {resp.status_code}"
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                failed_reason=f"Stripe rechazo: {reason}",
                raw_response=body if isinstance(body, dict) else None,
            )

        # Stripe devuelve el refund object; status puede ser 'pending', 'succeeded',
        # 'failed', 'canceled'. Mapeamos a nuestra maquina.
        stripe_status = (body.get("status") or "").lower()
        refund_id = body.get("id")
        if stripe_status == "succeeded":
            mapped = RefundStatus.CONFIRMED
        elif stripe_status == "pending":
            mapped = RefundStatus.SENT
        elif stripe_status in ("failed", "canceled"):
            return RefundResult(
                status=RefundStatus.FAILED, provider=self.provider_name,
                gateway_refund_id=refund_id,
                failed_reason=f"Stripe status={stripe_status}: {body.get('failure_reason') or ''}",
                raw_response=body,
            )
        else:
            mapped = RefundStatus.SENT

        return RefundResult(
            status=mapped, provider=self.provider_name,
            gateway_refund_id=refund_id, raw_response=body,
        )

    async def get_status(self, gateway_refund_id: str) -> RefundStatus:
        if not (self._api_key and gateway_refund_id):
            return RefundStatus.UNKNOWN
        headers = {"Authorization": f"Bearer {self._api_key}"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    f"{self._base_url}/refunds/{gateway_refund_id}", headers=headers,
                )
        except Exception:
            return RefundStatus.UNKNOWN
        if resp.status_code >= 400:
            return RefundStatus.UNKNOWN
        try:
            body = resp.json()
        except Exception:
            return RefundStatus.UNKNOWN
        st = (body.get("status") or "").lower()
        if st == "succeeded":
            return RefundStatus.CONFIRMED
        if st == "pending":
            return RefundStatus.SENT
        if st in ("failed", "canceled"):
            return RefundStatus.FAILED
        return RefundStatus.UNKNOWN
