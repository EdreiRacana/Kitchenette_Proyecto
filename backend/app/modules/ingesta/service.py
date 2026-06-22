"""
Motor de Ingesta Universal — service layer.

Responsabilidades:
  1. CRUD de fuentes, columnas y reglas.
  2. Detección automática de columnas via Claude API (Nivel 2).
  3. Normalización de estructura anidada (Nivel 3 — ej: Mercado Libre).
  4. Procesamiento de lotes: leer Excel/CSV, aplicar mapeos, guardar registros.
  5. Consulta de registros normalizados para BI y ventas.

Dependencias externas:
  - anthropic (pip install anthropic)
  - openpyxl  (pip install openpyxl)
  - pandas    (pip install pandas)
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.ingesta import models, schemas

# ─────────────────────────────────────────────────────────────
# CAMPOS INTERNOS STHENOVA — descripción para la IA
# ─────────────────────────────────────────────────────────────

CAMPOS_DESCRIPCION = {
    "upc":                   "Código de barras universal (UPC/EAN/GTIN)",
    "sku_cliente":           "Código interno del proveedor/cliente",
    "sku_cadena":            "Código interno de la cadena o marketplace",
    "descripcion":           "Nombre o descripción del producto",
    "fecha_inicio":          "Fecha de inicio del periodo reportado",
    "fecha_fin":             "Fecha de fin del periodo reportado",
    "fecha_venta":           "Fecha específica de la venta o transacción",
    "cantidad_vendida":      "Unidades vendidas (piezas, cajas, etc.)",
    "precio_unitario":       "Precio por unidad del producto",
    "venta_bruta":           "Importe total de ventas antes de deducciones",
    "venta_neta":            "Importe de ventas después de deducciones",
    "devoluciones_unidades": "Unidades devueltas por clientes",
    "devoluciones_importe":  "Importe monetario de devoluciones",
    "sra":                   "Shrink, Returns & Allowances (merma, devoluciones, descuentos)",
    "bonificaciones":        "Bonificaciones o allowances otorgados a la cadena",
    "descuentos":            "Descuentos aplicados sobre la venta",
    "cogs":                  "Costo de mercancía vendida (COGS)",
    "comisiones":            "Comisiones pagadas (ej: comisión marketplace)",
    "envio":                 "Costos de envío o logística",
    "marketing":             "Gastos de marketing o trade spend",
    "inv_inicial":           "Inventario inicial del periodo en tienda/bodega",
    "inv_final":             "Inventario final del periodo en tienda/bodega",
    "entradas_resurtido":    "Unidades recibidas como resurtido",
    "id_pedido":             "Identificador del pedido (agrupa múltiples líneas)",
    "es_fila_total":         "Indicador de que esta fila es el total/resumen del pedido",
    "costo_envio_pedido":    "Costo de envío a nivel de pedido completo",
    "skip":                  "Ignorar esta columna, no mapear a ningún campo",
}


# ─────────────────────────────────────────────────────────────
# 1. CRUD FUENTES
# ─────────────────────────────────────────────────────────────

async def get_fuentes(db: AsyncSession) -> List[models.IngestaFuente]:
    result = await db.execute(
        select(models.IngestaFuente)
        .options(selectinload(models.IngestaFuente.columnas))
        .order_by(models.IngestaFuente.nombre)
    )
    return result.scalars().all()


async def get_fuente(db: AsyncSession, fuente_id: int) -> Optional[models.IngestaFuente]:
    result = await db.execute(
        select(models.IngestaFuente)
        .options(
            selectinload(models.IngestaFuente.columnas),
            selectinload(models.IngestaFuente.reglas),
        )
        .where(models.IngestaFuente.id == fuente_id)
    )
    return result.scalar_one_or_none()


async def create_fuente(
    db: AsyncSession,
    data: schemas.IngestaFuenteCreate,
) -> models.IngestaFuente:
    fuente = models.IngestaFuente(
        nombre=data.nombre,
        tipo_cliente=data.tipo_cliente,
        tipo_ingesta=data.tipo_ingesta,
        moneda=data.moneda,
        periodicidad=data.periodicidad,
        activa=data.activa,
        notas=data.notas,
        separador_decimal=data.separador_decimal,
        formato_fecha=data.formato_fecha,
        simbolo_moneda=data.simbolo_moneda,
        fila_encabezado=data.fila_encabezado,
        tiene_filas_anidadas=data.tiene_filas_anidadas,
        campo_id_pedido=data.campo_id_pedido,
        patron_fila_total=data.patron_fila_total,
    )
    db.add(fuente)
    await db.flush()

    for col in data.columnas:
        db.add(models.IngestaColumna(fuente_id=fuente.id, **col.model_dump()))

    if data.reglas:
        db.add(models.IngestaRegla(fuente_id=fuente.id, **data.reglas.model_dump()))
    else:
        db.add(models.IngestaRegla(fuente_id=fuente.id))

    await db.commit()
    await db.refresh(fuente)
    return fuente


async def update_fuente(
    db: AsyncSession,
    fuente_id: int,
    data: schemas.IngestaFuenteUpdate,
) -> Optional[models.IngestaFuente]:
    fuente = await get_fuente(db, fuente_id)
    if not fuente:
        return None

    campos_simples = [
        "nombre", "tipo_cliente", "tipo_ingesta", "moneda", "periodicidad",
        "activa", "notas", "separador_decimal", "formato_fecha",
        "simbolo_moneda", "fila_encabezado", "tiene_filas_anidadas",
        "campo_id_pedido", "patron_fila_total",
    ]
    for campo in campos_simples:
        valor = getattr(data, campo, None)
        if valor is not None:
            setattr(fuente, campo, valor)

    if data.columnas is not None:
        for col in fuente.columnas:
            await db.delete(col)
        await db.flush()
        for col in data.columnas:
            db.add(models.IngestaColumna(fuente_id=fuente.id, **col.model_dump()))

    if data.reglas is not None and fuente.reglas:
        for campo, valor in data.reglas.model_dump().items():
            setattr(fuente.reglas, campo, valor)

    await db.commit()
    await db.refresh(fuente)
    return fuente


async def delete_fuente(db: AsyncSession, fuente_id: int) -> bool:
    fuente = await get_fuente(db, fuente_id)
    if not fuente:
        return False
    await db.delete(fuente)
    await db.commit()
    return True


# ─────────────────────────────────────────────────────────────
# 2. DETECCIÓN AUTOMÁTICA CON CLAUDE API (Nivel 2 + 3)
# ─────────────────────────────────────────────────────────────

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5"


def _build_detection_prompt(
    encabezados: List[str],
    muestra_filas: List[Dict[str, Any]],
    fuente_nombre: Optional[str],
    tipo_cliente: Optional[str],
) -> str:
    # Truncar valores de muestra a 30 chars y usar solo 2 filas para reducir tokens
    muestra_corta = [
        {k: (str(v)[:30] if v is not None else None) for k, v in row.items()}
        for row in muestra_filas[:2]
    ]
    muestra_json = json.dumps(muestra_corta, ensure_ascii=False, indent=2)

    hint = ""
    if fuente_nombre:
        hint += f"La fuente se llama: {fuente_nombre}. "
    if tipo_cliente:
        hint += f"Tipo de cliente: {tipo_cliente}."

    # Para archivos con muchas columnas, omitir "razon" para reducir tokens
    omitir_razon = len(encabezados) > 30

    if omitir_razon:
        formato_columna = '{"columna_origen":"...","campo_sthenova_sugerido":"...","muestra":"...","confianza":0.9}'
    else:
        formato_columna = '{"columna_origen":"...","campo_sthenova_sugerido":"...","muestra":"...","confianza":0.9,"razon":"..."}'

    return f"""Eres un experto en datos de ventas retail y CPG.

Mapea cada columna del archivo al campo interno de STHENOVA. {hint}

COLUMNAS ({len(encabezados)} total):
{json.dumps(encabezados, ensure_ascii=False)}

MUESTRA (2 filas):
{muestra_json}

CAMPOS STHENOVA válidos (usa exactamente estos nombres o "skip"):
{json.dumps(list(CAMPOS_DESCRIPCION.keys()), ensure_ascii=False)}

REGLAS:
- Devuelve una entrada por cada columna del archivo, en el mismo orden.
- Si no corresponde a ningún campo útil → "skip".
- Detecta estructura anidada (varias filas por pedido).
- Solo JSON puro, sin markdown ni texto extra.

RESPUESTA:
{{"columnas":[{formato_columna},...],
"tiene_filas_anidadas":false,
"campo_id_pedido_sugerido":null,
"patron_fila_total_sugerido":null,
"confianza_global":0.85,
"notas":null}}"""


async def detectar_columnas_ia(
    request: schemas.DeteccionRequest,
) -> schemas.DeteccionResponse:
    """
    Llama a Claude API para detectar y mapear columnas automáticamente.
    Modo 1 (IA automática): el usuario solo confirma.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY no configurada en variables de entorno.")

    prompt = _build_detection_prompt(
        encabezados=request.encabezados,
        muestra_filas=request.muestra_filas,
        fuente_nombre=request.fuente_nombre,
        tipo_cliente=request.tipo_cliente,
    )

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 6000,
        "messages": [{"role": "user", "content": prompt}],
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
        resp.raise_for_status()

    data = resp.json()
    raw_text = data["content"][0]["text"].strip()
    tokens_usados = data.get("usage", {}).get("input_tokens", 0) + data.get("usage", {}).get("output_tokens", 0)

    # Limpiar posibles backticks si la IA los incluyó
    raw_text = re.sub(r"^```json\s*", "", raw_text)
    raw_text = re.sub(r"\s*```$", "", raw_text)

    parsed = json.loads(raw_text)

    columnas = [
        schemas.ColumnaDetectada(
            columna_origen=c["columna_origen"],
            campo_sthenova_sugerido=c.get("campo_sthenova_sugerido", "skip"),
            muestra=c.get("muestra"),
            confianza=float(c.get("confianza", 0.5)),
            razon=c.get("razon"),
        )
        for c in parsed.get("columnas", [])
    ]

    return schemas.DeteccionResponse(
        columnas=columnas,
        tiene_filas_anidadas=parsed.get("tiene_filas_anidadas", False),
        campo_id_pedido_sugerido=parsed.get("campo_id_pedido_sugerido"),
        patron_fila_total_sugerido=parsed.get("patron_fila_total_sugerido"),
        confianza_global=float(parsed.get("confianza_global", 0.0)),
        notas=parsed.get("notas"),
        tokens_usados=tokens_usados,
    )


# ─────────────────────────────────────────────────────────────
# 3. PROCESAMIENTO DE LOTES (Excel / CSV)
# ─────────────────────────────────────────────────────────────

def _limpiar_numero(valor: Any, separador_decimal: str = "punto") -> Optional[float]:
    """Convierte strings con formato monetario a float."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    s = str(valor).strip()
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s:
        return None
    if separador_decimal == "coma":
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _limpiar_fecha(valor: Any, formato: str = "DD/MM/YYYY") -> Optional[str]:
    """Normaliza fechas a YYYY-MM-DD."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.strftime("%Y-%m-%d")
    s = str(valor).strip()
    formatos_intento = [
        ("%d/%m/%Y", "DD/MM/YYYY"),
        ("%m/%d/%Y", "MM/DD/YYYY"),
        ("%Y-%m-%d", "YYYY-MM-DD"),
        ("%d-%m-%Y", "DD-MM-YYYY"),
        ("%Y/%m/%d", "YYYY/MM/DD"),
    ]
    for fmt, _ in formatos_intento:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s


def _es_fila_total(fila: Dict[str, Any], patron: Optional[str]) -> bool:
    """Detecta si una fila es la fila de total/resumen de un pedido."""
    if not patron:
        return False
    patron_lower = patron.lower()
    for v in fila.values():
        if str(v).strip().lower() == patron_lower:
            return True
    return False


def _normalizar_fila(
    fila: Dict[str, Any],
    mapeo: Dict[str, str],
    fuente: models.IngestaFuente,
) -> Dict[str, Any]:
    """
    Aplica el mapeo columna→campo a una fila cruda.
    Retorna un dict con los campos internos de STHENOVA.
    """
    sep = fuente.separador_decimal
    fmt = fuente.formato_fecha

    resultado: Dict[str, Any] = {}

    for col_origen, campo_sthenova in mapeo.items():
        if campo_sthenova == "skip" or campo_sthenova not in CAMPOS_DESCRIPCION:
            continue
        valor = fila.get(col_origen)

        # Campos numéricos
        if campo_sthenova in (
            "cantidad_vendida", "precio_unitario", "venta_bruta", "venta_neta",
            "devoluciones_unidades", "devoluciones_importe", "sra",
            "bonificaciones", "descuentos", "cogs", "comisiones", "envio",
            "marketing", "inv_inicial", "inv_final", "entradas_resurtido",
            "costo_envio_pedido",
        ):
            resultado[campo_sthenova] = _limpiar_numero(valor, sep) or 0.0

        # Campos de fecha
        elif campo_sthenova in ("fecha_inicio", "fecha_fin", "fecha_venta"):
            resultado[campo_sthenova] = _limpiar_fecha(valor, fmt)

        # Campos de texto
        else:
            resultado[campo_sthenova] = str(valor).strip() if valor is not None else None

    return resultado


def _agrupar_filas_anidadas(
    filas: List[Dict[str, Any]],
    campo_id_pedido: str,
    patron_fila_total: Optional[str],
    mapeo: Dict[str, str],
    fuente: models.IngestaFuente,
) -> List[Dict[str, Any]]:
    """
    Agrupa filas de un pedido con múltiples líneas (ej: Mercado Libre).
    Toma los datos de las líneas de detalle e ignora/valida la fila de total.
    Retorna una lista de registros normalizados, uno por SKU por pedido.
    """
    grupos: Dict[str, List[Dict[str, Any]]] = {}
    totales: Dict[str, Dict[str, Any]] = {}

    for fila in filas:
        id_pedido = str(fila.get(campo_id_pedido, "")).strip()
        if not id_pedido:
            continue

        if _es_fila_total(fila, patron_fila_total):
            totales[id_pedido] = fila
        else:
            if id_pedido not in grupos:
                grupos[id_pedido] = []
            grupos[id_pedido].append(fila)

    registros: List[Dict[str, Any]] = []
    for id_pedido, lineas in grupos.items():
        total_fila = totales.get(id_pedido, {})
        for linea in lineas:
            reg = _normalizar_fila(linea, mapeo, fuente)
            reg["id_pedido_origen"] = id_pedido
            # Tomar costo de envío del total si existe
            if patron_fila_total and total_fila:
                envio_total = _limpiar_numero(
                    total_fila.get(
                        next((k for k, v in mapeo.items() if v == "costo_envio_pedido"), None)
                    ),
                    fuente.separador_decimal,
                )
                if envio_total:
                    reg["envio"] = round(envio_total / len(lineas), 4)
            registros.append(reg)

    return registros


async def procesar_lote(
    db: AsyncSession,
    fuente_id: int,
    filas_crudas: List[Dict[str, Any]],
    nombre_archivo: Optional[str] = None,
    tipo: str = "excel",
    periodo_inicio: Optional[str] = None,
    periodo_fin: Optional[str] = None,
) -> schemas.ProcesamientoResponse:
    """
    Procesa un lote de filas crudas (ya leídas del Excel/CSV por el router).
    Aplica mapeos, normaliza y guarda registros en la BD.
    """
    fuente = await get_fuente(db, fuente_id)
    if not fuente:
        raise ValueError(f"Fuente {fuente_id} no encontrada.")

    # Construir dict de mapeo {col_origen: campo_sthenova}
    mapeo: Dict[str, str] = {
        c.columna_origen: c.campo_sthenova
        for c in fuente.columnas
        if c.campo_sthenova != "skip"
    }

    # Crear lote
    lote = models.IngestaLote(
        fuente_id=fuente_id,
        nombre_archivo=nombre_archivo,
        tipo=tipo,
        estado="procesando",
        total_filas=len(filas_crudas),
        periodo_inicio=periodo_inicio,
        periodo_fin=periodo_fin,
    )
    db.add(lote)
    await db.flush()

    # Normalizar filas
    if fuente.tiene_filas_anidadas and fuente.campo_id_pedido:
        registros_normalizados = _agrupar_filas_anidadas(
            filas=filas_crudas,
            campo_id_pedido=fuente.campo_id_pedido,
            patron_fila_total=fuente.patron_fila_total,
            mapeo=mapeo,
            fuente=fuente,
        )
    else:
        registros_normalizados = [
            _normalizar_fila(fila, mapeo, fuente)
            for fila in filas_crudas
        ]

    filas_ok = 0
    filas_error = 0
    guardados: List[models.IngestaRegistro] = []

    for reg_dict in registros_normalizados:
        try:
            registro = models.IngestaRegistro(
                lote_id=lote.id,
                fuente_id=fuente_id,
                moneda=fuente.moneda,
                datos_crudos=None,
                **{k: v for k, v in reg_dict.items() if hasattr(models.IngestaRegistro, k)},
            )
            db.add(registro)
            guardados.append(registro)
            filas_ok += 1
        except Exception as e:
            filas_error += 1
            print(f"[ingesta] error en fila: {e}")

    lote.filas_ok = filas_ok
    lote.filas_error = filas_error
    lote.estado = "ok" if filas_error == 0 else "error"

    await db.commit()
    await db.refresh(lote)

    muestra = guardados[:5]
    for r in muestra:
        await db.refresh(r)

    return schemas.ProcesamientoResponse(
        lote_id=lote.id,
        fuente_id=fuente_id,
        estado=lote.estado,
        total_filas=lote.total_filas,
        filas_ok=filas_ok,
        filas_error=filas_error,
        registros_muestra=[schemas.IngestaRegistro.model_validate(r) for r in muestra],
    )


# ─────────────────────────────────────────────────────────────
# 4. CONSULTA DE REGISTROS NORMALIZADOS
# ─────────────────────────────────────────────────────────────

async def get_registros(
    db: AsyncSession,
    fuente_id: Optional[int] = None,
    lote_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
) -> Tuple[List[models.IngestaRegistro], int]:
    q = select(models.IngestaRegistro)
    if fuente_id:
        q = q.where(models.IngestaRegistro.fuente_id == fuente_id)
    if lote_id:
        q = q.where(models.IngestaRegistro.lote_id == lote_id)

    total_result = await db.execute(
        select(func.count()).select_from(q.subquery())
    )
    total = total_result.scalar() or 0

    result = await db.execute(q.offset(skip).limit(limit))
    return result.scalars().all(), total


async def get_resumen(db: AsyncSession) -> schemas.ResumenIngesta:
    fuentes_total = (await db.execute(select(func.count(models.IngestaFuente.id)))).scalar() or 0
    fuentes_activas = (await db.execute(
        select(func.count(models.IngestaFuente.id)).where(models.IngestaFuente.activa == True)
    )).scalar() or 0
    lotes_total = (await db.execute(select(func.count(models.IngestaLote.id)))).scalar() or 0
    registros_total = (await db.execute(select(func.count(models.IngestaRegistro.id)))).scalar() or 0

    ultimo_lote = (await db.execute(
        select(models.IngestaLote).order_by(models.IngestaLote.created_at.desc()).limit(1)
    )).scalar_one_or_none()

    registros_ultimo = 0
    if ultimo_lote:
        registros_ultimo = (await db.execute(
            select(func.count(models.IngestaRegistro.id)).where(
                models.IngestaRegistro.lote_id == ultimo_lote.id
            )
        )).scalar() or 0

    return schemas.ResumenIngesta(
        total_fuentes=fuentes_total,
        fuentes_activas=fuentes_activas,
        total_lotes=lotes_total,
        ultimo_lote_fecha=ultimo_lote.created_at if ultimo_lote else None,
        total_registros=registros_total,
        registros_ultimo_lote=registros_ultimo,
    )
