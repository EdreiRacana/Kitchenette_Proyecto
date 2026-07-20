// AgentsTab.tsx — Configuración → Agentes / Comisionistas.
// Alta de agentes (internos o externos) con su % de comisión, y reporte de
// comisiones a pagar por periodo (base de venta, cobrado y comisión).
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  UserPlus, Users, Pencil, Trash2, X, Calculator, Download, Percent, Info,
} from "lucide-react";
import { salesApi, type SalesAgent, type SalesAgentDraft, type AgentCommissionReport } from "../sales/api";

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function firstDayOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function lastDayOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function toDateInput(d: Date) { return d.toISOString().slice(0, 10); }

const emptyDraft = (): SalesAgentDraft => ({
  name: "", is_external: true, user_id: null, commission_pct: 0,
  email: "", phone: "", notes: "", is_active: true,
});

const csvEscape = (v: any) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default function AgentsTab({ t }: { t: any }) {
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SalesAgent | null>(null);
  const [draft, setDraft] = useState<SalesAgentDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const today = new Date();
  const [start, setStart] = useState(toDateInput(firstDayOfMonth(today)));
  const [end, setEnd] = useState(toDateInput(lastDayOfMonth(today)));
  const [report, setReport] = useState<AgentCommissionReport | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setAgents(await salesApi.listAgents(true)); }
    catch { setError("No se pudieron cargar los agentes."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setDraft(emptyDraft()); };
  const openEdit = (a: SalesAgent) => {
    setEditing(a);
    setDraft({ name: a.name, is_external: a.is_external, user_id: a.user_id, commission_pct: a.commission_pct,
      email: a.email, phone: a.phone, notes: a.notes, is_active: a.is_active });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError("El nombre del agente es obligatorio."); return; }
    setSaving(true); setError(null);
    try {
      if (editing) await salesApi.updateAgent(editing.id, draft);
      else await salesApi.createAgent(draft);
      setDraft(null); setEditing(null);
      await load();
    } catch { setError("No se pudo guardar el agente."); }
    finally { setSaving(false); }
  };

  const remove = async (a: SalesAgent) => {
    if (!confirm(`¿Eliminar al agente "${a.name}"? Si ya tiene ventas, solo se desactivará para conservar el histórico.`)) return;
    try { await salesApi.deleteAgent(a.id); await load(); }
    catch { setError("No se pudo eliminar el agente."); }
  };

  const runReport = useCallback(async () => {
    setRepLoading(true); setError(null);
    try {
      setReport(await salesApi.agentCommissions({
        start: start ? new Date(start).toISOString() : undefined,
        end: end ? new Date(end + "T23:59:59").toISOString() : undefined,
      }));
    } catch { setError("No se pudo calcular el reporte de comisiones."); }
    finally { setRepLoading(false); }
  }, [start, end]);

  useEffect(() => { runReport(); }, [runReport]);

  const exportCsv = () => {
    if (!report) return;
    const rows: (string | number)[][] = [];
    rows.push([`Comisiones por agente`, `${start} → ${end}`]);
    rows.push([]);
    rows.push(["Agente", "Tipo", "Comisión %", "Órdenes", "Base venta", "Ya cobrado", "Comisión", "Comisión s/cobrado"]);
    for (const r of report.rows) {
      rows.push([r.agent_name, r.is_external ? "Externo" : "Interno", r.commission_pct, r.orders_count,
        r.sales_base, r.paid_base, r.commission, r.commission_on_paid]);
    }
    rows.push([]);
    rows.push(["TOTAL", "", "", "", report.totals.sales_base, report.totals.paid_base, report.totals.commission, report.totals.commission_on_paid]);
    const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `comisiones_${start}_${end}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const card: React.CSSProperties = { background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 };
  const th: React.CSSProperties = { padding: "9px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${t.border}` };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: t.textHi, borderBottom: `1px solid ${t.border}` };
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && (
        <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{error}</div>
      )}

      {/* ── Agentes ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 7, display: "flex" }}><Users size={16} /></div>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: t.textHi }}>Agentes / Comisionistas</span>
          <button onClick={openNew} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: "none", background: t.nova, color: "#04121f", cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>
            <UserPlus size={14} /> Nuevo agente
          </button>
        </div>
        <div style={{ fontSize: 12, color: t.textLo, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={13} /> Un agente puede ser interno (personal del sistema) o externo (comisionista independiente). El % aquí es su comisión por venta.
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 13 }}>Cargando…</div>
        ) : agents.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 13 }}>Aún no hay agentes. Crea el primero con "Nuevo agente".</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>
                <th style={th}>Agente</th><th style={th}>Tipo</th>
                <th style={{ ...th, textAlign: "right" }}>Comisión</th>
                <th style={th}>Contacto</th><th style={th}>Estado</th><th style={{ ...th, textAlign: "right" }}>Acciones</th>
              </tr></thead>
              <tbody>
                {agents.map(a => (
                  <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{a.name}</span></td>
                    <td style={td}>
                      <span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 99, background: (a.is_external ? t.warn : t.good) + "22", color: a.is_external ? t.warn : t.good, fontWeight: 600 }}>
                        {a.is_external ? "Externo" : "Interno"}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: t.nova, fontVariantNumeric: "tabular-nums" }}>{a.commission_pct}%</td>
                    <td style={{ ...td, fontSize: 12, color: t.textMid }}>{a.email || a.phone || "—"}</td>
                    <td style={td}>{a.is_active ? "Activo" : "Inactivo"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button onClick={() => openEdit(a)} title="Editar" style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: 6, cursor: "pointer", color: t.textMid, marginRight: 6 }}><Pencil size={14} /></button>
                      <button onClick={() => remove(a)} title="Eliminar" style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: 6, cursor: "pointer", color: t.bad }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Reporte de comisiones ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ background: t.good + "22", color: t.good, borderRadius: 8, padding: 7, display: "flex" }}><Percent size={16} /></div>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: t.textHi }}>Comisiones a pagar</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap" }}>
            <div>
              <label style={{ display: "block", fontSize: 10.5, color: t.textLo, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Desde</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ ...inp, width: 150 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 10.5, color: t.textLo, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Hasta</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ ...inp, width: 150 }} />
            </div>
            <button onClick={runReport} disabled={repLoading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#04121f", cursor: repLoading ? "wait" : "pointer", fontSize: 12.5, fontWeight: 700 }}>
              <Calculator size={14} /> {repLoading ? "Calculando…" : "Calcular"}
            </button>
            <button onClick={exportCsv} disabled={!report || report.rows.length === 0} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: report && report.rows.length ? "pointer" : "not-allowed", opacity: report && report.rows.length ? 1 : 0.5, fontSize: 12.5 }}>
              <Download size={14} /> CSV
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: t.textLo, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Info size={13} /> Base = venta (subtotal sin IVA) de las órdenes del periodo atribuidas a cada agente. "Sobre cobrado" es la comisión de la parte ya pagada por el cliente.
        </div>
        {report && report.rows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={th}>Agente</th>
                <th style={{ ...th, textAlign: "right" }}>%</th>
                <th style={{ ...th, textAlign: "right" }}>Órdenes</th>
                <th style={{ ...th, textAlign: "right" }}>Base venta</th>
                <th style={{ ...th, textAlign: "right" }}>Ya cobrado</th>
                <th style={{ ...th, textAlign: "right" }}>Comisión</th>
                <th style={{ ...th, textAlign: "right" }}>Comisión s/cobrado</th>
              </tr></thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.agent_id ?? r.agent_name}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{r.agent_name}</span>{r.is_external && <span style={{ fontSize: 10.5, color: t.warn, marginLeft: 6 }}>externo</span>}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.commission_pct}%</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.orders_count}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mxn(r.sales_base)}</td>
                    <td style={{ ...td, textAlign: "right", color: t.textMid, fontVariantNumeric: "tabular-nums" }}>{mxn(r.paid_base)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: t.nova, fontVariantNumeric: "tabular-nums" }}>{mxn(r.commission)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(r.commission_on_paid)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, fontWeight: 800, borderBottom: "none" }} colSpan={3}>TOTAL ({report.totals.agents_count})</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", fontVariantNumeric: "tabular-nums" }}>{mxn(report.totals.sales_base)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", color: t.textMid, fontVariantNumeric: "tabular-nums" }}>{mxn(report.totals.paid_base)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", color: t.nova, fontVariantNumeric: "tabular-nums" }}>{mxn(report.totals.commission)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, borderBottom: "none", color: t.good, fontVariantNumeric: "tabular-nums" }}>{mxn(report.totals.commission_on_paid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 13 }}>
            {repLoading ? "Calculando…" : "Sin ventas atribuidas a agentes en este periodo. Asigna un agente a las órdenes (o al cliente) para verlas aquí."}
          </div>
        )}
      </div>

      {/* ── Modal alta/edición ── */}
      {draft && createPortal(
        <div onClick={() => setDraft(null)} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.75)", zIndex: 90, display: "flex", justifyContent: "center", alignItems: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${t.border}`, background: t.panel2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: t.textHi }}>{editing ? "Editar agente" : "Nuevo agente"}</div>
              <button onClick={() => setDraft(null)} style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>Nombre *</label>
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre del agente" style={inp} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>Tipo</label>
                  <select value={draft.is_external ? "ext" : "int"} onChange={e => setDraft({ ...draft, is_external: e.target.value === "ext" })} style={inp as any}>
                    <option value="ext">Externo (comisionista)</option>
                    <option value="int">Interno (personal)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>Comisión (%)</label>
                  <input type="number" step="0.1" min={0} max={100} value={draft.commission_pct}
                    onChange={e => setDraft({ ...draft, commission_pct: Number(e.target.value) })} style={inp} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>Correo</label>
                  <input value={draft.email || ""} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="opcional" style={inp} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: t.textLo, marginBottom: 4 }}>Teléfono</label>
                  <input value={draft.phone || ""} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="opcional" style={inp} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t.textMid, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.is_active} onChange={e => setDraft({ ...draft, is_active: e.target.checked })} /> Activo
              </label>
            </div>
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setDraft(null)} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
              <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: t.nova, color: "#04121f", cursor: saving ? "wait" : "pointer", fontSize: 13, fontWeight: 700 }}>{saving ? "Guardando…" : "Guardar"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
