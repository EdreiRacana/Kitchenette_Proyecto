// Ajuste Anual del ISR (LISR arts. 97 y 116).
// Tab con historial + wizard nuevo cálculo + tabla con semáforo saldo a favor/cargo.

import { useCallback, useEffect, useState } from "react";
import {
  Calculator, Download, FileText, RefreshCw, Plus, Check,
  AlertTriangle, X, Trash2, TrendingUp, TrendingDown, Users, Info,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mxn0 = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const EXCL_LABEL: Record<string, string> = {
  declara_propia: "Empleado presenta declaración propia (art. 97-B)",
  ingresos_excede_400k: "Ingresos anuales > $400,000 (art. 98-III)",
  alta_mid_year: "Ingresó después del 1° enero (art. 97-A IV)",
  baja_pre_diciembre: "Dejó de laborar antes del 1° diciembre (art. 97-A I)",
};

export default function AnnualIsrTab({ t }: { t: any }) {
  const now = new Date();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [wizardYear, setWizardYear] = useState(now.getFullYear() - 1);
  const [showWizard, setShowWizard] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const l = await hrApi.annualIsrList();
      setList(l);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const d = await hrApi.annualIsrPreview(wizardYear);
      setPreviewData(d);
      setSelected(null);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const d = await hrApi.annualIsrSave(wizardYear);
      setSelected(d); setPreviewData(null); setShowWizard(false);
      await loadList();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    } finally { setBusy(false); }
  };

  const openAdj = async (id: number) => {
    setBusy(true);
    try {
      const d = await hrApi.annualIsrGet(id);
      setSelected(d); setPreviewData(null);
    } finally { setBusy(false); }
  };

  const removeAdj = async (id: number) => {
    if (!confirm("¿Eliminar este ajuste? Solo si no está aplicado.")) return;
    try {
      await hrApi.annualIsrDelete(id);
      if (selected?.id === id) setSelected(null);
      await loadList();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    }
  };

  const approve = async () => {
    if (!selected) return;
    if (!confirm(`¿Aprobar el ajuste ${selected.period_year}? Después no se puede editar.`)) return;
    setBusy(true);
    try {
      const d = await hrApi.annualIsrApprove(selected.id);
      setSelected(d); await loadList();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  const data = selected || previewData;
  const isPreview = !selected && !!previewData;
  const totals = data?.totals || _emptyTotals();
  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: t.textHi, fontSize: 18, fontWeight: 700 }}>Ajuste anual del ISR</h2>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>
            LISR arts. 97 y 116 · El patrón compara el ISR retenido durante el año contra el ISR causado sobre los ingresos gravables anuales.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={loadList} style={btnGhost(t)}><RefreshCw size={14} /></button>
          <button onClick={() => { setShowWizard(true); setSelected(null); setPreviewData(null); }}
            style={btnPrimary(t)}>
            <Plus size={14} /> Nuevo cálculo
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14 }}>
        {/* Sidebar historial */}
        <div style={{ ...glass, padding: 14, maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.textMid, marginBottom: 10,
                        textTransform: "uppercase", letterSpacing: 0.5 }}>
            Historial ({list.length})
          </div>
          {loading && <div style={{ color: t.textLo, fontSize: 13 }}>Cargando...</div>}
          {list.length === 0 && !loading && (
            <div style={{ color: t.textLo, fontSize: 12.5, padding: "12px 0" }}>
              Sin ajustes guardados. Corre uno con <b>Nuevo cálculo</b>.
            </div>
          )}
          {list.map(a => (
            <button key={a.id} onClick={() => openAdj(a.id)} style={{
              width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 8,
              borderRadius: 10, border: `1px solid ${selected?.id === a.id ? t.nova : t.border}`,
              background: selected?.id === a.id ? t.nova + "18" : t.panel2,
              color: t.textHi, cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Ejercicio {a.period_year}</div>
                <StatusBadge t={t} status={a.status} />
              </div>
              <div style={{ fontSize: 11, color: t.textLo, marginTop: 6 }}>
                A favor: <b style={{ color: t.good }}>{mxn0(a.total_saldo_a_favor)}</b>
                {" · "}
                A cargo: <b style={{ color: t.bad }}>{mxn0(a.total_saldo_a_cargo)}</b>
              </div>
              {a.status === "draft" && (
                <button onClick={e => { e.stopPropagation(); removeAdj(a.id); }}
                  style={{ marginTop: 6, padding: "3px 8px", borderRadius: 5, border: "none",
                           background: t.bad + "22", color: t.bad, cursor: "pointer",
                           fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Trash2 size={11} /> Eliminar
                </button>
              )}
            </button>
          ))}
        </div>

        {/* Detalle */}
        <div>
          {showWizard && (
            <div style={{ ...glass, padding: 18, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>Nuevo ajuste anual</div>
                  <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>
                    El ajuste toma todas las nóminas calculadas/aprobadas/dispersadas del año.
                  </div>
                </div>
                <button onClick={() => setShowWizard(false)} style={{ background: "transparent", border: "none", color: t.textMid, cursor: "pointer" }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={lbl(t)}>Año del ejercicio</label>
                  <input type="number" value={wizardYear} onChange={e => setWizardYear(Number(e.target.value))}
                    style={{ ...inp(t), width: 120 }} />
                </div>
                <button onClick={runPreview} disabled={busy} style={btnGhost(t)}>
                  <Calculator size={14} /> {busy ? "..." : "Preview"}
                </button>
                <button onClick={save} disabled={busy || !previewData} style={btnPrimary(t)}>
                  <Check size={14} /> Guardar como borrador
                </button>
              </div>
            </div>
          )}

          {!data && !showWizard && (
            <div style={{ ...glass, padding: 40, textAlign: "center", color: t.textLo }}>
              <Calculator size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div style={{ fontSize: 15, color: t.textMid, marginBottom: 4 }}>
                Selecciona un ajuste o crea uno nuevo
              </div>
              <div style={{ fontSize: 12 }}>
                El sistema aplica las exclusiones art. 97-A / 97-B automáticamente.
              </div>
            </div>
          )}

          {data && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ ...glass, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi }}>
                      Ejercicio {data.period_year}
                      {isPreview && <span style={{ marginLeft: 8, fontSize: 11, background: t.warn + "22",
                                                    color: t.warn, padding: "2px 8px", borderRadius: 4 }}>PREVIEW</span>}
                      {!isPreview && <span style={{ marginLeft: 8 }}><StatusBadge t={t} status={data.status} /></span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!isPreview && (
                      <>
                        <button onClick={() => hrApi.downloadAnnualIsrXlsx(data.id, data.period_year)}
                          style={btnGhost(t)}>
                          <Download size={14} /> XLSX
                        </button>
                        <button onClick={() => hrApi.downloadDimAnexo1(data.period_year)}
                          title="DIM Anexo 1 — layout .txt para programa DIM SAT"
                          style={btnGhost(t)}>
                          <FileText size={14} /> DIM .txt
                        </button>
                      </>
                    )}
                    {!isPreview && data.status === "draft" && (
                      <button onClick={approve} disabled={busy} style={{
                        ...btnPrimary(t), background: `linear-gradient(135deg, ${t.good}, #059669)`,
                      }}>
                        <Check size={14} /> Aprobar
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {data.warnings?.length > 0 && (
                <div style={{ ...glass, padding: 12, background: t.warn + "10", border: `1px solid ${t.warn}44` }}>
                  {data.warnings.map((w: string, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: t.warn, display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} /> {w}
                    </div>
                  ))}
                </div>
              )}

              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <KpiCard t={t} icon={Users} label="Empleados con ajuste"
                         value={String((totals.total_employees || 0) - (totals.total_excluded || 0))}
                         sub={`${totals.total_excluded || 0} excluidos`} color={t.nova} />
                <KpiCard t={t} icon={Calculator} label="ISR retenido total"
                         value={mxn0(totals.total_isr_retenido)}
                         sub={`Causado: ${mxn0(totals.total_isr_causado)}`} color={t.textMid} />
                <KpiCard t={t} icon={TrendingUp} label="Saldo a favor total"
                         value={mxn0(totals.total_saldo_a_favor)}
                         sub="Devolver a empleados" color={t.good} />
                <KpiCard t={t} icon={TrendingDown} label="Saldo a cargo total"
                         value={mxn0(totals.total_saldo_a_cargo)}
                         sub="Retener en próximas nóminas" color={t.bad} />
              </div>

              {/* Tabla */}
              <div style={{ ...glass, overflow: "auto", maxHeight: "55vh" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200, fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                      <th style={th(t, 240, true)}>Empleado</th>
                      <th style={th(t, 110)}>Depto</th>
                      <th style={{ ...th(t, 120), textAlign: "right" }}>Ingresos anual</th>
                      <th style={{ ...th(t, 120), textAlign: "right" }}>Gravable</th>
                      <th style={{ ...th(t, 110), textAlign: "right" }}>ISR retenido</th>
                      <th style={{ ...th(t, 110), textAlign: "right" }}>ISR causado</th>
                      <th style={{ ...th(t, 110), textAlign: "right" }}>Diferencia</th>
                      <th style={th(t, 130)}>Estado</th>
                      <th style={th(t, 60)}>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rows || []).map((r: any, i: number) => {
                      const isExcl = r.excluded;
                      const afavor = !isExcl && r.diferencia > 0.5;
                      const acargo = !isExcl && r.diferencia < -0.5;
                      const bg = isExcl ? t.warn + "10"
                              : afavor ? t.good + "10"
                              : acargo ? t.bad + "10"
                              : i % 2 === 0 ? t.panel : t.panel2 + "80";
                      return (
                        <tr key={r.employee_id} style={{ borderTop: `1px solid ${t.border}`, background: bg }}>
                          <td style={{ ...td(t), position: "sticky", left: 0, background: "inherit" }}>
                            <div style={{ fontWeight: 600, color: t.textHi }}>{r.employee_name}</div>
                            <div style={{ fontSize: 10.5, color: t.textLo }}>
                              #{r.employee_number}
                              {r.declares_own_annual && <span style={{ marginLeft: 6, color: t.warn }}>· DECL. PROPIA</span>}
                            </div>
                          </td>
                          <td style={td(t)}>{r.department || ""}</td>
                          <td style={{ ...td(t), textAlign: "right" }}>{mxn0(r.total_ingresos)}</td>
                          <td style={{ ...td(t), textAlign: "right" }}>{mxn0(r.total_gravable)}</td>
                          <td style={{ ...td(t), textAlign: "right" }}>{mxn0(r.total_isr_retenido)}</td>
                          <td style={{ ...td(t), textAlign: "right" }}>{mxn0(r.isr_causado_anual)}</td>
                          <td style={{ ...td(t), textAlign: "right", fontWeight: 700,
                                       color: isExcl ? t.textLo : afavor ? t.good : acargo ? t.bad : t.textMid }}>
                            {isExcl ? "—" : (r.diferencia > 0 ? "+" : "") + mxn(r.diferencia)}
                          </td>
                          <td style={td(t)}>
                            {isExcl && <span title={EXCL_LABEL[r.excluded_reason]}
                                              style={{ color: t.warn, fontSize: 10.5, fontWeight: 700 }}>NO APLICA</span>}
                            {!isExcl && afavor && <span style={{ color: t.good, fontSize: 10.5, fontWeight: 700 }}>A FAVOR</span>}
                            {!isExcl && acargo && <span style={{ color: t.bad, fontSize: 10.5, fontWeight: 700 }}>A CARGO</span>}
                            {!isExcl && !afavor && !acargo && <span style={{ color: t.textMid, fontSize: 10.5 }}>SIN DIF.</span>}
                          </td>
                          <td style={td(t)}>
                            <button onClick={() => hrApi.downloadAnnualIsrConstancia(
                              data.period_year, r.employee_id, r.employee_number)}
                              title="Constancia art. 99 LISR"
                              style={{ background: "transparent", border: "none",
                                       color: t.nova, cursor: "pointer", padding: 4 }}>
                              <FileText size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Leyenda */}
              <div style={{ ...glass, padding: 12, fontSize: 11.5, color: t.textLo,
                            display: "flex", gap: 16, flexWrap: "wrap" }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.good, borderRadius: 2, marginRight: 6 }} />
                  Saldo a favor (devolver al empleado)</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.bad, borderRadius: 2, marginRight: 6 }} />
                  Saldo a cargo (retener en próximas nóminas)</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.warn, borderRadius: 2, marginRight: 6 }} />
                  Excluido (art. 97-A / 97-B)</span>
                <span>DECL. PROPIA = empleado marcó que hará su propia declaración</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function StatusBadge({ t, status }: { t: any; status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    draft:    { bg: t.textLo + "22", fg: t.textMid, label: "Borrador" },
    approved: { bg: t.nova + "22", fg: t.nova, label: "Aprobado" },
    applied:  { bg: t.good + "22", fg: t.good, label: "Aplicado" },
  };
  const s = map[status] || map.draft;
  return (
    <span style={{ background: s.bg, color: s.fg, fontSize: 10.5, fontWeight: 700,
                    padding: "2px 8px", borderRadius: 4, letterSpacing: 0.3 }}>
      {s.label.toUpperCase()}
    </span>
  );
}

function KpiCard({ t, icon: Icon, label, value, sub, color }: any) {
  return (
    <div style={{
      background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: 14, display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: color + "22", color, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.textHi, marginTop: 2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function _emptyTotals() {
  return {
    total_employees: 0, total_excluded: 0,
    total_ingresos: 0, total_isr_retenido: 0, total_isr_causado: 0,
    total_saldo_a_favor: 0, total_saldo_a_cargo: 0,
  };
}

const th = (t: any, w: number, sticky = false): React.CSSProperties => ({
  padding: "10px 10px", textAlign: "left", color: t.textMid, fontSize: 11,
  fontWeight: 700, minWidth: w, whiteSpace: "nowrap",
  position: sticky ? "sticky" : undefined,
  left: sticky ? 0 : undefined, background: sticky ? t.panel2 : undefined,
  zIndex: sticky ? 2 : undefined,
  borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3,
});
const td = (t: any): React.CSSProperties => ({
  padding: "8px 10px", color: t.textHi, fontSize: 12, verticalAlign: "middle",
});
const inp = (t: any): React.CSSProperties => ({
  padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none",
});
const lbl = (t: any): React.CSSProperties => ({
  display: "block", fontSize: 11.5, color: t.textMid, marginBottom: 4, fontWeight: 600,
});
const btnGhost = (t: any): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13,
});
const btnPrimary = (t: any): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8, border: "none",
  background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
  color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
});
