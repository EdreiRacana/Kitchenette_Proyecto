"""
Motor de Ingesta Universal — endpoints REST.

Rutas:
  GET    /ingesta/resumen                    → dashboard de ingesta
  GET    /ingesta/fuentes                    → listar fuentes
  POST   /ingesta/fuentes                    → crear fuente
  GET    /ingesta/fuentes/{id}               → detalle fuente
  PUT    /ingesta/fuentes/{id}               → actualizar fuente
  DELETE /ingesta/fuentes/{id}               → eliminar fuente

  POST   /ingesta/preview                    → leer encabezados + muestra de cualquier archivo
  POST   /ingesta/detectar                   → detectar columnas con IA (modo automático)
  POST   /ingesta/fuentes/{id}/upload        → subir Excel/CSV y procesar
  POST   /ingesta/fuentes/{id}/webhook       → ingesta tipo API (auth por X-API-Key)
  GET    /ingesta/fuentes/{id}/lotes         → historial de lotes de una fuente
  POST   /ingesta/lotes/{lote_id}/generar-ventas → convierte registros en Order reales
  GET    /ingesta/lotes/{lote_id}/registros  → registros normalizados de un lote
"""

from __future__ import annotations

import asyncio
import io
from typing import Annotated, Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.ingesta import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ─────────────────────────────────────────────────────────────
# RESUMEN / DASHBOARD
# ─────────────────────────────────────────────────────────────

@router.get("/resumen", response_model=schemas.ResumenIngesta)
async def resumen(db: DB, _: CurrentUser):
    return await service.get_resumen(db)


# ─────────────────────────────────────────────────────────────
# FUENTES — CRUD
# ─────────────────────────────────────────────────────────────

@router.get("/fuentes", response_model=List[schemas.IngestaFuente])
async def listar_fuentes(db: DB, _: CurrentUser):
    return await service.get_fuentes(db)


@router.post("/fuentes", response_model=schemas.IngestaFuente, status_code=201)
async def crear_fuente(data: schemas.IngestaFuenteCreate, db: DB, _: CurrentUser):
    return await service.create_fuente(db, data)


@router.get("/fuentes/{fuente_id}", response_model=schemas.IngestaFuente)
async def detalle_fuente(fuente_id: int, db: DB, _: CurrentUser):
    fuente = await service.get_fuente(db, fuente_id)
    if not fuente:
        raise HTTPException(404, "Fuente no encontrada")
    return fuente


@router.put("/fuentes/{fuente_id}", response_model=schemas.IngestaFuente)
async def actualizar_fuente(
    fuente_id: int,
    data: schemas.IngestaFuenteUpdate,
    db: DB,
    _: CurrentUser,
):
    fuente = await service.update_fuente(db, fuente_id, data)
    if not fuente:
        raise HTTPException(404, "Fuente no encontrada")
    return fuente


@router.delete("/fuentes/{fuente_id}", status_code=204)
async def eliminar_fuente(fuente_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_fuente(db, fuente_id)
    if not ok:
        raise HTTPException(404, "Fuente no encontrada")


# ─────────────────────────────────────────────────────────────
# PREVIEW — leer encabezados y muestra de cualquier archivo
# ─────────────────────────────────────────────────────────────

@router.post("/preview")
async def preview_archivo(
    _: CurrentUser,
    archivo: UploadFile = File(...),
    fila_encabezado: int = Form(1),
):
    """
    Recibe cualquier archivo (xlsx, xls, csv) y devuelve:
    - encabezados: lista de nombres de columnas
    - muestra_filas: primeras 5 filas como lista de dicts
    - total_filas: cantidad total de filas de datos

    El frontend usa esto para mostrar el mapeo antes de procesar.
    No guarda nada en la base de datos.
    """
    nombre = archivo.filename or "archivo"
    contenido = await archivo.read()
    extension = nombre.rsplit(".", 1)[-1].lower()

    try:
        encabezados, muestra_filas, total_filas = await asyncio.to_thread(
            _leer_preview, contenido, extension, fila_encabezado
        )
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")

    if not encabezados:
        raise HTTPException(400, "El archivo no tiene columnas detectables o está vacío.")

    return {
        "encabezados": encabezados,
        "muestra_filas": muestra_filas,
        "total_filas": total_filas,
        "nombre_archivo": nombre,
        "extension": extension,
    }


def _leer_preview(
    contenido: bytes,
    extension: str,
    fila_encabezado: int = 1,
) -> tuple[List[str], List[Dict[str, Any]], int]:
    """
    Lee encabezados y muestra de filas usando pandas.
    Retorna (encabezados, muestra_filas, total_filas).
    """
    try:
        import pandas as pd
    except ImportError:
        raise RuntimeError("pandas no instalado. Agrega 'pandas openpyxl' a requirements.txt")

    header_row = max(0, fila_encabezado - 1)

    if extension in ("xlsx", "xls"):
        df = pd.read_excel(
            io.BytesIO(contenido),
            header=header_row,
            dtype=str,
            nrows=200,  # solo leer primeras 200 filas para el preview
        )
    elif extension == "csv":
        df = pd.read_csv(
            io.BytesIO(contenido),
            header=header_row,
            dtype=str,
            encoding="utf-8-sig",
            nrows=200,
        )
    else:
        raise ValueError(f"Formato no soportado: .{extension}. Usa .xlsx, .xls o .csv")

    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]

    encabezados = df.columns.tolist()
    muestra = df.head(5).where(df.notna(), None).to_dict(orient="records")
    # Convertir a strings limpios para JSON
    muestra_limpia = [
        {k: (str(v) if v is not None else None) for k, v in row.items()}
        for row in muestra
    ]

    return encabezados, muestra_limpia, len(df)


def _leer_archivo(
    contenido: bytes,
    extension: str,
    fila_encabezado: int = 1,
) -> list:
    """
    Lee Excel o CSV completo y retorna lista de dicts {columna: valor}.
    """
    try:
        import pandas as pd
    except ImportError:
        raise RuntimeError("pandas no instalado.")

    header_row = max(0, fila_encabezado - 1)

    if extension in ("xlsx", "xls"):
        df = pd.read_excel(io.BytesIO(contenido), header=header_row, dtype=str)
    elif extension == "csv":
        df = pd.read_csv(
            io.BytesIO(contenido), header=header_row, dtype=str, encoding="utf-8-sig"
        )
    else:
        raise ValueError(f"Formato no soportado: .{extension}")

    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]
    return df.where(df.notna(), None).to_dict(orient="records")


# ─────────────────────────────────────────────────────────────
# DETECCIÓN DE COLUMNAS CON IA
# ─────────────────────────────────────────────────────────────

@router.post("/detectar", response_model=schemas.DeteccionResponse)
async def detectar_columnas(
    request: schemas.DeteccionRequest,
    _: CurrentUser,
):
    """
    Modo automático: manda encabezados + muestra de filas a Claude API.
    Devuelve propuesta de mapeo lista para que el usuario confirme o corrija.
    """
    try:
        return await service.detectar_columnas_ia(request)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Error al conectar con Claude API: {e}")


# ─────────────────────────────────────────────────────────────
# UPLOAD Y PROCESAMIENTO DE ARCHIVO
# ─────────────────────────────────────────────────────────────

@router.post("/fuentes/{fuente_id}/upload", response_model=schemas.ProcesamientoResponse)
async def upload_archivo(
    fuente_id: int,
    db: DB,
    _: CurrentUser,
    archivo: UploadFile = File(...),
    periodo_inicio: Optional[str] = Form(None),
    periodo_fin: Optional[str] = Form(None),
):
    """
    Sube un archivo Excel o CSV, lee las filas y procesa el lote.
    El mapeo de columnas debe estar guardado en la fuente previamente.
    """
    fuente = await service.get_fuente(db, fuente_id)
    if not fuente:
        raise HTTPException(404, "Fuente no encontrada")

    if not fuente.columnas:
        raise HTTPException(
            400,
            "Esta fuente no tiene columnas mapeadas. "
            "Primero usa /preview + /detectar para configurar el mapeo."
        )

    nombre = archivo.filename or "archivo"
    contenido = await archivo.read()
    extension = nombre.rsplit(".", 1)[-1].lower()

    try:
        filas = await asyncio.to_thread(_leer_archivo, contenido, extension, fuente.fila_encabezado)
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")

    if not filas:
        raise HTTPException(400, "El archivo está vacío o no tiene filas de datos.")

    try:
        resultado = await service.procesar_lote(
            db=db,
            fuente_id=fuente_id,
            filas_crudas=filas,
            nombre_archivo=nombre,
            tipo="csv" if extension == "csv" else "excel",
            periodo_inicio=periodo_inicio,
            periodo_fin=periodo_fin,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if fuente.auto_crear_ventas:
        await service.generar_ordenes_de_lote(db, resultado.lote_id)

    return resultado


# ─────────────────────────────────────────────────────────────
# WEBHOOK — ingesta tipo "api" (sin login, autenticado por api_key)
# ─────────────────────────────────────────────────────────────

@router.post("/fuentes/{fuente_id}/webhook", response_model=schemas.ProcesamientoResponse)
async def webhook_ingesta(
    fuente_id: int,
    payload: schemas.WebhookIngestaRequest,
    db: DB,
    x_api_key: str = Header(..., alias="X-API-Key"),
):
    """
    Punto de entrada para que un marketplace/cliente empuje su reporte de
    ventas directamente, sin subir un archivo. Misma normalización y reglas
    que Excel/CSV — solo cambia el transporte.
    """
    fuente = await service.get_fuente_por_api_key(db, x_api_key)
    if not fuente or fuente.id != fuente_id:
        raise HTTPException(401, "API key inválida para esta fuente.")

    if not fuente.columnas:
        raise HTTPException(
            400,
            "Esta fuente no tiene columnas mapeadas. Configúrala antes de enviar datos."
        )

    if not payload.filas:
        raise HTTPException(400, "No se enviaron filas.")

    try:
        resultado = await service.procesar_lote(
            db=db,
            fuente_id=fuente_id,
            filas_crudas=payload.filas,
            nombre_archivo=None,
            tipo="api",
            periodo_inicio=payload.periodo_inicio,
            periodo_fin=payload.periodo_fin,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if fuente.auto_crear_ventas:
        await service.generar_ordenes_de_lote(db, resultado.lote_id)

    return resultado


# ─────────────────────────────────────────────────────────────
# LOTES E HISTORIAL
# ─────────────────────────────────────────────────────────────

@router.get("/fuentes/{fuente_id}/lotes", response_model=List[schemas.IngestaLote])
async def listar_lotes(
    fuente_id: int,
    db: DB,
    _: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    fuente = await service.get_fuente(db, fuente_id)
    if not fuente:
        raise HTTPException(404, "Fuente no encontrada")

    from sqlalchemy import select
    from app.modules.ingesta.models import IngestaLote

    result = await db.execute(
        select(IngestaLote)
        .where(IngestaLote.fuente_id == fuente_id)
        .order_by(IngestaLote.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/lotes/{lote_id}/generar-ventas", response_model=schemas.GenerarVentasResponse)
async def generar_ventas(
    lote_id: int,
    db: DB,
    user: CurrentUser,
):
    """
    Convierte los registros normalizados (aún sin Order) de un lote en
    pedidos reales de Ventas, para que Finanzas/Inventario los reconozcan.
    Idempotente: los registros que ya tienen order_id se omiten.
    """
    try:
        return await service.generar_ordenes_de_lote(db, lote_id, user_id=user.id)
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/lotes/{lote_id}/registros")
async def registros_lote(
    lote_id: int,
    db: DB,
    _: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    registros, total = await service.get_registros(
        db, lote_id=lote_id, skip=skip, limit=limit
    )
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [schemas.IngestaRegistro.model_validate(r) for r in registros],
    }


@router.get("/registros")
async def registros_fuente(
    db: DB,
    _: CurrentUser,
    fuente_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    registros, total = await service.get_registros(
        db, fuente_id=fuente_id, skip=skip, limit=limit
    )
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [schemas.IngestaRegistro.model_validate(r) for r in registros],
    }
