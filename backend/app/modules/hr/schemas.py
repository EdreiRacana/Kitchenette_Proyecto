from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


# ── Employee ─────────────────────────────────────────────────────────────
class EmployeeBase(BaseModel):
    name: str
    last_name: str
    email: str
    phone: Optional[str] = None
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
    vacation_days: int = 0
    vacation_used: int = 0
    is_active: bool = True


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
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
    vacation_days: Optional[int] = None
    vacation_used: Optional[int] = None
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


class HRDashboard(BaseModel):
    total: int
    active: int
    on_trial: int
    expiring_30: int
    total_payroll_monthly: float
    by_department: dict
    present_today: int
    absent_today: int
