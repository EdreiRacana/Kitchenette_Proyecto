"""REST API — Contabilidad (Fase 1). Protegido por el write-guard de 'accounting'."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.accounting import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Catálogo de cuentas ───────────────────────────────────────────────────────

@router.get("/accounts", response_model=List[schemas.AccountInDB])
async def list_accounts(db: DB, _: CurrentUser, only_active: bool = False):
    return await service.list_accounts(db, only_active=only_active)


@router.post("/accounts/seed-default")
async def seed_default(db: DB, _: CurrentUser):
    created = await service.seed_default_chart(db)
    mapped = await service.ensure_default_map(db)
    return {"created": created, "mapped": mapped}


# ── Configuración contable: mapeo de cuentas para pólizas automáticas ──────────

@router.get("/config/account-map", response_model=List[schemas.AccountMapItem])
async def get_account_map(db: DB, _: CurrentUser):
    await service.ensure_default_map(db)
    return await service.list_account_map(db)


@router.put("/config/account-map")
async def update_account_map(data: schemas.AccountMapUpdate, db: DB, _: CurrentUser):
    await service.set_account_map(db, {k: v for k, v in data.mapping.items()})
    return {"ok": True}


# ── Contabilidad Electrónica SAT (Fase 4): XML del Anexo 24 ───────────────────

from fastapi import Response  # noqa: E402


async def _resolve_rfc(db, rfc: Optional[str]) -> str:
    if rfc:
        return rfc.strip().upper()
    try:
        from app.modules.core_config.service import get_company_profile
        company = await get_company_profile(db)
        if company and getattr(company, "tax_id", None):
            return str(company.tax_id).strip().upper()
    except Exception:
        pass
    raise HTTPException(status_code=400, detail="Falta el RFC. Indícalo o configúralo en el perfil de la empresa.")


def _xml_response(content: str, filename: str) -> Response:
    return Response(content=content, media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/sat/catalogo")
async def sat_catalogo(db: DB, _: CurrentUser, anio: int, mes: int, rfc: Optional[str] = None):
    from app.modules.accounting import sat
    r = await _resolve_rfc(db, rfc)
    xml = await sat.xml_catalogo(db, rfc=r, anio=anio, mes=mes)
    return _xml_response(xml, f"{r}{anio}{int(mes):02d}CT.xml")


@router.get("/sat/balanza")
async def sat_balanza(db: DB, _: CurrentUser, anio: int, mes: int,
                      rfc: Optional[str] = None, tipo_envio: str = "N"):
    from app.modules.accounting import sat
    r = await _resolve_rfc(db, rfc)
    xml = await sat.xml_balanza(db, rfc=r, anio=anio, mes=mes, tipo_envio=tipo_envio)
    suf = "B" + ("C" if tipo_envio == "C" else "N")
    return _xml_response(xml, f"{r}{anio}{int(mes):02d}{suf}.xml")


@router.get("/sat/polizas")
async def sat_polizas(db: DB, _: CurrentUser, anio: int, mes: int, rfc: Optional[str] = None,
                      tipo_solicitud: str = "AF", num_orden: Optional[str] = None,
                      num_tramite: Optional[str] = None):
    from app.modules.accounting import sat
    r = await _resolve_rfc(db, rfc)
    xml = await sat.xml_polizas(db, rfc=r, anio=anio, mes=mes, tipo_solicitud=tipo_solicitud,
                                num_orden=num_orden, num_tramite=num_tramite)
    return _xml_response(xml, f"{r}{anio}{int(mes):02d}PL.xml")


@router.post("/accounts", response_model=schemas.AccountInDB, status_code=201)
async def create_account(data: schemas.AccountCreate, db: DB, _: CurrentUser):
    try:
        return await service.create_account(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/accounts/{account_id}", response_model=schemas.AccountInDB)
async def update_account(account_id: int, data: schemas.AccountUpdate, db: DB, _: CurrentUser):
    acc = await service.update_account(db, account_id, data)
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return acc


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: int, db: DB, _: CurrentUser):
    try:
        ok = await service.delete_account(db, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")


# ── Pólizas ───────────────────────────────────────────────────────────────────

@router.get("/entries", response_model=List[schemas.JournalEntryInDB])
async def list_entries(db: DB, _: CurrentUser, skip: int = 0, limit: int = Query(100, ge=1, le=500),
                       status: Optional[str] = None, entry_type: Optional[str] = None,
                       date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.list_entries(db, skip=skip, limit=limit, status=status,
                                      entry_type=entry_type, date_from=date_from, date_to=date_to)


@router.post("/entries", response_model=schemas.JournalEntryDetail, status_code=201)
async def create_entry(data: schemas.JournalEntryCreate, db: DB, user: CurrentUser):
    try:
        return await service.create_entry(db, data, user_id=user.id, branch_id=getattr(user, "branch_id", None))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/entries/{entry_id}", response_model=schemas.JournalEntryDetail)
async def get_entry(entry_id: int, db: DB, _: CurrentUser):
    e = await service.get_entry(db, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Póliza no encontrada")
    return e


@router.post("/entries/{entry_id}/cancel", response_model=schemas.JournalEntryDetail)
async def cancel_entry(entry_id: int, db: DB, _: CurrentUser):
    e = await service.cancel_entry(db, entry_id)
    if not e:
        raise HTTPException(status_code=404, detail="Póliza no encontrada")
    return e


# ── Mayor / auxiliar ──────────────────────────────────────────────────────────

@router.get("/ledger/{account_id}", response_model=schemas.LedgerReport)
async def ledger(account_id: int, db: DB, _: CurrentUser,
                 date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    rep = await service.ledger(db, account_id, date_from=date_from, date_to=date_to)
    if not rep:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return rep


# ── Estados financieros (Fase 2) ──────────────────────────────────────────────

@router.get("/reports/trial-balance", response_model=schemas.TrialBalance)
async def trial_balance(db: DB, _: CurrentUser,
                        date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.trial_balance(db, date_from=date_from, date_to=date_to)


@router.get("/reports/balance-sheet", response_model=schemas.BalanceSheet)
async def balance_sheet(db: DB, _: CurrentUser, as_of: Optional[datetime] = None):
    return await service.balance_sheet(db, as_of=as_of)


@router.get("/reports/income-statement", response_model=schemas.IncomeStatement)
async def income_statement(db: DB, _: CurrentUser,
                           date_from: Optional[datetime] = None, date_to: Optional[datetime] = None):
    return await service.income_statement(db, date_from=date_from, date_to=date_to)


# ── Cierre de período ──────────────────────────────────────────────────
@router.get("/period-close")
async def list_closes(db: DB, _: CurrentUser):
    """Historial de cierres mensuales."""
    return await service.list_period_closes(db)


@router.post("/period-close")
async def close_month(year: int, month: int, db: DB, current_user: CurrentUser,
                       notes: Optional[str] = None):
    """Cierra un mes: bloquea edición de pólizas en ese período y persiste
    snapshot del trial balance + income statement + balance sheet."""
    # Requiere admin/manager
    if not current_user.is_superuser and (current_user.role or "user") not in ("admin", "manager"):
        raise HTTPException(403, "Se requiere rol admin/manager para cerrar períodos")
    try:
        return await service.close_period(db, year, month, user_id=current_user.id, notes=notes)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/period-close/{year}/{month}/reopen")
async def reopen_month(year: int, month: int, db: DB, current_user: CurrentUser,
                        reason: Optional[str] = None):
    """Reabre un mes cerrado. Requiere justificación textual — deja rastro auditable."""
    if not current_user.is_superuser:
        raise HTTPException(403, "Sólo el superusuario puede reabrir períodos cerrados")
    try:
        return await service.reopen_period(db, year, month, user_id=current_user.id, reason=reason)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Políticas contables (Fase 4) ─────────────────────────────────────────────

@router.get("/policies/current", response_model=schemas.AccountingPolicyInDB)
async def get_current_policy(db: DB, current_user: CurrentUser,
                              branch_id: Optional[int] = None):
    """Devuelve la política vigente HOY para la sucursal (o global si no se pasa)."""
    from datetime import datetime, timezone
    policy = await service.get_active_policy(db, at_date=datetime.now(timezone.utc),
                                              branch_id=branch_id)
    # Puede que sea la creada in-memory sin id; hacer commit para persistir
    if policy.id is None:
        await db.commit()
        await db.refresh(policy)
    return policy


@router.get("/policies", response_model=List[schemas.AccountingPolicyInDB])
async def list_policies(db: DB, current_user: CurrentUser,
                         branch_id: Optional[int] = None):
    """Historial completo de políticas (para auditoría). Más recientes primero."""
    return await service.list_policies(db, branch_id=branch_id)


@router.put("/policies", response_model=schemas.AccountingPolicyInDB)
async def upsert_current_policy(data: schemas.AccountingPolicyIn, db: DB,
                                 current_user: CurrentUser):
    """Actualiza la política vigente. Si effective_from es hoy o el pasado
    inmediato, actualiza in-place; si es futuro, crea una nueva versión con
    esa fecha efectiva y marca la anterior como superseded (auditable)."""
    try:
        payload = data.model_dump(exclude_none=True)
        policy = await service.upsert_policy(
            db, payload, user_id=current_user.id, branch_id=data.branch_id,
        )
        return policy
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Cierre anual del ejercicio (Hook 10) ─────────────────────────────────────

@router.post("/close-year/{year}")
async def close_year(year: int, db: DB, current_user: CurrentUser):
    """Cierra el ejercicio fiscal del año dado. Genera la póliza que traslada
    los saldos de todas las cuentas de resultado (ingresos, costos, gastos)
    contra la cuenta 3103 'Resultado del ejercicio'. Idempotente: si el año
    ya está cerrado, devuelve 400. Solo para superusuario."""
    if not current_user.is_superuser:
        raise HTTPException(403, "Sólo el superusuario puede cerrar el ejercicio")
    try:
        return await service.close_year(db, year=year, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Activos fijos y depreciación (Hook 9) ────────────────────────────────────

@router.get("/fixed-assets", response_model=List[schemas.FixedAssetInDB])
async def list_assets(db: DB, current_user: CurrentUser, only_active: bool = True):
    """Lista de activos fijos. Filtro `only_active=false` incluye los dados de baja."""
    return await service.list_fixed_assets(db, only_active=only_active)


@router.post("/fixed-assets", response_model=schemas.FixedAssetInDB, status_code=201)
async def create_asset(data: schemas.FixedAssetIn, db: DB, current_user: CurrentUser):
    """Alta de un activo fijo depreciable (LISR art. 34-35)."""
    return await service.create_fixed_asset(db, data.model_dump(), user_id=current_user.id)


@router.post("/fixed-assets/{asset_id}/dispose", response_model=schemas.FixedAssetInDB)
async def dispose_asset(asset_id: int, db: DB, current_user: CurrentUser):
    """Baja del activo — deja de depreciarse desde el mes siguiente."""
    asset = await service.dispose_fixed_asset(db, asset_id, user_id=current_user.id)
    if not asset:
        raise HTTPException(404, "Activo no encontrado")
    return asset


@router.post("/depreciation/run/{year}/{month}")
async def run_depreciation(year: int, month: int, db: DB, current_user: CurrentUser):
    """Genera la póliza de depreciación mensual (Hook 9). Idempotente por mes.
    Se puede correr manualmente aquí o programar un cron mensual (fuera de scope)."""
    return await service.record_monthly_depreciation(
        db, year=year, month=month, user_id=current_user.id,
    )
