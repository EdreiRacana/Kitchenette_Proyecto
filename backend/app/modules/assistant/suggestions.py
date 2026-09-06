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
# La PRIMERA frase de cada tool es la que sale en el cold-start del
# asistente (una plantilla por tool permitida), así que debe ser
# genérica y aplicable a cualquier empresa — sin nombres propios de
# clientes, vendedores, cadenas ni sucursales específicas.
PROMPT_HINTS: dict[str, list[str]] = {
    # ── Ventas / CRM ─────────────────────────────────────────────────
    "ventas_periodo": [
        "ventas del mes", "cuánto vendí este mes", "cuánto facturé este mes",
        "cuánto llevo vendido", "total de ventas del mes",
        "ventas de hoy", "ventas de la semana", "ventas del año",
        "ventas de julio", "ventas del mes pasado",
        "cuánto se ha vendido", "facturación del mes",
    ],
    "top_productos": [
        "top productos del mes", "top 5 productos", "productos más vendidos",
        "cuáles son los mejores productos", "qué es lo que más vendo",
        "productos estrella", "productos que más rotan",
        "top SKUs del mes", "mejores productos del año",
    ],
    "top_clientes": [
        "top clientes del mes", "top 5 clientes", "mejores clientes",
        "quiénes compran más", "clientes más importantes",
        "principales clientes", "clientes que más me facturan",
        "top 10 clientes",
    ],
    "top_vendedores": [
        "top vendedores del mes", "mejor vendedor", "top 5 vendedores",
        "quién es el mejor vendedor", "vendedor que más vendió",
        "ranking de vendedores", "quién vendió más este mes",
        "ventas por vendedor",
    ],
    "pedidos_pendientes": [
        "pedidos pendientes", "órdenes abiertas",
        "cuáles pedidos me faltan por entregar",
        "pedidos por surtir", "órdenes sin entregar",
        "qué pedidos tengo pendientes", "pedidos en curso",
        "pedidos abiertos", "órdenes por completar",
    ],
    "cotizaciones_abiertas": [
        "cotizaciones abiertas", "cuántas cotizaciones tengo",
        "pipeline de cotizaciones", "quotes vigentes",
        "cotizaciones vigentes", "cotizaciones sin cerrar",
        "propuestas abiertas", "cotizaciones activas",
    ],
    "clientes_inactivos": [
        "clientes inactivos", "quiénes dejaron de comprar",
        "clientes perdidos", "clientes que ya no compran",
        "clientes sin actividad", "clientes que se fueron",
        "quién no ha comprado",
    ],
    "ticket_promedio_ventas": [
        "ticket promedio", "cuánto es el ticket promedio de ventas",
        "ticket promedio del mes", "cuánto compra en promedio un cliente",
        "venta promedio",
    ],
    "devoluciones_periodo": [
        "devoluciones del mes", "cuántas devoluciones tengo",
        "cuánto me devolvieron este mes", "monto de devoluciones",
        "devoluciones del año", "clientes que devolvieron",
    ],
    "concentracion_clientes": [
        "concentración de clientes", "pareto de clientes",
        "80/20 de mis clientes", "riesgo de concentración",
        "qué clientes concentran mis ventas",
        "dependencia de clientes",
    ],
    "ventas_persona": [
        "ventas de un cliente", "cómo va un cliente",
        "cuánto ha comprado un cliente", "estado de cuenta de un cliente",
        "cuánto le he vendido a", "historial de un cliente",
        "ventas de un vendedor", "cómo va un vendedor",
    ],
    # ── Fase 16 · Ventas ─────────────────────────────────────────────
    "pedidos_sin_timbrar": [
        "pedidos sin timbrar", "cuántas facturas me faltan",
        "cfdi pendientes", "resumen de timbrado",
        "pedidos sin facturar", "facturación pendiente",
        "cuántas facturas debo emitir", "órdenes por facturar",
    ],
    "ventas_por_canal": [
        "ventas por canal", "cuánto vendo en whatsapp",
        "distribución por canal", "qué canal vende más",
        "ventas mostrador vs web", "cuánto se vende por marketplace",
        "canal más productivo", "ventas por medio",
    ],
    "comisiones_agentes": [
        "comisiones del mes", "cuánto le debo a agentes",
        "top comisiones", "ranking de comisiones",
        "comisiones a pagar", "comisiones por vendedor",
        "cuánto pagué de comisiones", "comisiones acumuladas",
    ],
    "tasa_conversion_cotizaciones": [
        "tasa de conversión", "cuántas cotizaciones cerré",
        "% de cierre", "conversión de quotes",
        "efectividad de cotizaciones", "qué % de cotizaciones cierro",
    ],
    "cotizaciones_vencidas": [
        "cotizaciones vencidas", "quotes caducadas",
        "cotizaciones que expiraron", "cotizaciones caducas",
        "cuántas cotizaciones se me vencieron",
    ],
    "clientes_nuevos_mes": [
        "clientes nuevos", "cuántos clientes nuevos tengo",
        "primeras compras del mes", "clientes nuevos del mes",
        "cuántos clientes gané", "adquisición de clientes",
    ],
    "ventas_por_sucursal": [
        "ventas por sucursal", "qué sucursal vende más",
        "ventas por almacén", "ranking de sucursales",
        "cuál sucursal factura más", "comparativo de sucursales",
    ],
    "devoluciones_por_razon": [
        "por qué me devuelven", "razones de devolución",
        "top razones de devolución", "causas de devolución",
        "motivos de devolución más comunes",
    ],
    "metodos_pago_ventas": [
        "cómo me pagan", "efectivo vs tarjeta general",
        "métodos de pago del mes", "formas de pago totales",
        "distribución de formas de pago",
        "en qué forma me pagan", "métodos de cobro",
    ],
    "margen_por_producto": [
        "productos con más margen", "productos con más ganancia",
        "top margen", "qué me deja más dinero",
        "margen por producto", "SKUs más rentables",
        "productos más rentables",
    ],
    "pedidos_con_saldo_parcial": [
        "pedidos con abono parcial", "quiénes deben aún",
        "pagos incompletos", "cobranza fácil",
        "clientes con abonos parciales", "quién me debe todavía",
        "pedidos con saldo pendiente",
    ],
    "pipeline_valor": [
        "valor del pipeline", "potencial de ventas",
        "cuánto potencial tengo", "pipeline vigente",
        "cuánto vale mi pipeline", "oportunidades vigentes",
    ],
    # ── Finanzas ─────────────────────────────────────────────────────
    "cxc_resumen": [
        "cartera vencida", "cuentas por cobrar",
        "cuánto me deben", "aging de cxc",
        "saldo de cuentas por cobrar", "saldo por cobrar",
        "estado de la cartera", "cobranza pendiente",
        "cuánto tengo por cobrar", "cxc del mes",
    ],
    "cxp_resumen": [
        "cuentas por pagar", "cuánto le debo a proveedores",
        "saldo de cuentas por pagar", "saldo por pagar",
        "cuánto debo pagar", "cxp del mes",
        "pasivo con proveedores", "deuda con proveedores",
    ],
    "top_deudores": [
        "top deudores", "quién me debe más",
        "clientes que más me deben", "clientes morosos",
        "principales deudores", "cartera por cliente",
    ],
    "top_acreedores": [
        "top acreedores", "a quién le debo más",
        "principales acreedores", "proveedores a los que más debo",
        "top proveedores por deuda",
    ],
    "saldo_bancos": [
        "saldo en bancos", "cuánto tengo en el banco",
        "cuentas bancarias", "saldo de las cuentas",
        "efectivo en bancos", "disponibilidad bancaria",
        "cuánto hay en el banco",
    ],
    "cxc_vencen_semana": [
        "cobros de esta semana", "qué cxc vence esta semana",
        "cobranza de la semana", "vencimientos por cobrar",
        "clientes a cobrar esta semana",
    ],
    "cxp_vencen_semana": [
        "pagos de esta semana", "qué le debo pagar esta semana",
        "vencimientos por pagar", "proveedores a pagar esta semana",
        "pagos pendientes de la semana",
    ],
    "flujo_neto_30d": [
        "flujo de efectivo 30 días", "cash flow proyectado",
        "flujo neto del mes", "proyección de flujo",
        "cuánto me va a entrar vs salir",
        "flujo de caja próximo mes",
    ],
    "aging_cxc": [
        "aging de cartera", "antigüedad de saldos",
        "cartera por antigüedad", "aging de cuentas por cobrar",
        "análisis de antigüedad",
    ],
    "dso_dpo": [
        "días de cobro", "DSO", "DPO", "días de pago",
        "días promedio de cobro", "días promedio de pago",
        "cuánto tardo en cobrar", "cuánto tardo en pagar",
    ],
    "pagos_programados": [
        "pagos programados", "calendario de pagos",
        "próximos pagos", "agenda de pagos",
        "pagos por hacer",
    ],
    # ── Inventario ───────────────────────────────────────────────────
    "stock_critico": [
        "stock crítico", "qué productos están agotados",
        "productos por reordenar", "productos por agotarse",
        "qué se me está acabando", "productos con stock bajo",
        "inventario crítico", "qué necesito comprar",
        "SKUs agotados", "productos sin existencia",
    ],
    "caducidades_proximas": [
        "caducidades próximas", "qué productos van a caducar",
        "perecederos por caducar", "productos por vencer",
        "cuándo caducan mis productos", "lotes por vencer",
        "productos que caducan pronto",
    ],
    "sin_movimiento": [
        "productos sin movimiento", "qué no se está vendiendo",
        "productos con poca rotación", "productos parados",
        "productos sin ventas", "SKUs sin rotación",
        "inventario muerto", "qué no se mueve",
    ],
    "rotacion_producto": [
        "rotación de productos", "weeks of supply",
        "WoS por producto", "qué tan rápido rotan mis productos",
        "velocidad de rotación", "cuántas semanas de stock tengo",
    ],
    "valor_inventario": [
        "cuánto vale el inventario", "valor del almacén",
        "valor del inventario a costo", "cuánto tengo en inventario",
        "capital en inventario", "valor total del stock",
    ],
    "merma_mes": [
        "merma del mes", "cuánta merma tuve",
        "pérdidas de inventario", "merma acumulada",
        "cuánto perdí por merma",
    ],
    "top_valor_inmovilizado": [
        "productos con más valor parado", "top inmovilizado",
        "SKUs con más inversión parada", "capital inmovilizado por producto",
        "dónde tengo más dinero parado",
    ],
    "faltantes_para_pedidos": [
        "faltantes para pedidos", "qué me falta para surtir",
        "productos faltantes", "cuánto me falta comprar",
        "backorders", "demanda no cubierta",
    ],
    # ── Compras ──────────────────────────────────────────────────────
    "oc_abiertas": [
        "órdenes de compra abiertas", "OC pendientes",
        "OC abiertas", "compras en curso",
        "órdenes de compra en proceso",
    ],
    "oc_atrasadas": [
        "OC atrasadas", "órdenes de compra retrasadas",
        "OC vencidas", "compras que no han llegado",
        "proveedores retrasados", "órdenes de compra tardías",
    ],
    "top_proveedores": [
        "top proveedores", "proveedores con más gasto",
        "principales proveedores", "a qué proveedores les compro más",
        "ranking de proveedores", "top 5 proveedores",
    ],
    "lead_time_proveedor": [
        "lead time de proveedores", "tiempo de entrega proveedores",
        "cuánto tarda cada proveedor", "días de entrega por proveedor",
        "tiempo promedio de entrega",
    ],
    "reordenar_sin_oc": [
        "productos por reordenar sin OC", "qué necesita OC",
        "qué tengo que ordenar", "compras urgentes",
        "SKUs bajo punto de reorden sin OC",
    ],
    "variacion_costo": [
        "variación de costos", "qué costos subieron",
        "productos que se encarecieron", "cambios de costo",
        "SKUs con cambio de precio de compra",
    ],
    # ── Contabilidad ─────────────────────────────────────────────────
    "utilidad_bruta": [
        "utilidad bruta del mes", "margen bruto",
        "cuál es mi margen", "margen del mes",
        "cuánto es la utilidad", "ganancia bruta",
        "cuál es mi ganancia", "margen bruto %",
    ],
    "ingresos_vs_egresos": [
        "ingresos vs egresos", "P&L del mes",
        "estado de resultados", "cuánto entró y cuánto salió",
        "resultado del mes", "utilidad del mes",
        "P&L express",
    ],
    "gastos_por_categoria": [
        "gastos por categoría", "en qué gasto más",
        "top gastos del mes", "dónde se me va el dinero",
        "principales gastos", "categorías de gasto",
    ],
    "movimientos_no_conciliados": [
        "movimientos sin conciliar", "qué falta por conciliar",
        "bancos sin conciliar", "movimientos pendientes de conciliación",
        "extracto sin conciliar",
    ],
    "iva_mes": [
        "IVA del mes", "cuánto IVA debo pagar",
        "IVA a pagar", "IVA trasladado vs acreditable",
        "cuánto es el IVA", "IVA por pagar",
    ],
    # ── RH / Nómina ──────────────────────────────────────────────────
    "nomina_periodo": [
        "nómina del mes", "cuánto pagué de nómina",
        "nómina de julio", "cuánto pagaré de nómina",
        "total de nómina", "nómina de la quincena",
        "costo de nómina del mes",
    ],
    "empleados_activos": [
        "empleados activos", "plantilla", "cuántos empleados tengo",
        "cuántos trabajadores tengo", "número de empleados",
        "personal activo", "tamaño de la plantilla",
    ],
    "incapacidades_mes": [
        "incapacidades del mes", "cuántas incapacidades tengo",
        "empleados incapacitados", "ausencias por incapacidad",
        "incapacidades activas",
    ],
    "contratos_por_vencer": [
        "contratos por vencer", "qué contratos vencen pronto",
        "contratos próximos a vencer", "renovaciones de contrato",
        "empleados con contrato por terminar",
    ],
    "cumpleanos_mes": [
        "cumpleaños del mes", "quién cumple años este mes",
        "empleados que cumplen años", "cumpleañeros",
    ],
    "isr_nomina_mes": [
        "ISR de nómina", "ISR retenido del mes",
        "cuánto retuve de ISR", "ISR a enterar",
        "retenciones de ISR",
    ],
    "imss_a_pagar": [
        "IMSS del mes", "cuánto pago de IMSS",
        "cuota IMSS a pagar", "cuánto pagaré de IMSS este mes",
        "cuota obrero patronal", "IMSS a pagar",
        "cédula IMSS del mes", "cuánto se paga de IMSS",
        "aportaciones IMSS del mes",
    ],
    "aguinaldo_devengado": [
        "aguinaldo devengado", "cuánto llevo de aguinaldo",
        "aguinaldo acumulado", "provisión de aguinaldo",
        "cuánto voy a pagar de aguinaldo",
    ],
    "vacaciones_pendientes": [
        "vacaciones pendientes", "días de vacaciones no gozadas",
        "vacaciones acumuladas", "quién tiene vacaciones pendientes",
        "días de vacaciones por tomar",
    ],
    "ptu_estimado": [
        "PTU estimado", "reparto de utilidades",
        "cuánto es la PTU", "utilidades por repartir",
        "PTU del año",
    ],
    # ── POS ──────────────────────────────────────────────────────────
    "ventas_pos_dia": [
        "ventas del POS hoy", "corte POS del día",
        "cuánto se vendió en el POS hoy", "ventas de caja hoy",
        "cuánto llevo en el POS",
    ],
    "ventas_pos_periodo": [
        "ventas POS del mes", "ventas POS de julio",
        "ventas del POS este mes", "cuánto vendió el POS del mes",
        "totales del POS",
    ],
    "ventas_pos_hora": [
        "ventas por hora POS", "cuál fue la hora pico del POS",
        "distribución por hora del POS", "a qué hora se vende más",
        "horarios pico del POS",
    ],
    "corte_caja_actual": [
        "corte de caja actual", "sesiones POS abiertas",
        "cajas abiertas", "quién tiene caja abierta",
        "turnos POS activos",
    ],
    "formas_pago_pos": [
        "formas de pago del día", "efectivo vs tarjeta POS",
        "cómo me pagaron hoy en el POS", "distribución de cobros POS",
        "métodos de pago del POS",
    ],
    "top_cajeros_dia": [
        "top cajeros del día", "cajero que más vendió hoy",
        "mejores cajeros del día", "ranking de cajeros",
    ],
    "descuentos_pos_dia": [
        "descuentos aplicados hoy en POS", "cuánto se descontó hoy",
        "total de descuentos del día", "descuentos POS",
    ],
    "devoluciones_pos_dia": [
        "devoluciones POS del día", "reembolsos de hoy",
        "cuánto se devolvió hoy en el POS",
    ],
    "cancelaciones_pos_dia": [
        "cancelaciones del día", "órdenes canceladas hoy",
        "cuántas cancelaciones tuve", "tickets cancelados hoy",
    ],
    "top_producto_pos_dia": [
        "producto más vendido en POS hoy", "top producto del día",
        "SKU estrella del día",
    ],
    # ── Retail ───────────────────────────────────────────────────────
    "desempeno_cadena": [
        "desempeño de cadenas", "top cadenas del mes",
        "cómo van mis cadenas", "cadena que más vende",
        "ranking de cadenas", "ventas por cadena",
    ],
    "desempeno_tienda": [
        "desempeño por tienda", "top tiendas",
        "mejores tiendas del mes", "cuál tienda vende más",
        "ranking de tiendas", "tiendas top",
    ],
    "sell_through_por_tienda": [
        "sell-through por tienda", "sell out por tienda",
        "rotación por tienda", "% de venta por tienda",
    ],
    "tiendas_wos_critico": [
        "tiendas con WoS crítico", "tiendas que necesitan reabasto",
        "tiendas por resurtir", "tiendas con poco stock",
        "tiendas en rojo",
    ],
    "tiendas_sobrestock": [
        "tiendas con sobre-stock", "tiendas con exceso de inventario",
        "tiendas sobradas", "dónde tengo demasiado stock",
        "tiendas para trasladar",
    ],
    "fill_rate_cadena": [
        "fill rate por cadena", "nivel de servicio",
        "nivel de servicio por cadena", "fill rate del mes",
    ],
    "return_rate_cadena": [
        "tasa de devoluciones por cadena", "return rate",
        "% de devoluciones por cadena", "cadenas con más devolución",
    ],
    # ── KPI ejecutivo (solo administrador) ──────────────────────────
    "flujo_efectivo_proyectado": [
        "flujo de efectivo proyectado", "proyección de caja 30 días",
        "cuánto voy a tener en caja", "flujo esperado",
        "liquidez proyectada",
    ],
    "nomina_vs_ventas": [
        "nómina vs ventas", "porcentaje de costo laboral",
        "cuánto pesa la nómina sobre ventas", "% de nómina sobre ventas",
        "costo laboral %",
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
