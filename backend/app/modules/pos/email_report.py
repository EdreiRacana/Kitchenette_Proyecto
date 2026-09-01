"""Render del cuerpo HTML para el correo de cierre de turno a contabilidad.

El detalle completo del turno (arqueo por denominación, movimientos, ventas)
vive en el PDF adjunto. Este HTML es solo la nota profesional que acompaña
al correo: saludo al contador, resumen breve (folio + total + diferencia),
mención del PDF adjunto y despedida cordial.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Tuple


# Content-ID compartido para el logo — el HTML lo referencia como
# <img src="cid:erp-logo"/> y el sender lo adjunta con este mismo cid.
LOGO_CID = "erp-logo"


def logo_inline_attachment(company: Optional[dict]) -> Optional[Tuple[str, bytes, str, str]]:
    """Devuelve el 4-tuple (filename, bytes, subtype, content_id) para adjuntar
    el logo como imagen inline al email — o None si la empresa no tiene logo.
    Los renderers HTML esperan src="cid:erp-logo". El sender debe pasar este
    tuple en `attachments` a send_email para que la referencia se resuelva."""
    if not company:
        return None
    bts = company.get("logo_bytes")
    if not bts:
        return None
    mime = (company.get("logo_mime") or "image/png").lower()
    subtype = mime.split("/", 1)[1] if "/" in mime else "png"
    filename = f"logo.{subtype}"
    return (filename, bts, subtype, LOGO_CID)


def _money(v: float | None) -> str:
    n = float(v or 0)
    return f"${n:,.2f}"


def _fmt_dt(v) -> str:
    if not v:
        return "—"
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except Exception:
            return v
    try:
        return v.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(v)


def render_session_close_html(
    company: dict, session: dict, report: dict, *,
    kind: str = "Z", extra_notes: Optional[str] = None,
) -> str:
    """Nota profesional para el contador: saludo, resumen del turno,
    mención del PDF adjunto y despedida. El detalle vive en el PDF."""
    biz = (company or {}).get("legal_name") or "Sthenova"
    accent = (company or {}).get("brand_color") or "#111827"
    # Logo via CID inline attachment — el sender adjunta el logo con
    # Content-ID "erp-logo" y aqui lo referenciamos. Gmail/Outlook renderizan
    # CID correctamente (bloquean data:base64, por eso no usamos data URI).
    has_logo = bool((company or {}).get("logo_bytes"))
    logo_html = (
        f'<img src="cid:{LOGO_CID}" alt="{biz}" width="130" '
        f'style="width:130px;height:auto;max-width:130px;display:block;margin:0 auto"/>'
    ) if has_logo else ""

    kind_label = "Cierre de turno" if kind == "Z" else "Corte intermedio"
    kind_word = "cierre" if kind == "Z" else "corte"
    variance = float(report.get("variance") or 0)
    var_color = "#DC2626" if variance < 0 else ("#059669" if variance > 0 else "#111827")
    var_txt = f"{'+' if variance > 0 else ''}{_money(variance)}"
    variance_note = (
        "sin diferencias" if abs(variance) < 0.005
        else ("con sobrante" if variance > 0 else "con faltante")
    )

    total_sales = _money(session.get("total_sales_amount"))
    total_count = session.get("total_sales_count") or 0
    terminal_name = session.get("terminal_name") or "—"
    cashier_name = session.get("cashier_name") or "—"
    session_id = session.get("id")

    extra_note_html = ""
    if extra_notes:
        extra_note_html = (
            f'<p style="margin:0 0 14px;padding:10px 12px;background:#F9FAFB;'
            f'border-left:3px solid {accent};font-size:13.5px;color:#374151">'
            f'<b>Notas del cajero:</b> {extra_notes}</p>'
        )

    # Datos de contacto de la empresa para el pie
    contact_bits = []
    contact_email = (company or {}).get("contact_email")
    contact_phone = (company or {}).get("contact_phone")
    address = (company or {}).get("address")
    if contact_phone:
        contact_bits.append(contact_phone)
    if contact_email:
        contact_bits.append(contact_email)
    if address:
        contact_bits.append(address)
    contact_line = " · ".join(contact_bits)

    return f"""<!doctype html>
<html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{kind_label} · Turno #{session_id} — {biz}</title>
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
          <div style="font-size:11.5px;color:#6B7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.6px">{kind_label}</div>
        </td></tr>

        <!-- Cuerpo del mensaje -->
        <tr><td style="padding:28px 32px 8px;font-size:15px;color:#1F2937">
          <p style="margin:0 0 14px">Hola,</p>
          <p style="margin:0 0 14px">
            Se ha cerrado el turno <b>#{session_id}</b> de la caja
            <b>{terminal_name}</b>, operado por <b>{cashier_name}</b>.
          </p>
          <p style="margin:0 0 14px">
            El reporte {kind} completo va <b>adjunto en PDF</b> con el detalle de
            arqueo por denominación, ventas por método de pago, bitácora de
            movimientos y reconciliación post-cierre. Es el documento oficial
            para tu registro contable.
          </p>
          {extra_note_html}
        </td></tr>

        <!-- Resumen breve: ventas, arqueo, diferencia -->
        <tr><td style="padding:0 32px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px">
            <tr>
              <td style="padding:14px 16px;border-bottom:1px solid #E5E7EB">
                <div style="font-size:11.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px">Ventas del turno</div>
                <div style="font-size:20px;color:#111827;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums">{total_sales}</div>
                <div style="font-size:12px;color:#6B7280;margin-top:2px">{total_count} ticket{'s' if total_count != 1 else ''}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 16px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:12.5px;color:#374151">
                  <tr>
                    <td style="padding:3px 0">Efectivo esperado</td>
                    <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{_money(session.get('expected_cash'))}</td>
                  </tr>
                  <tr>
                    <td style="padding:3px 0">Efectivo contado</td>
                    <td style="padding:3px 0;text-align:right;font-variant-numeric:tabular-nums">{_money(session.get('actual_cash'))}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;border-top:1px solid #E5E7EB;color:{var_color};font-weight:700">Diferencia (arqueo)</td>
                    <td style="padding:6px 0;border-top:1px solid #E5E7EB;text-align:right;color:{var_color};font-weight:700;font-variant-numeric:tabular-nums">{var_txt}</td>
                  </tr>
                </table>
                <div style="margin-top:6px;font-size:11.5px;color:#6B7280;text-align:right">
                  Cerrado {variance_note} · {_fmt_dt(session.get('closed_at'))}
                </div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Cierre y despedida -->
        <tr><td style="padding:0 32px 28px;font-size:15px;color:#1F2937">
          <p style="margin:0 0 14px">
            Si detectas cualquier inconsistencia o necesitas información
            adicional sobre este {kind_word}, con gusto la revisamos.
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
      </table>
    </td></tr>
  </table>
</body></html>"""
