"""Cliente LLM del asistente (Anthropic Claude Haiku).

Dos usos:
  1. Router: dado una pregunta libre + catálogo de tools, elige cuál llamar
     y con qué parámetros (function calling nativo de Anthropic).
  2. Narrar: dado un tool result + intención de pregunta, redacta 2-4
     oraciones de análisis. Los números vienen de Python — el LLM NO
     inventa cifras, solo las interpreta.

Guardarraíles:
  - Antes de cada llamada revisa budget.is_over_budget(). Si True → skip.
  - Registra input/output tokens en assistant_llm_usage vía budget.record_usage.
  - Solo Haiku (más barato). Nunca Sonnet.
  - Prompts cortos. Sin history de conversación en Sprint 2 (Sprint 3).
"""
from __future__ import annotations
import os
import json
from typing import Optional, List, Dict, Any
import httpx

from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.assistant import budget


ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5"
API_VERSION = "2023-06-01"


def _headers() -> Dict[str, str]:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    return {
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
    }


def _has_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


# ── Catálogo de tools que el LLM puede llamar (schema para function calling) ──
# Solo listamos los tools reales (implementados). Los stubs quedan fuera para
# que el LLM no los sugiera.
TOOLS_SCHEMA: List[Dict[str, Any]] = [
    {
        "name": "ventas_periodo",
        "description": "Total facturado, número de pedidos y ticket promedio en un periodo, con comparativa al periodo anterior.",
        "input_schema": {
            "type": "object",
            "properties": {
                "periodo": {"type": "string", "enum": ["hoy", "ayer", "semana", "mes", "mes_pasado", "año"], "default": "mes"},
            },
        },
    },
    {
        "name": "top_productos",
        "description": "Top N productos más vendidos en el periodo, ordenados por revenue, unidades o margen.",
        "input_schema": {
            "type": "object",
            "properties": {
                "periodo": {"type": "string", "enum": ["hoy", "ayer", "semana", "mes", "mes_pasado", "año"], "default": "mes"},
                "por": {"type": "string", "enum": ["revenue", "unidades", "margen"], "default": "revenue"},
                "limite": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            },
        },
    },
    {
        "name": "top_clientes",
        "description": "Top N clientes por revenue en el periodo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "periodo": {"type": "string", "enum": ["hoy", "semana", "mes", "mes_pasado", "año"], "default": "mes"},
                "limite": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            },
        },
    },
    {
        "name": "pedidos_pendientes",
        "description": "Pedidos abiertos o parcialmente pagados que aún requieren atención.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "cxc_resumen",
        "description": "Cuentas por cobrar: total y aging (al día, 1-30, 31-60, +60 días), con top deudores.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "cxp_resumen",
        "description": "Cuentas por pagar: total y aging por vencimiento, con top acreedores.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "saldo_bancos",
        "description": "Saldos actuales de las cuentas bancarias activas.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "stock_critico",
        "description": "Productos bajo el punto de reorden o agotados.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "caducidades_proximas",
        "description": "Lotes de productos perecederos que caducan en los próximos N días.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dias": {"type": "integer", "minimum": 1, "maximum": 365, "default": 30},
            },
        },
    },
    {
        "name": "desempeno_cadena",
        "description": "Desempeño (revenue, pedidos) de cadenas de retail en el periodo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "periodo": {"type": "string", "enum": ["semana", "mes", "mes_pasado", "año"], "default": "mes"},
                "limite": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
            },
        },
    },
    {
        "name": "ventas_pos_dia",
        "description": "Corte del día del POS: total, tickets, ticket promedio, diferencias de arqueo.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


SYSTEM_ROUTER = (
    "Eres el enrutador de un asistente de negocio para un ERP. Dada la "
    "pregunta del usuario, tu ÚNICA tarea es decidir qué herramienta llamar "
    "y con qué parámetros. NO respondas texto — solo elige una herramienta. "
    "Si la pregunta no encaja con ninguna herramienta disponible, no llames "
    "ninguna y responde brevemente que no puedes ayudar con eso."
)


async def route_with_llm(
    db: AsyncSession, question: str, user_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Pregunta libre → LLM decide qué tool llamar. Devuelve
    {tool_name, tool_input} o None si el LLM no encuentra match o si
    se pasó el presupuesto.
    """
    if not _has_key():
        return None
    if await budget.is_over_budget(db):
        return None
    payload = {
        "model": MODEL,
        "max_tokens": 400,
        "system": SYSTEM_ROUTER,
        "tools": TOOLS_SCHEMA,
        "tool_choice": {"type": "auto"},
        "messages": [{"role": "user", "content": question}],
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.post(ANTHROPIC_API_URL, json=payload, headers=_headers())
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"[assistant.llm.route] error: {e}")
        return None

    usage = data.get("usage", {}) or {}
    await budget.record_usage(
        db, purpose="route",
        input_tokens=int(usage.get("input_tokens", 0)),
        output_tokens=int(usage.get("output_tokens", 0)),
        model=MODEL, user_id=user_id,
    )

    for block in data.get("content", []):
        if block.get("type") == "tool_use":
            return {"tool_name": block.get("name"), "tool_input": block.get("input") or {}}
    return None


SYSTEM_NARRATE = (
    "Eres un analista de negocio senior. Recibirás una pregunta y los datos "
    "reales calculados por el sistema. Redacta una respuesta breve (máximo "
    "4 oraciones) usando SOLO los datos entregados — nunca inventes cifras. "
    "Sé directo, profesional y en español mexicano. Si hay un dato "
    "sobresaliente (ej. una caída fuerte o un concentración inusual), "
    "menciónalo. Al final, si aplica, sugiere una acción concreta en una "
    "oración corta."
)


async def narrate_with_llm(
    db: AsyncSession, question: str, tool_result: Dict[str, Any],
    user_id: Optional[int] = None,
) -> Optional[str]:
    """Dado el resultado de una tool + la pregunta original, genera una
    interpretación en lenguaje natural. Cost tracking automático."""
    if not _has_key():
        return None
    if await budget.is_over_budget(db):
        return None
    prompt = (
        f"Pregunta del usuario:\n{question}\n\n"
        f"Datos calculados por el sistema:\n{json.dumps(tool_result, ensure_ascii=False, default=str)}\n\n"
        "Redacta la respuesta ahora."
    )
    payload = {
        "model": MODEL,
        "max_tokens": 350,
        "system": SYSTEM_NARRATE,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.post(ANTHROPIC_API_URL, json=payload, headers=_headers())
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"[assistant.llm.narrate] error: {e}")
        return None

    usage = data.get("usage", {}) or {}
    await budget.record_usage(
        db, purpose="narrate",
        input_tokens=int(usage.get("input_tokens", 0)),
        output_tokens=int(usage.get("output_tokens", 0)),
        model=MODEL, user_id=user_id,
    )
    for block in data.get("content", []):
        if block.get("type") == "text":
            return (block.get("text") or "").strip()
    return None


# ── Detección local de intención de insight ────────────────────────────
# Cuando el usuario quiere una interpretación ("por qué…", "cómo va…",
# "sugerencia…"), el pipeline usa narrate_with_llm después de correr
# el/los tool(s). Esta función NO llama al LLM — solo dice si aplica.
import re
_INSIGHT_PATTERNS = re.compile(
    r"(por\s+qu[eé]|c[oó]mo\s+va|sugier|recomiend|qu[eé]\s+opinas|qu[eé]\s+piensas|analiza|explica|dime\s+algo\s+de|qu[eé]\s+recomiend|qu[eé]\s+deber[ií]a)",
    re.IGNORECASE,
)


def wants_narrative(question: str) -> bool:
    return bool(_INSIGHT_PATTERNS.search(question or ""))
