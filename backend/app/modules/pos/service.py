"""POS service — apertura/cierre de turno, ventas POS, movimientos de caja."""
from __future__ import annotations
from typing import Optional, List
from datetime import datetime
import json

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from app.modules.pos import models, schemas, models as pos_models
from app.modules.sales import models as sales_models
from app.core.logging import get_logger

log = get_logger(__name__)


async def _log(db: AsyncSession, user_id: Optional[int], action: str, description: str = None, details: dict = None):
    try:
        from app.modules.core_config.service import create_audit_log
        await create_audit_log(db, user_id=user_id, action=action, module="pos",
                                description=description, details=details)
    except Exception:
        pass


# ── Terminales ────────────────────────────────────────────────────────────
async def list_terminals(db: AsyncSession) -> List[dict]:
    res = await db.execute(select(pos_models.POSTerminal).order_by(pos_models.POSTerminal.name))
    terms = res.scalars().all()
    out = []
    for t in terms:
        # ¿tiene sesión abierta?
        res_s = await db.execute(select(pos_models.POSSession).where(
            pos_models.POSSession.terminal_id == t.id,
            pos_models.POSSession.status == "open",
        ))
        s = res_s.scalars().first()
        cashier_name = None
        if s:
            from app.modules.auth.models import User
            res_u = await db.execute(select(User).where(User.id == s.cashier_id))
            u = res_u.scalars().first()
            cashier_name = u.full_name or u.email if u else None
        # nombre almacén
        wh_name = None
        if t.warehouse_id:
            from app.modules.inventory.models import Warehouse
            res_w = await db.execute(select(Warehouse).where(Warehouse.id == t.warehouse_id))
            w = res_w.scalars().first()
            wh_name = w.name if w else None
        out.append({
            "id": t.id, "name": t.name, "code": t.code,
            "warehouse_id": t.warehouse_id, "warehouse_name": wh_name,
            "printer_ip": t.printer_ip, "default_price_list": t.default_price_list,
            "is_active": t.is_active, "notes": t.notes,
            "created_at": t.created_at,
            "open_session_id": s.id if s else None,
            "open_cashier_name": cashier_name,
        })
    return out


async def create_terminal(db: AsyncSession, data: schemas.POSTerminalCreate,
                          user_id: Optional[int] = None) -> pos_models.POSTerminal:
    t = pos_models.POSTerminal(**data.model_dump())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    await _log(db, user_id, "CREATE_POS_TERMINAL", f"Terminal POS creada: {t.name}", {"id": t.id})
    return t


async def update_terminal(db: AsyncSession, terminal_id: int, data: schemas.POSTerminalUpdate,
                          user_id: Optional[int] = None) -> Optional[pos_models.POSTerminal]:
    res = await db.execute(select(pos_models.POSTerminal).where(pos_models.POSTerminal.id == terminal_id))
    t = res.scalars().first()
    if not t:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return t


# ── Sesión (turno) ────────────────────────────────────────────────────────
async def open_session(db: AsyncSession, terminal_id: int, cashier_id: int,
                       opening_balance: float, opening_notes: Optional[str] = None) -> dict:
    # Validar que el terminal no tenga sesión abierta
    res = await db.execute(select(pos_models.POSSession).where(
        pos_models.POSSession.terminal_id == terminal_id,
        pos_models.POSSession.status == "open",
    ))
    if res.scalars().first():
        raise ValueError("Este terminal ya tiene una sesión abierta. Cierra la sesión anterior primero.")

    s = pos_models.POSSession(
        terminal_id=terminal_id, cashier_id=cashier_id,
        opening_balance=opening_balance, opening_notes=opening_notes,
        status="open",
    )
    db.add(s)
    await db.flush()

    # Movimiento de apertura
    db.add(pos_models.POSTransaction(
        session_id=s.id, type="opening", amount=opening_balance,
        notes=opening_notes or "Apertura de turno",
    ))
    await db.commit()
    await db.refresh(s)
    await _log(db, cashier_id, "OPEN_POS_SESSION", f"Turno abierto en terminal {terminal_id}",
                {"session_id": s.id, "opening_balance": opening_balance})
    return await get_session(db, s.id)


async def close_session(db: AsyncSession, session_id: int,
                        denominations: dict, closing_notes: Optional[str] = None,
                        user_id: Optional[int] = None) -> dict:
    res = await db.execute(select(pos_models.POSSession).where(pos_models.POSSession.id == session_id))
    s = res.scalars().first()
    if not s:
        raise ValueError("Sesión no encontrada")
    if s.status != "open":
        raise ValueError(f"La sesión ya está en estado '{s.status}'")

    # Sumar transacciones para calcular expected_cash
    res_tx = await db.execute(select(pos_models.POSTransaction).where(
        pos_models.POSTransaction.session_id == session_id,
    ))
    txs = res_tx.scalars().all()
    cash_in = sum(t.amount for t in txs if t.type == "cash_in")
    cash_out = sum(t.amount for t in txs if t.type == "cash_out")
    sales_cash = sum(t.amount for t in txs if t.type == "sale" and t.payment_method == "cash")
    refunds_cash = sum(t.amount for t in txs if t.type == "refund" and t.payment_method == "cash")
    expected = (s.opening_balance or 0.0) + sales_cash + cash_in - cash_out - refunds_cash

    # Contar arqueo
    actual = 0.0
    for den, qty in (denominations or {}).items():
        try:
            actual += float(den) * int(qty)
        except (ValueError, TypeError):
            continue

    total_sales_amount = sum(t.amount for t in txs if t.type == "sale")
    total_refunds = sum(t.amount for t in txs if t.type == "refund")
    sales_count = sum(1 for t in txs if t.type == "sale")

    s.status = "closed"
    s.closed_at = datetime.now()
    s.expected_cash = round(expected, 2)
    s.actual_cash = round(actual, 2)
    s.variance = round(actual - expected, 2)
    s.denominations_json = denominations
    s.closing_notes = closing_notes
    s.total_sales_amount = round(total_sales_amount, 2)
    s.total_sales_count = sales_count
    s.total_cash_in = round(cash_in, 2)
    s.total_cash_out = round(cash_out, 2)
    s.total_refunds = round(total_refunds, 2)

    db.add(pos_models.POSTransaction(
        session_id=s.id, type="closing", amount=actual,
        notes=f"Cierre: esperado ${expected:,.2f}, real ${actual:,.2f}, "
              f"var ${actual-expected:+,.2f}",
    ))
    await db.commit()
    await _log(db, user_id or s.cashier_id, "CLOSE_POS_SESSION",
                f"Turno cerrado, variance ${s.variance:+,.2f}",
                {"session_id": s.id, "expected": s.expected_cash, "actual": s.actual_cash})
    return await get_session(db, s.id)


async def add_cash_movement(db: AsyncSession, session_id: int, type: str,
                            amount: float, notes: Optional[str] = None,
                            user_id: Optional[int] = None) -> dict:
    if type not in ("cash_in", "cash_out"):
        raise ValueError("type debe ser cash_in o cash_out")
    if amount <= 0:
        raise ValueError("amount debe ser positivo")
    res = await db.execute(select(pos_models.POSSession).where(pos_models.POSSession.id == session_id))
    s = res.scalars().first()
    if not s or s.status != "open":
        raise ValueError("Sesión no encontrada o no abierta")
    tx = pos_models.POSTransaction(
        session_id=session_id, type=type, amount=amount,
        payment_method="cash", notes=notes,
    )
    db.add(tx)
    await db.commit()
    await _log(db, user_id, f"POS_{type.upper()}", f"{type} ${amount:,.2f}",
                {"session_id": session_id, "amount": amount})
    return {"id": tx.id, "type": type, "amount": amount, "notes": notes,
            "created_at": tx.created_at}


async def get_session(db: AsyncSession, session_id: int) -> Optional[dict]:
    res = await db.execute(select(pos_models.POSSession).where(pos_models.POSSession.id == session_id))
    s = res.scalars().first()
    if not s:
        return None
    from app.modules.auth.models import User
    res_u = await db.execute(select(User).where(User.id == s.cashier_id))
    u = res_u.scalars().first()
    res_t = await db.execute(select(pos_models.POSTerminal).where(pos_models.POSTerminal.id == s.terminal_id))
    t = res_t.scalars().first()
    return {
        "id": s.id, "terminal_id": s.terminal_id,
        "terminal_name": t.name if t else "?",
        "cashier_id": s.cashier_id,
        "cashier_name": (u.full_name or u.email) if u else "?",
        "status": s.status,
        "opened_at": s.opened_at, "closed_at": s.closed_at,
        "opening_balance": s.opening_balance,
        "expected_cash": s.expected_cash, "actual_cash": s.actual_cash,
        "variance": s.variance,
        "total_sales_amount": s.total_sales_amount,
        "total_sales_count": s.total_sales_count,
        "total_cash_in": s.total_cash_in, "total_cash_out": s.total_cash_out,
        "total_refunds": s.total_refunds,
        "denominations_json": s.denominations_json,
        "opening_notes": s.opening_notes, "closing_notes": s.closing_notes,
    }


async def get_session_report(db: AsyncSession, session_id: int) -> Optional[dict]:
    base = await get_session(db, session_id)
    if not base:
        return None
    res_tx = await db.execute(select(pos_models.POSTransaction).where(
        pos_models.POSTransaction.session_id == session_id,
    ).order_by(pos_models.POSTransaction.created_at))
    txs = res_tx.scalars().all()
    by_method: dict = {}
    for t in txs:
        if t.type == "sale":
            k = t.payment_method or "unknown"
            by_method[k] = by_method.get(k, 0.0) + t.amount
    base["sales_by_method"] = {k: round(v, 2) for k, v in by_method.items()}
    base["transactions"] = [{
        "id": t.id, "type": t.type, "amount": t.amount,
        "payment_method": t.payment_method, "order_id": t.order_id,
        "notes": t.notes, "created_at": t.created_at,
    } for t in txs]
    return base


async def get_open_session_for_user(db: AsyncSession, cashier_id: int) -> Optional[dict]:
    res = await db.execute(select(pos_models.POSSession).where(
        pos_models.POSSession.cashier_id == cashier_id,
        pos_models.POSSession.status == "open",
    ))
    s = res.scalars().first()
    return await get_session(db, s.id) if s else None


async def get_previous_session(
    db: AsyncSession,
    cashier_id: Optional[int] = None,
    terminal_id: Optional[int] = None,
) -> Optional[dict]:
    """Devuelve el reporte completo del último turno cerrado.

    Prioridad de filtros:
      - Si viene terminal_id → el último turno cerrado en ese terminal
        (útil para "qué dejó el cajero anterior en la misma caja").
      - Si no, filtra por cashier_id → el último turno cerrado del usuario.
      - Si tampoco, devuelve el último turno cerrado global.

    Se busca por closed_at desc, con fallback a opened_at desc para turnos
    en los que closed_at pudiera ser NULL por algún estado histórico.
    """
    stmt = select(pos_models.POSSession).where(
        pos_models.POSSession.status.in_(("closed", "reconciled"))
    )
    if terminal_id is not None:
        stmt = stmt.where(pos_models.POSSession.terminal_id == terminal_id)
    elif cashier_id is not None:
        stmt = stmt.where(pos_models.POSSession.cashier_id == cashier_id)
    stmt = stmt.order_by(
        pos_models.POSSession.closed_at.desc().nulls_last(),
        pos_models.POSSession.opened_at.desc(),
        pos_models.POSSession.id.desc(),
    ).limit(1)
    s = (await db.execute(stmt)).scalars().first()
    if not s:
        return None
    return await get_session_report(db, s.id)


# ── Venta POS ─────────────────────────────────────────────────────────────
async def register_sale(db: AsyncSession, session_id: int,
                        customer_id: Optional[int], items: list, payments: dict,
                        discount_amount: float = 0.0, tax_rate: float = 16.0,
                        shipping_amount: float = 0.0, notes: Optional[str] = None,
                        user_id: Optional[int] = None) -> dict:
    """Registra una venta POS. Crea Order + OrderItems y una POSTransaction
    por cada método de pago. La reducción de stock la hace el módulo sales.
    """
    res = await db.execute(select(pos_models.POSSession).where(pos_models.POSSession.id == session_id))
    s = res.scalars().first()
    if not s or s.status != "open":
        raise ValueError("Sesión no abierta")

    # Calcular totales
    subtotal = 0.0
    order_items = []
    for it in items:
        line_subtotal = round((it["unit_price"] * it["quantity"]) - (it.get("discount_amount") or 0.0), 2)
        subtotal += line_subtotal
        order_items.append({**it, "subtotal": line_subtotal,
                            "total": round(line_subtotal * (1 + (it.get("tax_rate", 0) or 0) / 100), 2)})
    base_after_discount = max(0.0, subtotal - discount_amount)
    # IVA incluido en precio → separo: tax_amount = base × tasa / (1 + tasa)
    tax_amount = round(base_after_discount * tax_rate / (100 + tax_rate), 2)
    total = round(base_after_discount + shipping_amount, 2)
    # Sólo el efectivo puede exceder el total (para dar cambio). Tarjeta y
    # transferencia deben cobrarse en el monto exacto — si el cliente elige
    # pago mixto, el efectivo cubre sólo la diferencia. Esta validación
    # evita que un bug del cliente duplique el cargo a tarjeta.
    non_cash = sum(v for k, v in payments.items() if k != "cash")
    if non_cash > total + 0.005:
        raise ValueError(
            f"El pago con tarjeta+transferencia (${non_cash:,.2f}) excede el "
            f"total (${total:,.2f}). No es posible dar cambio con métodos "
            f"electrónicos — ajusta los montos."
        )
    paid = sum(payments.values())
    if paid + 0.005 < total:
        raise ValueError(f"El pago (${paid:,.2f}) es menor que el total (${total:,.2f})")

    # Folio
    res_c = await db.execute(select(func.count()).select_from(sales_models.Order))
    count = res_c.scalar() or 0
    folio = f"POS-{count + 1:06d}"

    # Almacén (heredado del terminal si existe)
    res_t = await db.execute(select(pos_models.POSTerminal).where(pos_models.POSTerminal.id == s.terminal_id))
    terminal = res_t.scalars().first()
    warehouse_id = terminal.warehouse_id if terminal else None

    order = sales_models.Order(
        folio=folio, kind="order", customer_id=customer_id, user_id=user_id or s.cashier_id,
        warehouse_id=warehouse_id, status="paid", channel="pos",
        currency="MXN", subtotal=round(subtotal, 2),
        discount_type="amount", discount_value=discount_amount, discount_amount=discount_amount,
        tax_rate=tax_rate, tax_amount=tax_amount,
        shipping_amount=shipping_amount, total_amount=total, paid_amount=paid,
        notes=notes, pos_session_id=s.id,
        relationship_type="retail",
    )
    db.add(order)
    await db.flush()

    from app.modules.inventory import fifo_service
    from app.modules.inventory import models as inv_models
    for it in order_items:
        oi = sales_models.OrderItem(
            order_id=order.id, variant_id=it.get("variant_id"),
            product_name=it["product_name"], sku=it.get("sku"),
            quantity=it["quantity"], unit_price=it["unit_price"],
            discount_amount=it.get("discount_amount") or 0.0,
            tax_rate=it.get("tax_rate") or 0.0,
            subtotal=it["subtotal"], total=it["total"],
            is_service=it.get("is_service", False),
            unit_cost=it.get("unit_cost", 0.0),
        )
        db.add(oi)
        # Descuento FIFO real + snapshot de costo unitario para P&L exacto
        variant_id = it.get("variant_id")
        qty = int(it.get("quantity") or 0)
        if variant_id and warehouse_id and qty > 0 and not it.get("is_service"):
            # Servicios del catálogo tampoco descuentan inventario
            res_v = await db.execute(select(inv_models.ProductVariant)
                                       .where(inv_models.ProductVariant.id == variant_id)
                                       .options(selectinload(inv_models.ProductVariant.product)))
            v = res_v.scalars().first()
            if v and v.product and (v.product.item_type or "") == "service":
                oi.is_service = True
                continue
            try:
                result = await fifo_service.consume_stock(
                    db, variant_id=variant_id, warehouse_id=warehouse_id,
                    quantity=qty, reference=f"order:{order.id}",
                    user_id=user_id or s.cashier_id,
                    allow_negative=True, commit=False,
                )
                oi.unit_cost = float(result.get("unit_cost_avg") or 0.0)
            except Exception as e:
                log.warning("consume_stock error en venta POS",
                            extra={"order_id": order.id, "variant_id": variant_id, "error": str(e)},
                            exc_info=True)

    # Registrar Payment(s) y POSTransaction(s) — una por método
    for method, amount in payments.items():
        if amount <= 0:
            continue
        db.add(sales_models.Payment(
            order_id=order.id, amount=amount, method=method,
            user_id=user_id or s.cashier_id,
        ))
        db.add(pos_models.POSTransaction(
            session_id=s.id, type="sale", amount=amount,
            payment_method=method, order_id=order.id,
            notes=f"Venta {folio}",
        ))
    await db.commit()
    await _log(db, user_id or s.cashier_id, "POS_SALE",
                f"Venta POS {folio} ${total:,.2f}",
                {"session_id": s.id, "order_id": order.id, "folio": folio})
    return {
        "order_id": order.id, "folio": folio,
        "subtotal": round(subtotal, 2),
        "discount_amount": discount_amount,
        "tax_amount": tax_amount,
        "shipping_amount": shipping_amount,
        "total_amount": total,
        "paid_amount": paid,
        "change": round(paid - total, 2),
    }


# ── Búsqueda rápida de productos (para el POS) ─────────────────────────────
async def prepare_ticket_data(db: AsyncSession, order_id: int) -> Optional[dict]:
    """Reúne todos los datos necesarios para imprimir un ticket POS."""
    from app.modules.sales.universal_service import _get_company_dict
    res = await db.execute(select(sales_models.Order).where(sales_models.Order.id == order_id))
    order = res.scalars().first()
    if not order:
        return None

    res_items = await db.execute(select(sales_models.OrderItem).where(
        sales_models.OrderItem.order_id == order_id
    ))
    items = [{
        "product_name": it.product_name, "sku": it.sku,
        "quantity": it.quantity, "unit_price": it.unit_price,
        "subtotal": it.subtotal, "total": it.total,
    } for it in res_items.scalars().all()]

    res_pays = await db.execute(select(sales_models.Payment).where(
        sales_models.Payment.order_id == order_id
    ).order_by(sales_models.Payment.created_at))
    payments = [{"method": p.method, "amount": p.amount, "reference": p.reference}
                for p in res_pays.scalars().all()]
    total_paid = sum(p["amount"] for p in payments)

    session_dict = None
    if order.pos_session_id:
        session_dict = await get_session(db, order.pos_session_id)

    customer_name = None
    if order.customer_id:
        from app.modules.customers.models import Customer
        res_c = await db.execute(select(Customer).where(Customer.id == order.customer_id))
        c = res_c.scalars().first()
        if c:
            customer_name = c.razon_social or c.name

    company = await _get_company_dict(db)
    order_dict = {
        "id": order.id, "folio": order.folio,
        "subtotal": order.subtotal,
        "tax_amount": order.tax_amount,
        "discount_amount": order.discount_amount or 0.0,
        "shipping_amount": order.shipping_amount or 0.0,
        "total_amount": order.total_amount,
        "change": max(0, round(total_paid - (order.total_amount or 0), 2)),
        "customer_name": customer_name,
        "created_at": order.created_at,
    }
    return {
        "company": company,
        "order": order_dict,
        "items": items,
        "payments": payments,
        "session": session_dict,
    }


async def list_session_sales(db: AsyncSession, session_id: int) -> List[dict]:
    """Lista todas las ventas de un turno POS, ordenadas de la más reciente a
    la más antigua. Es la fuente de verdad para el historial del cajero:
    reimprimir ticket, ver detalle, hacer una devolución."""
    res = await db.execute(
        select(sales_models.Order)
        .where(sales_models.Order.pos_session_id == session_id)
        .order_by(sales_models.Order.created_at.desc())
    )
    orders = res.scalars().all()
    if not orders:
        return []

    order_ids = [o.id for o in orders]
    res_pays = await db.execute(
        select(sales_models.Payment).where(sales_models.Payment.order_id.in_(order_ids))
    )
    pays_by_order: dict = {}
    for p in res_pays.scalars().all():
        pays_by_order.setdefault(p.order_id, []).append({
            "method": p.method or "unknown",
            "amount": float(p.amount or 0.0),
        })

    res_items = await db.execute(
        select(sales_models.OrderItem).where(sales_models.OrderItem.order_id.in_(order_ids))
    )
    items_count: dict = {}
    for it in res_items.scalars().all():
        items_count[it.order_id] = items_count.get(it.order_id, 0) + (it.quantity or 0)

    customer_names: dict = {}
    cust_ids = [o.customer_id for o in orders if o.customer_id]
    if cust_ids:
        from app.modules.customers.models import Customer
        res_c = await db.execute(select(Customer).where(Customer.id.in_(cust_ids)))
        for c in res_c.scalars().all():
            customer_names[c.id] = c.razon_social or c.name

    out = []
    for o in orders:
        pays = pays_by_order.get(o.id, [])
        primary_method = pays[0]["method"] if pays else (o.payment_method or "cash")
        total_paid = sum(p["amount"] for p in pays)
        out.append({
            "order_id": o.id,
            "folio": o.folio,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "status": o.status,
            "total_amount": float(o.total_amount or 0.0),
            "paid_amount": float(total_paid),
            "change": max(0.0, round(total_paid - float(o.total_amount or 0.0), 2)),
            "items_count": items_count.get(o.id, 0),
            "customer_id": o.customer_id,
            "customer_name": customer_names.get(o.customer_id) if o.customer_id else None,
            "payment_methods": [p["method"] for p in pays] or [primary_method],
            "payments": pays,
        })
    return out


async def search_products(db: AsyncSession, query: str, limit: int = 20) -> List[dict]:
    """Búsqueda unificada por SKU exacto, código de barras o nombre parcial.
    Prioriza matches exactos por SKU/barcode para lector."""
    from app.modules.inventory.models import ProductVariant, Product
    q = (query or "").strip()
    if not q:
        return []

    def _serialize(v, p):
        return {
            "variant_id": v.id, "product_id": p.id,
            "sku": v.sku, "barcode": getattr(v, "barcode", None),
            "product_name": p.name,
            "variant_label": getattr(v, "label", None) or getattr(v, "attributes", None),
            "unit_price": getattr(v, "price", 0.0) or 0.0,
            "unit_cost": getattr(v, "cost_price", 0.0) or 0.0,
        }

    # 1) Match EXACTO por SKU o barcode (lector de código de barras)
    exact = await db.execute(
        select(ProductVariant, Product)
        .join(Product, ProductVariant.product_id == Product.id)
        .where((ProductVariant.sku == q) | (ProductVariant.barcode == q))
        .limit(2)
    )
    exact_rows = exact.all()
    if len(exact_rows) == 1:
        # Un solo match exacto → escaneo bulletproof, regresar solo eso
        v, p = exact_rows[0]
        return [_serialize(v, p)]

    # 2) Match parcial por SKU, barcode o nombre
    stmt = (
        select(ProductVariant, Product)
        .join(Product, ProductVariant.product_id == Product.id)
        .where(
            (ProductVariant.sku == q) | (ProductVariant.barcode == q) |
            Product.name.ilike(f"%{q}%") | ProductVariant.sku.ilike(f"%{q}%")
        )
        .limit(limit)
    )
    res = await db.execute(stmt)
    return [_serialize(v, p) for v, p in res.all()]
