// Lightweight analytics: dependency-free SVG area chart (sales area at the
// back, returns area layered on top) + goal line + interactive tooltip +
// top lists + average-returns metric, all filterable by customer.

import { useState } from "react";
import type { Tokens, Translator } from "./theme";
import { money } from "./theme";
import type { TrendPoint, TopCustomer, TopProduct, CustomerLite, AverageReturns, CustomerForecast } from "./types";
import { EmptyState } from "./ui";

function AreaTrendChart({ tk, data }: { tk: Tokens; data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <EmptyState tk={tk} title="Sin datos de tendencia" />;

  const W = 720, H = 240, padL = 8, padR = 8, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => Math.max(d.total, d.returns_total, d.goal ?? 0)), 1) * 1.08;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const labelEvery = Math.ceil(data.length / 8);
  const yFor = (v: number) => padT + innerH - innerH * (v / max);
  const xFor = (i: number) => padL + i * step;

  const lineFor = (key: "total" | "returns_total") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(d[key])}`).join(" ");
  const areaFor = (key: "total" | "returns_total") => {
    const line = lineFor(key);
    return `${line} L${xFor(data.length - 1)},${padT + innerH} L${xFor(0)},${padT + innerH} Z`;
  };
  const hasGoal = data.some((d) => d.goal != null);
  const goalPath = hasGoal ? lineFor("goal" as "total") : "";

  const accent = tk.accent, bad = tk.bad ?? "#e5484d";
  const hd = hover != null ? data[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max((xFor(hover) / W) * 100, 14), 86) : 0;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * W;
          const i = step > 0 ? Math.round((relX - padL) / step) : 0;
          setHover(Math.min(Math.max(i, 0), data.length - 1));
        }}>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={padL} x2={W - padR} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)}
            stroke={tk.border} strokeWidth={1} strokeDasharray="3 4" />
        ))}

        {/* Ventas: área de fondo, color discreto y translúcido */}
        <path d={areaFor("total")} fill={accent} opacity={0.16} />
        <path d={lineFor("total")} fill="none" stroke={accent} strokeWidth={1.75} opacity={0.9} />

        {/* Devoluciones: área superpuesta, más translúcida aún */}
        <path d={areaFor("returns_total")} fill={bad} opacity={0.22} />
        <path d={lineFor("returns_total")} fill="none" stroke={bad} strokeWidth={1.75} opacity={0.9} />

        {hasGoal && <path d={goalPath} fill="none" stroke={tk.textLo} strokeWidth={1.25} strokeDasharray="5 4" opacity={0.8} />}

        {data.map((d, i) => i % labelEvery === 0 && (
          <text key={i} x={xFor(i)} y={H - padB + 16} fontSize={9} fill={tk.textLo} textAnchor="middle">
            {d.period.slice(5)}
          </text>
        ))}

        {hover != null && (
          <line x1={xFor(hover)} x2={xFor(hover)} y1={padT} y2={padT + innerH} stroke={tk.textLo} strokeWidth={1} strokeDasharray="2 3" opacity={0.6} />
        )}
        {hover != null && (
          <>
            <circle cx={xFor(hover)} cy={yFor(data[hover].total)} r={3.5} fill={accent} />
            <circle cx={xFor(hover)} cy={yFor(data[hover].returns_total)} r={3.5} fill={bad} />
          </>
        )}
      </svg>

      {hd && (
        <div style={{
          position: "absolute", top: 6, left: `${tipLeft}%`, transform: "translateX(-50%)",
          background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 11, color: tk.textHi, pointerEvents: "none",
          boxShadow: "0 4px 14px rgba(0,0,0,.25)", whiteSpace: "nowrap", zIndex: 2,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hd.period}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: accent }} /> Ventas: <strong>{money(hd.total)}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: bad }} /> Devoluciones: <strong>{money(hd.returns_total)}</strong>
            {hd.total > 0 && <span style={{ color: tk.textLo }}>({((hd.returns_total / hd.total) * 100).toFixed(1)}%)</span>}
          </div>
          {hd.goal != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: tk.textLo }} /> Meta: <strong>{money(hd.goal)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChartLegend({ tk, hasGoal }: { tk: Tokens; hasGoal: boolean }) {
  const item = (color: string, label: string, dashed = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: tk.textLo }}>
      <span style={{ width: 14, height: dashed ? 0 : 8, borderRadius: dashed ? 0 : 2, background: dashed ? "none" : color, borderTop: dashed ? `2px dashed ${color}` : undefined }} />
      {label}
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
      {item(tk.accent, "Ventas")}
      {item(tk.bad ?? "#e5484d", "Devoluciones")}
      {hasGoal && item(tk.textLo, "Meta", true)}
    </div>
  );
}

function RankPanel<T>({ tk, title, rows, render }: {
  tk: Tokens; title: string; rows: T[]; render: (row: T, i: number) => { name: string; value: string; sub?: string };
}) {
  return (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 12 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: tk.textLo, padding: "12px 0" }}>Sin datos</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r, i) => {
            const { name, value, sub } = render(r, i);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: tk.accent + "1A", color: tk.accent, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: tk.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                  {sub && <div style={{ fontSize: 11, color: tk.textLo }}>{sub}</div>}
                </div>
                <div style={{ fontSize: 13, color: tk.textHi, fontWeight: 700 }}>{value}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AverageReturnsCard({ tk, tr, avgReturns, customerName }: {
  tk: Tokens; tr: Translator; avgReturns: AverageReturns | null; customerName: string | null;
}) {
  const pct = avgReturns?.return_rate_pct ?? 0;
  const good = tk.good ?? "#3dd68c", warn = "#f5a623", bad = tk.bad ?? "#e5484d";
  const pctColor = pct >= 10 ? bad : pct >= 5 ? warn : good;
  return (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, minWidth: 220 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 6 }}>
        {tr("sales_avg_returns", "Promedio de devoluciones")}
      </div>
      <div style={{ fontSize: 11, color: tk.textLo, marginBottom: 10 }}>
        {customerName ? customerName : tr("sales_avg_returns_all", "Todos los clientes")}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: tk.textHi }}>
          {money(avgReturns?.average_amount ?? 0)}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: pctColor, background: pctColor + "1A",
          borderRadius: 6, padding: "2px 8px",
        }}>
          {pct.toFixed(1)}%
        </div>
      </div>
      <div style={{ fontSize: 12, color: tk.textLo, marginTop: 4 }}>
        {avgReturns?.count ?? 0} {tr("sales_returns_count", "ventas canceladas")}
      </div>
      <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2 }}>
        {tr("sales_returns_of_total", "del total de ventas")} ({money(avgReturns?.total_returns ?? 0)} / {money((avgReturns?.total_sales ?? 0) + (avgReturns?.total_returns ?? 0))})
      </div>
    </div>
  );
}

function ForecastCard({ tk, tr, forecast }: { tk: Tokens; tr: Translator; forecast: CustomerForecast | null }) {
  if (!forecast) return null;
  const hasGoal = forecast.goal_allocated != null;
  const overGoal = hasGoal && (forecast.variance_vs_goal ?? 0) >= 0;
  return (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, minWidth: 260, flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 6 }}>
        {tr("sales_forecast", "Pronóstico de ventas")}
      </div>
      <div style={{ fontSize: 11, color: tk.textLo, marginBottom: 10 }}>{forecast.customer_name}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: tk.textHi }}>{money(forecast.forecast_next_month)}</div>
      <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>
        {tr("sales_forecast_next_month", "Próximo mes")} {forecast.goal_month ?? ""}
        {forecast.trend_pct != null && (
          <span style={{ color: forecast.trend_pct >= 0 ? (tk.good ?? "#3dd68c") : (tk.bad ?? "#e5484d"), marginLeft: 6, fontWeight: 700 }}>
            {forecast.trend_pct >= 0 ? "+" : ""}{forecast.trend_pct.toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${tk.border}`, marginTop: 12, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: tk.textLo }}>
          <span>{tr("sales_avg_monthly", "Promedio mensual")}</span><span style={{ color: tk.textHi, fontWeight: 600 }}>{money(forecast.avg_monthly)}</span>
        </div>
        {hasGoal && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: tk.textLo }}>
              <span>{tr("sales_goal_allocated", "Meta asignada")}</span><span style={{ color: tk.textHi, fontWeight: 600 }}>{money(forecast.goal_allocated ?? 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: tk.textLo }}>
              <span>{tr("sales_goal_variance", "Variación vs. meta")}</span>
              <span style={{ color: overGoal ? (tk.good ?? "#3dd68c") : (tk.bad ?? "#e5484d"), fontWeight: 700 }}>
                {overGoal ? "+" : ""}{money(forecast.variance_vs_goal ?? 0)}
              </span>
            </div>
          </>
        )}
        {!hasGoal && (
          <div style={{ fontSize: 11, color: tk.textLo }}>{tr("sales_no_goal", "Sin meta de ingresos configurada para este mes")}</div>
        )}
      </div>
    </div>
  );
}

export function Analytics({ tk, tr, trend, topCustomers, topProducts, customers, selectedCustomer, onSelectCustomer, avgReturns, forecast }: {
  tk: Tokens; tr: Translator; trend: TrendPoint[]; topCustomers: TopCustomer[]; topProducts: TopProduct[];
  customers: CustomerLite[]; selectedCustomer: number | null; onSelectCustomer: (id: number | null) => void;
  avgReturns: AverageReturns | null; forecast?: CustomerForecast | null;
}) {
  const hasGoal = trend.some((d) => d.goal != null);
  const customerName = selectedCustomer != null
    ? (customers.find((c) => c.id === selectedCustomer)?.name ?? null)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, flex: 1, minWidth: 320 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>
              {tr("sales_trend_combined", "Ventas, devoluciones y meta")}
            </div>
            <select
              value={selectedCustomer ?? ""}
              onChange={(e) => onSelectCustomer(e.target.value ? Number(e.target.value) : null)}
              style={{ background: tk.bg, color: tk.textHi, border: `1px solid ${tk.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
            >
              <option value="">{tr("sales_avg_returns_all", "Todos los clientes")}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <AreaTrendChart tk={tk} data={trend} />
          <ChartLegend tk={tk} hasGoal={hasGoal} />
        </div>
        <AverageReturnsCard tk={tk} tr={tr} avgReturns={avgReturns} customerName={customerName} />
        {selectedCustomer != null && <ForecastCard tk={tk} tr={tr} forecast={forecast ?? null} />}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <RankPanel tk={tk} title={tr("sales_top_customers", "Top clientes")} rows={topCustomers}
          render={(c) => ({ name: c.name, value: money(c.total), sub: `${c.orders} ${tr("sales_orders", "pedidos")}` })} />
        <RankPanel tk={tk} title={tr("sales_top_products", "Top productos")} rows={topProducts}
          render={(p) => ({ name: p.name, value: money(p.total), sub: `${p.quantity} ${tr("sales_units", "uds")}` })} />
      </div>
    </div>
  );
}
