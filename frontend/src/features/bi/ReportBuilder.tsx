// Report Builder — Reportes personalizables.
// Dataset picker + column picker + filtros + group by + aggregations
// + preview + save/load/share + descarga XLSX.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Save, Trash2, Download, Play, Star, Share2,
  FileText, ChevronDown, ChevronRight, X, Filter,
  BarChart3, RefreshCw, Search,
} from "lucide-react";
import api from "../../services/api";

interface DatasetField {
  alias: string; label: string; type: string;
  allowed_aggs: string[];
}
interface DatasetMeta {
  key: string; label: string;
  date_field?: string;
  groupable: string[];
  fields: DatasetField[];
}
interface SavedReport {
  id: number; name: string; description?: string;
  dataset: string; config: any;
  is_shared: boolean; is_favorite: boolean;
  owner_id: number; is_mine: boolean;
  last_run_at?: string; updated_at?: string;
}
type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "ilike" | "between" | "is_null" | "not_null";
interface ReportConfig {
  columns: string[];
  filters: { field: string; op: FilterOp; value: any }[];
  group_by: string[];
  aggregations: Record<string, "sum" | "count" | "avg" | "min" | "max">;
  sort: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

const OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "ilike", label: "contiene" },
  { value: "between", label: "entre" },
  { value: "is_null", label: "vacío" },
  { value: "not_null", label: "no vacío" },
];


export default function ReportBuilder({ t }: { t: any }) {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [currentReport, setCurrentReport] = useState<SavedReport | null>(null);
  const [datasetKey, setDatasetKey] = useState<string>("");
  const [config, setConfig] = useState<ReportConfig>({
    columns: [], filters: [], group_by: [], aggregations: {}, sort: [], limit: 1000,
  });
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const [ds, sv] = await Promise.all([
        api.get<DatasetMeta[]>("/reports/datasets"),
        api.get<SavedReport[]>("/reports/saved"),
      ]);
      setDatasets(ds.data);
      setSaved(sv.data);
      if (!datasetKey && ds.data.length) setDatasetKey(ds.data[0].key);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar");
    }
  }, [datasetKey]);

  useEffect(() => { load(); }, []);

  const ds = useMemo(() => datasets.find(d => d.key === datasetKey), [datasets, datasetKey]);

  const loadReport = (r: SavedReport) => {
    setCurrentReport(r);
    setDatasetKey(r.dataset);
    setConfig({ ...config, ...r.config });
    setName(r.name);
    setDescription(r.description || "");
    setIsShared(r.is_shared);
    setResult(null);
  };

  const newReport = () => {
    setCurrentReport(null);
    setName("");
    setDescription("");
    setIsShared(false);
    setConfig({ columns: [], filters: [], group_by: [], aggregations: {}, sort: [], limit: 1000 });
    setResult(null);
  };

  const run = async () => {
    setRunning(true); setError(null);
    try {
      const payload = { dataset: datasetKey, ...config };
      const r = await api.post("/reports/run", payload);
      setResult(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al ejecutar");
    } finally { setRunning(false); }
  };

  const save = async () => {
    if (!name.trim()) { alert("Nombre requerido"); return; }
    setSaving(true);
    try {
      const payload = {
        name, description, dataset: datasetKey, config,
        is_shared: isShared, is_favorite: currentReport?.is_favorite || false,
      };
      if (currentReport) {
        const r = await api.put(`/reports/saved/${currentReport.id}`, payload);
        setCurrentReport(r.data);
      } else {
        const r = await api.post("/reports/saved", payload);
        setCurrentReport(r.data);
      }
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!currentReport) return;
    if (!confirm(`¿Eliminar "${currentReport.name}"?`)) return;
    try {
      await api.delete(`/reports/saved/${currentReport.id}`);
      newReport();
      await load();
    } catch { alert("Error"); }
  };

  const toggleFavorite = async (r: SavedReport) => {
    try {
      await api.put(`/reports/saved/${r.id}`, { is_favorite: !r.is_favorite });
      await load();
    } catch { }
  };

  const downloadXlsx = async () => {
    if (currentReport) {
      const res = await api.get(`/reports/saved/${currentReport.id}/run.xlsx`, { responseType: "blob" });
      _download(res, `${currentReport.name}.xlsx`);
    } else {
      const res = await api.post(`/reports/run.xlsx`, { dataset: datasetKey, name: name || "Reporte", ...config },
        { responseType: "blob" });
      _download(res, `${name || "Reporte"}.xlsx`);
    }
  };

  const toggleColumn = (alias: string) => {
    setConfig(prev => ({
      ...prev,
      columns: prev.columns.includes(alias)
        ? prev.columns.filter(c => c !== alias)
        : [...prev.columns, alias],
    }));
  };

  const toggleGroupBy = (alias: string) => {
    setConfig(prev => ({
      ...prev,
      group_by: prev.group_by.includes(alias)
        ? prev.group_by.filter(g => g !== alias)
        : [...prev.group_by, alias],
    }));
  };

  const setAggregation = (alias: string, agg: string | null) => {
    setConfig(prev => {
      const next = { ...prev.aggregations };
      if (agg == null || agg === "") delete next[alias];
      else next[alias] = agg as any;
      return { ...prev, aggregations: next };
    });
  };

  const addFilter = () => {
    if (!ds) return;
    const firstField = ds.fields[0];
    setConfig(prev => ({
      ...prev,
      filters: [...prev.filters, { field: firstField.alias, op: "eq", value: "" }],
    }));
  };

  const updateFilter = (i: number, patch: Partial<{ field: string; op: FilterOp; value: any }>) => {
    setConfig(prev => ({
      ...prev,
      filters: prev.filters.map((f, idx) => idx === i ? { ...f, ...patch } : f),
    }));
  };

  const removeFilter = (i: number) => {
    setConfig(prev => ({ ...prev, filters: prev.filters.filter((_, idx) => idx !== i) }));
  };

  const filteredSaved = useMemo(() => {
    if (!q.trim()) return saved;
    const qs = q.toLowerCase();
    return saved.filter(r => r.name.toLowerCase().includes(qs)
      || (r.description || "").toLowerCase().includes(qs));
  }, [saved, q]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, minHeight: 600 }}>
      {/* ─── Sidebar: reportes guardados ─── */}
      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>Reportes guardados</div>
          <button onClick={newReport} title="Nuevo"
            style={{ padding: 4, borderRadius: 6, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer" }}>
            <Plus size={13} />
          </button>
        </div>
        <div style={{ position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…"
            style={{ padding: "5px 8px 5px 26px", borderRadius: 6, border: `1px solid ${t.border}`, background: t.panel2, color: t.textHi, fontSize: 12, width: "100%", boxSizing: "border-box", outline: "none" }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {filteredSaved.length === 0 && (
            <div style={{ fontSize: 11.5, color: t.textLo, padding: 12, textAlign: "center" }}>
              Sin reportes guardados
            </div>
          )}
          {filteredSaved.map(r => (
            <div key={r.id} onClick={() => loadReport(r)}
              style={{
                padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                background: currentReport?.id === r.id ? t.nova + "22" : t.panel2,
                border: currentReport?.id === r.id ? `1px solid ${t.nova}55` : "1px solid transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <button onClick={(e) => { e.stopPropagation(); toggleFavorite(r); }}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
                <Star size={12} fill={r.is_favorite ? t.warn : "none"} color={r.is_favorite ? t.warn : t.textLo} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                <div style={{ fontSize: 10, color: t.textLo }}>
                  {r.dataset.replace(/_/g, " ")}
                  {r.is_shared && <span style={{ marginLeft: 4, color: t.nova }}>· compartido</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Main builder ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="Nombre del reporte"
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel, color: t.textHi, fontSize: 15, fontWeight: 700, width: "100%", boxSizing: "border-box", outline: "none" }} />
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Descripción (opcional)"
              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "transparent", color: t.textMid, fontSize: 12, width: "100%", marginTop: 4, outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: t.panel2, borderRadius: 8, cursor: "pointer", fontSize: 12, color: t.textMid }}>
              <input type="checkbox" checked={isShared} onChange={e => setIsShared(e.target.checked)} style={{ margin: 0 }} />
              <Share2 size={12} /> Compartido
            </label>
            <button onClick={run} disabled={running} style={primBtn(t)}>
              <Play size={13} /> {running ? "…" : "Ejecutar"}
            </button>
            <button onClick={save} disabled={saving} style={secBtn(t)}>
              <Save size={13} /> {saving ? "…" : currentReport ? "Guardar" : "Guardar"}
            </button>
            {currentReport && (
              <button onClick={remove} style={{ ...secBtn(t), color: t.bad }}>
                <Trash2 size={13} />
              </button>
            )}
            <button onClick={downloadXlsx} style={secBtn(t)}>
              <Download size={13} /> XLSX
            </button>
            <button onClick={load} style={secBtn(t)}><RefreshCw size={13} /></button>
          </div>
        </div>

        {/* Dataset picker */}
        <div style={{ padding: 10, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Dataset</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {datasets.map(d => (
              <button key={d.key} onClick={() => { setDatasetKey(d.key); setConfig({ ...config, columns: [], group_by: [], aggregations: {}, filters: [], sort: [] }); setResult(null); }}
                style={{
                  padding: "6px 12px", borderRadius: 6,
                  border: `1px solid ${datasetKey === d.key ? t.nova : t.border}`,
                  background: datasetKey === d.key ? t.nova + "18" : t.panel2,
                  color: datasetKey === d.key ? t.nova : t.textMid,
                  cursor: "pointer", fontSize: 12, fontWeight: 600,
                }}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {ds && (
          <>
            {/* Config grid: columns | group by | aggregations */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {/* Columns */}
              <div style={panelStyle(t)}>
                <div style={panelTitle(t)}>Columnas visibles</div>
                <div style={panelBody()}>
                  {ds.fields.map(f => (
                    <label key={f.alias} style={rowStyle(t)}>
                      <input type="checkbox"
                        checked={config.columns.includes(f.alias)}
                        onChange={() => toggleColumn(f.alias)} />
                      <span style={{ fontSize: 12, color: t.textMid }}>{f.label}</span>
                      <span style={typeBadge(t, f.type)}>{f.type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Group by */}
              <div style={panelStyle(t)}>
                <div style={panelTitle(t)}>Agrupar por</div>
                <div style={panelBody()}>
                  {ds.fields.filter(f => ds.groupable.includes(f.alias)).map(f => (
                    <label key={f.alias} style={rowStyle(t)}>
                      <input type="checkbox"
                        checked={config.group_by.includes(f.alias)}
                        onChange={() => toggleGroupBy(f.alias)} />
                      <span style={{ fontSize: 12, color: t.textMid }}>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Aggregations */}
              <div style={panelStyle(t)}>
                <div style={panelTitle(t)}>Agregaciones</div>
                <div style={panelBody()}>
                  {ds.fields.filter(f => f.allowed_aggs.length > 0).map(f => (
                    <div key={f.alias} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px" }}>
                      <span style={{ flex: 1, fontSize: 12, color: t.textMid, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</span>
                      <select
                        value={config.aggregations[f.alias] || ""}
                        onChange={e => setAggregation(f.alias, e.target.value || null)}
                        style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${t.border}`, background: t.panel2, color: t.textHi, fontSize: 11, outline: "none" }}>
                        <option value="">—</option>
                        {f.allowed_aggs.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Filtros */}
            <div style={panelStyle(t)}>
              <div style={{ ...panelTitle(t), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span><Filter size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> Filtros</span>
                <button onClick={addFilter} style={{ padding: "3px 10px", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 6, color: t.textMid, cursor: "pointer", fontSize: 11 }}>
                  <Plus size={11} /> Agregar
                </button>
              </div>
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {config.filters.length === 0 && (
                  <div style={{ fontSize: 11.5, color: t.textLo, textAlign: "center", padding: 8 }}>
                    Sin filtros — el reporte incluirá todos los registros
                  </div>
                )}
                {config.filters.map((f, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr auto", gap: 6, alignItems: "center" }}>
                    <select value={f.field} onChange={e => updateFilter(i, { field: e.target.value })} style={inpSm(t)}>
                      {ds.fields.map(x => <option key={x.alias} value={x.alias}>{x.label}</option>)}
                    </select>
                    <select value={f.op} onChange={e => updateFilter(i, { op: e.target.value as FilterOp })} style={inpSm(t)}>
                      {OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {f.op !== "is_null" && f.op !== "not_null" && (
                      f.op === "between" ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <input value={Array.isArray(f.value) ? f.value[0] || "" : ""}
                            onChange={e => updateFilter(i, { value: [e.target.value, Array.isArray(f.value) ? f.value[1] || "" : ""] })}
                            placeholder="min" style={{ ...inpSm(t), flex: 1 }} />
                          <input value={Array.isArray(f.value) ? f.value[1] || "" : ""}
                            onChange={e => updateFilter(i, { value: [Array.isArray(f.value) ? f.value[0] || "" : "", e.target.value] })}
                            placeholder="max" style={{ ...inpSm(t), flex: 1 }} />
                        </div>
                      ) : (
                        <input value={f.value || ""} onChange={e => updateFilter(i, { value: e.target.value })}
                          placeholder="valor" style={inpSm(t)} />
                      )
                    )}
                    <button onClick={() => removeFilter(i)}
                      style={{ padding: 5, background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.bad, cursor: "pointer" }}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Resultado */}
            {error && (
              <div style={{ padding: 10, background: (t.bad || "#ef4444") + "18", color: t.bad, borderRadius: 8, fontSize: 12.5 }}>
                {error}
              </div>
            )}

            {result && (
              <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: t.textLo }}>
                    <b style={{ color: t.textHi }}>{result.row_count}</b> filas
                    {result.truncated && <span style={{ color: t.warn, marginLeft: 8 }}>(truncado al límite)</span>}
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 480 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3, position: "sticky", top: 0 }}>
                        {result.columns.map((c: any) => (
                          <th key={c.alias} style={{ padding: "8px 10px", textAlign: c.type === "money" || c.type === "number" ? "right" : "left", whiteSpace: "nowrap" }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row: any, i: number) => (
                        <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}>
                          {result.columns.map((c: any) => {
                            const v = row[c.alias];
                            let display = v ?? "";
                            if (v != null && (c.type === "money" || c.type === "number")) {
                              display = "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            } else if (v != null && c.type === "int") {
                              display = Number(v).toLocaleString("es-MX");
                            } else if (v != null && c.type === "date") {
                              display = String(v).slice(0, 10);
                            }
                            return (
                              <td key={c.alias} style={{ padding: "7px 10px", textAlign: c.type === "money" || c.type === "number" || c.type === "int" ? "right" : "left", color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// helpers
function _download(res: any, filename: string) {
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
const panelStyle = (t: any): React.CSSProperties => ({
  background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden",
});
const panelTitle = (t: any): React.CSSProperties => ({
  padding: "8px 12px", background: t.panel2, borderBottom: `1px solid ${t.border}`,
  fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700,
});
const panelBody = (): React.CSSProperties => ({
  padding: 4, maxHeight: 260, overflowY: "auto",
});
const rowStyle = (t: any): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
  cursor: "pointer", borderRadius: 4,
});
const typeBadge = (t: any, type: string): React.CSSProperties => ({
  marginLeft: "auto", fontSize: 9, padding: "1px 6px", borderRadius: 3,
  background: t.panel2, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4,
});
const inpSm = (t: any): React.CSSProperties => ({
  padding: "5px 8px", borderRadius: 4, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textHi, fontSize: 12, outline: "none",
  width: "100%", boxSizing: "border-box",
});
const secBtn = (t: any): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 12px",
  borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2,
  color: t.textMid, cursor: "pointer", fontSize: 12,
});
const primBtn = (t: any): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px",
  borderRadius: 8, border: "none",
  background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
  color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600,
});
