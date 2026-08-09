// Dashboard Ejecutivo — reemplaza el Tablero anterior. Consume /dashboard/executive
// que agrega ventas, forecast, mapa MX, cartera, alertas, etc.
//
// Diseño según requerimiento del cliente:
// - Fila 1: 6 KPIs ejecutivos (Ingresos, Utilidad, Pedidos, Ticket, Margen, Meta)
// - Fila 2: Ventas del período (línea) | Meta vs Real (gauge) | Top 5 Clientes
// - Fila 3: Ingresos vs Gastos | Mapa MX + Top 5 estados | KPIs Operativos
// - Fila 4: Ventas por Canal (donut) | Alertas Tempranas | KPIs Financieros
//
// Todos los KPIs son clickeables y navegan al módulo relevante.

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  TrendingUp, TrendingDown, Package, ShoppingCart, Target,
  DollarSign, RefreshCw, Building2, AlertTriangle, MapPin, CreditCard,
} from "lucide-react";
import { dashboardApi } from "./api";
import MexicoMap from "./MexicoMap";
import LiquidCore from "../../components/LiquidCore";
import type {
  ExecutiveDashboardResponse, ExecKPI, TopCustomerRow,
  ChannelSalesRow, AlertRow, OperationalKPIRow, FinancialKPIRow,
  GeoStateRow, TrendPoint,
} from "./types";

type Tokens = any;

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = (n: number) => (n || 0).toLocaleString("es-MX");

interface Props {
  t: Tokens;
  lang?: "es" | "en";
  setPage?: (page: string) => void;
  isMobile?: boolean;
}

// Diccionario mínimo para los strings visibles del dashboard.
// El resto del app ya se traduce por su cuenta; aquí sólo cubrimos textos
// hard-coded en este archivo para que el toggle idioma tenga efecto visible.
const I18N = {
  es: {
    title: "Matriz de Indicadores", from: "Del", to: "al",
    refresh: "Actualizar", loading: "Calculando indicadores…",
    error: "Error", retry: "Reintentar", year: "1 año",
    salesPeriod: "Ventas del período", vsPrev: "Actual vs anterior",
    metaVsReal: "Meta vs Real", monthLabel: "Mes",
    basisForecast: "Contra forecast", basisPrev: "Contra mes anterior", basisNone: "Sin referencia",
    noMeta: "Sin meta ni ventas del mes anterior para comparar",
    top5Cust: "Top 5 Clientes", ofPeriod: "del período",
    incomeExpenses: "Tendencia Ingresos vs Gastos", income: "Ingresos", expenses: "Gastos",
    geoDist: "Distribución Geográfica", salesByState: "Ventas por estado",
    opKpis: "KPIs Operativos", channels: "Ventas por Canal",
    alerts: "Alertas Tempranas", top5: "Top 5", finKpis: "KPIs Financieros",
    ofGoal: "DE LA META", current: "Actual", previous: "Anterior",
    top5states: "Top 5 estados", noGeo: "Sin ventas geolocalizadas",
    noChannel: "Sin ventas por canal", noAlerts: "Sin alertas activas ✓",
    noSalesPeriod: "Sin ventas en el período",
    ordersW: (n:number) => `${n} pedido${n!==1?"s":""}`,
    statesWithSales: (n:number) => `México · ${n} estados con venta`,
  },
  en: {
    title: "Dashboard", from: "From", to: "to",
    refresh: "Refresh", loading: "Computing dashboard…",
    error: "Error", retry: "Retry", year: "1 year",
    salesPeriod: "Sales in period", vsPrev: "Current vs previous",
    metaVsReal: "Target vs Actual", monthLabel: "Month",
    basisForecast: "vs forecast", basisPrev: "vs previous month", basisNone: "No reference",
    noMeta: "No target nor previous-month sales to compare",
    top5Cust: "Top 5 Customers", ofPeriod: "of the period",
    incomeExpenses: "Income vs Expenses", income: "Income", expenses: "Expenses",
    geoDist: "Geographic Distribution", salesByState: "Sales by state",
    opKpis: "Operational KPIs", channels: "Sales by Channel",
    alerts: "Early Alerts", top5: "Top 5", finKpis: "Financial KPIs",
    ofGoal: "OF TARGET", current: "Current", previous: "Previous",
    top5states: "Top 5 states", noGeo: "No geolocated sales",
    noChannel: "No channel sales", noAlerts: "No active alerts ✓",
    noSalesPeriod: "No sales in the period",
    ordersW: (n:number) => `${n} order${n!==1?"s":""}`,
    statesWithSales: (n:number) => `Mexico · ${n} states with sales`,
  },
} as const;

const KPI_ICON: Record<string, any> = {
  income_total: DollarSign,
  net_profit: TrendingUp,
  orders: Package,
  avg_ticket: ShoppingCart,
  margin_pct: Target,
  receivables: CreditCard,
};

const KPI_NAV: Record<string, string> = {
  income_total: "ventas",
  net_profit: "ventas",
  orders: "ventas",
  avg_ticket: "ventas",
  margin_pct: "reportes",
  receivables: "finanzas",
};

function colorForHint(t: Tokens, hint?: string | null): string {
  switch (hint) {
    case "good": return t.good || "#22c55e";
    case "warn": return t.warn || "#f59e0b";
    case "bad": return t.bad || "#ef4444";
    default: return t.textHi || "#e5e7eb";
  }
}

export default function ExecutiveDashboard({ t, lang = "es", setPage, isMobile = false }: Props) {
  const [data, setData] = useState<ExecutiveDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const L = I18N[lang] || I18N.es;
  const locale = lang === "en" ? "en-US" : "es-MX";

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const end = new Date();
      const start = new Date(); start.setDate(end.getDate() - days);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const r = await dashboardApi.executive({ start: iso(start), end: iso(end) });
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Error al cargar dashboard");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [days]);

  const nav = (page?: string) => { if (page && setPage) setPage(page); };

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>{L.loading}</div>;
  if (error) {
    return (
      <div style={{ padding: 20, color: t.bad, background: t.bad + "18", borderRadius: 10, textAlign: "center" }}>
        <AlertTriangle size={24} />
        <div style={{ marginTop: 8, fontSize: 14 }}>{L.error}: {error}</div>
        <button onClick={load} style={{ marginTop: 12, padding: "6px 14px", background: t.nova, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{L.retry}</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div style={{ padding: isMobile ? 12 : 20, maxWidth: 1500, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isMobile ? 12 : 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, color: t.textHi }}>{L.title}</h1>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3 }}>
            {L.from} {new Date(data.period_start).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
            {" "}{L.to}{" "}
            {new Date(data.period_end).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[7, 30, 90, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${t.border}`,
                        background: days === d ? t.nova : "transparent",
                        color: days === d ? "#fff" : t.textMid,
                        cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {d === 7 ? "7d" : d === 30 ? "30d" : d === 90 ? "90d" : L.year}
            </button>
          ))}
          <button onClick={load} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <RefreshCw size={12} /> {L.refresh}
          </button>
        </div>
      </div>

      {/* Fila 1: 6 KPIs principales (móvil: 2×3) */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))", gap: isMobile ? 8 : 10, marginBottom: isMobile ? 10 : 14 }}>
        {data.kpis.map(k => <KPITile key={k.key} kpi={k} t={t} isMobile={isMobile} onClick={() => nav(KPI_NAV[k.key])} />)}
      </div>

      {/* Fila 2: Ventas del período + Meta vs Real + Top 5 Clientes */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 14 }}>
        <PanelCard t={t} title={L.salesPeriod} subtitle={L.vsPrev}>
          <SalesTrendChart data={data.trend_sales} t={t} L={L} />
        </PanelCard>
        <PanelCard
          t={t}
          title={L.metaVsReal}
          subtitle={
            data.meta_vs_real.basis === "previous_period" ? L.basisPrev
            : data.meta_vs_real.basis === "none" ? L.basisNone
            : L.basisForecast
          }
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
            {data.meta_vs_real.goal > 0 ? (
              <>
                <LiquidCore
                  pct={data.meta_vs_real.achieved_pct}
                  t={t}
                  sub={L.ofGoal}
                  hue={data.meta_vs_real.achieved_pct >= 60 ? "green" : "blue"}
                />
                <div style={{ fontSize: 11, color: t.textLo, textAlign: "center" }}>
                  <b style={{ color: t.textHi }}>{mxn(data.meta_vs_real.real)}</b>
                  {" / "}{mxn(data.meta_vs_real.goal)}
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 28, color: t.textHi, fontWeight: 800 }}>
                  {mxn(data.meta_vs_real.real)}
                </div>
                <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4, maxWidth: 220 }}>
                  {L.noMeta}
                </div>
              </div>
            )}
          </div>
        </PanelCard>
        <PanelCard t={t} title={L.top5Cust} subtitle={L.ofPeriod}>
          <TopCustomers rows={data.top_customers} t={t} L={L} onSelect={(id) => id && nav("clientes")} />
        </PanelCard>
      </div>

      {/* Fila 3: Ingresos vs Gastos + Mapa MX + KPIs Operativos */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)", gap: isMobile ? 10 : 12, marginBottom: isMobile ? 10 : 14 }}>
        <PanelCard t={t} title={L.incomeExpenses}>
          <IncomeExpensesChart data={data.trend_income_expenses} t={t} L={L} />
        </PanelCard>
        <PanelCard t={t} title={L.geoDist} subtitle={L.salesByState}>
          <GeoMap geo={data.geographic} t={t} L={L} isMobile={isMobile} />
        </PanelCard>
        <PanelCard t={t} title={L.opKpis}>
          <OperationalBars kpis={data.operational_kpis} t={t} />
        </PanelCard>
      </div>

      {/* Fila 4: Canales + Alertas + Financieros */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)", gap: isMobile ? 10 : 12 }}>
        <PanelCard t={t} title={L.channels}>
          <ChannelDonut data={data.channel_sales.channels} total={data.channel_sales.total_revenue} t={t} L={L} />
        </PanelCard>
        <PanelCard t={t} title={L.alerts} subtitle={L.top5}>
          <AlertList alerts={data.alerts} t={t} L={L} onClick={(a) => nav(a.module === "finance" ? "finanzas" : a.module === "retail" ? "retail" : "inventario")} />
        </PanelCard>
        <PanelCard t={t} title={L.finKpis}>
          <FinancialKPIs kpis={data.financial_kpis} t={t} onClick={() => nav("contabilidad")} />
        </PanelCard>
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ────────────────────────────────────────────────────────────────────────

function PanelCard({ t, title, subtitle, children }: { t: Tokens; title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", minHeight: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 10.5, color: t.textLo }}>{subtitle}</div>}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}


function KPITile({ kpi, t, isMobile, onClick }: { kpi: ExecKPI; t: Tokens; isMobile?: boolean; onClick?: () => void }) {
  const Icon = KPI_ICON[kpi.key] || DollarSign;
  const color = colorForHint(t, kpi.color_hint);
  const deltaSign = kpi.delta_pct == null ? null : kpi.delta_pct >= 0 ? "▲" : "▼";
  const deltaColor = kpi.delta_pct == null ? t.textLo
    : kpi.delta_pct >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444");

  const isMeta = kpi.key === "margin_pct";
  return (
    <div onClick={onClick}
      style={{
        padding: isMobile ? 10 : 14, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
        cursor: onClick ? "pointer" : "default", position: "relative", overflow: "hidden",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius: 8, background: color + "22", color: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={isMobile ? 14 : 16} />
        </div>
      </div>
      <div style={{ fontSize: isMobile ? 9.5 : 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginTop: isMobile ? 8 : 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.label}</div>
      {isMeta ? (
        <MiniGauge value_pct={kpi.value} color={color} t={t} display={kpi.display} />
      ) : (
        <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: t.textHi, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{kpi.display}</div>
      )}
      {kpi.delta_pct != null && (
        <div style={{ fontSize: isMobile ? 10 : 11, color: deltaColor, marginTop: 4, fontWeight: 700 }}>
          {deltaSign} {Math.abs(kpi.delta_pct).toFixed(1)}%
          {!isMobile && <span style={{ color: t.textLo, fontWeight: 400 }}> {kpi.sub}</span>}
        </div>
      )}
      {kpi.delta_pct == null && kpi.sub && (
        <div style={{ fontSize: isMobile ? 9.5 : 10.5, color: t.textLo, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{kpi.sub}</div>
      )}
    </div>
  );
}


function MiniGauge({ value_pct, color, t, display }: { value_pct: number; color: string; t: Tokens; display: string }) {
  const pct = Math.max(0, Math.min(100, value_pct));
  const size = 62;
  const cx = size / 2, cy = size / 2;
  const r = 24;
  const circ = 2 * Math.PI * r;
  const arc = (pct / 100) * circ * 0.75; // 3/4 circle
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
      <svg width={size} height={size} style={{ transform: "rotate(135deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.border} strokeWidth="6" strokeDasharray={`${circ * 0.75} ${circ}`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{display}</div>
    </div>
  );
}


// Hook: índice del data-point bajo el mouse, o null.
// Si el dataset está vacío o tiene un solo punto, no calcula índice — evita
// crash accediendo a data[0] en un array vacío.
function useHoverIndex(len: number) {
  const [idx, setIdx] = useState<number | null>(null);
  const [mouseX, setMouseX] = useState(0);
  const [mouseY, setMouseY] = useState(0);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (len <= 0) { setIdx(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(len - 1, Math.round(rel * Math.max(1, len - 1))));
    setIdx(i);
    setMouseX(e.clientX - rect.left);
    setMouseY(e.clientY - rect.top);
  };
  const onLeave = () => setIdx(null);
  return { idx, mouseX, mouseY, onMove, onLeave };
}


function SalesTrendChart({ data, t, L }: { data: TrendPoint[]; t: Tokens; L: any }) {
  const safe = data || [];
  const maxVal = Math.max(1, ...safe.map(d => Math.max(d.revenue || 0, d.prev_revenue || 0)));
  const W = 100, H = 60;
  const step = safe.length > 1 ? W / (safe.length - 1) : W;
  const buildPath = (getVal: (d: TrendPoint) => number) =>
    safe.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - ((getVal(d) || 0) / maxVal) * H).toFixed(2)}`).join(" ");
  const lineCur = buildPath(d => d.revenue);
  const linePrev = buildPath(d => d.prev_revenue);
  const { idx, mouseX, mouseY, onMove, onLeave } = useHoverIndex(safe.length);
  const hovered = idx != null && safe[idx] ? safe[idx] : null;

  return (
    <div style={{ width: "100%", height: 180, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: t.textLo, marginBottom: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.nova, marginRight: 4 }} /> {L.current}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.textLo, opacity: 0.5, marginRight: 4 }} /> {L.previous}</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }} onMouseMove={onMove} onMouseLeave={onLeave}>
        <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          <path d={linePrev} stroke={t.textLo} strokeWidth="1.5" fill="none" strokeDasharray="4,4" opacity="0.6" vectorEffect="non-scaling-stroke" />
          <path d={lineCur} stroke={t.nova} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {idx != null && safe[idx] && (
            <>
              <line x1={idx * step} y1="0" x2={idx * step} y2={H} stroke={t.textLo} strokeWidth="1" strokeDasharray="2,2" opacity="0.7" vectorEffect="non-scaling-stroke" />
              <circle cx={idx * step} cy={H - ((safe[idx].revenue || 0) / maxVal) * H} r="1.2" fill={t.nova} vectorEffect="non-scaling-stroke" />
              <circle cx={idx * step} cy={H - ((safe[idx].prev_revenue || 0) / maxVal) * H} r="1" fill={t.textLo} opacity="0.7" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hovered && (
          <ChartTooltip t={t} x={mouseX} y={mouseY} title={hovered.label} rows={[
            { label: L.current, value: mxn(hovered.revenue), color: t.nova },
            { label: L.previous, value: mxn(hovered.prev_revenue), color: t.textLo },
          ]} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: t.textLo, marginTop: 4 }}>
        {safe.filter((_, i) => i === 0 || i === Math.floor(safe.length / 2) || i === safe.length - 1).map(d => <span key={d.period}>{d.label}</span>)}
      </div>
    </div>
  );
}


function ChartTooltip({ t, x, y, title, rows }: {
  t: Tokens; x: number; y: number; title: string;
  rows: { label: string; value: string; color: string }[];
}) {
  return (
    <div style={{
      position: "absolute", left: Math.min(x + 12, 999), top: Math.max(y - 40, 0),
      background: t.panel || t.panel2 || "rgba(15,20,30,0.92)",
      border: `1px solid ${t.border}`,
      borderRadius: 6, padding: "6px 8px", pointerEvents: "none",
      fontSize: 11, whiteSpace: "nowrap", zIndex: 10,
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      transform: x > 200 ? "translateX(-100%) translateX(-24px)" : undefined,
    }}>
      <div style={{ color: t.textHi, fontWeight: 700, marginBottom: 3 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: "inline-block" }} />
          <span style={{ color: t.textMid }}>{r.label}:</span>
          <b style={{ color: t.textHi, marginLeft: "auto" }}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}


function IncomeExpensesChart({ data, t, L }: { data: TrendPoint[]; t: Tokens; L: any }) {
  const safe = data || [];
  const maxVal = Math.max(1, ...safe.map(d => Math.max(d.revenue || 0, d.expenses || 0)));
  const W = 100, H = 60;
  const step = safe.length > 1 ? W / (safe.length - 1) : W;
  const areaRev = safe.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - ((d.revenue || 0) / maxVal) * H).toFixed(2)}`).join(" ")
                    + ` L ${W} ${H} L 0 ${H} Z`;
  const lineExp = safe.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - ((d.expenses || 0) / maxVal) * H).toFixed(2)}`).join(" ");
  const { idx, mouseX, mouseY, onMove, onLeave } = useHoverIndex(safe.length);
  const hovered = idx != null && safe[idx] ? safe[idx] : null;

  return (
    <div style={{ width: "100%", height: 180, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: t.textLo, marginBottom: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.good, marginRight: 4 }} /> {L.income}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.bad, marginRight: 4 }} /> {L.expenses}</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }} onMouseMove={onMove} onMouseLeave={onLeave}>
        <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          <path d={areaRev} fill={t.good} opacity="0.15" />
          <path d={areaRev.replace(` L ${W} ${H} L 0 ${H} Z`, "")} stroke={t.good} strokeWidth="2" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={lineExp} stroke={t.bad} strokeWidth="2" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {idx != null && safe[idx] && (
            <>
              <line x1={idx * step} y1="0" x2={idx * step} y2={H} stroke={t.textLo} strokeWidth="1" strokeDasharray="2,2" opacity="0.7" vectorEffect="non-scaling-stroke" />
              <circle cx={idx * step} cy={H - ((safe[idx].revenue || 0) / maxVal) * H} r="1.2" fill={t.good} vectorEffect="non-scaling-stroke" />
              <circle cx={idx * step} cy={H - ((safe[idx].expenses || 0) / maxVal) * H} r="1.2" fill={t.bad} vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
        {hovered && (
          <ChartTooltip t={t} x={mouseX} y={mouseY} title={hovered.label} rows={[
            { label: L.income, value: mxn(hovered.revenue), color: t.good },
            { label: L.expenses, value: mxn(hovered.expenses), color: t.bad },
          ]} />
        )}
      </div>
    </div>
  );
}


function TopCustomers({ rows, t, L, onSelect }: { rows: TopCustomerRow[]; t: Tokens; L: any; onSelect?: (id?: number | null) => void }) {
  if (!rows?.length) return <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>{L.noSalesPeriod}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((c, i) => (
        <div key={i} onClick={() => onSelect?.(c.customer_id)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: t.panel2, borderRadius: 6, cursor: onSelect && c.customer_id ? "pointer" : "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: t.nova + "22", color: t.nova, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: t.textLo }}>{L.ordersW(c.orders)}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{mxn(c.total)}</div>
            {c.delta_pct != null && (
              <div style={{ fontSize: 10, color: c.delta_pct >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444") }}>
                {c.delta_pct >= 0 ? "▲" : "▼"} {Math.abs(c.delta_pct).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}


function GeoMap({ geo, t, L, isMobile }: { geo: { by_state: GeoStateRow[]; top5: GeoStateRow[]; total_revenue: number }; t: Tokens; L: any; isMobile?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr", gap: 12, minHeight: isMobile ? 420 : 260 }}>
      <div style={{ position: "relative", background: t.panel2, borderRadius: 8, overflow: "hidden", minHeight: isMobile ? 240 : 240 }}>
        <MexicoMap t={t} data={geo.by_state || []} />
        <div style={{ position: "absolute", bottom: 6, left: 8, fontSize: 9, color: t.textLo, pointerEvents: "none" }}>
          {L.statesWithSales(geo.by_state?.length || 0)}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
        <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{L.top5states}</div>
        {(!geo.top5?.length) && <div style={{ color: t.textLo, fontSize: 11 }}>{L.noGeo}</div>}
        {(geo.top5 || []).map((s, i) => (
          <div key={s.state_code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 8px", background: t.panel2, borderRadius: 6 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11.5, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {s.state_name}</div>
              <div style={{ fontSize: 9.5, color: t.textLo }}>{num(s.units)}u · {s.orders_count} ped.</div>
            </div>
            <div style={{ textAlign: "right", marginLeft: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.textHi }}>{mxn(s.revenue)}</div>
              <div style={{ fontSize: 10, color: t.nova }}>{s.share_pct.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function OperationalBars({ kpis, t }: { kpis: OperationalKPIRow[]; t: Tokens }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 0" }}>
      {kpis.map(k => {
        const color = colorForHint(t, k.color_hint);
        return (
          <div key={k.key}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <div style={{ fontSize: 12, color: t.textMid }}>{k.label}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: color }}>{k.value_pct.toFixed(0)}%</div>
            </div>
            <div style={{ width: "100%", height: 8, background: t.panel2, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, k.value_pct)}%`, height: "100%", background: color, transition: "width 0.3s" }} />
            </div>
            {k.hint && <div style={{ fontSize: 10, color: t.textLo, marginTop: 3 }}>{k.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}


function ChannelDonut({ data, total, t, L }: { data: ChannelSalesRow[]; total: number; t: Tokens; L: any }) {
  const palette = [t.nova || "#33B2F5", t.good || "#22c55e", t.warn || "#f59e0b", "#a855f7", "#ec4899", t.textLo];
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data?.length || total === 0) return <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>{L.noChannel}</div>;
  const cx = 50, cy = 50, r = 34, w = 12;
  let accum = 0;
  const arcs = data.map((d, i) => {
    const start = accum;
    const share = d.revenue / total;
    accum += share;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = accum * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = share > 0.5 ? 1 : 0;
    const d_ = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    const isHover = hoverIdx === i;
    return (
      <path key={i} d={d_}
        stroke={palette[i % palette.length]}
        strokeWidth={isHover ? w + 3 : w}
        fill="none"
        opacity={hoverIdx == null || isHover ? 1 : 0.4}
        style={{ cursor: "pointer", transition: "stroke-width 0.15s, opacity 0.15s" }}
        onMouseEnter={() => setHoverIdx(i)}
        onMouseLeave={() => setHoverIdx(null)}
      />
    );
  });
  const focused = hoverIdx != null ? data[hoverIdx] : data[0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: 180 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>{arcs}</svg>
        <div style={{ position: "absolute", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{focused ? focused.share_pct.toFixed(0) : 0}%</div>
          <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase" }}>{focused?.label || "—"}</div>
          {hoverIdx != null && focused && (
            <div style={{ fontSize: 10.5, color: t.textMid, marginTop: 3 }}>
              {mxn(focused.revenue)} · {focused.orders} ped.
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        {data.map((d, i) => (
          <div key={i}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 11,
              padding: "3px 4px", borderRadius: 4, cursor: "pointer",
              background: hoverIdx === i ? t.panel2 : "transparent",
              transition: "background 0.15s",
            }}>
            <div style={{ width: 10, height: 10, background: palette[i % palette.length], borderRadius: 2 }} />
            <div style={{ flex: 1, color: t.textMid }}>{d.label}</div>
            <div style={{ color: t.textHi, fontWeight: 700 }}>{mxn(d.revenue)}</div>
            <div style={{ color: t.textLo, fontSize: 10, width: 34, textAlign: "right" }}>{d.share_pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}


function AlertList({ alerts, t, L, onClick }: { alerts: AlertRow[]; t: Tokens; L: any; onClick?: (a: AlertRow) => void }) {
  if (!alerts?.length) return <div style={{ color: t.good, fontSize: 12, textAlign: "center", padding: 20 }}>{L.noAlerts}</div>;
  const sevColor = (s: string) => s === "urgent" ? (t.bad || "#ef4444") : s === "high" ? (t.warn || "#f59e0b") : t.nova;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {alerts.map((a, i) => (
        <div key={i} onClick={() => onClick?.(a)}
          style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", background: t.panel2, borderRadius: 6, cursor: onClick ? "pointer" : "default" }}>
          <span style={{ padding: "2px 6px", borderRadius: 4, background: sevColor(a.severity) + "22", color: sevColor(a.severity), fontSize: 9.5, fontWeight: 800 }}>
            {a.label}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
            {a.subtitle && <div style={{ fontSize: 10, color: t.textLo, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.subtitle}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}


function FinancialKPIs({ kpis, t, onClick }: { kpis: FinancialKPIRow[]; t: Tokens; onClick?: () => void }) {
  const statusColor = (s: string) => s === "good" ? (t.good || "#22c55e") : s === "warn" ? (t.warn || "#f59e0b") : s === "bad" ? (t.bad || "#ef4444") : t.textLo;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {kpis.map(k => (
        <div key={k.key} onClick={onClick}
          title={onClick ? "Ir a Contabilidad → Balance General" : undefined}
          style={{
            padding: 10, background: k.available ? t.panel2 : (t.panel2 + "88"),
            borderRadius: 8, border: k.available ? "none" : `1px dashed ${t.border}`,
            cursor: onClick ? "pointer" : "default",
            transition: "transform 0.12s, box-shadow 0.12s",
          }}
          onMouseEnter={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)"; }}
          onMouseLeave={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = "none"; }}
        >
          <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>{k.label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: k.available ? statusColor(k.status) : t.textLo, fontVariantNumeric: "tabular-nums" }}>{k.display}</div>
          {k.subtitle && <div style={{ fontSize: 9.5, color: t.textLo, marginTop: 2 }}>{k.subtitle}</div>}
        </div>
      ))}
    </div>
  );
}
