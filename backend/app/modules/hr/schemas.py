from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


# ── Employee ─────────────────────────────────────────────────────────────
class EmployeeBase(BaseModel):
    name: str
    last_name: str
    email: str
    phone: Optional[str] = None
    photo: Optional[str] = None       # URL o data URI de la foto (subida a Supabase)
    # Datos personales (LFT art. 25)
    nationality: Optional[str] = None
    birth_date: Optional[str] = None       # ISO YYYY-MM-DD
    gender: Optional[str] = None           # M | F | X
    marital_status: Optional[str] = None
    address: Optional[str] = None
    department: str
    position: str
    cost_center: Optional[str] = None
    contract_type: str = "indefinido"
    status: str = "activo"
    hire_date: str
    contract_end: Optional[str] = None
    trial_end: Optional[str] = None
    curp: str
    rfc: str
    nss: Optional[str] = None
    bank: Optional[str] = None
    clabe: Optional[str] = None
    base_salary: float = 0.0
    sbc: float = 0.0
    pay_frequency: str = "quincenal"
    tax_regime: str = "605"
    infonavit_credit: Optional[str] = None
    infonavit_discount_type: Optional[str] = None
    infonavit_discount_value: Optional[float] = None
    fonacot_credit: Optional[str] = None
    fonacot_discount_value: Optional[float] = None
    alimony_type: Optional[str] = None          # porcentaje | cuota_fija | uma_multiple
    alimony_value: Optional[float] = None
    alimony_beneficiary: Optional[str] = None
    alimony_court_order: Optional[str] = None
    vacation_days: int = 0
    vacation_used: int = 0
    # PTU (LFT art. 127)
    ptu_excluded: bool = False        # frac. I / VI: director, gerente general, doméstico
    is_confidential: bool = False     # aplica cap frac. II
    is_active: bool = True


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    photo: Optional[str] = None
    nationality: Optional[str] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    address: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    cost_center: Optional[str] = None
    contract_type: Optional[str] = None
    status: Optional[str] = None
    hire_date: Optional[str] = None
    contract_end: Optional[str] = None
    trial_end: Optional[str] = None
    curp: Optional[str] = None
    rfc: Optional[str] = None
    nss: Optional[str] = None
    bank: Optional[str] = None
    clabe: Optional[str] = None
    base_salary: Optional[float] = None
    sbc: Optional[float] = None
    pay_frequency: Optional[str] = None
    tax_regime: Optional[str] = None
    infonavit_credit: Optional[str] = None
    infonavit_discount_type: Optional[str] = None
    infonavit_discount_value: Optional[float] = None
    fonacot_credit: Optional[str] = None
    fonacot_discount_value: Optional[float] = None
    alimony_type: Optional[str] = None
    alimony_value: Optional[float] = None
    alimony_beneficiary: Optional[str] = None
    alimony_court_order: Optional[str] = None
    vacation_days: Optional[int] = None
    vacation_used: Optional[int] = None
    ptu_excluded: Optional[bool] = None
    is_confidential: Optional[bool] = None
    is_active: Optional[bool] = None


class EmployeeInDB(EmployeeBase):
    id: int
    employee_number: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Attendance ───────────────────────────────────────────────────────────
class AttendanceBase(BaseModel):
    employee_id: int
    date: str
    type: str
    time: Optional[str] = None
    hours: Optional[float] = None
    notes: Optional[str] = None
    approved: bool = False
    channel: Optional[str] = None
    incapacity_subtype: Optional[str] = None    # enfermedad_general | maternidad | riesgo_trabajo | paternidad
    imss_folio: Optional[str] = None


class AttendanceCreate(AttendanceBase):
    pass


class AttendanceInDB(AttendanceBase):
    id: int
    employee_name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Payroll ──────────────────────────────────────────────────────────────
class PayrollPeriodCreate(BaseModel):
    name: str
    frequency: str
    start_date: str
    end_date: str
    payment_date: str
    kind: str = "regular"  # regular | aguinaldo | prima_vacacional | finiquito


class PayrollDetailInDB(BaseModel):
    employee_id: int
    employee_name: str
    department: Optional[str] = None
    base_salary: float
    days_worked: float
    salary_earned: float
    overtime_double: float
    overtime_triple: float
    bonus: float
    vacation_premium: float
    food_vouchers: float
    savings_fund: float
    imss_employee: float
    isr: float
    infonavit: float
    fonacot: float
    loan_deduction: float
    alimony: float = 0.0
    total_gross: float
    total_deductions: float
    total_net: float
    dispersion_status: str
    bank: Optional[str] = None
    clabe: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PayrollPeriodInDB(BaseModel):
    id: int
    name: str
    frequency: str
    start_date: str
    end_date: str
    payment_date: str
    status: str
    total_employees: int
    total_gross: float
    total_deductions: float
    total_net: float

    model_config = ConfigDict(from_attributes=True)


class PayrollPeriodDetailResponse(PayrollPeriodInDB):
    details: List[PayrollDetailInDB] = []


# ── Alerts / Dashboard ───────────────────────────────────────────────────
class AlertOut(BaseModel):
    id: str
    type: str  # danger, warning, info
    employee_id: int
    employee_name: str
    message: str
    date: str
    action: str


class PTURequest(BaseModel):
    year: int
    total_utilidad: float


class AguinaldoRequest(BaseModel):
    year: int
    payment_date: str  # ISO YYYY-MM-DD, típicamente antes del 20 de diciembre


class PayrollDetailUpdate(BaseModel):
    """Edición manual de la partida de un empleado (bonos, vales, préstamos, notas).
    Solo aplicable en períodos con status = 'calculated' (antes de aprobar)."""
    bonus: Optional[float] = None
    food_vouchers: Optional[float] = None
    savings_fund: Optional[float] = None
    loan_deduction: Optional[float] = None
    notes: Optional[str] = None


class HRDashboard(BaseModel):
    total: int
    active: int
    on_trial: int
    expiring_30: int
    total_payroll_monthly: float
    by_department: dict
    present_today: int
    absent_today: int


# ── Anuncios internos (Fase 2) ─────────────────────────────────────────────
class AnnouncementCreate(BaseModel):
    title: str
    body: str
    priority: str = "info"          # info | important | urgent
    target_type: str = "all"         # all | department | specific
    target_department: Optional[str] = None
    target_employee_ids: Optional[List[int]] = None  # solo cuando target_type=specific
    also_email: bool = False


class AnnouncementReceiptOut(BaseModel):
    employee_id: int
    employee_name: str
    read_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class AnnouncementOut(BaseModel):
    id: int
    sender_user_id: Optional[int] = None
    sender_name: Optional[str] = None
    title: str
    body: str
    priority: str
    target_type: str
    target_department: Optional[str] = None
    also_email: bool
    email_sent_count: int = 0
    email_error: Optional[str] = None
    created_at: datetime
    total_recipients: int = 0
    read_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class InboxItem(BaseModel):
    """Cada anuncio dirigido al empleado logueado, con estado read/unread."""
    id: int                           # id del receipt
    announcement_id: int
    title: str
    body: str
    priority: str
    sender_name: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime


# ── Contratos (Fase 3) ─────────────────────────────────────────────────────
class ContractCreate(BaseModel):
    employee_id: int
    contract_type: str
    salary_amount: float = 0.0
    salary_frequency: str = "mensual"
    hours_per_week: Optional[int] = None
    work_schedule: Optional[str] = None
    workplace_address: Optional[str] = None
    job_functions: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    commission_pct: Optional[float] = None
    professional_service: Optional[str] = None
    non_compete: bool = False
    confidentiality: bool = True
    # LFT art. 25 — extras capturables desde el wizard
    rest_days: Optional[str] = None            # ej. "Sábado y domingo"
    payment_method: Optional[str] = None       # transferencia | efectivo | cheque
    payment_place: Optional[str] = None
    training_clause: Optional[str] = None      # art. 132-XV
    temporary_reason: Optional[str] = None     # causa del contrato temporal (art. 37)


class ContractUpdate(BaseModel):
    contract_type: Optional[str] = None
    salary_amount: Optional[float] = None
    salary_frequency: Optional[str] = None
    hours_per_week: Optional[int] = None
    work_schedule: Optional[str] = None
    workplace_address: Optional[str] = None
    job_functions: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    commission_pct: Optional[float] = None
    professional_service: Optional[str] = None
    non_compete: Optional[bool] = None
    confidentiality: Optional[bool] = None
    rest_days: Optional[str] = None
    payment_method: Optional[str] = None
    payment_place: Optional[str] = None
    training_clause: Optional[str] = None
    temporary_reason: Optional[str] = None
    status: Optional[str] = None
    signed_document_url: Optional[str] = None
    termination_reason: Optional[str] = None


class ContractOut(BaseModel):
    id: int
    employee_id: int
    employee_name: Optional[str] = None
    contract_type: str
    salary_amount: float
    salary_frequency: str
    hours_per_week: Optional[int] = None
    work_schedule: Optional[str] = None
    workplace_address: Optional[str] = None
    job_functions: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    commission_pct: Optional[float] = None
    professional_service: Optional[str] = None
    non_compete: bool
    confidentiality: bool
    rest_days: Optional[str] = None
    payment_method: Optional[str] = None
    payment_place: Optional[str] = None
    training_clause: Optional[str] = None
    temporary_reason: Optional[str] = None
    status: str
    generated_at: Optional[datetime] = None
    signed_at: Optional[datetime] = None
    signed_document_url: Optional[str] = None
    terminated_at: Optional[datetime] = None
    termination_reason: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Liquidación / finiquito (Fase 4 preview) ───────────────────────────────
class SettlementRequest(BaseModel):
    """Cálculo de finiquito conforme LFT. `termination_type` determina si
    aplica indemnización (despido injustificado) o no (renuncia)."""
    employee_id: int
    termination_date: str                    # YYYY-MM-DD
    termination_type: str                    # renuncia | despido_justificado | despido_injustificado | mutuo_acuerdo
    include_indemnization: bool = False      # 3 meses + 20 días/año — solo si despido injustificado
    include_seniority_premium: bool = True   # prima de antigüedad art. 162 LFT (12 días/año, 15+ años)
    pending_days_worked: int = 0             # días trabajados en el mes en curso no pagados
    pending_vacation_days: Optional[int] = None    # si None, se calcula desde vacation_days - vacation_used


class SettlementItem(BaseModel):
    concept: str
    days: float = 0
    amount: float


class SettlementResponse(BaseModel):
    employee_id: int
    employee_name: str
    termination_date: str
    termination_type: str
    years_of_service: float
    daily_salary: float
    items: List[SettlementItem]
    total_perceptions: float
    total_deductions: float
    total_net: float
    legal_basis: List[str]                # cita de artículos de la LFT aplicados
