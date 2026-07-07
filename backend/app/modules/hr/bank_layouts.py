"""Generadores de layouts bancarios para dispersión de nómina.

Cada banco de México publica un layout propio (fixed-width TXT) para importar
pagos masivos vía su portal de banca en línea empresarial. Estos layouts son
los estándar de uso público documentado por cada banco para su producto de
"Pago de Nómina" o "Pago Masivo Interbancario (SPEI)".

IMPORTANTE — recomendación operativa:
  Los layouts oficiales de cada banco pueden variar según:
    · Versión/producto contratado (Nómina Interna vs. Pago Interbancario)
    · Fecha de vigencia de la especificación
    · Contrato específico con el cliente
  Antes de subir un archivo a producción por primera vez con un banco nuevo,
  valida el layout con tu ejecutivo de cuenta. Los layouts implementados aquí
  siguen las especificaciones públicas más comunes; para casos particulares
  puedes ajustarlos en este archivo sin tocar el resto del código.

Sobre la validación de CLABE:
  La CLABE (Clave Bancaria Estandarizada) es 18 dígitos con un dígito
  verificador módulo 100. Se valida antes de generar el archivo para evitar
  que la banca en línea rechace todo el lote por un solo dígito mal capturado.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Optional


# ── Validación de CLABE ─────────────────────────────────────────────────────

_CLABE_WEIGHTS = [3, 7, 1] * 6  # 18 posiciones: 3,7,1,3,7,1,...


def validate_clabe(clabe: Optional[str]) -> tuple[bool, Optional[str]]:
    """Valida la CLABE mexicana. Devuelve (es_valida, mensaje_de_error)."""
    if not clabe:
        return False, "CLABE vacía"
    s = "".join(c for c in str(clabe) if c.isdigit())
    if len(s) != 18:
        return False, f"CLABE debe tener 18 dígitos (tiene {len(s)})"
    check = int(s[-1])
    total = sum(int(s[i]) * _CLABE_WEIGHTS[i] for i in range(17))
    expected = (10 - (total % 10)) % 10
    if check != expected:
        return False, "Dígito verificador de la CLABE es incorrecto"
    return True, None


def clabe_bank_code(clabe: str) -> str:
    """Los primeros 3 dígitos de la CLABE son el código del banco."""
    s = "".join(c for c in str(clabe) if c.isdigit())
    return s[:3] if len(s) >= 3 else ""


# Códigos SPEI oficiales de banco (SPEI/CLABE)
BANK_CODES = {
    "BBVA": "012",
    "Banorte": "072",
    "Santander": "014",
    "HSBC": "021",
    "Banamex": "002",
    "Citibanamex": "002",
    "Scotiabank": "044",
    "Inbursa": "036",
    "Banregio": "058",
    "Azteca": "127",
}

# Bancos con layout implementado (el usuario descarga uno específico por banco)
SUPPORTED_BANKS = ["BBVA", "Banorte", "Santander", "HSBC", "Banamex", "SPEI"]


# ── Datos de entrada ─────────────────────────────────────────────────────────

@dataclass
class DispersionRow:
    """Un renglón por empleado listo para incluirse en el layout."""
    employee_number: str
    full_name: str
    rfc: str
    clabe: str
    amount: float               # importe neto a depositar
    reference: str = ""         # referencia interna (opcional)
    concept: str = ""           # concepto del pago
    bank: str = ""              # nombre del banco (solo informativo)


@dataclass
class DispersionValidation:
    row: DispersionRow
    ok: bool
    reasons: List[str]


def validate_rows(rows: List[DispersionRow]) -> List[DispersionValidation]:
    """Marca cada renglón como listo o con motivos por los que la banca lo
    rechazaría. Nunca falla — devuelve la lista con las razones para que la
    UI las muestre al operador antes de generar el archivo."""
    out: List[DispersionValidation] = []
    for r in rows:
        reasons: List[str] = []
        if not r.full_name.strip():
            reasons.append("Falta nombre del empleado")
        if not r.rfc.strip():
            reasons.append("Falta RFC")
        ok_clabe, err = validate_clabe(r.clabe)
        if not ok_clabe:
            reasons.append(f"CLABE: {err}")
        if (r.amount or 0.0) <= 0:
            reasons.append("Importe debe ser mayor a cero")
        out.append(DispersionValidation(row=r, ok=len(reasons) == 0, reasons=reasons))
    return out


# ── Utilidades de layout ─────────────────────────────────────────────────────

def _pad_left(s: str, width: int, fill: str = "0") -> str:
    return str(s)[:width].rjust(width, fill)


def _pad_right(s: str, width: int, fill: str = " ") -> str:
    s = str(s or "")
    return s[:width].ljust(width, fill)


def _amount_no_decimal(amount: float, width: int) -> str:
    """Convierte 1234.56 → '000000000123456' (centavos incluidos, sin punto)."""
    cents = int(round((amount or 0.0) * 100))
    return _pad_left(str(cents), width)


def _amount_with_decimal(amount: float, width: int) -> str:
    """Convierte 1234.56 → '        1234.56' (con punto, alineado a la derecha con espacios)."""
    s = f"{(amount or 0.0):.2f}"
    return s.rjust(width)


def _sanitize(name: str) -> str:
    """Normaliza texto: mayúsculas, sin acentos ni caracteres especiales.
    Muchos bancos rechazan Ñ y acentos en el archivo."""
    if not name:
        return ""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", str(name))
    ascii_ = nfkd.encode("ascii", "ignore").decode("ascii")
    return "".join(c if c.isalnum() or c == " " else " " for c in ascii_).upper().strip()


def _today_ddmmyy() -> str:
    return date.today().strftime("%d%m%y")


def _today_yymmdd() -> str:
    return date.today().strftime("%y%m%d")


def _today_yyyymmdd() -> str:
    return date.today().strftime("%Y%m%d")


# ── BBVA — Layout Pago Interbancario / Nómina H2H ────────────────────────────
# Estructura: 01 Cabecera + N x 02 Detalle + 03 Trailer. Longitud fija 240.
# Basado en la especificación pública "BBVA Nómina - Layout Estándar".

BBVA_LINE_WIDTH = 240


def bbva_layout(rows: List[DispersionRow], origin_account: str, lote_number: str,
                payment_date: Optional[date] = None) -> str:
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    total_cents = int(round(sum(r.amount for r in valid) * 100))
    date_str = payment_date.strftime("%d%m%Y")

    lines: List[str] = []

    # 01 CABECERA
    header = (
        "01"                                          # 2  tipo
        + _pad_right("H", 1)                         # 1  tipo mov (H = nómina)
        + _pad_right(origin_account, 18)              # 18 cuenta cargo (CLABE)
        + _pad_left(lote_number, 7)                   # 7  número de lote
        + date_str                                    # 8  fecha aplicación DDMMAAAA
        + _pad_left(str(len(valid)), 7)               # 7  cantidad de operaciones
        + _pad_left(str(total_cents), 15)             # 15 importe total sin decimales
        + _pad_right("MXN", 3)                       # 3  moneda
        + _pad_right("STHENOVA ERP - NOMINA", 40)    # 40 descripción del lote
    )
    lines.append(_pad_right(header, BBVA_LINE_WIDTH))

    # 02 DETALLE (uno por empleado)
    for i, r in enumerate(valid, start=1):
        detail = (
            "02"                                              # 2
            + _pad_left(str(i), 7)                            # 7  secuencia
            + _pad_left(BANK_CODES.get("BBVA", "012"), 3)     # 3  banco destino
            + _pad_right(r.clabe, 18)                        # 18 CLABE destino
            + _pad_left(_amount_no_decimal(r.amount, 15), 15) # 15 importe sin decimales
            + _pad_right(_sanitize(r.full_name), 40)         # 40 nombre beneficiario
            + _pad_right(_sanitize(r.rfc), 13)               # 13 RFC
            + _pad_right(_sanitize(r.concept or "NOMINA"), 30) # 30 concepto
            + _pad_right(r.reference or r.employee_number, 7) # 7  referencia numérica
        )
        lines.append(_pad_right(detail, BBVA_LINE_WIDTH))

    # 03 TRAILER
    trailer = (
        "03"                                        # 2
        + _pad_left(str(len(valid)), 7)             # 7  total registros
        + _pad_left(str(total_cents), 15)           # 15 suma de importes
    )
    lines.append(_pad_right(trailer, BBVA_LINE_WIDTH))

    return "\r\n".join(lines) + "\r\n"


# ── Banorte — Layout Payroll (PDN — Pago Directo Nómina) ────────────────────
# Longitud fija 200. Un registro por empleado (sin cabecera/trailer explícitos).

def banorte_layout(rows: List[DispersionRow], origin_account: str,
                    payment_date: Optional[date] = None) -> str:
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    lines: List[str] = []
    for i, r in enumerate(valid, start=1):
        line = (
            _pad_left(str(i), 6)                          # 6   secuencia
            + _pad_right(origin_account, 18)              # 18  cuenta origen (CLABE)
            + _pad_right(r.clabe, 18)                     # 18  CLABE destino
            + _amount_with_decimal(r.amount, 15)          # 15  importe con decimales
            + _pad_right(_sanitize(r.rfc), 13)            # 13  RFC beneficiario
            + _pad_right(_sanitize(r.full_name), 60)      # 60  nombre completo
            + payment_date.strftime("%Y%m%d")             # 8   fecha aplicación
            + _pad_right(_sanitize(r.concept or "NOMINA"), 40) # 40 concepto
            + _pad_right(r.reference or r.employee_number, 22) # 22 referencia
        )
        lines.append(line)
    return "\r\n".join(lines) + "\r\n"


# ── Santander — Layout Pago Nómina Masiva (formato Santander Empresas) ──────

def santander_layout(rows: List[DispersionRow], origin_account: str,
                      payment_date: Optional[date] = None) -> str:
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    total_cents = int(round(sum(r.amount for r in valid) * 100))
    date_str = payment_date.strftime("%d%m%Y")
    lines: List[str] = []

    # H — Cabecera
    header = (
        "H"                                              # 1
        + date_str                                       # 8   fecha
        + _pad_right(origin_account, 18)                 # 18  cuenta origen
        + _pad_left(str(len(valid)), 6)                  # 6   cantidad de operaciones
        + _pad_left(str(total_cents), 15)                # 15  importe total (centavos)
        + _pad_right("STHENOVA ERP", 30)                # 30  emisor
    )
    lines.append(header)

    # D — Detalle
    for i, r in enumerate(valid, start=1):
        line = (
            "D"                                          # 1
            + _pad_left(str(i), 6)                       # 6  secuencia
            + _pad_right(r.clabe, 18)                    # 18 CLABE destino
            + _pad_left(_amount_no_decimal(r.amount, 15), 15) # 15 importe centavos
            + _pad_right(_sanitize(r.full_name), 40)     # 40 nombre
            + _pad_right(_sanitize(r.rfc), 13)           # 13 RFC
            + _pad_right(_sanitize(r.concept or "NOMINA"), 30) # 30 concepto
            + _pad_right(r.reference or r.employee_number, 12) # 12 referencia
        )
        lines.append(line)

    # T — Trailer
    trailer = "T" + _pad_left(str(len(valid)), 6) + _pad_left(str(total_cents), 15)
    lines.append(trailer)

    return "\r\n".join(lines) + "\r\n"


# ── HSBC — Layout Payments Studio (formato empresarial) ─────────────────────

def hsbc_layout(rows: List[DispersionRow], origin_account: str,
                 payment_date: Optional[date] = None) -> str:
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    lines: List[str] = []

    # Cabecera
    header = (
        _pad_right("HSBC", 4)                            # 4  banco
        + payment_date.strftime("%Y%m%d")                # 8  fecha
        + _pad_right(origin_account, 18)                 # 18 cuenta origen
        + _pad_left(str(len(valid)), 5)                  # 5  cantidad de operaciones
        + _pad_left(_amount_no_decimal(sum(r.amount for r in valid), 15), 15)
        + _pad_right("NOM", 3)                          # 3  tipo
    )
    lines.append(header)

    for i, r in enumerate(valid, start=1):
        line = (
            _pad_left(str(i), 5)                         # 5  secuencia
            + _pad_right(r.clabe, 18)                    # 18 CLABE destino
            + _pad_left(BANK_CODES.get(r.bank, clabe_bank_code(r.clabe)), 3) # 3 banco destino
            + _amount_with_decimal(r.amount, 15)         # 15 importe con decimales
            + _pad_right(_sanitize(r.full_name), 50)     # 50 nombre
            + _pad_right(_sanitize(r.rfc), 13)           # 13 RFC
            + _pad_right(_sanitize(r.concept or "NOMINA"), 30) # 30 concepto
            + _pad_right(r.reference or r.employee_number, 15) # 15 referencia
        )
        lines.append(line)

    return "\r\n".join(lines) + "\r\n"


# ── Banamex / Citibanamex — Layout Nómina Masiva Interna ────────────────────

def banamex_layout(rows: List[DispersionRow], origin_account: str,
                     payment_date: Optional[date] = None) -> str:
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    total_cents = int(round(sum(r.amount for r in valid) * 100))
    date_str = payment_date.strftime("%Y%m%d")
    lines: List[str] = []

    header = (
        "1"                                              # 1  tipo cabecera
        + date_str                                       # 8  fecha
        + _pad_right(origin_account, 18)                 # 18 cuenta origen
        + _pad_left(str(len(valid)), 6)                  # 6  cantidad de operaciones
        + _pad_left(str(total_cents), 15)                # 15 importe total centavos
        + _pad_right("STHENOVA NOM", 20)                # 20 descripción del lote
    )
    lines.append(header)

    for i, r in enumerate(valid, start=1):
        line = (
            "2"                                          # 1  tipo detalle
            + _pad_left(str(i), 6)                       # 6  secuencia
            + _pad_right(r.clabe, 18)                    # 18 CLABE destino
            + _pad_left(_amount_no_decimal(r.amount, 15), 15) # 15 importe centavos
            + _pad_right(_sanitize(r.full_name), 40)     # 40 nombre beneficiario
            + _pad_right(_sanitize(r.rfc), 13)           # 13 RFC
            + _pad_right(_sanitize(r.concept or "NOMINA"), 30) # 30 concepto
            + _pad_right(r.reference or r.employee_number, 10) # 10 referencia
        )
        lines.append(line)

    trailer = "9" + _pad_left(str(len(valid)), 6) + _pad_left(str(total_cents), 15)
    lines.append(trailer)

    return "\r\n".join(lines) + "\r\n"


# ── SPEI Genérico (formato Banxico) ─────────────────────────────────────────

def spei_layout(rows: List[DispersionRow], origin_account: str,
                 payment_date: Optional[date] = None) -> str:
    """Layout SPEI genérico que la mayoría de bancos aceptan para
    transferencias interbancarias masivas cuando no se contrató un producto
    específico de nómina interna."""
    payment_date = payment_date or date.today()
    valid = [r for r in rows if (r.amount or 0.0) > 0 and r.clabe]
    lines: List[str] = []

    for i, r in enumerate(valid, start=1):
        line = "|".join([
            str(i),
            origin_account,
            r.clabe,
            f"{r.amount:.2f}",
            _sanitize(r.full_name),
            _sanitize(r.rfc),
            _sanitize(r.concept or "Pago de nomina"),
            r.reference or r.employee_number,
            BANK_CODES.get(r.bank, clabe_bank_code(r.clabe)),
            payment_date.strftime("%Y-%m-%d"),
        ])
        lines.append(line)

    # Encabezado con nombres de columnas (útil para debugging del operador)
    header = "|".join([
        "SEQ", "CUENTA_ORIGEN_CLABE", "CUENTA_DESTINO_CLABE", "IMPORTE",
        "BENEFICIARIO", "RFC", "CONCEPTO", "REFERENCIA", "BANCO_DEST", "FECHA_APLICACION",
    ])
    return header + "\r\n" + "\r\n".join(lines) + "\r\n"


# ── Dispatcher ──────────────────────────────────────────────────────────────

LAYOUT_META = {
    "BBVA":      {"extension": "txt", "content_type": "text/plain"},
    "Banorte":   {"extension": "txt", "content_type": "text/plain"},
    "Santander": {"extension": "txt", "content_type": "text/plain"},
    "HSBC":      {"extension": "txt", "content_type": "text/plain"},
    "Banamex":   {"extension": "txt", "content_type": "text/plain"},
    "SPEI":      {"extension": "csv", "content_type": "text/plain"},
    "CSV":       {"extension": "csv", "content_type": "text/csv"},
}


def generate_layout(bank: str, rows: List[DispersionRow],
                     origin_account: str, lote_number: str = "1",
                     payment_date: Optional[date] = None) -> str:
    bank = (bank or "").strip()
    if bank.upper() == "BBVA":
        return bbva_layout(rows, origin_account, lote_number, payment_date)
    if bank.title() == "Banorte":
        return banorte_layout(rows, origin_account, payment_date)
    if bank.title() == "Santander":
        return santander_layout(rows, origin_account, payment_date)
    if bank.upper() == "HSBC":
        return hsbc_layout(rows, origin_account, payment_date)
    if bank.title() in ("Banamex", "Citibanamex"):
        return banamex_layout(rows, origin_account, payment_date)
    if bank.upper() == "SPEI":
        return spei_layout(rows, origin_account, payment_date)
    # Fallback: CSV genérico
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["No. empleado", "Nombre", "RFC", "Banco", "CLABE", "Importe neto"])
    for r in rows:
        w.writerow([r.employee_number, r.full_name, r.rfc, r.bank, r.clabe, f"{r.amount:.2f}"])
    return buf.getvalue()
