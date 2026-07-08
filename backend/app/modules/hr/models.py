from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, Text, ForeignKey
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
    vacation_days = Column(Integer, nullable=False, default=0)
    vacation_used = Column(Integer, nullable=False, default=0)
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
