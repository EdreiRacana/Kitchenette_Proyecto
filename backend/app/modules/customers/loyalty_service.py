"""
Programa de fidelización — servicio.

Responsable de:
  * CRUD de tiers y configuración del programa (singleton id=1)
  * Búsqueda rápida de cliente por código de tarjeta / teléfono / email / nombre
  * Historial y recomendaciones (por categoría/subcategoría)
  * Recalcular tier automáticamente al cerrar una venta
  * Generación de tarjeta PDF con branding de la empresa
  * Job de envío de correos de cumpleaños

Todos los flujos son defensivos: si el programa está apagado (is_enabled=False),
la búsqueda igual funciona pero no se aplica descuento ni se recalcula tier.
"""

from datetime import datetime, timezone, timedelta, date
from io import BytesIO
from typing import List, Optional
import hmac
import hashlib
import secrets
import string

from sqlalchemy import func, or_, and_, extract
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.modules.customers.models import Customer, CustomerTier, LoyaltyProgramConfig
from app.modules.sales.models import Order, OrderItem
from app.modules.inventory.models import ProductVariant, Product


# ── Configuración singleton ────────────────────────────────────────────────

async def get_program_config(db: AsyncSession) -> LoyaltyProgramConfig:
    cfg = await db.get(LoyaltyProgramConfig, 1)
    if cfg is None:
        cfg = LoyaltyProgramConfig(id=1)
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


async def update_program_config(db: AsyncSession, data: dict) -> LoyaltyProgramConfig:
    cfg = await get_program_config(db)
    for field, value in data.items():
        if value is not None and hasattr(cfg, field):
            setattr(cfg, field, value)
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ── Tiers ──────────────────────────────────────────────────────────────────

async def list_tiers(db: AsyncSession, *, only_active: bool = False) -> List[CustomerTier]:
    stmt = select(CustomerTier).order_by(CustomerTier.rank.asc())
    if only_active:
        stmt = stmt.where(CustomerTier.is_active.is_(True))
    return (await db.execute(stmt)).scalars().all()


async def create_tier(db: AsyncSession, data: dict) -> CustomerTier:
    t = CustomerTier(
        name=data["name"],
        color_hex=data.get("color_hex"),
        rank=int(data.get("rank") or 0),
        discount_pct=float(data.get("discount_pct") or 0.0),
        min_spend=float(data.get("min_spend") or 0.0),
        min_orders=int(data.get("min_orders") or 0),
        min_avg_ticket=float(data.get("min_avg_ticket") or 0.0),
        perks=data.get("perks"),
        is_active=bool(data.get("is_active", True)),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def update_tier(db: AsyncSession, tier_id: int, data: dict) -> Optional[CustomerTier]:
    t = await db.get(CustomerTier, tier_id)
    if not t:
        return None
    for field in ("name", "color_hex", "rank", "discount_pct", "min_spend",
                  "min_orders", "min_avg_ticket", "perks", "is_active"):
        if field in data and data[field] is not None:
            setattr(t, field, data[field])
    await db.commit()
    await db.refresh(t)
    return t


async def delete_tier(db: AsyncSession, tier_id: int) -> bool:
    t = await db.get(CustomerTier, tier_id)
    if not t:
        return False
    # Desligar customers de este tier para no romper FK
    await db.execute(
        Customer.__table__.update().where(Customer.tier_id == tier_id).values(tier_id=None)
    )
    await db.delete(t)
    await db.commit()
    return True


# ── Lookup rápido para el POS ──────────────────────────────────────────────

def _serialize_customer_lite(c: Customer, tier: Optional[CustomerTier]) -> dict:
    return {
        "id": c.id,
        "client_number": c.client_number,
        "loyalty_code": c.loyalty_code,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "date_of_birth": c.date_of_birth.isoformat() if c.date_of_birth else None,
        "accepts_marketing": c.accepts_marketing,
        "total_spent_lifetime": c.total_spent_lifetime or 0.0,
        "total_orders_lifetime": c.total_orders_lifetime or 0,
        "last_order_at": c.last_order_at.isoformat() if c.last_order_at else None,
        "tier": {
            "id": tier.id, "name": tier.name, "color_hex": tier.color_hex,
            "discount_pct": tier.discount_pct, "perks": tier.perks,
        } if tier else None,
        "loyalty_expires_at": c.loyalty_expires_at.isoformat() if c.loyalty_expires_at else None,
    }


async def search_customers_lite(db: AsyncSession, query: str, limit: int = 8) -> List[dict]:
    """Búsqueda difusa para autocomplete del POS. Devuelve hasta `limit`
    clientes que hacen match parcial en nombre, teléfono, correo, número de
    cliente, RFC o código de tarjeta. Ordena: match exacto primero, después
    los que compraron más recientemente (útil para clientes recurrentes)."""
    q = (query or "").strip()
    if not q or len(q) < 2:
        return []
    like = f"%{q}%"
    stmt = (
        select(Customer).options(selectinload(Customer.tier)).where(or_(
            Customer.name.ilike(like),
            Customer.email.ilike(like),
            Customer.phone.ilike(like),
            Customer.client_number.ilike(like),
            Customer.loyalty_code.ilike(like),
            Customer.rfc.ilike(like),
        ))
        .order_by(Customer.last_order_at.desc().nulls_last(), Customer.name.asc())
        .limit(max(1, min(limit, 25)))
    )
    rows = (await db.execute(stmt)).scalars().all()
    # Priorizar match exacto (correo/tel/código de tarjeta/número de cliente)
    exact = [c for c in rows if (c.email or "").lower() == q.lower()
             or c.phone == q or c.loyalty_code == q or c.client_number == q]
    seen = {c.id for c in exact}
    ordered = exact + [c for c in rows if c.id not in seen]
    return [_serialize_customer_lite(c, c.tier) for c in ordered]


async def lookup_customer(db: AsyncSession, query: str) -> Optional[dict]:
    """Búsqueda flexible: id > código de tarjeta > teléfono > email >
    número de cliente > nombre. Retorna el primer match.
    Si `query` es numérico también matchea contra `Customer.id` para que la
    vista 360 pueda cargar los datos de fidelidad usando el id del cliente."""
    q = (query or "").strip()
    if not q:
        return None

    conditions = [
        Customer.loyalty_code == q,
        Customer.phone == q,
        Customer.email == q.lower(),
        Customer.client_number == q,
        Customer.name.ilike(f"%{q}%"),
    ]
    if q.isdigit():
        # Precedencia: id exacto > cualquier match textual
        conditions.insert(0, Customer.id == int(q))

    stmt = select(Customer).options(selectinload(Customer.tier)).where(
        or_(*conditions)
    ).limit(1)
    c = (await db.execute(stmt)).scalars().first()
    if not c:
        return None
    return _serialize_customer_lite(c, c.tier)


# ── Historial y recomendaciones ────────────────────────────────────────────

async def get_customer_history(db: AsyncSession, customer_id: int, limit: int = 20) -> List[dict]:
    """Últimas N interacciones del cliente: compras y devoluciones intercaladas
    por fecha. Al cajero le sirve para verlo en el panel del POS cuando lo
    identifica, y a Ventas/CRM para mostrar el historial completo."""
    stmt = (
        select(Order).where(Order.customer_id == customer_id, Order.kind == "order")
        .order_by(Order.created_at.desc()).limit(limit)
        .options(selectinload(Order.items))
    )
    orders = (await db.execute(stmt)).scalars().all()
    out: List[dict] = []
    for o in orders:
        out.append({
            "id": o.id, "folio": o.folio,
            "kind": "sale",
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "total_amount": o.total_amount or 0.0,
            "status": o.status,
            "items": [
                {
                    "variant_id": it.variant_id,
                    "product_name": it.product_name,
                    "sku": it.sku,
                    "quantity": it.quantity,
                    "unit_price": it.unit_price,
                }
                for it in (o.items or [])
            ],
        })

    # Devoluciones del cliente: se mezclan en la misma lista para dar contexto
    # (el cajero necesita saber si el cliente devolvió algo, no solo qué compró).
    from app.modules.sales.models import CustomerReturn, CustomerReturnItem
    rstmt = (
        select(CustomerReturn).where(CustomerReturn.customer_id == customer_id)
        .order_by(CustomerReturn.created_at.desc()).limit(limit)
        .options(selectinload(CustomerReturn.items))
    )
    rets = (await db.execute(rstmt)).scalars().all()
    for r in rets:
        out.append({
            "id": r.id, "folio": r.folio,
            "kind": "return",
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "total_amount": -(r.refund_amount or 0.0),   # negativo para diferenciar visualmente
            "status": r.status,
            "settlement_type": r.settlement_type,
            "reason": r.reason,
            "items": [
                {
                    "variant_id": it.variant_id,
                    "product_name": it.product_name,
                    "sku": it.sku,
                    "quantity": -(it.quantity or 0),
                    "unit_price": it.unit_price,
                }
                for it in (r.items or [])
            ],
        })

    out.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return out[:limit]


async def get_customer_recommendations(db: AsyncSession, customer_id: int, limit: int = 5) -> List[dict]:
    """Recomienda variantes basadas en las CATEGORÍAS que el cliente ya compró.
    Algoritmo (simple pero efectivo, patrón usado por Amazon en su MVP):
      1. Categorías donde el cliente concentra sus compras (top N)
      2. Productos más vendidos globalmente en esas categorías
      3. Excluye lo que ya compró en los últimos 90 días
    """
    # 1) Categorías del cliente (con peso por cantidad comprada)
    cat_stmt = (
        select(Product.category, func.sum(OrderItem.quantity).label("qty"))
        .join(ProductVariant, ProductVariant.id == OrderItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.customer_id == customer_id,
            Order.kind == "order",
            Order.status.notin_(["cancelled", "draft"]),
            Product.category.isnot(None),
        )
        .group_by(Product.category)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(3)
    )
    top_cats = [r[0] for r in (await db.execute(cat_stmt)).all() if r[0]]
    if not top_cats:
        return []

    # 2) Variantes ya compradas en 90d (para excluirlas)
    since = datetime.now(timezone.utc) - timedelta(days=90)
    bought_stmt = (
        select(OrderItem.variant_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.customer_id == customer_id, Order.created_at >= since)
    )
    already = {r[0] for r in (await db.execute(bought_stmt)).all() if r[0]}

    # 3) Top variantes globales en esas categorías (últimos 180 días)
    since_wide = datetime.now(timezone.utc) - timedelta(days=180)
    rec_stmt = (
        select(
            ProductVariant.id.label("vid"),
            Product.name.label("product_name"),
            ProductVariant.sku,
            ProductVariant.price,
            Product.category,
            func.sum(OrderItem.quantity).label("global_qty"),
        )
        .join(Product, Product.id == ProductVariant.product_id)
        .join(OrderItem, OrderItem.variant_id == ProductVariant.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Product.category.in_(top_cats),
            Order.kind == "order",
            Order.status.notin_(["cancelled", "draft"]),
            Order.created_at >= since_wide,
            ProductVariant.is_active.is_(True),
        )
        .group_by(ProductVariant.id, Product.name, ProductVariant.sku, ProductVariant.price, Product.category)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(limit * 3)  # margen para poder filtrar los ya-comprados
    )
    rows = (await db.execute(rec_stmt)).all()
    out = []
    for r in rows:
        if r.vid in already:
            continue
        out.append({
            "variant_id": r.vid,
            "product_name": r.product_name,
            "sku": r.sku,
            "price": r.price,
            "category": r.category,
        })
        if len(out) >= limit:
            break
    return out


# ── Recalcular tier ────────────────────────────────────────────────────────

def _pick_tier(tiers: List[CustomerTier], spent: float, orders: int, avg_ticket: float) -> Optional[CustomerTier]:
    """Elige el tier más alto (mayor rank) para el que el cliente cumple TODOS
    los umbrales configurados. Umbrales en 0 se consideran no-aplican."""
    eligible = []
    for t in tiers:
        if not t.is_active:
            continue
        if t.min_spend > 0 and spent < t.min_spend:
            continue
        if t.min_orders > 0 and orders < t.min_orders:
            continue
        if t.min_avg_ticket > 0 and avg_ticket < t.min_avg_ticket:
            continue
        # Si el tier no tiene umbrales, solo aplica por asignación manual
        if t.min_spend <= 0 and t.min_orders <= 0 and t.min_avg_ticket <= 0:
            continue
        eligible.append(t)
    if not eligible:
        return None
    return max(eligible, key=lambda x: x.rank)


async def recompute_customer_tier(db: AsyncSession, customer_id: int) -> Optional[Customer]:
    """Recalcula tier de UN cliente. Actualiza totals cacheados usando la
    ventana configurada en el programa (o vitalicio si es None)."""
    c = await db.get(Customer, customer_id)
    if not c:
        return None
    cfg = await get_program_config(db)
    if not cfg.is_enabled:
        return c

    # Ventana
    if cfg.tier_lookback_months and cfg.tier_lookback_months > 0:
        since = datetime.now(timezone.utc) - timedelta(days=cfg.tier_lookback_months * 30)
    else:
        since = None

    q = (
        select(
            func.coalesce(func.sum(Order.total_amount), 0.0).label("spent"),
            func.count(Order.id).label("orders"),
            func.max(Order.created_at).label("last_at"),
        )
        .where(
            Order.customer_id == customer_id,
            Order.kind == "order",
            Order.status.notin_(["cancelled", "draft"]),
        )
    )
    if since is not None:
        q = q.where(Order.created_at >= since)
    row = (await db.execute(q)).one()
    spent = float(row.spent or 0.0)
    orders = int(row.orders or 0)
    avg_ticket = (spent / orders) if orders > 0 else 0.0

    # Update totals cacheados (siempre reflejan la ventana usada para tier)
    c.total_spent_lifetime = spent
    c.total_orders_lifetime = orders
    if row.last_at:
        c.last_order_at = row.last_at

    tiers = await list_tiers(db, only_active=True)
    chosen = _pick_tier(tiers, spent, orders, avg_ticket)
    # Respetar override manual — si el operador fijó el tier a mano, no lo movemos.
    if c.manual_tier:
        chosen = c.tier if c.tier_id else None
    if chosen is not None:
        c.tier_id = chosen.id
        # Extender vigencia de la tarjeta si aplica
        if cfg.card_validity_days:
            c.loyalty_expires_at = datetime.now(timezone.utc) + timedelta(days=cfg.card_validity_days)
        if not c.loyalty_since:
            c.loyalty_since = datetime.now(timezone.utc)
        if not c.loyalty_code:
            c.loyalty_code = _generate_loyalty_code(c.id)

    await db.commit()
    await db.refresh(c)
    return c


def _generate_loyalty_code(customer_id: int) -> str:
    """Genera un código humanamente legible tipo LP-A3B7-XXXXX."""
    alphabet = string.ascii_uppercase + string.digits
    tail = "".join(secrets.choice(alphabet) for _ in range(5))
    return f"LP-{customer_id:04d}-{tail}"


async def recompute_all_tiers(db: AsyncSession) -> dict:
    """Job masivo — típicamente corrido nightly. Recalcula tier de todos los
    clientes con al menos una compra."""
    ids = (await db.execute(
        select(Customer.id).where(Customer.total_orders_lifetime > 0)
        .union(select(Order.customer_id).where(Order.customer_id.isnot(None)).distinct())
    )).scalars().all()
    updated = 0
    for cid in set(ids):
        if cid:
            await recompute_customer_tier(db, cid)
            updated += 1
    return {"updated": updated}


# ── Job de cumpleaños ──────────────────────────────────────────────────────

async def find_todays_birthdays(db: AsyncSession) -> List[Customer]:
    """Clientes con cumpleaños hoy que aceptan marketing y tienen email."""
    today = date.today()
    stmt = select(Customer).where(
        Customer.date_of_birth.isnot(None),
        Customer.accepts_marketing.is_(True),
        Customer.email.isnot(None),
        Customer.is_active.is_(True),
        extract("month", Customer.date_of_birth) == today.month,
        extract("day", Customer.date_of_birth) == today.day,
    )
    return (await db.execute(stmt)).scalars().all()


async def send_birthday_emails(db: AsyncSession) -> dict:
    """Encuentra cumpleañeros y envía el correo. Retorna resumen para dashboard."""
    cfg = await get_program_config(db)
    if not cfg.is_enabled or not cfg.birthday_email_enabled:
        return {"skipped": True, "reason": "birthday_disabled"}
    people = await find_todays_birthdays(db)
    if not people:
        return {"sent": 0}

    # Reutiliza el sender genérico de la app (mismo transporte que el resto).
    from app.core.email import send_email
    sent, failed = 0, 0
    subject = cfg.birthday_email_subject or "¡Feliz cumpleaños!"
    tpl = cfg.birthday_email_body or (
        "¡Hola {name}! Te deseamos un feliz cumpleaños. "
        "Muestra tu tarjeta {program} en tienda para tu descuento especial."
    )
    for c in people:
        first = ((c.name or "").split() or ["amig@"])[0]
        body_txt = tpl.format(name=first, program=cfg.program_name or "de fidelidad")
        body_html = f"<p>{body_txt}</p>"
        try:
            ok = await send_email(db, to=c.email, subject=subject, body_html=body_html)
            if ok:
                sent += 1
            else:
                failed += 1
        except Exception:
            failed += 1
    return {"sent": sent, "failed": failed, "total": len(people)}


# ── Tarjeta PDF ────────────────────────────────────────────────────────────

async def generate_loyalty_card_pdf(db: AsyncSession, customer_id: int, company: dict) -> Optional[bytes]:
    """Genera un PDF de tarjeta de fidelidad — estilo tarjeta de crédito
    (85 × 55 mm relativas, escaladas a A6 con márgenes), con logo, gradiente
    y QR del loyalty_code."""
    c = await db.execute(
        select(Customer).options(selectinload(Customer.tier)).where(Customer.id == customer_id)
    )
    customer = c.scalars().first()
    if not customer or not customer.loyalty_code:
        return None

    cfg = await get_program_config(db)
    tier = customer.tier

    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A6
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase.pdfmetrics import stringWidth

    buf = BytesIO()
    page_w, page_h = A6  # 105 x 148 mm — vertical
    c_pdf = canvas.Canvas(buf, pagesize=A6)

    # Paleta AUTO-ADAPTATIVA: el operador solo escoge card_bg_color y el
    # resto se calcula solo. Evita "texto oscuro sobre fondo oscuro" cuando
    # la config de la empresa tiene un bg heredado de otro momento.
    bg = cfg.card_bg_color or "#FFFFFF"

    def _luminance(hex_color: str) -> float:
        """Luminancia percibida 0..1 según fórmula estándar sRGB."""
        h = hex_color.lstrip("#")
        if len(h) != 6:
            return 1.0
        r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    _is_dark_bg = _luminance(bg) < 0.5
    # Auto: texto claro sobre bg oscuro, texto oscuro sobre bg claro.
    # Si la empresa configuró card_text_color explícitamente Y es coherente
    # (contrasta con el bg), lo respetamos. Si no, forzamos coherencia.
    if cfg.card_text_color:
        cfg_txt_dark = _luminance(cfg.card_text_color) < 0.5
        if cfg_txt_dark == _is_dark_bg:
            # Texto y fondo tienen misma "familia" → mal contraste, forzamos auto
            text_color = "#FFFFFF" if _is_dark_bg else "#1A1A1A"
        else:
            text_color = cfg.card_text_color
    else:
        text_color = "#FFFFFF" if _is_dark_bg else "#1A1A1A"
    text_muted = "#B8BEC9" if _is_dark_bg else "#6B7280"
    gold = (tier.color_hex if tier and tier.color_hex else (cfg.card_accent_color or "#C9A961"))

    # ═══════════════════════════════════════════════════════════════
    # DISEÑO SOBRIO — inspiración Amex Platinum / tarjetas de museo.
    # Cero adornos: solo tipografía, espacio en blanco, y UN acento dorado.
    # Todo el peso visual lo lleva la jerarquía del texto.
    # ═══════════════════════════════════════════════════════════════

    # Fondo sólido navy
    c_pdf.setFillColor(HexColor(bg))
    c_pdf.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    # Marco interior extremadamente fino (opcional, muy sutil)
    inset = 4 * mm
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.3)
    c_pdf.rect(inset, inset, page_w - 2 * inset, page_h - 2 * inset, fill=0, stroke=1)

    pad = 10 * mm  # margen interno consistente

    # ── Zona superior: logo pequeño + programa ────────────────────────
    # El círculo del logo SIEMPRE tiene fondo blanco — así el logo real de
    # la empresa (que suele tener transparencia y colores propios) se ve
    # bien tanto en tarjetas de fondo claro como oscuro.
    logo_bytes = company.get("logo_bytes")
    logo_r = 7 * mm
    logo_cx = pad + logo_r
    logo_cy = page_h - pad - logo_r
    c_pdf.setFillColor(white)
    c_pdf.circle(logo_cx, logo_cy, logo_r, fill=1, stroke=0)
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.5)
    c_pdf.circle(logo_cx, logo_cy, logo_r, fill=0, stroke=1)
    if logo_bytes:
        try:
            img = ImageReader(BytesIO(logo_bytes))
            side = logo_r * 1.6
            c_pdf.drawImage(
                img, logo_cx - side / 2, logo_cy - side / 2,
                width=side, height=side,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            pass
    else:
        # Sin logo: iniciales en oscuro sobre el círculo blanco
        name0 = (company.get("commercial_name") or company.get("legal_name") or "").strip()
        initials = "".join(w[0] for w in name0.split()[:2]).upper() or "*"
        c_pdf.setFillColor(HexColor("#1A1A1A"))
        c_pdf.setFont("Times-Bold", 12)
        c_pdf.drawCentredString(logo_cx, logo_cy - 4, initials)

    # Nombre de la empresa a la derecha del logo (small caps)
    company_name = (company.get("commercial_name") or company.get("legal_name") or "").upper()
    text_x = pad + 2 * logo_r + 4 * mm
    c_pdf.setFillColor(HexColor(text_color))
    c_pdf.setFont("Helvetica-Bold", 8)
    c_pdf.drawString(text_x, logo_cy + 2 * mm, company_name[:32])
    # Programa (small caps, muy delgado) — separado 4mm abajo para no chocar
    c_pdf.setFillColor(HexColor(text_muted))
    c_pdf.setFont("Helvetica", 6.5)
    prog_txt = (cfg.program_name or "Programa de Fidelidad").upper()
    c_pdf.drawString(text_x, logo_cy - 3 * mm, prog_txt[:36])

    # ── Único acento decorativo: línea horizontal fina dorada ────────
    accent_y = page_h - 30 * mm
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.6)
    c_pdf.line(pad, accent_y, pad + 20 * mm, accent_y)

    # ── Nombre del titular en tipografía grande serif ────────────────
    name_txt = customer.name or ""
    # Auto-fit
    max_name_w = page_w - 2 * pad
    name_size = 22
    while stringWidth(name_txt.upper(), "Times-Roman", name_size) > max_name_w and name_size > 12:
        name_size -= 0.5
    c_pdf.setFillColor(HexColor(text_color))
    c_pdf.setFont("Times-Roman", name_size)
    c_pdf.drawString(pad, accent_y - 12 * mm, name_txt.upper())

    # ── Tier + año de miembro (SIN repetir el descuento) ─────────────
    # El descuento se muestra UNA sola vez, como hero abajo. Aquí solo
    # aparece el nombre del nivel y la fecha de alta.
    tier_line_y = accent_y - 22 * mm
    if tier:
        c_pdf.setFillColor(HexColor(gold))
        c_pdf.setFont("Helvetica-Bold", 10)
        c_pdf.drawString(pad, tier_line_y, tier.name.upper())

    if customer.loyalty_since:
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Times-Italic", 9)
        c_pdf.drawString(pad, tier_line_y - 6 * mm,
                          f"Miembro desde {customer.loyalty_since.year}")

    # ── Descuento gigante como elemento visual principal ─────────────
    # Alineado a la derecha. Es el "hero" del diseño.
    if tier and tier.discount_pct > 0:
        pct_txt = f"{int(tier.discount_pct)}"
        num_size = 56
        c_pdf.setFont("Times-Bold", num_size)
        pct_w = stringWidth(pct_txt, "Times-Bold", num_size)
        # % ancho para reservarlo a la derecha
        pct_char_size = 24
        pct_char_w = stringWidth("%", "Times-Bold", pct_char_size)
        num_y = page_h * 0.35   # baseline del número grande
        num_x = page_w - pad - pct_w - pct_char_w - 2 * mm

        c_pdf.setFillColor(HexColor(gold))
        c_pdf.drawString(num_x, num_y, pct_txt)
        # "%" alineado con la parte superior del número (altura de mayúscula
        # aprox = fontSize * 0.7 pt ≈ num_size * 0.247 mm)
        pct_top_offset = num_size * 0.72 * 0.353  # cap height en mm
        c_pdf.setFont("Times-Bold", pct_char_size)
        c_pdf.drawString(num_x + pct_w + 1 * mm,
                          num_y + pct_top_offset - pct_char_size * 0.72 * 0.353,
                          "%")
        # "OFF" pequeño en la línea base del número, a la derecha
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Helvetica-Bold", 8)
        c_pdf.drawString(num_x + pct_w + 1 * mm, num_y, "OFF")

    # ── Perks (una sola línea sobria, itálica pequeña) ───────────────
    if tier and (tier.perks or "").strip():
        perks = (tier.perks or "").strip()
        if len(perks) > 55:
            perks = perks[:52] + "..."
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Times-Italic", 8)
        c_pdf.drawString(pad, 60 * mm, perks)

    # ── Bloque inferior: código + vigencia (izq) | QR (der) ──────────
    # Sin borde alrededor. Solo texto limpio.
    footer_baseline = 22 * mm
    c_pdf.setFillColor(HexColor(text_muted))
    c_pdf.setFont("Helvetica", 6.5)
    c_pdf.drawString(pad, footer_baseline + 12 * mm, "CÓDIGO")
    c_pdf.setFillColor(HexColor(text_color))
    c_pdf.setFont("Courier", 11)
    c_pdf.drawString(pad, footer_baseline + 7 * mm, customer.loyalty_code)

    if customer.loyalty_expires_at:
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Helvetica", 6.5)
        c_pdf.drawString(pad, footer_baseline, "VIGENTE HASTA")
        c_pdf.setFillColor(HexColor(text_color))
        c_pdf.setFont("Helvetica", 9)
        c_pdf.drawString(pad, footer_baseline - 5 * mm,
                          customer.loyalty_expires_at.strftime("%d.%m.%Y"))

    # QR: sin marco decorativo, solo fondo blanco necesario para escaneo
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=3, border=1)
        qr.add_data(customer.loyalty_code)
        qr.make(fit=True)
        qr_img_pil = qr.make_image(fill_color="#000000", back_color="#FFFFFF")
        img_buf = BytesIO()
        qr_img_pil.save(img_buf, format="PNG")
        img_buf.seek(0)
        qr_size = 22 * mm
        qr_x = page_w - qr_size - pad
        qr_y = footer_baseline - 6 * mm
        # SIEMPRE fondo blanco alrededor del QR — funciona con bg claro y oscuro
        c_pdf.setFillColor(white)
        c_pdf.rect(qr_x - 1.5 * mm, qr_y - 1.5 * mm,
                    qr_size + 3 * mm, qr_size + 3 * mm,
                    fill=1, stroke=0)
        c_pdf.drawImage(ImageReader(img_buf), qr_x, qr_y,
                          width=qr_size, height=qr_size, mask="auto")
    except Exception:
        pass

    c_pdf.showPage()
    c_pdf.save()
    return buf.getvalue()


# ── Opt-out por HMAC (LFPDPPP) ─────────────────────────────────────────────

def _optout_secret() -> bytes:
    """Usa SECRET_KEY del app (o un fallback derivado del app_name)."""
    try:
        from app.core.config import settings
        s = getattr(settings, "SECRET_KEY", None) or getattr(settings, "PROJECT_NAME", "sthenova")
    except Exception:
        s = "sthenova"
    return str(s).encode("utf-8")


def build_optout_token(customer_id: int) -> str:
    """Firma HMAC(customer_id) → token seguro para el enlace en correos."""
    payload = str(customer_id).encode("utf-8")
    sig = hmac.new(_optout_secret(), payload, hashlib.sha256).hexdigest()[:16]
    return f"{customer_id}.{sig}"


def verify_optout_token(token: str) -> Optional[int]:
    try:
        cid_str, sig = (token or "").split(".", 1)
        expected = build_optout_token(int(cid_str)).split(".", 1)[1]
        return int(cid_str) if hmac.compare_digest(sig, expected) else None
    except Exception:
        return None


async def opt_out_customer(db: AsyncSession, token: str) -> Optional[Customer]:
    cid = verify_optout_token(token)
    if not cid:
        return None
    c = await db.get(Customer, cid)
    if not c:
        return None
    c.accepts_marketing = False
    await db.commit()
    await db.refresh(c)
    return c


# ── Override manual de tier ────────────────────────────────────────────────

async def set_customer_tier(db: AsyncSession, customer_id: int,
                             tier_id: Optional[int], manual: bool = True) -> Optional[Customer]:
    """Asigna (o quita) el tier de un cliente. manual=True marca el override
    para que recompute_customer_tier lo respete.
    Pasar tier_id=None + manual=False → vuelve al modo automático.

    Nota importante: si es una asignación manual (`manual=True`), SIEMPRE
    emite código y vigencia — la intención del operador de fijar tier a mano
    es exactamente esa: emitir tarjeta. Si el programa singleton está apagado,
    también lo prendemos automáticamente para que la tarjeta sea funcional
    (el operador espera que funcione, no que aparezca en modo latente)."""
    c = await db.get(Customer, customer_id)
    if not c:
        return None
    if tier_id is not None:
        tier = await db.get(CustomerTier, tier_id)
        if not tier:
            raise ValueError("Tier no existe")
        c.tier_id = tier_id
        c.manual_tier = manual
        cfg = await get_program_config(db)
        # Si el operador fuerza tier a mano, prender el programa si estaba
        # apagado — de lo contrario la tarjeta queda emitida pero sin efecto.
        if manual and not cfg.is_enabled:
            cfg.is_enabled = True
        # Emitir código de tarjeta siempre (asignación manual o programa activo)
        if manual or cfg.is_enabled:
            if not c.loyalty_code:
                c.loyalty_code = _generate_loyalty_code(c.id)
            if not c.loyalty_since:
                c.loyalty_since = datetime.now(timezone.utc)
            days = cfg.card_validity_days or 365
            c.loyalty_expires_at = datetime.now(timezone.utc) + timedelta(days=days)
    else:
        # Quitar override → recompute recalcula
        c.manual_tier = False
        c.tier_id = None
    await db.commit()
    await db.refresh(c)
    return c


# ── Enviar tarjeta por correo ──────────────────────────────────────────────

async def email_loyalty_card(db: AsyncSession, customer_id: int, company: dict,
                              extra_message: Optional[str] = None) -> dict:
    """Genera la tarjeta PDF y la envía como adjunto al correo del cliente.
    Requiere que el cliente tenga email y loyalty_code emitido."""
    c = await db.get(Customer, customer_id)
    if not c:
        return {"ok": False, "reason": "not_found"}
    if not c.email:
        return {"ok": False, "reason": "no_email"}
    if not c.loyalty_code:
        # Intentar emitirla ahora
        await recompute_customer_tier(db, customer_id)
        c = await db.get(Customer, customer_id)
        if not c.loyalty_code:
            return {"ok": False, "reason": "no_card"}

    pdf = await generate_loyalty_card_pdf(db, customer_id, company)
    if not pdf:
        return {"ok": False, "reason": "pdf_error"}

    cfg = await get_program_config(db)
    subject = f"Tu tarjeta {cfg.program_name}"
    optout_token = build_optout_token(customer_id)
    body_html = (
        f"<p>¡Hola {(c.name or '').split()[0] or 'amig@'}!</p>"
        f"<p>Adjuntamos tu tarjeta <b>{cfg.program_name}</b> — muéstrala en tienda para "
        f"aplicar tu descuento y beneficios exclusivos.</p>"
        + (f"<p>{extra_message}</p>" if extra_message else "")
        + f"<hr style='border:none;border-top:1px solid #ccc;margin:20px 0'>"
        + f"<p style='font-size:11px;color:#888'>Si ya no quieres recibir nuestros correos, "
        + f"puedes darte de baja en cualquier momento contactándonos o usando el enlace de opt-out: "
        + f"<code>{optout_token}</code>. Aviso de privacidad: "
        + f"{cfg.privacy_policy_url or 'contacta a la empresa'}.</p>"
    )
    from app.core.email import send_email
    ok = await send_email(
        db, to=c.email, subject=subject, body_html=body_html,
        attachments=[(f"tarjeta_{c.client_number or c.id}.pdf", pdf, "pdf")],
    )
    return {"ok": bool(ok), "sent_to": c.email if ok else None}


# ── Campañas / segmentación ────────────────────────────────────────────────

async def query_segment(db: AsyncSession, *, tier_ids: Optional[List[int]] = None,
                          only_opt_in: bool = True, birthday_month: Optional[int] = None,
                          min_last_order_days_ago: Optional[int] = None,
                          limit: int = 5000) -> List[Customer]:
    """Filtra clientes por criterios. Se usa para vista previa y para envío
    de campañas. Por defecto exige opt-in (LFPDPPP)."""
    stmt = select(Customer).where(Customer.is_active.is_(True))
    if only_opt_in:
        stmt = stmt.where(Customer.accepts_marketing.is_(True))
    if tier_ids:
        stmt = stmt.where(Customer.tier_id.in_(tier_ids))
    if birthday_month is not None and 1 <= birthday_month <= 12:
        stmt = stmt.where(
            Customer.date_of_birth.isnot(None),
            extract("month", Customer.date_of_birth) == birthday_month,
        )
    if min_last_order_days_ago is not None and min_last_order_days_ago > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=min_last_order_days_ago)
        stmt = stmt.where(
            or_(Customer.last_order_at.is_(None), Customer.last_order_at <= cutoff)
        )
    stmt = stmt.limit(limit)
    return (await db.execute(stmt)).scalars().all()


async def send_campaign(db: AsyncSession, *, segment_filters: dict,
                         subject: str, body_html: str,
                         discount_code: Optional[str] = None) -> dict:
    """Envía un correo a todos los clientes que caen en el segmento.
    body_html soporta placeholders {name}, {code}, {program} y auto-agrega
    aviso + opt-out link al final."""
    if not subject or not body_html:
        raise ValueError("Asunto y cuerpo son obligatorios")
    people = await query_segment(db, **segment_filters)
    cfg = await get_program_config(db)
    from app.core.email import send_email
    sent, failed, skipped = 0, 0, 0
    for c in people:
        if not c.email:
            skipped += 1
            continue
        first = ((c.name or "").split() or ["amig@"])[0]
        rendered = body_html.format(
            name=first,
            code=discount_code or "",
            program=cfg.program_name,
        )
        optout_token = build_optout_token(c.id)
        html = (rendered
                + f"<hr style='border:none;border-top:1px solid #ccc;margin:20px 0'>"
                + f"<p style='font-size:11px;color:#888'>Recibes este correo porque estás "
                + f"suscrito a {cfg.program_name}. Para dejar de recibirlos, contáctanos con "
                + f"tu código de baja: <b>{optout_token}</b>."
                + (f" <a href='{cfg.privacy_policy_url}'>Aviso de privacidad</a>." if cfg.privacy_policy_url else "")
                + f"</p>")
        try:
            ok = await send_email(db, to=c.email, subject=subject, body_html=html)
            sent += 1 if ok else 0
            failed += 0 if ok else 1
        except Exception:
            failed += 1
    return {"targeted": len(people), "sent": sent, "failed": failed, "skipped_no_email": skipped}


# ── Estadísticas del programa ──────────────────────────────────────────────

async def get_program_stats(db: AsyncSession) -> dict:
    tiers = await list_tiers(db, only_active=False)
    by_tier = []
    for t in tiers:
        cnt = (await db.execute(select(func.count(Customer.id)).where(Customer.tier_id == t.id))).scalar() or 0
        by_tier.append({"tier_id": t.id, "name": t.name, "color_hex": t.color_hex, "count": int(cnt)})
    total = (await db.execute(select(func.count(Customer.id)).where(Customer.is_active.is_(True)))).scalar() or 0
    enrolled = (await db.execute(select(func.count(Customer.id)).where(Customer.loyalty_code.isnot(None)))).scalar() or 0
    opt_in = (await db.execute(select(func.count(Customer.id)).where(
        Customer.accepts_marketing.is_(True), Customer.is_active.is_(True)))).scalar() or 0
    with_bday = (await db.execute(select(func.count(Customer.id)).where(
        Customer.date_of_birth.isnot(None), Customer.is_active.is_(True)))).scalar() or 0

    # Cumpleaños próximos 30 días
    today = date.today()
    from datetime import timedelta as _td
    horizon = today + _td(days=30)
    if today.month == horizon.month:
        birthday_next_30 = (await db.execute(select(func.count(Customer.id)).where(
            Customer.date_of_birth.isnot(None),
            extract("month", Customer.date_of_birth) == today.month,
            extract("day", Customer.date_of_birth) >= today.day,
            extract("day", Customer.date_of_birth) <= horizon.day,
        ))).scalar() or 0
    else:
        this_m = (await db.execute(select(func.count(Customer.id)).where(
            Customer.date_of_birth.isnot(None),
            extract("month", Customer.date_of_birth) == today.month,
            extract("day", Customer.date_of_birth) >= today.day,
        ))).scalar() or 0
        next_m = (await db.execute(select(func.count(Customer.id)).where(
            Customer.date_of_birth.isnot(None),
            extract("month", Customer.date_of_birth) == horizon.month,
            extract("day", Customer.date_of_birth) <= horizon.day,
        ))).scalar() or 0
        birthday_next_30 = int(this_m) + int(next_m)

    return {
        "total_active_customers": int(total),
        "enrolled_in_program": int(enrolled),
        "opt_in_marketing": int(opt_in),
        "with_birthday": int(with_bday),
        "birthdays_next_30_days": int(birthday_next_30),
        "by_tier": by_tier,
    }
