// High-end Sales / CRM module — orchestrator.
// Keeps the { t, s } contract so it drops into App.tsx in place of the inline
// Sales component. Connects to the live API and gracefully falls back to a
// built-in demo dataset (with a banner) when the backend is unreachable.
//
// LOADING STRATEGY (block / progressive):
//   The screen is split into independent blocks, each with its own loading
//   state and skeleton, so each part renders the moment its own data arrives:
//     • orders list  → reacts to filters/page (fast; this is the demo canary)
//     • KPIs (stats) → global, loaded once + after mutations (NOT on paging)
//     • analytics    → deferred; only fetched when the Analytics tab is opened
//     • catalogs     → customers + variants, loaded once, independent
//   Nothing is held hostage by the slowest aggregate query anymore.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, List, Columns, BarChart3, Plus, Download, DollarSign, Clock,
  TrendingUp, Percent, ChevronRight, ArrowUp, ArrowDown, FileText, Info,
} from "lucide-react";
import api from "../../services/api";
import { resolveTheme, makeTr, money, dateShort, statusColors, statusMeta, paymentLabel, ORDER_PIPELINE, PAYMENT_METHODS } from "./theme";
import type { Tokens } from "./theme";
import type { Order, OrderDraft, OrderFilters, SalesStats, TrendPoint, TopCustomer, TopProduct, CustomerLite } from "./types";
import { salesApi } from "./api";
import type { VariantOption } from "./api";
import { Spinner, Badge, Button, EmptyState, Spinkeyframes } from "./ui";
import { OrderForm } from "./OrderForm";
import { PaymentModal } from "./PaymentModal";
import { OrderDrawer } from "./OrderDrawer";
import { Analytics } from "./Analytics";
import { DEMO_ORDERS, DEMO_CUSTOMERS, DEMO_VARIANTS } from "./demo";

type ViewMode = "list" | "pipeline" | "analytics";
const PAGE = 20;

function computeStats(orders: Order[]): SalesStats {
  const real = orders.filter((o) => o.kind === "order" && o.status !== "cancelled");
  const paid = real.filter((o) => o.status === "paid");
  const pending = real.filter((o) => o.status === "pending" || o.status === "partial");
  return {
    total_sold: real.reduce((a, o) => a + o.paid_amount, 0),
    orders_count: real.length,
    pending_orders: pending.length,
    pending_amount: pending.reduce((a, o) => a + (o.total_amount - o.paid_amount), 0),
    paid_rate: real.length ? Math.round((paid.length / real.length) * 1000) / 10 : 0,
    avg_ticket: real.length ? Math.round((real.reduce((a, o) => a + o.total_amount, 0) / real.length) * 100) / 100 : 0,
    quotes_count: orders.filter((o) => o.kind === "quote").length,
  };
}

export default function SalesCRM({ t, s }: { t: unknown; s: unknown }) {
  const tk = useMemo<Tokens>(() => resolveTheme(t as Record<string, unknown>), [t]);
  const tr = useMemo(() => makeTr(s), [s]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);

  // ── Independent loading states (one per block) ─────────────────────────────
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [payTarget, setPayTarget] = useState<Order | null>(null);

  const [dragId, setDragId] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);

  const filters = useMemo<OrderFilters>(() => ({
    q: q || undefined, kind: (kind || undefined) as OrderFilters["kind"], status: status || undefined,
    payment_method: payment || undefined, date_from: from || undefined, date_to: to || undefined,
    sort_by: sortBy, sort_dir: sortDir, skip: page * PAGE, limit: PAGE,
  }), [q, kind, status, payment, from, to, sortBy, sortDir, page]);

  // ── Demo-mode local filtering ────────────────────────────────────────────
  const applyDemoFilters = useCallback((all: Order[]): Order[] => {
    let r = [...all];
    if (kind) r = r.filter((o) => o.kind === kind);
    if (status) r = r.filter((o) => o.status === status);
    if (payment) r = r.filter((o) => o.payment_method === payment);
    if (q) { const k = q.toLowerCase(); r = r.filter((o) => (o.folio ?? "").toLowerCase().includes(k) || (o.customer?.name ?? "").toLowerCase().includes(k) || o.status.includes(k)); }
    r.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "total_amount") return (a.total_amount - b.total_amount) * dir;
      if (sortBy === "folio") return (a.folio ?? "").localeCompare(b.folio ?? "") * dir;
      if (sortBy === "status") return a.status.localeCompare(b.status) * dir;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });
    return r;
  }, [kind, status, payment, q, sortBy, sortDir]);

  const refreshDemoAnalytics = useCallback((all: Order[]) => {
    setStats(computeStats(all));
    const byDay = new Map<string, { total: number; count: number }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => {
      const k = o.created_at.slice(0, 10);
      const e = byDay.get(k) ?? { total: 0, count: 0 };
      e.total += o.total_amount; e.count += 1; byDay.set(k, e);
    });
    setTrend([...byDay.entries()].sort().map(([period, v]) => ({ period, total: Math.round(v.total), count: v.count })));
    const byCust = new Map<string, { total: number; orders: number; id: number | null }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => {
      const name = o.customer?.name ?? "Sin cliente";
      const e = byCust.get(name) ?? { total: 0, orders: 0, id: o.customer_id };
      e.total += o.total_amount; e.orders += 1; byCust.set(name, e);
    });
    setTopCustomers([...byCust.entries()].map(([name, v]) => ({ customer_id: v.id, name, total: Math.round(v.total), orders: v.orders })).sort((a, b) => b.total - a.total).slice(0, 5));
    const byProd = new Map<string, { qty: number; total: number }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => o.items.forEach((it) => {
      const e = byProd.get(it.product_name ?? "—") ?? { qty: 0, total: 0 };
      e.qty += it.quantity; e.total += (it.total ?? 0); byProd.set(it.product_name ?? "—", e);
    }));
    setTopProducts([...byProd.entries()].map(([name, v]) => ({ variant_id: null, name, quantity: v.qty, total: Math.round(v.total) })).sort((a, b) => b.total - a.total).slice(0, 5));
  }, []);

  // ── Block 1: orders list (paginated). Also the "is the backend up?" canary. ──
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const page1 = await salesApi.list(filters);
      setOrders(page1.items);
      setTotal(page1.total);
      setDemo(false);
    } catch {
      // Backend unreachable → demo mode (fills orders + analytics locally).
      setDemo(true);
      setCustomers(DEMO_CUSTOMERS);
      setVariants(DEMO_VARIANTS);
      const filtered = applyDemoFilters(DEMO_ORDERS);
      setOrders(filtered.slice(page * PAGE, page * PAGE + PAGE));
      setTotal(filtered.length);
      refreshDemoAnalytics(DEMO_ORDERS);
      setStatsLoading(false);
      setAnalyticsLoaded(true);
    } finally {
      setOrdersLoading(false);
    }
  }, [filters, applyDemoFilters, refreshDemoAnalytics, page]);

  // ── Block 2: KPIs (global, not paginated). Once on mount + after mutations. ──
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await salesApi.stats());
    } catch {
      /* demo path fills stats; ignore here */
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Block 3: analytics bundle (global). Lazy — only when the tab is open. ──
  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [tr1, tc, tp] = await Promise.all([
        salesApi.trend("day", 30), salesApi.topCustomers(5), salesApi.topProducts(5),
      ]);
      setTrend(tr1); setTopCustomers(tc); setTopProducts(tp);
      setAnalyticsLoaded(true);
    } catch {
      /* ignore; demo path handles it */
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // ── Block 4: catalogs (customers + variants). Once; independent of the list. ──
  const loadCatalogs = useCallback(async () => {
    salesApi.customers().then(setCustomers).catch(() => { /* keep current */ });
    salesApi.variantOptions().then(setVariants).catch(() => { /* keep current */ });
  }, []);

  // Refresh after a mutation: list + KPIs now, analytics on next open.
  const refreshData = useCallback(async () => {
    await loadOrders();
    loadStats();
    setAnalyticsLoaded(false); // invalidate cache; refetches if the tab is open
  }, [loadOrders, loadStats]);

  // ── Effects: each block loads on its own trigger ───────────────────────────
  useEffect(() => { loadOrders(); }, [loadOrders]);            // filters / page
  useEffect(() => { loadStats(); loadCatalogs(); }, [loadStats, loadCatalogs]); // once
  useEffect(() => {
    if (view === "analytics" && !demo && !analyticsLoaded) loadAnalytics();
  }, [view, demo, analyticsLoaded, loadAnalytics]);
  useEffect(() => { setPage(0); }, [q, kind, status, payment, from, to]);

  // ── Demo mutation helpers ────────────────────────────────────────────────
  const demoStore = useMemo(() => ({ list: [...DEMO_ORDERS] }), []);
  const commitDemo = useCallback(() => {
    const filtered = applyDemoFilters(demoStore.list);
    setOrders(filtered.slice(page * PAGE, page * PAGE + PAGE)); setTotal(filtered.length);
    refreshDemoAnalytics(demoStore.list);
  }, [applyDemoFilters, demoStore, page, refreshDemoAnalytics]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const openDetail = useCallback(async (o: Order) => {
    if (demo) { setSelected(o); return; }
    try { setSelected(await salesApi.get(o.id)); } catch { setSelected(o); }
  }, [demo]);

  const handleSubmit = useCallback(async (draft: OrderDraft) => {
    setSaving(true);
    try {
      if (demo) {
        const subtotal = draft.items.reduce((a, it) => a + Math.max(it.unit_price * it.quantity - it.discount_amount, 0), 0);
        const disc = draft.discount_type === "percent" ? subtotal * draft.discount_value / 100 : draft.discount_value;
        const taxable = Math.max(subtotal - disc, 0); const tax = taxable * draft.tax_rate / 100;
        const totalv = Math.round((taxable + tax + draft.shipping_amount) * 100) / 100;
        if (editing) {
          const idx = demoStore.list.findIndex((x) => x.id === editing.id);
          if (idx >= 0) demoStore.list[idx] = { ...editing, subtotal, discount_amount: disc, tax_amount: tax, total_amount: totalv, balance: totalv - editing.paid_amount, notes: draft.notes || null };
        } else {
          const id = Math.max(0, ...demoStore.list.map((x) => x.id)) + 1;
          const folio = `${draft.kind === "quote" ? "COT" : "ORD"}-${String(id).padStart(6, "0")}`;
          demoStore.list.unshift({
            id, folio, kind: draft.kind, customer_id: draft.customer_id, user_id: 1, warehouse_id: 1,
            status: draft.kind === "quote" ? "sent" : "pending", payment_method: draft.payment_method, channel: draft.channel,
            currency: "MXN", subtotal, discount_type: draft.discount_type, discount_value: draft.discount_value,
            discount_amount: disc, tax_rate: draft.tax_rate, tax_amount: tax, shipping_amount: draft.shipping_amount,
            total_amount: totalv, paid_amount: 0, balance: totalv, due_date: null, valid_until: null, notes: draft.notes || null,
            bill_rfc: draft.bill_rfc || null, bill_name: draft.bill_name || null, bill_use: draft.bill_use || null,
            bill_regime: draft.bill_regime || null, bill_zip: draft.bill_zip || null, cfdi_uuid: null, cfdi_status: "none", invoiced_at: null,
            created_at: new Date().toISOString(), updated_at: null,
            items: draft.items.map((it, i) => ({ id: i, variant_id: it.variant_id, product_name: it.product_name, sku: it.sku, quantity: it.quantity, unit_price: it.unit_price, discount_amount: it.discount_amount, tax_rate: it.tax_rate, subtotal: it.unit_price * it.quantity, total: it.unit_price * it.quantity * (1 + it.tax_rate / 100) })),
            payments: [], events: [{ id: 1, event_type: "created", from_status: null, to_status: "pending", message: "Creado", created_at: new Date().toISOString() }],
            customer: draft.customer_id ? (DEMO_CUSTOMERS.find((c) => c.id === draft.customer_id) ?? null) : null,
            seller: { id: 1, full_name: "Vendedor Demo" },
          });
        }
        commitDemo();
      } else {
        if (editing) await salesApi.update(editing.id, draft);
        else await salesApi.create(draft);
        await refreshData();
      }
      setFormOpen(false); setEditing(null);
    } finally { setSaving(false); }
  }, [demo, editing, demoStore, commitDemo, refreshData]);

  const handlePay = useCallback(async (amount: number, method: string, reference: string, note: string) => {
    if (!payTarget) return;
    setSaving(true);
    try {
      if (demo) {
        const idx = demoStore.list.findIndex((x) => x.id === payTarget.id);
        if (idx >= 0) {
          const o = demoStore.list[idx]; const paid = o.paid_amount + amount;
          demoStore.list[idx] = { ...o, paid_amount: paid, balance: Math.round((o.total_amount - paid) * 100) / 100, status: paid + 0.001 >= o.total_amount ? "paid" : "partial", payments: [...o.payments, { id: o.payments.length + 1, order_id: o.id, amount, method, reference: reference || null, note: note || null, created_at: new Date().toISOString() }] };
        }
        commitDemo(); setSelected(null);
      } else {
        await salesApi.addPayment(payTarget.id, amount, method, reference, note);
        await refreshData(); setSelected(null);
      }
      setPayTarget(null);
    } catch (e) { alert(extractErr(e)); } finally { setSaving(false); }
  }, [payTarget, demo, demoStore, commitDemo, refreshData]);

  const changeStatus = useCallback(async (o: Order, newStatus: string) => {
    if (o.status === newStatus) return;
    if (demo) {
      const idx = demoStore.list.findIndex((x) => x.id === o.id);
      if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: newStatus as Order["status"] };
      commitDemo(); return;
    }
    try { await salesApi.changeStatus(o.id, newStatus); await refreshData(); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData]);

  const markPaid = useCallback((o: Order) => { setPayTarget(o); }, []);

  const convert = useCallback(async (o: Order) => {
    if (demo) {
      const idx = demoStore.list.findIndex((x) => x.id === o.id);
      if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: "converted" };
      commitDemo(); setSelected(null); return;
    }
    try { await salesApi.convert(o.id); await refreshData(); setSelected(null); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData]);

  const cancel = useCallback(async (o: Order) => {
    if (!window.confirm(tr("sales_confirm_cancel", "¿Cancelar este documento?"))) return;
    if (demo) {
      const idx = demoStore.list.findIndex((x) => x.id === o.id);
      if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: "cancelled", balance: 0 };
      commitDemo(); setSelected(null); return;
    }
    try { await salesApi.cancel(o.id); await refreshData(); setSelected(null); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData, tr]);

  const invoice = useCallback(async (o: Order) => {
    if (!o.bill_rfc) { alert(tr("sales_need_rfc", "Agrega datos de facturación (RFC) al pedido para generar el CFDI.")); return; }
    if (demo) { alert("CFDI (demo): se generaría el comprobante para timbrar con tu PAC."); return; }
    try {
      const { data } = await api.get(`/sales/${o.id}/invoice`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `cfdi-${o.folio}.json`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert(extractErr(e)); }
  }, [demo, tr]);

  const openEdit = useCallback((o: Order) => { setEditing(o); setSelected(null); setFormOpen(true); }, []);
  const openNew = useCallback(() => { setEditing(null); setFormOpen(true); }, []);

  const exportCsv = useCallback(() => {
    if (demo) { alert("Export CSV disponible con backend conectado."); return; }
    window.open(salesApi.exportUrl(filters), "_blank");
  }, [demo, filters]);

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  // ── Render helpers ───────────────────────────────────────────────────────
  const kpis = stats ?? computeStats(orders);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const KpiCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 170 }}>
      <div style={{ background: color + "22", color, borderRadius: 10, padding: 9, display: "flex" }}>{icon}</div>
      <div><div style={{ fontSize: 12, color: tk.textLo, marginBottom: 2 }}>{label}</div><div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{value}</div></div>
    </div>
  );

  const KpiSkeleton = () => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 170 }}>
      <Skel tk={tk} w={38} h={38} r={10} />
      <div style={{ flex: 1 }}>
        <Skel tk={tk} w="60%" h={10} style={{ marginBottom: 8 }} />
        <Skel tk={tk} w="42%" h={16} />
      </div>
    </div>
  );

  const inputBase: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 14, outline: "none" };
  const SortHead = ({ col, label }: { col: string; label: string }) => (
    <th onClick={() => toggleSort(col)} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: 0.4 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{label}{sortBy === col && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  );

  const thBase: React.CSSProperties = { padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 0" }}>
      <Spinkeyframes />
      <ShimmerKeyframes />

      {demo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.warn + "18", border: `1px solid ${tk.warn}44`, color: tk.warn, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <Info size={16} /> {tr("sales_demo_mode", "Modo demo: backend no disponible. Mostrando datos de ejemplo; las acciones no se guardan.")}
        </div>
      )}

      {/* KPIs — own block: skeleton until stats land, list keeps loading underneath */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {statsLoading && !stats ? (
          Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : (
          <>
            <KpiCard icon={<DollarSign size={20} />} label={tr("sales_kpi_sold", "Total vendido")} value={money(kpis.total_sold)} color={tk.good} />
            <KpiCard icon={<Clock size={20} />} label={tr("sales_kpi_pending_orders", "Pedidos pendientes")} value={String(kpis.pending_orders)} color={tk.warn} />
            <KpiCard icon={<TrendingUp size={20} />} label={tr("sales_kpi_pending_amount", "Por cobrar")} value={money(kpis.pending_amount)} color={tk.accent} />
            <KpiCard icon={<Percent size={20} />} label={tr("sales_kpi_paid_rate", "Tasa pagados")} value={`${kpis.paid_rate}%`} color={tk.good} />
            <KpiCard icon={<FileText size={20} />} label={tr("sales_kpi_avg", "Ticket promedio")} value={money(kpis.avg_ticket)} color={tk.accent} />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: tk.textLo }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("sales_search_placeholder", "Buscar folio, cliente o estado…")}
            style={{ ...inputBase, width: "100%", paddingLeft: 34, boxSizing: "border-box" }} />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("sales_all_docs", "Todos")}</option>
          <option value="order">{tr("sales_kind_order", "Pedidos")}</option>
          <option value="quote">{tr("sales_kind_quote", "Cotizaciones")}</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("sales_filter_status", "Estado")}</option>
          {["draft", "pending", "partial", "paid", "cancelled"].map((st) => <option key={st} value={st}>{statusMeta(st).label}</option>)}
        </select>
        <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("sales_detail_payment", "Pago")}</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputBase} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputBase} />
        <div style={{ display: "flex", gap: 4 }}>
          {([["list", List], ["pipeline", Columns], ["analytics", BarChart3]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v)} title={v}
              style={{ ...inputBase, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, background: view === v ? tk.accent : tk.inputBg, color: view === v ? "#06122B" : tk.textMid, borderColor: view === v ? tk.accent : tk.border }}>
              <Icon size={16} />
            </button>
          ))}
        </div>
        <Button tk={tk} variant="ghost" icon={<Download size={16} />} onClick={exportCsv}>{tr("sales_export", "Export")}</Button>
        <Button tk={tk} variant="primary" icon={<Plus size={16} />} onClick={openNew}>{tr("sales_new", "Nuevo")}</Button>
      </div>

      {/* Main content — each view block manages its own loading state */}
      {view === "analytics" ? (
        analyticsLoading && !analyticsLoaded ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner tk={tk} size={28} /></div>
        ) : (
          <Analytics tk={tk} tr={tr} trend={trend} topCustomers={topCustomers} topProducts={topProducts} />
        )
      ) : view === "pipeline" ? (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {ORDER_PIPELINE.map((col) => {
            const colOrders = orders.filter((o) => o.kind === "order" && o.status === col);
            const sc = statusColors(tk, col);
            return (
              <div key={col} onDragOver={(e) => { e.preventDefault(); setDragCol(col); }} onDrop={() => { if (dragId !== null) { const o = orders.find((x) => x.id === dragId); if (o) changeStatus(o, col); } setDragId(null); setDragCol(null); }}
                style={{ flex: "0 0 270px", background: dragCol === col ? sc.bg : tk.panel, border: `2px solid ${dragCol === col ? sc.border : tk.border}`, borderRadius: 12, padding: 12, minHeight: 320, transition: "border .2s, background .2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: sc.text, fontSize: 14 }}>{statusMeta(col).label}</span>
                  <Badge tk={tk} bg={sc.bg} color={sc.text} border={sc.border}>{ordersLoading ? "…" : colOrders.length}</Badge>
                </div>
                <div style={{ fontSize: 12, color: tk.textLo, marginBottom: 10 }}>{ordersLoading ? "" : money(colOrders.reduce((a, b) => a + b.total_amount, 0))}</div>
                {ordersLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} style={{ background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                      <Skel tk={tk} w="50%" h={12} style={{ marginBottom: 6 }} />
                      <Skel tk={tk} w="75%" h={11} style={{ marginBottom: 6 }} />
                      <Skel tk={tk} w="40%" h={13} />
                    </div>
                  ))
                ) : (
                  colOrders.map((o) => (
                    <div key={o.id} draggable onDragStart={() => setDragId(o.id)} onClick={() => openDetail(o)}
                      style={{ background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, cursor: "grab", opacity: dragId === o.id ? 0.5 : 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: tk.accent, marginBottom: 4 }}>{o.folio}</div>
                      <div style={{ fontSize: 12, color: tk.textHi, marginBottom: 4 }}>{o.customer?.name ?? tr("sales_no_customer", "Mostrador")}</div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: tk.textHi }}>{money(o.total_amount)}</div>
                    </div>
                  ))
                )}
                {!ordersLoading && colOrders.length === 0 && <div style={{ textAlign: "center", color: tk.textLo, fontSize: 12, padding: "24px 0", opacity: 0.6 }}>—</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr style={{ background: tk.panel2 }}>
                <SortHead col="folio" label={tr("sales_col_folio", "Folio")} />
                <th style={thBase}>{tr("sales_col_client", "Cliente")}</th>
                <SortHead col="created_at" label={tr("sales_col_date", "Fecha")} />
                <th style={thBase}>{tr("sales_col_payment", "Pago")}</th>
                <SortHead col="total_amount" label={tr("sales_col_total", "Total")} />
                <th style={thBase}>{tr("sales_balance", "Saldo")}</th>
                <SortHead col="status" label={tr("sales_col_status", "Estado")} />
                <th style={{ borderBottom: `1px solid ${tk.border}` }}></th>
              </tr></thead>
              <tbody>
                {ordersLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                      {Array.from({ length: 7 }).map((__, c) => (
                        <td key={c} style={{ padding: "12px 16px" }}><Skel tk={tk} w={c === 1 ? "70%" : "55%"} h={12} /></td>
                      ))}
                      <td style={{ padding: "12px 16px" }}><Skel tk={tk} w={16} h={12} /></td>
                    </tr>
                  ))
                ) : orders.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState tk={tk} title={tr("sales_no_results", "Sin resultados")} hint={tr("sales_no_results_hint", "Ajusta los filtros o crea un nuevo pedido.")} /></td></tr>
                ) : (
                  orders.map((o, i) => {
                    const sc = statusColors(tk, o.status);
                    return (
                      <tr key={o.id} onClick={() => openDetail(o)} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = tk.panel3)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? tk.panel : tk.panel2)}>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: tk.accent, fontWeight: 700 }}>{o.folio}{o.kind === "quote" && <span style={{ fontSize: 10, color: tk.textLo, fontWeight: 600 }}> · COT</span>}</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi }}>{o.customer?.name ?? tr("sales_no_customer", "Mostrador")}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{dateShort(o.created_at)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{paymentLabel(o.payment_method)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi, fontWeight: 700 }}>{money(o.total_amount)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: o.balance > 0 ? tk.warn : tk.textLo }}>{money(o.balance)}</td>
                        <td style={{ padding: "12px 16px" }}><Badge tk={tk} bg={sc.bg} color={sc.text} border={sc.border}>{statusMeta(o.status).label}</Badge></td>
                        <td style={{ padding: "12px 16px" }}><ChevronRight size={16} color={tk.textLo} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > PAGE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${tk.border}` }}>
              <span style={{ fontSize: 13, color: tk.textLo }}>{total} {tr("sales_results", "resultados")}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button tk={tk} variant="subtle" disabled={page === 0 || ordersLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</Button>
                <span style={{ fontSize: 13, color: tk.textMid }}>{page + 1} / {pages}</span>
                <Button tk={tk} variant="subtle" disabled={page + 1 >= pages || ordersLoading} onClick={() => setPage((p) => p + 1)}>›</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <OrderForm tk={tk} tr={tr} open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={handleSubmit} editing={editing} customers={customers} variants={variants} saving={saving} />
      <PaymentModal tk={tk} tr={tr} open={!!payTarget} onClose={() => setPayTarget(null)} order={payTarget} onSubmit={handlePay} saving={saving} />
      <OrderDrawer tk={tk} tr={tr} order={selected} onClose={() => setSelected(null)} onEdit={openEdit} onPay={(o) => { setPayTarget(o); }} onMarkPaid={markPaid} onConvert={convert} onCancel={cancel} onInvoice={invoice} />
    </div>
  );
}

// ── Skeleton primitive (theme-aware shimmer) ────────────────────────────────
function Skel({ tk, w, h, r = 8, style }: { tk: Tokens; w: number | string; h: number | string; r?: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: `linear-gradient(90deg, ${tk.panel2} 25%, ${tk.panel3} 37%, ${tk.panel2} 63%)`,
      backgroundSize: "400% 100%", animation: "kt-shimmer 1.4s ease infinite",
      ...style,
    }} />
  );
}

function ShimmerKeyframes() {
  return <style>{`@keyframes kt-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>;
}

function extractErr(e: unknown): string {
  const anyE = e as { response?: { data?: { detail?: string } } };
  return anyE?.response?.data?.detail ?? "Ocurrió un error. Intenta de nuevo.";
}
