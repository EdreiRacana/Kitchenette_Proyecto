"""
Notas de crédito (CFDI 4.0 tipo 'E' — Egreso).

Diseño empresarial:
  - Una NC referencia SIEMPRE una Order original ya timbrada (Order.cfdi_uuid).
  - Motivos SAT según Anexo 20 CFDI 4.0:
      "01" comprobante emitido con errores con relación
      "02" comprobante emitido con errores sin relación
      "03" no se llevó a cabo la operación
      "04" operación nominativa relacionada en la factura global
  - kind: "total" (cancela todo el importe) o "parcial" (líneas específicas).
  - Estados: draft → stamped → cancelled (fluye siempre en ese orden).
  - Cada NC tiene su propio folio interno + el UUID SAT tras timbrado.
  - Se guarda el XML y PDF originales del PAC para cumplimiento fiscal
    (SAT exige conservarlos 5 años).
  - Aislamiento multi-tenant vía company_id + índice.
"""
from sqlalchemy import (
    Column, Integer, String, DateTime, ForeignKey, Float, Text, LargeBinary,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


# Vocabulario canónico (strings para portabilidad SQLite ↔ Postgres)
CREDIT_NOTE_STATUSES = ("draft", "stamped", "cancelled")
CREDIT_NOTE_KINDS = ("total", "parcial")
# Códigos SAT c_TipoRelacion — CFDI 4.0. Los 4 relevantes para NC:
CREDIT_NOTE_MOTIVOS_SAT = {
    "01": "Nota de crédito de los documentos relacionados",
    "02": "Nota de débito de los documentos relacionados",
    "03": "Devolución de mercancía sobre facturas o traslados previos",
    "04": "Sustitución de los CFDI previos",
}


class CreditNote(Base):
    """Nota de crédito CFDI 4.0. Documento fiscal negativo que ajusta o
    cancela parcialmente una venta ya facturada."""
    __tablename__ = "credit_notes"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(String, ForeignKey("company_profile.id", ondelete="CASCADE"),
                        nullable=True, index=True)

    # Referencia a la venta original (obligatorio — no hay NC "huérfana").
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True, index=True)

    # Folio interno del ERP (ej. "NC-000042"). El folio SAT vive en cfdi_uuid.
    folio = Column(String(32), nullable=False, unique=True, index=True)

    # Clasificación
    kind = Column(String(16), default="parcial", nullable=False)  # total | parcial
    motivo_sat = Column(String(4), nullable=False)                # 01 | 02 | 03 | 04
    reason = Column(Text, nullable=True)                          # texto libre del cajero

    # Money breakdown
    subtotal = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    tax_rate = Column(Float, default=16.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    total = Column(Float, default=0.0, nullable=False)
    currency = Column(String(3), default="MXN", nullable=False)

    # Estado y trazabilidad
    status = Column(String(16), default="draft", nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # CFDI 4.0 — datos fiscales del comprobante timbrado
    cfdi_uuid = Column(String(64), nullable=True, index=True)  # Folio Fiscal SAT
    cfdi_serie = Column(String(32), nullable=True)
    cfdi_folio = Column(String(32), nullable=True)
    cfdi_xml = Column(LargeBinary, nullable=True)              # XML original firmado por SAT
    cfdi_pdf = Column(LargeBinary, nullable=True)              # PDF del PAC
    cfdi_pac = Column(String(32), nullable=True)               # "sufactura" | "finkok" | …
    cfdi_selloDigital = Column(Text, nullable=True)            # sello del PAC
    cfdi_selloCFD = Column(Text, nullable=True)                # sello del emisor
    cfdi_noCertificadoSAT = Column(String(20), nullable=True)
    stamped_at = Column(DateTime(timezone=True), nullable=True)

    # Cancelación (CFDI ya timbrado que se anula ante el SAT)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_motivo = Column(String(4), nullable=True)     # 01 | 02 | 03 | 04 (c_MotivoCancelacion)
    cancellation_folio_sustituto = Column(String(64), nullable=True)
    cancellation_acuse = Column(Text, nullable=True)            # respuesta del SAT

    # Efecto físico (si es devolución de mercancía)
    restocks_inventory = Column(Integer, default=0, nullable=False)  # 0/1 boolean-ish
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=True)

    # Relaciones
    order = relationship("Order", backref="credit_notes")
    customer = relationship("Customer")
    items = relationship("CreditNoteItem", back_populates="credit_note",
                          cascade="all, delete-orphan")


class CreditNoteItem(Base):
    """Línea acreditada — corresponde 1:1 (opcional) con una OrderItem
    original para trazabilidad, o standalone si es acreditación de servicio."""
    __tablename__ = "credit_note_items"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(String, ForeignKey("company_profile.id", ondelete="CASCADE"),
                        nullable=True, index=True)
    credit_note_id = Column(Integer, ForeignKey("credit_notes.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    order_item_id = Column(Integer, ForeignKey("order_items.id"), nullable=True)
    variant_id = Column(Integer, ForeignKey("product_variants.id"), nullable=True)

    product_name = Column(String, nullable=False)
    sku = Column(String, nullable=True)
    quantity = Column(Float, default=1.0, nullable=False)
    unit_price = Column(Float, default=0.0, nullable=False)
    discount_amount = Column(Float, default=0.0, nullable=False)
    tax_rate = Column(Float, default=16.0, nullable=False)

    subtotal = Column(Float, default=0.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    total = Column(Float, default=0.0, nullable=False)

    # Clave SAT del producto/servicio (obligatorio en CFDI 4.0). Si nulo se
    # infiere en el momento del timbrado desde la config del producto.
    clave_prod_serv = Column(String(16), nullable=True)  # c_ClaveProdServ
    clave_unidad = Column(String(8), nullable=True)      # c_ClaveUnidad
    unidad = Column(String(32), nullable=True)           # "Pieza", "Kilogramo", etc.

    credit_note = relationship("CreditNote", back_populates="items")
