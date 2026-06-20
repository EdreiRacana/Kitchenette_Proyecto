// FinanceModule.tsx — Módulo de Finanzas Premium
// Pestañas: Dashboard · CXC · CXP · Bancos · Transacciones · Flujo de caja
// Mismo contrato { t, s } que App.tsx — modo demo automático

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Wallet, Building2,
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Plus, Search,
  Filter, Download, ChevronRight, Info, AlertTriangle, Check,
  X, DollarSign, CreditCard, BarChart3, Calendar, FileText,
  Clock, CheckCircle, XCircle, AlertCircle, ArrowLeftRight,
  PiggyBank, Receipt, Banknote, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  id: number;
  type: "income" | "expense";
  amount: number;
  category: string;
  description?: string;
  reference?: string;
  created_at: string;
}
interface CXCItem {
  id: number;
  customer: string;
  folio: string;
  total: number;
  paid: number;
  balance: number;
  due_date: string;
  aging: "current" | "1-30" | "31-60" | "61-90" | "90+";
  status: "pending" | "partial" | "overdue" | "paid";
}
interface CXPItem {
  id: number;
  supplier: string;
  concept: string;
  total: number;
  paid: number;
  balance: number;
  due_date: string;
  aging: "current" | "1-30" | "31-60" | "61-90" | "90+";
  status: "pending" | "partial" | "overdue" | "paid";
}
interface BankAccount {
  id: number;
  name: string;
  bank: string;
  account_number: string;
  type: "checking" | "savings" | "credit";
  balance: number;
  currency: string;
}
interface FlowPoint {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

// ── Demo Data ─────────────────────────────────────────────────────────────
const DEMO_TRANSACTIONS: Transaction[] = [
  { id: 1, type: "income", amount: 84200, category: "sales", description: "Pago pedido VTA-2041", reference: "order:2041", created_at: "2026-06-11T10:00:00Z" },
  { id: 2, type: "income", amount: 196400, category: "sales", description: "Abono parcial VTA-2039", reference: "order:2039", created_at: "2026-06-10T14:00:00Z" },
  { id: 3, type: "expense", amount: 45000, category: "payroll", description: "Nómina quincenal", reference: "nom:jun-1", created_at: "2026-06-09T09:00:00Z" },
  { id: 4, type: "expense", amount: 28500, category: "supplies", description: "Compra material proveedor Aceros SA", reference: "OC-112", created_at: "2026-06-08T11:00:00Z" },
  { id: 5, type: "income", amount: 57300, category: "sales", description: "Anticipo pedido VTA-2037", reference: "order:2037", created_at: "2026-06-08T16:00:00Z" },
  { id: 6, type: "expense", amount: 12000, category: "rent", description: "Renta bodega junio", reference: "rent:jun", created_at: "2026-06-07T08:00:00Z" },
  { id: 7, type: "expense", amount: 8400, category: "utilities", description: "Electricidad y agua", reference: "util:jun", created_at: "2026-06-06T10:00:00Z" },
  { id: 8, type: "income", amount: 12650, category: "sales", description: "Pago pedido VTA-2040", reference: "order:2040", created_at: "2026-06-05T12:00:00Z" },
  { id: 9, type: "expense", amount: 6200, category: "transport", description: "Fletes y envíos", reference: "flete:jun", created_at: "2026-06-04T09:00:00Z" },
  { id: 10, type: "expense", amount: 3800, category: "marketing", description: "Publicidad digital", reference: "mkt:jun", created_at: "2026-06-03T11:00:00Z" },
];
const DEMO_CXC: CXCItem[] = [
  { id: 1, customer: "Mantenimiento Industrial GZ", folio: "VTA-2039", total: 196400, paid: 98200, balance: 98200, due_date: "2026-06-30", aging: "current", status: "partial" },
  { id: 2, customer: "Obras del Bajío SA", folio: "VTA-2037", total: 57300, paid: 0, balance: 57300, due_date: "2026-06-25", aging: "current", status: "pending" },
  { id: 3, customer: "Constructora Robles", folio: "VTA-2035", total: 124000, paid: 0, balance: 124000, due_date: "2026-05-31", aging: "1-30", status: "overdue" },
  { id: 4, customer: "Ferretería La Esquina", folio: "VTA-2028", total: 38500, paid: 19250, balance: 19250, due_date: "2026-05-15", aging: "31-60", status: "overdue" },
  { id: 5, customer: "Catering Eventos MX", folio: "VTA-2019", total: 22000, paid: 0, balance: 22000, due_date: "2026-04-30", aging: "61-90", status: "overdue" },
];
const DEMO_CXP: CXPItem[] = [
  { id: 1, supplier: "Aceros del Norte SA", concept: "Compra varilla corrugada", total: 85000, paid: 42500, balance: 42500, due_date: "2026-06-28", aging: "current", status: "partial" },
  { id: 2, supplier: "Cementos Cruz Azul", concept: "Cemento gris CPC 30R", total: 64800, paid: 0, balance: 64800, due_date: "2026-06-20", aging: "current", status: "pending" },
  { id: 3, supplier: "Pinturas Comex SA", concept: "Pintura vinílica y esmalte", total: 31200, paid: 0, balance: 31200, due_date: "2026-06-10", aging: "1-30", status: "overdue" },
  { id: 4, supplier: "Tubos y Conexiones MX", concept: "PVC hidráulico y sanitario", total: 18600, paid: 18600, balance: 0, due_date: "2026-06-01", aging: "current", status: "paid" },
];
const DEMO_BANKS: BankAccount[] = [
  { id: 1, name: "Cuenta Principal", bank: "BBVA", account_number: "****4821", type: "checking", balance: 1840200, currency: "MXN" },
  { id: 2, name: "Cuenta Nómina", bank: "Santander", account_number: "****2234", type: "checking", balance: 284500, currency: "MXN" },
  { id: 3, name: "Cuenta Ahorro", bank: "Banamex", account_number: "****9901", type: "savings", balance: 520000, currency: "MXN" },
  { id: 4, name: "Tarjeta Corporativa", bank: "HSBC", account_number: "****6612", type: "credit", balance: -48200, currency: "MXN" },
];
const DEMO_FLOW: FlowPoint[] = [
  { period: "Ene", income: 820000, expenses: 580000, net: 240000 },
  { period: "Feb", income: 932000, expenses: 620000, net: 312000 },
  { period: "Mar", income: 901000, expenses: 650000, net: 251000 },
  { period: "Abr", income: 1034000, expenses: 710000, net: 324000 },
  { period: "May", income: 1190000, expenses: 780000, net: 410000 },
  { period: "Jun", income: 1284000, expenses: 830000, net: 454000 },
];

// ── Helpers ────────────────────────────────────────────────────────────────
const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mxnShort = (n: number) => n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

// Vidrio: en modo oscuro devuelve panel translúcido + blur; en claro, sólido.
const glass = (t: any): React.CSSProperties =>
  t?.name === "dark"
    ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
    : { background: t.panel, border: `1px solid ${t.border}` };

const AGING_COLORS: Record<string, string> = { current: "#34D399", "1-30": "#FBBF24", "31-60": "#FB923C", "61-90": "#F87171", "90+": "#DC2626" };
const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Pendiente", color: "#FBBF24", icon: Clock },
  partial: { label: "Parcial", color: "#33B2F5", icon: AlertCircle },
  overdue: { label: "Vencido", color: "#F87171", icon: XCircle },
  paid: { label: "Pagado", color: "#34D399", icon: CheckCircle },
};
const CATEGORIES: Record<string, { label: string; color: string }> = {
  sales: { label: "Ventas", color: "#34D399" },
  payroll: { label: "Nómina", color: "#F87171" },
  supplies: { label: "Compras", color: "#FB923C" },
  rent: { label: "Renta", color: "#A78BFA" },
  utilities: { label: "Servicios", color: "#60A5FA" },
  transport: { label: "Transporte", color: "#FBBF24" },
  marketing: { label: "Marketing", color: "#F472B6" },
  sales_reversal: { label: "Reverso venta", color: "#F87171" },
  other: { label: "Otro", color: "#94A3B8" },
};

// ── Main Component ─────────────────────────────────────────────────────────
export default function FinanceModule({ t, s }: { t: any; s: any }) {
  const [tab, setTab] = useState<"dashboard" | "cxc" | "cxp" | "banks" | "transactions" | "flow">("dashboard");
  const [demo, setDemo] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cxc, setCxc] = useState<CXCItem[]>([]);
  const [cxp, setCxp] = useState<CXPItem[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [flow, setFlow] = useState<FlowPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [txForm, setTxForm] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const lang = "es";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [txRes] = await Promise.all([
        fetch("/api/v1/finance/transactions").then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      ]);
      setTransactions(txRes);
      setCxc(DEMO_CXC); setCxp(DEMO_CXP); setBanks(DEMO_BANKS); setFlow(DEMO_FLOW);
      setDemo(false);
    } catch {
      setDemo(true);
      setTransactions(DEMO_TRANSACTIONS);
      setCxc(DEMO_CXC); setCxp(DEMO_CXP); setBanks(DEMO_BANKS); setFlow(DEMO_FLOW);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalIncome = transactions.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const totalExpenses = transactions.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
    const totalCXC = cxc.filter(c => c.status !== "paid").reduce((a, c) => a + c.balance, 0);
    const overdueCXC = cxc.filter(c => c.status === "overdue").reduce((a, c) => a + c.balance, 0);
    const totalCXP = cxp.filter(c => c.status !== "paid").reduce((a, c) => a + c.balance, 0);
    const totalBankBalance = banks.reduce((a, b) => a + b.balance, 0);
    return { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, totalCXC, overdueCXC, totalCXP, totalBankBalance };
  }, [transactions, cxc, cxp, banks]);

  const filteredTx = useMemo(() => transactions.filter(tx => {
    const matchQ = !q || (tx.description || "").toLowerCase().includes(q.toLowerCase()) || (tx.reference || "").toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || tx.type === typeFilter;
    const matchCat = !catFilter || tx.category === catFilter;
    return matchQ && matchType && matchCat;
  }), [transactions, q, typeFilter, catFilter]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s", whiteSpace: "nowrap" });

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "cxc", label: "Por cobrar", icon: TrendingUp },
    { id: "cxp", label: "Por pagar", icon: TrendingDown },
    { id: "banks", label: "Bancos", icon: Building2 },
    { id: "transactions", label: "Transacciones", icon: ArrowLeftRight },
    { id: "flow", label: "Flujo de caja", icon: BarChart3 },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {demo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.warn + "18", border: `1px solid ${t.warn}44`, color: t.warn, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          <Info size={16} /> Modo demo: backend no disponible. Los cambios no se guardan.
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>Finanzas</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>Cuentas por cobrar, por pagar, bancos y flujo de caja</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <RefreshCw size={15} /> Actualizar
          </button>
          <button onClick={() => setTxForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Plus size={15} /> Nueva transacción
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as any)} style={tabBtn(tab === id)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon size={14} />{label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: Dashboard ── */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {[
              { label: "Ingresos del periodo", value: mxn(kpis.totalIncome), icon: TrendingUp, color: t.good, sub: `${transactions.filter(tx => tx.type === "income").length} transacciones` },
              { label: "Egresos del periodo", value: mxn(kpis.totalExpenses), icon: TrendingDown, color: t.bad, sub: `${transactions.filter(tx => tx.type === "expense").length} transacciones` },
              { label: "Utilidad neta", value: mxn(kpis.netProfit), icon: DollarSign, color: kpis.netProfit >= 0 ? t.good : t.bad, sub: `${Math.round((kpis.netProfit / (kpis.totalIncome || 1)) * 100)}% margen` },
              { label: "Por cobrar", value: mxn(kpis.totalCXC), icon: Receipt, color: t.warn, sub: `${mxn(kpis.overdueCXC)} vencido` },
              { label: "Por pagar", value: mxn(kpis.totalCXP), icon: CreditCard, color: "#F87171", sub: `${cxp.filter(c => c.status === "overdue").length} facturas vencidas` },
              { label: "Saldo en bancos", value: mxn(kpis.totalBankBalance), icon: PiggyBank, color: t.nova, sub: `${banks.length} cuentas` },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: k.color + "22", color: k.color, borderRadius: 10, padding: 10, display: "flex", flexShrink: 0 }}><k.icon size={20} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Income vs Expenses mini chart */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <BarChart3 size={16} color={t.nova} /> Flujo mensual 2026
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
                {DEMO_FLOW.map((f, i) => {
                  const maxVal = Math.max(...DEMO_FLOW.map(x => Math.max(x.income, x.expenses)));
                  const incH = (f.income / maxVal) * 140;
                  const expH = (f.expenses / maxVal) * 140;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 140 }}>
                        <div style={{ width: 14, height: incH, background: t.good + "99", borderRadius: "3px 3px 0 0", transition: "height .3s" }} title={`Ingresos: ${mxnShort(f.income)}`} />
                        <div style={{ width: 14, height: expH, background: t.bad + "99", borderRadius: "3px 3px 0 0", transition: "height .3s" }} title={`Egresos: ${mxnShort(f.expenses)}`} />
                      </div>
                      <div style={{ fontSize: 11, color: t.textLo }}>{f.period}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 12, height: 12, borderRadius: 3, background: t.good + "99" }} /> Ingresos</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 12, height: 12, borderRadius: 3, background: t.bad + "99" }} /> Egresos</span>
              </div>
            </div>

            {/* Expenses by category */}
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>Egresos por categoría</div>
              {Object.entries(
                transactions.filter(tx => tx.type === "expense").reduce((acc, tx) => {
                  acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
                  return acc;
                }, {} as Record<string, number>)
              ).sort(([, a], [, b]) => b - a).slice(0, 6).map(([cat, val]) => {
                const total = transactions.filter(tx => tx.type === "expense").reduce((a, tx) => a + tx.amount, 0);
                const pct = Math.round((val / total) * 100);
                const catInfo = CATEGORIES[cat] || { label: cat, color: t.textLo };
                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12.5, color: t.textMid }}>{catInfo.label}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textHi }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, background: t.panel3, borderRadius: 99 }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: catInfo.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CXC aging summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { title: "Antigüedad CXC — Por cobrar", items: cxc.filter(c => c.status !== "paid"), total: kpis.totalCXC },
              { title: "Antigüedad CXP — Por pagar", items: cxp.filter(c => c.status !== "paid"), total: kpis.totalCXP },
            ].map(({ title, items, total }) => (
              <div key={title} style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>{title}</div>
                {[
                  { label: "Corriente", key: "current" },
                  { label: "1-30 días", key: "1-30" },
                  { label: "31-60 días", key: "31-60" },
                  { label: "61-90 días", key: "61-90" },
                  { label: "90+ días", key: "90+" },
                ].map(({ label, key }) => {
                  const agingItems = items.filter(i => i.aging === key);
                  const agingTotal = agingItems.reduce((a, i) => a + i.balance, 0);
                  if (agingTotal === 0) return null;
                  const pct = Math.round((agingTotal / total) * 100);
                  return (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, color: t.textMid }}>{label}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: AGING_COLORS[key] }}>{mxn(agingTotal)}</span>
                      </div>
                      <div style={{ height: 6, background: t.panel3, borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: AGING_COLORS[key] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: CXC ── */}
      {tab === "cxc" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              { label: "Total por cobrar", value: mxn(kpis.totalCXC), color: t.warn },
              { label: "Vencido", value: mxn(kpis.overdueCXC), color: t.bad },
              { label: "Clientes con saldo", value: String(cxc.filter(c => c.status !== "paid").length), color: t.nova },
              { label: "En riesgo (60+ días)", value: mxn(cxc.filter(c => c.aging === "61-90" || c.aging === "90+").reduce((a, c) => a + c.balance, 0)), color: t.bad },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* CXC Table (sólida) */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Cliente", "Folio", "Total", "Pagado", "Saldo", "Vencimiento", "Antigüedad", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cxc.map((c, i) => {
                    const sm = STATUS_META[c.status];
                    const ac = AGING_COLORS[c.aging];
                    return (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{c.customer}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.nova, fontWeight: 700 }}>{c.folio}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(c.total)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.paid)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 14, fontWeight: 700, color: c.balance > 0 ? t.warn : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.balance)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 12.5, color: t.textMid, whiteSpace: "nowrap" }}>{fmtDate(c.due_date)}</td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: ac, background: ac + "18", padding: "3px 8px", borderRadius: 20 }}>
                            {c.aging === "current" ? "Corriente" : c.aging + " días"}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: sm.color, background: sm.color + "18", padding: "4px 10px", borderRadius: 20 }}>
                            <sm.icon size={12} />{sm.label}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          {c.status !== "paid" && (
                            <button style={{ fontSize: 12, color: t.nova, background: "transparent", border: `1px solid ${t.nova}44`, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                              Registrar pago
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
        </div>
      )}

      {/* ── TAB: CXP ── */}
      {tab === "cxp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              { label: "Total por pagar", value: mxn(kpis.totalCXP), color: t.bad },
              { label: "Vencido", value: mxn(cxp.filter(c => c.status === "overdue").reduce((a, c) => a + c.balance, 0)), color: "#DC2626" },
              { label: "Proveedores activos", value: String(cxp.filter(c => c.status !== "paid").length), color: t.nova },
              { label: "Próximo vencimiento", value: fmtDate(cxp.filter(c => c.status !== "paid").sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]?.due_date || ""), color: t.warn },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: k.label === "Próximo vencimiento" ? 14 : 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Proveedor", "Concepto", "Total", "Pagado", "Saldo", "Vencimiento", "Antigüedad", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cxp.map((c, i) => {
                    const sm = STATUS_META[c.status];
                    const ac = AGING_COLORS[c.aging];
                    return (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{c.supplier}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.textMid }}>{c.concept}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(c.total)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.paid)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 14, fontWeight: 700, color: c.balance > 0 ? t.bad : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.balance)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 12.5, color: t.textMid, whiteSpace: "nowrap" }}>{fmtDate(c.due_date)}</td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: ac, background: ac + "18", padding: "3px 8px", borderRadius: 20 }}>
                            {c.aging === "current" ? "Corriente" : c.aging + " días"}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: sm.color, background: sm.color + "18", padding: "4px 10px", borderRadius: 20 }}>
                            <sm.icon size={12} />{sm.label}
                          </span>
                        </td>
                        <td style={{ padding: "13px 16px" }}>
                          {c.status !== "paid" && (
                            <button style={{ fontSize: 12, color: t.bad, background: "transparent", border: `1px solid ${t.bad}44`, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                              Pagar
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
        </div>
      )}

      {/* ── TAB: Banks ── */}
      {tab === "banks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {banks.map(b => {
              const typeColors: Record<string, string> = { checking: t.nova, savings: t.good, credit: t.bad };
              const typeLabels: Record<string, string> = { checking: "Cuenta cheques", savings: "Ahorro", credit: "Tarjeta crédito" };
              const color = typeColors[b.type] || t.nova;
              return (
                <div key={b.id} style={{ ...glass(t), borderRadius: 14, padding: 22, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: 99, background: color + "0d" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.textHi }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>{b.bank} · {b.account_number}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color, background: color + "18", padding: "3px 8px", borderRadius: 6 }}>{typeLabels[b.type]}</span>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: b.balance < 0 ? t.bad : t.textHi, fontVariantNumeric: "tabular-nums" }}>
                    {mxn(b.balance)}
                  </div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 4 }}>{b.currency}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <button style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Ver movimientos</button>
                    <button style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: color + "22", color, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Transferir</button>
                  </div>
                </div>
              );
            })}
            <button style={{ background: "transparent", border: `2px dashed ${t.border}`, borderRadius: 14, padding: 22, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 160, color: t.textLo }}>
              <Plus size={24} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Agregar cuenta</span>
            </button>
          </div>

          {/* Total summary */}
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi }}>Posición total de tesorería</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: kpis.totalBankBalance >= 0 ? t.good : t.bad }}>{mxn(kpis.totalBankBalance)}</div>
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { label: "Cuentas de cheques", value: banks.filter(b => b.type === "checking").reduce((a, b) => a + b.balance, 0), color: t.nova },
                { label: "Ahorro", value: banks.filter(b => b.type === "savings").reduce((a, b) => a + b.balance, 0), color: t.good },
                { label: "Crédito utilizado", value: Math.abs(banks.filter(b => b.type === "credit").reduce((a, b) => a + b.balance, 0)), color: t.bad },
              ].map(item => (
                <div key={item.label} style={{ background: t.panel2, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{mxn(item.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Transactions ── */}
      {tab === "transactions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar descripción o referencia…" style={{ ...inp, paddingLeft: 34, width: "100%" }} />
            </div>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Tipo</option>
              <option value="income">Ingresos</option>
              <option value="expense">Egresos</option>
            </select>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Categoría</option>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
              <Download size={14} /> Exportar
            </button>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Tipo", "Descripción", "Categoría", "Referencia", "Monto", "Fecha"].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 6 }).map((__, c) => <td key={c} style={{ padding: "14px 16px" }}><div style={{ height: 12, borderRadius: 6, background: t.panel3, width: "60%" }} /></td>)}</tr>
                    ))
                  ) : filteredTx.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin transacciones. Ajusta los filtros o registra una nueva.</td></tr>
                  ) : filteredTx.map((tx, i) => {
                    const isIncome = tx.type === "income";
                    const cat = CATEGORIES[tx.category] || { label: tx.category, color: t.textLo };
                    return (
                      <tr key={tx.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: isIncome ? t.good : t.bad, background: (isIncome ? t.good : t.bad) + "18", padding: "3px 9px", borderRadius: 20 }}>
                            {isIncome ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />}
                            {isIncome ? "Ingreso" : "Egreso"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi }}>{tx.description || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: 12, color: cat.color, background: cat.color + "18", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>{cat.label}</span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo, fontFamily: "monospace" }}>{tx.reference || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: isIncome ? t.good : t.bad, fontVariantNumeric: "tabular-nums" }}>
                          {isIncome ? "+" : "-"}{mxn(tx.amount)}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo, whiteSpace: "nowrap" }}>{fmtDate(tx.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Flow ── */}
      {tab === "flow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              { label: "Ingresos acumulados", value: mxn(DEMO_FLOW.reduce((a, f) => a + f.income, 0)), color: t.good },
              { label: "Egresos acumulados", value: mxn(DEMO_FLOW.reduce((a, f) => a + f.expenses, 0)), color: t.bad },
              { label: "Flujo neto", value: mxn(DEMO_FLOW.reduce((a, f) => a + f.net, 0)), color: t.nova },
              { label: "Mejor mes", value: DEMO_FLOW.reduce((a, f) => f.net > a.net ? f : a, DEMO_FLOW[0]).period, color: t.good },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ ...glass(t), borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 20 }}>Flujo de caja mensual 2026</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                <thead>
                  <tr>
                    {["Mes", "Ingresos", "Egresos", "Flujo neto", "Acumulado", "Margen"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 16px", textAlign: i === 0 ? "left" : "right", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEMO_FLOW.reduce((acc, f) => {
                    const prev = acc[acc.length - 1];
                    return [...acc, { ...f, acumulado: (prev?.acumulado || 0) + f.net }];
                  }, [] as (FlowPoint & { acumulado: number })[]).map((f, i) => {
                    const margin = Math.round((f.net / f.income) * 100);
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{f.period}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.good, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(f.income)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(f.expenses)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: f.net >= 0 ? t.nova : t.bad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(f.net)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(f.acumulado)}</td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: margin >= 30 ? t.good : margin >= 15 ? t.warn : t.bad }}>{margin}%</span>
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

      {/* ── MODAL: Transaction Form ── */}
      {txForm && <TransactionFormModal t={t} onClose={() => setTxForm(false)} onSave={async (data) => { if (demo) { alert("Modo demo: transacción simulada ✓"); } setTxForm(false); await load(); }} />}
    </div>
  );
}

// ── Transaction Form Modal ─────────────────────────────────────────────────
function TransactionFormModal({ t, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: "income", amount: "", category: "sales", description: "", reference: "" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  const isIncome = form.type === "income";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: (isIncome ? t.good : t.bad) + "22", color: isIncome ? t.good : t.bad, borderRadius: 8, padding: 8, display: "flex" }}>
              {isIncome ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Nueva transacción</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Type toggle */}
          <div style={{ display: "flex", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, gap: 4 }}>
            {[{ v: "income", label: "Ingreso", color: t.good }, { v: "expense", label: "Egreso", color: t.bad }].map(opt => (
              <button key={opt.v} onClick={() => setForm(f => ({ ...f, type: opt.v }))} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: form.type === opt.v ? opt.color + "22" : "transparent", color: form.type === opt.v ? opt.color : t.textLo, transition: "all .15s" }}>
                {opt.label}
              </button>
            ))}
          </div>
          <div><label style={label}>Monto *</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: t.textLo, fontSize: 14 }}>$</span>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" style={{ ...inp, paddingLeft: 28 }} />
            </div>
          </div>
          <div><label style={label}>Categoría</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div><label style={label}>Descripción</label><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe la transacción…" style={inp} /></div>
          <div><label style={label}>Referencia</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="order:123, factura:A-100…" style={inp} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.amount} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: isIncome ? `linear-gradient(135deg, ${t.good}, #059669)` : `linear-gradient(135deg, ${t.bad}, #DC2626)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.amount ? 0.5 : 1 }}>
            {saving ? "…" : "Guardar transacción"}
          </button>
        </div>
      </div>
    </div>
  );
}
