// DIOT — Declaración Informativa de Operaciones con Terceros.
// Preview interactivo + descarga .txt (SAT) y .xlsx (contador).
// Diseñado con estándar CONTPAQi/Aspel: selector período, KPIs, tabla con
// warnings destacadas, downloads, ayuda contextual.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Download, FileText, AlertTriangle, Search, Info, CheckCircle2,
} from "lucide-react";
import { diotService, type DiotPreview, type DiotRow } from "./service";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function DiotTab({ t, lang }: { t: any; lang: string }) {
  const now = new Date();
  // DIOT se declara del mes anterior — arrancamos ahí por default
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [data, setData] = useState<DiotPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [downloading, setDownloading] = useState<"txt" | "xlsx" | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await diotService.preview(year, month);
      setData(r);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Error al cargar DIOT");
    } finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!q.trim()) return data.rows;
    const qs = q.trim().toLowerCase();
    return data.rows.filter(r =>
      (r.supplier_name || "").toLowerCase().includes(qs)
      || (r.rfc || "").toLowerCase().includes(qs));
  }, [data, q]);

  const download = async (kind: "txt" | "xlsx") => {
    setDownloading(kind);
    try {
      if (kind === "txt") await diotService.downloadTxt(year, month);
      else await diotService.downloadXlsx(year, month);
    } catch {
      alert(lang === "es" ? "Error al descargar" : "Download error");
    } finally { setDownloading(null); }
  };

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2020; y--) arr.push(y);
    return arr;
  }, [now]);

  const totals = data?.totals;
  const hasWarnings = (totals?.warnings_count ?? 0) > 0;
  const hasData = (totals?.rows ?? 0) > 0;

  const inpSelect: React.CSSProperties = {
    padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
    background: t.panel2, color: t.textHi, fontSize: 13, outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, color: t.textHi, fontWeight: 700 }}>
            DIOT — {lang === "es" ? "Declaración Informativa de Operaciones con Terceros" : "Third-Party Operations Informative Return"}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3, maxWidth: 640 }}>
            {lang === "es"
              ? "Agrupa las facturas de proveedor efectivamente pagadas en el mes. Descarga el .txt oficial y súbelo al portal del SAT (Servicio de Declaraciones y Pagos → Informativas → DIOT)."
              : "Aggregates supplier bills effectively paid in the month. Download the official .txt and upload it to the SAT portal (Payments Service → Informative → DIOT)."}
          </div>
        </div>
      </div>

      {/* Selector periodo + acciones */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 12, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>
            {lang === "es" ? "Periodo" : "Period"}
          </div>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={inpSelect}>
            {MONTHS_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={inpSelect}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={load} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <RefreshCw size={13} /> {lang === "es" ? "Actualizar" : "Refresh"}
          </button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => download("xlsx")} disabled={!hasData || downloading !== null}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: hasData ? "pointer" : "not-allowed", fontSize: 12.5, opacity: hasData ? 1 : 0.5 }}>
            <Download size={13} /> {downloading === "xlsx" ? "…" : "XLSX"}
          </button>
          <button onClick={() => download("txt")} disabled={!hasData || downloading !== null}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: hasData ? "pointer" : "not-allowed", fontSize: 12.5, fontWeight: 600, opacity: hasData ? 1 : 0.5 }}>
            <FileText size={13} /> {downloading === "txt" ? "…" : ".txt SAT"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: (t.bad || "#ef4444") + "18", color: t.bad, borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}

      {!loading && data && (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <KpiTile t={t} label={lang === "es" ? "Proveedores" : "Suppliers"} value={String(totals?.rows ?? 0)} />
            <KpiTile t={t} label={lang === "es" ? "Total pagado" : "Total paid"} value={mxn(totals?.total_paid)} />
            <KpiTile t={t} label={lang === "es" ? "IVA acreditable" : "Deductible VAT"} value={mxn(totals?.total_iva)} color={t.nova} />
            <KpiTile t={t} label={lang === "es" ? "Advertencias" : "Warnings"} value={String(totals?.warnings_count ?? 0)} color={hasWarnings ? t.warn : t.good} icon={hasWarnings ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />} />
          </div>

          {/* Búsqueda */}
          {hasData && (
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder={lang === "es" ? "Buscar por proveedor o RFC…" : "Search by supplier or RFC…"}
                style={{
                  padding: "8px 12px 8px 32px", borderRadius: 8,
                  border: `1px solid ${t.border}`, background: t.panel2,
                  color: t.textHi, fontSize: 13, outline: "none", width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Tabla */}
          {hasData ? (
            <div style={{ overflowX: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.4 }}>
                    <th style={th()}>{lang === "es" ? "Proveedor" : "Supplier"}</th>
                    <th style={th()}>RFC</th>
                    <th style={th()}>{lang === "es" ? "Tipo" : "Type"}</th>
                    <th style={{ ...th(), textAlign: "right" }}>{lang === "es" ? "Valor 16%" : "Value 16%"}</th>
                    <th style={{ ...th(), textAlign: "right" }}>IVA 16%</th>
                    <th style={{ ...th(), textAlign: "right" }}>{lang === "es" ? "Total pagado" : "Total paid"}</th>
                    <th style={{ ...th(), textAlign: "center" }}>{lang === "es" ? "Estado" : "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => <DiotRowView key={i} t={t} row={r} />)}
                </tbody>
                <tfoot>
                  <tr style={{ background: t.panel2, borderTop: `2px solid ${t.nova}` }}>
                    <td style={{ ...td(), fontWeight: 700, color: t.textHi }} colSpan={3}>{lang === "es" ? "TOTALES" : "TOTALS"}</td>
                    <td style={{ ...td(), textAlign: "right", fontWeight: 700, color: t.textHi }}>
                      {mxn(filtered.reduce((s, r) => s + r.value_16, 0))}
                    </td>
                    <td style={{ ...td(), textAlign: "right", fontWeight: 700, color: t.nova }}>
                      {mxn(filtered.reduce((s, r) => s + r.iva_16, 0))}
                    </td>
                    <td style={{ ...td(), textAlign: "right", fontWeight: 700, color: t.textHi }}>
                      {mxn(filtered.reduce((s, r) => s + r.total_paid, 0))}
                    </td>
                    <td style={td()}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", background: t.panel, border: `1px dashed ${t.border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 14, color: t.textMid, marginBottom: 4 }}>
                {lang === "es" ? "Sin facturas de proveedor pagadas en el periodo" : "No supplier bills paid in the period"}
              </div>
              <div style={{ fontSize: 12, color: t.textLo }}>
                {lang === "es"
                  ? "El DIOT se genera de las facturas efectivamente pagadas cada mes. Registra los pagos en Finanzas → Cuentas por Pagar."
                  : "DIOT is built from bills paid within the month. Register payments in Finance → Accounts Payable."}
              </div>
            </div>
          )}

          {/* Info */}
          <div style={{ padding: "10px 12px", background: t.nova + "12", border: `1px solid ${t.nova}44`, borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: t.textMid }}>
            <Info size={14} color={t.nova} style={{ marginTop: 1, flexShrink: 0 }} />
            <div>
              {lang === "es"
                ? <>El archivo <b>.txt</b> tiene formato oficial del SAT (pipe-delimited). Súbelo en el portal del SAT en <i>Servicio de Declaraciones y Pagos → Informativas → DIOT</i>. El <b>.xlsx</b> es solo para revisión del contador.</>
                : <>The <b>.txt</b> uses the official SAT pipe-delimited format. Upload it in the SAT portal at <i>Declarations Service → Informative → DIOT</i>. The <b>.xlsx</b> is for accountant review only.</>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


function DiotRowView({ t, row }: { t: any; row: DiotRow }) {
  const hasWarn = row.warnings.length > 0;
  return (
    <tr style={{ borderTop: `1px solid ${t.border}`, background: hasWarn ? (t.warn || "#f59e0b") + "10" : "transparent" }}>
      <td style={{ ...td(), color: t.textHi, fontWeight: 600 }}>{row.supplier_name}</td>
      <td style={{ ...td(), fontFamily: "monospace", color: t.textMid }}>{row.rfc || "—"}</td>
      <td style={td()}>
        <div style={{ fontSize: 11.5, color: t.textMid }}>{row.third_type_label}</div>
        <div style={{ fontSize: 10.5, color: t.textLo }}>{row.operation_type_label}</div>
      </td>
      <td style={{ ...td(), textAlign: "right", color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
        {row.value_16 > 0 ? "$" + row.value_16.toLocaleString("es-MX") : "—"}
      </td>
      <td style={{ ...td(), textAlign: "right", color: t.nova, fontVariantNumeric: "tabular-nums" }}>
        {row.iva_16 > 0 ? "$" + row.iva_16.toLocaleString("es-MX") : "—"}
      </td>
      <td style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        ${row.total_paid.toLocaleString("es-MX")}
      </td>
      <td style={{ ...td(), textAlign: "center" }}>
        {hasWarn ? (
          <div title={row.warnings.join(" · ")} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", background: (t.warn || "#f59e0b") + "22", color: t.warn, borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>
            <AlertTriangle size={11} /> {row.warnings.length}
          </div>
        ) : (
          <CheckCircle2 size={14} color={t.good} />
        )}
      </td>
    </tr>
  );
}


function KpiTile({ t, label, value, color, icon }: {
  t: any; label: string; value: string; color?: string; icon?: any;
}) {
  return (
    <div style={{ padding: 12, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span style={{ color: color || t.textHi }}>{icon}</span>}
        <div style={{ fontSize: 20, fontWeight: 800, color: color || t.textHi, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      </div>
    </div>
  );
}


const th = (): React.CSSProperties => ({
  padding: "10px 12px", textAlign: "left", whiteSpace: "nowrap",
});
const td = (): React.CSSProperties => ({
  padding: "10px 12px", verticalAlign: "top",
});
