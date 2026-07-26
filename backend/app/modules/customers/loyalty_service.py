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
    """Últimas N compras del cliente con detalle mínimo (folio, fecha, total, items)."""
    stmt = (
        select(Order).where(Order.customer_id == customer_id, Order.kind == "order")
        .order_by(Order.created_at.desc()).limit(limit)
        .options(selectinload(Order.items))
    )
    orders = (await db.execute(stmt)).scalars().all()
    out = []
    for o in orders:
        out.append({
            "id": o.id, "folio": o.folio,
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
    return out


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

    from math import cos, radians, sin
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A6
    from reportlab.lib.units import mm
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase.pdfmetrics import stringWidth

    buf = BytesIO()
    page_w, page_h = A6  # 105 x 148 mm — vertical
    c_pdf = canvas.Canvas(buf, pagesize=A6)

    # Paleta premium: navy profundo + dorado. Aunque cfg permita otros
    # colores, aquí forzamos una paleta cálida (accent dorado por default
    # si el operador no lo cambió) para asemejar la estética de tarjeta VIP.
    bg = cfg.card_bg_color or "#0B1739"
    bg_dark = "#050B21"
    text_color = cfg.card_text_color or "#FFFFFF"
    text_muted = "#B9C4D9"
    gold = (tier.color_hex if tier and tier.color_hex else (cfg.card_accent_color or "#D4AF37"))
    gold_light = "#F0D77A"

    # ── Fondo con degradado vertical simulado (bandas horizontales) ────
    # Efecto "vignette" de tarjeta metálica: más oscuro arriba y abajo.
    steps = 40
    for i in range(steps):
        t = i / (steps - 1)
        # Curva suave: max claridad al 45% de altura
        dist = abs(t - 0.45) * 2
        shade = max(0.0, min(1.0, dist))
        # Interpolar entre bg (claro) y bg_dark
        c1 = HexColor(bg)
        c2 = HexColor(bg_dark)
        r = c1.red * (1 - shade) + c2.red * shade
        g = c1.green * (1 - shade) + c2.green * shade
        b = c1.blue * (1 - shade) + c2.blue * shade
        c_pdf.setFillColorRGB(r, g, b)
        band_y = page_h * i / steps
        c_pdf.rect(0, band_y, page_w, page_h / steps + 0.5, fill=1, stroke=0)

    # ── Marco interior fino dorado (borde de tarjeta premium) ─────────
    inset = 3 * mm
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.5)
    c_pdf.rect(inset, inset, page_w - 2 * inset, page_h - 2 * inset, fill=0, stroke=1)

    # ── Cinta / bookmark esquina superior derecha con el logo ─────────
    ribbon_w = 22 * mm
    ribbon_h = 32 * mm
    rx = page_w - ribbon_w - 6 * mm
    ry_top = page_h - 4 * mm
    # Sombra sutil de la cinta
    c_pdf.setFillColorRGB(0, 0, 0, alpha=0.3)
    p = c_pdf.beginPath()
    p.moveTo(rx + 0.8 * mm, ry_top + 0.8 * mm)
    p.lineTo(rx + ribbon_w + 0.8 * mm, ry_top + 0.8 * mm)
    p.lineTo(rx + ribbon_w + 0.8 * mm, ry_top - ribbon_h + 0.8 * mm)
    p.lineTo(rx + ribbon_w / 2 + 0.8 * mm, ry_top - ribbon_h + 5 * mm)
    p.lineTo(rx + 0.8 * mm, ry_top - ribbon_h + 0.8 * mm)
    p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)
    # Cinta dorada
    c_pdf.setFillColor(HexColor(gold))
    p = c_pdf.beginPath()
    p.moveTo(rx, ry_top)
    p.lineTo(rx + ribbon_w, ry_top)
    p.lineTo(rx + ribbon_w, ry_top - ribbon_h)
    p.lineTo(rx + ribbon_w / 2, ry_top - ribbon_h + 5 * mm)
    p.lineTo(rx, ry_top - ribbon_h)
    p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)
    # Reflejo interno más claro
    c_pdf.setFillColor(HexColor(gold_light))
    c_pdf.rect(rx + 1 * mm, ry_top - 3 * mm, ribbon_w - 2 * mm, 1.2 * mm,
               fill=1, stroke=0)

    # Círculo blanco con el logo dentro de la cinta
    logo_r = 7 * mm
    logo_cx = rx + ribbon_w / 2
    logo_cy = ry_top - 11 * mm
    c_pdf.setFillColor(white)
    c_pdf.circle(logo_cx, logo_cy, logo_r, fill=1, stroke=0)
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.5)
    c_pdf.circle(logo_cx, logo_cy, logo_r, fill=0, stroke=1)
    logo_bytes = company.get("logo_bytes")
    if logo_bytes:
        try:
            side = logo_r * 1.5
            c_pdf.drawImage(
                ImageReader(BytesIO(logo_bytes)),
                logo_cx - side / 2, logo_cy - side / 2,
                width=side, height=side,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            pass
    else:
        name0 = (company.get("commercial_name") or company.get("legal_name") or "").strip()
        initials = "".join(w[0] for w in name0.split()[:2]).upper() or "*"
        c_pdf.setFillColor(HexColor(bg))
        c_pdf.setFont("Helvetica-Bold", 11)
        c_pdf.drawCentredString(logo_cx, logo_cy - 3.5, initials)

    # ── Corona dorada centrada arriba ─────────────────────────────────
    crown_cx = (page_w - ribbon_w - 6 * mm) / 2 + 4 * mm
    crown_cy = page_h - 14 * mm
    c_pdf.setFillColor(HexColor(gold))
    # Base horizontal de la corona
    c_pdf.rect(crown_cx - 7 * mm, crown_cy - 1 * mm, 14 * mm, 1.2 * mm,
               fill=1, stroke=0)
    # Tres picos triangulares
    p = c_pdf.beginPath()
    for peak_x, peak_h in [(crown_cx - 6 * mm, 3 * mm),
                             (crown_cx, 5 * mm),
                             (crown_cx + 6 * mm, 3 * mm)]:
        p.moveTo(peak_x - 1.5 * mm, crown_cy)
        p.lineTo(peak_x, crown_cy + peak_h)
        p.lineTo(peak_x + 1.5 * mm, crown_cy)
        p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)
    # Estrellas de los picos (círculos pequeños)
    for peak_x, peak_h in [(crown_cx - 6 * mm, 3 * mm),
                             (crown_cx, 5 * mm),
                             (crown_cx + 6 * mm, 3 * mm)]:
        c_pdf.circle(peak_x, crown_cy + peak_h + 0.5 * mm, 0.7 * mm,
                     fill=1, stroke=0)

    # ── Título dividido en dos líneas: "PROGRAMA DE" / "FIDELIDAD" ─
    prog_full = (cfg.program_name or "Programa de Fidelidad").strip()
    parts = prog_full.upper().rsplit(" ", 1)
    if len(parts) == 2 and len(parts[0]) >= 3 and len(parts[1]) >= 3:
        line1, line2 = parts
    else:
        line1, line2 = "", prog_full.upper()

    center_x = page_w / 2
    y_title = page_h - 26 * mm

    if line1:
        c_pdf.setFillColor(HexColor(text_color))
        c_pdf.setFont("Times-Roman", 13)
        c_pdf.drawCentredString(center_x, y_title, line1)
        y_title -= 10 * mm

    # Línea 2 gigante — el nombre real del programa
    line2_size = 26
    while stringWidth(line2, "Times-Bold", line2_size) > page_w - 12 * mm and line2_size > 14:
        line2_size -= 1
    c_pdf.setFillColor(HexColor(gold))
    c_pdf.setFont("Times-Bold", line2_size)
    c_pdf.drawCentredString(center_x, y_title, line2)
    y_title -= 6 * mm

    # Tagline con separadores decorativos
    if cfg.tagline:
        tag = cfg.tagline.upper()
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Helvetica", 8)
        tag_w = stringWidth(tag, "Helvetica", 8)
        c_pdf.drawCentredString(center_x, y_title, tag)
        # Líneas laterales con diamante centrado
        line_w = 15 * mm
        c_pdf.setStrokeColor(HexColor(gold))
        c_pdf.setLineWidth(0.4)
        c_pdf.line(center_x - tag_w / 2 - 3 * mm - line_w, y_title + 1.5,
                   center_x - tag_w / 2 - 3 * mm, y_title + 1.5)
        c_pdf.line(center_x + tag_w / 2 + 3 * mm, y_title + 1.5,
                   center_x + tag_w / 2 + 3 * mm + line_w, y_title + 1.5)

    # Diamante decorativo debajo del tagline
    y_title -= 4 * mm
    c_pdf.setFillColor(HexColor(gold))
    p = c_pdf.beginPath()
    p.moveTo(center_x, y_title + 1.2 * mm)
    p.lineTo(center_x + 1.2 * mm, y_title)
    p.lineTo(center_x, y_title - 1.2 * mm)
    p.lineTo(center_x - 1.2 * mm, y_title)
    p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)

    # ── TITULAR con líneas decorativas a los lados ─────────────────
    # Layout vertical planificado: título 0-42mm desde arriba, TITULAR
    # 45-63mm, badge 65-92mm, banner 100mm, perks 110mm, footer 118-145mm.
    y = page_h - 52 * mm
    c_pdf.setFillColor(HexColor(text_muted))
    c_pdf.setFont("Helvetica", 8)
    label = "TITULAR"
    label_w = stringWidth(label, "Helvetica", 8)
    c_pdf.drawCentredString(center_x, y, label)
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.3)
    c_pdf.line(center_x - label_w / 2 - 3 * mm - 10 * mm, y + 1.5,
               center_x - label_w / 2 - 3 * mm, y + 1.5)
    c_pdf.line(center_x + label_w / 2 + 3 * mm, y + 1.5,
               center_x + label_w / 2 + 3 * mm + 10 * mm, y + 1.5)

    # Nombre grande
    name_txt = (customer.name or "").upper()
    name_size = 15
    while stringWidth(name_txt, "Helvetica-Bold", name_size) > page_w - 16 * mm and name_size > 10:
        name_size -= 0.5
    c_pdf.setFillColor(HexColor(text_color))
    c_pdf.setFont("Helvetica-Bold", name_size)
    c_pdf.drawCentredString(center_x, y - 7 * mm, name_txt)

    # Cliente desde YEAR con líneas decorativas
    if customer.loyalty_since:
        cd = f"CLIENTE DESDE {customer.loyalty_since.year}"
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Helvetica", 7.5)
        cd_w = stringWidth(cd, "Helvetica", 7.5)
        c_pdf.drawCentredString(center_x, y - 13 * mm, cd)
        c_pdf.setStrokeColor(HexColor(gold))
        c_pdf.setLineWidth(0.3)
        c_pdf.line(center_x - cd_w / 2 - 2 * mm - 6 * mm, y - 12.5 * mm,
                   center_x - cd_w / 2 - 2 * mm, y - 12.5 * mm)
        c_pdf.line(center_x + cd_w / 2 + 2 * mm, y - 12.5 * mm,
                   center_x + cd_w / 2 + 2 * mm + 6 * mm, y - 12.5 * mm)

    # ── Badge central con rayos radiales acotados + anillo dorado ─
    badge_cy = page_h - 84 * mm
    badge_r = 13 * mm
    if tier and tier.discount_pct > 0:
        # Rayos MUY cortos (solo 4mm) — evitan cruzar por encima del banner
        # y del nombre del titular. Sirven como ornamento discreto.
        ray_inner = badge_r + 1.5 * mm
        ray_outer = badge_r + 4.5 * mm
        c_pdf.setStrokeColor(HexColor(gold))
        c_pdf.setLineWidth(0.25)
        for angle_deg in range(0, 360, 15):
            a = radians(angle_deg)
            x1 = center_x + cos(a) * ray_inner
            y1 = badge_cy + sin(a) * ray_inner
            x2 = center_x + cos(a) * ray_outer
            y2 = badge_cy + sin(a) * ray_outer
            c_pdf.line(x1, y1, x2, y2)

        # Anillo exterior dorado
        c_pdf.setFillColor(HexColor(gold))
        c_pdf.circle(center_x, badge_cy, badge_r, fill=1, stroke=0)
        c_pdf.setFillColor(HexColor(gold_light))
        c_pdf.circle(center_x, badge_cy, badge_r - 0.8 * mm, fill=1, stroke=0)
        c_pdf.setFillColor(HexColor(gold))
        c_pdf.circle(center_x, badge_cy, badge_r - 1.6 * mm, fill=1, stroke=0)
        c_pdf.setFillColor(HexColor(bg_dark))
        c_pdf.circle(center_x, badge_cy, badge_r - 3 * mm, fill=1, stroke=0)

        pct_txt = f"{int(tier.discount_pct)}%"
        c_pdf.setFillColor(HexColor(gold))
        c_pdf.setFont("Times-Bold", 20)
        c_pdf.drawCentredString(center_x, badge_cy - 1, pct_txt)
        c_pdf.setFont("Helvetica-Bold", 6.5)
        c_pdf.setFillColor(HexColor(gold_light))
        c_pdf.drawCentredString(center_x, badge_cy - 6 * mm, "DESCUENTO")

    # ── Banner ribbon con nombre del tier ─────────────────────────
    banner_y = page_h - 106 * mm
    banner_h = 8 * mm
    banner_w = 62 * mm
    bx = center_x - banner_w / 2

    # Colas triangulares laterales (más oscuras para profundidad)
    c_pdf.setFillColor(HexColor(bg_dark))
    p = c_pdf.beginPath()
    p.moveTo(bx, banner_y + banner_h / 2)
    p.lineTo(bx - 4 * mm, banner_y + banner_h / 2 - 2 * mm)
    p.lineTo(bx - 4 * mm, banner_y - banner_h / 2 - 2 * mm)
    p.lineTo(bx, banner_y - banner_h / 2)
    p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)
    p = c_pdf.beginPath()
    p.moveTo(bx + banner_w, banner_y + banner_h / 2)
    p.lineTo(bx + banner_w + 4 * mm, banner_y + banner_h / 2 - 2 * mm)
    p.lineTo(bx + banner_w + 4 * mm, banner_y - banner_h / 2 - 2 * mm)
    p.lineTo(bx + banner_w, banner_y - banner_h / 2)
    p.close()
    c_pdf.drawPath(p, fill=1, stroke=0)

    # Cinta principal con degradado sutil (dos capas)
    c_pdf.setFillColor(HexColor(gold))
    c_pdf.rect(bx, banner_y - banner_h / 2, banner_w, banner_h,
               fill=1, stroke=0)
    # Reflejo horizontal claro
    c_pdf.setFillColor(HexColor(gold_light))
    c_pdf.rect(bx, banner_y + banner_h / 2 - 1.5 * mm, banner_w, 0.8 * mm,
               fill=1, stroke=0)
    # Borde inferior más oscuro
    c_pdf.setFillColorRGB(0, 0, 0, alpha=0.15)
    c_pdf.rect(bx, banner_y - banner_h / 2, banner_w, 1.2 * mm,
               fill=1, stroke=0)

    # Texto del tier en la cinta
    tier_name = (tier.name if tier else "SIN NIVEL").upper()
    tier_size = 14
    while stringWidth(tier_name, "Times-Bold", tier_size) > banner_w - 8 * mm and tier_size > 9:
        tier_size -= 0.5
    c_pdf.setFillColor(HexColor(bg_dark))
    c_pdf.setFont("Times-Bold", tier_size)
    c_pdf.drawCentredString(center_x, banner_y - 1.5, tier_name)

    # ── Beneficios (perks) con separador — arriba del footer ─────
    perks_y = banner_y - 7 * mm
    if tier and (tier.perks or "").strip():
        perks = (tier.perks or "").strip().upper()
        if len(perks) > 50:
            perks = perks[:47] + "..."
        # Auto-fit
        p_size = 8
        while stringWidth(perks, "Helvetica", p_size) > page_w - 18 * mm and p_size > 6:
            p_size -= 0.5
        c_pdf.setFillColor(HexColor(gold_light))
        c_pdf.setFont("Helvetica-Oblique", p_size)
        c_pdf.drawCentredString(center_x, perks_y, perks)

    # ── Bloque inferior: código + vigencia (izq) | QR (der) ───────
    footer_h = 26 * mm  # altura reservada
    footer_top = 7 * mm + footer_h  # coord y del top del footer = 33mm
    left_w = 55 * mm
    c_pdf.setStrokeColor(HexColor(gold))
    c_pdf.setLineWidth(0.4)
    c_pdf.roundRect(8 * mm, 7 * mm, left_w, footer_h, 2 * mm,
                    fill=0, stroke=1)
    # Alias para no romper el resto del código que usa footer_y
    footer_y = footer_top

    c_pdf.setFillColor(HexColor(text_muted))
    c_pdf.setFont("Helvetica", 6.5)
    c_pdf.drawString(12 * mm, footer_y - 2.5 * mm, "CÓDIGO")
    c_pdf.setFillColor(HexColor(text_color))
    c_pdf.setFont("Courier-Bold", 11)
    c_pdf.drawString(12 * mm, footer_y - 7 * mm, customer.loyalty_code)

    if customer.loyalty_expires_at:
        c_pdf.setFillColor(HexColor(text_muted))
        c_pdf.setFont("Helvetica", 6.5)
        c_pdf.drawString(12 * mm, footer_y - 12 * mm, "VIGENCIA")
        c_pdf.setFillColor(HexColor(text_color))
        c_pdf.setFont("Helvetica-Bold", 10)
        c_pdf.drawString(12 * mm, footer_y - 16.5 * mm,
                         customer.loyalty_expires_at.strftime("%d / %m / %Y"))

    # QR con marco dorado redondeado
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, box_size=3, border=1)
        qr.add_data(customer.loyalty_code)
        qr.make(fit=True)
        qr_img_pil = qr.make_image(fill_color="#000000", back_color="#FFFFFF")
        img_buf = BytesIO()
        qr_img_pil.save(img_buf, format="PNG")
        img_buf.seek(0)
        qr_size = 21 * mm
        qr_x = page_w - qr_size - 8 * mm
        qr_y = 9 * mm
        # Marco dorado con relleno blanco
        c_pdf.setFillColor(HexColor(gold))
        c_pdf.roundRect(qr_x - 1.5 * mm, qr_y - 1.5 * mm,
                        qr_size + 3 * mm, qr_size + 3 * mm,
                        2 * mm, fill=1, stroke=0)
        c_pdf.setFillColor(white)
        c_pdf.roundRect(qr_x - 0.5 * mm, qr_y - 0.5 * mm,
                        qr_size + 1 * mm, qr_size + 1 * mm,
                        1.5 * mm, fill=1, stroke=0)
        c_pdf.drawImage(ImageReader(img_buf), qr_x, qr_y,
                        width=qr_size, height=qr_size, mask="auto")
    except Exception:
        c_pdf.setFillColor(HexColor(text_color))
        c_pdf.setFont("Courier-Bold", 9)
        c_pdf.drawRightString(page_w - 8 * mm, footer_y - 10 * mm, customer.loyalty_code)

    # ── Firma emocional al pie (por debajo del marco interior) ────
    c_pdf.setFillColor(HexColor(gold_light))
    c_pdf.setFont("Times-Italic", 8)
    signature = "Gracias por confiar en nosotros"
    sig_w = stringWidth(signature, "Times-Italic", 8)
    c_pdf.drawString((page_w - sig_w) / 2, 2 * mm, signature + " ♥")

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
