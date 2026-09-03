"""Wrapper del PAC Sufactura (CFDI 4.0).

Interfaz uniforme:
  - stamp_invoice(payload)      -> PACResult(uuid, xml_bytes, pdf_bytes, ...)
  - stamp_credit_note(payload)  -> PACResult(...)
  - cancel_cfdi(uuid, motivo, folio_sustituto?) -> PACResult(acuse=xml_bytes)
  - get_pdf(uuid) / get_xml(uuid)

Autenticación: Basic Auth username/password + header X-RFC del emisor,
según docs de Sufactura. Los endpoints exactos son:
  POST /api/v1/cfdi/stamp            -> timbra ingreso o egreso
  POST /api/v1/cfdi/{uuid}/cancel    -> cancela con motivo SAT
  GET  /api/v1/cfdi/{uuid}/pdf       -> descarga PDF
  GET  /api/v1/cfdi/{uuid}/xml       -> descarga XML timbrado
  GET  /api/v1/account/balance       -> ping/saldo (ya usado por el test)

Diseño defensivo:
  - Timeout de 20s (timbrar puede tardar).
  - Ningún request al PAC se lanza sin credenciales — retornamos error
    legible en lugar de romper con excepción críptica.
  - Se guarda la respuesta cruda del PAC en `raw_response` de PACResult
    para poder auditar/debugear después.
  - No hardcodeamos URLs: sandbox vs producción se toma del config.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, Tuple

import httpx


class PACError(Exception):
    """Error genérico del PAC. Contiene un mensaje legible + código si aplica."""
    def __init__(self, message: str, code: Optional[str] = None,
                  http_status: Optional[int] = None, raw: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.raw = raw


@dataclass
class PACResult:
    """Resultado uniforme de una operación del PAC."""
    ok: bool
    uuid: Optional[str] = None
    xml: Optional[bytes] = None
    pdf: Optional[bytes] = None
    serie: Optional[str] = None
    folio: Optional[str] = None
    sello_cfd: Optional[str] = None
    sello_sat: Optional[str] = None
    no_certificado_sat: Optional[str] = None
    stamped_at: Optional[str] = None
    acuse: Optional[bytes] = None       # solo para cancelaciones
    error: Optional[str] = None
    error_code: Optional[str] = None
    raw_response: Dict[str, Any] = field(default_factory=dict)


class SufacturaPAC:
    """Cliente Sufactura autenticado con las credenciales de UNA empresa."""

    def __init__(self, *, username: str, password: str, rfc: str,
                  environment: str = "production", timeout: float = 20.0):
        if not username or not password or not rfc:
            raise PACError("Faltan credenciales de Sufactura (usuario/password/RFC).")
        self.username = username
        self.password = password
        self.rfc = rfc.upper().strip()
        self.env = (environment or "production").lower()
        self.base = ("https://sandbox.sufactura.com.mx" if self.env == "sandbox"
                     else "https://sufactura.com.mx")
        self.timeout = timeout

    # ── Helpers ──
    @property
    def _auth(self) -> Tuple[str, str]:
        return (self.username, self.password)

    @property
    def _headers(self) -> Dict[str, str]:
        return {"X-RFC": self.rfc, "Accept": "application/json"}

    async def _post(self, path: str, json: Dict[str, Any]) -> Tuple[int, Dict[str, Any] | str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base}{path}", auth=self._auth,
                                    headers={**self._headers, "Content-Type": "application/json"},
                                    json=json)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text

    async def _get(self, path: str) -> Tuple[int, bytes | Dict[str, Any] | str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base}{path}", auth=self._auth, headers=self._headers)
        # PDF/XML vienen como bytes; JSON como dict; error como texto
        ct = (r.headers.get("content-type") or "").lower()
        if "application/pdf" in ct or "application/xml" in ct or "text/xml" in ct:
            return r.status_code, r.content
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text

    # ── Operaciones principales ──

    async def stamp(self, payload: Dict[str, Any]) -> PACResult:
        """Timbra un CFDI 4.0 (Ingreso o Egreso). El payload debe ser el
        JSON canónico que Sufactura acepta:
          {
            "tipo_comprobante": "I" | "E",
            "receptor": {...},
            "conceptos": [...],
            "cfdi_relacionados": {tipo_relacion, uuids: []}  ← solo NC/E
            ...
          }
        """
        try:
            status, body = await self._post("/api/v1/cfdi/stamp", payload)
        except httpx.RequestError as e:
            return PACResult(ok=False, error=f"No se pudo contactar al PAC: {e}")

        if status >= 300:
            err = body.get("error") if isinstance(body, dict) else str(body)[:500]
            return PACResult(ok=False, error=err or f"HTTP {status}", error_code=str(status),
                             raw_response={"status": status, "body": body})

        if not isinstance(body, dict):
            return PACResult(ok=False, error="Respuesta inesperada del PAC",
                             raw_response={"body": body})

        # Sufactura devuelve típicamente: {uuid, xml_base64, pdf_base64, sello, ...}
        import base64
        def _b64(v):
            if not v: return None
            try: return base64.b64decode(v)
            except Exception: return None

        return PACResult(
            ok=True,
            uuid=body.get("uuid") or body.get("folio_fiscal"),
            xml=_b64(body.get("xml_base64") or body.get("xml")),
            pdf=_b64(body.get("pdf_base64") or body.get("pdf")),
            serie=body.get("serie"),
            folio=body.get("folio"),
            sello_cfd=body.get("sello_cfd"),
            sello_sat=body.get("sello_sat"),
            no_certificado_sat=body.get("no_certificado_sat"),
            stamped_at=body.get("stamped_at") or body.get("fecha_timbrado"),
            raw_response=body,
        )

    async def stamp_credit_note(self, payload: Dict[str, Any]) -> PACResult:
        """Timbra un CFDI 4.0 tipo Egreso (nota de crédito). Requiere
        `cfdi_relacionados` con tipo_relacion "01" y el UUID de la
        factura original que se está acreditando."""
        payload = {**payload, "tipo_comprobante": "E"}
        if "cfdi_relacionados" not in payload:
            raise PACError("Una NC requiere cfdi_relacionados con el UUID de la factura original.")
        return await self.stamp(payload)

    async def cancel_cfdi(self, uuid: str, motivo: str,
                            folio_sustituto: Optional[str] = None) -> PACResult:
        """Cancela un CFDI ante el SAT.
        motivo: "01" comprobante emitido con errores con relación
                "02" comprobante emitido con errores sin relación
                "03" no se llevó a cabo la operación
                "04" operación nominativa relacionada en la factura global
        folio_sustituto: OBLIGATORIO si motivo == "01"."""
        if motivo == "01" and not folio_sustituto:
            return PACResult(ok=False, error="Motivo 01 requiere folio_sustituto (UUID de reemplazo).")
        body = {"motivo": motivo}
        if folio_sustituto:
            body["folio_sustituto"] = folio_sustituto
        try:
            status, resp = await self._post(f"/api/v1/cfdi/{uuid}/cancel", body)
        except httpx.RequestError as e:
            return PACResult(ok=False, error=f"No se pudo contactar al PAC: {e}")
        if status >= 300:
            err = resp.get("error") if isinstance(resp, dict) else str(resp)[:500]
            return PACResult(ok=False, error=err or f"HTTP {status}", error_code=str(status))
        import base64
        if isinstance(resp, dict):
            acuse_b64 = resp.get("acuse_base64") or resp.get("acuse")
            acuse = None
            if acuse_b64:
                try: acuse = base64.b64decode(acuse_b64)
                except Exception: acuse = None
            return PACResult(ok=True, uuid=uuid, acuse=acuse, raw_response=resp)
        return PACResult(ok=True, uuid=uuid, raw_response={"raw": str(resp)[:500]})

    async def get_pdf(self, uuid: str) -> Optional[bytes]:
        status, body = await self._get(f"/api/v1/cfdi/{uuid}/pdf")
        if status == 200 and isinstance(body, (bytes, bytearray)):
            return bytes(body)
        return None

    async def get_xml(self, uuid: str) -> Optional[bytes]:
        status, body = await self._get(f"/api/v1/cfdi/{uuid}/xml")
        if status == 200 and isinstance(body, (bytes, bytearray)):
            return bytes(body)
        return None


# ── Factory helper ────────────────────────────────────────────────────────
async def get_sufactura_client_for_current_company(db):
    """Instancia un cliente PAC con las credenciales de la empresa activa.
    - Si environment == "mock" -> retorna MockPAC (no requiere red ni credenciales
      reales, ideal para pruebas locales / demos).
    - Si environment == "sandbox" o "production" -> retorna SufacturaPAC real.
    Lanza PACError si no está configurado."""
    from sqlalchemy import select
    from app.modules.core_config.models import SystemIntegration, IntegrationType
    from app.core.tenancy import get_company_context

    cid = get_company_context()
    stmt = select(SystemIntegration).where(
        SystemIntegration.integration_type == IntegrationType.INVOICING_SUFACTURA,
        SystemIntegration.is_active == True,  # noqa: E712
    )
    if cid:
        stmt = stmt.where(SystemIntegration.company_id == cid)
    res = await db.execute(stmt)
    intg = res.scalars().first()
    if not intg:
        raise PACError("Sufactura no está configurado o no está activo para esta empresa. "
                        "Ve a Configuración → Integraciones → Sufactura.")
    meta = intg.meta_data or {}
    env = (meta.get("environment") or "production").lower()
    rfc = meta.get("rfc", "")

    if env == "mock":
        from .mock import MockPAC
        return MockPAC(rfc=rfc)

    if not intg.api_key or not intg.api_secret:
        raise PACError("Faltan credenciales de Sufactura para esta empresa. "
                        "Configura usuario y contraseña, o cambia el entorno a "
                        "'mock' para pruebas sin conexión al PAC.")
    return SufacturaPAC(
        username=intg.api_key,
        password=intg.api_secret,
        rfc=rfc,
        environment=env,
    )
