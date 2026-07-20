"""Reconciliación de liquidaciones (depósitos) de marketplace.

Cuando Liverpool/Amazon/ML te deposita un pago periódico, este módulo:
  1. Consulta todas las órdenes marketplace del período.
  2. Suma el "neto a pagar al seller" acumulado.
  3. Descuenta devoluciones registradas.
  4. Compara contra el depósito recibido y detecta faltantes/sobrantes.
  5. Genera reporte auditable línea por línea.

Fórmula:
  esperado = Σ(net_to_seller de órdenes) − Σ(refund de devoluciones)
                                        − IVA retenido (8% s/bruto) − ISR retenido (2.5% s/bruto)
                                        ± ajustes manuales (comisiones extra, promociones)
  diferencia = depositado − esperado

Las retenciones (8% IVA + 2.5% ISR, o el esquema configurado en el cliente)
las retiene la plataforma en la fuente y las entera al SAT por ti, así que se
descuentan del depósito esperado. Solo aplican a clientes marketplace/cadena.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from app.modules.sales import models as sales_models


async def compute_settlement(
    db: AsyncSession, customer_id: int,
    start: Optional[datetime] = None, end: Optional[datetime] = None,
    deposited_amount: Optional[float] = None,
) -> dict:
    """Calcula qué debería depositarte el marketplace en un período.

    Args:
      customer_id: cliente marketplace (Liverpool, Amazon, etc.)
      start, end: rango del período de liquidación
      deposited_amount: si sabes cuánto te depositaron, lo compara y genera variance

    Returns:
      Desglose completo con líneas de órdenes, devoluciones, esperado y variance.
    """
    # Aplica a marketplaces y sell-through de cadenas: en ambos casos existe un
    # "esperado a depositar" y el cliente/plataforma envía un pago periódico.
    conds = [
        sales_models.Order.customer_id == customer_id,
        sales_models.Order.kind == "order",
        sales_models.Order.status != "cancelled",
        sales_models.Order.channel.in_(("marketplace", "chain_sellthrough")),
    ]
    if start:
        conds.append(sales_models.Order.created_at >= start)
    if end:
        conds.append(sales_models.Order.created_at < end)

    res = await db.execute(select(sales_models.Order).where(*conds))
    orders = res.scalars().all()

    # Tasas de retención del cliente (marketplace/cadena). Para otros tipos
    # regresa (0, 0) y no se descuenta nada.
    from app.modules.customers.models import Customer, marketplace_retention_rates
    cust = (await db.execute(
        select(Customer).where(Customer.id == customer_id)
    )).scalar_one_or_none()
    iva_ret_pct, isr_ret_pct = marketplace_retention_rates(cust) if cust else (0.0, 0.0)

    order_lines = []
    total_gross = 0.0
    total_net_expected = 0.0
    for o in orders:
        gross = o.subtotal or 0.0
        # paid_amount se seteó al importar con "net_to_seller"
        net = o.paid_amount or gross
        commission = gross - net
        total_gross += gross
        total_net_expected += net
        order_lines.append({
            "order_id": o.id, "folio": o.folio,
            "external_order_id": o.external_order_id,
            "created_at": o.created_at,
            "gross": round(gross, 2),
            "net_to_seller": round(net, 2),
            "commission": round(commission, 2),
        })

    # Devoluciones que reducen la liquidación
    return_lines = []
    total_returns = 0.0
    if orders:
        order_ids = [o.id for o in orders]
        res_ret = await db.execute(select(sales_models.CustomerReturn).where(
            sales_models.CustomerReturn.order_id.in_(order_ids),
        ))
        for r in res_ret.scalars().all():
            amt = r.refund_amount or 0.0
            total_returns += amt
            return_lines.append({
                "return_id": r.id, "folio": r.folio,
                "order_id": r.order_id,
                "status": r.status, "reason": r.reason,
                "refund_amount": round(amt, 2),
            })

    # Retenciones fiscales sobre la venta bruta (las retiene la plataforma).
    iva_retention = round(total_gross * iva_ret_pct, 2)
    isr_retention = round(total_gross * isr_ret_pct, 2)
    retention_total = round(iva_retention + isr_retention, 2)

    expected = round(total_net_expected - total_returns - retention_total, 2)
    variance = None
    if deposited_amount is not None:
        variance = round(deposited_amount - expected, 2)

    return {
        "customer_id": customer_id,
        "period_start": start.isoformat() if start else None,
        "period_end": end.isoformat() if end else None,
        "orders_count": len(orders),
        "returns_count": len(return_lines),
        "totals": {
            "gross_sales": round(total_gross, 2),
            "commission_total": round(total_gross - total_net_expected, 2),
            "net_expected_before_returns": round(total_net_expected, 2),
            "returns_deducted": round(total_returns, 2),
            "iva_retention": iva_retention,
            "isr_retention": isr_retention,
            "retention_total": retention_total,
            "iva_retention_pct": round(iva_ret_pct * 100, 3),
            "isr_retention_pct": round(isr_ret_pct * 100, 3),
            "expected_deposit": round(expected, 2),
            "deposited": deposited_amount,
            "variance": variance,
        },
        "orders": sorted(order_lines, key=lambda r: r.get("created_at") or datetime.min, reverse=True),
        "returns": return_lines,
    }
