"""REST API del módulo Retail Sell-out Analytics."""
from __future__ import annotations

import io
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_db
from app.modules.auth.models import User

from . import schemas, service

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter()

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Channels ─────────────────────────────────────────────────────────────

@router.get("/channels", response_model=List[schemas.RetailChannelOut])
async def list_channels(db: DB, _: CurrentUser):
    return await service.list_channels(db)


@router.post("/channels", response_model=schemas.RetailChannelOut, status_code=201)
async def create_channel(payload: schemas.RetailChannelCreate, db: DB, _: CurrentUser):
    ch = await service.create_channel(db, payload)
    return schemas.RetailChannelOut(
        id=ch.id, name=ch.name, code=ch.code, customer_id=ch.customer_id,
        target_wos_weeks=ch.target_wos_weeks,
        critical_wos_weeks=ch.critical_wos_weeks,
        overstock_wos_weeks=ch.overstock_wos_weeks,
        is_active=ch.is_active, notes=ch.notes,
        stores_count=0, created_at=ch.created_at,
    )


@router.patch("/channels/{channel_id}", response_model=schemas.RetailChannelOut)
async def update_channel(channel_id: int, payload: schemas.RetailChannelUpdate,
                          db: DB, _: CurrentUser):
    ch = await service.update_channel(db, channel_id, payload)
    if ch is None:
        raise HTTPException(404, "Cadena no encontrada")
    return schemas.RetailChannelOut(
        id=ch.id, name=ch.name, code=ch.code, customer_id=ch.customer_id,
        target_wos_weeks=ch.target_wos_weeks,
        critical_wos_weeks=ch.critical_wos_weeks,
        overstock_wos_weeks=ch.overstock_wos_weeks,
        is_active=ch.is_active, notes=ch.notes,
        stores_count=0, created_at=ch.created_at,
    )


@router.delete("/channels/{channel_id}", status_code=204)
async def delete_channel(channel_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_channel(db, channel_id)
    if not ok:
        raise HTTPException(404, "Cadena no encontrada")


# ── Stores ───────────────────────────────────────────────────────────────

@router.get("/stores", response_model=List[schemas.RetailStoreOut])
async def list_stores(db: DB, _: CurrentUser,
                       channel_id: Optional[int] = Query(None),
                       active_only: bool = Query(False)):
    return await service.list_stores(db, channel_id=channel_id, active_only=active_only)


async def _store_to_schema(db: AsyncSession, s, ch=None) -> schemas.RetailStoreOut:
    from app.modules.inventory import models as inv_models
    if ch is None and s.channel_id:
        ch = await service.get_channel(db, s.channel_id)
    wh_name = None
    if s.consignment_warehouse_id:
        w = await db.get(inv_models.Warehouse, s.consignment_warehouse_id)
        wh_name = w.name if w else None
    return schemas.RetailStoreOut(
        id=s.id, channel_id=s.channel_id,
        channel_name=ch.name if ch else None,
        name=s.name, code=s.code, external_code=s.external_code,
        city=s.city, state=s.state, region=s.region,
        store_format=s.store_format, address=s.address,
        contact_name=s.contact_name, contact_phone=s.contact_phone,
        consignment_warehouse_id=s.consignment_warehouse_id,
        consignment_warehouse_name=wh_name,
        is_active=s.is_active, notes=s.notes, created_at=s.created_at,
    )


@router.post("/stores", response_model=schemas.RetailStoreOut, status_code=201)
async def create_store(payload: schemas.RetailStoreCreate, db: DB, _: CurrentUser):
    ch = await service.get_channel(db, payload.channel_id)
    if ch is None:
        raise HTTPException(400, "Cadena no encontrada")
    s = await service.create_store(db, payload)
    return await _store_to_schema(db, s, ch)


@router.post("/stores/bulk", response_model=schemas.BulkStoresResponse, status_code=201)
async def bulk_create_stores(payload: schemas.BulkStoresRequest, db: DB, _: CurrentUser):
    try:
        return await service.bulk_create_stores(db, payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/stores/{store_id}", response_model=schemas.RetailStoreOut)
async def update_store(store_id: int, payload: schemas.RetailStoreUpdate,
                        db: DB, _: CurrentUser):
    s = await service.update_store(db, store_id, payload)
    if s is None:
        raise HTTPException(404, "Tienda no encontrada")
    return await _store_to_schema(db, s)


@router.delete("/stores/{store_id}", status_code=204)
async def delete_store(store_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_store(db, store_id)
    if not ok:
        raise HTTPException(404, "Tienda no encontrada")


@router.get("/stores/{store_id}/performance", response_model=schemas.StorePerformanceOut)
async def store_performance(store_id: int, db: DB, _: CurrentUser,
                              weeks_back: int = Query(12, ge=1, le=52)):
    r = await service.store_performance(db, store_id, weeks_back=weeks_back)
    if r is None:
        raise HTTPException(404, "Tienda no encontrada")
    return r


# ── Sell-out reports ────────────────────────────────────────────────────

@router.get("/sellout", response_model=List[schemas.SellOutReportOut])
async def list_sellout(db: DB, _: CurrentUser,
                        channel_id: Optional[int] = Query(None),
                        store_id: Optional[int] = Query(None),
                        variant_id: Optional[int] = Query(None),
                        period_start_gte: Optional[datetime] = Query(None),
                        period_start_lt: Optional[datetime] = Query(None),
                        limit: int = Query(500, ge=1, le=5000)):
    return await service.list_sellout(
        db, channel_id=channel_id, store_id=store_id, variant_id=variant_id,
        period_start_gte=period_start_gte, period_start_lt=period_start_lt,
        limit=limit,
    )


@router.post("/sellout", response_model=schemas.SellOutReportOut, status_code=201)
async def create_sellout(payload: schemas.SellOutReportCreate, db: DB, current_user: CurrentUser):
    store = await service.get_store(db, payload.store_id)
    if store is None:
        raise HTTPException(400, "Tienda no encontrada")
    r = await service.create_sellout(db, payload, user_id=current_user.id)
    from . import models as m
    ch = await service.get_channel(db, store.channel_id)
    return schemas.SellOutReportOut(
        id=r.id, store_id=r.store_id, store_name=store.name,
        channel_id=store.channel_id, channel_name=ch.name if ch else None,
        variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
        period_start=r.period_start, period_end=r.period_end,
        period_type=r.period_type,
        units_sold=r.units_sold, units_on_hand=r.units_on_hand,
        revenue=r.revenue, source=r.source, notes=r.notes,
        created_at=r.created_at,
    )


@router.patch("/sellout/{report_id}", response_model=schemas.SellOutReportOut)
async def update_sellout(report_id: int, payload: schemas.SellOutReportUpdate,
                          db: DB, _: CurrentUser):
    r = await service.update_sellout(db, report_id, payload)
    if r is None:
        raise HTTPException(404, "Reporte no encontrado")
    store = await service.get_store(db, r.store_id)
    ch = await service.get_channel(db, store.channel_id) if store else None
    return schemas.SellOutReportOut(
        id=r.id, store_id=r.store_id, store_name=store.name if store else None,
        channel_id=store.channel_id if store else None,
        channel_name=ch.name if ch else None,
        variant_id=r.variant_id, product_name=r.product_name, sku=r.sku,
        period_start=r.period_start, period_end=r.period_end,
        period_type=r.period_type,
        units_sold=r.units_sold, units_on_hand=r.units_on_hand,
        revenue=r.revenue, source=r.source, notes=r.notes,
        created_at=r.created_at,
    )


@router.delete("/sellout/{report_id}", status_code=204)
async def delete_sellout(report_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_sellout(db, report_id)
    if not ok:
        raise HTTPException(404, "Reporte no encontrado")


# ── Dashboard / KPIs ────────────────────────────────────────────────────

@router.get("/dashboard", response_model=schemas.RetailKPIs)
async def dashboard(db: DB, _: CurrentUser,
                     channel_id: Optional[int] = Query(None),
                     days: int = Query(30, ge=1, le=365)):
    return await service.dashboard_kpis(db, channel_id=channel_id, days=days)


@router.get("/stores-velocity", response_model=List[schemas.StoreVelocityRow])
async def stores_velocity(db: DB, _: CurrentUser,
                            channel_id: Optional[int] = Query(None)):
    return await service.stores_velocity(db, channel_id=channel_id)


@router.get("/skus-velocity", response_model=List[schemas.SKUVelocityRow])
async def skus_velocity(db: DB, _: CurrentUser,
                          channel_id: Optional[int] = Query(None),
                          limit: int = Query(100, ge=1, le=500)):
    return await service.skus_velocity(db, channel_id=channel_id, limit=limit)


# ── Plantilla + import ──────────────────────────────────────────────────

@router.get("/sellout/template")
async def download_sellout_template(
    db: DB, _: CurrentUser,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$"),
):
    if format == "csv":
        content = service.build_sellout_template_csv()
        return StreamingResponse(
            io.BytesIO(content),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="retail_sellout_plantilla.csv"'},
        )
    content = await service.build_sellout_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(content),
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="retail_sellout_plantilla.xlsx"'},
    )


@router.post("/sellout/import", response_model=schemas.ImportSellOutResponse)
async def import_sellout(
    db: DB, current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """Ingesta bulk de sell-out desde xlsx o csv siguiendo la plantilla."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")
    try:
        return await service.import_sellout(
            db, content, file.filename or "", user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Replenishment engine ────────────────────────────────────────────────

@router.get("/replenishment", response_model=schemas.ReplenishmentResponse)
async def replenishment(db: DB, _: CurrentUser,
                          channel_id: Optional[int] = Query(None)):
    return await service.replenishment(db, channel_id=channel_id)


# ── Reportes descargables (Excel + PDF ejecutivo) ──────────────────────

from fastapi.responses import Response
from . import reports as retail_reports


def _xlsx_response(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/sellout.xlsx")
async def report_sellout_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    store_id: Optional[int] = Query(None),
    variant_id: Optional[int] = Query(None),
    period_start_gte: Optional[datetime] = Query(None),
    period_start_lt: Optional[datetime] = Query(None),
    limit: int = Query(5000, ge=1, le=20000),
):
    rows = await service.list_sellout(
        db, channel_id=channel_id, store_id=store_id, variant_id=variant_id,
        period_start_gte=period_start_gte, period_start_lt=period_start_lt,
        limit=limit,
    )
    content = retail_reports.build_sellout_report(rows)
    return _xlsx_response(content, "retail_sellout.xlsx")


@router.get("/reports/dashboard.xlsx")
async def report_dashboard_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    kpis = await service.dashboard_kpis(db, channel_id=channel_id, days=days)
    stores = await service.stores_velocity(db, channel_id=channel_id)
    skus = await service.skus_velocity(db, channel_id=channel_id, limit=100)
    content = retail_reports.build_dashboard_report(kpis, stores, skus)
    return _xlsx_response(content, "retail_dashboard.xlsx")


@router.get("/reports/replenishment.xlsx")
async def report_replenishment_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
):
    resp = await service.replenishment(db, channel_id=channel_id)
    content = retail_reports.build_replenishment_report(resp)
    return _xlsx_response(content, "retail_reabasto.xlsx")


@router.get("/reports/heatmap.xlsx")
async def report_heatmap_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    metric: str = Query("wos", pattern="^(wos|units_sold|on_hand)$"),
    limit_variants: int = Query(40, ge=1, le=200),
):
    hm = await service.heatmap(db, channel_id=channel_id, metric=metric,
                                 limit_variants=limit_variants)
    content = retail_reports.build_heatmap_report(hm)
    return _xlsx_response(content, "retail_heatmap.xlsx")


@router.get("/reports/abc.xlsx")
async def report_abc_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    days: int = Query(90, ge=1, le=365),
):
    abc = await service.abc_classification(db, channel_id=channel_id, days=days)
    content = retail_reports.build_abc_report(abc)
    return _xlsx_response(content, "retail_abc.xlsx")


@router.get("/reports/alerts.xlsx")
async def report_alerts_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, pattern="^(open|acknowledged|resolved|dismissed)$"),
    severity: Optional[str] = Query(None, pattern="^(urgent|high|medium|low)$"),
):
    alerts = await service.list_alerts(db, channel_id=channel_id,
                                          status=status, severity=severity, limit=2000)
    content = retail_reports.build_alerts_report(alerts)
    return _xlsx_response(content, "retail_alertas.xlsx")


@router.get("/reports/consignment.xlsx")
async def report_consignment_xlsx(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
):
    recon = await service.consignment_reconciliation(db, channel_id=channel_id)
    content = retail_reports.build_consignment_report(recon)
    return _xlsx_response(content, "retail_consignacion.xlsx")


@router.get("/reports/executive.pdf")
async def report_executive_pdf(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    days: int = Query(30, ge=1, le=90),
):
    """Reporte ejecutivo semanal en PDF (para mandar al gerente comercial)."""
    kpis = await service.dashboard_kpis(db, channel_id=channel_id, days=days)
    stores = await service.stores_velocity(db, channel_id=channel_id)
    skus = await service.skus_velocity(db, channel_id=channel_id, limit=50)
    alerts = await service.list_alerts(db, channel_id=channel_id, limit=100)
    repl = await service.replenishment(db, channel_id=channel_id)
    from app.modules.sales.universal_service import _get_company_dict
    company = await _get_company_dict(db)
    pdf = retail_reports.build_executive_pdf(company, kpis, stores, skus, alerts, repl)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="retail_reporte_ejecutivo.pdf"'},
    )


# ── Analytics: heatmap y ABC ────────────────────────────────────────────

@router.get("/analytics/heatmap", response_model=schemas.HeatmapResponse)
async def analytics_heatmap(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    metric: str = Query("wos", pattern="^(wos|units_sold|on_hand)$"),
    limit_variants: int = Query(40, ge=1, le=500),
    store_search: Optional[str] = Query(None, max_length=100),
    region: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    store_format: Optional[str] = Query(None),
    store_offset: int = Query(0, ge=0),
    store_limit: int = Query(100, ge=10, le=500),
    sort_stores_by: str = Query("worst_wos", pattern="^(name|worst_wos|best_wos|most_sales)$"),
):
    return await service.heatmap(
        db, channel_id=channel_id, metric=metric,
        limit_variants=limit_variants,
        store_search=store_search, region=region, state=state,
        store_format=store_format,
        store_offset=store_offset, store_limit=store_limit,
        sort_stores_by=sort_stores_by,
    )


@router.get("/analytics/heatmap/filters", response_model=schemas.HeatmapFilters)
async def analytics_heatmap_filters(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
):
    return await service.heatmap_filters(db, channel_id=channel_id)


@router.get("/analytics/abc", response_model=schemas.ABCResponse)
async def analytics_abc(
    db: DB, _: CurrentUser,
    channel_id: Optional[int] = Query(None),
    days: int = Query(90, ge=1, le=365),
):
    return await service.abc_classification(db, channel_id=channel_id, days=days)


# ── Traslados desde reabasto ────────────────────────────────────────────

@router.get("/replenishment/source-warehouses",
             response_model=List[schemas.SourceWarehouseOption])
async def source_warehouses(db: DB, _: CurrentUser):
    return await service.list_source_warehouses(db)


@router.post("/replenishment/transfer", response_model=schemas.TransferResponse)
async def create_transfer(payload: schemas.TransferRequest,
                            db: DB, current_user: CurrentUser):
    try:
        return await service.create_transfer(db, payload, user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Perfiles de importación ─────────────────────────────────────────────

@router.get("/import-profiles",
             response_model=List[schemas.RetailImportProfileOut])
async def list_import_profiles(db: DB, _: CurrentUser,
                                 channel_id: Optional[int] = Query(None)):
    return await service.list_profiles(db, channel_id=channel_id)


@router.post("/import-profiles",
              response_model=schemas.RetailImportProfileOut, status_code=201)
async def create_import_profile(payload: schemas.RetailImportProfileCreate,
                                  db: DB, _: CurrentUser):
    ch = await service.get_channel(db, payload.channel_id)
    if ch is None:
        raise HTTPException(400, "Cadena no encontrada")
    p = await service.create_profile(db, payload)
    return schemas.RetailImportProfileOut(
        id=p.id, channel_id=p.channel_id, channel_name=ch.name,
        name=p.name, notes=p.notes,
        is_active=p.is_active, is_default=p.is_default,
        file_format=p.file_format, sheet_name=p.sheet_name,
        header_row=p.header_row, encoding=p.encoding,
        delimiter=p.delimiter, date_format=p.date_format,
        decimal_separator=p.decimal_separator,
        thousands_separator=p.thousands_separator,
        units_multiplier=p.units_multiplier,
        revenue_multiplier=p.revenue_multiplier,
        default_period_type=p.default_period_type,
        column_map=dict(p.column_map or {}),
        ignore_row_pattern=p.ignore_row_pattern,
        default_channel_code=p.default_channel_code,
        created_at=p.created_at,
    )


@router.patch("/import-profiles/{profile_id}",
                response_model=schemas.RetailImportProfileOut)
async def update_import_profile(profile_id: int,
                                  payload: schemas.RetailImportProfileUpdate,
                                  db: DB, _: CurrentUser):
    p = await service.update_profile(db, profile_id, payload)
    if p is None:
        raise HTTPException(404, "Perfil no encontrado")
    ch = await service.get_channel(db, p.channel_id)
    return schemas.RetailImportProfileOut(
        id=p.id, channel_id=p.channel_id, channel_name=ch.name if ch else None,
        name=p.name, notes=p.notes,
        is_active=p.is_active, is_default=p.is_default,
        file_format=p.file_format, sheet_name=p.sheet_name,
        header_row=p.header_row, encoding=p.encoding,
        delimiter=p.delimiter, date_format=p.date_format,
        decimal_separator=p.decimal_separator,
        thousands_separator=p.thousands_separator,
        units_multiplier=p.units_multiplier,
        revenue_multiplier=p.revenue_multiplier,
        default_period_type=p.default_period_type,
        column_map=dict(p.column_map or {}),
        ignore_row_pattern=p.ignore_row_pattern,
        default_channel_code=p.default_channel_code,
        created_at=p.created_at,
    )


@router.delete("/import-profiles/{profile_id}", status_code=204)
async def delete_import_profile(profile_id: int, db: DB, _: CurrentUser):
    ok = await service.delete_profile(db, profile_id)
    if not ok:
        raise HTTPException(404, "Perfil no encontrado")


@router.post("/import-profiles/detect-columns",
              response_model=schemas.DetectColumnsResponse)
async def detect_columns(
    db: DB, _: CurrentUser,
    profile_id: Optional[int] = Query(None),
    file: UploadFile = File(...),
):
    """Detecta encabezados del archivo y propone mapeo automático heurístico."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")
    return await service.detect_columns(db, content, file.filename or "", profile_id=profile_id)


@router.post("/import-profiles/{profile_id}/preview",
              response_model=schemas.PreviewResponse)
async def preview_import(
    profile_id: int, db: DB, _: CurrentUser,
    file: UploadFile = File(...),
    limit: int = Query(10, ge=1, le=50),
):
    """Aplica el perfil al archivo y devuelve las primeras filas normalizadas
    para revisar ANTES de importar. No escribe nada en la base."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")
    try:
        return await service.preview_with_profile(db, profile_id, content, file.filename or "", limit=limit)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/import-profiles/{profile_id}/import",
              response_model=schemas.ImportSellOutResponse)
async def import_with_profile(
    profile_id: int, db: DB, current_user: CurrentUser,
    file: UploadFile = File(...),
):
    """Ejecuta la importación aplicando el perfil (mapeo + normalización)."""
    content = await file.read()
    if not content:
        raise HTTPException(400, "Archivo vacío")
    try:
        return await service.import_with_profile(
            db, profile_id, content, file.filename or "", user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


# ── Consignación ────────────────────────────────────────────────────────

@router.get("/consignment/warehouses",
             response_model=List[schemas.ConsignmentWarehouseOption])
async def list_consignment_warehouses(db: DB, _: CurrentUser):
    """Warehouses con type=consignment, para asignar a tiendas retail."""
    return await service.list_consignment_warehouses(db)


@router.get("/consignment/reconciliation",
             response_model=schemas.ConsignmentReconResponse)
async def consignment_reconciliation(db: DB, _: CurrentUser,
                                       channel_id: Optional[int] = Query(None)):
    """Compara on_hand reportado por cada tienda vs stock en su almacén de
    consignación asignado. Sólo tiendas con warehouse."""
    return await service.consignment_reconciliation(db, channel_id=channel_id)


# ── Alerts ──────────────────────────────────────────────────────────────

@router.get("/alerts", response_model=List[schemas.RetailAlertOut])
async def list_alerts(db: DB, _: CurrentUser,
                        channel_id: Optional[int] = Query(None),
                        status: Optional[str] = Query(None, pattern="^(open|acknowledged|resolved|dismissed)$"),
                        severity: Optional[str] = Query(None, pattern="^(urgent|high|medium|low)$"),
                        limit: int = Query(500, ge=1, le=2000)):
    return await service.list_alerts(
        db, channel_id=channel_id, status=status, severity=severity, limit=limit,
    )


@router.get("/alerts/summary", response_model=schemas.AlertsSummary)
async def alerts_summary(db: DB, _: CurrentUser,
                           channel_id: Optional[int] = Query(None)):
    return await service.alerts_summary(db, channel_id=channel_id)


@router.post("/alerts/evaluate", response_model=schemas.EvaluateAlertsResponse)
async def evaluate_alerts_route(db: DB, _: CurrentUser,
                                 channel_id: Optional[int] = Query(None)):
    return await service.evaluate_alerts(db, channel_id=channel_id)


@router.post("/alerts/{alert_id}/acknowledge", response_model=schemas.RetailAlertOut)
async def acknowledge_alert(alert_id: int, payload: schemas.AlertActionRequest,
                              db: DB, current_user: CurrentUser):
    try:
        a = await service.acknowledge_alert(db, alert_id, user_id=current_user.id, notes=payload.notes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if a is None:
        raise HTTPException(404, "Alerta no encontrada")
    return await service._alert_to_schema(db, a)


@router.post("/alerts/{alert_id}/resolve", response_model=schemas.RetailAlertOut)
async def resolve_alert(alert_id: int, payload: schemas.AlertActionRequest,
                          db: DB, current_user: CurrentUser):
    try:
        a = await service.resolve_alert(db, alert_id, user_id=current_user.id, notes=payload.notes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if a is None:
        raise HTTPException(404, "Alerta no encontrada")
    return await service._alert_to_schema(db, a)


@router.post("/alerts/{alert_id}/dismiss", response_model=schemas.RetailAlertOut)
async def dismiss_alert(alert_id: int, payload: schemas.AlertActionRequest,
                          db: DB, current_user: CurrentUser):
    try:
        a = await service.dismiss_alert(db, alert_id, user_id=current_user.id, notes=payload.notes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if a is None:
        raise HTTPException(404, "Alerta no encontrada")
    return await service._alert_to_schema(db, a)
