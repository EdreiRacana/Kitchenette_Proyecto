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
PRICE_LISTS = ("ABRIGO", "MATRIZ", "RETAIL", "RETAIL REBAJAS", "RETAIL VIP ACCESS")


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

    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    documents = relationship(
        "CustomerDocument", back_populates="customer", cascade="all, delete-orphan"
    )


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
