"""Render ticket de venta para envío por correo o WhatsApp."""
from __future__ import annotations

import base64
from typing import Optional
from urllib.parse import quote

from app.modules.sales import models
from app.modules.core_config.models import CompanyProfile


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


def render_ticket_html(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """HTML del ticket para correo. Layout de tabla (compatible con Gmail,
    Outlook, iOS Mail) — flex y grid rompen en muchos clientes de correo.
    Logo va embebido como data URI para que se pinte siempre."""
    biz = _biz_name(company)
    logo_uri = _logo_data_uri(company)
    logo_html = (
        f'<img src="{logo_uri}" alt="{biz}" '
        f'style="max-height:56px;max-width:180px;display:block;margin:0 auto 8px" />'
    ) if logo_uri else ""

    accent = (company.brand_color if company and company.brand_color else "#111")
    kind_label = "Cotización" if order.kind == "quote" else "Ticket de compra"
    folio = order.folio or f"#{order.id}"
    fecha = order.created_at.strftime("%d/%m/%Y %H:%M") if order.created_at else ""
    customer_name = order.customer.name if order.customer else "Público general"
    pago = PAYMENT_LABEL.get(order.payment_method or "", order.payment_method or "—")
    estado = STATUS_LABEL.get(order.status or "", order.status or "—")
    currency = order.currency or "MXN"

    def _row(it):
        sku_html = (
            f'<div style="color:#888;font-size:11px;font-family:monospace;margin-top:2px">{it.sku}</div>'
            if it.sku else ""
        )
        line_total = it.subtotal or (it.unit_price * it.quantity)
        # Cada celda con anchos explícitos — Gmail respeta width en <td>,
        # no en <th> o inline flex. Sin esto los headers se acomodan mal.
        return (
            "<tr>"
            f'<td style="padding:10px 6px;border-bottom:1px solid #eee;vertical-align:top">'
            f'<div style="font-weight:600;color:#111;font-size:13.5px">{it.product_name or ""}</div>'
            f'{sku_html}</td>'
            f'<td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:right;'
            f'vertical-align:top;width:44px;font-variant-numeric:tabular-nums">{it.quantity}</td>'
            f'<td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:right;'
            f'vertical-align:top;width:90px;font-variant-numeric:tabular-nums">'
            f'{_money(it.unit_price, currency)}</td>'
            f'<td style="padding:10px 6px;border-bottom:1px solid #eee;text-align:right;'
            f'vertical-align:top;width:100px;font-weight:700;font-variant-numeric:tabular-nums">'
            f'{_money(line_total, currency)}</td>'
            "</tr>"
        )

    rows = "".join(_row(it) for it in order.items)

    def _tot_row(label: str, value: str, *, bold: bool = False, big: bool = False,
                 color: str = "#111") -> str:
        weight = 800 if big else (700 if bold else 400)
        size = "17px" if big else "13px"
        border = "border-top:2px solid #111;" if big else ""
        return (
            f'<tr><td colspan="3" style="{border}padding:{"10px" if big else "5px"} 6px;'
            f'text-align:right;color:{color};font-size:{size};font-weight:{weight}">{label}</td>'
            f'<td style="{border}padding:{"10px" if big else "5px"} 6px;text-align:right;'
            f'color:{color};font-size:{size};font-weight:{weight};'
            f'font-variant-numeric:tabular-nums;width:100px">{value}</td></tr>'
        )

    totals_rows = [_tot_row("Subtotal", _money(order.subtotal, currency))]
    if (order.discount_amount or 0) > 0:
        totals_rows.append(_tot_row("Descuento",
                                    f"− {_money(order.discount_amount, currency)}",
                                    color="#DC2626"))
    if (order.tax_amount or 0) > 0:
        totals_rows.append(_tot_row(f"IVA ({order.tax_rate}%)",
                                    _money(order.tax_amount, currency)))
    if (order.shipping_amount or 0) > 0:
        totals_rows.append(_tot_row("Envío", _money(order.shipping_amount, currency)))
    totals_rows.append(_tot_row("TOTAL", _money(order.total_amount, currency), big=True))
    if order.kind != "quote":
        totals_rows.append(_tot_row("Pagado", _money(order.paid_amount, currency),
                                    bold=True, color="#059669"))
        saldo = (order.total_amount or 0) - (order.paid_amount or 0)
        if abs(saldo) > 0.005:
            totals_rows.append(_tot_row("Saldo", _money(saldo, currency),
                                        bold=True,
                                        color="#DC2626" if saldo > 0 else "#059669"))

    footer_txt = (company.document_footer if company and company.document_footer else "")

    return f"""<!doctype html>
<html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{folio} — {biz}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="width:100%;background:#F3F4F6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:520px;background:#fff;border-radius:14px;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);overflow:hidden">
        <!-- Encabezado con logo -->
        <tr><td style="padding:24px 24px 16px;text-align:center;
                       border-bottom:3px solid {accent}">
          {logo_html}
          <div style="font-size:20px;font-weight:800;color:#111;margin-top:4px">{biz}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:4px;text-transform:uppercase;
                      letter-spacing:0.6px">{kind_label}</div>
        </td></tr>

        <!-- Datos del ticket -->
        <tr><td style="padding:16px 24px;background:#F9FAFB;border-bottom:1px solid #E5E7EB">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:12.5px;color:#374151">
            <tr>
              <td style="padding:2px 0"><b>Folio:</b> <span style="font-family:monospace">{folio}</span></td>
              <td style="padding:2px 0;text-align:right">{fecha}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding:2px 0"><b>Cliente:</b> {customer_name}</td>
            </tr>
            <tr>
              <td style="padding:2px 0"><b>Pago:</b> {pago}</td>
              <td style="padding:2px 0;text-align:right"><b>Estado:</b> {estado}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Tabla de productos -->
        <tr><td style="padding:8px 24px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:12.5px">
            <thead>
              <tr style="background:#F3F4F6">
                <th align="left"   style="padding:8px 6px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px;font-size:10.5px;font-weight:700">Producto</th>
                <th align="right"  style="padding:8px 6px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px;font-size:10.5px;font-weight:700;width:44px">Cant</th>
                <th align="right"  style="padding:8px 6px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px;font-size:10.5px;font-weight:700;width:90px">P.U.</th>
                <th align="right"  style="padding:8px 6px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px;font-size:10.5px;font-weight:700;width:100px">Importe</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </td></tr>

        <!-- Totales -->
        <tr><td style="padding:8px 24px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
            {"".join(totals_rows)}
          </table>
        </td></tr>

        <!-- Pie -->
        <tr><td style="padding:18px 24px;background:#F9FAFB;text-align:center;
                       border-top:1px solid #E5E7EB;color:#6B7280;font-size:12px">
          ¡Gracias por su compra! 🙌<br>
          <span style="font-size:11px">Se adjunta este ticket en PDF.</span>
          {f'<div style="margin-top:8px;font-size:11px;color:#9CA3AF">{footer_txt}</div>' if footer_txt else ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def render_ticket_text(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """Ticket en texto plano, optimizado para WhatsApp (con emojis y bold *…*)."""
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
