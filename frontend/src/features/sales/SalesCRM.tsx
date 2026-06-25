// High-end Sales / CRM module — orchestrator.
// Ingesta uses /ingesta/preview to read file headers server-side (pandas),
// so xlsx/xls/csv all work correctly without client-side parsing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, List, Columns, BarChart3, Plus, Download, DollarSign, Clock,
  TrendingUp, Percent, ChevronRight, ArrowUp, ArrowDown, FileText, Info,
  Upload, Zap, Settings2, CheckCircle, AlertTriangle, FileSpreadsheet, Check, Trash2, ChevronLeft, Pencil,
} from "lucide-react";
import api from "../../services/api";
import IngestaConfigurador from "./IngestaConfigurador";
import { resolveTheme, makeTr, money, dateShort, statusColors, statusMeta, paymentLabel, ORDER_PIPELINE, PAYMENT_METHODS } from "./theme";
import type { Tokens } from "./theme";
import type { Order, OrderDraft, OrderFilters, SalesStats, TrendPoint, TopCustomer, TopProduct, CustomerLite } from "./types";
import { salesApi } from "./api";
import type { VariantOption } from "./api";
import { Spinner, Badge, Button, EmptyState, Spinkeyframes } from "./ui";
import { OrderForm } from "./OrderForm";
import { PaymentModal } from "./PaymentModal";
import { OrderDrawer } from "./OrderDrawer";
import { Analytics } from "./Analytics";
import { DEMO_ORDERS, DEMO_CUSTOMERS, DEMO_VARIANTS } from "./demo";

type ViewMode = "list" | "pipeline" | "analytics" | "ingesta";
const PAGE = 20;

// ── Ingesta API ──────────────────────────────────────────────────────────────
const ingestaApi = {
  fuentes: () => api.get("/ingesta/fuentes").then((r) => r.data),
  borrarFuente: (id: number) => api.delete(`/ingesta/fuentes/${id}`),
  preview: (formData: FormData) =>
    api.post("/ingesta/preview", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data),
  detectar: (payload: unknown) =>
    api.post("/ingesta/detectar", payload).then((r) => r.data),
  crearFuente: (data: unknown) =>
    api.post("/ingesta/fuentes", data).then((r) => r.data),
  upload: (fuenteId: number, formData: FormData) =>
    api.post(`/ingesta/fuentes/${fuenteId}/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data),
  generarVentas: (loteId: number) =>
    api.post(`/ingesta/lotes/${loteId}/generar-ventas`).then((r) => r.data),
  lotes: (fuenteId: number) =>
    api.get(`/ingesta/fuentes/${fuenteId}/lotes`).then((r) => r.data),
};

interface LoteHistorial {
  id: number;
  nombre_archivo: string | null;
  tipo: string;
  estado: string;
  total_filas: number;
  filas_ok: number;
  filas_error: number;
  created_at: string;
}

// ── Campos internos estándar ─────────────────────────────────────────────────
const CAMPOS_STHENOVA = [
  { value: "skip",                  label: "— Ignorar columna —" },
  { value: "upc",                   label: "UPC / código de barras" },
  { value: "sku_cliente",           label: "SKU del cliente" },
  { value: "sku_cadena",            label: "SKU de la cadena" },
  { value: "descripcion",           label: "Descripción del producto" },
  { value: "fecha_inicio",          label: "Fecha inicio periodo" },
  { value: "fecha_fin",             label: "Fecha fin periodo" },
  { value: "fecha_venta",           label: "Fecha de venta" },
  { value: "cantidad_vendida",      label: "Cantidad vendida" },
  { value: "precio_unitario",       label: "Precio unitario" },
  { value: "venta_bruta",           label: "Venta bruta" },
  { value: "venta_neta",            label: "Venta neta" },
  { value: "devoluciones_unidades", label: "Devoluciones (unidades)" },
  { value: "devoluciones_importe",  label: "Devoluciones (importe)" },
  { value: "sra",                   label: "SR&A" },
  { value: "bonificaciones",        label: "Bonificaciones" },
  { value: "descuentos",            label: "Descuentos" },
  { value: "cogs",                  label: "COGS" },
  { value: "comisiones",            label: "Comisiones" },
  { value: "envio",                 label: "Envío" },
  { value: "marketing",             label: "Marketing / trade spend" },
  { value: "inv_inicial",           label: "Inventario inicial" },
  { value: "inv_final",             label: "Inventario final" },
  { value: "entradas_resurtido",    label: "Entradas / resurtido" },
  { value: "id_pedido",             label: "ID de pedido (agrupa filas)" },
  { value: "costo_envio_pedido",    label: "Costo envío del pedido" },
  { value: "estatus_pedido",         label: "Estatus del pedido (enviado, devuelto...)" },
];

// ── Types ────────────────────────────────────────────────────────────────────
type IngestaStep = "inicio" | "leyendo" | "detectando" | "mapeo" | "subiendo" | "resultado";

interface ColumnaDetectada {
  columna_origen: string;
  campo_sthenova_sugerido: string;
  muestra: string | null;
  confianza: number;
  razon: string | null;
}

interface DeteccionResult {
  columnas: ColumnaDetectada[];
  tiene_filas_anidadas: boolean;
  campo_id_pedido_sugerido: string | null;
  confianza_global: number;
  notas: string | null;
  tokens_usados: number;
}

interface PreviewResult {
  encabezados: string[];
  muestra_filas: Record<string, string | null>[];
  total_filas: number;
  nombre_archivo: string;
}

interface FuenteItem {
  id: number;
  nombre: string;
  moneda: string;
}

interface ResultadoLote {
  lote_id: number;
  filas_ok: number;
  filas_error: number;
  total_filas: number;
  estado: string;
  registros_muestra: {
    descripcion: string | null;
    cantidad_vendida: number;
    venta_bruta: number;
    upc: string | null;
  }[];
}

function computeStats(orders: Order[]): SalesStats {
  const real = orders.filter((o) => o.kind === "order" && o.status !== "cancelled");
  const paid = real.filter((o) => o.status === "paid");
  const pending = real.filter((o) => o.status === "pending" || o.status === "partial");
  return {
    total_sold: real.reduce((a, o) => a + o.paid_amount, 0),
    orders_count: real.length,
    pending_orders: pending.length,
    pending_amount: pending.reduce((a, o) => a + (o.total_amount - o.paid_amount), 0),
    paid_rate: real.length ? Math.round((paid.length / real.length) * 1000) / 10 : 0,
    avg_ticket: real.length ? Math.round((real.reduce((a, o) => a + o.total_amount, 0) / real.length) * 100) / 100 : 0,
    quotes_count: orders.filter((o) => o.kind === "quote").length,
  };
}

// ── Módulo de Ingesta ────────────────────────────────────────────────────────
function IngestaModule({ tk, tr }: { tk: Tokens; tr: (k: string, fb: string) => string }) {
  const [modo, setModo] = useState<"lista" | "nueva" | "editar" | "subir" | "historial">("lista");
  const [fuenteEditar, setFuenteEditar] = useState<number | null>(null);
  const [fuenteHistorial, setFuenteHistorial] = useState<{ id: number; nombre: string } | null>(null);
  const [lotes, setLotes] = useState<LoteHistorial[]>([]);
  const [lotesLoading, setLotesLoading] = useState(false);
  const [generandoLote, setGenerandoLote] = useState<number | null>(null);
  const [fuentes, setFuentes] = useState<{ id: number; nombre: string; moneda: string; activa: boolean; customer_id?: number | null; auto_crear_ventas?: boolean }[]>([]);
  const [fuenteSubir, setFuenteSubir] = useState<{ id: number; nombre: string } | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generandoVentas, setGenerandoVentas] = useState(false);
  const [ventasGeneradas, setVentasGeneradas] = useState<{ ordenes_creadas: number } | null>(null);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [asignandoCliente, setAsignandoCliente] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fuenteSubirRef = useRef<{ id: number; nombre: string } | null>(null);

  const cargarFuentes = () => {
    api.get("/ingesta/fuentes").then((r) => setFuentes(r.data)).catch(() => {});
  };

  useEffect(() => { cargarFuentes(); salesApi.customers().then(setCustomers).catch(() => {}); }, []);

  const asignarCliente = async (fuenteId: number, customerId: number | "") => {
    setAsignandoCliente(fuenteId);
    try {
      await api.put(`/ingesta/fuentes/${fuenteId}`, { customer_id: customerId || null });
      cargarFuentes();
    } catch {
      alert("No se pudo asignar el cliente. Intenta de nuevo.");
    } finally {
      setAsignandoCliente(null);
    }
  };

  const borrar = async (id: number, nombre: string) => {
    if (!window.confirm(`¿Eliminar la fuente "${nombre}" y todos sus datos? Esta acción no se puede deshacer.`)) return;
    setBorrando(id);
    try { await api.delete(`/ingesta/fuentes/${id}`); setFuentes((p) => p.filter((f) => f.id !== id)); }
    catch { alert("No se pudo eliminar. Intenta de nuevo."); }
    finally { setBorrando(null); }
  };

  const subirArchivo = async (fuenteId: number, archivo: File) => {
    setSubiendo(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      const res = await api.post(`/ingesta/fuentes/${fuenteId}/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResultado(res.data);
      setModo("lista");
      cargarFuentes();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? "Error al procesar el archivo.");
    } finally { setSubiendo(false); }
  };

  const card: React.CSSProperties = { background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "18px 22px", marginBottom: 14 };

  const verHistorial = async (fuenteId: number, nombre: string) => {
    setFuenteHistorial({ id: fuenteId, nombre });
    setModo("historial");
    setLotesLoading(true);
    try { setLotes(await ingestaApi.lotes(fuenteId)); }
    catch { setLotes([]); }
    finally { setLotesLoading(false); }
  };

  const generarVentasDeLote = async (loteId: number) => {
    setGenerandoLote(loteId);
    try {
      const res = await ingestaApi.generarVentas(loteId);
      alert(`${res.ordenes_creadas} pedido(s) generado(s) en Ventas. ${res.registros_omitidos ? `${res.registros_omitidos} registro(s) ya estaban vinculados.` : ""}`);
      if (fuenteHistorial) await verHistorial(fuenteHistorial.id, fuenteHistorial.nombre);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      alert(err?.response?.data?.detail ?? "No se pudieron generar las ventas de este lote.");
    } finally { setGenerandoLote(null); }
  };

  const generarVentas = async () => {
    if (!resultado) return;
    setGenerandoVentas(true); setError(null);
    try {
      const res = await ingestaApi.generarVentas(resultado.lote_id);
      setVentasGeneradas({ ordenes_creadas: res.ordenes_creadas });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? "No se pudieron generar las ventas.");
    } finally { setGenerandoVentas(false); }
  };

  // ── Vista: resultado de carga ──────────────────────────────────────────────
  if (resultado) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, textAlign: "center" }}>
        <Check size={40} color={tk.good} style={{ margin: "0 auto 12px", display: "block" }} />
        <div style={{ fontSize: 17, fontWeight: 600, color: tk.textHi }}>¡Archivo procesado correctamente!</div>
        <div style={{ fontSize: 13, color: tk.textLo, marginTop: 4 }}>{resultado.filas_ok} registros importados · {resultado.filas_error} errores · estado: {resultado.estado}</div>
      </div>

      {ventasGeneradas ? (
        <div style={{ ...card, textAlign: "center", borderColor: tk.good + "55" }}>
          <CheckCircle size={28} color={tk.good} style={{ margin: "0 auto 10px", display: "block" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>{ventasGeneradas.ordenes_creadas} pedido{ventasGeneradas.ordenes_creadas !== 1 ? "s" : ""} generado{ventasGeneradas.ordenes_creadas !== 1 ? "s" : ""} en Ventas</div>
          <div style={{ fontSize: 12, color: tk.textLo, marginTop: 4 }}>Ya puedes verlos en el listado de pedidos.</div>
        </div>
      ) : (
        <button onClick={generarVentas} disabled={generandoVentas}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px", borderRadius: 9, border: `1px solid ${tk.nova}55`, background: tk.nova + "18", color: tk.nova, fontSize: 14, fontWeight: 600, cursor: generandoVentas ? "default" : "pointer", opacity: generandoVentas ? 0.6 : 1 }}>
          <Zap size={16} /> {generandoVentas ? "Generando pedidos..." : "Generar pedidos de venta a partir de este lote"}
        </button>
      )}

      {resultado.registros_muestra?.length > 0 && (
        <div style={card}>
          <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 10px" }}>Vista previa — primeros registros normalizados</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: tk.panel2 }}>
                {["UPC", "Descripción", "Cantidad", "Venta bruta"].map((h) => <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: tk.textLo, fontWeight: 600, borderBottom: `1px solid ${tk.border}` }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {resultado.registros_muestra.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${tk.border}` }}>
                    <td style={{ padding: "8px 12px", color: tk.textMid }}>{r.upc ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: tk.textHi }}>{r.descripcion ?? "—"}</td>
                    <td style={{ padding: "8px 12px", color: tk.textMid }}>{r.cantidad_vendida}</td>
                    <td style={{ padding: "8px 12px", color: tk.textHi, fontWeight: 600 }}>${r.venta_bruta?.toLocaleString("es-MX") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <button onClick={() => { setResultado(null); setVentasGeneradas(null); }} style={{ padding: "10px", borderRadius: 9, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Volver a Carga de ventas
      </button>
    </div>
  );

  // ── Vista: configurador de fuente (nueva o edición) ───────────────────────
  if (modo === "nueva" || modo === "editar") return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={() => { setModo("lista"); setFuenteEditar(null); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 13, cursor: "pointer" }}>
          <ChevronLeft size={14} /> Volver
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: tk.textHi }}>{modo === "editar" ? "Editar fuente" : "Configurar nueva fuente"}</span>
      </div>
      <IngestaConfigurador
        tk={tk}
        fuenteId={modo === "editar" ? fuenteEditar ?? undefined : undefined}
        onGuardado={(id) => { cargarFuentes(); setModo("lista"); setFuenteEditar(null); }}
        onCancelar={() => { setModo("lista"); setFuenteEditar(null); }}
      />
    </div>
  );

  // ── Vista: historial de lotes de una fuente ───────────────────────────────
  if (modo === "historial" && fuenteHistorial) return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={() => { setModo("lista"); setFuenteHistorial(null); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 13, cursor: "pointer" }}>
          <ChevronLeft size={14} /> Volver
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: tk.textHi }}>Historial de cargas — {fuenteHistorial.nombre}</span>
      </div>

      {lotesLoading ? (
        <div style={{ padding: 24, textAlign: "center", color: tk.textLo, fontSize: 13 }}>Cargando...</div>
      ) : lotes.length === 0 ? (
        <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "32px 24px", textAlign: "center", color: tk.textLo, fontSize: 13 }}>
          Esta fuente todavía no tiene cargas registradas.
        </div>
      ) : (
        lotes.map((l) => (
          <div key={l.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
            <FileSpreadsheet size={18} color={tk.nova} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>{l.nombre_archivo || "(sin nombre)"}</div>
              <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>
                {new Date(l.created_at).toLocaleString("es-MX")} · {l.filas_ok} registros · estado: {l.estado}
              </div>
            </div>
            <button onClick={() => generarVentasDeLote(l.id)} disabled={generandoLote === l.id}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${tk.nova}55`, background: tk.nova + "18", color: tk.nova, fontSize: 13, fontWeight: 600, cursor: generandoLote === l.id ? "default" : "pointer", opacity: generandoLote === l.id ? 0.6 : 1 }}>
              <Zap size={14} /> {generandoLote === l.id ? "Generando..." : "Generar / revisar ventas"}
            </button>
          </div>
        ))
      )}
    </div>
  );

  // ── Vista: lista de fuentes ────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input ref={fileRef} type="file" style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          const objetivo = fuenteSubirRef.current;
          if (fileRef.current) fileRef.current.value = "";
          if (!f) return;
          if (!objetivo) { setError("No se pudo identificar la fuente. Vuelve a pulsar 'Subir reporte'."); return; }
          const ext = f.name.split(".").pop()?.toLowerCase();
          if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
            setError(`Formato no soportado (.${ext ?? "?"}). Usa un archivo .xlsx, .xls o .csv.`);
            return;
          }
          subirArchivo(objetivo.id, f);
        }} />

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.bad + "18", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {subiendo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.nova + "18", border: `1px solid ${tk.nova}44`, color: tk.nova, borderRadius: 10, padding: "12px 14px", fontSize: 13 }}>
          <Upload size={16} /> Procesando archivo... esto puede tomar unos segundos.
        </div>
      )}

      {fuentes.length === 0 ? (
        <div style={{ background: tk.panel, border: `2px dashed ${tk.border}`, borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
          <FileSpreadsheet size={36} color={tk.textLo} style={{ margin: "0 auto 12px", display: "block" }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: tk.textHi, marginBottom: 6 }}>No hay fuentes configuradas</div>
          <div style={{ fontSize: 13, color: tk.textLo, marginBottom: 20 }}>Configura tu primera fuente de datos. Solo lo haces una vez.</div>
          <button onClick={() => setModo("nueva")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 9, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            <Plus size={16} /> Configurar primera fuente
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>{fuentes.length} fuente{fuentes.length !== 1 ? "s" : ""} configurada{fuentes.length !== 1 ? "s" : ""}</span>
            <button onClick={() => setModo("nueva")}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              <Plus size={14} /> Nueva fuente
            </button>
          </div>

          {fuentes.map((f) => (
            <div key={f.id} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <FileSpreadsheet size={20} color={tk.nova} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: tk.textHi, display: "flex", alignItems: "center", gap: 8 }}>
                  {f.nombre}
                  {f.auto_crear_ventas && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6, background: tk.nova + "18", color: tk.nova, fontSize: 11, fontWeight: 600 }}>
                      <Zap size={11} /> Auto
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  {f.moneda} · {f.activa ? "Activa" : "Inactiva"} ·
                  <select
                    value={f.customer_id ?? ""}
                    disabled={asignandoCliente === f.id}
                    onChange={(e) => asignarCliente(f.id, e.target.value ? Number(e.target.value) : "")}
                    style={{ background: tk.panel2, color: tk.textMid, border: `1px solid ${tk.border}`, borderRadius: 6, fontSize: 12, padding: "2px 6px", cursor: asignandoCliente === f.id ? "default" : "pointer" }}>
                    <option value="">Sin asignar (solo BI)</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {asignandoCliente === f.id && "guardando..."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setModo("editar"); setFuenteEditar(f.id); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <Pencil size={14} /> Editar
                </button>
                <button
                  onClick={() => { fuenteSubirRef.current = { id: f.id, nombre: f.nombre }; setFuenteSubir({ id: f.id, nombre: f.nombre }); fileRef.current?.click(); }}
                  disabled={subiendo}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: tk.nova, color: "#06122B", fontSize: 13, fontWeight: 600, cursor: subiendo ? "default" : "pointer", opacity: subiendo ? 0.6 : 1 }}>
                  <Upload size={14} /> Subir reporte
                </button>
                <button
                  onClick={() => verHistorial(f.id, f.nombre)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <FileText size={14} /> Historial
                </button>
                <button
                  onClick={() => borrar(f.id, f.nombre)}
                  disabled={borrando === f.id}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 8, border: `1px solid ${tk.bad}55`, background: tk.bad + "18", color: tk.bad, fontSize: 13, cursor: borrando === f.id ? "default" : "pointer", opacity: borrando === f.id ? 0.6 : 1 }}>
                  <Trash2 size={14} /> {borrando === f.id ? "..." : "Eliminar"}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}


// ── SalesCRM principal ───────────────────────────────────────────────────────
export default function SalesCRM({ t, s, initialQuery }: { t: unknown; s: unknown; initialQuery?: string }) {
  const tk = useMemo<Tokens>(() => resolveTheme(t as Record<string, unknown>), [t]);
  const tr = useMemo(() => makeTr(s), [s]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SalesStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);

  const [ordersLoading, setOrdersLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);

  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState(initialQuery || "");
  useEffect(() => { if (initialQuery) setQ(initialQuery); }, [initialQuery]);
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [payment, setPayment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [payTarget, setPayTarget] = useState<Order | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);

  const filters = useMemo<OrderFilters>(() => ({
    q: q || undefined, kind: (kind || undefined) as OrderFilters["kind"], status: status || undefined,
    payment_method: payment || undefined, date_from: from || undefined, date_to: to || undefined,
    sort_by: sortBy, sort_dir: sortDir, skip: page * PAGE, limit: PAGE,
  }), [q, kind, status, payment, from, to, sortBy, sortDir, page]);

  const applyDemoFilters = useCallback((all: Order[]): Order[] => {
    let r = [...all];
    if (kind) r = r.filter((o) => o.kind === kind);
    if (status) r = r.filter((o) => o.status === status);
    if (payment) r = r.filter((o) => o.payment_method === payment);
    if (q) { const k = q.toLowerCase(); r = r.filter((o) => (o.folio ?? "").toLowerCase().includes(k) || (o.customer?.name ?? "").toLowerCase().includes(k) || o.status.includes(k)); }
    r.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "total_amount") return (a.total_amount - b.total_amount) * dir;
      if (sortBy === "folio") return (a.folio ?? "").localeCompare(b.folio ?? "") * dir;
      if (sortBy === "status") return a.status.localeCompare(b.status) * dir;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });
    return r;
  }, [kind, status, payment, q, sortBy, sortDir]);

  const refreshDemoAnalytics = useCallback((all: Order[]) => {
    setStats(computeStats(all));
    const byDay = new Map<string, { total: number; count: number }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => {
      const k = o.created_at.slice(0, 10);
      const e = byDay.get(k) ?? { total: 0, count: 0 };
      e.total += o.total_amount; e.count += 1; byDay.set(k, e);
    });
    setTrend([...byDay.entries()].sort().map(([period, v]) => ({ period, total: Math.round(v.total), count: v.count })));
    const byCust = new Map<string, { total: number; orders: number; id: number | null }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => {
      const name = o.customer?.name ?? "Sin cliente";
      const e = byCust.get(name) ?? { total: 0, orders: 0, id: o.customer_id };
      e.total += o.total_amount; e.orders += 1; byCust.set(name, e);
    });
    setTopCustomers([...byCust.entries()].map(([name, v]) => ({ customer_id: v.id, name, total: Math.round(v.total), orders: v.orders })).sort((a, b) => b.total - a.total).slice(0, 5));
    const byProd = new Map<string, { qty: number; total: number }>();
    all.filter((o) => o.kind === "order" && o.status !== "cancelled").forEach((o) => o.items.forEach((it) => {
      const e = byProd.get(it.product_name ?? "—") ?? { qty: 0, total: 0 };
      e.qty += it.quantity; e.total += (it.total ?? 0); byProd.set(it.product_name ?? "—", e);
    }));
    setTopProducts([...byProd.entries()].map(([name, v]) => ({ variant_id: null, name, quantity: v.qty, total: Math.round(v.total) })).sort((a, b) => b.total - a.total).slice(0, 5));
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const page1 = await salesApi.list(filters);
      setOrders(page1.items); setTotal(page1.total); setDemo(false);
    } catch {
      setDemo(true); setCustomers(DEMO_CUSTOMERS); setVariants(DEMO_VARIANTS);
      const filtered = applyDemoFilters(DEMO_ORDERS);
      setOrders(filtered.slice(page * PAGE, page * PAGE + PAGE)); setTotal(filtered.length);
      refreshDemoAnalytics(DEMO_ORDERS); setStatsLoading(false); setAnalyticsLoaded(true);
    } finally { setOrdersLoading(false); }
  }, [filters, applyDemoFilters, refreshDemoAnalytics, page]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try { setStats(await salesApi.stats()); } catch { } finally { setStatsLoading(false); }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [tr1, tc, tp] = await Promise.all([salesApi.trend("day", 30), salesApi.topCustomers(5), salesApi.topProducts(5)]);
      setTrend(tr1); setTopCustomers(tc); setTopProducts(tp); setAnalyticsLoaded(true);
    } catch { } finally { setAnalyticsLoading(false); }
  }, []);

  const loadCatalogs = useCallback(async () => {
    salesApi.customers().then(setCustomers).catch(() => {});
    salesApi.variantOptions().then(setVariants).catch(() => {});
  }, []);

  const refreshData = useCallback(async () => {
    await loadOrders(); loadStats(); setAnalyticsLoaded(false);
  }, [loadOrders, loadStats]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { loadStats(); loadCatalogs(); }, [loadStats, loadCatalogs]);
  useEffect(() => { if (view === "analytics" && !demo && !analyticsLoaded) loadAnalytics(); }, [view, demo, analyticsLoaded, loadAnalytics]);
  useEffect(() => { setPage(0); }, [q, kind, status, payment, from, to]);

  const demoStore = useMemo(() => ({ list: [...DEMO_ORDERS] }), []);
  const commitDemo = useCallback(() => {
    const filtered = applyDemoFilters(demoStore.list);
    setOrders(filtered.slice(page * PAGE, page * PAGE + PAGE)); setTotal(filtered.length);
    refreshDemoAnalytics(demoStore.list);
  }, [applyDemoFilters, demoStore, page, refreshDemoAnalytics]);

  const openDetail = useCallback(async (o: Order) => {
    if (demo) { setSelected(o); return; }
    try { setSelected(await salesApi.get(o.id)); } catch { setSelected(o); }
  }, [demo]);

  const handleSubmit = useCallback(async (draft: OrderDraft) => {
    setSaving(true);
    try {
      if (demo) {
        const subtotal = draft.items.reduce((a, it) => a + Math.max(it.unit_price * it.quantity - it.discount_amount, 0), 0);
        const disc = draft.discount_type === "percent" ? subtotal * draft.discount_value / 100 : draft.discount_value;
        const taxable = Math.max(subtotal - disc, 0); const tax = taxable * draft.tax_rate / 100;
        const totalv = Math.round((taxable + tax + draft.shipping_amount) * 100) / 100;
        if (editing) {
          const idx = demoStore.list.findIndex((x) => x.id === editing.id);
          if (idx >= 0) demoStore.list[idx] = { ...editing, subtotal, discount_amount: disc, tax_amount: tax, total_amount: totalv, balance: totalv - editing.paid_amount, notes: draft.notes || null };
        } else {
          const id = Math.max(0, ...demoStore.list.map((x) => x.id)) + 1;
          const folio = `${draft.kind === "quote" ? "COT" : "ORD"}-${String(id).padStart(6, "0")}`;
          demoStore.list.unshift({ id, folio, kind: draft.kind, customer_id: draft.customer_id, user_id: 1, warehouse_id: 1, status: draft.kind === "quote" ? "sent" : "pending", payment_method: draft.payment_method, channel: draft.channel, currency: "MXN", subtotal, discount_type: draft.discount_type, discount_value: draft.discount_value, discount_amount: disc, tax_rate: draft.tax_rate, tax_amount: tax, shipping_amount: draft.shipping_amount, total_amount: totalv, paid_amount: 0, balance: totalv, due_date: null, valid_until: null, notes: draft.notes || null, bill_rfc: draft.bill_rfc || null, bill_name: draft.bill_name || null, bill_use: draft.bill_use || null, bill_regime: draft.bill_regime || null, bill_zip: draft.bill_zip || null, cfdi_uuid: null, cfdi_status: "none", invoiced_at: null, created_at: new Date().toISOString(), updated_at: null, items: draft.items.map((it, i) => ({ id: i, variant_id: it.variant_id, product_name: it.product_name, sku: it.sku, quantity: it.quantity, unit_price: it.unit_price, discount_amount: it.discount_amount, tax_rate: it.tax_rate, subtotal: it.unit_price * it.quantity, total: it.unit_price * it.quantity * (1 + it.tax_rate / 100) })), payments: [], events: [{ id: 1, event_type: "created", from_status: null, to_status: "pending", message: "Creado", created_at: new Date().toISOString() }], customer: draft.customer_id ? (DEMO_CUSTOMERS.find((c) => c.id === draft.customer_id) ?? null) : null, seller: { id: 1, full_name: "Vendedor Demo" } });
        }
        commitDemo();
      } else {
        if (editing) await salesApi.update(editing.id, draft);
        else await salesApi.create(draft);
        await refreshData();
      }
      setFormOpen(false); setEditing(null);
    } finally { setSaving(false); }
  }, [demo, editing, demoStore, commitDemo, refreshData]);

  const handlePay = useCallback(async (amount: number, method: string, reference: string, note: string) => {
    if (!payTarget) return;
    setSaving(true);
    try {
      if (demo) {
        const idx = demoStore.list.findIndex((x) => x.id === payTarget.id);
        if (idx >= 0) { const o = demoStore.list[idx]; const paid = o.paid_amount + amount; demoStore.list[idx] = { ...o, paid_amount: paid, balance: Math.round((o.total_amount - paid) * 100) / 100, status: paid + 0.001 >= o.total_amount ? "paid" : "partial", payments: [...o.payments, { id: o.payments.length + 1, order_id: o.id, amount, method, reference: reference || null, note: note || null, created_at: new Date().toISOString() }] }; }
        commitDemo(); setSelected(null);
      } else { await salesApi.addPayment(payTarget.id, amount, method, reference, note); await refreshData(); setSelected(null); }
      setPayTarget(null);
    } catch (e) { alert(extractErr(e)); } finally { setSaving(false); }
  }, [payTarget, demo, demoStore, commitDemo, refreshData]);

  const changeStatus = useCallback(async (o: Order, newStatus: string) => {
    if (o.status === newStatus) return;
    if (demo) { const idx = demoStore.list.findIndex((x) => x.id === o.id); if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: newStatus as Order["status"] }; commitDemo(); return; }
    try { await salesApi.changeStatus(o.id, newStatus); await refreshData(); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData]);

  const markPaid = useCallback((o: Order) => { setPayTarget(o); }, []);
  const convert = useCallback(async (o: Order) => {
    if (demo) { const idx = demoStore.list.findIndex((x) => x.id === o.id); if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: "converted" }; commitDemo(); setSelected(null); return; }
    try { await salesApi.convert(o.id); await refreshData(); setSelected(null); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData]);

  const cancel = useCallback(async (o: Order) => {
    if (!window.confirm(tr("sales_confirm_cancel", "¿Cancelar este documento?"))) return;
    if (demo) { const idx = demoStore.list.findIndex((x) => x.id === o.id); if (idx >= 0) demoStore.list[idx] = { ...demoStore.list[idx], status: "cancelled", balance: 0 }; commitDemo(); setSelected(null); return; }
    try { await salesApi.cancel(o.id); await refreshData(); setSelected(null); } catch (e) { alert(extractErr(e)); }
  }, [demo, demoStore, commitDemo, refreshData, tr]);

  const invoice = useCallback(async (o: Order) => {
    if (!o.bill_rfc) { alert(tr("sales_need_rfc", "Agrega datos de facturación (RFC) al pedido para generar el CFDI.")); return; }
    if (demo) { alert("CFDI (demo): se generaría el comprobante para timbrar con tu PAC."); return; }
    try {
      const { data } = await api.get(`/sales/${o.id}/invoice`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `cfdi-${o.folio}.json`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { alert(extractErr(e)); }
  }, [demo, tr]);

  const openEdit = useCallback((o: Order) => { setEditing(o); setSelected(null); setFormOpen(true); }, []);
  const openNew = useCallback(() => { setEditing(null); setFormOpen(true); }, []);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportFile = useCallback(async (formato: "csv" | "xlsx") => {
    setExportMenuOpen(false);
    if (demo) { alert("La exportación requiere conexión con el servidor."); return; }
    setExporting(true);
    try {
      const blob = await salesApi.exportFile(filters, formato);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ventas.${formato}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(extractErr(e));
    } finally {
      setExporting(false);
    }
  }, [demo, filters]);

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const kpis = stats ?? computeStats(orders);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const KpiCard = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 170 }}>
      <div style={{ background: color + "22", color, borderRadius: 10, padding: 9, display: "flex" }}>{icon}</div>
      <div><div style={{ fontSize: 12, color: tk.textLo, marginBottom: 2 }}>{label}</div><div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{value}</div></div>
    </div>
  );

  const KpiSkeleton = () => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 170 }}>
      <Skel tk={tk} w={38} h={38} r={10} />
      <div style={{ flex: 1 }}><Skel tk={tk} w="60%" h={10} style={{ marginBottom: 8 }} /><Skel tk={tk} w="42%" h={16} /></div>
    </div>
  );

  const inputBase: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 14, outline: "none" };
  const SortHead = ({ col, label }: { col: string; label: string }) => (
    <th onClick={() => toggleSort(col)} style={{ padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, cursor: "pointer", userSelect: "none", textTransform: "uppercase", letterSpacing: 0.4 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{label}{sortBy === col && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  );
  const thBase: React.CSSProperties = { padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 0" }}>
      <Spinkeyframes />
      <ShimmerKeyframes />

      {demo && view !== "ingesta" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.warn + "18", border: `1px solid ${tk.warn}44`, color: tk.warn, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <Info size={16} /> {tr("sales_demo_mode", "Modo demo: backend no disponible. Mostrando datos de ejemplo; las acciones no se guardan.")}
        </div>
      )}

      {view !== "ingesta" && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {statsLoading && !stats ? (
            Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : (
            <>
              <KpiCard icon={<DollarSign size={20} />} label={tr("sales_kpi_sold", "Total vendido")} value={money(kpis.total_sold)} color={tk.good} />
              <KpiCard icon={<Clock size={20} />} label={tr("sales_kpi_pending_orders", "Pedidos pendientes")} value={String(kpis.pending_orders)} color={tk.warn} />
              <KpiCard icon={<TrendingUp size={20} />} label={tr("sales_kpi_pending_amount", "Por cobrar")} value={money(kpis.pending_amount)} color={tk.accent} />
              <KpiCard icon={<Percent size={20} />} label={tr("sales_kpi_paid_rate", "Tasa pagados")} value={`${kpis.paid_rate}%`} color={tk.good} />
              <KpiCard icon={<FileText size={20} />} label={tr("sales_kpi_avg", "Ticket promedio")} value={money(kpis.avg_ticket)} color={tk.accent} />
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {view !== "ingesta" && (
          <>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: tk.textLo }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("sales_search_placeholder", "Buscar folio, cliente o estado…")} style={{ ...inputBase, width: "100%", paddingLeft: 34, boxSizing: "border-box" }} />
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
              <option value="">{tr("sales_all_docs", "Todos")}</option>
              <option value="order">{tr("sales_kind_order", "Pedidos")}</option>
              <option value="quote">{tr("sales_kind_quote", "Cotizaciones")}</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
              <option value="">{tr("sales_filter_status", "Estado")}</option>
              {["draft", "pending", "partial", "paid", "cancelled"].map((st) => <option key={st} value={st}>{statusMeta(st).label}</option>)}
            </select>
            <select value={payment} onChange={(e) => setPayment(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
              <option value="">{tr("sales_detail_payment", "Pago")}</option>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputBase} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputBase} />
          </>
        )}

        <div style={{ display: "flex", gap: 4 }}>
          {([["list", List, "Lista"], ["pipeline", Columns, "Pipeline"], ["analytics", BarChart3, "Analytics"], ["ingesta", Upload, "Carga de ventas"]] as const).map(([v, Icon, label]) => (
            <button key={v} onClick={() => setView(v)} title={label}
              style={{ ...inputBase, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, background: view === v ? tk.accent : tk.inputBg, color: view === v ? "#06122B" : tk.textMid, borderColor: view === v ? tk.accent : tk.border }}>
              <Icon size={15} /><span style={{ fontSize: 12 }}>{label}</span>
            </button>
          ))}
        </div>

        {view !== "ingesta" && (
          <>
            <div style={{ position: "relative" }}>
              <Button tk={tk} variant="ghost" icon={<Download size={16} />} disabled={exporting} onClick={() => setExportMenuOpen((o) => !o)}>
                {exporting ? "Exportando…" : tr("sales_export", "Export")}
              </Button>
              {exportMenuOpen && (
                <>
                  <div onClick={() => setExportMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", overflow: "hidden", zIndex: 10, minWidth: 160 }}>
                    {([["xlsx", "Excel (.xlsx)"], ["csv", "CSV"]] as const).map(([fmt, label]) => (
                      <button key={fmt} onClick={() => exportFile(fmt)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "transparent", color: tk.textHi, fontSize: 13, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = tk.panel2)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Button tk={tk} variant="primary" icon={<Plus size={16} />} onClick={openNew}>{tr("sales_new", "Nuevo")}</Button>
          </>
        )}
      </div>

      {view === "ingesta" ? (
        <IngestaModule tk={tk} tr={tr} />
      ) : view === "analytics" ? (
        analyticsLoading && !analyticsLoaded ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Spinner tk={tk} size={28} /></div>
        ) : (
          <Analytics tk={tk} tr={tr} trend={trend} topCustomers={topCustomers} topProducts={topProducts} />
        )
      ) : view === "pipeline" ? (
        <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
          {ORDER_PIPELINE.map((col) => {
            const colOrders = orders.filter((o) => o.kind === "order" && o.status === col);
            const sc = statusColors(tk, col);
            return (
              <div key={col} onDragOver={(e) => { e.preventDefault(); setDragCol(col); }} onDrop={() => { if (dragId !== null) { const o = orders.find((x) => x.id === dragId); if (o) changeStatus(o, col); } setDragId(null); setDragCol(null); }}
                style={{ flex: "0 0 270px", background: dragCol === col ? sc.bg : tk.panel, border: `2px solid ${dragCol === col ? sc.border : tk.border}`, borderRadius: 12, padding: 12, minHeight: 320, transition: "border .2s, background .2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: sc.text, fontSize: 14 }}>{statusMeta(col).label}</span>
                  <Badge tk={tk} bg={sc.bg} color={sc.text} border={sc.border}>{ordersLoading ? "…" : colOrders.length}</Badge>
                </div>
                <div style={{ fontSize: 12, color: tk.textLo, marginBottom: 10 }}>{ordersLoading ? "" : money(colOrders.reduce((a, b) => a + b.total_amount, 0))}</div>
                {ordersLoading ? Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} style={{ background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
                    <Skel tk={tk} w="50%" h={12} style={{ marginBottom: 6 }} /><Skel tk={tk} w="75%" h={11} style={{ marginBottom: 6 }} /><Skel tk={tk} w="40%" h={13} />
                  </div>
                )) : colOrders.map((o) => (
                  <div key={o.id} draggable onDragStart={() => setDragId(o.id)} onClick={() => openDetail(o)}
                    style={{ background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, cursor: "grab", opacity: dragId === o.id ? 0.5 : 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: tk.accent, marginBottom: 4 }}>{o.folio}</div>
                    <div style={{ fontSize: 12, color: tk.textHi, marginBottom: 4 }}>{o.customer?.name ?? tr("sales_no_customer", "Mostrador")}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: tk.textHi }}>{money(o.total_amount)}</div>
                  </div>
                ))}
                {!ordersLoading && colOrders.length === 0 && <div style={{ textAlign: "center", color: tk.textLo, fontSize: 12, padding: "24px 0", opacity: 0.6 }}>—</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr style={{ background: tk.panel2 }}>
                <SortHead col="folio" label={tr("sales_col_folio", "Folio")} />
                <th style={thBase}>{tr("sales_col_client", "Cliente")}</th>
                <SortHead col="created_at" label={tr("sales_col_date", "Fecha")} />
                <th style={thBase}>{tr("sales_col_payment", "Pago")}</th>
                <SortHead col="total_amount" label={tr("sales_col_total", "Total")} />
                <th style={thBase}>{tr("sales_balance", "Saldo")}</th>
                <SortHead col="status" label={tr("sales_col_status", "Estado")} />
                <th style={{ borderBottom: `1px solid ${tk.border}` }}></th>
              </tr></thead>
              <tbody>
                {ordersLoading ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                    {Array.from({ length: 7 }).map((__, c) => <td key={c} style={{ padding: "12px 16px" }}><Skel tk={tk} w={c === 1 ? "70%" : "55%"} h={12} /></td>)}
                    <td style={{ padding: "12px 16px" }}><Skel tk={tk} w={16} h={12} /></td>
                  </tr>
                )) : orders.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState tk={tk} title={tr("sales_no_results", "Sin resultados")} hint={tr("sales_no_results_hint", "Ajusta los filtros o crea un nuevo pedido.")} /></td></tr>
                ) : orders.map((o, i) => {
                  const sc = statusColors(tk, o.status);
                  return (
                    <tr key={o.id} onClick={() => openDetail(o)} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = tk.panel3)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? tk.panel : tk.panel2)}>
                      <td style={{ padding: "12px 16px", fontSize: 14, color: tk.accent, fontWeight: 700 }}>{o.folio}{o.kind === "quote" && <span style={{ fontSize: 10, color: tk.textLo, fontWeight: 600 }}> · COT</span>}</td>
                      <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi }}>{o.customer?.name ?? tr("sales_no_customer", "Mostrador")}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{dateShort(o.created_at)}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{paymentLabel(o.payment_method)}</td>
                      <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi, fontWeight: 700 }}>{money(o.total_amount)}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: o.balance > 0 ? tk.warn : tk.textLo }}>{money(o.balance)}</td>
                      <td style={{ padding: "12px 16px" }}><Badge tk={tk} bg={sc.bg} color={sc.text} border={sc.border}>{statusMeta(o.status).label}</Badge></td>
                      <td style={{ padding: "12px 16px" }}><ChevronRight size={16} color={tk.textLo} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${tk.border}` }}>
              <span style={{ fontSize: 13, color: tk.textLo }}>{total} {tr("sales_results", "resultados")}</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button tk={tk} variant="subtle" disabled={page === 0 || ordersLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</Button>
                <span style={{ fontSize: 13, color: tk.textMid }}>{page + 1} / {pages}</span>
                <Button tk={tk} variant="subtle" disabled={page + 1 >= pages || ordersLoading} onClick={() => setPage((p) => p + 1)}>›</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <OrderForm tk={tk} tr={tr} open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={handleSubmit} editing={editing} customers={customers} variants={variants} saving={saving} />
      <PaymentModal tk={tk} tr={tr} open={!!payTarget} onClose={() => setPayTarget(null)} order={payTarget} onSubmit={handlePay} saving={saving} />
      <OrderDrawer tk={tk} tr={tr} order={selected} onClose={() => setSelected(null)} onEdit={openEdit} onPay={(o) => { setPayTarget(o); }} onMarkPaid={markPaid} onConvert={convert} onCancel={cancel} onInvoice={invoice} />
    </div>
  );
}

function Skel({ tk, w, h, r = 8, style }: { tk: Tokens; w: number | string; h: number | string; r?: number; style?: React.CSSProperties }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: `linear-gradient(90deg, ${tk.panel2} 25%, ${tk.panel3} 37%, ${tk.panel2} 63%)`, backgroundSize: "400% 100%", animation: "kt-shimmer 1.4s ease infinite", ...style }} />;
}

function ShimmerKeyframes() {
  return <style>{`@keyframes kt-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>;
}

function extractErr(e: unknown): string {
  const anyE = e as { response?: { data?: { detail?: string } } };
  return anyE?.response?.data?.detail ?? "Ocurrió un error. Intenta de nuevo.";
}
