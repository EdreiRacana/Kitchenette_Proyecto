// BIModule.tsx — Reportes / Business Intelligence Premium
// Pestañas: Ejecutivo · Ventas · Inventario · Finanzas · RH · Personalizado
// Todos los números mostrados se obtienen de endpoints reales del backend (incluyendo RH/Nómina).
// Contrato { t, s } igual que App.tsx

import { useState, useEffect, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard, Package, Wallet, Users, Sliders,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle,
  XCircle, Download, ChevronRight,
  Target, DollarSign, ShoppingCart, Clock, Star,
  Mail, X, Check,
  TrendingDown, Activity, TrendingUp, Store,
} from "lucide-react";
import { salesApi } from "../sales/api";
import { financeService } from "../finance/service";
import { inventoryService, type ReorderAlert } from "../inventory/service";
import { hrApi } from "../hr/api";
import { biService, type OmnichannelData } from "./service";
import ExecutiveLive from "./ExecutiveLive";

// ── Types ──────────────────────────────────────────────────────────────────
type Period = "week" | "month" | "quarter" | "year";
type TrafficLight = "green" | "yellow" | "red";

interface ChartPoint {
  label: string;
  current: number;
  prev: number;
  target?: number;
}

interface DrillRow {
  label: string;
  value: number;
  pct?: number;
  trend?: number;
  color?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = (n: number, type: "money" | "number" | "percent") => {
  if (type === "money") return n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + Math.round(n);
  if (type === "percent") return n.toFixed(1) + "%";
  return n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n));
};
const fmtFull = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const delta = (cur: number, prev: number) => prev === 0 ? 0 : Math.round(((cur - prev) / prev) * 1000) / 10;
const light = (cur: number, prev: number, target?: number): TrafficLight => {
  const d = delta(cur, prev);
  if (target && cur < target * 0.7) return "red";
  if (d >= 5) return "green";
  if (d >= 0) return "yellow";
  return "red";
};
const lightColor = (tl: TrafficLight, t: any) => ({ green: t.good, yellow: t.warn, red: t.bad }[tl]);
const PERIOD_LABELS: Record<Period, string> = { week: "Semana", month: "Mes", quarter: "Trimestre", year: "Año" };

// ── Rango de fechas: período actual vs período anterior comparable ─────────
function addPeriod(d: Date, period: Period, mult: number): Date {
  const r = new Date(d);
  if (period === "week") r.setDate(r.getDate() + 7 * mult);
  else if (period === "month") r.setMonth(r.getMonth() + 1 * mult);
  else if (period === "quarter") r.setMonth(r.getMonth() + 3 * mult);
  else r.setFullYear(r.getFullYear() + 1 * mult);
  return r;
}
function computeRanges(period: Period) {
  const curEnd = new Date();
  const curStart = addPeriod(curEnd, period, -1);
  const prevEnd = curStart;
  const prevStart = addPeriod(prevEnd, period, -1);
  return { curStart, curEnd, prevStart, prevEnd };
}
function trendParams(period: Period): { granularity: "day" | "week" | "month"; days: number } {
  if (period === "week") return { granularity: "day", days: 7 };
  if (period === "month") return { granularity: "day", days: 30 };
  if (period === "quarter") return { granularity: "week", days: 13 };
  return { granularity: "month", days: 12 };
}

// ── Exportar a CSV (descarga real en el navegador) ──────────────────────────
function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportPeriodReport(D: BIState, period: Period) {
  const rows: (string | number)[][] = [];
  rows.push([`Reporte BI · ${PERIOD_LABELS[period]}`, "", ""]);
  rows.push([]);
  rows.push(["INDICADORES PRINCIPALES", "Actual", "Anterior"]);
  rows.push(["Ventas totales (cobradas)", D.ventas, D.ventasPrev]);
  rows.push(["Ingresos (Finanzas)", D.ingresos, D.ingresosPrev]);
  rows.push(["Gastos totales", D.gastos, D.gastosPrev]);
  rows.push(["Utilidad neta", D.utilidad, D.utilidadPrev]);
  rows.push(["Margen neto (%)", D.margenNeto, D.margenNetoPrev]);
  rows.push(["Pedidos", D.pedidos, D.pedidosPrev]);
  rows.push(["Ticket promedio", D.ticket, D.ticketPrev]);
  rows.push(["Por cobrar (CXC, saldo actual)", D.cxc, ""]);
  rows.push(["Por pagar (CXP, saldo actual)", D.cxp, ""]);
  rows.push(["Valor de inventario (fotografía actual)", D.inventarioVal, ""]);
  rows.push([]);
  rows.push(["TOP CLIENTES", "Monto", ""]);
  D.topClientes.forEach(c => rows.push([c.label, c.value, ""]));
  rows.push([]);
  rows.push(["TOP PRODUCTOS", "Monto", ""]);
  D.topProductos.forEach(p => rows.push([p.label, p.value, ""]));
  rows.push([]);
  rows.push(["VENTAS POR CANAL", "Monto", "%"]);
  D.ventasPorCanal.forEach(c => rows.push([c.label, c.value, c.pct ?? ""]));
  rows.push([]);
  rows.push(["GASTOS POR CATEGORÍA", "Monto", "%"]);
  D.gastosCat.forEach(g => rows.push([g.label, g.value, g.pct ?? ""]));
  const fecha = new Date().toISOString().slice(0, 10);
  downloadCSV(`Reporte_BI_${PERIOD_LABELS[period]}_${fecha}.csv`, rows);
}

// ── SVG Charts ────────────────────────────────────────────────────────────
/* ── RadarChart: 6 ejes actual vs anterior ────────────────────────── */
function RadarChart({ t, axes, cur, prev, size = 240 }: any) {
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const n = axes.length;
  const angleFor = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (val: number, i: number, max: number) => {
    const norm = max > 0 ? Math.min(1, val / max) : 0;
    return [cx + r * norm * Math.cos(angleFor(i)), cy + r * norm * Math.sin(angleFor(i))];
  };
  // Normalizamos por eje: cada eje tiene su propio max (para que sean comparables)
  const maxByAxis = axes.map((_: any, i: number) => Math.max(cur[i] || 0, prev[i] || 0, 1));
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const polyPoints = (arr: number[]) =>
    arr.map((v, i) => pt(v, i, maxByAxis[i]).map((n) => n.toFixed(1)).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxHeight: size + 20 }}>
      {/* Grid concéntrico */}
      {gridLevels.map((lvl, i) => (
        <polygon key={i}
          points={axes.map((_: any, ai: number) => {
            const [x, y] = [cx + r * lvl * Math.cos(angleFor(ai)), cy + r * lvl * Math.sin(angleFor(ai))];
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ")}
          fill="none" stroke={t.border} strokeWidth="1" opacity="0.5" />
      ))}
      {/* Ejes radiales */}
      {axes.map((_: any, i: number) => {
        const [x, y] = [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))];
        return <line key={i} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke={t.border} strokeWidth="1" opacity="0.5" />;
      })}
      {/* Polígono período anterior */}
      <polygon points={polyPoints(prev)} fill={t.textLo} fillOpacity="0.10" stroke={t.textLo} strokeOpacity="0.55" strokeWidth="1.4" strokeDasharray="4 4" />
      {/* Polígono actual */}
      <polygon points={polyPoints(cur)} fill={t.nova} fillOpacity="0.14" stroke={t.nova} strokeOpacity="0.85" strokeWidth="1.8" />
      {cur.map((v: number, i: number) => {
        const [x, y] = pt(v, i, maxByAxis[i]);
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill={t.panel} stroke={t.nova} strokeWidth="1.6" />;
      })}
      {/* Labels */}
      {axes.map((ax: string, i: number) => {
        const [x, y] = [cx + (r + 22) * Math.cos(angleFor(i)), cy + (r + 22) * Math.sin(angleFor(i))];
        const anchor: any = Math.abs(x - cx) < 5 ? "middle" : x < cx ? "end" : "start";
        return (
          <text key={i} x={x.toFixed(1)} y={y.toFixed(1)} textAnchor={anchor}
                fontSize="10.5" fill={t.textMid} fontWeight="600" dominantBaseline="middle">
            {ax}
          </text>
        );
      })}
    </svg>
  );
}

/* ── Waterfall: cascada P&L (Ingresos → Gastos → Utilidad) ─────────── */
function WaterfallChart({ t, ingresos, gastosCategorias, utilidad }: any) {
  // Construimos steps: primer barra sube = ingresos; luego una barra baja por cada categoría de gasto; última barra = utilidad neta.
  type Step = { label: string; delta: number; kind: "start" | "sub" | "end"; };
  const steps: Step[] = [{ label: "Ingresos", delta: ingresos, kind: "start" }];
  for (const g of gastosCategorias.slice(0, 5)) {
    steps.push({ label: g.label, delta: -Math.abs(g.value), kind: "sub" });
  }
  // Si hay más gastos, agrupa el resto
  if (gastosCategorias.length > 5) {
    const restTotal = gastosCategorias.slice(5).reduce((a: number, c: any) => a + c.value, 0);
    if (restTotal > 0) steps.push({ label: "Otros gastos", delta: -restTotal, kind: "sub" });
  }
  steps.push({ label: "Utilidad neta", delta: utilidad, kind: "end" });

  // Cálculo cumulativo
  let cum = 0;
  const bars = steps.map((s, i) => {
    if (s.kind === "end") {
      // Utilidad neta = barra desde 0 hasta el valor final
      const to = s.delta;
      return { ...s, from: 0, to, i };
    }
    const from = s.kind === "start" ? 0 : cum;
    const to = from + s.delta;
    cum = to;
    return { ...s, from, to, i };
  });

  const maxAbs = Math.max(1, ...bars.map(b => Math.abs(b.from)), ...bars.map(b => Math.abs(b.to)));
  const W = 800, H = 260, PL = 20, PR = 20, PT = 20, PB = 44;
  const iw = W - PL - PR, ih = H - PT - PB;
  const barW = Math.min(70, (iw / bars.length) * 0.62);
  const bx = (i: number) => PL + (iw / bars.length) * i + (iw / bars.length - barW) / 2;
  const by = (v: number) => PT + (1 - v / maxAbs) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} preserveAspectRatio="xMidYMid meet">
      {/* Base line (0) */}
      <line x1={PL} x2={W - PR} y1={PT + ih} y2={PT + ih} stroke={t.border} strokeWidth="1" />
      {bars.map((b, i) => {
        const y1 = by(b.from), y2 = by(b.to);
        const top = Math.min(y1, y2), h = Math.max(2, Math.abs(y2 - y1));
        const color = b.kind === "start" ? t.nova : b.kind === "end" ? (b.to >= 0 ? t.good : t.bad) : "#B87A8A";
        return (
          <g key={i}>
            <rect x={bx(i).toFixed(1)} y={top.toFixed(1)} width={barW.toFixed(1)} height={h.toFixed(1)}
                  rx="4" fill={color} fillOpacity="0.35" stroke={color} strokeOpacity="0.7" strokeWidth="1" />
            {/* Línea conectora hacia siguiente */}
            {i < bars.length - 1 && b.kind !== "end" && (
              <line x1={(bx(i) + barW).toFixed(1)} y1={y2.toFixed(1)}
                    x2={bx(i + 1).toFixed(1)} y2={y2.toFixed(1)}
                    stroke={t.border} strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />
            )}
            <text x={(bx(i) + barW / 2).toFixed(1)} y={(top - 6).toFixed(1)} textAnchor="middle"
                  fontSize="10.5" fill={t.textHi} fontWeight="700">
              {(b.delta >= 0 ? "+" : "−") + fmt(Math.abs(b.delta), "money")}
            </text>
            <text x={(bx(i) + barW / 2).toFixed(1)} y={(PT + ih + 16).toFixed(1)} textAnchor="middle"
                  fontSize="10" fill={t.textLo}>
              {b.label.length > 12 ? b.label.slice(0, 11) + "…" : b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Sankey/Embudo curvo (trapecios) ──────────────────────────────── */
function SankeyFunnel({ t, stages }: any) {
  // stages: [{ label, value, color }]
  if (!stages || stages.length === 0) return null;
  const W = 720, H = 230, PL = 16, PR = 16, PT = 22, PB = 40;
  const iw = W - PL - PR, ih = H - PT - PB;
  const max = Math.max(1, stages[0].value);
  const gapPx = 30;                                   // aire entre etapas (para la píldora de conversión)
  const sectionW = (iw - gapPx * (stages.length - 1)) / stages.length;
  const cy = PT + ih / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
      <defs>
        {stages.map((s: any, i: number) => (
          <linearGradient key={i} id={`sankG${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.75" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0.32" />
          </linearGradient>
        ))}
      </defs>
      {stages.map((s: any, i: number) => {
        const nextV = i < stages.length - 1 ? stages[i + 1].value : s.value;
        const h1 = Math.max(6, (s.value / max) * ih), h2 = Math.max(6, (nextV / max) * ih);
        const x0 = PL + i * (sectionW + gapPx);
        const x1 = x0 + sectionW;
        const top1 = cy - h1 / 2, bot1 = cy + h1 / 2;
        const top2 = cy - h2 / 2, bot2 = cy + h2 / 2;
        const trap = `M ${x0} ${top1} L ${x1} ${top2} L ${x1} ${bot2} L ${x0} ${bot1} Z`;
        const isLast = i === stages.length - 1;
        const conv = s.value > 0 ? Math.round((nextV / s.value) * 100) : 0;
        const midX = (x1 + gapPx / 2).toFixed(1);
        return (
          <g key={i}>
            <path d={trap} fill={`url(#sankG${i})`} stroke={s.color} strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round" />
            <text x={((x0 + x1) / 2).toFixed(1)} y={(cy - 3).toFixed(1)} textAnchor="middle" fontSize="17" fontWeight="800" fill={t.textHi} style={{ fontVariantNumeric: "tabular-nums" }}>
              {s.value.toLocaleString("es-MX")}
            </text>
            <text x={((x0 + x1) / 2).toFixed(1)} y={(PT + ih + 22).toFixed(1)} textAnchor="middle" fontSize="11" fontWeight="600" fill={t.textMid}>
              {s.label}
            </text>
            {/* Píldora de conversión hacia la siguiente etapa */}
            {!isLast && (
              <g>
                <line x1={(x1 + 2).toFixed(1)} y1={cy} x2={(x1 + gapPx - 2).toFixed(1)} y2={cy} stroke={t.border} strokeWidth="1.5" strokeDasharray="3 3" />
                <rect x={(+midX - 17).toFixed(1)} y={(cy - 10).toFixed(1)} width="34" height="20" rx="10" fill={t.panel3} stroke={conv >= 60 ? t.good : conv >= 30 ? t.warn : t.bad} strokeOpacity="0.6" strokeWidth="1" />
                <text x={midX} y={(cy + 4).toFixed(1)} textAnchor="middle" fontSize="10.5" fontWeight="800" fill={conv >= 60 ? t.good : conv >= 30 ? t.warn : t.bad}>
                  {conv}%
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Treemap simple (squarified aproximado, filas horizontales) ───── */
function Treemap({ t, items, height = 220 }: any) {
  if (!items || items.length === 0) {
    return <div style={{ padding: "60px 0", textAlign: "center", color: t.textLo, fontSize: 12.5 }}>Sin datos.</div>;
  }
  const total = items.reduce((a: number, it: any) => a + it.value, 0) || 1;
  // Distribución en filas: agrupa las 3 más grandes en fila superior y el resto en fila inferior
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const topRow = sorted.slice(0, 3);
  const bottomRow = sorted.slice(3);
  const topSum = topRow.reduce((a, it) => a + it.value, 0);
  const bottomSum = bottomRow.reduce((a, it) => a + it.value, 0);
  const topRowH = bottomRow.length === 0 ? height : Math.round(height * (topSum / total));
  const bottomRowH = height - topRowH;
  const palette = ["#5B8DEF", "#5EBBA9", "#C89E5A", "#8E7BB8", "#B87A8A", "#7BA98E", "#8CA1BE"];
  const renderRow = (row: any[], rowH: number, sum: number) => (
    <div style={{ display: "flex", width: "100%", height: rowH, gap: 2 }}>
      {row.map((it, i) => {
        const w = sum > 0 ? (it.value / sum) * 100 : 0;
        const color = palette[i % palette.length];
        return (
          <div key={i} style={{ width: `${w}%`, background: color + "38", border: `1px solid ${color}66`, borderRadius: 4, padding: "8px 10px", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0 }} title={`${it.label} — ${fmt(it.value, "money")}`}>
            <div style={{ fontSize: 11.5, color: t.textHi, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: color }}>{fmt(it.value, "money")}</div>
              <div style={{ fontSize: 10, color: t.textLo }}>{((it.value / total) * 100).toFixed(1)}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {topRow.length > 0 && renderRow(topRow, topRowH, topSum)}
      {bottomRow.length > 0 && renderRow(bottomRow, bottomRowH, bottomSum)}
    </div>
  );
}

/* ── Heatmap semanal (7 días × 24 horas) ──────────────────────────── */
function HeatmapWeek({ t, cells }: any) {
  const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells || []) {
    if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.dow][c.hour] += c.total || 0;
    }
  }
  const max = Math.max(1, ...grid.flat());
  const NR = 51, NG = 178, NB = 245;                   // t.nova (#33B2F5) en RGB
  const cell = (a: number) => `rgba(${NR}, ${NG}, ${NB}, ${a})`;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "44px repeat(24, minmax(20px, 1fr))", gap: 3, minWidth: 640 }}>
        <div />
        {hours.map(h => (
          <div key={h} style={{ fontSize: 9, color: t.textLo, textAlign: "center", paddingBottom: 4 }}>
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
        {days.map((d, di) => (
          <Fragment key={`row-${di}`}>
            <div style={{ fontSize: 11, color: t.textMid, display: "flex", alignItems: "center", paddingRight: 6, fontWeight: 600 }}>{d}</div>
            {hours.map(h => {
              const v = grid[di][h];
              const alpha = v > 0 ? 0.14 + Math.pow(v / max, 0.6) * 0.7 : 0;
              return (
                <div key={`${di}-${h}`}
                     title={v > 0 ? `${d} ${h}:00 — ${fmt(v, "money")}` : `${d} ${h}:00 — sin ventas`}
                     style={{
                       height: 22, borderRadius: 4,
                       background: v > 0 ? cell(alpha) : t.panel3,
                       boxShadow: v >= max * 0.85 ? `0 0 0 1px ${cell(0.9)}` : "none",
                     }} />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 10.5, color: t.textLo }}>
        <span>Menos</span>
        <div style={{ width: 8, height: 12, borderRadius: 2, background: t.panel3 }} />
        {[0.2, 0.4, 0.6, 0.8, 1].map(a => (
          <div key={a} style={{ width: 20, height: 12, borderRadius: 2, background: cell(a) }} />
        ))}
        <span>Más actividad</span>
      </div>
    </div>
  );
}

/* ── Bubble chart: Top clientes (X pedidos, Y ticket, tamaño = venta) ─ */
function BubbleChart({ t, items }: any) {
  if (!items || items.length === 0) {
    return <div style={{ padding: "60px 0", textAlign: "center", color: t.textLo, fontSize: 12.5 }}>Sin ventas registradas.</div>;
  }
  const [hover, setHover] = useState<number | null>(null);
  const W = 700, H = 300, PL = 60, PR = 20, PT = 20, PB = 44;
  const iw = W - PL - PR, ih = H - PT - PB;
  const maxOrders = Math.max(1, ...items.map((it: any) => it.orders));
  const maxTicket = Math.max(1, ...items.map((it: any) => it.ticket));
  const maxTotal = Math.max(1, ...items.map((it: any) => it.total));
  const x = (v: number) => PL + (v / maxOrders) * iw;
  const y = (v: number) => PT + (1 - v / maxTicket) * ih;
  const rBubble = (v: number) => 8 + Math.sqrt(v / maxTotal) * 30;
  const palette = ["#33B2F5", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#FB923C"];
  const topIdx = items.reduce((b: number, it: any, i: number) => it.total > items[b].total ? i : b, 0);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {/* Grid recesivo */}
        {[0, 0.25, 0.5, 0.75, 1].map(g => (
          <line key={`h${g}`} x1={PL} x2={W - PR} y1={PT + (1 - g) * ih} y2={PT + (1 - g) * ih} stroke={t.gridLine} strokeWidth="1" opacity={g === 0 ? "0.9" : "0.45"} />
        ))}
        {[0.25, 0.5, 0.75, 1].map(g => (
          <line key={`v${g}`} x1={PL + g * iw} x2={PL + g * iw} y1={PT} y2={PT + ih} stroke={t.gridLine} strokeWidth="1" opacity="0.3" />
        ))}
        <line x1={PL} y1={PT} x2={PL} y2={PT + ih} stroke={t.gridLine} strokeWidth="1" opacity="0.9" />
        {/* Bubbles con anillo de superficie */}
        {items.map((it: any, i: number) => {
          const cxB = x(it.orders), cyB = y(it.ticket), rB = rBubble(it.total);
          const color = palette[i % palette.length];
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: "pointer" }}>
              <circle cx={cxB.toFixed(1)} cy={cyB.toFixed(1)} r={rB.toFixed(1)}
                      fill={color} fillOpacity={hover === i ? 0.6 : 0.38}
                      stroke={t.panel} strokeWidth="2" />
              <circle cx={cxB.toFixed(1)} cy={cyB.toFixed(1)} r={rB.toFixed(1)}
                      fill="none" stroke={color} strokeOpacity={hover === i ? "1" : "0.7"} strokeWidth={hover === i ? "2" : "1.2"} />
              {i === topIdx && rB > 16 && (
                <text x={cxB.toFixed(1)} y={(cyB + 3).toFixed(1)} textAnchor="middle" fontSize="10" fontWeight="700" fill={t.textHi} style={{ pointerEvents: "none" }}>
                  {it.name.length > 12 ? it.name.slice(0, 11) + "…" : it.name}
                </text>
              )}
            </g>
          );
        })}
        {/* Ejes / etiquetas */}
        <text x={PL - 6} y={PT + 8} textAnchor="end" fontSize="10" fill={t.textLo}>Ticket prom.</text>
        <text x={PL - 6} y={PT + ih + 4} textAnchor="end" fontSize="10" fill={t.textLo}>0</text>
        <text x={PL} y={H - 8} textAnchor="start" fontSize="10" fill={t.textLo}>0 pedidos</text>
        <text x={W - PR} y={H - 8} textAnchor="end" fontSize="10" fill={t.textLo}>{maxOrders} pedidos →</text>
      </svg>
      {hover !== null && (
        <div style={{ position: "absolute", top: 12, right: 20, background: t.panel2, border: `1px solid ${t.nova}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.45)", minWidth: 200, pointerEvents: "none" }}>
          <div style={{ fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{items[hover].name}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: t.textMid }}>
            <span>Ventas totales</span><span style={{ color: t.textHi, fontWeight: 700 }}>{fmt(items[hover].total, "money")}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: t.textMid, marginTop: 3 }}>
            <span>Pedidos</span><span style={{ color: t.textHi }}>{items[hover].orders}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: t.textMid, marginTop: 3 }}>
            <span>Ticket promedio</span><span style={{ color: t.textHi }}>{fmt(items[hover].ticket, "money")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LineBarChart({ data, t, height = 200 }: { data: ChartPoint[]; t: any; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  // Series: azul = período actual · naranja = período anterior (par CVD-seguro)
  const CUR = t.nova || "#33B2F5";
  const PREV = "#FB923C";
  const W = 600, H = height, PL = 6, PR = 6, PT = 14, PB = 12;
  const iw = W - PL - PR, ih = H - PT - PB, n = data.length;
  const baseY = PT + ih;
  const maxVal = (Math.max(1, ...data.map(d => Math.max(d.current, d.prev)))) * 1.18;
  const x = (i: number) => PL + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => PT + (1 - v / maxVal) * ih;

  // Curva suave (Catmull-Rom → Bézier cúbica)
  const smooth = (vals: number[]) => {
    const p = vals.map((v, i) => [x(i), y(v)] as [number, number]);
    if (p.length < 2) return p.length ? `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}` : "";
    let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const curLine = smooth(data.map(d => d.current));
  const prevLine = smooth(data.map(d => d.prev));
  const toArea = (line: string) => n ? `${line} L ${x(n - 1).toFixed(1)} ${baseY.toFixed(1)} L ${x(0).toFixed(1)} ${baseY.toFixed(1)} Z` : "";
  const grid = [0, 0.25, 0.5, 0.75, 1].map(g => PT + g * ih);
  const nearest = (px: number) => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const dd = Math.abs(px - x(i)); if (dd < bd) { bd = dd; b = i; } } return b; };
  const hv = hover !== null ? data[hover] : null;
  const hd = hv ? delta(hv.current, hv.prev) : 0;
  const posPct = (i: number) => (x(i) / W) * 100;
  const stride = Math.max(1, Math.ceil(n / 9));

  if (!n) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: t.textLo, fontSize: 13 }}>Sin datos para este período</div>;

  return (
    <div style={{ position: "relative" }}>
      {/* Leyenda (identidad no depende solo del color) */}
      <div style={{ display: "flex", gap: 18, marginBottom: 12 }}>
        {[{ c: CUR, l: "Período actual" }, { c: PREV, l: "Período anterior" }].map(s => (
          <span key={s.l} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: t.textMid, fontWeight: 600 }}>
            <span style={{ width: 18, height: 3, borderRadius: 3, background: s.c }} />{s.l}
          </span>
        ))}
      </div>

      <div style={{ position: "relative", width: "100%", height, cursor: "crosshair" }}
        onMouseMove={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setHover(nearest((e.clientX - r.left) / r.width * W)); }}
        onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id="biAreaCur" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CUR} stopOpacity="0.28" />
              <stop offset="90%" stopColor={CUR} stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="biAreaPrev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PREV} stopOpacity="0.16" />
              <stop offset="90%" stopColor={PREV} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {grid.map((g, i) => <line key={i} x1={PL} x2={W - PR} y1={g} y2={g} stroke={t.gridLine} strokeWidth="1" opacity={i === grid.length - 1 ? "0.85" : "0.4"} vectorEffect="non-scaling-stroke" />)}
          <path d={toArea(prevLine)} fill="url(#biAreaPrev)" />
          <path d={toArea(curLine)} fill="url(#biAreaCur)" />
          <path d={prevLine} fill="none" stroke={PREV} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" vectorEffect="non-scaling-stroke" />
          <path d={curLine} fill="none" stroke={CUR} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hv && <line x1={x(hover!)} x2={x(hover!)} y1={PT} y2={baseY} stroke={t.textMid} strokeWidth="1" strokeDasharray="4 4" opacity="0.45" vectorEffect="non-scaling-stroke" />}
        </svg>

        {/* Marcadores en hover (HTML → nítidos, con anillo de superficie) */}
        {hv && (
          <>
            <span style={{ position: "absolute", left: `${posPct(hover!)}%`, top: y(hv.prev), width: 9, height: 9, borderRadius: 99, background: PREV, boxShadow: `0 0 0 2px ${t.panel}`, transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
            <span style={{ position: "absolute", left: `${posPct(hover!)}%`, top: y(hv.current), width: 11, height: 11, borderRadius: 99, background: CUR, boxShadow: `0 0 0 2px ${t.panel}, 0 0 0 6px ${CUR}22`, transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
          </>
        )}
      </div>

      {/* Eje X (HTML → sin distorsión por el stretch del SVG) */}
      <div style={{ position: "relative", height: 16, marginTop: 4 }}>
        {data.map((d, i) => (i % stride === 0 || i === n - 1) && (
          <span key={i} style={{ position: "absolute", left: `${posPct(i)}%`, transform: "translateX(-50%)", fontSize: 10.5, color: t.textLo, whiteSpace: "nowrap" }}>{d.label}</span>
        ))}
      </div>

      {hv && (
        <div style={{ position: "absolute", top: 30, left: `${posPct(hover!) > 62 ? posPct(hover!) - 2 : posPct(hover!) + 2}%`, transform: posPct(hover!) > 62 ? "translateX(-100%)" : "none", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: "9px 12px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.45)", minWidth: 140, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{hv.label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 3 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 3, borderRadius: 3, background: CUR }} />Actual</span>
            <span style={{ color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(hv.current, "money")}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 6 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 3, borderRadius: 3, background: PREV }} />Anterior</span>
            <span style={{ color: t.textMid, fontVariantNumeric: "tabular-nums" }}>{fmt(hv.prev, "money")}</span>
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 5, color: hd >= 0 ? t.good : t.bad, fontWeight: 700 }}>
            {hd >= 0 ? "▲ +" : "▼ "}{hd}% vs anterior
          </div>
        </div>
      )}
    </div>
  );
}

function DonutChart({ data, t, size = 150 }: { data: { label: string; value: number; color: string }[]; t: any; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size * 0.4, sw = size * 0.13;
  const r2d = Math.PI / 180;
  const gap = data.length > 1 ? 4 : 0;                 // separación (grados) → aire entre segmentos
  let angle = -90;
  const arcs = total ? data.map(d => {
    const pct = d.value / total;
    const deg = pct * 360;
    const start = angle + gap / 2;
    const end = angle + deg - gap / 2;
    angle += deg;
    if (end <= start) return { ...d, pct, path: "", full: pct >= 0.999 };
    const x1 = cx + r * Math.cos(start * r2d), y1 = cy + r * Math.sin(start * r2d);
    const x2 = cx + r * Math.cos(end * r2d), y2 = cy + r * Math.sin(end * r2d);
    const large = (end - start) > 180 ? 1 : 0;
    return { ...d, pct, full: false, path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}` };
  }) : [];
  const hv = hover !== null ? arcs[hover] : null;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {/* Pista recesiva */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.panel3} strokeWidth={sw} />
      {arcs.map((a, i) => (
        a.full
          ? <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={sw} opacity="0.92" />
          : <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={hover === i ? sw + 4 : sw} strokeLinecap="round" opacity={hover === null || hover === i ? "0.92" : "0.35"} style={{ cursor: "pointer", transition: "stroke-width .12s, opacity .12s" }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
      ))}
      {hv ? (
        <>
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.17} fontWeight="800" fill={t.textHi}>{Math.round(hv.pct * 100)}%</text>
          <text x={cx} y={cy + 13} textAnchor="middle" fontSize={size * 0.072} fill={t.textLo}>{hv.label.length > 14 ? hv.label.slice(0, 13) + "…" : hv.label}</text>
        </>
      ) : (
        <>
          <text x={cx} y={cy - 3} textAnchor="middle" fontSize={size * 0.115} fontWeight="800" fill={t.textHi} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(total, "money")}</text>
          <text x={cx} y={cy + 13} textAnchor="middle" fontSize={size * 0.072} fill={t.textLo}>Total</text>
        </>
      )}
    </svg>
  );
}

function SparkMini({ data, color, width = 80, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  const min = Math.min(...data), max = Math.max(...data);
  const px = (i: number) => (i / Math.max(1, data.length - 1)) * width;
  const py = (v: number) => max === min ? height / 2 : height - 4 - ((v - min) / (max - min)) * (height - 8);
  const path = data.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ overflow: "visible" }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx={px(data.length - 1)} cy={py(data[data.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}

/* ── Núcleo de líquido (medidor de nivel animado) ─────────────────────
   Mismo instrumento que la esfera de "Meta vs real" del Tablero: vaso
   circular que se llena de líquido "Matrix" hasta el %, con superficie de
   onda en movimiento, burbujas y anillo de ticks. Animación SMIL (SVG puro). */
function LiquidCore({ pct, t, sub, hue = "green" }: { pct: number; t: any; sub?: string; hue?: "green" | "blue" }) {
  const W = 200, H = 204, cx = 100, cy = 100, r = 78;
  const fillPct = Math.max(0, Math.min(100, Math.round(pct)));
  const bot = cy + r;
  const fillTopY = bot - (2 * r) * fillPct / 100;
  const MTX = hue === "blue"
    ? { dark: "#0B4A78", mid: "#1E86CC", bright: "#33B2F5", surf: "#8CEEFF" }
    : { dark: "#067A2E", mid: "#12D954", bright: "#5BFF87", surf: "#8AFFB0" };
  // Theme-aware: la esfera debe leerse igual en claro y oscuro.
  const isLight = ((): boolean => { const h = String(t.base || t.panel || "").replace("#", ""); if (h.length < 6) return false; return (parseInt(h.slice(0, 2), 16) * 299 + parseInt(h.slice(2, 4), 16) * 587 + parseInt(h.slice(4, 6), 16) * 114) / 1000 > 140; })();
  const waveFill = (amp: number, wl: number) => {
    let d = `M ${-2 * wl} ${fillTopY.toFixed(1)}`;
    for (let x = -2 * wl; x <= W + 2 * wl; x += 5) d += ` L ${x} ${(fillTopY + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(1)}`;
    return d + ` L ${W + 2 * wl} ${bot + 24} L ${-2 * wl} ${bot + 24} Z`;
  };
  const waveLine = (amp: number, wl: number) => {
    let d = `M ${-2 * wl} ${(fillTopY + amp * Math.sin((-2 * wl / wl) * 2 * Math.PI)).toFixed(1)}`;
    for (let x = -2 * wl; x <= W + 2 * wl; x += 5) d += ` L ${x} ${(fillTopY + amp * Math.sin((x / wl) * 2 * Math.PI)).toFixed(1)}`;
    return d;
  };
  const gridYs = [38, 54, 70, 86, 102, 118, 134, 150, 166];
  const bubbles = [
    { x: 76, r: 2.4, dur: 3.6, begin: 0 }, { x: 112, r: 1.7, dur: 4.3, begin: 0.9 },
    { x: 94, r: 3, dur: 3.9, begin: 1.7 }, { x: 128, r: 1.9, dur: 4.7, begin: 2.4 },
    { x: 66, r: 1.5, dur: 3.2, begin: 1.2 },
  ];
  const hasLiquid = fillPct > 0.5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 210, height: "auto", display: "block" }}>
      <defs>
        <clipPath id="lcClip"><circle cx={cx} cy={cy} r={r - 3} /></clipPath>
        <linearGradient id="lcLiquid" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={MTX.dark} /><stop offset="70%" stopColor={MTX.mid} /><stop offset="100%" stopColor={MTX.bright} />
        </linearGradient>
        <radialGradient id="lcVign" cx="50%" cy="42%" r="62%">
          <stop offset="58%" stopColor="#000" stopOpacity="0" /><stop offset="100%" stopColor="#000" stopOpacity={isLight ? "0.06" : "0.38"} />
        </radialGradient>
        <filter id="lcGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.6" /></filter>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={t.panel3} opacity="0.5" />
      <g clipPath="url(#lcClip)">
        {gridYs.map((y) => <line key={y} x1={cx - r} x2={cx + r} y1={y} y2={y} stroke={t.gridLine} strokeWidth="1" opacity={isLight ? "0.7" : "0.5"} />)}
        {hasLiquid && (
          <>
            <g opacity="0.3">
              <animateTransform attributeName="transform" type="translate" from="0 0" to="-100 0" dur="5.5s" repeatCount="indefinite" />
              <path d={waveFill(6, 100)} fill={MTX.mid} />
            </g>
            <g>
              <animateTransform attributeName="transform" type="translate" from="0 0" to="-70 0" dur="3.2s" repeatCount="indefinite" />
              <path d={waveFill(5, 70)} fill="url(#lcLiquid)" opacity="0.92" />
              <path d={waveLine(5, 70)} fill="none" stroke={MTX.surf} strokeWidth="2" filter="url(#lcGlow)" />
            </g>
            {bubbles.map((b, i) => (
              <circle key={i} cx={b.x} cy={bot - 6} r={b.r} fill={MTX.surf} opacity="0">
                <animate attributeName="cy" from={bot - 6} to={fillTopY + 4} dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.55;0" dur={`${b.dur}s`} begin={`${b.begin}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </>
        )}
        <rect x="0" y="0" width={W} height={H} fill="url(#lcVign)" />
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={MTX.bright} strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={t.border} strokeWidth="1" />
      {Array.from({ length: 36 }, (_, i) => {
        const a = (i * 10 - 90) * Math.PI / 180;
        const major = i % 9 === 0;
        const x1 = cx + (r + 4) * Math.cos(a), y1 = cy + (r + 4) * Math.sin(a);
        const x2 = cx + (r + (major ? 11 : 7)) * Math.cos(a), y2 = cy + (r + (major ? 11 : 7)) * Math.sin(a);
        return <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke={major ? MTX.bright : t.textLo} strokeWidth="1" opacity={major ? "0.85" : "0.35"} />;
      })}
      <text x={cx} y={cy - 1} textAnchor="middle" fontSize="42" fontWeight="800" fill={t.textHi} style={{ letterSpacing: "-1px" }}>{fillPct}%</text>
      {sub && <text x={cx} y={cy + 17} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={t.textMid} letterSpacing="1.4">{sub}</text>}
    </svg>
  );
}

// ── KPI Card Component ────────────────────────────────────────────────────
function KPIBlock({ label, value, prev, format, icon: Icon, color, target, t, sparkData, onClick, noHistory }: any) {
  const hasComparison = !noHistory && prev !== undefined && prev !== null && prev !== value;
  const d = hasComparison ? delta(value, prev) : 0;
  const up = d >= 0;
  const tl = hasComparison ? light(value, prev, target) : ("yellow" as TrafficLight);
  const tlColor = lightColor(tl, t);
  return (
    <div onClick={onClick} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 18px", cursor: onClick ? "pointer" : "default", position: "relative", overflow: "hidden", transition: "transform .12s, box-shadow .12s" }}
      onMouseEnter={e => onClick && ((e.currentTarget as any).style.transform = "translateY(-2px)")}
      onMouseLeave={e => onClick && ((e.currentTarget as any).style.transform = "")}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tlColor, borderRadius: "12px 0 0 12px" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ background: color + "18", color, borderRadius: 8, padding: 7, display: "flex" }}><Icon size={16} /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: tlColor, boxShadow: `0 0 0 3px ${tlColor}22` }} />
          {sparkData && <SparkMini data={sparkData} color={tlColor} />}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmt(value, format)}</div>
      {target && (
        <div style={{ marginTop: 6, height: 4, background: t.panel3, borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, (value / target) * 100)}%`, height: "100%", borderRadius: 99, background: tlColor, transition: "width .4s" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7 }}>
        {hasComparison ? (
          <>
            {up ? <ArrowUpRight size={13} color={t.good} /> : <ArrowDownRight size={13} color={t.bad} />}
            <span style={{ fontSize: 12, fontWeight: 700, color: up ? t.good : t.bad }}>{Math.abs(d)}%</span>
            <span style={{ fontSize: 11, color: t.textLo }}>vs anterior</span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: t.textLo, fontStyle: "italic" }}>— sin comparativo histórico</span>
        )}
        {target && <span style={{ fontSize: 11, color: t.textLo, marginLeft: 4 }}>· ref. {fmt(target, format)}</span>}
      </div>
      {onClick && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 8, fontSize: 11, color: t.nova, fontWeight: 600 }}>
          Ver detalle <ChevronRight size={12} />
        </div>
      )}
    </div>
  );
}

// ── Drill-down Table ──────────────────────────────────────────────────────
function DrillTable({ rows, t, title, colorPalette, emptyMsg }: { rows: DrillRow[]; t: any; title: string; colorPalette?: string[]; emptyMsg?: string }) {
  const COLORS = colorPalette || ["#33B2F5", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#60A5FA", "#FB923C"];
  const maxVal = Math.max(1, ...rows.map(r => r.value));
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>{title}</div>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: t.textLo }}>{emptyMsg || "Sin datos para este período."}</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: t.textMid, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.value)}</span>
              {r.pct !== undefined && <span style={{ fontSize: 11, color: t.textLo }}>{r.pct.toFixed(1)}%</span>}
              {r.trend !== undefined && (
                <span style={{ fontSize: 11, fontWeight: 700, color: r.trend >= 0 ? t.good : t.bad, display: "flex", alignItems: "center", gap: 2 }}>
                  {r.trend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{Math.abs(r.trend)}%
                </span>
              )}
            </div>
          </div>
          <div style={{ height: 5, background: t.panel3, borderRadius: 99 }}>
            <div style={{ width: `${(r.value / maxVal) * 100}%`, height: "100%", borderRadius: 99, background: r.color || COLORS[i % COLORS.length], opacity: 0.85, transition: "width .4s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title, color, t }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <div style={{ background: color + "22", color, borderRadius: 8, padding: 7, display: "flex" }}><Icon size={16} /></div>
      <span style={{ fontSize: 15, fontWeight: 700, color: t.textHi }}>{title}</span>
    </div>
  );
}

// ── Health Badge ──────────────────────────────────────────────────────────
function HealthBadge({ tl, t }: { tl: TrafficLight; t: any }) {
  const c = lightColor(tl, t);
  const labels = { green: "Saludable", yellow: "Atención", red: "Crítico" };
  const icons = { green: CheckCircle, yellow: AlertTriangle, red: XCircle };
  const Icon = icons[tl];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: c, background: c + "18", padding: "4px 10px", borderRadius: 20 }}>
      <Icon size={12} />{labels[tl]}
    </span>
  );
}

// ── Estado real (sin datos de demostración) ─────────────────────────────────
interface BIState {
  ventas: number; ventasPrev: number;
  pedidos: number; pedidosPrev: number;
  ticket: number; ticketPrev: number;
  pendientes: number; pendientesPrev: number;
  paidRate: number; paidRatePrev: number;
  quotesCount: number; quotesCountPrev: number;
  chartSales: ChartPoint[];
  topClientes: DrillRow[];
  topProductos: DrillRow[];
  ventasPorVendedor: DrillRow[];
  ventasPorCanal: (DrillRow & { color: string })[];

  ingresos: number; ingresosPrev: number;
  gastos: number; gastosPrev: number;
  utilidad: number; utilidadPrev: number;
  margenNeto: number; margenNetoPrev: number;
  gastosCat: DrillRow[];
  nomina: number | null; nominaPrev: number | null;
  cxc: number; cxp: number;

  inventarioVal: number;
  inventarioUnidades: number;
  inventarioAgotados: number;
  inventarioBajoStock: number;
  inventarioCat: DrillRow[];
  reorderAlerts: ReorderAlert[];

  hrTotal: number; hrActive: number; hrOnTrial: number; hrExpiring30: number;
  hrPayrollMonthly: number; hrPresentToday: number; hrAbsentToday: number;
  hrByDepartment: DrillRow[];

  // Nuevos datasets para charts BI premium
  heatmap: { dow: number; hour: number; orders: number; total: number }[];
  topClientesRich: { name: string; total: number; orders: number; ticket: number }[];
  salaryBuckets: DrillRow[];  // histograma de salarios (base_salary de empleados)
}

// Paleta pastel — copiada del Tablero rediseñado para coherencia visual
const CHANNEL_COLORS = ["#5B8DEF", "#5EBBA9", "#C89E5A", "#8E7BB8", "#B87A8A", "#7BA98E"];

const isMobileBI = () => typeof window !== "undefined" && window.innerWidth < 860;

async function loadBIState(period: Period): Promise<BIState> {
  const { curStart, curEnd, prevStart, prevEnd } = computeRanges(period);
  const curStartISO = curStart.toISOString(), curEndISO = curEnd.toISOString();
  const prevStartISO = prevStart.toISOString(), prevEndISO = prevEnd.toISOString();
  const { granularity, days } = trendParams(period);

  const [
    statsCur, statsPrev,
    trendCur, trendPrev,
    topCust, topProd,
    bySeller, byChannel, heatmap,
    finComparison, finDashboard,
    invStats, reorderAlerts,
    hrDashboard, employees,
  ] = await Promise.all([
    salesApi.stats(curStartISO, curEndISO),
    salesApi.stats(prevStartISO, prevEndISO),
    salesApi.trend(granularity, days, curEndISO),      // fix: siempre pasar endDate simétrico
    salesApi.trend(granularity, days, prevEndISO),     // fix: mismo tratamiento para período anterior
    salesApi.topCustomers(10, curStartISO, curEndISO),
    salesApi.topProducts(5, curStartISO, curEndISO),
    salesApi.bySeller(curStartISO, curEndISO),
    salesApi.byChannel(curStartISO, curEndISO),
    salesApi.heatmap(curStartISO, curEndISO).catch(() => []),
    financeService.getPeriodComparison(curStartISO, curEndISO),
    financeService.getDashboard(),
    inventoryService.getStats(),
    inventoryService.getReorderAlerts(),
    hrApi.dashboard(),
    hrApi.employees().catch(() => []),
  ]);

  const n = Math.max(trendCur.length, trendPrev.length);
  const chartSales: ChartPoint[] = Array.from({ length: n }, (_, i) => ({
    label: (trendCur[i]?.period ?? trendPrev[i]?.period ?? "").slice(5),
    current: trendCur[i]?.total ?? 0,
    prev: trendPrev[i]?.total ?? 0,
  }));

  const channelTotal = byChannel.reduce((a, c) => a + c.total, 0);
  const ventasPorCanal = byChannel.map((c, i) => ({
    label: c.channel, value: c.total,
    pct: channelTotal ? Math.round((c.total / channelTotal) * 1000) / 10 : 0,
    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
  }));

  const vendedorTotal = bySeller.reduce((a, v) => a + v.total, 0);
  const ventasPorVendedor: DrillRow[] = bySeller.map(v => ({
    label: v.name, value: v.total,
    pct: vendedorTotal ? Math.round((v.total / vendedorTotal) * 1000) / 10 : 0,
  }));

  const findNomina = (cats: { category: string; amount: number }[]) => {
    const matches = cats.filter(c => /n[óo]mina|payroll|sueldo/i.test(c.category));
    return matches.length ? matches.reduce((a, c) => a + c.amount, 0) : null;
  };
  const nomina = findNomina(finComparison.current.expenses_by_category);
  const nominaPrev = findNomina(finComparison.previous.expenses_by_category);

  const gastosCat: DrillRow[] = finComparison.current.expenses_by_category.map(c => ({
    label: c.category, value: c.amount,
    pct: finComparison.current.total_expenses ? Math.round((c.amount / finComparison.current.total_expenses) * 1000) / 10 : 0,
  }));

  const margenNeto = finComparison.current.total_income ? (finComparison.current.net_profit / finComparison.current.total_income) * 100 : 0;
  const margenNetoPrev = finComparison.previous.total_income ? (finComparison.previous.net_profit / finComparison.previous.total_income) * 100 : 0;

  return {
    ventas: statsCur.total_sold, ventasPrev: statsPrev.total_sold,
    pedidos: statsCur.orders_count, pedidosPrev: statsPrev.orders_count,
    ticket: statsCur.avg_ticket, ticketPrev: statsPrev.avg_ticket,
    pendientes: statsCur.pending_amount, pendientesPrev: statsPrev.pending_amount,
    paidRate: statsCur.paid_rate, paidRatePrev: statsPrev.paid_rate,
    quotesCount: statsCur.quotes_count, quotesCountPrev: statsPrev.quotes_count,
    chartSales,
    topClientes: topCust.map(c => ({ label: c.name, value: c.total })),
    topProductos: topProd.map(p => ({ label: p.name, value: p.total })),
    ventasPorVendedor,
    ventasPorCanal,

    ingresos: finComparison.current.total_income, ingresosPrev: finComparison.previous.total_income,
    gastos: finComparison.current.total_expenses, gastosPrev: finComparison.previous.total_expenses,
    utilidad: finComparison.current.net_profit, utilidadPrev: finComparison.previous.net_profit,
    margenNeto, margenNetoPrev,
    gastosCat,
    nomina, nominaPrev,
    cxc: finDashboard.cxc_balance ?? 0, cxp: finDashboard.cxp_balance ?? 0,

    inventarioVal: invStats.total_value,
    inventarioUnidades: invStats.total_units,
    inventarioAgotados: invStats.out_of_stock,
    inventarioBajoStock: invStats.low_stock,
    inventarioCat: invStats.by_category.map(c => ({ label: c.category, value: c.value, pct: c.pct })),
    reorderAlerts,

    hrTotal: hrDashboard.total, hrActive: hrDashboard.active,
    hrOnTrial: hrDashboard.on_trial, hrExpiring30: hrDashboard.expiring_30,
    hrPayrollMonthly: hrDashboard.total_payroll_monthly,
    hrPresentToday: hrDashboard.present_today, hrAbsentToday: hrDashboard.absent_today,
    hrByDepartment: Object.entries(hrDashboard.by_department ?? {}).map(([label, value]) => ({ label, value: value as number })),

    heatmap,
    topClientesRich: topCust.map(c => ({
      name: c.name, total: c.total, orders: c.orders,
      ticket: c.orders ? c.total / c.orders : 0,
    })),
    salaryBuckets: (() => {
      const salaries = (employees || []).map((e: any) => Number(e.base_salary || 0)).filter((s: number) => s > 0);
      if (salaries.length === 0) return [];
      const bucketDefs = [
        { label: "≤ $10k", min: 0, max: 10000 },
        { label: "$10k – $25k", min: 10000, max: 25000 },
        { label: "$25k – $50k", min: 25000, max: 50000 },
        { label: "$50k – $100k", min: 50000, max: 100000 },
        { label: "> $100k", min: 100000, max: Infinity },
      ];
      return bucketDefs.map(b => {
        const count = salaries.filter((s: number) => s >= b.min && s < b.max).length;
        return { label: b.label, value: count, pct: count / salaries.length * 100 };
      });
    })(),
  };
}

// ── Main Module ───────────────────────────────────────────────────────────
export default function BIModule({ t, s }: { t: any; s: any }) {
  void s;
  const [tab, setTab] = useState<"executive" | "sales" | "inventory" | "finance" | "hr" | "omnichannel" | "custom">("executive");
  const [period, setPeriod] = useState<Period>("month");
  const [D, setD] = useState<BIState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillKpi, setDrillKpi] = useState<any | null>(null);
  const [customKPIs, setCustomKPIs] = useState<string[]>(["ventas", "utilidad", "pedidos", "inventario"]);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedFreq, setSchedFreq] = useState("Semanal");
  const [schedFmt, setSchedFmt] = useState("PDF");
  const [schedEmail, setSchedEmail] = useState("");
  const [schedSaved, setSchedSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadBIState(period)
      .then(data => { if (alive) { setD(data); setLoading(false); } })
      .catch(err => { if (alive) { setError(err?.message || "Error al cargar datos de BI"); setLoading(false); } });
    return () => { alive = false; };
  }, [period]);

  const openDrill = (k: any) => setDrillKpi(k);

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer",
    fontWeight: active ? 700 : 500, fontSize: 13,
    background: active ? t.panel : "transparent",
    color: active ? t.nova : t.textLo,
    borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent",
    transition: "all .15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
  });

  const TABS = [
    { id: "executive", label: "Ejecutivo", icon: LayoutDashboard },
    { id: "sales", label: "Ventas", icon: ShoppingCart },
    { id: "inventory", label: "Inventario", icon: Package },
    { id: "finance", label: "Finanzas", icon: Wallet },
    { id: "hr", label: "RH", icon: Users },
    { id: "omnichannel", label: "Omnicanal", icon: Store },
    { id: "custom", label: "Personalizado", icon: Sliders },
  ] as const;

  const ALL_KPIS = useMemo(() => {
    if (!D) return [];
    return [
      { id: "ventas", label: "Ventas totales (cobradas)", value: D.ventas, prev: D.ventasPrev, format: "money" as const, icon: TrendingUp, color: t.good },
      { id: "utilidad", label: "Utilidad neta", value: D.utilidad, prev: D.utilidadPrev, format: "money" as const, icon: DollarSign, color: t.nova },
      { id: "pedidos", label: "Pedidos", value: D.pedidos, prev: D.pedidosPrev, format: "number" as const, icon: ShoppingCart, color: "#A78BFA" },
      { id: "ticket", label: "Ticket promedio", value: D.ticket, prev: D.ticketPrev, format: "money" as const, icon: Star, color: t.warn },
      { id: "margen", label: "Margen neto", value: D.margenNeto, prev: D.margenNetoPrev, format: "percent" as const, icon: Activity, color: t.good },
      { id: "gastos", label: "Gastos totales", value: D.gastos, prev: D.gastosPrev, format: "money" as const, icon: TrendingDown, color: t.bad },
      { id: "inventario", label: "Valor inventario", value: D.inventarioVal, prev: null, noHistory: true, format: "money" as const, icon: Package, color: t.nova },
      { id: "cxc", label: "Por cobrar (CXC)", value: D.cxc, prev: null, noHistory: true, format: "money" as const, icon: Clock, color: t.warn },
      { id: "pendientes", label: "Pendiente de cobro (período)", value: D.pendientes, prev: D.pendientesPrev, format: "money" as const, icon: Clock, color: t.warn },
    ];
  }, [D, t]);

  const sparkFor = (k: any) => [k.prev, k.value];

  const moduleHealth = useMemo(() => {
    if (!D) return [];
    const base = [
      { label: "Ventas", tl: light(D.ventas, D.ventasPrev), value: fmt(D.ventas, "money"), delta: delta(D.ventas, D.ventasPrev) },
      { label: "Inventario (valor actual)", tl: D.inventarioAgotados > 0 ? "red" as TrafficLight : D.inventarioBajoStock > 0 ? "yellow" as TrafficLight : "green" as TrafficLight, value: fmt(D.inventarioVal, "money"), delta: 0 },
      { label: "Utilidad neta", tl: light(D.utilidad, D.utilidadPrev), value: fmt(D.utilidad, "money"), delta: delta(D.utilidad, D.utilidadPrev) },
      { label: "Margen neto", tl: D.margenNeto >= 15 ? "green" as TrafficLight : D.margenNeto >= 5 ? "yellow" as TrafficLight : "red" as TrafficLight, value: D.margenNeto.toFixed(1) + "%", delta: delta(D.margenNeto, D.margenNetoPrev) },
      { label: "CXC por cobrar", tl: D.cxc > D.ventas ? "red" as TrafficLight : "yellow" as TrafficLight, value: fmt(D.cxc, "money"), delta: 0 },
    ];
    if (D.nomina !== null) {
      base.push({ label: "Nómina", tl: light(D.nomina, D.nominaPrev ?? D.nomina), value: fmt(D.nomina, "money"), delta: delta(D.nomina, D.nominaPrev ?? D.nomina) });
    }
    return base;
  }, [D]);

  const handleSchedule = () => {
    setSchedSaved(`Reporte ${schedFreq.toLowerCase()} en ${schedFmt}${schedEmail ? ` a ${schedEmail}` : ""}`);
    setSchedOpen(false);
  };

  if (loading || !D) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 12 }}>
        <div style={{ fontSize: 14, color: t.textLo }}>{error ? `Error: ${error}` : "Cargando indicadores reales…"}</div>
      </div>
    );
  }

  return <BIModuleBody t={t} D={D} tab={tab} setTab={setTab} period={period} setPeriod={setPeriod}
    drillKpi={drillKpi} setDrillKpi={setDrillKpi} openDrill={openDrill}
    customKPIs={customKPIs} setCustomKPIs={setCustomKPIs}
    schedOpen={schedOpen} setSchedOpen={setSchedOpen}
    schedFreq={schedFreq} setSchedFreq={setSchedFreq}
    schedFmt={schedFmt} setSchedFmt={setSchedFmt}
    schedEmail={schedEmail} setSchedEmail={setSchedEmail}
    schedSaved={schedSaved} setSchedSaved={setSchedSaved}
    handleSchedule={handleSchedule}
    ALL_KPIS={ALL_KPIS} moduleHealth={moduleHealth} sparkFor={sparkFor}
    tabBtn={tabBtn} TABS={TABS} />;
}

// ── Cuerpo visual (separado para mantener el componente principal legible) ──
function BIModuleBody({
  t, D, tab, setTab, period, setPeriod,
  drillKpi, setDrillKpi, openDrill,
  customKPIs, setCustomKPIs,
  schedOpen, setSchedOpen, schedFreq, setSchedFreq, schedFmt, setSchedFmt,
  schedEmail, setSchedEmail, schedSaved, setSchedSaved, handleSchedule,
  ALL_KPIS, moduleHealth, sparkFor, tabBtn, TABS,
}: any) {
  // Embudo de conversión: solo etapas reales y derivables (sin multiplicadores ficticios)
  const funnel = [
    { label: "Cotizaciones generadas", value: D.quotesCount, color: "#A78BFA", pct: 100 },
    { label: "Pedidos confirmados", value: D.pedidos, color: t.nova, pct: D.quotesCount ? Math.min(100, Math.round((D.pedidos / D.quotesCount) * 100)) : 100 },
    { label: "Pedidos pagados", value: Math.round(D.pedidos * (D.paidRate / 100)), color: t.good, pct: Math.round(D.paidRate) },
  ];

  // Análisis ABC real: cumulativo sobre by_category (ya viene ordenado desc por valor)
  const abc = useMemo(() => {
    const total = D.inventarioCat.reduce((a: number, c: DrillRow) => a + c.value, 0);
    let cum = 0;
    const groups: Record<"A" | "B" | "C", { value: number; count: number }> = { A: { value: 0, count: 0 }, B: { value: 0, count: 0 }, C: { value: 0, count: 0 } };
    for (const c of D.inventarioCat) {
      cum += c.value;
      const cumPct = total ? (cum / total) * 100 : 0;
      const g = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
      groups[g].value += c.value;
      groups[g].count += 1;
    }
    return groups;
  }, [D.inventarioCat]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>Reportes / BI</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>Inteligencia de negocio en tiempo real — datos reales de ventas, finanzas e inventario</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
            {(["week", "month", "quarter", "year"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: period === p ? 700 : 500, background: period === p ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : "transparent", color: period === p ? "#fff" : t.textMid, transition: "all .15s" }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button onClick={() => exportPeriodReport(D, period)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <Download size={14} /> Exportar
          </button>
          <button onClick={() => setSchedOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <Mail size={14} /> Programar reporte
          </button>
        </div>
      </div>

      {schedSaved && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.good + "16", border: `1px solid ${t.good}44`, color: t.good, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          <CheckCircle size={16} />
          <span style={{ flex: 1 }}>Programado: <b>{schedSaved}</b>. <span style={{ color: t.textMid }}>El envío automático se activará al conectar el servidor de correo.</span></span>
          <button onClick={() => setSchedSaved(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.good, display: "flex" }}><X size={16} /></button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }: any) => (
          <button key={id} onClick={() => setTab(id)} style={tabBtn(tab === id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ── TAB: Executive ── */}
      {tab === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Nuevo dashboard consolidado: usa /bi/executive-summary con auto-refresh */}
          <ExecutiveLive t={t} />

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <SectionTitle icon={Activity} title="Semáforo de salud empresarial" color={t.nova} t={t} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {moduleHealth.map((m: any) => {
                const c = lightColor(m.tl, t);
                return (
                  <div key={m.label} style={{ background: t.panel2, border: `1px solid ${c}33`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: t.textLo }}>{m.label}</span>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: c, boxShadow: `0 0 0 3px ${c}22`, animation: m.tl === "red" ? "pulse 1.5s ease infinite" : "none" }} />
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.textHi }}>{m.value}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                      {m.delta >= 0 ? <ArrowUpRight size={12} color={t.good} /> : <ArrowDownRight size={12} color={t.bad} />}
                      <span style={{ fontSize: 11, color: m.delta >= 0 ? t.good : t.bad, fontWeight: 600 }}>{Math.abs(m.delta)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {ALL_KPIS.slice(0, 6).map((k: any) => (
              <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />
            ))}
          </div>

          {/* Radar 6 ejes: actual vs anterior */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Vista 360 del período — actual vs anterior</div>
              <div style={{ display: "flex", gap: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 14, height: 3, borderRadius: 2, background: t.nova }} /> Actual</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMid }}><span style={{ width: 14, height: 0, borderTop: `2px dashed ${t.textLo}` }} /> Anterior</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobileBI() ? "1fr" : "1fr 1fr", gap: 20, alignItems: "center" }}>
              <RadarChart t={t}
                axes={["Ventas", "Utilidad", "Pedidos", "Ticket", "Margen %", "Cotizaciones"]}
                cur={[D.ventas, Math.max(0, D.utilidad), D.pedidos, D.ticket, Math.max(0, D.margenNeto), D.quotesCount]}
                prev={[D.ventasPrev, Math.max(0, D.utilidadPrev), D.pedidosPrev, D.ticketPrev, Math.max(0, D.margenNetoPrev), D.quotesCountPrev]}
                size={280}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Ventas", c: D.ventas, p: D.ventasPrev, f: "money" as const },
                  { label: "Utilidad neta", c: D.utilidad, p: D.utilidadPrev, f: "money" as const },
                  { label: "Pedidos", c: D.pedidos, p: D.pedidosPrev, f: "number" as const },
                  { label: "Ticket promedio", c: D.ticket, p: D.ticketPrev, f: "money" as const },
                  { label: "Margen neto", c: D.margenNeto, p: D.margenNetoPrev, f: "percent" as const },
                  { label: "Cotizaciones", c: D.quotesCount, p: D.quotesCountPrev, f: "number" as const },
                ].map(row => {
                  const dd = delta(row.c, row.p);
                  return (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${t.border}55` }}>
                      <span style={{ fontSize: 12.5, color: t.textMid }}>{row.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>
                        {fmt(row.c, row.f)} <span style={{ fontSize: 10.5, color: dd >= 0 ? t.good : t.bad, marginLeft: 6 }}>{dd >= 0 ? "↑" : "↓"} {Math.abs(dd)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Tendencia de ventas</div>
                <div style={{ display: "flex", gap: 14 }}>
                  {[{ color: t.nova, label: "Actual" }, { color: t.textLo, label: "Anterior", dash: true }].map(l => (
                    <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: t.textMid }}>
                      <span style={{ width: 16, height: 2, background: l.dash ? "transparent" : l.color, borderTop: l.dash ? `2px dashed ${l.color}` : "none", display: "inline-block" }} />{l.label}
                    </span>
                  ))}
                </div>
              </div>
              <LineBarChart data={D.chartSales} t={t} height={220} />
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Resumen financiero del período</div>
              {[
                { l: "Ingresos", v: D.ingresos, c: t.good },
                { l: "Gastos", v: D.gastos, c: t.bad },
                { l: "Utilidad neta", v: D.utilidad, c: t.nova },
              ].map(row => (
                <div key={row.l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                  <span style={{ fontSize: 12.5, color: t.textMid }}>{row.l}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: row.c }}>{fmtFull(row.v)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0" }}>
                <span style={{ fontSize: 12.5, color: t.textMid }}>Margen neto</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: t.good }}>{D.margenNeto.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.topClientes} t={t} title="Top 5 clientes por volumen" />
            <DrillTable rows={D.topProductos} t={t} title="Top 5 productos por venta" />
          </div>
        </div>
      )}

      {/* ── TAB: Sales ── */}
      {tab === "sales" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={ShoppingCart} title="Análisis de Ventas & CRM" color={t.good} t={t} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { id: "s_ventas", label: "Ventas totales", value: D.ventas, prev: D.ventasPrev, format: "money" as const, icon: TrendingUp, color: t.good },
              { id: "s_pedidos", label: "Pedidos cerrados", value: D.pedidos, prev: D.pedidosPrev, format: "number" as const, icon: ShoppingCart, color: t.nova },
              { id: "s_ticket", label: "Ticket promedio", value: D.ticket, prev: D.ticketPrev, format: "money" as const, icon: Star, color: t.warn },
              { id: "s_cotiz", label: "Cotizaciones", value: D.quotesCount, prev: D.quotesCountPrev, format: "number" as const, icon: Target, color: "#A78BFA" },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Evolución de ventas vs período anterior</div>
            <LineBarChart data={D.chartSales} t={t} height={220} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Embudo de conversión</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 12 }}>Cotización → Pedido confirmado → Pedido pagado — con % de conversión entre etapas</div>
              <SankeyFunnel t={t} stages={funnel.map(s => ({ label: s.label, value: s.value, color: s.color }))} />
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Tasa de pedidos pagados</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 8 }}>Pedidos cobrados sobre el total del período</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LiquidCore pct={D.paidRate} sub="Pagado" t={t} />
              </div>
            </div>
          </div>

          {/* NUEVO: Heatmap actividad de ventas (7 días × 24 horas) */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Mapa de calor — actividad de ventas</div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Concentración de ventas por día de semana × hora del día. Útil para planear personal y campañas.</div>
            <HeatmapWeek t={t} cells={D.heatmap} />
          </div>

          {/* NUEVO: Bubble chart de Top clientes */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Radiografía de clientes</div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Cada burbuja es un cliente: <b>eje X</b> = # de pedidos, <b>eje Y</b> = ticket promedio, <b>tamaño</b> = ventas totales.</div>
            <BubbleChart t={t} items={D.topClientesRich} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Ventas por operador</div>
              <div style={{ fontSize: 11, color: t.textLo, marginBottom: 14, fontStyle: "italic" }}>Usuario del sistema que capturó cada pedido — no confundir con el vendedor comercial (que se registra en Empleados).</div>
              {D.ventasPorVendedor.length === 0 ? (
                <div style={{ fontSize: 12.5, color: t.textLo }}>Sin pedidos en el período.</div>
              ) : D.ventasPorVendedor.map((r: DrillRow, i: number) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, color: t.textMid }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{fmtFull(r.value)}</span>
                  </div>
                  <div style={{ height: 6, background: t.panel3, borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${r.pct ?? 0}%`, height: "100%", borderRadius: 99, background: "#5B8DEF", opacity: 0.65 }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Ventas por canal</div>
              {D.ventasPorCanal.length === 0 ? (
                <div style={{ fontSize: 12.5, color: t.textLo }}>Sin datos de canal en este período.</div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                    <DonutChart data={D.ventasPorCanal.map((c: any) => ({ label: c.label, value: c.value, color: c.color }))} t={t} size={140} />
                  </div>
                  {D.ventasPorCanal.map((c: any, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: c.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: t.textMid, flex: 1 }}>{c.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{c.pct}%</span>
                      <span style={{ fontSize: 12, color: t.textLo }}>{fmt(c.value, "money")}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <DrillTable rows={D.topClientes} t={t} title="Top 5 clientes por volumen de compra" />
        </div>
      )}

      {/* ── TAB: Inventory ── */}
      {tab === "inventory" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={Package} title="Análisis de Inventario" color={t.nova} t={t} />
          <div style={{ fontSize: 12, color: t.textLo, marginTop: -10 }}>El inventario es una fotografía del momento actual; no existe historial para comparar contra períodos anteriores.</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { id: "i_val", label: "Valor total", value: D.inventarioVal, prev: null, noHistory: true, format: "money" as const, icon: Package, color: t.nova },
              { id: "i_und", label: "Unidades disponibles", value: D.inventarioUnidades, prev: null, noHistory: true, format: "number" as const, icon: Activity, color: t.good },
              { id: "i_bajo", label: "Productos en stock bajo", value: D.inventarioBajoStock, prev: null, noHistory: true, format: "number" as const, icon: AlertTriangle, color: t.warn },
              { id: "i_ago", label: "Agotados", value: D.inventarioAgotados, prev: null, noHistory: true, format: "number" as const, icon: XCircle, color: t.bad },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Análisis ABC de inventario</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>Clasificación real por valor acumulado: A ≤80% · B ≤95% · C resto, calculado sobre las categorías de inventario</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobileBI() ? "1fr" : "200px 1fr", gap: 18, alignItems: "center" }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <DonutChart
                  data={(["A", "B", "C"] as const).map(cat => ({ label: `Clase ${cat}`, value: abc[cat].value, color: cat === "A" ? t.good : cat === "B" ? t.warn : t.bad }))}
                  t={t} size={190} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {(["A", "B", "C"] as const).map(cat => {
                  const abcInfo = abc[cat];
                  const color = cat === "A" ? t.good : cat === "B" ? t.warn : t.bad;
                  const label = cat === "A" ? "Alta concentración" : cat === "B" ? "Media concentración" : "Baja concentración";
                  const pct = D.inventarioVal ? Math.round((abcInfo.value / D.inventarioVal) * 100) : 0;
                  return (
                    <div key={cat} style={{ background: color + "12", border: `1px solid ${color}33`, borderRadius: 10, padding: 16, textAlign: "center" }}>
                      <div style={{ fontSize: 28, fontWeight: 900, color, marginBottom: 4 }}>{cat}</div>
                      <div style={{ fontSize: 12, color: t.textLo, marginBottom: 8 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi }}>{fmt(abcInfo.value, "money")}</div>
                      <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 4 }}>{abcInfo.count} categorías · {pct}% del valor</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Valor por categoría</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 14 }}>Mapa proporcional del valor total de inventario</div>
              <Treemap t={t} items={D.inventarioCat} height={240} />
            </div>
            <DrillTable rows={D.topProductos} t={t} title="Top productos por ventas del período" emptyMsg="No hay ventas en este período." />
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Alertas de reabastecimiento (stock real)</div>
            {D.reorderAlerts.length === 0 ? (
              <div style={{ fontSize: 13, color: t.good, display: "flex", alignItems: "center", gap: 8 }}><CheckCircle size={16} /> Todo el inventario está en niveles saludables.</div>
            ) : D.reorderAlerts.slice(0, 8).map((p: ReorderAlert, i: number) => {
              const color = p.level === "red" ? t.bad : t.warn;
              const max = Math.max(p.available, p.reorder_point, p.safety_stock, 1);
              const pct = Math.min((p.available / max) * 100, 100);
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, color: t.textHi }}>{p.product_name} <span style={{ color: t.textLo, fontSize: 11.5 }}>({p.sku})</span></span>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{p.available.toLocaleString()} disp.</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color, background: color + "18", padding: "2px 6px", borderRadius: 4 }}>{p.level === "red" ? "CRÍTICO" : "BAJO"}</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: t.panel3, borderRadius: 99, position: "relative" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: color }} />
                    <div style={{ position: "absolute", left: `${(p.reorder_point / max) * 100}%`, top: -2, width: 2, height: 10, background: t.textLo, opacity: 0.5 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Finance ── */}
      {tab === "finance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={Wallet} title="Análisis Financiero" color={t.warn} t={t} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { id: "f_ing", label: "Ingresos totales", value: D.ingresos, prev: D.ingresosPrev, format: "money" as const, icon: TrendingUp, color: t.good },
              { id: "f_uti", label: "Utilidad neta", value: D.utilidad, prev: D.utilidadPrev, format: "money" as const, icon: DollarSign, color: t.nova },
              { id: "f_mar", label: "Margen neto", value: D.margenNeto, prev: D.margenNetoPrev, format: "percent" as const, icon: Activity, color: t.warn },
              { id: "f_gas", label: "Gastos totales", value: D.gastos, prev: D.gastosPrev, format: "money" as const, icon: TrendingDown, color: t.bad },
              { id: "f_cxc", label: "CXC por cobrar", value: D.cxc, prev: null, noHistory: true, format: "money" as const, icon: Clock, color: t.warn },
              { id: "f_cxp", label: "CXP por pagar", value: D.cxp, prev: null, noHistory: true, format: "money" as const, icon: TrendingDown, color: t.bad },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Estado de resultados — Waterfall</div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Ingresos, descuento de gastos por categoría, y utilidad neta resultante</div>
            <WaterfallChart t={t} ingresos={D.ingresos} gastosCategorias={D.gastosCat} utilidad={D.utilidad} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobileBI() ? "1fr" : "1fr 1.3fr", gap: 14 }}>
            {/* Gauge de margen neto */}
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Margen neto</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 8 }}>Utilidad sobre ingresos del período · objetivo 15%</div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LiquidCore pct={Math.max(0, Math.min(D.margenNeto, 100))} sub="Margen neto" hue="blue" t={t} />
              </div>
            </div>
            {/* Donut de estructura de egresos */}
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Estructura de egresos</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Distribución del gasto total por categoría</div>
              {D.gastosCat.length === 0 ? (
                <div style={{ fontSize: 12.5, color: t.textLo, padding: "20px 0", textAlign: "center" }}>No hay gastos registrados en este período.</div>
              ) : (
                <div style={{ display: isMobileBI() ? "block" : "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ display: "flex", justifyContent: "center", flexShrink: 0, marginBottom: isMobileBI() ? 12 : 0 }}>
                    <DonutChart data={D.gastosCat.map((g: DrillRow, i: number) => ({ label: g.label, value: g.value, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }))} t={t} size={150} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {D.gastosCat.slice(0, 6).map((g: DrillRow, i: number) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 99, background: CHANNEL_COLORS[i % CHANNEL_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, color: t.textMid, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{g.pct ?? 0}%</span>
                        <span style={{ fontSize: 12, color: t.textLo }}>{fmt(g.value, "money")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Razones financieras (calculadas con datos reales)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { label: "Margen neto", value: `${D.margenNeto.toFixed(1)}%`, ref: ">15% saludable", tl: (D.margenNeto > 15 ? "green" : D.margenNeto > 5 ? "yellow" : "red") as TrafficLight },
                { label: "Gastos / Ingresos", value: D.ingresos ? `${((D.gastos / D.ingresos) * 100).toFixed(1)}%` : "N/D", ref: "<85% saludable", tl: (D.ingresos && (D.gastos / D.ingresos) < 0.85 ? "green" : "yellow") as TrafficLight },
                ...(D.nomina !== null ? [{ label: "Nómina / Ingresos", value: D.ingresos ? `${((D.nomina / D.ingresos) * 100).toFixed(1)}%` : "N/D", ref: "<20% saludable", tl: (D.ingresos && (D.nomina / D.ingresos) < 0.2 ? "green" : "yellow") as TrafficLight }] : []),
              ].map(r => {
                const c = lightColor(r.tl, t);
                return (
                  <div key={r.label} style={{ background: t.panel2, border: `1px solid ${c}33`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 6 }}>{r.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{r.value}</div>
                    <div style={{ fontSize: 11, color: t.textLo, marginTop: 5, marginBottom: 8 }}>Ref: {r.ref}</div>
                    <HealthBadge tl={r.tl} t={t} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: HR ── */}
      {tab === "hr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={Users} title="Análisis de RH & Nómina" color="#A78BFA" t={t} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { id: "hr_tot", label: "Empleados totales", value: D.hrTotal, format: "number" as const, icon: Users, color: "#A78BFA" },
              { id: "hr_act", label: "Empleados activos", value: D.hrActive, format: "number" as const, icon: CheckCircle, color: t.good },
              { id: "hr_tri", label: "En periodo de prueba", value: D.hrOnTrial, format: "number" as const, icon: Clock, color: t.warn },
              { id: "hr_exp", label: "Contratos por vencer (30 días)", value: D.hrExpiring30, format: "number" as const, icon: AlertTriangle, color: t.bad },
              { id: "hr_pay", label: "Nómina mensual", value: D.hrPayrollMonthly, format: "money" as const, icon: DollarSign, color: t.nova },
              { id: "hr_pre", label: "Asistencia hoy (presentes)", value: D.hrPresentToday, format: "number" as const, icon: TrendingUp, color: t.good },
              { id: "hr_abs", label: "Ausentes hoy", value: D.hrAbsentToday, format: "number" as const, icon: TrendingDown, color: t.bad },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobileBI() ? "1fr" : "1fr 1fr", gap: 14 }}>
            {/* Donut de plantilla por departamento */}
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Plantilla por departamento</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Distribución de empleados en la organización</div>
              {D.hrByDepartment.length === 0 ? (
                <div style={{ fontSize: 12.5, color: t.textLo, padding: "20px 0", textAlign: "center" }}>Sin empleados registrados.</div>
              ) : (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <DonutChart data={D.hrByDepartment.map((r, i) => ({ label: r.label, value: r.value, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }))} t={t} size={200} />
                </div>
              )}
            </div>
            {/* Gauge de asistencia del día */}
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Tasa de asistencia (hoy)</div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 8 }}>Presentes sobre el total esperado · objetivo 90%</div>
              {(D.hrPresentToday + D.hrAbsentToday) === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: t.textLo, padding: "20px 0" }}>Sin registros de asistencia hoy.</div>
              ) : (
                <>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <LiquidCore pct={Math.round((D.hrPresentToday / (D.hrPresentToday + D.hrAbsentToday)) * 100)} sub="Asistencia" t={t} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 4 }}>
                    <span style={{ fontSize: 11.5, color: t.textMid, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 99, background: t.good }} />{D.hrPresentToday} presentes</span>
                    <span style={{ fontSize: 11.5, color: t.textMid, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 99, background: t.bad }} />{D.hrAbsentToday} ausentes</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Histograma de rangos salariales */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Distribución salarial</div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 16 }}>Empleados por rango de salario base mensual</div>
            {D.salaryBuckets.length === 0 ? (
              <div style={{ fontSize: 12.5, color: t.textLo, padding: "20px 0", textAlign: "center" }}>Sin datos de salario.</div>
            ) : D.salaryBuckets.map((b, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12.5, color: t.textMid }}>{b.label}</span>
                  <span style={{ fontSize: 12.5, color: t.textHi, fontWeight: 700 }}>{b.value} <span style={{ fontSize: 10.5, color: t.textLo }}>· {(b.pct ?? 0).toFixed(0)}%</span></span>
                </div>
                <div style={{ height: 6, background: t.panel3, borderRadius: 99 }}>
                  <div style={{ width: `${b.pct ?? 0}%`, height: "100%", borderRadius: 99, background: "#5EBBA9", opacity: 0.6 }} />
                </div>
              </div>
            ))}
          </div>

          {/* Barras de plantilla por depto */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Empleados por departamento (ranked)</div>
            {D.hrByDepartment.length === 0 ? (
              <div style={{ fontSize: 12.5, color: t.textLo }}>Sin datos.</div>
            ) : D.hrByDepartment.slice().sort((a: any, b: any) => b.value - a.value).map((r: DrillRow, i: number) => {
              const max = Math.max(1, ...D.hrByDepartment.map((x: DrillRow) => x.value));
              const pct = (r.value / max) * 100;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12.5, color: t.textMid }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{r.value} <span style={{ fontSize: 10.5, color: t.textLo, marginLeft: 4 }}>emp.</span></span>
                  </div>
                  <div style={{ height: 6, background: t.panel3, borderRadius: 99 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: CHANNEL_COLORS[i % CHANNEL_COLORS.length], opacity: 0.6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Custom ── */}
      {tab === "omnichannel" && <OmnichannelView t={t} />}

      {tab === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Dashboard personalizado</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>Selecciona los indicadores que quieres monitorear en tu vista personal.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_KPIS.map((k: any) => (
                <button key={k.id} onClick={() => setCustomKPIs((prev: string[]) => prev.includes(k.id) ? prev.filter(x => x !== k.id) : [...prev, k.id])} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${customKPIs.includes(k.id) ? t.nova : t.border}`, background: customKPIs.includes(k.id) ? t.nova + "18" : t.panel2, color: customKPIs.includes(k.id) ? t.nova : t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600, transition: "all .15s" }}>
                  {customKPIs.includes(k.id) && <Check size={12} />}
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {customKPIs.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              {ALL_KPIS.filter((k: any) => customKPIs.includes(k.id)).map((k: any) => (
                <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />
              ))}
            </div>
          )}

          {customKPIs.length > 0 && (
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Tendencia de ventas (referencia para los indicadores seleccionados)</div>
              <LineBarChart data={D.chartSales} t={t} height={200} />
            </div>
          )}

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Programar reporte automático</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Frecuencia</label>
                <select value={schedFreq} onChange={(e: any) => setSchedFreq(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>Diario</option><option>Semanal</option><option>Quincenal</option><option>Mensual</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Formato</label>
                <select value={schedFmt} onChange={(e: any) => setSchedFmt(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>PDF</option><option>Excel</option><option>Ambos</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Email destino</label>
                <input value={schedEmail} onChange={(e: any) => setSchedEmail(e.target.value)} placeholder="correo@empresa.mx" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
            <button onClick={handleSchedule} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Mail size={14} /> Activar reporte automático
            </button>
          </div>
        </div>
      )}

      {/* ── DRILL-DOWN Modal ── */}
      {drillKpi && (() => {
        const kpi = drillKpi;
        const dd = delta(kpi.value, kpi.prev);
        return createPortal(
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }} onClick={() => setDrillKpi(null)}>
            <div onClick={(e: any) => e.stopPropagation()} style={{ width: "100%", maxWidth: 600, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24, maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{kpi.label} — Detalle · {PERIOD_LABELS[period]}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: t.textHi }}>{fmt(kpi.value, kpi.format)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 13, color: dd >= 0 ? t.good : t.bad, fontWeight: 700 }}>
                      {dd >= 0 ? "+" : ""}{dd}% vs período anterior
                    </span>
                  </div>
                </div>
                <button onClick={() => setDrillKpi(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
              </div>
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 10 }}>Tendencia de ventas del período (referencia general):</div>
              <LineBarChart data={D.chartSales} t={t} height={180} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
                {[
                  { l: "Actual", v: fmt(kpi.value, kpi.format), c: t.textHi },
                  { l: "Período anterior", v: fmt(kpi.prev, kpi.format), c: t.textLo },
                ].map(item => (
                  <div key={item.l} style={{ background: t.panel2, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>{item.l}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: item.c }}>{item.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* ── Modal: Programar reporte ── */}
      {schedOpen && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }} onClick={() => setSchedOpen(false)}>
          <div onClick={(e: any) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>Programar reporte automático</span>
              <button onClick={() => setSchedOpen(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Frecuencia</label>
                <select value={schedFreq} onChange={(e: any) => setSchedFreq(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>Diario</option><option>Semanal</option><option>Quincenal</option><option>Mensual</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Formato</label>
                <select value={schedFmt} onChange={(e: any) => setSchedFmt(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>PDF</option><option>Excel</option><option>Ambos</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Email destino</label>
                <input value={schedEmail} onChange={(e: any) => setSchedEmail(e.target.value)} placeholder="correo@empresa.mx" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ fontSize: 11.5, color: t.textLo, background: t.panel2, padding: "10px 12px", borderRadius: 8 }}>
                El envío automático de correos se activará al conectar el servidor. Por ahora se guarda la configuración.
              </div>
              <button onClick={handleSchedule} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
                <Mail size={15} /> Guardar programación
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
    </div>
  );
}


// ── Omnicanal: ventas por canal + inventario unificado ─────────────────────
const CHANNEL_PALETTE = ["#33B2F5", "#34D399", "#A78BFA", "#F59E0B", "#F472B6", "#22D3EE", "#FB7185", "#94A3B8"];

function OmnichannelView({ t }: { t: any }) {
  const [data, setData] = useState<OmnichannelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const money = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
  const numf = (n: number) => (n || 0).toLocaleString("es-MX");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    biService.omnichannel(days)
      .then(r => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Sin datos.</div>;

  const d = data.direct;
  const inv = data.inventory;
  const maxRev = Math.max(1, ...d.channels.map(c => c.revenue));

  const tile = (label: string, value: string, sub: string, color: string) => (
    <div style={{ padding: 16, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12 }}>
      <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 3 }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: t.textLo, maxWidth: 640 }}>
          Consolidado de <b style={{ color: t.textMid }}>ventas por canal</b> de toda la empresa (punto de venta, mostrador, e-commerce, distribuidores…). El sell-out de cadenas se muestra aparte por ser venta indirecta.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 90, 180].map(dd => (
            <button key={dd} onClick={() => setDays(dd)}
              style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${days === dd ? t.nova : t.border}`, background: days === dd ? t.nova : "transparent", color: days === dd ? "#fff" : t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              {dd}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {tile("Ventas directas", money(d.total_revenue), `${numf(d.total_units)} u · ${numf(d.total_orders)} pedidos`, t.textHi)}
        {tile("Canales activos", String(d.channels.length), "con venta en el periodo", t.nova)}
        {tile("Inventario a costo", money(inv.total_cost_value), `${numf(inv.own_units + inv.consignment_units)} unidades`, t.good)}
        {tile("Retail (indirecto)", numf(data.indirect_retail.sell_out_units) + " u", `sell-out · ${data.indirect_retail.stores_reporting} tiendas`, t.textMid)}
      </div>

      {/* Ventas por canal */}
      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Ventas por canal</div>
        {d.channels.length === 0 ? (
          <div style={{ color: t.textLo, fontSize: 12.5, textAlign: "center", padding: 20 }}>Sin ventas en el periodo.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {d.channels.map((c, i) => (
              <div key={c.channel || i}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12.5 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, color: t.textHi, fontWeight: 600 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: CHANNEL_PALETTE[i % CHANNEL_PALETTE.length] }} />
                    {c.label}
                  </span>
                  <span style={{ color: t.textMid }}>
                    <b style={{ color: t.textHi }}>{money(c.revenue)}</b> · {numf(c.units)} u · {numf(c.orders)} ped · {c.share_pct.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 10, background: t.panel2, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${(c.revenue / maxRev) * 100}%`, height: "100%", background: CHANNEL_PALETTE[i % CHANNEL_PALETTE.length] }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inventario unificado */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 10 }}>Inventario unificado (a costo)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: t.textMid }}>Almacenes propios</span>
              <span style={{ color: t.textHi, fontWeight: 700 }}>{money(inv.own_cost_value)} <span style={{ color: t.textLo, fontWeight: 400 }}>· {numf(inv.own_units)} u</span></span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: t.textMid }}>Consignación (cadenas)</span>
              <span style={{ color: t.textHi, fontWeight: 700 }}>{money(inv.consignment_cost_value)} <span style={{ color: t.textLo, fontWeight: 400 }}>· {numf(inv.consignment_units)} u</span></span>
            </div>
            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <span style={{ color: t.textHi, fontWeight: 700 }}>Total</span>
              <span style={{ color: t.good, fontWeight: 800 }}>{money(inv.total_cost_value)}</span>
            </div>
          </div>
        </div>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 10 }}>Canal indirecto · Retail</div>
          <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 10 }}>
            Lo que las cadenas venden al consumidor final (sell-out). No es ingreso propio; es visibilidad aguas abajo.
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{numf(data.indirect_retail.sell_out_units)}</div>
              <div style={{ fontSize: 11, color: t.textLo }}>unidades sell-out</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{money(data.indirect_retail.sell_out_revenue)}</div>
              <div style={{ fontSize: 11, color: t.textLo }}>venta al consumidor</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: t.textLo }}>
        Las ventas POS ya se cuentan como canal "Punto de venta" (no se duplican). Los conectores de e-commerce y marketplaces se integran vía la API cuando estén disponibles.
      </div>
    </div>
  );
}
