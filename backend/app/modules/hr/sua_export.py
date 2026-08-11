"""SUA · Sistema Único de Autodeterminación IMSS.

Genera archivos batch para importar en el programa SUA de escritorio:

  MOVTOS.txt  → movimientos afiliatorios (alta / baja / modif salario)
                Formato ancho-fijo compatible con la utilería de importación
                de movimientos del SUA (versión 3.6.6+).

Layout de MOVIMIENTOS (ancho fijo, 1 registro por movimiento):

  Pos  Long  Campo
  1    11    Registro patronal IMSS (AAA-NN-CCCCC-D)
  12   11    NSS del trabajador (11 dígitos)
  23   50    Nombre del trabajador (apellido paterno, materno, nombres)
  73   18    CURP
  91   13    RFC (con homoclave)
  104  1     Tipo de movimiento: 08 Alta / 02 Baja / 07 Modif salario
             (usamos códigos SUA reales)
  106  8     Fecha del movimiento (YYYYMMDD)
  114  8     Salario diario integrado (SDI) — dos decimales sin punto,
             ancho 8 con ceros a la izquierda (ejemplo: $ 245.34 = 00024534)
  122  2     Motivo de baja (para tipo 02) o "00"
  124  ...   Filler

Notas de compatibilidad SUA:
  - El archivo debe estar en codificación **CP-850** (Latín-1 ext. DOS).
    Aquí generamos ASCII estricto para máxima portabilidad.
  - Line ending CR+LF.
  - Sin encabezado (SUA no lo tolera).
"""
from __future__ import annotations

import unicodedata
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.hr import models


SUA_TYPE = {
    "alta": "08",
    "baja": "02",
    "modif_salario": "07",
}


def _ascii_upper(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", (s or "").upper())
        if not unicodedata.combining(c)
    )


def _sdi_fmt(sdi: float) -> str:
    """Salario diario integrado — 8 chars, 2 decimales, ceros a la izquierda."""
    cents = int(round(max(float(sdi or 0), 0) * 100))
    return f"{min(cents, 99999999):08d}"


async def build_sua_movimientos(
    db: AsyncSession,
    registro_patronal: str,
    movement_ids: Optional[List[int]] = None,
    year: Optional[int] = None,
) -> str:
    """Genera el .txt de movimientos SUA.

    - Si `movement_ids` viene, solo esos movimientos.
    - Si `year` viene, todos los movimientos de ese año.
    - Sin filtros: todos los movimientos registrados.
    """
    q = (
        select(models.IMSSMovement, models.Employee)
        .join(models.Employee, models.IMSSMovement.employee_id == models.Employee.id)
        .order_by(models.IMSSMovement.movement_date)
    )
    if movement_ids:
        q = q.where(models.IMSSMovement.id.in_(movement_ids))
    if year:
        q = q.where(
            models.IMSSMovement.movement_date >= f"{year:04d}-01-01",
            models.IMSSMovement.movement_date <= f"{year:04d}-12-31",
        )
    rows = (await db.execute(q)).all()

    rp = (registro_patronal or "").upper()[:11].ljust(11)
    lines = []
    for m, emp in rows:
        sua_type = SUA_TYPE.get(m.movement_type)
        if not sua_type:
            continue

        # NSS 11 dígitos (rellena con ceros a la izquierda si viene corto)
        nss = "".join(ch for ch in (emp.nss or "") if ch.isdigit())[:11].rjust(11, "0")
        # Nombre en formato SUA: APELLIDO_PATERNO APELLIDO_MATERNO NOMBRES.
        # Nuestro modelo trae last_name como un solo string, así lo dejamos.
        nombre = _ascii_upper(f"{emp.last_name} {emp.name}")[:50].ljust(50)
        curp = (emp.curp or "").upper()[:18].ljust(18)
        rfc = (emp.rfc or "").upper()[:13].ljust(13)

        fecha = (m.movement_date or "").replace("-", "")[:8].rjust(8, "0")

        # SDI para el movimiento
        if m.movement_type == "alta":
            sdi = m.sbc_at_movement or emp.sbc or 0.0
        elif m.movement_type == "modif_salario":
            sdi = m.new_sbc or emp.sbc or 0.0
        else:  # baja
            sdi = emp.sbc or 0.0
        sdi_fmt = _sdi_fmt(sdi)

        motivo = "00"
        if m.movement_type == "baja" and m.baja_reason_code:
            code = "".join(ch for ch in (m.baja_reason_code or "") if ch.isdigit())
            motivo = code[:2].rjust(2, "0")

        line = rp + nss + nombre + curp + rfc + sua_type + fecha + sdi_fmt + motivo
        lines.append(line)

    return "\r\n".join(lines) + ("\r\n" if lines else "")
