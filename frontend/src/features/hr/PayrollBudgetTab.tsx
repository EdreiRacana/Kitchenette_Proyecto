// Presupuesto anual de nómina por empleado — matriz editable con variance.
// Empleados en filas × 12 meses en columnas. Modo "Capturar" edita el
// presupuesto; modo "Variación" compara vs. costo real de nómina con
// semáforo (rojo si real supera el presupuesto en > 5%).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download, RefreshCw, Save, Copy, Plus, AlertTriangle,
  CheckCircle, TrendingDown, TrendingUp,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const mxn2 = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
               "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MCOLS = ["m1", "m2", "m3", "m4", "m5", "m6",
               "m7", "m8", "m9", "m10", "m11", "m12"];

type Employee = { id: number; employee_number: string; name: string; last_name: string; department?: string; position?: string; is_active?: boolean };
type Row = {
  id?: number; employee_id: number;
  employee_number?: string; employee_name?: string;
  department?: string; position?: string;
  m1?: number; m2?: number; m3?: number; m4?: number; m5?: number; m6?: number;
  m7?: number; m8?: number; m9?: number; m10?: number; m11?: number; m12?: number;
  annual_total?: number; notes?: string;
  // variance-mode extras
  budget_monthly?: number[]; real_monthly?: number[]; variance_monthly?: number[];
  variance_pct_monthly?: (number | null)[];
  budget_ytd?: number; real_ytd?: number; variance_ytd?: number;
  variance_pct_ytd?: number | null;
};

export default function PayrollBudgetTab({
  t, employees,
}: { t: any; employees: Employee[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [mode, setMode] = useState<"capture" | "variance">("capture");
  const [rows, setRows] = useState<Row[]>([]);
  const [variance, setVariance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showCopy, setShowCopy] = useState(false);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = now.getFullYear() + 2; y >= 2020; y--) out.push(y);
    return out;
  }, [now]);

  const loadCapture = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await hrApi.listPayrollBudgets(year);
      // Merge con empleados activos que aún no tienen presupuesto (para poder capturar)
      const byId: Record<number, Row> = {};
      for (const r of list) byId[r.employee_id] = r;
      const active = employees.filter(e => e.is_active !== false);
      for (const e of active) {
        if (!byId[e.id]) {
          byId[e.id] = {
            employee_id: e.id, employee_number: e.employee_number,
            employee_name: `${e.name} ${e.last_name}`,
            department: e.department, position: e.position,
            m1: 0, m2: 0, m3: 0, m4: 0, m5: 0, m6: 0,
            m7: 0, m8: 0, m9: 0, m10: 0, m11: 0, m12: 0,
            annual_total: 0,
          };
        }
      }
      const merged = Object.values(byId).sort((a, b) =>
        (a.department || "").localeCompare(b.department || "") ||
        (a.employee_name || "").localeCompare(b.employee_name || "")
      );
      setRows(merged);
      setDirty(new Set());
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar presupuestos");
    } finally { setLoading(false); }
  }, [year, employees]);

  const loadVariance = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const v = await hrApi.getPayrollBudgetVariance(year);
      setVariance(v);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar variación");
    } finally { setLoading(false); }
  }, [year]);

  useEffect(() => {
    if (mode === "capture") loadCapture();
    else loadVariance();
  }, [mode, loadCapture, loadVariance]);

  const editCell = (empId: number, col: string, value: string) => {
    const num = value === "" ? 0 : Number(value.replace(/[^0-9.]/g, ""));
    setRows(prev => prev.map(r => {
      if (r.employee_id !== empId) return r;
      const next: Row = { ...r, [col]: isNaN(num) ? 0 : num };
      next.annual_total = MCOLS.reduce((s, c) => s + Number((next as any)[c] || 0), 0);
      return next;
    }));
    setDirty(prev => new Set(prev).add(empId));
  };

  const applyToAllMonths = (empId: number, value: number) => {
    setRows(prev => prev.map(r => {
      if (r.employee_id !== empId) return r;
      const next: Row = { ...r };
      for (const c of MCOLS) (next as any)[c] = value;
      next.annual_total = value * 12;
      return next;
    }));
    setDirty(prev => new Set(prev).add(empId));
  };

  const saveRow = async (row: Row) => {
    setSaving(row.employee_id);
    try {
      const payload: any = {
        employee_id: row.employee_id, period_year: year,
      };
      for (const c of MCOLS) payload[c] = Number((row as any)[c] || 0);
      const saved = await hrApi.upsertPayrollBudget(payload);
      setRows(prev => prev.map(r =>
        r.employee_id === row.employee_id ? { ...r, ...saved } : r
      ));
      setDirty(prev => {
        const next = new Set(prev); next.delete(row.employee_id); return next;
      });
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    } finally { setSaving(null); }
  };

  const saveAll = async () => {
    if (dirty.size === 0) return;
    const dirtyRows = rows.filter(r => dirty.has(r.employee_id));
    for (const r of dirtyRows) await saveRow(r);
  };

  const totalAnnual = useMemo(
    () => rows.reduce((s, r) => s + Number(r.annual_total || 0), 0),
    [rows]
  );

  const totalByMonth = useMemo(() => {
    const out = new Array(12).fill(0);
    for (const r of rows) {
      for (let i = 0; i < 12; i++) out[i] += Number((r as any)[MCOLS[i]] || 0);
    }
    return out;
  }, [rows]);

  const varRowColor = (pct: number | null | undefined): string => {
    if (pct == null) return t.textLo;
    if (pct <= -5) return t.good;   // gastó menos de lo presupuestado
    if (pct <= 5) return t.textMid;  // dentro de tolerancia
    return t.bad;
  };

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  // ── Toolbar ────────────────────────────────────────────────────────────
  const Toolbar = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6, background: t.panel2, padding: 4, borderRadius: 10, border: `1px solid ${t.border}` }}>
        <button onClick={() => setMode("capture")} style={{
          padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
          background: mode === "capture" ? t.nova : "transparent",
          color: mode === "capture" ? "#fff" : t.textMid,
          fontWeight: 600, fontSize: 13,
        }}>Capturar presupuesto</button>
        <button onClick={() => setMode("variance")} style={{
          padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
          background: mode === "variance" ? t.nova : "transparent",
          color: mode === "variance" ? "#fff" : t.textMid,
          fontWeight: 600, fontSize: 13,
        }}>Variación vs real</button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ color: t.textMid, fontSize: 13 }}>Año</label>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
                   background: t.inputBg, color: t.textHi, fontSize: 13 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <button onClick={() => setShowCopy(true)} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
          borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2,
          color: t.textMid, cursor: "pointer", fontSize: 13,
        }}>
          <Copy size={14} /> Copiar de año
        </button>

        {mode === "capture" && (
          <button onClick={saveAll} disabled={dirty.size === 0} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
            borderRadius: 8, border: "none",
            background: dirty.size > 0
              ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : t.panel2,
            color: dirty.size > 0 ? "#fff" : t.textLo,
            cursor: dirty.size > 0 ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600,
          }}>
            <Save size={14} /> Guardar cambios ({dirty.size})
          </button>
        )}

        {mode === "variance" && (
          <button onClick={() => hrApi.downloadPayrollBudgetVarianceXlsx(year)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
            borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${t.good}, #059669)`,
            color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}>
            <Download size={14} /> Descargar XLSX
          </button>
        )}

        <button onClick={() => mode === "capture" ? loadCapture() : loadVariance()}
          style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
                   background: t.panel2, color: t.textMid, cursor: "pointer" }}>
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );

  // ── Capture mode ───────────────────────────────────────────────────────
  const CaptureTable = (
    <div style={{ ...glass, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400, fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: t.panel2, position: "sticky", top: 0, zIndex: 1 }}>
            <th style={thStyle(t, 240, true)}>Empleado</th>
            <th style={thStyle(t, 130)}>Depto.</th>
            {MESES.map(m => <th key={m} style={{ ...thStyle(t, 90), textAlign: "right" }}>{m}</th>)}
            <th style={{ ...thStyle(t, 110), textAlign: "right", background: t.nova + "22" }}>Total anual</th>
            <th style={{ ...thStyle(t, 100), textAlign: "center" }}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={16} style={{ textAlign: "center", padding: 32, color: t.textLo }}>
              {loading ? "Cargando..." : "No hay empleados activos"}
            </td></tr>
          )}
          {rows.map((r, ri) => {
            const isDirty = dirty.has(r.employee_id);
            return (
              <tr key={r.employee_id} style={{
                borderTop: `1px solid ${t.border}`,
                background: isDirty ? t.warn + "0f" : ri % 2 === 0 ? t.panel : t.panel2 + "80",
              }}>
                <td style={{ ...tdStyle(t), position: "sticky", left: 0, background: "inherit" }}>
                  <div style={{ fontWeight: 600, color: t.textHi }}>{r.employee_name}</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>#{r.employee_number} · {r.position}</div>
                </td>
                <td style={tdStyle(t)}>{r.department}</td>
                {MCOLS.map(c => (
                  <td key={c} style={{ ...tdStyle(t), textAlign: "right", padding: "4px 6px" }}>
                    <input value={(r as any)[c] || 0}
                      onChange={e => editCell(r.employee_id, c, e.target.value)}
                      type="number" step="0.01" min="0"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6,
                               border: `1px solid ${t.border}`, background: t.inputBg,
                               color: t.textHi, textAlign: "right", fontSize: 12.5 }} />
                  </td>
                ))}
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.nova }}>
                  {mxn(r.annual_total)}
                </td>
                <td style={{ ...tdStyle(t), textAlign: "center" }}>
                  {isDirty ? (
                    <button onClick={() => saveRow(r)} disabled={saving === r.employee_id}
                      style={{ padding: "5px 10px", borderRadius: 6, border: "none",
                               background: t.nova, color: "#fff", cursor: "pointer",
                               fontSize: 11, fontWeight: 600 }}>
                      {saving === r.employee_id ? "..." : "Guardar"}
                    </button>
                  ) : (
                    <button onClick={() => {
                      const v = prompt(`Copiar el mismo monto a los 12 meses de ${r.employee_name}:`, "0");
                      if (v != null) {
                        const num = Number(v);
                        if (!isNaN(num)) applyToAllMonths(r.employee_id, num);
                      }
                    }} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${t.border}`,
                                background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 11 }}>
                      = 12
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr style={{ background: t.nova + "18", borderTop: `2px solid ${t.nova}` }}>
              <td style={{ ...tdStyle(t), fontWeight: 800, color: t.textHi, position: "sticky", left: 0, background: t.nova + "18" }}>TOTALES</td>
              <td style={tdStyle(t)}></td>
              {totalByMonth.map((v, i) => (
                <td key={i} style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>
                  {mxn(v)}
                </td>
              ))}
              <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800, color: t.nova, fontSize: 14 }}>
                {mxn(totalAnnual)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );

  // ── Variance mode ──────────────────────────────────────────────────────
  const VarianceView = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {variance && variance.totals && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          <KpiCard t={t} label="Presupuesto anual" value={mxn2(variance.totals.budget_ytd)} color={t.nova} icon={TrendingUp} />
          <KpiCard t={t} label="Costo real acumulado" value={mxn2(variance.totals.real_ytd)} color={t.textMid} icon={TrendingDown} />
          <KpiCard t={t} label="Variación absoluta"
            value={mxn2(variance.totals.variance_ytd)}
            color={variance.totals.variance_ytd > 0 ? t.bad : t.good}
            icon={variance.totals.variance_ytd > 0 ? AlertTriangle : CheckCircle} />
          <KpiCard t={t} label="% de ejecución"
            value={variance.totals.budget_ytd > 0
              ? `${((variance.totals.real_ytd / variance.totals.budget_ytd) * 100).toFixed(1)}%`
              : "—"}
            color={t.nova} icon={TrendingUp} />
        </div>
      )}

      <div style={{ ...glass, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1600, fontSize: 12 }}>
          <thead>
            <tr style={{ background: t.panel2 }}>
              <th style={thStyle(t, 220, true)}>Empleado</th>
              <th style={thStyle(t, 120)}>Depto.</th>
              {MESES.map(m => (
                <th key={m} style={{ ...thStyle(t, 90), textAlign: "center" }}>{m}</th>
              ))}
              <th style={{ ...thStyle(t, 100), textAlign: "right", background: t.nova + "1a" }}>YTD Presup.</th>
              <th style={{ ...thStyle(t, 100), textAlign: "right", background: t.nova + "1a" }}>YTD Real</th>
              <th style={{ ...thStyle(t, 90), textAlign: "right", background: t.nova + "1a" }}>Var. %</th>
            </tr>
          </thead>
          <tbody>
            {variance?.rows?.length === 0 && (
              <tr><td colSpan={17} style={{ textAlign: "center", padding: 32, color: t.textLo }}>
                {loading ? "Cargando..." : "No hay presupuestos capturados para este año"}
              </td></tr>
            )}
            {variance?.rows?.map((r: Row, ri: number) => (
              <tr key={r.employee_id} style={{
                borderTop: `1px solid ${t.border}`,
                background: ri % 2 === 0 ? t.panel : t.panel2 + "80",
              }}>
                <td style={{ ...tdStyle(t), position: "sticky", left: 0, background: "inherit" }}>
                  <div style={{ fontWeight: 600, color: t.textHi }}>{r.employee_name}</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>#{r.employee_number}</div>
                </td>
                <td style={tdStyle(t)}>{r.department}</td>
                {r.budget_monthly?.map((_bv, i) => {
                  const bv = r.budget_monthly![i];
                  const rv = r.real_monthly![i];
                  const vpct = r.variance_pct_monthly?.[i];
                  return (
                    <td key={i} style={{ ...tdStyle(t), textAlign: "right", padding: "4px 6px" }}>
                      <div style={{ fontSize: 11, color: t.textLo }}>P: {mxn(bv)}</div>
                      <div style={{ fontWeight: 600, color: t.textMid }}>{mxn(rv)}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: varRowColor(vpct) }}>
                        {vpct != null ? `${vpct > 0 ? "+" : ""}${vpct.toFixed(1)}%` : "—"}
                      </div>
                    </td>
                  );
                })}
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700 }}>{mxn2(r.budget_ytd)}</td>
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700 }}>{mxn2(r.real_ytd)}</td>
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800, color: varRowColor(r.variance_pct_ytd) }}>
                  {r.variance_pct_ytd != null ? `${r.variance_pct_ytd > 0 ? "+" : ""}${r.variance_pct_ytd.toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {variance?.totals && variance?.rows?.length > 0 && (
            <tfoot>
              <tr style={{ background: t.nova + "18", borderTop: `2px solid ${t.nova}` }}>
                <td style={{ ...tdStyle(t), fontWeight: 800, position: "sticky", left: 0, background: t.nova + "18" }}>TOTALES</td>
                <td style={tdStyle(t)}></td>
                {MESES.map((_, i) => {
                  const bv = variance.totals.budget_monthly[i];
                  const rv = variance.totals.real_monthly[i];
                  const vpct = bv > 0.01 ? ((rv - bv) / bv) * 100 : null;
                  return (
                    <td key={i} style={{ ...tdStyle(t), textAlign: "right", padding: "4px 6px" }}>
                      <div style={{ fontSize: 11, color: t.textLo }}>P: {mxn(bv)}</div>
                      <div style={{ fontWeight: 700, color: t.textHi }}>{mxn(rv)}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: varRowColor(vpct) }}>
                        {vpct != null ? `${vpct > 0 ? "+" : ""}${vpct.toFixed(1)}%` : "—"}
                      </div>
                    </td>
                  );
                })}
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800, color: t.textHi }}>{mxn2(variance.totals.budget_ytd)}</td>
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800, color: t.textHi }}>{mxn2(variance.totals.real_ytd)}</td>
                <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800,
                             color: varRowColor(variance.totals.budget_ytd > 0
                                                ? ((variance.totals.real_ytd - variance.totals.budget_ytd) / variance.totals.budget_ytd) * 100
                                                : null) }}>
                  {variance.totals.budget_ytd > 0
                    ? `${(((variance.totals.real_ytd - variance.totals.budget_ytd) / variance.totals.budget_ytd) * 100).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div style={{ ...glass, padding: 14, fontSize: 12, color: t.textLo }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.good, borderRadius: 2, marginRight: 6 }} />
            Real ≤ Presupuesto − 5% (ahorro)</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.textMid, borderRadius: 2, marginRight: 6 }} />
            Dentro de tolerancia ±5%</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.bad, borderRadius: 2, marginRight: 6 }} />
            Real supera presupuesto en más de +5% (sobreejercicio)</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Fórmula real:</strong> Σ (Sueldo bruto + IMSS patronal + INFONAVIT patronal + ISN estatal) de todos los períodos de nómina calculados que iniciaron en el mes.
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, color: t.textHi, fontSize: 18, fontWeight: 700 }}>Presupuesto anual de nómina</h2>
        <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>
          Planea el costo laboral anual por empleado y compáralo mes a mes contra
          la nómina real (bruto + carga patronal). Base para P&amp;L de nómina y
          proyecciones de flujo.
        </p>
      </div>

      {error && (
        <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad,
                      borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12,
                      display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {Toolbar}
      {mode === "capture" ? CaptureTable : VarianceView}

      {showCopy && (
        <CopyFromYearModal t={t} currentYear={year}
          onClose={() => setShowCopy(false)}
          onDone={() => { setShowCopy(false); mode === "capture" ? loadCapture() : loadVariance(); }} />
      )}
    </div>
  );
}

// ── Helpers de estilo ─────────────────────────────────────────────────────

function thStyle(t: any, w: number, sticky = false): React.CSSProperties {
  return {
    padding: "10px 12px", textAlign: "left", color: t.textMid, fontSize: 12,
    fontWeight: 600, minWidth: w, whiteSpace: "nowrap",
    position: sticky ? "sticky" : undefined,
    left: sticky ? 0 : undefined, background: sticky ? t.panel2 : undefined,
    zIndex: sticky ? 2 : undefined,
    borderBottom: `1px solid ${t.border}`,
  };
}

function tdStyle(t: any): React.CSSProperties {
  return { padding: "8px 12px", color: t.textHi, fontSize: 12.5, verticalAlign: "middle" };
}

function KpiCard({ t, label, value, color, icon: Icon }: any) {
  return (
    <div style={{
      background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: 14, display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: color + "22", display: "flex",
        alignItems: "center", justifyContent: "center", color,
      }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

// ── Copy modal ────────────────────────────────────────────────────────────

function CopyFromYearModal({
  t, currentYear, onClose, onDone,
}: { t: any; currentYear: number; onClose: () => void; onDone: () => void }) {
  const [source, setSource] = useState(currentYear - 1);
  const [target, setTarget] = useState(currentYear);
  const [factor, setFactor] = useState(1.05);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await hrApi.copyPayrollBudgets(source, target, factor);
      alert(`Copiado exitoso: ${r.created} presupuestos creados`);
      onDone();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al copiar");
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.panel, borderRadius: 14, padding: 24, maxWidth: 480, width: "100%",
        border: `1px solid ${t.border}`,
      }}>
        <h3 style={{ margin: 0, color: t.textHi, fontSize: 17, marginBottom: 6 }}>Copiar presupuestos de otro año</h3>
        <p style={{ margin: "0 0 16px", color: t.textLo, fontSize: 13 }}>
          Duplica los montos del año origen al destino multiplicando por el factor.
          No sobreescribe presupuestos ya capturados.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: t.textMid, marginBottom: 4 }}>Año origen</label>
            <input type="number" value={source} onChange={e => setSource(Number(e.target.value))}
              style={inpS(t)} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: t.textMid, marginBottom: 4 }}>Año destino</label>
            <input type="number" value={target} onChange={e => setTarget(Number(e.target.value))}
              style={inpS(t)} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "block", fontSize: 12, color: t.textMid, marginBottom: 4 }}>
              Factor (1.05 = +5% aumento salarial)
            </label>
            <input type="number" step="0.01" value={factor} onChange={e => setFactor(Number(e.target.value))}
              style={inpS(t)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={{
            padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`,
            background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13,
          }}>Cancelar</button>
          <button onClick={run} disabled={busy} style={{
            padding: "9px 20px", borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
            color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <Plus size={14} /> {busy ? "Copiando..." : "Copiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inpS = (t: any): React.CSSProperties => ({
  width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none",
});
