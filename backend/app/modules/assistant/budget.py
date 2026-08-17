"""Presupuesto mensual del asistente. Tope duro $5 USD/mes.

Guardarraíles:
  - Tracking por llamada en tabla assistant_llm_usage.
  - Suma mensual en tiempo real vía SQL agregada.
  - Kill switch al llegar al tope: is_over_budget() = True → NO se llama al LLM.
  - Umbrales para la UI: verde <60%, amarillo 60-85%, rojo >85%.

Pricing Haiku (Nov 2026):
  - input: $1.00 por 1M tokens
  - output: $5.00 por 1M tokens
Cifras conservadoras — si Anthropic sube precios, ajustar aquí una vez.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


MONTHLY_LIMIT_USD = 5.00
HAIKU_INPUT_USD_PER_MTOK = 1.00
HAIKU_OUTPUT_USD_PER_MTOK = 5.00


def compute_cost(input_tokens: int, output_tokens: int, model: str = "haiku") -> float:
    """Costo en USD para una llamada. Solo Haiku por ahora."""
    it = max(0, int(input_tokens or 0))
    ot = max(0, int(output_tokens or 0))
    if "haiku" in model.lower():
        cost = (it * HAIKU_INPUT_USD_PER_MTOK + ot * HAIKU_OUTPUT_USD_PER_MTOK) / 1_000_000
    else:
        # Fallback conservador — nunca subestimar el costo
        cost = (it * 3.00 + ot * 15.00) / 1_000_000
    return round(cost, 6)


async def month_spend(db: AsyncSession) -> float:
    """Gasto acumulado del mes en curso (UTC)."""
    now = datetime.now(timezone.utc)
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    res = await db.execute(
        text("SELECT COALESCE(SUM(cost_usd), 0) FROM assistant_llm_usage WHERE created_at >= :s"),
        {"s": first},
    )
    return round(float(res.scalar() or 0.0), 4)


async def is_over_budget(db: AsyncSession) -> bool:
    return (await month_spend(db)) >= MONTHLY_LIMIT_USD


async def budget_status(db: AsyncSession) -> dict:
    """Estado actual para la UI. NO expone la cifra al usuario si no la pide."""
    spent = await month_spend(db)
    pct = min(1.0, spent / MONTHLY_LIMIT_USD) if MONTHLY_LIMIT_USD > 0 else 0.0
    level = "red" if pct >= 0.85 else "amber" if pct >= 0.60 else "green"
    return {
        "spent_usd": round(spent, 4),
        "limit_usd": MONTHLY_LIMIT_USD,
        "pct": round(pct, 4),
        "level": level,
        "over_budget": spent >= MONTHLY_LIMIT_USD,
    }


async def record_usage(
    db: AsyncSession, *,
    purpose: str,               # "route" | "narrate" | "insight"
    input_tokens: int,
    output_tokens: int,
    model: str = "claude-haiku-4-5",
    user_id: Optional[int] = None,
) -> float:
    """Registra una llamada al LLM y devuelve su costo. Commit inmediato
    para que el tracking sea contable incluso si el resto de la request
    falla después."""
    cost = compute_cost(input_tokens, output_tokens, model)
    await db.execute(
        text("""INSERT INTO assistant_llm_usage
                (user_id, purpose, model, input_tokens, output_tokens, cost_usd)
                VALUES (:u, :p, :m, :it, :ot, :c)"""),
        {"u": user_id, "p": purpose, "m": model,
         "it": input_tokens, "ot": output_tokens, "c": cost},
    )
    await db.commit()
    return cost
