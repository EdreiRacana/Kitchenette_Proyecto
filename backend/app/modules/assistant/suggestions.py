"""Sugerencias de preguntas para el asistente (autocompletado / typeahead).

Cada tool declara una lista de "prompts ejemplo" — frases naturales
que un usuario diría para invocar esa consulta. El endpoint
GET /assistant/suggest hace fuzzy match sobre esas frases y devuelve
las top N que más se parezcan a lo que el usuario está escribiendo,
filtrando por permisos RBAC.

Motor: substring + Levenshtein normalizado. Cero AI, sub-50ms típico.
El objetivo es que el usuario descubra qué puede preguntar mientras
escribe, sin memorizar sintaxis del asistente.
"""
from __future__ import annotations
from typing import List, Optional
import re
import unicodedata

from app.modules.auth.models import User
from app.modules.assistant.permissions import allowed_tools_for


# Prompts por tool — frases naturales que la gente diría.
# Al agregar tools nuevas, agrega aquí 2-4 variantes por cada una.
PROMPT_HINTS: dict[str, list[str]] = {
    # ── Ventas / CRM ─────────────────────────────────────────────────
    "ventas_periodo": [
        "cuánto vendí este mes", "cuánto facturé este mes",
        "ventas del mes", "ventas de hoy", "ventas de la semana",
        "ventas de julio",
    ],
    "top_productos": [
        "top 5 productos", "productos más vendidos",
        "cuáles son los mejores productos", "top productos del mes",
    ],
    "top_clientes": [
        "top 5 clientes", "mejores clientes", "quiénes compran más",
        "clientes más importantes",
    ],
    "top_vendedores": [
        "mejor vendedor", "top 5 vendedores",
        "quién es el mejor vendedor", "vendedor que más vendió",
    ],
    "pedidos_pendientes": [
        "pedidos pendientes", "órdenes abiertas",
        "cuáles pedidos me faltan por entregar",
    ],
    "cotizaciones_abiertas": [
        "cotizaciones abiertas", "cuántas cotizaciones tengo",
        "pipeline de cotizaciones",
    ],
    "clientes_inactivos": [
        "clientes inactivos", "quiénes dejaron de comprar",
        "clientes perdidos",
    ],
    "ticket_promedio_ventas": [
        "ticket promedio", "cuánto es el ticket promedio de ventas",
    ],
    "devoluciones_periodo": [
        "devoluciones del mes", "cuántas devoluciones tengo",
    ],
    "concentracion_clientes": [
        "concentración de clientes", "pareto de clientes",
        "80/20 de mis clientes",
    ],
    "ventas_persona": [
        "ventas de Francisco", "cómo va Manuel",
        "cuánto ha comprado Argelia", "estado de cliente Elías",
    ],
    # ── Fase 16 · Ventas — 12 tools nuevas ─────────────────────────
    "pedidos_sin_timbrar": [
        "pedidos sin timbrar", "cuántas facturas me faltan",
        "cfdi pendientes", "resumen de timbrado",
        "pedidos sin facturar",
    ],
    "ventas_por_canal": [
        "ventas por canal", "cuánto vendo en whatsapp",
        "distribución por canal", "qué canal vende más",
        "ventas mostrador vs web",
    ],
    "comisiones_agentes": [
        "comisiones del mes", "cuánto le debo a agentes",
        "top comisiones", "ranking de comisiones",
        "comisiones a pagar",
    ],
    "tasa_conversion_cotizaciones": [
        "tasa de conversión", "cuántas cotizaciones cerré",
        "% de cierre", "conversión de quotes",
    ],
    "cotizaciones_vencidas": [
        "cotizaciones vencidas", "quotes caducadas",
        "cotizaciones que expiraron",
    ],
    "clientes_nuevos_mes": [
        "clientes nuevos", "cuántos clientes nuevos tengo",
        "primeras compras del mes",
    ],
    "ventas_por_sucursal": [
        "ventas por sucursal", "qué sucursal vende más",
        "ventas por almacén",
    ],
    "devoluciones_por_razon": [
        "por qué me devuelven", "razones de devolución",
        "top razones de devolución",
    ],
    "metodos_pago_ventas": [
        "cómo me pagan", "efectivo vs tarjeta general",
        "métodos de pago del mes", "formas de pago totales",
    ],
    "margen_por_producto": [
        "productos con más ganancia", "top margen",
        "qué me deja más dinero", "margen por producto",
    ],
    "pedidos_con_saldo_parcial": [
        "pedidos con abono parcial", "quiénes deben aún",
        "pagos incompletos", "cobranza fácil",
    ],
    "pipeline_valor": [
        "valor del pipeline", "potencial de ventas",
        "cuánto potencial tengo", "pipeline vigente",
    ],
    # ── Finanzas ─────────────────────────────────────────────────────
    "cxc_resumen": [
        "cartera vencida", "cuentas por cobrar",
        "cuánto me deben", "aging de cxc",
    ],
    "cxp_resumen": [
        "cuentas por pagar", "cuánto le debo a proveedores",
    ],
    "top_deudores": [
        "top deudores", "quién me debe más",
        "clientes que más me deben",
    ],
    "top_acreedores": [
        "top acreedores", "a quién le debo más",
    ],
    "saldo_bancos": [
        "saldo en bancos", "cuánto tengo en el banco",
        "cuentas bancarias",
    ],
    "cxc_vencen_semana": [
        "cobros de esta semana", "qué cxc vence esta semana",
    ],
    "cxp_vencen_semana": [
        "pagos de esta semana", "qué le debo pagar esta semana",
    ],
    "flujo_neto_30d": [
        "flujo de efectivo 30 días", "cash flow proyectado",
        "flujo neto del mes",
    ],
    "aging_cxc": [
        "aging de cartera", "antigüedad de saldos",
    ],
    "dso_dpo": [
        "días de cobro", "DSO", "DPO", "días de pago",
    ],
    "pagos_programados": [
        "pagos programados", "calendario de pagos",
    ],
    # ── Inventario ───────────────────────────────────────────────────
    "stock_critico": [
        "stock crítico", "qué productos están agotados",
        "productos por reordenar",
    ],
    "caducidades_proximas": [
        "caducidades próximas", "qué productos van a caducar",
        "perecederos por caducar",
    ],
    "sin_movimiento": [
        "productos sin movimiento", "qué no se está vendiendo",
    ],
    "rotacion_producto": [
        "rotación de productos", "weeks of supply",
    ],
    "valor_inventario": [
        "cuánto vale el inventario", "valor del almacén",
    ],
    "merma_mes": [
        "merma del mes", "cuánta merma tuve",
    ],
    "top_valor_inmovilizado": [
        "productos con más valor parado", "top inmovilizado",
    ],
    "faltantes_para_pedidos": [
        "faltantes para pedidos", "qué me falta para surtir",
    ],
    # ── Compras ──────────────────────────────────────────────────────
    "oc_abiertas": [
        "órdenes de compra abiertas", "OC pendientes",
    ],
    "oc_atrasadas": [
        "OC atrasadas", "órdenes de compra retrasadas",
    ],
    "top_proveedores": [
        "top proveedores", "proveedores con más gasto",
    ],
    "lead_time_proveedor": [
        "lead time de proveedores", "tiempo de entrega proveedores",
    ],
    "reordenar_sin_oc": [
        "productos por reordenar sin OC", "qué necesita OC",
    ],
    "variacion_costo": [
        "variación de costos", "qué costos subieron",
    ],
    # ── Contabilidad ─────────────────────────────────────────────────
    "utilidad_bruta": [
        "utilidad bruta del mes", "margen bruto",
        "cuál es mi margen",
    ],
    "ingresos_vs_egresos": [
        "ingresos vs egresos", "P&L del mes",
        "estado de resultados",
    ],
    "gastos_por_categoria": [
        "gastos por categoría", "en qué gasto más",
    ],
    "movimientos_no_conciliados": [
        "movimientos sin conciliar", "qué falta por conciliar",
    ],
    "iva_mes": [
        "IVA del mes", "cuánto IVA debo pagar",
    ],
    # ── RH / Nómina ──────────────────────────────────────────────────
    "nomina_periodo": [
        "cuánto pagué de nómina", "nómina del mes",
        "nómina de julio",
    ],
    "empleados_activos": [
        "empleados activos", "plantilla", "cuántos empleados tengo",
    ],
    "incapacidades_mes": [
        "incapacidades del mes",
    ],
    "contratos_por_vencer": [
        "contratos por vencer", "qué contratos vencen pronto",
    ],
    "cumpleanos_mes": [
        "cumpleaños del mes",
    ],
    "isr_nomina_mes": [
        "ISR de nómina", "ISR retenido del mes",
    ],
    "imss_a_pagar": [
        "cuánto pago de IMSS", "IMSS del mes",
        "cuota IMSS a pagar",
    ],
    "aguinaldo_devengado": [
        "aguinaldo devengado", "cuánto llevo de aguinaldo",
    ],
    "vacaciones_pendientes": [
        "vacaciones pendientes", "días de vacaciones no gozadas",
    ],
    "ptu_estimado": [
        "PTU estimado", "reparto de utilidades",
    ],
    # ── POS ──────────────────────────────────────────────────────────
    "ventas_pos_dia": [
        "ventas del POS hoy", "corte POS del día",
    ],
    "ventas_pos_periodo": [
        "ventas POS de julio", "ventas POS del mes",
    ],
    "ventas_pos_hora": [
        "ventas por hora POS", "cuál fue la hora pico del POS",
    ],
    "corte_caja_actual": [
        "corte de caja actual", "sesiones POS abiertas",
    ],
    "formas_pago_pos": [
        "formas de pago del día", "efectivo vs tarjeta POS",
    ],
    "top_cajeros_dia": [
        "top cajeros del día",
    ],
    "descuentos_pos_dia": [
        "descuentos aplicados hoy en POS",
    ],
    "devoluciones_pos_dia": [
        "devoluciones POS del día",
    ],
    "cancelaciones_pos_dia": [
        "cancelaciones del día",
    ],
    "top_producto_pos_dia": [
        "producto más vendido en POS hoy",
    ],
    # ── Retail ───────────────────────────────────────────────────────
    "desempeno_cadena": [
        "cómo va Walmart", "desempeño de cadenas",
        "top cadenas del mes",
    ],
    "desempeno_tienda": [
        "mejor tienda de walmart", "top tiendas",
        "desempeño por tienda",
    ],
    "sell_through_por_tienda": [
        "sell-through por tienda", "sell out por tienda",
    ],
    "tiendas_wos_critico": [
        "tiendas con WoS crítico", "tiendas que necesitan reabasto",
    ],
    "tiendas_sobrestock": [
        "tiendas con sobre-stock", "tiendas con exceso de inventario",
    ],
    "fill_rate_cadena": [
        "fill rate por cadena", "nivel de servicio",
    ],
    "return_rate_cadena": [
        "tasa de devoluciones por cadena", "return rate",
    ],
    # ── KPI ejecutivo (solo administrador) ──────────────────────────
    "flujo_efectivo_proyectado": [
        "flujo de efectivo proyectado", "proyección de caja 30 días",
    ],
    "nomina_vs_ventas": [
        "nómina vs ventas", "porcentaje de costo laboral",
    ],
}


def _normalize(s: str) -> str:
    """Baja a minúsculas, quita acentos y signos. Sirve para que
    'imss' matchee 'IMSS' y 'nomina' matchee 'nómina'."""
    if not s:
        return ""
    s = s.lower().strip()
    # Quitar acentos
    s = "".join(
        c for c in unicodedata.normalize("NFKD", s)
        if not unicodedata.combining(c)
    )
    # Colapsar signos de puntuación a espacio
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _score(query: str, hint: str) -> float:
    """Puntaje 0..1. Prefiere prefix, después substring, después
    coincidencia de palabras. Cero deps externas, cero LLM."""
    q = _normalize(query)
    h = _normalize(hint)
    if not q or not h:
        return 0.0
    # Match exacto → 1.0
    if q == h:
        return 1.0
    # Prefijo → alto
    if h.startswith(q):
        return 0.90 + 0.10 * (len(q) / max(len(h), 1))
    # Substring → medio-alto
    if q in h:
        return 0.75 + 0.10 * (len(q) / max(len(h), 1))
    # Coincidencia por palabras — cuenta cuántas palabras de q están en h
    q_words = q.split()
    h_words = set(h.split())
    hits = sum(1 for w in q_words if w in h_words)
    if hits == 0:
        # Prefix por palabra: alguna palabra de h empieza con q completa
        if any(w.startswith(q) for w in h_words):
            return 0.55
        return 0.0
    return 0.30 + 0.50 * (hits / len(q_words))


async def suggest_entities(db, query: str, user: User, limit: int = 8) -> List[dict]:
    """Busca entidades reales (tiendas retail, clientes, empleados) cuyo
    nombre matchee el query. Devuelve items {tool, prompt, score, type, sublabel}
    listos para inyectarse en el typeahead del asistente.

    Idea: si el usuario escribe "satelite" y hay una tienda "Plaza Satelite",
    debe aparecer sin importar que "satelite" no esté en PROMPT_HINTS.
    """
    from sqlalchemy import select, or_, func
    q = (query or "").strip()
    if len(q) < 2:
        return []
    like = f"%{q}%"
    results: list[dict] = []
    allowed = set(allowed_tools_for(user))

    # ── Tiendas retail (RetailStore.name) ────────────────────────────
    if "desempeno_tienda" in allowed or "sell_through_por_tienda" in allowed:
        try:
            from app.modules.retail import models as rm
            stmt = (
                select(rm.RetailStore.name, rm.RetailChannel.name.label("cadena"))
                .join(rm.RetailChannel, rm.RetailChannel.id == rm.RetailStore.channel_id)
                .where(rm.RetailStore.is_active == True, rm.RetailStore.name.ilike(like))  # noqa: E712
                .limit(limit)
            )
            for r in (await db.execute(stmt)).all():
                results.append({
                    "tool": "desempeno_tienda",
                    "prompt": f"cómo va {r.name}",
                    "score": 0.98, "type": "store",
                    "sublabel": f"Tienda · {r.cadena}",
                })
        except Exception:
            pass

    # ── Clientes (Customer.name / razon_social) ──────────────────────
    if "ventas_persona" in allowed or "top_clientes" in allowed:
        try:
            from app.modules.sales.models import Customer
            stmt = (
                select(Customer.name)
                .where(or_(Customer.name.ilike(like), Customer.razon_social.ilike(like)))
                .limit(limit)
            )
            for r in (await db.execute(stmt)).all():
                results.append({
                    "tool": "ventas_persona",
                    "prompt": f"ventas de {r.name}",
                    "score": 0.97, "type": "customer",
                    "sublabel": "Cliente",
                })
        except Exception:
            pass

    # ── Empleados (Employee.name + last_name) ────────────────────────
    if "nomina_periodo" in allowed or "empleados_activos" in allowed:
        try:
            from app.modules.hr import models as hm
            full = func.concat(hm.Employee.name, " ", hm.Employee.last_name)
            stmt = (
                select(hm.Employee.name, hm.Employee.last_name)
                .where(or_(hm.Employee.name.ilike(like),
                           hm.Employee.last_name.ilike(like),
                           full.ilike(like)))
                .limit(limit)
            )
            for r in (await db.execute(stmt)).all():
                fullname = f"{r.name} {r.last_name or ''}".strip()
                results.append({
                    "tool": "nomina_periodo",
                    "prompt": f"nómina de {fullname}",
                    "score": 0.96, "type": "employee",
                    "sublabel": "Empleado",
                })
        except Exception:
            pass

    # ── Módulos por nombre (navegación conceptual) ───────────────────
    # Los prompts estáticos ya cubren la mayoría de módulos, pero
    # agregamos sinónimos comunes que no están en PROMPT_HINTS.
    module_synonyms: dict[str, tuple[str, str]] = {
        "forecast": ("ventas_periodo", "cómo va el forecast del mes"),
        "pronostico": ("ventas_periodo", "cómo va el forecast del mes"),
        "pronóstico": ("ventas_periodo", "cómo va el forecast del mes"),
        "bi": ("ventas_periodo", "ventas del mes"),
        "kpi": ("ventas_periodo", "ventas del mes"),
        "dashboard": ("ventas_periodo", "ventas del mes"),
        "tablero": ("ventas_periodo", "ventas del mes"),
    }
    nq = _normalize(q)
    for key, (tool, prompt) in module_synonyms.items():
        if tool in allowed and (nq in _normalize(key) or _normalize(key).startswith(nq)):
            results.append({
                "tool": tool, "prompt": prompt, "score": 0.85,
                "type": "module", "sublabel": "Módulo",
            })

    # Dedup por (tool + prompt), quedarnos con el score máximo
    seen: dict[tuple, dict] = {}
    for r in results:
        k = (r["tool"], r["prompt"])
        if k not in seen or r["score"] > seen[k]["score"]:
            seen[k] = r
    return list(seen.values())


def suggest(query: str, user: User, limit: int = 6) -> List[dict]:
    """Devuelve top N sugerencias filtradas por RBAC del usuario.
    Cada entrada: {tool, prompt, score}. Ordenado por score desc.

    Si `query` está vacío o es muy corto (<2 chars), devuelve una
    selección diversa de las tools permitidas (una plantilla por tool,
    hasta `limit`) para que el usuario tenga sugerencias iniciales.
    """
    allowed = set(allowed_tools_for(user))
    q = (query or "").strip()
    results: list[dict] = []

    if len(q) < 2:
        # Cold start: una plantilla por tool permitida, en orden estable.
        for tool, prompts in PROMPT_HINTS.items():
            if tool not in allowed or not prompts:
                continue
            results.append({"tool": tool, "prompt": prompts[0], "score": 1.0})
            if len(results) >= limit:
                break
        return results

    for tool, prompts in PROMPT_HINTS.items():
        if tool not in allowed:
            continue
        best = 0.0
        best_prompt = None
        for p in prompts:
            s = _score(q, p)
            if s > best:
                best = s
                best_prompt = p
        if best > 0.30 and best_prompt:
            results.append({"tool": tool, "prompt": best_prompt, "score": round(best, 3)})

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]


async def log_unmatched(db, question: str, user_id: Optional[int],
                         matched_by: str = "none", tool_hit: Optional[str] = None) -> None:
    """Loguea una pregunta que no matcheó el router determinista, o
    que solo pudo resolverse via LLM. Se revisa periódicamente para
    convertir en patrones nuevos. Nunca falla la request si el insert
    falla — es best-effort."""
    from sqlalchemy import text
    try:
        await db.execute(
            text("""INSERT INTO assistant_unmatched_queries
                     (user_id, question, matched_by, tool_hit)
                     VALUES (:u, :q, :m, :t)"""),
            {"u": user_id, "q": (question or "")[:500],
             "m": matched_by, "t": tool_hit},
        )
        await db.commit()
    except Exception as e:
        # Logueamos a stdout pero no rompemos la request del usuario.
        print(f"[assistant.log_unmatched] failed: {e}")
