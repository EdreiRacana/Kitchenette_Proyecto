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
import secrets
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
    "estatus_pedido":        "Estado del pedido: recibido, enviado, entregado, devuelto, reembolsado, cancelado",
    "skip":                  "Ignorar esta columna, no mapear a ningún campo",
}


# ─────────────────────────────────────────────────────────────
# 1. CRUD FUENTES
# ─────────────────────────────────────────────────────────────

async def get_fuentes(db: AsyncSession) -> List[models.IngestaFuente]:
    result = await db.execute(
        select(models.IngestaFuente)
        .options(
            selectinload(models.IngestaFuente.columnas),
            selectinload(models.IngestaFuente.reglas),
        )
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
        customer_id=data.customer_id,
        auto_crear_ventas=data.auto_crear_ventas,
        api_key=secrets.token_urlsafe(24) if data.tipo_ingesta == "api" else None,
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
    return await get_fuente(db, fuente.id)


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
        "campo_id_pedido", "patron_fila_total", "customer_id", "auto_crear_ventas",
    ]
    for campo in campos_simples:
        valor = getattr(data, campo, None)
        if valor is not None:
            setattr(fuente, campo, valor)

    if fuente.tipo_ingesta == "api" and not fuente.api_key:
        fuente.api_key = secrets.token_urlsafe(24)

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
    return await get_fuente(db, fuente_id)


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


async def _llamar_claude(
    prompt: str,
    api_key: str,
    max_tokens: int = 3000,
) -> tuple[str, int]:
    """Llama a Claude API y retorna (texto_respuesta, tokens_usados)."""
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
        resp.raise_for_status()
    data = resp.json()
    raw = data["content"][0]["text"].strip()
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    tokens = data.get("usage", {}).get("input_tokens", 0) + data.get("usage", {}).get("output_tokens", 0)
    return raw, tokens


async def detectar_columnas_ia(
    request: schemas.DeteccionRequest,
) -> schemas.DeteccionResponse:
    """
    Detecta y mapea columnas automáticamente con Claude API.
    Para archivos con más de 40 columnas divide en lotes para evitar
    que el JSON se trunque por límite de tokens de salida.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY no configurada en variables de entorno.")

    LOTE = 40  # columnas por llamada
    encabezados = request.encabezados
    muestra_filas = request.muestra_filas

    # Muestra reducida para no inflar el prompt
    muestra_corta = [
        {k: (str(v)[:25] if v is not None else None) for k, v in row.items()}
        for row in muestra_filas[:2]
    ]

    campos_validos = json.dumps(list(CAMPOS_DESCRIPCION.keys()), ensure_ascii=False)
    hint = ""
    if request.fuente_nombre:
        hint += f"Fuente: {request.fuente_nombre}. "
    if request.tipo_cliente:
        hint += f"Tipo: {request.tipo_cliente}."

    todas_columnas: list = []
    tokens_total = 0
    tiene_anidadas = False
    id_pedido_sugerido = None
    patron_total_sugerido = None
    confianza_global = 0.0
    n_lotes = 0

    # Dividir en lotes de LOTE columnas
    for inicio in range(0, len(encabezados), LOTE):
        lote_cols = encabezados[inicio: inicio + LOTE]
        # Muestra solo con las columnas del lote
        muestra_lote = [
            {k: v for k, v in row.items() if k in lote_cols}
            for row in muestra_corta
        ]

        prompt = f"""Experto en datos retail. Mapea columnas de reporte de ventas a campos STHENOVA.
{hint}

COLUMNAS A MAPEAR ({len(lote_cols)} de {len(encabezados)} total, lote {inicio // LOTE + 1}):
{json.dumps(lote_cols, ensure_ascii=False)}

MUESTRA:
{json.dumps(muestra_lote, ensure_ascii=False)}

CAMPOS VÁLIDOS (usa exactamente o "skip"):
{campos_validos}

Responde SOLO JSON puro:
{{"columnas":[{{"columna_origen":"...","campo_sthenova_sugerido":"...","muestra":"...","confianza":0.9}},...],
"tiene_filas_anidadas":false,"campo_id_pedido_sugerido":null,"confianza_global":0.85}}"""

        raw, tokens = await _llamar_claude(prompt, api_key, max_tokens=3000)
        tokens_total += tokens
        n_lotes += 1

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # Si falla un lote, marcar esas columnas como skip
            for col in lote_cols:
                todas_columnas.append({
                    "columna_origen": col,
                    "campo_sthenova_sugerido": "skip",
                    "muestra": None,
                    "confianza": 0.0,
                    "razon": "Error al parsear respuesta de IA",
                })
            continue

        todas_columnas.extend(parsed.get("columnas", []))

        # Tomar metadatos del primer lote (tiene más contexto)
        if inicio == 0:
            tiene_anidadas = parsed.get("tiene_filas_anidadas", False)
            id_pedido_sugerido = parsed.get("campo_id_pedido_sugerido")
            patron_total_sugerido = parsed.get("patron_fila_total_sugerido")

        confianza_global += parsed.get("confianza_global", 0.85)

    confianza_global = round(confianza_global / max(n_lotes, 1), 2)

    columnas = [
        schemas.ColumnaDetectada(
            columna_origen=c.get("columna_origen", ""),
            campo_sthenova_sugerido=c.get("campo_sthenova_sugerido", "skip"),
            muestra=c.get("muestra"),
            confianza=float(c.get("confianza", 0.5)),
            razon=c.get("razon"),
        )
        for c in todas_columnas
    ]

    return schemas.DeteccionResponse(
        columnas=columnas,
        tiene_filas_anidadas=tiene_anidadas,
        campo_id_pedido_sugerido=id_pedido_sugerido,
        patron_fila_total_sugerido=patron_total_sugerido,
        confianza_global=confianza_global,
        notas=f"Procesado en {n_lotes} lote(s) · {len(encabezados)} columnas totales",
        tokens_usados=tokens_total,
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


def _es_devolucion(fila: Dict[str, Any], fuente: models.IngestaFuente) -> bool:
    """
    Detecta si una fila representa una devolución/reembolso según la regla
    configurada en la fuente: columna de estatus (raw, tal como viene en el
    archivo) + valor/condición a comparar. Esto es lo que permite que un
    mismo pedido, re-subido en un periodo posterior con el estatus cambiado
    (ej: "Entregado" → "Reembolsado"), se reconozca como devolución en vez
    de quedar como una venta más.
    """
    reglas = fuente.reglas
    if not reglas or not reglas.dev_columna_estatus or not reglas.dev_valor:
        return False
    valor_fila = fila.get(reglas.dev_columna_estatus)
    if valor_fila is None:
        return False
    valor_fila = str(valor_fila).strip().lower()
    valor_regla = str(reglas.dev_valor).strip().lower()
    if reglas.dev_regla == "igual":
        return valor_fila == valor_regla
    if reglas.dev_regla == "diferente":
        return valor_fila != valor_regla
    return valor_regla in valor_fila  # "contiene" (default)


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

    # El campo de mapeo se llama "id_pedido" (CAMPOS_DESCRIPCION) pero la
    # columna del modelo es "id_pedido_origen" — sin este alias, fuentes
    # planas (sin filas anidadas) nunca guardan la clave de pedido y el
    # sistema no puede reconocer un pedido re-subido en un periodo distinto.
    if "id_pedido" in resultado:
        resultado["id_pedido_origen"] = resultado.pop("id_pedido")

    resultado["es_devolucion"] = _es_devolucion(fila, fuente)

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
        # Algunas fuentes solo reportan el estatus (ej: "Reembolsado") en la
        # fila de total, no en cada línea de detalle.
        total_es_devolucion = _es_devolucion(total_fila, fuente) if total_fila else False
        for linea in lineas:
            reg = _normalizar_fila(linea, mapeo, fuente)
            reg["id_pedido_origen"] = id_pedido
            if total_es_devolucion:
                reg["es_devolucion"] = True
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

    # Normalizar filas. Una fila individual con datos inválidos no debe
    # tumbar el lote completo: se cuenta como error y se sigue con el resto.
    filas_ok = 0
    filas_error = 0

    if fuente.tiene_filas_anidadas and fuente.campo_id_pedido:
        try:
            registros_normalizados = _agrupar_filas_anidadas(
                filas=filas_crudas,
                campo_id_pedido=fuente.campo_id_pedido,
                patron_fila_total=fuente.patron_fila_total,
                mapeo=mapeo,
                fuente=fuente,
            )
        except Exception as e:
            print(f"[ingesta] error al agrupar filas anidadas: {e}")
            registros_normalizados = []
            filas_error += len(filas_crudas)
    else:
        registros_normalizados = []
        for fila in filas_crudas:
            try:
                registros_normalizados.append(_normalizar_fila(fila, mapeo, fuente))
            except Exception as e:
                filas_error += 1
                print(f"[ingesta] error al normalizar fila: {e}")
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


async def get_fuente_por_api_key(db: AsyncSession, api_key: str) -> Optional[models.IngestaFuente]:
    result = await db.execute(
        select(models.IngestaFuente)
        .options(selectinload(models.IngestaFuente.columnas))
        .where(models.IngestaFuente.api_key == api_key, models.IngestaFuente.activa == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


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


# ─────────────────────────────────────────────────────────────
# 5. PUENTE INGESTA → VENTAS (genera Order reales desde registros)
# ─────────────────────────────────────────────────────────────
#
# Un IngestaRegistro normalizado es solo BI hasta que esta función lo
# convierte en una Order real: ahí es cuando Finanzas reconoce el ingreso
# e Inventario refleja el movimiento (si el SKU está vinculado a un
# variant_id real; si no, es un renglón de texto libre, igual que en
# Ventas manuales).
#
# Agrupamos por id_pedido_origen cuando existe (un pedido, varias líneas);
# si no, cada registro es su propio pedido de una sola línea.

async def generar_ordenes_de_lote(
    db: AsyncSession,
    lote_id: int,
    user_id: Optional[int] = None,
) -> schemas.GenerarVentasResponse:
    from app.modules.sales import models as sales_models, schemas as sales_schemas, service as sales_service

    lote = await db.get(models.IngestaLote, lote_id)
    if not lote:
        raise ValueError(f"Lote {lote_id} no encontrado.")

    fuente = await get_fuente(db, lote.fuente_id)
    if not fuente:
        raise ValueError(f"Fuente {lote.fuente_id} no encontrada.")

    result = await db.execute(
        select(models.IngestaRegistro).where(
            models.IngestaRegistro.lote_id == lote_id,
            models.IngestaRegistro.order_id.is_(None),
        )
    )
    registros = result.scalars().all()

    pendientes_total = (await db.execute(
        select(func.count(models.IngestaRegistro.id)).where(models.IngestaRegistro.lote_id == lote_id)
    )).scalar() or 0
    omitidos = pendientes_total - len(registros)

    grupos: Dict[str, List[models.IngestaRegistro]] = {}
    for reg in registros:
        clave = reg.id_pedido_origen or f"_reg_{reg.id}"
        grupos.setdefault(clave, []).append(reg)

    # Pedidos (id_pedido_origen real, no la clave sintética de una sola fila)
    # que ya fueron facturados en un lote ANTERIOR de la misma fuente. Si el
    # archivo se vuelve a subir (ej: el reporte de mayo repite pedidos de
    # abril), estos no deben generar una segunda Order — solo se vinculan, y
    # si el estatus cambió a devolución se registra la devolución real.
    claves_reales = {reg.id_pedido_origen for reg in registros if reg.id_pedido_origen}
    ordenes_previas: Dict[str, int] = {}
    if claves_reales:
        prev = await db.execute(
            select(models.IngestaRegistro.id_pedido_origen, models.IngestaRegistro.order_id)
            .where(
                models.IngestaRegistro.fuente_id == fuente.id,
                models.IngestaRegistro.lote_id != lote_id,
                models.IngestaRegistro.id_pedido_origen.in_(claves_reales),
                models.IngestaRegistro.order_id.isnot(None),
            )
        )
        for id_pedido_origen, order_id in prev.all():
            ordenes_previas.setdefault(id_pedido_origen, order_id)

    order_ids: List[int] = []
    pedidos_ya_existentes = 0
    devoluciones_generadas = 0

    for clave, regs in grupos.items():
        id_pedido = regs[0].id_pedido_origen
        order_id_existente = ordenes_previas.get(id_pedido) if id_pedido else None

        if order_id_existente:
            # Ya existe una venta para este pedido: no se duplica. Solo se
            # vinculan los registros nuevos y, si cambió a devolución, se
            # registra una devolución real sobre la Order existente.
            pedidos_ya_existentes += 1
            for reg in regs:
                reg.order_id = order_id_existente

            if any(reg.es_devolucion for reg in regs):
                ya_tiene_devolucion = (await db.execute(
                    select(func.count(sales_models.CustomerReturn.id)).where(
                        sales_models.CustomerReturn.order_id == order_id_existente,
                        sales_models.CustomerReturn.status != "cancelled",
                    )
                )).scalar() or 0
                if not ya_tiene_devolucion:
                    items_dev = [
                        sales_schemas.ReturnItemCreate(
                            variant_id=None,
                            product_name=reg.descripcion or reg.sku_cliente or reg.upc or "Producto",
                            sku=reg.sku_cliente or reg.sku_cadena or reg.upc,
                            quantity=max(1, int(reg.cantidad_vendida or 1)),
                            unit_price=reg.precio_unitario or (
                                (reg.venta_neta or reg.venta_bruta or 0.0) / max(1, reg.cantidad_vendida or 1)
                            ),
                            condition="damaged",
                        )
                        for reg in regs
                    ]
                    await sales_service.create_return(
                        db,
                        sales_schemas.ReturnCreate(
                            order_id=order_id_existente,
                            reason="Detectado automáticamente al re-procesar la ingesta",
                            settlement_type="refund",
                            notes=f"Generado desde ingesta · fuente '{fuente.nombre}' · lote #{lote_id} · pedido {id_pedido}",
                            items=items_dev,
                        ),
                        user_id=user_id,
                    )
                    devoluciones_generadas += 1
            continue

        items = [
            sales_schemas.OrderItemCreate(
                variant_id=None,
                product_name=reg.descripcion or reg.sku_cliente or reg.upc or "Producto",
                sku=reg.sku_cliente or reg.sku_cadena or reg.upc,
                quantity=max(1, int(reg.cantidad_vendida or 1)),
                unit_price=reg.precio_unitario or (
                    (reg.venta_neta or reg.venta_bruta or 0.0) / max(1, reg.cantidad_vendida or 1)
                ),
                discount_amount=0.0,
                tax_rate=0.0,
            )
            for reg in regs
        ]

        order_in = sales_schemas.OrderCreate(
            kind="order",
            customer_id=fuente.customer_id,
            payment_method="marketplace",
            channel=fuente.tipo_cliente or "marketplace",
            status="paid",  # la cadena ya liquidó la venta; se reconoce el ingreso de inmediato
            notes=f"Generado desde ingesta · fuente '{fuente.nombre}' · lote #{lote_id}"
                  + (f" · pedido origen {clave}" if regs[0].id_pedido_origen else ""),
            items=items,
        )

        order = await sales_service.create_order(db, order_in, user_id=user_id)
        order_ids.append(order.id)
        for reg in regs:
            reg.order_id = order.id

    await db.commit()

    return schemas.GenerarVentasResponse(
        lote_id=lote_id,
        ordenes_creadas=len(order_ids),
        registros_omitidos=omitidos,
        pedidos_ya_existentes=pedidos_ya_existentes,
        devoluciones_generadas=devoluciones_generadas,
        order_ids=order_ids,
    )
