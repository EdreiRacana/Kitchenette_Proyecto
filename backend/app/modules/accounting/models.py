"""Contabilidad (partida doble) — Fase 1.

Catálogo de cuentas + pólizas (asientos) con movimientos de cargo/abono. Todo
calculado de pólizas contabilizadas (status='posted'); las canceladas se
excluyen de saldos. Sin dependencias externas.
"""
from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Boolean, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


ACCOUNT_TYPES = ("activo", "pasivo", "capital", "ingreso", "costo", "gasto", "orden")
ACCOUNT_NATURES = ("deudora", "acreedora")
ENTRY_TYPES = ("ingreso", "egreso", "diario")
ENTRY_STATUSES = ("posted", "cancelled")


class Account(Base):
    """Cuenta del catálogo. Las cuentas agrupadoras (is_postable=False) no reciben
    movimientos; solo las de detalle (is_postable=True)."""
    __tablename__ = "accounting_accounts"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True, nullable=False)        # número de cuenta (jerárquico)
    name = Column(String, nullable=False)
    account_type = Column(String, nullable=False)            # activo | pasivo | capital | ingreso | costo | gasto | orden
    nature = Column(String, default="deudora", nullable=False)  # deudora | acreedora
    level = Column(Integer, default=1, nullable=False)
    parent_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)
    sat_code = Column(String, nullable=True)                 # código agrupador SAT (Anexo 24)
    is_postable = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    parent = relationship("Account", remote_side=[id])


class JournalEntry(Base):
    """Póliza contable."""
    __tablename__ = "accounting_journal_entries"

    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String, index=True, nullable=True)        # POL-000001
    date = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    entry_type = Column(String, default="diario", nullable=False)  # ingreso | egreso | diario
    concept = Column(Text, nullable=True)
    source = Column(String, default="manual", nullable=False)      # manual | venta:12 | compra:.. | nomina:.. | pago:..
    status = Column(String, default="posted", nullable=False, index=True)  # posted | cancelled
    total_debit = Column(Float, default=0.0, nullable=False)
    total_credit = Column(Float, default=0.0, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    cancelled_at = Column(DateTime(timezone=True), nullable=True)

    lines = relationship("JournalLine", back_populates="entry", cascade="all, delete-orphan")


class AccountMap(Base):
    """Mapeo de 'rol contable' → cuenta, para generar pólizas automáticas desde
    la operación (ventas, cobros, compras, nómina…). p.ej. role='sales' → 4101."""
    __tablename__ = "accounting_account_map"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, unique=True, index=True, nullable=False)
    account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)

    account = relationship("Account")


class JournalLine(Base):
    """Movimiento (partida) de una póliza: cargo o abono a una cuenta."""
    __tablename__ = "accounting_journal_lines"

    id = Column(Integer, primary_key=True, index=True)
    entry_id = Column(Integer, ForeignKey("accounting_journal_entries.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=False, index=True)
    debit = Column(Float, default=0.0, nullable=False)
    credit = Column(Float, default=0.0, nullable=False)
    description = Column(String, nullable=True)

    entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("Account")


class AccountingPolicy(Base):
    """Políticas contables por empresa/sucursal, con versionado por fecha efectiva.
    Cuando el contador cambia una política, se crea un registro NUEVO con la nueva
    effective_from y el anterior queda como histórico. Los hooks buscan la política
    vigente al momento de la operación (no la última) — así una póliza generada en
    junio respeta la política que estaba activa en junio, no la de julio.

    Compatible con las tres principales prácticas mexicanas:
      - Régimen general PM (devengado)
      - RESICO / persona física actividad empresarial (flujo)
      - Régimen simplificado
    """
    __tablename__ = "accounting_policies"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)

    # #1 IVA acreditable (compras)
    #   pending_payment: 1106 al recibir, se pasa a 1105 al pagar (base flujo)
    #   direct_paid:     1105 directo al recibir (base devengado clásico)
    iva_acreditable_scheme = Column(String, default="pending_payment", nullable=False)

    # #2 IVA trasladado (ventas)
    #   pending_collection: 2104 al vender, se pasa a 2103 al cobrar (base flujo)
    #   direct_collected:   2103 directo al vender (base devengado clásico)
    iva_trasladado_scheme = Column(String, default="pending_collection", nullable=False)

    # #3 Costo de ventas
    #   perpetual: póliza al vender con el costo FIFO integrado (recomendado)
    #   analytic:  al cierre mensual: inv. inicial + compras − inv. final
    cogs_scheme = Column(String, default="perpetual", nullable=False)

    # #4 Reconocimiento de compra
    #   on_receive: al recibir la mercancía (recomendado, esencia sobre forma NIF A-2)
    #   on_bill:    al capturar la factura del proveedor
    #   on_pay:     al momento del pago (solo si el cliente es 100% flujo)
    purchase_recognition = Column(String, default="on_receive", nullable=False)

    # #5 Nómina
    #   itemized:      desglose completo (sueldos + patronal + provisiones + retenciones)
    #   consolidated:  todo consolidado en Sueldos
    #   admin_expense: cargado como gasto único de administración
    payroll_scheme = Column(String, default="itemized", nullable=False)

    # #6 Gastos operativos
    #   accrual: devengado (al capturar en Finanzas)
    #   cash:    flujo (al pagar)
    expense_basis = Column(String, default="accrual", nullable=False)

    # #7 Retenciones a proveedores
    withholding_enabled = Column(Boolean, default=True, nullable=False)
    # Tasas por tipo de proveedor (JSON: {"honorarios": {"isr":10,"iva":10.6667}, ...})
    # Vive en JSON para que se ajuste sin migración cuando SAT actualice tasas.
    withholding_rates = Column(JSON, nullable=True)

    # #8 Tipo de cambio
    #   transaction_date: TC del día de la operación + póliza de dif. cambiaria al pagar
    #   month_end_close:  ajuste solo al cierre mensual (menos preciso)
    fx_scheme = Column(String, default="transaction_date", nullable=False)

    # #9 Provisión de beneficios laborales (aguinaldo, prima vacacional)
    #   monthly_provision: provisión de 1/12 mensual (NIF D-3, evita salto en dic)
    #   at_payment:        registro solo al momento del pago
    labor_benefits_scheme = Column(String, default="monthly_provision", nullable=False)

    # #10 Depreciación
    #   straight_line_monthly: línea recta automática mensual (LISR art. 34)
    #   manual:                el contador la registra a mano
    depreciation_scheme = Column(String, default="straight_line_monthly", nullable=False)

    # Metadatos de versionado y auditoría
    effective_from = Column(DateTime(timezone=True), nullable=False, index=True)
    status = Column(String, default="active", nullable=False, index=True)  # active | superseded
    superseded_at = Column(DateTime(timezone=True), nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("accounting_policies.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FixedAsset(Base):
    """Activo fijo depreciable. Alimenta la depreciación automática mensual
    (línea recta) según LISR art. 34-35. La póliza se genera el último día
    del mes con: Cargo Gasto de depreciación / Abono Depreciación acumulada.

    Vida útil típica (tasa anual):
      - Equipo de cómputo: 30% → 3.33 años
      - Mobiliario y equipo oficina: 10% → 10 años
      - Equipo de transporte: 25% → 4 años
      - Maquinaria: 10% → 10 años
      - Edificios: 5% → 20 años
    """
    __tablename__ = "accounting_fixed_assets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)          # equipo_computo | mobiliario | transporte | maquinaria | edificio | otro
    acquisition_date = Column(DateTime(timezone=True), nullable=False, index=True)
    acquisition_cost = Column(Float, nullable=False)  # costo original
    salvage_value = Column(Float, default=0.0, nullable=False)  # valor residual estimado al final
    annual_rate_pct = Column(Float, nullable=False)   # tasa anual de depreciación (ej. 30 = 30%)
    useful_life_months = Column(Integer, nullable=False)  # meses de vida útil (auto-calc de annual_rate)
    # Cuentas contables donde se registran
    asset_account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)      # p.ej. 1201, 1202
    accumulated_depr_account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)  # p.ej. 1204
    expense_account_id = Column(Integer, ForeignKey("accounting_accounts.id"), nullable=True)    # p.ej. 6101
    # Estado
    is_active = Column(Boolean, default=True, nullable=False)     # false cuando se dio de baja
    disposed_at = Column(DateTime(timezone=True), nullable=True)
    accumulated_depreciation = Column(Float, default=0.0, nullable=False)  # snapshot corriente
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    asset_account = relationship("Account", foreign_keys=[asset_account_id])
    accumulated_depr_account = relationship("Account", foreign_keys=[accumulated_depr_account_id])
    expense_account = relationship("Account", foreign_keys=[expense_account_id])


class PeriodClose(Base):
    """Cierre de período contable. Cuando existe un registro con status=closed
    para (year, month), las pólizas con date en ese mes se consideran
    congeladas — no se pueden crear/editar/cancelar sin reabrir el período.

    Guarda snapshot del trial balance y de los totales del estado de resultados
    en el momento del cierre para auditoría (aunque los datos vivos cambien
    después por reaperturas)."""
    __tablename__ = "accounting_period_close"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    status = Column(String, default="closed", nullable=False)  # closed | reopened
    closed_at = Column(DateTime(timezone=True), server_default=func.now())
    reopened_at = Column(DateTime(timezone=True), nullable=True)
    closed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reopened_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Snapshot en JSON: {"trial_balance": [...], "income_statement": {...}, "totals": {...}}
    snapshot_json = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
