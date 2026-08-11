from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base


class Employee(Base):
    __tablename__ = "hr_employees"

    id = Column(Integer, primary_key=True, index=True)
    employee_number = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)
    photo = Column(Text, nullable=True)
    # Datos personales exigidos por LFT art. 25 (contrato individual de trabajo)
    nationality = Column(String, nullable=True)        # nacionalidad (ej. Mexicana)
    birth_date = Column(String, nullable=True)         # ISO date; se usa para calcular edad
    gender = Column(String, nullable=True)             # M | F | X
    marital_status = Column(String, nullable=True)     # soltero | casado | union_libre | divorciado | viudo
    address = Column(Text, nullable=True)              # domicilio del trabajador
    department = Column(String, nullable=False, index=True)
    position = Column(String, nullable=False)
    cost_center = Column(String, nullable=True)
    contract_type = Column(String, nullable=False, default="indefinido")
    status = Column(String, nullable=False, default="activo", index=True)
    hire_date = Column(String, nullable=False)  # ISO date
    contract_end = Column(String, nullable=True)
    trial_end = Column(String, nullable=True)
    curp = Column(String, nullable=False)
    rfc = Column(String, nullable=False)
    nss = Column(String, nullable=True)
    bank = Column(String, nullable=True)
    clabe = Column(String, nullable=True)
    base_salary = Column(Float, nullable=False, default=0.0)
    sbc = Column(Float, nullable=False, default=0.0)
    pay_frequency = Column(String, nullable=False, default="quincenal")
    tax_regime = Column(String, nullable=False, default="605")
    infonavit_credit = Column(String, nullable=True)
    infonavit_discount_type = Column(String, nullable=True)  # cuota_fija, porcentaje, factor_veces_salario
    infonavit_discount_value = Column(Float, nullable=True)
    fonacot_credit = Column(String, nullable=True)
    fonacot_discount_value = Column(Float, nullable=True)
    # Pensión alimenticia (LFT art. 110 fracción V — descuento por mandato judicial).
    # alimony_type: porcentaje | cuota_fija | uma_multiple
    #   porcentaje: alimony_value = % sobre percepciones netas (después de deducciones legales)
    #   cuota_fija: alimony_value = MXN por período
    #   uma_multiple: alimony_value = número de UMAs mensuales
    alimony_type = Column(String, nullable=True)
    alimony_value = Column(Float, nullable=True)
    alimony_beneficiary = Column(String, nullable=True)  # nombre del acreedor alimentario
    alimony_court_order = Column(String, nullable=True)  # expediente / juzgado
    vacation_days = Column(Integer, nullable=False, default=0)
    vacation_used = Column(Integer, nullable=False, default=0)
    # PTU (art. 127 LFT):
    # ptu_excluded: TRUE si es director, administrador o gerente general (frac. I)
    # is_confidential: aplica cap art. 127-II (salario tope = sindicalizado max × 1.20)
    ptu_excluded = Column(Boolean, default=False, nullable=False)
    is_confidential = Column(Boolean, default=False, nullable=False)
    # Ajuste anual ISR (art. 97 LISR):
    # declares_own_annual = empleado comunicó por escrito que hará su propia
    # declaración anual (art. 97-B). Si TRUE, el patrón NO realiza ajuste.
    declares_own_annual = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    attendance = relationship("Attendance", back_populates="employee", cascade="all, delete-orphan")
    payroll_details = relationship("PayrollDetail", back_populates="employee", cascade="all, delete-orphan")


class Attendance(Base):
    __tablename__ = "hr_attendance"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # ISO date
    type = Column(String, nullable=False)  # entrada, salida, retardo, falta, vacacion, incapacidad, permiso, extra
    time = Column(String, nullable=True)
    hours = Column(Float, nullable=True)  # horas extra trabajadas (solo type == "extra")
    notes = Column(Text, nullable=True)
    approved = Column(Boolean, default=False, nullable=False)
    channel = Column(String, nullable=True)  # biometric, qr, app, whatsapp, kiosk, manual
    # Subtipo (solo aplica cuando type == 'incapacidad'):
    #   enfermedad_general | maternidad | riesgo_trabajo | paternidad
    # Rige el % del salario que paga el patrón vs. lo que subsidia el IMSS:
    #   enfermedad_general: patrón descuenta días 1-3, IMSS paga 60% desde día 4
    #   maternidad:         IMSS paga 100% SBC (42+42 días pre y post parto)
    #   riesgo_trabajo:     IMSS paga 100% desde día 1
    #   paternidad:         patrón paga 100% × 5 días (art. 132-XXVII bis LFT)
    incapacity_subtype = Column(String, nullable=True)
    imss_folio = Column(String, nullable=True)  # folio del certificado IMSS
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee", back_populates="attendance")


class PayrollPeriod(Base):
    __tablename__ = "hr_payroll_periods"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    frequency = Column(String, nullable=False)  # semanal, catorcenal, quincenal, mensual
    start_date = Column(String, nullable=False)
    end_date = Column(String, nullable=False)
    payment_date = Column(String, nullable=False)
    status = Column(String, nullable=False, default="draft", index=True)  # draft, calculated, approved, dispersed
    # Tipo de nomina: regular / aguinaldo / prima_vacacional / finiquito
    kind = Column(String, nullable=False, default="regular", index=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    dispersed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    details = relationship("PayrollDetail", back_populates="period", cascade="all, delete-orphan")


class PayrollDetail(Base):
    __tablename__ = "hr_payroll_details"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(Integer, ForeignKey("hr_payroll_periods.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id"), nullable=False, index=True)
    department = Column(String, nullable=True)
    base_salary = Column(Float, nullable=False, default=0.0)
    days_worked = Column(Float, nullable=False, default=0.0)
    days_absent = Column(Float, nullable=False, default=0.0)          # faltas descontadas
    days_incapacity = Column(Float, nullable=False, default=0.0)      # incapacidad total del período
    # Percepciones
    salary_earned = Column(Float, nullable=False, default=0.0)
    overtime_double = Column(Float, nullable=False, default=0.0)
    overtime_triple = Column(Float, nullable=False, default=0.0)
    bonus = Column(Float, nullable=False, default=0.0)
    vacation_premium = Column(Float, nullable=False, default=0.0)
    food_vouchers = Column(Float, nullable=False, default=0.0)
    savings_fund = Column(Float, nullable=False, default=0.0)
    aguinaldo = Column(Float, nullable=False, default=0.0)             # solo en períodos tipo aguinaldo
    subsidy_applied = Column(Float, nullable=False, default=0.0)      # subsidio al empleo pagado
    # Deducciones
    imss_employee = Column(Float, nullable=False, default=0.0)
    isr = Column(Float, nullable=False, default=0.0)
    infonavit = Column(Float, nullable=False, default=0.0)
    fonacot = Column(Float, nullable=False, default=0.0)
    loan_deduction = Column(Float, nullable=False, default=0.0)
    alimony = Column(Float, nullable=False, default=0.0)  # pensión alimenticia retenida (LFT art. 110-V)
    # Cuota patronal (informativa, para SUA + P&L de nómina)
    imss_employer = Column(Float, nullable=False, default=0.0)
    infonavit_employer = Column(Float, nullable=False, default=0.0)   # 5% SBC amortización crédito habitación
    state_payroll_tax = Column(Float, nullable=False, default=0.0)    # ISN estatal patronal (2-4% según estado)
    # Notas del capturista (justifica bonos, préstamos, etc.)
    notes = Column(Text, nullable=True)
    # Marca si el detalle fue editado a mano después de un cálculo automático
    edited_manually = Column(Boolean, default=False, nullable=False)
    # Totales
    total_gross = Column(Float, nullable=False, default=0.0)
    total_deductions = Column(Float, nullable=False, default=0.0)
    total_net = Column(Float, nullable=False, default=0.0)
    # Dispersión
    dispersion_status = Column(String, nullable=False, default="pendiente")  # pendiente, enviado, confirmado

    period = relationship("PayrollPeriod", back_populates="details")
    employee = relationship("Employee", back_populates="payroll_details")


# ── Comunicación interna ───────────────────────────────────────────────────
# Anuncios/notificaciones que RH manda a departamentos o empleados
# específicos. Se muestran en la campana del header del destinatario y
# opcionalmente se mandan por correo (usando Resend/plataforma).
class Announcement(Base):
    __tablename__ = "hr_announcements"

    id = Column(Integer, primary_key=True, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # quién lo envió
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    priority = Column(String, nullable=False, default="info")  # info | important | urgent
    target_type = Column(String, nullable=False, default="all")  # all | department | specific
    target_department = Column(String, nullable=True)  # cuando target_type=department
    also_email = Column(Boolean, default=False, nullable=False)
    email_sent_count = Column(Integer, default=0, nullable=False)
    email_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    receipts = relationship("AnnouncementReceipt", back_populates="announcement",
                            cascade="all, delete-orphan")


class AnnouncementReceipt(Base):
    """1 fila por (anuncio × empleado destinatario). Al abrir la campana
    se marca read_at. Sirve para métricas de leído por leyente."""
    __tablename__ = "hr_announcement_receipts"

    id = Column(Integer, primary_key=True, index=True)
    announcement_id = Column(Integer, ForeignKey("hr_announcements.id", ondelete="CASCADE"),
                              nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    announcement = relationship("Announcement", back_populates="receipts")
    employee = relationship("Employee")


# ── Contratos laborales / de servicios (Fase 3) ────────────────────────────
# Genera y guarda el contrato firmable. Cada contrato apunta a UN empleado
# (contract_type distinto al Employee.contract_type porque un mismo empleado
# puede tener varios contratos históricos, ej. período de prueba → indeterminado).
class Contract(Base):
    __tablename__ = "hr_contracts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    # Tipo de contrato — determina la plantilla legal aplicada:
    #   indeterminado, determinado, prueba, capacitacion, obra, temporal,
    #   comisionista, honorarios
    contract_type = Column(String, nullable=False)
    # Cláusulas configurables
    salary_amount = Column(Float, nullable=False, default=0.0)   # sueldo/comisión pactada
    salary_frequency = Column(String, nullable=False, default="mensual")  # semanal/quincenal/mensual/por_venta
    hours_per_week = Column(Integer, nullable=True)              # jornada semanal (LFT máx 48)
    work_schedule = Column(String, nullable=True)                # ej. "L-V 9:00-18:00, S 9:00-14:00"
    workplace_address = Column(Text, nullable=True)              # domicilio del centro de trabajo
    job_functions = Column(Text, nullable=True)                  # descripción del puesto y funciones
    start_date = Column(String, nullable=False)                  # ISO YYYY-MM-DD
    end_date = Column(String, nullable=True)                     # solo determinado/temporal/prueba/capacitacion
    # Cláusulas específicas (opcionales, para casos particulares)
    commission_pct = Column(Float, nullable=True)                # % comisión sobre venta (comisionista)
    professional_service = Column(Text, nullable=True)           # descripción del servicio (honorarios)
    non_compete = Column(Boolean, default=False, nullable=False) # cláusula de no competencia
    confidentiality = Column(Boolean, default=True, nullable=False)  # confidencialidad (default sí)
    # Extras LFT art. 25 — capturables desde el wizard
    rest_days = Column(String, nullable=True)                    # ej. "Sábado y domingo"
    payment_method = Column(String, nullable=True)               # transferencia | efectivo | cheque
    payment_place = Column(Text, nullable=True)                  # domicilio o cuenta CLABE
    training_clause = Column(Text, nullable=True)                # descripción del programa de capacitación
    temporary_reason = Column(Text, nullable=True)               # justificación LFT art. 37 para determinado
    # Estado
    status = Column(String, nullable=False, default="draft")     # draft, generated, signed, terminated
    generated_at = Column(DateTime(timezone=True), nullable=True)
    signed_at = Column(DateTime(timezone=True), nullable=True)
    signed_document_url = Column(Text, nullable=True)            # URL del PDF firmado escaneado (opcional)
    terminated_at = Column(DateTime(timezone=True), nullable=True)
    termination_reason = Column(Text, nullable=True)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    employee = relationship("Employee")


class PayrollBudget(Base):
    """Presupuesto anual de nómina por empleado — 12 columnas mensuales.

    Cada fila = un empleado × un año. Los montos m1..m12 son el costo total
    proyectado por mes (sueldo bruto + prestaciones + carga patronal).
    El sistema compara contra PayrollDetail.total_gross real para variance.
    """
    __tablename__ = "hr_payroll_budgets"
    __table_args__ = (
        UniqueConstraint("employee_id", "period_year",
                         name="uq_payroll_budget_employee_year"),
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    period_year = Column(Integer, nullable=False, index=True)

    m1 = Column(Float, default=0.0, nullable=False)
    m2 = Column(Float, default=0.0, nullable=False)
    m3 = Column(Float, default=0.0, nullable=False)
    m4 = Column(Float, default=0.0, nullable=False)
    m5 = Column(Float, default=0.0, nullable=False)
    m6 = Column(Float, default=0.0, nullable=False)
    m7 = Column(Float, default=0.0, nullable=False)
    m8 = Column(Float, default=0.0, nullable=False)
    m9 = Column(Float, default=0.0, nullable=False)
    m10 = Column(Float, default=0.0, nullable=False)
    m11 = Column(Float, default=0.0, nullable=False)
    m12 = Column(Float, default=0.0, nullable=False)

    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    employee_link = relationship("Employee", foreign_keys=[employee_id])


# ── PTU (Participación de los Trabajadores en las Utilidades) ──────────────
# LFT arts. 117-131 + reforma DOF 23-abr-2021 (tope art. 127-VIII).
# Cada corrida se persiste completa con topes y exclusiones justificadas para
# tener trazabilidad legal ante inspección STPS o juicio individual.

class PTUCalculation(Base):
    """Corrida de reparto de PTU de un año.

    Un cálculo por (period_year × company). Estados:
      - draft: cálculo guardado, aún no genera nómina
      - approved: aprobado, listo para nómina/CFDI
      - paid: ya se generó PayrollPeriod y dispersó
    """
    __tablename__ = "hr_ptu_calculations"

    id = Column(Integer, primary_key=True, index=True)
    period_year = Column(Integer, nullable=False, index=True)
    utilidad_repartible = Column(Float, nullable=False)
    # Tarifa máxima del sindicalizado (tope art. 127-II para confianza).
    # NULL = no aplica (no hay sindicato o no se capturó).
    sindicato_max_daily = Column(Float, nullable=True)
    # Fecha límite legal de pago (60 días después del 31-mar = 30-mayo)
    payment_deadline = Column(String, nullable=True)  # ISO YYYY-MM-DD
    notes = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="draft", index=True)
    # Enlace opcional al período de nómina generado (tipo="ptu")
    payroll_period_id = Column(Integer, ForeignKey("hr_payroll_periods.id"), nullable=True)

    total_days = Column(Float, nullable=False, default=0.0)
    total_salary_base = Column(Float, nullable=False, default=0.0)
    total_ptu_paid = Column(Float, nullable=False, default=0.0)  # suma después de topes
    total_excluded = Column(Integer, nullable=False, default=0)

    calculated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    details = relationship("PTUDetail", back_populates="calculation",
                           cascade="all, delete-orphan")
    payroll_period = relationship("PayrollPeriod", foreign_keys=[payroll_period_id])


class PTUDetail(Base):
    """Cálculo por empleado dentro de una corrida.

    Guarda la mitad-por-días, la mitad-por-salario, y el monto final
    después del cap art. 127-VIII con justificación del cap y bandera
    de exclusión (art. 127-I / VII).
    """
    __tablename__ = "hr_ptu_details"

    id = Column(Integer, primary_key=True, index=True)
    calculation_id = Column(Integer,
                             ForeignKey("hr_ptu_calculations.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id"),
                          nullable=False, index=True)

    # Datos base
    days_worked_ptu = Column(Float, nullable=False, default=0.0)   # art. 123 LFT
    salary_earned_ptu = Column(Float, nullable=False, default=0.0)  # cap conf. art. 127-II
    salary_cap_applied = Column(Boolean, default=False, nullable=False)
    salary_cap_note = Column(Text, nullable=True)  # ej. "cap $Xdía por confianza"

    # Reparto bruto
    ptu_by_days = Column(Float, nullable=False, default=0.0)
    ptu_by_salary = Column(Float, nullable=False, default=0.0)
    ptu_gross = Column(Float, nullable=False, default=0.0)

    # Tope art. 127-VIII (mayor entre 3 meses salario o promedio 3 años)
    cap_3_months = Column(Float, nullable=True)
    cap_avg_3_years = Column(Float, nullable=True)
    cap_applied_amount = Column(Float, nullable=True)  # el mayor de los dos
    cap_reason = Column(String, nullable=True)   # "3_months" | "avg_3_years"

    ptu_final = Column(Float, nullable=False, default=0.0)  # después del cap

    # Exclusiones art. 127
    excluded = Column(Boolean, default=False, nullable=False)
    excluded_reason = Column(String, nullable=True)  # "director_gerente" | "eventual_menor_60d" | "domestico"

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    calculation = relationship("PTUCalculation", back_populates="details")
    employee = relationship("Employee")


class PTUHistoric(Base):
    """PTU pagada históricamente a un empleado — sirve de insumo para el
    promedio de los últimos 3 años del cap art. 127-VIII.

    Se llena automáticamente cuando un cálculo pasa a status='paid', pero
    también se puede capturar manualmente para años previos al sistema.
    """
    __tablename__ = "hr_ptu_historic"
    __table_args__ = (
        UniqueConstraint("employee_id", "period_year",
                         name="uq_ptu_historic_employee_year"),
    )

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    period_year = Column(Integer, nullable=False, index=True)
    amount_paid = Column(Float, nullable=False, default=0.0)
    source = Column(String, nullable=False, default="system")  # system | manual
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("Employee")


# ── Ajuste anual de ISR (LISR art. 97 y 116) ───────────────────────────────
# Cada empresa corre 1 ajuste por año. Cada empleado tiene un renglón con
# el ISR causado anual vs. el retenido durante el año → saldo a favor / a
# cargo, o marcado como excluido con la razón legal (art. 97-A / 97-B).

class AnnualISRAdjustment(Base):
    """Cabecera del ajuste anual del año."""
    __tablename__ = "hr_annual_isr_adjustments"
    __table_args__ = (
        UniqueConstraint("period_year", name="uq_annual_isr_year"),
    )

    id = Column(Integer, primary_key=True, index=True)
    period_year = Column(Integer, nullable=False, index=True)
    status = Column(String, nullable=False, default="draft")  # draft | approved | applied
    notes = Column(Text, nullable=True)

    total_employees = Column(Integer, nullable=False, default=0)
    total_excluded = Column(Integer, nullable=False, default=0)
    total_saldo_a_favor = Column(Float, nullable=False, default=0.0)
    total_saldo_a_cargo = Column(Float, nullable=False, default=0.0)

    calculated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    details = relationship("AnnualISRDetail", back_populates="adjustment",
                            cascade="all, delete-orphan")


class AnnualISRDetail(Base):
    """Ajuste anual por empleado."""
    __tablename__ = "hr_annual_isr_details"

    id = Column(Integer, primary_key=True, index=True)
    adjustment_id = Column(Integer,
                            ForeignKey("hr_annual_isr_adjustments.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("hr_employees.id"),
                          nullable=False, index=True)

    # Ingresos del año (según nóminas calculadas)
    total_ingresos = Column(Float, nullable=False, default=0.0)     # total_gross del año
    total_gravable = Column(Float, nullable=False, default=0.0)     # ingresos - exentos aprox
    total_isr_retenido = Column(Float, nullable=False, default=0.0)
    total_sae_pagado = Column(Float, nullable=False, default=0.0)
    days_worked_year = Column(Float, nullable=False, default=0.0)
    periods_count = Column(Integer, nullable=False, default=0)

    # Cálculo anual
    isr_causado_anual = Column(Float, nullable=False, default=0.0)  # tarifa anual sobre gravable
    diferencia = Column(Float, nullable=False, default=0.0)          # retenido - causado (>0 = a favor)

    # Estado
    excluded = Column(Boolean, default=False, nullable=False)
    excluded_reason = Column(String, nullable=True)
    # ingresos_excede_400k | declara_propia | alta_mid_year | baja_pre_dic

    applied_to_period_id = Column(Integer, ForeignKey("hr_payroll_periods.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    adjustment = relationship("AnnualISRAdjustment", back_populates="details")
    employee = relationship("Employee")
