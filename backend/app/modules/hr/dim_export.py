"""DIM · Declaración Informativa Múltiple · Anexo 1 (Sueldos y Salarios).

Genera el archivo de texto para el programa DIM del SAT, anexo de
sueldos, salarios, conceptos asimilados y crédito al salario.

Layout pipe-delimited (una línea por trabajador). Encabezado en la
primera fila para revisión humana, el DIM lo ignora al importar.

Campos:
  1. RFC (13)
  2. CURP (18)
  3. Nombre (200 chars, ASCII mayúsculas)
  4. Total ingresos por salarios y asimilados
  5. Ingresos exentos (estimado)
  6. Ingresos gravables
  7. Subsidio al empleo entregado
  8. ISR retenido durante el año
  9. ISR causado anual sobre gravable
  10. Diferencia (+ a favor / − a cargo)

Solo se incluyen empleados con ingresos > 0 y sin bandera
`declares_own_annual` (art. 97-B).
"""
from __future__ import annotations

import unicodedata

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hr import annual_isr as _ai
from app.modules.hr import models


def _fmt_amount(n: float) -> str:
    return f"{max(float(n or 0), 0):.2f}"


def _ascii_upper(s: str) -> str:
    """El DIM legado rechaza acentos; normalizamos a ASCII UPPERCASE."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", (s or "").upper())
        if not unicodedata.combining(c)
    )


async def build_dim_anexo1(db: AsyncSession, year: int) -> str:
    """Genera el .txt del DIM Anexo 1 enriquecido con RFC/CURP de Employee."""
    data = await _ai.calculate_adjustment(db, year)
    emp_ids = [r["employee_id"] for r in data["rows"]]
    if not emp_ids:
        return _HEADER + "\r\n"

    q = select(models.Employee).where(models.Employee.id.in_(emp_ids))
    emps_by_id = {e.id: e for e in (await db.execute(q)).scalars().all()}

    lines = [_HEADER]
    for r in data["rows"]:
        if r.get("declares_own_annual"):
            continue
        total = float(r["total_ingresos"] or 0)
        if total <= 0:
            continue
        emp = emps_by_id.get(r["employee_id"])
        if not emp:
            continue
        gravable = float(r["total_gravable"] or 0)
        exento = round(max(total - gravable, 0), 2)
        retenido = float(r["total_isr_retenido"] or 0)
        causado = float(r["isr_causado_anual"] or 0)
        diferencia = round(retenido - causado, 2)
        nombre = _ascii_upper(r["employee_name"] or "")
        lines.append("|".join([
            (emp.rfc or "").upper()[:13].ljust(13),
            (emp.curp or "").upper()[:18].ljust(18),
            nombre[:200].ljust(200),
            _fmt_amount(total),
            _fmt_amount(exento),
            _fmt_amount(gravable),
            _fmt_amount(float(r["total_sae_pagado"] or 0)),
            _fmt_amount(retenido),
            _fmt_amount(causado),
            f"{diferencia:+.2f}",
        ]))
    return "\r\n".join(lines) + "\r\n"


_HEADER = "|".join([
    "RFC", "CURP", "NOMBRE",
    "INGRESOS_TOTALES", "INGRESOS_EXENTOS", "INGRESOS_GRAVABLES",
    "SUBSIDIO_PAGADO", "ISR_RETENIDO", "ISR_CAUSADO_ANUAL",
    "DIFERENCIA",
])
