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
async def stats(db: DB, current_user: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    from app.modules.inventory.branch_scope import visible_warehouse_ids
    ids = await visible_warehouse_ids(db, current_user)
    return await service.get_stats(db, start=start, end=end, branch_warehouse_ids=ids)


@router.get("/analytics/trend", response_model=List[schemas.TrendPoint])
async def trend(db: DB, _: CurrentUser,
                granularity: str = Query("day", pattern="^(day|week|month)$"),
                days: int = Query(30, ge=1, le=365),
                end: Optional[datetime] = None,
                customer_id: Optional[int] = None):
    return await service.sales_trend(db, granularity=granularity, days=days, end=end, customer_id=customer_id)


@router.get("/analytics/returns-avg", response_model=schemas.AverageReturns)
async def returns_avg(db: DB, _: CurrentUser, customer_id: Optional[int] = None):
    return await service.get_average_returns(db, customer_id=customer_id)


@router.get("/analytics/forecast/{customer_id}", response_model=schemas.CustomerForecast)
async def customer_forecast(customer_id: int, db: DB, _: CurrentUser, months: int = Query(6, ge=2, le=24)):
    return await service.get_customer_forecast(db, customer_id, months=months)


@router.get("/analytics/top-customers", response_model=List[schemas.TopCustomer])
async def top_customers(db: DB, _: CurrentUser, limit: int = Query(5, ge=1, le=50),
                         start: Optional[datetime] = None, end: Optional[datetime] = None):
    return await service.top_customers(db, limit=limit, start=start, end=end)


@router.get("/analytics/top-products", response_model=List[schemas.TopProduct])
async def top_products(db: DB, _: CurrentUser, limit: int = Query(5, ge=1, le=50),
                        start: Optional[datetime] = None, end: Optional[datetime] = None):
    return await service.top_products(db, limit=limit, start=start, end=end)


@router.get("/analytics/by-seller", response_model=List[schemas.SalesBySeller])
async def by_seller(db: DB, _: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    return await service.sales_by_seller(db, start=start, end=end)


@router.get("/analytics/by-channel", response_model=List[schemas.SalesByChannel])
async def by_channel(db: DB, _: CurrentUser, start: Optional[datetime] = None, end: Optional[datetime] = None):
    return await service.sales_by_channel(db, start=start, end=end)


@router.get("/customers/{customer_id}/360", response_model=schemas.Customer360)
async def customer_360(customer_id: int, db: DB, _: CurrentUser):
    data = await service.customer_360(db, customer_id)
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
