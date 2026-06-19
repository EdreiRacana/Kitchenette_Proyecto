// Customer360.tsx — Vista 360° del cliente (Customer 360)
// Estado de resultados por cliente (P&L), devoluciones, transacciones y segmentación.
// Respeta el patrón modular del proyecto: usa Tokens, componentes de ../sales/ui y money().
// Datos demo realistas (derivados del cliente) hasta conectar el backend real.

import { useMemo, useState } from "react";
import {
  X, TrendingUp, RotateCcw, Receipt, Truck, Megaphone, Percent, Landmark,
  ArrowUpRight, ShoppingBag, Package, CreditCard,
  FileText, Wallet, Store, Globe, Building2, Star, Users, Info,
} from "lucide-react";
import type { Tokens } from "../sales/theme";
import { money } from "../sales/theme";
import { Badge } from "../sales/ui";
import type { Customer } from "./types";

// ── Tipos del P&L por cliente ───────────────────────────────────────────────
interface CustomerPnL {
  gross_sales: number;       // Venta bruta
  returns: number;           // Devoluciones (SR&A)
  allowances: number;        // Bonificaciones
  discounts: number;         // Descuentos
  net_sales: number;         // Venta neta
  cogs: number;              // Costo de mercancía
  gross_margin: number;      // Margen bruto
  commissions: number;       // Comisiones
  shipping_costs: number;    // Costos de envío
  marketing: number;         // Gastos de marketing
  withholdings: number;      // Retenciones
  net_contribution: number;  // Contribución neta
}

interface Transaction {
  id: string;
  type: "venta" | "devolucion" | "nota_credito" | "pago";
  date: string;
  ref: string;
  amount: number;
  status: string;
}

interface ReturnItem {
  id: string;
  date: string;
  ref: string;
  product: string;
  qty: number;
  amount: number;
  reason: string;
}

// ── Segmento / tipo de cliente ──────────────────────────────────────────────
const SEGMENT_META: Record<string, { label: string; icon: typeof Store; color: string }> = {
  individual: { label: "Individual", icon: Users, color: "#60A5FA" },
  fisica: { label: "Tienda física", icon: Store, color: "#34D399" },
  marketplace: { label: "Marketplace", icon: Globe, color: "#A78BFA" },
  propia: { label: "Tienda propia", icon: Building2, color: "#33B2F5" },
  especial: { label: "Venta especial", icon: Star, color: "#FBBF24" },
};

// Mapea el client_type libre del backend a un segmento conocido (heurística demo)
function segmentOf(c: Customer): keyof typeof SEGMENT_META {
  const t = (c.client_type || "").toLowerCase();
  if (t.includes("market") || t.includes("amazon") || t.includes("mercado")) return "marketplace";
  if (t.includes("propia") || t.includes("interna")) return "propia";
  if (t.includes("especial") || t.includes("vip")) return "especial";
  if (t.includes("tienda") || t.includes("física") || t.includes("fisica") || t.includes("sucursal")) return "fisica";
  return "individual";
}

// ── Generador demo determinista (mismo cliente → mismos números) ────────────
function hashId(c: Customer): number {
  const base = (c.client_number || c.name || String(c.id));
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return h;
}

function demoPnL(c: Customer): CustomerPnL {
  const h = hashId(c);
  const gross = 180000 + (h % 1700000);          // 180k – 1.88M
  const returns = Math.round(gross * (0.02 + (h % 60) / 1000));   // 2%–8%
  const allowances = Math.round(gross * 0.01);
  const discounts = Math.round(gross * (0.02 + (h % 40) / 1000));
  const net_sales = gross - returns - allowances - discounts;
  const seg = segmentOf(c);
  const marginRate = seg === "propia" ? 0.34 : seg === "marketplace" ? 0.18 : seg === "especial" ? 0.28 : 0.26;
  const cogs = Math.round(net_sales * (1 - marginRate));
  const gross_margin = net_sales - cogs;
  const commissions = Math.round(net_sales * (seg === "marketplace" ? 0.12 : 0.03));
  const shipping_costs = Math.round(net_sales * 0.025);
  const marketing = Math.round(net_sales * (seg === "marketplace" ? 0.06 : 0.02));
  const withholdings = Math.round(net_sales * 0.0125);
  const net_contribution = gross_margin - commissions - shipping_costs - marketing - withholdings;
  return { gross_sales: gross, returns, allowances, discounts, net_sales, cogs, gross_margin, commissions, shipping_costs, marketing, withholdings, net_contribution };
}

function demoTransactions(c: Customer): Transaction[] {
  const h = hashId(c);
  const out: Transaction[] = [];
  const types: Transaction["type"][] = ["venta", "venta", "pago", "devolucion", "venta", "nota_credito"];
  for (let i = 0; i < 6; i++) {
    const day = 18 - i * 3;
    out.push({
      id: `T${i}`,
      type: types[i],
      date: `2026-06-${String(Math.max(1, day)).padStart(2, "0")}`,
      ref: `${types[i] === "venta" ? "VTA" : types[i] === "pago" ? "PAG" : types[i] === "devolucion" ? "DEV" : "NC"}-${2000 + ((h + i * 7) % 900)}`,
      amount: 8000 + ((h + i * 131) % 80000),
      status: types[i] === "pago" ? "Aplicado" : types[i] === "devolucion" ? "Procesada" : "Completada",
    });
  }
  return out;
}

function demoReturns(c: Customer): ReturnItem[] {
  const h = hashId(c);
  const products = ["Cemento gris CPC 30R", "Pintura vinílica 19L", "Varilla 3/8\"", "Tubo PVC 4\"", "Cable THW cal. 12"];
  const reasons = ["Producto dañado", "No coincide pedido", "Defecto de fábrica", "Cliente cambió de opinión", "Entrega tardía"];
  const n = 2 + (h % 3);
  const out: ReturnItem[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `R${i}`,
      date: `2026-06-${String(Math.max(1, 16 - i * 4)).padStart(2, "0")}`,
      ref: `DEV-${1000 + ((h + i * 53) % 900)}`,
      product: products[(h + i) % products.length],
      qty: 1 + ((h + i) % 12),
      amount: 1500 + ((h + i * 97) % 18000),
      reason: reasons[(h + i) % reasons.length],
    });
  }
  return out;
}

const TX_META: Record<Transaction["type"], { label: string; color: string; icon: typeof Receipt }> = {
  venta: { label: "Venta", color: "#34D399", icon: ShoppingBag },
  devolucion: { label: "Devolución", color: "#F87171", icon: RotateCcw },
  nota_credito: { label: "Nota de crédito", color: "#FBBF24", icon: FileText },
  pago: { label: "Pago", color: "#33B2F5", icon: CreditCard },
};

// ── Componente principal ────────────────────────────────────────────────────
export default function Customer360({
  tk, customer, onClose, onEdit,
}: {
  tk: Tokens;
  customer: Customer;
  onClose: () => void;
  onEdit?: (c: Customer) => void;
}) {
  const [tab, setTab] = useState<"resumen" | "pnl" | "transacciones" | "devoluciones">("resumen");

  const pnl = useMemo(() => demoPnL(customer), [customer]);
  const txs = useMemo(() => demoTransactions(customer), [customer]);
  const returns = useMemo(() => demoReturns(customer), [customer]);
  const seg = segmentOf(customer);
  const segMeta = SEGMENT_META[seg];
  const SegIcon = segMeta.icon;

  const marginPct = pnl.net_sales > 0 ? (pnl.gross_margin / pnl.net_sales) * 100 : 0;
  const contribPct = pnl.net_sales > 0 ? (pnl.net_contribution / pnl.net_sales) * 100 : 0;
  const returnRate = pnl.gross_sales > 0 ? (pnl.returns / pnl.gross_sales) * 100 : 0;

  const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer",
    fontWeight: active ? 700 : 500, fontSize: 13,
    background: active ? tk.panel : "transparent",
    color: active ? tk.accent : tk.textLo,
    borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
  });

  // Cascada P&L: cada línea con etiqueta, valor, si es resta, si es subtotal
  const pnlRows: { label: string; value: number; icon: typeof Receipt; neg?: boolean; subtotal?: boolean; strong?: boolean; pct?: number }[] = [
    { label: "Venta bruta", value: pnl.gross_sales, icon: ShoppingBag, strong: true },
    { label: "Devoluciones (SR&A)", value: pnl.returns, icon: RotateCcw, neg: true, pct: returnRate },
    { label: "Bonificaciones", value: pnl.allowances, icon: Percent, neg: true },
    { label: "Descuentos", value: pnl.discounts, icon: Percent, neg: true },
    { label: "Venta neta", value: pnl.net_sales, icon: TrendingUp, subtotal: true, strong: true },
    { label: "Costo de mercancía (COGS)", value: pnl.cogs, icon: Package, neg: true },
    { label: "Margen bruto", value: pnl.gross_margin, icon: Wallet, subtotal: true, strong: true, pct: marginPct },
    { label: "Comisiones", value: pnl.commissions, icon: Receipt, neg: true },
    { label: "Costos de envío", value: pnl.shipping_costs, icon: Truck, neg: true },
    { label: "Gastos de marketing", value: pnl.marketing, icon: Megaphone, neg: true },
    { label: "Retenciones de impuestos", value: pnl.withholdings, icon: Landmark, neg: true },
    { label: "Contribución neta del cliente", value: pnl.net_contribution, icon: TrendingUp, subtotal: true, strong: true, pct: contribPct },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.7)", zIndex: 70, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "100%", height: "100vh", background: tk.base, borderLeft: `1px solid ${tk.border}`, overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "22px 24px", borderBottom: `1px solid ${tk.border}`, background: tk.panel, position: "sticky", top: 0, zIndex: 5 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: segMeta.color + "22", color: segMeta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
                {customer.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{customer.name}</div>
                <div style={{ fontSize: 13, color: tk.textLo, marginTop: 2 }}>
                  {customer.client_number || "—"}{customer.rfc ? ` · ${customer.rfc}` : ""}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <Badge tk={tk} bg={segMeta.color + "22"} color={segMeta.color} border={segMeta.color + "55"}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><SegIcon size={11} />{segMeta.label}</span>
                  </Badge>
                  <Badge tk={tk} bg={(customer.is_active ? tk.good : tk.bad) + "22"} color={customer.is_active ? tk.good : tk.bad} border={(customer.is_active ? tk.good : tk.bad) + "55"}>
                    {customer.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                  {customer.sucursal && <Badge tk={tk} bg={tk.panel3} color={tk.textMid} border={tk.border}>{customer.sucursal}</Badge>}
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo, padding: 4 }}><X size={22} /></button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginTop: 18, marginBottom: -22, overflowX: "auto" }}>
            {([
              { id: "resumen", label: "Resumen", icon: TrendingUp },
              { id: "pnl", label: "Estado de resultados", icon: Receipt },
              { id: "transacciones", label: "Transacciones", icon: FileText },
              { id: "devoluciones", label: "Devoluciones", icon: RotateCcw },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} style={tabBtn(tab === id)}>
                <Icon size={14} />{label}
                {id === "devoluciones" && returns.length > 0 && (
                  <span style={{ background: tk.bad, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99 }}>{returns.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ── TAB: Resumen ── */}
          {tab === "resumen" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {[
                  { label: "Venta bruta", value: money(pnl.gross_sales), icon: ShoppingBag, color: tk.accent, sub: "acumulado" },
                  { label: "Venta neta", value: money(pnl.net_sales), icon: TrendingUp, color: tk.good, sub: `${((pnl.net_sales / pnl.gross_sales) * 100).toFixed(0)}% de la bruta` },
                  { label: "Margen bruto", value: `${marginPct.toFixed(1)}%`, icon: Wallet, color: tk.warn, sub: money(pnl.gross_margin) },
                  { label: "Devoluciones", value: `${returnRate.toFixed(1)}%`, icon: RotateCcw, color: tk.bad, sub: money(pnl.returns) },
                  { label: "Contribución neta", value: money(pnl.net_contribution), icon: ArrowUpRight, color: tk.good, sub: `${contribPct.toFixed(1)}% margen` },
                  { label: "Saldo actual", value: money(customer.credit_amount ?? 0), icon: CreditCard, color: tk.warn, sub: `${customer.credit_days ?? 0} días crédito` },
                ].map((k) => {
                  const Icon = k.icon;
                  return (
                    <div key={k.label} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ background: k.color + "22", color: k.color, borderRadius: 8, padding: 6, display: "flex" }}><Icon size={15} /></div>
                        <span style={{ fontSize: 11.5, color: tk.textLo }}>{k.label}</span>
                      </div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{k.value}</div>
                      <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2 }}>{k.sub}</div>
                    </div>
                  );
                })}
              </div>

              {/* Mini cascada visual */}
              <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: tk.textHi, marginBottom: 14 }}>De venta bruta a contribución neta</div>
                {[
                  { label: "Venta bruta", value: pnl.gross_sales, color: tk.accent },
                  { label: "Venta neta", value: pnl.net_sales, color: tk.good },
                  { label: "Margen bruto", value: pnl.gross_margin, color: tk.warn },
                  { label: "Contribución neta", value: pnl.net_contribution, color: "#A78BFA" },
                ].map((b) => {
                  const pct = (b.value / pnl.gross_sales) * 100;
                  return (
                    <div key={b.label} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 12.5, color: tk.textMid }}>{b.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>{money(b.value)} <span style={{ color: tk.textLo, fontWeight: 400, fontSize: 11 }}>({pct.toFixed(0)}%)</span></span>
                      </div>
                      <div style={{ height: 8, background: tk.panel3, borderRadius: 99 }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: b.color, opacity: 0.85 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: tk.textLo, background: tk.panel2, padding: "10px 14px", borderRadius: 8 }}>
                <Info size={15} /> Datos demostrativos. Al conectar el backend, este expediente mostrará los movimientos reales del cliente.
              </div>
            </>
          )}

          {/* ── TAB: P&L (cascada completa) ── */}
          {tab === "pnl" && (
            <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 22 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: tk.textHi, marginBottom: 4 }}>Estado de resultados del cliente</div>
              <div style={{ fontSize: 12.5, color: tk.textLo, marginBottom: 18 }}>Cascada completa de venta bruta a contribución neta</div>
              {pnlRows.map((row, i) => {
                const Icon = row.icon;
                const color = row.subtotal ? (row.value >= 0 ? tk.good : tk.bad) : row.neg ? tk.bad : tk.textHi;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: row.subtotal ? "12px 0" : "8px 0",
                    borderTop: row.subtotal ? `1px solid ${tk.border}` : "none",
                    marginTop: row.subtotal ? 4 : 0,
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ background: (row.subtotal ? color : tk.textLo) + "18", color: row.subtotal ? color : tk.textLo, borderRadius: 7, padding: 6, display: "flex" }}><Icon size={14} /></span>
                      <span style={{ fontSize: row.strong ? 14 : 13, fontWeight: row.strong ? 700 : 500, color: row.subtotal ? tk.textHi : tk.textMid }}>{row.label}</span>
                      {row.pct !== undefined && (
                        <span style={{ fontSize: 11, color: tk.textLo, background: tk.panel3, padding: "1px 7px", borderRadius: 20 }}>{row.pct.toFixed(1)}%</span>
                      )}
                    </span>
                    <span style={{ fontSize: row.strong ? 15 : 13.5, fontWeight: row.strong ? 800 : 600, color, fontVariantNumeric: "tabular-nums" }}>
                      {row.neg ? "− " : ""}{money(row.value)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── TAB: Transacciones ── */}
          {tab === "transacciones" && (
            <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr style={{ background: tk.panel2 }}>
                      {["Tipo", "Folio", "Fecha", "Estado", "Monto"].map((h, i) => (
                        <th key={i} style={{ padding: "11px 16px", textAlign: i === 4 ? "right" : "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map((tx, i) => {
                      const m = TX_META[tx.type];
                      const Icon = m.icon;
                      return (
                        <tr key={tx.id} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: m.color }}>
                              <Icon size={14} />{m.label}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: tk.accent, fontWeight: 600, fontFamily: "monospace" }}>{tx.ref}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, color: tk.textMid }}>{fmtDate(tx.date)}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, color: tk.textLo }}>{tx.status}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 700, textAlign: "right", color: tx.type === "devolucion" || tx.type === "nota_credito" ? tk.bad : tk.textHi, fontVariantNumeric: "tabular-nums" }}>
                            {tx.type === "devolucion" || tx.type === "nota_credito" ? "− " : ""}{money(tx.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TAB: Devoluciones ── */}
          {tab === "devoluciones" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: tk.textLo, marginBottom: 6 }}>Total devuelto</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: tk.bad }}>{money(pnl.returns)}</div>
                </div>
                <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: tk.textLo, marginBottom: 6 }}>Tasa de devolución</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: returnRate > 5 ? tk.bad : tk.warn }}>{returnRate.toFixed(1)}%</div>
                </div>
                <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11.5, color: tk.textLo, marginBottom: 6 }}>No. devoluciones</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{returns.length}</div>
                </div>
              </div>

              <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 580 }}>
                    <thead>
                      <tr style={{ background: tk.panel2 }}>
                        {["Folio", "Fecha", "Producto", "Cant.", "Motivo", "Monto"].map((h, i) => (
                          <th key={i} style={{ padding: "11px 16px", textAlign: i === 3 || i === 5 ? "right" : "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {returns.map((r, i) => (
                        <tr key={r.id} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: tk.accent, fontWeight: 600, fontFamily: "monospace" }}>{r.ref}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, color: tk.textMid }}>{fmtDate(r.date)}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textHi }}>{r.product}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid, textAlign: "right" }}>{r.qty}</td>
                          <td style={{ padding: "12px 16px", fontSize: 12.5, color: tk.textLo }}>{r.reason}</td>
                          <td style={{ padding: "12px 16px", fontSize: 13.5, fontWeight: 700, textAlign: "right", color: tk.bad, fontVariantNumeric: "tabular-nums" }}>− {money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: "auto", padding: "16px 24px", borderTop: `1px solid ${tk.border}`, background: tk.panel, display: "flex", gap: 10, justifyContent: "flex-end", position: "sticky", bottom: 0 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cerrar</button>
          {onEdit && (
            <button onClick={() => onEdit(customer)} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: tk.accent, color: "#06122B", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Editar cliente</button>
          )}
        </div>
      </div>
    </div>
  );
}
