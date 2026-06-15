// Lightweight analytics: dependency-free SVG trend chart + top lists.

import type { Tokens, Translator } from "./theme";
import { money } from "./theme";
import type { TrendPoint, TopCustomer, TopProduct } from "./types";
import { EmptyState } from "./ui";

function TrendChart({ tk, data }: { tk: Tokens; data: TrendPoint[] }) {
  if (!data.length) return <EmptyState tk={tk} title="Sin datos de tendencia" />;
  const W = 720, H = 200, pad = 28;
  const max = Math.max(...data.map((d) => d.total), 1);
  const bw = (W - pad * 2) / data.length;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={H - pad - (H - pad * 2) * g} y2={H - pad - (H - pad * 2) * g}
          stroke={tk.border} strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {data.map((d, i) => {
        const h = (H - pad * 2) * (d.total / max);
        const x = pad + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const y = H - pad - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(h, 1)} rx={3} fill={tk.accent} opacity={0.85}>
              <title>{`${d.period}: ${money(d.total)} (${d.count})`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + w / 2} y={H - pad + 14} fontSize={9} fill={tk.textLo} textAnchor="middle">
                {d.period.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
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

export function Analytics({ tk, tr, trend, topCustomers, topProducts }: {
  tk: Tokens; tr: Translator; trend: TrendPoint[]; topCustomers: TopCustomer[]; topProducts: TopProduct[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 12 }}>{tr("sales_trend", "Tendencia de ventas")}</div>
        <TrendChart tk={tk} data={trend} />
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
