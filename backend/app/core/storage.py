"""Almacenamiento de archivos: Supabase Storage si está configurado, disco local si no.

El disco local en Render es efímero (se borra en cada redeploy/reinicio), así
que en producción siempre debe usarse Supabase. El fallback local solo existe
para que el desarrollo funcione sin depender de credenciales externas.
"""
import os
import uuid
import mimetypes
from pathlib import Path

import httpx

from app.core.config import settings

LOCAL_UPLOAD_DIR = Path("uploads")
LOCAL_UPLOAD_DIR.mkdir(exist_ok=True)


def _is_supabase_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY)


def _unique_name(original_filename: str) -> str:
    ext = os.path.splitext(original_filename or "")[1]
    return f"{uuid.uuid4()}{ext}"


async def upload_bytes(content: bytes, filename: str, folder: str = "misc") -> str:
    """Sube un archivo y devuelve la URL pública con la que se puede acceder."""
    unique_filename = _unique_name(filename)
    object_path = f"{folder}/{unique_filename}"

    if _is_supabase_configured():
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        url = f"{settings.SUPABASE_URL}/storage/v1/object/{settings.SUPABASE_BUCKET}/{object_path}"
        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
            "apikey": settings.SUPABASE_SERVICE_KEY,
            "Content-Type": content_type,
            "x-upsert": "true",
        }
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(url, headers=headers, content=content)
            resp.raise_for_status()
        return f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.SUPABASE_BUCKET}/{object_path}"

    # Fallback local (solo para desarrollo)
    from starlette.concurrency import run_in_threadpool

    local_dir = LOCAL_UPLOAD_DIR / folder
    local_dir.mkdir(parents=True, exist_ok=True)
    file_path = local_dir / unique_filename

    def _write():
        with open(file_path, "wb") as f:
            f.write(content)

    await run_in_threadpool(_write)
    return f"/static/{folder}/{unique_filename}"


async def create_signed_upload(filename: str, folder: str = "misc") -> dict | None:
    """Pide a Supabase una URL firmada para que el NAVEGADOR suba el archivo
    directo a Supabase Storage (sin pasar los bytes por nuestro backend).

    Evita el doble salto navegador→Render→Supabase, que en Render free tier
    (poco ancho de banda saliente + cold start) hace lentas o agota el tiempo
    de subidas que en Supabase directo tardan segundos.

    Devuelve None si Supabase no está configurado (el caller debe usar el
    flujo de subida por el backend / disco local como respaldo).
    """
    if not _is_supabase_configured():
        return None

    unique_filename = _unique_name(filename)
    object_path = f"{folder}/{unique_filename}"
    sign_url = f"{settings.SUPABASE_URL}/storage/v1/object/upload/sign/{settings.SUPABASE_BUCKET}/{object_path}"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(sign_url, headers=headers, json={})
    except httpx.HTTPError as e:
        # Errores de red/DNS/timeout no son RuntimeError; sin esto escapan como
        # excepción no controlada y el endpoint devuelve un 500 opaco.
        raise RuntimeError(f"No se pudo contactar Supabase Storage: {e}") from e
    if resp.is_error:
        raise RuntimeError(f"Supabase sign-upload falló ({resp.status_code}): {resp.text}")
    try:
        signed = resp.json()
        relative = signed["url"]
    except (ValueError, KeyError) as e:
        raise RuntimeError(f"Respuesta inesperada de Supabase sign-upload: {resp.text}") from e

    # `url` viene como ruta relativa, p. ej. "/object/upload/sign/<bucket>/<path>?token=...".
    upload_url = f"{settings.SUPABASE_URL}/storage/v1{relative}"
    return {"upload_url": upload_url, "public_url": public_url_for(object_path), "path": object_path}


def public_url_for(object_path: str) -> str:
    """Reconstruye la URL pública de un objeto ya subido a Supabase, dado su path."""
    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.SUPABASE_BUCKET}/{object_path}"


async def create_signed_download(object_path: str, expires_in: int = 600) -> str:
    """Genera una URL de lectura firmada y temporal (bucket privado): el
    documento solo es accesible durante `expires_in` segundos, nunca queda
    público. Se usa para documentos sensibles de clientes (identificación,
    estados de cuenta), a diferencia de las imágenes de producto del
    Inventario, que sí usan el bucket/URL pública.
    """
    sign_url = f"{settings.SUPABASE_URL}/storage/v1/object/sign/{settings.SUPABASE_BUCKET}/{object_path}"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(sign_url, headers=headers, json={"expiresIn": expires_in})
    except httpx.HTTPError as e:
        raise RuntimeError(f"No se pudo firmar la descarga en Supabase: {e}") from e
    if resp.is_error:
        raise RuntimeError(f"Supabase sign-download falló ({resp.status_code}): {resp.text}")
    try:
        signed = resp.json()
        return f"{settings.SUPABASE_URL}/storage/v1{signed['signedURL']}"
    except (ValueError, KeyError) as e:
        raise RuntimeError(f"Respuesta inesperada de Supabase sign-download: {resp.text}") from e
