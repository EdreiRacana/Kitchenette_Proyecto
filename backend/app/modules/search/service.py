from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import schemas


async def global_search(db: AsyncSession, q: str, limit: int = 5) -> schemas.GlobalSearchResult:
    """Fan out a single query string across the modules that have a
    user-facing 'find a record' concept: customers, sales orders, products
    (by name or SKU), suppliers, purchase orders (by folio), and HR employees.
    Each module keeps its own search/filter semantics — this just probes the
    handful of fields a user is likely typing and caps each section to
    `limit` so the dropdown stays scannable.
    """
    like = f"%{q}%"
    result = schemas.GlobalSearchResult()

    from app.modules.customers import models as cust_models
    cust_stmt = (
        select(cust_models.Customer)
        .where(or_(cust_models.Customer.name.ilike(like), cust_models.Customer.rfc.ilike(like),
                    cust_models.Customer.email.ilike(like)))
        .limit(limit)
    )
    for c in (await db.execute(cust_stmt)).scalars().all():
        result.customers.append(schemas.SearchResultItem(
            kind="customer", id=c.id, title=c.name, subtitle=c.rfc or c.email,
            page="clientes", query=c.name,
        ))

    from app.modules.sales import models as sales_models
    order_stmt = (
        select(sales_models.Order)
        .where(sales_models.Order.kind == "order", sales_models.Order.folio.ilike(like))
        .limit(limit)
    )
    for o in (await db.execute(order_stmt)).scalars().all():
        result.orders.append(schemas.SearchResultItem(
            kind="order", id=o.id, title=o.folio or f"#{o.id}", subtitle=f"${o.total_amount:,.2f}",
            page="ventas", query=o.folio or str(o.id),
        ))

    from app.modules.inventory import models as inv_models
    prod_stmt = (
        select(inv_models.Product)
        .where(inv_models.Product.name.ilike(like))
        .limit(limit)
    )
    for p in (await db.execute(prod_stmt)).scalars().all():
        result.products.append(schemas.SearchResultItem(
            kind="product", id=p.id, title=p.name, subtitle=p.category,
            page="inventario", query=p.name,
        ))
    if len(result.products) < limit:
        variant_stmt = (
            select(inv_models.ProductVariant)
            .options(selectinload(inv_models.ProductVariant.product))
            .where(inv_models.ProductVariant.sku.ilike(like))
            .limit(limit - len(result.products))
        )
        seen = {r.id for r in result.products}
        for v in (await db.execute(variant_stmt)).scalars().all():
            if v.product_id in seen:
                continue
            result.products.append(schemas.SearchResultItem(
                kind="product", id=v.product_id, title=v.product.name if v.product else v.sku,
                subtitle=v.sku, page="inventario", query=v.sku,
            ))
            seen.add(v.product_id)

    supplier_stmt = (
        select(inv_models.Supplier)
        .where(or_(inv_models.Supplier.name.ilike(like), inv_models.Supplier.rfc.ilike(like)))
        .limit(limit)
    )
    for s in (await db.execute(supplier_stmt)).scalars().all():
        result.suppliers.append(schemas.SearchResultItem(
            kind="supplier", id=s.id, title=s.name, subtitle=s.rfc,
            page="inventario", query=s.name,
        ))

    po_stmt = (
        select(inv_models.PurchaseOrder)
        .where(inv_models.PurchaseOrder.folio.ilike(like))
        .limit(limit)
    )
    for po in (await db.execute(po_stmt)).scalars().all():
        result.purchase_orders.append(schemas.SearchResultItem(
            kind="purchase_order", id=po.id, title=po.folio or f"PO-{po.id}",
            subtitle=f"${po.total_amount:,.2f}", page="inventario", query=po.folio or str(po.id),
        ))

    from app.modules.hr import models as hr_models
    emp_stmt = (
        select(hr_models.Employee)
        .where(or_(hr_models.Employee.name.ilike(like), hr_models.Employee.last_name.ilike(like),
                    hr_models.Employee.employee_number.ilike(like)))
        .limit(limit)
    )
    for e in (await db.execute(emp_stmt)).scalars().all():
        result.employees.append(schemas.SearchResultItem(
            kind="employee", id=e.id, title=f"{e.name} {e.last_name}", subtitle=e.position,
            page="rh", query=f"{e.name} {e.last_name}",
        ))

    return result
