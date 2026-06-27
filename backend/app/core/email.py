"""Envío de correo genérico vía SMTP, configurado por cliente (multi-tenant).

Cada empresa que usa el ERP configura su propio servidor de correo en
Configuración > Integraciones (tabla system_integrations, integration_type=EMAIL).
No hay credenciales globales: si el cliente no configuró nada, send_email
simplemente no hace nada (no rompe el flujo que lo llama).
"""
import smtplib
import ssl
from typing import Optional, Sequence, Tuple
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.core_config.models import SystemIntegration, IntegrationType


async def get_active_email_integration(db: AsyncSession) -> SystemIntegration | None:
    res = await db.execute(
        select(SystemIntegration).where(
            SystemIntegration.integration_type == IntegrationType.EMAIL,
            SystemIntegration.is_active == True,  # noqa: E712
        )
    )
    return res.scalars().first()


async def send_email(db: AsyncSession, *, to: str, subject: str, body_html: str,
                     attachments: Optional[Sequence[Tuple[str, bytes, str]]] = None) -> bool:
    """Devuelve True si se envió, False si no hay configuración activa o falló.

    `attachments` es una lista de (nombre_archivo, contenido_bytes, subtipo_mime),
    por ejemplo ("OC-123.pdf", b"...", "pdf"), para adjuntar documentos como PDFs.
    """
    if not to:
        return False
    integration = await get_active_email_integration(db)
    if not integration:
        return False

    meta = integration.meta_data or {}
    host = meta.get("host")
    port = int(meta.get("port") or 587)
    use_tls = meta.get("use_tls", True)
    from_email = meta.get("from_email") or integration.api_key
    from_name = meta.get("from_name") or "Sthenova ERP"
    username = integration.api_key
    password = integration.api_secret

    if not host or not from_email:
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to
    msg.attach(MIMEText(body_html, "html"))

    for filename, content, subtype in (attachments or []):
        part = MIMEApplication(content, _subtype=subtype)
        part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(part)

    try:
        if use_tls:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.starttls(context=ssl.create_default_context())
                if username and password:
                    server.login(username, password)
                server.sendmail(from_email, [to], msg.as_string())
        else:
            with smtplib.SMTP_SSL(host, port, timeout=15) as server:
                if username and password:
                    server.login(username, password)
                server.sendmail(from_email, [to], msg.as_string())
        return True
    except Exception as exc:
        print(f"[email] error enviando a {to}: {exc}")
        return False
