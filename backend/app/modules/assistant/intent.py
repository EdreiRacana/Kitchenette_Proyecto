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
