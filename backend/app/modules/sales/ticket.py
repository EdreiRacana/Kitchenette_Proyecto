"""Render ticket de venta para envío por correo o WhatsApp."""
from __future__ import annotations

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


def render_ticket_html(order: models.Order, company: Optional[CompanyProfile] = None) -> str:
    """HTML compacto tipo ticket, apto para correo."""
    biz = _biz_name(company)
    logo = ""
    if company and company.logo_url:
        logo = (f'<img src="{company.logo_url}" alt="logo" '
                f'style="max-height:48px;max-width:160px;object-fit:contain;margin-bottom:6px" />')
    kind_label = "Cotización" if order.kind == "quote" else "Pedido"
    folio = order.folio or f"#{order.id}"
    fecha = order.created_at.strftime("%d/%m/%Y %H:%M") if order.created_at else ""
    customer_name = order.customer.name if order.customer else "Mostrador"
    pago = PAYMENT_LABEL.get(order.payment_method or "", order.payment_method or "—")
    estado = STATUS_LABEL.get(order.status or "", order.status or "—")
    currency = order.currency or "MXN"

    def _row(it):
        sku_html = f' <span style="color:#999;font-size:11px">{it.sku}</span>' if it.sku else ""
        line_total = it.subtotal or (it.unit_price * it.quantity)
        return (
            f"<tr><td>{it.product_name or ''}{sku_html}</td>"
            f"<td style='text-align:right'>{it.quantity}</td>"
            f"<td style='text-align:right'>{_money(it.unit_price, currency)}</td>"
            f"<td style='text-align:right'>{_money(line_total, currency)}</td></tr>"
        )

    rows = "".join(_row(it) for it in order.items)

    balance_html = ""
    if order.kind != "quote":
        balance_html = (
            f"<div style='display:flex;justify-content:space-between;font-size:13px;margin:4px 0'>"
            f"<span>Pagado</span><span>{_money(order.paid_amount, currency)}</span></div>"
            f"<div style='display:flex;justify-content:space-between;font-size:13px;margin:4px 0'>"
            f"<span>Saldo</span><span>{_money((order.total_amount or 0) - (order.paid_amount or 0), currency)}</span></div>"
        )

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{folio}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#111;max-width:480px;margin:0 auto;padding:20px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px">
    <div>{logo}<h1 style="font-size:20px;margin:0">{biz}</h1>
      <div style="color:#666;font-size:13px">{kind_label} {folio}</div></div>
    <div style="color:#666;font-size:13px">{fecha}</div>
  </div>
  <div style="color:#666;font-size:13px;margin-top:10px">
    Cliente: {customer_name}<br>Pago: {pago} · Estado: {estado}
  </div>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
    <thead><tr style="border-bottom:1px solid #eee">
      <th style="padding:6px 4px;text-align:left">Producto</th>
      <th style="padding:6px 4px;text-align:right">Cant</th>
      <th style="padding:6px 4px;text-align:right">P.U.</th>
      <th style="padding:6px 4px;text-align:right">Importe</th>
    </tr></thead><tbody>{rows}</tbody></table>
  <div style="margin-top:14px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>Subtotal</span><span>{_money(order.subtotal, currency)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>Descuento</span><span>− {_money(order.discount_amount, currency)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>IVA ({order.tax_rate}%)</span><span>{_money(order.tax_amount, currency)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0"><span>Envío</span><span>{_money(order.shipping_amount, currency)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;border-top:2px solid #111;padding-top:8px;margin-top:8px">
      <span>TOTAL</span><span>{_money(order.total_amount, currency)}</span></div>
    {balance_html}
  </div>
  <p style="text-align:center;color:#666;margin-top:24px;font-size:13px">¡Gracias por su compra!</p>
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
