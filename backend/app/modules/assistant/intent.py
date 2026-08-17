"""Router de intención — regex + keywords sobre la pregunta del usuario.

Meta: capturar el 60-70% de preguntas frecuentes sin llamar al LLM.
Cada patrón mapea a (tool_name, kwargs) que se ejecutan directo.
"""
from __future__ import annotations
import re
from typing import Optional, Tuple, Dict, Any


# Cada entrada: (regex, tool_name, kwargs_deriver)
# El deriver recibe el match y devuelve los kwargs; si es None se ejecuta sin args.
_PATTERNS: list = [
    # Ventas periodo — captura "vendí este mes / hoy / semana / año"
    (r"(cu[aá]nt[oa]|total|monto).{0,20}(vend|factur|ingres)",
        "ventas_periodo", lambda m, q: {"periodo": _detect_period(q)}),
    (r"(ventas|facturaci[oó]n).{0,25}(hoy|semana|mes|a[ñn]o|ayer)",
        "ventas_periodo", lambda m, q: {"periodo": _detect_period(q)}),

    # Top productos
    (r"(top|mejor(es)?|mayor(es)?|los? m[aá]s vendid).{0,30}(product|art[ií]cul|sku|it[ei]m)",
        "top_productos", lambda m, q: {"periodo": _detect_period(q),
                                        "por": _detect_metric(q), "limite": _detect_limit(q)}),
    (r"(product|art[ií]cul).{0,20}(top|mejor|m[aá]s vendid)",
        "top_productos", lambda m, q: {"periodo": _detect_period(q),
                                        "por": _detect_metric(q), "limite": _detect_limit(q)}),

    # Top clientes
    (r"(top|mejor(es)?|los? m[aá]s importantes?).{0,20}client",
        "top_clientes", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),
    (r"client.{0,15}(m[aá]s\s+(compran?|import|activ)|top)",
        "top_clientes", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),

    # Pedidos pendientes / abiertos
    (r"(pedidos?|[oó]rdenes?).{0,25}(pendient|abiert|sin\s+pagar|por\s+entregar)",
        "pedidos_pendientes", None),

    # CxC — cuentas por cobrar
    (r"(cxc|por\s+cobrar|cartera(\s+vencida)?|deben(me)?|adeudos?\s+de\s+client)",
        "cxc_resumen", None),
    (r"cu[aá]nto.{0,20}(me\s+deben|debe\s+el\s+cliente)",
        "cxc_resumen", None),

    # CxP — cuentas por pagar
    (r"(cxp|por\s+pagar|adeudos?\s+a\s+proveedor|proveedor.{0,15}debemos)",
        "cxp_resumen", None),
    (r"cu[aá]nto.{0,20}debemos",
        "cxp_resumen", None),

    # Top deudores/acreedores atajos
    (r"(qui[eé]n(es)?|top).{0,25}(me\s+debe|debe\s+m[aá]s|deudor)",
        "top_deudores", None),
    (r"(qui[eé]n(es)?|top).{0,25}(le\s+debemos|acreedor)",
        "top_acreedores", None),

    # Saldo bancos
    (r"(saldo(s)?|efectivo|dinero).{0,25}(banc|cuenta)",
        "saldo_bancos", None),
    (r"cu[aá]nto.{0,15}(hay|tengo).{0,15}(banc|cuenta)",
        "saldo_bancos", None),

    # Stock crítico / bajo
    (r"(stock|inventario).{0,20}(cr[ií]tic|bajo|agotad|escas)",
        "stock_critico", None),
    (r"(qu[eé]|cu[aá]les?).{0,20}(product|art[ií]cul|sku).{0,20}(agotad|falta|reorden)",
        "stock_critico", None),

    # Caducidades
    (r"(caducid|vencimient|por\s+cad|perecedero|pr[oó]xim\w*\s+a\s+caducar)",
        "caducidades_proximas", lambda m, q: {"dias": _detect_days(q, default=30)}),

    # Cadena / retail
    (r"(cadena|walmart|soriana|chedraui|costco|heb|comercial\s+mexicana)",
        "desempeno_cadena", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),
    (r"(c[oó]mo\s+va|desempe[nñ]o|performance).{0,20}(cadena|retail)",
        "desempeno_cadena", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),

    # POS — ventas del día
    (r"(pos|punto\s+de\s+venta|caja).{0,25}(hoy|d[ií]a|corte)",
        "ventas_pos_dia", None),
    (r"cu[aá]nto.{0,15}vend.{0,15}(pos|hoy|caja)",
        "ventas_pos_dia", None),

    # Utilidad / margen
    (r"(utilidad|margen|rentabilidad|ganancia)",
        "utilidad_bruta", lambda m, q: {"periodo": _detect_period(q)}),

    # Concentración
    (r"(concentraci[oó]n|pareto|80.{0,3}20|dependen(cia|ci) de client)",
        "concentracion_clientes", None),

    # Sin movimiento
    (r"(sin\s+movimient|no\s+se\s+vend|no\s+rot|estanc)",
        "sin_movimiento", lambda m, q: {"dias": _detect_days(q, default=30)}),

    # Rotación
    (r"(rotaci[oó]n|weeks?\s+of\s+supply|wos|d[ií]as?\s+de\s+inventario)",
        "rotacion_producto", None),

    # ── Ventas / CRM (nuevas) ─────────────────────────────────────────
    (r"(cotizaci[oó]n|quote|presupuesto).{0,20}(abiert|pendient|potencial|pipeline)?",
        "cotizaciones_abiertas", None),
    (r"(client|customer).{0,30}(inactiv|dejar|no\s+compran?|sin\s+compra|perdid)",
        "clientes_inactivos", lambda m, q: {"dias": _detect_days(q, default=60)}),
    (r"ticket\s+promedio",
        "ticket_promedio_ventas", lambda m, q: {"periodo": _detect_period(q)}),
    (r"(devoluci[oó]n(es)?|refund|reembols|retorn[oa]s?)",
        "devoluciones_periodo", lambda m, q: {"periodo": _detect_period(q)}),

    # ── Finanzas (nuevas) ─────────────────────────────────────────────
    (r"(cxc|por\s+cobrar|cobros?).{0,20}(esta\s+semana|pr[oó]xim|siguient)",
        "cxc_vencen_semana", None),
    (r"(cxp|por\s+pagar|pagos?).{0,20}(esta\s+semana|pr[oó]xim|siguient)",
        "cxp_vencen_semana", None),
    (r"(flujo|cash\s*flow|efectivo).{0,25}(proyec|30|mes|neto)",
        "flujo_neto_30d", None),

    # ── Compras ───────────────────────────────────────────────────────
    (r"(oc|[oó]rdenes?\s+de\s+compra|purchase\s+order).{0,20}(abiert|pendient|activ)",
        "oc_abiertas", None),
    (r"(oc|[oó]rdenes?\s+de\s+compra).{0,20}(atrasad|retras|vencid|tarde)",
        "oc_atrasadas", None),
    (r"(top|mejor(es)?).{0,20}proveedor",
        "top_proveedores", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),

    # ── Inventario avanzado ───────────────────────────────────────────
    (r"(valor|monto|cu[aá]nto\s+vale).{0,20}inventario",
        "valor_inventario", None),
    (r"(merma|caduc.{0,10}consumid|desperdicio|p[eé]rdida\s+inventario)",
        "merma_mes", None),

    # ── Contabilidad ──────────────────────────────────────────────────
    (r"(utilidad|margen|rentabilidad|ganancia)\s*(bruta)?",
        "utilidad_bruta", lambda m, q: {"periodo": _detect_period(q)}),
    (r"(ingresos?|entradas?).{0,15}(vs|contra|versus).{0,15}(egresos?|salidas?|gastos?)",
        "ingresos_vs_egresos", lambda m, q: {"periodo": _detect_period(q)}),
    (r"^(p&?l|pyl|estado\s+de\s+resultados)",
        "ingresos_vs_egresos", lambda m, q: {"periodo": _detect_period(q)}),
    (r"(gastos?).{0,15}(por|categor[ií]as?)",
        "gastos_por_categoria", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),
    (r"(no\s+conciliad|sin\s+conciliar|conciliaci[oó]n\s+pendient)",
        "movimientos_no_conciliados", None),

    # ── RH / Nómina ───────────────────────────────────────────────────
    (r"(n[oó]mina|payroll).{0,20}(mes|actual|periodo|reciente|[uú]ltim)",
        "nomina_periodo", None),
    (r"^(cu[aá]nto\s+pago(?:mos)?\s+de\s+n[oó]mina|total\s+n[oó]mina)",
        "nomina_periodo", None),
    (r"(empleados?\s+activ|plantilla|headcount|altas?\s+del\s+mes)",
        "empleados_activos", None),
    (r"(incapacid|permisos?\s+m[eé]dicos?|imss\s+incap)",
        "incapacidades_mes", None),
    (r"(contrato).{0,25}(vence|por\s+vencer|renovar|termin)",
        "contratos_por_vencer", lambda m, q: {"dias": _detect_days(q, default=30)}),
    (r"(cumplea[nñ]os|birthday|aniversari)",
        "cumpleanos_mes", None),
    (r"(isr).{0,20}(n[oó]mina|retenid)",
        "isr_nomina_mes", None),

    # ── POS avanzado ──────────────────────────────────────────────────
    (r"(corte\s+de\s+caja|caja\s+actual|sesi[oó]n(es)?\s+abiert)",
        "corte_caja_actual", None),
    (r"(formas?\s+de\s+pago|m[eé]todo\s+de\s+pago|efectivo\s+vs\s+tarjeta)",
        "formas_pago_pos", None),
    (r"(top\s+cajer|mejor(es)?\s+cajer|cajer.{0,15}(m[aá]s\s+vend|top))",
        "top_cajeros_dia", None),
    (r"(ventas?|pos).{0,20}(por\s+hora|hora\s+pico|franja)",
        "ventas_pos_hora", None),

    # ── Retail avanzado ───────────────────────────────────────────────
    (r"(tienda|store).{0,20}(top|mejor|desempe[nñ]o|revenue)",
        "desempeno_tienda", lambda m, q: {"periodo": _detect_period(q), "limite": _detect_limit(q)}),
    (r"(sell\s*through|sell-through)",
        "sell_through_por_tienda", lambda m, q: {"periodo": _detect_period(q)}),

    # ── KPI ejecutivo (Administrador) ─────────────────────────────────
    (r"(flujo\s+de\s+efectivo|cash\s*flow\s+proyec|proyecci[oó]n\s+de\s+caja)",
        "flujo_efectivo_proyectado", None),
    (r"(n[oó]mina).{0,15}(vs|contra|sobre).{0,15}(ventas?|ingresos?)",
        "nomina_vs_ventas", None),
    (r"(%|porcentaje).{0,20}(costo\s+laboral|nomina\s+sobre)",
        "nomina_vs_ventas", None),
]


def _detect_period(q: str) -> str:
    ql = q.lower()
    if re.search(r"\bhoy\b", ql): return "hoy"
    if re.search(r"\bayer\b", ql): return "ayer"
    if re.search(r"\b(esta\s+)?semana\b", ql): return "semana"
    if re.search(r"\b(mes\s+pasado|mes\s+anterior)\b", ql): return "mes_pasado"
    if re.search(r"\b(a[ñn]o|anual|ytd|acumulad)\b", ql): return "año"
    return "mes"


def _detect_metric(q: str) -> str:
    ql = q.lower()
    if re.search(r"(unidad|cantidad|volumen|piezas)", ql): return "unidades"
    if re.search(r"(margen|utilidad|ganancia)", ql): return "margen"
    return "revenue"


def _detect_limit(q: str, default: int = 5) -> int:
    m = re.search(r"\btop\s*(\d{1,2})\b", q.lower())
    if m: return min(max(int(m.group(1)), 1), 20)
    m = re.search(r"\b(\d{1,2})\s+(mejor|top|primer)", q.lower())
    if m: return min(max(int(m.group(1)), 1), 20)
    return default


def _detect_days(q: str, default: int = 30) -> int:
    m = re.search(r"\b(\d{1,3})\s*d[ií]as?\b", q.lower())
    if m: return min(max(int(m.group(1)), 1), 365)
    return default


def route(question: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Devuelve (tool_name, kwargs) si la pregunta matchea algún patrón,
    o None si no matchea nada (escalar a LLM en Sprint 2)."""
    q = (question or "").strip().lower()
    if not q or len(q) < 3:
        return None
    for pat, tool, deriver in _PATTERNS:
        m = re.search(pat, q)
        if m:
            kwargs = deriver(m, q) if deriver else {}
            return tool, kwargs
    return None
