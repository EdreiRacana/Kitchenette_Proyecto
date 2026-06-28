"""Contabilidad Electrónica (SAT, Anexo 24) — Fase 4.

Genera los XML que el contribuyente sube al Buzón Tributario:
  - Catálogo de cuentas (CT)         — esquema CatalogoCuentas 1.3
  - Balanza de comprobación (BN/BC)  — esquema BalanzaComprobacion 1.3
  - Pólizas del periodo (PL)         — esquema PolizasPeriodo 1.3

No requiere conexión externa: producimos el archivo listo para validar con el
validador del SAT y subirlo. Es un borrador fiel que el usuario valida/ajusta.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.accounting import models
from app.modules.accounting.service import _account_sums, list_accounts, _r

NS_CAT = "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas"
NS_BCE = "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion"
NS_PLZ = "http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/PolizasPeriodo"
NS_XSI = "http://www.w3.org/2001/XMLSchema-instance"


def _xesc(s) -> str:
    return (str(s if s is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _amt(x) -> str:
    return f"{round(float(x or 0.0), 2):.2f}"


def _mm(mes: int) -> str:
    return f"{int(mes):02d}"


def _month_bounds(anio: int, mes: int):
    if int(mes) >= 13:  # mes 13 = cierre del ejercicio -> todo el año
        return datetime(anio, 1, 1, tzinfo=timezone.utc), datetime(anio + 1, 1, 1, tzinfo=timezone.utc)
    start = datetime(anio, mes, 1, tzinfo=timezone.utc)
    end = (datetime(anio + 1, 1, 1, tzinfo=timezone.utc) if mes == 12
           else datetime(anio, mes + 1, 1, tzinfo=timezone.utc))
    return start, end


async def xml_catalogo(db: AsyncSession, *, rfc: str, anio: int, mes: int) -> str:
    accounts = await list_accounts(db)
    by_id = {a.id: a for a in accounts}
    rows = []
    for a in sorted(accounts, key=lambda x: x.code):
        if not a.sat_code:
            continue  # SAT exige código agrupador en cada cuenta reportada
        natur = "D" if a.nature == "deudora" else "A"
        attrs = (f'CodAgrup="{_xesc(a.sat_code)}" NumCta="{_xesc(a.code)}" '
                 f'Desc="{_xesc(a.name)}" Nivel="{a.level}" Natur="{natur}"')
        parent = by_id.get(a.parent_id) if a.parent_id else None
        if parent:
            attrs += f' SubCtaDe="{_xesc(parent.code)}"'
        rows.append(f'  <catalogocuentas:Ctas {attrs}/>')
    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<catalogocuentas:Catalogo xmlns:catalogocuentas="{NS_CAT}" '
        f'xmlns:xsi="{NS_XSI}" '
        f'xsi:schemaLocation="{NS_CAT} {NS_CAT}/CatalogoCuentas_1_3.xsd" '
        f'Version="1.3" RFC="{_xesc(rfc)}" Mes="{_mm(mes)}" Anio="{anio}">'
    )
    return header + "\n" + "\n".join(rows) + "\n</catalogocuentas:Catalogo>\n"


async def xml_balanza(db: AsyncSession, *, rfc: str, anio: int, mes: int, tipo_envio: str = "N") -> str:
    accounts = await list_accounts(db)
    start, end = _month_bounds(anio, mes)
    opening = await _account_sums(db, lt=start)
    period = await _account_sums(db, gte=start, lt=end)
    rows = []
    for a in sorted(accounts, key=lambda x: x.code):
        if not a.sat_code:
            continue
        o_d, o_c = opening.get(a.id, (0.0, 0.0))
        p_d, p_c = period.get(a.id, (0.0, 0.0))
        if round(o_d + o_c + p_d + p_c, 2) == 0:
            continue
        deudora = a.nature == "deudora"
        sini = (o_d - o_c) if deudora else (o_c - o_d)
        sfin = ((o_d + p_d) - (o_c + p_c)) if deudora else ((o_c + p_c) - (o_d + p_d))
        rows.append(
            f'  <BCE:Ctas NumCta="{_xesc(a.code)}" SaldoIni="{_amt(sini)}" '
            f'Debe="{_amt(p_d)}" Haber="{_amt(p_c)}" SaldoFin="{_amt(sfin)}"/>'
        )
    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<BCE:Balanza xmlns:BCE="{NS_BCE}" xmlns:xsi="{NS_XSI}" '
        f'xsi:schemaLocation="{NS_BCE} {NS_BCE}/BalanzaComprobacion_1_3.xsd" '
        f'Version="1.3" RFC="{_xesc(rfc)}" Mes="{_mm(mes)}" Anio="{anio}" TipoEnvio="{_xesc(tipo_envio)}">'
    )
    return header + "\n" + "\n".join(rows) + "\n</BCE:Balanza>\n"


async def xml_polizas(db: AsyncSession, *, rfc: str, anio: int, mes: int,
                      tipo_solicitud: str = "AF", num_orden: Optional[str] = None,
                      num_tramite: Optional[str] = None) -> str:
    start, end = _month_bounds(anio, mes)
    res = await db.execute(
        select(models.JournalEntry)
        .where(models.JournalEntry.status == "posted",
               models.JournalEntry.date >= start, models.JournalEntry.date < end)
        .options(selectinload(models.JournalEntry.lines).selectinload(models.JournalLine.account))
        .order_by(models.JournalEntry.date, models.JournalEntry.id)
    )
    entries = res.scalars().all()
    blocks = []
    for e in entries:
        fecha = (e.date or start).strftime("%Y-%m-%d")
        trans = []
        for l in e.lines:
            desc = l.account.name if l.account else ""
            numcta = l.account.code if l.account else ""
            trans.append(
                f'    <PLZ:Transaccion NumCta="{_xesc(numcta)}" DesCta="{_xesc(desc)}" '
                f'Concepto="{_xesc(l.description or e.concept or "Movimiento")}" '
                f'Debe="{_amt(l.debit)}" Haber="{_amt(l.credit)}"/>'
            )
        blocks.append(
            f'  <PLZ:Poliza NumUnIdenPol="{_xesc(e.folio or e.id)}" Fecha="{fecha}" '
            f'Concepto="{_xesc(e.concept or "Póliza")}">\n' + "\n".join(trans) + "\n  </PLZ:Poliza>"
        )
    # Atributo de solicitud (AF/FC requieren NumOrden; DE/CO requieren NumTramite)
    extra = ""
    if tipo_solicitud in ("AF", "FC") and num_orden:
        extra = f' NumOrden="{_xesc(num_orden)}"'
    elif tipo_solicitud in ("DE", "CO") and num_tramite:
        extra = f' NumTramite="{_xesc(num_tramite)}"'
    header = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<PLZ:Polizas xmlns:PLZ="{NS_PLZ}" xmlns:xsi="{NS_XSI}" '
        f'xsi:schemaLocation="{NS_PLZ} {NS_PLZ}/PolizasPeriodo_1_3.xsd" '
        f'Version="1.3" RFC="{_xesc(rfc)}" Mes="{_mm(mes)}" Anio="{anio}" '
        f'TipoSolicitud="{_xesc(tipo_solicitud)}"{extra}>'
    )
    return header + "\n" + "\n".join(blocks) + "\n</PLZ:Polizas>\n"
