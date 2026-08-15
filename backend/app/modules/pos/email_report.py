"""Render del cuerpo HTML para el correo de cierre de turno a contabilidad."""
from __future__ import annotations

from datetime import datetime
from typing import Optional


PAYMENT_LABEL = {
    "cash": "Efectivo", "card": "Tarjeta", "transfer": "Transferencia",
    "check": "Cheque", "credit": "Crédito", "unknown": "Otros",
}


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
    """HTML compacto listo para pegar en un correo transaccional.

    Muestra los mismos datos clave que el reporte Z en PDF adjunto, para que el
    contador pueda revisar de un vistazo sin abrir el PDF.
    """
    biz = (company or {}).get("legal_name") or "Sthenova"
    logo_url = (company or {}).get("logo_url")
    logo = ""
    if logo_url:
        logo = (f'<img src="{logo_url}" alt="logo" '
                f'style="max-height:44px;max-width:160px;object-fit:contain;margin-bottom:8px" />')

    kind_label = "Cierre de turno" if kind == "Z" else "Corte intermedio"
    variance = float(report.get("variance") or 0)
    var_color = "#DC2626" if variance < 0 else ("#059669" if variance > 0 else "#111")
    var_txt = f"{'+' if variance > 0 else ''}{_money(variance)}"

    by_method = report.get("sales_by_method") or {}
    methods_rows = "".join(
        f"<tr><td style='padding:4px 6px'>{PAYMENT_LABEL.get(k, k.title())}</td>"
        f"<td style='padding:4px 6px;text-align:right;font-variant-numeric:tabular-nums'>{_money(v)}</td></tr>"
        for k, v in by_method.items()
    ) or "<tr><td colspan='2' style='padding:6px;color:#666'>Sin ventas</td></tr>"

    notes_block = ""
    parts = []
    if session.get("opening_notes"):
        parts.append(f"<div><b>Apertura:</b> {session['opening_notes']}</div>")
    if session.get("closing_notes"):
        parts.append(f"<div style='margin-top:4px'><b>Cierre:</b> {session['closing_notes']}</div>")
    if extra_notes:
        parts.append(f"<div style='margin-top:4px'><b>Notas:</b> {extra_notes}</div>")
    if parts:
        notes_block = (
            "<div style='margin-top:14px;padding:10px 12px;background:#F9FAFB;border-left:3px solid #33B2F5;"
            "font-size:12.5px;color:#374151'>" + "".join(parts) + "</div>"
        )

    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{kind_label} · Turno {session.get('id')}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;color:#111;max-width:640px;margin:0 auto;padding:20px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px">
    <div>{logo}<h1 style="font-size:20px;margin:0">{biz}</h1>
      <div style="color:#666;font-size:13px">{kind_label} · Turno #{session.get('id')}</div></div>
    <div style="color:#666;font-size:12px;text-align:right">
      <div>Abierto: {_fmt_dt(session.get('opened_at'))}</div>
      <div>Cerrado: {_fmt_dt(session.get('closed_at'))}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;font-size:13px;color:#374151">
    <div><b>Caja:</b> {session.get('terminal_name') or '—'}</div>
    <div><b>Cajero:</b> {session.get('cashier_name') or '—'}</div>
    <div><b>Estado:</b> {session.get('status') or '—'}</div>
    <div><b>Fondo inicial:</b> {_money(session.get('opening_balance'))}</div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
    <tbody>
      <tr><td style="padding:6px 4px">Ventas ({session.get('total_sales_count') or 0} tickets)</td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums">{_money(session.get('total_sales_amount'))}</td></tr>
      <tr><td style="padding:6px 4px">Entradas de caja</td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums">{_money(session.get('total_cash_in'))}</td></tr>
      <tr><td style="padding:6px 4px">Salidas de caja</td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums">− {_money(session.get('total_cash_out'))}</td></tr>
      <tr><td style="padding:6px 4px">Reembolsos</td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums">− {_money(session.get('total_refunds'))}</td></tr>
      <tr style="border-top:1px solid #E5E7EB">
        <td style="padding:8px 4px"><b>Efectivo esperado</b></td>
        <td style="padding:8px 4px;text-align:right;font-variant-numeric:tabular-nums"><b>{_money(session.get('expected_cash'))}</b></td></tr>
      <tr><td style="padding:6px 4px"><b>Efectivo contado</b></td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums"><b>{_money(session.get('actual_cash'))}</b></td></tr>
      <tr><td style="padding:6px 4px;color:{var_color}"><b>Diferencia (arqueo)</b></td>
        <td style="padding:6px 4px;text-align:right;font-variant-numeric:tabular-nums;color:{var_color}"><b>{var_txt}</b></td></tr>
    </tbody>
  </table>

  <div style="margin-top:18px">
    <div style="font-size:11.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px">Ventas por método de pago</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;background:#F9FAFB;border-radius:6px;overflow:hidden">
      <tbody>{methods_rows}</tbody>
    </table>
  </div>

  <div style="margin-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12.5px">
    <div style="padding:8px;background:#EFF6FF;border-radius:6px">
      <div style="color:#6B7280;font-size:11px">Depositado al banco</div>
      <div style="font-weight:700;color:#1D4ED8;font-variant-numeric:tabular-nums">{_money(report.get('total_deposited'))}</div>
    </div>
    <div style="padding:8px;background:#FEF3C7;border-radius:6px">
      <div style="color:#6B7280;font-size:11px">Fondo siguiente turno</div>
      <div style="font-weight:700;color:#B45309;font-variant-numeric:tabular-nums">{_money(report.get('total_float_next'))}</div>
    </div>
    <div style="padding:8px;background:#F3F4F6;border-radius:6px">
      <div style="color:#6B7280;font-size:11px">Ajustes</div>
      <div style="font-weight:700;color:#111;font-variant-numeric:tabular-nums">{_money(report.get('total_adjustments'))}</div>
    </div>
  </div>

  {notes_block}

  <p style="margin-top:22px;font-size:12.5px;color:#6B7280">
    Se adjunta el reporte {kind} en PDF con el detalle completo del turno (arqueo por
    denominación, bitácora de movimientos y ventas). Correo generado automáticamente
    por STHENOVA ERP al cerrar el turno.
  </p>
</body></html>"""
