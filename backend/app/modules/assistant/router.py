"""Endpoint del asistente. Sprint 1: solo router determinista Python."""
from __future__ import annotations
import time
from typing import Annotated, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.assistant import tools, intent, templates

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
    data: Optional[dict] = None


@router.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, db: DB, current_user: CurrentUser) -> AskResponse:
    """Recibe pregunta, resuelve con router determinista, devuelve respuesta.

    Sprint 1 flow:
      1) intent.route(q) → (tool_name, kwargs) o None
      2) Si matcheó → ejecuta la tool → template → respuesta
      3) Si no matcheó → mensaje explicando que aún no lo entiende (en
         Sprint 2 aquí entra el LLM decidiendo qué tool llamar).
    """
    q = payload.question.strip()
    t0 = time.perf_counter()

    routed = intent.route(q)
    if not routed:
        return AskResponse(
            text=("Aún no puedo entender esa pregunta con precisión. "
                  "Prueba con: ventas del mes, top productos, cartera vencida, "
                  "stock crítico, caducidades, cadena Walmart, POS del día."),
            matched=False, used_llm=False,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    tool_name, kwargs = routed
    tool_fn = tools.TOOLS_REGISTRY.get(tool_name)
    if not tool_fn:
        return AskResponse(
            text=f"Tool '{tool_name}' no está disponible en esta versión.",
            matched=True, used_llm=False, tool=tool_name,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    try:
        result = await tool_fn(db, **kwargs)
    except Exception as e:
        return AskResponse(
            text=f"No pude ejecutar la consulta: {e}",
            matched=True, used_llm=False, tool=tool_name,
            ms=int((time.perf_counter() - t0) * 1000),
        )

    text = templates.format_response(result)
    return AskResponse(
        text=text,
        source=_source_label(tool_name),
        tool=tool_name,
        matched=True, used_llm=False,
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
