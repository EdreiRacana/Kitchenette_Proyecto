"""MockPAC — implementación local que simula un PAC real (Sufactura/Finkok).

Permite probar todo el flujo CFDI 4.0 (timbrar factura, emitir NC, cancelar,
descargar PDF/XML) sin credenciales de proveedor real. Genera UUIDs válidos,
XML mínimo con estructura CFDI 4.0 y un PDF simple con los datos clave.

Se activa configurando Sufactura en Configuración → Integraciones con
`environment = "mock"` (sin necesidad de usuario/contraseña reales).

USO EN PRODUCCIÓN: NO. Este mock retorna sellos ficticios; el SAT no
reconoce estos UUIDs. Es solo para desarrollo y demostración.
"""
from __future__ import annotations
import uuid
import io
from datetime import datetime
from typing import Optional, Dict, Any

from .sufactura import PACResult


def _mock_uuid() -> str:
    """UUID v4 mayúsculas — formato compatible con Folio Fiscal SAT."""
    return str(uuid.uuid4()).upper()


def _mock_xml(payload: Dict[str, Any], folio_fiscal: str) -> bytes:
    """XML mínimo simulando un CFDI 4.0. NO es un XML válido para el SAT
    (no lleva sellos ni certificado firmados), pero es útil para inspeccionar
    la estructura de datos generada por el ERP."""
    fecha = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    tipo = payload.get("tipo_comprobante", "I")
    serie = payload.get("serie", "")
    folio = payload.get("folio", "")
    total = payload.get("total", 0)
    subtotal = payload.get("subtotal", 0)
    receptor = payload.get("receptor", {})

    conceptos_xml = ""
    for c in payload.get("conceptos", []):
        conceptos_xml += (
            f'    <cfdi:Concepto ClaveProdServ="{c.get("clave_prod_serv","01010101")}" '
            f'Cantidad="{c.get("cantidad",1)}" ClaveUnidad="{c.get("clave_unidad","H87")}" '
            f'Descripcion="{c.get("descripcion","")}" '
            f'ValorUnitario="{c.get("valor_unitario",0)}" '
            f'Importe="{c.get("importe",0)}"/>\n'
        )

    rel_xml = ""
    rel = payload.get("cfdi_relacionados") or {}
    if rel and rel.get("uuids"):
        uuids_xml = "".join(
            f'    <cfdi:CfdiRelacionado UUID="{u}"/>\n' for u in rel["uuids"]
        )
        rel_xml = (
            f'  <cfdi:CfdiRelacionados TipoRelacion="{rel.get("tipo_relacion","01")}">\n'
            f'{uuids_xml}  </cfdi:CfdiRelacionados>\n'
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" '
        'Version="4.0" '
        f'Serie="{serie}" Folio="{folio}" '
        f'Fecha="{fecha}" '
        f'TipoDeComprobante="{tipo}" '
        f'SubTotal="{subtotal}" Total="{total}" '
        'Moneda="MXN" LugarExpedicion="00000">\n'
        f'{rel_xml}'
        f'  <cfdi:Receptor Rfc="{receptor.get("rfc","XAXX010101000")}" '
        f'Nombre="{receptor.get("nombre","")}" '
        f'DomicilioFiscalReceptor="{receptor.get("codigo_postal","00000")}" '
        f'RegimenFiscalReceptor="{receptor.get("regimen_fiscal","616")}" '
        f'UsoCFDI="{receptor.get("uso_cfdi","G03")}"/>\n'
        '  <cfdi:Conceptos>\n'
        f'{conceptos_xml}'
        '  </cfdi:Conceptos>\n'
        '  <cfdi:Complemento>\n'
        f'    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" '
        'Version="1.1" '
        f'UUID="{folio_fiscal}" '
        f'FechaTimbrado="{fecha}" '
        'SelloCFD="MOCK_SELLO_CFD_NO_VALIDO_PARA_SAT" '
        'NoCertificadoSAT="00000000000000000000" '
        'SelloSAT="MOCK_SELLO_SAT_NO_VALIDO"/>\n'
        '  </cfdi:Complemento>\n'
        '</cfdi:Comprobante>\n'
    )
    return xml.encode("utf-8")


def _mock_pdf(payload: Dict[str, Any], folio_fiscal: str) -> bytes:
    """PDF simple con los datos del comprobante — usa reportlab si está
    disponible (ya es dependencia del proyecto para nómina y tickets)."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas as pdf_canvas
    except Exception:
        # Fallback: PDF minimal por si reportlab no está
        return b"%PDF-1.4\n%mock CFDI\n"

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    w, h = letter
    y = h - 20 * mm

    tipo = payload.get("tipo_comprobante", "I")
    tipo_label = ("Nota de Crédito (Egreso)" if tipo == "E" else "Factura (Ingreso)")

    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, y, f"CFDI 4.0 — {tipo_label}")
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(0.7, 0.3, 0.3)
    c.drawString(20 * mm, y, "⚠ MODO PRUEBA (MOCK) — este comprobante NO es válido ante el SAT")
    c.setFillColorRGB(0, 0, 0)

    y -= 12 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, f"UUID: {folio_fiscal}")
    y -= 6 * mm
    serie = payload.get("serie", "")
    folio = payload.get("folio", "")
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, f"Serie/Folio: {serie}/{folio}")
    y -= 6 * mm
    c.drawString(20 * mm, y, f"Fecha: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")

    receptor = payload.get("receptor", {}) or {}
    y -= 10 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Receptor")
    y -= 5 * mm
    c.setFont("Helvetica", 9)
    c.drawString(22 * mm, y, f"RFC: {receptor.get('rfc','')}")
    y -= 5 * mm
    c.drawString(22 * mm, y, f"Nombre: {receptor.get('nombre','')}")
    y -= 5 * mm
    c.drawString(22 * mm, y, f"CP: {receptor.get('codigo_postal','')}  "
                              f"Régimen: {receptor.get('regimen_fiscal','')}  "
                              f"Uso: {receptor.get('uso_cfdi','')}")

    rel = payload.get("cfdi_relacionados") or {}
    if rel and rel.get("uuids"):
        y -= 8 * mm
        c.setFont("Helvetica-Bold", 10)
        c.drawString(20 * mm, y, f"Relacionados (Tipo {rel.get('tipo_relacion','01')})")
        for u in rel["uuids"]:
            y -= 5 * mm
            c.setFont("Helvetica", 8)
            c.drawString(22 * mm, y, u)

    # Conceptos
    y -= 10 * mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20 * mm, y, "Conceptos")
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 8)
    c.drawString(22 * mm, y, "Cant")
    c.drawString(35 * mm, y, "Descripción")
    c.drawString(140 * mm, y, "P.U.")
    c.drawString(170 * mm, y, "Importe")
    y -= 4 * mm
    c.line(20 * mm, y, 195 * mm, y)
    y -= 5 * mm
    c.setFont("Helvetica", 8)
    for it in (payload.get("conceptos") or [])[:20]:
        c.drawString(22 * mm, y, str(it.get("cantidad", 1)))
        desc = str(it.get("descripcion", ""))[:60]
        c.drawString(35 * mm, y, desc)
        c.drawRightString(160 * mm, y, f"${float(it.get('valor_unitario',0)):,.2f}")
        c.drawRightString(190 * mm, y, f"${float(it.get('importe',0)):,.2f}")
        y -= 5 * mm

    y -= 5 * mm
    c.line(120 * mm, y, 195 * mm, y)
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(160 * mm, y, "TOTAL:")
    c.drawRightString(190 * mm, y, f"${float(payload.get('total',0)):,.2f}")

    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawString(20 * mm, 12 * mm,
                  "STHENOVA ERP · CFDI 4.0 modo mock — comprobante generado localmente para pruebas.")
    c.showPage()
    c.save()
    return buf.getvalue()


class MockPAC:
    """PAC simulado — mismos métodos que SufacturaPAC pero sin red."""

    def __init__(self, rfc: str, environment: str = "mock"):
        self.rfc = rfc.upper().strip() if rfc else "XAXX010101000"
        self.env = "mock"

    async def stamp(self, payload: Dict[str, Any]) -> PACResult:
        folio_fiscal = _mock_uuid()
        return PACResult(
            ok=True,
            uuid=folio_fiscal,
            xml=_mock_xml(payload, folio_fiscal),
            pdf=_mock_pdf(payload, folio_fiscal),
            serie=payload.get("serie", ""),
            folio=payload.get("folio", ""),
            sello_cfd="MOCK_SELLO_CFD_NO_VALIDO_PARA_SAT",
            sello_sat="MOCK_SELLO_SAT_NO_VALIDO",
            no_certificado_sat="00000000000000000000",
            stamped_at=datetime.utcnow().isoformat(),
            raw_response={"mock": True, "payload": payload},
        )

    async def stamp_credit_note(self, payload: Dict[str, Any]) -> PACResult:
        payload = {**payload, "tipo_comprobante": "E"}
        return await self.stamp(payload)

    async def cancel_cfdi(self, uuid: str, motivo: str,
                            folio_sustituto: Optional[str] = None) -> PACResult:
        # ACUSE mock: XML de cancelación aceptada
        acuse = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Acuse xmlns="http://cancelacfd.sat.gob.mx" '
            f'Fecha="{datetime.utcnow().isoformat()}" '
            f'RfcEmisor="{self.rfc}">\n'
            f'  <Folios UUID="{uuid}" EstatusUUID="201" '
            f'Motivo="{motivo}" '
            + (f'FolioSustitucion="{folio_sustituto}" ' if folio_sustituto else "")
            + '/>\n'
            '  <Nota>MOCK — cancelación simulada, no reflejada en el SAT.</Nota>\n'
            '</Acuse>\n'
        ).encode("utf-8")
        return PACResult(ok=True, uuid=uuid, acuse=acuse,
                          raw_response={"mock": True, "motivo": motivo,
                                        "folio_sustituto": folio_sustituto})

    async def get_pdf(self, uuid: str) -> Optional[bytes]:
        # Regenera el PDF a partir de un payload mínimo — el uuid ya no
        # tiene el payload original en memoria, así que devolvemos None y
        # el service usa el pdf guardado en BD (que sí tiene).
        return None

    async def get_xml(self, uuid: str) -> Optional[bytes]:
        return None
