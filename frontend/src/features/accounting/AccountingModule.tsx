// AccountingModule.tsx — Contabilidad (Fase 1): Catálogo · Pólizas · Mayor
// Mismo contrato { t, s } que el resto de módulos.
import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen, Layers, FileText, Plus, X, Check, Trash2, RefreshCw, Search,
  ChevronRight, AlertTriangle, Ban, Info, BarChart3, Scale, TrendingUp,
  SlidersHorizontal, Zap, Landmark, Download, Lock, Unlock, Calendar,
} from "lucide-react";
import {
  accountingService, type Account, type JournalEntry, type LedgerReport,
  type TrialBalance, type BalanceSheet, type IncomeStatement, type AccountMapItem,
  type PeriodClose,
} from "./service";

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABEL: Record<string, string> = {
  activo: "Activo", pasivo: "Pasivo", capital: "Capital",
  ingreso: "Ingresos", costo: "Costos", gasto: "Gastos", orden: "Orden",
};
const TYPE_COLOR: Record<string, string> = {
  activo: "#33B2F5", pasivo: "#FBBF24", capital: "#A78BFA",
  ingreso: "#34D399", costo: "#F472B6", gasto: "#F87171", orden: "#94A3B8",
};

type Tab = "accounts" | "entries" | "ledger" | "reports" | "close" | "sat" | "config";

export default function AccountingModule({ t, s }: { t: any; s: any }) {
  const lang = s?.nav ? "es" : "en";
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [entryForm, setEntryForm] = useState(false);
  const [accountForm, setAccountForm] = useState(false);
  const [q, setQ] = useState("");

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const tabBtn = (active: boolean) => ({ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent" } as React.CSSProperties);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, ent] = await Promise.all([accountingService.getAccounts(), accountingService.getEntries()]);
      setAccounts(acc); setEntries(ent);
    } catch { /* backend no disponible: deja vacío */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const postable = useMemo(() => accounts.filter(a => a.is_postable && a.is_active), [accounts]);
  const filteredAccounts = useMemo(() => accounts.filter(a => {
    if (!q) return true;
    const qs = q.toLowerCase();
    return a.code.toLowerCase().includes(qs) || a.name.toLowerCase().includes(qs) || (a.sat_code || "").includes(qs);
  }), [accounts, q]);

  const seed = async () => {
    setSeeding(true);
    try { await accountingService.seedDefault(); await load(); }
    catch { alert("No se pudo cargar el catálogo base (¿backend disponible?)."); }
    finally { setSeeding(false); }
  };

  const TABS = [
    { id: "accounts", label: lang === "es" ? "Catálogo de cuentas" : "Chart of accounts", icon: Layers },
    { id: "entries", label: lang === "es" ? "Pólizas" : "Journal entries", icon: FileText },
    { id: "ledger", label: lang === "es" ? "Mayor / auxiliar" : "Ledger", icon: BookOpen },
    { id: "reports", label: lang === "es" ? "Estados financieros" : "Financial statements", icon: BarChart3 },
    { id: "close", label: lang === "es" ? "Cierre mensual" : "Month close", icon: Lock },
    { id: "sat", label: lang === "es" ? "Contabilidad Electrónica (SAT)" : "SAT e-accounting", icon: Landmark },
    { id: "config", label: lang === "es" ? "Configuración" : "Settings", icon: SlidersHorizontal },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>{lang === "es" ? "Contabilidad" : "Accounting"}</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Partida doble: catálogo, pólizas y mayor" : "Double-entry: chart, journal and ledger"}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <RefreshCw size={15} /> {lang === "es" ? "Actualizar" : "Refresh"}
          </button>
          {accounts.length > 0 && (
            <button onClick={() => setEntryForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nueva póliza" : "New entry"}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as Tab)} style={tabBtn(tab === id)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><Icon size={14} />{label}</span>
          </button>
        ))}
      </div>

      {/* Catálogo vacío → ofrecer catálogo base */}
      {!loading && accounts.length === 0 && (
        <div style={{ ...glass(t), borderRadius: 12, padding: 40, textAlign: "center" }}>
          <div style={{ display: "inline-flex", background: t.nova + "22", color: t.nova, borderRadius: 14, padding: 14, marginBottom: 14 }}><Layers size={26} /></div>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{lang === "es" ? "Aún no tienes catálogo de cuentas" : "No chart of accounts yet"}</div>
          <div style={{ fontSize: 13, color: t.textLo, maxWidth: 460, margin: "0 auto 18px" }}>
            {lang === "es" ? "Carga un catálogo base mexicano (con código agrupador del SAT). Después puedes editarlo a tu medida." : "Load a standard Mexican chart (with SAT grouping codes). You can adjust it afterwards."}
          </div>
          <button onClick={seed} disabled={seeding} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 22px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
            <Plus size={16} /> {seeding ? (lang === "es" ? "Cargando…" : "Loading…") : (lang === "es" ? "Cargar catálogo base" : "Load base chart")}
          </button>
        </div>
      )}

      {/* ── TAB: Catálogo ── */}
      {tab === "accounts" && accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === "es" ? "Buscar por número, nombre o código SAT…" : "Search by number, name or SAT code…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => setAccountForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nueva cuenta" : "New account"}
            </button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Cuenta", "Nombre", "Tipo", "Naturaleza", "Código SAT", "Detalle", ""].map((h, i) => (
                      <th key={i} style={{ padding: "11px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map(a => (
                    <tr key={a.id} style={{ borderBottom: `1px solid ${t.borderSoft}`, opacity: a.is_active ? 1 : 0.5 }}>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 700, color: t.nova, fontSize: 13, paddingLeft: 14 + (a.level - 1) * 16 }}>{a.code}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi, fontWeight: a.is_postable ? 400 : 700 }}>{a.name}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: TYPE_COLOR[a.account_type], background: TYPE_COLOR[a.account_type] + "1e", padding: "3px 9px", borderRadius: 20 }}>{TYPE_LABEL[a.account_type] || a.account_type}</span>
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid, textTransform: "capitalize" }}>{a.nature}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textLo, fontFamily: "monospace" }}>{a.sat_code || "—"}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12 }}>{a.is_postable ? <span style={{ color: t.good }}>Sí</span> : <span style={{ color: t.textLo }}>Agrupadora</span>}</td>
                      <td style={{ padding: "10px 14px" }}>
                        {a.is_postable && (
                          <button onClick={() => alert(lang === "es" ? "Eliminar/editar cuentas estará en la edición del catálogo." : "Account edit coming in catalog editing.")} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }} title="—">
                            <ChevronRight size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Pólizas ── */}
      {tab === "entries" && accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12.5, color: t.textLo }}>{entries.length} {lang === "es" ? "pólizas" : "entries"}</div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Folio", "Fecha", "Tipo", "Concepto", "Cargos", "Abonos", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "11px 14px", textAlign: i >= 4 && i <= 5 ? "right" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin pólizas todavía. Crea la primera con “Nueva póliza”." : "No entries yet."}</td></tr>
                  ) : entries.map(e => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${t.borderSoft}`, opacity: e.status === "cancelled" ? 0.5 : 1 }}>
                      <td style={{ padding: "10px 14px", fontSize: 13 }}>
                        <span style={{ fontFamily: "monospace", fontWeight: 700, color: t.nova }}>{e.folio}</span>
                        {e.source && e.source !== "manual" && (
                          <span title={e.source} style={{ marginLeft: 7, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: t.warn, background: t.warn + "1e", padding: "2px 6px", borderRadius: 6 }}><Zap size={10} /> {lang === "es" ? "Auto" : "Auto"}</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid }}>{new Date(e.date).toLocaleDateString("es-MX")}</td>
                      <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid, textTransform: "capitalize" }}>{e.entry_type}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi }}>{e.concept || "—"}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi, fontWeight: 600, textAlign: "right" }}>{mxn(e.total_debit)}</td>
                      <td style={{ padding: "10px 14px", fontSize: 13, color: t.textHi, fontWeight: 600, textAlign: "right" }}>{mxn(e.total_credit)}</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: e.status === "posted" ? t.good : t.bad, background: (e.status === "posted" ? t.good : t.bad) + "18", padding: "3px 9px", borderRadius: 20 }}>{e.status === "posted" ? (lang === "es" ? "Contabilizada" : "Posted") : (lang === "es" ? "Cancelada" : "Cancelled")}</span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {e.status === "posted" && (
                          <button onClick={async () => {
                            if (!confirm(lang === "es" ? `¿Cancelar la póliza ${e.folio}? Quedará fuera de saldos.` : `Cancel entry ${e.folio}?`)) return;
                            try { await accountingService.cancelEntry(e.id); load(); } catch { alert("No se pudo cancelar"); }
                          }} title={lang === "es" ? "Cancelar" : "Cancel"} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: "4px 8px", cursor: "pointer", color: t.textLo, display: "flex" }}>
                            <Ban size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Mayor ── */}
      {tab === "ledger" && accounts.length > 0 && (
        <LedgerView t={t} lang={lang} postable={postable} />
      )}

      {/* ── TAB: Estados financieros ── */}
      {tab === "reports" && accounts.length > 0 && (
        <ReportsView t={t} lang={lang} />
      )}

      {/* ── TAB: Cierre mensual ── */}
      {tab === "close" && accounts.length > 0 && (
        <PeriodCloseView t={t} lang={lang} onChanged={load} />
      )}

      {/* ── TAB: Contabilidad Electrónica SAT ── */}
      {tab === "sat" && accounts.length > 0 && (
        <SatView t={t} lang={lang} />
      )}

      {/* ── TAB: Configuración contable ── */}
      {tab === "config" && accounts.length > 0 && (
        <ConfigView t={t} lang={lang} accounts={accounts} />
      )}

      {/* Modales */}
      {entryForm && (
        <EntryModal t={t} lang={lang} postable={postable}
          onClose={() => setEntryForm(false)}
          onSaved={() => { setEntryForm(false); load(); }} />
      )}
      {accountForm && (
        <AccountModal t={t} lang={lang} accounts={accounts}
          onClose={() => setAccountForm(false)}
          onSaved={() => { setAccountForm(false); load(); }} />
      )}
    </div>
  );
}

// ── Vidrio ──
const glass = (t: any): React.CSSProperties =>
  t?.name === "dark"
    ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", border: `1px solid ${t.border}` }
    : { background: t.panel, border: `1px solid ${t.border}` };

// ── Modal: Nueva póliza ──
function EntryModal({ t, lang, postable, onClose, onSaved }: { t: any; lang: string; postable: Account[]; onClose: () => void; onSaved: () => void }) {
  type L = { account_id: number | ""; debit: string; credit: string; description: string };
  const blank = (): L => ({ account_id: "", debit: "", credit: "", description: "" });
  const [entryType, setEntryType] = useState<"ingreso" | "egreso" | "diario">("diario");
  const [concept, setConcept] = useState("");
  const [lines, setLines] = useState<L[]>([blank(), blank()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inp: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const setLine = (i: number, patch: Partial<L>) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const totalDebit = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const submit = async () => {
    const valid = lines.filter(l => l.account_id && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0));
    if (valid.length < 2) { setError(lang === "es" ? "Necesitas al menos 2 partidas con importe." : "Need at least 2 lines."); return; }
    if (!balanced) { setError(lang === "es" ? "La póliza no cuadra: los cargos deben ser iguales a los abonos." : "Entry not balanced."); return; }
    setSaving(true); setError(null);
    try {
      await accountingService.createEntry({
        entry_type: entryType, concept: concept || undefined,
        lines: valid.map(l => ({ account_id: Number(l.account_id), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || undefined })),
      });
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.detail || (lang === "es" ? "Error al guardar la póliza" : "Error saving entry")); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 16, width: "100%", maxWidth: 880, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${t.border}`, position: "sticky", top: 0, background: t.panel }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Nueva póliza" : "New journal entry"}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}><X size={20} /></button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {error && <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}><AlertTriangle size={15} /> {error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 }}>{lang === "es" ? "Tipo" : "Type"}</label>
              <select value={entryType} onChange={e => setEntryType(e.target.value as any)} style={{ ...inp, cursor: "pointer" }}>
                <option value="diario">Diario</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 }}>{lang === "es" ? "Concepto" : "Concept"}</label>
              <input value={concept} onChange={e => setConcept(e.target.value)} placeholder={lang === "es" ? "Descripción de la póliza…" : "Entry description…"} style={inp} />
            </div>
          </div>

          {/* Partidas */}
          <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: t.panel2 }}>
                  {["Cuenta", "Cargo", "Abono", "Descripción", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: i === 1 || i === 2 ? "right" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${t.borderSoft}` }}>
                    <td style={{ padding: "6px 8px", minWidth: 240 }}>
                      <select value={l.account_id} onChange={e => setLine(i, { account_id: e.target.value ? Number(e.target.value) : "" })} style={{ ...inp, cursor: "pointer" }}>
                        <option value="">{lang === "es" ? "— Cuenta —" : "— Account —"}</option>
                        {postable.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px", width: 120 }}>
                      <input type="number" min={0} value={l.debit} onChange={e => setLine(i, { debit: e.target.value, credit: "" })} style={{ ...inp, textAlign: "right" }} placeholder="0.00" />
                    </td>
                    <td style={{ padding: "6px 8px", width: 120 }}>
                      <input type="number" min={0} value={l.credit} onChange={e => setLine(i, { credit: e.target.value, debit: "" })} style={{ ...inp, textAlign: "right" }} placeholder="0.00" />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} style={inp} />
                    </td>
                    <td style={{ padding: "6px 8px", width: 36 }}>
                      {lines.length > 2 && <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.bad, display: "flex" }}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setLines(ls => [...ls, blank()])} style={{ width: "100%", padding: "8px", border: "none", borderTop: `1px solid ${t.borderSoft}`, background: "transparent", color: t.nova, cursor: "pointer", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <Plus size={14} /> {lang === "es" ? "Agregar partida" : "Add line"}
            </button>
          </div>

          {/* Totales + cuadre */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 22, fontSize: 13 }}>
              <div>{lang === "es" ? "Cargos:" : "Debit:"} <strong style={{ color: t.textHi }}>{mxn(totalDebit)}</strong></div>
              <div>{lang === "es" ? "Abonos:" : "Credit:"} <strong style={{ color: t.textHi }}>{mxn(totalCredit)}</strong></div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: balanced ? t.good : t.warn, fontWeight: 700 }}>
                {balanced ? <Check size={15} /> : <Info size={15} />}
                {balanced ? (lang === "es" ? "Cuadra" : "Balanced") : (lang === "es" ? `Diferencia ${mxn(Math.abs(totalDebit - totalCredit))}` : "Unbalanced")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
              <button onClick={submit} disabled={saving || !balanced} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, border: "none", background: balanced ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : t.panel3, color: balanced ? "#fff" : t.textLo, cursor: balanced ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
                <Check size={15} /> {saving ? (lang === "es" ? "Guardando…" : "Saving…") : (lang === "es" ? "Guardar póliza" : "Save entry")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Modal: Nueva cuenta ──
function AccountModal({ t, lang, accounts, onClose, onSaved }: { t: any; lang: string; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", account_type: "activo", nature: "deudora", parent_id: "", sat_code: "", is_postable: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError(lang === "es" ? "Número y nombre son obligatorios." : "Code and name required."); return; }
    setSaving(true); setError(null);
    try {
      await accountingService.createAccount({
        code: form.code.trim(), name: form.name.trim(), account_type: form.account_type, nature: form.nature,
        parent_id: form.parent_id ? Number(form.parent_id) : undefined, sat_code: form.sat_code.trim() || undefined, is_postable: form.is_postable, is_active: true,
      });
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.detail || (lang === "es" ? "Error al crear la cuenta" : "Error creating account")); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 16, width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Nueva cuenta" : "New account"}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}><X size={20} /></button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div style={{ background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>{lang === "es" ? "Número de cuenta" : "Account number"}</label><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="1109" style={inp} /></div>
            <div><label style={lbl}>{lang === "es" ? "Código SAT" : "SAT code"}</label><input value={form.sat_code} onChange={e => setForm(f => ({ ...f, sat_code: e.target.value }))} placeholder="105" style={inp} /></div>
          </div>
          <div><label style={lbl}>{lang === "es" ? "Nombre" : "Name"}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>{lang === "es" ? "Tipo" : "Type"}</label>
              <select value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                {["activo", "pasivo", "capital", "ingreso", "costo", "gasto", "orden"].map(x => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
              </select>
            </div>
            <div><label style={lbl}>{lang === "es" ? "Naturaleza" : "Nature"}</label>
              <select value={form.nature} onChange={e => setForm(f => ({ ...f, nature: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                <option value="deudora">Deudora</option><option value="acreedora">Acreedora</option>
              </select>
            </div>
          </div>
          <div><label style={lbl}>{lang === "es" ? "Cuenta padre (opcional)" : "Parent (optional)"}</label>
            <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "— Ninguna (cuenta de mayor) —" : "— None —"}</option>
              {accounts.filter(a => !a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t.textMid, cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_postable} onChange={e => setForm(f => ({ ...f, is_postable: e.target.checked }))} />
            {lang === "es" ? "Cuenta de detalle (recibe movimientos)" : "Detail account (postable)"}
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={submit} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{saving ? "…" : (lang === "es" ? "Guardar" : "Save")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Vista: Mayor / auxiliar ──
function LedgerView({ t, lang, postable }: { t: any; lang: string; postable: Account[] }) {
  const [accountId, setAccountId] = useState<number | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [report, setReport] = useState<LedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" };

  const run = async (id: number) => {
    setLoading(true);
    try {
      const params: any = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      setReport(await accountingService.getLedger(id, params));
    } catch { setReport(null); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 }}>{lang === "es" ? "Cuenta" : "Account"}</label>
          <select value={accountId} onChange={e => { const id = e.target.value ? Number(e.target.value) : ""; setAccountId(id); if (id) run(id as number); }} style={{ ...inp, width: "100%", cursor: "pointer" }}>
            <option value="">{lang === "es" ? "— Elige una cuenta —" : "— Pick an account —"}</option>
            {postable.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </div>
        <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 }}>{lang === "es" ? "Desde" : "From"}</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} /></div>
        <div><label style={{ fontSize: 12, fontWeight: 600, color: t.textMid, display: "block", marginBottom: 6 }}>{lang === "es" ? "Hasta" : "To"}</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} /></div>
        <button onClick={() => accountId && run(accountId as number)} disabled={!accountId} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: accountId ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600, opacity: accountId ? 1 : 0.5 }}>{lang === "es" ? "Consultar" : "Run"}</button>
      </div>

      {loading && <div style={{ color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}

      {report && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {[
              { label: lang === "es" ? "Saldo inicial" : "Opening", value: mxn(report.opening_balance), color: t.textMid },
              { label: lang === "es" ? "Cargos" : "Debit", value: mxn(report.total_debit), color: t.good },
              { label: lang === "es" ? "Abonos" : "Credit", value: mxn(report.total_credit), color: t.warn },
              { label: lang === "es" ? "Saldo final" : "Closing", value: mxn(report.closing_balance), color: t.nova },
            ].map(k => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              </div>
            ))}
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Folio", "Fecha", "Concepto", "Cargo", "Abono", "Saldo"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 14px", textAlign: i >= 3 ? "right" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.movements.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 36, color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Sin movimientos en el periodo." : "No movements."}</td></tr>
                  ) : report.movements.map((m, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${t.borderSoft}` }}>
                      <td style={{ padding: "9px 14px", fontFamily: "monospace", color: t.nova, fontSize: 12.5 }}>{m.folio}</td>
                      <td style={{ padding: "9px 14px", fontSize: 12.5, color: t.textMid }}>{new Date(m.date).toLocaleDateString("es-MX")}</td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: t.textHi }}>{m.concept || "—"}</td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: t.textHi, textAlign: "right" }}>{m.debit ? mxn(m.debit) : "—"}</td>
                      <td style={{ padding: "9px 14px", fontSize: 13, color: t.textHi, textAlign: "right" }}>{m.credit ? mxn(m.credit) : "—"}</td>
                      <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: t.textHi, textAlign: "right" }}>{mxn(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Vista: Estados financieros (Balanza · Balance General · Estado de Resultados) ──
function ReportsView({ t, lang }: { t: any; lang: string }) {
  type Kind = "trial" | "balance" | "income";
  const [kind, setKind] = useState<Kind>("balance");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(false);
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [is_, setIs] = useState<IncomeStatement | null>(null);

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" };
  const card: React.CSSProperties = { ...glass(t), borderRadius: 12, padding: 18 };
  const sectionTitle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 4px 6px" };
  const rowLine = (name: string, amount: number, opts: { bold?: boolean; indent?: number; color?: string } = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 4px", paddingLeft: 4 + (opts.indent || 0) * 14, borderBottom: `1px solid ${t.borderSoft}` }}>
      <span style={{ fontSize: 13, color: opts.color || (opts.bold ? t.textHi : t.textMid), fontWeight: opts.bold ? 700 : 400 }}>{name}</span>
      <span style={{ fontSize: 13, color: opts.color || t.textHi, fontWeight: opts.bold ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{mxn(amount)}</span>
    </div>
  );

  const run = async () => {
    setLoading(true);
    try {
      if (kind === "trial") {
        const p: any = {}; if (dateFrom) p.date_from = dateFrom; if (dateTo) p.date_to = dateTo;
        setTb(await accountingService.getTrialBalance(p));
      } else if (kind === "balance") {
        const p: any = {}; if (asOf) p.as_of = asOf;
        setBs(await accountingService.getBalanceSheet(p));
      } else {
        const p: any = {}; if (dateFrom) p.date_from = dateFrom; if (dateTo) p.date_to = dateTo;
        setIs(await accountingService.getIncomeStatement(p));
      }
    } catch { /* vacío */ }
    finally { setLoading(false); }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind]);

  const KINDS: { id: Kind; label: string; icon: any }[] = [
    { id: "balance", label: lang === "es" ? "Balance General" : "Balance Sheet", icon: Scale },
    { id: "income", label: lang === "es" ? "Estado de Resultados" : "Income Statement", icon: TrendingUp },
    { id: "trial", label: lang === "es" ? "Balanza de comprobación" : "Trial Balance", icon: BarChart3 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${kind === k.id ? t.nova : t.border}`, background: kind === k.id ? t.nova + "1e" : "transparent", color: kind === k.id ? t.nova : t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <k.icon size={15} /> {k.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          {kind === "balance" ? (
            <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Al día" : "As of"}</label><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={inp} /></div>
          ) : (
            <>
              <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Desde" : "From"}</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Hasta" : "To"}</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} /></div>
            </>
          )}
          <button onClick={run} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{lang === "es" ? "Generar" : "Run"}</button>
        </div>
      </div>

      {loading && <div style={{ color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Calculando…" : "Calculating…"}</div>}

      {kind === "balance" && bs && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <div style={card}>
            <div style={sectionTitle}>{lang === "es" ? "Activo" : "Assets"}</div>
            {bs.activo.map(l => rowLine(`${l.code} · ${l.name}`, l.amount))}
            {rowLine(lang === "es" ? "Total activo" : "Total assets", bs.total_activo, { bold: true, color: t.nova })}
          </div>
          <div style={card}>
            <div style={sectionTitle}>{lang === "es" ? "Pasivo" : "Liabilities"}</div>
            {bs.pasivo.map(l => rowLine(`${l.code} · ${l.name}`, l.amount))}
            {rowLine(lang === "es" ? "Total pasivo" : "Total liabilities", bs.total_pasivo, { bold: true })}
            <div style={{ ...sectionTitle, marginTop: 8 }}>{lang === "es" ? "Capital" : "Equity"}</div>
            {bs.capital.map(l => rowLine(`${l.code} · ${l.name}`, l.amount))}
            {rowLine(lang === "es" ? "Resultado del ejercicio" : "Net result", bs.resultado_ejercicio, { color: bs.resultado_ejercicio >= 0 ? t.good : t.bad })}
            {rowLine(lang === "es" ? "Total capital" : "Total equity", bs.total_capital, { bold: true })}
            {rowLine(lang === "es" ? "Pasivo + Capital" : "Liab. + Equity", bs.total_pasivo + bs.total_capital, { bold: true, color: t.nova })}
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: bs.balanced ? t.good : t.bad, display: "flex", alignItems: "center", gap: 6 }}>
              {bs.balanced ? <Check size={14} /> : <AlertTriangle size={14} />}
              {bs.balanced ? (lang === "es" ? "El balance cuadra" : "Balanced") : (lang === "es" ? `Descuadre: ${mxn(bs.difference)}` : `Off by ${mxn(bs.difference)}`)}
            </div>
          </div>
        </div>
      )}

      {kind === "income" && is_ && !loading && (
        <div style={{ ...card, maxWidth: 640 }}>
          <div style={sectionTitle}>{lang === "es" ? "Ingresos" : "Revenue"}</div>
          {is_.ingresos.map(l => rowLine(`${l.code} · ${l.name}`, l.amount, { indent: 1 }))}
          {rowLine(lang === "es" ? "Total ingresos" : "Total revenue", is_.total_ingresos, { bold: true })}
          <div style={sectionTitle}>{lang === "es" ? "Costos" : "Cost of sales"}</div>
          {is_.costos.map(l => rowLine(`${l.code} · ${l.name}`, l.amount, { indent: 1 }))}
          {rowLine(lang === "es" ? "Total costos" : "Total cost", is_.total_costos, { bold: true })}
          {rowLine(lang === "es" ? "Utilidad bruta" : "Gross profit", is_.utilidad_bruta, { bold: true, color: t.nova })}
          <div style={sectionTitle}>{lang === "es" ? "Gastos" : "Expenses"}</div>
          {is_.gastos.map(l => rowLine(`${l.code} · ${l.name}`, l.amount, { indent: 1 }))}
          {rowLine(lang === "es" ? "Total gastos" : "Total expenses", is_.total_gastos, { bold: true })}
          <div style={{ marginTop: 6, padding: "10px 4px", borderTop: `2px solid ${t.border}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: t.textHi }}>{is_.utilidad_neta >= 0 ? (lang === "es" ? "Utilidad neta" : "Net income") : (lang === "es" ? "Pérdida neta" : "Net loss")}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: is_.utilidad_neta >= 0 ? t.good : t.bad, fontVariantNumeric: "tabular-nums" }}>{mxn(is_.utilidad_neta)}</span>
          </div>
        </div>
      )}

      {kind === "trial" && tb && !loading && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: t.panel2 }}>
                  {["Cuenta", "Nombre", "Saldo inicial", "Cargos", "Abonos", "Saldo final"].map((h, i) => (
                    <th key={i} style={{ padding: "10px 14px", textAlign: i >= 2 ? "right" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tb.rows.map(r => (
                  <tr key={r.account_id} style={{ borderBottom: `1px solid ${t.borderSoft}`, background: r.is_postable ? "transparent" : t.panel2 }}>
                    <td style={{ padding: "8px 14px", fontFamily: "monospace", fontWeight: r.is_postable ? 500 : 700, color: t.nova, fontSize: 12.5, paddingLeft: 14 + (r.level - 1) * 14 }}>{r.code}</td>
                    <td style={{ padding: "8px 14px", fontSize: 13, color: t.textHi, fontWeight: r.is_postable ? 400 : 700 }}>{r.name}</td>
                    <td style={{ padding: "8px 14px", fontSize: 12.5, color: t.textMid, textAlign: "right" }}>{r.saldo_inicial ? mxn(r.saldo_inicial) : "—"}</td>
                    <td style={{ padding: "8px 14px", fontSize: 12.5, color: t.textMid, textAlign: "right" }}>{r.cargos ? mxn(r.cargos) : "—"}</td>
                    <td style={{ padding: "8px 14px", fontSize: 12.5, color: t.textMid, textAlign: "right" }}>{r.abonos ? mxn(r.abonos) : "—"}</td>
                    <td style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, color: t.textHi, textAlign: "right" }}>{mxn(r.saldo_final)}</td>
                  </tr>
                ))}
                <tr style={{ background: t.panel3 }}>
                  <td colSpan={3} style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Totales (detalle)" : "Totals"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: t.textHi, textAlign: "right" }}>{mxn(tb.total_cargos)}</td>
                  <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: t.textHi, textAlign: "right" }}>{mxn(tb.total_abonos)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, fontWeight: 700, color: Math.abs(tb.total_cargos - tb.total_abonos) < 0.01 ? t.good : t.bad }}>{Math.abs(tb.total_cargos - tb.total_abonos) < 0.01 ? "OK" : "≠"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista: Configuración contable — 2 sub-tabs ────────────────────────────────
// (a) Mapeo de cuentas para pólizas automáticas (rol → cuenta contable)
// (b) Políticas contables: flujo/devengado, perpetuo/analítico, nómina, etc.
function ConfigView({ t, lang, accounts }: { t: any; lang: string; accounts: Account[] }) {
  const [subtab, setSubtab] = useState<"map" | "policies">("map");
  const tabBtn: (active: boolean) => React.CSSProperties = (active) => ({
    padding: "9px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: active ? 700 : 500,
    background: active ? t.panel : "transparent",
    color: active ? t.nova : t.textLo,
    borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent",
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, gap: 2 }}>
        <button onClick={() => setSubtab("map")} style={tabBtn(subtab === "map")}>
          {lang === "es" ? "Cuentas para pólizas automáticas" : "Account mapping"}
        </button>
        <button onClick={() => setSubtab("policies")} style={tabBtn(subtab === "policies")}>
          {lang === "es" ? "Políticas contables" : "Accounting policies"}
        </button>
      </div>
      {subtab === "map" && <AccountMapView t={t} lang={lang} accounts={accounts} />}
      {subtab === "policies" && <PoliciesView t={t} lang={lang} />}
    </div>
  );
}

function AccountMapView({ t, lang, accounts }: { t: any; lang: string; accounts: Account[] }) {
  const [map, setMap] = useState<AccountMapItem[]>([]);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const inp: React.CSSProperties = { padding: "8px 11px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", cursor: "pointer" };

  useEffect(() => {
    accountingService.getAccountMap().then(m => {
      setMap(m);
      const d: Record<string, number | null> = {};
      m.forEach(x => { d[x.role] = x.account_id ?? null; });
      setDraft(d);
    }).catch(() => { });
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try { await accountingService.setAccountMap(draft); setMsg(lang === "es" ? "Configuración guardada ✓" : "Saved ✓"); }
    catch { setMsg(lang === "es" ? "No se pudo guardar" : "Error saving"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Zap size={16} color={t.warn} />
          <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Cuentas para pólizas automáticas" : "Accounts for auto entries"}</div>
        </div>
        <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 18, lineHeight: 1.5 }}>
          {lang === "es"
            ? "Define qué cuenta contable usa cada concepto. Con esto, cada venta y cobro generan su póliza automáticamente. Ya viene preconfigurado con el catálogo base; ajústalo si cambiaste tu catálogo."
            : "Map each concept to an account so sales and payments post automatically."}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {map.map(item => (
            <div key={item.role} style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: 12, alignItems: "center" }}>
              <label style={{ fontSize: 13, color: t.textMid, fontWeight: 600 }}>{item.label}</label>
              <select value={draft[item.role] ?? ""} onChange={e => setDraft(d => ({ ...d, [item.role]: e.target.value ? Number(e.target.value) : null }))} style={inp}>
                <option value="">{lang === "es" ? "— Sin asignar —" : "— None —"}</option>
                {accounts.filter(a => a.is_postable).map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
          <button onClick={save} disabled={saving} style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{saving ? "…" : (lang === "es" ? "Guardar" : "Save")}</button>
          {msg && <span style={{ fontSize: 12.5, color: msg.includes("✓") ? t.good : t.bad }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Vista: Políticas contables (Fase 4) ───────────────────────────────────────
// El contador escoge la política que mejor se ajuste al régimen fiscal y a la
// forma de llevar los libros de SU cliente. Cada política tiene una descripción
// legal breve, opciones documentadas y referencia a NIF/LISR/LIVA vigentes.
type PolicyOptDef = { value: string; label: string; desc: string };
type PolicyFieldDef = {
  key: string; title: string; nif?: string; help: string; options: PolicyOptDef[];
};

const POLICY_FIELDS: PolicyFieldDef[] = [
  {
    key: "iva_acreditable_scheme", title: "IVA acreditable (compras)",
    nif: "LIVA art. 4 · NIF C-9",
    help: "Momento en que el IVA de las facturas de proveedor se puede acreditar en la declaración mensual.",
    options: [
      { value: "pending_payment", label: "Pendiente de pago → pagado al liquidar", desc: "Cuenta 1106 al recibir la factura; se traslada a 1105 al pagarla. Régimen de flujo — recomendado para PyMEs, RESICO y personas físicas actividad empresarial." },
      { value: "direct_paid", label: "Pagado directo (al recibir la factura)", desc: "Cuenta 1105 desde el momento de la factura. Devengado clásico — solo si el régimen fiscal lo permite y así lo lleva el contador." },
    ],
  },
  {
    key: "iva_trasladado_scheme", title: "IVA trasladado (ventas)",
    nif: "LIVA art. 1-B · NIF C-9",
    help: "Momento en que el IVA cobrado a clientes se declara.",
    options: [
      { value: "pending_collection", label: "Pendiente de cobro → cobrado al liquidar", desc: "Cuenta 2104 al facturar; se traslada a 2103 al cobrar. Simétrico con el acreditable en base flujo." },
      { value: "direct_collected", label: "Cobrado directo (al facturar)", desc: "Cuenta 2103 desde la factura. Devengado clásico." },
    ],
  },
  {
    key: "cogs_scheme", title: "Costo de ventas",
    nif: "NIF C-4",
    help: "¿Cuándo se registra contablemente el costo de la mercancía vendida?",
    options: [
      { value: "perpetual", label: "Perpetuo (al vender, con costo FIFO)", desc: "Cada venta baja Inventarios y sube Costo de ventas con el costo integrado (landed) del FIFO. Máxima precisión — refleja el margen real cada día." },
      { value: "analytic", label: "Analítico (al cierre mensual)", desc: "Al cerrar el mes: Inv. inicial + Compras − Inv. final = Costo del período. Simple pero solo tienes el costo real al cierre." },
    ],
  },
  {
    key: "purchase_recognition", title: "Reconocimiento de compras",
    nif: "NIF A-2 (esencia sobre forma)",
    help: "¿En qué momento entra la compra al Estado de Resultados y a Proveedores?",
    options: [
      { value: "on_receive", label: "Al recibir la mercancía (recomendado)", desc: "El control físico marca el momento contable. Alineado con NIF A-2." },
      { value: "on_bill", label: "Al capturar la factura del proveedor", desc: "Si el flujo del cliente es que la mercancía llega antes que la factura, y quiere esperar al CFDI para contabilizar." },
      { value: "on_pay", label: "Al momento del pago", desc: "Solo si el cliente lleva 100% base flujo." },
    ],
  },
  {
    key: "payroll_scheme", title: "Nómina",
    nif: "LFT · LISR · LSS",
    help: "Nivel de detalle contable de la nómina en el Estado de Resultados.",
    options: [
      { value: "itemized", label: "Desglosada (sueldos + patronal + retenciones)", desc: "Sueldos, IMSS patronal, provisión aguinaldo y retenciones ISR/IMSS por separado. Nivel profesional — máxima trazabilidad." },
      { value: "consolidated", label: "Consolidada en Sueldos", desc: "Todo en la cuenta de Sueldos y salarios. Menor detalle pero suficiente para negocios pequeños." },
      { value: "admin_expense", label: "Cargada como gasto único de administración", desc: "Todo va a Gastos de administración. Solo si la empresa no requiere detalle por rubro." },
    ],
  },
  {
    key: "expense_basis", title: "Gastos operativos",
    nif: "LISR art. 27 · NIF C-9",
    help: "¿Los gastos se reconocen al capturarlos o al pagarlos?",
    options: [
      { value: "accrual", label: "Devengado (al capturar)", desc: "El gasto pega en el mes de la operación aunque se pague después. Base para PM régimen general." },
      { value: "cash", label: "Flujo (al pagar)", desc: "El gasto solo pega cuando sale el efectivo. RESICO / PF actividad empresarial." },
    ],
  },
  {
    key: "fx_scheme", title: "Tipo de cambio (operaciones USD/EUR)",
    nif: "NIF B-15",
    help: "¿Cómo se contabilizan las diferencias cambiarias en operaciones en moneda extranjera?",
    options: [
      { value: "transaction_date", label: "TC del día + póliza de dif. cambiaria al pagar", desc: "La factura entra al TC del día; al pagar, la diferencia va a Ganancia (4103) o Pérdida cambiaria (6103). Alineado con NIF B-15." },
      { value: "month_end_close", label: "Ajuste al cierre mensual (Banxico)", desc: "Menos preciso — solo se reevalúa la cartera al TC del último día del mes." },
    ],
  },
  {
    key: "labor_benefits_scheme", title: "Provisión de beneficios laborales",
    nif: "NIF D-3",
    help: "¿Cómo se acumula el aguinaldo, prima vacacional y PTU?",
    options: [
      { value: "monthly_provision", label: "Provisión mensual de 1/12 (recomendado)", desc: "Cada mes se acumula la doceava parte. Evita el 'salto' contable en diciembre cuando se paga el aguinaldo." },
      { value: "at_payment", label: "Registro al momento del pago", desc: "El aguinaldo pega solo en diciembre. Simple pero distorsiona el resultado mensual." },
    ],
  },
  {
    key: "depreciation_scheme", title: "Depreciación de activos fijos",
    nif: "LISR art. 34 · NIF C-6",
    help: "¿Cómo se registra la depreciación mensual?",
    options: [
      { value: "straight_line_monthly", label: "Línea recta automática mensual", desc: "El sistema genera la póliza el último día de cada mes según la vida útil fiscal de cada activo. Requiere activos con fecha de alta y tasa capturados." },
      { value: "manual", label: "Manual (el contador la registra)", desc: "Sin automatización — el contador arma la póliza cuando le convenga." },
    ],
  },
];

function PoliciesView({ t, lang }: { t: any; lang: string }) {
  void lang;
  const [policy, setPolicy] = useState<import("./service").AccountingPolicy | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [withholdingEnabled, setWithholdingEnabled] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    accountingService.getCurrentPolicy()
      .then(p => {
        setPolicy(p);
        const d: Record<string, any> = {};
        POLICY_FIELDS.forEach(f => { d[f.key] = (p as any)[f.key]; });
        setDraft(d);
        setWithholdingEnabled(!!p.withholding_enabled);
        if (p.effective_from) setEffectiveFrom(String(p.effective_from).slice(0, 10));
      })
      .catch(() => { });
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await accountingService.upsertPolicy({
        ...draft,
        withholding_enabled: withholdingEnabled,
        effective_from: new Date(effectiveFrom + "T00:00:00Z").toISOString(),
      });
      setMsg("Política guardada ✓");
      const p = await accountingService.getCurrentPolicy();
      setPolicy(p);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || "No se pudo guardar");
    } finally { setSaving(false); }
  };

  if (!policy) return <div style={{ padding: 40, color: t.textLo, fontSize: 13.5 }}>Cargando política vigente…</div>;

  const inp: React.CSSProperties = { padding: "8px 11px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>
          Políticas contables
        </div>
        <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 8, lineHeight: 1.5 }}>
          Cada opción cambia cómo se generan las pólizas automáticas del sistema. Escoge la que
          mejor se ajuste al régimen fiscal y a la forma de llevar los libros de la empresa —
          revisa la descripción y la referencia legal antes de guardar.
        </div>
        <div style={{ fontSize: 11.5, color: t.warn, marginBottom: 18, padding: "8px 12px", background: t.warn + "16", border: `1px solid ${t.warn}44`, borderRadius: 8 }}>
          ⚠ El cambio solo aplica a operaciones NUEVAS a partir de la fecha efectiva.
          Las pólizas históricas mantienen la política con la que se generaron.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <label style={{ fontSize: 12, color: t.textMid, fontWeight: 600, display: "block", marginBottom: 6 }}>Fecha efectiva</label>
            <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inp} />
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: t.textHi, cursor: "pointer" }}>
              <input type="checkbox" checked={withholdingEnabled} onChange={e => setWithholdingEnabled(e.target.checked)} />
              Aplicar retenciones automáticas a proveedores (LISR art. 106, 116)
            </label>
          </div>
        </div>
      </div>

      {POLICY_FIELDS.map(f => (
        <div key={f.key} style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>{f.title}</div>
            {f.nif && <span style={{ fontSize: 10.5, color: t.textLo, background: t.panel3, padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap", fontFamily: "monospace" }}>{f.nif}</span>}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginBottom: 12, lineHeight: 1.5 }}>{f.help}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {f.options.map(opt => {
              const active = draft[f.key] === opt.value;
              return (
                <label key={opt.value} onClick={() => setDraft(d => ({ ...d, [f.key]: opt.value }))}
                  style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                           background: active ? t.nova + "18" : t.panel2,
                           border: `1px solid ${active ? t.nova : t.border}`, transition: "all .12s" }}>
                  <input type="radio" checked={active} readOnly style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? t.nova : t.textHi }}>{opt.label}</div>
                    <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 3, lineHeight: 1.4 }}>{opt.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 4px" }}>
        <button onClick={save} disabled={saving}
          style={{ padding: "10px 24px", borderRadius: 10, border: "none",
                   background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
                   color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          {saving ? "Guardando…" : "Guardar política vigente"}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: msg.includes("✓") ? t.good : t.bad }}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Vista: Contabilidad Electrónica (SAT, Anexo 24) ──
function SatView({ t, lang }: { t: any; lang: string }) {
  const now = new Date();
  const [anio, setAnio] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [rfc, setRfc] = useState("");
  const [tipoEnvio, setTipoEnvio] = useState("N");
  const [tipoSol, setTipoSol] = useState("AF");
  const [numOrden, setNumOrden] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" };
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre", "Cierre (13)"];
  const baseParams = () => { const p: any = { anio, mes }; if (rfc.trim()) p.rfc = rfc.trim().toUpperCase(); return p; };
  const dl = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); }
    catch { setError(lang === "es" ? "No se pudo generar el XML. Verifica el RFC (o configúralo en el perfil de la empresa) y que existan movimientos en el periodo." : "Could not generate the XML."); }
    finally { setBusy(null); }
  };

  const card = (key: string, title: string, desc: string, icon: any, onDl: () => Promise<void>, extra?: any) => {
    const Icon = icon;
    return (
      <div style={{ ...glass(t), borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 10, padding: 9, display: "flex" }}><Icon size={18} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{title}</div>
            <div style={{ fontSize: 12, color: t.textLo }}>{desc}</div>
          </div>
        </div>
        {extra}
        <button onClick={() => dl(key, onDl)} disabled={busy === key} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <Download size={15} /> {busy === key ? (lang === "es" ? "Generando…" : "Generating…") : (lang === "es" ? "Descargar XML" : "Download XML")}
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.nova + "12", border: `1px solid ${t.nova}33`, color: t.textMid, borderRadius: 10, padding: "10px 14px", fontSize: 12.5 }}>
        <Info size={15} color={t.nova} /> {lang === "es" ? "Genera los XML del Anexo 24 y súbelos al Buzón Tributario del SAT con tu e.firma. Valídalos antes con el validador del SAT." : "Generate the Anexo 24 XMLs and upload them to the SAT portal."}
      </div>

      {/* Parámetros */}
      <div style={{ ...glass(t), borderRadius: 12, padding: 18, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Año" : "Year"}</label><input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ ...inp, width: 110 }} /></div>
        <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Mes" : "Month"}</label>
          <select value={mes} onChange={e => setMes(Number(e.target.value))} style={{ ...inp, cursor: "pointer" }}>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "RFC (opcional, usa el de la empresa)" : "RFC (optional)"}</label><input value={rfc} onChange={e => setRfc(e.target.value)} placeholder="XAXX010101000" style={{ ...inp, width: "100%", textTransform: "uppercase" }} /></div>
      </div>

      {error && <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}><AlertTriangle size={15} /> {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {card("cat", lang === "es" ? "Catálogo de cuentas" : "Chart of accounts", "CT · 1.3", Layers,
          () => accountingService.downloadSatCatalogo(baseParams()))}

        {card("bal", lang === "es" ? "Balanza de comprobación" : "Trial balance", "B" + (tipoEnvio === "C" ? "C" : "N") + " · 1.3", Scale,
          () => accountingService.downloadSatBalanza({ ...baseParams(), tipo_envio: tipoEnvio }),
          <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Tipo de envío" : "Type"}</label>
            <select value={tipoEnvio} onChange={e => setTipoEnvio(e.target.value)} style={{ ...inp, cursor: "pointer", width: "100%" }}>
              <option value="N">{lang === "es" ? "Normal" : "Normal"}</option>
              <option value="C">{lang === "es" ? "Complementaria" : "Complementary"}</option>
            </select>
          </div>
        )}

        {card("pol", lang === "es" ? "Pólizas del periodo" : "Journal entries", "PL · 1.3", FileText,
          () => accountingService.downloadSatPolizas({
            ...baseParams(), tipo_solicitud: tipoSol,
            num_orden: (tipoSol === "AF" || tipoSol === "FC") ? (numOrden.trim() || undefined) : undefined,
            num_tramite: (tipoSol === "DE" || tipoSol === "CO") ? (numOrden.trim() || undefined) : undefined,
          }),
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{lang === "es" ? "Tipo de solicitud" : "Request type"}</label>
              <select value={tipoSol} onChange={e => setTipoSol(e.target.value)} style={{ ...inp, cursor: "pointer", width: "100%" }}>
                <option value="AF">AF · {lang === "es" ? "Acto de fiscalización" : "Audit"}</option>
                <option value="FC">FC · {lang === "es" ? "Fiscalización compulsa" : "Compulsa"}</option>
                <option value="DE">DE · {lang === "es" ? "Devolución" : "Refund"}</option>
                <option value="CO">CO · {lang === "es" ? "Compensación" : "Offset"}</option>
              </select>
            </div>
            <div><label style={{ fontSize: 11, color: t.textLo, display: "block", marginBottom: 4 }}>{(tipoSol === "DE" || tipoSol === "CO") ? (lang === "es" ? "No. trámite" : "Procedure no.") : (lang === "es" ? "No. orden" : "Order no.")}</label><input value={numOrden} onChange={e => setNumOrden(e.target.value)} placeholder={tipoSol === "AF" ? "ABC6912345/12" : ""} style={{ ...inp, width: "100%" }} /></div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── Vista: Cierre mensual ─────────────────────────────────────────────
function PeriodCloseView({ t, lang, onChanged }: { t: any; lang: string; onChanged?: () => void }) {
  const [closes, setCloses] = useState<PeriodClose[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [notes, setNotes] = useState("");

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await accountingService.listPeriodCloses();
      setCloses(rows);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo cargar el historial");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const doClose = async () => {
    if (!confirm(lang === "es"
      ? `¿Cerrar el período ${year}-${String(month).padStart(2, "0")}?\n\nSe congelarán todas las pólizas de ese mes. Solo un superusuario puede reabrirlo después.`
      : `Close period ${year}-${String(month).padStart(2, "0")}?`)) return;
    setBusy(true); setError(null);
    try {
      const res = await accountingService.closePeriod(year, month, notes.trim() || undefined);
      alert(res.message);
      setNotes("");
      await load(); onChanged?.();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo cerrar el período");
    } finally { setBusy(false); }
  };

  const doReopen = async (pc: PeriodClose) => {
    const reason = prompt(lang === "es"
      ? `Razón para reabrir ${pc.period}:\n(quedará registrado en la bitácora de auditoría)`
      : `Reason to reopen ${pc.period}:`);
    if (!reason || !reason.trim()) return;
    setBusy(true); setError(null);
    try {
      await accountingService.reopenPeriod(pc.year, pc.month, reason.trim());
      await load(); onChanged?.();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo reabrir el período");
    } finally { setBusy(false); }
  };

  const closedThisYear = closes.filter(c => c.year === now.getFullYear() && c.status === "closed").length;
  const isPeriodClosed = closes.some(c => c.year === year && c.month === month && c.status === "closed");
  const monthLabels = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div style={{ ...glass(t), borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Meses cerrados {now.getFullYear()}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: t.good, marginTop: 4 }}>{closedThisYear} / 12</div>
        </div>
        <div style={{ ...glass(t), borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Último cierre</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.textHi, marginTop: 4 }}>
            {closes.filter(c => c.status === "closed")[0]?.period || "—"}
          </div>
        </div>
        <div style={{ ...glass(t), borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Reaperturas</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: closes.filter(c => c.status === "reopened").length > 0 ? t.warn : t.textHi, marginTop: 4 }}>
            {closes.filter(c => c.status === "reopened").length}
          </div>
        </div>
      </div>

      {/* Formulario de cierre */}
      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 10, padding: 9 }}><Lock size={18} /></div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Cerrar un período" : "Close a period"}</div>
            <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2 }}>{lang === "es" ? "Congela las pólizas de ese mes y guarda snapshot del trial balance, estado de resultados y balance." : "Freezes entries of the month and saves a snapshot."}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Año</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...inp, width: 100, cursor: "pointer" }}>
              {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Mes</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...inp, width: 120, cursor: "pointer" }}>
              {monthLabels.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{i + 1} · {m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: t.textLo, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>Notas (opcional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ej. Cierre firmado por contador el 5 del mes" style={inp} />
          </div>
          <button disabled={busy || isPeriodClosed} onClick={doClose}
            style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: isPeriodClosed ? t.panel3 : `linear-gradient(135deg, ${t.nova}, ${t.navy || "#1e40af"})`, color: "#fff", cursor: (busy || isPeriodClosed) ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={14} /> {busy ? "…" : (isPeriodClosed ? "Ya cerrado" : "Cerrar mes")}
          </button>
        </div>
        {isPeriodClosed && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: t.warn, display: "flex", alignItems: "center", gap: 5 }}>
            <AlertTriangle size={12} /> Este período ya está cerrado. Reábrelo desde la tabla inferior si necesitas modificarlo.
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: "12px 14px", background: t.bad + "18", border: `1px solid ${t.bad}55`, color: t.bad, borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Historial */}
      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <Calendar size={15} color={t.nova} />
          <div style={{ fontSize: 13.5, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Historial de cierres" : "Close history"}</div>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: t.textLo }}>{closes.length} registros</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ background: t.panel2 }}>
                {["Período", "Estado", "Cerrado", "Reabierto", "Notas", ""].map((h, i) => (
                  <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${t.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>Cargando…</td></tr>
              )}
              {!loading && closes.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: t.textLo, fontSize: 13 }}>Sin cierres registrados</td></tr>
              )}
              {!loading && closes.map((c, i) => (
                <tr key={c.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                  <td style={{ padding: "10px 14px", fontSize: 13.5, color: t.textHi, fontWeight: 700, fontFamily: "monospace" }}>{c.period}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: c.status === "closed" ? t.good : t.warn, background: (c.status === "closed" ? t.good : t.warn) + "22", padding: "3px 10px", borderRadius: 20 }}>
                      {c.status === "closed" ? <><Lock size={11} /> Cerrado</> : <><Unlock size={11} /> Reabierto</>}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12.5, color: t.textMid }}>{c.closed_at ? new Date(c.closed_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12.5, color: c.reopened_at ? t.warn : t.textLo }}>
                    {c.reopened_at ? new Date(c.reopened_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: t.textMid, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.notes || ""}>{c.notes || "—"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    {c.status === "closed" && (
                      <button onClick={() => doReopen(c)} disabled={busy}
                        style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${t.warn}55`, background: t.warn + "18", color: t.warn, cursor: "pointer", fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Unlock size={11} /> Reabrir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
