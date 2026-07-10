// Customer360.tsx — Vista 360° del cliente (Customer 360)
// Estado de resultados por cliente (P&L), devoluciones, transacciones y segmentación.
// Selector de periodo (Semana/Mes/Trimestre/Año) con comparativo vs periodo anterior.
// Respeta el patrón modular del proyecto: usa Tokens, componentes de ../sales/ui y money().
// Datos demo realistas (derivados del cliente + periodo) hasta conectar el backend real.

import { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X, TrendingUp, RotateCcw, Receipt, Truck, Percent, Landmark,
  ArrowUpRight, ArrowDownRight, ShoppingBag, Package, CreditCard,
  FileText, Wallet, Store, Globe, Building2, Star, Users, Info,
  Paperclip, Upload, Trash2, MessageCircle,
} from "lucide-react";
import type { Tokens } from "../sales/theme";
import { money } from "../sales/theme";
import { Badge, Select, Button } from "../sales/ui";
import type { Customer, CustomerDocument } from "./types";
import { customersApi } from "./api";
import { openWhatsApp } from "../../utils/whatsapp";
import { salesApi } from "../sales/api";
import type { CustomerPnLBreakdown, CustomerTransaction, CustomerReturnLine } from "../sales/types";

const DOC_TYPES = ["INE/Identificación", "Constancia de situación fiscal", "Comprobante de domicilio", "Contrato", "Otro"];

// El `detail` de un 422 de FastAPI suele ser un arreglo de errores de
// validación ([{loc, msg, type}, ...]), no un string: hay que extraer el
// texto útil de cada uno en vez de interpolarlo directo (da "[object Object]").
function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === "object" && "msg" in d) {
          const rawLoc = (d as { loc?: unknown[] }).loc;
          const loc = Array.isArray(rawLoc) ? rawLoc.filter((x) => x !== "body" && x !== "query").join(".") : "";
          const msg = (d as { msg: string }).msg;
          return loc ? `${loc}: ${msg}` : msg;
        }
        return JSON.stringify(d);
      })
      .join("; ");
  }
  if (typeof detail === "object") {
    try { return JSON.stringify(detail); } catch { return String(detail); }
  }
  return String(detail);
}

// Convierte el error de axios en un mensaje útil: sin esto, un bloqueo CORS o
// un 500 del servidor se ven idénticos en la UI ("no se pudo subir"), lo que
// hace imposible diagnosticar el problema sin abrir la consola del navegador.
function describeUploadError(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; request?: unknown; message?: string };
  if (e?.response) {
    const detail = formatDetail(e.response.data?.detail);
    return `Servidor respondió ${e.response.status}${detail ? `: ${detail}` : "."}`;
  }
  if (e?.request) {
    return "El servidor no respondió (sin conexión, CORS o backend caído/dormido en Render). Verifica el despliegue del backend.";
  }
  return e?.message || "Error desconocido.";
}

type Period = "week" | "month" | "quarter" | "year";

const PERIOD_LABELS: Record<Period, string> = { week: "Semana", month: "Mes", quarter: "Trimestre", year: "Año" };
const PERIOD_PREV_LABELS: Record<Period, string> = { week: "semana anterior", month: "mes anterior", quarter: "trimestre anterior", year: "año anterior" };

// ── Tipos del P&L por cliente (datos reales del backend) ────────────────────
type CustomerPnL = CustomerPnLBreakdown;
type Transaction = CustomerTransaction;
type ReturnItem = CustomerReturnLine;

const EMPTY_PNL: CustomerPnL = {
  gross_sales: 0, returns: 0, allowances: 0, discounts: 0, net_sales: 0, cogs: 0,
  gross_margin: 0, shipping_costs: 0, withholdings: 0, net_contribution: 0, orders_count: 0,
};

// Rango de fechas [start, end) para cada periodo, anclado a "ahora".
function periodRange(period: Period): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  if (period === "week") start.setDate(start.getDate() - 7);
  else if (period === "month") start.setMonth(start.getMonth() - 1);
  else if (period === "quarter") start.setMonth(start.getMonth() - 3);
  else start.setFullYear(start.getFullYear() - 1);
  return { start, end };
}

// ── Segmento / tipo de cliente ──────────────────────────────────────────────
const SEGMENT_META: Record<string, { label: string; icon: typeof Store; color: string }> = {
  individual: { label: "Individual", icon: Users, color: "#60A5FA" },
  fisica: { label: "Tienda física", icon: Store, color: "#34D399" },
  marketplace: { label: "Marketplace", icon: Globe, color: "#A78BFA" },
  propia: { label: "Tienda propia", icon: Building2, color: "#33B2F5" },
  especial: { label: "Venta especial", icon: Star, color: "#FBBF24" },
};
function segmentOf(c: Customer): keyof typeof SEGMENT_META {
  const t = (c.client_type || "").toLowerCase();
  if (t.includes("market") || t.includes("amazon") || t.includes("mercado")) return "marketplace";
  if (t.includes("propia") || t.includes("interna")) return "propia";
  if (t.includes("especial") || t.includes("vip")) return "especial";
  if (t.includes("tienda") || t.includes("física") || t.includes("fisica") || t.includes("sucursal") || t.includes("distribuidor")) return "fisica";
  return "individual";
}

const TX_META: Record<Transaction["type"], { label: string; color: string; icon: typeof Receipt }> = {
  venta: { label: "Venta", color: "#34D399", icon: ShoppingBag },
  devolucion: { label: "Devolución", color: "#F87171", icon: RotateCcw },
  nota_credito: { label: "Nota de crédito", color: "#FBBF24", icon: FileText },
  pago: { label: "Pago", color: "#33B2F5", icon: CreditCard },
};

// delta % entre actual y anterior
const pctDelta = (cur: number, prev: number) => prev === 0 ? 0 : Math.round(((cur - prev) / prev) * 1000) / 10;

// ── Componente principal ────────────────────────────────────────────────────
export default function Customer360({
  tk, customer, onClose, onEdit,
}: {
  tk: Tokens; customer: Customer; onClose: () => void; onEdit?: (c: Customer) => void;
}) {
  const [tab, setTab] = useState<"resumen" | "pnl" | "transacciones" | "devoluciones" | "documentos">("resumen");
  const mktInputRef = useRef<HTMLInputElement>(null);
  const [mktUploading, setMktUploading] = useState(false);
  const handleMarketplaceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const platform = customer.marketplace_platform || "liverpool";
    if (!confirm(
      `Se importará el reporte "${file.name}" para el cliente ${customer.name}.\n\n`
      + `Plataforma: ${platform}\n\n`
      + `El sistema creará las órdenes automáticamente y detectará devoluciones. ¿Continuar?`
    )) {
      if (mktInputRef.current) mktInputRef.current.value = "";
      return;
    }
    setMktUploading(true);
    try {
      const result = await salesApi.importMarketplaceReport(customer.id, platform, file);
      alert(
        `Importación completada:\n\n`
        + `• Filas leídas: ${result.rows_read}\n`
        + `• Órdenes creadas: ${result.orders_created}\n`
        + `• Órdenes actualizadas: ${result.orders_updated}\n`
        + `• Devoluciones registradas: ${result.returns_created}\n`
        + `• Errores: ${result.errors_count}`
      );
    } catch (err: any) {
      alert(err?.response?.data?.detail || err?.message || "Error al importar el reporte");
    } finally {
      setMktUploading(false);
      if (mktInputRef.current) mktInputRef.current.value = "";
    }
  };
  const [period, setPeriod] = useState<Period>("quarter");

  const [docs, setDocs] = useState<CustomerDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [newDocType, setNewDocType] = useState(DOC_TYPES[0]);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [docBusy, setDocBusy] = useState(false);

  const loadDocs = () => {
    setDocsLoading(true);
    customersApi.listDocuments(customer.id).then(setDocs).catch(() => setDocs([])).finally(() => setDocsLoading(false));
  };

  useEffect(() => { loadDocs(); }, [customer.id]);

  const addDocument = async () => {
    if (!newDocFile) return;
    setDocBusy(true);
    try {
      const doc = await customersApi.uploadDocument(customer.id, newDocType, newDocFile);
      setDocs((p) => [...p, doc]);
      setNewDocFile(null);
    } catch (err) { alert(`No se pudo subir el documento.\n${describeUploadError(err)}`); }
    finally { setDocBusy(false); }
  };

  const removeDocument = async (docId: number) => {
    if (!window.confirm("¿Eliminar este documento?")) return;
    try {
      await customersApi.deleteDocument(customer.id, docId);
      setDocs((p) => p.filter((x) => x.id !== docId));
    } catch (err) { alert(`No se pudo eliminar el documento.\n${describeUploadError(err)}`); }
  };

  const [pnl, setPnl] = useState<CustomerPnL>(EMPTY_PNL);
  const [pnlPrev, setPnlPrev] = useState<CustomerPnL>(EMPTY_PNL);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string | null>(null);

  useEffect(() => {
    const { start, end } = periodRange(period);
    setPnlLoading(true);
    setPnlError(null);
    salesApi.customerPnl(customer.id, start.toISOString(), end.toISOString())
      .then((r) => {
        setPnl(r.current);
        setPnlPrev(r.previous);
        setTxs(r.transactions);
        setReturns(r.returns);
      })
      .catch((err) => {
        setPnl(EMPTY_PNL); setPnlPrev(EMPTY_PNL); setTxs([]); setReturns([]);
        setPnlError(describeUploadError(err));
      })
      .finally(() => setPnlLoading(false));
  }, [customer.id, period]);

  const seg = segmentOf(customer);
  const segMeta = SEGMENT_META[seg];
  const SegIcon = segMeta.icon;

  const marginPct = pnl.net_sales > 0 ? (pnl.gross_margin / pnl.net_sales) * 100 : 0;
  const contribPct = pnl.net_sales > 0 ? (pnl.net_contribution / pnl.net_sales) * 100 : 0;
  const returnRate = pnl.gross_sales > 0 ? (pnl.returns / pnl.gross_sales) * 100 : 0;

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer",
    fontWeight: active ? 700 : 500, fontSize: 13,
    background: active ? tk.panel : "transparent",
    color: active ? tk.accent : tk.textLo,
    borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
  });

  // Pequeño indicador de variación vs periodo anterior
  const DeltaTag = ({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) => {
    const d = pctDelta(cur, prev);
    const good = invert ? d <= 0 : d >= 0;
    const color = d === 0 ? tk.textLo : good ? tk.good : tk.bad;
    const Arrow = d >= 0 ? ArrowUpRight : ArrowDownRight;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 700, color }}>
        <Arrow size={11} />{Math.abs(d)}%
      </span>
    );
  };

  const pnlRows: { label: string; value: number; prev: number; icon: typeof Receipt; neg?: boolean; subtotal?: boolean; strong?: boolean; pct?: number; invert?: boolean }[] = [
    { label: "Venta bruta", value: pnl.gross_sales, prev: pnlPrev.gross_sales, icon: ShoppingBag, strong: true },
    { label: "Devoluciones (SR&A)", value: pnl.returns, prev: pnlPrev.returns, icon: RotateCcw, neg: true, pct: returnRate, invert: true },
    { label: "Bonificaciones", value: pnl.allowances, prev: pnlPrev.allowances, icon: Percent, neg: true, invert: true },
    { label: "Descuentos", value: pnl.discounts, prev: pnlPrev.discounts, icon: Percent, neg: true, invert: true },
    { label: "Venta neta", value: pnl.net_sales, prev: pnlPrev.net_sales, icon: TrendingUp, subtotal: true, strong: true },
    { label: "Costo de mercancía (COGS)", value: pnl.cogs, prev: pnlPrev.cogs, icon: Package, neg: true, invert: true },
    { label: "Margen bruto", value: pnl.gross_margin, prev: pnlPrev.gross_margin, icon: Wallet, subtotal: true, strong: true, pct: marginPct },
    { label: "Costos de envío", value: pnl.shipping_costs, prev: pnlPrev.shipping_costs, icon: Truck, neg: true, invert: true },
    { label: "Retenciones de impuestos", value: pnl.withholdings, prev: pnlPrev.withholdings, icon: Landmark, neg: true, invert: true },
    { label: "Contribución neta del cliente", value: pnl.net_contribution, prev: pnlPrev.net_contribution, icon: TrendingUp, subtotal: true, strong: true, pct: contribPct },
  ];

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.7)", zIndex: 70, display: "flex", justifyContent: "flex-end", overflow: "hidden" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 680, maxWidth: "100vw", minWidth: 0, boxSizing: "border-box", height: "100%", background: tk.base, borderLeft: `1px solid ${tk.border}`, overflowX: "hidden", overflowY: "auto", display: "flex", flexDirection: "column" }}>

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
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {customer.phone && (
                <button
                  onClick={() => openWhatsApp(customer.phone!, `Hola ${customer.name}, te contactamos de parte de Sthenova.`)}
                  title="Enviar WhatsApp"
                  style={{ background: "#25D36622", border: `1px solid #25D36655`, borderRadius: 8, cursor: "pointer", color: "#25D366", padding: 6, display: "flex" }}
                >
                  <MessageCircle size={18} />
                </button>
              )}
              <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo, padding: 4 }}><X size={22} /></button>
            </div>
          </div>

          {/* Selector de periodo */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 9, padding: 3 }}>
              {(["week", "month", "quarter", "year"] as Period[]).map((p) => {
                const on = period === p;
                return (
                  <button key={p} onClick={() => setPeriod(p)} style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 14px", borderRadius: 7, background: on ? tk.accent : "transparent", color: on ? "#06122B" : tk.textMid }}>
                    {PERIOD_LABELS[p]}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 11.5, color: tk.textLo }}>comparado vs {PERIOD_PREV_LABELS[period]}</span>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginTop: 16, marginBottom: -22, overflowX: "auto" }}>
            {([
              { id: "resumen", label: "Resumen", icon: TrendingUp },
              { id: "pnl", label: "Estado de resultados", icon: Receipt },
              { id: "transacciones", label: "Transacciones", icon: FileText },
              { id: "devoluciones", label: "Devoluciones", icon: RotateCcw },
              { id: "documentos", label: "Documentos", icon: Paperclip },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} style={tabBtn(tab === id)}>
                <Icon size={14} />{label}
                {id === "devoluciones" && returns.length > 0 && (
                  <span style={{ background: tk.bad, color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99 }}>{returns.length}</span>
                )}
                {id === "documentos" && docs.length > 0 && (
                  <span style={{ background: tk.accent, color: "#06122B", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99 }}>{docs.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>

          {pnlLoading && tab !== "documentos" && (
            <div style={{ fontSize: 12.5, color: tk.textLo }}>Cargando datos del periodo…</div>
          )}
          {pnlError && tab !== "documentos" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: tk.bad + "18", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
              {pnlError}
            </div>
          )}

          {/* ── TAB: Resumen ── */}
          {tab === "resumen" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                {[
                  { label: "Venta bruta", value: money(pnl.gross_sales), icon: ShoppingBag, color: tk.accent, cur: pnl.gross_sales, prev: pnlPrev.gross_sales },
                  { label: "Venta neta", value: money(pnl.net_sales), icon: TrendingUp, color: tk.good, cur: pnl.net_sales, prev: pnlPrev.net_sales },
                  { label: "Margen bruto", value: `${marginPct.toFixed(1)}%`, icon: Wallet, color: tk.warn, cur: pnl.gross_margin, prev: pnlPrev.gross_margin },
                  { label: "Devoluciones", value: `${returnRate.toFixed(1)}%`, icon: RotateCcw, color: tk.bad, cur: pnl.returns, prev: pnlPrev.returns, invert: true },
                  { label: "Contribución neta", value: money(pnl.net_contribution), icon: ArrowUpRight, color: tk.good, cur: pnl.net_contribution, prev: pnlPrev.net_contribution },
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
                      <div style={{ fontSize: 11, color: tk.textLo, marginTop: 3 }}>
                        {k.sub ? k.sub : <DeltaTag cur={k.cur!} prev={k.prev!} invert={k.invert} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Mini cascada visual */}
              <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: tk.textHi, marginBottom: 14 }}>De venta bruta a contribución neta · {PERIOD_LABELS[period]}</div>
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
                <Info size={15} /> Datos demostrativos del {PERIOD_LABELS[period].toLowerCase()}. Al conectar el backend, mostrará los movimientos reales del cliente en cada periodo.
              </div>
            </>
          )}

          {/* ── TAB: P&L (cascada completa) ── */}
          {tab === "pnl" && (
            <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 22 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: tk.textHi, marginBottom: 4 }}>Estado de resultados · {PERIOD_LABELS[period]}</div>
              <div style={{ fontSize: 12.5, color: tk.textLo, marginBottom: 18 }}>Cascada de venta bruta a contribución neta, con variación vs {PERIOD_PREV_LABELS[period]}</div>
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
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <DeltaTag cur={row.value} prev={row.prev} invert={row.invert} />
                      <span style={{ fontSize: row.strong ? 15 : 13.5, fontWeight: row.strong ? 800 : 600, color, fontVariantNumeric: "tabular-nums", minWidth: 96, textAlign: "right" }}>
                        {row.neg ? "− " : ""}{money(row.value)}
                      </span>
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
                  <div style={{ marginTop: 4 }}><DeltaTag cur={pnl.returns} prev={pnlPrev.returns} invert /></div>
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

          {/* ── TAB: Documentos ── */}
          {tab === "documentos" && (
            <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: tk.textHi }}>Documentos del cliente</div>

              {docsLoading ? (
                <div style={{ fontSize: 13, color: tk.textLo }}>Cargando…</div>
              ) : docs.length === 0 ? (
                <div style={{ fontSize: 13, color: tk.textLo }}>Este cliente no tiene documentos cargados.</div>
              ) : docs.map((doc) => (
                <div key={doc.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 8, padding: "10px 14px", minWidth: 0 }}>
                  <FileText size={16} style={{ color: tk.accent, flexShrink: 0 }} />
                  <a href={doc.file_path} target="_blank" rel="noreferrer" title={doc.file_name}
                    style={{ color: tk.textHi, fontSize: 13.5, fontWeight: 600, textDecoration: "none", flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {doc.file_name}
                  </a>
                  <span style={{ fontSize: 11.5, color: tk.textLo, whiteSpace: "nowrap" }}>{doc.document_type}</span>
                  <Badge tk={tk} bg={tk.accent + "22"} color={tk.accent} border={tk.accent + "55"}>{doc.status}</Badge>
                  <button onClick={() => removeDocument(doc.id)} title="Eliminar"
                    style={{ background: "transparent", border: `1px solid ${tk.border}`, borderRadius: 8, padding: 7, cursor: "pointer", color: tk.bad, display: "flex", flexShrink: 0 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8, paddingTop: 14, borderTop: `1px solid ${tk.border}` }}>
                <div style={{ minWidth: 0, flex: "1 1 180px" }}>
                  <Select tk={tk} value={newDocType} onChange={setNewDocType} options={DOC_TYPES.map((v) => ({ value: v, label: v }))} />
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px dashed ${tk.border}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", color: tk.textHi, fontSize: 13, minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
                  <Upload size={14} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{newDocFile ? newDocFile.name : "Elegir archivo…"}</span>
                  <input type="file" style={{ display: "none" }} onChange={(e) => setNewDocFile(e.target.files?.[0] || null)} />
                </label>
                <Button tk={tk} variant="ghost" onClick={addDocument} disabled={!newDocFile || docBusy}>
                  {docBusy ? "Subiendo…" : "Agregar"}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: "auto", padding: "16px 24px", borderTop: `1px solid ${tk.border}`, background: tk.panel, display: "flex", gap: 10, justifyContent: "flex-end", position: "sticky", bottom: 0 }}>
          <input ref={mktInputRef} type="file" accept=".xlsx,.xls,.csv"
                 style={{ display: "none" }}
                 onChange={handleMarketplaceUpload} />
          {(customer.relationship_type === "marketplace" || customer.relationship_type === "chain_physical") && (
            <button
              disabled={mktUploading}
              onClick={() => mktInputRef.current?.click()}
              style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${tk.accent}66`, background: tk.accent + "18", color: tk.accent, cursor: mktUploading ? "wait" : "pointer", fontSize: 13, fontWeight: 700, opacity: mktUploading ? 0.6 : 1 }}>
              {mktUploading ? "Procesando…" : `Importar reporte ${customer.marketplace_platform || "marketplace"}`}
            </button>
          )}
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cerrar</button>
          {onEdit && (
            <button onClick={() => onEdit(customer)} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: tk.accent, color: "#06122B", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Editar cliente</button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
