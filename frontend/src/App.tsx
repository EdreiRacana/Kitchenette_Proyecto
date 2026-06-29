import { useState, useMemo, useEffect, useRef } from "react";
import {
  LayoutDashboard, TrendingUp, Package, PackageX, Wallet, Users, Sliders,
  SlidersHorizontal, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle,
  CheckCircle, XCircle, CircleDot, Download, RefreshCw, Filter,
  ChevronLeft, ChevronRight, ChevronDown, BarChart3, Target, DollarSign,
  ShoppingCart, Clock, Star, Info, Calendar, Calendar as CalIcon,
  FileText, FileWarning, Mail, Bell, Maximize2, X, TrendingDown, Activity,
  Zap, Award, Eye, Check, IdCard, Settings, Plus, Search, Globe, Sun, Moon,
  Lock, LogOut, User as UserIcon, Menu, UserCircle2, ShoppingBag, Box,
  Truck, ClipboardList, BookText,
} from "lucide-react";
import SalesCRM from "./features/sales/SalesCRM";
import CustomersModule from "./features/customers/CustomersModule";
import InventoryModule from "./features/inventory/InventoryModule";
import FinanceModule from "./features/finance/FinanceModule";
import { financeService } from "./features/finance/service";
import AccountingModule from "./features/accounting/AccountingModule";
import HRModule from "./features/hr/HRModule";
import BIModule from "./features/bi/BIModule";
import ConfigModule from "./features/config/ConfigModule";
import api from "./services/api";
import configService from "./features/config/service";

// Mapa de id de módulo del menú → clave de permiso del backend (rbac.py).
const NAV_PERM = {
  dashboard: "dashboard", ventas: "sales", clientes: "customers", inventario: "inventory",
  finanzas: "finance", contabilidad: "accounting", rh: "hr", reportes: "reports", config: "config",
};
import { salesApi } from "./features/sales/api";
import { inventoryService } from "./features/inventory/service";

/* ============================ Responsive ============================ */
function useIsMobile(breakpoint = 880) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}


/* ============================ Theme ============================ */
const THEMES = {
  dark: {
    name: "dark",
    base: "#0A1022", panel: "#0E1838", panel2: "#131F44", panel3: "#1A2856",
    border: "#1E2E5C", borderSoft: "#18254A",
    navy: "#131B47", nova: "#33B2F5", novaSoft: "#8CEEFF",
    textHi: "#F2F6FF", textMid: "#AFBEDF", textLo: "#7C9AD0",
    good: "#34D399", warn: "#FBBF24", bad: "#F87171",
    gridLine: "#172445", inputBg: "#0A1430",
  },
  light: {
    name: "light",
    base: "#F4F7FC", panel: "#FFFFFF", panel2: "#F1F5FB", panel3: "#E8EEF8",
    border: "#E1E8F3", borderSoft: "#ECF1F8",
    navy: "#131B47", nova: "#1E86CC", novaSoft: "#33B2F5",
    textHi: "#0E1838", textMid: "#46557D", textLo: "#7888AE",
    good: "#0F9D70", warn: "#C77A06", bad: "#D6453E",
    gridLine: "#ECF1F8", inputBg: "#F7FAFE",
  },
};

/* ============================ i18n ============================ */
const MON_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STRINGS = {
  es: {
    monShort: MON_ES,
    cal: { months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], dows: ["L", "M", "X", "J", "V", "S", "D"] },
    nav: { dashboard: "Tablero", ventas: "Ventas / CRM", clientes: "Clientes", inventario: "Inventario", finanzas: "Finanzas", contabilidad: "Contabilidad", rh: "RH / Nómina", reportes: "Reportes / BI", config: "Configuración" },
    modules: "MÓDULOS", search: "Nexus — buscar en todo el sistema…", role: "Administrador",
    api: "API", soonTag: "pronto",
    secure: "Sistema Seguro",
    login: { user: "Usuario", pass: "Contraseña", enter: "Entrar al sistema", demo: "Demo · cualquier credencial entra", platform: "Plataforma Sthenova · el logo de cada empresa cliente se configura por separado" },
    presets: { week: "Semana", month: "Mes", quarter: "Trimestre", year: "Año" },
    dash: {
      to: "al", custom: "Personalizado", marginLabel: "MARGEN", target: "obj.",
      focos: { agotados: "agotados", cartera: "vencida", margen: "stock bajo" },
      vsPrev: "vs ant.", chartTitle: "Ventas del periodo", chartUnit: "(miles MXN)",
      legendCur: "Actual", legendPrev: "Periodo anterior",
      metaTitle: "Meta vs real", metaSub: "de la meta del periodo", real: "Real", meta: "Meta",
      remaining: (a) => `Faltan ${a} para llegar al objetivo.`, skus: (n) => `${n} SKUs`,
      noGoal: "Sin meta configurada para este periodo. Crea un presupuesto de ingresos en Finanzas para activarla.",
      loading: "Cargando datos del tablero…", loadError: "No se pudieron cargar los datos del tablero.",
      ofTarget: "de meta", current: "Periodo actual", previous: "Periodo anterior",
      variation: "vs periodo anterior", growth: "Crecimiento", drop: "Caída",
      goalProgress: "Avance hacia la meta", trend: "Tendencia del periodo",
      seeAnalysis: "Ver análisis completo",
    },
    kpi: { "Ventas": "Ventas", "Utilidad neta": "Utilidad neta", "Pedidos": "Pedidos", "Ticket promedio": "Ticket promedio" },
    inv: { sub: "Catálogo de productos, variantes y existencias por almacén", add: "Agregar producto", search: "Buscar por nombre o categoría", filters: "Filtros", h: { product: "Producto", cat: "Categoría", variants: "Variantes", stock: "Existencia", price: "Precio" }, variant: "variante", variants: "variantes", edit: "Editar", none: "Sin resultados. Ajusta la búsqueda o agrega un producto." },
    sales: { sub: "Pedidos, cotizaciones y seguimiento comercial", add: "Nuevo pedido", h: { ref: "Folio", customer: "Cliente", date: "Fecha", total: "Total", status: "Estado" } },
    cust: { sub: "Cartera, saldos y clasificación comercial", add: "Nuevo cliente", h: { customer: "Cliente", tax: "RFC", balance: "Saldo", orders: "Pedidos", tag: "Etiqueta" } },
    fin: { sub: "Cuentas por cobrar, por pagar y bancos", cards: { recv: "Por cobrar", pay: "Por pagar", bank: "Saldo en bancos", flow: "Flujo del mes" }, aging: "Antigüedad de saldos · por cobrar", h: { customer: "Cliente", aging: "Antigüedad", amount: "Monto" } },
    soon: { rh: "Empleados, asistencias y cálculo de nómina", reportes: "Tableros y reportes configurables", title: "Módulo en preparación", body: "Este módulo todavía no tiene endpoints en el backend. En cuanto lo agreguemos, se conecta igual que Inventario." },
    cfg: { sub: "Datos de la empresa, marca del cliente y usuarios", identity: "Identidad de la empresa", changeLogo: "Cambiar logo del cliente", note1: "Cada empresa cliente trae su propio logo y datos fiscales. La marca ", note2: " aparece solo en el login y en el pie del menú, de forma discreta.", users: "Usuarios y permisos" },
    status: { Pagado: "Pagado", Pendiente: "Pendiente", Parcial: "Parcial", Agotado: "Agotado", Mayoreo: "Mayoreo", Frecuente: "Frecuente", "Crédito": "Crédito" },
    aging: { "30+ días": "30+ días", "0-15 días": "0-15 días", "15-30 días": "15-30 días" },
    roles: { Administrador: "Administrador", Inventario: "Inventario", Ventas: "Ventas" },
  },
  en: {
    monShort: MON_EN,
    cal: { months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], dows: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] },
    nav: { dashboard: "Dashboard", ventas: "Sales / CRM", clientes: "Customers", inventario: "Inventory", finanzas: "Finance", contabilidad: "Accounting", rh: "HR / Payroll", reportes: "Reports / BI", config: "Settings" },
    modules: "MODULES", search: "Nexus — search the whole system…", role: "Administrator",
    api: "API", soonTag: "soon",
    secure: "Secure System",
    login: { user: "User", pass: "Password", enter: "Sign in", demo: "Demo · any credentials work", platform: "Sthenova platform · each client company's logo is configured separately" },
    presets: { week: "Week", month: "Month", quarter: "Quarter", year: "Year" },
    dash: {
      to: "to", custom: "Custom", marginLabel: "MARGIN", target: "target",
      focos: { agotados: "out of stock", cartera: "overdue", margen: "low stock" },
      vsPrev: "vs prev.", chartTitle: "Period sales", chartUnit: "(thousands MXN)",
      legendCur: "Current", legendPrev: "Previous period",
      metaTitle: "Goal vs actual", metaSub: "of the period goal", real: "Actual", meta: "Goal",
      remaining: (a) => `${a} left to reach the goal.`, skus: (n) => `${n} SKUs`,
      noGoal: "No goal configured for this period. Create an income budget in Finance to enable it.",
      loading: "Loading dashboard data…", loadError: "Could not load dashboard data.",
      ofTarget: "of target", current: "Current period", previous: "Previous period",
      variation: "vs previous period", growth: "Growth", drop: "Drop",
      goalProgress: "Progress to goal", trend: "Period trend",
      seeAnalysis: "See full analysis",
    },
    kpi: { "Ventas": "Sales", "Utilidad neta": "Net profit", "Pedidos": "Orders", "Ticket promedio": "Avg. ticket" },
    inv: { sub: "Product catalog, variants and stock by warehouse", add: "Add product", search: "Search by name or category", filters: "Filters", h: { product: "Product", cat: "Category", variants: "Variants", stock: "Stock", price: "Price" }, variant: "variant", variants: "variants", edit: "Edit", none: "No results. Adjust the search or add a product." },
    sales: { sub: "Orders, quotes and sales tracking", add: "New order", h: { ref: "Ref.", customer: "Customer", date: "Date", total: "Total", status: "Status" } },
    cust: { sub: "Accounts, balances and segmentation", add: "New customer", h: { customer: "Customer", tax: "Tax ID", balance: "Balance", orders: "Orders", tag: "Tag" } },
    fin: { sub: "Receivables, payables and banks", cards: { recv: "Receivable", pay: "Payable", bank: "Bank balance", flow: "Monthly cash flow" }, aging: "Aging · receivables", h: { customer: "Customer", aging: "Aging", amount: "Amount" } },
    soon: { rh: "Employees, attendance and payroll", reportes: "Configurable dashboards and reports", title: "Module in progress", body: "This module has no backend endpoints yet. Once we add them, it connects just like Inventory." },
    cfg: { sub: "Company data, client branding and users", identity: "Company identity", changeLogo: "Change client logo", note1: "Each client company has its own logo and tax data. The ", note2: " brand appears only on the login and in the menu footer, discreetly.", users: "Users and permissions" },
    status: { Pagado: "Paid", Pendiente: "Pending", Parcial: "Partial", Agotado: "Out", Mayoreo: "Wholesale", Frecuente: "Frequent", "Crédito": "Credit" },
    aging: { "30+ días": "30+ days", "0-15 días": "0-15 days", "15-30 días": "15-30 days" },
    roles: { Administrador: "Administrator", Inventario: "Inventory", Ventas: "Sales" },
  },
};

/* ============================ Logo ============================ */
function NovaMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" aria-label="Sthenova">
      <defs>
        <linearGradient id="gRight" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34538F" /><stop offset="1" stopColor="#1D2D60" /></linearGradient>
        <linearGradient id="gNova" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8CEEFF" /><stop offset="1" stopColor="#33B2F5" /></linearGradient>
        <radialGradient id="gGlow"><stop offset="0" stopColor="#49CEF8" stopOpacity="0.5" /><stop offset="1" stopColor="#49CEF8" stopOpacity="0" /></radialGradient>
      </defs>
      <g transform="translate(70,72)">
        <polygon points="0,-62 62,46 0,24 -62,46" fill="#0E1838" />
        <polygon points="0,-62 0,-14 -30,-6" fill="#1A2856" />
        <polygon points="0,-62 30,-6 0,-14" fill="url(#gRight)" />
        <polygon points="-30,-6 0,-14 0,24 -62,46" fill="#131F44" />
        <polygon points="30,-6 62,46 0,24 0,-14" fill="#24386E" />
        <polyline points="0,-62 30,-6 62,46" fill="none" stroke="#5871BE" strokeWidth="1.2" strokeLinejoin="round" />
        <polygon points="0,-62 62,46 0,24 -62,46" fill="none" stroke="#3F578D" strokeWidth="1" strokeLinejoin="round" />
        <circle cx="0" cy="-10" r="22" fill="url(#gGlow)" className="nova-glow" />
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2,-30 C16,-28 18,-15 9,-10" stroke="#46C9F6" strokeWidth="2" />
          <path d="M-2,-30 C-16,-28 -18,-15 -9,-10" stroke="#46C9F6" strokeWidth="2" />
          <path d="M0,-11 L-8,3" stroke="#45C8F5" strokeWidth="1.4" /><path d="M0,-11 L8,3" stroke="#45C8F5" strokeWidth="1.4" />
          <path d="M0,-11 L0,7" stroke="#45C8F5" strokeWidth="1.4" /><path d="M0,-11 L-16,-11" stroke="#45C8F5" strokeWidth="1.4" /><path d="M0,-11 L16,-11" stroke="#45C8F5" strokeWidth="1.4" />
        </g>
        <g fill="#86ECFF"><circle cx="-8" cy="3" r="2" /><circle cx="8" cy="3" r="2" /><circle cx="0" cy="7" r="2" /><circle cx="-16" cy="-11" r="2" /><circle cx="16" cy="-11" r="2" /></g>
        <circle cx="0" cy="-11" r="5" fill="url(#gNova)" stroke="#0A1022" strokeWidth="0.5" />
        <circle cx="0" cy="-11" r="1.6" fill="#E6FBFF" />
      </g>
    </svg>
  );
}

/* ============================ Data ============================ */
const TODAY = new Date();
const fmtDate = (d, s) => `${d.getDate()} ${s.monShort[d.getMonth()]} ${d.getFullYear()}`;
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const PRESET_IDS = ["week", "month", "quarter", "year"];

/* ── Tablero: helpers de rango de fechas y carga de datos reales del backend ── */
function addPeriodDash(d, period, mult) {
  const r = new Date(d);
  if (period === "week") r.setDate(r.getDate() + 7 * mult);
  else if (period === "month") r.setMonth(r.getMonth() + 1 * mult);
  else if (period === "quarter") r.setMonth(r.getMonth() + 3 * mult);
  else r.setFullYear(r.getFullYear() + 1 * mult);
  return r;
}
function computeDashRanges(preset, customStart, customEnd) {
  if (preset === "custom" && customStart && customEnd) {
    const curStart = customStart, curEnd = customEnd;
    const spanMs = curEnd.getTime() - curStart.getTime();
    const prevEnd = new Date(curStart.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - spanMs);
    return { curStart, curEnd, prevStart, prevEnd };
  }
  const curEnd = TODAY;
  const curStart = addPeriodDash(curEnd, preset, -1);
  const prevEnd = curStart;
  const prevStart = addPeriodDash(prevEnd, preset, -1);
  return { curStart, curEnd, prevStart, prevEnd };
}
function dashTrendParams(preset) {
  if (preset === "week" || preset === "custom") return { granularity: "day", days: 7 };
  if (preset === "month") return { granularity: "day", days: 30 };
  if (preset === "quarter") return { granularity: "week", days: 13 };
  return { granularity: "month", days: 12 };
}
function monthsInRange(start, end) {
  const months = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (d <= last) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}
const pctDelta = (cur, prev) => (prev === 0 ? 0 : Math.round(((cur - prev) / prev) * 1000) / 10);

async function loadDashboardData(preset, customStart, customEnd) {
  const { curStart, curEnd, prevStart, prevEnd } = computeDashRanges(preset, customStart, customEnd);
  const curStartISO = curStart.toISOString(), curEndISO = curEnd.toISOString();
  const prevStartISO = prevStart.toISOString(), prevEndISO = prevEnd.toISOString();
  const { granularity, days } = dashTrendParams(preset);

  const [statsCur, statsPrev, trendCur, trendPrev, finComparison, invStats, finDashboard, budgets] = await Promise.all([
    salesApi.stats(curStartISO, curEndISO),
    salesApi.stats(prevStartISO, prevEndISO),
    salesApi.trend(granularity, days, curEndISO),
    salesApi.trend(granularity, days, curStartISO),
    financeService.getPeriodComparison(curStartISO, curEndISO),
    inventoryService.getStats(),
    financeService.getDashboard(),
    financeService.getBudgets(),
  ]);

  const n = Math.max(trendCur.length, trendPrev.length);
  const seriesCur = Array.from({ length: n }, (_, i) => trendCur[i]?.total ?? 0);
  const seriesPrev = Array.from({ length: n }, (_, i) => trendPrev[i]?.total ?? 0);
  const xlabels = Array.from({ length: n }, (_, i) => (trendCur[i]?.period ?? trendPrev[i]?.period ?? "").slice(5));

  const months = monthsInRange(curStart, curEnd);
  const goalTarget = budgets.filter((b) => b.type === "income" && months.includes(b.period)).reduce((a, b) => a + b.amount, 0);

  const kpis = [
    { label: "Ventas", value: statsCur.total_sold, money: true, delta: pctDelta(statsCur.total_sold, statsPrev.total_sold), spark: trendCur.map((p) => p.total) },
    { label: "Utilidad neta", value: finComparison.current.net_profit, money: true, delta: pctDelta(finComparison.current.net_profit, finComparison.previous.net_profit), spark: [] },
    { label: "Pedidos", value: statsCur.orders_count, money: false, delta: pctDelta(statsCur.orders_count, statsPrev.orders_count), spark: trendCur.map((p) => p.count) },
    { label: "Ticket promedio", value: statsCur.avg_ticket, money: true, delta: pctDelta(statsCur.avg_ticket, statsPrev.avg_ticket), spark: trendCur.map((p) => (p.count ? p.total / p.count : 0)) },
  ];

  const totalIncome = finComparison.current.total_income || 0;
  const margin = totalIncome ? Math.round((finComparison.current.net_profit / totalIncome) * 100) : 0;

  return {
    range: [curStart, curEnd],
    kpis,
    margin, marginTarget: 35,
    goal: { actual: statsCur.total_sold, target: goalTarget, configured: goalTarget > 0 },
    attention: { agotados: invStats.out_of_stock, cartera: finDashboard.cxc_balance ?? 0, stockBajo: invStats.low_stock },
    series: { cur: seriesCur, prev: seriesPrev },
    xlabels,
  };
}

const PRODUCTS = [
  { id: 1, name: "Cemento gris CPC 30R", cat: "Construcción", variants: 2, stock: 480, price: 215 },
  { id: 2, name: "Varilla corrugada 3/8\"", cat: "Acero", variants: 1, stock: 1320, price: 178 },
  { id: 3, name: "Pintura vinílica blanca 19L", cat: "Pinturas", variants: 4, stock: 96, price: 1290 },
  { id: 4, name: "Tubo PVC hidráulico 4\"", cat: "Plomería", variants: 3, stock: 12, price: 340 },
  { id: 5, name: "Block hueco 15x20x40", cat: "Construcción", variants: 1, stock: 0, price: 18 },
  { id: 6, name: "Cable THW cal. 12", cat: "Eléctrico", variants: 5, stock: 220, price: 28 },
  { id: 7, name: "Impermeabilizante 5 años 19L", cat: "Pinturas", variants: 2, stock: 64, price: 1490 },
];
const ORDERS = [
  { id: "VTA-2041", cliente: "Constructora Robles", fecha: "11 jun 2026", total: 84200, estado: "Pagado" },
  { id: "VTA-2040", cliente: "Ferretería La Esquina", fecha: "11 jun 2026", total: 12650, estado: "Pendiente" },
  { id: "VTA-2039", cliente: "Mantenimiento Industrial GZ", fecha: "10 jun 2026", total: 196400, estado: "Parcial" },
  { id: "VTA-2038", cliente: "Público en general", fecha: "10 jun 2026", total: 3480, estado: "Pagado" },
  { id: "VTA-2037", cliente: "Obras del Bajío SA", fecha: "09 jun 2026", total: 57300, estado: "Pendiente" },
];
const CUSTOMERS = [
  { name: "Constructora Robles", rfc: "CRO180921AB2", saldo: 84200, pedidos: 38, tag: "Mayoreo" },
  { name: "Ferretería La Esquina", rfc: "FLE150303KK9", saldo: 0, pedidos: 122, tag: "Frecuente" },
  { name: "Mantenimiento Industrial GZ", rfc: "MIG200710Q1A", saldo: 196400, pedidos: 14, tag: "Crédito" },
  { name: "Obras del Bajío SA", rfc: "OBA190511XY0", saldo: 57300, pedidos: 9, tag: "Crédito" },
];
const MODULES = [
  { id: "dashboard", icon: LayoutDashboard }, { id: "ventas", icon: ShoppingCart },
  { id: "clientes", icon: Users }, { id: "inventario", icon: Package, live: true },
  { id: "finanzas", icon: Wallet }, { id: "contabilidad", icon: BookText, live: true },
  { id: "rh", icon: IdCard },
  { id: "reportes", icon: BarChart3 }, { id: "config", icon: Settings },
];

const mxn = (n) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mxnShort = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n;
const statusColor = (t, d) => (d >= 3 ? t.good : d >= 0 ? t.warn : t.bad);
const pillColor = (t) => ({ Pagado: t.good, Pendiente: t.warn, Parcial: t.nova, Agotado: t.bad, Mayoreo: t.nova, Frecuente: t.good, "Crédito": t.warn });

/* ============================ Atoms ============================ */
function Card({ t, children, style, className, onClick }) {
  const isDark = t.name === "dark";
  const glass = isDark
    ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
    : { background: t.panel, border: `1px solid ${t.border}` };
  return <div className={className} onClick={onClick} style={{ ...glass, borderRadius: 14, ...style }}>{children}</div>;
}
function Pill({ t, s, k }) {
  const c = pillColor(t)[k] || t.textLo;
  return <span style={{ fontSize: 11.5, fontWeight: 600, color: c, padding: "3px 9px", borderRadius: 999, background: c + "1c", border: `1px solid ${c}30`, whiteSpace: "nowrap" }}>{s.status[k] || k}</span>;
}
function PageHead({ t, title, sub, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
      <div><h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>{title}</h1>{sub && <p style={{ margin: "6px 0 0", color: t.textLo, fontSize: 13.5 }}>{sub}</p>}</div>
      {action}
    </div>
  );
}
function PrimaryBtn({ t, children, onClick }) {
  return <button onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "10px 16px", borderRadius: 10, boxShadow: `0 6px 18px ${t.nova}2e` }}>{children}</button>;
}

/* ============================ Charts ============================ */
/* Sparkline con tooltip al pasar el cursor */
function Sparkline({ data, color, gid }) {
  const [hover, setHover] = useState(null);
  const W = 84, H = 26, min = Math.min(...data), max = Math.max(...data);
  const x = (i) => (i * W) / (data.length - 1);
  const y = (v) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 7));
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${H} L 0 ${H} Z`;
  const near = (px) => { let b = 0, bd = 1e9; for (let i = 0; i < data.length; i++) { const d = Math.abs(px - x(i)); if (d < bd) { bd = d; b = i; } } return b; };
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ cursor: "crosshair", overflow: "visible" }}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(near((e.clientX - r.left) / r.width * W)); }}
        onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.26" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.1" fill={color} fillOpacity="0.9" />
        {hover !== null && <circle cx={x(hover)} cy={y(data[hover])} r="3" fill={color} stroke="#fff" strokeWidth="1" />}
      </svg>
      {hover !== null && (
        <div style={{ position: "absolute", top: -22, left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)", background: "#131F44", border: `1px solid ${color}`, borderRadius: 6, padding: "2px 7px", fontSize: 10.5, fontWeight: 700, color: "#F2F6FF", whiteSpace: "nowrap", pointerEvents: "none", zIndex: 5 }}>
          {data[hover]}
        </div>
      )}
    </div>
  );
}
function Gauge({ t, value, target, max = 60 }) {
  const cx = 100, cy = 90, r = 66, sw = 11;
  const arc = (f0, f1) => { const a = (f) => Math.PI - f * Math.PI; const p = (f) => [cx + r * Math.cos(a(f)), cy - r * Math.sin(a(f))]; const [x0, y0] = p(f0), [x1, y1] = p(f1); return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const f = Math.max(0, Math.min(1, value / max));
  const tf = Math.max(0, Math.min(1, target / max));
  const needA = Math.PI - f * Math.PI;
  const nx = cx + (r - 6) * Math.cos(needA), ny = cy - (r - 6) * Math.sin(needA);
  const tA = Math.PI - tf * Math.PI;
  const valColor = value < 25 ? t.bad : value < 35 ? t.warn : t.good;
  return (
    <svg viewBox="0 0 200 104" style={{ width: 150, height: 78 }}>
      <path d={arc(0, 25 / max)} fill="none" stroke={t.bad} strokeWidth={sw} opacity="0.45" strokeLinecap="round" />
      <path d={arc(25 / max, 35 / max)} fill="none" stroke={t.warn} strokeWidth={sw} opacity="0.45" />
      <path d={arc(35 / max, 1)} fill="none" stroke={t.good} strokeWidth={sw} opacity="0.45" strokeLinecap="round" />
      <line x1={cx + (r - sw) * Math.cos(tA)} y1={cy - (r - sw) * Math.sin(tA)} x2={cx + (r + 4) * Math.cos(tA)} y2={cy - (r + 4) * Math.sin(tA)} stroke={t.textHi} strokeWidth="2" strokeOpacity="0.5" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={valColor} strokeWidth="3" strokeLinecap="round" strokeOpacity="0.65" />
      <circle cx={cx} cy={cy} r="5" fill={t.panel} stroke={valColor} strokeWidth="2.4" strokeOpacity="0.7" />
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="25" fontWeight="700" fill={valColor}>{value}%</text>
    </svg>
  );
}
/* ComparisonChart con tooltip interactivo (línea guía, puntos, valores y %) */
function ComparisonChart({ t, series, xlabels }) {
  const [hover, setHover] = useState(null);
  const W = 660, H = 250, P = { l: 8, r: 8, t: 16, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b, n = series.cur.length;
  const max = Math.max(...series.cur, ...series.prev) * 1.14;
  const x = (i) => P.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => P.t + (1 - v / max) * ih;
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const cur = path(series.cur);
  const area = `${cur} L ${x(n - 1).toFixed(1)} ${(P.t + ih).toFixed(1)} L ${x(0).toFixed(1)} ${(P.t + ih).toFixed(1)} Z`;
  const grid = [0, 0.33, 0.66, 1].map((g) => P.t + g * ih);
  const near = (px) => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const d = Math.abs(px - x(i)); if (d < bd) { bd = d; b = i; } } return b; };
  const hv = hover !== null ? { i: hover, cur: series.cur[hover], prev: series.prev[hover], label: xlabels[hover], delta: series.prev[hover] === 0 ? 0 : Math.round((series.cur[hover] - series.prev[hover]) / series.prev[hover] * 1000) / 10 } : null;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 250, cursor: "crosshair" }} preserveAspectRatio="none"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(near((e.clientX - r.left) / r.width * W)); }}
        onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="cmpFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={t.nova} stopOpacity="0.3" /><stop offset="100%" stopColor={t.nova} stopOpacity="0" /></linearGradient></defs>
        {grid.map((g, i) => <line key={i} x1={P.l} x2={W - P.r} y1={g} y2={g} stroke={t.gridLine} strokeWidth="1" />)}
        <path d={path(series.prev)} fill="none" stroke={t.textLo} strokeWidth="2" strokeDasharray="5 5" opacity="0.75" />
        <path d={area} fill="url(#cmpFill)" />
        <path d={cur} fill="none" stroke={t.nova} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {hv && <line x1={x(hv.i)} x2={x(hv.i)} y1={P.t} y2={P.t + ih} stroke={t.nova} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />}
        {series.cur.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill={t.panel} stroke={t.nova} strokeWidth="2" />)}
        {hv && <circle cx={x(hv.i)} cy={y(hv.prev)} r="4" fill={t.panel} stroke={t.textLo} strokeWidth="2" />}
        {hv && <circle cx={x(hv.i)} cy={y(hv.cur)} r="5" fill={t.panel} stroke={t.nova} strokeWidth="2.5" />}
        {xlabels.map((lb, i) => <text key={i} x={x(i)} y={H - 9} fill={t.textLo} fontSize="12" textAnchor="middle">{lb}</text>)}
      </svg>
      {hv && (
        <div style={{ position: "absolute", top: 8, left: `${(x(hv.i) / W) * 100 > 60 ? (x(hv.i) / W) * 100 - 2 : (x(hv.i) / W) * 100 + 3}%`, transform: (x(hv.i) / W) * 100 > 60 ? "translateX(-100%)" : "none", background: t.panel2, border: `1px solid ${t.nova}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.45)", minWidth: 140, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{hv.label}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 3 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 9, background: t.nova }} />Actual</span>
            <span style={{ color: t.textHi, fontWeight: 600 }}>${hv.cur}k</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 6 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 9, background: t.textLo }} />Anterior</span>
            <span style={{ color: t.textMid }}>${hv.prev}k</span>
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 5, color: hv.delta >= 0 ? t.good : t.bad, fontWeight: 600 }}>
            {hv.delta >= 0 ? "▲ +" : "▼ "}{hv.delta}% vs anterior
          </div>
        </div>
      )}
    </div>
  );
}
function MiniCalendar({ t, s, start, end, onPick }) {
  const [view, setView] = useState(new Date((start || TODAY).getFullYear(), (start || TODAY).getMonth(), 1));
  const firstDow = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 6) % 7;
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  const inRange = (d) => d && start && end && d >= start && d <= end;
  const isEdge = (d) => sameDay(d, start) || sameDay(d, end);
  const move = (n) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  return (
    <div style={{ position: "absolute", top: 44, right: 0, width: 264, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 12, boxShadow: "0 18px 44px rgba(0,0,0,0.4)", zIndex: 60 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => move(-1)} style={calNav(t)}><ChevronLeft size={16} /></button>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.textHi, textTransform: "capitalize" }}>{s.cal.months[view.getMonth()]} {view.getFullYear()}</span>
        <button onClick={() => move(1)} style={calNav(t)}><ChevronRight size={16} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {s.cal.dows.map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 10.5, color: t.textLo, fontWeight: 600, padding: "2px 0" }}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const edge = isEdge(d), range = inRange(d), today = sameDay(d, TODAY);
          return <button key={i} onClick={() => onPick(d)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, padding: "7px 0", borderRadius: 7, background: edge ? t.nova : range ? t.nova + "22" : "transparent", color: edge ? "#fff" : t.textMid, fontWeight: edge || today ? 700 : 500, outline: today && !edge ? `1px solid ${t.nova}66` : "none" }}>{d.getDate()}</button>;
        })}
      </div>
    </div>
  );
}
const calNav = (t) => ({ width: 28, height: 28, borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", display: "grid", placeItems: "center" });

/* ============================ Dashboard ============================ */
function Dashboard({ t, s, lang, setPage, isMobile }) {
  void lang;
  const [preset, setPreset] = useState("month");
  const [calOpen, setCalOpen] = useState(false);
  const [rStart, setRStart] = useState(null);
  const [rEnd, setREnd] = useState(null);
  const [kpiDrill, setKpiDrill] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (preset === "custom" && (!rStart || !rEnd)) return;
    let active = true;
    setLoading(true);
    setError(null);
    loadDashboardData(preset, preset === "custom" ? rStart : undefined, preset === "custom" ? rEnd : undefined)
      .then((d) => { if (active) { setData(d); setLoading(false); } })
      .catch((e) => { if (active) { setError(e?.message || "Error"); setLoading(false); } });
    return () => { active = false; };
  }, [preset, rStart, rEnd]);

  const choose = (id) => {
    setPreset(id);
    const { curStart, curEnd } = computeDashRanges(id);
    setRStart(curStart); setREnd(curEnd);
    setCalOpen(false);
  };
  const pick = (d) => {
    if (!rStart || (rStart && rEnd)) { setRStart(d); setREnd(null); setPreset("custom"); }
    else if (d >= rStart) { setREnd(d); setPreset("custom"); setCalOpen(false); }
    else { setRStart(d); setREnd(null); }
  };

  if (loading || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 320, gap: 10 }}>
        <div style={{ fontSize: 14, color: t.textLo }}>{error ? `${s.dash.loadError} (${error})` : s.dash.loading}</div>
      </div>
    );
  }

  const r0 = data.range[0];
  const r1 = data.range[1];
  const xlabels = data.xlabels;

  const goalPct = data.goal.configured ? Math.round((data.goal.actual / data.goal.target) * 100) : 0;

  const kpiTargets = {
    "Ventas": data.goal.configured ? data.goal.target : undefined,
  };

  const chips = [
    { icon: PackageX, value: String(data.attention.agotados), label: s.dash.focos.agotados, color: t.bad, go: "inventario" },
    { icon: FileWarning, value: mxnShort(data.attention.cartera), label: s.dash.focos.cartera, color: t.warn, go: "finanzas" },
    { icon: AlertTriangle, value: `${data.attention.stockBajo}`, label: s.dash.focos.margen, color: t.warn, go: "inventario" },
  ];

  const kpiIcons = { "Ventas": TrendingUp, "Utilidad neta": DollarSign, "Pedidos": ShoppingCart, "Ticket promedio": Star };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>{s.nav.dashboard}</h1>
          <p style={{ margin: "5px 0 0", color: t.textLo, fontSize: 13 }}>{fmtDate(r0, s)} <span style={{ opacity: 0.55 }}>{s.dash.to}</span> {fmtDate(r1, s)}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chips.map((c) => {
            const Icon = c.icon;
            return (
              <button key={c.label} className="clickrow" onClick={() => setPage(c.go)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: "7px 12px" }}>
                <Icon size={15} color={c.color} />
                <span style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{c.value}</span>
                <span style={{ fontSize: 11.5, color: t.textLo }}>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap", marginBottom: 16 }}>
        <Card t={t} style={{ flex: "1 1 380px", padding: "8px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 9, padding: 3 }}>
            {PRESET_IDS.map((id) => {
              const on = preset === id;
              return <button key={id} onClick={() => choose(id)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 7, background: on ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : "transparent", color: on ? "#fff" : t.textMid }}>{s.presets[id]}</button>;
            })}
          </div>
          <div style={{ position: "relative" }}>
            <button onClick={() => setCalOpen(!calOpen)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", background: preset === "custom" ? t.nova + "1a" : t.inputBg, border: `1px solid ${preset === "custom" ? t.nova + "55" : t.border}`, borderRadius: 9, padding: "7px 12px", color: t.textHi, fontSize: 12.5, fontWeight: 500 }}>
              <CalIcon size={14} color={preset === "custom" ? t.nova : t.textLo} />
              {preset === "custom" ? `${fmtDate(r0, s)} – ${fmtDate(r1, s)}` : s.dash.custom}
              <ChevronDown size={13} color={t.textLo} />
            </button>
            {calOpen && <MiniCalendar t={t} s={s} start={rStart} end={rEnd} onPick={pick} />}
          </div>
        </Card>
        <Card t={t} style={{ flex: "0 0 auto", padding: "8px 20px", display: "flex", alignItems: "center", gap: 14, minWidth: 220 }}>
          <Gauge t={t} value={data.margin} target={data.marginTarget} />
          <div>
            <div style={{ fontSize: 10.5, color: t.textLo, fontWeight: 600, letterSpacing: 0.6 }}>{s.dash.marginLabel}</div>
            <div style={{ fontSize: 12, color: t.textMid, marginTop: 3 }}>{s.dash.target} {data.marginTarget}%</div>
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14, marginBottom: 16 }}>
        {data.kpis.map((k, i) => {
          const up = k.delta >= 0; const c = statusColor(t, k.delta);
          const target = kpiTargets[k.label];
          const pct = target ? Math.min(100, Math.round((k.value / target) * 100)) : null;
          const Icon = kpiIcons[k.label];
          return (
            <Card key={k.label} t={t} className="clickrow" onClick={() => setKpiDrill(i)} style={{ padding: 18, position: "relative", overflow: "hidden", cursor: "pointer" }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c + "66" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {Icon && <Icon size={14} color={t.textLo} />}
                  <span style={{ fontSize: 12.5, color: t.textLo, fontWeight: 500 }}>{s.kpi[k.label]}</span>
                </span>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c + "cc", boxShadow: `0 0 0 3px ${c}1f` }} />
              </div>
              <div style={{ fontSize: 23, fontWeight: 700, color: t.textHi, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{k.money ? mxn(k.value) : k.value.toLocaleString("es-MX")}</div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 8 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {up ? <ArrowUpRight size={14} color={t.good} /> : <ArrowDownRight size={14} color={t.bad} />}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: up ? t.good : t.bad }}>{Math.abs(k.delta)}%</span>
                  <span style={{ fontSize: 11, color: t.textLo }}>{s.dash.vsPrev}</span>
                </span>
                {k.spark && k.spark.length > 1 && <Sparkline data={k.spark} color={c} gid={`spk${i}`} />}
              </div>
              {target && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ height: 4, background: t.panel3, borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: pct >= 90 ? t.good : pct >= 65 ? t.nova : t.warn }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4 }}>{pct}% {s.dash.ofTarget} · {k.money ? mxnShort(target) : target.toLocaleString("es-MX")}</div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 2fr) minmax(0, 1fr)", gap: 14 }}>
        <Card t={t} style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi }}>{s.dash.chartTitle} <span style={{ color: t.textLo, fontWeight: 400 }}>{s.dash.chartUnit}</span></div>
            <div style={{ display: "flex", gap: 16 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 14, height: 3, borderRadius: 2, background: t.nova }} /> {s.dash.legendCur}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${t.textLo}` }} /> {s.dash.legendPrev}</span>
            </div>
          </div>
          {xlabels.length > 0 ? <ComparisonChart t={t} series={data.series} xlabels={xlabels} /> : <div style={{ fontSize: 13, color: t.textLo, padding: "40px 0", textAlign: "center" }}>{s.dash.loadError}</div>}
        </Card>
        <Card t={t} style={{ padding: 20, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}><Target size={17} color={t.nova} /><span style={{ fontSize: 14, fontWeight: 600, color: t.textHi }}>{s.dash.metaTitle}</span></div>
          {data.goal.configured ? (
            <>
              <div style={{ fontSize: 30, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{goalPct}%</div>
              <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>{s.dash.metaSub}</div>
              <div style={{ height: 12, background: t.panel3, borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${Math.min(100, goalPct)}%`, height: "100%", borderRadius: 999, background: goalPct >= 90 ? t.good : goalPct >= 65 ? t.nova : t.warn }} /></div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5 }}>
                <span style={{ color: t.textLo }}>{s.dash.real} <b style={{ color: t.textHi }}>{mxnShort(data.goal.actual)}</b></span>
                <span style={{ color: t.textLo }}>{s.dash.meta} <b style={{ color: t.textHi }}>{mxnShort(data.goal.target)}</b></span>
              </div>
              <div style={{ marginTop: "auto", paddingTop: 16, fontSize: 12.5, color: t.textMid, borderTop: `1px solid ${t.borderSoft}` }}>{s.dash.remaining(mxn(Math.max(0, data.goal.target - data.goal.actual)))}</div>
            </>
          ) : (
            <div style={{ marginTop: 6, fontSize: 13, color: t.textLo, lineHeight: 1.5 }}>{s.dash.noGoal}</div>
          )}
        </Card>
      </div>

      {/* ── DRAWER: Detalle de KPI (drill-down) ── */}
      {kpiDrill !== null && (() => {
        const k = data.kpis[kpiDrill];
        const up = k.delta >= 0;
        const c = statusColor(t, k.delta);
        const target = kpiTargets[k.label];
        const pct = target ? Math.round((k.value / target) * 100) : null;
        const prevVal = Math.round(k.value / (1 + k.delta / 100));
        const Icon = kpiIcons[k.label];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={() => setKpiDrill(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", height: "100vh", background: t.panel, borderLeft: `1px solid ${t.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: 24, borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ background: c + "22", color: c, borderRadius: 10, padding: 10, display: "flex" }}>{Icon && <Icon size={20} />}</div>
                  <div>
                    <div style={{ fontSize: 12, color: t.textLo }}>{s.kpi[k.label]}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{k.money ? mxn(k.value) : k.value.toLocaleString("es-MX")}</div>
                  </div>
                </div>
                <button onClick={() => setKpiDrill(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
              </div>

              <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: t.panel2, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>{s.dash.current}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>{k.money ? mxn(k.value) : k.value.toLocaleString("es-MX")}</div>
                  </div>
                  <div style={{ background: t.panel2, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>{s.dash.previous}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: t.textMid }}>{k.money ? mxn(prevVal) : prevVal.toLocaleString("es-MX")}</div>
                  </div>
                </div>

                <div style={{ background: (up ? t.good : t.bad) + "12", border: `1px solid ${(up ? t.good : t.bad)}33`, borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {up ? <ArrowUpRight size={22} color={t.good} /> : <ArrowDownRight size={22} color={t.bad} />}
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: up ? t.good : t.bad }}>{up ? "+" : ""}{k.delta}%</div>
                    <div style={{ fontSize: 12, color: t.textMid }}>{up ? s.dash.growth : s.dash.drop} {s.dash.variation}</div>
                  </div>
                </div>

                {target && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, color: t.textMid }}>{s.dash.goalProgress}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: t.textHi }}>{pct}%</span>
                    </div>
                    <div style={{ height: 10, background: t.panel3, borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 999, background: pct >= 90 ? t.good : pct >= 65 ? t.nova : t.warn }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11.5, color: t.textLo }}>
                      <span>{s.dash.real} {k.money ? mxn(k.value) : k.value.toLocaleString("es-MX")}</span>
                      <span>{s.dash.meta} {k.money ? mxn(target) : target.toLocaleString("es-MX")}</span>
                    </div>
                  </div>
                )}

                {xlabels.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMid, marginBottom: 10 }}>{s.dash.trend}</div>
                    <Card t={t} style={{ padding: 14, background: t.panel2 }}>
                      <ComparisonChart t={t} series={data.series} xlabels={xlabels} />
                    </Card>
                  </div>
                )}

                <button onClick={() => { setKpiDrill(null); setPage(k.label === "Pedidos" || k.label === "Ticket promedio" ? "ventas" : "reportes"); }} style={{ marginTop: 4, padding: "11px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {s.dash.seeAnalysis} <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ============================ Login ============================ */
function Login({ t, s, lang, onEnter }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loginToken, setLoginToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const handleLogin = async () => {
    if (!u || !p) {
      setError(lang === "en" ? "Enter your email and password." : "Ingresa tu correo y contraseña.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const body = new URLSearchParams();
      body.append("username", u);
      body.append("password", p);

      const res = await api.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      if (res.data?.requires_2fa) {
        setLoginToken(res.data.login_token);
        return;
      }

      const token = res.data?.access_token;
      if (!token) throw new Error("no token");

      localStorage.setItem("token", token);
      onEnter();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        setError(lang === "en" ? "Incorrect email or password." : "Correo o contraseña incorrectos.");
      } else if (status === 422) {
        setError(lang === "en" ? "Please complete both fields." : "Completa ambos campos.");
      } else {
        setError(lang === "en"
          ? "Could not connect. The server may be starting up — try again in a moment."
          : "No se pudo conectar. El servidor puede estar iniciando — intenta de nuevo en un momento.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify2fa = async () => {
    if (!code) return;
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login/2fa", { login_token: loginToken, code });
      const token = res.data?.access_token;
      if (!token) throw new Error("no token");
      localStorage.setItem("token", token);
      onEnter();
    } catch (err) {
      const status = err?.response?.status;
      setError(status === 401
        ? (lang === "en" ? "Incorrect verification code." : "Código de verificación incorrecto.")
        : (lang === "en" ? "Could not verify. Try again." : "No se pudo verificar. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  };

  if (loginToken) {
    const onKey2fa = (e) => { if (e.key === "Enter" && !loading) handleVerify2fa(); };
    return (
      <div style={{ minHeight: "100vh", background: t.base, display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 380, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><NovaMark size={86} /></div>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: t.textHi }}>STHENOVA®</div>
          <Card t={t} style={{ padding: 26, textAlign: "left", marginTop: 24 }}>
            <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600 }}>
              {lang === "en" ? "Verification code" : "Código de verificación"}
            </label>
            <div style={{ fontSize: 11.5, color: t.textLo, margin: "4px 0 10px" }}>
              {lang === "en" ? "Enter the 6-digit code from your authenticator app, or a backup code." : "Ingresa el código de 6 dígitos de tu app de autenticación, o un código de respaldo."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", margin: "6px 0 20px" }}>
              <Lock size={16} color={t.textLo} />
              <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onKey2fa} autoFocus placeholder="000000" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 14, letterSpacing: 2 }} />
            </div>
            {error && (
              <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={15} /> {error}
              </div>
            )}
            <button onClick={handleVerify2fa} disabled={loading} style={{ width: "100%", border: "none", cursor: loading ? "default" : "pointer", color: "#fff", fontSize: 15, fontWeight: 600, padding: "12px", borderRadius: 10, background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {loading ? <><RefreshCw size={16} className="spin" /> {lang === "en" ? "Verifying…" : "Verificando…"}</> : (lang === "en" ? "Verify" : "Verificar")}
            </button>
            <button onClick={() => { setLoginToken(null); setCode(""); setError(""); }} style={{ width: "100%", border: "none", background: "transparent", color: t.textLo, fontSize: 12.5, marginTop: 10, cursor: "pointer" }}>
              {lang === "en" ? "Back" : "Regresar"}
            </button>
          </Card>
        </div>
      </div>
    );
  }

  const onKey = (e) => { if (e.key === "Enter" && !loading) handleLogin(); };

  return (
    <div style={{ minHeight: "100vh", background: t.base, display: "grid", placeItems: "center", padding: 24, position: "relative", overflow: "hidden" }}>
      <svg viewBox="0 0 800 800" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }} preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs><radialGradient id="bgGlow" cx="50%" cy="38%" r="55%"><stop offset="0" stopColor="#16306a" /><stop offset="1" stopColor={t.base} /></radialGradient></defs>
        <rect width="800" height="800" fill="url(#bgGlow)" />
        <g stroke="#23396f" strokeWidth="1" fill="none" opacity="0.6" className="login-tri"><polygon points="400,40 688,760 400,616 112,760" /><polyline points="400,40 544,616 688,760" /></g>
      </svg>
      <div style={{ position: "relative", width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><NovaMark size={86} /></div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: t.textHi }}>STHENOVA®</div>
        <div style={{ fontSize: 10, letterSpacing: 6, color: t.textLo, marginBottom: 30 }}>COMPLETE SYSTEM</div>
        <Card t={t} style={{ padding: 26, textAlign: "left" }}>
          <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600 }}>{s.login.user}</label>
          <div className="login-input-glow" style={{ display: "flex", alignItems: "center", gap: 8, background: t.inputBg, border: `1px solid ${t.nova}55`, borderRadius: 10, padding: "10px 12px", margin: "6px 0 16px" }}>
            <UserIcon size={16} color={t.textLo} />
            <input value={u} onChange={(e) => setU(e.target.value)} onKeyDown={onKey} autoComplete="username" placeholder="correo@empresa.com" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 14 }} />
          </div>
          <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600 }}>{s.login.pass}</label>
          <div className="login-input-glow" style={{ display: "flex", alignItems: "center", gap: 8, background: t.inputBg, border: `1px solid ${t.nova}55`, borderRadius: 10, padding: "10px 12px", margin: "6px 0 20px" }}>
            <Lock size={16} color={t.textLo} />
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={onKey} autoComplete="current-password" placeholder="••••••••" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 14 }} />
          </div>

          {error && (
            <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          <button onClick={handleLogin} disabled={loading} style={{ width: "100%", border: "none", cursor: loading ? "default" : "pointer", color: "#fff", fontSize: 15, fontWeight: 600, padding: "12px", borderRadius: 10, background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, boxShadow: `0 8px 22px ${t.nova}40`, opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading
              ? <><RefreshCw size={16} className="spin" /> {lang === "en" ? "Signing in…" : "Entrando…"}</>
              : s.login.enter}
          </button>
        </Card>
        <p style={{ marginTop: 22, fontSize: 11, color: t.textLo }}>{s.login.platform}</p>
      </div>
    </div>
  );
}

/* ============================ Sidebar ============================ */
function Sidebar({ t, s, page, setPage, collapsed, setCollapsed, mobile, mobileOpen, setMobileOpen, allowedIds }) {
  const w = mobile ? 248 : (collapsed ? 72 : 248);
  const showLabels = mobile || !collapsed;
  const goTo = (id) => { setPage(id); if (mobile) setMobileOpen(false); };
  const modules = allowedIds ? MODULES.filter((m) => allowedIds.includes(m.id)) : MODULES;
  return (
    <>
      {mobile && mobileOpen && (
        <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99 }} />
      )}
      <aside style={{
        width: w, flex: mobile ? undefined : `0 0 ${w}px`, background: t.panel, borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", transition: mobile ? "transform .22s ease" : "width .18s ease",
        height: "100vh", position: mobile ? "fixed" : "sticky", top: 0, left: 0, zIndex: 100,
        transform: mobile ? (mobileOpen ? "translateX(0)" : "translateX(-100%)") : "none",
      }}>
        <div style={{ height: 64, display: "flex", alignItems: "center", gap: 8, padding: !showLabels ? "0 16px" : "0 18px", borderBottom: `1px solid ${t.border}` }}>
          <NovaMark size={30} />
          {showLabels && <span style={{ fontWeight: 700, letterSpacing: 2.5, color: t.textHi, fontSize: 15 }}>STHENOVA®</span>}
          {mobile && <button onClick={() => setMobileOpen(false)} style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>}
        </div>
        <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
          {showLabels && <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: t.textLo, fontWeight: 600, padding: "6px 10px 8px" }}>{s.modules}</div>}
          {modules.map((m) => {
            const active = page === m.id; const Icon = m.icon;
            return (
              <button key={m.id} onClick={() => goTo(m.id)} title={s.nav[m.id]} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: !showLabels ? "11px 0" : "10px 12px", justifyContent: !showLabels ? "center" : "flex-start", marginBottom: 3, borderRadius: 10, border: "none", textAlign: "left", background: active ? `linear-gradient(90deg, ${t.nova}24, transparent)` : "transparent", color: active ? t.textHi : t.textMid, position: "relative" }}>
                {active && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: t.nova }} />}
                <Icon size={18} color={active ? t.nova : t.textLo} />
                {showLabels && <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 500 }}>{s.nav[m.id]}</span>}
                {showLabels && m.live && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: t.good, background: t.good + "22", padding: "2px 6px", borderRadius: 6 }}>{s.api}</span>}
                {showLabels && m.soon && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: t.textLo, background: t.panel3, padding: "2px 6px", borderRadius: 6 }}>{s.soonTag}</span>}
              </button>
            );
          })}
        </nav>

        {showLabels && (
          <div style={{
            padding: "8px 18px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderTop: `1px solid ${t.borderSoft}`,
          }}>
            <span style={{
              fontSize: 13,
              color: "#34D399",
              animation: "securePulse 2.8s ease-in-out infinite",
              lineHeight: 1,
            }}>◍</span>
            <span style={{
              fontSize: 10,
              color: "#34D399",
              opacity: 0.5,
              fontWeight: 500,
              letterSpacing: 0.4,
            }}>{s.secure}</span>
          </div>
        )}

        <div style={{ borderTop: `1px solid ${t.border}`, padding: !showLabels ? 12 : "14px 16px", display: "flex", alignItems: "center", justifyContent: !showLabels ? "center" : "space-between" }}>
          {showLabels ? (<div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}><NovaMark size={20} /><div style={{ lineHeight: 1.1 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: t.textLo }}>STHENOVA®</div><div style={{ fontSize: 8, letterSpacing: 1, color: t.textLo }}>v0.1 · demo</div></div></div>) : <NovaMark size={20} />}
          {!mobile && showLabels && <button onClick={() => setCollapsed(true)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><ChevronLeft size={18} /></button>}
        </div>
        {!mobile && collapsed && <button onClick={() => setCollapsed(false)} style={{ position: "absolute", top: 76, right: -12, width: 24, height: 24, borderRadius: 999, background: t.panel2, border: `1px solid ${t.border}`, cursor: "pointer", color: t.textMid, display: "grid", placeItems: "center" }}><ChevronRight size={14} /></button>}
      </aside>
    </>
  );
}

/* ============================ Nexus: universal search ============================
   "Nexus" is this app's internal codename for the cross-module search bar — it
   queries every module (clientes, ventas, inventario, proveedores, compras, RH)
   through a single backend endpoint (GET /search) instead of fanning out N
   per-module requests from the client. */
const NEXUS_ICONS = {
  customers: UserCircle2, orders: ShoppingBag, products: Box,
  suppliers: Truck, purchase_orders: ClipboardList, employees: Users,
};

function GlobalSearch({ t, s, lang, onNavigate }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ customers: [], orders: [], products: [], suppliers: [], purchase_orders: [], employees: [] });
  const debounceRef = useRef(null);

  const EMPTY = { customers: [], orders: [], products: [], suppliers: [], purchase_orders: [], employees: [] };

  useEffect(() => {
    if (!query.trim()) {
      setResults(EMPTY);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/search/", { params: { q: query, limit: 5 } });
        setResults({ ...EMPTY, ...data });
        setOpen(true);
      } catch {
        setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const sections = ["customers", "orders", "products", "suppliers", "purchase_orders", "employees"];
  const hasResults = sections.some((k) => (results[k] || []).length > 0);
  const select = (page, q) => { onNavigate(page, q); setQuery(""); setOpen(false); };
  const noResultsLabel = lang === "es" ? "Sin resultados" : "No results";
  const sectionLabels = {
    customers: lang === "es" ? "Clientes" : "Customers",
    orders: lang === "es" ? "Pedidos" : "Orders",
    products: lang === "es" ? "Productos" : "Products",
    suppliers: lang === "es" ? "Proveedores" : "Suppliers",
    purchase_orders: lang === "es" ? "Órdenes de compra" : "Purchase orders",
    employees: lang === "es" ? "Empleados" : "Employees",
  };

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 460, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "9px 12px" }}>
        <Search size={16} color={t.textLo} />
        <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: t.nova ?? t.accent, background: (t.nova ?? "#33B2F5") + "1A", padding: "2px 7px", borderRadius: 6 }}>NEXUS</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (hasResults) setOpen(true); }}
          placeholder={s.search}
          title="Nexus"
          style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 13.5 }}
        />
        {loading && <RefreshCw size={14} className="spin" color={t.textLo} />}
        {!loading && query && (
          <button onClick={() => { setQuery(""); setOpen(false); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}><X size={14} /></button>
        )}
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ position: "absolute", top: 48, left: 0, width: "min(420px, 90vw)", maxHeight: 440, overflowY: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 6, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", zIndex: 60 }}>
            {!hasResults && <div style={{ padding: 16, fontSize: 13, color: t.textLo, textAlign: "center" }}>{noResultsLabel}</div>}
            {sections.map((key) => {
              const items = results[key] || [];
              if (items.length === 0) return null;
              const Icon = NEXUS_ICONS[key];
              return (
                <div key={key} style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: t.textLo, padding: "8px 10px 4px" }}>{sectionLabels[key]}</div>
                  {items.map((r) => (
                    <button key={`${key}-${r.id}`} onClick={() => select(r.page, r.query)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "none", background: "transparent", color: t.textHi }}>
                      <Icon size={16} color={t.textLo} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                        {r.subtitle && <div style={{ fontSize: 11, color: t.textLo }}>{r.subtitle}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const SCHEDULED_REMINDER_LEAD_DAYS = 2;

function scheduledDueLabel(scheduledDate, lang) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(scheduledDate); due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return lang === "es" ? `Vencido hace ${-diffDays} día(s)` : `${-diffDays} day(s) overdue`;
  if (diffDays === 0) return lang === "es" ? "Vence hoy" : "Due today";
  return lang === "es" ? `Vence en ${diffDays} día(s)` : `Due in ${diffDays} day(s)`;
}

/* ============================ Notification Bell ============================ */
const ORDERS_SEEN_KEY = "kitchenette_orders_last_seen";

function NotificationBell({ t, lang, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [financeAlerts, setFinanceAlerts] = useState([]);
  const [scheduledAlerts, setScheduledAlerts] = useState([]);
  const [newOrders, setNewOrders] = useState([]);

  useEffect(() => {
    let active = true;
    const loadInventory = () => inventoryService.getReorderAlerts()
      .then((data) => { if (active) setAlerts(data || []); })
      .catch(() => { if (active) setAlerts([]); });
    const loadOrders = () => salesApi.list({ sort_by: "created_at", sort_dir: "desc", limit: 10 })
      .then((data) => {
        if (!active) return;
        const lastSeen = localStorage.getItem(ORDERS_SEEN_KEY);
        if (!lastSeen) {
          localStorage.setItem(ORDERS_SEEN_KEY, new Date().toISOString());
          setNewOrders([]);
          return;
        }
        const lastSeenTime = new Date(lastSeen).getTime();
        const fresh = (data.items || []).filter((o) => new Date(o.created_at).getTime() > lastSeenTime);
        setNewOrders(fresh);
      })
      .catch(() => { if (active) setNewOrders([]); });
    const loadFinance = () => Promise.all([financeService.getCXC(), financeService.getCXP()])
      .then(([cxc, cxp]) => {
        if (!active) return;
        const horizon = new Date();
        horizon.setDate(horizon.getDate() + SCHEDULED_REMINDER_LEAD_DAYS);
        const horizonStr = horizon.toISOString().slice(0, 10);
        const relevant = (i) => i.status === "overdue" || (i.due_date && i.due_date.slice(0, 10) <= horizonStr);
        const items = [
          ...cxc.filter(relevant).map((i) => ({ ...i, kind: "cxc" })),
          ...cxp.filter(relevant).map((i) => ({ ...i, kind: "cxp" })),
        ];
        setFinanceAlerts(items);
      })
      .catch(() => { if (active) setFinanceAlerts([]); });
    const loadScheduled = () => financeService.getScheduledPayments("pending")
      .then((data) => {
        if (!active) return;
        const horizon = new Date();
        horizon.setDate(horizon.getDate() + SCHEDULED_REMINDER_LEAD_DAYS);
        const horizonStr = horizon.toISOString().slice(0, 10);
        const due = (data || []).filter((sp) => sp.scheduled_date && sp.scheduled_date.slice(0, 10) <= horizonStr);
        setScheduledAlerts(due);
      })
      .catch(() => { if (active) setScheduledAlerts([]); });

    loadInventory();
    loadFinance();
    loadScheduled();
    loadOrders();
    const interval = setInterval(() => { loadInventory(); loadFinance(); loadScheduled(); loadOrders(); }, 60000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const count = alerts.length + financeAlerts.length + scheduledAlerts.length + newOrders.length;

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => { const next = !v; if (next && newOrders.length > 0) localStorage.setItem(ORDERS_SEEN_KEY, new Date().toISOString()); return next; })} style={iconBtn(t)}>
        <Bell size={18} />
        {count > 0 && (
          <span style={{ position: "absolute", top: 4, right: 4, minWidth: 15, height: 15, borderRadius: 999, background: t.bad, color: "#fff", fontSize: 9.5, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 2px" }}>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
          <div style={{ position: "absolute", top: 44, right: 0, width: "min(360px, 90vw)", maxHeight: 420, overflowY: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 6, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", zIndex: 60 }}>
            {count > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 6px 2px" }}>
                <button onClick={async () => {
                  try {
                    const { data } = await api.post("/notifications/email-digest");
                    alert(data.sent
                      ? (lang === "es" ? `Resumen enviado a ${data.to}` : `Digest sent to ${data.to}`)
                      : (lang === "es" ? "No se pudo enviar: configura el correo en Configuración > Integraciones." : "Could not send: set up email in Settings > Integrations."));
                  } catch { alert(lang === "es" ? "Error al enviar el resumen" : "Error sending digest"); }
                }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 9px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>
                  <Mail size={13} /> {lang === "es" ? "Enviar resumen por correo" : "Email digest"}
                </button>
              </div>
            )}
            {count === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: t.textLo, textAlign: "center" }}>
                {lang === "es" ? "Sin avisos pendientes" : "No pending alerts"}
              </div>
            )}
            {newOrders.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: t.textLo, padding: "8px 10px 6px" }}>
                  {lang === "es" ? "PEDIDOS NUEVOS" : "NEW ORDERS"}
                </div>
                {newOrders.map((o) => (
                  <button key={`order-${o.id}`} onClick={() => { onNavigate("ventas", o.folio || `#${o.id}`); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "none", background: "transparent", color: t.textHi }}>
                    <span style={{ marginTop: 3, width: 8, height: 8, borderRadius: 999, background: t.nova, flex: "0 0 auto" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.folio || `#${o.id}`}{o.customer?.full_name ? ` · ${o.customer.full_name}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: t.textLo }}>
                        {lang === "es" ? `Nuevo pedido: ${mxn(o.total_amount)}` : `New order: ${mxn(o.total_amount)}`}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
            {alerts.length > 0 && (
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: t.textLo, padding: "10px 10px 6px" }}>
                {lang === "es" ? "AVISOS DE INVENTARIO" : "INVENTORY ALERTS"}
              </div>
            )}
            {alerts.map((a) => (
              <button key={`${a.variant_id}-${a.warehouse_id}`} onClick={() => { onNavigate("inventario", a.product_name); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "none", background: "transparent", color: t.textHi }}>
                <span style={{ marginTop: 3, width: 8, height: 8, borderRadius: 999, background: a.level === "red" ? t.bad : t.warn, flex: "0 0 auto" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.product_name}</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>
                    {a.available <= 0
                      ? (lang === "es" ? "Agotado" : "Out of stock")
                      : (lang === "es" ? `Stock bajo: ${a.available} disponibles` : `Low stock: ${a.available} available`)}
                    {" · "}{a.warehouse_name}
                  </div>
                </div>
              </button>
            ))}
            {financeAlerts.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: t.textLo, padding: "10px 10px 6px" }}>
                  {lang === "es" ? "CUENTAS VENCIDAS Y POR VENCER" : "OVERDUE & UPCOMING ACCOUNTS"}
                </div>
                {financeAlerts.map((a) => {
                  const overdue = a.status === "overdue";
                  return (
                  <button key={`${a.kind}-${a.id}`} onClick={() => { onNavigate("finanzas", a.name); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "none", background: "transparent", color: t.textHi }}>
                    <span style={{ marginTop: 3, width: 8, height: 8, borderRadius: 999, background: overdue ? t.bad : t.warn, flex: "0 0 auto" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: t.textLo }}>
                        {a.kind === "cxc"
                          ? (overdue
                              ? (lang === "es" ? `Por cobrar vencido: ${mxn(a.balance)}` : `Overdue receivable: ${mxn(a.balance)}`)
                              : (lang === "es" ? `Por cobrar próximo: ${mxn(a.balance)}` : `Receivable due soon: ${mxn(a.balance)}`))
                          : (overdue
                              ? (lang === "es" ? `Por pagar vencido: ${mxn(a.balance)}` : `Overdue payable: ${mxn(a.balance)}`)
                              : (lang === "es" ? `Por pagar próximo: ${mxn(a.balance)}` : `Payable due soon: ${mxn(a.balance)}`))}
                        {" · "}{a.reference}{a.due_date ? ` · ${scheduledDueLabel(a.due_date, lang)}` : ""}
                      </div>
                    </div>
                  </button>
                  );
                })}
              </>
            )}
            {scheduledAlerts.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: t.textLo, padding: "10px 10px 6px" }}>
                  {lang === "es" ? "PAGOS PROGRAMADOS POR EJECUTAR" : "SCHEDULED PAYMENTS DUE"}
                </div>
                {scheduledAlerts.map((sp) => {
                  const overdue = new Date(sp.scheduled_date) < new Date(new Date().setHours(0, 0, 0, 0));
                  return (
                  <button key={`sp-${sp.id}`} onClick={() => { onNavigate("finanzas", sp.target_name); setOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", textAlign: "left", padding: "8px 10px", borderRadius: 9, border: "none", background: "transparent", color: t.textHi }}>
                    <span style={{ marginTop: 3, width: 8, height: 8, borderRadius: 999, background: overdue ? t.bad : t.warn, flex: "0 0 auto" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sp.target_name || `#${sp.target_id}`}</div>
                      <div style={{ fontSize: 11, color: t.textLo }}>
                        {sp.kind === "cxc"
                          ? (lang === "es" ? `Cobro programado: ${mxn(sp.amount)}` : `Scheduled collection: ${mxn(sp.amount)}`)
                          : (lang === "es" ? `Pago programado: ${mxn(sp.amount)}` : `Scheduled payment: ${mxn(sp.amount)}`)}
                        {" · "}{scheduledDueLabel(sp.scheduled_date, lang)}
                      </div>
                    </div>
                  </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================ Topbar ============================ */
function Topbar({ t, s, lang, setLang, theme, setTheme, onLogout, isMobile, onMenuClick, onNavigate }) {
  return (
    <header style={{ height: 64, flex: "0 0 64px", background: t.panel, borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, padding: isMobile ? "0 12px" : "0 20px", position: "sticky", top: 0, zIndex: 20 }}>
      {isMobile && (
        <button onClick={onMenuClick} style={iconBtn(t)}><Menu size={20} /></button>
      )}
      <GlobalSearch t={t} s={s} lang={lang} onNavigate={onNavigate} />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 4 : 6 }}>
        {!isMobile && (
          <button onClick={() => setLang(lang === "es" ? "en" : "es")} title="Language / Idioma" style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 11px", borderRadius: 10, cursor: "pointer", background: t.panel2, border: `1px solid ${t.border}`, color: t.textMid, fontSize: 12.5, fontWeight: 700 }}>
            <Globe size={15} />{lang.toUpperCase()}
          </button>
        )}
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Tema / Theme" style={iconBtn(t)}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
        <NotificationBell t={t} lang={lang} onNavigate={onNavigate} />
        <div style={{ width: 1, height: 26, background: t.border, margin: "0 4px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 32, height: 32, borderRadius: 999, background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 13, flex: "0 0 auto" }}>ER</span>
          {!isMobile && (
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textHi }}>Edrei</div>
              <div style={{ fontSize: 10.5, color: t.textLo }}>{s.role}</div>
            </div>
          )}
        </div>
        <button onClick={onLogout} style={iconBtn(t)}><LogOut size={17} /></button>
      </div>
    </header>
  );
}
const iconBtn = (t) => ({ position: "relative", width: 36, height: 36, borderRadius: 10, cursor: "pointer", background: "transparent", border: "1px solid transparent", color: t.textMid, display: "grid", placeItems: "center", flex: "0 0 auto" });

/* ============================ Module pages ============================ */
function Table({ t, head, children }) {
  return (
    <Card t={t} style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr style={{ background: t.panel2 }}>{head.map((h, i) => <th key={i} style={{ textAlign: h.r ? "right" : "left", padding: "13px 18px", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4, color: t.textLo, borderBottom: `1px solid ${t.border}` }}>{h.l || h}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}
const td = (t, r) => ({ padding: "14px 18px", fontSize: 13.5, color: t.textMid, borderBottom: `1px solid ${t.borderSoft}`, textAlign: r ? "right" : "left", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });

function Inventory({ t, s }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => PRODUCTS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.cat.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <div>
      <PageHead t={t} title={s.nav.inventario} sub={s.inv.sub} action={<PrimaryBtn t={t}><Plus size={16} /> {s.inv.add}</PrimaryBtn>} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240, maxWidth: 380, display: "flex", alignItems: "center", gap: 9, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px" }}><Search size={16} color={t.textLo} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.inv.search} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 13.5 }} /></div>
        <button style={{ display: "inline-flex", alignItems: "center", gap: 7, background: t.panel2, border: `1px solid ${t.border}`, color: t.textMid, borderRadius: 10, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", fontWeight: 600 }}><SlidersHorizontal size={15} /> {s.inv.filters}</button>
      </div>
      <Table t={t} head={[s.inv.h.product, s.inv.h.cat, s.inv.h.variants, { l: s.inv.h.stock, r: true }, { l: s.inv.h.price, r: true }, ""]}>
        {rows.map((p) => {
          const out = p.stock === 0, low = p.stock > 0 && p.stock < 20;
          return (
            <tr key={p.id}>
              <td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{p.name}</td>
              <td style={td(t)}>{p.cat}</td>
              <td style={td(t)}>{p.variants} {p.variants === 1 ? s.inv.variant : s.inv.variants}</td>
              <td style={td(t, true)}><span style={{ color: out ? t.bad : low ? t.warn : t.textHi, fontWeight: 600 }}>{p.stock}</span>{out && <span style={{ marginLeft: 8 }}><Pill t={t} s={s} k="Agotado" /></span>}</td>
              <td style={{ ...td(t, true), color: t.textHi }}>{mxn(p.price)}</td>
              <td style={{ ...td(t, true) }}><a style={{ color: t.nova, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{s.inv.edit}</a></td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={6} style={{ ...td(t), textAlign: "center", color: t.textLo, padding: 40 }}>{s.inv.none}</td></tr>}
      </Table>
    </div>
  );
}
function Sales({ t, s }) {
  return (
    <div>
      <PageHead t={t} title={s.nav.ventas} sub={s.sales.sub} action={<PrimaryBtn t={t}><Plus size={16} /> {s.sales.add}</PrimaryBtn>} />
      <Table t={t} head={[s.sales.h.ref, s.sales.h.customer, s.sales.h.date, { l: s.sales.h.total, r: true }, s.sales.h.status]}>
        {ORDERS.map((o) => (
          <tr key={o.id}><td style={{ ...td(t), color: t.nova, fontWeight: 600 }}>{o.id}</td><td style={{ ...td(t), color: t.textHi }}>{o.cliente}</td><td style={td(t)}>{o.fecha}</td><td style={{ ...td(t, true), color: t.textHi, fontWeight: 600 }}>{mxn(o.total)}</td><td style={td(t)}><Pill t={t} s={s} k={o.estado} /></td></tr>
        ))}
      </Table>
    </div>
  );
}
function Customers({ t, s }) {
  return (
    <div>
      <PageHead t={t} title={s.nav.clientes} sub={s.cust.sub} action={<PrimaryBtn t={t}><Plus size={16} /> {s.cust.add}</PrimaryBtn>} />
      <Table t={t} head={[s.cust.h.customer, s.cust.h.tax, { l: s.cust.h.balance, r: true }, { l: s.cust.h.orders, r: true }, s.cust.h.tag]}>
        {CUSTOMERS.map((c) => (
          <tr key={c.rfc}><td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{c.name}</td><td style={td(t)}>{c.rfc}</td><td style={{ ...td(t, true), color: c.saldo > 0 ? t.warn : t.good, fontWeight: 600 }}>{mxn(c.saldo)}</td><td style={td(t, true)}>{c.pedidos}</td><td style={td(t)}><Pill t={t} s={s} k={c.tag} /></td></tr>
        ))}
      </Table>
    </div>
  );
}
function Finance({ t, s }) {
  const cards = [{ key: "recv", v: 342800, c: t.warn }, { key: "pay", v: 211050, c: t.bad }, { key: "bank", v: 1840200, c: t.good }, { key: "flow", v: 131750, c: t.nova }];
  const cxc = [{ c: "Mantenimiento Industrial GZ", d: "30+ días", m: 196400 }, { c: "Constructora Robles", d: "0-15 días", m: 84200 }, { c: "Obras del Bajío SA", d: "15-30 días", m: 57300 }];
  return (
    <div>
      <PageHead t={t} title={s.nav.finanzas} sub={s.fin.sub} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14, marginBottom: 16 }}>
        {cards.map((x) => (<Card key={x.key} t={t} style={{ padding: 18 }}><span style={{ fontSize: 12.5, color: t.textLo }}>{s.fin.cards[x.key]}</span><div style={{ fontSize: 23, fontWeight: 700, color: x.c, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{mxn(x.v)}</div></Card>))}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, margin: "4px 2px 12px" }}>{s.fin.aging}</div>
      <Table t={t} head={[s.fin.h.customer, s.fin.h.aging, { l: s.fin.h.amount, r: true }]}>
        {cxc.map((r) => (<tr key={r.c}><td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{r.c}</td><td style={td(t)}>{s.aging[r.d]}</td><td style={{ ...td(t, true), color: t.textHi, fontWeight: 600 }}>{mxn(r.m)}</td></tr>))}
      </Table>
    </div>
  );
}
function Soon({ t, s, title, sub, icon: Icon }) {
  return (
    <div>
      <PageHead t={t} title={title} sub={sub} />
      <Card t={t} style={{ padding: 64, textAlign: "center", borderStyle: "dashed" }}>
        <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: 16, background: t.nova + "18", marginBottom: 16 }}><Icon size={28} color={t.nova} /></div>
        <div style={{ fontSize: 17, fontWeight: 600, color: t.textHi }}>{s.soon.title}</div>
        <p style={{ color: t.textLo, fontSize: 13.5, maxWidth: 420, margin: "8px auto 0" }}>{s.soon.body}</p>
      </Card>
    </div>
  );
}
function Config({ t, s, company }) {
  return (
    <div>
      <PageHead t={t} title={s.nav.config} sub={s.cfg.sub} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        <Card t={t} style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>{s.cfg.identity}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <span style={{ width: 56, height: 56, borderRadius: 14, background: company.color + "26", color: company.color, fontWeight: 700, fontSize: 20, display: "grid", placeItems: "center" }}>{company.initials}</span>
            <div><div style={{ fontSize: 15, fontWeight: 600, color: t.textHi }}>{company.name}</div><button style={{ marginTop: 6, fontSize: 12, color: t.nova, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>{s.cfg.changeLogo}</button></div>
          </div>
          <p style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.6, margin: 0 }}>{s.cfg.note1}<b style={{ color: t.textMid }}>Sthenova</b>{s.cfg.note2}</p>
        </Card>
        <Card t={t} style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>{s.cfg.users}</div>
          {[["EDREI", "Administrador", t.nova], ["Almacén 01", "Inventario", t.good], ["Caja Toreo", "Ventas", t.warn]].map(([n, r, c]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}><span style={{ width: 32, height: 32, borderRadius: 999, background: c + "26", color: c, fontWeight: 700, fontSize: 12, display: "grid", placeItems: "center" }}>{n[0]}</span><div style={{ flex: 1 }}><div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 11.5, color: t.textLo }}>{s.roles[r]}</div></div><CircleDot size={15} color={t.good} /></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* ============================ App ============================ */
export default function App() {
  const [theme, setTheme] = useState("dark");
  const [lang, setLang] = useState("es");
  const [authed, setAuthed] = useState(() => !!localStorage.getItem("token"));
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchNav, setSearchNav] = useState(null);
  const [perms, setPerms] = useState(null);
  const t = THEMES[theme];
  const s = STRINGS[lang];

  // Carga los permisos efectivos del usuario tras autenticarse, para adaptar el
  // menú (RBAC). Si el backend no responde, perms queda null y NO se oculta nada
  // (degradación segura: no dejar al usuario sin navegación por un fallo de red).
  useEffect(() => {
    if (!authed) { setPerms(null); return; }
    configService.getMyPermissions().then(setPerms).catch(() => setPerms(null));
  }, [authed]);

  const canView = (id) => {
    if (!perms) return true;            // sin datos de permisos → mostrar todo
    if (perms.is_superuser) return true;
    const k = NAV_PERM[id];
    return !!perms.permissions?.[k]?.view;
  };
  const allowedModuleIds = MODULES.map((m) => m.id).filter(canView);

  // Si el usuario está en un módulo que su rol no puede ver, lo mandamos al
  // primero permitido (o al dashboard).
  useEffect(() => {
    if (perms && !canView(page)) setPage(allowedModuleIds[0] || "dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, page]);

  const goToPage = (id) => { setPage(id); if (isMobile) setMobileNavOpen(false); };
  const handleSearchNavigate = (targetPage, query) => {
    setSearchNav({ page: targetPage, query, ts: Date.now() });
    goToPage(targetPage);
  };

  if (!authed) {
    return (<>
      <style>{`
        .nova-glow{animation:pulse 3.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}
        .login-tri{animation:triPulse 3.5s ease-in-out infinite}
        @keyframes triPulse{
          0%,100%{opacity:.25; stroke:#23396f}
          50%{opacity:.9; stroke:#33B2F5}
        }
        .spin{animation:spin360 .9s linear infinite}
        @keyframes spin360{to{transform:rotate(360deg)}}
        .login-input-glow{transition:box-shadow .25s ease, border-color .25s ease; animation:inputGlow 3.2s ease-in-out infinite}
        @keyframes inputGlow{0%,100%{box-shadow:0 0 0 1px ${t.nova}22, 0 0 8px ${t.nova}22}50%{box-shadow:0 0 0 1px ${t.nova}55, 0 0 14px ${t.nova}40}}
        .login-input-glow:focus-within{box-shadow:0 0 0 1px ${t.nova}88, 0 0 18px ${t.nova}55; animation:none}
        @media (prefers-reduced-motion:reduce){.nova-glow,.login-tri,.login-input-glow{animation:none}}
      `}</style>
      <Login t={t} s={s} lang={lang} onEnter={() => setAuthed(true)} />
    </>);
  }

  const qFor = (id) => (searchNav && searchNav.page === id ? searchNav.query : undefined);

  const PAGES = {
    dashboard: <Dashboard t={t} s={s} lang={lang} setPage={setPage} isMobile={isMobile} />,
    inventario: <InventoryModule t={t} s={s} initialQuery={qFor("inventario")} />,
    ventas: <SalesCRM t={t} s={s} initialQuery={qFor("ventas")} />,
    clientes: <CustomersModule t={t} s={s} initialQuery={qFor("clientes")} />,
    finanzas: <FinanceModule t={t} s={s} />,
    contabilidad: <AccountingModule t={t} s={s} />,
    rh: <HRModule t={t} s={s} />,
    reportes: <BIModule t={t} s={s} />,
    config: <ConfigModule t={t} s={s} />,
  };

  return (
    <div style={{ display: "flex", background: t.base, minHeight: "100vh", fontFamily: "Inter, system-ui, Arial, sans-serif", color: t.textMid }}>
      <style>{`
        .nova-glow{animation:pulse 3.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.45}50%{opacity:.85}}
        @keyframes securePulse{0%,100%{opacity:.3}50%{opacity:.75}}
        @media (prefers-reduced-motion:reduce){.nova-glow{animation:none}}
        ::placeholder{color:${t.textLo}}
        .clickrow{transition:transform .12s ease, box-shadow .12s ease}
        .clickrow:hover{transform:translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,0.18)}
        @keyframes glowDrift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-16px) scale(1.06)}}
        .bg-orb{position:absolute;border-radius:50%;pointer-events:none;filter:blur(8px);animation:glowDrift 18s ease-in-out infinite}
        @media (prefers-reduced-motion:reduce){.bg-orb{animation:none}}
        .spin{animation:spin360 .9s linear infinite}
        @keyframes spin360{to{transform:rotate(360deg)}}
      `}</style>
      <Sidebar t={t} s={s} page={page} setPage={goToPage} collapsed={collapsed} setCollapsed={setCollapsed} mobile={isMobile} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} allowedIds={allowedModuleIds} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
        <Topbar t={t} s={s} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} onLogout={() => { localStorage.removeItem("token"); setAuthed(false); }} isMobile={isMobile} onMenuClick={() => setMobileNavOpen(true)} onNavigate={handleSearchNavigate} />
        <main style={{ flex: 1, padding: isMobile ? 12 : 24, overflowX: "hidden", position: "relative" }}>
          {theme === "dark" && (
            <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
              <span className="bg-orb" style={{ width: 460, height: 460, top: -160, right: -120, background: "radial-gradient(circle, rgba(51,178,245,0.22), transparent 70%)" }} />
              <span className="bg-orb" style={{ width: 420, height: 420, bottom: -180, left: -100, background: "radial-gradient(circle, rgba(52,211,153,0.14), transparent 70%)", animationDelay: "-6s" }} />
              <span className="bg-orb" style={{ width: 360, height: 360, top: "30%", left: "45%", background: "radial-gradient(circle, rgba(167,139,250,0.12), transparent 70%)", animationDelay: "-12s" }} />
            </div>
          )}
          <div style={{ position: "relative", zIndex: 1 }}>{canView(page) ? PAGES[page] : null}</div>
        </main>
      </div>
    </div>
  );
}
