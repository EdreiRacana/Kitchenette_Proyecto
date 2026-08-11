// Avisos IMSS papel — AFIL-02 (alta), AFIL-04 (baja), AFIL-08 (modif salario).
// Detección automática de pendientes + wizard nuevo + historial con descarga PDF.

import { useCallback, useEffect, useState } from "react";
import {
  Plus, FileText, Download, RefreshCw, AlertTriangle, Trash2, X,
  ArrowUpCircle, ArrowDownCircle, TrendingUp, ClipboardCheck, Edit2,
} from "lucide-react";
import { hrApi } from "./api";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BAJA_REASONS: [string, string][] = [
  ["1", "Término de contrato"],
  ["2", "Separación voluntaria (renuncia)"],
  ["3", "Abandono de trabajo"],
  ["4", "Defunción"],
  ["5", "Clausura del centro de trabajo"],
  ["6", "Otras causas"],
  ["7", "Ausentismo (arts. 47/517 LFT)"],
  ["8", "Rescisión de contrato (justificada patronal)"],
  ["9", "Jubilación / pensión"],
];

const TYPE_META: Record<string, { label: string; short: string; color: string; icon: any }> = {
  alta:          { label: "Alta (AFIL-02)", short: "ALTA", color: "good", icon: ArrowUpCircle },
  baja:          { label: "Baja (AFIL-04)", short: "BAJA", color: "bad", icon: ArrowDownCircle },
  modif_salario: { label: "Modif. salario (AFIL-08)", short: "MODIF", color: "warn", icon: TrendingUp },
};

export default function AvisosImssTab({ t, employees }: { t: any; employees: any[] }) {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [pending, setPending] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showWizard, setShowWizard] = useState<null | { preset?: any }>(null);
  const [editingPresentation, setEditingPresentation] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        hrApi.imssMovementsPending(),
        hrApi.imssMovementsList(),
      ]);
      setPending(p.pending || []);
      setHistory(h || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (id: number) => {
    if (!confirm("¿Eliminar este movimiento del historial?")) return;
    try {
      await hrApi.imssMovementDelete(id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    }
  };

  const glass: React.CSSProperties = {
    background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: t.textHi, fontSize: 18, fontWeight: 700 }}>Avisos IMSS (papel)</h2>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>
            Formatos oficiales AFIL-02, AFIL-04 y AFIL-08. Se presentan al IMSS dentro de <b>5 días hábiles</b> (art. 15/34/37 LSS).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={btnGhost(t)}><RefreshCw size={14} /></button>
          <button onClick={() => {
            const y = prompt("¿Exportar SUA de qué año? (vacío = todos los movimientos)",
                              String(new Date().getFullYear()));
            if (y === null) return;
            const yr = y.trim() ? Number(y) : undefined;
            hrApi.downloadSuaMovimientos(yr).catch((e: any) =>
              alert(e?.response?.data?.detail || "Error al exportar SUA"));
          }} title="MOVTOS.txt para importar en SUA escritorio" style={btnGhost(t)}>
            <Download size={14} /> SUA .txt
          </button>
          <button onClick={() => setShowWizard({})} style={btnPrimary(t)}>
            <Plus size={14} /> Nuevo aviso
          </button>
        </div>
      </div>

      {/* Toggle */}
      <div style={{ display: "flex", gap: 4, background: t.panel2, padding: 4,
                    borderRadius: 10, border: `1px solid ${t.border}`, width: "fit-content" }}>
        <button onClick={() => setTab("pending")} style={{
          padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
          background: tab === "pending" ? t.nova : "transparent",
          color: tab === "pending" ? "#fff" : t.textMid,
          fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6,
        }}>
          Pendientes
          {pending.length > 0 && (
            <span style={{ background: tab === "pending" ? "#fff" : t.bad,
                            color: tab === "pending" ? t.nova : "#fff",
                            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99 }}>
              {pending.length}
            </span>
          )}
        </button>
        <button onClick={() => setTab("history")} style={{
          padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer",
          background: tab === "history" ? t.nova : "transparent",
          color: tab === "history" ? "#fff" : t.textMid,
          fontWeight: 600, fontSize: 13,
        }}>Historial ({history.length})</button>
      </div>

      {/* Pending */}
      {tab === "pending" && (
        <div style={glass}>
          {loading && <div style={{ padding: 30, textAlign: "center", color: t.textLo }}>Cargando...</div>}
          {!loading && pending.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>
              <ClipboardCheck size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
              <div style={{ fontSize: 15, color: t.textMid }}>Sin avisos pendientes</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                El sistema detecta automáticamente altas, bajas y cambios de SBC sin registrar.
              </div>
            </div>
          )}
          {pending.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2 }}>
                  <th style={th(t)}>Tipo</th>
                  <th style={th(t)}>Empleado</th>
                  <th style={th(t)}>Fecha sugerida</th>
                  <th style={th(t)}>Fecha límite</th>
                  <th style={{ ...th(t), textAlign: "right" }}>SBC / cambio</th>
                  <th style={th(t)}></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p, i) => {
                  const meta = TYPE_META[p.type];
                  const overdue = p.overdue;
                  const Icon = meta.icon;
                  return (
                    <tr key={i} style={{
                      borderTop: `1px solid ${t.border}`,
                      background: overdue ? t.bad + "10" : (i % 2 === 0 ? t.panel : t.panel2 + "80"),
                    }}>
                      <td style={td(t)}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
                                        color: (t as any)[meta.color], fontWeight: 700 }}>
                          <Icon size={16} /> {meta.short}
                        </span>
                      </td>
                      <td style={td(t)}>
                        <div style={{ fontWeight: 600, color: t.textHi }}>{p.employee_name}</div>
                        <div style={{ fontSize: 11, color: t.textLo }}>#{p.employee_number}</div>
                      </td>
                      <td style={td(t)}>{p.suggested_date}</td>
                      <td style={{ ...td(t), color: overdue ? t.bad : t.textMid,
                                    fontWeight: overdue ? 700 : 400 }}>
                        {p.deadline}
                        {overdue && (
                          <span style={{ marginLeft: 6, fontSize: 10.5, background: t.bad + "22",
                                          color: t.bad, padding: "1px 6px", borderRadius: 4, fontWeight: 700 }}>
                            VENCIDO
                          </span>
                        )}
                      </td>
                      <td style={{ ...td(t), textAlign: "right" }}>
                        {p.type === "modif_salario"
                          ? <span>{mxn(p.old_sbc)} → <b>{mxn(p.new_sbc)}</b></span>
                          : mxn(p.sbc)}
                      </td>
                      <td style={{ ...td(t), textAlign: "right" }}>
                        <button onClick={() => setShowWizard({ preset: p })} style={{
                          padding: "6px 12px", borderRadius: 6, border: "none",
                          background: t.nova, color: "#fff", cursor: "pointer",
                          fontSize: 11.5, fontWeight: 600,
                        }}>
                          Registrar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Historial */}
      {tab === "history" && (
        <div style={{ ...glass, overflow: "auto" }}>
          {loading && <div style={{ padding: 30, textAlign: "center", color: t.textLo }}>Cargando...</div>}
          {!loading && history.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>
              Sin movimientos registrados. Crea el primero con <b>Nuevo aviso</b>.
            </div>
          )}
          {history.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2 }}>
                  <th style={th(t)}>Tipo</th>
                  <th style={th(t)}>Empleado</th>
                  <th style={th(t)}>Fecha</th>
                  <th style={th(t)}>Detalle</th>
                  <th style={th(t)}>Presentación</th>
                  <th style={{ ...th(t), textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m, i) => {
                  const meta = TYPE_META[m.movement_type];
                  const Icon = meta.icon;
                  const detail = m.movement_type === "alta"
                    ? `SBC ${mxn(m.sbc_at_movement)}`
                    : m.movement_type === "baja"
                    ? `Motivo ${m.baja_reason_code} · ${m.baja_reason_text || ""}`
                    : `${mxn(m.old_sbc)} → ${mxn(m.new_sbc)}`;
                  return (
                    <tr key={m.id} style={{
                      borderTop: `1px solid ${t.border}`,
                      background: i % 2 === 0 ? t.panel : t.panel2 + "80",
                    }}>
                      <td style={td(t)}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
                                        color: (t as any)[meta.color], fontWeight: 700 }}>
                          <Icon size={16} /> {meta.short}
                        </span>
                      </td>
                      <td style={td(t)}>
                        <div style={{ fontWeight: 600, color: t.textHi }}>{m.employee_name}</div>
                        <div style={{ fontSize: 11, color: t.textLo }}>
                          #{m.employee_number}{m.nss ? ` · NSS ${m.nss}` : ""}
                        </div>
                      </td>
                      <td style={td(t)}>{m.movement_date}</td>
                      <td style={{ ...td(t), fontSize: 12, color: t.textMid }}>{detail}</td>
                      <td style={td(t)}>
                        {m.presented_date
                          ? <div>
                              <div style={{ fontSize: 12, color: t.good, fontWeight: 600 }}>
                                {m.presented_date}
                              </div>
                              {m.folio && <div style={{ fontSize: 10.5, color: t.textLo }}>
                                Folio: {m.folio}
                              </div>}
                            </div>
                          : <span style={{ fontSize: 11.5, color: t.warn }}>Sin presentar</span>}
                      </td>
                      <td style={{ ...td(t), textAlign: "right" }}>
                        <button onClick={() => hrApi.downloadImssMovementPdf(m)}
                          title="Descargar PDF"
                          style={{ background: "transparent", border: "none",
                                    color: t.nova, cursor: "pointer", padding: 4, marginRight: 4 }}>
                          <FileText size={14} />
                        </button>
                        <button onClick={() => setEditingPresentation(m)}
                          title="Marcar presentado / folio"
                          style={{ background: "transparent", border: "none",
                                    color: t.textMid, cursor: "pointer", padding: 4, marginRight: 4 }}>
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => del(m.id)}
                          title="Eliminar"
                          style={{ background: "transparent", border: "none",
                                    color: t.bad, cursor: "pointer", padding: 4 }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showWizard && (
        <AvisoWizard t={t} employees={employees}
          preset={showWizard.preset}
          onClose={() => setShowWizard(null)}
          onSaved={async (m: any) => {
            setShowWizard(null); await load();
            // Auto-descarga el PDF recién creado
            await hrApi.downloadImssMovementPdf(m);
          }}
        />
      )}

      {editingPresentation && (
        <PresentationModal t={t} mov={editingPresentation}
          onClose={() => setEditingPresentation(null)}
          onSaved={async () => { setEditingPresentation(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Wizard nuevo aviso ─────────────────────────────────────────────────

function AvisoWizard({ t, employees, preset, onClose, onSaved }: any) {
  const today = new Date().toISOString().substring(0, 10);
  const [empId, setEmpId] = useState<number | "">(preset?.employee_id || "");
  const [type, setType] = useState<"alta" | "baja" | "modif_salario">(preset?.type || "alta");
  const [movementDate, setMovementDate] = useState(preset?.suggested_date || today);
  const [sbc, setSbc] = useState<number | "">(preset?.sbc || "");
  const [bajaCode, setBajaCode] = useState("2");
  const [bajaText, setBajaText] = useState("");
  const [oldSbc, setOldSbc] = useState<number | "">(preset?.old_sbc || "");
  const [newSbc, setNewSbc] = useState<number | "">(preset?.new_sbc || "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!empId) { alert("Selecciona empleado"); return; }
    setBusy(true);
    try {
      const payload: any = {
        employee_id: Number(empId), movement_type: type,
        movement_date: movementDate, notes: notes || undefined,
      };
      if (type === "alta") payload.sbc_at_movement = sbc ? Number(sbc) : undefined;
      if (type === "baja") {
        payload.baja_reason_code = bajaCode;
        payload.baja_reason_text = bajaText || undefined;
      }
      if (type === "modif_salario") {
        payload.old_sbc = Number(oldSbc || 0);
        payload.new_sbc = Number(newSbc || 0);
      }
      const created = await hrApi.imssMovementCreate(payload);
      onSaved(created);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al crear aviso");
    } finally { setBusy(false); }
  };

  const emp = (employees || []).find((e: any) => e.id === Number(empId));

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.panel, borderRadius: 14, padding: 24, maxWidth: 560, width: "100%",
        border: `1px solid ${t.border}`, maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: t.textHi, fontSize: 17 }}>Nuevo aviso IMSS</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.textMid, cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={lbl(t)}>Tipo</label>
            <div style={{ display: "flex", gap: 6, background: t.panel2, padding: 4, borderRadius: 8 }}>
              {(["alta", "baja", "modif_salario"] as const).map(k => (
                <button key={k} onClick={() => setType(k)} style={{
                  flex: 1, padding: "8px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: type === k ? t.nova : "transparent",
                  color: type === k ? "#fff" : t.textMid,
                  fontWeight: 600, fontSize: 12,
                }}>{TYPE_META[k].short}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={lbl(t)}>Empleado</label>
            <select value={empId} onChange={e => {
              const id = Number(e.target.value); setEmpId(id);
              const em = (employees || []).find((x: any) => x.id === id);
              if (em && type === "alta") setSbc(em.sbc || 0);
              if (em && type === "modif_salario" && !oldSbc) setNewSbc(em.sbc || 0);
            }} style={inp(t)}>
              <option value="">— Selecciona —</option>
              {(employees || []).map((e: any) => (
                <option key={e.id} value={e.id}>
                  #{e.employee_number} · {e.name} {e.last_name}
                </option>
              ))}
            </select>
            {emp && (
              <div style={{ fontSize: 11, color: t.textLo, marginTop: 4 }}>
                SBC actual: <b>{mxn(emp.sbc)}</b>
                {emp.nss ? <> · NSS: <b>{emp.nss}</b></> : <span style={{ color: t.warn }}> · Sin NSS capturado</span>}
              </div>
            )}
          </div>

          <div>
            <label style={lbl(t)}>Fecha del movimiento</label>
            <input type="date" value={movementDate} onChange={e => setMovementDate(e.target.value)} style={inp(t)} />
          </div>

          {type === "alta" && (
            <div>
              <label style={lbl(t)}>SBC al alta (diario)</label>
              <input type="number" step="0.01" value={sbc} onChange={e => setSbc(Number(e.target.value))}
                style={inp(t)} placeholder="0.00" />
            </div>
          )}

          {type === "baja" && (
            <>
              <div>
                <label style={lbl(t)}>Motivo IMSS</label>
                <select value={bajaCode} onChange={e => setBajaCode(e.target.value)} style={inp(t)}>
                  {BAJA_REASONS.map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl(t)}>Descripción adicional (opcional)</label>
                <textarea rows={2} value={bajaText} onChange={e => setBajaText(e.target.value)}
                  style={{ ...inp(t), resize: "vertical" }} />
              </div>
            </>
          )}

          {type === "modif_salario" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={lbl(t)}>SBC anterior (diario)</label>
                <input type="number" step="0.01" value={oldSbc}
                  onChange={e => setOldSbc(Number(e.target.value))} style={inp(t)} />
              </div>
              <div>
                <label style={lbl(t)}>SBC nuevo (diario)</label>
                <input type="number" step="0.01" value={newSbc}
                  onChange={e => setNewSbc(Number(e.target.value))} style={inp(t)} />
              </div>
            </div>
          )}

          <div>
            <label style={lbl(t)}>Notas / observaciones (opcional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              style={{ ...inp(t), resize: "vertical" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={btnGhost(t)}>Cancelar</button>
          <button onClick={submit} disabled={busy} style={btnPrimary(t)}>
            <FileText size={14} /> {busy ? "..." : "Registrar y generar PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal marcar presentado ─────────────────────────────────────────────

function PresentationModal({ t, mov, onClose, onSaved }: any) {
  const today = new Date().toISOString().substring(0, 10);
  const [date, setDate] = useState(mov.presented_date || today);
  const [folio, setFolio] = useState(mov.folio || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await hrApi.imssMovementUpdate(mov.id, { presented_date: date, folio });
      onSaved();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.panel, borderRadius: 14, padding: 24, maxWidth: 440, width: "100%",
        border: `1px solid ${t.border}`,
      }}>
        <h3 style={{ margin: 0, color: t.textHi, fontSize: 17, marginBottom: 6 }}>
          Marcar como presentado
        </h3>
        <p style={{ margin: "0 0 16px", color: t.textLo, fontSize: 13 }}>
          Registra la fecha y folio del acuse del IDSE (o de ventanilla) para tener trazabilidad.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={lbl(t)}>Fecha de presentación</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp(t)} />
          </div>
          <div>
            <label style={lbl(t)}>Folio IDSE / acuse</label>
            <input value={folio} onChange={e => setFolio(e.target.value)} style={inp(t)}
              placeholder="Ej. 20260812-000000123" />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={btnGhost(t)}>Cancelar</button>
          <button onClick={save} disabled={busy} style={btnPrimary(t)}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const th = (t: any): React.CSSProperties => ({
  padding: "10px 12px", textAlign: "left", color: t.textMid, fontSize: 11,
  fontWeight: 700, whiteSpace: "nowrap",
  borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3,
});
const td = (t: any): React.CSSProperties => ({
  padding: "8px 12px", color: t.textHi, fontSize: 12.5, verticalAlign: "middle",
});
const inp = (t: any): React.CSSProperties => ({
  width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none",
});
const lbl = (t: any): React.CSSProperties => ({
  display: "block", fontSize: 11.5, color: t.textMid, marginBottom: 4, fontWeight: 600,
});
const btnGhost = (t: any): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13,
});
const btnPrimary = (t: any): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 8, border: "none",
  background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
  color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600,
});
