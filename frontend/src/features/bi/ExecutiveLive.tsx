// ExecutiveLive.tsx — Dashboard Ejecutivo consolidado, datos server-side.
// Usa GET /bi/executive-summary + /finance/cxc/aging-summary.
// Auto-refresh 5min. Sirve como panel de comando del dueño / gerente.

import { useEffect, useState } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Wallet,
  AlertTriangle, Package, Users, RefreshCw, Bell, ArrowUpRight,
  ArrowDownRight, Clock,
} from "lucide-react";
import { biService, type ExecutiveSummary, type AgingSummary } from "./service";

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const mxnFull = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
};

// Sparkline SVG minimalista, sin librerías
function Sparkline({ points, color, height = 44 }: { points: number[]; color: string; height?: number }) {
  if (points.length === 0) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 200; const h = height;
  const pts = points.map((p, i) => {
    const x = (i / (points.length - 1 || 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const areaPts = `0,${h} ${pts.join(" ")} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }}>
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#spark-${color.replace("#", "")})`} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface Props { t: any; onNavigate?: (page: string, query?: string) => void }

export default function ExecutiveLive({ t, onNavigate }: Props) {
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [cxcAging, setCxcAging] = useState<AgingSummary | null>(null);
  const [cxpAging, setCxpAging] = useState<AgingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [s, cxc, cxp] = await Promise.all([
        biService.executiveSummary(),
        biService.cxcAging().catch(() => null),
        biService.cxpAging().catch(() => null),
      ]);
      setSummary(s); setCxcAging(cxc); setCxpAging(cxp);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo cargar el resumen ejecutivo");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000); // Auto-refresh 5 min
    return () => clearInterval(t);
  }, []);

  if (loading && !summary) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>
        Cargando resumen ejecutivo…
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div style={{ padding: "12px 14px", background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={15} /> {error}
        <button onClick={load} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${t.bad}55`, color: t.bad, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
          Reintentar
        </button>
      </div>
    );
  }

  if (!summary) return null;

  const S = summary.sales;
  const R = summary.receivables;
  const P = summary.payables;
  const salesDelta = S.delta_pct;
  const trendPoints = S.daily_trend.map(d => d.total);

  const kpis = [
    {
      label: "Ventas HOY", value: mxn(S.today.total), sub: `${S.today.count} pedidos`,
      color: t.good, icon: DollarSign, spark: null,
    },
    {
      label: "Ventas del MES", value: mxn(S.month.total),
      sub: `${salesDelta >= 0 ? "↑" : "↓"} ${Math.abs(salesDelta)}% vs mes anterior`,
      subColor: salesDelta >= 0 ? t.good : t.bad,
      color: t.nova, icon: TrendingUp, spark: trendPoints,
    },
    {
      label: "Utilidad estimada", value: mxn(S.gross_margin_month),
      sub: `Margen ${S.margin_pct}% · COGS ${mxn(S.cogs_month)}`,
      color: "#8B5CF6", icon: Wallet, spark: null,
    },
    {
      label: "Cash disponible", value: mxn(summary.cash_available),
      sub: "En bancos",
      color: "#06B6D4", icon: Wallet, spark: null,
    },
    {
      label: "Por cobrar", value: mxn(R.total),
      sub: R.overdue > 0 ? `${mxnFull(R.overdue)} VENCIDO (${R.overdue_pct}%)` : "Al corriente",
      subColor: R.overdue > 0 ? t.bad : t.good,
      color: t.warn, icon: Users, spark: null, onClick: () => onNavigate?.("finanzas"),
    },
    {
      label: "Por pagar", value: mxn(P.total),
      sub: P.overdue > 0 ? `${mxnFull(P.overdue)} VENCIDO (${P.overdue_pct}%)` : "Al corriente",
      subColor: P.overdue > 0 ? t.bad : t.good,
      color: "#F97316", icon: ShoppingCart, spark: null, onClick: () => onNavigate?.("finanzas"),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header con refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: t.textHi }}>Dashboard Ejecutivo</div>
          <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={11} />
            {lastRefresh ? `Actualizado a las ${lastRefresh.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · auto-refresh 5min` : "…"}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: loading ? "wait" : "pointer", fontSize: 12.5 }}>
          <RefreshCw size={13} /> {loading ? "…" : "Actualizar"}
        </button>
      </div>

      {/* KPI grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {kpis.map(k => (
          <div key={k.label}
            onClick={k.onClick} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: "14px 16px", cursor: k.onClick ? "pointer" : "default", position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ background: k.color + "22", color: k.color, borderRadius: 8, padding: 7, display: "flex" }}>
                <k.icon size={15} />
              </div>
              <span style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>{k.label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: t.textHi, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11.5, color: k.subColor || t.textLo, marginTop: 5, fontWeight: k.subColor ? 700 : 500 }}>{k.sub}</div>
            {k.spark && k.spark.length > 0 && (
              <div style={{ marginTop: 10, marginLeft: -16, marginRight: -16, marginBottom: -14 }}>
                <Sparkline points={k.spark} color={k.color} height={38} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Alertas críticas — solo si hay */}
      {summary.alerts.total > 0 && (
        <div style={{ background: (summary.alerts.critical > 0 ? t.bad : t.warn) + "12", border: `1px solid ${(summary.alerts.critical > 0 ? t.bad : t.warn)}44`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Bell size={16} color={summary.alerts.critical > 0 ? t.bad : t.warn} />
            <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>
              Requiere tu atención
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
              {summary.alerts.critical > 0 && (
                <span style={{ color: t.bad, background: t.bad + "22", padding: "3px 10px", borderRadius: 20 }}>
                  {summary.alerts.critical} críticos
                </span>
              )}
              {summary.alerts.warning > 0 && (
                <span style={{ color: t.warn, background: t.warn + "22", padding: "3px 10px", borderRadius: 20 }}>
                  {summary.alerts.warning} advertencias
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.alerts.top.slice(0, 6).map((a, i) => (
              <div key={`${a.id || i}-${a.title}`}
                onClick={() => a.page && onNavigate?.(a.page, a.query || a.title)}
                style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: onNavigate ? "pointer" : "default", background: t.panel + "88" }}>
                <div style={{ width: 6, height: 6, borderRadius: 999, background: a.severity === "critical" ? t.bad : a.severity === "warning" ? t.warn : t.nova, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{a.title}</div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2 }}>{a.detail}</div>
                </div>
              </div>
            ))}
            {summary.alerts.total > 6 && (
              <div style={{ fontSize: 11, color: t.textLo, textAlign: "center", padding: 4 }}>
                +{summary.alerts.total - 6} avisos más — abre la campana en la barra superior
              </div>
            )}
          </div>
        </div>
      )}

      {/* Aging de cartera + Top clientes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        {cxcAging && cxcAging.total > 0 && (
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={15} color={t.warn} /> Antigüedad de cartera (CxC)
              <span style={{ marginLeft: "auto", fontSize: 11, color: t.textLo, fontWeight: 500 }}>{cxcAging.count} clientes</span>
            </div>
            {cxcAging.buckets.map(b => {
              const pct = cxcAging.total > 0 ? (b.amount / cxcAging.total) * 100 : 0;
              const isOverdue = b.bucket !== "Al corriente";
              const color = isOverdue
                ? (b.bucket === "+90 días" ? t.bad : b.bucket === "61-90 días" ? "#F97316" : t.warn)
                : t.good;
              return (
                <div key={b.bucket} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: t.textMid }}>{b.bucket}</span>
                    <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxnFull(b.amount)}</span>
                  </div>
                  <div style={{ height: 8, background: t.panel3, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
                  </div>
                </div>
              );
            })}
            {cxcAging.top_debtors && cxcAging.top_debtors.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6, fontWeight: 700 }}>Top clientes con saldo</div>
                {cxcAging.top_debtors.slice(0, 5).map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5, borderBottom: i < 4 ? `1px solid ${t.border}55` : "none" }}>
                    <span style={{ color: t.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{d.name}</span>
                    <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxnFull(d.balance)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {cxpAging && cxpAging.total > 0 && (
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <ShoppingCart size={15} color="#F97316" /> Cuentas por pagar
              <span style={{ marginLeft: "auto", fontSize: 11, color: t.textLo, fontWeight: 500 }}>{cxpAging.count} proveedores</span>
            </div>
            {cxpAging.buckets.map(b => {
              const pct = cxpAging.total > 0 ? (b.amount / cxpAging.total) * 100 : 0;
              const isOverdue = b.bucket !== "Al corriente";
              const color = isOverdue
                ? (b.bucket === "+90 días" ? t.bad : b.bucket === "61-90 días" ? "#F97316" : t.warn)
                : t.good;
              return (
                <div key={b.bucket} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: t.textMid }}>{b.bucket}</span>
                    <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxnFull(b.amount)}</span>
                  </div>
                  <div style={{ height: 8, background: t.panel3, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
                  </div>
                </div>
              );
            })}
            {cxpAging.top_creditors && cxpAging.top_creditors.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6, fontWeight: 700 }}>Top proveedores</div>
                {cxpAging.top_creditors.slice(0, 5).map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5, borderBottom: i < 4 ? `1px solid ${t.border}55` : "none" }}>
                    <span style={{ color: t.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{d.name}</span>
                    <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxnFull(d.balance)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Tendencia 14 días + Top productos */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={15} color={t.nova} /> Tendencia últimos 14 días
          </div>
          <TrendChart data={S.daily_trend} t={t} />
        </div>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={15} color="#8B5CF6" /> Top 5 productos del mes
          </div>
          {summary.top_products.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textLo, textAlign: "center", padding: 20 }}>Sin ventas este mes</div>
          ) : summary.top_products.map((p, i) => {
            const maxTotal = Math.max(...summary.top_products.map(x => x.total));
            const pct = maxTotal > 0 ? (p.total / maxTotal) * 100 : 0;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: t.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{i + 1}. {p.name}</span>
                  <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(p.total)}</span>
                </div>
                <div style={{ height: 5, background: t.panel3, borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${t.nova}, #8B5CF6)`, borderRadius: 99 }} />
                </div>
                <div style={{ fontSize: 10, color: t.textLo, marginTop: 2 }}>{p.quantity} unidades</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top clientes + Inventario crítico */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={15} color={t.good} /> Top 5 clientes del mes
          </div>
          {summary.top_customers.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textLo, textAlign: "center", padding: 20 }}>Sin clientes este mes</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>Cliente</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>Pedidos</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.top_customers.map((c, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${t.border}55` }}>
                      <td style={{ padding: "8px 10px", color: t.textHi, fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: "8px 10px", color: t.textMid, textAlign: "right" }}>{c.orders}</td>
                      <td style={{ padding: "8px 10px", color: t.textHi, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxnFull(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={15} color={t.bad} /> Inventario crítico
          </div>
          {summary.inventory.out_of_stock === 0 && summary.inventory.low_stock === 0 ? (
            <div style={{ fontSize: 12.5, color: t.good, textAlign: "center", padding: 20 }}>
              ✓ Todo el catálogo con stock adecuado
            </div>
          ) : (
            <>
              <div onClick={() => onNavigate?.("inventario")}
                style={{ cursor: onNavigate ? "pointer" : "default", padding: "12px 14px", borderRadius: 10, background: t.bad + "18", border: `1px solid ${t.bad}44`, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: t.bad, fontWeight: 700, marginBottom: 3 }}>AGOTADOS</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: t.bad, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{summary.inventory.out_of_stock}</div>
                <div style={{ fontSize: 11, color: t.textLo, marginTop: 3 }}>SKUs sin existencia</div>
              </div>
              <div onClick={() => onNavigate?.("inventario")}
                style={{ cursor: onNavigate ? "pointer" : "default", padding: "12px 14px", borderRadius: 10, background: t.warn + "18", border: `1px solid ${t.warn}44` }}>
                <div style={{ fontSize: 11, color: t.warn, fontWeight: 700, marginBottom: 3 }}>STOCK BAJO</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: t.warn, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{summary.inventory.low_stock}</div>
                <div style={{ fontSize: 11, color: t.textLo, marginTop: 3 }}>bajo el punto de reorden</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Gráfico de línea 14 días — SVG puro
function TrendChart({ data, t }: { data: { date: string; total: number; count: number }[]; t: any }) {
  if (!data || data.length === 0) return <div style={{ padding: 20, color: t.textLo, fontSize: 12 }}>Sin datos</div>;
  const w = 600; const h = 180; const padL = 40; const padB = 20; const padT = 10;
  const max = Math.max(...data.map(d => d.total), 100);
  const min = 0;
  const range = max - min || 1;
  const stepX = (w - padL - 10) / (data.length - 1 || 1);
  const points = data.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + (h - padT - padB) - ((d.total - min) / range) * (h - padT - padB);
    return { x, y, v: d.total, label: shortDate(d.date) };
  });
  const path = points.map((p, i) => (i === 0 ? "M" : "L") + p.x + "," + p.y).join(" ");
  const areaPath = path + ` L${points[points.length - 1].x},${h - padB} L${points[0].x},${h - padB} Z`;

  // Gridlines Y (4 líneas)
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = min + range * (1 - f);
    return { y: padT + f * (h - padT - padB), v };
  });

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: h, display: "block" }}>
        <defs>
          <linearGradient id="trend-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={t.nova} stopOpacity="0.28" />
            <stop offset="100%" stopColor={t.nova} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridY.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={w - 10} y1={g.y} y2={g.y} stroke={t.border} strokeWidth="0.5" strokeDasharray="2,3" />
            <text x={padL - 6} y={g.y + 3} fontSize="9" fill={t.textLo} textAnchor="end">{mxn(g.v)}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#trend-area)" />
        <path d={path} stroke={t.nova} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={t.nova}>
            <title>{p.label}: {mxnFull(p.v)}</title>
          </circle>
        ))}
        {points.filter((_, i) => i % 2 === 0).map((p, i) => (
          <text key={i} x={p.x} y={h - 4} fontSize="9" fill={t.textLo} textAnchor="middle">{p.label}</text>
        ))}
      </svg>
    </div>
  );
}
