"""Shopify Admin API connector — REST 2024-10.

Auth: private/custom app en la tienda del cliente. El cliente genera un
Admin API access token (Settings → Apps and sales channels → Develop apps
→ Configure Admin API scopes: read_orders, read_customers, read_products
→ Install → Reveal token). Guardamos:
  - shop_domain: "mi-tienda.myshopify.com"
  - access_token: "shpat_..."

Ritmo: Shopify permite 2 req/s (bucket 40). Nuestro sync es secuencial y
usa `updated_at_min` para incremental, así que un cliente típico con
1000 pedidos/mes traerá <500 requests por corrida.

Idempotencia: cada order de Shopify tiene un `id` numérico único. Lo
guardamos en Order.notes prefijado con "shopify:{id}" para detectar
duplicados en re-runs. Esta es una convención barata (sin migración de
esquema) para el MVP; cuando haya volumen, mover a tabla dedicada
`external_order_refs`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import json
import httpx

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.modules.marketplaces import models, schemas
from app.modules.marketplaces.connectors.base import BaseConnector
from app.modules.sales import models as sales_models


SHOPIFY_API_VERSION = "2024-10"


class ShopifyConnector(BaseConnector):
    PLATFORM_KEY = "shopify"
    LABEL = "Shopify"
    DOCS_URL = "https://shopify.dev/docs/api/admin-rest/2024-10/resources/order"
    FIELDS = [
        {"key": "shop_domain", "label": "Dominio de la tienda", "type": "text", "required": True,
         "placeholder": "mi-tienda.myshopify.com", "hint": "Incluye .myshopify.com"},
        {"key": "access_token", "label": "Admin API access token", "type": "password", "required": True,
         "placeholder": "shpat_...", "hint": "Se genera en Settings → Apps → Develop apps → Reveal token"},
    ]

    def _client(self, creds: Dict[str, Any]) -> httpx.AsyncClient:
        shop = (creds.get("shop_domain") or "").strip().rstrip("/")
        token = (creds.get("access_token") or "").strip()
        if not shop or not token:
            raise ValueError("Faltan credenciales: shop_domain y access_token son obligatorios")
        base = f"https://{shop}/admin/api/{SHOPIFY_API_VERSION}"
        return httpx.AsyncClient(base_url=base, timeout=30.0, headers={
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    async def sync_orders(self, db: AsyncSession, conn: models.MarketplaceConnection,
                          since: Optional[datetime] = None) -> schemas.SyncResult:
        creds = json.loads(conn.credentials) if conn.credentials else {}
        since_dt = since or conn.last_sync_at
        until_dt = datetime.now(timezone.utc)

        params: Dict[str, Any] = {
            "status": "any",
            "limit": 100,
            "order": "updated_at asc",
        }
        if since_dt:
            params["updated_at_min"] = since_dt.astimezone(timezone.utc).isoformat()

        imported = 0
        dup = 0
        errors: List[str] = []
        page_url: Optional[str] = None

        async with self._client(creds) as client:
            resp = await client.get("/orders.json", params=params)
            if resp.status_code == 401:
                raise ValueError("Token de Shopify rechazado (401). Verifica que sigue vigente y con scope read_orders.")
            resp.raise_for_status()
            data = resp.json()

            while True:
                orders = data.get("orders", []) or []
                for so in orders:
                    try:
                        ok = await self._materialize_order(db, conn, so)
                        if ok:
                            imported += 1
                        else:
                            dup += 1
                    except Exception as e:
                        errors.append(f"order {so.get('id')}: {e}")

                # Paginación por Link header (rel="next")
                link = resp.headers.get("Link", "")
                next_url = _parse_next_link(link)
                if not next_url:
                    break
                resp = await client.get(next_url)
                resp.raise_for_status()
                data = resp.json()

        await db.flush()
        conn.last_sync_at = until_dt
        conn.last_sync_orders = imported
        conn.last_error = "; ".join(errors)[:2000] if errors else None
        await db.commit()

        return schemas.SyncResult(
            connection_id=conn.id, platform=self.PLATFORM_KEY,
            orders_imported=imported, orders_skipped_duplicate=dup,
            error=conn.last_error, since=since_dt, until=until_dt,
        )

    async def _materialize_order(self, db: AsyncSession,
                                  conn: models.MarketplaceConnection,
                                  so: Dict[str, Any]) -> bool:
        """Convierte una orden Shopify en Order local. True si es nueva."""
        external_id = str(so.get("id") or "")
        if not external_id:
            return False
        marker = f"shopify:{external_id}"

        # Idempotencia por marker en notes
        existing = (await db.execute(
            select(sales_models.Order.id)
            .where(sales_models.Order.channel == self.PLATFORM_KEY)
            .where(sales_models.Order.notes.ilike(f"%{marker}%"))
            .limit(1)
        )).scalar_one_or_none()
        if existing:
            return False

        created_at = _parse_shopify_dt(so.get("created_at"))
        subtotal = float(so.get("subtotal_price") or 0.0)
        total = float(so.get("total_price") or 0.0)
        tax_amount = float(so.get("total_tax") or 0.0)
        shipping = 0.0
        for sl in (so.get("shipping_lines") or []):
            shipping += float(sl.get("price") or 0.0)
        discount = float(so.get("total_discounts") or 0.0)
        currency = so.get("currency") or "MXN"
        fin_status = so.get("financial_status") or "pending"
        status = "paid" if fin_status == "paid" else "pending"

        order = sales_models.Order(
            folio=f"SHP-{so.get('order_number') or so.get('name') or external_id}",
            kind="order",
            customer_id=conn.customer_id,
            warehouse_id=conn.default_warehouse_id,
            status=status,
            payment_method="shopify",
            channel=self.PLATFORM_KEY,
            currency=currency,
            subtotal=subtotal,
            discount_type="amount",
            discount_value=discount,
            discount_amount=discount,
            tax_amount=tax_amount,
            shipping_amount=shipping,
            total_amount=total,
            paid_amount=total if status == "paid" else 0.0,
            balance=0.0 if status == "paid" else total,
            notes=f"[{marker}] {so.get('name') or ''}".strip(),
            created_at=created_at,
        )
        db.add(order)
        await db.flush()

        # Line items
        for li in (so.get("line_items") or []):
            db.add(sales_models.OrderItem(
                order_id=order.id,
                variant_id=None,   # sin mapeo automático de variantes en el MVP
                product_name=li.get("title") or li.get("name") or "Producto Shopify",
                sku=li.get("sku") or None,
                quantity=int(li.get("quantity") or 1),
                unit_price=float(li.get("price") or 0.0),
                discount_amount=float(li.get("total_discount") or 0.0),
                tax_rate=0.0,
                subtotal=float(li.get("price") or 0.0) * int(li.get("quantity") or 1),
                total=float(li.get("price") or 0.0) * int(li.get("quantity") or 1),
            ))
        return True


def _parse_shopify_dt(s: Optional[str]) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    # "2024-10-15T14:30:00-06:00"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


def _parse_next_link(link_header: str) -> Optional[str]:
    """Extrae URL con rel="next" del header Link de Shopify (RFC 5988)."""
    if not link_header:
        return None
    for part in link_header.split(","):
        seg = part.strip()
        if 'rel="next"' in seg and seg.startswith("<"):
            end = seg.find(">")
            if end > 0:
                return seg[1:end]
    return None
