import { useState, useMemo } from "react";
import {
  LayoutDashboard, Package, Users, ShoppingCart, Wallet, BarChart3,
  Settings, IdCard, Search, SlidersHorizontal, Plus, Bell, ChevronDown,
  ChevronLeft, ChevronRight, LogOut, ArrowUpRight, ArrowDownRight,
  TrendingUp, Boxes, CircleDot, Sun, Moon, Check, Lock, User as UserIcon,
} from "lucide-react";

/* ============================ Brand & Theme ============================ */
/* Tokens del README de marca Sthenova + el isotipo "nova node".
   Navy #131B47 · Nova #33B2F5 · Base oscura #0A1022 · Leyenda #86A9D9
   Sin librerías de charts: todo es SVG/HTML, para que el build no falle.   */
const THEMES = {
  dark: {
    name: "dark",
    base: "#0A1022", panel: "#0E1838", panel2: "#131F44", panel3: "#1A2856",
    border: "#24386E", borderSoft: "#1b2c57",
    navy: "#131B47", nova: "#33B2F5", novaSoft: "#8CEEFF",
    textHi: "#F2F6FF", textMid: "#B9C6E6", textLo: "#86A9D9",
    good: "#34D399", warn: "#FBBF24", bad: "#F87171",
    gridLine: "#1b2c57", inputBg: "#0A1430",
  },
  light: {
    name: "light",
    base: "#F3F6FC", panel: "#FFFFFF", panel2: "#EEF3FB", panel3: "#E4ECF8",
    border: "#D7E0F0", borderSoft: "#E4ECF8",
    navy: "#131B47", nova: "#1E86CC", novaSoft: "#33B2F5",
    textHi: "#0E1838", textMid: "#41507A", textLo: "#6B7BA6",
    good: "#0F9D70", warn: "#C77A06", bad: "#D6453E",
    gridLine: "#E4ECF8", inputBg: "#F7FAFE",
  },
};

/* El isotipo de Sthenova, inline para que viaje con el archivo. */
function NovaMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" aria-label="Sthenova">
      <defs>
        <linearGradient id="gRight" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34538F" /><stop offset="1" stopColor="#1D2D60" />
        </linearGradient>
        <linearGradient id="gNova" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8CEEFF" /><stop offset="1" stopColor="#33B2F5" />
        </linearGradient>
        <radialGradient id="gGlow">
          <stop offset="0" stopColor="#49CEF8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#49CEF8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(70,72)">
        <polygon points="0,-62 62,46 0,24 -62,46" fill="#0E1838" />
        <polygon points="0,-62 0,-14 -30,-6" fill="#1A2856" />
        <polygon points="0,-62 30,-6 0,-14" fill="url(#gRight)" />
        <polygon points="-30,-6 0,-14 0,24 -62,46" fill="#131F44" />
        <polygon points="30,-6 62,46 0,24 0,-14" fill="#24386E" />
        <polyline points="0,-62 30,-6 62,46" fill="none" stroke="#5871BE" strokeWidth="1.2" strokeLinejoin="round" />
        <polygon points="0,-62 62,46 0,24 -62,46" fill="none" stroke="#3F578D" strokeWidth="1" strokeLinejoin="round" />
        <circle cx="0" cy="-10" r="22" fill="url(#gGlow)" className="nova-glow" />
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2,-30 C16,-28 18,-15 9,-10" stroke="#46C9F6" strokeWidth="2" />
          <path d="M-2,-30 C-16,-28 -18,-15 -9,-10" stroke="#46C9F6" strokeWidth="2" />
          <path d="M0,-11 L-8,3" stroke="#45C8F5" strokeWidth="1.4" />
          <path d="M0,-11 L8,3" stroke="#45C8F5" strokeWidth="1.4" />
          <path d="M0,-11 L0,7" stroke="#45C8F5" strokeWidth="1.4" />
          <path d="M0,-11 L-16,-11" stroke="#45C8F5" strokeWidth="1.4" />
          <path d="M0,-11 L16,-11" stroke="#45C8F5" strokeWidth="1.4" />
        </g>
        <g fill="#86ECFF">
          <circle cx="-8" cy="3" r="2" /><circle cx="8" cy="3" r="2" /><circle cx="0" cy="7" r="2" />
          <circle cx="-16" cy="-11" r="2" /><circle cx="16" cy="-11" r="2" />
        </g>
        <circle cx="0" cy="-11" r="5" fill="url(#gNova)" stroke="#0A1022" strokeWidth="0.5" />
        <circle cx="0" cy="-11" r="1.6" fill="#E6FBFF" />
      </g>
    </svg>
  );
}

/* ============================ Demo data ============================ */
const COMPANIES = [
  { id: "valle", name: "Comercializadora del Valle", initials: "CV", color: "#33B2F5" },
  { id: "norte", name: "Insumos del Norte", initials: "IN", color: "#34D399" },
  { id: "azteca", name: "Grupo Azteca Retail", initials: "GA", color: "#FBBF24" },
];

const KPIS = [
  { label: "Ventas del mes", value: 1284500, money: true, delta: 12.4, icon: TrendingUp },
  { label: "Por cobrar", value: 342800, money: true, delta: -3.1, icon: Wallet },
  { label: "Pedidos abiertos", value: 47, money: false, delta: 8.0, icon: ShoppingCart },
  { label: "SKUs activos", value: 1932, money: false, delta: 2.2, icon: Boxes },
];

const SALES_SERIES = [
  { m: "Ene", v: 820 }, { m: "Feb", v: 932 }, { m: "Mar", v: 901 },
  { m: "Abr", v: 1034 }, { m: "May", v: 1190 }, { m: "Jun", v: 1284 },
];
const CHANNELS = [
  { name: "Mostrador", v: 42 }, { name: "Mayoreo", v: 31 },
  { name: "e-Commerce", v: 18 }, { name: "Foráneo", v: 9 },
];
const TOP_PRODUCTS = [
  { p: "Cemento gris 50kg", u: 1240 }, { p: "Varilla 3/8\"", u: 980 },
  { p: "Pintura vinílica 19L", u: 760 }, { p: "Tubo PVC 4\"", u: 540 },
  { p: "Block hueco", u: 410 },
];

const PRODUCTS = [
  { id: 1, name: "Cemento gris CPC 30R", cat: "Construcción", variants: 2, stock: 480, price: 215 },
  { id: 2, name: "Varilla corrugada 3/8\"", cat: "Acero", variants: 1, stock: 1320, price: 178 },
  { id: 3, name: "Pintura vinílica blanca 19L", cat: "Pinturas", variants: 4, stock: 96, price: 1290 },
  { id: 4, name: "Tubo PVC hidráulico 4\"", cat: "Plomería", variants: 3, stock: 12, price: 340 },
  { id: 5, name: "Block hueco 15x20x40", cat: "Construcción", variants: 1, stock: 0, price: 18 },
  { id: 6, name: "Cable THW cal. 12", cat: "Eléctrico", variants: 5, stock: 220, price: 28 },
  { id: 7, name: "Impermeabilizante 5 años 19L", cat: "Pinturas", variants: 2, stock: 64, price: 1490 },
];

const ORDERS = [
  { id: "VTA-2041", cliente: "Constructora Robles", fecha: "11 jun 2026", total: 84200, estado: "Pagado" },
  { id: "VTA-2040", cliente: "Ferretería La Esquina", fecha: "11 jun 2026", total: 12650, estado: "Pendiente" },
  { id: "VTA-2039", cliente: "Mantenimiento Industrial GZ", fecha: "10 jun 2026", total: 196400, estado: "Parcial" },
  { id: "VTA-2038", cliente: "Público en general", fecha: "10 jun 2026", total: 3480, estado: "Pagado" },
  { id: "VTA-2037", cliente: "Obras del Bajío SA", fecha: "09 jun 2026", total: 57300, estado: "Pendiente" },
];

const CUSTOMERS = [
  { name: "Constructora Robles", rfc: "CRO180921AB2", saldo: 84200, pedidos: 38, tag: "Mayoreo" },
  { name: "Ferretería La Esquina", rfc: "FLE150303KK9", saldo: 0, pedidos: 122, tag: "Frecuente" },
  { name: "Mantenimiento Industrial GZ", rfc: "MIG200710Q1A", saldo: 196400, pedidos: 14, tag: "Crédito" },
  { name: "Obras del Bajío SA", rfc: "OBA190511XY0", saldo: 57300, pedidos: 9, tag: "Crédito" },
];

const MODULES = [
  { id: "dashboard", label: "Tablero", icon: LayoutDashboard },
  { id: "ventas", label: "Ventas / CRM", icon: ShoppingCart },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "inventario", label: "Inventario", icon: Package, live: true },
  { id: "finanzas", label: "Finanzas", icon: Wallet },
  { id: "rh", label: "RH / Nómina", icon: IdCard, soon: true },
  { id: "reportes", label: "Reportes / BI", icon: BarChart3, soon: true },
  { id: "config", label: "Configuración", icon: Settings },
];

const mxn = (n) => "$" + n.toLocaleString("es-MX");

/* ============================ Inline SVG charts ============================ */
function AreaChartSVG({ t, data }) {
  const W = 600, H = 220, P = { l: 6, r: 6, t: 14, b: 26 };
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b;
  const max = Math.max(...data.map((d) => d.v)) * 1.12;
  const x = (i) => P.l + (i * innerW) / (data.length - 1);
  const y = (v) => P.t + (1 - v / max) * innerH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d.v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(data.length - 1).toFixed(1)} ${P.t + innerH} L ${x(0).toFixed(1)} ${P.t + innerH} Z`;
  const grid = [0.25, 0.5, 0.75, 1].map((g) => P.t + g * innerH);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 220 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaNova" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.nova} stopOpacity="0.4" />
          <stop offset="100%" stopColor={t.nova} stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((gy, i) => <line key={i} x1={P.l} x2={W - P.r} y1={gy} y2={gy} stroke={t.gridLine} strokeWidth="1" />)}
      <path d={area} fill="url(#areaNova)" />
      <path d={line} fill="none" stroke={t.nova} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.v)} r="3.5" fill={t.panel} stroke={t.nova} strokeWidth="2" />)}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - 8} fill={t.textLo} fontSize="12" textAnchor="middle">{d.m}</text>
      ))}
    </svg>
  );
}

function DonutSVG({ t, data, colors }) {
  const total = data.reduce((s, d) => s + d.v, 0);
  const r = 58, cx = 90, cy = 90, sw = 22, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 180 180" style={{ width: 180, height: 180 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={t.panel3} strokeWidth={sw} />
      {data.map((d, i) => {
        const frac = d.v / total;
        const seg = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={colors[i]} strokeWidth={sw}
            strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}
            transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />
        );
        acc += frac;
        return seg;
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fill={t.textHi} fontSize="22" fontWeight="700">{total}%</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill={t.textLo} fontSize="10">distribución</text>
    </svg>
  );
}

function BarsHTML({ t, data }) {
  const max = Math.max(...data.map((d) => d.u));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.map((d) => (
        <div key={d.p} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 150, fontSize: 12.5, color: t.textMid, textAlign: "right", flex: "0 0 150px" }}>{d.p}</span>
          <div style={{ flex: 1, height: 16, background: t.panel3, borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${(d.u / max) * 100}%`, height: "100%", borderRadius: 6, background: `linear-gradient(90deg, ${t.navy}, ${t.nova})` }} />
          </div>
          <span style={{ width: 52, fontSize: 12.5, fontWeight: 600, color: t.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.u}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================ UI atoms ============================ */
function Card({ t, children, style }) {
  return (
    <div style={{
      background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14,
      boxShadow: t.name === "dark" ? "0 1px 0 rgba(255,255,255,0.02)" : "0 1px 2px rgba(16,24,56,0.05)",
      ...style,
    }}>{children}</div>
  );
}

function Pill({ t, children }) {
  const map = {
    Pagado: t.good, Pendiente: t.warn, Parcial: t.nova, Agotado: t.bad,
    Mayoreo: t.nova, Frecuente: t.good, "Crédito": t.warn,
  };
  const c = map[children] || t.textLo;
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 600, color: c, padding: "3px 9px", borderRadius: 999,
      background: c + "1f", border: `1px solid ${c}33`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function PageHead({ t, title, sub, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>{title}</h1>
        {sub && <p style={{ margin: "6px 0 0", color: t.textLo, fontSize: 13.5 }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function PrimaryBtn({ t, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
      background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff",
      fontSize: 13.5, fontWeight: 600, padding: "10px 16px", borderRadius: 10,
      boxShadow: `0 6px 18px ${t.nova}33`,
    }}>{children}</button>
  );
}

/* ============================ Login ============================ */
function Login({ t, onEnter }) {
  const [u, setU] = useState("admin@sthenova.mx");
  const [p, setP] = useState("demo");
  return (
    <div style={{ minHeight: "100vh", background: t.base, display: "grid", placeItems: "center", padding: 24, position: "relative", overflow: "hidden" }}>
      <svg viewBox="0 0 800 800" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }} preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="38%" r="55%">
            <stop offset="0" stopColor="#16306a" /><stop offset="1" stopColor={t.base} />
          </radialGradient>
        </defs>
        <rect width="800" height="800" fill="url(#bgGlow)" />
        <g stroke="#23396f" strokeWidth="1" fill="none" opacity="0.6">
          <polygon points="400,120 560,520 400,440 240,520" />
          <polyline points="400,120 480,440 560,520" />
        </g>
      </svg>

      <div style={{ position: "relative", width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><NovaMark size={86} /></div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, color: t.textHi }}>STHENOVA</div>
        <div style={{ fontSize: 10, letterSpacing: 6, color: t.textLo, marginBottom: 30 }}>COMPLETE SYSTEM</div>

        <Card t={t} style={{ padding: 26, textAlign: "left" }}>
          <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600 }}>Usuario</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", margin: "6px 0 16px" }}>
            <UserIcon size={16} color={t.textLo} />
            <input value={u} onChange={(e) => setU(e.target.value)} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 14 }} />
          </div>
          <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600 }}>Contraseña</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px", margin: "6px 0 20px" }}>
            <Lock size={16} color={t.textLo} />
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 14 }} />
          </div>
          <button onClick={onEnter} style={{
            width: "100%", border: "none", cursor: "pointer", color: "#fff", fontSize: 15, fontWeight: 600,
            padding: "12px", borderRadius: 10, background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
            boxShadow: `0 8px 22px ${t.nova}40`,
          }}>Entrar al sistema</button>
          <p style={{ margin: "14px 0 0", fontSize: 11.5, color: t.textLo, textAlign: "center" }}>
            Demo · cualquier credencial entra
          </p>
        </Card>
        <p style={{ marginTop: 22, fontSize: 11, color: t.textLo }}>Plataforma Sthenova · el logo de cada empresa cliente se configura por separado</p>
      </div>
    </div>
  );
}

/* ============================ Sidebar ============================ */
function Sidebar({ t, page, setPage, collapsed, setCollapsed }) {
  const w = collapsed ? 72 : 248;
  return (
    <aside style={{
      width: w, flex: `0 0 ${w}px`, background: t.panel, borderRight: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column", transition: "width .18s ease", height: "100vh", position: "sticky", top: 0,
    }}>
      <div style={{ height: 64, display: "flex", alignItems: "center", gap: 8, padding: collapsed ? "0 16px" : "0 18px", borderBottom: `1px solid ${t.border}` }}>
        <NovaMark size={30} />
        {!collapsed && <span style={{ fontWeight: 700, letterSpacing: 2.5, color: t.textHi, fontSize: 15 }}>STHENOVA</span>}
      </div>

      <nav style={{ flex: 1, padding: "12px 10px", overflowY: "auto" }}>
        {!collapsed && <div style={{ fontSize: 10.5, letterSpacing: 1.5, color: t.textLo, fontWeight: 600, padding: "6px 10px 8px" }}>MÓDULOS</div>}
        {MODULES.map((m) => {
          const active = page === m.id;
          const Icon = m.icon;
          return (
            <button key={m.id} onClick={() => setPage(m.id)} title={m.label} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 11, cursor: "pointer",
              padding: collapsed ? "11px 0" : "10px 12px", justifyContent: collapsed ? "center" : "flex-start",
              marginBottom: 3, borderRadius: 10, border: "none", textAlign: "left",
              background: active ? `linear-gradient(90deg, ${t.nova}26, transparent)` : "transparent",
              color: active ? t.textHi : t.textMid, position: "relative",
            }}>
              {active && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: t.nova }} />}
              <Icon size={18} color={active ? t.nova : t.textLo} />
              {!collapsed && <span style={{ fontSize: 13.5, fontWeight: active ? 600 : 500 }}>{m.label}</span>}
              {!collapsed && m.live && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: t.good, background: t.good + "22", padding: "2px 6px", borderRadius: 6 }}>API</span>}
              {!collapsed && m.soon && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: t.textLo, background: t.panel3, padding: "2px 6px", borderRadius: 6 }}>pronto</span>}
            </button>
          );
        })}
      </nav>

      {/* Logo de plataforma, discreto — donde lo pide el README de marca */}
      <div style={{ borderTop: `1px solid ${t.border}`, padding: collapsed ? 12 : "14px 16px", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
        {!collapsed ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
            <NovaMark size={20} />
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: t.textLo }}>STHENOVA</div>
              <div style={{ fontSize: 8, letterSpacing: 1, color: t.textLo }}>v0.1 · demo</div>
            </div>
          </div>
        ) : <NovaMark size={20} />}
        {!collapsed && (
          <button onClick={() => setCollapsed(true)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}>
            <ChevronLeft size={18} />
          </button>
        )}
      </div>
      {collapsed && (
        <button onClick={() => setCollapsed(false)} style={{ position: "absolute", top: 76, right: -12, width: 24, height: 24, borderRadius: 999, background: t.panel2, border: `1px solid ${t.border}`, cursor: "pointer", color: t.textMid, display: "grid", placeItems: "center" }}>
          <ChevronRight size={14} />
        </button>
      )}
    </aside>
  );
}

/* ============================ Topbar ============================ */
function Topbar({ t, company, setCompany, theme, setTheme, onLogout }) {
  const [open, setOpen] = useState(false);
  return (
    <header style={{
      height: 64, flex: "0 0 64px", background: t.panel, borderBottom: `1px solid ${t.border}`,
      display: "flex", alignItems: "center", gap: 14, padding: "0 20px", position: "sticky", top: 0, zIndex: 20,
    }}>
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen(!open)} style={{
          display: "flex", alignItems: "center", gap: 9, cursor: "pointer", background: t.panel2,
          border: `1px solid ${t.border}`, borderRadius: 10, padding: "7px 11px", color: t.textHi,
        }}>
          <span style={{ width: 24, height: 24, borderRadius: 7, background: company.color + "26", color: company.color, fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>{company.initials}</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{company.name}</span>
          <ChevronDown size={15} color={t.textLo} />
        </button>
        {open && (
          <div style={{ position: "absolute", top: 48, left: 0, width: 260, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 6, boxShadow: "0 18px 40px rgba(0,0,0,0.35)", zIndex: 50 }}>
            <div style={{ fontSize: 10.5, letterSpacing: 1, color: t.textLo, fontWeight: 600, padding: "8px 10px 6px" }}>EMPRESAS</div>
            {COMPANIES.map((c) => (
              <button key={c.id} onClick={() => { setCompany(c); setOpen(false); }} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left",
                padding: "9px 10px", borderRadius: 9, border: "none", background: c.id === company.id ? t.panel2 : "transparent", color: t.textHi,
              }}>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: c.color + "26", color: c.color, fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>{c.initials}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{c.name}</span>
                {c.id === company.id && <Check size={15} color={t.nova} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, maxWidth: 420, display: "flex", alignItems: "center", gap: 9, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "9px 12px" }}>
        <Search size={16} color={t.textLo} />
        <input placeholder="Buscar productos, clientes, folios…" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 13.5 }} />
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Tema" style={iconBtn(t)}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button style={iconBtn(t)} title="Notificaciones"><Bell size={18} /><span style={{ position: "absolute", top: 8, right: 8, width: 7, height: 7, borderRadius: 999, background: t.nova }} /></button>
        <div style={{ width: 1, height: 26, background: t.border, margin: "0 4px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 32, height: 32, borderRadius: 999, background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 13 }}>JS</span>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textHi }}>Jos</div>
            <div style={{ fontSize: 10.5, color: t.textLo }}>Administrador</div>
          </div>
        </div>
        <button onClick={onLogout} style={iconBtn(t)} title="Salir"><LogOut size={17} /></button>
      </div>
    </header>
  );
}
const iconBtn = (t) => ({
  position: "relative", width: 36, height: 36, borderRadius: 10, cursor: "pointer",
  background: "transparent", border: "1px solid transparent", color: t.textMid, display: "grid", placeItems: "center",
});

/* ============================ Pages ============================ */
function Dashboard({ t }) {
  const donutColors = [t.nova, t.good, t.warn, t.novaSoft];
  return (
    <div>
      <PageHead t={t} title="Tablero" sub="Resumen operativo de la empresa seleccionada · junio 2026" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 16 }}>
        {KPIS.map((k) => {
          const up = k.delta >= 0; const Icon = k.icon;
          return (
            <Card key={k.label} t={t} style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontSize: 12.5, color: t.textLo, fontWeight: 500 }}>{k.label}</span>
                <span style={{ width: 34, height: 34, borderRadius: 9, background: t.nova + "1f", display: "grid", placeItems: "center" }}><Icon size={17} color={t.nova} /></span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: t.textHi, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
                {k.money ? mxn(k.value) : k.value.toLocaleString("es-MX")}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
                {up ? <ArrowUpRight size={14} color={t.good} /> : <ArrowDownRight size={14} color={t.bad} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: up ? t.good : t.bad }}>{Math.abs(k.delta)}%</span>
                <span style={{ fontSize: 11.5, color: t.textLo }}>vs mes anterior</span>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 16 }}>
        <Card t={t} style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>Ventas mensuales <span style={{ color: t.textLo, fontWeight: 400 }}>(miles MXN)</span></div>
          <AreaChartSVG t={t} data={SALES_SERIES} />
        </Card>
        <Card t={t} style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>Ventas por canal</div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <DonutSVG t={t} data={CHANNELS} colors={donutColors} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {CHANNELS.map((c, i) => (
                <span key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: t.textMid }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: donutColors[i] }} />{c.name}
                  <b style={{ color: t.textHi, marginLeft: 4 }}>{c.v}%</b>
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card t={t} style={{ padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>Productos más vendidos <span style={{ color: t.textLo, fontWeight: 400 }}>(unidades)</span></div>
        <BarsHTML t={t} data={TOP_PRODUCTS} />
      </Card>
    </div>
  );
}

function Table({ t, head, children }) {
  return (
    <Card t={t} style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr style={{ background: t.panel2 }}>
              {head.map((h, i) => (
                <th key={i} style={{ textAlign: h.r ? "right" : "left", padding: "13px 18px", fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4, color: t.textLo, borderBottom: `1px solid ${t.border}` }}>{h.l || h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  );
}
const td = (t, r) => ({ padding: "14px 18px", fontSize: 13.5, color: t.textMid, borderBottom: `1px solid ${t.borderSoft}`, textAlign: r ? "right" : "left", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" });

function Inventory({ t }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => PRODUCTS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.cat.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <div>
      <PageHead t={t} title="Inventario" sub="Catálogo de productos, variantes y existencias por almacén"
        action={<PrimaryBtn t={t}><Plus size={16} /> Agregar producto</PrimaryBtn>} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240, maxWidth: 380, display: "flex", alignItems: "center", gap: 9, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px" }}>
          <Search size={16} color={t.textLo} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o categoría" style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.textHi, fontSize: 13.5 }} />
        </div>
        <button style={{ display: "inline-flex", alignItems: "center", gap: 7, background: t.panel2, border: `1px solid ${t.border}`, color: t.textMid, borderRadius: 10, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", fontWeight: 600 }}>
          <SlidersHorizontal size={15} /> Filtros
        </button>
      </div>
      <Table t={t} head={["Producto", "Categoría", "Variantes", { l: "Existencia", r: true }, { l: "Precio", r: true }, ""]}>
        {rows.map((p) => {
          const out = p.stock === 0, low = p.stock > 0 && p.stock < 20;
          return (
            <tr key={p.id}>
              <td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{p.name}</td>
              <td style={td(t)}>{p.cat}</td>
              <td style={td(t)}>{p.variants} {p.variants === 1 ? "variante" : "variantes"}</td>
              <td style={td(t, true)}>
                <span style={{ color: out ? t.bad : low ? t.warn : t.textHi, fontWeight: 600 }}>{p.stock}</span>
                {out && <span style={{ marginLeft: 8 }}><Pill t={t}>Agotado</Pill></span>}
              </td>
              <td style={{ ...td(t, true), color: t.textHi }}>{mxn(p.price)}</td>
              <td style={{ ...td(t, true) }}><a style={{ color: t.nova, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Editar</a></td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr><td colSpan={6} style={{ ...td(t), textAlign: "center", color: t.textLo, padding: 40 }}>Sin resultados. Ajusta la búsqueda o agrega un producto.</td></tr>
        )}
      </Table>
    </div>
  );
}

function Sales({ t }) {
  return (
    <div>
      <PageHead t={t} title="Ventas / CRM" sub="Pedidos, cotizaciones y seguimiento comercial"
        action={<PrimaryBtn t={t}><Plus size={16} /> Nuevo pedido</PrimaryBtn>} />
      <Table t={t} head={["Folio", "Cliente", "Fecha", { l: "Total", r: true }, "Estado"]}>
        {ORDERS.map((o) => (
          <tr key={o.id}>
            <td style={{ ...td(t), color: t.nova, fontWeight: 600 }}>{o.id}</td>
            <td style={{ ...td(t), color: t.textHi }}>{o.cliente}</td>
            <td style={td(t)}>{o.fecha}</td>
            <td style={{ ...td(t, true), color: t.textHi, fontWeight: 600 }}>{mxn(o.total)}</td>
            <td style={td(t)}><Pill t={t}>{o.estado}</Pill></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Customers({ t }) {
  return (
    <div>
      <PageHead t={t} title="Clientes" sub="Cartera, saldos y clasificación comercial"
        action={<PrimaryBtn t={t}><Plus size={16} /> Nuevo cliente</PrimaryBtn>} />
      <Table t={t} head={["Cliente", "RFC", { l: "Saldo", r: true }, { l: "Pedidos", r: true }, "Etiqueta"]}>
        {CUSTOMERS.map((c) => (
          <tr key={c.rfc}>
            <td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{c.name}</td>
            <td style={td(t)}>{c.rfc}</td>
            <td style={{ ...td(t, true), color: c.saldo > 0 ? t.warn : t.good, fontWeight: 600 }}>{mxn(c.saldo)}</td>
            <td style={td(t, true)}>{c.pedidos}</td>
            <td style={td(t)}><Pill t={t}>{c.tag}</Pill></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Finance({ t }) {
  const cxc = [
    { c: "Mantenimiento Industrial GZ", d: "30+ días", m: 196400 },
    { c: "Constructora Robles", d: "0-15 días", m: 84200 },
    { c: "Obras del Bajío SA", d: "15-30 días", m: 57300 },
  ];
  return (
    <div>
      <PageHead t={t} title="Finanzas" sub="Cuentas por cobrar, por pagar y bancos" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14, marginBottom: 16 }}>
        {[
          { l: "Por cobrar", v: 342800, c: t.warn }, { l: "Por pagar", v: 211050, c: t.bad },
          { l: "Saldo en bancos", v: 1840200, c: t.good }, { l: "Flujo del mes", v: 131750, c: t.nova },
        ].map((x) => (
          <Card key={x.l} t={t} style={{ padding: 18 }}>
            <span style={{ fontSize: 12.5, color: t.textLo }}>{x.l}</span>
            <div style={{ fontSize: 24, fontWeight: 700, color: x.c, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{mxn(x.v)}</div>
          </Card>
        ))}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, margin: "4px 2px 12px" }}>Antigüedad de saldos · por cobrar</div>
      <Table t={t} head={["Cliente", "Antigüedad", { l: "Monto", r: true }]}>
        {cxc.map((r) => (
          <tr key={r.c}>
            <td style={{ ...td(t), color: t.textHi, fontWeight: 600 }}>{r.c}</td>
            <td style={td(t)}>{r.d}</td>
            <td style={{ ...td(t, true), color: t.textHi, fontWeight: 600 }}>{mxn(r.m)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Soon({ t, title, sub, icon: Icon }) {
  return (
    <div>
      <PageHead t={t} title={title} sub={sub} />
      <Card t={t} style={{ padding: 64, textAlign: "center", borderStyle: "dashed" }}>
        <div style={{ display: "inline-grid", placeItems: "center", width: 64, height: 64, borderRadius: 16, background: t.nova + "18", marginBottom: 16 }}>
          <Icon size={28} color={t.nova} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: t.textHi }}>Módulo en preparación</div>
        <p style={{ color: t.textLo, fontSize: 13.5, maxWidth: 420, margin: "8px auto 0" }}>
          Este módulo todavía no tiene endpoints en el backend. En cuanto lo agreguemos, se conecta igual que Inventario.
        </p>
      </Card>
    </div>
  );
}

function Config({ t, company }) {
  return (
    <div>
      <PageHead t={t} title="Configuración" sub="Datos de la empresa, marca del cliente y usuarios" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        <Card t={t} style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>Identidad de la empresa</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <span style={{ width: 56, height: 56, borderRadius: 14, background: company.color + "26", color: company.color, fontWeight: 700, fontSize: 20, display: "grid", placeItems: "center" }}>{company.initials}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.textHi }}>{company.name}</div>
              <button style={{ marginTop: 6, fontSize: 12, color: t.nova, background: "transparent", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>Cambiar logo del cliente</button>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.6, margin: 0 }}>
            Cada empresa cliente trae su propio logo y datos fiscales. La marca <b style={{ color: t.textMid }}>Sthenova</b> aparece solo en el login y en el pie del menú, de forma discreta.
          </p>
        </Card>
        <Card t={t} style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 16 }}>Usuarios y permisos</div>
          {[["Jos", "Administrador", t.nova], ["Almacén 01", "Inventario", t.good], ["Caja Toreo", "Ventas", t.warn]].map(([n, r, c]) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
              <span style={{ width: 32, height: 32, borderRadius: 999, background: c + "26", color: c, fontWeight: 700, fontSize: 12, display: "grid", placeItems: "center" }}>{n[0]}</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{n}</div><div style={{ fontSize: 11.5, color: t.textLo }}>{r}</div></div>
              <CircleDot size={15} color={t.good} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* ============================ App ============================ */
export default function App() {
  const [theme, setTheme] = useState("dark");
  const [authed, setAuthed] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [company, setCompany] = useState(COMPANIES[0]);
  const t = THEMES[theme];

  if (!authed) {
    return (<>
      <style>{`.nova-glow{animation:pulse 3.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}@media (prefers-reduced-motion:reduce){.nova-glow{animation:none}}`}</style>
      <Login t={t} onEnter={() => setAuthed(true)} />
    </>);
  }

  const PAGES = {
    dashboard: <Dashboard t={t} />,
    inventario: <Inventory t={t} />,
    ventas: <Sales t={t} />,
    clientes: <Customers t={t} />,
    finanzas: <Finance t={t} />,
    rh: <Soon t={t} title="RH / Nómina" sub="Empleados, asistencias y cálculo de nómina" icon={IdCard} />,
    reportes: <Soon t={t} title="Reportes / BI" sub="Tableros y reportes configurables" icon={BarChart3} />,
    config: <Config t={t} company={company} />,
  };

  return (
    <div style={{ display: "flex", background: t.base, minHeight: "100vh", fontFamily: "Inter, system-ui, Arial, sans-serif", color: t.textMid }}>
      <style>{`.nova-glow{animation:pulse 3.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.45}50%{opacity:.85}}@media (prefers-reduced-motion:reduce){.nova-glow{animation:none}} ::placeholder{color:${t.textLo}}`}</style>
      <Sidebar t={t} page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar t={t} company={company} setCompany={setCompany} theme={theme} setTheme={setTheme} onLogout={() => setAuthed(false)} />
        <main style={{ flex: 1, padding: 24, overflowX: "hidden" }}>{PAGES[page]}</main>
      </div>
    </div>
  );
}
