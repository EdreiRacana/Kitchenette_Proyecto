// FinanceModule.tsx — Módulo de Finanzas Premium
// Pestañas: Dashboard · CXC · CXP · Bancos · Transacciones · Flujo de caja
// Mismo contrato { t, s } que App.tsx — modo demo automático si el backend no responde

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard, TrendingUp, TrendingDown, Building2,
  ArrowDownToLine, ArrowUpFromLine, RefreshCw, Plus, Search,
  Download, Info, Check,
  X, DollarSign, CreditCard, BarChart3,
  Clock, CheckCircle, XCircle, AlertCircle, ArrowLeftRight,
  PiggyBank, Receipt, Edit2, Trash2, ArrowRightLeft, Upload,
  Wallet, FileText, History, Paperclip, CalendarClock, Ban, Mail,
} from "lucide-react";
import { financeService, downloadCSV } from "./service";

// ── Types ──────────────────────────────────────────────────────────────────
interface Transaction {
  id: number;
  type: "income" | "expense";
  amount: number;
  category: string;
  description?: string;
  reference?: string;
  attachment_url?: string;
  created_at: string;
}
interface AgingItem {
  id: number;
  name: string;
  reference: string;
  total: number;
  paid: number;
  balance: number;
  due_date?: string;
  aging: "current" | "1-30" | "31-60" | "61-90" | "90+";
  status: "pending" | "partial" | "overdue" | "paid";
  late_fee?: number;
}
interface BankAccount {
  id: number;
  name: string;
  bank?: string;
  account_number?: string;
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

// ── Demo Data (sólo se usa si el backend no responde) ───────────────────────
const DEMO_TRANSACTIONS: Transaction[] = [
  { id: 1, type: "income", amount: 84200, category: "sales", description: "Pago pedido VTA-2041", reference: "order:2041", created_at: "2026-06-11T10:00:00Z" },
  { id: 2, type: "income", amount: 196400, category: "sales", description: "Abono parcial VTA-2039", reference: "order:2039", created_at: "2026-06-10T14:00:00Z" },
  { id: 3, type: "expense", amount: 45000, category: "payroll", description: "Nómina quincenal", reference: "nom:jun-1", created_at: "2026-06-09T09:00:00Z" },
  { id: 4, type: "expense", amount: 28500, category: "supplies", description: "Compra material proveedor Aceros SA", reference: "OC-112", created_at: "2026-06-08T11:00:00Z" },
];
const DEMO_CXC: AgingItem[] = [
  { id: 1, name: "Mantenimiento Industrial GZ", reference: "VTA-2039", total: 196400, paid: 98200, balance: 98200, due_date: "2026-06-30", aging: "current", status: "partial" },
  { id: 2, name: "Obras del Bajío SA", reference: "VTA-2037", total: 57300, paid: 0, balance: 57300, due_date: "2026-06-25", aging: "current", status: "pending" },
];
const DEMO_CXP: AgingItem[] = [
  { id: 1, name: "Aceros del Norte SA", reference: "OC-00112", total: 85000, paid: 42500, balance: 42500, due_date: "2026-06-28", aging: "current", status: "partial" },
];
const DEMO_BANKS: BankAccount[] = [
  { id: 1, name: "Cuenta Principal", bank: "BBVA", account_number: "****4821", type: "checking", balance: 1840200, currency: "MXN" },
  { id: 2, name: "Tarjeta Corporativa", bank: "HSBC", account_number: "****6612", type: "credit", balance: -48200, currency: "MXN" },
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
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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
  const [tab, setTab] = useState<"dashboard" | "cxc" | "cxp" | "banks" | "transactions" | "flow" | "advanced">("dashboard");
  const [demo, setDemo] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cxc, setCxc] = useState<AgingItem[]>([]);
  const [cxp, setCxp] = useState<AgingItem[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [flow, setFlow] = useState<FlowPoint[]>([]);
  const [dash, setDash] = useState<{ projected_balance?: number; bank_balance?: number; cxc_balance?: number; cxp_balance?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [txForm, setTxForm] = useState<null | "new" | Transaction>(null);
  const [payTarget, setPayTarget] = useState<null | { kind: "cxc" | "cxp"; item: AgingItem }>(null);
  const [bankForm, setBankForm] = useState(false);
  const [bankView, setBankView] = useState<BankAccount | null>(null);
  const [transferFrom, setTransferFrom] = useState<BankAccount | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, tx, cxcRes, cxpRes, bankRes, flowRes] = await Promise.all([
        financeService.getDashboard(),
        financeService.getTransactions({ limit: 200 }),
        financeService.getCXC(),
        financeService.getCXP(),
        financeService.getBanks(),
        financeService.getCashFlow(6),
      ]);
      setDash(dash);
      setTransactions(tx);
      setCxc(cxcRes);
      setCxp(cxpRes);
      setBanks(bankRes);
      setFlow(flowRes);
      setDemo(false);
    } catch {
      setDemo(true);
      setTransactions(DEMO_TRANSACTIONS);
      setCxc(DEMO_CXC); setCxp(DEMO_CXP); setBanks(DEMO_BANKS); setFlow(DEMO_FLOW);
      setDash(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalIncome = transactions.filter(tx => tx.type === "income").reduce((a, tx) => a + tx.amount, 0);
    const totalExpenses = transactions.filter(tx => tx.type === "expense").reduce((a, tx) => a + tx.amount, 0);
    const totalCXC = cxc.reduce((a, c) => a + c.balance, 0);
    const overdueCXC = cxc.filter(c => c.status === "overdue").reduce((a, c) => a + c.balance, 0);
    const totalCXP = cxp.reduce((a, c) => a + c.balance, 0);
    const totalBankBalance = banks.reduce((a, b) => a + b.balance, 0);
    return { totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses, totalCXC, overdueCXC, totalCXP, totalBankBalance };
  }, [transactions, cxc, cxp, banks]);

  const filteredTx = useMemo(() => transactions.filter(tx => {
    const matchQ = !q || (tx.description || "").toLowerCase().includes(q.toLowerCase()) || (tx.reference || "").toLowerCase().includes(q.toLowerCase());
    const matchType = !typeFilter || tx.type === typeFilter;
    const matchCat = !catFilter || tx.category === catFilter;
    return matchQ && matchType && matchCat;
  }), [transactions, q, typeFilter, catFilter]);

  // ── Export helpers ──────────────────────────────────────────────────────
  const exportTransactions = () => downloadCSV(
    "transacciones.csv",
    ["Tipo", "Descripción", "Categoría", "Referencia", "Monto", "Fecha"],
    filteredTx.map(tx => [tx.type === "income" ? "Ingreso" : "Egreso", tx.description || "", (CATEGORIES[tx.category] || { label: tx.category }).label, tx.reference || "", tx.amount, fmtDate(tx.created_at)])
  );
  const exportCXC = () => downloadCSV(
    "cuentas_por_cobrar.csv",
    ["Cliente", "Folio", "Total", "Pagado", "Saldo", "Vencimiento", "Antigüedad", "Estado"],
    cxc.map(c => [c.name, c.reference, c.total, c.paid, c.balance, fmtDate(c.due_date), c.aging, STATUS_META[c.status]?.label || c.status])
  );
  const exportCXP = () => downloadCSV(
    "cuentas_por_pagar.csv",
    ["Proveedor", "Folio", "Total", "Pagado", "Saldo", "Vencimiento", "Antigüedad", "Estado"],
    cxp.map(c => [c.name, c.reference, c.total, c.paid, c.balance, fmtDate(c.due_date), c.aging, STATUS_META[c.status]?.label || c.status])
  );
  const exportFlow = () => downloadCSV(
    "flujo_de_caja.csv",
    ["Periodo", "Ingresos", "Egresos", "Flujo neto"],
    flow.map(f => [f.period, f.income, f.expenses, f.net])
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const handleDeleteTx = async (id: number) => {
    if (!window.confirm("¿Eliminar esta transacción? Esta acción no se puede deshacer.")) return;
    if (demo) { alert("Modo demo: no se puede eliminar (backend no disponible)."); return; }
    try { await financeService.deleteTransaction(id); await load(); }
    catch { alert("No se pudo eliminar la transacción."); }
  };

  const handlePay = async (data: { amount: number; method?: string; reference?: string; note?: string; scheduled?: boolean; scheduled_date?: string }) => {
    if (!payTarget) return;
    if (demo) { alert(data.scheduled ? "Modo demo: pago programado simulado ✓" : "Modo demo: pago simulado ✓"); setPayTarget(null); return; }
    try {
      if (data.scheduled) {
        await financeService.createScheduledPayment({
          kind: payTarget.kind,
          target_id: payTarget.item.id,
          target_name: payTarget.item.name,
          amount: data.amount,
          method: data.method,
          reference: data.reference,
          note: data.note,
          scheduled_date: data.scheduled_date,
        });
      } else if (payTarget.kind === "cxc") {
        await financeService.payCXC(payTarget.item.id, data);
      } else {
        await financeService.payCXP(payTarget.item.id, data);
      }
      setPayTarget(null);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "No se pudo registrar el pago.");
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s", whiteSpace: "nowrap" });
  const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 };

  const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "cxc", label: "Por cobrar", icon: TrendingUp },
    { id: "cxp", label: "Por pagar", icon: TrendingDown },
    { id: "banks", label: "Bancos", icon: Building2 },
    { id: "transactions", label: "Transacciones", icon: ArrowLeftRight },
    { id: "flow", label: "Flujo de caja", icon: BarChart3 },
    { id: "advanced", label: "Avanzado", icon: Wallet },
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
          <button onClick={load} style={ghostBtn}><RefreshCw size={15} /> Actualizar</button>
          <button onClick={() => setTxForm("new")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {[
              { label: "Ingresos del periodo", value: mxn(kpis.totalIncome), icon: TrendingUp, color: t.good, sub: `${transactions.filter(tx => tx.type === "income").length} transacciones` },
              { label: "Egresos del periodo", value: mxn(kpis.totalExpenses), icon: TrendingDown, color: t.bad, sub: `${transactions.filter(tx => tx.type === "expense").length} transacciones` },
              { label: "Utilidad neta", value: mxn(kpis.netProfit), icon: DollarSign, color: kpis.netProfit >= 0 ? t.good : t.bad, sub: `${Math.round((kpis.netProfit / (kpis.totalIncome || 1)) * 100)}% margen` },
              { label: "Por cobrar", value: mxn(kpis.totalCXC), icon: Receipt, color: t.warn, sub: `${mxn(kpis.overdueCXC)} vencido` },
              { label: "Por pagar", value: mxn(kpis.totalCXP), icon: CreditCard, color: "#F87171", sub: `${cxp.filter(c => c.status === "overdue").length} facturas vencidas` },
              { label: "Saldo en bancos", value: mxn(kpis.totalBankBalance), icon: PiggyBank, color: t.nova, sub: `${banks.length} cuentas` },
              { label: "Saldo proyectado", value: dash?.projected_balance != null ? mxn(dash.projected_balance) : "—", icon: Wallet, color: t.good, sub: "Bancos + CXC − CXP" },
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

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <BarChart3 size={16} color={t.nova} /> Flujo mensual
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
                {flow.map((f, i) => {
                  const maxVal = Math.max(...flow.map(x => Math.max(x.income, x.expenses)), 1);
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
              {transactions.filter(tx => tx.type === "expense").length === 0 && (
                <div style={{ fontSize: 12.5, color: t.textLo, textAlign: "center", padding: 16 }}>Sin egresos registrados</div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              { title: "Antigüedad CXC — Por cobrar", items: cxc, total: kpis.totalCXC },
              { title: "Antigüedad CXP — Por pagar", items: cxp, total: kpis.totalCXP },
            ].map(({ title, items, total }) => (
              <div key={title} style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>{title}</div>
                {total === 0 && <div style={{ fontSize: 12.5, color: t.textLo, padding: "8px 0" }}>Sin saldos pendientes</div>}
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
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, flex: 1 }}>
              {[
                { label: "Total por cobrar", value: mxn(kpis.totalCXC), color: t.warn },
                { label: "Vencido", value: mxn(kpis.overdueCXC), color: t.bad },
                { label: "Clientes con saldo", value: String(cxc.length), color: t.nova },
                { label: "En riesgo (60+ días)", value: mxn(cxc.filter(c => c.aging === "61-90" || c.aging === "90+").reduce((a, c) => a + c.balance, 0)), color: t.bad },
              ].map(k => (
                <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            <button onClick={exportCXC} style={ghostBtn}><Download size={14} /> Descargar</button>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Cliente", "Folio", "Total", "Pagado", "Saldo", "Recargo", "Vencimiento", "Antigüedad", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cxc.length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin cuentas por cobrar pendientes.</td></tr>
                  ) : cxc.map((c, i) => {
                    const sm = STATUS_META[c.status];
                    const ac = AGING_COLORS[c.aging];
                    return (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{c.name}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.nova, fontWeight: 700 }}>{c.reference}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(c.total)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.paid)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 14, fontWeight: 700, color: c.balance > 0 ? t.warn : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.balance)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 12.5, color: (c.late_fee || 0) > 0 ? t.bad : t.textLo, fontVariantNumeric: "tabular-nums" }}>{(c.late_fee || 0) > 0 ? mxn(c.late_fee!) : "—"}</td>
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
                            <button onClick={() => setPayTarget({ kind: "cxc", item: c })} style={{ fontSize: 12, color: t.nova, background: "transparent", border: `1px solid ${t.nova}44`, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, flex: 1 }}>
              {[
                { label: "Total por pagar", value: mxn(kpis.totalCXP), color: t.bad },
                { label: "Vencido", value: mxn(cxp.filter(c => c.status === "overdue").reduce((a, c) => a + c.balance, 0)), color: "#DC2626" },
                { label: "Proveedores activos", value: String(cxp.length), color: t.nova },
                { label: "Próximo vencimiento", value: cxp.length ? fmtDate(cxp.slice().sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime())[0]?.due_date) : "—", color: t.warn },
              ].map(k => (
                <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: k.label === "Próximo vencimiento" ? 14 : 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => {
                try {
                  const r = await financeService.sendPaymentReminders();
                  alert(r.sent > 0 ? `Se enviaron ${r.sent} recordatorio(s) de pago al correo de la empresa.` : "No hay recordatorios pendientes por enviar, o no hay correo configurado (Configuración > Integraciones).");
                } catch { alert("No se pudieron enviar los recordatorios."); }
              }} style={ghostBtn}><Mail size={14} /> Enviar recordatorios de pago</button>
              <button onClick={exportCXP} style={ghostBtn}><Download size={14} /> Descargar</button>
            </div>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Proveedor", "Folio", "Total", "Pagado", "Saldo", "Recargo", "Vencimiento", "Antigüedad", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cxp.length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin cuentas por pagar pendientes.</td></tr>
                  ) : cxp.map((c, i) => {
                    const sm = STATUS_META[c.status];
                    const ac = AGING_COLORS[c.aging];
                    return (
                      <tr key={c.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{c.name}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.textMid }}>{c.reference}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13.5, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(c.total)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 13, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.paid)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 14, fontWeight: 700, color: c.balance > 0 ? t.bad : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(c.balance)}</td>
                        <td style={{ padding: "13px 16px", fontSize: 12.5, color: (c.late_fee || 0) > 0 ? t.bad : t.textLo, fontVariantNumeric: "tabular-nums" }}>{(c.late_fee || 0) > 0 ? mxn(c.late_fee!) : "—"}</td>
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
                            <button onClick={() => setPayTarget({ kind: "cxp", item: c })} style={{ fontSize: 12, color: t.bad, background: "transparent", border: `1px solid ${t.bad}44`, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
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
                    <button onClick={() => setBankView(b)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Ver movimientos</button>
                    <button onClick={() => setTransferFrom(b)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: color + "22", color, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Transferir</button>
                  </div>
                </div>
              );
            })}
            <button onClick={() => setBankForm(true)} style={{ background: "transparent", border: `2px dashed ${t.border}`, borderRadius: 14, padding: 22, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 160, color: t.textLo }}>
              <Plus size={24} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Agregar cuenta</span>
            </button>
          </div>

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
            <button onClick={exportTransactions} style={ghostBtn}><Download size={14} /> Exportar</button>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Tipo", "Descripción", "Categoría", "Referencia", "Monto", "Fecha", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 7 }).map((__, c) => <td key={c} style={{ padding: "14px 16px" }}><div style={{ height: 12, borderRadius: 6, background: t.panel3, width: "60%" }} /></td>)}</tr>
                    ))
                  ) : filteredTx.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin transacciones. Ajusta los filtros o registra una nueva.</td></tr>
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
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <label title={tx.attachment_url ? "Comprobante adjunto" : "Adjuntar comprobante"} style={{ background: "transparent", border: `1px solid ${tx.attachment_url ? t.good : t.border}44`, borderRadius: 6, padding: 5, cursor: "pointer", color: tx.attachment_url ? t.good : t.textMid, display: "flex" }}>
                              <Paperclip size={13} />
                              <input type="file" style={{ display: "none" }} onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                if (demo) { alert("Modo demo: no se puede adjuntar (backend no disponible)."); return; }
                                try { await financeService.uploadAttachment(tx.id, file); await load(); }
                                catch { alert("No se pudo adjuntar el comprobante."); }
                              }} />
                            </label>
                            <button onClick={() => setTxForm(tx)} title="Editar" style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, padding: 5, cursor: "pointer", color: t.textMid, display: "flex" }}><Edit2 size={13} /></button>
                            <button onClick={() => handleDeleteTx(tx.id)} title="Eliminar" style={{ background: "transparent", border: `1px solid ${t.bad}44`, borderRadius: 6, padding: 5, cursor: "pointer", color: t.bad, display: "flex" }}><Trash2 size={13} /></button>
                          </div>
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

      {/* ── TAB: Flow ── */}
      {tab === "flow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, flex: 1 }}>
              {[
                { label: "Ingresos acumulados", value: mxn(flow.reduce((a, f) => a + f.income, 0)), color: t.good },
                { label: "Egresos acumulados", value: mxn(flow.reduce((a, f) => a + f.expenses, 0)), color: t.bad },
                { label: "Flujo neto", value: mxn(flow.reduce((a, f) => a + f.net, 0)), color: t.nova },
                { label: "Mejor mes", value: flow.length ? flow.reduce((a, f) => f.net > a.net ? f : a, flow[0]).period : "—", color: t.good },
              ].map(k => (
                <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.value}</div>
                </div>
              ))}
            </div>
            <button onClick={exportFlow} style={ghostBtn}><Download size={14} /> Descargar</button>
          </div>

          <div style={{ ...glass(t), borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 20 }}>Flujo de caja mensual</div>
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
                  {flow.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: t.textLo }}>Sin movimientos registrados aún.</td></tr>
                  ) : flow.reduce((acc, f) => {
                    const prev = acc[acc.length - 1];
                    return [...acc, { ...f, acumulado: (prev?.acumulado || 0) + f.net }];
                  }, [] as (FlowPoint & { acumulado: number })[]).map((f, i) => {
                    const margin = f.income ? Math.round((f.net / f.income) * 100) : 0;
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

      {/* ── TAB: Avanzado (presupuestos, recurrentes, reportes, auditoría) ── */}
      {tab === "advanced" && <AdvancedPanel t={t} demo={demo} />}

      {/* ── MODALS ── */}
      {txForm && (
        <TransactionFormModal
          t={t}
          tx={txForm === "new" ? null : txForm}
          onClose={() => setTxForm(null)}
          onSave={async (data) => {
            if (demo) { alert("Modo demo: transacción simulada ✓"); setTxForm(null); return; }
            try {
              if (txForm === "new") await financeService.createTransaction(data);
              else await financeService.updateTransaction((txForm as Transaction).id, data);
              setTxForm(null);
              await load();
            } catch { alert("No se pudo guardar la transacción."); }
          }}
        />
      )}
      {payTarget && (
        <PayDebtModal
          t={t}
          item={payTarget.item}
          kind={payTarget.kind}
          onClose={() => setPayTarget(null)}
          onSave={handlePay}
        />
      )}
      {bankForm && (
        <BankFormModal
          t={t}
          onClose={() => setBankForm(false)}
          onSave={async (data) => {
            if (demo) { alert("Modo demo: cuenta simulada ✓"); setBankForm(false); return; }
            try { await financeService.createBank(data); setBankForm(false); await load(); }
            catch (e: any) {
              const detail = e?.response?.data?.detail || e?.message || "Error desconocido";
              alert(`No se pudo crear la cuenta: ${detail}`);
            }
          }}
        />
      )}
      {bankView && (
        <BankMovementsModal
          t={t}
          bank={bankView}
          demo={demo}
          onClose={() => setBankView(null)}
          onChanged={load}
        />
      )}
      {transferFrom && (
        <TransferModal
          t={t}
          from={transferFrom}
          banks={banks.filter(b => b.id !== transferFrom.id)}
          onClose={() => setTransferFrom(null)}
          onSave={async (toId, amount, description) => {
            if (demo) { alert("Modo demo: transferencia simulada ✓"); setTransferFrom(null); return; }
            try {
              await financeService.transferBank(transferFrom.id, { to_account_id: toId, amount, description });
              setTransferFrom(null);
              await load();
            } catch (e: any) { alert(e?.response?.data?.detail || "No se pudo transferir."); }
          }}
        />
      )}
    </div>
  );
}

// ── Transaction Form Modal (crear / editar) ─────────────────────────────────
function TransactionFormModal({ t, tx, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(tx
    ? { type: tx.type, amount: String(tx.amount), category: tx.category || "sales", description: tx.description || "", reference: tx.reference || "" }
    : { type: "income", amount: "", category: "sales", description: "", reference: "" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => { setSaving(true); try { await onSave({ ...form, amount: parseFloat(form.amount) }); } finally { setSaving(false); } };
  const isIncome = form.type === "income";
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: (isIncome ? t.good : t.bad) + "22", color: isIncome ? t.good : t.bad, borderRadius: 8, padding: 8, display: "flex" }}>
              {isIncome ? <ArrowDownToLine size={18} /> : <ArrowUpFromLine size={18} />}
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{tx ? "Editar transacción" : "Nueva transacción"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
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
            {saving ? "…" : tx ? "Guardar cambios" : "Guardar transacción"}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

// ── Pay Debt Modal (CXC / CXP) ───────────────────────────────────────────────
function PayDebtModal({ t, item, kind, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const todayPlus1 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ amount: String(item.balance), method: "transfer", reference: "", note: "", scheduled_date: todayPlus1 });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const color = kind === "cxc" ? t.good : t.bad;
  const handleSave = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return;
    if (mode === "schedule" && !form.scheduled_date) return;
    setSaving(true);
    try {
      await onSave({
        amount, method: form.method, reference: form.reference, note: form.note,
        scheduled: mode === "schedule",
        scheduled_date: mode === "schedule" ? form.scheduled_date : undefined,
      });
    }
    finally { setSaving(false); }
  };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{kind === "cxc" ? "Registrar pago de cliente" : "Pagar a proveedor"}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ fontSize: 13, color: t.textMid }}>{item.name} · {item.reference}</div>
          <div style={{ fontSize: 13, color: t.textLo }}>Saldo pendiente: <b style={{ color }}>{mxn(item.balance)}</b></div>
          <div style={{ display: "flex", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, gap: 4 }}>
            {[{ v: "now", label: "Pagar ahora" }, { v: "schedule", label: "Programar pago" }].map(opt => (
              <button key={opt.v} onClick={() => setMode(opt.v as any)} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, background: mode === opt.v ? color + "22" : "transparent", color: mode === opt.v ? color : t.textLo, transition: "all .15s" }}>
                {opt.label}
              </button>
            ))}
          </div>
          <div><label style={label}>Monto a pagar *</label>
            <input type="number" max={item.balance} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} />
          </div>
          {mode === "schedule" && (
            <div><label style={label}>Fecha de pago *</label>
              <input type="date" min={todayPlus1} value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} style={inp} />
            </div>
          )}
          <div><label style={label}>Método</label>
            <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
              <option value="check">Cheque</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div><label style={label}>Referencia</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} style={inp} /></div>
          <div><label style={label}>Nota</label><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${color}, ${color})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {saving ? "…" : mode === "schedule" ? "Programar pago" : "Confirmar pago"} {!saving && <Check size={14} style={{ marginLeft: 4, verticalAlign: "-2px" }} />}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

// ── Bank Account Form Modal ──────────────────────────────────────────────────
function BankFormModal({ t, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", bank: "", account_number: "", type: "checking", balance: "0", currency: "MXN" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => { if (!form.name) return; setSaving(true); try { await onSave({ ...form, balance: parseFloat(form.balance) || 0 }); } finally { setSaving(false); } };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Agregar cuenta bancaria</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div><label style={label}>Nombre de la cuenta *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Cuenta principal" style={inp} /></div>
          <div><label style={label}>Banco</label><input value={form.bank} onChange={e => setForm(f => ({ ...f, bank: e.target.value }))} placeholder="BBVA, Santander…" style={inp} /></div>
          <div><label style={label}>Número de cuenta</label><input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="****4821" style={inp} /></div>
          <div><label style={label}>Tipo</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="checking">Cuenta cheques</option>
              <option value="savings">Ahorro</option>
              <option value="credit">Tarjeta de crédito</option>
            </select>
          </div>
          <div><label style={label}>Saldo inicial</label><input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.name ? 0.5 : 1 }}>
            {saving ? "…" : "Crear cuenta"}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}

// ── Bank Movements Modal ─────────────────────────────────────────────────────
function BankMovementsModal({ t, bank, demo, onClose, onChanged }: any) {
  const [movs, setMovs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ type: "deposit", amount: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none" };

  const fetchMovs = useCallback(async () => {
    setLoading(true);
    if (demo) { setMovs([]); setLoading(false); return; }
    try { setMovs(await financeService.getBankTransactions(bank.id)); }
    catch { setMovs([]); }
    finally { setLoading(false); }
  }, [bank.id, demo]);

  useEffect(() => { fetchMovs(); }, [fetchMovs]);

  const exportMovs = () => downloadCSV(
    `movimientos_${bank.name}.csv`,
    ["Tipo", "Monto", "Descripción", "Fecha"],
    movs.map((m: any) => [m.type, m.amount, m.description || "", fmtDate(m.created_at)])
  );

  const handleAdd = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) return;
    if (demo) { alert("Modo demo: movimiento simulado ✓"); return; }
    setSaving(true);
    try {
      await financeService.createBankTransaction(bank.id, { type: form.type, amount, description: form.description });
      setForm({ type: "deposit", amount: "", description: "" });
      await fetchMovs();
      await onChanged();
    } catch { alert("No se pudo registrar el movimiento."); }
    finally { setSaving(false); }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (demo) { alert("Modo demo: no se puede importar sin conexión al backend."); return; }
    setImporting(true);
    setImportMsg(null);
    try {
      let r;
      try {
        r = await financeService.importBankStatement(bank.id, file);
      } catch (e: any) {
        if (e?.response?.data?.detail === "PDF_PASSWORD_REQUIRED") {
          const password = window.prompt("Este PDF está protegido con contraseña. Ingresa la contraseña del estado de cuenta:") || undefined;
          if (!password) { setImportMsg("Importación cancelada: se requiere la contraseña del PDF."); return; }
          r = await financeService.importBankStatement(bank.id, file, password);
        } else {
          throw e;
        }
      }
      setImportMsg(
        `Importados: ${r.imported} · Duplicados omitidos: ${r.skipped_duplicates}` +
        (r.errors.length ? ` · Filas con error: ${r.errors.length}` : "")
      );
      await fetchMovs();
      await onChanged();
    } catch (e: any) {
      setImportMsg(e?.response?.data?.detail || "No se pudo importar el archivo.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column", background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Movimientos — {bank.name}</h2>
            <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>{bank.bank} · {bank.account_number} · Saldo: {mxn(bank.balance)}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: "16px 24px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: `1px solid ${t.border}` }}>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
            <option value="deposit">Depósito</option>
            <option value="withdrawal">Retiro</option>
          </select>
          <input type="number" placeholder="Monto" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ ...inp, width: 110 }} />
          <input placeholder="Descripción" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 140 }} />
          <button onClick={handleAdd} disabled={saving || !form.amount} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.amount ? 0.5 : 1 }}>Agregar</button>
          <button onClick={exportMovs} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><Download size={13} /> Descargar</button>
          <input
            ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" style={{ display: "none" }}
            onChange={e => handleImportFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileInputRef.current?.click()} disabled={importing}
            style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6, opacity: importing ? 0.6 : 1 }}
          >
            <Upload size={13} /> {importing ? "Importando…" : "Cargar estado de cuenta (CSV/Excel/PDF)"}
          </button>
        </div>
        {importMsg && (
          <div style={{ padding: "8px 24px", fontSize: 12, color: t.textMid, borderBottom: `1px solid ${t.border}` }}>{importMsg}</div>
        )}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px 24px 20px" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 13 }}>Cargando…</div>
          ) : movs.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 13 }}>Sin movimientos registrados para esta cuenta.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Tipo", "Monto", "Descripción", "Fecha", "Conciliado"].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10.5, fontWeight: 700, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movs.map((m: any) => {
                  const inFlow = m.type === "deposit" || m.type === "transfer_in";
                  return (
                    <tr key={m.id}>
                      <td style={{ padding: "9px 10px", fontSize: 12.5 }}>
                        <span style={{ color: inFlow ? t.good : t.bad, fontWeight: 600 }}>
                          {m.type === "deposit" ? "Depósito" : m.type === "withdrawal" ? "Retiro" : m.type === "transfer_in" ? "Transf. recibida" : "Transf. enviada"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 13, fontWeight: 700, color: inFlow ? t.good : t.bad }}>{inFlow ? "+" : "-"}{mxn(m.amount)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 12.5, color: t.textMid }}>{m.description || "—"}</td>
                      <td style={{ padding: "9px 10px", fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>{fmtDate(m.created_at)}</td>
                      <td style={{ padding: "9px 10px" }}>
                        <input
                          type="checkbox" checked={!!m.reconciled}
                          onChange={async (e) => {
                            if (demo) { alert("Modo demo: no se puede conciliar (backend no disponible)."); return; }
                            try {
                              await financeService.reconcileMovement(m.id, e.target.checked);
                              await fetchMovs();
                            } catch { alert("No se pudo actualizar la conciliación."); }
                          }}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Advanced Panel — Presupuestos, recurrentes, reportes y auditoría ────────
function AdvancedPanel({ t, demo }: any) {
  const [section, setSection] = useState<"budgets" | "recurring" | "scheduled" | "reports" | "audit">("budgets");
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [comparison, setComparison] = useState<any[]>([]);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [budgetForm, setBudgetForm] = useState({ category: "rent", type: "expense", period, amount: "" });
  const [recurring, setRecurring] = useState<any[]>([]);
  const [recForm, setRecForm] = useState({ type: "expense", amount: "", category: "rent", description: "", frequency: "monthly", next_run_date: "" });
  const [reportStart, setReportStart] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [reportEnd, setReportEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [pnl, setPnl] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none" };
  const ghostBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 };

  const loadBudgets = useCallback(async () => {
    if (demo) { setBudgets([]); setComparison([]); return; }
    try {
      setBudgets(await financeService.getBudgets(period));
      setComparison(await financeService.getBudgetComparison(period));
    } catch { setBudgets([]); setComparison([]); }
  }, [demo, period]);

  const loadRecurring = useCallback(async () => {
    if (demo) { setRecurring([]); return; }
    try { setRecurring(await financeService.getRecurring()); } catch { setRecurring([]); }
  }, [demo]);

  const loadAudit = useCallback(async () => {
    if (demo) { setAuditLogs([]); return; }
    try { setAuditLogs(await financeService.getAuditLogs()); } catch { setAuditLogs([]); }
  }, [demo]);

  const loadScheduled = useCallback(async () => {
    if (demo) { setScheduled([]); return; }
    try { setScheduled(await financeService.getScheduledPayments()); } catch { setScheduled([]); }
  }, [demo]);

  useEffect(() => {
    if (section === "budgets") loadBudgets();
    if (section === "recurring") loadRecurring();
    if (section === "scheduled") loadScheduled();
    if (section === "audit") loadAudit();
  }, [section, loadBudgets, loadRecurring, loadScheduled, loadAudit]);

  const handleCancelScheduled = async (id: number) => {
    if (!window.confirm("¿Cancelar este pago programado?")) return;
    if (demo) { alert("Modo demo: no se puede cancelar (backend no disponible)."); return; }
    try { await financeService.cancelScheduledPayment(id); await loadScheduled(); }
    catch { alert("No se pudo cancelar el pago programado."); }
  };

  const handleCreateBudget = async () => {
    if (!budgetForm.amount) return;
    if (demo) { alert("Modo demo: presupuesto simulado ✓"); return; }
    try {
      await financeService.createBudget({ ...budgetForm, period, amount: parseFloat(budgetForm.amount) });
      setBudgetForm(f => ({ ...f, amount: "" }));
      await loadBudgets();
    } catch { alert("No se pudo crear el presupuesto."); }
  };

  const handleCreateRecurring = async () => {
    if (!recForm.amount || !recForm.next_run_date) return;
    if (demo) { alert("Modo demo: transacción recurrente simulada ✓"); return; }
    try {
      await financeService.createRecurring({ ...recForm, amount: parseFloat(recForm.amount), next_run_date: recForm.next_run_date });
      setRecForm(f => ({ ...f, amount: "", description: "" }));
      await loadRecurring();
    } catch { alert("No se pudo crear la transacción recurrente."); }
  };

  const handleRunPnL = async () => {
    if (demo) { alert("Modo demo: reporte no disponible sin backend."); return; }
    try { setPnl(await financeService.getPnL(reportStart, reportEnd)); } catch { alert("No se pudo generar el reporte."); }
  };

  const SECTIONS = [
    { id: "budgets", label: "Presupuestos", icon: PiggyBank },
    { id: "recurring", label: "Recurrentes", icon: RefreshCw },
    { id: "scheduled", label: "Pagos programados", icon: CalendarClock },
    { id: "reports", label: "Reportes P&L", icon: FileText },
    { id: "audit", label: "Auditoría", icon: History },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 999, border: `1px solid ${section === id ? t.nova : t.border}`, background: section === id ? t.nova + "18" : t.panel2, color: section === id ? t.nova : t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {section === "budgets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)} style={inp} />
            <select value={budgetForm.type} onChange={e => setBudgetForm(f => ({ ...f, type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
            </select>
            <select value={budgetForm.category} onChange={e => setBudgetForm(f => ({ ...f, category: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="number" placeholder="Monto presupuestado" value={budgetForm.amount} onChange={e => setBudgetForm(f => ({ ...f, amount: e.target.value }))} style={{ ...inp, width: 160 }} />
            <button onClick={handleCreateBudget} disabled={!budgetForm.amount} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !budgetForm.amount ? 0.5 : 1 }}>Agregar presupuesto</button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: t.panel2 }}>
                {["Categoría", "Tipo", "Presupuestado", "Real", "Variación", "% usado"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {comparison.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: t.textLo }}>Sin presupuestos para {period}.</td></tr>
                ) : comparison.map((c, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi }}>{(CATEGORIES[c.category] || { label: c.category }).label}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid }}>{c.type === "income" ? "Ingreso" : "Gasto"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{mxn(c.budgeted)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{mxn(c.actual)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: c.variance >= 0 ? t.good : t.bad }}>{mxn(c.variance)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: c.percent_used > 100 ? t.bad : t.textHi }}>{c.percent_used}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "recurring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <select value={recForm.type} onChange={e => setRecForm(f => ({ ...f, type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
            </select>
            <select value={recForm.category} onChange={e => setRecForm(f => ({ ...f, category: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="number" placeholder="Monto" value={recForm.amount} onChange={e => setRecForm(f => ({ ...f, amount: e.target.value }))} style={{ ...inp, width: 110 }} />
            <input placeholder="Descripción" value={recForm.description} onChange={e => setRecForm(f => ({ ...f, description: e.target.value }))} style={{ ...inp, minWidth: 160 }} />
            <select value={recForm.frequency} onChange={e => setRecForm(f => ({ ...f, frequency: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="monthly">Mensual</option>
              <option value="weekly">Semanal</option>
            </select>
            <input type="date" value={recForm.next_run_date} onChange={e => setRecForm(f => ({ ...f, next_run_date: e.target.value }))} style={inp} />
            <button onClick={handleCreateRecurring} disabled={!recForm.amount || !recForm.next_run_date} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!recForm.amount || !recForm.next_run_date) ? 0.5 : 1 }}>Agregar recurrente</button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: t.panel2 }}>
                {["Tipo", "Categoría", "Monto", "Descripción", "Frecuencia", "Próxima ejecución", "Activa"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {recurring.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 32, color: t.textLo }}>Sin transacciones recurrentes.</td></tr>
                ) : recurring.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: r.type === "income" ? t.good : t.bad }}>{r.type === "income" ? "Ingreso" : "Gasto"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{(CATEGORIES[r.category] || { label: r.category }).label}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700 }}>{mxn(r.amount)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid }}>{r.description || "—"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{r.frequency === "monthly" ? "Mensual" : "Semanal"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{fmtDate(r.next_run_date)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: r.is_active ? t.good : t.textLo }}>{r.is_active ? "Sí" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "scheduled" && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: t.panel2 }}>
              {["Tipo", "Cliente/Proveedor", "Monto", "Fecha programada", "Estado", ""].map((h, i) => (
                <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {scheduled.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: t.textLo }}>Sin pagos programados.</td></tr>
              ) : scheduled.map((sp) => {
                const statusColor = sp.status === "paid" ? t.good : sp.status === "failed" ? t.bad : sp.status === "cancelled" ? t.textLo : t.nova;
                const statusLabel = { pending: "Pendiente", paid: "Pagado", cancelled: "Cancelado", failed: "Falló" }[sp.status] || sp.status;
                return (
                  <tr key={sp.id}>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, color: sp.kind === "cxc" ? t.good : t.bad }}>{sp.kind === "cxc" ? "Por cobrar" : "Por pagar"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi }}>{sp.target_name || `#${sp.target_id}`}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700 }}>{mxn(sp.amount)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5 }}>{fmtDate(sp.scheduled_date)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12.5, fontWeight: 600, color: statusColor }} title={sp.error || undefined}>{statusLabel}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {sp.status === "pending" && (
                        <button onClick={() => handleCancelScheduled(sp.id)} title="Cancelar" style={{ background: "transparent", border: "none", cursor: "pointer", color: t.bad, display: "flex", alignItems: "center" }}>
                          <Ban size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {section === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <input type="date" value={reportStart} onChange={e => setReportStart(e.target.value)} style={inp} />
            <input type="date" value={reportEnd} onChange={e => setReportEnd(e.target.value)} style={inp} />
            <button onClick={handleRunPnL} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Generar P&L</button>
            <button onClick={() => !demo && financeService.exportPnLPdf(reportStart, reportEnd)} disabled={demo} style={{ ...ghostBtn, opacity: demo ? 0.5 : 1 }}><Download size={14} /> Exportar PDF</button>
          </div>
          {pnl && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div><div style={{ fontSize: 11.5, color: t.textLo }}>Ingresos</div><div style={{ fontSize: 18, fontWeight: 800, color: t.good }}>{mxn(pnl.total_income)}</div></div>
                <div><div style={{ fontSize: 11.5, color: t.textLo }}>Gastos</div><div style={{ fontSize: 18, fontWeight: 800, color: t.bad }}>{mxn(pnl.total_expenses)}</div></div>
                <div><div style={{ fontSize: 11.5, color: t.textLo }}>Utilidad neta</div><div style={{ fontSize: 18, fontWeight: 800, color: t.nova }}>{mxn(pnl.net_profit)}</div></div>
              </div>
            </div>
          )}
        </div>
      )}

      {section === "audit" && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: t.panel2 }}>
              {["Acción", "Descripción", "Usuario", "Fecha"].map((h, i) => (
                <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {auditLogs.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: t.textLo }}>Sin registros de auditoría.</td></tr>
              ) : auditLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: t.nova }}>{log.action}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid }}>{log.description || "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textLo }}>{log.user_id ?? "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>{fmtDate(log.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Transfer Modal ───────────────────────────────────────────────────────────
function TransferModal({ t, from, banks, onClose, onSave }: any) {
  const [toId, setToId] = useState<number | "">(banks[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!toId || !amt || amt <= 0) return;
    setSaving(true);
    try { await onSave(toId, amt, description); } finally { setSaving(false); }
  };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi, display: "flex", alignItems: "center", gap: 8 }}><ArrowRightLeft size={18} /> Transferir</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ fontSize: 13, color: t.textLo }}>Desde: <b style={{ color: t.textHi }}>{from.name}</b> ({mxn(from.balance)})</div>
          <div><label style={label}>Cuenta destino *</label>
            <select value={toId} onChange={e => setToId(Number(e.target.value))} style={{ ...inp, cursor: "pointer" }}>
              {banks.length === 0 && <option value="">No hay otras cuentas</option>}
              {banks.map((b: BankAccount) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label style={label}>Monto *</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inp} /></div>
          <div><label style={label}>Descripción</label><input value={description} onChange={e => setDescription(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !toId || !amount} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!toId || !amount) ? 0.5 : 1 }}>
            {saving ? "…" : "Transferir"}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}
