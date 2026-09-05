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


def _mix(a, b, t=0.5):
    """Interpola dos triples RGB — util para tintes suaves del brand color."""
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def _optimize_logo(logo_bytes: bytes, max_dim: int = 240) -> bytes:
    """Baja la resolucion del logo antes de embeberlo, para que el PDF
    no pese 2MB. Usa Pillow si esta; si no, devuelve el original."""
    if not logo_bytes:
        return logo_bytes
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(logo_bytes))
        im.thumbnail((max_dim, max_dim))
        out = io.BytesIO()
        # PNG con transparencia si el original lo era; JPEG en caso contrario
        fmt = "PNG" if im.mode in ("RGBA", "LA", "P") else "JPEG"
        im.save(out, format=fmt, optimize=True, quality=85)
        return out.getvalue()
    except Exception:
        return logo_bytes


_UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
             "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS",
             "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE"]
_DECENAS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA",
            "OCHENTA", "NOVENTA"]
_CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
             "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"]


def _num_letters(n: int) -> str:
    if n == 0:
        return "CERO"
    if n <= 20:
        return _UNIDADES[n]
    if n < 30:
        return "VEINTI" + _UNIDADES[n - 20]
    if n < 100:
        d, u = divmod(n, 10)
        return _DECENAS[d] + (" Y " + _UNIDADES[u] if u else "")
    if n == 100:
        return "CIEN"
    if n < 1000:
        c, r = divmod(n, 100)
        return _CENTENAS[c] + (" " + _num_letters(r) if r else "")
    if n < 1_000_000:
        miles, r = divmod(n, 1000)
        pre = "UN MIL" if miles == 1 else (_num_letters(miles) + " MIL")
        return pre + (" " + _num_letters(r) if r else "")
    millones, r = divmod(n, 1_000_000)
    pre = "UN MILLÓN" if millones == 1 else (_num_letters(millones) + " MILLONES")
    return pre + (" " + _num_letters(r) if r else "")


def _amount_in_words(amount: float, currency: str = "MXN") -> str:
    """'71635.00 MXN' -> 'SETENTA Y UN MIL SEISCIENTOS TREINTA Y CINCO PESOS 00/100 M.N.'"""
    entero = int(amount)
    cents = int(round((amount - entero) * 100))
    label = "PESOS" if currency == "MXN" else currency
    suffix = "M.N." if currency == "MXN" else ""
    return f"{_num_letters(entero)} {label} {cents:02d}/100 {suffix}".strip()


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
    logo_bytes = _optimize_logo(branding.get("logo_bytes"))
    brand_color = branding.get("brand_color") or "#0F172A"
    footer = branding.get("footer") or ""
    br, bg, bb = _hex_to_rgb(brand_color)
    brand = (br, bg, bb)
    # tintes derivados del color de marca — para bandas suaves y acentos
    brand_tint = _mix(brand, (1, 1, 1), 0.92)   # muy claro
    brand_soft = _mix(brand, (1, 1, 1), 0.78)   # medio
    ink = (0.06, 0.09, 0.16)     # slate-900
    ink_mid = (0.35, 0.40, 0.48)  # slate-500
    ink_lo = (0.55, 0.58, 0.63)   # slate-400
    hair = (0.89, 0.91, 0.94)     # divider hairline

    emisor = payload.get("emisor") or {}
    receptor = payload.get("receptor") or {}
    tipo = payload.get("tipo_comprobante", "I")
    tipo_label = "NOTA DE CRÉDITO" if tipo == "E" else "FACTURA"
    tipo_sub = "Egreso · CFDI 4.0" if tipo == "E" else "Ingreso · CFDI 4.0"

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    W, H = letter
    LEFT, RIGHT = 15 * mm, W - 15 * mm

    # ── HEADER premium: barra fina + zona con logo grande y titulo ─
    c.setFillColorRGB(*brand)
    c.rect(0, H - 5, W, 5, stroke=0, fill=1)

    header_top = H - 15 * mm
    # Logo (izquierda) — reducido -10%: 38mm x 25mm
    LOGO_MAX_W, LOGO_MAX_H = 38 * mm, 25 * mm
    logo_h = 0
    logo_w = 0
    if logo_bytes:
        try:
            img = ImageReader(io.BytesIO(logo_bytes))
            iw, ih = img.getSize()
            rr = min(LOGO_MAX_W / iw, LOGO_MAX_H / ih)
            logo_w, logo_h = iw * rr, ih * rr
            c.drawImage(img, LEFT, header_top - logo_h, width=logo_w, height=logo_h,
                        mask="auto", preserveAspectRatio=True)
        except Exception:
            pass

    # Emisor: A LA DERECHA DEL LOGO, centrado verticalmente con el logo
    emi_x = LEFT + (logo_w if logo_w else 0) + 6 * mm   # gap 6mm despues del logo
    # Contar cuantas lineas se van a dibujar para calcular altura total y centrar
    emi_lines = []
    emi_lines.append(("Helvetica-Bold", 11, ink,
                       (emisor.get("nombre_comercial") or emisor.get("nombre") or "EMISOR")[:40]))
    if emisor.get("nombre") and emisor.get("nombre_comercial") and emisor["nombre"] != emisor["nombre_comercial"]:
        emi_lines.append(("Helvetica", 7.5, ink_mid, emisor["nombre"][:55]))
    if emisor.get("rfc"):
        emi_lines.append(("Helvetica", 7.5, ink_mid,
                           f"RFC {emisor['rfc']}   ·   Régimen {emisor.get('regimen_fiscal','')}"))
    if emisor.get("domicilio"):
        emi_lines.append(("Helvetica", 7.5, ink_mid, emisor["domicilio"][:70]))
    contact = "   ·   ".join([x for x in [emisor.get("telefono"), emisor.get("email")] if x])
    if contact:
        emi_lines.append(("Helvetica", 7.5, ink_mid, contact[:70]))

    # Altura total del bloque emisor: primera linea 4.2mm de leading + 3.4mm cada extra
    emi_total_h = 4.2 * mm + max(0, len(emi_lines) - 1) * 3.4 * mm
    # Logo va de header_top (top) a header_top - logo_h (bottom). Centro del logo:
    logo_center_y = header_top - (logo_h if logo_h else LOGO_MAX_H) / 2
    # Colocar emisor centrado en el mismo centro: primera linea baseline
    ey = logo_center_y + (emi_total_h / 2) - 3.5 * mm  # -3.5mm compensa el ascender de 11pt
    for font, size, color, text in emi_lines:
        c.setFillColorRGB(*color); c.setFont(font, size)
        c.drawString(emi_x, ey, text)
        ey -= 4.2 * mm if font == "Helvetica-Bold" else 3.4 * mm

    # Titulo derecha (compacto y bien espaciado)
    serie = payload.get("serie", "F"); serie_folio = f"Serie {serie}   ·   Folio {payload.get('folio', '')}"
    c.setFillColorRGB(*ink); c.setFont("Helvetica-Bold", 16)
    c.drawRightString(RIGHT, header_top - 6 * mm, tipo_label)
    c.setFont("Helvetica", 8.5); c.setFillColorRGB(*brand)
    c.drawRightString(RIGHT, header_top - 11 * mm, tipo_sub)

    # Chip serie/folio: ancho justo al texto, con MARGEN VERTICAL claro
    from reportlab.pdfbase.pdfmetrics import stringWidth as _sw2
    sf_w = _sw2(serie_folio, "Helvetica-Bold", 9.5) + 10 * mm
    chip_bottom = header_top - 22 * mm
    chip_h = 7 * mm
    c.setFillColorRGB(*brand_tint)
    c.roundRect(RIGHT - sf_w, chip_bottom, sf_w, chip_h, 2, stroke=0, fill=1)
    c.setFillColorRGB(*ink); c.setFont("Helvetica-Bold", 9.5)
    c.drawRightString(RIGHT - 5 * mm, chip_bottom + 2.3 * mm, serie_folio)
    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica", 7.5)
    c.drawRightString(RIGHT, chip_bottom - 3.5 * mm,
                       datetime.utcnow().strftime("%d %b %Y · %H:%M UTC").upper())

    # Cursor y para lo que sigue: bajo el bloque logo/emisor
    y = header_top - max(logo_h, LOGO_MAX_H) - 6 * mm

    # ── BANDA FISCAL: UUID + metadatos ──────────────────────────────
    band_y = y - 8 * mm - 20 * mm
    c.setFillColorRGB(*brand_tint)
    c.rect(LEFT, band_y, RIGHT - LEFT, 20 * mm, stroke=0, fill=1)
    # Franja lateral gruesa color de marca
    c.setFillColorRGB(*brand)
    c.rect(LEFT, band_y, 1.6 * mm, 20 * mm, stroke=0, fill=1)

    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica", 7)
    c.drawString(LEFT + 6 * mm, band_y + 15 * mm, "FOLIO FISCAL · UUID")
    c.setFillColorRGB(*ink); c.setFont("Courier-Bold", 11)
    c.drawString(LEFT + 6 * mm, band_y + 9 * mm, folio_fiscal)
    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica", 7)
    c.drawString(LEFT + 6 * mm, band_y + 4 * mm,
                  f"Lugar de expedición: {payload.get('lugar_expedicion','00000')}   ·   "
                  f"Tipo comprobante: {tipo}")

    def _kv_right(x_right, top, k, v):
        """KV alineado a la derecha para que 4 columnas quepan sin encimar."""
        c.setFillColorRGB(*ink_mid); c.setFont("Helvetica", 6.8)
        c.drawRightString(x_right, top, k)
        c.setFillColorRGB(*ink); c.setFont("Helvetica-Bold", 10)
        c.drawRightString(x_right, top - 5 * mm, v)

    # 4 columnas espaciadas 22mm entre bordes derechos, con padding 5mm
    # del borde derecho para que USO CFDI no quede pegado al margen.
    _r = RIGHT - 5 * mm
    _kv_right(_r,               band_y + 15 * mm, "USO CFDI",   (receptor.get("uso_cfdi") or "G03"))
    _kv_right(_r - 22 * mm,     band_y + 15 * mm, "MÉTODO",     payload.get("metodo_pago", "PUE"))
    _kv_right(_r - 44 * mm,     band_y + 15 * mm, "FORMA PAGO", payload.get("forma_pago", "01"))
    _kv_right(_r - 68 * mm,     band_y + 15 * mm, "MONEDA",     payload.get("moneda", "MXN"))

    # ── RECEPTOR: card sobria ───────────────────────────────────────
    rec_y = band_y - 4 * mm
    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7.5)
    c.drawString(LEFT, rec_y, "FACTURAR A")
    c.setStrokeColorRGB(*hair); c.setLineWidth(0.4)
    c.line(LEFT + 22 * mm, rec_y + 1, RIGHT, rec_y + 1)

    rec_y -= 6 * mm
    c.setFillColorRGB(*ink); c.setFont("Helvetica-Bold", 12)
    c.drawString(LEFT, rec_y, (receptor.get("nombre") or "PÚBLICO EN GENERAL")[:80])
    rec_y -= 4.8 * mm
    c.setFont("Helvetica", 9); c.setFillColorRGB(*ink_mid)
    c.drawString(LEFT, rec_y,
                  f"RFC {receptor.get('rfc','XAXX010101000')}   ·   "
                  f"Régimen {receptor.get('regimen_fiscal','616')}   ·   "
                  f"CP {receptor.get('codigo_postal','00000')}")

    # Relacionados (NC)
    rel = payload.get("cfdi_relacionados") or {}
    y_after_rec = rec_y - 6 * mm
    if rel and rel.get("uuids"):
        c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7.5)
        c.drawString(LEFT, y_after_rec, f"CFDI RELACIONADO · Tipo {rel.get('tipo_relacion','01')}")
        y_after_rec -= 5 * mm
        c.setFont("Courier", 9); c.setFillColorRGB(*ink)
        for u in rel["uuids"][:3]:
            c.drawString(LEFT, y_after_rec, u)
            y_after_rec -= 4 * mm

    # ── CONCEPTOS: header con brand + zebra sutil + wrap por palabra ──
    y = y_after_rec - 8 * mm
    c.setFillColorRGB(*brand)
    c.rect(LEFT, y - 7 * mm, RIGHT - LEFT, 7 * mm, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1); c.setFont("Helvetica-Bold", 8)
    # Columnas (ajustadas para dar mas aire a DESCRIPCION):
    #   CANT | SKU | CLAVE SAT | DESCRIPCION (wrap) | UNIDAD | P.UNITARIO | IMPORTE
    COL_CANT = LEFT + 3 * mm
    COL_SKU = LEFT + 12 * mm
    COL_CLAVE = LEFT + 44 * mm     # +6mm: da 32mm al SKU para caber sin encimar
    COL_DESC = LEFT + 64 * mm
    COL_UNIT_R = RIGHT - 52 * mm   # right-edge de UNIDAD (label + valor right-aligned)
    COL_PU = RIGHT - 28 * mm
    COL_IMP = RIGHT - 3 * mm
    DESC_MAX_W = COL_UNIT_R - COL_DESC - 12 * mm  # gap visual generoso antes de UNIDAD

    row_top = y - 4.5 * mm
    c.drawString(COL_CANT, row_top, "CANT")
    c.drawString(COL_SKU, row_top, "SKU")
    c.drawString(COL_CLAVE, row_top, "CLAVE SAT")
    c.drawString(COL_DESC, row_top, "DESCRIPCIÓN")
    c.drawRightString(COL_UNIT_R, row_top, "UNIDAD")
    c.drawRightString(COL_PU, row_top, "P. UNITARIO")
    c.drawRightString(COL_IMP, row_top, "IMPORTE")
    y -= 9 * mm

    from reportlab.pdfbase.pdfmetrics import stringWidth as _sw

    def _wrap(text: str, max_w: float, font: str = "Helvetica", size: float = 8.5) -> list:
        """Envuelve `text` en varias lineas para no exceder max_w. Divide
        por palabras; si una palabra sola no cabe, la parte por caracteres."""
        words = str(text).split()
        lines, cur = [], ""
        for w in words:
            probe = (cur + " " + w).strip()
            if _sw(probe, font, size) <= max_w:
                cur = probe
                continue
            # w no cabe con lo que hay: guardar lo acumulado y probar sola
            if cur:
                lines.append(cur)
                cur = ""
            if _sw(w, font, size) <= max_w:
                cur = w
            else:
                # partir palabra excesivamente larga por caracteres
                chunk = ""
                for ch in w:
                    if _sw(chunk + ch, font, size) <= max_w:
                        chunk += ch
                    else:
                        lines.append(chunk); chunk = ch
                cur = chunk
        if cur:
            lines.append(cur)
        return lines or [""]

    c.setFont("Helvetica", 8.5); zebra = False
    conceptos = (payload.get("conceptos") or [])[:40]
    LINE_H = 4.0 * mm
    ROW_PAD = 2.2 * mm  # margen vertical dentro de la fila

    for it in conceptos:
        desc_lines = _wrap(str(it.get("descripcion", "")), DESC_MAX_W)
        row_h = max(6.5 * mm, ROW_PAD * 2 + LINE_H * len(desc_lines))
        # zebra
        if zebra:
            c.setFillColorRGB(*brand_tint)
            c.rect(LEFT, y - row_h + 0.5 * mm, RIGHT - LEFT, row_h, stroke=0, fill=1)
        zebra = not zebra

        # texto de las columnas simples alineado al TOP de la fila
        text_y = y - ROW_PAD
        c.setFillColorRGB(*ink); c.setFont("Helvetica-Bold", 9)
        c.drawString(COL_CANT, text_y, f"{it.get('cantidad', 1)}")
        c.setFont("Courier-Bold", 8.5); c.setFillColorRGB(*brand)
        # Truncar SKU por ANCHO real, no chars: si excede el hueco SKU-CLAVE
        # se le agrega elipsis. Evita cualquier encimado con la columna CLAVE.
        _sku_txt = str(it.get("sku") or "—")
        _sku_max = COL_CLAVE - COL_SKU - 2 * mm
        while _sku_txt and _sw(_sku_txt, "Courier-Bold", 8.5) > _sku_max:
            _sku_txt = _sku_txt[:-1]
            if _sw(_sku_txt + "…", "Courier-Bold", 8.5) <= _sku_max:
                _sku_txt = _sku_txt + "…"
                break
        c.drawString(COL_SKU, text_y, _sku_txt)
        c.setFont("Courier", 7.5); c.setFillColorRGB(*ink_mid)
        c.drawString(COL_CLAVE, text_y, str(it.get("clave_prod_serv", "01010101")))
        c.setFont("Helvetica", 8); c.setFillColorRGB(*ink_mid)
        c.drawRightString(COL_UNIT_R, text_y, str(it.get("unidad", "Pieza"))[:14])
        c.setFont("Helvetica", 9); c.setFillColorRGB(*ink)
        c.drawRightString(COL_PU, text_y, f"${float(it.get('valor_unitario', 0)):,.2f}")
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(COL_IMP, text_y, f"${float(it.get('importe', 0)):,.2f}")

        # descripcion multilinea
        c.setFont("Helvetica", 8.5); c.setFillColorRGB(*ink)
        line_y = text_y
        for ln in desc_lines:
            c.drawString(COL_DESC, line_y, ln)
            line_y -= LINE_H

        y -= row_h
        if y < 90 * mm:
            break

    # ── TOTALES: bloque a la derecha con jerarquia clara ────────────
    y -= 5 * mm
    c.setStrokeColorRGB(*hair); c.setLineWidth(0.4)
    c.line(LEFT + 100 * mm, y, RIGHT, y)
    y -= 5.5 * mm

    def _tot(label, val, big=False):
        nonlocal y
        c.setFillColorRGB(*ink_mid)
        c.setFont("Helvetica", 12 if big else 9)
        c.drawRightString(RIGHT - 40 * mm, y, label)
        c.setFillColorRGB(*ink)
        c.setFont("Helvetica-Bold", 13 if big else 9)
        c.drawRightString(RIGHT - 3 * mm, y, f"${float(val):,.2f}")
        y -= (6.5 * mm if big else 4.8 * mm)

    _tot("Subtotal", payload.get("subtotal", 0))
    imp = (payload.get("impuestos") or {}).get("total_traslados_impuestos", 0)
    if imp:
        _tot("IVA 16%", imp)
    # Linea separadora ANTES del total, con aire arriba y abajo.
    y -= 2 * mm
    c.setFillColorRGB(*brand); c.setLineWidth(0.8)
    c.line(LEFT + 100 * mm, y, RIGHT, y)
    y -= 6 * mm  # aire entre la linea y el baseline de TOTAL (13pt bold ~ 4.6mm alto)
    _tot("TOTAL " + (payload.get("moneda") or "MXN"), payload.get("total", 0), big=True)

    # Importe con letra (requisito SAT)
    words = _amount_in_words(float(payload.get("total", 0)), payload.get("moneda", "MXN"))
    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, y, "IMPORTE CON LETRA")
    c.setFillColorRGB(*ink); c.setFont("Helvetica", 9)
    # Envolver a dos líneas si es muy largo
    max_chars = 90
    if len(words) <= max_chars:
        c.drawString(LEFT, y - 5 * mm, words)
    else:
        cut = words.rfind(" ", 0, max_chars)
        c.drawString(LEFT, y - 5 * mm, words[:cut])
        c.drawString(LEFT, y - 9 * mm, words[cut + 1:])

    # ── SELLOS + QR ─────────────────────────────────────────────────
    sellos_y = 42 * mm
    c.setStrokeColorRGB(*hair); c.setLineWidth(0.4)
    c.line(LEFT, sellos_y + 22 * mm, RIGHT, sellos_y + 22 * mm)

    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 18 * mm, "SELLO DIGITAL DEL CFD")
    c.setFillColorRGB(*ink); c.setFont("Courier", 6.5)
    c.drawString(LEFT, sellos_y + 14 * mm, "MOCK_SELLO_CFD_NO_VALIDO_PARA_SAT" + ("_" * 40))

    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 9.5 * mm, "SELLO DIGITAL DEL SAT")
    c.setFillColorRGB(*ink); c.setFont("Courier", 6.5)
    c.drawString(LEFT, sellos_y + 5.5 * mm, "MOCK_SELLO_SAT_NO_VALIDO" + ("_" * 40))

    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, sellos_y + 1 * mm, "No. CERTIFICADO SAT")
    c.setFillColorRGB(*ink); c.setFont("Courier", 7)
    c.drawString(LEFT + 34 * mm, sellos_y + 1 * mm, "00000000000000000000")

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
        size = 26 * mm
        d = Drawing(size, size, transform=[size / qw, 0, 0, size / qh, 0, 0])
        d.add(qr)
        renderPDF.draw(d, c, RIGHT - size, sellos_y - 2 * mm)
    except Exception:
        pass

    # ── LEYENDA OFICIAL + FOOTER ────────────────────────────────────
    c.setFillColorRGB(*ink_mid); c.setFont("Helvetica-Oblique", 7)
    c.drawString(LEFT, 22 * mm,
                  "Este documento es una representación impresa de un CFDI 4.0")
    c.setFillColorRGB(0.75, 0.29, 0.29); c.setFont("Helvetica-Bold", 7)
    c.drawString(LEFT, 18 * mm,
                  "MODO PRUEBA · Comprobante generado localmente — no válido ante el SAT.")
    if footer:
        c.setFillColorRGB(*ink_mid); c.setFont("Helvetica", 7)
        c.drawString(LEFT, 14 * mm, footer[:130])

    # Pie de página fino con banda color de marca
    c.setFillColorRGB(*brand); c.rect(0, 0, W, 4, stroke=0, fill=1)
    c.setFillColorRGB(*ink_lo); c.setFont("Helvetica", 6.5)
    c.drawRightString(RIGHT, 8 * mm,
                       f"CFDI 4.0 · Página 1 de 1 · {datetime.utcnow().strftime('%Y-%m-%d')}")

    c.showPage(); c.save()
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
