/**
 * IngestaConfigurador.tsx
 * Configurador de fuente de ventas — primera vez.
 * El cliente sube su archivo, ve TODAS las columnas con ejemplos reales,
 * y asigna cada una a su campo. Solo una vez. Después solo sube el archivo.
 */

import { useEffect, useRef, useState } from "react";
import {
  Upload, ChevronRight, ChevronLeft, Check, AlertTriangle,
  Info, Plus, Trash2, Settings, FileSpreadsheet, Zap, Copy,
} from "lucide-react";
import api from "../../services/api";
import { salesApi } from "./api";
import type { CustomerLite } from "./types";
import type { Tokens } from "./theme";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Columna {
  nombre: string;
  muestra: string | null;
  campo: string;
  etiqueta_custom?: string;
}

interface Fuente {
  id: number;
  nombre: string;
  moneda: string;
  activa: boolean;
}

interface Props {
  tk: Tokens;
  onGuardado?: (fuenteId: number) => void;
  onCancelar?: () => void;
}

interface FuenteCreada {
  id: number;
  tipo_ingesta: string;
  api_key?: string | null;
}

// ── Campos estándar STHENOVA ──────────────────────────────────────────────────
// COGS y marketing NO están aquí (vienen de Compras y Gastos).

const GRUPOS_CAMPOS = [
  {
    grupo: "Identificadores del producto",
    campos: [
      { value: "upc",        label: "UPC / código de barras",           hint: "EAN / GTIN — código universal" },
      { value: "sku_cliente",label: "SKU interno del cliente",          hint: "Código propio de la empresa, no del marketplace" },
      { value: "sku_cadena", label: "SKU de la cadena",                 hint: "Código que asigna Liverpool, MeLi, Amazon, etc." },
      { value: "descripcion",label: "Nombre / descripción del producto", hint: "Texto descriptivo del artículo" },
      { value: "variante",   label: "Variante",                         hint: "Color, talla, presentación" },
      { value: "subcategoria",label: "Subcategoría",                    hint: "Categoría interna del producto" },
    ],
  },
  {
    grupo: "Pedido / documento",
    campos: [
      { value: "id_pedido",      label: "ID del pedido / orden",         hint: "Número único que identifica el pedido" },
      { value: "estatus_pedido", label: "Estatus del pedido",            hint: "Enviado, entregado, cancelado, reembolsado..." },
      { value: "canal_venta",    label: "Canal de venta",                hint: "App, web, mostrador, teléfono..." },
      { value: "metodo_envio",   label: "Método de envío",               hint: "Home delivery, Click & Collect, etc." },
    ],
  },
  {
    grupo: "Fechas",
    campos: [
      { value: "fecha_venta",   label: "Fecha de venta",                 hint: "Fecha en que se realizó la venta" },
      { value: "fecha_inicio",  label: "Fecha inicio del periodo",       hint: "Para reportes por semana o mes" },
      { value: "fecha_fin",     label: "Fecha fin del periodo",          hint: "Para reportes por semana o mes" },
      { value: "fecha_entrega", label: "Fecha de entrega",               hint: "Cuando llegó al cliente final" },
    ],
  },
  {
    grupo: "Ventas (ingresos)",
    campos: [
      { value: "cantidad_vendida", label: "Cantidad vendida (unidades)", hint: "Piezas, cajas, etc. vendidas" },
      { value: "precio_unitario",  label: "Precio unitario",             hint: "Precio de venta por unidad" },
      { value: "venta_bruta",      label: "Venta bruta",                 hint: "Ingreso total antes de deducciones" },
      { value: "venta_neta",       label: "Venta neta",                  hint: "Después de comisión, envío y devoluciones" },
    ],
  },
  {
    grupo: "Deducciones / contra-ingresos",
    campos: [
      { value: "comision",             label: "Comisión del marketplace",  hint: "Lo que cobra la cadena por vender" },
      { value: "costo_logistico",      label: "Costo logístico / envío",   hint: "Cobro de la cadena por el envío" },
      { value: "devoluciones_importe", label: "Devoluciones — importe",    hint: "Monto devuelto al comprador" },
      { value: "devoluciones_unidades",label: "Devoluciones — unidades",   hint: "Piezas devueltas" },
      { value: "sra",                  label: "SR&A (mermas y ajustes)",   hint: "Shrink, Returns & Allowances" },
      { value: "bonificaciones",       label: "Bonificaciones",            hint: "Allowances otorgados a la cadena" },
      { value: "descuentos",           label: "Descuentos",                hint: "Descuentos aplicados al precio" },
    ],
  },
  {
    grupo: "Inventario en cadena",
    campos: [
      { value: "inv_inicial",        label: "Inventario inicial",          hint: "Stock al inicio del periodo en tienda/CEDIS" },
      { value: "inv_final",          label: "Inventario final",            hint: "Stock al final del periodo" },
      { value: "entradas_resurtido", label: "Entradas / resurtido",        hint: "Unidades recibidas en el periodo" },
    ],
  },
];

const TODOS_LOS_CAMPOS = [
  { value: "skip", label: "— Ignorar esta columna —", hint: "" },
  ...GRUPOS_CAMPOS.flatMap((g) => g.campos),
  { value: "campo_extra_1", label: "Campo personalizado 1", hint: "Dato adicional que quieres conservar" },
  { value: "campo_extra_2", label: "Campo personalizado 2", hint: "Dato adicional que quieres conservar" },
  { value: "campo_extra_3", label: "Campo personalizado 3", hint: "Dato adicional que quieres conservar" },
];

// ── Campos requeridos mínimos para procesar ───────────────────────────────────
const CAMPOS_REQUERIDOS = ["venta_bruta", "fecha_venta", "cantidad_vendida"];

// ── Componente principal ──────────────────────────────────────────────────────

export default function IngestaConfigurador({ tk, onGuardado, onCancelar }: Props) {
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ encabezados: string[]; muestra_filas: Record<string, string | null>[]; total_filas: number; nombre_archivo: string } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 1 — datos de la fuente
  const [nombre, setNombre] = useState("");
  const [tipoCliente, setTipoCliente] = useState("marketplace");
  const [tipoIngesta, setTipoIngesta] = useState<"excel" | "csv" | "api">("excel");
  const [moneda, setMoneda] = useState("MXN");
  const [periodicidad, setPeriodicidad] = useState("flexible");
  const [nombreHoja, setNombreHoja] = useState("");
  const [tieneAnidadas, setTieneAnidadas] = useState(false);
  const [campoIdPedido, setCampoIdPedido] = useState("");

  // Puente a Ventas — a qué cliente se le atribuye la venta y si se factura sola
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [customerId, setCustomerId] = useState<number | "">("");
  const [autoCrearVentas, setAutoCrearVentas] = useState(false);
  const [creada, setCreada] = useState<FuenteCreada | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    salesApi.customers().then(setCustomers).catch(() => {});
  }, []);

  // Paso 2 — columnas
  const [columnas, setColumnas] = useState<Columna[]>([]);

  // Paso 3 — reglas
  const [comisionOrigen, setComisionOrigen] = useState<"columna" | "porcentaje" | "no_aplica">("columna");
  const [comisionPct, setComisionPct] = useState<number>(17);
  const [precioConIva, setPrecioConIva] = useState(false);
  const [ivaPct, setIvaPct] = useState<number>(16);
  const [devColumna, setDevColumna] = useState("");
  const [devRegla, setDevRegla] = useState<"contiene" | "igual" | "diferente">("contiene");
  const [devValor, setDevValor] = useState("");
  const [devVentana, setDevVentana] = useState(90);

  const fileRef = useRef<HTMLInputElement>(null);

  const card: React.CSSProperties = {
    background: tk.panel, border: `1px solid ${tk.border}`,
    borderRadius: 12, padding: "18px 22px", marginBottom: 14,
  };
  const inp: React.CSSProperties = {
    padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
    background: tk.inputBg, color: tk.textHi, fontSize: 14,
    outline: "none", width: "100%", boxSizing: "border-box",
  };
  const label12: React.CSSProperties = { fontSize: 12, color: tk.textLo, display: "block", marginBottom: 4 };

  // Subir archivo al backend para leer encabezados reales
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setArchivo(f);
    setError(null);
    setLeyendo(true);
    try {
      const fd = new FormData();
      fd.append("archivo", f);
      const res = await api.post("/ingesta/preview", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreview(res.data);
      // Inicializar columnas con "skip" por defecto
      setColumnas(res.data.encabezados.map((h: string) => ({
        nombre: h,
        muestra: res.data.muestra_filas[0]?.[h] ?? null,
        campo: "skip",
      })));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "No se pudo leer el archivo.");
      setArchivo(null);
      setPreview(null);
    } finally {
      setLeyendo(false);
    }
  };

  const setColCampo = (idx: number, campo: string) => {
    setColumnas((prev) => prev.map((c, i) => i === idx ? { ...c, campo } : c));
  };
  const setColEtiqueta = (idx: number, etiqueta: string) => {
    setColumnas((prev) => prev.map((c, i) => i === idx ? { ...c, etiqueta_custom: etiqueta } : c));
  };

  // Validaciones por paso
  const paso1Ok = nombre.trim().length > 0 && archivo !== null && preview !== null;
  const camposMapeados = columnas.filter((c) => c.campo !== "skip").map((c) => c.campo);
  const faltanRequeridos = CAMPOS_REQUERIDOS.filter((r) => !camposMapeados.includes(r));
  const paso2Ok = true; // siempre puede continuar, los requeridos son solo advertencia

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const payload = {
        nombre,
        tipo_cliente: tipoCliente,
        tipo_ingesta: tipoIngesta,
        moneda,
        periodicidad,
        nombre_hoja: nombreHoja || null,
        tiene_filas_anidadas: tieneAnidadas,
        campo_id_pedido: tieneAnidadas ? campoIdPedido : null,
        customer_id: customerId || null,
        auto_crear_ventas: autoCrearVentas,
        columnas: columnas.filter((c) => c.campo !== "skip").map((c) => ({
          columna_origen: c.nombre,
          campo_sthenova: c.campo,
          muestra: c.muestra ? String(c.muestra).slice(0, 60) : null,
          confirmada: true,
          etiqueta_custom: c.etiqueta_custom || null,
        })),
        reglas: {
          comision_origen: comisionOrigen,
          comision_porcentaje: comisionOrigen === "porcentaje" ? comisionPct : null,
          precio_incluye_iva: precioConIva,
          iva_porcentaje: precioConIva ? ivaPct : null,
          dev_columna_estatus: devColumna || null,
          dev_regla: devRegla,
          dev_valor: devValor || null,
          dev_ventana_dias: devVentana,
          dev_fecha_venta_original: true,
          inv_control_temporalidad: true,
          inv_alerta_amarilla_dias: 90,
          inv_alerta_roja_dias: 180,
        },
      };
      const res = await api.post("/ingesta/fuentes", payload);
      if (tipoIngesta === "api" && res.data.api_key) {
        setCreada({ id: res.data.id, tipo_ingesta: res.data.tipo_ingesta, api_key: res.data.api_key });
      } else if (onGuardado) {
        onGuardado(res.data.id);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e?.response?.data?.detail ?? "Error al guardar. Intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  const stepLabel = ["Datos de la fuente", "Asignar columnas", "Reglas del negocio", "Confirmar y guardar"];

  const webhookUrl = `${(api.defaults.baseURL ?? "").replace(/\/$/, "")}/ingesta/fuentes/${creada?.id}/webhook`;

  // ── Vista: fuente tipo API creada — entregar la clave y la URL ──────────────
  if (creada) return (
    <div style={card}>
      <Check size={32} color={tk.good} style={{ marginBottom: 10 }} />
      <p style={{ fontSize: 15, fontWeight: 600, color: tk.textHi, margin: "0 0 6px" }}>Fuente API creada</p>
      <p style={{ fontSize: 13, color: tk.textLo, margin: "0 0 16px" }}>
        Comparte esto con el equipo técnico del marketplace/cliente. Cada envío reutiliza el mismo mapeo de columnas que configuraste.
      </p>

      <label style={label12}>URL del webhook</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input readOnly value={webhookUrl} style={{ ...inp, fontFamily: "monospace", fontSize: 12 }} />
      </div>

      <label style={label12}>API Key (header X-API-Key) — solo se muestra una vez</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input readOnly value={creada.api_key ?? ""} style={{ ...inp, fontFamily: "monospace", fontSize: 12 }} />
        <button
          onClick={() => { navigator.clipboard.writeText(creada.api_key ?? ""); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textHi, fontSize: 13, cursor: "pointer" }}>
          <Copy size={14} /> {copiado ? "¡Copiado!" : "Copiar"}
        </button>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: tk.textLo, padding: "10px 12px", background: tk.panel2, borderRadius: 8 }}>
        <Info size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
        POST de JSON: <code>{`{"filas": [{ "<columna_origen>": "<valor>", ... }]}`}</code> — mismas columnas que mapeaste con el archivo de muestra.
      </div>

      <button onClick={() => { if (onGuardado) onGuardado(creada.id); }}
        style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Listo
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Barra de pasos */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
        {stepLabel.map((lbl, i) => {
          const n = i + 1;
          const activo = paso === n;
          const hecho = paso > n;
          return (
            <div key={n} style={{ flex: 1, display: "flex", alignItems: "center", gap: 0 }}>
              <div style={{ flex: 1, padding: "8px 10px", textAlign: "center", fontSize: 12, fontWeight: activo ? 600 : 400, color: hecho ? tk.good : activo ? tk.nova : tk.textLo, borderBottom: `2px solid ${hecho ? tk.good : activo ? tk.nova : tk.border}` }}>
                {hecho ? <Check size={13} style={{ verticalAlign: -2, marginRight: 4 }} /> : null}
                {n}. {lbl}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error global */}
      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.bad + "18", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* ── PASO 1 — Datos de la fuente ────────────────────────────────────── */}
      {paso === 1 && (
        <>
          <div style={{ ...card, borderLeft: `3px solid ${tk.nova}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Info size={16} color={tk.nova} />
              <span style={{ fontSize: 13, color: tk.textMid }}>
                Este configurador se hace <strong style={{ color: tk.textHi }}>solo una vez</strong>. Después solo subes tu archivo y STHENOVA lo procesa automáticamente.
              </span>
            </div>
          </div>

          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 14px" }}>1. Sube el archivo de tu reporte</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} style={{ display: "none" }} />

            <div onClick={() => !leyendo && fileRef.current?.click()}
              style={{ border: `2px dashed ${preview ? tk.good : tk.border}`, borderRadius: 10, padding: "28px 20px", textAlign: "center", cursor: leyendo ? "wait" : "pointer", background: preview ? tk.good + "08" : "transparent", transition: "all .2s" }}>
              {leyendo ? (
                <><Upload size={24} color={tk.textLo} style={{ margin: "0 auto 8px", display: "block" }} /><div style={{ fontSize: 14, color: tk.textMid }}>Leyendo columnas...</div></>
              ) : preview ? (
                <>
                  <FileSpreadsheet size={24} color={tk.good} style={{ margin: "0 auto 8px", display: "block" }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>{preview.nombre_archivo}</div>
                  <div style={{ fontSize: 12, color: tk.textLo, marginTop: 4 }}>{preview.encabezados.length} columnas · {preview.total_filas} filas · clic para cambiar</div>
                </>
              ) : (
                <>
                  <Upload size={24} color={tk.textLo} style={{ margin: "0 auto 8px", display: "block" }} />
                  <div style={{ fontSize: 14, color: tk.textMid }}>Haz clic para seleccionar tu archivo</div>
                  <div style={{ fontSize: 12, color: tk.textLo, marginTop: 4 }}>Excel (.xlsx, .xls) o CSV</div>
                </>
              )}
            </div>
          </div>

          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 14px" }}>2. Información de la fuente</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label12}>Nombre de la fuente *</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Mercado Libre MX, Liverpool, Amazon MX..." style={inp} />
              </div>
              <div>
                <label style={label12}>Tipo de cliente</label>
                <select value={tipoCliente} onChange={(e) => setTipoCliente(e.target.value)} style={inp}>
                  <option value="marketplace">Marketplace digital (MeLi, Amazon)</option>
                  <option value="cadena_retail">Cadena retail (Liverpool, Coppel)</option>
                  <option value="tienda_fisica">Tienda física propia</option>
                  <option value="distribuidor">Distribuidor / mayorista</option>
                  <option value="web_propia">Página web propia</option>
                </select>
              </div>
              <div>
                <label style={label12}>Moneda principal</label>
                <select value={moneda} onChange={(e) => setMoneda(e.target.value)} style={inp}>
                  <option value="MXN">MXN — Pesos mexicanos</option>
                  <option value="USD">USD — Dólares americanos</option>
                </select>
              </div>
              <div>
                <label style={label12}>Periodicidad típica del reporte</label>
                <select value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)} style={inp}>
                  <option value="flexible">Flexible / cuando quiera</option>
                  <option value="diaria">Diaria</option>
                  <option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>
              <div>
                <label style={label12}>Nombre de la hoja (si es Excel)</label>
                <input value={nombreHoja} onChange={(e) => setNombreHoja(e.target.value)} placeholder="Ej: Meli, Amazon, Venta_Total..." style={inp} />
              </div>
              <div>
                <label style={label12}>Cómo llegarán los datos después</label>
                <select value={tipoIngesta} onChange={(e) => setTipoIngesta(e.target.value as "excel" | "csv" | "api")} style={inp}>
                  <option value="excel">Subiendo Excel/CSV manualmente</option>
                  <option value="api">Conectado por API (webhook)</option>
                </select>
              </div>
              <div>
                <label style={label12}>Cliente al que se le atribuye la venta</label>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : "")} style={inp}>
                  <option value="">— Sin asignar (solo BI, no genera Order) —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 14, padding: "12px 14px", background: tk.panel2, borderRadius: 9, border: `1px solid ${tk.border}` }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={autoCrearVentas} onChange={(e) => setAutoCrearVentas(e.target.checked)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>Generar pedidos de Ventas automáticamente</div>
                  <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>
                    Cada archivo/envío crea Orders reales al instante (Finanzas e Inventario los ven). Si lo dejas apagado, puedes generarlos manualmente después de revisar cada lote.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ marginTop: 14, padding: "12px 14px", background: tk.panel2, borderRadius: 9, border: `1px solid ${tk.border}` }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={tieneAnidadas} onChange={(e) => setTieneAnidadas(e.target.checked)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>Este reporte tiene varias filas por pedido</div>
                  <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>Activa si el mismo número de orden aparece en múltiples filas con distintos productos (como Mercado Libre)</div>
                </div>
              </label>
              {tieneAnidadas && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: tk.textLo, flexShrink: 0 }}>Columna que identifica el pedido:</span>
                  <select value={campoIdPedido} onChange={(e) => setCampoIdPedido(e.target.value)} style={{ ...inp, width: "auto", flex: 1 }}>
                    <option value="">— Elige una columna —</option>
                    {(preview?.encabezados ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            {onCancelar && <button onClick={onCancelar} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 14, cursor: "pointer" }}>Cancelar</button>}
            <button onClick={() => setPaso(2)} disabled={!paso1Ok}
              style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: paso1Ok ? `linear-gradient(135deg, ${tk.nova}, ${tk.navy})` : tk.panel2, color: paso1Ok ? "#fff" : tk.textLo, fontSize: 14, fontWeight: 600, cursor: paso1Ok ? "pointer" : "default" }}>
              Continuar — asignar columnas <ChevronRight size={15} style={{ verticalAlign: -2 }} />
            </button>
          </div>
        </>
      )}

      {/* ── PASO 2 — Asignar columnas ──────────────────────────────────────── */}
      {paso === 2 && (
        <>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: 0 }}>Asigna cada columna a su campo STHENOVA</p>
              <span style={{ fontSize: 12, color: tk.textLo }}>{preview?.nombre_archivo} · {columnas.length} columnas</span>
            </div>
            <p style={{ fontSize: 12, color: tk.textLo, margin: "0 0 14px" }}>
              Si una columna no la necesitas, déjala en "— Ignorar —". Solo necesitas asignar al menos: <strong style={{ color: tk.warn }}>venta bruta, cantidad vendida y fecha de venta</strong>.
            </p>

            {/* Columnas por grupos visuales */}
            {faltanRequeridos.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: tk.warn + "18", border: `1px solid ${tk.warn}44`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: tk.warn }}>
                <AlertTriangle size={14} />
                Faltan campos requeridos: <strong>{faltanRequeridos.map((f) => TODOS_LOS_CAMPOS.find((c) => c.value === f)?.label ?? f).join(", ")}</strong>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {columnas.map((col, idx) => {
                const esExtra = col.campo.startsWith("campo_extra_");
                const info = TODOS_LOS_CAMPOS.find((c) => c.value === col.campo);
                const esRequerido = CAMPOS_REQUERIDOS.includes(col.campo);
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: col.campo !== "skip" ? tk.panel2 : tk.panel, borderRadius: 9, border: `1px solid ${esRequerido ? tk.nova + "55" : tk.border}` }}>
                    {/* Nombre de la columna */}
                    <div style={{ flex: "0 0 220px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.nombre}</div>
                      {col.muestra && <div style={{ fontSize: 11, color: tk.textLo, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(col.muestra).slice(0, 40)}</div>}
                    </div>

                    {/* Flecha */}
                    <ChevronRight size={14} color={tk.textLo} style={{ flexShrink: 0 }} />

                    {/* Dropdown */}
                    <select value={col.campo} onChange={(e) => setColCampo(idx, e.target.value)}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${col.campo !== "skip" ? tk.nova + "55" : tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none" }}>
                      <option value="skip">— Ignorar esta columna —</option>
                      {GRUPOS_CAMPOS.map((g) => (
                        <optgroup key={g.grupo} label={g.grupo}>
                          {g.campos.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </optgroup>
                      ))}
                      <optgroup label="Campos personalizados">
                        <option value="campo_extra_1">Campo personalizado 1</option>
                        <option value="campo_extra_2">Campo personalizado 2</option>
                        <option value="campo_extra_3">Campo personalizado 3</option>
                      </optgroup>
                    </select>

                    {/* Hint del campo seleccionado */}
                    {info && info.hint && col.campo !== "skip" && (
                      <div style={{ fontSize: 11, color: tk.textLo, maxWidth: 140, lineHeight: 1.3, flexShrink: 0 }}>{info.hint}</div>
                    )}

                    {/* Etiqueta custom si es campo extra */}
                    {esExtra && (
                      <input value={col.etiqueta_custom ?? ""} onChange={(e) => setColEtiqueta(idx, e.target.value)}
                        placeholder="Nombre del campo" style={{ ...inp, width: 130, flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button onClick={() => setPaso(1)} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 14, cursor: "pointer" }}>
              <ChevronLeft size={14} style={{ verticalAlign: -2 }} /> Atrás
            </button>
            <button onClick={() => setPaso(3)}
              style={{ flex: 1, maxWidth: 320, padding: "9px 24px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Continuar — reglas del negocio <ChevronRight size={15} style={{ verticalAlign: -2 }} />
            </button>
          </div>
        </>
      )}

      {/* ── PASO 3 — Reglas de negocio ─────────────────────────────────────── */}
      {paso === 3 && (
        <>
          {/* Comisión */}
          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 4px" }}>Comisión del marketplace / cadena</p>
            <p style={{ fontSize: 12, color: tk.textLo, margin: "0 0 12px" }}>¿Cómo obtiene STHENOVA el dato de comisión para este reporte?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([
                ["columna", "Ya está en el archivo", "Asigné la columna de comisión en el paso anterior"],
                ["porcentaje", "Porcentaje calculado", "El archivo no tiene comisión — STHENOVA la calcula sobre la venta bruta"],
                ["no_aplica", "No aplica", "Esta fuente no tiene comisión"],
              ] as const).map(([val, titulo, desc]) => (
                <label key={val} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", border: `1px solid ${comisionOrigen === val ? tk.nova + "55" : tk.border}`, borderRadius: 9, cursor: "pointer", background: comisionOrigen === val ? tk.nova + "0a" : "transparent" }}>
                  <input type="radio" name="comision" value={val} checked={comisionOrigen === val} onChange={() => setComisionOrigen(val)} style={{ marginTop: 2 }} />
                  <div><div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>{titulo}</div><div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>{desc}</div></div>
                </label>
              ))}
            </div>
            {comisionOrigen === "porcentaje" && (
              <div style={{ marginTop: 10, padding: "12px 14px", background: tk.warn + "18", border: `1px solid ${tk.warn}44`, borderRadius: 9, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: tk.textMid }}>Comisión =</span>
                <input type="number" value={comisionPct} min={0} max={100} step={0.1} onChange={(e) => setComisionPct(Number(e.target.value))} style={{ ...inp, width: 80 }} />
                <span style={{ fontSize: 13, color: tk.textMid }}>% de la venta bruta</span>
                <span style={{ fontSize: 12, color: tk.textLo }}>Puedes cambiarlo cuando cambie la tarifa.</span>
              </div>
            )}
          </div>

          {/* IVA */}
          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 4px" }}>IVA en el precio</p>
            <p style={{ fontSize: 12, color: tk.textLo, margin: "0 0 12px" }}>¿Los precios en el archivo ya vienen sin IVA, o hay que quitarlo?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${!precioConIva ? tk.nova + "55" : tk.border}`, borderRadius: 9, cursor: "pointer", background: !precioConIva ? tk.nova + "0a" : "transparent" }}>
                <input type="radio" name="iva" checked={!precioConIva} onChange={() => setPrecioConIva(false)} />
                <div><div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>Precio ya sin IVA</div><div style={{ fontSize: 12, color: tk.textLo }}>La mayoría de los marketplaces ya reportan sin IVA</div></div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${precioConIva ? tk.nova + "55" : tk.border}`, borderRadius: 9, cursor: "pointer", background: precioConIva ? tk.nova + "0a" : "transparent" }}>
                <input type="radio" name="iva" checked={precioConIva} onChange={() => setPrecioConIva(true)} />
                <div><div style={{ fontSize: 13, fontWeight: 600, color: tk.textHi }}>Incluye IVA — quitar para cálculos</div><div style={{ fontSize: 12, color: tk.textLo }}>Como la Página Web propia (Total incluye IVA)</div></div>
              </label>
            </div>
            {precioConIva && (
              <div style={{ marginTop: 10, padding: "12px 14px", background: tk.warn + "18", border: `1px solid ${tk.warn}44`, borderRadius: 9, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: tk.textMid }}>IVA =</span>
                <input type="number" value={ivaPct} min={0} max={100} onChange={(e) => setIvaPct(Number(e.target.value))} style={{ ...inp, width: 72 }} />
                <span style={{ fontSize: 13, color: tk.textMid }}>% — STHENOVA divide el precio entre {(1 + ivaPct / 100).toFixed(2)} automáticamente</span>
              </div>
            )}
          </div>

          {/* Devoluciones */}
          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 4px" }}>Identificar devoluciones automáticamente</p>
            <p style={{ fontSize: 12, color: tk.textLo, margin: "0 0 12px" }}>
              Indica cómo STHENOVA reconoce que una fila es una devolución. Ejemplos: MeLi → columna Estatus contiene "devolución" · Liverpool → columna Estado contiene "Reembolsado" · Amazon → columna order-status igual a "Cancelled"
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={label12}>Columna de estatus</label>
                <select value={devColumna} onChange={(e) => setDevColumna(e.target.value)} style={inp}>
                  <option value="">— No aplica —</option>
                  {(preview?.encabezados ?? []).map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <label style={label12}>Regla</label>
                <select value={devRegla} onChange={(e) => setDevRegla(e.target.value as "contiene" | "igual" | "diferente")} style={inp}>
                  <option value="contiene">Contiene el texto</option>
                  <option value="igual">Es exactamente igual a</option>
                  <option value="diferente">Es diferente de</option>
                </select>
              </div>
              <div>
                <label style={label12}>Valor</label>
                <input value={devValor} onChange={(e) => setDevValor(e.target.value)} placeholder="ej: devolución, Cancelled, Pagada..." style={inp} />
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: tk.textLo }}>Ventana máxima de devolución:</span>
              <input type="number" value={devVentana} min={1} max={365} onChange={(e) => setDevVentana(Number(e.target.value))} style={{ ...inp, width: 72 }} />
              <span style={{ fontSize: 13, color: tk.textLo }}>días</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: tk.textLo, padding: "8px 12px", background: tk.panel2, borderRadius: 8 }}>
              <Info size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
              STHENOVA registra la devolución con dos fechas: la fecha de venta original (para estadística y forecast) y la fecha de aplicación del descuento (para contabilidad). Esto evita que aparezcan ventas negativas en los reportes.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button onClick={() => setPaso(2)} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 14, cursor: "pointer" }}>
              <ChevronLeft size={14} style={{ verticalAlign: -2 }} /> Atrás
            </button>
            <button onClick={() => setPaso(4)} style={{ flex: 1, maxWidth: 300, padding: "9px 24px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${tk.nova}, ${tk.navy})`, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Ver resumen y guardar <ChevronRight size={15} style={{ verticalAlign: -2 }} />
            </button>
          </div>
        </>
      )}

      {/* ── PASO 4 — Resumen y guardar ─────────────────────────────────────── */}
      {paso === 4 && (
        <>
          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 12px" }}>Resumen del perfil</p>
            {[
              ["Nombre", nombre],
              ["Tipo", tipoCliente.replace("_", " ")],
              ["Moneda", moneda],
              ["Periodicidad", periodicidad],
              ["Hoja del archivo", nombreHoja || "Primera hoja"],
              ["Estructura", tieneAnidadas ? `Varias filas por pedido · agrupa por "${campoIdPedido}"` : "Una fila = una venta"],
              ["Comisión", comisionOrigen === "columna" ? "Columna del archivo" : comisionOrigen === "porcentaje" ? `${comisionPct}% calculado` : "No aplica"],
              ["IVA", precioConIva ? `Incluye ${ivaPct}% IVA — se quita automáticamente` : "Precio ya sin IVA"],
              ["Devolución", devColumna ? `Columna "${devColumna}" ${devRegla} "${devValor}"` : "Sin detección automática"],
              ["Transporte", tipoIngesta === "api" ? "API / webhook" : "Subida manual de archivo"],
              ["Cliente en Ventas", customers.find((c) => c.id === customerId)?.name ?? "Sin asignar (solo BI)"],
              ["Generar pedidos", autoCrearVentas ? "Automático al procesar" : "Manual (botón después de cada lote)"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${tk.border}`, fontSize: 13 }}>
                <span style={{ color: tk.textLo }}>{k}</span>
                <span style={{ color: tk.textHi, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={card}>
            <p style={{ fontSize: 13, fontWeight: 600, color: tk.textHi, margin: "0 0 10px" }}>
              Columnas asignadas ({columnas.filter((c) => c.campo !== "skip").length} de {columnas.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {columnas.filter((c) => c.campo !== "skip").map((col) => {
                const info = TODOS_LOS_CAMPOS.find((f) => f.value === col.campo);
                return (
                  <div key={col.nombre} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${tk.border}`, fontSize: 13 }}>
                    <span style={{ color: tk.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{col.nombre}</span>
                    <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: tk.good + "22", color: tk.good, flexShrink: 0 }}>
                      → {col.etiqueta_custom || info?.label || col.campo}
                    </span>
                  </div>
                );
              })}
              {columnas.filter((c) => c.campo === "skip").length > 0 && (
                <div style={{ fontSize: 12, color: tk.textLo, paddingTop: 6 }}>
                  + {columnas.filter((c) => c.campo === "skip").length} columnas ignoradas
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button onClick={() => setPaso(3)} style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, fontSize: 14, cursor: "pointer" }}>
              <ChevronLeft size={14} style={{ verticalAlign: -2 }} /> Editar
            </button>
            <button onClick={guardar} disabled={guardando}
              style={{ flex: 1, maxWidth: 300, padding: "9px 24px", borderRadius: 8, border: "none", background: guardando ? tk.panel2 : tk.good, color: guardando ? tk.textLo : "#fff", fontSize: 14, fontWeight: 600, cursor: guardando ? "default" : "pointer" }}>
              {guardando ? "Guardando..." : "✓ Guardar perfil"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
