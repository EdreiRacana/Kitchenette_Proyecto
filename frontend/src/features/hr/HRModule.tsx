// HRModule.tsx — Módulo RH / Nómina Premium
// Arquitectura: Dashboard · Empleados · Asistencia · Checador · Nómina · Dispersión · Reportes
// Cumplimiento: LFT 2026, IMSS, ISR SAT, CFDI 4.0, Reforma 40hrs
// Contrato { t, s } igual que App.tsx

import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Users, UserPlus, Clock, Fingerprint, Receipt, Banknote, BarChart3,
  AlertTriangle, CheckCircle, XCircle, AlertCircle, Calendar, Search,
  Plus, Download, Upload, RefreshCw, Info, X, Check, ChevronRight,
  Shield, Smartphone, QrCode, CreditCard, Wifi, Camera, Edit2,
  DollarSign, TrendingUp, TrendingDown, FileText, Bell, Eye,
  Building2, Briefcase, MapPin, Phone, Mail, Hash, Star,
  ChevronDown, ChevronUp, Filter, MoreVertical, Play, Pause,
  CheckSquare, Clock3, UserCheck, UserX, Cake, Award,
} from "lucide-react";
import { hrApi, downloadBlob } from "./api";

// ── Types ──────────────────────────────────────────────────────────────────
type ContractType = "indefinido" | "prueba" | "capacitacion" | "temporal" | "eventual" | "honorarios" | "outsourcing" | "proyecto" | "partime";
type EmployeeStatus = "activo" | "baja" | "vacaciones" | "incapacidad" | "suspendido";
type PayFrequency = "semanal" | "catorcenal" | "quincenal" | "mensual";
type AttendanceType = "entrada" | "salida" | "retardo" | "falta" | "vacacion" | "incapacidad" | "permiso" | "extra";

interface Employee {
  id: number;
  employee_number: string;
  name: string;
  last_name: string;
  email: string;
  phone?: string;
  photo?: string;
  department: string;
  position: string;
  cost_center?: string;
  contract_type: ContractType;
  status: EmployeeStatus;
  hire_date: string;
  contract_end?: string;
  trial_end?: string;
  curp: string;
  rfc: string;
  nss: string;
  bank: string;
  clabe: string;
  base_salary: number;
  sbc: number; // Salario Base Cotización
  pay_frequency: PayFrequency;
  tax_regime: string;
  infonavit_credit?: string;
  infonavit_discount_type?: string;
  infonavit_discount_value?: number;
  fonacot_credit?: string;
  fonacot_discount_value?: number;
  vacation_days: number;
  vacation_used: number;
  is_active: boolean;
}

interface Attendance {
  id: number;
  employee_id: number;
  employee_name: string;
  date: string;
  type: AttendanceType;
  time?: string;
  hours?: number;
  notes?: string;
  approved: boolean;
  channel?: "biometric" | "qr" | "app" | "whatsapp" | "kiosk" | "manual";
}

interface PayrollPeriod {
  id: number;
  name: string;
  frequency: PayFrequency;
  start_date: string;
  end_date: string;
  payment_date: string;
  status: "draft" | "calculated" | "approved" | "dispersed";
  total_employees: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
}

interface PayrollDetail {
  employee_id: number;
  employee_name: string;
  department: string;
  base_salary: number;
  days_worked: number;
  // Percepciones
  salary_earned: number;
  overtime_double: number;
  overtime_triple: number;
  bonus: number;
  vacation_premium: number;
  food_vouchers: number;
  savings_fund: number;
  // Deducciones
  imss_employee: number;
  isr: number;
  infonavit: number;
  fonacot: number;
  loan_deduction: number;
  // Totales
  total_gross: number;
  total_deductions: number;
  total_net: number;
}

interface Alert {
  id: number;
  type: "danger" | "warning" | "info";
  employee_id: number;
  employee_name: string;
  message: string;
  date: string;
  action: string;
}

// ── Catalogs ──────────────────────────────────────────────────────────────
const CONTRACT_TYPES: Record<ContractType, { label: string; color: string; desc: string }> = {
  indefinido: { label: "Tiempo indeterminado", color: "#34D399", desc: "Empleado de planta fija" },
  prueba: { label: "Período de prueba", color: "#FBBF24", desc: "Máx 30 días operativo / 180 días confianza" },
  capacitacion: { label: "Capacitación inicial", color: "#FB923C", desc: "Hasta 3 meses antes de hacer fijo" },
  temporal: { label: "Tiempo determinado", color: "#60A5FA", desc: "Proyecto o temporada con fecha fin" },
  eventual: { label: "Eventual", color: "#A78BFA", desc: "Sustitución temporal o temporada" },
  honorarios: { label: "Honorarios", color: "#F472B6", desc: "Servicios profesionales independientes" },
  outsourcing: { label: "Outsourcing/REPSE", color: "#94A3B8", desc: "Personal de empresa REPSE registrada" },
  proyecto: { label: "Por proyecto", color: "#33B2F5", desc: "Contrato ligado a entregables" },
  partime: { label: "Medio tiempo", color: "#34D399", desc: "Jornada reducida proporcional" },
};

const STATUS_META: Record<EmployeeStatus, { label: string; color: string; icon: any }> = {
  activo: { label: "Activo", color: "#34D399", icon: CheckCircle },
  baja: { label: "Baja", color: "#F87171", icon: XCircle },
  vacaciones: { label: "Vacaciones", color: "#33B2F5", icon: Calendar },
  incapacidad: { label: "Incapacidad", color: "#FBBF24", icon: AlertCircle },
  suspendido: { label: "Suspendido", color: "#94A3B8", icon: Pause },
};

const ATTENDANCE_META: Record<AttendanceType, { label: string; color: string; icon: any }> = {
  entrada: { label: "Entrada", color: "#34D399", icon: CheckCircle },
  salida: { label: "Salida", color: "#33B2F5", icon: CheckSquare },
  retardo: { label: "Retardo", color: "#FBBF24", icon: Clock3 },
  falta: { label: "Falta", color: "#F87171", icon: XCircle },
  vacacion: { label: "Vacación", color: "#A78BFA", icon: Calendar },
  incapacidad: { label: "Incapacidad", color: "#FB923C", icon: AlertCircle },
  permiso: { label: "Permiso", color: "#60A5FA", icon: FileText },
  extra: { label: "Hora extra", color: "#F472B6", icon: TrendingUp },
};

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  biometric: { label: "Biométrico", icon: Fingerprint, color: "#33B2F5" },
  qr: { label: "Código QR", icon: QrCode, color: "#A78BFA" },
  app: { label: "App móvil", icon: Smartphone, color: "#34D399" },
  whatsapp: { label: "WhatsApp", icon: Phone, color: "#25D366" },
  kiosk: { label: "Kiosko", icon: Wifi, color: "#FBBF24" },
  manual: { label: "Manual", icon: Edit2, color: "#94A3B8" },
};

const PERIOD_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Borrador", color: "#94A3B8", icon: FileText },
  calculated: { label: "Calculada", color: "#FBBF24", icon: Receipt },
  approved: { label: "Aprobada", color: "#33B2F5", icon: CheckCircle },
  dispersed: { label: "Dispersada", color: "#34D399", icon: Banknote },
};

const DEPARTMENTS = ["Ventas", "Contabilidad", "Almacén", "Operaciones", "Sistemas", "Diseño", "RH", "Dirección", "Marketing", "Logística"];
const BANKS = ["BBVA", "Santander", "Banamex", "HSBC", "Banorte", "Scotiabank", "Inbursa", "Afirme"];

// ── Helpers ────────────────────────────────────────────────────────────────
const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mxnShort = (n: number) => n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n;
const fmtDate = (d: string) => d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = (date: string) => Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
const fullName = (e: Employee) => `${e.name} ${e.last_name}`;
const glass = (t: any): React.CSSProperties =>
  t?.name === "dark"
    ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
    : { background: t.panel, border: `1px solid ${t.border}` };

// ── Main Component ─────────────────────────────────────────────────────────
export default function HRModule({ t, s }: { t: any; s: any }) {
  const [tab, setTab] = useState<"dashboard" | "employees" | "attendance" | "checker" | "payroll" | "dispersion" | "reports">("dashboard");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<{ employees?: boolean; alerts?: boolean; periods?: boolean; attendance?: boolean }>({});

  // UI State
  const [employeeForm, setEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [periodDetail, setPeriodDetail] = useState<any | null>(null);
  const [attendanceForm, setAttendanceForm] = useState(false);
  const [periodForm, setPeriodForm] = useState(false);
  const [reportModal, setReportModal] = useState<null | {
    kind: "overtime" | "annual" | "ptu" | "sua" | "aguinaldo";
  }>(null);
  const [simpleReport, setSimpleReport] = useState<null | {
    kind: "headcount" | "vacations" | "infonavit";
  }>(null);
  const [detailEditor, setDetailEditor] = useState<null | { period: any; row: any }>(null);
  const [bulkUpload, setBulkUpload] = useState<null | { period: any }>(null);

  // Filters
  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [contractFilter, setContractFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [attendanceDateFilter, setAttendanceDateFilter] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    const [empR, alertR, periodR] = await Promise.allSettled([
      hrApi.employees(), hrApi.alerts(), hrApi.periods(),
    ]);
    setEmployees(empR.status === "fulfilled" ? empR.value : []);
    setAlerts(alertR.status === "fulfilled" ? alertR.value : []);
    setPeriods(periodR.status === "fulfilled" ? periodR.value : []);
    setErrors({
      employees: empR.status === "rejected",
      alerts: alertR.status === "rejected",
      periods: periodR.status === "rejected",
    });
    setLoading(false);
  }, []);

  const loadAttendance = useCallback(async (date: string) => {
    try {
      const data = await hrApi.attendance(date);
      setAttendance(data);
      setErrors(e => ({ ...e, attendance: false }));
    } catch {
      setAttendance([]);
      setErrors(e => ({ ...e, attendance: true }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAttendance(attendanceDateFilter); }, [loadAttendance, attendanceDateFilter]);

  useEffect(() => {
    if (!selectedPeriod) { setPeriodDetail(null); return; }
    hrApi.periodDetail(selectedPeriod.id).then(setPeriodDetail).catch(() => setPeriodDetail(null));
  }, [selectedPeriod]);

  // ── KPIs ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = employees.filter(e => e.status === "activo").length;
    const onTrial = employees.filter(e => e.contract_type === "prueba" || e.contract_type === "capacitacion").length;
    const expiring30 = employees.filter(e => e.contract_end && daysUntil(e.contract_end) <= 30 && daysUntil(e.contract_end) > 0).length;
    const totalPayroll = employees.filter(e => e.is_active).reduce((a, e) => a + e.base_salary, 0);
    const byDept = DEPARTMENTS.reduce((acc, d) => ({ ...acc, [d]: employees.filter(e => e.department === d && e.is_active).length }), {} as Record<string, number>);
    const todayAttendance = attendance.filter(a => a.date === new Date().toISOString().slice(0, 10));
    const presentToday = todayAttendance.filter(a => a.type === "entrada").length;
    const absentToday = todayAttendance.filter(a => a.type === "falta").length;
    return { total: employees.length, active, onTrial, expiring30, totalPayroll, byDept, presentToday, absentToday };
  }, [employees, attendance]);

  const filteredEmployees = useMemo(() => employees.filter(e => {
    const qs = q.toLowerCase();
    const matchQ = !q || fullName(e).toLowerCase().includes(qs) || e.employee_number.toLowerCase().includes(qs) || e.position.toLowerCase().includes(qs) || e.rfc.toLowerCase().includes(qs);
    const matchDept = !deptFilter || e.department === deptFilter;
    const matchContract = !contractFilter || e.contract_type === contractFilter;
    const matchStatus = !statusFilter || e.status === statusFilter;
    return matchQ && matchDept && matchContract && matchStatus;
  }), [employees, q, deptFilter, contractFilter, statusFilter]);

  const todayAttendance = useMemo(() => attendance.filter(a => a.date === attendanceDateFilter), [attendance, attendanceDateFilter]);

  // ── Styles ────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: "10px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 });

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "employees", label: "Empleados", icon: Users },
    { id: "attendance", label: "Asistencia", icon: Clock },
    { id: "checker", label: "Checador", icon: Fingerprint },
    { id: "payroll", label: "Nómina", icon: Receipt },
    { id: "dispersion", label: "Dispersión", icon: Banknote },
    { id: "reports", label: "Reportes", icon: FileText },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Error banner */}
      {(errors.employees || errors.alerts || errors.periods) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          <AlertTriangle size={16} /> No se pudo cargar información del servidor. Intenta recargar.
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>RH / Nómina</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>Control de personal, asistencia, nómina y dispersión de pagos</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <RefreshCw size={15} />
          </button>
          <button onClick={() => setEmployeeForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <UserPlus size={15} /> Nuevo empleado
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as any)} style={tabBtn(tab === id)}>
            <Icon size={14} />{label}
            {id === "dashboard" && alerts.filter(a => a.type === "danger").length > 0 && (
              <span style={{ background: t.bad, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 99, minWidth: 16, textAlign: "center" }}>
                {alerts.filter(a => a.type === "danger").length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TAB: Dashboard ── */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
            {[
              { label: "Total empleados", value: String(kpis.total), icon: Users, color: t.nova, sub: `${kpis.active} activos` },
              { label: "Costo nómina/mes", value: mxnShort(kpis.totalPayroll * 2), icon: DollarSign, color: t.good, sub: mxn(kpis.totalPayroll * 2) },
              { label: "En período prueba", value: String(kpis.onTrial), icon: Clock3, color: t.warn, sub: "requieren decisión" },
              { label: "Contratos por vencer", value: String(kpis.expiring30), icon: AlertTriangle, color: t.bad, sub: "próximos 30 días" },
              { label: "Presentes hoy", value: String(kpis.presentToday), icon: UserCheck, color: t.good, sub: `${kpis.absentToday} faltas` },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: k.color + "22", color: k.color, borderRadius: 10, padding: 10, display: "flex", flexShrink: 0 }}><k.icon size={20} /></div>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.textHi }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <Bell size={16} color={t.bad} /> Alertas de RH
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alerts.map(a => {
                  const colors = { danger: t.bad, warning: t.warn, info: t.nova };
                  const color = colors[a.type];
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: color + "10", border: `1px solid ${color}30` }}>
                      <div style={{ background: color + "22", color, borderRadius: 8, padding: 7, display: "flex", flexShrink: 0 }}>
                        {a.type === "danger" ? <XCircle size={16} /> : a.type === "warning" ? <AlertTriangle size={16} /> : <Info size={16} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{a.employee_name}</div>
                        <div style={{ fontSize: 12.5, color: t.textMid, marginTop: 2 }}>{a.message}</div>
                      </div>
                      <button style={{ fontSize: 11.5, color, background: "transparent", border: `1px solid ${color}44`, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {a.action}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Headcount by dept + Contract breakdown */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>Headcount por departamento</div>
              {Object.entries(kpis.byDept).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).map(([dept, count]) => {
                const max = Math.max(...Object.values(kpis.byDept));
                const pct = Math.round((count / max) * 100);
                return (
                  <div key={dept} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, color: t.textMid }}>{dept}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textHi }}>{count}</span>
                    </div>
                    <div style={{ height: 6, background: t.panel3, borderRadius: 99 }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${t.nova}, ${t.navy})` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>Tipos de contrato</div>
              {Object.entries(CONTRACT_TYPES).map(([key, meta]) => {
                const count = employees.filter(e => e.contract_type === key && e.is_active).length;
                if (count === 0) return null;
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: t.textMid }}>{meta.label}</span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent periods */}
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <Receipt size={16} color={t.nova} /> Períodos de nómina recientes
            </div>
            {periods.slice(0, 4).map(p => {
              const ps = PERIOD_STATUS[p.status];
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                  <div style={{ background: ps.color + "22", color: ps.color, borderRadius: 8, padding: 7, display: "flex" }}><ps.icon size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: t.textLo }}>Pago: {fmtDate(p.payment_date)} · {p.total_employees} empleados</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.good }}>{p.status === "draft" ? "—" : mxn(p.total_net)}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ps.color, background: ps.color + "18", padding: "2px 7px", borderRadius: 20 }}>{ps.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Employees ── */}
      {tab === "employees" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nombre, número, RFC, puesto…" style={{ ...inp, paddingLeft: 34, width: "100%" }} />
            </div>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Departamento</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={contractFilter} onChange={e => setContractFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Tipo contrato</option>
              {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Estado</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {(q || deptFilter || contractFilter || statusFilter) && (
              <button onClick={() => { setQ(""); setDeptFilter(""); setContractFilter(""); setStatusFilter(""); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 13 }}>
                <X size={13} /> Limpiar
              </button>
            )}
          </div>

          <div style={{ fontSize: 12.5, color: t.textLo }}>{filteredEmployees.length} empleados</div>

          {/* Table */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["No.", "Empleado", "Departamento", "Puesto", "Contrato", "Salario", "Vigencia", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 8 }).map((__, c) => <td key={c} style={{ padding: "14px 16px" }}><div style={{ height: 12, borderRadius: 6, background: t.panel3, width: c === 1 ? "70%" : "50%" }} /></td>)}<td /></tr>
                    ))
                  ) : filteredEmployees.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin empleados. Ajusta los filtros o registra uno nuevo.</td></tr>
                  ) : filteredEmployees.map((e, i) => {
                    const ct = CONTRACT_TYPES[e.contract_type];
                    const sm = STATUS_META[e.status];
                    const endDate = e.contract_end || e.trial_end;
                    const daysLeft = endDate ? daysUntil(endDate) : null;
                    const urgency = daysLeft !== null ? (daysLeft <= 7 ? t.bad : daysLeft <= 30 ? t.warn : t.textLo) : t.textLo;
                    return (
                      <tr key={e.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2, cursor: "pointer" }}
                        onMouseEnter={ev => (ev.currentTarget.style.background = t.panel3)}
                        onMouseLeave={ev => (ev.currentTarget.style.background = i % 2 === 0 ? t.panel : t.panel2)}
                        onClick={() => setSelectedEmployee(e)}>
                        <td style={{ padding: "13px 16px", fontSize: 12, color: t.nova, fontWeight: 700, fontFamily: "monospace" }}>{e.employee_number}</td>
                        <td style={{ padding: "13px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 99, background: `linear-gradient(135deg, ${t.nova}44, ${t.navy}44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: t.nova, flexShrink: 0 }}>
                              {e.name[0]}{e.last_name[0]}
                            </div>
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textHi }}>{fullName(e)}</div>
                              <div style={{ fontSize: 11.5, color: t.textLo }}>{e.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.textMid }}>{e.department}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.textMid }}>{e.position}</td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: ct.color, background: ct.color + "18", padding: "3px 8px", borderRadius: 20 }}>{ct.label}</span>
                        </td>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{mxn(e.base_salary)}</td>
                        <td style={{ padding: "13px 16px" }}>
                          {endDate ? (
                            <div>
                              <div style={{ fontSize: 12, color: urgency, fontWeight: 600 }}>{fmtDate(endDate)}</div>
                              <div style={{ fontSize: 11, color: urgency }}>{daysLeft !== null && daysLeft > 0 ? `${daysLeft} días` : daysLeft === 0 ? "HOY" : "Vencido"}</div>
                            </div>
                          ) : <span style={{ fontSize: 12, color: t.textLo }}>Indefinido</span>}
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: sm.color, background: sm.color + "18", padding: "4px 10px", borderRadius: 20 }}>
                            <sm.icon size={12} />{sm.label}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px" }}><ChevronRight size={16} color={t.textLo} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Attendance ── */}
      {tab === "attendance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {Object.entries(ATTENDANCE_META).map(([type, meta]) => {
              const count = todayAttendance.filter(a => a.type === type).length;
              return (
                <div key={type} style={{ ...glass(t), borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ background: meta.color + "22", color: meta.color, borderRadius: 8, padding: 7, display: "flex" }}><meta.icon size={14} /></div>
                  <div>
                    <div style={{ fontSize: 11, color: t.textLo }}>{meta.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: meta.color }}>{count}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input type="date" value={attendanceDateFilter} onChange={e => setAttendanceDateFilter(e.target.value)} style={inp} />
            <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar empleado…" style={{ ...inp, paddingLeft: 34, width: "100%" }} />
            </div>
            <button onClick={() => setAttendanceForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Registrar incidencia
            </button>
          </div>
          {errors.attendance && (
            <div style={{ fontSize: 12.5, color: t.bad }}>No se pudo cargar la asistencia de esta fecha.</div>
          )}

          {/* Attendance Table */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Empleado", "Tipo", "Hora", "Canal", "Notas", "Aprobado"].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {todayAttendance.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: t.textLo }}>Sin registros para esta fecha.</td></tr>
                  ) : todayAttendance.map((a, i) => {
                    const am = ATTENDANCE_META[a.type];
                    const ch = a.channel ? CHANNEL_META[a.channel] : null;
                    return (
                      <tr key={a.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{a.employee_name}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: am.color, background: am.color + "18", padding: "3px 9px", borderRadius: 20 }}>
                            <am.icon size={12} />{am.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: t.textHi, fontFamily: "monospace" }}>{a.time || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          {ch && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: ch.color, background: ch.color + "18", padding: "3px 8px", borderRadius: 6 }}>
                              <ch.icon size={11} />{ch.label}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo }}>{a.notes || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          {a.approved
                            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: t.good }}><CheckCircle size={14} /> Aprobado</span>
                            : <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: t.warn }}><AlertCircle size={14} /> Pendiente</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Checker ── */}
      {tab === "checker" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Control de jornada laboral</div>
            <div style={{ fontSize: 13, color: t.textLo, marginBottom: 20 }}>Reforma LFT 2026 — Registro electrónico obligatorio. Configura los canales de entrada/salida de tus empleados.</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {[
                { icon: Fingerprint, title: "Biométrico (huella/facial)", desc: "Conecta tu lector ZKTeco, Suprema o Hikvision vía SDK/API. Evidencia legal STPS.", color: t.nova, status: "Configurar", configured: false },
                { icon: Smartphone, title: "App móvil + GPS", desc: "Tus empleados registran entrada/salida desde su celular con geolocalización y foto.", color: t.good, status: "Activo", configured: true },
                { icon: QrCode, title: "Código QR / Barras", desc: "Genera tarjetas de empleado con QR o código de barras. Escanea con cámara web o lector USB.", color: "#A78BFA", status: "Configurar", configured: false },
                { icon: Phone, title: "WhatsApp Bot", desc: "Empleado envía mensaje al bot. GPS automático. Sin app que instalar.", color: "#25D366", status: "Configurar", configured: false },
                { icon: Wifi, title: "Kiosko web (tablet)", desc: "Instala en tablet en recepción. Funciona sin internet con sync automático.", color: t.warn, status: "Configurar", configured: false },
                { icon: Edit2, title: "Registro manual", desc: "Para correcciones autorizadas. Requiere supervisor y justificación.", color: "#94A3B8", status: "Activo", configured: true },
              ].map(card => (
                <div key={card.title} style={{ background: t.panel2, border: `1px solid ${card.configured ? card.color + "44" : t.border}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div style={{ background: card.color + "22", color: card.color, borderRadius: 10, padding: 10, display: "flex" }}><card.icon size={20} /></div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: card.configured ? t.good : t.textLo, background: (card.configured ? t.good : t.textLo) + "18", padding: "3px 8px", borderRadius: 6 }}>
                      {card.configured ? "● Activo" : "○ Inactivo"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{card.title}</div>
                  <div style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.5, marginBottom: 14 }}>{card.desc}</div>
                  <button disabled style={{ width: "100%", padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel3, color: t.textLo, cursor: "not-allowed", fontSize: 12.5, fontWeight: 600 }}>
                    No disponible — requiere integración externa
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* LFT 2026 compliance note */}
          <div style={{ background: t.nova + "10", border: `1px solid ${t.nova}33`, borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Shield size={18} color={t.nova} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Cumplimiento LFT 2026 — Reforma 40 horas</div>
                <div style={{ fontSize: 12.5, color: t.textMid, lineHeight: 1.6 }}>
                  El sistema clasifica automáticamente: <b style={{ color: t.textHi }}>horas ordinarias</b> (hasta 40/semana), <b style={{ color: t.warn }}>horas extra dobles</b> (41-49h) y <b style={{ color: t.bad }}>horas extra triples</b> (50h+). Genera evidencia digital no alterable para inspecciones STPS con trazabilidad completa. Multa máxima por incumplimiento: <b style={{ color: t.bad }}>$586,550 MXN</b>.
                </div>
              </div>
            </div>
          </div>

          {/* Live feed */}
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: t.good, animation: "pulse 2s ease infinite" }} /> Feed en tiempo real — Hoy
            </div>
            {attendance.filter(a => a.date === new Date().toISOString().slice(0, 10)).slice(0, 8).map((a, i) => {
              const am = ATTENDANCE_META[a.type];
              const ch = a.channel ? CHANNEL_META[a.channel] : null;
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 99, background: am.color + "22", color: am.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><am.icon size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{a.employee_name}</span>
                    <span style={{ fontSize: 12.5, color: t.textLo }}> — {am.label}</span>
                    {ch && <span style={{ fontSize: 11, color: ch.color, marginLeft: 8 }}>via {ch.label}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontFamily: "monospace" }}>{a.time || ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Payroll ── */}
      {tab === "payroll" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Periods */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi }}>Períodos de nómina</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => setReportModal({ kind: "aguinaldo" })}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                <DollarSign size={14} /> Nuevo aguinaldo
              </button>
              <button onClick={() => setPeriodForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Plus size={15} /> Nuevo período
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
            {periods.map(p => {
              const ps = PERIOD_STATUS[p.status];
              const freqColors: Record<string, string> = { quincenal: t.nova, semanal: t.good, catorcenal: "#A78BFA", mensual: t.warn };
              const freqColor = freqColors[p.frequency] || t.nova;
              return (
                <div key={p.id} onClick={() => setSelectedPeriod(p)} style={{ ...glass(t), border: `1px solid ${p.status === "calculated" ? t.warn + "55" : t.border}`, borderRadius: 12, padding: 20, cursor: "pointer", transition: "transform .12s, box-shadow .12s" }}
                  onMouseEnter={e => { (e.currentTarget as any).style.transform = "translateY(-2px)"; (e.currentTarget as any).style.boxShadow = `0 8px 24px rgba(0,0,0,0.15)`; }}
                  onMouseLeave={e => { (e.currentTarget as any).style.transform = ""; (e.currentTarget as any).style.boxShadow = ""; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 3 }}>Pago: {fmtDate(p.payment_date)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: freqColor, background: freqColor + "18", padding: "2px 7px", borderRadius: 6 }}>{p.frequency}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ps.color, background: ps.color + "18", padding: "2px 7px", borderRadius: 6 }}>{ps.label}</span>
                    </div>
                  </div>
                  {p.status !== "draft" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10.5, color: t.textLo }}>Bruto</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{mxn(p.total_gross)}</div>
                      </div>
                      <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10.5, color: t.textLo }}>Deducciones</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.bad }}>{mxn(p.total_deductions)}</div>
                      </div>
                      <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10.5, color: t.textLo }}>Neto</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.good }}>{mxn(p.total_net)}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: t.panel2, borderRadius: 8, padding: 12, textAlign: "center", color: t.textLo, fontSize: 13 }}>
                      Pendiente de calcular
                    </div>
                  )}
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    {p.status === "draft" && (
                      <button onClick={async e => { e.stopPropagation(); try { await hrApi.calculatePeriod(p.id); await load(); } catch (err: any) { alert(err?.response?.data?.detail || "Error al calcular la nómina"); } }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        Calcular nómina
                      </button>
                    )}
                    {p.status === "calculated" && (
                      <>
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            if (!window.confirm(
                              "Recalcular reprocesa asistencia, incluye empleados nuevos y actualiza los importes.\n\n"
                              + "Las ediciones manuales (bonos, vales, ahorro, préstamos, notas) SÍ se preservan.\n\n"
                              + "¿Continuar?"
                            )) return;
                            try {
                              await hrApi.calculatePeriod(p.id);
                              await load();
                              if (selectedPeriod?.id === p.id) {
                                const d = await hrApi.periodDetail(p.id);
                                setPeriodDetail(d);
                              }
                            } catch (err: any) {
                              alert(err?.response?.data?.detail || "Error al recalcular");
                            }
                          }}
                          title="Recalcular incluyendo empleados y asistencia nueva"
                          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                        >
                          <RefreshCw size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Recalcular
                        </button>
                        <button onClick={async e => { e.stopPropagation(); try { await hrApi.approvePeriod(p.id); await load(); } catch (err: any) { alert(err?.response?.data?.detail || "Error al aprobar"); } }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Aprobar
                        </button>
                        <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12 }}>
                          <Eye size={14} />
                        </button>
                      </>
                    )}
                    {p.status === "approved" && (
                      <>
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            if (!confirm(
                              "¿Reabrir esta nómina aprobada?\n\n"
                              + "La regresará a estado 'Calculada' para que puedas recalcularla "
                              + "con los datos corregidos (por ejemplo si actualizaste créditos "
                              + "INFONAVIT / FONACOT o salarios de empleados).\n\n"
                              + "Las ediciones manuales previas se conservan al recalcular.\n\n"
                              + "¿Continuar?"
                            )) return;
                            try {
                              await hrApi.reopenPeriod(p.id);
                              await load();
                              if (selectedPeriod?.id === p.id) {
                                const d = await hrApi.periodDetail(p.id);
                                setPeriodDetail(d);
                              }
                            } catch (err: any) {
                              alert(err?.response?.data?.detail || "Error al reabrir");
                            }
                          }}
                          title="Regresar a 'Calculada' para poder recalcular con datos corregidos"
                          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                        >
                          <RefreshCw size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> Reabrir
                        </button>
                        <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Ir a dispersión →
                        </button>
                      </>
                    )}
                    {p.status === "dispersed" && (
                      <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12 }}>
                        Ver detalle
                      </button>
                    )}
                    {(p.status === "calculated" || p.status === "approved" || p.status === "dispersed") && (
                      <button
                        onClick={async e => {
                          e.stopPropagation();
                          try {
                            const res = await hrApi.downloadReceiptsZip(p.id);
                            downloadBlob(res.data, `recibos_${p.name.replace(/\s+/g, "_")}.zip`);
                          } catch { alert("Error al generar los recibos PDF"); }
                        }}
                        title="Descargar recibos PDF (ZIP)"
                        style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11 }}
                      >
                        <FileText size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detalle del período seleccionado */}
          {selectedPeriod && periodDetail && Array.isArray(periodDetail.excluded_active_employees) && periodDetail.excluded_active_employees.length > 0 && (
            <div style={{ background: t.warn + "16", border: `1px solid ${t.warn}55`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <AlertTriangle size={16} color={t.warn} />
                <span style={{ fontSize: 13, color: t.textHi, fontWeight: 700 }}>
                  {periodDetail.excluded_active_employees.length} empleado{periodDetail.excluded_active_employees.length !== 1 ? "s" : ""} activo{periodDetail.excluded_active_employees.length !== 1 ? "s" : ""} quedó fuera de este período
                </span>
              </div>
              <div style={{ paddingLeft: 24 }}>
                {periodDetail.excluded_active_employees.map((e: any, i: number) => (
                  <div key={i} style={{ fontSize: 12.5, color: t.textMid, padding: "3px 0" }}>
                    · <b style={{ color: t.textHi }}>{e.employee_name}</b>: {e.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alertas de integridad de datos (SBC mal capturado, sin banco, etc.) */}
          {selectedPeriod && periodDetail && Array.isArray(periodDetail.data_integrity_warnings) && periodDetail.data_integrity_warnings.length > 0 && (() => {
            const errs = periodDetail.data_integrity_warnings.filter((w: any) => w.severity === "error");
            const warns = periodDetail.data_integrity_warnings.filter((w: any) => w.severity !== "error");
            const showList = [...errs, ...warns];
            const color = errs.length > 0 ? t.bad : t.warn;
            return (
              <div style={{ background: color + "14", border: `1px solid ${color}55`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <AlertTriangle size={16} color={color} />
                  <span style={{ fontSize: 13, color: t.textHi, fontWeight: 700 }}>
                    {errs.length > 0
                      ? `${errs.length} error${errs.length !== 1 ? "es" : ""} de datos que afectan el cálculo`
                      : `${warns.length} advertencia${warns.length !== 1 ? "s" : ""} de datos`}
                  </span>
                </div>
                <div style={{ paddingLeft: 24 }}>
                  {showList.map((w: any, i: number) => (
                    <div key={i} style={{ fontSize: 12.5, color: t.textMid, padding: "3px 0" }}>
                      · <b style={{ color: w.severity === "error" ? t.bad : t.textHi }}>{w.employee_name}</b>: {w.message}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {selectedPeriod && periodDetail && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>
                    Detalle · {selectedPeriod.name}
                    {(() => {
                      // periodDetail.status es la fuente de verdad tras reopen/recalcular
                      const st = (periodDetail?.status || selectedPeriod.status) as keyof typeof PERIOD_STATUS;
                      const meta = PERIOD_STATUS[st];
                      if (!meta) return null;
                      return (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: meta.color, background: meta.color + "18", padding: "2px 8px", borderRadius: 20 }}>
                          {meta.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ fontSize: 12, color: t.textLo, marginTop: 3 }}>
                    Bruto {mxn(periodDetail.total_gross)} · Deducciones {mxn(periodDetail.total_deductions)} · Neto {mxn(periodDetail.total_net)}
                    {typeof periodDetail.total_state_payroll_tax === "number" && periodDetail.total_state_payroll_tax > 0 && (
                      <span> · ISN patronal {mxn(periodDetail.total_state_payroll_tax)}</span>
                    )}
                  </div>
                </div>
                {selectedPeriod.status === "calculated" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      onClick={async () => {
                        try {
                          const res = await hrApi.downloadBulkTemplate(selectedPeriod.id, "xlsx");
                          downloadBlob(res.data, `detalle_${selectedPeriod.name.replace(/\s+/g, "_")}.xlsx`);
                        } catch { alert("Error al descargar la plantilla"); }
                      }}
                      title="Descarga XLSX pre-llenado con los empleados del período"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                    >
                      <Download size={12} /> Plantilla
                    </button>
                    <button
                      onClick={() => setBulkUpload({ period: selectedPeriod })}
                      title="Sube el XLSX/CSV con bonos, vales, ahorro, préstamos y notas"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.nova}66`, background: t.nova + "18", color: t.nova, cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                    >
                      <Upload size={12} /> Cargar bonos/vales
                    </button>
                  </div>
                )}
              </div>
              <div style={{ overflowX: "auto", maxWidth: "100%", borderRadius: 8, border: `1px solid ${t.borderSoft || t.border}` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1350, fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: t.panel2 }}>
                      {[
                        { label: "Empleado", align: "left", sticky: true },
                        { label: "Días", align: "right" },
                        { label: "Faltas", align: "right" },
                        { label: "Incap.", align: "right" },
                        { label: "Salario", align: "right" },
                        { label: "H.Extra", align: "right" },
                        { label: "Prima vac.", align: "right" },
                        { label: "Bono", align: "right" },
                        { label: "Vales", align: "right" },
                        { label: "Ahorro", align: "right" },
                        { label: "Préstamo", align: "right" },
                        { label: "IMSS", align: "right" },
                        { label: "INFONAVIT", align: "right" },
                        { label: "FONACOT", align: "right" },
                        { label: "ISR", align: "right" },
                        { label: "Neto", align: "right", strong: true },
                        { label: "", align: "center" },
                      ].map((h, i) => (
                        <th key={i} style={{
                          padding: "10px 10px",
                          textAlign: h.align as any,
                          fontSize: 10.5, fontWeight: 700, color: t.textLo,
                          borderBottom: `1px solid ${t.border}`,
                          textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap",
                          position: h.sticky ? "sticky" : undefined,
                          left: h.sticky ? 0 : undefined,
                          background: h.sticky ? t.panel2 : undefined,
                          zIndex: h.sticky ? 2 : undefined,
                        }}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(periodDetail.details || []).map((row: any, i: number) => {
                      const hExtraTotal = (row.overtime_double || 0) + (row.overtime_triple || 0);
                      const bg = i % 2 === 0 ? t.panel : t.panel2;
                      return (
                        <tr key={row.employee_id} style={{ background: bg }}>
                          <td style={{ padding: "11px 12px", fontSize: 13, color: t.textHi, fontWeight: 600, position: "sticky", left: 0, background: bg, zIndex: 1, borderRight: `1px solid ${t.borderSoft || t.border}`, minWidth: 200 }}>
                            {row.employee_name}
                            {row.edited_manually && (
                              <span title={row.notes || "Editado manualmente"}
                                    style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: t.warn, background: t.warn + "18", padding: "1px 6px", borderRadius: 10 }}>
                                EDITADO
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.days_worked ?? 0}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.days_absent || 0) > 0 ? t.warn : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: (row.days_absent || 0) > 0 ? 700 : 400 }}>{(row.days_absent || 0) > 0 ? row.days_absent : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.days_incapacity || 0) > 0 ? t.nova : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: (row.days_incapacity || 0) > 0 ? 700 : 400 }}>{(row.days_incapacity || 0) > 0 ? row.days_incapacity : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(row.salary_earned)}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: hExtraTotal > 0 ? t.good : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: hExtraTotal > 0 ? 600 : 400 }}>{hExtraTotal > 0 ? mxn(hExtraTotal) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.vacation_premium || 0) > 0 ? t.good : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(row.vacation_premium || 0) > 0 ? mxn(row.vacation_premium) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: row.bonus > 0 ? t.good : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.bonus > 0 ? mxn(row.bonus) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: row.food_vouchers > 0 ? t.good : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.food_vouchers > 0 ? mxn(row.food_vouchers) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: row.savings_fund > 0 ? t.good : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.savings_fund > 0 ? mxn(row.savings_fund) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: row.loan_deduction > 0 ? t.bad : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.loan_deduction > 0 ? mxn(row.loan_deduction) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.imss_employee || 0) > 0 ? t.bad : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(row.imss_employee || 0) > 0 ? mxn(row.imss_employee) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.infonavit || 0) > 0 ? t.bad : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(row.infonavit || 0) > 0 ? mxn(row.infonavit) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.fonacot || 0) > 0 ? t.bad : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(row.fonacot || 0) > 0 ? mxn(row.fonacot) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 12.5, color: (row.isr || 0) > 0 ? t.bad : t.textLo, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(row.isr || 0) > 0 ? mxn(row.isr) : "—"}</td>
                          <td style={{ padding: "11px 12px", fontSize: 13.5, fontWeight: 800, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(row.total_net)}</td>
                          <td style={{ padding: "8px 12px", textAlign: "center" }}>
                            {selectedPeriod.status === "calculated" && (
                              <button
                                onClick={() => setDetailEditor({ period: selectedPeriod, row })}
                                title="Editar bonos, vales, ahorro, préstamo"
                                style={{ background: t.panel3, border: `1px solid ${t.border}`, color: t.nova, padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}
                              >
                                <Edit2 size={12} style={{ verticalAlign: -1, marginRight: 4 }} /> Editar
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── TAB: Dispersion ── */}
      {tab === "dispersion" && (
        <DispersionTab
          t={t}
          periods={periods}
          selectedPeriod={selectedPeriod}
          setSelectedPeriod={setSelectedPeriod}
          onDispersed={async () => { await load(); if (selectedPeriod) { const d = await hrApi.periodDetail(selectedPeriod.id); setPeriodDetail(d); } }}
        />
      )}

      {/* ── TAB: Reports ── */}
      {tab === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {[
              { icon: Users, title: "Plantilla STPS", desc: "Reporte de personal activo para registro STPS. Incluye tipos de contrato y jornada.", color: t.bad, tag: "STPS", action: async () => setSimpleReport({ kind: "headcount" }) },
              { icon: Calendar, title: "Control de vacaciones", desc: "Días generados, tomados y pendientes por empleado y período.", color: t.nova, tag: "RH", action: async () => setSimpleReport({ kind: "vacations" }) },
              { icon: Clock, title: "Horas extra LFT 2026", desc: "Clasifica horas extra dobles (hasta 9/semana) y triples (excedente) por empleado, en un rango de fechas.", color: t.warn, tag: "LFT", action: async () => setReportModal({ kind: "overtime" }) },
              { icon: BarChart3, title: "Acumulado anual", desc: "Suma de percepciones y deducciones por empleado a lo largo del año, de períodos ya calculados.", color: t.good, tag: "ISR", action: async () => setReportModal({ kind: "annual" }) },
              { icon: DollarSign, title: "PTU — Participación de utilidades", desc: "Reparte la utilidad declarada 50% por días trabajados y 50% por salario percibido en el año.", color: t.nova, tag: "LFT", action: async () => setReportModal({ kind: "ptu" }) },
              { icon: TrendingDown, title: "Reporte INFONAVIT / FONACOT", desc: "Créditos vigentes, tipo de descuento configurado y monto estimado por período de cada empleado.", color: t.bad, tag: "INFONAVIT", action: async () => setSimpleReport({ kind: "infonavit" }) },
              { icon: FileText, title: "SUA — IMSS (apoyo)", desc: "Cuotas obrero-patronales por empleado de un período calculado, como apoyo para captura/validación en el programa oficial del IMSS.", color: t.textMid, tag: "IMSS", action: async () => setReportModal({ kind: "sua" }) },
            ].map(r => (
              <button key={r.title} style={{ ...glass(t), borderRadius: 12, padding: 20, textAlign: "left", cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as any).style.transform = "translateY(-2px)"; (e.currentTarget as any).style.boxShadow = `0 8px 20px rgba(0,0,0,0.15)`; }}
                onMouseLeave={e => { (e.currentTarget as any).style.transform = ""; (e.currentTarget as any).style.boxShadow = ""; }}
                onClick={async () => { try { await r.action(); } catch { alert(`Error al generar: ${r.title}`); } }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ background: r.color + "22", color: r.color, borderRadius: 10, padding: 10, display: "flex" }}><r.icon size={20} /></div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: r.color, background: r.color + "18", padding: "2px 7px", borderRadius: 6 }}>{r.tag}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.5, marginBottom: 14 }}>{r.desc}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 12, color: r.color, display: "flex", alignItems: "center", gap: 4 }}><Download size={12} /> CSV</span>
                </div>
              </button>
            ))}
            {[
              { icon: Receipt, title: "Confronta SAT", tag: "SAT", reason: "Requiere integración con un Proveedor Autorizado de Certificación (PAC) para timbrar y consultar CFDI 4.0 de nómina — no implementada en este sistema." },
            ].map(r => (
              <div key={r.title} style={{ ...glass(t), borderRadius: 12, padding: 20, opacity: 0.55 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ background: t.textLo + "22", color: t.textLo, borderRadius: 10, padding: 10, display: "flex" }}><r.icon size={20} /></div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: t.textLo, background: t.textLo + "18", padding: "2px 7px", borderRadius: 6 }}>{r.tag}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>No disponible. {r.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DRAWER: Employee Detail ── */}
      {reportModal && (
        <ReportRunnerModal
          t={t} kind={reportModal.kind} periods={periods}
          onClose={() => setReportModal(null)}
          onDone={async () => { setReportModal(null); await load(); }}
        />
      )}

      {simpleReport && (
        <SimpleReportModal
          t={t} kind={simpleReport.kind}
          onClose={() => setSimpleReport(null)}
        />
      )}

      {detailEditor && (
        <PayrollDetailEditor
          t={t}
          period={detailEditor.period}
          row={detailEditor.row}
          onClose={() => setDetailEditor(null)}
          onSaved={async (fresh) => {
            setPeriodDetail(fresh);
            setDetailEditor(null);
          }}
        />
      )}

      {bulkUpload && (
        <BulkDetailUploadModal
          t={t}
          period={bulkUpload.period}
          onClose={() => setBulkUpload(null)}
          onDone={async () => {
            const fresh = await hrApi.periodDetail(bulkUpload.period.id);
            setPeriodDetail(fresh);
          }}
        />
      )}

      {selectedEmployee && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setSelectedEmployee(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 480, height: "100vh", background: t.panel, borderLeft: `1px solid ${t.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ padding: 24, borderBottom: `1px solid ${t.border}`, display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 56, height: 56, borderRadius: 99, background: `linear-gradient(135deg, ${t.nova}44, ${t.navy}44)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: t.nova, flexShrink: 0 }}>
                {selectedEmployee.name[0]}{selectedEmployee.last_name[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.textHi }}>{fullName(selectedEmployee)}</div>
                <div style={{ fontSize: 13, color: t.textLo, marginTop: 2 }}>{selectedEmployee.position} · {selectedEmployee.department}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: CONTRACT_TYPES[selectedEmployee.contract_type].color, background: CONTRACT_TYPES[selectedEmployee.contract_type].color + "18", padding: "3px 8px", borderRadius: 20 }}>{CONTRACT_TYPES[selectedEmployee.contract_type].label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_META[selectedEmployee.status].color, background: STATUS_META[selectedEmployee.status].color + "18", padding: "3px 8px", borderRadius: 20 }}>{STATUS_META[selectedEmployee.status].label}</span>
                </div>
              </div>
              <button onClick={() => setSelectedEmployee(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
            </div>

            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Contract alert */}
              {(selectedEmployee.contract_end || selectedEmployee.trial_end) && (() => {
                const endDate = selectedEmployee.contract_end || selectedEmployee.trial_end!;
                const days = daysUntil(endDate);
                const color = days <= 7 ? t.bad : days <= 30 ? t.warn : t.nova;
                return (
                  <div style={{ background: color + "14", border: `1px solid ${color}44`, borderRadius: 10, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
                    <AlertTriangle size={16} color={color} />
                    <div style={{ fontSize: 13, color }}>
                      <b>{selectedEmployee.trial_end ? "Período de prueba" : "Contrato"}</b> vence el {fmtDate(endDate)} ({days > 0 ? `en ${days} días` : "VENCIDO"})
                    </div>
                  </div>
                );
              })()}

              {/* Asistencia reciente (últimos 30 días) */}
              <EmployeeAttendancePanel t={t} employee={selectedEmployee} />

              {/* Personal info */}
              {[
                { section: "Datos personales", items: [
                  { icon: Hash, label: "No. empleado", value: selectedEmployee.employee_number },
                  { icon: Mail, label: "Email", value: selectedEmployee.email },
                  { icon: Phone, label: "Teléfono", value: selectedEmployee.phone || "—" },
                  { icon: FileText, label: "CURP", value: selectedEmployee.curp },
                  { icon: FileText, label: "RFC", value: selectedEmployee.rfc },
                  { icon: Shield, label: "NSS (IMSS)", value: selectedEmployee.nss || "N/A" },
                ]},
                { section: "Datos laborales", items: [
                  { icon: Building2, label: "Departamento", value: selectedEmployee.department },
                  { icon: Briefcase, label: "Puesto", value: selectedEmployee.position },
                  { icon: Calendar, label: "Fecha ingreso", value: fmtDate(selectedEmployee.hire_date) },
                  { icon: Receipt, label: "Frecuencia pago", value: selectedEmployee.pay_frequency },
                  { icon: Calendar, label: "Vacaciones disp.", value: `${selectedEmployee.vacation_days - selectedEmployee.vacation_used} de ${selectedEmployee.vacation_days} días` },
                ]},
                { section: "Datos bancarios y fiscales", items: [
                  { icon: Building2, label: "Banco", value: selectedEmployee.bank },
                  { icon: CreditCard, label: "CLABE", value: selectedEmployee.clabe },
                  { icon: DollarSign, label: "Salario base", value: mxn(selectedEmployee.base_salary) },
                  { icon: DollarSign, label: "SBC", value: mxn(selectedEmployee.sbc) },
                  { icon: FileText, label: "Régimen fiscal", value: selectedEmployee.tax_regime },
                ]},
              ].map(sec => (
                <div key={sec.section}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" }}>{sec.section}</div>
                  <div style={{ background: t.panel2, borderRadius: 10, overflow: "hidden" }}>
                    {sec.items.map((item, i) => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: i < sec.items.length - 1 ? `1px solid ${t.borderSoft}` : "none" }}>
                        <item.icon size={14} color={t.textLo} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, color: t.textLo, minWidth: 120 }}>{item.label}</span>
                        <span style={{ fontSize: 13, color: t.textHi, fontWeight: 500, flex: 1, textAlign: "right", fontFamily: item.label === "CURP" || item.label === "RFC" || item.label === "CLABE" || item.label === "NSS (IMSS)" ? "monospace" : "inherit" }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: 20, borderTop: `1px solid ${t.border}`, display: "flex", gap: 8, marginTop: "auto" }}>
              <button onClick={() => { setEditingEmployee(selectedEmployee); setSelectedEmployee(null); setEmployeeForm(true); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Edit2 size={14} /> Editar
              </button>
              <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Receipt size={14} /> Ver nómina
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── MODAL: Employee Form ── */}
      {employeeForm && <EmployeeFormModal t={t} editing={editingEmployee} onClose={() => { setEmployeeForm(false); setEditingEmployee(null); }} onSave={async (form: any) => {
        const payload = {
          ...form, base_salary: Number(form.base_salary) || 0, sbc: Number(form.sbc) || 0,
          infonavit_discount_type: form.infonavit_credit ? (form.infonavit_discount_type || null) : null,
          infonavit_discount_value: form.infonavit_discount_value !== "" ? Number(form.infonavit_discount_value) : null,
          fonacot_discount_value: form.fonacot_discount_value !== "" ? Number(form.fonacot_discount_value) : null,
        };
        if (editingEmployee) await hrApi.updateEmployee(editingEmployee.id, payload);
        else await hrApi.createEmployee(payload);
        setEmployeeForm(false); setEditingEmployee(null); await load();
      }} />}

      {/* ── MODAL: Attendance Form ── */}
      {attendanceForm && <AttendanceFormModal t={t} employees={employees} onClose={() => setAttendanceForm(false)} onSave={async (form: any) => {
        await hrApi.createAttendance(form);
        setAttendanceForm(false); await loadAttendance(attendanceDateFilter);
      }} />}

      {/* ── MODAL: Period Form ── */}
      {periodForm && <PeriodFormModal t={t} onClose={() => setPeriodForm(false)} onSave={async (form: any) => {
        await hrApi.createPeriod(form);
        setPeriodForm(false); await load();
      }} />}

      <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
    </div>
  );
}

// ── Employee Form Modal ────────────────────────────────────────────────────
function EmployeeFormModal({ t, editing, onClose, onSave }: any) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: editing?.name || "", last_name: editing?.last_name || "",
    email: editing?.email || "", phone: editing?.phone || "",
    department: editing?.department || "", position: editing?.position || "",
    cost_center: editing?.cost_center || "",
    contract_type: editing?.contract_type || "indefinido",
    hire_date: editing?.hire_date || new Date().toISOString().slice(0, 10),
    contract_end: editing?.contract_end || "", trial_end: editing?.trial_end || "",
    curp: editing?.curp || "", rfc: editing?.rfc || "", nss: editing?.nss || "",
    bank: editing?.bank || "", clabe: editing?.clabe || "",
    base_salary: editing?.base_salary || "", sbc: editing?.sbc || "",
    pay_frequency: editing?.pay_frequency || "quincenal",
    tax_regime: editing?.tax_regime || "605",
    infonavit_credit: editing?.infonavit_credit || "",
    infonavit_discount_type: editing?.infonavit_discount_type || "",
    infonavit_discount_value: editing?.infonavit_discount_value ?? "",
    fonacot_credit: editing?.fonacot_credit || "",
    fonacot_discount_value: editing?.fonacot_discount_value ?? "",
  });

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const g2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

  const STEPS = ["Datos personales", "Datos laborales", "Contrato", "Fiscal y pago"];
  const ct = CONTRACT_TYPES[form.contract_type as ContractType];
  const needsEndDate = ["temporal", "eventual", "proyecto", "capacitacion"].includes(form.contract_type);
  const needsTrialDate = form.contract_type === "prueba";

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 620, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.textHi }}>{editing ? "Editar empleado" : "Nuevo empleado"}</h2>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {STEPS.map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 99, background: step > i + 1 ? t.good : step === i + 1 ? t.nova : t.panel3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: step >= i + 1 ? "#fff" : t.textLo, flexShrink: 0 }}>
                    {step > i + 1 ? <Check size={11} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 11.5, color: step === i + 1 ? t.nova : t.textLo, whiteSpace: "nowrap" }}>{st}</span>
                  {i < STEPS.length - 1 && <ChevronRight size={11} color={t.borderSoft} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, flexShrink: 0 }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={g2}>
                <div><label style={lbl}>Nombre(s) *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>Apellidos *</label><input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} style={inp} /></div>
              </div>
              <div style={g2}>
                <div><label style={lbl}>Email *</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>Teléfono</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
              </div>
              <div style={g2}>
                <div><label style={lbl}>CURP *</label><input value={form.curp} onChange={e => setForm(f => ({ ...f, curp: e.target.value.toUpperCase() }))} placeholder="AAAA000000HXXXXXX00" style={{ ...inp, fontFamily: "monospace", textTransform: "uppercase" }} /></div>
                <div><label style={lbl}>RFC *</label><input value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} placeholder="AAAA000000XX0" style={{ ...inp, fontFamily: "monospace", textTransform: "uppercase" }} /></div>
              </div>
              <div><label style={lbl}>NSS (IMSS)</label><input value={form.nss} onChange={e => setForm(f => ({ ...f, nss: e.target.value }))} placeholder="11 dígitos" style={{ ...inp, fontFamily: "monospace" }} /></div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={g2}>
                <div><label style={lbl}>Departamento *</label>
                  <select value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="">Seleccionar…</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Puesto *</label><input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} style={inp} /></div>
              </div>
              <div><label style={lbl}>Centro de costo</label><input value={form.cost_center} onChange={e => setForm(f => ({ ...f, cost_center: e.target.value }))} placeholder="CC-VTA, CC-ADM…" style={inp} /></div>
              <div style={g2}>
                <div><label style={lbl}>Salario base mensual *</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo }}>$</span>
                    <input type="number" value={form.base_salary}
                      onChange={e => {
                        const sal = Number(e.target.value) || 0;
                        // SBC DIARIO = (mensual / 30) × factor integración (Art. 27 LSS, 1.0452 con 1 año antigüedad)
                        const sbcDiarioSugerido = sal > 0 ? (sal / 30) * 1.0452 : 0;
                        setForm(f => ({ ...f, base_salary: e.target.value, sbc: sbcDiarioSugerido ? sbcDiarioSugerido.toFixed(2) : "" }));
                      }}
                      style={{ ...inp, paddingLeft: 24 }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4 }}>Total mensual bruto</div>
                </div>
                <div><label style={lbl}>SBC diario (Salario Base Cotización) *</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo }}>$</span>
                    <input type="number" step={0.01} value={form.sbc} onChange={e => setForm(f => ({ ...f, sbc: e.target.value }))} style={{ ...inp, paddingLeft: 24 }} />
                  </div>
                  {(() => {
                    const sal = Number(form.base_salary) || 0;
                    const sbc = Number(form.sbc) || 0;
                    const sugerido = sal > 0 ? (sal / 30) * 1.0452 : 0;
                    // Warning si SBC parece capturado como mensual (mucho más alto que el sugerido)
                    if (sal > 0 && sbc > sugerido * 3) {
                      return (
                        <div style={{ fontSize: 10.5, color: t.bad, marginTop: 4, fontWeight: 600 }}>
                          ⚠ SBC muy alto. Debe ser DIARIO (~${sugerido.toFixed(2)}), no mensual. Corrige antes de calcular nómina.
                        </div>
                      );
                    }
                    if (sal > 0 && sbc > 0 && sbc < sugerido * 0.5) {
                      return (
                        <div style={{ fontSize: 10.5, color: t.warn, marginTop: 4 }}>
                          SBC bajo (sugerido ~${sugerido.toFixed(2)}/día). Verifica que sea el correcto.
                        </div>
                      );
                    }
                    return <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4 }}>DIARIO — Art. 27 LSS. Tope 25 UMAs ($2,828.50).</div>;
                  })()}
                </div>
              </div>
              <div><label style={lbl}>Frecuencia de pago *</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["semanal", "catorcenal", "quincenal", "mensual"] as PayFrequency[]).map(freq => (
                    <button key={freq} onClick={() => setForm(f => ({ ...f, pay_frequency: freq }))} style={{ flex: 1, padding: "9px 6px", borderRadius: 8, border: `1px solid ${form.pay_frequency === freq ? t.nova : t.border}`, background: form.pay_frequency === freq ? t.nova + "18" : t.inputBg, color: form.pay_frequency === freq ? t.nova : t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                      {freq.charAt(0).toUpperCase() + freq.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Tipo de contrato *</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(CONTRACT_TYPES).map(([key, meta]) => (
                    <button key={key} onClick={() => setForm(f => ({ ...f, contract_type: key }))} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${form.contract_type === key ? meta.color : t.border}`, background: form.contract_type === key ? meta.color + "14" : t.inputBg, cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: form.contract_type === key ? meta.color : t.textMid }}>{meta.label}</div>
                      <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{meta.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected contract info */}
              <div style={{ background: ct.color + "14", border: `1px solid ${ct.color}33`, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: ct.color }}>
                <b>{ct.label}:</b> {ct.desc}
              </div>

              <div style={g2}>
                <div><label style={lbl}>Fecha de ingreso *</label><input type="date" value={form.hire_date} onChange={e => setForm(f => ({ ...f, hire_date: e.target.value }))} style={inp} /></div>
                {needsEndDate && <div><label style={lbl}>Fecha fin de contrato *</label><input type="date" value={form.contract_end} onChange={e => setForm(f => ({ ...f, contract_end: e.target.value }))} style={inp} /></div>}
                {needsTrialDate && <div><label style={lbl}>Fin período de prueba *</label><input type="date" value={form.trial_end} onChange={e => setForm(f => ({ ...f, trial_end: e.target.value }))} style={inp} /></div>}
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={g2}>
                <div><label style={lbl}>Banco *</label>
                  <select value={form.bank} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="">Seleccionar…</option>
                    {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>CLABE interbancaria *</label><input value={form.clabe} onChange={e => setForm(f => ({ ...f, clabe: e.target.value }))} placeholder="18 dígitos" maxLength={18} style={{ ...inp, fontFamily: "monospace" }} /></div>
              </div>
              <div style={g2}>
                <div><label style={lbl}>Régimen fiscal SAT *</label>
                  <select value={form.tax_regime} onChange={e => setForm(f => ({ ...f, tax_regime: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="605">605 - Sueldos y salarios</option>
                    <option value="612">612 - Personas físicas actividades</option>
                    <option value="626">626 - Simplificado de confianza</option>
                  </select>
                </div>
                <div><label style={lbl}>Crédito INFONAVIT</label><input value={form.infonavit_credit} onChange={e => setForm(f => ({ ...f, infonavit_credit: e.target.value }))} placeholder="Número de crédito" style={inp} /></div>
              </div>
              {form.infonavit_credit && (
                <div style={g2}>
                  <div><label style={lbl}>Tipo de descuento INFONAVIT</label>
                    <select value={form.infonavit_discount_type} onChange={e => setForm(f => ({ ...f, infonavit_discount_type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                      <option value="">Seleccionar…</option>
                      <option value="cuota_fija">Cuota fija</option>
                      <option value="porcentaje">Porcentaje del salario</option>
                      <option value="factor_veces_salario">Factor de veces el salario (VSM/UMA)</option>
                    </select>
                  </div>
                  <div><label style={lbl}>Valor del descuento</label><input type="number" value={form.infonavit_discount_value} onChange={e => setForm(f => ({ ...f, infonavit_discount_value: e.target.value }))} placeholder="Monto o %" style={inp} /></div>
                </div>
              )}
              <div style={g2}>
                <div><label style={lbl}>Crédito FONACOT</label><input value={form.fonacot_credit} onChange={e => setForm(f => ({ ...f, fonacot_credit: e.target.value }))} placeholder="Número de crédito" style={inp} /></div>
                {form.fonacot_credit && <div><label style={lbl}>Descuento FONACOT por período</label><input type="number" value={form.fonacot_discount_value} onChange={e => setForm(f => ({ ...f, fonacot_discount_value: e.target.value }))} placeholder="Monto fijo" style={inp} /></div>}
              </div>

              {/* Resumen fiscal (referencia rápida) */}
              {form.base_salary && (
                <div style={{ background: t.panel2, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textLo, marginBottom: 10 }}>RESUMEN FISCAL</div>
                  {(() => {
                    const sal = Number(form.base_salary) || 0;
                    const sbc = Number(form.sbc) || 0;
                    const items = [
                      { l: "Salario base mensual", v: mxn(sal), c: t.textHi },
                      { l: "SBC (para IMSS/INFONAVIT)", v: sbc ? mxn(sbc) : "—", c: t.textHi },
                      { l: "Régimen fiscal (SAT)", v: form.tax_regime || "—", c: t.textMid },
                      { l: "Frecuencia de pago", v: form.pay_frequency || "—", c: t.textMid },
                    ];
                    return (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                          {items.map(item => (
                            <div key={item.l} style={{ background: t.panel3, borderRadius: 8, padding: "10px 12px" }}>
                              <div style={{ fontSize: 10.5, color: t.textLo, marginBottom: 4 }}>{item.l}</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: item.c }}>{item.v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: t.textLo, marginTop: 10, lineHeight: 1.5 }}>
                          Los cálculos de ISR, IMSS obrero/patronal, INFONAVIT/FONACOT, subsidio al empleo e ISN se realizan en el servidor
                          con las tablas oficiales al momento de calcular cada período de nómina.
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {step === 1 ? "Cancelar" : "← Anterior"}
          </button>
          {step < 4 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={step === 1 && (!form.name || !form.last_name || !form.email)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (step === 1 && (!form.name || !form.last_name || !form.email)) ? 0.5 : 1 }}>
              Siguiente →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {saving ? "Guardando…" : "Guardar empleado"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Attendance Form Modal ──────────────────────────────────────────────────
function AttendanceFormModal({ t, employees, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: employees[0]?.id || "",
    date: new Date().toISOString().slice(0, 10),
    type: "entrada" as AttendanceType,
    time: "",
    hours: "",
    channel: "manual",
    notes: "",
  });

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };

  const handleSave = async () => {
    if (!form.employee_id) return;
    setSaving(true);
    try { await onSave({ ...form, employee_id: Number(form.employee_id), hours: form.hours !== "" ? Number(form.hours) : null }); } finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.textHi }}>Registrar incidencia</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl}>Empleado *</label>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Seleccionar…</option>
              {employees.map((e: Employee) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Fecha *</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>Tipo *</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as AttendanceType }))} style={{ ...inp, cursor: "pointer" }}>
              {Object.entries(ATTENDANCE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Hora</label>
            <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} style={inp} />
          </div>
          {form.type === "extra" && (
            <div>
              <label style={lbl}>Horas extra trabajadas *</label>
              <input type="number" step="0.5" min="0" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} placeholder="Ej. 3.5" style={inp} />
            </div>
          )}
          <div>
            <label style={lbl}>Notas</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inp} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.employee_id} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.employee_id ? 0.5 : 1 }}>
            {saving ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Period Form Modal ──────────────────────────────────────────────────────
function PeriodFormModal({ t, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    frequency: "quincenal" as PayFrequency,
    start_date: "",
    end_date: "",
    payment_date: "",
  });

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const valid = form.name && form.start_date && form.end_date && form.payment_date;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.textHi }}>Nuevo período de nómina</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl}>Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Quincena Jul 1-15 2026" style={inp} />
          </div>
          <div>
            <label style={lbl}>Frecuencia *</label>
            <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as PayFrequency }))} style={{ ...inp, cursor: "pointer" }}>
              {(["semanal", "catorcenal", "quincenal", "mensual"] as PayFrequency[]).map(fr => <option key={fr} value={fr}>{fr}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Fecha inicio *</label>
            <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>Fecha fin *</label>
            <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={lbl}>Fecha de pago *</label>
            <input type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} style={inp} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !valid} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.5 : 1 }}>
            {saving ? "Creando…" : "Crear período"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Dispersion Tab (rediseñada) ─────────────────────────────────────────────
// Prepara el archivo listo para subir a la banca en línea:
//   1) resumen por banco con desglose (# empleados × total)
//   2) validación previa (CLABE inválida, RFC faltante, importe cero)
//   3) descarga del layout oficial (BBVA/Banorte/Santander/HSBC/Banamex/SPEI)
//   4) botón "Marcar como dispersado" solo tras confirmar la subida al banco
function DispersionTab({
  t, periods, selectedPeriod, setSelectedPeriod, onDispersed,
}: {
  t: any;
  periods: any[];
  selectedPeriod: any | null;
  setSelectedPeriod: (p: any | null) => void;
  onDispersed: () => Promise<void> | void;
}) {
  const downloadAllReceipts = async () => {
    if (!selectedPeriod) return;
    try {
      const res = await hrApi.downloadReceiptsZip(selectedPeriod.id);
      downloadBlob(res.data, `recibos_${selectedPeriod.name.replace(/\s+/g, "_")}.zip`);
    } catch { alert("Error al generar los recibos"); }
  };
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [originAccount, setOriginAccount] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [confirmDispersed, setConfirmDispersed] = useState(false);
  const [dispersing, setDispersing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fetchSummary = useCallback(async (id: number) => {
    setLoading(true); setErr(null);
    try {
      const s = await hrApi.dispersionSummary(id);
      setSummary(s);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "No se pudo cargar el resumen de dispersión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPeriod?.id) fetchSummary(selectedPeriod.id);
    else setSummary(null);
  }, [selectedPeriod?.id, fetchSummary]);

  const eligible = periods.filter((p: any) => p.status === "approved" || p.status === "dispersed" || p.status === "calculated");

  const clabeOk = originAccount.length === 0 || /^\d{18}$/.test(originAccount);

  const download = async (bank: string) => {
    if (!selectedPeriod) return;
    setDownloading(bank);
    try {
      const res = await hrApi.downloadBankLayout(selectedPeriod.id, bank, originAccount || undefined);
      const disposition = res.headers?.["content-disposition"] || "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match ? match[1] : `dispersion_${bank.toLowerCase()}_${selectedPeriod.id}.txt`;
      downloadBlob(res.data, filename);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al generar el layout bancario");
    } finally {
      setDownloading(null);
    }
  };

  const disperse = async () => {
    if (!selectedPeriod) return;
    if (!confirmDispersed) {
      alert("Marca la casilla de confirmación antes de dispersar.");
      return;
    }
    setDispersing(true);
    try {
      await hrApi.dispersePeriod(selectedPeriod.id);
      await onDispersed();
      await fetchSummary(selectedPeriod.id);
      setConfirmDispersed(false);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al dispersar");
    } finally {
      setDispersing(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header: selector de periodo + estado + cuenta origen */}
      <div style={{ ...glass(t), borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>Dispersión de nómina</div>
              {selectedPeriod && (
                <button onClick={downloadAllReceipts}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                  <FileText size={12} /> Recibos PDF (ZIP)
                </button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginTop: 4, maxWidth: 620, lineHeight: 1.5 }}>
              Prepara el archivo listo para subir a la banca en línea. Cada banco tiene su formato oficial; validamos CLABE, RFC y monto antes de generarlo para evitar rechazos.
            </div>
          </div>
          {selectedPeriod && summary && (
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <StatBlock t={t} label="Empleados" value={String(summary.total_employees)} sub={`${summary.ready_count} listos${summary.error_count ? ` · ${summary.error_count} con error` : ""}`} />
              <StatBlock t={t} label="Total a dispersar" value={mxn(summary.total_amount)} sub={`Fecha pago: ${summary.payment_date || "—"}`} valueColor={t.good} />
              <StatBlock t={t} label="Estado" value={PERIOD_STATUS[summary.period_status].label} valueColor={PERIOD_STATUS[summary.period_status].color} />
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 340px) minmax(240px, 1fr)", gap: 12, marginTop: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase", display: "block", marginBottom: 5 }}>Período</label>
            <select value={selectedPeriod?.id || ""} onChange={e => setSelectedPeriod(periods.find((p: any) => p.id === Number(e.target.value)) || null)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, cursor: "pointer" }}>
              <option value="">— Elige un período —</option>
              {eligible.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {PERIOD_STATUS[p.status].label}</option>)}
            </select>
            {eligible.length === 0 && (
              <div style={{ fontSize: 11.5, color: t.warn, marginTop: 6 }}>Aún no hay períodos calculados o aprobados. Ve a Nómina para crear uno.</div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase", display: "block", marginBottom: 5 }}>
              Cuenta cargo (CLABE de la empresa)
            </label>
            <input value={originAccount} onChange={e => setOriginAccount(e.target.value.replace(/\D/g, "").slice(0, 18))} maxLength={18}
                   placeholder="18 dígitos — se usa como cuenta origen en el archivo"
                   style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${clabeOk ? t.border : t.bad}`, background: t.inputBg, color: t.textHi, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }} />
            <div style={{ fontSize: 10.5, color: clabeOk ? t.textLo : t.bad, marginTop: 4 }}>
              {clabeOk ? "Si la dejas vacía, el archivo llevará 18 ceros y deberás editarlo antes de subirlo al banco." : "Debe ser 18 dígitos."}
            </div>
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 13 }}>Cargando resumen de dispersión…</div>}
      {err && <div style={{ background: t.bad + "18", color: t.bad, padding: 14, borderRadius: 10, fontSize: 13 }}>{err}</div>}

      {!loading && !err && !selectedPeriod && (
        <div style={{ ...glass(t), borderRadius: 12, padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>
          Elige un período arriba para preparar la dispersión.
        </div>
      )}

      {summary && !loading && (
        <>
          {/* Warnings */}
          {summary.error_count > 0 && (
            <div style={{ background: t.warn + "16", border: `1px solid ${t.warn}55`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <AlertTriangle size={16} color={t.warn} />
                  <span style={{ fontSize: 13, color: t.textHi, fontWeight: 600 }}>
                    {summary.error_count} empleado{summary.error_count !== 1 ? "s" : ""} con datos incompletos — no se incluirán en el archivo.
                  </span>
                </div>
                <button onClick={() => setShowIssues(!showIssues)} style={{ background: "transparent", color: t.warn, border: `1px solid ${t.warn}55`, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  {showIssues ? "Ocultar" : "Ver detalle"}
                </button>
              </div>
              {showIssues && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${t.warn}33`, paddingTop: 10 }}>
                  {summary.issues.map((issue: any, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, borderBottom: i < summary.issues.length - 1 ? `1px solid ${t.warn}22` : "none" }}>
                      <span style={{ color: t.textMid }}><b style={{ color: t.textHi }}>{issue.employee_name}</b> ({issue.bank || "sin banco"}) · {mxn(issue.amount)}</span>
                      <span style={{ color: t.warn, textAlign: "right" }}>{issue.reasons.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tabla de bancos con desglose y descarga */}
          <div style={{ ...glass(t), borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>Archivos por banco</div>
                <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2 }}>
                  Cada archivo trae solo a los empleados con cuenta en ese banco. El SPEI incluye a todos y sirve como archivo universal.
                </div>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: t.panel }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>Banco</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>Empleados</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>Total</th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>Layout</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>Archivo</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.banks.map((b: any, i: number) => (
                    <tr key={b.bank} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                      <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{b.bank}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {b.employees}
                        {b.with_errors > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: t.warn }}>({b.with_errors} c/error)</span>}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 700, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(b.amount)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {b.layout_supported ? (
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: t.good, background: t.good + "18", padding: "3px 8px", borderRadius: 20 }}>Oficial (.txt)</span>
                        ) : (
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: t.warn, background: t.warn + "18", padding: "3px 8px", borderRadius: 20 }}>SPEI genérico</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "right" }}>
                        {b.ready === 0 ? (
                          <span style={{ fontSize: 11.5, color: t.textLo }}>Sin empleados listos</span>
                        ) : (
                          <button onClick={() => download(b.layout_supported ? b.bank : "SPEI")} disabled={downloading === b.bank}
                                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${t.nova}66`, background: t.nova + "18", color: t.nova, cursor: "pointer", fontSize: 12, fontWeight: 700, opacity: downloading === b.bank ? 0.6 : 1 }}>
                            <Download size={13} /> Descargar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* Fila SPEI universal (todos los empleados válidos) */}
                  <tr style={{ background: t.panel3, borderTop: `2px solid ${t.border}` }}>
                    <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 700 }}>
                      SPEI universal <span style={{ fontSize: 10.5, color: t.textLo, fontWeight: 400, marginLeft: 6 }}>(todos los bancos)</span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{summary.ready_count}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 700, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(summary.total_amount)}</td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: t.nova, background: t.nova + "18", padding: "3px 8px", borderRadius: 20 }}>SPEI (.csv)</span>
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>
                      <button onClick={() => download("SPEI")} disabled={downloading === "SPEI"}
                              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                        <Download size={13} /> Descargar
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Confirmación tras subir al banco */}
          {summary.period_status === "approved" && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 16, border: `1px solid ${t.good}44`, background: t.good + "08" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>
                ¿Ya subiste el archivo a la banca en línea?
              </div>
              <div style={{ fontSize: 12, color: t.textLo, marginBottom: 12, lineHeight: 1.5 }}>
                Descarga el layout arriba, súbelo en tu portal empresarial (BBVA Net Cash, Banorte Empresarial, Santander SuperNet, HSBCnet, BancaNet Empresarial). Cuando el banco te confirme la operación, marca la nómina como dispersada para dejar constancia y actualizar el estado.
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12.5, color: t.textMid }}>
                <input type="checkbox" checked={confirmDispersed} onChange={e => setConfirmDispersed(e.target.checked)} />
                Confirmo que subí el archivo al banco y la operación fue aceptada.
              </label>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={disperse} disabled={!confirmDispersed || dispersing}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 10, border: "none",
                                  background: confirmDispersed ? `linear-gradient(135deg, ${t.good}, #059669)` : t.panel3,
                                  color: confirmDispersed ? "#fff" : t.textLo, cursor: confirmDispersed ? "pointer" : "not-allowed",
                                  fontSize: 13, fontWeight: 700, opacity: dispersing ? 0.6 : 1 }}>
                  <Banknote size={14} /> {dispersing ? "Guardando…" : "Marcar como dispersada"}
                </button>
              </div>
            </div>
          )}

          {summary.period_status === "dispersed" && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 16, border: `1px solid ${t.good}66`, display: "flex", gap: 10, alignItems: "center" }}>
              <CheckCircle size={20} color={t.good} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>Nómina dispersada</div>
                <div style={{ fontSize: 12, color: t.textLo }}>Registrada como pagada. Puedes volver a descargar el archivo si necesitas revalidar.</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatBlock({ t, label, value, sub, valueColor }: { t: any; label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: valueColor || t.textHi, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Report Runner Modal ─────────────────────────────────────────────────────
// Sustituye los window.prompt() por un formulario tipado con validación.
// Cubre: horas extra (rango de fechas), acumulado anual (año), PTU (año +
// utilidad), SUA (selector de período) y aguinaldo (año + fecha pago).
function ReportRunnerModal({
  t, kind, periods, onClose, onDone,
}: {
  t: any;
  kind: "overtime" | "annual" | "ptu" | "sua" | "aguinaldo";
  periods: any[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<string>(String(currentYear));
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [utilidad, setUtilidad] = useState<string>("");
  const [periodId, setPeriodId] = useState<string>("");
  const [paymentDate, setPaymentDate] = useState<string>(`${currentYear}-12-19`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [preview, setPreview] = useState<any[] | null>(null);

  const meta: Record<typeof kind, { title: string; sub: string; cta: string }> = {
    overtime: {
      title: "Horas extra LFT 2026",
      sub: "Elige el rango de fechas. El reporte clasifica dobles (hasta 9/sem ISO) y triples (excedente).",
      cta: "Generar preview",
    },
    annual: {
      title: "Acumulado anual",
      sub: "Suma percepciones y deducciones de los períodos calculados del año.",
      cta: "Generar preview",
    },
    ptu: {
      title: "PTU — Participación de utilidades",
      sub: "Reparte la utilidad declarada 50 % por días trabajados y 50 % por salario percibido.",
      cta: "Generar preview",
    },
    sua: {
      title: "SUA (apoyo IMSS)",
      sub: "Cuotas obrero-patronales del período seleccionado. Formato CSV para captura en SUA.",
      cta: "Generar preview",
    },
    aguinaldo: {
      title: "Nuevo período de aguinaldo",
      sub: "Se crea un período tipo aguinaldo. Después ábrelo en la lista y presiona 'Calcular nómina'.",
      cta: "Crear período",
    },
  };

  const isValid = (() => {
    if (kind === "overtime") return !!start && !!end && start <= end;
    if (kind === "annual") return /^\d{4}$/.test(year);
    if (kind === "ptu") return /^\d{4}$/.test(year) && Number(utilidad) > 0;
    if (kind === "sua") return !!periodId;
    if (kind === "aguinaldo") return /^\d{4}$/.test(year) && /^\d{4}-\d{2}-\d{2}$/.test(paymentDate);
    return false;
  })();

  const generatePreview = async () => {
    if (!isValid) return;
    setBusy(true); setErr(null);
    try {
      let data: any[] = [];
      if (kind === "overtime") data = await hrApi.reportOvertimeData(start, end);
      else if (kind === "annual") data = await hrApi.reportAnnualData(Number(year));
      else if (kind === "ptu") data = await hrApi.reportPTUData(Number(year), Number(utilidad));
      else if (kind === "sua") data = await hrApi.reportSUAData(Number(periodId));
      setPreview(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al generar el reporte");
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async () => {
    setBusy(true); setErr(null);
    try {
      if (kind === "overtime") {
        const res = await hrApi.downloadOvertimeReport(start, end);
        downloadBlob(res.data, `horas_extra_${start}_a_${end}.csv`);
      } else if (kind === "annual") {
        const res = await hrApi.downloadAnnualAccumulatedReport(Number(year));
        downloadBlob(res.data, `acumulado_anual_${year}.csv`);
      } else if (kind === "ptu") {
        const res = await hrApi.downloadPTUReport(Number(year), Number(utilidad));
        downloadBlob(res.data, `ptu_${year}.csv`);
      } else if (kind === "sua") {
        const res = await hrApi.downloadSUAReport(Number(periodId));
        downloadBlob(res.data, `sua_apoyo_${periodId}.csv`);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al descargar el CSV");
    } finally {
      setBusy(false);
    }
  };

  const createAguinaldo = async () => {
    setBusy(true); setErr(null);
    try {
      await hrApi.createAguinaldo(Number(year), paymentDate);
      await onDone();
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al crear período de aguinaldo");
    } finally {
      setBusy(false);
    }
  };

  const m = meta[kind];
  const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, boxSizing: "border-box", outline: "none" };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase", display: "block", marginBottom: 4 };

  const eligible = periods.filter((p: any) => p.status === "calculated" || p.status === "approved" || p.status === "dispersed");

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: preview ? 1080 : 520, background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22, maxHeight: "94vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{m.title}</h3>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>{m.sub}</p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14, overflowY: "auto" }}>
          {/* Formulario de parámetros */}
          <div style={{ display: "grid", gridTemplateColumns: kind === "overtime" || kind === "aguinaldo" ? "1fr 1fr" : "1fr", gap: 10 }}>
            {kind === "overtime" && (
              <>
                <div><label style={lbl}>Fecha inicial</label><input type="date" value={start} onChange={e => { setStart(e.target.value); setPreview(null); }} style={inp} /></div>
                <div><label style={lbl}>Fecha final</label><input type="date" value={end} onChange={e => { setEnd(e.target.value); setPreview(null); }} style={inp} /></div>
              </>
            )}
            {kind === "annual" && (
              <div><label style={lbl}>Año a consultar</label><input type="number" value={year} onChange={e => { setYear(e.target.value); setPreview(null); }} min={2020} max={2100} style={inp} /></div>
            )}
            {kind === "ptu" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label style={lbl}>Año del ejercicio</label><input type="number" value={year} onChange={e => { setYear(e.target.value); setPreview(null); }} min={2020} max={2100} style={inp} /></div>
                <div>
                  <label style={lbl}>Utilidad repartible (MXN)</label>
                  <input type="number" step={0.01} value={utilidad} onChange={e => { setUtilidad(e.target.value); setPreview(null); }} placeholder="Ej. 250000.00" style={inp} />
                </div>
              </div>
            )}
            {kind === "sua" && (
              <div>
                <label style={lbl}>Período</label>
                <select value={periodId} onChange={e => { setPeriodId(e.target.value); setPreview(null); }} style={{ ...inp, cursor: "pointer" }}>
                  <option value="">— Elige uno —</option>
                  {eligible.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {p.status}</option>)}
                </select>
                {eligible.length === 0 && (
                  <div style={{ fontSize: 11.5, color: t.warn, marginTop: 6 }}>Aún no hay períodos calculados.</div>
                )}
              </div>
            )}
            {kind === "aguinaldo" && (
              <>
                <div><label style={lbl}>Año</label><input type="number" value={year} onChange={e => setYear(e.target.value)} min={2020} max={2100} style={inp} /></div>
                <div><label style={lbl}>Fecha de pago</label><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} style={inp} /></div>
              </>
            )}
          </div>

          {err && <div style={{ color: t.bad, fontSize: 12, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}

          {/* Preview de datos */}
          {preview !== null && kind !== "aguinaldo" && (
            <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>Preview — {preview.length} {preview.length === 1 ? "registro" : "registros"}</span>
                {preview.length === 0 && <span style={{ fontSize: 11.5, color: t.textLo }}>Sin datos para los parámetros elegidos</span>}
              </div>
              {preview.length > 0 && (
                <div style={{ maxHeight: 380, overflow: "auto" }}>
                  <ReportTable rows={preview} t={t} />
                </div>
              )}
            </div>
          )}

          {/* Botones */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cerrar</button>
            <div style={{ display: "flex", gap: 8 }}>
              {kind === "aguinaldo" ? (
                <button onClick={createAguinaldo} disabled={busy || !isValid}
                        style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                          background: isValid ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : t.panel3,
                          color: isValid ? "#fff" : t.textLo, cursor: isValid ? "pointer" : "not-allowed",
                          fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                  {busy ? "Creando…" : "Crear período"}
                </button>
              ) : (
                <>
                  {preview !== null && preview.length > 0 && (
                    <button onClick={downloadCsv} disabled={busy}
                            style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textHi, cursor: "pointer", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Download size={14} /> Descargar CSV
                    </button>
                  )}
                  <button onClick={generatePreview} disabled={busy || !isValid}
                          style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                            background: isValid ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : t.panel3,
                            color: isValid ? "#fff" : t.textLo, cursor: isValid ? "pointer" : "not-allowed",
                            fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
                    {busy ? "Generando…" : preview === null ? m.cta : "Regenerar"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  , document.body);
}


// ── ReportTable ─────────────────────────────────────────────────────────────
// Tabla genérica que renderiza cualquier lista de objetos. Detecta valores
// numéricos y les da formato dinero cuando la clave sugiere importe.
function ReportTable({ rows, t }: { rows: any[]; t: any }) {
  const columns = useMemo(() => {
    if (!rows.length) return [];
    // Toma las llaves de la primera fila
    return Object.keys(rows[0]);
  }, [rows]);

  const isMoneyKey = (k: string) => /amount|total|salary|earned|net|gross|premium|imss|isr|infonavit|fonacot|bonus|voucher|fund|loan|pay|ptu/i.test(k) && !/count|days|hours/i.test(k);
  const isNumericKey = (k: string) => /count|days|hours|year|month|number|id/i.test(k);
  const fmtValue = (k: string, v: any) => {
    if (v == null || v === "") return "—";
    if (typeof v === "number") {
      if (isMoneyKey(k)) return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (Number.isInteger(v)) return v.toLocaleString("es-MX");
      return v.toLocaleString("es-MX", { maximumFractionDigits: 2 });
    }
    return String(v);
  };
  const humanize = (k: string) => k
    .replace(/_/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: t.panel3 }}>
          {columns.map(c => (
            <th key={c} style={{ padding: "8px 10px", textAlign: (isMoneyKey(c) || isNumericKey(c)) ? "right" : "left", fontSize: 10.5, fontWeight: 700, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", position: "sticky", top: 0, background: t.panel3 }}>
              {humanize(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
            {columns.map(c => (
              <td key={c} style={{
                padding: "8px 10px",
                textAlign: (isMoneyKey(c) || isNumericKey(c)) ? "right" : "left",
                color: t.textMid, fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}>
                {fmtValue(c, row[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}


// ── Payroll Detail Editor ───────────────────────────────────────────────────
// Permite ajustar bonos, vales, fondo de ahorro y préstamos por empleado
// antes de aprobar. Recalcula ISR, ISN y neto al guardar.
function PayrollDetailEditor({
  t, period, row, onClose, onSaved,
}: {
  t: any;
  period: any;
  row: any;
  onClose: () => void;
  onSaved: (fresh: any) => void;
}) {
  const [bonus, setBonus] = useState<string>(String(row.bonus ?? 0));
  const [vouchers, setVouchers] = useState<string>(String(row.food_vouchers ?? 0));
  const [savings, setSavings] = useState<string>(String(row.savings_fund ?? 0));
  const [loan, setLoan] = useState<string>(String(row.loan_deduction ?? 0));
  const [notes, setNotes] = useState<string>(row.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const preview = (() => {
    const base = row.total_gross - (row.bonus || 0) - (row.food_vouchers || 0) - (row.savings_fund || 0);
    const gross = base + Number(bonus || 0) + Number(vouchers || 0) + Number(savings || 0);
    const deducciones = row.total_deductions - (row.loan_deduction || 0) + Number(loan || 0);
    const neto = gross - deducciones + (row.subsidy_applied || 0);
    return { gross, deducciones, neto };
  })();

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const fresh = await hrApi.updatePayrollDetail(period.id, row.employee_id, {
        bonus: Number(bonus) || 0,
        food_vouchers: Number(vouchers) || 0,
        savings_fund: Number(savings) || 0,
        loan_deduction: Number(loan) || 0,
        notes: notes || undefined,
      });
      onSaved(fresh);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al guardar cambios");
    } finally {
      setBusy(false);
    }
  };

  const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, boxSizing: "border-box", outline: "none" };
  const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase", display: "block", marginBottom: 4 };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Editar recibo — {row.employee_name}</h3>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: t.textLo }}>
              {period.name} · Solo puedes editar mientras el estado sea "calculado". Al guardar se recalculan ISR, ISN y neto.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          <div>
            <label style={lbl}>Bonos / incentivos (percepción gravable)</label>
            <input type="number" step={0.01} value={bonus} onChange={e => setBonus(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Vales de despensa (percepción gravable)</label>
            <input type="number" step={0.01} value={vouchers} onChange={e => setVouchers(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Fondo de ahorro (exento LISR)</label>
            <input type="number" step={0.01} value={savings} onChange={e => setSavings(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lbl}>Préstamo (deducción)</label>
            <input type="number" step={0.01} value={loan} onChange={e => setLoan(e.target.value)} style={inp} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={lbl}>Notas / justificación</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                    placeholder="Ej. Bono trimestral por metas de ventas Q2"
                    style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
        </div>

        <div style={{ marginTop: 16, padding: "12px 14px", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 }}>Vista previa (aproximada)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div><div style={{ fontSize: 11, color: t.textLo }}>Nuevo bruto</div><div style={{ fontSize: 15, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(preview.gross)}</div></div>
            <div><div style={{ fontSize: 11, color: t.textLo }}>Deducciones aprox.</div><div style={{ fontSize: 15, fontWeight: 700, color: t.bad, fontVariantNumeric: "tabular-nums" }}>{mxn(preview.deducciones)}</div></div>
            <div><div style={{ fontSize: 11, color: t.textLo }}>Neto estimado</div><div style={{ fontSize: 15, fontWeight: 700, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(preview.neto)}</div></div>
          </div>
          <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 6, lineHeight: 1.5 }}>
            El servidor recalcula ISR y SAE con las tablas oficiales; los números finales pueden variar por centavos.
          </div>
        </div>

        {err && <div style={{ marginTop: 12, color: t.bad, fontSize: 12, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={save} disabled={busy}
                  style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.good}, ${t.nova})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Guardando…" : "Guardar y recalcular"}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}


// ── EmployeeAttendancePanel — asistencia últimos 30 días en el drawer ───────
function EmployeeAttendancePanel({ t, employee }: { t: any; employee: any }) {
  const [data, setData] = useState<{ items: any[]; summary: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!employee?.id) return;
    setLoading(true); setErr(null);
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    hrApi.employeeAttendance(employee.id, iso(start), iso(end))
      .then((d: any) => setData(d))
      .catch((e: any) => setErr(e?.response?.data?.detail || "Error"))
      .finally(() => setLoading(false));
  }, [employee?.id]);

  const cards = data ? [
    { label: "Faltas", value: data.summary.faltas ?? 0, color: t.bad },
    { label: "Retardos", value: data.summary.retardos ?? 0, color: t.warn },
    { label: "Incapacidad", value: data.summary.incapacidad ?? 0, color: t.nova },
    { label: "Vacaciones", value: data.summary.vacacion ?? 0, color: t.good },
    { label: "H. extra", value: `${data.summary.extra_hours ?? 0}h`, color: "#A78BFA" },
  ] : [];

  return (
    <div>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" }}>
        Asistencia (últimos 30 días)
      </div>

      {loading && <div style={{ fontSize: 12.5, color: t.textLo }}>Cargando…</div>}
      {err && <div style={{ fontSize: 12.5, color: t.bad, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}

      {!loading && !err && data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 12 }}>
            {cards.map(c => (
              <div key={c.label} style={{ background: t.panel2, borderRadius: 8, padding: "8px 6px", textAlign: "center", border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: c.color, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
                <div style={{ fontSize: 10, color: t.textLo, marginTop: 2 }}>{c.label}</div>
              </div>
            ))}
          </div>

          {data.items.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textLo, background: t.panel2, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
              Sin incidencias registradas en los últimos 30 días.
            </div>
          ) : (
            <div style={{ background: t.panel2, borderRadius: 8, overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
              {data.items.slice(0, 15).map((a: any, i: number) => {
                const meta = ATTENDANCE_META[a.type] || { label: a.type, color: t.textLo, icon: Info };
                const Icon = meta.icon;
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: i < Math.min(data.items.length, 15) - 1 ? `1px solid ${t.borderSoft}` : "none" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 99, background: meta.color + "22", color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={11} />
                    </div>
                    <span style={{ fontSize: 12, color: t.textHi, fontWeight: 600 }}>{meta.label}</span>
                    {a.hours != null && a.type === "extra" && (
                      <span style={{ fontSize: 11, color: "#A78BFA", background: "#A78BFA22", padding: "1px 7px", borderRadius: 10, fontWeight: 600 }}>{a.hours}h</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: t.textLo, fontFamily: "monospace" }}>{a.date}</span>
                  </div>
                );
              })}
              {data.items.length > 15 && (
                <div style={{ padding: "6px 12px", fontSize: 11, color: t.textLo, textAlign: "center", background: t.panel3 }}>
                  … y {data.items.length - 15} más
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ── BulkDetailUploadModal ──────────────────────────────────────────────────
// Sube XLSX/CSV con bonos/vales/ahorro/préstamos/notas. Reporta aplicados,
// omitidos y errores por fila con línea del archivo original.
function BulkDetailUploadModal({
  t, period, onClose, onDone,
}: {
  t: any; period: any; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<null | { applied: number; skipped: number; errors: { row: number; reason: string }[] }>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const res = await hrApi.bulkImportDetail(period.id, file);
      setResult(res);
      await onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al procesar el archivo");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: "5vh 20px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Cargar bonos, vales y préstamos</h3>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>
              Sube el XLSX o CSV que descargaste con la plantilla. El sistema matchea empleados por número (primario) o RFC (fallback), aplica los cambios y recalcula ISR, ISN y neto.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, border: `2px dashed ${t.border}`, borderRadius: 10, background: t.panel2, textAlign: "center", marginTop: 12 }}>
          <Upload size={22} color={t.nova} />
          <div style={{ marginTop: 8, color: t.textMid, fontSize: 13 }}>
            {file ? file.name : "Selecciona un archivo .xlsx, .xlsm o .csv"}
          </div>
          <label style={{ display: "inline-block", marginTop: 10, padding: "6px 14px", borderRadius: 8, background: t.nova, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            Elegir archivo
            <input type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }}
                   onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
          </label>
        </div>

        {result && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: t.good + "18" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>Carga completada</div>
            <div style={{ fontSize: 12.5, color: t.textMid, marginTop: 4 }}>
              <b style={{ color: t.textHi }}>{result.applied}</b> empleados actualizados
              {result.skipped > 0 && ` · ${result.skipped} sin cambios`}
              {result.errors.length > 0 && ` · ${result.errors.length} con problema`}
            </div>
            {result.errors.length > 0 && (
              <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px", fontSize: 12, color: t.warn }}>
                {result.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>Fila {e.row}: {e.reason}</li>
                ))}
                {result.errors.length > 6 && <li>… y {result.errors.length - 6} más</li>}
              </ul>
            )}
          </div>
        )}

        {err && <div style={{ marginTop: 12, color: t.bad, fontSize: 12.5, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cerrar</button>
          <button onClick={submit} disabled={!file || busy}
                  style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.good}, ${t.nova})`, color: "#fff", cursor: !file ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, opacity: (!file || busy) ? 0.6 : 1 }}>
            {busy ? "Procesando…" : "Subir y aplicar"}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}


// ── SimpleReportModal ──────────────────────────────────────────────────────
// Modal para reportes que NO requieren parámetros: STPS, Vacaciones, INFONAVIT.
// Se abre, carga el JSON automáticamente, muestra la tabla y ofrece descarga CSV.
function SimpleReportModal({
  t, kind, onClose,
}: {
  t: any;
  kind: "headcount" | "vacations" | "infonavit";
  onClose: () => void;
}) {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = {
    headcount: { title: "Plantilla STPS", sub: "Personal activo con tipo de contrato y frecuencia de pago.", filename: "plantilla_stps.csv", dl: hrApi.downloadHeadcountReport },
    vacations: { title: "Control de vacaciones", sub: "Días generados, tomados y disponibles por empleado.", filename: "control_vacaciones.csv", dl: hrApi.downloadVacationReport },
    infonavit: { title: "INFONAVIT / FONACOT", sub: "Créditos vigentes y descuento estimado por período.", filename: "infonavit_fonacot.csv", dl: hrApi.downloadInfonavitReport },
  }[kind];

  useEffect(() => {
    setLoading(true); setErr(null);
    const fetcher = kind === "headcount" ? hrApi.reportHeadcountData
      : kind === "vacations" ? hrApi.reportVacationsData
      : hrApi.reportInfonavitData;
    fetcher()
      .then((d: any) => setData(Array.isArray(d) ? d : []))
      .catch((e: any) => setErr(e?.response?.data?.detail || "Error al cargar el reporte"))
      .finally(() => setLoading(false));
  }, [kind]);

  const downloadCsv = async () => {
    setBusy(true);
    try {
      const res = await meta.dl();
      downloadBlob(res.data, meta.filename);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al descargar el CSV");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1080, background: t.panel, borderRadius: 14, border: `1px solid ${t.border}`, padding: 22, maxHeight: "94vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{meta.title}</h3>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>{meta.sub}</p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
        </div>

        {err && <div style={{ color: t.bad, fontSize: 12, background: t.bad + "15", padding: "8px 12px", borderRadius: 8, marginBottom: 10 }}>{err}</div>}

        <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden", flex: 1, minHeight: 200 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>
              {loading ? "Cargando…" : `${data?.length || 0} registros`}
            </span>
            {!loading && data && data.length === 0 && (
              <span style={{ fontSize: 11.5, color: t.textLo }}>Sin datos para este reporte</span>
            )}
          </div>
          {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>Cargando reporte…</div>}
          {!loading && data && data.length > 0 && (
            <div style={{ maxHeight: 500, overflow: "auto" }}>
              <ReportTable rows={data} t={t} />
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cerrar</button>
          <button onClick={downloadCsv} disabled={loading || busy || !data || data.length === 0}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: (loading || busy || !data) ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, opacity: (loading || busy || !data || data.length === 0) ? 0.5 : 1 }}>
            <Download size={14} /> Descargar CSV
          </button>
        </div>
      </div>
    </div>
  , document.body);
}
