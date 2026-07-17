"""Envío de WhatsApp del ERP — vía webhook saliente, agnóstico de proveedor.

No se acopla a Twilio/Meta directamente: se configura UN webhook (la propia
automatización del cliente en Twilio, Meta Cloud API, n8n, Make, Zapier, etc.)
por variables de entorno a nivel plataforma. Así el ERP no guarda credenciales
de WhatsApp y el cliente conecta el proveedor que ya usa.

Variables de entorno:
  WHATSAPP_WEBHOOK_URL   URL a la que se hace POST con el mensaje.
  WHATSAPP_API_KEY       (opcional) se manda como header Authorization: Bearer.
  WHATSAPP_DEFAULT_TO    (opcional) número/destino por defecto.

Payload del POST (JSON):
  { "to": "<destino>", "text": "<mensaje>", "source": "sthenova-retail" }

Si no hay webhook configurado, send_whatsapp devuelve (False, motivo) sin
romper el flujo.
"""
import os
from typing import Optional, Tuple

import httpx


def whatsapp_configured() -> bool:
    return bool(os.getenv("WHATSAPP_WEBHOOK_URL"))


async def send_whatsapp(text: str, to: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """POST del mensaje al webhook configurado. Devuelve (ok, error_legible)."""
    url = os.getenv("WHATSAPP_WEBHOOK_URL")
    if not url:
        return False, ("WhatsApp no configurado. Define WHATSAPP_WEBHOOK_URL con la URL "
                       "de tu automatización (Twilio, Meta Cloud API, n8n, Make…).")
    dest = to or os.getenv("WHATSAPP_DEFAULT_TO")
    if not dest:
        return False, "No hay destino de WhatsApp (parámetro 'to' ni WHATSAPP_DEFAULT_TO)."
    headers = {"Content-Type": "application/json"}
    api_key = os.getenv("WHATSAPP_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"to": dest, "text": text, "source": "sthenova-retail"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(url, headers=headers, json=payload)
        if r.status_code < 300:
            return True, None
        return False, f"Webhook WhatsApp {r.status_code}: {r.text[:300]}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
