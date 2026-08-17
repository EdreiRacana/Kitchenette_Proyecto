"""Endpoint del asistente. Sprint 2: router determinista + fallback LLM."""
from __future__ import annotations
import time
from typing import Annotated, Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.assistant import tools, intent, templates, budget, llm, permissions, export

router = APIRouter()
DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class AskResponse(BaseModel):
    text: str
    source: Optional[str] = None
    tool: Optional[str] = None
    ms: int
    matched: bool
    used_llm: bool = False
    llm_purpose: Optional[str] = None  # "route" | "narrate" | None
    data: Optional[dict] = None


class BudgetResponse(BaseModel):
    spent_usd: float
    limit_usd: float
    pct: float
    level: str            # "green" | "amber" | "red"
    over_budget: bool


class ExportRequest(BaseModel):
    tool_name: str
    data: Dict[str, Any]
    question: Optional[str] = None


@router.get("/budget", response_model=BudgetResponse)
async def get_budget(db: DB, current_user: CurrentUser):
    """Estado actual del presupuesto mensual de LLM.
    La UI la usa para colorear la barra sin exponer cifras al usuario."""
    return await budget.budget_status(db)


@router.post("/export-xlsx")
async def export_xlsx(payload: ExportRequest, current_user: CurrentUser):
    """Convierte la respuesta de una tool a XLSX descargable.

    Guardarraíl RBAC: si la tool no está en el ámbito del rol del usuario,
    se rechaza — no se puede exportar lo que no se puede consultar.
    """
    if not permissions.user_can_use_tool(current_user, payload.tool_name):
        raise HTTPException(status_code=403, detail="No autorizado para exportar esta consulta.")
    if not export.is_exportable(payload.data):
        raise HTTPException(status_code=400, detail="Esta respuesta no tiene datos exportables.")
    try:
        blob = export.build_xlsx(payload.tool_name, payload.data, question=payload.question)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No pude generar el Excel: {e}")
    filename = export.safe_filename(payload.tool_name)
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, db: DB, current_user: CurrentUser) -> AskResponse:
    """Pipeline:

      1) intent.route(q) → si matchea patrón conocido, ejecuta tool + template.
         Cero LLM. 60-70% del tráfico cae aquí.
      2) Si NO matchea → llm.route_with_llm decide qué tool llamar.
         Ejecuta tool + template. 1 llamada Haiku (~$0.0005).
      3) Si la pregunta es interpretativa ("por qué / sugiere / analiza")
         → después de ejecutar la tool, llm.narrate_with_llm redacta
         interpretación en vez de usar el template. +1 llamada (~$0.001).
      4) Budget guard: si mes >= $5, se salta el LLM y responde con
         template o mensaje de "presupuesto agotado".
    """
    q = payload.question.strip()
    t0 = time.perf_counter()
    user_id = getattr(current_user, "id", None)

    # Capa 1: router determinista
    routed = intent.route(q)
    used_llm = False
    llm_purpose: Optional[str] = None

    # Capa 2: si router local no matcheó, escalar a LLM (si hay presupuesto).
    # Se le pasa SOLO el catálogo de tools que el usuario puede ejecutar —
    # de lo más eficiente: el LLM ni siquiera sugiere algo que se le va a
    # bloquear después.
    if not routed:
        allowed = set(permissions.allowed_tools_for(current_user))
        llm_choice = await llm.route_with_llm(
            db, q, user_id=user_id, allowed_tools=allowed,
        )
        if llm_choice:
            routed = (llm_choice["tool_name"], llm_choice.get("tool_input") or {})
            used_llm = True
            llm_purpose = "route"

    if not routed:
        # No entendimos, o LLM tampoco encontró tool aplicable, o presupuesto agotado
        over = await budget.is_over_budget(db)
        base = ("Aún no puedo entender esa pregunta con precisión. "
                "Prueba con: ventas del mes, top productos, cartera vencida, "
                "stock crítico, caducidades, cadena Walmart, POS del día.")
        if over:
            base = ("Se agotó el presupuesto mensual del asistente. "
                    "Aún puedo responder preguntas frecuentes (ventas del mes, "
                    "cxc, top productos, stock crítico...) con el motor "
                    "determinista sin costo.")
        return AskResponse(
            text=base, matched=False, used_llm=used_llm, llm_purpose=llm_purpose,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    tool_name, kwargs = routed

    # Inyección declarativa de permisos a tools sensibles: ventas_persona
    # devuelve datos HR (salario, SBC, banco, deducciones) SOLO si el
    # usuario tiene 'hr.view'. Cualquier otro rol ve solo la info
    # organizacional básica. Esta gate es adicional al RBAC de acceso
    # a la tool — aquí controlamos el DETALLE dentro de la respuesta.
    from app.modules.auth.rbac import user_can
    if tool_name == "ventas_persona" and user_can(current_user, "hr", "view"):
        kwargs = {**kwargs, "include_hr_details": True}

    # Guardarraíl RBAC: si el router local (regex) matcheó una tool que el
    # usuario no puede consumir, devolvemos mensaje suave. Sin ejecutar
    # queries, sin llamar al LLM: cero fugas de datos por chat.
    if not permissions.user_can_use_tool(current_user, tool_name):
        return AskResponse(
            text=permissions.permission_denied_message(tool_name),
            matched=True, used_llm=used_llm, llm_purpose=llm_purpose,
            tool=tool_name,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    tool_fn = tools.TOOLS_REGISTRY.get(tool_name)
    if not tool_fn:
        return AskResponse(
            text=f"Tool '{tool_name}' no está disponible en esta versión.",
            matched=True, used_llm=used_llm, llm_purpose=llm_purpose, tool=tool_name,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    try:
        result = await tool_fn(db, **kwargs)
    except Exception as e:
        return AskResponse(
            text=f"No pude ejecutar la consulta: {e}",
            matched=True, used_llm=used_llm, llm_purpose=llm_purpose, tool=tool_name,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    # Capa 3: ¿el usuario pide interpretación? → narrar con LLM.
    # Solo si el tool devolvió datos reales, no si viene vacío o es stub.
    narrative: Optional[str] = None
    if llm.wants_narrative(q) and not result.get("empty"):
        narrative = await llm.narrate_with_llm(db, q, result, user_id=user_id)
        if narrative:
            used_llm = True
            llm_purpose = "narrate" if llm_purpose != "route" else "route+narrate"

    text = narrative if narrative else templates.format_response(result)

    return AskResponse(
        text=text,
        source=_source_label(tool_name),
        tool=tool_name,
        matched=True, used_llm=used_llm, llm_purpose=llm_purpose,
        data=result,
        ms=int((time.perf_counter() - t0) * 1000),
    )


_SOURCE_MAP = {
    "ventas_periodo": "Ventas", "top_productos": "Ventas",
    "top_clientes": "Ventas", "pedidos_pendientes": "Ventas",
    "cxc_resumen": "Finanzas", "cxp_resumen": "Finanzas",
    "top_deudores": "Finanzas", "top_acreedores": "Finanzas",
    "saldo_bancos": "Finanzas",
    "stock_critico": "Inventario", "caducidades_proximas": "Inventario",
    "sin_movimiento": "Inventario", "rotacion_producto": "Inventario",
    "desempeno_cadena": "Retail", "desempeno_tienda": "Retail",
    "sell_through_por_tienda": "Retail",
    "ventas_pos_dia": "POS", "ventas_pos_hora": "POS",
    "utilidad_bruta": "Contabilidad",
    "concentracion_clientes": "Ventas",
}

def _source_label(tool_name: str) -> str:
    return _SOURCE_MAP.get(tool_name, "Sistema")
