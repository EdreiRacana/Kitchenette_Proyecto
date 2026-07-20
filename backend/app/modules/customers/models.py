"""
Customer / CRM domain models — professional grade.

Design notes:
  - Backward compatible: the original columns (name, email, phone, address,
    is_active) are kept, so existing rows and the Sales module keep working.
  - New columns are ADDITIVE and nullable. `Base.metadata.create_all` only
    creates *missing tables*, it does NOT alter an existing one — so on a live
    DB run the ALTER statements shipped in `scripts/customers_upgrade.sql`.
  - `client_number` is assigned from the row id after insert (race-free, no
    COUNT()+1), e.g. CLI-00042.
  - Fiscal data follows CFDI 4.0 (RFC, Régimen Fiscal, Uso CFDI, domicilio
    fiscal). Catalogs live on the frontend (catalogs.ts).
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


# ── Canonical vocab (plain strings for SQLite/Postgres friendliness) ─────────
SUCURSALES = ("CEDIS 1", "CEDIS 2", "CEDIS 3")
CLIENT_TYPES = ("Contado", "Crédito", "Mayorista", "Distribuidor", "VIP")
PRICE_LISTS = ("General", "Mayoreo", "Menudeo", "Distribuidor", "VIP")

# ── Tipos de relación comercial ──────────────────────────────────────────
# retail            = venta directa al público (mostrador)
# b2b_firm          = venta a empresa con crédito, pedido en firme
# b2b_consignment   = consignación: entregas mercancía y se paga lo vendido
# marketplace       = venta en plataforma (Liverpool, Amazon, ML) — despachas según pedido
# chain_physical    = venta a cadena con tiendas físicas (Sears, Chedraui) — con sell-through
RELATIONSHIP_TYPES = ("retail", "b2b_firm", "b2b_consignment", "marketplace", "chain_physical")

# ── Esquemas de retención fiscal México (Art. 106, 113-A LISR, 3-BIS LIVA) ─
WITHHOLDING_SCHEMES = {
    "none":              {"label": "Sin retención",              "isr_pct": 0.0,   "iva_pct": 0.0},
    "honorarios":        {"label": "Honorarios (persona física)", "isr_pct": 10.0,  "iva_pct": 10.667},
    "arrendamiento":     {"label": "Arrendamiento (PF)",          "isr_pct": 10.0,  "iva_pct": 10.667},
    "fletes":            {"label": "Fletes / autotransporte",     "isr_pct": 4.0,   "iva_pct": 4.0},
    "comisiones":        {"label": "Comisiones mercantiles (PF)", "isr_pct": 10.0,  "iva_pct": 10.667},
    "marketplace_pf_min": {"label": "Marketplace PF — bajo (0.4%)", "isr_pct": 0.4,  "iva_pct": 8.0},
    "marketplace_pf_mid": {"label": "Marketplace PF — medio (2%)",  "isr_pct": 2.0,  "iva_pct": 8.0},
    "marketplace_pf_max": {"label": "Marketplace PF — alto (5.4%)", "isr_pct": 5.4,  "iva_pct": 8.0},
    "custom":            {"label": "Personalizado",               "isr_pct": 0.0,  "iva_pct": 0.0},
}

# Tipos de cliente que operan vía plataforma con retención en la fuente.
MARKETPLACE_TYPES = ("marketplace", "chain_physical")
# Retenciones fiscales vigentes en México para plataformas digitales:
#   IVA = la mitad del 16% = 8% · ISR = 2.5% (tasa fija de plataformas).
DEFAULT_MARKETPLACE_IVA_RET = 8.0
DEFAULT_MARKETPLACE_ISR_RET = 2.5


def marketplace_retention_rates(customer) -> tuple:
    """Devuelve (iva_pct, isr_pct) como fracciones, p. ej. (0.08, 0.025).

    Las retenciones solo aplican a clientes marketplace/cadena (los que venden
    a través de una plataforma que retiene y entera los impuestos por ti).
    Para el resto de clientes regresa (0, 0). Respeta el esquema configurado
    en el cliente; si no tiene uno explícito, usa las tasas fijas vigentes
    (8% IVA + 2.5% ISR)."""
    if (getattr(customer, "relationship_type", None) or "retail") not in MARKETPLACE_TYPES:
        return 0.0, 0.0
    scheme_key = getattr(customer, "withholding_scheme", None) or "none"
    if scheme_key == "custom":
        return (getattr(customer, "withholding_iva_pct", 0.0) or 0.0) / 100.0, \
               (getattr(customer, "withholding_isr_pct", 0.0) or 0.0) / 100.0
    if scheme_key != "none":
        s = WITHHOLDING_SCHEMES.get(scheme_key, WITHHOLDING_SCHEMES["none"])
        return s["iva_pct"] / 100.0, s["isr_pct"] / 100.0
    # Marketplace/cadena sin esquema explícito → tasas fijas de plataforma.
    return DEFAULT_MARKETPLACE_IVA_RET / 100.0, DEFAULT_MARKETPLACE_ISR_RET / 100.0


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)

    # ── Identity / classification ────────────────────────────────────────
    client_number = Column(String, unique=True, index=True, nullable=True)  # CLI-00042
    client_type = Column(String, default="Contado", nullable=True, index=True)
    razon_social = Column(String, nullable=True)        # legal name
    nombre_comercial = Column(String, nullable=True)    # trade name
    name = Column(String, index=True, nullable=False)   # display (kept for compat)

    # ── Tax / CFDI 4.0 ───────────────────────────────────────────────────
    rfc = Column(String, index=True, nullable=True)
    regimen_fiscal = Column(String, nullable=True)      # SAT c_RegimenFiscal code
    uso_cfdi = Column(String, nullable=True, default="G03")
    cuenta_contable = Column(String, nullable=True, default="105-01-001")

    # ── Commercial terms ─────────────────────────────────────────────────
    sucursal = Column(String, nullable=True, index=True)        # branch
    price_list = Column(String, nullable=True)                  # lista de precios
    credit_days = Column(Integer, default=0, nullable=True)     # días de crédito
    credit_amount = Column(Float, default=0.0, nullable=True)   # monto de crédito
    discount_pact = Column(Float, default=0.0, nullable=True)   # % descuento pactado
    account_number = Column(String, nullable=True)              # No. de cuenta (banco)
    sales_agent = Column(String, nullable=True)                 # asignado a Ventas
    credit_agent = Column(String, nullable=True)                # asignado a Créditos
    how_heard = Column(String, nullable=True)                   # ¿cómo se enteró?

    # ── Contact ──────────────────────────────────────────────────────────
    email = Column(String, index=True, nullable=True)
    phone = Column(String, nullable=True)               # primary (kept for compat)
    phones = Column(Text, nullable=True)                # JSON list of extra phones

    # ── Fiscal address (domicilio fiscal) ────────────────────────────────
    pais = Column(String, nullable=True, default="México")
    estado = Column(String, nullable=True)
    municipio = Column(String, nullable=True)
    localidad = Column(String, nullable=True)
    calle = Column(String, nullable=True)
    colonia = Column(String, nullable=True)
    codigo_postal = Column(String, nullable=True)
    no_exterior = Column(String, nullable=True)
    no_interior = Column(String, nullable=True)
    codigo_colonia = Column(String, nullable=True)      # opcional (SAT)
    codigo_localidad = Column(String, nullable=True)    # opcional (SAT)
    referencia = Column(Text, nullable=True)
    address = Column(Text, nullable=True)               # free-form (kept for compat)

    # ── Perfil comercial extendido (Fase Universal ERP) ─────────────────
    # Diferencia entre: retail, B2B pedido firme, consignación,
    # marketplace y cadena con tiendas físicas. Cada tipo activa
    # comportamientos distintos en el módulo de ventas.
    relationship_type = Column(String, default="retail", nullable=True, index=True)
    # Comisiones y gastos (%)
    commission_base_pct = Column(Float, default=0.0, nullable=True)
    logistics_pct = Column(Float, default=0.0, nullable=True)
    logistics_fixed = Column(Float, default=0.0, nullable=True)
    cedis_pct = Column(Float, default=0.0, nullable=True)  # solo aplica en chain_physical
    portal_pct = Column(Float, default=0.0, nullable=True)  # cuota portal seller
    # Retenciones fiscales
    withholding_scheme = Column(String, default="none", nullable=True)  # ver WITHHOLDING_SCHEMES
    withholding_isr_pct = Column(Float, default=0.0, nullable=True)  # override si scheme=custom
    withholding_iva_pct = Column(Float, default=0.0, nullable=True)  # override si scheme=custom
    # Descuentos comerciales pactados (adicional a discount_pact que ya existía)
    commercial_discount_pct = Column(Float, default=0.0, nullable=True)
    # Configuración específica marketplace / cadena
    marketplace_platform = Column(String, nullable=True)  # "liverpool" | "amazon" | "mercadolibre" | "shopify" | ...
    seller_id_external = Column(String, nullable=True)    # ID del vendedor en la plataforma
    # Configuración específica consignación
    consignment_settlement_days = Column(Integer, default=30, nullable=True)  # frecuencia de liquidación

    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    documents = relationship(
        "CustomerDocument", back_populates="customer", cascade="all, delete-orphan"
    )
    category_commissions = relationship(
        "CustomerCategoryCommission", back_populates="customer", cascade="all, delete-orphan"
    )


class CustomerCategoryCommission(Base):
    """Cuando un cliente marketplace / cadena cobra distinto % de comisión
    por categoría de producto. Ej: Liverpool ropa 18%, electrónicos 12%.
    Si no existe fila para una categoría, aplica commission_base_pct."""
    __tablename__ = "customer_category_commissions"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    category = Column(String, nullable=False)  # nombre de la categoría (matches products.category)
    commission_pct = Column(Float, nullable=False, default=0.0)

    customer = relationship("Customer", back_populates="category_commissions")


class CustomerDocument(Base):
    __tablename__ = "customer_documents"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    document_type = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)
    status = Column(String, default="pendiente")

    verified_at = Column(DateTime(timezone=True), nullable=True)
    verified_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    upload_date = Column(DateTime(timezone=True), server_default=func.now())

    customer = relationship("Customer", back_populates="documents")


class ConsignmentStock(Base):
    """Saldo de mercancía en consignación por cliente / variante.
    Al entregar consignación: delivered += qty, on_hand += qty.
    Al reportar venta:        sold += qty, on_hand -= qty.
    Al reportar devolución:   returned += qty, on_hand -= qty (regresa a mi almacén).
    """
    __tablename__ = "consignment_stock"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False, index=True)
    delivered_qty = Column(Integer, default=0, nullable=False)
    sold_qty = Column(Integer, default=0, nullable=False)
    returned_qty = Column(Integer, default=0, nullable=False)
    on_hand_qty = Column(Integer, default=0, nullable=False)  # delivered - sold - returned
    last_movement_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ChannelInventory(Base):
    """Inventario del cliente/cadena — cuánto le vendí (sell-in) vs cuánto vendió al
    público (sell-through). Sirve para saber qué le queda en piso a la cadena y sugerir
    reposiciones o descuentos por baja rotación."""
    __tablename__ = "channel_inventory"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=False, index=True)
    sku = Column(String, nullable=True, index=True)  # SKU del cliente o del seller
    sell_in_qty = Column(Integer, default=0, nullable=False)
    sell_through_qty = Column(Integer, default=0, nullable=False)
    returned_qty = Column(Integer, default=0, nullable=False)
    on_hand_at_channel = Column(Integer, default=0, nullable=False)  # sell_in - sell_through - returned
    last_sell_through_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SalesReportImport(Base):
    """Registro de cada archivo de reporte (marketplace/cadena) importado.
    Guarda log completo para auditoría y rollback si es necesario."""
    __tablename__ = "sales_report_imports"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    platform = Column(String, nullable=True)  # "liverpool" | "amazon" | "custom"
    file_name = Column(String, nullable=True)
    rows_read = Column(Integer, default=0, nullable=False)
    orders_created = Column(Integer, default=0, nullable=False)
    orders_updated = Column(Integer, default=0, nullable=False)
    returns_created = Column(Integer, default=0, nullable=False)
    errors_count = Column(Integer, default=0, nullable=False)
    errors_detail = Column(Text, nullable=True)  # JSON con las filas problema
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
