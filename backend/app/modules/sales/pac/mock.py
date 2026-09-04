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


def _hex_to_rgb(hex_str: str):
    """'#33B2F5' -> (0.20, 0.70, 0.96) para setFillColorRGB."""
    s = (hex_str or "#33B2F5").lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
        return r / 255.0, g / 255.0, b / 255.0
    except Exception:
        return 0.20, 0.70, 0.96


def _mock_pdf(payload: Dict[str, Any], folio_fiscal: str) -> bytes:
    """PDF profesional del CFDI 4.0 — layout sobrio con logo, tarjetas
    Emisor/Receptor, banda fiscal, tabla de conceptos, totales, sellos y
    QR SAT. Diseño estilo enterprise (fondo blanco, tipografía Helvetica,
    banda de color de marca, espaciado generoso).

    El diseño espeja las guías de facturas fiscales de alta gama:
    - Header con logo + razón social + banda de color de marca
    - Tarjetas paralelas Emisor / Receptor con jerarquía tipográfica
    - Metadata fiscal (UUID, serie, folio, fecha) en banda destacada
    - Tabla de conceptos con encabezado y separadores finos
    - Sección de totales con desglose de impuestos
    - Bloque de sellos SAT + QR (formato SAT) en pie
    - Leyenda oficial obligatoria: "Este documento es representación impresa..."
    """
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.lib.utils import ImageReader
    except Exception:
        return b"%PDF-1.4\n%mock CFDI\n"

    branding = payload.get("_branding") or {}
    logo_bytes = branding.get("logo_bytes")
    brand_color = branding.get("brand_color") or "#0F172A"
    footer = branding.get("footer") or ""
    br, bg, bb = _hex_to_rgb(brand_color)

    emisor = payload.get("emisor") or {}
    receptor = payload.get("receptor") or {}
    tipo = payload.get("tipo_comprobante", "I")
    tipo_label = "NOTA DE CRÉDITO" if tipo == "E" else "FACTURA"
    tipo_sub = "Egreso · CFDI 4.0" if tipo == "E" else "Ingreso · CFDI 4.0"

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    W, H = letter
    LEFT, RIGHT = 15 * mm, W - 15 * mm

    # ── HEADER: banda de color superior ────────────────────────────
    c.setFillColorRGB(br, bg, bb)
    c.rect(0, H - 8, W, 8, stroke=0, fill=1)  # línea acento

    # Zona header (72px)
    header_top = H - 12 * mm
    header_h = 30 * mm

    # Logo (izquierda) — 30mm de ancho máximo
    if logo_bytes:
        try:
            img = ImageReader(io.BytesIO(logo_bytes))
            iw, ih = img.getSize()
            max_w, max_h = 32 * mm, 22 * mm
            r = min(max_w / iw, max_h / ih)
            lw, lh = iw * r, ih * r
            c.drawImage(img, LEFT, header_top - lh, width=lw, height=lh,
                        mask="auto", preserveAspectRatio=True)
        except Exception:
            pass

    # Tipo de comprobante (derecha)
    c.setFillColorRGB(0.06, 0.09, 0.16)  # slate-900
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(RIGHT, header_top - 6 * mm, tipo_label)
    c.setFont("Helvetica", 9)
    c.setFillColorRGB(br, bg, bb)
    c.drawRightString(RIGHT, header_top - 11 * mm, tipo_sub)
    c.setFillColorRGB(0.06, 0.09, 0.16)
    c.setFont("Helvetica-Bold", 10)
    serie = payload.get("serie", "F")
    folio = payload.get("folio", "")
    c.drawRightString(RIGHT, header_top - 18 * mm, f"Serie {serie}  ·  Folio {folio}")
    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.42, 0.45, 0.50)
    c.drawRightString(RIGHT, header_top - 22.5 * mm,
                       datetime.utcnow().strftime("%d %b %Y  ·  %H:%M UTC").upper())

    # Emisor debajo del logo
    y = header_top - 28 * mm
    c.setFillColorRGB(0.06, 0.09, 0.16)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(LEFT, y, emisor.get("nombre_comercial") or emisor.get("nombre") or "EMISOR")
    y -= 4.5 * mm
    c.setFont("Helvetica", 8.5)
    c.setFillColorRGB(0.35, 0.40, 0.48)
    if emisor.get("rfc"):
        c.drawString(LEFT, y, f"RFC {emisor['rfc']}   ·   Régimen {emisor.get('regimen_fiscal','')}")
        y -= 3.8 * mm
    if emisor.get("domicilio"):
        c.drawString(LEFT, y, emisor["domicilio"][:110])
        y -= 3.8 * mm
    line = " · ".join([x for x in [emisor.get("telefono"), emisor.get("email")] if x])
    if line:
        c.drawString(LEFT, y, line)

    # ── BANDA FISCAL: UUID + metadatos ──────────────────────────────
    band_y = H - 82 * mm
    c.setFillColorRGB(0.96, 0.97, 0.99)  # gris muy claro
    c.rect(LEFT, band_y, RIGHT - LEFT, 18 * mm, stroke=0, fill=1)
    c.setStrokeColorRGB(br, bg, bb)
    c.setLineWidth(0.4)
    c.line(LEFT, band_y + 18 * mm, LEFT, band_y)  # borde izquierdo acento
    c.setLineWidth(3)
    c.line(LEFT, band_y + 18 * mm, LEFT, band_y)
    c.setLineWidth(0.4)

    c.setFillColorRGB(0.42, 0.45, 0.50)
    c.setFont("Helvetica", 7)
    c.drawString(LEFT + 5 * mm, band_y + 14 * mm, "FOLIO FISCAL (UUID)")
    c.setFillColorRGB(0.06, 0.09, 0.16)
    c.setFont("Courier-Bold", 10)
    c.drawString(LEFT + 5 * mm, band_y + 9 * mm, folio_fiscal)

    # metadatos a la derecha
    def _kv(x, top, k, v):
        c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica", 7)
        c.drawString(x, top, k)
        c.setFillColorRGB(0.06, 0.09, 0.16); c.setFont("Helvetica-Bold", 9)
        c.drawString(x, top - 4 * mm, v)

    _kv(LEFT + 105 * mm, band_y + 14 * mm, "MONEDA", payload.get("moneda", "MXN"))
    _kv(LEFT + 125 * mm, band_y + 14 * mm, "FORMA PAGO", payload.get("forma_pago", "01"))
    _kv(LEFT + 150 * mm, band_y + 14 * mm, "MÉTODO", payload.get("metodo_pago", "PUE"))
    _kv(RIGHT - 20 * mm, band_y + 14 * mm, "USO CFDI", (receptor.get("uso_cfdi") or "G03"))

    # ── RECEPTOR ────────────────────────────────────────────────────
    rec_y = band_y - 8 * mm
    c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT, rec_y, "RECEPTOR")
    c.setStrokeColorRGB(0.86, 0.88, 0.92); c.setLineWidth(0.4)
    c.line(LEFT + 22 * mm, rec_y + 1, RIGHT, rec_y + 1)

    rec_y -= 6 * mm
    c.setFillColorRGB(0.06, 0.09, 0.16); c.setFont("Helvetica-Bold", 11)
    c.drawString(LEFT, rec_y, (receptor.get("nombre") or "PÚBLICO EN GENERAL")[:80])
    rec_y -= 4.5 * mm
    c.setFont("Helvetica", 9); c.setFillColorRGB(0.35, 0.40, 0.48)
    c.drawString(LEFT, rec_y,
                  f"RFC {receptor.get('rfc','XAXX010101000')}   ·   "
                  f"Régimen {receptor.get('regimen_fiscal','616')}   ·   "
                  f"CP {receptor.get('codigo_postal','00000')}")

    # ── RELACIONADOS (NC) ───────────────────────────────────────────
    rel = payload.get("cfdi_relacionados") or {}
    y_after_rec = rec_y - 8 * mm
    if rel and rel.get("uuids"):
        c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Bold", 8)
        c.drawString(LEFT, y_after_rec, f"CFDI RELACIONADO  ·  Tipo {rel.get('tipo_relacion','01')}")
        y_after_rec -= 5 * mm
        c.setFont("Courier", 9); c.setFillColorRGB(0.06, 0.09, 0.16)
        for u in rel["uuids"][:3]:
            c.drawString(LEFT, y_after_rec, u)
            y_after_rec -= 4 * mm

    # ── CONCEPTOS ───────────────────────────────────────────────────
    y = y_after_rec - 6 * mm
    c.setFillColorRGB(br, bg, bb)
    c.rect(LEFT, y - 6 * mm, RIGHT - LEFT, 6 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica-Bold", 8)
    c.drawString(LEFT + 3 * mm, y - 4 * mm, "CANT")
    c.drawString(LEFT + 16 * mm, y - 4 * mm, "CLAVE SAT")
    c.drawString(LEFT + 38 * mm, y - 4 * mm, "DESCRIPCIÓN")
    c.drawRightString(RIGHT - 30 * mm, y - 4 * mm, "P. UNITARIO")
    c.drawRightString(RIGHT - 3 * mm, y - 4 * mm, "IMPORTE")
    y -= 8 * mm

    c.setFont("Helvetica", 9)
    zebra = False
    for it in (payload.get("conceptos") or [])[:25]:
        if zebra:
            c.setFillColorRGB(0.98, 0.98, 0.99)
            c.rect(LEFT, y - 4.5 * mm, RIGHT - LEFT, 6.5 * mm, stroke=0, fill=1)
        zebra = not zebra
        c.setFillColorRGB(0.06, 0.09, 0.16)
        c.drawString(LEFT + 3 * mm, y - 1 * mm, f"{it.get('cantidad', 1)}")
        c.setFont("Courier", 8); c.setFillColorRGB(0.35, 0.40, 0.48)
        c.drawString(LEFT + 16 * mm, y - 1 * mm, str(it.get("clave_prod_serv", "01010101")))
        c.setFont("Helvetica", 9); c.setFillColorRGB(0.06, 0.09, 0.16)
        c.drawString(LEFT + 38 * mm, y - 1 * mm, str(it.get("descripcion", ""))[:55])
        c.drawRightString(RIGHT - 30 * mm, y - 1 * mm, f"${float(it.get('valor_unitario', 0)):,.2f}")
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(RIGHT - 3 * mm, y - 1 * mm, f"${float(it.get('importe', 0)):,.2f}")
        c.setFont("Helvetica", 9)
        y -= 6.5 * mm
        if y < 70 * mm:
            break

    # ── TOTALES ─────────────────────────────────────────────────────
    y -= 4 * mm
    c.setStrokeColorRGB(0.86, 0.88, 0.92); c.setLineWidth(0.4)
    c.line(LEFT + 100 * mm, y, RIGHT, y)
    y -= 5 * mm

    def _tot(label, val, bold=False, big=False):
        nonlocal y
        c.setFillColorRGB(0.42, 0.45, 0.50)
        c.setFont("Helvetica" if not bold else "Helvetica-Bold", 11 if big else 9)
        c.drawRightString(RIGHT - 35 * mm, y, label)
        c.setFillColorRGB(0.06, 0.09, 0.16)
        c.setFont("Helvetica-Bold" if bold or big else "Helvetica", 11 if big else 9)
        c.drawRightString(RIGHT - 3 * mm, y, f"${float(val):,.2f}")
        y -= (5.5 * mm if big else 4.5 * mm)

    _tot("Subtotal", payload.get("subtotal", 0))
    imp = (payload.get("impuestos") or {}).get("total_traslados_impuestos", 0)
    if imp:
        _tot("IVA", imp)
    y -= 1 * mm
    c.setFillColorRGB(br, bg, bb); c.setLineWidth(0.6)
    c.line(LEFT + 100 * mm, y + 3, RIGHT, y + 3)
    _tot("TOTAL", payload.get("total", 0), big=True)

    # ── SELLOS + QR ─────────────────────────────────────────────────
    sellos_y = 42 * mm
    c.setStrokeColorRGB(0.86, 0.88, 0.92); c.setLineWidth(0.4)
    c.line(LEFT, sellos_y + 20 * mm, RIGHT, sellos_y + 20 * mm)

    c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 17 * mm, "SELLO DIGITAL DEL CFD")
    c.setFillColorRGB(0.06, 0.09, 0.16); c.setFont("Courier", 6.5)
    c.drawString(LEFT, sellos_y + 13.5 * mm, "MOCK_SELLO_CFD_NO_VALIDO_PARA_SAT" + ("_" * 40))

    c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 9 * mm, "SELLO DIGITAL DEL SAT")
    c.setFillColorRGB(0.06, 0.09, 0.16); c.setFont("Courier", 6.5)
    c.drawString(LEFT, sellos_y + 5.5 * mm, "MOCK_SELLO_SAT_NO_VALIDO" + ("_" * 40))

    c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 1 * mm, "No. Certificado SAT")
    c.setFillColorRGB(0.06, 0.09, 0.16); c.setFont("Courier", 7)
    c.drawString(LEFT + 32 * mm, sellos_y + 1 * mm, "00000000000000000000")

    # QR (formato SAT: URL de validación con re, rr, tt, id)
    try:
        from reportlab.graphics.barcode.qr import QrCodeWidget
        from reportlab.graphics.shapes import Drawing
        from reportlab.graphics import renderPDF
        qr_data = (
            f"https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?"
            f"&id={folio_fiscal}"
            f"&re={emisor.get('rfc','')}"
            f"&rr={receptor.get('rfc','')}"
            f"&tt={float(payload.get('total', 0)):017.6f}"
        )
        qr = QrCodeWidget(qr_data, barLevel="M")
        bounds = qr.getBounds()
        qw, qh = bounds[2] - bounds[0], bounds[3] - bounds[1]
        size = 28 * mm
        d = Drawing(size, size, transform=[size / qw, 0, 0, size / qh, 0, 0])
        d.add(qr)
        renderPDF.draw(d, c, RIGHT - size, sellos_y)
    except Exception:
        pass

    # ── LEYENDA OFICIAL + FOOTER ────────────────────────────────────
    c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica-Oblique", 7)
    c.drawString(LEFT, 22 * mm,
                  "Este documento es una representación impresa de un CFDI 4.0")
    c.setFillColorRGB(0.75, 0.29, 0.29); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, 18 * mm,
                  "MODO PRUEBA · Comprobante generado localmente — no válido ante el SAT.")
    if footer:
        c.setFillColorRGB(0.42, 0.45, 0.50); c.setFont("Helvetica", 7)
        c.drawString(LEFT, 14 * mm, footer[:130])

    # Pie de pagina fino con banda
    c.setFillColorRGB(br, bg, bb)
    c.rect(0, 0, W, 4, stroke=0, fill=1)
    c.setFillColorRGB(0.55, 0.58, 0.63); c.setFont("Helvetica", 6.5)
    c.drawRightString(RIGHT, 8 * mm,
                       f"STHENOVA ERP · CFDI 4.0 · Página 1 de 1 · {datetime.utcnow().strftime('%Y-%m-%d')}")

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
