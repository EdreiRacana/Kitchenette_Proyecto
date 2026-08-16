"""Servicio de lotes y trazabilidad para productos perecederos.

Complementa fifo_service:
- Consulta lotes por caducidad (dashboard "Próximo a caducar")
- Retiro sanitario (recall) de un lote con lista de clientes afectados
- Cuarentena / liberación manual
- Auto-merma diaria de lotes que cruzan expiration_date
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional, List, Dict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func, and_

from app.modules.inventory import models


# Bucket de severidad para el dashboard
BUCKETS = {
    "expired": lambda days: days is not None and days <= 0,
    "critical": lambda days: days is not None and 1 <= days <= 7,
    "alert": lambda days: days is not None and 8 <= days <= 30,
    "ok": lambda days: days is not None and days > 30,
}


def _bucket_for(days_to_expire: Optional[int]) -> str:
    if days_to_expire is None:
        return "no_expiry"
    if days_to_expire <= 0:
        return "expired"
    if days_to_expire <= 7:
        return "critical"
    if days_to_expire <= 30:
        return "alert"
    return "ok"


async def list_expiring_lots(
    db: AsyncSession, *,
    days: int = 30,
    warehouse_id: Optional[int] = None,
    include_expired: bool = True,
    limit: int = 500,
) -> Dict:
    """Lista lotes activos con caducidad dentro de los próximos `days` días
    (por default 30 = alerta amarilla). Si include_expired, también los ya
    caducados que aún tienen stock (deben moverse a merma cuanto antes)."""
    today = date.today()
    horizon = today + timedelta(days=max(0, days))

    conds = [
        models.StockLot.quantity_remaining > 0,
        models.StockLot.expiration_date.isnot(None),
        models.StockLot.status.in_(("active", "quarantine")),
    ]
    if include_expired:
        # <= horizon captura tanto los ya caducados como los próximos
        conds.append(models.StockLot.expiration_date <= horizon)
    else:
        conds.append(models.StockLot.expiration_date > today)
        conds.append(models.StockLot.expiration_date <= horizon)
    if warehouse_id is not None:
        conds.append(models.StockLot.warehouse_id == warehouse_id)

    res = await db.execute(
        select(models.StockLot)
        .where(*conds)
        .options(
            selectinload(models.StockLot.variant).selectinload(models.ProductVariant.product),
            selectinload(models.StockLot.warehouse),
            selectinload(models.StockLot.supplier),
        )
        .order_by(models.StockLot.expiration_date.asc().nulls_last(), models.StockLot.id.asc())
        .limit(max(1, min(limit, 2000)))
    )
    lots = res.scalars().all()

    rows: List[dict] = []
    counters = {"expired": 0, "critical": 0, "alert": 0, "ok": 0, "no_expiry": 0}
    total_value_at_risk = 0.0

    for l in lots:
        days_left = (l.expiration_date - today).days if l.expiration_date else None
        bucket = _bucket_for(days_left)
        counters[bucket] = counters.get(bucket, 0) + 1
        risk = (l.quantity_remaining or 0) * (l.unit_cost or 0.0)
        if bucket in ("expired", "critical", "alert"):
            total_value_at_risk += risk
        p = l.variant.product if (l.variant and l.variant.product) else None
        rows.append({
            "lot_id": l.id,
            "variant_id": l.variant_id,
            "product_id": p.id if p else None,
            "product_name": p.name if p else "?",
            "sku": l.variant.sku if l.variant else None,
            "warehouse_id": l.warehouse_id,
            "warehouse_name": l.warehouse.name if l.warehouse else None,
            "batch_code": l.batch_code,
            "expiration_date": l.expiration_date.isoformat() if l.expiration_date else None,
            "manufacturing_date": l.manufacturing_date.isoformat() if l.manufacturing_date else None,
            "days_left": days_left,
            "bucket": bucket,
            "quantity_remaining": l.quantity_remaining,
            "unit_cost": round(l.unit_cost or 0.0, 4),
            "value_at_risk": round(risk, 2),
            "status": l.status,
            "supplier_id": l.supplier_id,
            "supplier_name": l.supplier.name if l.supplier else None,
        })

    return {
        "as_of": today.isoformat(),
        "horizon_days": days,
        "rows": rows,
        "summary": {
            **counters,
            "total_lots": len(rows),
            "total_value_at_risk": round(total_value_at_risk, 2),
        },
    }


async def ensure_expiry_warehouse(db: AsyncSession) -> models.Warehouse:
    """Almacén único donde caen los caducados — se auto-crea al primer uso.
    Misma idea que _ensure_returns_warehouse en retail."""
    res = await db.execute(
        select(models.Warehouse).where(models.Warehouse.name == "Merma · Caducados")
    )
    wh = res.scalars().first()
    if wh:
        return wh
    wh = models.Warehouse(name="Merma · Caducados", type="scrap", is_active=True)
    db.add(wh)
    await db.flush()
    return wh


async def sweep_expired_to_scrap(
    db: AsyncSession, *, user_id: Optional[int] = None
) -> Dict:
    """Barre los lotes con expiration_date <= hoy y quantity_remaining > 0.
    Marca status='expired' y registra un StockMovement de salida (OUT) por
    el residual — evita seguir contando ese stock como vendible sin borrar
    la historia. Devuelve resumen para logs / notificaciones."""
    today = date.today()
    res = await db.execute(
        select(models.StockLot).where(
            models.StockLot.quantity_remaining > 0,
            models.StockLot.expiration_date.isnot(None),
            models.StockLot.expiration_date <= today,
            models.StockLot.status == "active",
        )
    )
    lots = res.scalars().all()
    swept = 0
    total_value = 0.0
    for l in lots:
        qty = l.quantity_remaining or 0
        if qty <= 0:
            l.status = "consumed"
            continue
        cost = l.unit_cost or 0.0
        db.add(models.StockMovement(
            variant_id=l.variant_id, warehouse_id=l.warehouse_id,
            quantity=-qty, movement_type="out",
            unit_cost=cost, reference=f"expiry:{l.id}",
            notes=f"Auto-merma por caducidad (lote {l.batch_code or l.id})",
            user_id=user_id, stock_lot_id=l.id,
        ))
        # Ajustar StockLevel — quita del disponible el residual del lote
        lvl_res = await db.execute(select(models.StockLevel).where(
            models.StockLevel.variant_id == l.variant_id,
            models.StockLevel.warehouse_id == l.warehouse_id,
        ))
        lvl = lvl_res.scalars().first()
        if lvl:
            lvl.quantity = max(0, (lvl.quantity or 0) - qty)
        l.quantity_remaining = 0
        l.status = "expired"
        swept += 1
        total_value += qty * cost
    if swept:
        await db.commit()
    return {
        "date": today.isoformat(),
        "lots_expired": swept,
        "total_value_written_off": round(total_value, 2),
    }


async def recall_lot(
    db: AsyncSession, lot_id: int, *,
    reason: str, user_id: Optional[int] = None,
) -> Dict:
    """Retira sanitariamente un lote:
    1. Bloquea el lote (status='recalled') — deja de venderse aunque tenga stock.
    2. Regresa la lista de órdenes que consumieron unidades de ese lote.
    3. Deja rastro en audit log del motivo del retiro."""
    res = await db.execute(select(models.StockLot).where(models.StockLot.id == lot_id))
    lot = res.scalars().first()
    if not lot:
        return {"ok": False, "reason": "Lote no encontrado"}
    lot.status = "recalled"
    # Buscar movimientos de salida (OUT) con este stock_lot_id
    res_m = await db.execute(
        select(models.StockMovement)
        .where(
            models.StockMovement.stock_lot_id == lot_id,
            models.StockMovement.movement_type == "out",
        )
        .order_by(models.StockMovement.created_at.desc())
    )
    movements = res_m.scalars().all()
    # Extraer order_id de reference (formato "order:{id}")
    affected: Dict[int, dict] = {}
    for m in movements:
        ref = m.reference or ""
        oid = None
        if ref.startswith("order:"):
            try:
                oid = int(ref.split(":", 1)[1])
            except ValueError:
                pass
        if not oid:
            continue
        row = affected.setdefault(oid, {
            "order_id": oid, "units": 0,
            "last_delivered_at": m.created_at.isoformat() if m.created_at else None,
        })
        row["units"] += abs(m.quantity or 0)

    # Enriquecer con nombre de cliente si se puede
    if affected:
        try:
            from app.modules.sales.models import Order
            from app.modules.customers.models import Customer
            oids = list(affected.keys())
            res_o = await db.execute(
                select(Order, Customer)
                .join(Customer, Customer.id == Order.customer_id, isouter=True)
                .where(Order.id.in_(oids))
            )
            for o, c in res_o.all():
                affected[o.id]["folio"] = o.folio
                affected[o.id]["customer_id"] = o.customer_id
                affected[o.id]["customer_name"] = c.name if c else "Público general"
                affected[o.id]["customer_email"] = c.email if c else None
                affected[o.id]["customer_phone"] = c.phone if c else None
        except Exception:
            pass

    # Audit log
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(
            db, user_id=user_id, action="RECALL_STOCK_LOT",
            module="inventory",
            description=f"Retiro sanitario del lote {lot.batch_code or lot.id}",
            details={"lot_id": lot.id, "reason": reason,
                     "affected_orders": len(affected)},
        )
    except Exception:
        pass

    await db.commit()
    return {
        "ok": True,
        "lot_id": lot.id,
        "batch_code": lot.batch_code,
        "expiration_date": lot.expiration_date.isoformat() if lot.expiration_date else None,
        "affected_orders": list(affected.values()),
    }


async def get_batches_for_order(db: AsyncSession, order_id: int) -> Dict[int, List[dict]]:
    """Devuelve, por variant_id, los lotes que se despacharon en la orden
    (con código y caducidad). Se lee de stock_movements.reference='order:{id}'
    e implementa el requisito legal de imprimir la caducidad en el ticket."""
    ref = f"order:{order_id}"
    res = await db.execute(
        select(models.StockMovement, models.StockLot)
        .join(models.StockLot, models.StockLot.id == models.StockMovement.stock_lot_id, isouter=True)
        .where(
            models.StockMovement.reference == ref,
            models.StockMovement.movement_type == "out",
            models.StockMovement.stock_lot_id.isnot(None),
        )
    )
    out: Dict[int, List[dict]] = {}
    for mv, lot in res.all():
        if not lot:
            continue
        # Solo incluir si el lote tiene datos de trazabilidad relevantes
        if not (lot.batch_code or lot.expiration_date):
            continue
        row = {
            "batch_code": lot.batch_code,
            "expiration_date": lot.expiration_date.isoformat() if lot.expiration_date else None,
            "quantity": abs(mv.quantity or 0),
        }
        out.setdefault(mv.variant_id, []).append(row)
    # Ordenar cada lista por caducidad ASC (el que caduca primero primero)
    for vid, rows in out.items():
        rows.sort(key=lambda r: (r.get("expiration_date") or "9999-99-99"))
    return out


def _fmt_date(v) -> str:
    if not v:
        return "—"
    try:
        return v.strftime("%d/%m/%Y")
    except Exception:
        return str(v)


def render_expiry_alert_html(company: dict, rows: List[dict], summary: Dict) -> str:
    """HTML para el correo de alerta de perecederos — solo lotes en bucket
    expired/critical/alert. Cuerpo profesional con logo, tabla y sugerencias
    de acción; el detalle completo sigue en el dashboard del ERP."""
    import base64
    biz = (company or {}).get("legal_name") or "Sthenova"
    accent = (company or {}).get("brand_color") or "#111827"
    logo_uri = ""
    if company and company.get("logo_bytes"):
        try:
            mime = company.get("logo_mime") or "image/png"
            b64 = base64.b64encode(company["logo_bytes"]).decode("ascii")
            logo_uri = f"data:{mime};base64,{b64}"
        except Exception:
            pass
    logo_html = (
        f'<img src="{logo_uri}" alt="{biz}" width="130" '
        f'style="width:130px;height:auto;max-width:130px;display:block;margin:0 auto"/>'
    ) if logo_uri else ""

    def _row(r: dict) -> str:
        bucket = r.get("bucket", "no_expiry")
        color = {
            "expired": "#7F1D1D", "critical": "#DC2626",
            "alert": "#D97706", "ok": "#059669",
        }.get(bucket, "#6B7280")
        badge = {
            "expired": "CADUCADO", "critical": "CRÍTICO",
            "alert": "ALERTA", "ok": "OK", "no_expiry": "S/F",
        }.get(bucket, bucket.upper())
        days_txt = ""
        d = r.get("days_left")
        if d is not None:
            days_txt = f"Caducó hace {-d}d" if d <= 0 else f"en {d}d"
        return (
            "<tr>"
            f'<td style="padding:8px 6px;border-bottom:1px solid #E5E7EB">'
            f'<div style="font-weight:600;color:#111827;font-size:12.5px">{r.get("product_name") or "?"}</div>'
            f'<div style="font-family:monospace;font-size:10.5px;color:#6B7280;margin-top:1px">'
            f'Lote {r.get("batch_code") or "—"} · {r.get("warehouse_name") or ""}</div></td>'
            f'<td style="padding:8px 6px;border-bottom:1px solid #E5E7EB;text-align:center;font-size:11.5px;color:#374151">'
            f'{r.get("expiration_date","—")}<br>'
            f'<span style="color:{color};font-weight:700">{days_txt}</span></td>'
            f'<td style="padding:8px 6px;border-bottom:1px solid #E5E7EB;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#111827">'
            f'{r.get("quantity_remaining") or 0}</td>'
            f'<td style="padding:8px 6px;border-bottom:1px solid #E5E7EB;text-align:center">'
            f'<span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;'
            f'background:{color}22;color:{color}">{badge}</span></td>'
            "</tr>"
        )

    rows_html = "".join(_row(r) for r in rows[:60]) or (
        '<tr><td colspan="4" style="padding:20px;text-align:center;color:#6B7280">Sin lotes por avisar</td></tr>'
    )
    more_html = ""
    if len(rows) > 60:
        more_html = f'<div style="text-align:center;margin-top:10px;color:#6B7280;font-size:12px">y {len(rows) - 60} lote(s) más — revísalos en el ERP</div>'

    return f"""<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#F3F4F6;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,0.06);overflow:hidden">
        <tr><td style="padding:24px 32px 16px;text-align:center;border-bottom:3px solid {accent}">
          {logo_html}
          <div style="font-size:16px;font-weight:800;margin-top:{'10px' if logo_html else '0'}">{biz}</div>
          <div style="font-size:11.5px;color:#6B7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.6px">Alerta de productos por caducar</div>
        </td></tr>

        <tr><td style="padding:22px 32px 8px;font-size:14.5px;color:#1F2937">
          <p style="margin:0 0 12px">Hola,</p>
          <p style="margin:0 0 12px">
            Estos son los lotes que requieren tu atención hoy —
            <b style="color:#7F1D1D">{summary.get("expired", 0)} caducado(s)</b>,
            <b style="color:#DC2626">{summary.get("critical", 0)} crítico(s)</b> y
            <b style="color:#D97706">{summary.get("alert", 0)} en alerta</b>.
            Valor en riesgo: <b style="font-variant-numeric:tabular-nums">${summary.get("total_value_at_risk", 0):,.2f}</b>.
          </p>
        </td></tr>

        <tr><td style="padding:8px 32px 22px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:12px;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#F9FAFB">
                <th align="left" style="padding:8px 6px;font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px">Producto / Lote</th>
                <th align="center" style="padding:8px 6px;font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px">Caducidad</th>
                <th align="right" style="padding:8px 6px;font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px">Unid.</th>
                <th align="center" style="padding:8px 6px;font-size:10.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.4px">Estado</th>
              </tr>
            </thead>
            <tbody>{rows_html}</tbody>
          </table>
          {more_html}
        </td></tr>

        <tr><td style="padding:0 32px 22px;font-size:13.5px;color:#374151">
          <div style="padding:12px 14px;background:#FEF3C7;border-left:3px solid #D97706;border-radius:6px;font-size:12.5px;line-height:1.55">
            <b>Acciones sugeridas:</b>
            para los <b>caducados</b> usa "Barrer" en Perecederos.
            Para los <b>críticos</b> considera promoción, transferencia a otra tienda,
            o notificar a la demostradora para que rote el producto al frente.
            Para los de <b>alerta</b>, planifica reabastecimiento a menor ritmo.
          </div>
        </td></tr>

        <tr><td style="padding:0 32px 28px;font-size:14px;color:#1F2937">
          <p style="margin:0">Un cordial saludo,<br><b>Equipo {biz}</b></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def render_expiry_alert_text(rows: List[dict], summary: Dict) -> str:
    """Versión texto para WhatsApp / SMS. Compacto, con emojis y bold *…*."""
    lines = [
        "🕐 *Alerta perecederos*",
        (f"Caducados: {summary.get('expired', 0)} · Críticos: {summary.get('critical', 0)}"
         f" · Alerta: {summary.get('alert', 0)}"),
        f"Valor en riesgo: ${summary.get('total_value_at_risk', 0):,.2f}",
        "",
    ]
    shown = 0
    for r in rows:
        if shown >= 15:
            break
        d = r.get("days_left")
        if d is None:
            days_txt = ""
        elif d <= 0:
            days_txt = f"caducó hace {-d}d"
        else:
            days_txt = f"en {d}d"
        lines.append(
            f"• {r.get('product_name') or '?'} — {r.get('quantity_remaining') or 0} unid. "
            f"(Cad {_fmt_date_iso(r.get('expiration_date'))}, {days_txt})"
        )
        if r.get("batch_code"):
            lines.append(f"    _Lote {r['batch_code']} · {r.get('warehouse_name') or ''}_")
        shown += 1
    if len(rows) > shown:
        lines.append(f"…y {len(rows) - shown} lote(s) más")
    return "\n".join(lines)


def _fmt_date_iso(s):
    if not s:
        return "—"
    try:
        return date.fromisoformat(s).strftime("%d/%m/%Y")
    except Exception:
        return str(s)


def _parse_recipients(raw: Optional[str]) -> List[str]:
    """Convierte una cadena 'a@x.com, b@y.com; c@z.com' en lista limpia."""
    if not raw:
        return []
    import re
    parts = re.split(r"[,;\s]+", raw)
    out = []
    seen = set()
    for p in parts:
        p = p.strip().lower()
        if not p or p in seen:
            continue
        if "@" in p:
            out.append(p)
            seen.add(p)
    return out


async def notify_expiring_by_email(
    db: AsyncSession, *,
    to: Optional[str] = None,
    days: int = 30,
    warehouse_id: Optional[int] = None,
    only_critical: bool = False,
) -> Dict:
    """Genera el resumen y lo manda por correo a los destinatarios operativos:
      - Si `to` viene, se usa esa lista (permite override desde la UI).
      - Si no, usa CompanyProfile.alerts_recipients (lista separada por coma
        con comprador + gerente + supervisor).
      - Fallback final: accounting_email (una sola dirección).
    """
    from app.core.email import send_email
    from app.modules.core_config.service import get_company_profile
    from app.modules.sales.universal_service import _get_company_dict

    data = await list_expiring_lots(db, days=days, warehouse_id=warehouse_id,
                                     include_expired=True, limit=500)
    rows = data["rows"]
    if only_critical:
        rows = [r for r in rows if r.get("bucket") in ("expired", "critical")]
    if not rows:
        return {"sent": False, "reason": "Sin lotes por avisar"}

    company_obj = await get_company_profile(db)
    company_dict = await _get_company_dict(db)

    # Resolver destinatarios: override > alerts_recipients > accounting_email
    recipients = _parse_recipients(to)
    if not recipients and company_obj:
        recipients = _parse_recipients(getattr(company_obj, "alerts_recipients", None))
        if not recipients:
            acc = (getattr(company_obj, "accounting_email", None) or "").strip().lower()
            if acc:
                recipients = [acc]
    if not recipients:
        return {"sent": False, "reason": "No hay destinatarios configurados"}

    # Recalcular summary sobre las filas filtradas
    counters = {"expired": 0, "critical": 0, "alert": 0, "ok": 0, "no_expiry": 0}
    value = 0.0
    for r in rows:
        counters[r.get("bucket", "no_expiry")] = counters.get(r.get("bucket", "no_expiry"), 0) + 1
        if r.get("bucket") in ("expired", "critical", "alert"):
            value += float(r.get("value_at_risk") or 0)
    summary = {**counters, "total_lots": len(rows), "total_value_at_risk": round(value, 2)}

    html = render_expiry_alert_html(company_dict, rows, summary)
    biz = (company_obj.legal_name if company_obj and company_obj.legal_name else "Sthenova")
    subject_bits = []
    if summary["expired"]:
        subject_bits.append(f"{summary['expired']} caducado(s)")
    if summary["critical"]:
        subject_bits.append(f"{summary['critical']} crítico(s)")
    if not subject_bits:
        subject_bits.append(f"{summary['alert']} en alerta")
    subject = f"[{biz}] Perecederos — {', '.join(subject_bits)}"

    # Envío individual — un send_email por destinatario para máxima
    # entregabilidad (no todos los proveedores manejan bien el multi-to).
    sent_to: List[str] = []
    failed: List[str] = []
    for r in recipients:
        ok = await send_email(db, to=r, subject=subject, body_html=html)
        (sent_to if ok else failed).append(r)
    return {
        "sent": len(sent_to) > 0,
        "to": ", ".join(sent_to) if sent_to else None,
        "failed": failed or None,
        "rows_notified": len(rows),
        "summary": summary,
        "reason": None if sent_to else "No se pudo enviar el correo a ningún destinatario",
    }


async def get_store_demonstrator_for_warehouse(
    db: AsyncSession, warehouse_id: int,
) -> Optional[dict]:
    """Devuelve la demostradora de la tienda de retail cuyo warehouse de
    consignación es el que se le pasa. Sirve para el enrutamiento
    automático de alertas de perecederos por punto de venta."""
    try:
        from app.modules.retail.models import RetailStore
        res = await db.execute(
            select(RetailStore).where(
                RetailStore.consignment_warehouse_id == warehouse_id,
                RetailStore.is_active == True,  # noqa: E712
            ).limit(1)
        )
        s = res.scalars().first()
    except Exception:
        s = None
    if not s:
        return None
    return {
        "store_id": s.id, "store_name": s.name,
        "demonstrator_name": s.demonstrator_name,
        "demonstrator_phone": s.demonstrator_phone,
        "demonstrator_email": s.demonstrator_email,
    }


async def notify_store_demonstrator(
    db: AsyncSession, warehouse_id: int, *,
    days: int = 30, prefer_channel: str = "whatsapp",
) -> Dict:
    """Genera el resumen filtrado por almacén de la tienda y lo enruta a la
    demostradora. Devuelve wa.me link si prefer_channel='whatsapp', o intenta
    correo si prefer_channel='email' (o si no hay teléfono)."""
    demo = await get_store_demonstrator_for_warehouse(db, warehouse_id)
    if not demo or (not demo.get("demonstrator_phone") and not demo.get("demonstrator_email")):
        return {"ok": False, "reason": "No hay demostradora configurada para esta tienda"}

    data = await list_expiring_lots(db, days=days, warehouse_id=warehouse_id,
                                     include_expired=True, limit=100)
    if not data.get("rows"):
        return {"ok": False, "reason": "Sin lotes por avisar en esta tienda"}

    text = render_expiry_alert_text(data["rows"], data["summary"])
    # Encabezado personalizado para la demostradora
    intro = (f"Hola {demo['demonstrator_name'] or ''}, "
             f"estos son los productos de {demo['store_name']} que necesitan atención hoy:")
    full_text = f"{intro}\n\n{text}\n\nGracias — Equipo de piso"

    if prefer_channel == "whatsapp" and demo.get("demonstrator_phone"):
        # Devolver link wa.me pre-cargado para que el gerente lo abra
        phone = demo["demonstrator_phone"]
        digits = "".join(ch for ch in phone if ch.isdigit())
        if len(digits) == 10:
            digits = "52" + digits
        from urllib.parse import quote
        return {
            "ok": True, "channel": "whatsapp",
            "store_name": demo["store_name"],
            "demonstrator_name": demo["demonstrator_name"],
            "phone": phone,
            "url": f"https://wa.me/{digits}?text={quote(full_text)}",
            "count": len(data["rows"]),
        }

    if demo.get("demonstrator_email"):
        from app.core.email import send_email
        from app.modules.core_config.service import get_company_profile
        from app.modules.sales.universal_service import _get_company_dict
        company_obj = await get_company_profile(db)
        company_dict = await _get_company_dict(db)
        biz = (company_obj.legal_name if company_obj and company_obj.legal_name else "Sthenova")
        html = render_expiry_alert_html(company_dict, data["rows"], data["summary"])
        subject = f"[{biz}] Perecederos en {demo['store_name']} — {len(data['rows'])} lote(s)"
        ok = await send_email(db, to=demo["demonstrator_email"], subject=subject, body_html=html)
        return {
            "ok": ok, "channel": "email",
            "store_name": demo["store_name"],
            "demonstrator_name": demo["demonstrator_name"],
            "to": demo["demonstrator_email"],
            "count": len(data["rows"]),
            "reason": None if ok else "No se pudo enviar el correo",
        }

    return {"ok": False, "reason": "Sin canal disponible para notificar"}


async def build_expiring_whatsapp_text(
    db: AsyncSession, *,
    days: int = 30,
    warehouse_id: Optional[int] = None,
    only_critical: bool = False,
) -> Dict:
    """Devuelve texto para WhatsApp (wa.me) con el resumen de perecederos."""
    data = await list_expiring_lots(db, days=days, warehouse_id=warehouse_id,
                                     include_expired=True, limit=200)
    rows = data["rows"]
    if only_critical:
        rows = [r for r in rows if r.get("bucket") in ("expired", "critical")]
    text = render_expiry_alert_text(rows, data["summary"])
    return {"text": text, "count": len(rows)}


async def set_lot_status(
    db: AsyncSession, lot_id: int, *,
    status: str, user_id: Optional[int] = None,
) -> Optional[models.StockLot]:
    """Cambia manualmente el status de un lote (cuarentena, reactivar, etc.)."""
    if status not in ("active", "quarantine", "recalled", "expired", "consumed"):
        raise ValueError(f"status inválido: {status}")
    res = await db.execute(select(models.StockLot).where(models.StockLot.id == lot_id))
    lot = res.scalars().first()
    if not lot:
        return None
    lot.status = status
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(
            db, user_id=user_id, action="UPDATE_STOCK_LOT_STATUS",
            module="inventory",
            description=f"Lote {lot.batch_code or lot.id} → {status}",
            details={"lot_id": lot.id, "status": status},
        )
    except Exception:
        pass
    await db.commit()
    await db.refresh(lot)
    return lot
