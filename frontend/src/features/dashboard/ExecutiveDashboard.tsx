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
  DollarSign, RefreshCw, Building2, AlertTriangle, MapPin,
} from "lucide-react";
import { dashboardApi } from "./api";
import MexicoMap from "./MexicoMap";
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
  setPage?: (page: string) => void;
}

const KPI_ICON: Record<string, any> = {
  income_total: DollarSign,
  net_profit: TrendingUp,
  orders: Package,
  avg_ticket: ShoppingCart,
  margin_pct: Target,
  revenue_target: Target,
};

const KPI_NAV: Record<string, string> = {
  income_total: "ventas",
  net_profit: "ventas",
  orders: "ventas",
  avg_ticket: "ventas",
  margin_pct: "reportes",
  revenue_target: "forecast",
};

function colorForHint(t: Tokens, hint?: string | null): string {
  switch (hint) {
    case "good": return t.good || "#22c55e";
    case "warn": return t.warn || "#f59e0b";
    case "bad": return t.bad || "#ef4444";
    default: return t.textHi || "#e5e7eb";
  }
}

export default function ExecutiveDashboard({ t, setPage }: Props) {
  const [data, setData] = useState<ExecutiveDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

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

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>Calculando dashboard ejecutivo…</div>;
  if (error) {
    return (
      <div style={{ padding: 20, color: t.bad, background: t.bad + "18", borderRadius: 10, textAlign: "center" }}>
        <AlertTriangle size={24} />
        <div style={{ marginTop: 8, fontSize: 14 }}>Error: {error}</div>
        <button onClick={load} style={{ marginTop: 12, padding: "6px 14px", background: t.nova, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Reintentar</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div style={{ padding: 20, maxWidth: 1500, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: t.textHi }}>Tablero Ejecutivo</h1>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3 }}>
            Del {new Date(data.period_start).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
            {" al "}
            {new Date(data.period_end).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[7, 30, 90, 365].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${t.border}`,
                        background: days === d ? t.nova : "transparent",
                        color: days === d ? "#fff" : t.textMid,
                        cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {d === 7 ? "7d" : d === 30 ? "30d" : d === 90 ? "90d" : "1 año"}
            </button>
          ))}
          <button onClick={load} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
      </div>

      {/* Fila 1: 6 KPIs principales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 14 }}>
        {data.kpis.map(k => <KPITile key={k.key} kpi={k} t={t} onClick={() => nav(KPI_NAV[k.key])} />)}
      </div>

      {/* Fila 2: Ventas del período + Meta vs Real + Top 5 Clientes */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <PanelCard t={t} title="Ventas del período" subtitle="Actual vs anterior">
          <SalesTrendChart data={data.trend_sales} t={t} />
        </PanelCard>
        <PanelCard t={t} title="Meta vs Real" subtitle={`Mes ${data.meta_vs_real.period}`}>
          <MetaGauge meta={data.meta_vs_real} t={t} />
        </PanelCard>
        <PanelCard t={t} title="Top 5 Clientes" subtitle="del período">
          <TopCustomers rows={data.top_customers} t={t} onSelect={(id) => id && nav("clientes")} />
        </PanelCard>
      </div>

      {/* Fila 3: Ingresos vs Gastos + Mapa MX + KPIs Operativos */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 12, marginBottom: 14 }}>
        <PanelCard t={t} title="Tendencia Ingresos vs Gastos">
          <IncomeExpensesChart data={data.trend_income_expenses} t={t} />
        </PanelCard>
        <PanelCard t={t} title="Distribución Geográfica" subtitle="Ventas por estado">
          <GeoMap geo={data.geographic} t={t} />
        </PanelCard>
        <PanelCard t={t} title="KPIs Operativos">
          <OperationalBars kpis={data.operational_kpis} t={t} />
        </PanelCard>
      </div>

      {/* Fila 4: Canales + Alertas + Financieros */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 12 }}>
        <PanelCard t={t} title="Ventas por Canal">
          <ChannelDonut data={data.channel_sales.channels} total={data.channel_sales.total_revenue} t={t} />
        </PanelCard>
        <PanelCard t={t} title="Alertas Tempranas" subtitle="Top 5">
          <AlertList alerts={data.alerts} t={t} onClick={(a) => nav(a.module === "finance" ? "finanzas" : a.module === "retail" ? "retail" : "inventario")} />
        </PanelCard>
        <PanelCard t={t} title="KPIs Financieros">
          <FinancialKPIs kpis={data.financial_kpis} t={t} />
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


function KPITile({ kpi, t, onClick }: { kpi: ExecKPI; t: Tokens; onClick?: () => void }) {
  const Icon = KPI_ICON[kpi.key] || DollarSign;
  const color = colorForHint(t, kpi.color_hint);
  const deltaSign = kpi.delta_pct == null ? null : kpi.delta_pct >= 0 ? "▲" : "▼";
  const deltaColor = kpi.delta_pct == null ? t.textLo
    : kpi.delta_pct >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444");

  const isMeta = kpi.key === "revenue_target" || kpi.key === "margin_pct";
  return (
    <div onClick={onClick}
      style={{
        padding: 14, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
        cursor: onClick ? "pointer" : "default", position: "relative", overflow: "hidden",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: color + "22", color: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10 }}>{kpi.label}</div>
      {isMeta ? (
        <MiniGauge value_pct={kpi.value} color={color} t={t} display={kpi.display} />
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, color: t.textHi, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{kpi.display}</div>
      )}
      {kpi.delta_pct != null && (
        <div style={{ fontSize: 11, color: deltaColor, marginTop: 4, fontWeight: 700 }}>
          {deltaSign} {Math.abs(kpi.delta_pct).toFixed(1)}% <span style={{ color: t.textLo, fontWeight: 400 }}>{kpi.sub}</span>
        </div>
      )}
      {kpi.delta_pct == null && kpi.sub && (
        <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 4 }}>{kpi.sub}</div>
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


function SalesTrendChart({ data, t }: { data: TrendPoint[]; t: Tokens }) {
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.revenue, d.prev_revenue)));
  const W = 100, H = 60;   // viewbox virtual
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const buildPath = (getVal: (d: TrendPoint) => number) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - (getVal(d) / maxVal) * H).toFixed(2)}`).join(" ");
  const lineCur = buildPath(d => d.revenue);
  const linePrev = buildPath(d => d.prev_revenue);

  return (
    <div style={{ width: "100%", height: 180, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: t.textLo, marginBottom: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.nova, marginRight: 4 }} /> Actual</span>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.textLo, opacity: 0.5, marginRight: 4 }} /> Anterior</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ width: "100%", flex: 1 }}>
        <path d={linePrev} stroke={t.textLo} strokeWidth="0.5" fill="none" strokeDasharray="1.5,1.5" opacity="0.6" />
        <path d={lineCur} stroke={t.nova} strokeWidth="0.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: t.textLo, marginTop: 4 }}>
        {data.filter((_, i) => i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1).map(d => <span key={d.period}>{d.label}</span>)}
      </div>
    </div>
  );
}


function IncomeExpensesChart({ data, t }: { data: TrendPoint[]; t: Tokens }) {
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.revenue, d.expenses)));
  const W = 100, H = 60;
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const areaRev = data.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - (d.revenue / maxVal) * H).toFixed(2)}`).join(" ")
                    + ` L ${W} ${H} L 0 ${H} Z`;
  const lineExp = data.map((d, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(H - (d.expenses / maxVal) * H).toFixed(2)}`).join(" ");

  return (
    <div style={{ width: "100%", height: 180, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: t.textLo, marginBottom: 6 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.good, marginRight: 4 }} /> Ingresos</span>
        <span><span style={{ display: "inline-block", width: 10, height: 2, background: t.bad, marginRight: 4 }} /> Gastos</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" style={{ width: "100%", flex: 1 }}>
        <path d={areaRev} fill={t.good} opacity="0.15" />
        <path d={areaRev.replace(` L ${W} ${H} L 0 ${H} Z`, "")} stroke={t.good} strokeWidth="0.7" fill="none" strokeLinejoin="round" />
        <path d={lineExp} stroke={t.bad} strokeWidth="0.6" fill="none" strokeLinejoin="round" />
      </svg>
    </div>
  );
}


function MetaGauge({ meta, t }: { meta: { goal: number; real: number; achieved_pct: number }; t: Tokens }) {
  const pct = Math.max(0, Math.min(100, meta.achieved_pct));
  const size = 160;
  const cx = size / 2, cy = size / 2;
  const r = 65;
  const circ = 2 * Math.PI * r;
  const arc = (pct / 100) * circ;
  const color = pct >= 90 ? (t.good || "#22c55e") : pct >= 60 ? (t.warn || "#f59e0b") : (t.bad || "#ef4444");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.border} strokeWidth="14" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={`${arc} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ marginTop: -110, fontSize: 32, fontWeight: 800, color: t.textHi }}>{pct.toFixed(0)}%</div>
      <div style={{ marginTop: 70, textAlign: "center", fontSize: 11, color: t.textLo }}>
        <b style={{ color: t.textHi }}>{mxn(meta.real)}</b> de {mxn(meta.goal)}
      </div>
    </div>
  );
}


function TopCustomers({ rows, t, onSelect }: { rows: TopCustomerRow[]; t: Tokens; onSelect?: (id?: number | null) => void }) {
  if (!rows.length) return <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>Sin ventas en el período</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((c, i) => (
        <div key={i} onClick={() => onSelect?.(c.customer_id)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: t.panel2, borderRadius: 6, cursor: onSelect && c.customer_id ? "pointer" : "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: t.nova + "22", color: t.nova, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: t.textLo }}>{c.orders} pedido{c.orders !== 1 ? "s" : ""}</div>
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


function GeoMap({ geo, t }: { geo: { by_state: GeoStateRow[]; top5: GeoStateRow[]; total_revenue: number }; t: Tokens }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, height: 260 }}>
      <div style={{ position: "relative", background: t.panel2, borderRadius: 8, overflow: "hidden", minHeight: 240 }}>
        <MexicoMap t={t} data={geo.by_state} />
        <div style={{ position: "absolute", bottom: 6, left: 8, fontSize: 9, color: t.textLo, pointerEvents: "none" }}>
          México · {geo.by_state.length} estados con venta
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
        <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Top 5 estados</div>
        {geo.top5.length === 0 && <div style={{ color: t.textLo, fontSize: 11 }}>Sin ventas geolocalizadas</div>}
        {geo.top5.map((s, i) => (
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


function ChannelDonut({ data, total, t }: { data: ChannelSalesRow[]; total: number; t: Tokens }) {
  const palette = [t.nova || "#33B2F5", t.good || "#22c55e", t.warn || "#f59e0b", "#a855f7", "#ec4899", t.textLo];
  if (total === 0) return <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>Sin ventas por canal</div>;
  // Donut SVG con arcs
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
    return <path key={i} d={d_} stroke={palette[i % palette.length]} strokeWidth={w} fill="none" />;
  });
  const winner = data[0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: 180 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>{arcs}</svg>
        <div style={{ position: "absolute", textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{winner ? winner.share_pct.toFixed(0) : 0}%</div>
          <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase" }}>{winner?.label || "—"}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
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


function AlertList({ alerts, t, onClick }: { alerts: AlertRow[]; t: Tokens; onClick?: (a: AlertRow) => void }) {
  if (!alerts.length) return <div style={{ color: t.good, fontSize: 12, textAlign: "center", padding: 20 }}>Sin alertas activas ✓</div>;
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


function FinancialKPIs({ kpis, t }: { kpis: FinancialKPIRow[]; t: Tokens }) {
  const statusColor = (s: string) => s === "good" ? (t.good || "#22c55e") : s === "warn" ? (t.warn || "#f59e0b") : s === "bad" ? (t.bad || "#ef4444") : t.textLo;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {kpis.map(k => (
        <div key={k.key} style={{ padding: 10, background: k.available ? t.panel2 : (t.panel2 + "88"), borderRadius: 8, border: k.available ? "none" : `1px dashed ${t.border}` }}>
          <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>{k.label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: k.available ? statusColor(k.status) : t.textLo, fontVariantNumeric: "tabular-nums" }}>{k.display}</div>
          {k.subtitle && <div style={{ fontSize: 9.5, color: t.textLo, marginTop: 2 }}>{k.subtitle}</div>}
        </div>
      ))}
    </div>
  );
}
