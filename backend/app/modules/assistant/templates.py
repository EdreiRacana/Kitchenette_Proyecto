"""Templates de respuesta — arma texto legible desde el dict del tool.
Sin IA, sin creatividad. Formato consistente, negritas en cifras clave.
"""
from __future__ import annotations
from typing import Dict, Any


def _mxn(v) -> str:
    try: return f"${float(v or 0):,.2f}"
    except Exception: return "$0.00"


def _pct(v) -> str:
    if v is None: return "s/d"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.1f}%"


def _short(v: float) -> str:
    """Formato compacto: $1.2K, $12.3K, $1.5M."""
    v = float(v or 0)
    if abs(v) >= 1_000_000: return f"${v/1_000_000:.1f}M"
    if abs(v) >= 1_000:     return f"${v/1_000:.1f}K"
    return _mxn(v)


def format_response(result: Dict[str, Any]) -> str:
    """Elige el formatter según el tool que produjo el resultado."""
    tool = (result or {}).get("tool", "")
    if result.get("empty"):
        return _empty_msg(tool, result.get("reason"))
    fn = _FORMATTERS.get(tool)
    if not fn:
        return "Consulta ejecutada. (Sin formato específico configurado aún.)"
    try:
        return fn(result)
    except Exception as e:
        return f"Hubo un problema formateando la respuesta: {e}"


def _empty_msg(tool: str, reason: str | None) -> str:
    friendly = {
        "ventas_periodo": "Sin ventas registradas en el periodo consultado.",
        "top_productos": "No hay ventas de productos en el periodo consultado.",
        "top_clientes": "No hay ventas por cliente en el periodo consultado.",
        "pedidos_pendientes": "No hay pedidos pendientes en este momento.",
        "cxc_resumen": "Cartera por cobrar en cero — no hay clientes con saldo pendiente.",
        "cxp_resumen": "Cartera por pagar en cero — no hay proveedores con saldo pendiente.",
        "saldo_bancos": "No hay cuentas bancarias activas configuradas.",
        "stock_critico": "Ningún producto está bajo el punto de reorden. Inventario saludable.",
        "caducidades_proximas": "No hay lotes por caducar en el rango consultado.",
        "desempeno_cadena": "No hay ventas por cadena de retail en el periodo.",
        "ventas_pos_dia": "No hay ventas registradas en el POS para esta fecha.",
    }
    base = friendly.get(tool, "No hay datos que mostrar para esta consulta.")
    if reason and "construcción" in reason:
        base += f"\n\n_{reason}_"
    return base


# ─────────── formatters por tool ───────────

def _t_ventas_periodo(r: Dict[str, Any]) -> str:
    txt = (f"Este {r['periodo']} llevas **{_mxn(r['total'])}** en {r['count']} pedido"
           f"{'s' if r['count'] != 1 else ''}"
           f" (ticket promedio **{_mxn(r['ticket_promedio'])}**).")
    c = r.get("comparativa")
    if c and c.get("var_total_pct") is not None:
        dir_word = "arriba" if c["var_total_pct"] >= 0 else "abajo"
        txt += (f"\n{_pct(c['var_total_pct'])} vs {c['prev_label']} "
                f"({_mxn(c['prev_total'])} · {c['prev_count']} pedidos) — "
                f"vas {dir_word}.")
    return txt


def _t_top_productos(r: Dict[str, Any]) -> str:
    unit = "unidades vendidas" if r["por"] == "unidades" else "revenue"
    lines = [f"Top productos {r['periodo']} por {unit}:"]
    for i, it in enumerate(r["items"], 1):
        if r["por"] == "unidades":
            lines.append(f"{i}. **{it['product_name']}** — {it['quantity']} uds. ({_mxn(it['revenue'])})")
        else:
            lines.append(f"{i}. **{it['product_name']}** — {_mxn(it['revenue'])} ({it['quantity']} uds.)")
    return "\n".join(lines)


def _t_top_clientes(r: Dict[str, Any]) -> str:
    lines = [f"Top clientes {r['periodo']}:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {_mxn(it['revenue'])} en {it['pedidos']} pedido{'s' if it['pedidos'] != 1 else ''}")
    return "\n".join(lines)


def _t_pedidos_pendientes(r: Dict[str, Any]) -> str:
    txt = (f"Tienes **{r['count']}** pedido{'s' if r['count'] != 1 else ''}"
           f" pendiente{'s' if r['count'] != 1 else ''} con **{_mxn(r['total_saldo'])}** de saldo total.")
    if r["items"]:
        txt += "\n\nMás antiguos:"
        for it in r["items"][:5]:
            estado = "parcial" if it["status"] == "partial" else "pendiente"
            txt += f"\n• {it['folio']} — {_mxn(it['saldo'])} ({estado}, hace {it['dias']}d)"
    return txt


def _t_cxc_resumen(r: Dict[str, Any]) -> str:
    b = r["buckets"]
    txt = f"Tienes **{_mxn(r['total'])}** por cobrar."
    txt += (f"\n\nAging:\n"
            f"• Al día: **{_mxn(b['al_dia'])}**\n"
            f"• 1-30 días: {_mxn(b['1_30'])}\n"
            f"• 31-60 días: {_mxn(b['31_60'])}\n"
            f"• +60 días (revisar): **{_mxn(b['mas_60'])}**")
    if r.get("top_debtors"):
        txt += "\n\nTop deudores:"
        for d in r["top_debtors"]:
            txt += f"\n• {d['name']} — {_mxn(d['saldo'])}"
    return txt


def _t_cxp_resumen(r: Dict[str, Any]) -> str:
    b = r["buckets"]
    txt = f"Debemos **{_mxn(r['total'])}** a proveedores."
    txt += (f"\n\nPor antigüedad:\n"
            f"• Vigente: {_mxn(b['vigente'])}\n"
            f"• 1-30 días vencido: {_mxn(b['1_30'])}\n"
            f"• 31-60 días: {_mxn(b['31_60'])}\n"
            f"• +60 días (urgente): **{_mxn(b['mas_60'])}**")
    if r.get("top_creditors"):
        txt += "\n\nTop acreedores:"
        for d in r["top_creditors"]:
            txt += f"\n• {d['name']} — {_mxn(d['saldo'])}"
    return txt


def _t_top_deudores(r: Dict[str, Any]) -> str:
    lines = ["Clientes que más te deben:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {_mxn(it['saldo'])}")
    return "\n".join(lines)


def _t_top_acreedores(r: Dict[str, Any]) -> str:
    lines = ["Proveedores a los que más debemos:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {_mxn(it['saldo'])}")
    return "\n".join(lines)


def _t_saldo_bancos(r: Dict[str, Any]) -> str:
    txt = f"Saldo total en cuentas MXN: **{_mxn(r['total_mxn'])}**"
    if r["accounts"]:
        txt += "\n\nDesglose:"
        for a in r["accounts"]:
            txt += f"\n• {a['name']} — {_mxn(a['balance'])} {a['currency']}"
    return txt


def _t_stock_critico(r: Dict[str, Any]) -> str:
    txt = (f"**{r['count']}** producto{'s' if r['count'] != 1 else ''}"
           f" bajo punto de reorden")
    if r["agotados"] > 0:
        txt += f" — **{r['agotados']} agotado{'s' if r['agotados'] != 1 else ''}**"
    if r["items"]:
        txt += ":\n"
        for it in r["items"]:
            estado = "🔴 agotado" if it["agotado"] else f"quedan {it['stock']}"
            txt += f"\n• **{it['name']}** ({it['sku']}) · {it['warehouse']} — {estado} (reorden a {it['reorder']})"
    return txt


def _t_caducidades_proximas(r: Dict[str, Any]) -> str:
    s = r.get("summary", {})
    exp = s.get("expired", 0)
    crit = s.get("critical", 0)
    al = s.get("alert", 0)
    txt = f"En los próximos {r['dias']} días hay **{r['count']}** lote{'s' if r['count'] != 1 else ''} que revisar."
    if exp or crit:
        txt += f"\n\n🔴 **{exp} caducado{'s' if exp != 1 else ''}** · 🟠 **{crit} crítico{'s' if crit != 1 else ''}** · 🟡 {al} en alerta"
    if r["items"]:
        txt += "\n\nMás urgentes:"
        for it in r["items"][:5]:
            d = it.get("days_left")
            when = "caducado" if d is not None and d <= 0 else f"en {d}d" if d is not None else "s/f"
            txt += f"\n• **{it.get('product_name', '?')}** — {it.get('quantity_remaining', 0)} uds. ({when})"
    return txt


def _t_desempeno_cadena(r: Dict[str, Any]) -> str:
    lines = [f"Cadenas de retail {r['periodo']}:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {_mxn(it['revenue'])} ({it['pedidos']} pedidos)")
    return "\n".join(lines)


def _t_ventas_pos_dia(r: Dict[str, Any]) -> str:
    txt = (f"POS del día ({r['fecha']}):\n"
           f"• **{_mxn(r['total'])}** en {r['tickets']} ticket{'s' if r['tickets'] != 1 else ''}"
           f" (promedio **{_mxn(r['ticket_promedio'])}**)")
    if r["sesiones_cerradas"] > 0:
        var = r["diferencia_arqueo_total"]
        if abs(var) < 0.005:
            txt += f"\n• {r['sesiones_cerradas']} sesión{'es' if r['sesiones_cerradas'] != 1 else ''} cerrada sin diferencias de arqueo. ✓"
        else:
            sign = "sobrante" if var > 0 else "faltante"
            txt += f"\n• {r['sesiones_cerradas']} sesión{'es' if r['sesiones_cerradas'] != 1 else ''} cerrada con **{_mxn(abs(var))} de {sign}** en arqueo"
    return txt


_FORMATTERS = {
    "ventas_periodo": _t_ventas_periodo,
    "top_productos": _t_top_productos,
    "top_clientes": _t_top_clientes,
    "pedidos_pendientes": _t_pedidos_pendientes,
    "cxc_resumen": _t_cxc_resumen,
    "cxp_resumen": _t_cxp_resumen,
    "top_deudores": _t_top_deudores,
    "top_acreedores": _t_top_acreedores,
    "saldo_bancos": _t_saldo_bancos,
    "stock_critico": _t_stock_critico,
    "caducidades_proximas": _t_caducidades_proximas,
    "desempeno_cadena": _t_desempeno_cadena,
    "ventas_pos_dia": _t_ventas_pos_dia,
}
