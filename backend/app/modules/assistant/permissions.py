"""Capa de permisos del asistente — cada tool declara a qué módulo RBAC
pertenece; antes de ejecutar se verifica que el usuario tenga acción
'view' sobre ese módulo (aprovechando la matriz existente en
app.modules.auth.rbac).

Filosofía:
  - Administrador / superusuario ve TODO (ya lo maneja user_can).
  - Rol Contador ve solo tools del cluster financiero-contable-nómina.
  - Rol Ventas ve solo tools de ventas/CRM/clientes.
  - Rol Almacén ve inventario + lectura de ventas.
  - Cualquier tool sin módulo declarado queda como 'dashboard' (público).

Cuando el usuario pregunta algo fuera de su ámbito, NO se ejecuta la
tool ni se llama al LLM: se devuelve una respuesta suave que indica
que el dato existe pero no está en su alcance. Esto es lo que hacen
ERPs de nivel mundial (SAP, Oracle, NetSuite) — el asistente respeta
los mismos permisos que el UI, sin filtraciones de datos por chat.
"""
from __future__ import annotations
from typing import Optional
from app.modules.auth.models import User
from app.modules.auth.rbac import user_can


# Cada tool → módulo canónico del RBAC. El módulo se toma de MODULE_KEYS
# en rbac.py: dashboard | sales | customers | inventory | finance |
# accounting | hr | reports | config.
TOOL_MODULE: dict[str, str] = {
    # Ventas / CRM
    "ventas_periodo": "sales",
    "top_productos": "sales",
    "top_clientes": "sales",
    "pedidos_pendientes": "sales",
    "concentracion_clientes": "sales",
    "ticket_promedio_ventas": "sales",
    "cotizaciones_abiertas": "sales",
    "clientes_inactivos": "sales",
    "devoluciones_periodo": "sales",

    # Finanzas / Tesorería
    "cxc_resumen": "finance",
    "cxp_resumen": "finance",
    "top_deudores": "finance",
    "top_acreedores": "finance",
    "saldo_bancos": "finance",
    "cxc_vencen_semana": "finance",
    "cxp_vencen_semana": "finance",
    "flujo_neto_30d": "finance",

    # Inventario / Almacén
    "stock_critico": "inventory",
    "caducidades_proximas": "inventory",
    "sin_movimiento": "inventory",
    "rotacion_producto": "inventory",
    "valor_inventario": "inventory",
    "merma_mes": "inventory",

    # Compras (usan modelos de inventory + finance; se ancla a inventory
    # porque quien maneja OC en la práctica es el rol Almacén/Compras)
    "oc_abiertas": "inventory",
    "oc_atrasadas": "inventory",
    "top_proveedores": "finance",

    # Contabilidad
    "utilidad_bruta": "accounting",
    "ingresos_vs_egresos": "accounting",
    "gastos_por_categoria": "accounting",
    "movimientos_no_conciliados": "accounting",

    # RH / Nómina
    "nomina_periodo": "hr",
    "empleados_activos": "hr",
    "incapacidades_mes": "hr",
    "contratos_por_vencer": "hr",
    "cumpleanos_mes": "hr",
    "isr_nomina_mes": "hr",

    # POS (se ancla a sales — el vendedor/cajero es quien lo consume;
    # el auditor de caja debería usar rol Contador que también ve sales).
    "ventas_pos_dia": "sales",
    "ventas_pos_hora": "sales",
    "corte_caja_actual": "sales",
    "formas_pago_pos": "sales",
    "top_cajeros_dia": "sales",

    # Retail
    "desempeno_cadena": "sales",
    "desempeno_tienda": "sales",
    "sell_through_por_tienda": "sales",

    # KPI ejecutivo — solo administrador (queda anclado a 'reports'
    # que por default solo Administrador/Contador ven en el seed RBAC).
    "flujo_efectivo_proyectado": "reports",
    "nomina_vs_ventas": "reports",

    # Fase 6 · Retail avanzado
    "tiendas_wos_critico": "sales",
    "tiendas_sobrestock": "sales",
    "fill_rate_cadena": "sales",
    "return_rate_cadena": "sales",
    # Fase 6 · Finanzas
    "aging_cxc": "finance",
    "dso_dpo": "finance",
    "pagos_programados": "finance",
    # Fase 6 · RH extra
    "aguinaldo_devengado": "hr",
    "vacaciones_pendientes": "hr",
    "imss_a_pagar": "hr",
    "ptu_estimado": "hr",
    # Fase 6 · Contabilidad
    "iva_mes": "accounting",
    # Fase 6 · Compras
    "lead_time_proveedor": "inventory",
    "reordenar_sin_oc": "inventory",
    "variacion_costo": "inventory",
    # Fase 6 · Inventario
    "top_valor_inmovilizado": "inventory",
    "faltantes_para_pedidos": "inventory",
    # Fase 6 · POS extra
    "descuentos_pos_dia": "sales",
    "devoluciones_pos_dia": "sales",
    "cancelaciones_pos_dia": "sales",
    "top_producto_pos_dia": "sales",
    # Fase 8
    "top_vendedores": "sales",
    "ventas_pos_periodo": "sales",
    "ventas_cliente": "sales",
}


def module_for_tool(tool_name: str) -> str:
    """Devuelve el módulo RBAC asociado a la tool. Fallback 'dashboard'
    (todos los roles con acceso al ERP pueden verlo)."""
    return TOOL_MODULE.get(tool_name, "dashboard")


def user_can_use_tool(user: User, tool_name: str) -> bool:
    """True si el usuario tiene 'view' sobre el módulo de esta tool.
    Superusuario y rol Administrador pasan siempre por diseño de user_can()."""
    module = module_for_tool(tool_name)
    return user_can(user, module, "view")


def permission_denied_message(tool_name: str) -> str:
    """Mensaje suave, no confidencial, para el usuario sin permiso. NO
    revela el nombre técnico de la tool ni cifras — solo dice que
    la consulta no está en su alcance."""
    module = module_for_tool(tool_name)
    friendly = {
        "sales": "ventas / CRM",
        "customers": "clientes",
        "inventory": "inventario",
        "finance": "finanzas y tesorería",
        "accounting": "contabilidad",
        "hr": "recursos humanos y nómina",
        "reports": "reportes ejecutivos",
        "config": "configuración",
        "dashboard": "tablero general",
    }.get(module, module)
    return (
        f"Esta consulta pertenece al área de **{friendly}** y tu rol "
        f"actual no la tiene habilitada. Pide al administrador que "
        f"amplíe tus permisos si necesitas verla."
    )


def allowed_tools_for(user: User) -> list[str]:
    """Lista de tools que el usuario puede invocar — útil para armar el
    catálogo dinámico que se le pasa al LLM (así no sugiere tools que
    igual se van a bloquear después)."""
    return [t for t in TOOL_MODULE.keys() if user_can_use_tool(user, t)]
