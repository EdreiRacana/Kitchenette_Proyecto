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
  Wallet, FileText, History, Paperclip, CalendarClock, Ban, Mail, Bell,
} from "lucide-react";
import { financeService, downloadCSV } from "./service";
import type { SupplierBill, SupplierBillDraft, BillsStats as BillsStatsData } from "./service";
import { useServerRecovery } from "../../hooks/useServerRecovery";
import api from "../../services/api";

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
  const [demo, setDemo] = useState(false); // legado: ya nunca se activa (sin datos ficticios)
  const [loadError, setLoadError] = useState(false);
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
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [bankView, setBankView] = useState<BankAccount | null>(null);
  const [transferFrom, setTransferFrom] = useState<BankAccount | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [catFilter, setCatFilter] = useState("");
  // Bills (CxP moderna) ─────────────────────────────
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [billsStats, setBillsStats] = useState<BillsStatsData | null>(null);
  const [billForm, setBillForm] = useState<null | "new" | SupplierBill>(null);
  const [selectedBillIds, setSelectedBillIds] = useState<number[]>([]);
  const [multiPayOpen, setMultiPayOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, tx, cxcRes, cxpRes, bankRes, flowRes, billsRes, billsStatsRes] = await Promise.all([
        financeService.getDashboard(),
        financeService.getTransactions({ limit: 200 }),
        financeService.getCXC(),
        financeService.getCXP(),
        financeService.getBanks(),
        financeService.getCashFlow(6),
        financeService.listBills().catch(() => [] as SupplierBill[]),
        financeService.billsStats().catch(() => null as BillsStatsData | null),
      ]);
      setDash(dash);
      setTransactions(tx);
      setCxc(cxcRes);
      setCxp(cxpRes);
      setBanks(bankRes);
      setFlow(flowRes);
      setBills(billsRes);
      setBillsStats(billsStatsRes);
      setDemo(false); setLoadError(false);
    } catch (err) {
      // NUNCA mostrar datos ficticios: si el backend no responde, se dice la
      // verdad y se ofrece reintentar.
      console.error("Error cargando finanzas:", err);
      setLoadError(true);
      setDash(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Si falló la carga, recarga sola en cuanto el servidor vuelva a responder.
  useServerRecovery(loadError, load);

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
      {loadError && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, flexWrap: "wrap" }}>
          <Info size={16} /> No se pudo conectar con el servidor. Los datos no se cargaron.
          <button onClick={load} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 8, border: `1px solid ${t.bad}66`, background: "transparent", color: t.bad, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            Reintentar
          </button>
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
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => {
                try {
                  const res = await api.get("/finance/cxc/aging-report.pdf", { responseType: "blob" });
                  const url = URL.createObjectURL(res.data);
                  const a = document.createElement("a");
                  a.href = url; a.download = `cxc_${new Date().toISOString().slice(0,10)}.pdf`;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                } catch { alert("Error al descargar PDF"); }
              }} style={{ ...ghostBtn, background: t.nova + "18", color: t.nova, borderColor: t.nova + "55" }}>
                <FileText size={14} /> PDF de cartera
              </button>
              <button onClick={exportCXC} style={ghostBtn}><Download size={14} /> CSV</button>
            </div>
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

      {/* ── TAB: CXP (bills con vencimiento + pago consolidado) ── */}
      {tab === "cxp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Toolbar compacta: acciones principales a la izquierda, utilidades a la derecha */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                onClick={() => setBillForm("new")}
                style={{
                  background: `linear-gradient(135deg, ${t.nova}, ${t.navy || t.panel2})`,
                  color: "#fff", border: "none", padding: "8px 14px", borderRadius: 8,
                  cursor: "pointer", fontSize: 13, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", gap: 6, boxShadow: `0 4px 12px ${t.nova}33`,
                }}
              >
                <Plus size={14} /> Nueva factura
              </button>
              <button
                disabled={selectedBillIds.length === 0}
                onClick={() => setMultiPayOpen(true)}
                style={{
                  ...ghostBtn, padding: "8px 12px",
                  opacity: selectedBillIds.length === 0 ? 0.5 : 1,
                  cursor: selectedBillIds.length === 0 ? "not-allowed" : "pointer",
                  color: selectedBillIds.length > 0 ? t.good : t.textMid,
                  borderColor: selectedBillIds.length > 0 ? t.good + "55" : t.border,
                }}
              >
                <DollarSign size={14} /> Pagar seleccionadas{selectedBillIds.length > 0 ? ` (${selectedBillIds.length})` : ""}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={async () => {
                try {
                  const r = await financeService.sendPaymentReminders();
                  alert(r.sent > 0 ? `Se enviaron ${r.sent} recordatorio(s) de pago al correo de la empresa.` : "No hay recordatorios pendientes por enviar, o no hay correo configurado (Configuración > Integraciones).");
                } catch { alert("No se pudieron enviar los recordatorios."); }
              }} style={{ ...ghostBtn, padding: "8px 12px" }} title="Enviar recordatorios por email"><Mail size={14} /> Recordatorios</button>
              <button onClick={async () => {
                try {
                  const res = await api.get("/finance/cxp/aging-report.pdf", { responseType: "blob" });
                  const url = URL.createObjectURL(res.data);
                  const a = document.createElement("a");
                  a.href = url; a.download = `cxp_${new Date().toISOString().slice(0,10)}.pdf`;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                } catch { alert("Error al descargar PDF"); }
              }} style={{ ...ghostBtn, padding: "8px 12px", background: t.nova + "18", color: t.nova, borderColor: t.nova + "55" }}><FileText size={14} /> PDF</button>
              <button onClick={exportCXP} style={{ ...ghostBtn, padding: "8px 12px" }} title="Descargar CSV"><Download size={14} /> CSV</button>
            </div>
          </div>

          {/* KPIs compactos en fila pareja */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            {[
              { label: "Total por pagar", value: mxn(billsStats?.total_open ?? bills.reduce((a, b) => a + b.balance, 0)), color: t.bad, icon: TrendingDown },
              { label: "Vencido", value: mxn(billsStats?.overdue ?? bills.filter(b => b.status === "overdue").reduce((a, b) => a + b.balance, 0)), color: "#DC2626", icon: AlertCircle },
              { label: "Por vencer 7 días", value: mxn(billsStats?.upcoming_7d ?? 0), color: t.warn, icon: Clock },
              { label: "Proveedores activos", value: String(billsStats?.active_suppliers ?? new Set(bills.map(b => b.supplier_id).filter(Boolean)).size), color: t.nova, icon: Building2 },
              { label: "Próximo vencimiento", value: billsStats?.next_due_date ? fmtDate(billsStats.next_due_date) : "—", color: t.textHi, icon: CalendarClock, sub: billsStats?.next_due_bill_supplier || undefined },
            ].map(k => {
              const Icon = k.icon;
              return (
                <div key={k.label} style={{ ...glass(t), borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, minHeight: 76 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon size={13} color={k.color} />
                    <span style={{ fontSize: 11, color: t.textLo, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>{k.label}</span>
                  </div>
                  <div style={{ fontSize: k.label === "Próximo vencimiento" ? 15 : 18, fontWeight: 800, color: k.color, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{k.value}</div>
                  {k.sub && <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.sub}>{k.sub}</div>}
                </div>
              );
            })}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    <th style={{ padding: "12px 12px", width: 32 }}>
                      <input
                        type="checkbox"
                        checked={bills.length > 0 && selectedBillIds.length === bills.filter(b => b.status !== "paid" && b.status !== "cancelled").length}
                        onChange={(e) => setSelectedBillIds(e.target.checked ? bills.filter(b => b.status !== "paid" && b.status !== "cancelled").map(b => b.id) : [])}
                      />
                    </th>
                    {["Proveedor", "Factura prov.", "Categoría", "Emisión", "Vencimiento", "Días", "Total", "Saldo", "Antigüedad", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bills.length === 0 ? (
                    <tr><td colSpan={12} style={{ textAlign: "center", padding: 48, color: t.textLo }}>Sin facturas por pagar. Da clic en "Nueva factura por pagar" para registrar la primera.</td></tr>
                  ) : bills.map((b, i) => {
                    const sm = STATUS_META[b.status === "open" ? "pending" : b.status === "cancelled" ? "paid" : b.status];
                    const ac = AGING_COLORS[b.aging] || t.textLo;
                    const cancelled = b.status === "cancelled";
                    const disabled = b.status === "paid" || cancelled;
                    const daysColor = (b.days_to_due ?? 999) < 0 ? t.bad : (b.days_to_due ?? 999) <= 7 ? t.warn : t.textMid;
                    const daysText = b.days_to_due == null ? "—" : b.days_to_due < 0 ? `${-b.days_to_due} d. vencida` : b.days_to_due === 0 ? "Vence hoy" : `en ${b.days_to_due} d.`;
                    return (
                      <tr key={b.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2, opacity: cancelled ? 0.55 : 1 }}>
                        <td style={{ padding: "10px 12px" }}>
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selectedBillIds.includes(b.id)}
                            onChange={(e) => setSelectedBillIds(e.target.checked ? [...selectedBillIds, b.id] : selectedBillIds.filter(id => id !== b.id))}
                          />
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>
                          {b.supplier_name || "—"}
                          <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2 }}>{b.folio}</div>
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 12.5, color: t.textMid }}>{b.supplier_folio || "—"}</td>
                        <td style={{ padding: "11px 14px", fontSize: 12, color: t.textLo }}>{b.category || "—"}</td>
                        <td style={{ padding: "11px 14px", fontSize: 12.5, color: t.textMid, whiteSpace: "nowrap" }}>{fmtDate(b.issue_date)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 12.5, color: t.textHi, whiteSpace: "nowrap", fontWeight: 600 }}>{fmtDate(b.due_date)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 12, color: daysColor, whiteSpace: "nowrap", fontWeight: 600 }}>{daysText}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(b.total_amount)}</td>
                        <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 700, color: b.balance > 0 ? t.bad : t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(b.balance)}</td>
                        <td style={{ padding: "11px 14px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: ac, background: ac + "18", padding: "3px 8px", borderRadius: 20 }}>
                            {b.aging === "current" ? "Corriente" : b.aging + " d."}
                          </span>
                        </td>
                        <td style={{ padding: "11px 14px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: cancelled ? t.textLo : sm.color, background: (cancelled ? t.textLo : sm.color) + "18", padding: "3px 9px", borderRadius: 20 }}>
                            {cancelled ? "Cancelada" : sm.label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                          {!disabled && (
                            <>
                              <button onClick={() => setSelectedBillIds([b.id]) && setMultiPayOpen(true)} title="Pagar" style={{ fontSize: 11.5, color: t.bad, background: "transparent", border: `1px solid ${t.bad}44`, padding: "3px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 600, marginRight: 4 }}>
                                Pagar
                              </button>
                              <button onClick={() => setBillForm(b)} title="Editar" style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textMid, padding: 4 }}>
                                <Edit2 size={13} />
                              </button>
                              <button onClick={async () => {
                                try {
                                  const r = await financeService.remindBill(b.id);
                                  alert(r.notified ? "Recordatorio registrado — aparecerá en la campanita." : "No se pudo registrar el recordatorio.");
                                  load();
                                } catch { alert("No se pudo enviar el recordatorio."); }
                              }} title="Enviar recordatorio" style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textMid, padding: 4 }}>
                                <Bell size={13} />
                              </button>
                            </>
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

      {billForm && (
        <BillFormModal
          t={t}
          bill={billForm === "new" ? null : billForm}
          onClose={() => setBillForm(null)}
          onSaved={async () => { setBillForm(null); await load(); }}
        />
      )}

      {multiPayOpen && selectedBillIds.length > 0 && (
        <BillMultiPayModal
          t={t}
          bills={bills.filter(b => selectedBillIds.includes(b.id))}
          banks={banks}
          onClose={() => setMultiPayOpen(false)}
          onSaved={async () => { setMultiPayOpen(false); setSelectedBillIds([]); await load(); }}
        />
      )}

      {/* ── TAB: Banks ── */}
      {tab === "banks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.textHi }}>Cuentas bancarias</div>
            <button onClick={() => setReconcileOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.good}55`, background: t.good + "18", color: t.good, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              <Upload size={14} /> Conciliar extracto bancario
            </button>
          </div>
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
                    <button onClick={() => setEditingBank(b)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Editar</button>
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
      {(bankForm || editingBank) && (
        <BankFormModal
          t={t}
          editing={editingBank}
          onClose={() => { setBankForm(false); setEditingBank(null); }}
          onSave={async (data) => {
            try {
              if (editingBank) await financeService.updateBank(editingBank.id, data);
              else await financeService.createBank(data);
              setBankForm(false); setEditingBank(null); await load();
            }
            catch (e: any) {
              const detail = e?.response?.data?.detail || e?.message || "Error desconocido";
              alert(`No se pudo guardar la cuenta: ${detail}`);
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

      {reconcileOpen && (
        <BankReconcileModal t={t} banks={banks}
          onClose={() => setReconcileOpen(false)}
          onDone={async () => { setReconcileOpen(false); await load(); }} />
      )}
    </div>
  );
}


// ── Modal: Conciliación bancaria (importar extracto) ─────────────────────
function BankReconcileModal({ t, banks, onClose, onDone }:
  { t: any; banks: BankAccount[]; onClose: () => void; onDone: () => void }) {
  const [bankId, setBankId] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | {
    imported: number; matched: number; unmatched: number; duplicated: number;
    match_rate: number; details: any[]; error?: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    if (!bankId || !file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const form = new FormData();
      form.append("bank_account_id", String(bankId));
      form.append("file", file);
      const { data } = await api.post("/finance/reconciliation/import", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al procesar el extracto");
    } finally { setBusy(false); }
  };

  const modalBg: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };

  return createPortal(
    <div style={modalBg} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14 }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: t.panel2 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi }}>Conciliar extracto bancario</div>
            <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>Sube el CSV o XLSX del banco. El sistema hará matching automático por fecha ±3 días + monto exacto.</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {!result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Cuenta bancaria</label>
                <select value={bankId} onChange={e => setBankId(e.target.value ? Number(e.target.value) : "")}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 14 }}>
                  <option value="">— Selecciona —</option>
                  {banks.map(b => <option key={b.id} value={b.id}>{b.name} · {b.bank || ""} {b.account_number ? "·" + b.account_number : ""}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>Archivo del extracto</label>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "24px 20px", borderRadius: 10, border: `2px dashed ${t.border}`, background: t.panel2, cursor: "pointer" }}>
                  <Upload size={18} color={t.nova} />
                  <span style={{ fontSize: 13.5, color: file ? t.textHi : t.textLo }}>{file ? file.name : "Elegir archivo (CSV o XLSX)"}</span>
                  <input type="file" accept=".csv,.xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
                </label>
              </div>
              <div style={{ padding: 12, background: t.panel2, borderRadius: 8, fontSize: 11.5, color: t.textLo, lineHeight: 1.5 }}>
                <b style={{ color: t.textMid }}>Formato esperado:</b> columnas Fecha, Concepto, Cargo, Abono
                (o Monto único con signo). Se aceptan variantes: BBVA, Santander, Banorte.
                El delimitador CSV se detecta automáticamente (coma o punto y coma).
              </div>
              {error && (
                <div style={{ padding: "10px 12px", background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 8, fontSize: 13 }}>
                  <AlertCircle size={13} style={{ marginRight: 6, verticalAlign: "text-bottom" }} /> {error}
                </div>
              )}
            </div>
          )}

          {result && !result.error && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ padding: 16, background: t.good + "18", border: `1px solid ${t.good}55`, borderRadius: 10, textAlign: "center" }}>
                <CheckCircle size={26} color={t.good} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 15, fontWeight: 800, color: t.textHi }}>Extracto procesado</div>
                <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>Tasa de conciliación automática: <b style={{ color: t.good }}>{result.match_rate}%</b></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {[
                  { label: "Importados", value: result.imported, color: t.nova },
                  { label: "Conciliados", value: result.matched, color: t.good },
                  { label: "Sin match", value: result.unmatched, color: t.warn },
                  { label: "Duplicados", value: result.duplicated, color: t.textLo },
                ].map(k => (
                  <div key={k.label} style={{ padding: "12px 10px", background: t.panel2, borderRadius: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.value}</div>
                  </div>
                ))}
              </div>
              {result.details && result.details.length > 0 && (
                <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${t.border}`, borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                        <th style={{ padding: "8px 10px", textAlign: "left", color: t.textLo, fontSize: 10.5, textTransform: "uppercase" }}>Estado</th>
                        <th style={{ padding: "8px 10px", textAlign: "left", color: t.textLo, fontSize: 10.5, textTransform: "uppercase" }}>Fecha</th>
                        <th style={{ padding: "8px 10px", textAlign: "left", color: t.textLo, fontSize: 10.5, textTransform: "uppercase" }}>Descripción</th>
                        <th style={{ padding: "8px 10px", textAlign: "right", color: t.textLo, fontSize: 10.5, textTransform: "uppercase" }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.details.slice(0, 60).map((d, i) => {
                        const sColor = d.status === "matched" ? t.good : d.status === "duplicated" ? t.textLo : t.warn;
                        const sLabel = d.status === "matched" ? "Conciliado" : d.status === "duplicated" ? "Duplicado" : "Sin match";
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${t.border}55` }}>
                            <td style={{ padding: "6px 10px" }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: sColor, background: sColor + "22", padding: "2px 8px", borderRadius: 12 }}>{sLabel}</span>
                            </td>
                            <td style={{ padding: "6px 10px", color: t.textMid }}>{d.date ? new Date(d.date).toLocaleDateString("es-MX") : "—"}</td>
                            <td style={{ padding: "6px 10px", color: t.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{d.desc}</td>
                            <td style={{ padding: "6px 10px", textAlign: "right", color: (d.amount || 0) > 0 ? t.good : t.bad, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(d.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8, background: t.panel2 }}>
          {!result ? (
            <>
              <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer" }}>Cancelar</button>
              <button disabled={!bankId || !file || busy} onClick={upload}
                style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: (!bankId || !file) ? t.panel3 : `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: (!bankId || !file || busy) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <Upload size={13} /> {busy ? "Procesando…" : "Conciliar"}
              </button>
            </>
          ) : (
            <button onClick={onDone} style={{ padding: "9px 22px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy || "#1e40af"})`, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
function BankFormModal({ t, onClose, onSave, editing }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: editing?.name ?? "", bank: editing?.bank ?? "", account_number: editing?.account_number ?? "",
    type: editing?.type ?? "checking", balance: String(editing?.balance ?? "0"), currency: editing?.currency ?? "MXN",
  });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => { if (!form.name) return; setSaving(true); try { await onSave({ ...form, balance: parseFloat(form.balance) || 0 }); } finally { setSaving(false); } };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? "Editar cuenta bancaria" : "Agregar cuenta bancaria"}</h2>
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
          <div><label style={label}>{editing ? "Saldo" : "Saldo inicial"}</label><input type="number" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.name ? 0.5 : 1 }}>
            {saving ? "…" : (editing ? "Guardar cambios" : "Crear cuenta")}
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
  , document.body);
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

// ── Bill Form Modal (crear/editar factura de proveedor) ─────────────────────
function BillFormModal({ t, bill, onClose, onSaved }: { t: any; bill: SupplierBill | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = bill !== null;
  const [suppliers, setSuppliers] = useState<{ id: number; name: string; rfc?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isoDate = (v?: string) => (v ? v.slice(0, 10) : "");

  const [form, setForm] = useState<SupplierBillDraft & { supplier_id?: number | null }>(() => ({
    supplier_id: bill?.supplier_id ?? null,
    supplier_name: bill?.supplier_name ?? "",
    supplier_folio: bill?.supplier_folio ?? "",
    issue_date: isoDate(bill?.issue_date),
    due_date: isoDate(bill?.due_date),
    payment_terms: bill?.payment_terms ?? "net_30",
    category: bill?.category ?? "compras",
    description: bill?.description ?? "",
    currency: bill?.currency ?? "MXN",
    subtotal: bill?.subtotal ?? 0,
    tax_amount: bill?.tax_amount ?? 0,
    total_amount: bill?.total_amount ?? 0,
  }));

  useEffect(() => {
    (async () => {
      try {
        const { data } = await (await import("../../services/api")).default.get<{ id: number; name: string; rfc?: string }[]>("/inventory/suppliers", { params: { limit: 200 } });
        setSuppliers(Array.isArray(data) ? data : []);
      } catch { setSuppliers([]); }
    })();
  }, []);

  const setF = <K extends keyof typeof form>(k: K, v: any) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.due_date) { setErr("La fecha de vencimiento es obligatoria."); return; }
    if (!form.total_amount || form.total_amount <= 0) { setErr("El total debe ser mayor a cero."); return; }
    setSaving(true); setErr(null);
    try {
      const payload: SupplierBillDraft = {
        ...form,
        issue_date: form.issue_date ? new Date(form.issue_date + "T00:00:00").toISOString() : null,
        due_date: form.due_date ? new Date(form.due_date + "T00:00:00").toISOString() : null,
        supplier_id: form.supplier_id ?? null,
        supplier_name: form.supplier_name || null,
        supplier_folio: form.supplier_folio || null,
        payment_terms: form.payment_terms || null,
        category: form.category || null,
        description: form.description || null,
      };
      if (isEdit) await financeService.updateBill(bill!.id, payload);
      else await financeService.createBill(payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: t.textLo, marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: 0.4 };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>
              {isEdit ? `Editar factura ${bill?.folio || ""}` : "Nueva factura por pagar"}
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: t.textLo }}>
              Registra la factura del proveedor con su fecha de vencimiento; luego podrás liquidarla con un pago (o consolidar varias en uno solo).
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Proveedor</label>
              <select value={form.supplier_id ?? ""} onChange={e => {
                const id = e.target.value ? Number(e.target.value) : null;
                const sup = suppliers.find(s => s.id === id);
                setF("supplier_id", id);
                if (sup) setF("supplier_name", sup.name);
              }} style={{ ...inp, cursor: "pointer" }}>
                <option value="">— Selecciona proveedor —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.rfc ? ` · ${s.rfc}` : ""}</option>)}
              </select>
              {form.supplier_id == null && (
                <input value={form.supplier_name ?? ""} onChange={e => setF("supplier_name", e.target.value)} placeholder="…o escribe el nombre" style={{ ...inp, marginTop: 6 }} />
              )}
            </div>
            <div>
              <label style={label}>Folio del proveedor</label>
              <input value={form.supplier_folio ?? ""} onChange={e => setF("supplier_folio", e.target.value)} placeholder="Ej. FAC-937" style={inp} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Fecha de emisión</label>
              <input type="date" value={form.issue_date ?? ""} onChange={e => setF("issue_date", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={label}>Vencimiento *</label>
              <input type="date" value={form.due_date ?? ""} onChange={e => setF("due_date", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={label}>Condiciones</label>
              <select value={form.payment_terms ?? ""} onChange={e => setF("payment_terms", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="cash">Contado</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_60">Net 60</option>
                <option value="net_90">Net 90</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Categoría</label>
              <select value={form.category ?? ""} onChange={e => setF("category", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="compras">Compras / mercancía</option>
                <option value="renta">Renta</option>
                <option value="servicios">Servicios</option>
                <option value="transporte">Transporte</option>
                <option value="marketing">Marketing</option>
                <option value="otros">Otros</option>
              </select>
            </div>
            <div>
              <label style={label}>Moneda</label>
              <select value={form.currency ?? "MXN"} onChange={e => setF("currency", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>

          <div>
            <label style={label}>Descripción</label>
            <input value={form.description ?? ""} onChange={e => setF("description", e.target.value)} placeholder="Renta CEDIS 1 · junio" style={inp} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Subtotal</label>
              <input type="number" step={0.01} value={form.subtotal ?? 0} onChange={e => {
                const v = parseFloat(e.target.value) || 0;
                setF("subtotal", v);
                if (!form.total_amount || form.total_amount === (form.subtotal || 0) + (form.tax_amount || 0)) {
                  setF("total_amount", v + (form.tax_amount || 0));
                }
              }} style={inp} />
            </div>
            <div>
              <label style={label}>IVA / Impuesto</label>
              <input type="number" step={0.01} value={form.tax_amount ?? 0} onChange={e => {
                const v = parseFloat(e.target.value) || 0;
                setF("tax_amount", v);
                setF("total_amount", (form.subtotal || 0) + v);
              }} style={inp} />
            </div>
            <div>
              <label style={label}>Total *</label>
              <input type="number" step={0.01} value={form.total_amount ?? 0} onChange={e => setF("total_amount", parseFloat(e.target.value) || 0)} style={{ ...inp, color: t.textHi, fontWeight: 700 }} />
            </div>
          </div>

          {err && <div style={{ color: t.bad, fontSize: 12.5, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}
        </div>

        <div style={{ padding: "16px 22px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={submit} disabled={saving} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Guardando…" : (isEdit ? "Guardar cambios" : "Crear factura")}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}


// ── Bill Multi-Pay Modal (pago consolidado 1 → N facturas) ──────────────────
function BillMultiPayModal({ t, bills, banks, onClose, onSaved }: { t: any; bills: SupplierBill[]; banks: any[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<string>("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [bankAccountId, setBankAccountId] = useState<number | "">("");
  const [alloc, setAlloc] = useState<Record<number, number>>(() => {
    const a: Record<number, number> = {};
    for (const b of bills) a[b.id] = b.balance;
    return a;
  });

  const total = Object.values(alloc).reduce((a, b) => a + (b || 0), 0);

  const submit = async () => {
    if (total <= 0) { setErr("El monto a pagar debe ser mayor a cero."); return; }
    for (const b of bills) {
      const v = alloc[b.id] || 0;
      if (v < 0) { setErr(`El pago a ${b.folio} no puede ser negativo.`); return; }
      if (v > b.balance + 0.01) { setErr(`El pago a ${b.folio} excede el saldo ($${b.balance.toFixed(2)}).`); return; }
    }
    setSaving(true); setErr(null);
    try {
      await financeService.payBills({
        amount: total,
        method,
        reference: reference || undefined,
        note: note || undefined,
        bank_account_id: bankAccountId ? Number(bankAccountId) : undefined,
        allocations: bills.map(b => ({ bill_id: b.id, amount: alloc[b.id] || 0 })).filter(a => a.amount > 0),
      });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: t.textLo, marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: 0.4 };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>
              {bills.length === 1 ? "Pagar factura" : `Pagar ${bills.length} facturas`}
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: t.textLo }}>
              Se crea UNA transacción de egreso y se aplica a las facturas seleccionadas. Si eliges cuenta bancaria, se descuenta del saldo.
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: t.panel2, fontSize: 11.5, color: t.textLo, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Facturas seleccionadas
            </div>
            {bills.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${t.border}`, gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: t.textHi, fontWeight: 600 }}>{b.supplier_name} · {b.folio}</div>
                  <div style={{ fontSize: 11.5, color: t.textLo }}>Saldo: ${b.balance.toFixed(2)} · Vence {b.due_date ? new Date(b.due_date).toLocaleDateString("es-MX") : "—"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label style={{ fontSize: 11, color: t.textLo }}>Aplicar:</label>
                  <input type="number" step={0.01} value={alloc[b.id] || 0} onChange={e => setAlloc(a => ({ ...a, [b.id]: parseFloat(e.target.value) || 0 }))} style={{ ...inp, width: 130 }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Método de pago</label>
              <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="transfer">Transferencia</option>
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="check">Cheque</option>
                <option value="other">Otro</option>
              </select>
            </div>
            <div>
              <label style={label}>Cuenta bancaria (opcional)</label>
              <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value ? Number(e.target.value) : "")} style={{ ...inp, cursor: "pointer" }}>
                <option value="">— No descontar de banco —</option>
                {banks.map((b: any) => <option key={b.id} value={b.id}>{b.name} · ${b.balance.toFixed(2)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={label}>Referencia (opcional)</label>
              <input value={reference} onChange={e => setReference(e.target.value)} placeholder="TRF-9911" style={inp} />
            </div>
            <div>
              <label style={label}>Nota (opcional)</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Pago viernes" style={inp} />
            </div>
          </div>

          <div style={{ padding: "12px 14px", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: t.textLo, fontWeight: 600 }}>Total a pagar</span>
            <span style={{ fontSize: 20, color: t.textHi, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              ${total.toFixed(2)}
            </span>
          </div>

          {err && <div style={{ color: t.bad, fontSize: 12.5, background: t.bad + "15", padding: "8px 12px", borderRadius: 8 }}>{err}</div>}
        </div>

        <div style={{ padding: "16px 22px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={submit} disabled={saving || total <= 0} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good || "#34D399"}, ${t.nova || "#33B2F5"})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: total <= 0 || saving ? 0.5 : 1 }}>
            {saving ? "Procesando…" : `Pagar $${total.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  , document.body);
}
