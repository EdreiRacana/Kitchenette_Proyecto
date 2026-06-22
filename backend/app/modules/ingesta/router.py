"""
Motor de Ingesta Universal — endpoints REST.

Rutas:
  GET    /ingesta/resumen                    → dashboard de ingesta
  GET    /ingesta/fuentes                    → listar fuentes
  POST   /ingesta/fuentes                    → crear fuente
  GET    /ingesta/fuentes/{id}               → detalle fuente
  PUT    /ingesta/fuentes/{id}               → actualizar fuente
  DELETE /ingesta/fuentes/{id}               → eliminar fuente

  POST   /ingesta/detectar                   → detectar columnas con IA (modo automático)
  POST   /ingesta/fuentes/{id}/upload        → subir Excel/CSV y procesar
  GET    /ingesta/fuentes/{id}/lotes         → historial de lotes de una fuente
  GET    /ingesta/lotes/{lote_id}/registros  → registros normalizados de un lote
"""

from __future__ import annotations

import io
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
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
    """Métricas globales del motor de ingesta para el dashboard."""
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
    No requiere fuente_id — se usa antes de crear/actualizar el perfil.
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
            "Primero usa /detectar para configurar el mapeo."
        )

    nombre = archivo.filename or "archivo"
    contenido = await archivo.read()
    extension = nombre.rsplit(".", 1)[-1].lower()

    try:
        filas = _leer_archivo(contenido, extension, fuente.fila_encabezado)
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

    return resultado


def _leer_archivo(
    contenido: bytes,
    extension: str,
    fila_encabezado: int = 1,
) -> list:
    """
    Lee Excel o CSV y retorna lista de dicts {columna: valor}.
    Soporta .xlsx, .xls, .csv.
    """
    try:
        import pandas as pd
    except ImportError:
        raise RuntimeError("pandas no está instalado. Agrega 'pandas openpyxl' a requirements.txt")

    header_row = max(0, fila_encabezado - 1)

    if extension in ("xlsx", "xls"):
        df = pd.read_excel(
            io.BytesIO(contenido),
            header=header_row,
            dtype=str,
        )
    elif extension == "csv":
        df = pd.read_csv(
            io.BytesIO(contenido),
            header=header_row,
            dtype=str,
            encoding="utf-8-sig",
        )
    else:
        raise ValueError(f"Formato no soportado: .{extension}. Usa .xlsx, .xls o .csv")

    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]

    return df.where(df.notna(), None).to_dict(orient="records")


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
    """Historial de archivos subidos para una fuente."""
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


@router.get("/lotes/{lote_id}/registros")
async def registros_lote(
    lote_id: int,
    db: DB,
    _: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Registros normalizados de un lote específico."""
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
    """Registros normalizados filtrados por fuente."""
    registros, total = await service.get_registros(
        db, fuente_id=fuente_id, skip=skip, limit=limit
    )
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [schemas.IngestaRegistro.model_validate(r) for r in registros],
    }
