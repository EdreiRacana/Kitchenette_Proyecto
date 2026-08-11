// PTU — Participación de Utilidades (LFT arts. 122-131 + reforma 2021).
// Tab con historial + wizard nuevo cálculo + preview con topes y exclusiones.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calculator, Download, FileText, RefreshCw, Plus, Check,
  AlertTriangle, X, Trash2, DollarSign, Users, TrendingDown, Info,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mxn0 = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const EXCL_LABEL: Record<string, string> = {
  director_gerente_domestico: "Excluido art. 127-I/VI (director / gerente / doméstico)",
  eventual_menor_60_dias: "Excluido art. 127-VII (< 60 días trabajados)",
};

export default function PTUTab({ t }: { t: any }) {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showGenPayroll, setShowGenPayroll] = useState<any>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const l = await hrApi.ptuList();
      setList(l);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar historial");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openCalc = async (calcId: number) => {
    setBusy(true);
    try {
      const d = await hrApi.ptuGet(calcId);
      setSelected(d);
      setPreviewData(null);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al cargar cálculo");
    } finally { setBusy(false); }
  };

  const removeCalc = async (id: number) => {
    if (!confirm("¿Eliminar este cálculo? Solo se puede si está en estado 'draft'.")) return;
    try {
      await hrApi.ptuDelete(id);
      if (selected?.id === id) setSelected(null);
      await loadList();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al eliminar");
    }
  };

  const approve = async () => {
    if (!selected) return;
    if (!confirm(`¿Aprobar el reparto ${selected.period_year}? Una vez aprobado no puedes editarlo, solo generar la nómina.`)) return;
    setBusy(true);
    try {
      const d = await hrApi.ptuApprove(selected.id);
      setSelected(d);
      await loadList();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al aprobar");
    } finally { setBusy(false); }
  };

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: t.textHi, fontSize: 18, fontWeight: 700 }}>Reparto de Utilidades (PTU)</h2>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>
            LFT arts. 122-131 + reforma 2021 · Tope art. 127-VIII: mayor entre 3 meses de salario o promedio de últimos 3 años.
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

      {error && (
        <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad,
                      borderRadius: 10, padding: "10px 14px", fontSize: 13,
                      display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
        {/* ── Sidebar historial ── */}
        <div style={{ ...glass, padding: 14, maxHeight: "70vh", overflowY: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.textMid, marginBottom: 10,
                        textTransform: "uppercase", letterSpacing: 0.5 }}>
            Historial ({list.length})
          </div>
          {loading && <div style={{ color: t.textLo, fontSize: 13 }}>Cargando...</div>}
          {list.length === 0 && !loading && (
            <div style={{ color: t.textLo, fontSize: 13, padding: "12px 0" }}>
              No hay cálculos guardados aún. Crea el primero con <b>Nuevo cálculo</b>.
            </div>
          )}
          {list.map(c => (
            <button key={c.id} onClick={() => openCalc(c.id)}
              style={{
                width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 8,
                borderRadius: 10, border: `1px solid ${selected?.id === c.id ? t.nova : t.border}`,
                background: selected?.id === c.id ? t.nova + "18" : t.panel2,
                color: t.textHi, cursor: "pointer",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Ejercicio {c.period_year}</div>
                <StatusBadge t={t} status={c.status} />
              </div>
              <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>
                Utilidad: {mxn0(c.utilidad_repartible)} · PTU pagada: {mxn0(c.total_ptu_paid)}
              </div>
              {c.status === "draft" && (
                <button onClick={e => { e.stopPropagation(); removeCalc(c.id); }}
                  style={{ marginTop: 6, padding: "3px 8px", borderRadius: 5, border: "none",
                           background: t.bad + "22", color: t.bad, cursor: "pointer",
                           fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Trash2 size={11} /> Eliminar
                </button>
              )}
            </button>
          ))}
        </div>

        {/* ── Detalle ── */}
        <div>
          {showWizard && (
            <PTUWizard t={t}
              onClose={() => setShowWizard(false)}
              onPreview={(d) => { setPreviewData(d); setSelected(null); }}
              onSaved={async (d) => { setShowWizard(false); await loadList(); setSelected(d); setPreviewData(null); }}
            />
          )}

          {!showWizard && !selected && !previewData && (
            <div style={{ ...glass, padding: 40, textAlign: "center", color: t.textLo }}>
              <Calculator size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div style={{ fontSize: 15, color: t.textMid, marginBottom: 4 }}>
                Selecciona un cálculo del historial o crea uno nuevo
              </div>
              <div style={{ fontSize: 12 }}>
                El sistema aplica automáticamente los topes y exclusiones de la LFT.
              </div>
            </div>
          )}

          {(selected || previewData) && (
            <PTUDetail t={t}
              data={selected || previewData}
              isPreview={!selected && !!previewData}
              busy={busy}
              onApprove={approve}
              onGeneratePayroll={() => setShowGenPayroll(selected)} />
          )}

          {showGenPayroll && (
            <GeneratePayrollModal t={t} calc={showGenPayroll}
              onClose={() => setShowGenPayroll(null)}
              onDone={async () => { setShowGenPayroll(null); await loadList(); if (selected) openCalc(selected.id); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wizard nuevo cálculo ─────────────────────────────────────────────────

function PTUWizard({ t, onClose, onPreview, onSaved }: any) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear() - 1);
  const [utilidad, setUtilidad] = useState<number>(0);
  const [sindicato, setSindicato] = useState<number | "">("");
  const [deadline, setDeadline] = useState(`${now.getFullYear()}-05-30`);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    if (utilidad <= 0) { alert("Captura la utilidad repartible (> 0)"); return; }
    setBusy(true);
    try {
      const p = await hrApi.ptuPreview(year, utilidad, sindicato ? Number(sindicato) : null);
      setPreview(p);
      onPreview(p);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error en preview");
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await hrApi.ptuSave({
        year, utilidad_repartible: utilidad,
        sindicato_max_daily: sindicato ? Number(sindicato) : null,
        payment_deadline: deadline || undefined,
        notes: notes || undefined,
      });
      onSaved(saved);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    } finally { setBusy(false); }
  };

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18,
  };

  return (
    <div style={{ ...glass, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>Nuevo cálculo de PTU</div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>
            Captura la utilidad repartible y los parámetros legales
          </div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.textMid, cursor: "pointer" }}>
          <X size={20} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        <div>
          <label style={lbl(t)}>Año del ejercicio</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={inp(t)} />
        </div>
        <div>
          <label style={lbl(t)}>Utilidad repartible (MXN) *</label>
          <input type="number" step="0.01" value={utilidad || ""}
            onChange={e => setUtilidad(Number(e.target.value))} style={inp(t)} placeholder="0.00" />
          <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 3 }}>
            10% de la utilidad fiscal (art. 120 LFT)
          </div>
        </div>
        <div>
          <label style={lbl(t)}>Tarifa sindicato máxima (diaria)</label>
          <input type="number" step="0.01" value={sindicato}
            onChange={e => setSindicato(e.target.value ? Number(e.target.value) : "")}
            style={inp(t)} placeholder="Opcional" />
          <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 3 }}>
            Cap art. 127-II para confianza (sindicato × 1.20)
          </div>
        </div>
        <div>
          <label style={lbl(t)}>Fecha límite de pago</label>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inp(t)} />
          <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 3 }}>
            60 días después del 31-marzo (art. 122)
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={lbl(t)}>Notas / justificación (opcional)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          style={{ ...inp(t), resize: "vertical" }} placeholder="Referencia al acta de la comisión mixta, etc." />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
        <button onClick={runPreview} disabled={busy} style={btnGhost(t)}>
          <Calculator size={14} /> {busy ? "Calculando..." : "Preview"}
        </button>
        <button onClick={save} disabled={busy || !preview} style={btnPrimary(t)}>
          <Check size={14} /> Guardar como borrador
        </button>
      </div>
    </div>
  );
}

// ── Detalle / Preview ───────────────────────────────────────────────────

function PTUDetail({ t, data, isPreview, busy, onApprove, onGeneratePayroll }: any) {
  const canApprove = !isPreview && data.status === "draft";
  const canGenPayroll = !isPreview && data.status === "approved" && !data.payroll_period_id;
  const canDownload = !isPreview;
  const totals = data.totals || _computeTotals(data.rows || []);

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ ...glass, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi }}>
              Ejercicio {data.period_year}
              {isPreview && <span style={{ marginLeft: 8, fontSize: 11, background: t.warn + "22",
                                            color: t.warn, padding: "2px 8px", borderRadius: 4 }}>PREVIEW</span>}
              {!isPreview && <span style={{ marginLeft: 8 }}><StatusBadge t={t} status={data.status} /></span>}
            </div>
            <div style={{ fontSize: 13, color: t.textLo, marginTop: 4 }}>
              Utilidad repartible: <b style={{ color: t.textMid }}>{mxn(data.utilidad_repartible)}</b>
              {data.payment_deadline && <> · Pago límite: <b>{data.payment_deadline}</b></>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canDownload && (
              <>
                <button onClick={() => hrApi.downloadPtuXlsx(data.id, data.period_year)} style={btnGhost(t)}>
                  <Download size={14} /> XLSX
                </button>
                <button onClick={() => hrApi.downloadPtuPdf(data.id, data.period_year)} style={btnGhost(t)}>
                  <FileText size={14} /> Cédula PDF
                </button>
              </>
            )}
            {canApprove && (
              <button onClick={onApprove} disabled={busy} style={{
                ...btnPrimary(t), background: `linear-gradient(135deg, ${t.good}, #059669)`,
              }}>
                <Check size={14} /> Aprobar
              </button>
            )}
            {canGenPayroll && (
              <button onClick={onGeneratePayroll} style={btnPrimary(t)}>
                <DollarSign size={14} /> Generar nómina PTU
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings?.length > 0 && (
        <div style={{ ...glass, padding: 12, background: t.warn + "10",
                      border: `1px solid ${t.warn}44` }}>
          {data.warnings.map((w: string, i: number) => (
            <div key={i} style={{ fontSize: 12, color: t.warn, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <Info size={12} style={{ marginTop: 2, flexShrink: 0 }} /> {w}
            </div>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        <KpiCard t={t} icon={Users} label="Empleados incluidos"
                 value={String(totals.total_included || 0)}
                 sub={`${totals.total_excluded || 0} excluidos`}
                 color={t.nova} />
        <KpiCard t={t} icon={Calculator} label="Días base"
                 value={totals.total_days?.toLocaleString("es-MX") || "0"}
                 sub={`Salario base: ${mxn0(totals.total_salary_base)}`}
                 color={t.textMid} />
        <KpiCard t={t} icon={DollarSign} label="PTU bruta calculada"
                 value={mxn(totals.total_ptu_gross)}
                 sub="Antes de topes 127-VIII" color={t.textMid} />
        <KpiCard t={t} icon={Check} label="PTU final a pagar"
                 value={mxn(totals.total_ptu_paid)}
                 sub={totals.total_cap_savings > 0
                      ? `Ahorro por topes: ${mxn(totals.total_cap_savings)}`
                      : "Sin topes aplicados"}
                 color={t.good} />
      </div>

      {/* Tabla de empleados */}
      <div style={{ ...glass, overflow: "auto", maxHeight: "55vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 12 }}>
          <thead>
            <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
              <th style={th(t, 240, true)}>Empleado</th>
              <th style={th(t, 110)}>Depto</th>
              <th style={{ ...th(t, 80), textAlign: "right" }}>Días</th>
              <th style={{ ...th(t, 110), textAlign: "right" }}>Salario base</th>
              <th style={{ ...th(t, 100), textAlign: "right" }}>Por días</th>
              <th style={{ ...th(t, 100), textAlign: "right" }}>Por salario</th>
              <th style={{ ...th(t, 100), textAlign: "right" }}>Bruto</th>
              <th style={{ ...th(t, 100), textAlign: "right" }}>Cap</th>
              <th style={{ ...th(t, 110), textAlign: "right", background: t.nova + "22" }}>Final</th>
              <th style={th(t, 220)}>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {(data.rows || []).map((r: any, i: number) => {
              const isExcluded = r.excluded;
              const isCapped = r.cap_reason;
              const bg = isExcluded ? t.warn + "10" : isCapped ? t.bad + "10"
                       : i % 2 === 0 ? t.panel : t.panel2 + "80";
              const obs: string[] = [];
              if (isExcluded) obs.push(EXCL_LABEL[r.excluded_reason] || r.excluded_reason);
              if (r.salary_cap_applied) obs.push(r.salary_cap_note || "Cap art. 127-II");
              if (isCapped) {
                const src = r.cap_reason === "3_months" ? "3 meses salario" : "promedio 3 años";
                obs.push(`Tope 127-VIII: ${src} (${mxn(r.cap_applied_amount)})`);
              }
              return (
                <tr key={r.id || r.employee_id} style={{ borderTop: `1px solid ${t.border}`, background: bg }}>
                  <td style={{ ...td(t), position: "sticky", left: 0, background: "inherit" }}>
                    <div style={{ fontWeight: 600, color: t.textHi }}>{r.employee_name}</div>
                    <div style={{ fontSize: 10.5, color: t.textLo }}>
                      #{r.employee_number}
                      {r.is_confidential && <span style={{ marginLeft: 6, color: t.warn }}>· CONF.</span>}
                    </div>
                  </td>
                  <td style={td(t)}>{r.department || ""}</td>
                  <td style={{ ...td(t), textAlign: "right" }}>{r.days_worked_ptu?.toFixed(0)}</td>
                  <td style={{ ...td(t), textAlign: "right", color: r.salary_cap_applied ? t.warn : t.textHi }}>
                    {mxn0(r.salary_earned_ptu)}
                  </td>
                  <td style={{ ...td(t), textAlign: "right" }}>{mxn(r.ptu_by_days)}</td>
                  <td style={{ ...td(t), textAlign: "right" }}>{mxn(r.ptu_by_salary)}</td>
                  <td style={{ ...td(t), textAlign: "right", color: t.textMid }}>{mxn(r.ptu_gross)}</td>
                  <td style={{ ...td(t), textAlign: "right", fontSize: 10.5, color: t.textLo }}>
                    {r.cap_applied_amount != null ? mxn0(r.cap_applied_amount) : "—"}
                  </td>
                  <td style={{ ...td(t), textAlign: "right", fontWeight: 700,
                               color: isExcluded ? t.textLo : t.good }}>
                    {mxn(r.ptu_final)}
                  </td>
                  <td style={{ ...td(t), fontSize: 10.5, color: t.textLo }}>
                    {obs.join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Leyenda */}
      <div style={{ ...glass, padding: 12, fontSize: 11.5, color: t.textLo, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.warn, borderRadius: 2, marginRight: 6 }} />
          Excluido del reparto (art. 127 I/VI/VII)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: t.bad, borderRadius: 2, marginRight: 6 }} />
          Tope art. 127-VIII aplicado</span>
        <span>CONF. = trabajador de confianza (aplica cap 127-II si hay sindicato)</span>
      </div>
    </div>
  );
}

// ── Modal generar nómina ─────────────────────────────────────────────────

function GeneratePayrollModal({ t, calc, onClose, onDone }: any) {
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await hrApi.ptuGeneratePayroll(calc.id, date);
      alert(`Nómina PTU generada: ${r.employees} empleados, total ${mxn(r.total_paid)}. ` +
            `Puedes verla en la pestaña Nómina.`);
      onDone();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al generar nómina");
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.panel, borderRadius: 14, padding: 24, maxWidth: 460, width: "100%",
        border: `1px solid ${t.border}`,
      }}>
        <h3 style={{ margin: 0, color: t.textHi, fontSize: 17, marginBottom: 6 }}>
          Generar nómina PTU {calc.period_year}
        </h3>
        <p style={{ margin: "0 0 16px", color: t.textLo, fontSize: 13 }}>
          Crea un período de nómina tipo <b>"ptu"</b> con el monto final por empleado.
          Después podrás timbrar el CFDI de nómina con concepto SAT 023.
        </p>

        <label style={lbl(t)}>Fecha de pago</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp(t)} />

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={btnGhost(t)}>Cancelar</button>
          <button onClick={run} disabled={busy} style={btnPrimary(t)}>
            <DollarSign size={14} /> {busy ? "Generando..." : "Generar"}
          </button>
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
    paid:     { bg: t.good + "22", fg: t.good, label: "Pagado" },
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

function _computeTotals(rows: any[]) {
  const included = rows.filter(r => !r.excluded);
  return {
    total_employees: rows.length,
    total_included: included.length,
    total_excluded: rows.length - included.length,
    total_days: included.reduce((s, r) => s + (r.days_worked_ptu || 0), 0),
    total_salary_base: included.reduce((s, r) => s + (r.salary_earned_ptu || 0), 0),
    total_ptu_gross: rows.reduce((s, r) => s + (r.ptu_gross || 0), 0),
    total_ptu_paid: rows.reduce((s, r) => s + (r.ptu_final || 0), 0),
    total_cap_savings: rows.filter(r => !r.excluded)
      .reduce((s, r) => s + ((r.ptu_gross || 0) - (r.ptu_final || 0)), 0),
  };
}

// Styles
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
  width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
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
