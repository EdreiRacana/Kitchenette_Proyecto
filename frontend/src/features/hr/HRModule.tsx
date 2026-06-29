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

// ISR 2026 quincenal (tabla simplificada)
const calcISR = (gravable: number): number => {
  const tables = [
    { li: 0, ls: 1768.96, fi: 0, porcentaje: 0.0192 },
    { li: 1768.97, ls: 15009.06, fi: 33.96, porcentaje: 0.0640 },
    { li: 15009.07, ls: 26385.47, fi: 881.68, porcentaje: 0.1088 },
    { li: 26385.48, ls: 30674.03, fi: 2118.73, porcentaje: 0.1600 },
    { li: 30674.04, ls: 36732.23, fi: 2804.44, porcentaje: 0.1792 },
    { li: 36732.24, ls: 74049.45, fi: 3890.39, porcentaje: 0.2136 },
    { li: 74049.46, ls: 116829.20, fi: 11870.05, porcentaje: 0.2352 },
    { li: 116829.21, ls: 999999999, fi: 21927.38, porcentaje: 0.3000 },
  ];
  const row = tables.find(r => gravable >= r.li && gravable <= r.ls) || tables[tables.length - 1];
  return Math.round(((gravable - row.li) * row.porcentaje + row.fi) * 100) / 100;
};

const calcIMSS = (sbc: number, freq: PayFrequency): number => {
  const uma2026 = 113.14;
  const diasPeriodo = freq === "semanal" ? 7 : freq === "catorcenal" ? 14 : freq === "quincenal" ? 15 : 30;
  const sbcDiario = sbc / 30;
  const enfermedadMaternidad = sbcDiario * diasPeriodo * 0.0025;
  const invalidezVida = sbcDiario * diasPeriodo * 0.00625;
  const cesantiaVejez = sbcDiario * diasPeriodo * 0.01125;
  return Math.round((enfermedadMaternidad + invalidezVida + cesantiaVejez) * 100) / 100;
};

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
            <button onClick={() => setPeriodForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Nuevo período
            </button>
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
                        <button onClick={async e => { e.stopPropagation(); try { await hrApi.approvePeriod(p.id); await load(); } catch (err: any) { alert(err?.response?.data?.detail || "Error al aprobar"); } }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                          Aprobar
                        </button>
                        <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12 }}>
                          <Eye size={14} />
                        </button>
                      </>
                    )}
                    {p.status === "approved" && (
                      <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                        Ir a dispersión →
                      </button>
                    )}
                    {p.status === "dispersed" && (
                      <button onClick={e => { e.stopPropagation(); setSelectedPeriod(p); setTab("dispersion"); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12 }}>
                        Ver detalle
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Payroll calculator preview */}
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 4 }}>Calculadora de nómina — Vista previa</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>Percepciones y deducciones estimadas por empleado (quincena)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Empleado", "Días trab.", "Salario base", "H.Extra", "Total percep.", "IMSS obrg.", "ISR", "Total deduc.", "NETO"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 14px", textAlign: i > 1 ? "right" : "left", fontSize: 10.5, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {employees.filter(e => e.pay_frequency === "quincenal" && e.is_active).map((e, i) => {
                    const diasPeriodo = 15;
                    const salarioGanado = (e.base_salary / 30) * diasPeriodo;
                    const imss = calcIMSS(e.sbc, "quincenal");
                    const isr = calcISR(salarioGanado - imss);
                    const totalPerc = salarioGanado;
                    const totalDeduc = imss + isr;
                    const neto = totalPerc - totalDeduc;
                    return (
                      <tr key={e.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.textHi, fontWeight: 600 }}>{fullName(e)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.textMid, textAlign: "right" }}>{diasPeriodo}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(salarioGanado)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.textLo, textAlign: "right" }}>—</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(totalPerc)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(imss)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(isr)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, fontWeight: 600, color: t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(totalDeduc)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 800, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(neto)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Dispersion ── */}
      {tab === "dispersion" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Dispersión de pagos</div>
            <div style={{ fontSize: 13, color: t.textLo, marginBottom: 20 }}>Genera el archivo bancario para dispersar el pago de nómina directamente a las cuentas CLABE de tus empleados.</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Período</label>
              <select value={selectedPeriod?.id || ""} onChange={e => setSelectedPeriod(periods.find(p => p.id === Number(e.target.value)) || null)} style={{ ...inp, cursor: "pointer", maxWidth: 360 }}>
                <option value="">Seleccionar período…</option>
                {periods.filter(p => p.status !== "draft").map(p => <option key={p.id} value={p.id}>{p.name} — {PERIOD_STATUS[p.status].label}</option>)}
              </select>
            </div>

            {!selectedPeriod ? (
              <div style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 13 }}>Selecciona un período calculado, aprobado o dispersado para ver su detalle.</div>
            ) : !periodDetail ? (
              <div style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 13 }}>Cargando detalle…</div>
            ) : (
              <>
                {/* Bank layout downloads */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
                  {["Todos", ...BANKS].map(bank => (
                    <button key={bank} style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", textAlign: "left", transition: "all .15s" }}
                      onMouseEnter={e => { (e.currentTarget as any).style.borderColor = t.nova + "66"; (e.currentTarget as any).style.background = t.panel3; }}
                      onMouseLeave={e => { (e.currentTarget as any).style.borderColor = t.border; (e.currentTarget as any).style.background = t.panel2; }}
                      onClick={async () => {
                        try {
                          const res = await hrApi.downloadBankLayout(selectedPeriod.id, bank === "Todos" ? undefined : bank);
                          downloadBlob(res.data, `layout_${bank}_${selectedPeriod.id}.csv`);
                        } catch { alert("Error al generar el layout bancario"); }
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>{bank}</div>
                      <div style={{ fontSize: 11.5, color: t.textLo }}>Layout bancario</div>
                      <div style={{ marginTop: 10, fontSize: 12, color: t.nova, display: "flex", alignItems: "center", gap: 4 }}>
                        <Download size={12} /> Descargar CSV
                      </div>
                    </button>
                  ))}
                </div>

                {/* Dispersion table */}
                <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 12 }}>Detalle de dispersión — {selectedPeriod.name}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: t.panel2 }}>
                        {["Empleado", "Banco", "CLABE", "Importe neto", "Estado"].map((h, i) => (
                          <th key={i} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(periodDetail.details || []).length === 0 ? (
                        <tr><td colSpan={5} style={{ textAlign: "center", padding: 30, color: t.textLo }}>Sin detalle disponible.</td></tr>
                      ) : (periodDetail.details || []).map((d: any, i: number) => {
                        const emp = employees.find(e => e.id === d.employee_id);
                        const dispersed = d.dispersion_status === "confirmado";
                        const stColor = dispersed ? t.good : t.warn;
                        return (
                          <tr key={d.employee_id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                            <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{d.employee_name}</td>
                            <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{emp?.bank || "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 12, color: t.textLo, fontFamily: "monospace" }}>{emp?.clabe || "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(d.total_net)}</td>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: stColor, background: stColor + "18", padding: "3px 9px", borderRadius: 20 }}>{dispersed ? "Confirmado" : "Pendiente"}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {selectedPeriod.status === "approved" && (
                  <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                    <button onClick={async () => {
                      try { await hrApi.dispersePeriod(selectedPeriod.id); await load(); const detail = await hrApi.periodDetail(selectedPeriod.id); setPeriodDetail(detail); } catch (err: any) { alert(err?.response?.data?.detail || "Error al dispersar"); }
                    }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                      <Banknote size={15} /> Dispersar pagos
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Reports ── */}
      {tab === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {[
              { icon: Users, title: "Plantilla STPS", desc: "Reporte de personal activo para registro STPS. Incluye tipos de contrato y jornada.", color: t.bad, tag: "STPS", action: async () => { const res = await hrApi.downloadHeadcountReport(); downloadBlob(res.data, "plantilla_stps.csv"); } },
              { icon: Calendar, title: "Control de vacaciones", desc: "Días generados, tomados y pendientes por empleado y período.", color: t.nova, tag: "RH", action: async () => { const res = await hrApi.downloadVacationReport(); downloadBlob(res.data, "control_vacaciones.csv"); } },
              { icon: Clock, title: "Horas extra LFT 2026", desc: "Clasifica horas extra dobles (hasta 9/semana) y triples (excedente) por empleado, en un rango de fechas.", color: t.warn, tag: "LFT", action: async () => {
                const start = window.prompt("Fecha inicial (YYYY-MM-DD):"); if (!start) return;
                const end = window.prompt("Fecha final (YYYY-MM-DD):"); if (!end) return;
                const res = await hrApi.downloadOvertimeReport(start, end); downloadBlob(res.data, `horas_extra_${start}_a_${end}.csv`);
              } },
              { icon: BarChart3, title: "Acumulado anual", desc: "Suma de percepciones y deducciones por empleado a lo largo del año, de períodos ya calculados.", color: t.good, tag: "ISR", action: async () => {
                const year = window.prompt("Año a consultar:", String(new Date().getFullYear())); if (!year) return;
                const res = await hrApi.downloadAnnualAccumulatedReport(Number(year)); downloadBlob(res.data, `acumulado_anual_${year}.csv`);
              } },
              { icon: DollarSign, title: "PTU — Participación de utilidades", desc: "Reparte la utilidad declarada 50% por días trabajados y 50% por salario percibido en el año.", color: t.nova, tag: "LFT", action: async () => {
                const year = window.prompt("Año del ejercicio:", String(new Date().getFullYear())); if (!year) return;
                const total = window.prompt("Monto total de utilidad repartible (MXN):"); if (!total) return;
                const res = await hrApi.downloadPTUReport(Number(year), Number(total)); downloadBlob(res.data, `ptu_${year}.csv`);
              } },
              { icon: TrendingDown, title: "Reporte INFONAVIT / FONACOT", desc: "Créditos vigentes, tipo de descuento configurado y monto estimado por período de cada empleado.", color: t.bad, tag: "INFONAVIT", action: async () => {
                const res = await hrApi.downloadInfonavitReport(); downloadBlob(res.data, "infonavit_fonacot.csv");
              } },
              { icon: FileText, title: "SUA — IMSS (apoyo)", desc: "Cuotas obrero-patronales por empleado de un período calculado, como apoyo para captura/validación en el programa oficial del IMSS.", color: t.textMid, tag: "IMSS", action: async () => {
                if (!periods.length) { alert("No hay períodos de nómina calculados todavía."); return; }
                const list = periods.map(p => `${p.id}: ${p.name} (${p.status})`).join("\n");
                const id = window.prompt(`Captura el ID del período:\n${list}`); if (!id) return;
                const res = await hrApi.downloadSUAReport(Number(id)); downloadBlob(res.data, `sua_apoyo_${id}.csv`);
              } },
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
                    <input type="number" value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: e.target.value, sbc: String(Number(e.target.value) * 1.05) }))} style={{ ...inp, paddingLeft: 24 }} />
                  </div>
                </div>
                <div><label style={lbl}>SBC (Salario Base Cotización) *</label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo }}>$</span>
                    <input type="number" value={form.sbc} onChange={e => setForm(f => ({ ...f, sbc: e.target.value }))} style={{ ...inp, paddingLeft: 24 }} />
                  </div>
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

              {/* ISR Preview */}
              {form.base_salary && (
                <div style={{ background: t.panel2, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textLo, marginBottom: 10 }}>VISTA PREVIA — NÓMINA QUINCENAL ESTIMADA</div>
                  {(() => {
                    const sal = Number(form.base_salary);
                    const sbc = Number(form.sbc) || sal * 1.05;
                    const salQ = (sal / 30) * 15;
                    const imss = calcIMSS(sbc, "quincenal");
                    const isr = calcISR(salQ - imss);
                    const neto = salQ - imss - isr;
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                        {[
                          { l: "Salario quincenal", v: mxn(salQ), c: t.textHi },
                          { l: "IMSS obrero", v: mxn(imss), c: t.bad },
                          { l: "ISR", v: mxn(isr), c: t.bad },
                          { l: "NETO", v: mxn(neto), c: t.good },
                        ].map(item => (
                          <div key={item.l} style={{ background: t.panel3, borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 10.5, color: t.textLo, marginBottom: 4 }}>{item.l}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: item.c }}>{item.v}</div>
                          </div>
                        ))}
                      </div>
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
