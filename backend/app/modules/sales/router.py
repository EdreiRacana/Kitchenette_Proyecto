"""REST API for the Sales / CRM module."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import io

from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.modules.auth.models import User
from app.modules.sales import schemas, service

router = APIRouter()

DB = Annotated[AsyncSession, Depends(deps.get_db)]
CurrentUser = Annotated[User, Depends(deps.get_current_active_user)]


# ── Analytics (declared before /{order_id} so paths don't collide) ────────────

@router.get("/stats", response_model=schemas.SalesStats)
async def stats(db: DB, current_user: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None,
                status: Optional[str] = None, payment_method: Optional[str] = None, q: Optional[str] = None):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_stats(db, start=start, end=end, branch_warehouse_ids=ids,
                                   status=status, payment_method=payment_method, q=q)


async def _branch_ids(db, user):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    return await visible_warehouse_ids(db, user)


@router.get("/analytics/trend", response_model=List[schemas.TrendPoint])
async def trend(db: DB, current_user: CurrentUser,
                granularity: str = Query("day", pattern="^(day|week|month)$"),
                days: int = Query(30, ge=1, le=365),
                end: Optional[datetime] = None,
                customer_id: Optional[int] = None):
    ids = await _branch_ids(db, current_user)
    return await service.sales_trend(db, granularity=granularity, days=days, end=end, customer_id=customer_id, branch_warehouse_ids=ids)


@router.get("/sellers", response_model=List[schemas.SellerLite])
async def sellers(db: DB, _: CurrentUser):
    return await service.list_sellers(db)


@router.get("/analytics/returns-avg", response_model=schemas.AverageReturns)
async def returns_avg(db: DB, current_user: CurrentUser, customer_id: Optional[int] = None):
    ids = await _branch_ids(db, current_user)
    return await service.get_average_returns(db, customer_id=customer_id, branch_warehouse_ids=ids)


@router.get("/analytics/forecast/{customer_id}", response_model=schemas.CustomerForecast)
async def customer_forecast(customer_id: int, db: DB, _: CurrentUser, months: int = Query(6, ge=2, le=24)):
    return await service.get_customer_forecast(db, customer_id, months=months)


@router.get("/analytics/top-customers", response_model=List[schemas.TopCustomer])
async def top_customers(db: DB, current_user: CurrentUser, limit: int = Query(5, ge=1, le=50),
                         start: Optional[datetime] = None, end: Optional[datetime] = None):
    ids = await _branch_ids(db, current_user)
    return await service.top_customers(db, limit=limit, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/analytics/top-products", response_model=List[schemas.TopProduct])
async def top_products(db: DB, current_user: CurrentUser, limit: int = Query(5, ge=1, le=50),
                        start: Optional[datetime] = None, end: Optional[datetime] = None):
    ids = await _branch_ids(db, current_user)
    return await service.top_products(db, limit=limit, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/analytics/by-seller", response_model=List[schemas.SalesBySeller])
async def by_seller(db: DB, current_user: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    ids = await _branch_ids(db, current_user)
    return await service.sales_by_seller(db, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/analytics/by-channel", response_model=List[schemas.SalesByChannel])
async def by_channel(db: DB, current_user: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    ids = await _branch_ids(db, current_user)
    return await service.sales_by_channel(db, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/analytics/heatmap", response_model=List[schemas.HeatmapCell])
async def sales_heatmap(db: DB, current_user: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    """Actividad de ventas por día-de-semana × hora. Devuelve solo las
    celdas con al menos 1 pedido; el frontend completa el grid 7×24."""
    ids = await _branch_ids(db, current_user)
    return await service.sales_heatmap(db, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/customers/{customer_id}/360", response_model=schemas.Customer360)
async def customer_360(customer_id: int, db: DB, _: CurrentUser):
    data = await service.customer_360(db, customer_id)
    if not data:
        raise HTTPException(404, "Cliente no encontrado")
    return data


@router.get("/customers/{customer_id}/pnl", response_model=schemas.CustomerPnLReport)
async def customer_pnl(
    customer_id: int, db: DB, _: CurrentUser,
    start: datetime, end: datetime,
):
    if end <= start:
        raise HTTPException(400, "El fin del periodo debe ser posterior al inicio")
    data = await service.customer_pnl_report(db, customer_id, start, end)
    if not data:
        raise HTTPException(404, "Cliente no encontrado")
    return data


@router.get("/export")
async def export_orders(
    db: DB, _: CurrentUser,
    formato: str = Query("csv", pattern="^(csv|xlsx)$"),
    kind: Optional[str] = None, status: Optional[str] = None,
    customer_id: Optional[int] = None, seller_id: Optional[int] = None,
    payment_method: Optional[str] = None, channel: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[datetime] = None, date_to: Optional[datetime] = None,
):
    filtros = dict(
        kind=kind, status=status, customer_id=customer_id, seller_id=seller_id,
        payment_method=payment_method, channel=channel, q=q,
        date_from=date_from, date_to=date_to,
    )
    if formato == "xlsx":
        contenido = await service.export_xlsx(db, **filtros)
        return StreamingResponse(
            io.BytesIO(contenido),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=ventas.xlsx"},
        )
    csv_text = await service.export_csv(db, **filtros)
    return StreamingResponse(
        io.StringIO(csv_text), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ventas.csv"},
    )


# ── CRUD / listing ────────────────────────────────────────────────────────────

@router.post("/", response_model=schemas.OrderDetail, status_code=201)
async def create_order(order_in: schemas.OrderCreate, db: DB, user: CurrentUser):
    order = await service.create_order(db, order_in, user_id=user.id)
    return await service.get_order_detail(db, order.id)


@router.get("/", response_model=schemas.PaginatedOrders)
async def read_orders(
    db: DB, current_user: CurrentUser,
    skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500),
    kind: Optional[str] = None, status: Optional[str] = None,
    customer_id: Optional[int] = None, seller_id: Optional[int] = None,
    payment_method: Optional[str] = None, channel: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[datetime] = None, date_to: Optional[datetime] = None,
    sort_by: str = Query("created_at"), sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    items, total = await service.get_orders(
        db, skip=skip, limit=limit, kind=kind, status=status, customer_id=customer_id,
        seller_id=seller_id, payment_method=payment_method, channel=channel, q=q,
        date_from=date_from, date_to=date_to, sort_by=sort_by, sort_dir=sort_dir,
        branch_warehouse_ids=ids,
    )
    return schemas.PaginatedOrders(items=items, total=total, skip=skip, limit=limit)


@router.get("/{order_id}", response_model=schemas.OrderDetail)
async def read_order(order_id: int, db: DB, _: CurrentUser):
    order = await service.get_order_detail(db, order_id)
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return order


@router.put("/{order_id}", response_model=schemas.OrderDetail)
async def update_order(order_id: int, data: schemas.OrderUpdate, db: DB, user: CurrentUser):
    try:
        order = await service.update_order(db, order_id, data, user_id=user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return await service.get_order_detail(db, order_id)


@router.patch("/{order_id}/status", response_model=schemas.OrderDetail)
async def update_status(order_id: int, payload: schemas.StatusUpdate, db: DB, user: CurrentUser):
    order = await service.change_status(db, order_id, payload.status, payload.message, user_id=user.id)
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return await service.get_order_detail(db, order_id)


@router.post("/{order_id}/payments", response_model=schemas.OrderDetail)
async def add_payment(order_id: int, pay: schemas.PaymentCreate, db: DB, user: CurrentUser):
    try:
        order = await service.register_payment(db, order_id, pay, user_id=user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return await service.get_order_detail(db, order_id)


@router.post("/{order_id}/convert", response_model=schemas.OrderDetail)
async def convert_quote(order_id: int, db: DB, user: CurrentUser):
    try:
        order = await service.convert_quote_to_order(db, order_id, user_id=user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not order:
        raise HTTPException(404, "Cotización no encontrada")
    return await service.get_order_detail(db, order.id)


@router.post("/{order_id}/cancel", response_model=schemas.OrderDetail)
async def cancel(order_id: int, db: DB, user: CurrentUser):
    order = await service.cancel_order(db, order_id, user_id=user.id)
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return await service.get_order_detail(db, order_id)


@router.get("/{order_id}/invoice")
async def invoice_payload(order_id: int, db: DB, _: CurrentUser):
    order = await service.get_order_detail(db, order_id)
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    if not order.bill_rfc:
        raise HTTPException(400, "El pedido no tiene datos de facturación (RFC)")
    return service.build_invoice_payload(order)


# ── Universal ERP: PDFs, importadores marketplace, P&L cliente ─────────────
from fastapi import UploadFile, File, Form
from fastapi.responses import Response
from app.modules.sales import universal_service


@router.get("/{order_id}/document/{kind}.pdf")
async def download_document_pdf(order_id: int, kind: str, db: DB, _: CurrentUser):
    """Descarga PDF del documento asociado a la orden.
    kind ∈ {quote, remission, proforma}. Se genera con logo, colores y datos
    de la empresa (CompanyProfile)."""
    if kind not in ("quote", "remission", "proforma"):
        raise HTTPException(400, "kind debe ser quote | remission | proforma")
    pdf_bytes = await universal_service.generate_document_pdf(db, order_id, kind)
    if not pdf_bytes:
        raise HTTPException(404, "Pedido no encontrado")
    filenames = {"quote": "cotizacion", "remission": "remision", "proforma": "pre_factura"}
    fname = f"{filenames[kind]}_{order_id}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/marketplace/parsers")
async def list_parsers(_: CurrentUser):
    """Lista de plataformas soportadas por el importador de reportes."""
    return {"parsers": list(universal_service.PARSERS.keys()) + ["custom"]}


@router.post("/marketplace/import")
async def import_marketplace(
    db: DB, current_user: CurrentUser,
    customer_id: int = Form(...),
    platform: str = Form(...),
    file: UploadFile = File(...),
    mapping_json: Optional[str] = Form(None),
):
    """Sube un XLSX de reporte marketplace (Liverpool, Amazon, etc.) y crea
    órdenes + devoluciones automáticamente. Idempotente por external_order_id.
    """
    import json as _json
    contents = await file.read()
    mapping = _json.loads(mapping_json) if mapping_json else None
    try:
        result = await universal_service.import_marketplace_report(
            db, customer_id=customer_id, platform=platform,
            file_bytes=contents, filename=file.filename or "reporte.xlsx",
            mapping=mapping, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.get("/customers/{customer_id}/pnl-universal")
async def customer_pnl_universal(customer_id: int, db: DB, _: CurrentUser,
                                  start: Optional[datetime] = Query(default=None),
                                  end: Optional[datetime] = Query(default=None)):
    """Estado de resultados por cliente con desglose completo (Universal ERP):
    Venta bruta − comisiones − logísticos − CEDIS − portal − descuentos −
    devoluciones − retenciones ISR/IVA − COGS = Margen bruto. Usa la config
    comercial del cliente (relationship_type, commission_base_pct, etc.)."""
    return await universal_service.compute_customer_pnl(db, customer_id, start=start, end=end)


@router.get("/customers/{customer_id}/settlement")
async def marketplace_settlement(customer_id: int, db: DB, _: CurrentUser,
                                 start: Optional[datetime] = Query(default=None),
                                 end: Optional[datetime] = Query(default=None),
                                 deposited_amount: Optional[float] = Query(default=None)):
    """Reconciliación de liquidación marketplace. Compara lo depositado por
    la plataforma (Liverpool, Amazon, ML) contra lo esperado según órdenes
    − devoluciones. Detecta variance para reclamaciones."""
    from app.modules.sales.marketplace_settlement import compute_settlement
    return await compute_settlement(db, customer_id, start=start, end=end,
                                     deposited_amount=deposited_amount)


@router.post("/returns/{return_id}/receive")
async def receive_return_endpoint(return_id: int, payload: dict, db: DB, current_user: CurrentUser):
    """Recibe físicamente la devolución en almacén y marca condition
    (sellable/damaged) por cada partida."""
    warehouse_id = payload.get("warehouse_id")
    items_condition = payload.get("items_condition", {})
    if not warehouse_id:
        raise HTTPException(400, "warehouse_id requerido")
    # Convertir keys a int
    items_condition = {int(k): v for k, v in items_condition.items()}
    result = await universal_service.receive_return(
        db, return_id=return_id, warehouse_id=warehouse_id,
        items_condition=items_condition, notes=payload.get("notes"),
        user_id=current_user.id,
    )
    if not result:
        raise HTTPException(404, "Devolución no encontrada")
    return result
