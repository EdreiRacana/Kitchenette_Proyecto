// Dashboard Ejecutivo — Rediseno "Tablero Sthenova" (mockup b92bdb2b aprobado).
// Consume /dashboard/executive (agrega ventas, forecast, cartera, alertas, etc).
//
// Estructura visual:
//  Fila 1: 6 KPIs hero (Ingresos, Utilidad, Pedidos, Ticket, Margen, CxC)
//          — accent bar top, icono, sparkline decorativa, hover chevron
//  Fila 2: Ventas del periodo (span 8) + Top 5 clientes (span 4)
//  Fila 3: Meta vs Real (esfera liquida) + Ventas por canal (donut) + KPIs operativos
//  Fila 4: Alertas tempranas + Distribucion geografica (mapa + top 3) + KPIs financieros
//
// Todos los KPIs y widgets clickeables navegan al modulo relevante.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  TrendingUp, Package, ShoppingCart, Target,
  DollarSign, RefreshCw, AlertTriangle, CreditCard, ChevronRight,
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

// Convierte "#RRGGBB" a rgba(r,g,b,alpha). Si el input no es hex, lo devuelve tal cual.
function withAlpha(hex: string | undefined, a: number): string {
  if (!hex) return `rgba(19, 28, 46, ${a})`;
  if (hex.startsWith("rgba")) return hex;
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Estilo "cristal" (glassmorphism) para contenedores. Fondo semi-transparente
// + blur del fondo detras. Fallback a color solido en navegadores sin support.
function glass(t: Tokens, alpha = 0.55): CSSProperties {
  const base = t.panel || "#131C2E";
  return {
    background: withAlpha(base, alpha),
    backdropFilter: "blur(14px) saturate(140%)",
    WebkitBackdropFilter: "blur(14px) saturate(140%)",
    borderColor: withAlpha(t.textHi || "#E8EEFA", 0.09),
  };
}

// Genera path SVG suavizado (curva Catmull-Rom → cubic Bezier). Elimina las
// puntas angulares del grafico de linea.
function smoothPath(points: { x: number; y: number }[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Normaliza para lookup case-insensitive y sin acentos, colapsando espacios.
// Asi "Ingresos Totales", "ingresos totales", "Ingresos  Totales" comparten
// entrada en el diccionario.
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Diccionario ES → EN normalizado. Keys en lowercase sin acentos. Cubre todos
// los textos que llegan del backend en /dashboard/executive (revisado contra
// backend/app/modules/dashboard/service.py, agosto 2026).
const ES_EN_RAW: Record<string, string> = {
  // KPI hero labels
  "Ingresos Totales": "Total Revenue",
  "Ingresos": "Revenue",
  "Utilidad Neta": "Net Profit",
  "Pedidos": "Orders",
  "Ticket Promedio": "Avg. Ticket",
  "Margen de Ganancia": "Profit Margin",
  "Margen": "Margin",
  "Cuentas por Cobrar": "Accounts Receivable",
  // KPI subs
  "vs. periodo anterior": "vs. previous period",
  "vs periodo anterior": "vs previous period",
  "Utilidad / Ingresos": "Profit / Revenue",
  // Operational KPI labels
  "Cumplimiento de meta": "Goal Achievement",
  "Margen neto vs objetivo": "Net Margin vs Target",
  "Cobranza del período": "Collections in Period",
  "Salud del inventario": "Inventory Health",
  // Operational KPI hints
  "Real vs forecast del mes": "Actual vs monthly forecast",
  "Objetivo 25% margen": "Target 25% margin",
  "Pagado / Vendido": "Paid / Sold",
  "% SKUs sobre punto de reorden": "% SKUs above reorder point",
  // Alertas labels (uppercase tags)
  "CARTERA": "AR",
  "RETAIL": "RETAIL",
  "STOCK": "STOCK",
  "INVENTARIO": "INVENTORY",
  "FINANZAS": "FINANCE",
  // Alertas title / subtitle
  "Alerta retail": "Retail alert",
  // Financial KPI labels
  "Liquidez Corriente": "Current Ratio",
  "Endeudamiento": "Leverage",
  "Rotación de Inventario": "Inventory Turnover",
  "Días de Cobranza": "DSO (Days Sales Outstanding)",
  "Días de Pago": "DPO (Days Payable Outstanding)",
  // Financial KPI subtitles
  "COGS / Inventario prom.": "COGS / Avg. inventory",
  "Sin COGS o inventario capturado": "No COGS or inventory captured",
  "AR / Ventas × días": "AR / Sales × days",
  "Captura balance en Contabilidad": "Enter balance sheet in Accounting",
  "Sin datos": "No data",
  "Sin ventas en el periodo": "No sales in the period",
  // Meta bubble
  "de la meta": "of target",
  // Mapa
  "México": "Mexico",
};

const ES_EN: Record<string, string> = Object.fromEntries(
  Object.entries(ES_EN_RAW).map(([k, v]) => [normKey(k), v])
);

function tr(s: string | null | undefined, lang: "es" | "en"): string {
  if (s == null) return "";
  if (lang === "es") return s;

  // 1. Match exacto (normalizado)
  const nk = normKey(s);
  if (ES_EN[nk]) return ES_EN[nk];

  // 2. Patrones con valores dinamicos
  let out = s;

  // "Saldo pendiente $1,234.56"  → "Outstanding balance $1,234.56"
  out = out.replace(/^saldo\s+pendiente\s+/i, "Outstanding balance ");
  // "Sobreinventario en X"       → "Overstock in X"
  out = out.replace(/^sobreinventario\s+en\s+/i, "Overstock in ");
  // "Punto de reorden alcanzado" (con posible sufijo)
  out = out.replace(/^punto\s+de\s+reorden\s+alcanzado/i, "Reorder point reached");
  // "Disponible 4 / reorden 10"  → "Available 4 / reorder 10"
  out = out.replace(/^disponible\s+(\d+)\s*\/\s*reorden\s+(\d+)$/i, "Available $1 / reorder $2");
  // "Balance <periodo>"          → "Balance sheet <periodo>"
  out = out.replace(/^balance\s+/i, "Balance sheet ");
  out = out.replace(/\bsin\s+pasivo\s+corto\s+plazo/gi, "no short-term liabilities");
  out = out.replace(/\bsin\s+activo/gi, "no assets");

  // Sub del KPI CxC dinamico
  out = out.replace(/^(\d+)\s+[oó]rdenes?\s+con\s+saldo$/i, (_m, n) => `${n} order${n === "1" ? "" : "s"} with balance`);
  out = out.replace(/^(\d+)\s+pedidos?$/i, (_m, n) => `${n} order${n === "1" ? "" : "s"}`);

  // Unidades cortas
  out = out.replace(/(\d+)\s+d[ií]as?\s+atr[aá]s/gi, "$1 days ago");
  out = out.replace(/(\d+)\s+d[ií]as?/gi, "$1 days");
  out = out.replace(/(\d+)\s+sem\.?/gi, "$1 wk");
  out = out.replace(/(\d+)u\b/gi, "$1u");
  out = out.replace(/(\d+)\s+ped\.?/gi, "$1 ord.");
  out = out.replace(/^m[aá]x\s+/i, "max ");
  out = out.replace(/^rp:\s*/i, "reorder: ");

  return out;
}

interface Props {
  t: Tokens;
  lang?: "es" | "en";
  setPage?: (page: string) => void;
  isMobile?: boolean;
}

const I18N = {
  es: {
    title: "Matriz de indicadores", from: "Del", to: "al", subtitleSuffix: "Vista ejecutiva",
    refresh: "Actualizar", loading: "Calculando indicadores…",
    error: "Error", retry: "Reintentar", year: "1 año",
    custom: "Personalizado", startDate: "Desde", endDate: "Hasta", apply: "Aplicar",
    salesPeriod: "Ventas del periodo", vsPrev: "Actual vs periodo anterior",
    metaVsReal: "Meta vs Real",
    basisForecast: "Contra forecast", basisPrev: "Contra mes anterior", basisNone: "Sin referencia",
    noMeta: "Sin meta ni ventas del mes anterior para comparar",
    top5Cust: "Top 5 clientes", ofPeriod: "del periodo",
    geoDist: "Distribucion geografica", topStates: "Top 3 estados",
    opKpis: "KPIs operativos", opSub: "salud del negocio",
    channels: "Ventas por canal",
    alerts: "Alertas tempranas", top4: "Top 4", finKpis: "KPIs financieros", finSub: "indicadores clave",
    ofGoal: "de la meta",
    noGeo: "Sin ventas geolocalizadas",
    noChannel: "Sin ventas por canal", noAlerts: "Sin alertas activas ✓",
    noSalesPeriod: "Sin ventas en el periodo",
    vsAnterior: "vs anterior",
    chartCurrent: "Actual", chartPrev: "Periodo anterior",
    objective: "objetivo", anterior: "anterior",
    ordersW: (n: number) => `${n} pedido${n !== 1 ? "s" : ""}`,
    statesWithSales: (n: number) => `Mexico · ${n} estados con venta`,
    captureBalance: "Capturar balance",
    goToAccounting: "Ir a Contabilidad → Balance General",
    channelCol: "Canal", channelRevCol: "Ingreso", channelShareCol: "%",
  },
  en: {
    title: "Indicator matrix", from: "From", to: "to", subtitleSuffix: "Executive view",
    refresh: "Refresh", loading: "Computing dashboard…",
    error: "Error", retry: "Retry", year: "1 year",
    custom: "Custom", startDate: "From", endDate: "To", apply: "Apply",
    salesPeriod: "Sales in period", vsPrev: "Current vs previous period",
    metaVsReal: "Target vs Actual",
    basisForecast: "vs forecast", basisPrev: "vs previous month", basisNone: "No reference",
    noMeta: "No target nor previous-month sales to compare",
    top5Cust: "Top 5 customers", ofPeriod: "of the period",
    geoDist: "Geographic distribution", topStates: "Top 3 states",
    opKpis: "Operational KPIs", opSub: "business health",
    channels: "Sales by channel",
    alerts: "Early alerts", top4: "Top 4", finKpis: "Financial KPIs", finSub: "key indicators",
    ofGoal: "of target",
    noGeo: "No geolocated sales",
    noChannel: "No channel sales", noAlerts: "No active alerts ✓",
    noSalesPeriod: "No sales in the period",
    vsAnterior: "vs previous",
    chartCurrent: "Current", chartPrev: "Previous period",
    objective: "target", anterior: "previous",
    ordersW: (n: number) => `${n} order${n !== 1 ? "s" : ""}`,
    statesWithSales: (n: number) => `Mexico · ${n} states with sales`,
    captureBalance: "Enter balance",
    goToAccounting: "Go to Accounting → Balance Sheet",
    channelCol: "Channel", channelRevCol: "Revenue", channelShareCol: "%",
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

// Acentos por KPI segun el mockup.
const KPI_ACCENT: Record<string, string> = {
  income_total: "#33B2F5",
  net_profit: "#22C55E",
  orders: "#F59E0B",
  avg_ticket: "#A78BFA",
  margin_pct: "#22D3EE",
  receivables: "#EF4444",
};

const KPI_NAV: Record<string, string> = {
  income_total: "ventas",
  net_profit: "ventas",
  orders: "ventas",
  avg_ticket: "ventas",
  margin_pct: "reportes",
  receivables: "finanzas",
};

const CHANNEL_PALETTE = ["#33B2F5", "#22C55E", "#A78BFA", "#F59E0B", "#EC4899", "#5D6A85"];

export default function ExecutiveDashboard({ t, lang = "es", setPage, isMobile = false }: Props) {
  const [data, setData] = useState<ExecutiveDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number | "custom">(30);
  const isoToday = () => new Date().toISOString().slice(0, 10);
  const isoDaysAgo = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const [customStart, setCustomStart] = useState<string>(isoDaysAgo(30));
  const [customEnd, setCustomEnd] = useState<string>(isoToday());
  const baseL = I18N[lang] || I18N.es;
  const L = { ...baseL, tr: (s: string | null | undefined) => tr(s, lang) };
  const locale = lang === "en" ? "en-US" : "es-MX";

  const load = async () => {
    setLoading(true); setError(null);
    try {
      let start: string, end: string;
      if (days === "custom") {
        start = customStart; end = customEnd;
      } else {
        end = isoToday();
        start = isoDaysAgo(days);
      }
      const r = await dashboardApi.executive({ start, end });
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Error al cargar dashboard");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);
  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    if (customStart > customEnd) {
      alert(lang === "es" ? "La fecha inicial no puede ser mayor a la final" : "Start date must be before end date");
      return;
    }
    if (days === "custom") load();
    else setDays("custom");
  };

  const nav = (page?: string) => { if (page && setPage) setPage(page); };

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>{L.loading}</div>;
  if (error) {
    return (
      <div style={{ padding: 20, color: t.bad, background: (t.bad || "#ef4444") + "18", borderRadius: 10, textAlign: "center" }}>
        <AlertTriangle size={24} />
        <div style={{ marginTop: 8, fontSize: 14 }}>{L.error}: {error}</div>
        <button onClick={load} style={{ marginTop: 12, padding: "6px 14px", background: t.nova, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>{L.retry}</button>
      </div>
    );
  }
  if (!data) return null;

  // Sparkline serie base (para el KPI de Ingresos). El resto usa una serie
  // reducida derivada — o ninguna, si no hay datos.
  const salesSpark = (data.trend_sales || []).map(p => p.revenue || 0);
  const expensesSpark = (data.trend_income_expenses || []).map(p => p.expenses || 0);
  const profitSpark = (data.trend_income_expenses || []).map(p => (p.revenue || 0) - (p.expenses || 0));
  const kpiSparks: Record<string, number[]> = {
    income_total: salesSpark,
    net_profit: profitSpark,
    orders: [],
    avg_ticket: [],
    margin_pct: [],
    receivables: expensesSpark,
  };

  // Layout de la grid principal (12 columnas). Se colapsa a 1 columna en movil.
  const gridBase = isMobile
    ? { display: "grid", gridTemplateColumns: "1fr", gap: 10 }
    : { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 };

  const rangeBtn = (active: boolean): CSSProperties => ({
    padding: "6px 12px", fontSize: 12, fontWeight: 600,
    color: active ? "#fff" : t.textMid,
    borderRadius: 7, cursor: "pointer",
    border: "none", background: active ? t.nova : "transparent",
    transition: "background .15s, color .15s",
  });

  return (
    <div style={{ padding: isMobile ? 12 : "20px 24px 32px", maxWidth: 1600, margin: "0 auto" }}>
      {/* Page head */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontSize: isMobile ? 20 : 24, fontWeight: 700, letterSpacing: "-0.02em", color: t.textHi }}>
            {L.title}
          </h1>
          <div style={{ fontSize: 12, color: t.textLo }}>
            {L.from} {new Date(data.period_start).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
            {" "}{L.to}{" "}
            {new Date(data.period_end).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
            {"  ·  "}{L.subtitleSuffix}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3 }}>
            {[7, 30, 90, 365].map(d => (
              <button key={d} onClick={() => setDays(d)} style={rangeBtn(days === d)}>
                {d === 7 ? "7d" : d === 30 ? "30d" : d === 90 ? "90d" : L.year}
              </button>
            ))}
            <button onClick={() => setDays("custom")}
              style={{ ...rangeBtn(days === "custom"), background: days === "custom" ? t.nova : (t.panel2 || t.panel), color: days === "custom" ? "#fff" : t.textMid }}>
              {L.custom}
            </button>
          </div>
          {days === "custom" && (
            <div style={{ display: "flex", gap: 4, alignItems: "center", background: t.panel2, padding: "4px 6px", borderRadius: 8, border: `1px solid ${t.border}` }}>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} title={L.startDate}
                style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${t.border}`, background: t.panel, color: t.textHi, fontSize: 11.5, outline: "none" }} />
              <span style={{ fontSize: 11, color: t.textLo }}>{L.to}</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} title={L.endDate}
                style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${t.border}`, background: t.panel, color: t.textHi, fontSize: 11.5, outline: "none" }} />
              <button onClick={applyCustom}
                style={{ padding: "3px 10px", borderRadius: 4, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                {L.apply}
              </button>
            </div>
          )}
          <button onClick={load} title={L.refresh}
            style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel, color: t.textMid, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Fila 1 — 6 KPIs hero */}
      <div style={{ ...gridBase, marginBottom: 12 }}>
        {data.kpis.map(k => (
          <KpiHero key={k.key} kpi={k} t={t} isMobile={isMobile}
            accent={KPI_ACCENT[k.key] || t.nova}
            spark={kpiSparks[k.key] || []}
            L={L}
            onClick={() => nav(KPI_NAV[k.key])}
          />
        ))}
      </div>

      {/* Fila 2 — Ventas del periodo (8) + Distribucion geografica (4, mapa GRANDE) */}
      <div style={{ ...gridBase, marginBottom: 12 }}>
        <PanelCard t={t} title={L.salesPeriod} subtitle={L.vsPrev}
          hint={data.trend_sales?.length ? `${mxn(sumPoints(data.trend_sales, "revenue"))} / ${mxn(sumPoints(data.trend_sales, "prev_revenue"))} ${L.anterior}` : undefined}
          span={isMobile ? undefined : 8} minH={300}>
          <SalesTrendChart data={data.trend_sales || []} t={t} L={L} />
        </PanelCard>
        <PanelCard t={t} title={L.geoDist} hint={L.topStates}
          span={isMobile ? undefined : 4} minH={300}>
          <GeoBig geo={data.geographic} t={t} L={L} />
        </PanelCard>
      </div>

      {/* Fila 3 — Meta (4) + Canal (4) + Top 5 clientes (4) — compactas */}
      <div style={{ ...gridBase, marginBottom: 12 }}>
        <PanelCard t={t} title={L.metaVsReal}
          hint={
            data.meta_vs_real.basis === "previous_period" ? L.basisPrev
              : data.meta_vs_real.basis === "none" ? L.basisNone
                : L.basisForecast
          }
          span={isMobile ? undefined : 4} minH={210}>
          <MetaBubble data={data.meta_vs_real} t={t} L={L} />
        </PanelCard>

        <PanelCard t={t} title={L.channels} hint={L.ofPeriod}
          span={isMobile ? undefined : 4} minH={210}>
          <ChannelDonut data={data.channel_sales.channels || []} total={data.channel_sales.total_revenue} t={t} L={L} />
        </PanelCard>

        <PanelCard t={t} title={L.top5Cust} hint={L.ofPeriod}
          span={isMobile ? undefined : 4} minH={210}>
          <TopCustomers rows={data.top_customers || []} t={t} L={L}
            onSelect={(id) => id && nav("clientes")} />
        </PanelCard>
      </div>

      {/* Fila 4 — Alertas (4) + KPIs Op (4) + Financieros (4) */}
      <div style={{ ...gridBase }}>
        <PanelCard t={t} title={L.alerts} hint={L.top4}
          span={isMobile ? undefined : 4} minH={220}>
          <AlertList alerts={(data.alerts || []).slice(0, 4)} t={t} L={L}
            onClick={(a) => nav(a.module === "finance" ? "finanzas" : a.module === "retail" ? "retail" : "inventario")} />
        </PanelCard>

        <PanelCard t={t} title={L.opKpis} hint={L.opSub}
          span={isMobile ? undefined : 4} minH={220}>
          <OperationalBars kpis={data.operational_kpis || []} t={t} L={L} />
        </PanelCard>

        <PanelCard t={t} title={L.finKpis} hint={L.finSub}
          span={isMobile ? undefined : 4} minH={220}>
          <FinancialKPIs kpis={data.financial_kpis || []} t={t} L={L}
            onClick={() => nav("contabilidad")} />
        </PanelCard>
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ────────────────────────────────────────────────────────────────────────

function sumPoints(rows: TrendPoint[], key: "revenue" | "prev_revenue" | "expenses"): number {
  return (rows || []).reduce((acc, r) => acc + (Number((r as any)[key]) || 0), 0);
}


function PanelCard({
  t, title, subtitle, hint, children, span, minH,
}: {
  t: Tokens; title: string; subtitle?: string; hint?: string;
  children: any; span?: number; minH?: number;
}) {
  const style: CSSProperties = {
    ...glass(t, 0.55),
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    padding: "14px 16px",
    display: "flex", flexDirection: "column",
    minHeight: minH || 220,
    position: "relative",
    overflow: "hidden",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.18)",
  };
  if (span) style.gridColumn = `span ${span}`;
  return (
    <div style={style}>
      {/* Highlight superior tipo cristal */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 60,
        background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 100%)",
        pointerEvents: "none",
      }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 8, position: "relative" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: t.textLo, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {hint && <div style={{ fontSize: 10, color: t.textLo, fontVariantNumeric: "tabular-nums", textAlign: "right", flexShrink: 0 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</div>
    </div>
  );
}


function KpiHero({
  kpi, t, isMobile, accent, spark, L, onClick,
}: {
  kpi: ExecKPI; t: Tokens; isMobile?: boolean;
  accent: string; spark: number[]; L: any;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = KPI_ICON[kpi.key] || DollarSign;
  const deltaSign = kpi.delta_pct == null ? null : kpi.delta_pct >= 0 ? "▲" : "▼";
  const isFlat = kpi.delta_pct == null;
  const deltaColor = isFlat ? t.textLo
    : (kpi.delta_pct as number) >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444");

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        gridColumn: isMobile ? "span 1" : "span 2",
        position: "relative",
        display: "flex", flexDirection: "column",
        ...glass(t, 0.5),
        border: `1px solid ${hover ? accent + "77" : t.border}`,
        borderRadius: 12,
        padding: "14px 16px 12px",
        minHeight: 108,
        cursor: onClick ? "pointer" : "default",
        overflow: "hidden",
        transform: hover ? "translateY(-2px)" : "none",
        boxShadow: hover
          ? `0 10px 28px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)`
          : "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.15)",
        transition: "transform .15s ease, border-color .15s ease, box-shadow .15s ease",
      }}
    >
      {/* Accent bar top */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent, opacity: 0.6 }} />
      {/* Highlight cristal superior */}
      <div style={{
        position: "absolute", top: 2, left: 0, right: 0, height: 50,
        background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)",
        pointerEvents: "none",
      }} />

      {/* Chevron esquina */}
      <span style={{
        position: "absolute", top: 12, right: 12,
        width: 18, height: 18, display: "grid", placeItems: "center",
        color: accent, opacity: hover ? 1 : 0, transition: "opacity .15s",
      }}>
        <ChevronRight size={14} />
      </span>

      {/* Header: icono + titulo lado a lado, con tooltip nativo por si se trunca */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: accent + "26", color: accent,
          display: "grid", placeItems: "center", flexShrink: 0,
          boxShadow: `inset 0 0 0 1px ${accent}33`,
        }}>
          <Icon size={14} />
        </div>
        <div
          title={L.tr(kpi.label)}
          style={{
            fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase",
            color: t.textLo, fontWeight: 700,
            lineHeight: 1.2,
            minWidth: 0, flex: 1,
            whiteSpace: "normal", wordBreak: "normal", overflowWrap: "break-word",
          }}>{L.tr(kpi.label)}</div>
      </div>

      <div
        title={kpi.display}
        style={{
          fontSize: "clamp(20px, 1.6vw, 26px)",
          fontWeight: 700, color: t.textHi, lineHeight: 1.05, marginBottom: 4,
          fontVariantNumeric: "tabular-nums", letterSpacing: "-0.015em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{kpi.display}</div>

      <div style={{
        fontSize: 11, fontWeight: 600, color: deltaColor, marginTop: "auto",
        display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap",
      }}>
        {deltaSign && <span style={{ whiteSpace: "nowrap" }}>{deltaSign} {Math.abs(kpi.delta_pct as number).toFixed(1)}%</span>}
        {!deltaSign && <span>—</span>}
        <span style={{ color: t.textLo, fontWeight: 500, fontSize: 10.5 }}>
          {kpi.delta_pct != null ? L.vsAnterior : L.tr(kpi.sub || "")}
        </span>
      </div>

      {/* Sparkline decorativa (solo si hay datos) */}
      {spark.length > 1 && (
        <Sparkline values={spark} color={accent} />
      )}
    </div>
  );
}


function Sparkline({ values, color }: { values: number[]; color: string }) {
  // Compacta y translucida: refuerza el trend sin robar espacio al numero grande.
  const w = 48, h = 16;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(" ");
  return (
    <svg style={{ position: "absolute", right: 14, bottom: 10, width: w, height: h, opacity: 0.5, pointerEvents: "none" }}
      viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}


// ── Ventas del periodo — area + linea dashed anterior ───────────────
function SalesTrendChart({ data, t, L }: { data: TrendPoint[]; t: Tokens; L: any }) {
  const safe = data || [];
  if (!safe.length) return <EmptyMsg t={t} msg={L.noSalesPeriod} />;
  const maxVal = Math.max(1, ...safe.map(d => Math.max(d.revenue || 0, d.prev_revenue || 0)));
  const W = 720, H = 220;
  const padL = 44, padR = 30, padT = 12, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = safe.length > 1 ? innerW / (safe.length - 1) : innerW;
  const y = (v: number) => padT + innerH - ((v || 0) / maxVal) * innerH;
  const x = (i: number) => padL + i * step;

  // Curva suave: convierte los puntos a Bezier cubico (Catmull-Rom) para que
  // los picos sean redondeados en vez de puntas angulares.
  const points = (getV: (d: TrendPoint) => number) =>
    safe.map((d, i) => ({ x: x(i), y: y(getV(d)) }));
  const buildLine = (getV: (d: TrendPoint) => number) => smoothPath(points(getV));
  const buildArea = () => {
    const pts = points(d => d.revenue || 0);
    const curve = smoothPath(pts);
    if (!curve) return "";
    return `${curve} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  };

  const [hover, setHover] = useState<{ i: number; mx: number; my: number } | null>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const sx = rel * W;
    const i = Math.max(0, Math.min(safe.length - 1, Math.round((sx - padL) / step)));
    setHover({ i, mx: e.clientX - rect.left, my: e.clientY - rect.top });
  };
  const onLeave = () => setHover(null);

  // Y-axis marks (3): 0, maxVal/2, maxVal
  const yLabels = [maxVal, maxVal / 2, 0];
  // Fechas cada 3 dias (con techo de ~12 ticks para no saturar rangos largos).
  const xLabels = pickXTicks(safe, 3, 12);

  const nova = t.nova || "#33B2F5";
  const dim = t.textLo || "#5D6A85";
  const grid = (t.border || "#223154");
  const gid = `sales-grad-${useIdSuffix()}`;

  const cur = hover && safe[hover.i] ? safe[hover.i] : null;

  return (
    <div style={{ position: "relative", width: "100%", height: 160, display: "flex", flexDirection: "column" }}
      onMouseMove={onMove} onMouseLeave={onLeave}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={nova} stopOpacity="0.35" />
              <stop offset="100%" stopColor={nova} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Grid horizontal */}
          {yLabels.map((v, i) => (
            <line key={i} x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={grid} strokeWidth="0.5" opacity="0.6" />
          ))}
          {/* Y labels */}
          <g fontFamily="Inter, sans-serif" fontSize="11" fill={dim} fontWeight="500">
            {yLabels.map((v, i) => (
              <text key={i} x={padL - 6} y={y(v) + 3} textAnchor="end">{formatShort(v)}</text>
            ))}
          </g>
          {/* Periodo anterior dashed */}
          <path d={buildLine(d => d.prev_revenue || 0)} fill="none" stroke={dim} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.6" />
          {/* Area actual */}
          <path d={buildArea()} fill={`url(#${gid})`} />
          {/* Linea actual */}
          <path d={buildLine(d => d.revenue || 0)} fill="none" stroke={nova} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* Endpoint */}
          {safe.length > 0 && (
            <circle cx={x(safe.length - 1)} cy={y(safe[safe.length - 1].revenue || 0)} r="4" fill={nova} stroke={t.panel || "#0A111E"} strokeWidth="2" />
          )}
          {/* Hover crosshair */}
          {hover && safe[hover.i] && (
            <>
              <line x1={x(hover.i)} x2={x(hover.i)} y1={padT} y2={padT + innerH} stroke={dim} strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
              <circle cx={x(hover.i)} cy={y(safe[hover.i].revenue || 0)} r="3.5" fill={nova} stroke={t.panel || "#0A111E"} strokeWidth="1.5" />
              <circle cx={x(hover.i)} cy={y(safe[hover.i].prev_revenue || 0)} r="3" fill={dim} stroke={t.panel || "#0A111E"} strokeWidth="1.5" />
            </>
          )}
          {/* X labels */}
          <g fontFamily="Inter, sans-serif" fontSize="10.5" fill={dim} textAnchor="middle" fontWeight="500">
            {xLabels.map(i => (
              <text key={i} x={x(i)} y={H - 10}>{safe[i]?.label || ""}</text>
            ))}
          </g>
        </svg>
      </div>
      {cur && hover && (
        <ChartTooltip t={t} x={hover.mx} y={hover.my} title={cur.label} rows={[
          { label: L.salesPeriod, value: mxn(cur.revenue), color: nova },
          { label: L.vsPrev, value: mxn(cur.prev_revenue), color: dim },
        ]} />
      )}
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: t.textMid }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: nova, marginRight: 6, verticalAlign: "middle" }} />{L.chartCurrent}</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: dim, marginRight: 6, verticalAlign: "middle" }} />{L.chartPrev}</span>
      </div>
    </div>
  );
}


// Selecciona ticks del eje X con paso de `stepDays` (por defecto cada 3 dias),
// ampliando el paso automaticamente cuando el rango excede `maxTicks` para
// que rangos largos (90/365 dias) no saturen el eje.
function pickXTicks(rows: TrendPoint[], stepDays: number, maxTicks: number): number[] {
  if (!rows.length) return [];
  const stride = Math.max(stepDays, Math.ceil(rows.length / Math.max(1, maxTicks)));
  const idxs: number[] = [];
  for (let i = 0; i < rows.length; i += stride) idxs.push(i);
  if (idxs[idxs.length - 1] !== rows.length - 1) idxs.push(rows.length - 1);
  return idxs;
}


function formatShort(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}


// Genera un sufijo determinístico por ejecución para evitar colision de IDs SVG
// cuando el componente se re-renderiza en la misma pantalla. useState congelado.
function useIdSuffix(): string {
  const [id] = useState(() => Math.random().toString(36).slice(2, 8));
  return id;
}


function ChartTooltip({ t, x, y, title, rows }: {
  t: Tokens; x: number; y: number; title: string;
  rows: { label: string; value: string; color: string }[];
}) {
  return (
    <div style={{
      position: "absolute", left: Math.min(x + 12, 999), top: Math.max(y - 40, 0),
      background: t.panel2 || t.panel || "rgba(15,20,30,0.94)",
      border: `1px solid ${t.border}`,
      borderRadius: 8, padding: "8px 10px", pointerEvents: "none",
      fontSize: 11, whiteSpace: "nowrap", zIndex: 10,
      boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
      transform: x > 400 ? "translateX(-100%) translateX(-24px)" : undefined,
    }}>
      <div style={{ color: t.textHi, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: "inline-block" }} />
          <span style={{ color: t.textMid }}>{r.label}:</span>
          <b style={{ color: t.textHi, marginLeft: "auto" }}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}


// ── Top 5 clientes ─────────────────────────────────────────────────
function TopCustomers({ rows, t, L, onSelect }: {
  rows: TopCustomerRow[]; t: Tokens; L: any; onSelect?: (id?: number | null) => void;
}) {
  if (!rows?.length) return <EmptyMsg t={t} msg={L.noSalesPeriod} />;
  const warn = t.warn || "#F59E0B";
  const shown = rows.slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", gap: 4 }}>
      {shown.map((c, i) => {
        const isTop = i === 0;
        return (
          <div key={i} onClick={() => onSelect?.(c.customer_id)}
            style={{
              display: "grid", gridTemplateColumns: "20px 1fr auto",
              gap: 10, alignItems: "center", padding: "6px 0",
              borderBottom: i === shown.length - 1 ? "none" : `1px solid ${t.border}`,
              cursor: onSelect && c.customer_id ? "pointer" : "default",
              flex: 1, minHeight: 0,
            }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: isTop ? warn + "33" : (t.panel2 || t.panel),
              color: isTop ? warn : t.textMid,
              display: "grid", placeItems: "center",
              fontSize: 10, fontWeight: 700,
            }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: t.textLo }}>{L.ordersW(c.orders)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(c.total)}</div>
              {c.delta_pct != null && (
                <div style={{ fontSize: 10.5, color: c.delta_pct >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444"), fontWeight: 600 }}>
                  {c.delta_pct >= 0 ? "▲" : "▼"} {Math.abs(c.delta_pct).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Meta vs Real (esfera liquida) ──────────────────────────────────
function MetaBubble({ data, t, L }: { data: any; t: Tokens; L: any }) {
  const hasGoal = data?.goal > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      {/* Burbuja arriba llenando todo el ancho disponible del panel */}
      <div style={{ flex: 1, display: "grid", placeItems: "center", width: "100%", minHeight: 0 }}>
        {hasGoal ? (
          <LiquidCore
            pct={data.achieved_pct}
            t={t}
            sub={L.ofGoal}
            hue="blue"
            liquidOpacity={0.55}
            style={{ maxWidth: 130, width: "100%" }}
          />
        ) : (
          <div style={{ textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 28, color: t.textHi, fontWeight: 800 }}>{mxn(data?.real || 0)}</div>
            <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4, maxWidth: 220 }}>{L.noMeta}</div>
          </div>
        )}
      </div>
      {/* Footer con la comparativa real vs objetivo, tipografia grande y horizontal */}
      {hasGoal && (
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "center",
          gap: 10, paddingTop: 6, borderTop: `1px solid ${withAlpha(t.border || "#223154", 0.5)}`,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(data.real)}</span>
          <span style={{ fontSize: 12, color: t.textLo }}>/</span>
          <span style={{ fontSize: 13, color: t.textMid, fontVariantNumeric: "tabular-nums" }}>{mxn(data.goal)}</span>
          <span style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{L.objective}</span>
        </div>
      )}
    </div>
  );
}


// ── Ventas por canal (donut interactivo + leyenda) ─────────────────
function ChannelDonut({ data, total, t, L }: {
  data: ChannelSalesRow[]; total: number; t: Tokens; L: any;
}) {
  if (!data?.length || total === 0) return <EmptyMsg t={t} msg={L.noChannel} />;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const cx = 21, cy = 21, r = 15.9, w = 4.5;
  let accum = 0;
  const rings = data.map((d, i) => {
    const share = d.revenue / total;
    const dashLen = share * 100;
    const rest = 100 - dashLen;
    const offset = -accum * 100 + 25;
    accum += share;
    const isHover = hoverIdx === i;
    const color = CHANNEL_PALETTE[i % CHANNEL_PALETTE.length];
    // Anillo mas translucido en normal, saturado en hover
    return (
      <circle key={i} cx={cx} cy={cy} r={r} fill="transparent"
        stroke={withAlpha(color, isHover ? 0.95 : 0.4)}
        strokeWidth={isHover ? w + 1.5 : w}
        strokeDasharray={`${dashLen} ${rest}`}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        opacity={hoverIdx == null || isHover ? 1 : 0.45}
        style={{ cursor: "pointer", transition: "stroke-width .15s, opacity .15s, stroke .15s" }}
        onMouseEnter={() => setHoverIdx(i)}
        onMouseLeave={() => setHoverIdx(null)}
      />
    );
  });

  // Foco: canal bajo hover, o el mayor (top) por default
  const focusIdx = hoverIdx != null ? hoverIdx : 0;
  const focused = data[focusIdx];
  const focusColor = CHANNEL_PALETTE[focusIdx % CHANNEL_PALETTE.length];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%", gap: 10, padding: "2px 0" }}>
      {/* Anillo arriba, centrado */}
      <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
        <svg viewBox="0 0 42 42" style={{ width: "100%", height: "100%" }}>
          <circle cx={cx} cy={cy} r={r} fill="transparent" stroke={withAlpha(t.border || "#1B2540", 0.3)} strokeWidth={w} />
          {rings}
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none", textAlign: "center", padding: 6,
        }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: focusColor, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
            {focused ? focused.share_pct.toFixed(0) : 0}%
          </div>
          <div title={focused ? L.tr(focused.label) : undefined}
            style={{ fontSize: 8.5, color: t.textLo, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 80, fontWeight: 700 }}>
            {focused ? L.tr(focused.label) : "—"}
          </div>
        </div>
      </div>

      {/* Leyenda debajo del anillo, full width con scroll interno si hay muchos canales */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 4,
        width: "100%", minWidth: 0, flex: 1, minHeight: 0,
        overflowY: "auto", overflowX: "hidden", paddingRight: 4,
        scrollbarWidth: "thin",
      }}>
        {data.map((d, i) => {
          const color = CHANNEL_PALETTE[i % CHANNEL_PALETTE.length];
          const isHover = hoverIdx === i;
          const dim = hoverIdx != null && !isHover;
          return (
            <div key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) auto",
                alignItems: "center", columnGap: 9,
                padding: "5px 8px", borderRadius: 6,
                background: isHover ? withAlpha(color, 0.12) : "transparent",
                borderLeft: `2px solid ${isHover ? color : withAlpha(color, 0.35)}`,
                opacity: dim ? 0.5 : 1,
                transition: "background .15s, opacity .15s, border-color .15s",
                cursor: "pointer",
              }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: withAlpha(color, 0.65),
                boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.9)}`,
              }} />
              <span style={{
                color: t.textMid, fontSize: 11.5, fontWeight: 500,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
              }}>{L.tr(d.label)}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
                <span style={{
                  color: t.textHi, fontWeight: 700, fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}>{mxn(d.revenue)}</span>
                <span style={{
                  color: withAlpha(color, 0.95), fontWeight: 700, fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                }}>{d.share_pct.toFixed(1)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── KPIs operativos (barras con nota + valor) ──────────────────────
function OperationalBars({ kpis, t, L }: { kpis: OperationalKPIRow[]; t: Tokens; L: any }) {
  const colorFor = (hint?: string | null) => {
    switch (hint) {
      case "good": return t.good || "#22C55E";
      case "warn": return t.warn || "#F59E0B";
      case "bad": return t.bad || "#EF4444";
      default: return t.textMid || "#98A6BE";
    }
  };
  const bgFor = (hint?: string | null) => {
    switch (hint) {
      case "good": return `linear-gradient(90deg, #16A34A, ${t.good || "#22C55E"})`;
      case "warn": return `linear-gradient(90deg, ${t.warn || "#F59E0B"}, #FBBF24)`;
      case "bad": return `linear-gradient(90deg, ${t.bad || "#EF4444"}, #F87171)`;
      default: return t.nova || "#33B2F5";
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
      {kpis.map((k, i) => {
        const c = colorFor(k.color_hint);
        return (
          <div key={k.key} style={{
            display: "grid", gridTemplateColumns: "1fr auto",
            alignItems: "center", padding: "6px 0",
            borderBottom: i === kpis.length - 1 ? "none" : `1px solid ${t.border}`,
            gap: 12, flex: 1, minHeight: 0,
          }}>
            <div>
              <div style={{ fontSize: 12, color: t.textMid, fontWeight: 500 }}>{L.tr(k.label)}</div>
              {k.hint && <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 1 }}>{L.tr(k.hint)}</div>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: c, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
              {k.value_pct.toFixed(0)}%
            </div>
            <div style={{ gridColumn: "1 / -1", height: 4, background: t.panel2 || t.panel, borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
              <div style={{ width: `${Math.min(100, k.value_pct)}%`, height: "100%", borderRadius: 2, background: bgFor(k.color_hint) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Alertas tempranas (pill con --accent border-left) ──────────────
function AlertList({ alerts, t, L, onClick }: {
  alerts: AlertRow[]; t: Tokens; L: any; onClick?: (a: AlertRow) => void;
}) {
  if (!alerts?.length) return <EmptyMsg t={t} msg={L.noAlerts} color={t.good} />;
  const accentFor = (s: string) => s === "urgent" ? (t.bad || "#EF4444") : s === "high" ? (t.warn || "#F59E0B") : (t.nova || "#33B2F5");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "100%", justifyContent: "space-between" }}>
      {alerts.map((a, i) => {
        const accent = accentFor(a.severity);
        return (
          <div key={i} onClick={() => onClick?.(a)}
            style={{
              display: "grid", gridTemplateColumns: "auto 1fr auto",
              alignItems: "center", gap: 10, padding: "8px 10px",
              background: withAlpha(t.panel2 || t.panel || "#0F1729", 0.55), borderRadius: 8,
              borderLeft: `3px solid ${accent}`,
              cursor: onClick ? "pointer" : "default",
              flex: 1, minHeight: 0,
            }}>
            <span style={{
              textTransform: "uppercase", letterSpacing: "0.08em",
              fontSize: 8.5, fontWeight: 800,
              padding: "3px 6px", borderRadius: 4,
              background: accent + "33", color: accent, textAlign: "center",
            }}>{L.tr(a.label)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{L.tr(a.title)}</div>
              {a.subtitle && <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{L.tr(a.subtitle)}</div>}
            </div>
            {a.reference && (
              <div style={{ fontSize: 11, fontWeight: 700, color: accent, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {a.reference}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


// ── Distribucion geografica (mapa fijo + estados con scroll) ───────
function GeoBig({ geo, t, L }: {
  geo: { by_state: GeoStateRow[]; top5: GeoStateRow[]; total_revenue: number };
  t: Tokens; L: any;
}) {
  // Todos los estados con venta ordenados por revenue, no solo top 3 —
  // asi la lista se hace scrolleable cuando hay muchas ciudades.
  const allStates = [...(geo?.by_state || [])].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const nova = t.nova || "#33B2F5";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
      {/* Mapa — tamano y posicion fijos, no se mueven al crecer la lista */}
      <div style={{
        width: "100%", height: 190, flexShrink: 0,
        background: t.panel2 || t.panel,
        borderRadius: 10, padding: 8, display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative",
      }}>
        <MexicoMap t={t} data={geo?.by_state || []} />
        <div style={{
          position: "absolute", bottom: 6, right: 10,
          fontSize: 9.5, color: t.textLo, pointerEvents: "none",
          background: withAlpha(t.panel || "#0A111E", 0.8), padding: "2px 6px", borderRadius: 4,
        }}>
          {L.statesWithSales(allStates.length)}
        </div>
      </div>
      {/* Lista de estados — toma el espacio restante y hace scroll si excede */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 4,
        flex: 1, minHeight: 0,
        overflowY: "auto", overflowX: "hidden",
        paddingRight: 4,
        scrollbarWidth: "thin",
      }}>
        {!allStates.length && <div style={{ color: t.textLo, fontSize: 11, textAlign: "center", padding: 8 }}>{L.noGeo}</div>}
        {allStates.map((s, i) => (
          <div key={s.state_code} style={{
            display: "grid", gridTemplateColumns: "18px 1fr auto auto",
            gap: 10, alignItems: "center", padding: "5px 8px",
            background: t.panel2 || t.panel, borderRadius: 6,
            flexShrink: 0,
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: "50%",
              background: withAlpha(nova, 0.18), color: nova,
              display: "grid", placeItems: "center",
              fontSize: 10, fontWeight: 700,
            }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.state_name}</div>
              <div style={{ fontSize: 10, color: t.textLo }}>{num(s.units)}u · {s.orders_count} ped.</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{mxn(s.revenue)}</div>
            <div style={{ fontSize: 10.5, color: nova, fontWeight: 600, minWidth: 38, textAlign: "right" }}>{s.share_pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── KPIs financieros (2x2 tiles con border-left color) ─────────────
function FinancialKPIs({ kpis, t, L, onClick }: {
  kpis: FinancialKPIRow[]; t: Tokens; L: any; onClick?: () => void;
}) {
  const accentFor = (status: string): string => {
    switch (status) {
      case "good": return t.good || "#22C55E";
      case "warn": return t.warn || "#F59E0B";
      case "bad": return t.bad || "#EF4444";
      default: return t.nova || "#33B2F5";
    }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, height: "100%" }}>
      {kpis.slice(0, 4).map(k => {
        const accent = accentFor(k.status);
        return (
          <div key={k.key} onClick={onClick}
            title={onClick ? L.goToAccounting : undefined}
            style={{
              padding: "10px 12px",
              display: "flex", flexDirection: "column", justifyContent: "center",
              background: withAlpha(t.panel2 || t.panel || "#0F1729", k.available ? 0.55 : 0.35),
              borderRadius: 10,
              borderLeft: `3px solid ${accent}`,
              cursor: onClick ? "pointer" : "default",
              transition: "transform .12s, background .12s",
              minHeight: 0,
            }}
            onMouseEnter={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = "none"; }}
          >
            <div title={L.tr(k.label)} style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textLo, fontWeight: 700, marginBottom: 4, lineHeight: 1.2 }}>{L.tr(k.label)}</div>
            {k.available ? (
              <div title={k.display}
                style={{ fontSize: "clamp(16px, 1.4vw, 20px)", fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {k.display}
              </div>
            ) : (
              <button type="button"
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                style={{
                  marginTop: 2, alignSelf: "flex-start",
                  fontSize: 10, fontWeight: 600, color: accent,
                  background: withAlpha(accent, 0.14),
                  border: `1px solid ${withAlpha(accent, 0.35)}`,
                  padding: "3px 8px", borderRadius: 6, cursor: onClick ? "pointer" : "default",
                }}>
                {L.captureBalance}
              </button>
            )}
            {k.subtitle && <div style={{ fontSize: 10, color: t.textLo, marginTop: 3, lineHeight: 1.3 }}>{L.tr(k.subtitle)}</div>}
          </div>
        );
      })}
    </div>
  );
}


function EmptyMsg({ t, msg, color }: { t: Tokens; msg: string; color?: string }) {
  return (
    <div style={{ color: color || t.textLo, fontSize: 12, textAlign: "center", padding: 20, height: "100%", display: "grid", placeItems: "center" }}>
      {msg}
    </div>
  );
}
