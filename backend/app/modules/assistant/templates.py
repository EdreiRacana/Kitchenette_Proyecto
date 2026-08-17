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
        # Originales
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
        # Fase 2/3
        "concentracion_clientes": "No hay ventas registradas este mes — no se puede calcular concentración.",
        "sin_movimiento": "Todos los SKUs con stock han tenido movimiento en el periodo. Excelente rotación.",
        "rotacion_producto": "No hay ventas suficientes de las últimas 4 semanas para calcular WoS.",
        "desempeno_tienda": "No hay reportes de sell-out en el periodo consultado.",
        "sell_through_por_tienda": "No hay reportes de sell-out por tienda en el periodo.",
        "ventas_pos_hora": "No hay ventas registradas en el POS hoy.",
        "utilidad_bruta": "No hay ventas en el periodo — no se puede calcular utilidad.",
        "cotizaciones_abiertas": "No hay cotizaciones abiertas en este momento.",
        "clientes_inactivos": "Todos los clientes activos han comprado dentro del periodo. Bien.",
        "ticket_promedio_ventas": "Sin ventas en el periodo para calcular ticket promedio.",
        "devoluciones_periodo": "No hay devoluciones de clientes registradas en el periodo.",
        "cxc_vencen_semana": "No hay cobros con fecha de vencimiento esta semana.",
        "cxp_vencen_semana": "No hay pagos con fecha de vencimiento esta semana.",
        "flujo_neto_30d": "No hay CxC ni CxP con fecha registrada para proyectar.",
        "oc_abiertas": "No hay órdenes de compra abiertas en este momento.",
        "oc_atrasadas": "Ninguna OC está atrasada. Proveedores al día.",
        "top_proveedores": "No hay facturas de proveedores en el periodo consultado.",
        "valor_inventario": "No hay stock valorizado en el inventario (verifica que los productos tengan cost_price).",
        "merma_mes": "No se registró merma en el mes actual.",
        "ingresos_vs_egresos": "No hay transacciones registradas en el periodo.",
        "gastos_por_categoria": "No hay gastos registrados en el periodo.",
        "movimientos_no_conciliados": "Todos los movimientos bancarios están conciliados. Al día.",
        "nomina_periodo": "No hay periodos de nómina calculados todavía.",
        "empleados_activos": "No hay empleados activos registrados.",
        "incapacidades_mes": "No se registraron incapacidades en el mes actual.",
        "contratos_por_vencer": "Ningún contrato vence en los próximos 30 días.",
        "cumpleanos_mes": "Ningún empleado cumple años este mes.",
        "isr_nomina_mes": "No hay nóminas pagadas este mes con retención de ISR.",
        "corte_caja_actual": "No hay sesiones de POS abiertas en este momento.",
        "formas_pago_pos": "No hay ventas registradas en el POS hoy.",
        "top_cajeros_dia": "No hay ventas registradas en el POS hoy.",
        "flujo_efectivo_proyectado": "No hay datos suficientes para proyectar el flujo.",
        "nomina_vs_ventas": "No hay ventas ni nómina registrada para comparar.",
        "top_deudores": "No hay clientes con saldo pendiente.",
        "top_acreedores": "No hay proveedores con saldo pendiente.",
        # Fase 6
        "tiendas_wos_critico": "Ninguna tienda está en WoS crítico. Todo el retail en buen nivel.",
        "tiendas_sobrestock": "Ninguna tienda tiene sobre-stock. Inventario balanceado.",
        "fill_rate_cadena": "No hay reportes de sell-out para calcular fill rate.",
        "return_rate_cadena": "No hay devoluciones ni ventas para calcular tasa.",
        "aging_cxc": "Cartera por cobrar en cero — no hay saldos pendientes.",
        "dso_dpo": "No hay ventas ni compras de los últimos 90 días para calcular DSO/DPO.",
        "pagos_programados": "No hay pagos programados pendientes.",
        "aguinaldo_devengado": "No hay empleados activos para calcular aguinaldo.",
        "vacaciones_pendientes": "Todos los empleados activos tienen sus vacaciones al día. Bien.",
        "imss_a_pagar": "No hay nóminas pagadas este mes con cuotas IMSS.",
        "ptu_estimado": "No hay cálculo de PTU registrado todavía.",
        "iva_mes": "No hay ventas ni facturas de proveedor este mes.",
        "lead_time_proveedor": "Ningún proveedor tiene lead time configurado.",
        "reordenar_sin_oc": "Todos los SKUs bajo mínimo ya tienen OC en camino. Bien gestionado.",
        "variacion_costo": "No hay cambios significativos de costo (>5%) en los últimos 60 días.",
        "top_valor_inmovilizado": "No hay stock valorizado en el inventario.",
        "faltantes_para_pedidos": "Ningún pedido pendiente excede el stock disponible. Todo se puede surtir.",
        "descuentos_pos_dia": "No se aplicaron descuentos en el POS hoy.",
        "devoluciones_pos_dia": "No hay devoluciones registradas en el POS hoy.",
        "cancelaciones_pos_dia": "No hay órdenes canceladas hoy.",
        "top_producto_pos_dia": "No hay ventas registradas en el POS hoy.",
        # Fase 8
        "top_vendedores": "No hay ventas asignadas a vendedores en el periodo consultado.",
        "ventas_pos_periodo": "No hay ventas registradas en el POS para el periodo consultado.",
        "ventas_cliente": "No encontré un cliente con ese nombre, o no tiene compras registradas.",
        # Fase 9
        "ventas_persona": "No encontré vendedor ni cliente con ese nombre.",
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


# ═════════════ formatters de tools Fase 2/3 ═════════════

def _t_concentracion(r: Dict[str, Any]) -> str:
    t = (f"Tienes {r['n_clientes']} clientes activos {r['periodo']}. "
         f"**{r['clientes_hasta_80']}** concentran el 80% del ingreso.")
    if r.get("top1"):
        t += (f"\n\nTop cliente: **{r['top1']['name']}** — "
              f"{_mxn(r['top1']['revenue'])} ({r['top1']['pct']}% del total).")
    t += f"\nLos 3 principales pesan **{r['top3_pct']}%**."
    return t


def _t_sin_movimiento(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** SKU activo{'s' if r['count'] != 1 else ''} sin ventas en {r['dias']} días."
    if r["items"]:
        t += "\n\nCon más stock parado:"
        for it in r["items"][:5]:
            t += f"\n• **{it['name']}** ({it['sku']}) — {it['stock']} uds."
    return t


def _t_rotacion(r: Dict[str, Any]) -> str:
    t = (f"WoS promedio: **{r['wos_promedio']} semanas** "
         f"({r['n_evaluados']} SKUs evaluados con ventas recientes).")
    if r.get("rapidos"):
        t += "\n\nRápidos:"
        for it in r["rapidos"][:3]:
            t += f"\n• {it['name']} — {it['wos']}sem (vel {it['vel_sem']}/sem)"
    if r.get("lentos"):
        t += "\n\nLentos:"
        for it in r["lentos"][:3]:
            t += f"\n• {it['name']} — {it['wos']}sem"
    return t


def _t_desempeno_tienda(r: Dict[str, Any]) -> str:
    lines = [f"Desempeño de tiendas {r['periodo']}:"]
    if r.get("top"):
        lines.append("\nTop:")
        for i, it in enumerate(r["top"], 1):
            lines.append(f"{i}. **{it['name']}** ({it['cadena']}) — {_mxn(it['revenue'])} · {it['unidades']} uds.")
    if r.get("bottom"):
        lines.append("\nBottom:")
        for it in r["bottom"]:
            lines.append(f"• {it['name']} ({it['cadena']}) — {_mxn(it['revenue'])}")
    return "\n".join(lines)


def _t_sell_through(r: Dict[str, Any]) -> str:
    lines = [f"Sell-out por tienda {r['periodo']}:"]
    for it in r["items"]:
        lines.append(f"• **{it['name']}** — {it['units_out']} uds.")
    if r.get("nota"):
        lines.append(f"\n_{r['nota']}_")
    return "\n".join(lines)


def _t_pos_hora(r: Dict[str, Any]) -> str:
    lines = [f"POS por hora ({r['fecha']}):"]
    for h in r["horas"]:
        bar = "▇" * min(20, int(h["monto"] / 500)) if h["monto"] else ""
        lines.append(f"{h['hora']:02d}:00 — {_mxn(h['monto'])} · {h['tickets']}t  {bar}")
    if r.get("pico"):
        lines.append(f"\nHora pico: **{r['pico']['hora']:02d}:00** con {_mxn(r['pico']['monto'])}")
    return "\n".join(lines)


def _t_utilidad_bruta(r: Dict[str, Any]) -> str:
    return (f"Utilidad bruta {r['periodo']}: **{_mxn(r['utilidad'])}** "
            f"({r['margen_pct']}% de margen).\n"
            f"Ingreso {_mxn(r['ingreso'])} − Costo {_mxn(r['costo'])}.")


def _t_cotizaciones(r: Dict[str, Any]) -> str:
    t = (f"**{r['count']}** cotizaci{'ones abiertas' if r['count'] != 1 else 'ón abierta'} "
         f"por un total de **{_mxn(r['monto_total'])}**.")
    if r.get("recientes"):
        t += "\n\nRecientes:"
        for it in r["recientes"]:
            t += f"\n• {it['folio']} — {_mxn(it['monto'])}"
    return t


def _t_clientes_inactivos(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** cliente{'s' if r['count'] != 1 else ''} sin comprar en {r['dias']}+ días."
    if r.get("items"):
        t += "\n\nMás recientes en volverse inactivos:"
        for it in r["items"][:5]:
            d = it.get("dias_sin_comprar")
            t += f"\n• **{it['name']}** — {d or '?'}d sin comprar"
    return t


def _t_ticket_promedio(r: Dict[str, Any]) -> str:
    return (f"Ticket promedio {r['periodo']}: **{_mxn(r['ticket'])}** "
            f"(sobre {r['count']} pedidos).")


def _t_devoluciones(r: Dict[str, Any]) -> str:
    return (f"**{r['count']}** devoluci{'ones' if r['count'] != 1 else 'ón'} {r['periodo']} — "
            f"**{_mxn(r['monto'])}** reembolsados.")


def _t_venc_semana(r: Dict[str, Any], quien: str) -> str:
    t = (f"**{r['count']}** {quien}{'s' if r['count'] != 1 else ''} "
         f"vencen esta semana — total **{_mxn(r['total'])}**.")
    if r["items"]:
        t += "\n\nDetalle:"
        for it in r["items"][:5]:
            who = it.get("cliente") or it.get("proveedor") or "?"
            t += f"\n• {it['folio']} · {who} — {_mxn(it['monto'])} ({it['vence']})"
    return t


def _t_flujo_neto(r: Dict[str, Any]) -> str:
    signo = "positivo" if r["neto"] >= 0 else "**negativo**"
    return (f"Flujo neto proyectado 30 días: {signo} **{_mxn(r['neto'])}**.\n"
            f"CxC esperada {_mxn(r['cxc'])} − CxP esperada {_mxn(r['cxp'])}.")


def _t_oc_abiertas(r: Dict[str, Any]) -> str:
    t = (f"**{r['count']}** OC abierta{'s' if r['count'] != 1 else ''} — "
         f"total **{_mxn(r['monto_total'])}**.")
    if r["items"]:
        t += "\n\nRecientes:"
        for it in r["items"][:5]:
            t += f"\n• {it['folio']} · {it['proveedor']} — {_mxn(it['monto'])} ({it['status']}, {it['vence']})"
    return t


def _t_oc_atrasadas(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** OC atrasada{'s' if r['count'] != 1 else ''}."
    if r["items"]:
        t += "\n\nMás críticas:"
        for it in r["items"][:5]:
            t += f"\n• {it['folio']} · {it['proveedor']} — {_mxn(it['monto'])} (**{it['dias_retraso']}d de retraso**)"
    return t


def _t_top_proveedores(r: Dict[str, Any]) -> str:
    lines = [f"Top proveedores {r['periodo']} por gasto:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {_mxn(it['gasto'])} ({it['facturas']} facturas)")
    return "\n".join(lines)


def _t_valor_inventario(r: Dict[str, Any]) -> str:
    return (f"Inventario valorizado en **{_mxn(r['valor_total'])}** "
            f"sobre {r['skus_con_stock']} SKUs con stock.")


def _t_merma(r: Dict[str, Any]) -> str:
    return (f"Merma del mes: **{r['unidades']} uds.** por **{_mxn(r['valor'])}** "
            f"en {r['movimientos']} movimiento{'s' if r['movimientos'] != 1 else ''}.")


def _t_ing_vs_egr(r: Dict[str, Any]) -> str:
    resultado = "utilidad" if r["neto"] >= 0 else "**pérdida**"
    return (f"P&L {r['periodo']}:\n"
            f"• Ingresos: **{_mxn(r['ingresos'])}**\n"
            f"• Egresos: {_mxn(r['egresos'])}\n"
            f"• Resultado: {resultado} de **{_mxn(abs(r['neto']))}**")


def _t_gastos_cat(r: Dict[str, Any]) -> str:
    lines = [f"Gastos {r['periodo']} — total {_mxn(r['total'])}:"]
    for it in r["items"]:
        lines.append(f"• {it['categoria']} — **{_mxn(it['monto'])}**")
    return "\n".join(lines)


def _t_no_conciliados(r: Dict[str, Any]) -> str:
    return (f"**{r['count']}** movimiento{'s' if r['count'] != 1 else ''} bancario"
            f"{'s' if r['count'] != 1 else ''} sin conciliar por **{_mxn(r['monto'])}**.")


def _t_nomina_periodo(r: Dict[str, Any]) -> str:
    t = (f"Nómina **{r['periodo']}** ({r['status']}, {r['kind']}):\n"
         f"• Empleados: {r['empleados']}\n"
         f"• Bruto: **{_mxn(r['bruto'])}**\n"
         f"• Neto pagado: **{_mxn(r['neto'])}**\n"
         f"• IMSS patronal: {_mxn(r['imss_patronal'])}")
    return t


def _t_empleados(r: Dict[str, Any]) -> str:
    return (f"Plantilla activa: **{r['activos']}** empleado"
            f"{'s' if r['activos'] != 1 else ''}. "
            f"Altas este mes: {r['altas_mes']}.")


def _t_incapacidades(r: Dict[str, Any]) -> str:
    t = f"**{r['total']}** incapacidad{'es' if r['total'] != 1 else ''} en {r['periodo']}."
    if r.get("desglose"):
        t += "\n\nDesglose:"
        for k, v in r["desglose"].items():
            t += f"\n• {k}: {v}"
    return t


def _t_contratos(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** contrato{'s' if r['count'] != 1 else ''} vencen en {r['dias']} días."
    if r["items"]:
        t += "\n\nPróximos:"
        for it in r["items"][:5]:
            t += f"\n• **{it['empleado']}** ({it['tipo']}) — vence {it['vence']} (en {it['dias']}d)"
    return t


def _t_cumpleanos(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** cumpleaños este mes."
    if r["items"]:
        for it in r["items"][:10]:
            t += f"\n• {it['dia']} — {it['nombre']}"
    return t


def _t_isr_nomina(r: Dict[str, Any]) -> str:
    return f"ISR retenido de nómina {r['periodo']}: **{_mxn(r['isr_retenido'])}**."


def _t_corte_caja(r: Dict[str, Any]) -> str:
    t = f"**{r['abiertas']}** sesión{'es' if r['abiertas'] != 1 else ''} POS abierta{'s' if r['abiertas'] != 1 else ''}."
    if r["sesiones"]:
        t += "\n\nEsperado en caja:"
        for s in r["sesiones"]:
            t += f"\n• {s['terminal']} (desde {s['abierta']}) — **{_mxn(s['esperado'])}**"
    return t


def _t_formas_pago(r: Dict[str, Any]) -> str:
    t = f"Formas de pago del POS ({r['fecha']}) — total **{_mxn(r['total'])}**:"
    for it in r["items"]:
        t += f"\n• {it['metodo']}: **{_mxn(it['monto'])}** ({it['tickets']}t)"
    return t


def _t_top_cajeros(r: Dict[str, Any]) -> str:
    lines = [f"Top cajeros del día ({r['fecha']}):"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['cajero']}** — {_mxn(it['monto'])} ({it['tickets']}t)")
    return "\n".join(lines)


def _t_flujo_proyectado(r: Dict[str, Any]) -> str:
    return (f"Proyección de caja 30 días:\n"
            f"• Saldo actual bancos: **{_mxn(r['saldo_actual'])}**\n"
            f"• Cobranza esperada: {_mxn(r['cobranza_esperada'])}\n"
            f"• Pagos esperados: {_mxn(r['pagos_esperados'])}\n"
            f"• **Proyección: {_mxn(r['proyeccion_30d'])}**")


def _t_nomina_vs_ventas(r: Dict[str, Any]) -> str:
    pct = r.get("pct_costo_laboral")
    pct_txt = f"**{pct}%**" if pct is not None else "s/d"
    return (f"Costo laboral del mes: {pct_txt} de las ventas.\n"
            f"Ventas {_mxn(r['ventas'])} · Nómina bruta {_mxn(r['nomina'])}.")


# ═════════════ formatters Fase 6 ═════════════

def _t_wos_critico(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** tienda{'s' if r['count'] != 1 else ''} en WoS crítico."
    if r["items"]:
        t += "\n\nUrgentes:"
        for it in r["items"][:5]:
            t += f"\n• **{it['name']}** ({it['cadena']}) — {it['wos']}sem · {it['on_hand']} uds. (umbral {it['umbral']})"
    return t


def _t_sobrestock(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** tienda{'s' if r['count'] != 1 else ''} con sobre-stock."
    if r["items"]:
        t += "\n\nCandidatas a traslado:"
        for it in r["items"][:5]:
            t += f"\n• **{it['name']}** ({it['cadena']}) — {it['wos']}sem · {it['on_hand']} uds. (umbral {it['umbral']})"
    return t


def _t_fill_rate(r: Dict[str, Any]) -> str:
    lines = [f"Fill rate por cadena {r['periodo']}:"]
    for it in r["items"]:
        pct = it["fill_rate_pct"]
        pct_txt = f"**{pct}%**" if pct is not None else "s/d"
        lines.append(f"• {it['cadena']} — {pct_txt} ({it['vendido']} vend / {it['devuelto']} dev)")
    return "\n".join(lines)


def _t_return_rate(r: Dict[str, Any]) -> str:
    lines = [f"Return rate por cadena {r['periodo']}:"]
    for it in r["items"]:
        marca = " ⚠️" if it["excede"] else ""
        lines.append(f"• {it['cadena']} — **{it['return_rate_pct']}%** (umbral {it['umbral']}%){marca}")
    return "\n".join(lines)


def _t_aging_cxc(r: Dict[str, Any]) -> str:
    b = r["buckets"]
    return (f"Aging CxC — total **{_mxn(r['total'])}**:\n"
            f"• Al día: {_mxn(b.get('al_dia', 0))}\n"
            f"• 1-30 días: {_mxn(b.get('1_30', 0))}\n"
            f"• 31-60 días: {_mxn(b.get('31_60', 0))}\n"
            f"• +60 días: **{_mxn(b.get('mas_60', 0))}**")


def _t_dso_dpo(r: Dict[str, Any]) -> str:
    dso = r["dso_dias"]
    dpo = r["dpo_dias"]
    dso_t = f"**{dso}d**" if dso is not None else "s/d"
    dpo_t = f"**{dpo}d**" if dpo is not None else "s/d"
    return (f"DSO (días de cobro): {dso_t}\n"
            f"DPO (días de pago): {dpo_t}\n"
            f"CxC {_mxn(r['cxc'])} · CxP {_mxn(r['cxp'])}")


def _t_pagos_prog(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** pago{'s' if r['count'] != 1 else ''} programado{'s' if r['count'] != 1 else ''} — total **{_mxn(r['total'])}**."
    if r["items"]:
        t += "\n\nPróximos:"
        for it in r["items"][:5]:
            t += f"\n• {it['fecha']} · {it['concepto']} ({it['tipo']}) — {_mxn(it['monto'])}"
    return t


def _t_aguinaldo(r: Dict[str, Any]) -> str:
    t = (f"Aguinaldo devengado al día: **{_mxn(r['total'])}** "
         f"para {r['empleados']} empleado{'s' if r['empleados'] != 1 else ''}.")
    if r.get("top"):
        t += "\n\nMayor devengado:"
        for it in r["top"][:5]:
            t += f"\n• {it['empleado']} — {_mxn(it['aguinaldo'])}"
    return t


def _t_vacaciones(r: Dict[str, Any]) -> str:
    t = (f"**{r['empleados_con_saldo']}** empleado{'s' if r['empleados_con_saldo'] != 1 else ''} "
         f"con vacaciones pendientes ({r['total_dias']} días en total).")
    if r.get("top"):
        t += "\n\nMayor saldo:"
        for it in r["top"][:5]:
            t += f"\n• {it['empleado']} — {it['pendientes']} días"
    return t


def _t_imss(r: Dict[str, Any]) -> str:
    return (f"IMSS {r['periodo']} — total a pagar **{_mxn(r['total'])}**:\n"
            f"• Cuota obrero: {_mxn(r['obrero'])}\n"
            f"• Cuota patronal: {_mxn(r['patronal'])}\n"
            f"• INFONAVIT patronal (5%): {_mxn(r['infonavit_patronal'])}")


def _t_ptu(r: Dict[str, Any]) -> str:
    return (f"PTU {r['anio']} ({r['status']}):\n"
            f"• Utilidad repartible: **{_mxn(r['utilidad_repartible'])}**\n"
            f"• PTU pagado: {_mxn(r['ptu_pagado'])}\n"
            f"• Empleados excluidos: {r['excluidos']}")


def _t_iva(r: Dict[str, Any]) -> str:
    return (f"IVA {r['periodo']} (aproximación):\n"
            f"• Trasladado: **{_mxn(r['trasladado'])}**\n"
            f"• Acreditable: {_mxn(r['acreditable'])}\n"
            f"• Saldo: **{_mxn(r['saldo'])}**\n"
            f"_{r.get('nota', '')}_")


def _t_lead_time(r: Dict[str, Any]) -> str:
    t = f"Lead time promedio: **{r['promedio_dias']}d** ({r['count']} proveedores configurados)."
    if r.get("mas_lentos"):
        t += "\n\nMás lentos:"
        for it in r["mas_lentos"][:5]:
            t += f"\n• {it['name']} — {it['dias']}d"
    return t


def _t_reordenar_sin_oc(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** SKU{'s' if r['count'] != 1 else ''} bajo punto de reorden SIN orden de compra abierta."
    if r["items"]:
        t += "\n\nUrgentes:"
        for it in r["items"][:5]:
            t += f"\n• **{it['name']}** ({it['sku']}) — {it['stock']} uds (reorden a {it['reorder']})"
    return t


def _t_variacion_costo(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** SKU{'s' if r['count'] != 1 else ''} con variación >5% en costo (últimos 60 días)."
    if r["items"]:
        t += "\n\nMayores cambios:"
        for it in r["items"][:5]:
            arrow = "↑" if it["variacion_pct"] > 0 else "↓"
            t += f"\n• **{it['name']}** ({it['sku']}) — {arrow}{abs(it['variacion_pct'])}% ({_mxn(it['anterior'])} → {_mxn(it['actual'])})"
    return t


def _t_top_inmovilizado(r: Dict[str, Any]) -> str:
    lines = ["Top SKUs por valor inmovilizado:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** ({it['sku']}) — {_mxn(it['valor'])} ({it['unidades']} uds)")
    return "\n".join(lines)


def _t_faltantes(r: Dict[str, Any]) -> str:
    t = f"**{r['count']}** SKU{'s' if r['count'] != 1 else ''} con demanda pendiente que excede el stock."
    if r["items"]:
        t += "\n\nMayores faltantes:"
        for it in r["items"][:5]:
            t += f"\n• **{it['name']}** ({it['sku']}) — faltan **{it['faltan']}** uds. (req {it['requerido']} / stock {it['stock']})"
    return t


def _t_descuentos_pos(r: Dict[str, Any]) -> str:
    return (f"Descuentos POS ({r['fecha']}): **{_mxn(r['monto_descontado'])}** "
            f"en {r['tickets_con_descuento']} ticket{'s' if r['tickets_con_descuento'] != 1 else ''}.")


def _t_devoluciones_pos(r: Dict[str, Any]) -> str:
    return (f"Devoluciones POS ({r['fecha']}): **{r['count']}** — total **{_mxn(r['monto'])}**.")


def _t_cancelaciones_pos(r: Dict[str, Any]) -> str:
    return (f"Cancelaciones ({r['fecha']}): **{r['count']}** órdenes por {_mxn(r['monto'])}.")


def _t_top_prod_pos(r: Dict[str, Any]) -> str:
    lines = [f"Top productos POS ({r['fecha']}):"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['name']}** — {it['unidades']} uds. ({_mxn(it['revenue'])})")
    return "\n".join(lines)


# ═════════════ formatters Fase 8 ═════════════

def _t_top_vendedores(r: Dict[str, Any]) -> str:
    lines = [f"Top vendedores {r['periodo']}:"]
    for i, it in enumerate(r["items"], 1):
        lines.append(f"{i}. **{it['vendedor']}** — {_mxn(it['revenue'])} en {it['pedidos']} pedido{'s' if it['pedidos'] != 1 else ''}")
    return "\n".join(lines)


def _t_ventas_pos_periodo(r: Dict[str, Any]) -> str:
    return (f"POS {r['periodo']}: **{_mxn(r['total'])}** en {r['tickets']} ticket"
            f"{'s' if r['tickets'] != 1 else ''}"
            f" (promedio {_mxn(r['ticket_promedio'])}).")


def _t_ventas_persona(r: Dict[str, Any]) -> str:
    """Formato con secciones — vendedor, cliente y/o empleado según qué
    se encontró bajo el nombre buscado."""
    vends = r.get("vendedores") or []
    custs = r.get("clientes") or []
    emps = r.get("empleados") or []
    parts = [f"Búsqueda: **{r['nombre_busqueda']}**"]
    if vends:
        parts.append("\n**Como vendedor:**")
        for v in vends:
            parts.append(
                f"• **{v['nombre']}** — {_mxn(v['total_vendido'])} en "
                f"{v['pedidos']} pedido{'s' if v['pedidos'] != 1 else ''}"
                f" (última venta {v['ultima_venta']})"
            )
    if custs:
        parts.append("\n**Como cliente:**")
        for c in custs:
            parts.append(
                f"• **{c['nombre']}** — compró {_mxn(c['total_comprado'])} "
                f"({c['pedidos']} pedido{'s' if c['pedidos'] != 1 else ''}, "
                f"saldo {_mxn(c['saldo_pendiente'])}, última {c['ultima_compra']})"
            )
    if emps:
        parts.append("\n**Como empleado:**")
        for e in emps:
            num = f" ({e['numero']})" if e.get("numero") else ""
            parts.append(
                f"• **{e['nombre']}**{num} — {e['puesto']} · {e['departamento']}"
                f" (ingreso {e['ingreso']}, estado {e['estado']})"
            )
            # Datos operativos HR (solo si el rol los tiene habilitados)
            if "salario_base" in e:
                parts.append(
                    f"   — Salario **{_mxn(e['salario_base'])}** {e['frecuencia']}"
                    f" · SBC {_mxn(e['sbc'])} · Contrato {e['contrato']}"
                )
                parts.append(
                    f"   — Contacto: {e['telefono']} · {e['email_personal']}"
                )
                parts.append(
                    f"   — Banco: {e['banco']} · CLABE {e['clabe']}"
                )
                parts.append(
                    f"   — Vacaciones pendientes: **{e['vacaciones_pendientes']}d**"
                    f" · {e['deducciones']}"
                )
    return "\n".join(parts)


# Retrocompat: ventas_cliente ya no se usa de la regex, pero el alias en
# tools.py sigue devolviendo el mismo shape que ventas_persona.
_t_ventas_cliente = _t_ventas_persona


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
    # Fase 2 (stubs → real)
    "concentracion_clientes": _t_concentracion,
    "sin_movimiento": _t_sin_movimiento,
    "rotacion_producto": _t_rotacion,
    "desempeno_tienda": _t_desempeno_tienda,
    "sell_through_por_tienda": _t_sell_through,
    "ventas_pos_hora": _t_pos_hora,
    "utilidad_bruta": _t_utilidad_bruta,
    # Fase 3 (tools nuevas)
    "cotizaciones_abiertas": _t_cotizaciones,
    "clientes_inactivos": _t_clientes_inactivos,
    "ticket_promedio_ventas": _t_ticket_promedio,
    "devoluciones_periodo": _t_devoluciones,
    "cxc_vencen_semana": lambda r: _t_venc_semana(r, "cobro"),
    "cxp_vencen_semana": lambda r: _t_venc_semana(r, "pago"),
    "flujo_neto_30d": _t_flujo_neto,
    "oc_abiertas": _t_oc_abiertas,
    "oc_atrasadas": _t_oc_atrasadas,
    "top_proveedores": _t_top_proveedores,
    "valor_inventario": _t_valor_inventario,
    "merma_mes": _t_merma,
    "ingresos_vs_egresos": _t_ing_vs_egr,
    "gastos_por_categoria": _t_gastos_cat,
    "movimientos_no_conciliados": _t_no_conciliados,
    "nomina_periodo": _t_nomina_periodo,
    "empleados_activos": _t_empleados,
    "incapacidades_mes": _t_incapacidades,
    "contratos_por_vencer": _t_contratos,
    "cumpleanos_mes": _t_cumpleanos,
    "isr_nomina_mes": _t_isr_nomina,
    "corte_caja_actual": _t_corte_caja,
    "formas_pago_pos": _t_formas_pago,
    "top_cajeros_dia": _t_top_cajeros,
    "flujo_efectivo_proyectado": _t_flujo_proyectado,
    "nomina_vs_ventas": _t_nomina_vs_ventas,
    # Fase 6
    "tiendas_wos_critico": _t_wos_critico,
    "tiendas_sobrestock": _t_sobrestock,
    "fill_rate_cadena": _t_fill_rate,
    "return_rate_cadena": _t_return_rate,
    "aging_cxc": _t_aging_cxc,
    "dso_dpo": _t_dso_dpo,
    "pagos_programados": _t_pagos_prog,
    "aguinaldo_devengado": _t_aguinaldo,
    "vacaciones_pendientes": _t_vacaciones,
    "imss_a_pagar": _t_imss,
    "ptu_estimado": _t_ptu,
    "iva_mes": _t_iva,
    "lead_time_proveedor": _t_lead_time,
    "reordenar_sin_oc": _t_reordenar_sin_oc,
    "variacion_costo": _t_variacion_costo,
    "top_valor_inmovilizado": _t_top_inmovilizado,
    "faltantes_para_pedidos": _t_faltantes,
    "descuentos_pos_dia": _t_descuentos_pos,
    "devoluciones_pos_dia": _t_devoluciones_pos,
    "cancelaciones_pos_dia": _t_cancelaciones_pos,
    "top_producto_pos_dia": _t_top_prod_pos,
    # Fase 8
    "top_vendedores": _t_top_vendedores,
    "ventas_pos_periodo": _t_ventas_pos_periodo,
    "ventas_cliente": _t_ventas_cliente,
    # Fase 9
    "ventas_persona": _t_ventas_persona,
}
