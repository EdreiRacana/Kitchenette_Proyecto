// BIModule.tsx — Reportes / Business Intelligence Premium
// Pestañas: Ejecutivo · Ventas · Inventario · Finanzas · RH · Personalizado
// Inspirado en: Tableau, Power BI, NetSuite, SAP Analytics Cloud
// Principios: jerarquía visual, semáforos, drill-down, comparativos, cero desbordamiento
// Contrato { t, s } igual que App.tsx

import { useState, useMemo, useCallback } from "react";
import {
  LayoutDashboard, TrendingUp, Package, Wallet, Users, Sliders,
  ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle,
  XCircle, Download, RefreshCw, Filter, ChevronRight, ChevronDown,
  BarChart3, Target, DollarSign, ShoppingCart, Clock, Star,
  Info, Calendar, FileText, Mail, Bell, Maximize2, X,
  TrendingDown, Activity, Zap, Award, Eye,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type Period = "week" | "month" | "quarter" | "year";
type TrafficLight = "green" | "yellow" | "red";

interface KPICard {
  id: string;
  label: string;
  value: number;
  prev: number;
  format: "money" | "number" | "percent";
  icon: any;
  color: string;
  target?: number;
}

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

// ── Demo Data ─────────────────────────────────────────────────────────────
const DATA: Record<Period, {
  ventas: number; ventasPrev: number; ventasMeta: number;
  utilidad: number; utilidadPrev: number;
  pedidos: number; pedidosPrev: number;
  ticket: number; ticketPrev: number;
  margenBruto: number; margenBrutoPrev: number;
  flujoNeto: number; flujoPrev: number;
  nomina: number; nominaPrev: number;
  inventarioVal: number;
  cxc: number; cxp: number;
  chart: ChartPoint[];
  topClientes: DrillRow[];
  topProductos: DrillRow[];
  ventasPorVendedor: DrillRow[];
  ventasPorCanal: DrillRow[];
  inventarioCat: DrillRow[];
  gastosCat: DrillRow[];
  nominaDept: DrillRow[];
}> = {
  week: {
    ventas: 286400, ventasPrev: 269800, ventasMeta: 350000,
    utilidad: 71600, utilidadPrev: 65200,
    pedidos: 112, pedidosPrev: 114,
    ticket: 2557, ticketPrev: 2367,
    margenBruto: 31, margenBrutoPrev: 29,
    flujoNeto: 48200, flujoPrev: 41000,
    nomina: 45000, nominaPrev: 45000,
    inventarioVal: 457060,
    cxc: 320750, cxp: 138500,
    chart: [
      { label: "Lun", current: 31, prev: 28, target: 50 },
      { label: "Mar", current: 35, prev: 30, target: 50 },
      { label: "Mié", current: 33, prev: 31, target: 50 },
      { label: "Jue", current: 40, prev: 33, target: 50 },
      { label: "Vie", current: 38, prev: 36, target: 50 },
      { label: "Sáb", current: 44, prev: 38, target: 50 },
      { label: "Dom", current: 46, prev: 40, target: 50 },
    ],
    topClientes: [
      { label: "Constructora Robles", value: 84200, trend: 12 },
      { label: "Mantenimiento Industrial GZ", value: 57300, trend: -3 },
      { label: "Ferretería La Esquina", value: 42800, trend: 8 },
      { label: "Obras del Bajío SA", value: 38500, trend: 21 },
      { label: "Hotel Gran Plaza", value: 29100, trend: 5 },
    ],
    topProductos: [
      { label: "Varilla corrugada 3/8\"", value: 171600, pct: 28, trend: 15 },
      { label: "Pintura vinílica blanca 19L", value: 106800, pct: 17, trend: 8 },
      { label: "Cemento gris CPC 30R", value: 96000, pct: 16, trend: -2 },
      { label: "Impermeabilizante 5A 19L", value: 75600, pct: 12, trend: 22 },
      { label: "Cable THW cal. 12", value: 48400, pct: 8, trend: 4 },
    ],
    ventasPorVendedor: [
      { label: "Carlos Mendoza", value: 142000, pct: 50, trend: 8 },
      { label: "Ana Torres", value: 86000, pct: 30, trend: 12 },
      { label: "Roberto Flores", value: 58400, pct: 20, trend: -4 },
    ],
    ventasPorCanal: [
      { label: "Mostrador / Directo", value: 168000, pct: 59, color: "#33B2F5" },
      { label: "Pedido telefónico", value: 72000, pct: 25, color: "#34D399" },
      { label: "En línea", value: 46400, pct: 16, color: "#A78BFA" },
    ],
    inventarioCat: [
      { label: "Construcción", value: 192000, pct: 42, trend: 3 },
      { label: "Acero", value: 171600, pct: 38, trend: -1 },
      { label: "Pinturas", value: 68400, pct: 15, trend: 8 },
      { label: "Plomería", value: 16320, pct: 4, trend: -5 },
      { label: "Eléctrico", value: 8740, pct: 2, trend: 2 },
    ],
    gastosCat: [
      { label: "Nómina", value: 45000, pct: 48 },
      { label: "Compras", value: 28500, pct: 30 },
      { label: "Renta", value: 12000, pct: 13 },
      { label: "Servicios", value: 5600, pct: 6 },
      { label: "Marketing", value: 3000, pct: 3 },
    ],
    nominaDept: [
      { label: "Ventas", value: 16800, pct: 37 },
      { label: "Almacén", value: 10800, pct: 24 },
      { label: "Contabilidad", value: 8800, pct: 20 },
      { label: "Operaciones", value: 6000, pct: 13 },
      { label: "Dirección", value: 2600, pct: 6 },
    ],
  },
  month: {
    ventas: 1284500, ventasPrev: 1142800, ventasMeta: 1600000,
    utilidad: 436730, utilidadPrev: 387200,
    pedidos: 472, pedidosPrev: 438,
    ticket: 2721, ticketPrev: 2607,
    margenBruto: 34, margenBrutoPrev: 31,
    flujoNeto: 131750, flujoPrev: 108200,
    nomina: 180000, nominaPrev: 180000,
    inventarioVal: 457060,
    cxc: 320750, cxp: 138500,
    chart: [
      { label: "Sem 1", current: 286, prev: 250, target: 400 },
      { label: "Sem 2", current: 318, prev: 270, target: 400 },
      { label: "Sem 3", current: 341, prev: 290, target: 400 },
      { label: "Sem 4", current: 339, prev: 310, target: 400 },
    ],
    topClientes: [
      { label: "Constructora Robles", value: 380000, trend: 14 },
      { label: "Mantenimiento Industrial GZ", value: 247600, trend: -2 },
      { label: "Ferretería La Esquina", value: 186400, trend: 9 },
      { label: "Obras del Bajío SA", value: 148200, trend: 18 },
      { label: "Hotel Gran Plaza", value: 112800, trend: 6 },
    ],
    topProductos: [
      { label: "Varilla corrugada 3/8\"", value: 428000, pct: 33, trend: 12 },
      { label: "Pintura vinílica blanca 19L", value: 287400, pct: 22, trend: 7 },
      { label: "Cemento gris CPC 30R", value: 234800, pct: 18, trend: -1 },
      { label: "Impermeabilizante 5A 19L", value: 186200, pct: 14, trend: 19 },
      { label: "Cable THW cal. 12", value: 148100, pct: 12, trend: 3 },
    ],
    ventasPorVendedor: [
      { label: "Carlos Mendoza", value: 642250, pct: 50, trend: 11 },
      { label: "Ana Torres", value: 385350, pct: 30, trend: 14 },
      { label: "Roberto Flores", value: 256900, pct: 20, trend: -3 },
    ],
    ventasPorCanal: [
      { label: "Mostrador / Directo", value: 758255, pct: 59, color: "#33B2F5" },
      { label: "Pedido telefónico", value: 321125, pct: 25, color: "#34D399" },
      { label: "En línea", value: 205120, pct: 16, color: "#A78BFA" },
    ],
    inventarioCat: [
      { label: "Construcción", value: 192000, pct: 42, trend: 3 },
      { label: "Acero", value: 171600, pct: 38, trend: -1 },
      { label: "Pinturas", value: 68400, pct: 15, trend: 8 },
      { label: "Plomería", value: 16320, pct: 4, trend: -5 },
      { label: "Eléctrico", value: 8740, pct: 2, trend: 2 },
    ],
    gastosCat: [
      { label: "Nómina", value: 180000, pct: 48 },
      { label: "Compras", value: 114000, pct: 30 },
      { label: "Renta", value: 48000, pct: 13 },
      { label: "Servicios", value: 22400, pct: 6 },
      { label: "Marketing", value: 12000, pct: 3 },
    ],
    nominaDept: [
      { label: "Ventas", value: 67200, pct: 37 },
      { label: "Almacén", value: 43200, pct: 24 },
      { label: "Contabilidad", value: 35200, pct: 20 },
      { label: "Operaciones", value: 24000, pct: 13 },
      { label: "Dirección", value: 10400, pct: 6 },
    ],
  },
  quarter: {
    ventas: 3508000, ventasPrev: 3060000, ventasMeta: 4200000,
    utilidad: 1192720, utilidadPrev: 1040400,
    pedidos: 1380, pedidosPrev: 1280,
    ticket: 2542, ticketPrev: 2391,
    margenBruto: 33, margenBrutoPrev: 30,
    flujoNeto: 386000, flujoPrev: 324000,
    nomina: 540000, nominaPrev: 540000,
    inventarioVal: 457060,
    cxc: 320750, cxp: 138500,
    chart: [
      { label: "Abr", current: 1034, prev: 820, target: 1400 },
      { label: "May", current: 1190, prev: 932, target: 1400 },
      { label: "Jun", current: 1284, prev: 1010, target: 1400 },
    ],
    topClientes: [
      { label: "Constructora Robles", value: 1140000, trend: 16 },
      { label: "Mantenimiento Industrial GZ", value: 742800, trend: -1 },
      { label: "Ferretería La Esquina", value: 559200, trend: 10 },
      { label: "Obras del Bajío SA", value: 444600, trend: 20 },
      { label: "Hotel Gran Plaza", value: 338400, trend: 7 },
    ],
    topProductos: [
      { label: "Varilla corrugada 3/8\"", value: 1284000, pct: 37, trend: 14 },
      { label: "Pintura vinílica blanca 19L", value: 862200, pct: 25, trend: 9 },
      { label: "Cemento gris CPC 30R", value: 704400, pct: 20, trend: 2 },
      { label: "Impermeabilizante 5A 19L", value: 558600, pct: 16, trend: 24 },
      { label: "Cable THW cal. 12", value: 98800, pct: 3, trend: 1 },
    ],
    ventasPorVendedor: [
      { label: "Carlos Mendoza", value: 1754000, pct: 50, trend: 13 },
      { label: "Ana Torres", value: 1052400, pct: 30, trend: 16 },
      { label: "Roberto Flores", value: 701600, pct: 20, trend: -2 },
    ],
    ventasPorCanal: [
      { label: "Mostrador / Directo", value: 2069720, pct: 59, color: "#33B2F5" },
      { label: "Pedido telefónico", value: 877000, pct: 25, color: "#34D399" },
      { label: "En línea", value: 561280, pct: 16, color: "#A78BFA" },
    ],
    inventarioCat: [
      { label: "Construcción", value: 192000, pct: 42, trend: 3 },
      { label: "Acero", value: 171600, pct: 38, trend: -1 },
      { label: "Pinturas", value: 68400, pct: 15, trend: 8 },
      { label: "Plomería", value: 16320, pct: 4, trend: -5 },
      { label: "Eléctrico", value: 8740, pct: 2, trend: 2 },
    ],
    gastosCat: [
      { label: "Nómina", value: 540000, pct: 48 },
      { label: "Compras", value: 342000, pct: 30 },
      { label: "Renta", value: 144000, pct: 13 },
      { label: "Servicios", value: 67200, pct: 6 },
      { label: "Marketing", value: 36000, pct: 3 },
    ],
    nominaDept: [
      { label: "Ventas", value: 201600, pct: 37 },
      { label: "Almacén", value: 129600, pct: 24 },
      { label: "Contabilidad", value: 105600, pct: 20 },
      { label: "Operaciones", value: 72000, pct: 13 },
      { label: "Dirección", value: 31200, pct: 6 },
    ],
  },
  year: {
    ventas: 6161000, ventasPrev: 5212000, ventasMeta: 9000000,
    utilidad: 2094740, utilidadPrev: 1772080,
    pedidos: 2431, pedidosPrev: 2204,
    ticket: 2534, ticketPrev: 2365,
    margenBruto: 35, margenBrutoPrev: 31,
    flujoNeto: 724200, flujoPrev: 612000,
    nomina: 1080000, nominaPrev: 1044000,
    inventarioVal: 457060,
    cxc: 320750, cxp: 138500,
    chart: [
      { label: "Ene", current: 820, prev: 690, target: 1500 },
      { label: "Feb", current: 932, prev: 710, target: 1500 },
      { label: "Mar", current: 901, prev: 780, target: 1500 },
      { label: "Abr", current: 1034, prev: 860, target: 1500 },
      { label: "May", current: 1190, prev: 910, target: 1500 },
      { label: "Jun", current: 1284, prev: 1010, target: 1500 },
    ],
    topClientes: [
      { label: "Constructora Robles", value: 2280000, trend: 18 },
      { label: "Mantenimiento Industrial GZ", value: 1485600, trend: 2 },
      { label: "Ferretería La Esquina", value: 1118400, trend: 11 },
      { label: "Obras del Bajío SA", value: 889200, trend: 22 },
      { label: "Hotel Gran Plaza", value: 676800, trend: 9 },
    ],
    topProductos: [
      { label: "Varilla corrugada 3/8\"", value: 2568000, pct: 42, trend: 16 },
      { label: "Pintura vinílica blanca 19L", value: 1724400, pct: 28, trend: 11 },
      { label: "Cemento gris CPC 30R", value: 1408800, pct: 23, trend: 4 },
      { label: "Impermeabilizante 5A 19L", value: 459800, pct: 7, trend: 28 },
    ],
    ventasPorVendedor: [
      { label: "Carlos Mendoza", value: 3080500, pct: 50, trend: 15 },
      { label: "Ana Torres", value: 1848300, pct: 30, trend: 18 },
      { label: "Roberto Flores", value: 1232200, pct: 20, trend: -1 },
    ],
    ventasPorCanal: [
      { label: "Mostrador / Directo", value: 3634990, pct: 59, color: "#33B2F5" },
      { label: "Pedido telefónico", value: 1540250, pct: 25, color: "#34D399" },
      { label: "En línea", value: 985760, pct: 16, color: "#A78BFA" },
    ],
    inventarioCat: [
      { label: "Construcción", value: 192000, pct: 42, trend: 3 },
      { label: "Acero", value: 171600, pct: 38, trend: -1 },
      { label: "Pinturas", value: 68400, pct: 15, trend: 8 },
      { label: "Plomería", value: 16320, pct: 4, trend: -5 },
      { label: "Eléctrico", value: 8740, pct: 2, trend: 2 },
    ],
    gastosCat: [
      { label: "Nómina", value: 1080000, pct: 48 },
      { label: "Compras", value: 684000, pct: 30 },
      { label: "Renta", value: 288000, pct: 13 },
      { label: "Servicios", value: 134400, pct: 6 },
      { label: "Marketing", value: 72000, pct: 3 },
    ],
    nominaDept: [
      { label: "Ventas", value: 403200, pct: 37 },
      { label: "Almacén", value: 259200, pct: 24 },
      { label: "Contabilidad", value: 211200, pct: 20 },
      { label: "Operaciones", value: 144000, pct: 13 },
      { label: "Dirección", value: 62400, pct: 6 },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = (n: number, type: "money" | "number" | "percent") => {
  if (type === "money") return n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n;
  if (type === "percent") return n.toFixed(1) + "%";
  return n >= 1000 ? Math.round(n / 1000) + "k" : String(n);
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

// ── SVG Charts ────────────────────────────────────────────────────────────
function LineBarChart({ data, t, height = 200 }: { data: ChartPoint[]; t: any; height?: number }) {
  const W = 600, H = height, PL = 8, PR = 8, PT = 16, PB = 28;
  const iw = W - PL - PR, ih = H - PT - PB, n = data.length;
  const maxVal = Math.max(...data.map(d => Math.max(d.current, d.prev, d.target || 0))) * 1.15;
  const x = (i: number) => PL + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => PT + (1 - v / maxVal) * ih;
  const barW = Math.min(28, iw / n / 2.5);
  const curPath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.current).toFixed(1)}`).join(" ");
  const prevPath = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.prev).toFixed(1)}`).join(" ");
  const areaPath = `${curPath} L ${x(n - 1).toFixed(1)} ${(PT + ih).toFixed(1)} L ${PL.toFixed(1)} ${(PT + ih).toFixed(1)} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map(g => PT + g * ih);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="biArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.nova} stopOpacity="0.25" />
          <stop offset="100%" stopColor={t.nova} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g, i) => <line key={i} x1={PL} x2={W - PR} y1={g} y2={g} stroke={t.gridLine} strokeWidth="1" opacity="0.6" />)}
      {data.map((d, i) => (
        <rect key={i} x={x(i) - barW / 2} y={y(d.current)} width={barW} height={(PT + ih) - y(d.current)} fill={t.nova} opacity="0.12" rx="3" />
      ))}
      {data[0]?.target && <path d={data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.target!).toFixed(1)}`).join(" ")} fill="none" stroke={t.warn} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.6" />}
      <path d={prevPath} fill="none" stroke={t.textLo} strokeWidth="1.8" strokeDasharray="5 4" opacity="0.5" />
      <path d={areaPath} fill="url(#biArea)" />
      <path d={curPath} fill="none" stroke={t.nova} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.current)} r="3.5" fill={t.panel} stroke={t.nova} strokeWidth="2" />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={t.textLo}>{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

function DonutChart({ data, t, size = 140 }: { data: { label: string; value: number; color: string }[]; t: any; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size * 0.38, sw = size * 0.14;
  let angle = -90;
  const arcs = data.map(d => {
    const pct = d.value / total;
    const deg = pct * 360;
    const start = angle;
    angle += deg;
    const r2d = Math.PI / 180;
    const x1 = cx + r * Math.cos(start * r2d), y1 = cy + r * Math.sin(start * r2d);
    const x2 = cx + r * Math.cos((start + deg - 0.5) * r2d), y2 = cy + r * Math.sin((start + deg - 0.5) * r2d);
    const large = deg > 180 ? 1 : 0;
    return { ...d, pct, path: `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}` };
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      {arcs.map((a, i) => (
        <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="butt" opacity="0.85" />
      ))}
      <circle cx={cx} cy={cy} r={r - sw / 2 - 2} fill={t.panel2} />
    </svg>
  );
}

function SparkMini({ data, color, width = 80, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  const min = Math.min(...data), max = Math.max(...data);
  const px = (i: number) => (i / (data.length - 1)) * width;
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
        {target && <span style={{ fontSize: 11, color: t.textLo, marginLeft: 4 }}>· meta {fmt(target, format)}</span>}
      </div>
    </div>
  );
}

// ── Drill-down Table ──────────────────────────────────────────────────────
function DrillTable({ rows, t, title, colorPalette }: { rows: DrillRow[]; t: any; title: string; colorPalette?: string[] }) {
  const COLORS = colorPalette || ["#33B2F5", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#60A5FA", "#FB923C"];
  const maxVal = Math.max(...rows.map(r => r.value));
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: t.textMid, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{fmtFull(r.value)}</span>
              {r.pct !== undefined && <span style={{ fontSize: 11, color: t.textLo }}>{r.pct}%</span>}
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

// ── Main Module ───────────────────────────────────────────────────────────
export default function BIModule({ t, s }: { t: any; s: any }) {
  const [tab, setTab] = useState<"executive" | "sales" | "inventory" | "finance" | "hr" | "custom">("executive");
  const [period, setPeriod] = useState<Period>("month");
  const [drillOpen, setDrillOpen] = useState<string | null>(null);
  const [customKPIs, setCustomKPIs] = useState<string[]>(["ventas", "utilidad", "pedidos", "inventario"]);

  const D = DATA[period];
  const lang = "es";

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

  const ALL_KPIS = [
    { id: "ventas", label: "Ventas totales", value: D.ventas, prev: D.ventasPrev, format: "money" as const, icon: TrendingUp, color: t.good, target: D.ventasMeta },
    { id: "utilidad", label: "Utilidad neta", value: D.utilidad, prev: D.utilidadPrev, format: "money" as const, icon: DollarSign, color: t.nova, target: D.ventasMeta * 0.3 },
    { id: "pedidos", label: "Pedidos", value: D.pedidos, prev: D.pedidosPrev, format: "number" as const, icon: ShoppingCart, color: "#A78BFA", target: D.pedidosPrev * 1.1 },
    { id: "ticket", label: "Ticket promedio", value: D.ticket, prev: D.ticketPrev, format: "money" as const, icon: Star, color: t.warn },
    { id: "margen", label: "Margen bruto", value: D.margenBruto, prev: D.margenBrutoPrev, format: "percent" as const, icon: Activity, color: t.good, target: 38 },
    { id: "flujo", label: "Flujo neto", value: D.flujoNeto, prev: D.flujoPrev, format: "money" as const, icon: Zap, color: "#34D399" },
    { id: "nomina", label: "Costo nómina", value: D.nomina, prev: D.nominaPrev, format: "money" as const, icon: Users, color: t.bad },
    { id: "inventario", label: "Valor inventario", value: D.inventarioVal, prev: D.inventarioVal * 0.97, format: "money" as const, icon: Package, color: t.nova },
    { id: "cxc", label: "Por cobrar", value: D.cxc, prev: D.cxc * 1.05, format: "money" as const, icon: Clock, color: t.warn },
  ];

  // ── Module health ───────────────────────────────────────────────────────
  const moduleHealth = [
    { label: "Ventas", tl: light(D.ventas, D.ventasPrev, D.ventasMeta), value: fmt(D.ventas, "money"), delta: delta(D.ventas, D.ventasPrev) },
    { label: "Inventario", tl: light(D.inventarioVal, D.inventarioVal * 0.97), value: fmt(D.inventarioVal, "money"), delta: delta(D.inventarioVal, D.inventarioVal * 0.97) },
    { label: "Finanzas", tl: light(D.flujoNeto, D.flujoPrev), value: fmt(D.flujoNeto, "money"), delta: delta(D.flujoNeto, D.flujoPrev) },
    { label: "RH / Nómina", tl: light(D.nomina, D.nominaPrev) === "red" ? "yellow" as TrafficLight : "green" as TrafficLight, value: fmt(D.nomina, "money"), delta: delta(D.nomina, D.nominaPrev) },
    { label: "CXC Cobrar", tl: D.cxc > 300000 ? "red" as TrafficLight : "yellow" as TrafficLight, value: fmt(D.cxc, "money"), delta: -2.1 },
    { label: "Margen bruto", tl: D.margenBruto >= 35 ? "green" as TrafficLight : D.margenBruto >= 28 ? "yellow" as TrafficLight : "red" as TrafficLight, value: D.margenBruto + "%", delta: delta(D.margenBruto, D.margenBrutoPrev) },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>Reportes / BI</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>Inteligencia de negocio en tiempo real — todos los módulos integrados</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Period selector */}
          <div style={{ display: "flex", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
            {(["week", "month", "quarter", "year"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: period === p ? 700 : 500, background: period === p ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : "transparent", color: period === p ? "#fff" : t.textMid, transition: "all .15s" }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <Download size={14} /> Exportar
          </button>
          <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <Mail size={14} /> Programar reporte
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as any)} style={tabBtn(tab === id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ── TAB: Executive ── */}
      {tab === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Module health scorecard */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <SectionTitle icon={Activity} title="Semáforo de salud empresarial" color={t.nova} t={t} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {moduleHealth.map(m => {
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

          {/* Main KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {ALL_KPIS.slice(0, 6).map(k => (
              <KPIBlock key={k.id} {...k} t={t} sparkData={[k.prev * 0.9, k.prev * 0.95, k.prev, k.prev * 1.02, k.value * 0.97, k.value]} onClick={() => setDrillOpen(k.id)} />
            ))}
          </div>

          {/* Main chart + gauge */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Tendencia de ventas <span style={{ color: t.textLo, fontWeight: 400, fontSize: 12 }}>(miles MXN)</span></div>
                <div style={{ display: "flex", gap: 14 }}>
                  {[{ color: t.nova, label: "Actual" }, { color: t.textLo, label: "Anterior", dash: true }, { color: t.warn, label: "Meta", dash: true }].map(l => (
                    <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: t.textMid }}>
                      <span style={{ width: 16, height: 2, background: l.dash ? "transparent" : l.color, borderTop: l.dash ? `2px dashed ${l.color}` : "none", display: "inline-block" }} />{l.label}
                    </span>
                  ))}
                </div>
              </div>
              <LineBarChart data={D.chart} t={t} height={220} />
            </div>
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>Cumplimiento de meta</div>
              <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>{PERIOD_LABELS[period]}</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <GaugeArc value={D.ventas} target={D.ventasMeta} max={D.ventasMeta} t={t} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
                <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10.5, color: t.textLo }}>Real</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.good }}>{fmt(D.ventas, "money")}</div>
                </div>
                <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10.5, color: t.textLo }}>Meta</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.warn }}>{fmt(D.ventasMeta, "money")}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12.5, color: t.textMid, textAlign: "center" }}>
                Faltan <b style={{ color: t.textHi }}>{fmt(Math.max(0, D.ventasMeta - D.ventas), "money")}</b> para la meta
              </div>
            </div>
          </div>

          {/* Top clientes + productos */}
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

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { label: "Ventas totales", value: D.ventas, prev: D.ventasPrev, format: "money" as const, icon: TrendingUp, color: t.good, target: D.ventasMeta },
              { label: "Pedidos cerrados", value: D.pedidos, prev: D.pedidosPrev, format: "number" as const, icon: ShoppingCart, color: t.nova },
              { label: "Ticket promedio", value: D.ticket, prev: D.ticketPrev, format: "money" as const, icon: Star, color: t.warn },
              { label: "Tasa conversión", value: 68, prev: 62, format: "percent" as const, icon: Target, color: "#A78BFA" },
            ].map(k => <KPIBlock key={k.label} {...k} t={t} sparkData={[k.prev * 0.9, k.prev * 0.95, k.prev, k.value * 0.97, k.value]} />)}
          </div>

          {/* Chart */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Evolución de ventas vs período anterior y meta</div>
            <LineBarChart data={D.chart} t={t} height={220} />
          </div>

          {/* Embudo de ventas */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Embudo de conversión</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Cotizaciones generadas", value: Math.round(D.pedidos * 1.47), color: t.nova, pct: 100 },
                { label: "Cotizaciones enviadas", value: Math.round(D.pedidos * 1.32), color: "#A78BFA", pct: 90 },
                { label: "En negociación", value: Math.round(D.pedidos * 1.1), color: t.warn, pct: 75 },
                { label: "Pedidos confirmados", value: D.pedidos, color: t.good, pct: 68 },
                { label: "Pedidos pagados", value: Math.round(D.pedidos * 0.72), color: "#34D399", pct: 49 },
              ].map((stage, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: `${stage.pct}%`, background: stage.color + "22", border: `1px solid ${stage.color}44`, borderRadius: 6, padding: "10px 14px", display: "flex", justifyContent: "space-between", transition: "width .4s" }}>
                    <span style={{ fontSize: 13, color: t.textHi }}>{stage.label}</span>
                    <div style={{ display: "flex", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: stage.color }}>{stage.value.toLocaleString()}</span>
                      <span style={{ fontSize: 12, color: t.textLo }}>{stage.pct}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.ventasPorVendedor} t={t} title="Ventas por vendedor" />
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Ventas por canal</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <DonutChart data={D.ventasPorCanal.map(c => ({ label: c.label, value: c.value, color: c.color! }))} t={t} size={140} />
              </div>
              {D.ventasPorCanal.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: c.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: t.textMid, flex: 1 }}>{c.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{c.pct}%</span>
                  <span style={{ fontSize: 12, color: t.textLo }}>{fmt(c.value, "money")}</span>
                </div>
              ))}
            </div>
          </div>

          <DrillTable rows={D.topClientes} t={t} title="Top 5 clientes por volumen de compra" />
        </div>
      )}

      {/* ── TAB: Inventory ── */}
      {tab === "inventory" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={Package} title="Análisis de Inventario" color={t.nova} t={t} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { label: "Valor total", value: D.inventarioVal, prev: D.inventarioVal * 0.97, format: "money" as const, icon: Package, color: t.nova },
              { label: "Rotación mensual", value: 4.2, prev: 3.8, format: "number" as const, icon: RefreshCw, color: t.good },
              { label: "Días de inventario", value: 38, prev: 42, format: "number" as const, icon: Calendar, color: t.warn },
              { label: "SKUs activos", value: 7, prev: 7, format: "number" as const, icon: BarChart3, color: "#A78BFA" },
              { label: "Agotados", value: 1, prev: 0, format: "number" as const, icon: XCircle, color: t.bad },
            ].map(k => <KPIBlock key={k.label} {...k} t={t} sparkData={[k.prev * 0.9, k.prev, k.prev * 1.02, k.value]} />)}
          </div>

          {/* ABC Analysis */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Análisis ABC de inventario</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>A = 80% del valor · B = 15% · C = 5%</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { cat: "A", label: "Alta rotación", pct: 80, value: D.inventarioVal * 0.8, items: 2, color: t.good },
                { cat: "B", label: "Media rotación", pct: 15, value: D.inventarioVal * 0.15, items: 2, color: t.warn },
                { cat: "C", label: "Baja rotación", pct: 5, value: D.inventarioVal * 0.05, items: 3, color: t.bad },
              ].map(abc => (
                <div key={abc.cat} style={{ background: abc.color + "12", border: `1px solid ${abc.color}33`, borderRadius: 10, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: abc.color, marginBottom: 4 }}>{abc.cat}</div>
                  <div style={{ fontSize: 12, color: t.textLo, marginBottom: 8 }}>{abc.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi }}>{fmt(abc.value, "money")}</div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 4 }}>{abc.items} SKUs · {abc.pct}% del valor</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.inventarioCat} t={t} title="Valor por categoría" />
            <DrillTable rows={D.topProductos} t={t} title="Top productos por valor de inventario" />
          </div>

          {/* Stock health */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Salud del stock por producto</div>
            {[
              { name: "Varilla corrugada 3/8\"", stock: 1320, min: 200, max: 2000, dias: 82 },
              { name: "Cemento gris CPC 30R", stock: 480, min: 100, max: 800, dias: 34 },
              { name: "Pintura vinílica 19L", stock: 96, min: 30, max: 200, dias: 12 },
              { name: "Tubo PVC 4\"", stock: 12, min: 20, max: 100, dias: 4 },
              { name: "Block hueco 15x20x40", stock: 0, min: 50, max: 500, dias: 0 },
            ].map((p, i) => {
              const pct = Math.min((p.stock / p.max) * 100, 100);
              const color = p.stock === 0 ? t.bad : p.stock < p.min ? t.warn : t.good;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, color: t.textHi }}>{p.name}</span>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: t.textLo }}>{p.dias} días</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{p.stock.toLocaleString()} uds</span>
                      {p.stock === 0 && <span style={{ fontSize: 10, fontWeight: 700, color: t.bad, background: t.bad + "18", padding: "2px 6px", borderRadius: 4 }}>AGOTADO</span>}
                      {p.stock > 0 && p.stock < p.min && <span style={{ fontSize: 10, fontWeight: 700, color: t.warn, background: t.warn + "18", padding: "2px 6px", borderRadius: 4 }}>BAJO</span>}
                    </div>
                  </div>
                  <div style={{ height: 6, background: t.panel3, borderRadius: 99, position: "relative" }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: color }} />
                    <div style={{ position: "absolute", left: `${(p.min / p.max) * 100}%`, top: -2, width: 2, height: 10, background: t.textLo, opacity: 0.5 }} />
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
              { label: "Ingresos totales", value: D.ventas, prev: D.ventasPrev, format: "money" as const, icon: TrendingUp, color: t.good },
              { label: "Utilidad neta", value: D.utilidad, prev: D.utilidadPrev, format: "money" as const, icon: DollarSign, color: t.nova },
              { label: "Margen bruto", value: D.margenBruto, prev: D.margenBrutoPrev, format: "percent" as const, icon: Activity, color: t.warn, target: 38 },
              { label: "Flujo neto", value: D.flujoNeto, prev: D.flujoPrev, format: "money" as const, icon: Zap, color: "#34D399" },
              { label: "CXC por cobrar", value: D.cxc, prev: D.cxc * 1.05, format: "money" as const, icon: Clock, color: t.warn },
              { label: "CXP por pagar", value: D.cxp, prev: D.cxp * 0.98, format: "money" as const, icon: TrendingDown, color: t.bad },
            ].map(k => <KPIBlock key={k.label} {...k} t={t} sparkData={[k.prev * 0.9, k.prev, k.value]} />)}
          </div>

          {/* P&L Simplificado */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Estado de resultados simplificado (P&L)</div>
            <div style={{ maxWidth: 560 }}>
              {[
                { label: "Ventas netas", value: D.ventas, indent: 0, bold: true, color: t.textHi },
                { label: "Costo de ventas", value: -(D.ventas * (1 - D.margenBruto / 100)), indent: 0, color: t.bad },
                { label: "Utilidad bruta", value: D.ventas * (D.margenBruto / 100), indent: 0, bold: true, color: t.good, line: true },
                { label: "Gastos operativos", value: -(D.nomina + D.ventas * 0.08), indent: 0, color: t.bad },
                { label: "  · Nómina", value: -D.nomina, indent: 1, color: t.textMid },
                { label: "  · Otros gastos", value: -(D.ventas * 0.08), indent: 1, color: t.textMid },
                { label: "Utilidad operativa (EBIT)", value: D.utilidad * 1.08, indent: 0, bold: true, color: t.nova, line: true },
                { label: "Intereses / Otros", value: -D.utilidad * 0.08, indent: 0, color: t.bad },
                { label: "UTILIDAD NETA", value: D.utilidad, indent: 0, bold: true, color: t.good, line: true, big: true },
              ].map((row, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: `${row.line ? "10px 0 8px" : "7px 0"}`, borderTop: row.line ? `1px solid ${t.border}` : "none", borderBottom: row.line && row.big ? `2px solid ${t.border}` : "none", paddingLeft: row.indent ? 16 : 0 }}>
                  <span style={{ fontSize: row.big ? 14 : 13, color: row.color || t.textMid, fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                  <span style={{ fontSize: row.big ? 15 : 13.5, fontWeight: row.bold ? 700 : 500, color: row.value >= 0 ? t.good : t.bad, fontVariantNumeric: "tabular-nums" }}>
                    {row.value >= 0 ? "" : ""}{fmtFull(Math.abs(row.value))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Razones financieras */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 16 }}>Razones financieras clave</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { label: "Margen neto", value: `${((D.utilidad / D.ventas) * 100).toFixed(1)}%`, ref: ">15% saludable", tl: (D.utilidad / D.ventas) > 0.15 ? "green" : "yellow" as TrafficLight },
                { label: "Liquidez corriente", value: "2.4x", ref: ">1.5x saludable", tl: "green" as TrafficLight },
                { label: "Endeudamiento", value: "28%", ref: "<50% saludable", tl: "green" as TrafficLight },
                { label: "ROE", value: `${((D.utilidad / (D.ventas * 0.4)) * 100).toFixed(1)}%`, ref: ">12% saludable", tl: "green" as TrafficLight },
                { label: "Rotación CXC", value: "18 días", ref: "<30 días saludable", tl: "green" as TrafficLight },
                { label: "Costo nómina / ventas", value: `${((D.nomina / D.ventas) * 100).toFixed(1)}%`, ref: "<20% saludable", tl: (D.nomina / D.ventas) < 0.2 ? "green" : "yellow" as TrafficLight },
              ].map(r => {
                const c = lightColor(r.tl, t);
                return (
                  <div key={r.label} style={{ background: t.panel2, border: `1px solid ${c}33`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 6 }}>{r.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{r.value}</div>
                    <div style={{ fontSize: 11, color: t.textLo, marginTop: 5 }}>Ref: {r.ref}</div>
                    <HealthBadge tl={r.tl} t={t} />
                  </div>
                );
              })}
            </div>
          </div>

          <DrillTable rows={D.gastosCat} t={t} title="Distribución de egresos por categoría" />
        </div>
      )}

      {/* ── TAB: HR ── */}
      {tab === "hr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SectionTitle icon={Users} title="Análisis de RH & Nómina" color="#A78BFA" t={t} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            {[
              { label: "Costo nómina", value: D.nomina, prev: D.nominaPrev, format: "money" as const, icon: DollarSign, color: "#A78BFA" },
              { label: "Nómina / Ventas", value: Math.round((D.nomina / D.ventas) * 1000) / 10, prev: Math.round((D.nominaPrev / D.ventasPrev) * 1000) / 10, format: "percent" as const, icon: Activity, color: t.warn },
              { label: "Empleados activos", value: 7, prev: 6, format: "number" as const, icon: Users, color: t.good },
              { label: "Contratos por vencer", value: 2, prev: 1, format: "number" as const, icon: AlertTriangle, color: t.bad },
              { label: "Ausentismo", value: 3.2, prev: 4.1, format: "percent" as const, icon: Clock, color: t.warn },
            ].map(k => <KPIBlock key={k.label} {...k} t={t} sparkData={[k.prev * 0.95, k.prev, k.value]} />)}
          </div>

          {/* Payroll trend */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Costo de nómina vs ventas</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {D.chart.map((c, i) => {
                const pct = Math.round((D.nomina / D.ventas) * 1000) / 10;
                const barH = Math.min((D.nomina / (D.ventas * 0.25)) * 100, 100);
                return (
                  <div key={i} style={{ flex: 1, minWidth: 60, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: 120, background: t.panel2, borderRadius: 6, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", bottom: 0, width: "100%", height: `${(c.current / Math.max(...D.chart.map(x => x.current))) * 100}%`, background: t.nova, opacity: 0.4, borderRadius: "4px 4px 0 0" }} />
                      <div style={{ position: "absolute", bottom: 0, width: "100%", height: `${barH}%`, background: "#A78BFA", opacity: 0.7, borderRadius: "4px 4px 0 0" }} />
                    </div>
                    <span style={{ fontSize: 11, color: t.textLo }}>{c.label}</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 16, width: "100%", paddingTop: 8 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: t.textMid }}><span style={{ width: 10, height: 10, borderRadius: 2, background: t.nova, opacity: 0.4 }} />Ventas</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: t.textMid }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#A78BFA", opacity: 0.7 }} />Nómina</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <DrillTable rows={D.nominaDept} t={t} title="Nómina por departamento" colorPalette={["#A78BFA", "#33B2F5", "#34D399", "#FBBF24", "#F472B6"]} />
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Indicadores de bienestar</div>
              {[
                { label: "Tasa de retención", value: "94.3%", target: ">90%", tl: "green" as TrafficLight },
                { label: "Ausentismo", value: "3.2%", target: "<5%", tl: "green" as TrafficLight },
                { label: "Horas extra / total", value: "4.8%", target: "<10%", tl: "green" as TrafficLight },
                { label: "Contratos próx. vencer", value: "2", target: "0 ideal", tl: "yellow" as TrafficLight },
                { label: "Costo por empleado", value: fmtFull(D.nomina / 7), target: "benchmark", tl: "green" as TrafficLight },
              ].map(r => {
                const c = lightColor(r.tl, t);
                return (
                  <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                    <span style={{ fontSize: 13, color: t.textMid }}>{r.label}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: c }}>{r.value}</span>
                      <span style={{ fontSize: 11, color: t.textLo }}>ref: {r.target}</span>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Custom ── */}
      {tab === "custom" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>Dashboard personalizado</div>
            <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 16 }}>Selecciona los indicadores que quieres monitorear en tu vista personal.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_KPIS.map(k => (
                <button key={k.id} onClick={() => setCustomKPIs(prev => prev.includes(k.id) ? prev.filter(x => x !== k.id) : [...prev, k.id])} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${customKPIs.includes(k.id) ? t.nova : t.border}`, background: customKPIs.includes(k.id) ? t.nova + "18" : t.panel2, color: customKPIs.includes(k.id) ? t.nova : t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600, transition: "all .15s" }}>
                  {customKPIs.includes(k.id) && <Check size={12} />}
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {customKPIs.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              {ALL_KPIS.filter(k => customKPIs.includes(k.id)).map(k => (
                <KPIBlock key={k.id} {...k} t={t} sparkData={[k.prev * 0.88, k.prev * 0.94, k.prev, k.value * 0.97, k.value]} />
              ))}
            </div>
          )}

          {customKPIs.length > 0 && (
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Tendencia de indicadores seleccionados</div>
              <LineBarChart data={D.chart} t={t} height={200} />
            </div>
          )}

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 14 }}>Programar reporte automático</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Frecuencia</label>
                <select style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>Diario</option>
                  <option>Semanal</option>
                  <option>Quincenal</option>
                  <option>Mensual</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Formato</label>
                <select style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" }}>
                  <option>PDF</option>
                  <option>Excel</option>
                  <option>Ambos</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" }}>Email destino</label>
                <input placeholder="correo@empresa.mx" style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Bell size={14} /> Activar reporte automático
            </button>
          </div>
        </div>
      )}

      {/* ── DRILL-DOWN Modal ── */}
      {drillOpen && (() => {
        const kpi = ALL_KPIS.find(k => k.id === drillOpen);
        if (!kpi) return null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setDrillOpen(null)}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 600, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>{kpi.label} — Detalle</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: t.textHi }}>{fmt(kpi.value, kpi.format)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 13, color: delta(kpi.value, kpi.prev) >= 0 ? t.good : t.bad, fontWeight: 700 }}>
                      {delta(kpi.value, kpi.prev) >= 0 ? "+" : ""}{delta(kpi.value, kpi.prev)}% vs período anterior
                    </span>
                  </div>
                </div>
                <button onClick={() => setDrillOpen(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
              </div>
              <LineBarChart data={D.chart.map(c => ({ ...c, current: c.current * (kpi.value / D.ventas) * 1000, prev: c.prev * (kpi.prev / D.ventasPrev) * 1000 }))} t={t} height={180} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 16 }}>
                {[
                  { l: "Actual", v: fmt(kpi.value, kpi.format), c: t.textHi },
                  { l: "Período anterior", v: fmt(kpi.prev, kpi.format), c: t.textLo },
                  { l: "Meta", v: kpi.target ? fmt(kpi.target, kpi.format) : "N/A", c: t.warn },
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

      <style>{`@keyframes pulse{0%,100%{opacity:.5}50%{opacity:1}}`}</style>
    </div>
  );
}
