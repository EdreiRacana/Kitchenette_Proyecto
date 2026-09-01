"""Render ticket de venta para envío por correo o WhatsApp."""
from __future__ import annotations

import base64
from datetime import date, datetime
from typing import Optional, Dict, List
from urllib.parse import quote

from app.modules.sales import models
from app.modules.core_config.models import CompanyProfile


def _format_batches(batches: Optional[List[dict]]) -> str:
    """Convierte la lista de lotes despachados en una línea legible tipo
    'Cad: 20/08/2026 · Lote L2026-A' — máx 2 lotes visibles para no saturar."""
    if not batches:
        return ""
    parts = []
    for b in batches[:2]:
        exp = b.get("expiration_date")
        code = b.get("batch_code")
        bits = []
        if exp:
            try:
                bits.append(f"Cad: {datetime.fromisoformat(exp).strftime('%d/%m/%Y')}")
            except Exception:
                bits.append(f"Cad: {exp}")
        if code:
            bits.append(f"Lote {code}")
        if bits:
            parts.append(" · ".join(bits))
    extra = "" if len(batches) <= 2 else f" (+{len(batches) - 2} lotes)"
    return " · ".join(parts) + extra


PAYMENT_LABEL = {
    "cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia",
    "check": "Cheque", "credit": "Crédito",
}

STATUS_LABEL = {
    "draft": "Borrador", "pending": "Pendiente", "partial": "Pago parcial",
    "paid": "Pagado", "cancelled": "Cancelado", "converted": "Convertida",
}


def _money(v: float | None, currency: str = "MXN") -> str:
    n = float(v or 0)
    return f"${n:,.2f} {currency}"


def _biz_name(company: Optional[CompanyProfile]) -> str:
    return (company.legal_name if company and company.legal_name else "Kitchenette")


def _logo_data_uri(company: Optional[CompanyProfile]) -> str:
    """Convierte los bytes del logo en un data URI base64. Se inlinea en el
    HTML del correo para que TODO cliente lo muestre — Gmail y Outlook
    bloquean o rompen imágenes referenciadas por URL relativa/http, pero un
    data URI siempre se pinta."""
    if not company or not getattr(company, "logo_bytes", None):
        return ""
    try:
        mime = company.logo_mime or "image/png"
        b64 = base64.b64encode(company.logo_bytes).decode("ascii")
        return f"data:{mime};base64,{b64}"
    except Exception:
        return ""


def _classify_customer_tone(order: models.Order) -> str:
    """Determina el tono del correo y el tipo de PDF adjunto según
    DÓNDE se originó la venta:

      - "pos": la orden se registró en el módulo POS (punto de venta
        físico) → tono cálido personal + ticket térmico 80mm.
      - "b2b": la orden se registró en CRM/Sales (empresas, cadenas,
        mayoristas, marketplaces, distribuidores, ventas telefónicas,
        etc.) → tono institucional + remisión formal en carta.

    Regla única y estable: `order.channel == "pos"` decide, nada más.
    El POS setea explícitamente channel="pos" al registrar la venta
    (pos/service.register_sale), y el módulo Sales usa otros valores
    ("mostrador", "telefono", "whatsapp", "web", "marketplace", …) o
    null. Así una misma cuenta cliente puede tener órdenes POS y CRM
    y cada correo saldrá con el formato correcto según origen.

    Antes esto se decidía por RFC/razón_social/source/relationship_type
    del cliente, pero era frágil: la migración auto-marcaba source='pos'
    para clientes sin datos fiscales y el default relationship_type era
    'retail', dejando a Walmart y similares en la clasificación POS.
    """
    ch = (getattr(order, "channel", None) or "").lower()
    return "pos" if ch == "pos" else "b2b"


def render_ticket_html(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """Cuerpo del correo que acompaña al PDF adjunto.
    Elige tono POS (cálido personal) o B2B (institucional) según el cliente.
    NO es otro ticket — el PDF ya cumple ese rol; este HTML solo introduce.
    """
    tone = _classify_customer_tone(order)
    if tone == "b2b":
        return _render_ticket_html_b2b(order, company)
    return _render_ticket_html_pos(order, company)


def _render_ticket_html_pos(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """Versión mostrador / POS: 'Hola Carlos, gracias por tu compra…'."""
    biz = _biz_name(company)
    # Nota: Gmail/Outlook bloquean data:base64 en <img>, asi que la imagen
    # del logo NO va en el cuerpo del email. El logo si aparece en el PDF
    # adjunto. En el body dejamos solo el nombre de la empresa grande.
    logo_html = ""

    accent = (company.brand_color if company and company.brand_color else "#111827")
    folio = order.folio or f"#{order.id}"
    currency = order.currency or "MXN"
    total_txt = _money(order.total_amount, currency)

    # Saludo personalizado — usamos SOLO el primer nombre. "Estimado Sr. López"
    # se siente frío; "Hola Carlos" es cálido pero profesional. Si es público
    # en general, saludo genérico.
    if order.customer and order.customer.name:
        first_name = order.customer.name.strip().split()[0]
        greeting = f"Hola {first_name},"
    else:
        greeting = "Hola,"

    # Datos de contacto del negocio para el pie
    contact_bits = []
    if company:
        if company.contact_phone:
            contact_bits.append(company.contact_phone)
        if company.contact_email:
            contact_bits.append(company.contact_email)
        if company.address:
            contact_bits.append(company.address)
    contact_line = " · ".join(contact_bits)
    footer_txt = (company.document_footer if company and company.document_footer else "")

    kind_word = "cotización" if order.kind == "quote" else "compra"

    return f"""<!doctype html>
<html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gracias por tu {kind_word} — {biz}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;line-height:1.55">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;background:#F3F4F6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:520px;background:#ffffff;border-radius:14px;
                    box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">

        <!-- Encabezado con logo pequeño -->
        <tr><td style="padding:28px 32px 16px;text-align:center;border-bottom:3px solid {accent}">
          {logo_html}
          <div style="font-size:16px;font-weight:800;color:#111827;margin-top:{'10px' if logo_html else '0'}">{biz}</div>
        </td></tr>

        <!-- Cuerpo del mensaje -->
        <tr><td style="padding:28px 32px 8px;font-size:15px;color:#1F2937">
          <p style="margin:0 0 14px">{greeting}</p>
          <p style="margin:0 0 14px">
            Gracias por tu {kind_word}. Fue un gusto atenderte.
          </p>
          <p style="margin:0 0 14px">
            Encontrarás tu ticket completo en el <b>archivo PDF adjunto</b> a este correo,
            con el detalle de los productos, cantidades y totales.
            Te sugerimos guardarlo por si necesitas hacer alguna aclaración o devolución.
          </p>
        </td></tr>

        <!-- Resumen breve (solo folio + total, sin duplicar la tabla del PDF) -->
        <tr><td style="padding:0 32px 20px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px">
            <tr>
              <td style="padding:12px 16px;font-size:12.5px;color:#6B7280">
                Folio
                <div style="font-family:monospace;font-size:14px;color:#111827;font-weight:700;margin-top:2px">{folio}</div>
              </td>
              <td style="padding:12px 16px;text-align:right;font-size:12.5px;color:#6B7280">
                Total
                <div style="font-size:18px;color:#111827;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums">{total_txt}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Cierre y despedida -->
        <tr><td style="padding:0 32px 28px;font-size:15px;color:#1F2937">
          <p style="margin:0 0 14px">
            Si necesitas cualquier cosa, no dudes en escribirnos o llamarnos —
            estamos para ayudarte.
          </p>
          <p style="margin:0">
            Un cordial saludo,<br>
            <b style="color:#111827">Equipo {biz}</b>
          </p>
        </td></tr>

        <!-- Pie con contacto -->
        {(
          '<tr><td style="padding:16px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;'
          'text-align:center;color:#6B7280;font-size:11.5px">' +
          contact_line +
          '</td></tr>'
        ) if contact_line else ""}
        {(
          f'<tr><td style="padding:10px 32px;background:#F9FAFB;text-align:center;'
          f'color:#9CA3AF;font-size:11px">{footer_txt}</td></tr>'
        ) if footer_txt else ""}
      </table>
    </td></tr>
  </table>
</body></html>"""


def _render_ticket_html_b2b(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """Versión institucional B2B: para distribuidores, mayoristas, cadenas
    de retail (Walmart, Soriana, HEB) y marketplaces. Tono formal, referencia
    al pedido con folio + orden de compra si aplica, términos de pago y
    persona de contacto para logística."""
    biz = _biz_name(company)
    logo_uri = _logo_data_uri(company)
    logo_html = (
        f'<img src="{logo_uri}" alt="{biz}" width="130" '
        f'style="width:130px;height:auto;max-width:130px;display:block;margin:0 auto"/>'
    ) if logo_uri else ""

    accent = (company.brand_color if company and company.brand_color else "#111827")
    folio = order.folio or f"#{order.id}"
    currency = order.currency or "MXN"
    total_txt = _money(order.total_amount, currency)

    cust = order.customer
    # Dirigirnos a la razón social si la tenemos (más formal en B2B), o al
    # nombre comercial. Para saludo del cuerpo usamos "Estimado equipo de X".
    razon = (cust.razon_social if cust and cust.razon_social else None)
    nombre_comercial = (cust.name if cust else None)
    display_name = razon or nombre_comercial or "cliente"
    salutation = f"Estimado equipo de {nombre_comercial or razon},"

    kind_word = "cotización" if order.kind == "quote" else "pedido"
    kind_word_cap = "Cotización" if order.kind == "quote" else "Pedido"

    # Términos de pago si aplican
    pay_line = ""
    if order.kind != "quote":
        pay_method_label = {
            "cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia",
            "check": "Cheque", "credit": "Crédito",
        }.get(order.payment_method or "", None)
        credit_days = getattr(cust, "credit_days", None) if cust else None
        if credit_days and credit_days > 0:
            pay_line = f"Términos: crédito a {credit_days} días naturales."
        elif pay_method_label:
            pay_line = f"Forma de pago: {pay_method_label}."

    # Contacto de la empresa remitente para logística / aclaraciones
    contact_bits = []
    if company:
        if company.contact_phone:
            contact_bits.append(f"Tel. {company.contact_phone}")
        if company.contact_email:
            contact_bits.append(company.contact_email)
    contact_line = " · ".join(contact_bits)
    footer_txt = (company.document_footer if company and company.document_footer else "")

    return f"""<!doctype html>
<html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{kind_word_cap} {folio} — {biz}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;line-height:1.55">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F3F4F6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;
                    box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">

        <!-- Header con logo pequeño y razón social -->
        <tr><td style="padding:26px 32px 14px;text-align:center;border-bottom:3px solid {accent}">
          {logo_html}
          <div style="font-size:16px;font-weight:800;color:#111827;margin-top:{'10px' if logo_html else '0'}">{biz}</div>
          <div style="font-size:11.5px;color:#6B7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.6px">
            {kind_word_cap} {folio}
          </div>
        </td></tr>

        <!-- Cuerpo institucional -->
        <tr><td style="padding:28px 32px 8px;font-size:14.5px;color:#1F2937">
          <p style="margin:0 0 14px">{salutation}</p>
          <p style="margin:0 0 14px">
            Por medio del presente, adjuntamos el <b>{kind_word}</b> con folio
            <b style="font-family:monospace">{folio}</b> emitido a nombre de
            <b>{display_name}</b>. El detalle formal — productos, cantidades,
            precios unitarios, impuestos y totales — se encuentra en el
            <b>archivo PDF adjunto</b>, que también sirve como documento
            respaldo para cualquier proceso de recepción o conciliación.
          </p>
          {f'<p style="margin:0 0 14px">{pay_line}</p>' if pay_line else ''}
        </td></tr>

        <!-- Card con folio + total -->
        <tr><td style="padding:0 32px 20px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px">
            <tr>
              <td style="padding:14px 16px;font-size:12.5px;color:#6B7280">
                Folio
                <div style="font-family:monospace;font-size:14px;color:#111827;font-weight:700;margin-top:2px">{folio}</div>
              </td>
              <td style="padding:14px 16px;text-align:right;font-size:12.5px;color:#6B7280">
                Total
                <div style="font-size:18px;color:#111827;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums">{total_txt}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Cierre institucional -->
        <tr><td style="padding:0 32px 28px;font-size:14.5px;color:#1F2937">
          <p style="margin:0 0 12px">
            Para cualquier aclaración, ajuste o coordinación logística respecto
            a este {kind_word}, quedamos a sus órdenes por los medios habituales.
          </p>
          <p style="margin:0">
            Atentamente,<br>
            <b style="color:#111827">{biz}</b>
            {f'<br><span style="font-size:12.5px;color:#6B7280">{contact_line}</span>' if contact_line else ''}
          </p>
        </td></tr>

        {(
          f'<tr><td style="padding:10px 32px;background:#F9FAFB;text-align:center;'
          f'color:#9CA3AF;font-size:11px">{footer_txt}</td></tr>'
        ) if footer_txt else ""}
      </table>
    </td></tr>
  </table>
</body></html>"""


def render_ticket_text(order: models.Order, company: Optional[CompanyProfile] = None,
                        batches_by_variant: Optional[Dict[int, List[dict]]] = None) -> str:
    """Ticket en texto plano, optimizado para WhatsApp (con emojis y bold *…*).
    Si viene batches_by_variant, imprime "Cad: dd/mm/yyyy · Lote X" bajo cada
    producto perecedero — requisito legal para alimentos y farmacéuticos."""
    biz = _biz_name(company)
    kind_label = "Cotización" if order.kind == "quote" else "Pedido"
    folio = order.folio or f"#{order.id}"
    fecha = order.created_at.strftime("%d/%m/%Y %H:%M") if order.created_at else ""
    customer_name = order.customer.name if order.customer else "Mostrador"
    currency = order.currency or "MXN"

    lines = [
        f"🧾 *{biz}*",
        f"{kind_label} *{folio}* — {fecha}",
        f"Cliente: {customer_name}",
        "",
        "*Productos:*",
    ]
    for it in order.items:
        sub = it.subtotal or (it.unit_price * it.quantity)
        lines.append(f"• {it.product_name or ''} x{it.quantity} — {_money(sub, currency)}")
        batch_line = _format_batches((batches_by_variant or {}).get(it.variant_id))
        if batch_line:
            lines.append(f"    _{batch_line}_")
    lines += [
        "",
        f"Subtotal: {_money(order.subtotal, currency)}",
    ]
    if (order.discount_amount or 0) > 0:
        lines.append(f"Descuento: -{_money(order.discount_amount, currency)}")
    if (order.tax_amount or 0) > 0:
        lines.append(f"IVA ({order.tax_rate}%): {_money(order.tax_amount, currency)}")
    if (order.shipping_amount or 0) > 0:
        lines.append(f"Envío: {_money(order.shipping_amount, currency)}")
    lines.append(f"*TOTAL: {_money(order.total_amount, currency)}*")
    if order.kind != "quote":
        lines.append(f"Pagado: {_money(order.paid_amount, currency)}")
        saldo = (order.total_amount or 0) - (order.paid_amount or 0)
        lines.append(f"Saldo: {_money(saldo, currency)}")
    lines += ["", "¡Gracias por su compra! 🙌"]
    return "\n".join(lines)


def normalize_phone(raw: str | None) -> str:
    """Deja solo dígitos. Si no trae lada, asume MX (52)."""
    if not raw:
        return ""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        return ""
    # Si son 10 dígitos, asume México
    if len(digits) == 10:
        digits = "52" + digits
    return digits


def build_whatsapp_link(phone: str, text: str) -> str:
    """URL wa.me lista para abrir WhatsApp Web/App con el mensaje pre-llenado."""
    p = normalize_phone(phone)
    return f"https://wa.me/{p}?text={quote(text)}"
