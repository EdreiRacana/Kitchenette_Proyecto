// BIModule.tsx — Reportes / Business Intelligence Premium
// Pestañas: Ejecutivo · Ventas · Inventario · Finanzas · RH · Personalizado
// Todos los números mostrados se obtienen de endpoints reales del backend (incluyendo RH/Nómina).
// Contrato { t, s } igual que App.tsx

import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Package, Wallet, Users, Sliders,
  ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle,
  XCircle, Download, ChevronRight,
  Target, DollarSign, ShoppingCart, Clock, Star,
  Mail, X, Check,
  TrendingDown, Activity, TrendingUp,
} from "lucide-react";
import { salesApi } from "../sales/api";
import { financeService } from "../finance/service";
import { inventoryService, type ReorderAlert } from "../inventory/service";
import { hrApi } from "../hr/api";

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
function LineBarChart({ data, t, height = 200 }: { data: ChartPoint[]; t: any; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, PL = 8, PR = 8, PT = 16, PB = 28;
  const iw = W - PL - PR, ih = H - PT - PB, n = data.length;
  const maxVal = (Math.max(1, ...data.map(d => Math.max(d.current, d.prev, d.target || 0)))) * 1.15;
  const x = (i: number) => PL + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => PT + (1 - v / maxVal) * ih;
  const barW = Math.min(28, iw / n / 2.5);
  const curPath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.current).toFixed(1)}`).join(" ");
  const prevPath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.prev).toFixed(1)}`).join(" ");
  const areaPath = n ? `${curPath} L ${x(n - 1).toFixed(1)} ${(PT + ih).toFixed(1)} L ${PL.toFixed(1)} ${(PT + ih).toFixed(1)} Z` : "";
  const grid = [0, 0.25, 0.5, 0.75, 1].map(g => PT + g * ih);
  const nearest = (px: number) => { let b = 0, bd = 1e9; for (let i = 0; i < n; i++) { const dd = Math.abs(px - x(i)); if (dd < bd) { bd = dd; b = i; } } return b; };
  const hv = hover !== null ? data[hover] : null;
  const hd = hv ? delta(hv.current, hv.prev) : 0;

  if (!n) return <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: t.textLo, fontSize: 13 }}>Sin datos para este período</div>;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, cursor: "crosshair" }} preserveAspectRatio="none"
        onMouseMove={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); setHover(nearest((e.clientX - r.left) / r.width * W)); }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="biArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.nova} stopOpacity="0.25" />
            <stop offset="100%" stopColor={t.nova} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => <line key={i} x1={PL} x2={W - PR} y1={g} y2={g} stroke={t.gridLine} strokeWidth="1" opacity="0.6" />)}
        {data.map((d, i) => (
          <rect key={i} x={x(i) - barW / 2} y={y(d.current)} width={barW} height={(PT + ih) - y(d.current)} fill={t.nova} opacity={hover === i ? "0.22" : "0.12"} rx="3" />
        ))}
        <path d={prevPath} fill="none" stroke={t.textLo} strokeWidth="1.8" strokeDasharray="5 4" opacity="0.5" />
        <path d={areaPath} fill="url(#biArea)" />
        <path d={curPath} fill="none" stroke={t.nova} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
        {hv && <line x1={x(hover!)} x2={x(hover!)} y1={PT} y2={PT + ih} stroke={t.nova} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.current)} r={hover === i ? "5" : "3.5"} fill={t.panel} stroke={t.nova} strokeWidth="2" />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={t.textLo}>{d.label}</text>
          </g>
        ))}
        {hv && <circle cx={x(hover!)} cy={y(hv.prev)} r="4" fill={t.panel} stroke={t.textLo} strokeWidth="2" />}
      </svg>
      {hv && (
        <div style={{ position: "absolute", top: 6, left: `${(x(hover!) / W) * 100 > 62 ? (x(hover!) / W) * 100 - 2 : (x(hover!) / W) * 100 + 2}%`, transform: (x(hover!) / W) * 100 > 62 ? "translateX(-100%)" : "none", background: t.panel2, border: `1px solid ${t.nova}`, borderRadius: 10, padding: "9px 12px", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.45)", minWidth: 130, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{hv.label}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 3 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 9, background: t.nova }} />Actual</span>
            <span style={{ color: t.textHi, fontWeight: 700 }}>{hv.current}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 6 }}>
            <span style={{ color: t.textMid, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 9, background: t.textLo }} />Anterior</span>
            <span style={{ color: t.textMid }}>{hv.prev}</span>
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 5, color: hd >= 0 ? t.good : t.bad, fontWeight: 700 }}>
            {hd >= 0 ? "▲ +" : "▼ "}{hd}% vs anterior
          </div>
        </div>
      )}
    </div>
  );
}

function DonutChart({ data, t, size = 140 }: { data: { label: string; value: number; color: string }[]; t: any; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size * 0.38, sw = size * 0.14;
  let angle = -90;
  const arcs = total ? data.map(d => {
    const pct = d.value / total;
    const deg = pct * 360;
    const start = angle;
    angle += deg;
    const r2d = Math.PI / 180;
    const x1 = cx + r * Math.cos(start * r2d), y1 = cy + r * Math.sin(start * r2d);
    const x2 = cx + r * Math.cos((start + deg - 0.5) * r2d), y2 = cy + r * Math.sin((start + deg - 0.5) * r2d);
    const large = deg > 180 ? 1 : 0;
    return { ...d, pct, path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}` };
  }) : [];
  const hv = hover !== null ? arcs[hover] : null;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {arcs.map((a, i) => (
        <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={hover === i ? sw + 4 : sw} strokeLinecap="butt" opacity={hover === null || hover === i ? "0.9" : "0.4"} style={{ cursor: "pointer", transition: "stroke-width .12s" }}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
      ))}
      <circle cx={cx} cy={cy} r={r - sw / 2 - 2} fill={t.panel2} />
      {hv ? (
        <>
          <text x={cx} y={cy - 3} textAnchor="middle" fontSize={size * 0.13} fontWeight="800" fill={t.textHi}>{Math.round(hv.pct * 100)}%</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={size * 0.075} fill={t.textLo}>{hv.label.length > 14 ? hv.label.slice(0, 13) + "…" : hv.label}</text>
        </>
      ) : (
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={size * 0.085} fill={t.textLo}>Total</text>
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

function GaugeArc({ value, target, max, t }: { value: number; target: number; max: number; t: any }) {
  const pct = Math.min(value / max, 1);
  const tpct = Math.min(target / max, 1);
  const cx = 80, cy = 70, r = 55, sw = 10;
  const arc = (f0: number, f1: number) => {
    const a = (f: number) => Math.PI - f * Math.PI;
    const px = (f: number) => [cx + r * Math.cos(a(f)), cy - r * Math.sin(a(f))];
    const [x0, y0] = px(f0), [x1, y1] = px(f1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const needleA = Math.PI - pct * Math.PI;
  const nx = cx + (r - 4) * Math.cos(needleA), ny = cy - (r - 4) * Math.sin(needleA);
  const tA = Math.PI - tpct * Math.PI;
  const valColor = pct >= 0.8 ? t.good : pct >= 0.5 ? t.warn : t.bad;
  return (
    <svg viewBox="0 0 160 90" style={{ width: 140, height: 78 }}>
      <path d={arc(0, 0.5)} fill="none" stroke={t.bad} strokeWidth={sw} opacity="0.3" strokeLinecap="round" />
      <path d={arc(0.5, 0.75)} fill="none" stroke={t.warn} strokeWidth={sw} opacity="0.3" />
      <path d={arc(0.75, 1)} fill="none" stroke={t.good} strokeWidth={sw} opacity="0.3" strokeLinecap="round" />
      <path d={arc(0, pct)} fill="none" stroke={valColor} strokeWidth={sw} opacity="0.85" strokeLinecap="round" />
      <line x1={cx + (r - sw) * Math.cos(tA)} y1={cy - (r - sw) * Math.sin(tA)} x2={cx + (r + 4) * Math.cos(tA)} y2={cy - (r + 4) * Math.sin(tA)} stroke={t.textHi} strokeWidth="2" strokeOpacity="0.5" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={valColor} strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
      <circle cx={cx} cy={cy} r="4" fill={t.panel} stroke={valColor} strokeWidth="2" />
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="18" fontWeight="700" fill={valColor}>{Math.round(pct * 100)}%</text>
    </svg>
  );
}

// ── KPI Card Component ────────────────────────────────────────────────────
function KPIBlock({ label, value, prev, format, icon: Icon, color, target, t, sparkData, onClick }: any) {
  const d = delta(value, prev);
  const up = d >= 0;
  const tl = light(value, prev, target);
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
        {up ? <ArrowUpRight size={13} color={t.good} /> : <ArrowDownRight size={13} color={t.bad} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: up ? t.good : t.bad }}>{Math.abs(d)}%</span>
        <span style={{ fontSize: 11, color: t.textLo }}>vs anterior</span>
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
}

const CHANNEL_COLORS = ["#33B2F5", "#34D399", "#A78BFA", "#FBBF24", "#F472B6", "#60A5FA"];

async function loadBIState(period: Period): Promise<BIState> {
  const { curStart, curEnd, prevStart, prevEnd } = computeRanges(period);
  const curStartISO = curStart.toISOString(), curEndISO = curEnd.toISOString();
  const prevStartISO = prevStart.toISOString(), prevEndISO = prevEnd.toISOString();
  const { granularity, days } = trendParams(period);

  const [
    statsCur, statsPrev,
    trendCur, trendPrev,
    topCust, topProd,
    bySeller, byChannel,
    finComparison, finDashboard,
    invStats, reorderAlerts,
    hrDashboard,
  ] = await Promise.all([
    salesApi.stats(curStartISO, curEndISO),
    salesApi.stats(prevStartISO, prevEndISO),
    salesApi.trend(granularity, days),
    salesApi.trend(granularity, days, curStartISO),
    salesApi.topCustomers(5, curStartISO, curEndISO),
    salesApi.topProducts(5, curStartISO, curEndISO),
    salesApi.bySeller(curStartISO, curEndISO),
    salesApi.byChannel(curStartISO, curEndISO),
    financeService.getPeriodComparison(curStartISO, curEndISO),
    financeService.getDashboard(),
    inventoryService.getStats(),
    inventoryService.getReorderAlerts(),
    hrApi.dashboard(),
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
  };
}

// ── Main Module ───────────────────────────────────────────────────────────
export default function BIModule({ t, s }: { t: any; s: any }) {
  void s;
  const [tab, setTab] = useState<"executive" | "sales" | "inventory" | "finance" | "hr" | "custom">("executive");
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
      { id: "inventario", label: "Valor inventario", value: D.inventarioVal, prev: D.inventarioVal, format: "money" as const, icon: Package, color: t.nova },
      { id: "cxc", label: "Por cobrar (CXC)", value: D.cxc, prev: D.cxc, format: "money" as const, icon: Clock, color: t.warn },
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
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Embudo de conversión</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {funnel.map((stage, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: `${Math.max(stage.pct, 8)}%`, background: stage.color + "22", border: `1px solid ${stage.color}44`, borderRadius: 6, padding: "10px 14px", display: "flex", justifyContent: "space-between", transition: "width .4s" }}>
                      <span style={{ fontSize: 13, color: t.textHi }}>{stage.label}</span>
                      <div style={{ display: "flex", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: stage.color }}>{stage.value.toLocaleString()}</span>
                        <span style={{ fontSize: 12, color: t.textLo }}>{stage.pct}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: t.textLo, marginTop: 10 }}>Basado en cotizaciones, pedidos confirmados y tasa de pago real del período.</div>
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6, alignSelf: "flex-start" }}>Tasa de pedidos pagados</div>
              <GaugeArc value={D.paidRate} target={80} max={100} t={t} />
              <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 8 }}>Referencia: 80%</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.ventasPorVendedor} t={t} title="Ventas por vendedor" emptyMsg="No hay pedidos con vendedor asignado en este período." />
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
              { id: "i_val", label: "Valor total", value: D.inventarioVal, prev: D.inventarioVal, format: "money" as const, icon: Package, color: t.nova },
              { id: "i_und", label: "Unidades disponibles", value: D.inventarioUnidades, prev: D.inventarioUnidades, format: "number" as const, icon: Activity, color: t.good },
              { id: "i_bajo", label: "Productos en stock bajo", value: D.inventarioBajoStock, prev: D.inventarioBajoStock, format: "number" as const, icon: AlertTriangle, color: t.warn },
              { id: "i_ago", label: "Agotados", value: D.inventarioAgotados, prev: D.inventarioAgotados, format: "number" as const, icon: XCircle, color: t.bad },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Análisis ABC de inventario</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>Clasificación real por valor acumulado: A ≤80% · B ≤95% · C resto, calculado sobre las categorías de inventario</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.inventarioCat} t={t} title="Valor por categoría" />
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
              { id: "f_cxc", label: "CXC por cobrar", value: D.cxc, prev: D.cxc, format: "money" as const, icon: Clock, color: t.warn },
              { id: "f_cxp", label: "CXP por pagar", value: D.cxp, prev: D.cxp, format: "money" as const, icon: TrendingDown, color: t.bad },
            ].map((k: any) => <KPIBlock key={k.id} {...k} t={t} sparkData={sparkFor(k)} onClick={() => openDrill(k)} />)}
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Estado de resultados (P&L real)</div>
            <div style={{ maxWidth: 560 }}>
              {[
                { label: "Ingresos totales", value: D.ingresos, bold: true, color: t.textHi },
                { label: "Gastos totales", value: -D.gastos, color: t.bad },
                { label: "UTILIDAD NETA", value: D.utilidad, bold: true, color: t.good, line: true, big: true },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: row.line ? "10px 0 8px" : "7px 0", borderTop: row.line ? `1px solid ${t.border}` : "none", borderBottom: row.line && row.big ? `2px solid ${t.border}` : "none" }}>
                  <span style={{ fontSize: row.big ? 14 : 13, color: row.color || t.textMid, fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                  <span style={{ fontSize: row.big ? 15 : 13.5, fontWeight: row.bold ? 700 : 500, color: row.value >= 0 ? t.good : t.bad, fontVariantNumeric: "tabular-nums" }}>
                    {fmtFull(Math.abs(row.value))}
                  </span>
                </div>
              ))}
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

          <DrillTable rows={D.gastosCat} t={t} title="Distribución de egresos por categoría" emptyMsg="No hay gastos registrados en este período." />
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

          <DrillTable rows={D.hrByDepartment} t={t} title="Empleados por departamento" emptyMsg="No hay empleados registrados." />
        </div>
      )}

      {/* ── TAB: Custom ── */}
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
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setDrillKpi(null)}>
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
          </div>
        );
      })()}

      {/* ── Modal: Programar reporte ── */}
      {schedOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setSchedOpen(false)}>
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
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
    </div>
  );
}
