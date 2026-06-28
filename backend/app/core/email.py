"""Envío de correo del ERP.

Dos modos, en este orden de preferencia:
  1) Proveedor HTTP a nivel PLATAFORMA (Resend / SendGrid) vía variables de
     entorno. Es el modo recomendado y el único que funciona en hostings que
     bloquean SMTP saliente (como Render). Una sola cuenta/llave sirve a TODOS
     los clientes; la empresa cliente NO configura nada de correo. Soporta
     adjuntos (PDF/XML de facturas, OC, etc.).
  2) SMTP por empresa (tabla system_integrations). Fallback para auto-hospedaje
     en servidores que sí permiten SMTP saliente.

Si no hay ninguno configurado, send_email no hace nada (no rompe el flujo).

Variables de entorno (modo 1):
  EMAIL_PROVIDER = resend | sendgrid | brevo   (opcional; se infiere de la llave)
  EMAIL_API_KEY  / RESEND_API_KEY / SENDGRID_API_KEY / BREVO_API_KEY
  MAIL_FROM      = "STHENOVA <notificaciones@tu-dominio.com>"
"""
import os
import ssl
import base64
import smtplib
from email.utils import parseaddr, formataddr
from typing import Optional, Sequence, Tuple
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.core_config.models import SystemIntegration, IntegrationType


# ── Proveedor HTTP a nivel plataforma ─────────────────────────────────────────

def _platform_provider() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Devuelve (provider, api_key, mail_from) si hay un proveedor HTTP
    configurado por variables de entorno; si no, (None, None, None)."""
    provider = (os.getenv("EMAIL_PROVIDER") or "").lower().strip()
    api_key = (os.getenv("EMAIL_API_KEY") or os.getenv("RESEND_API_KEY")
               or os.getenv("SENDGRID_API_KEY") or os.getenv("BREVO_API_KEY"))
    mail_from = os.getenv("MAIL_FROM")
    if not provider:
        if os.getenv("RESEND_API_KEY"):
            provider = "resend"
        elif os.getenv("SENDGRID_API_KEY"):
            provider = "sendgrid"
        elif os.getenv("BREVO_API_KEY"):
            provider = "brevo"
    if provider in ("resend", "sendgrid", "brevo") and api_key and mail_from:
        return provider, api_key, mail_from
    return None, None, None


async def _company_identity(db: AsyncSession) -> Tuple[Optional[str], Optional[str]]:
    """(nombre_empresa, correo_contacto) para firmar el remitente y el reply-to,
    para que el correo se vea "de parte de" la empresa cliente."""
    try:
        from app.modules.core_config.service import get_company_profile
        company = await get_company_profile(db)
        if company:
            return getattr(company, "name", None), getattr(company, "contact_email", None)
    except Exception:
        pass
    return None, None


def _b64_attachments(attachments) -> list:
    return [(fn, base64.b64encode(content).decode("ascii"), st) for fn, content, st in (attachments or [])]


async def _send_http(provider: str, api_key: str, mail_from: str, *, to: str, subject: str,
                     body_html: str, reply_to: Optional[str] = None, from_name: Optional[str] = None,
                     attachments=None) -> Tuple[bool, Optional[str]]:
    """Envía por API HTTP (Resend/SendGrid). Devuelve (ok, error_legible)."""
    base_name, base_email = parseaddr(mail_from)
    if not base_email:
        return False, "MAIL_FROM inválido (debe ser 'Nombre <correo@dominio>')."
    display = from_name or base_name or "Sthenova ERP"
    try:
        if provider == "resend":
            payload = {"from": formataddr((display, base_email)), "to": [to],
                       "subject": subject, "html": body_html}
            if reply_to:
                payload["reply_to"] = reply_to
            atts = _b64_attachments(attachments)
            if atts:
                payload["attachments"] = [{"filename": fn, "content": c} for fn, c, _st in atts]
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post("https://api.resend.com/emails",
                                      headers={"Authorization": f"Bearer {api_key}"}, json=payload)
            return (True, None) if r.status_code < 300 else (False, f"Resend {r.status_code}: {r.text[:300]}")

        if provider == "sendgrid":
            msg = {"personalizations": [{"to": [{"email": to}]}],
                   "from": {"email": base_email, "name": display},
                   "subject": subject,
                   "content": [{"type": "text/html", "value": body_html}]}
            if reply_to:
                msg["reply_to"] = {"email": reply_to}
            atts = _b64_attachments(attachments)
            if atts:
                msg["attachments"] = [{"content": c, "filename": fn, "type": f"application/{st}",
                                       "disposition": "attachment"} for fn, c, st in atts]
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post("https://api.sendgrid.com/v3/mail/send",
                                      headers={"Authorization": f"Bearer {api_key}"}, json=msg)
            return (True, None) if r.status_code < 300 else (False, f"SendGrid {r.status_code}: {r.text[:300]}")

        if provider == "brevo":
            payload = {"sender": {"name": display, "email": base_email},
                       "to": [{"email": to}],
                       "subject": subject,
                       "htmlContent": body_html}
            if reply_to:
                payload["replyTo"] = {"email": reply_to}
            atts = _b64_attachments(attachments)
            if atts:
                payload["attachment"] = [{"name": fn, "content": c} for fn, c, _st in atts]
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post("https://api.brevo.com/v3/smtp/email",
                                      headers={"api-key": api_key, "accept": "application/json"}, json=payload)
            return (True, None) if r.status_code < 300 else (False, f"Brevo {r.status_code}: {r.text[:300]}")

        return False, f"Proveedor de correo desconocido: {provider}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ── SMTP por empresa (fallback) ───────────────────────────────────────────────

async def get_active_email_integration(db: AsyncSession) -> SystemIntegration | None:
    res = await db.execute(
        select(SystemIntegration).where(
            SystemIntegration.integration_type == IntegrationType.EMAIL,
            SystemIntegration.is_active == True,  # noqa: E712
        )
    )
    return res.scalars().first()


def _deliver(*, host: str, port: int, use_tls: bool, username: Optional[str],
             password: Optional[str], from_email: str, to: str, msg: MIMEMultipart) -> None:
    """Entrega por SMTP. Lanza excepción si falla. Puerto 465 => SSL implícito;
    587 (u otros) con use_tls => STARTTLS."""
    if int(port) == 465:
        with smtplib.SMTP_SSL(host, port, timeout=15, context=ssl.create_default_context()) as server:
            if username and password:
                server.login(username, password)
            server.sendmail(from_email, [to], msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            if use_tls:
                server.starttls(context=ssl.create_default_context())
            if username and password:
                server.login(username, password)
            server.sendmail(from_email, [to], msg.as_string())


def _build_mime(*, from_name: str, from_email: str, to: str, subject: str,
                body_html: str, attachments=None) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to
    msg.attach(MIMEText(body_html, "html"))
    for filename, content, subtype in (attachments or []):
        part = MIMEApplication(content, _subtype=subtype)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)
    return msg


async def _send_smtp(db: AsyncSession, *, to: str, subject: str, body_html: str,
                     attachments=None) -> Tuple[bool, Optional[str]]:
    integration = await get_active_email_integration(db)
    if not integration:
        return False, "No hay correo configurado (ni proveedor de plataforma ni SMTP)."
    meta = integration.meta_data or {}
    host = meta.get("host")
    port = int(meta.get("port") or 587)
    use_tls = meta.get("use_tls", True)
    from_email = meta.get("from_email") or integration.api_key
    from_name = meta.get("from_name") or "Sthenova ERP"
    if not host:
        return False, "Falta el servidor SMTP (host)."
    if not from_email:
        return False, "Falta el correo remitente (from_email)."
    msg = _build_mime(from_name=from_name, from_email=from_email, to=to,
                      subject=subject, body_html=body_html, attachments=attachments)
    try:
        _deliver(host=host, port=port, use_tls=use_tls, username=integration.api_key,
                 password=integration.api_secret, from_email=from_email, to=to, msg=msg)
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ── API pública ───────────────────────────────────────────────────────────────

async def send_email(db: AsyncSession, *, to: str, subject: str, body_html: str,
                     attachments: Optional[Sequence[Tuple[str, bytes, str]]] = None) -> bool:
    """Envía un correo. Prefiere el proveedor HTTP de plataforma; si no hay,
    cae al SMTP por empresa. Devuelve True si se envió. `attachments` es una
    lista de (nombre_archivo, contenido_bytes, subtipo_mime)."""
    if not to:
        return False
    from_name, reply_to = await _company_identity(db)
    provider, api_key, mail_from = _platform_provider()
    if provider:
        ok, err = await _send_http(provider, api_key, mail_from, to=to, subject=subject,
                                   body_html=body_html, reply_to=reply_to, from_name=from_name,
                                   attachments=attachments)
        if not ok:
            print(f"[email] proveedor HTTP error enviando a {to}: {err}")
        return ok
    ok, err = await _send_smtp(db, to=to, subject=subject, body_html=body_html, attachments=attachments)
    if not ok:
        print(f"[email] SMTP error enviando a {to}: {err}")
    return ok


async def send_test_email(db: AsyncSession, to: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Envía un correo de prueba y devuelve (ok, error_legible) SIN tragarse el
    error, para diagnosticar la configuración desde la UI."""
    from_name, contact = await _company_identity(db)
    provider, api_key, mail_from = _platform_provider()
    body = (f"<p>✅ ¡Funciona! Correo de prueba de STHENOVA ERP"
            f"{' vía ' + provider if provider else ''}.</p>"
            f"<p>La configuración de correo está correcta; los recordatorios y avisos podrán enviarse.</p>")
    if provider:
        _, base_email = parseaddr(mail_from)
        dest = to or contact or base_email
        if not dest:
            return False, "No hay destinatario para la prueba."
        return await _send_http(provider, api_key, mail_from, to=dest,
                                subject="Prueba de correo — Sthenova ERP", body_html=body,
                                reply_to=contact, from_name=from_name)
    # Fallback SMTP
    integration = await get_active_email_integration(db)
    if not integration:
        return False, ("No hay proveedor de correo de plataforma (variables Resend/SendGrid) "
                       "ni una integración SMTP activa. Configura uno de los dos.")
    dest = to or (integration.meta_data or {}).get("from_email") or integration.api_key
    if not dest:
        return False, "No hay destinatario para la prueba."
    return await _send_smtp(db, to=dest, subject="Prueba de correo — Sthenova ERP", body_html=body)
