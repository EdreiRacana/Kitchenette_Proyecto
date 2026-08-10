// Conciliación bancaria — workspace dedicado dual-pane.
// Estándar CONTPAQi/NetSuite: selector cuenta + periodo, saldos con validación
// visual, dos paneles (Banco | Sistema), match manual, importar extracto,
// completar sesión, descarga PDF/XLSX oficial.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Upload, Download, FileText, CheckCircle2, XCircle,
  Link2, Unlink, Search, AlertTriangle, Lock, Unlock, Save,
} from "lucide-react";
import api from "../../services/api";

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                 "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const mxn = (n: number | null | undefined) =>
  "$" + (n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface BankAccount {
  id: number; name: string; bank?: string;
  account_number?: string; balance: number;
}

interface BankTx {
  id: number; type: string; amount: number;
  description?: string; reference?: string;
  reconciled: boolean; bank_date?: string; created_at?: string;
  matched_transaction_id?: number | null;
  source: string;
}

interface SysTx {
  id: number; type: "income" | "expense"; amount: number;
  category?: string; description?: string; reference?: string;
  matched: boolean; created_at?: string;
}

interface Reconciliation {
  id: number; bank_account_id: number;
  period_year: number; period_month: number;
  opening_balance: number; closing_balance_bank: number;
  closing_balance_system: number; difference: number;
  status: "draft" | "completed" | "reopened";
  notes?: string; completed_at?: string;
}

interface Workspace {
  reconciliation: Reconciliation;
  bank_transactions: BankTx[];
  system_transactions: SysTx[];
  totals: {
    bank_deposits: number; bank_withdrawals: number;
    sys_income: number; sys_expense: number;
    matched_count: number;
    unmatched_bank_count: number; unmatched_sys_count: number;
  };
}


export default function ReconciliationWorkspace({ t, lang }: { t: any; lang: string }) {
  const now = new Date();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBank, setSelectedBank] = useState<number | null>(null);
  const [openBank, setOpenBank] = useState("");
  const [closeBank, setCloseBank] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "unmatched" | "matched">("unmatched");
  const [q, setQ] = useState("");

  const loadAccounts = useCallback(async () => {
    try {
      const r = await api.get<BankAccount[]>("/finance/banks");
      setAccounts(r.data || []);
      if (r.data?.length && accountId == null) setAccountId(r.data[0].id);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudieron cargar cuentas bancarias");
    }
  }, [accountId]);

  const loadWorkspace = useCallback(async () => {
    if (accountId == null) return;
    setLoading(true); setError(null);
    try {
      const r = await api.get<Workspace>("/finance/reconciliation/workspace",
        { params: { bank_account_id: accountId, year, month } });
      setData(r.data);
      setOpenBank(String(r.data.reconciliation.opening_balance || 0));
      setCloseBank(String(r.data.reconciliation.closing_balance_bank || 0));
      setNotes(r.data.reconciliation.notes || "");
      setSelectedBank(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Error al cargar workspace");
    } finally { setLoading(false); }
  }, [accountId, year, month]);

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { if (accountId) loadWorkspace(); }, [loadWorkspace, accountId]);

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2020; y--) arr.push(y);
    return arr;
  }, [now]);

  const isCompleted = data?.reconciliation.status === "completed";
  const rec = data?.reconciliation;
  const totals = data?.totals;

  const filteredBank = useMemo(() => {
    if (!data) return [];
    return data.bank_transactions.filter(b => {
      if (filter === "matched" && !b.matched_transaction_id) return false;
      if (filter === "unmatched" && b.matched_transaction_id) return false;
      if (q) {
        const qs = q.toLowerCase();
        if (!(b.description || "").toLowerCase().includes(qs)
            && !(b.reference || "").toLowerCase().includes(qs)
            && !String(b.amount).includes(qs)) return false;
      }
      return true;
    });
  }, [data, filter, q]);

  const filteredSys = useMemo(() => {
    if (!data) return [];
    return data.system_transactions.filter(t => {
      if (filter === "matched" && !t.matched) return false;
      if (filter === "unmatched" && t.matched) return false;
      if (q) {
        const qs = q.toLowerCase();
        if (!(t.description || "").toLowerCase().includes(qs)
            && !(t.reference || "").toLowerCase().includes(qs)
            && !(t.category || "").toLowerCase().includes(qs)
            && !String(t.amount).includes(qs)) return false;
      }
      return true;
    });
  }, [data, filter, q]);

  const doMatch = async (systemTxId: number) => {
    if (selectedBank == null || isCompleted) return;
    setBusy(true);
    try {
      await api.post("/finance/reconciliation/match",
        { bank_tx_id: selectedBank, system_tx_id: systemTxId });
      setSelectedBank(null);
      await loadWorkspace();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setBusy(false); }
  };

  const doUnmatch = async (bankTxId: number) => {
    if (isCompleted) return;
    setBusy(true);
    try {
      await api.post("/finance/reconciliation/unmatch", { bank_tx_id: bankTxId });
      await loadWorkspace();
    } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const saveBalances = async () => {
    if (!rec) return;
    setBusy(true);
    try {
      await api.put(`/finance/reconciliation/${rec.id}`, {
        opening_balance: Number(openBank) || 0,
        closing_balance_bank: Number(closeBank) || 0,
        notes,
      });
      await loadWorkspace();
    } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    if (!rec) return;
    if (Math.abs(rec.difference) > 1 && !confirm(
      lang === "es"
        ? `La diferencia es ${mxn(rec.difference)}. ¿Cerrar de todas formas?`
        : `Difference is ${mxn(rec.difference)}. Complete anyway?`
    )) return;
    setBusy(true);
    try {
      await api.post(`/finance/reconciliation/${rec.id}/complete`);
      await loadWorkspace();
    } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!rec) return;
    if (!confirm(lang === "es" ? "¿Reabrir esta conciliación?" : "Reopen this reconciliation?")) return;
    setBusy(true);
    try {
      await api.post(`/finance/reconciliation/${rec.id}/reopen`);
      await loadWorkspace();
    } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
    finally { setBusy(false); }
  };

  const download = async (kind: "pdf" | "xlsx") => {
    if (!rec) return;
    try {
      const res = await api.get(`/finance/reconciliation/${rec.id}/${kind}`, { responseType: "blob" });
      const cd = (res.headers as any)["content-disposition"] || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const fname = m ? m[1] : `conciliacion.${kind}`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
    } catch { alert("Error al descargar"); }
  };

  const importStatement = async () => {
    if (accountId == null) return;
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".csv,.xlsx,.xls";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const form = new FormData();
      form.append("bank_account_id", String(accountId));
      form.append("file", f);
      setBusy(true);
      try {
        const r = await api.post("/finance/reconciliation/import", form,
          { headers: { "Content-Type": "multipart/form-data" } });
        alert(lang === "es"
          ? `Importados: ${r.data.imported} · Match automático: ${r.data.matched} (${r.data.match_rate}%)`
          : `Imported: ${r.data.imported} · Auto-matched: ${r.data.matched} (${r.data.match_rate}%)`);
        await loadWorkspace();
      } catch (e: any) { alert(e?.response?.data?.detail || "Error"); }
      finally { setBusy(false); }
    };
    input.click();
  };

  const diffColor = rec && Math.abs(rec.difference) < 1
    ? (t.good || "#22c55e")
    : rec && Math.abs(rec.difference) < 100
    ? (t.warn || "#f59e0b")
    : (t.bad || "#ef4444");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, color: t.textHi, fontWeight: 700 }}>
            {lang === "es" ? "Conciliación Bancaria" : "Bank Reconciliation"}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3, maxWidth: 640 }}>
            {lang === "es"
              ? "Concilia mes a mes los movimientos del extracto bancario contra las transacciones del sistema. Match manual, importación de extracto y reporte oficial firmable."
              : "Reconcile bank statement lines against system transactions month by month. Manual matching, statement import, and signable official report."}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 12, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
        <select value={accountId ?? ""} onChange={e => setAccountId(Number(e.target.value))}
          style={selectStyle(t)}>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}{a.bank ? ` · ${a.bank}` : ""}</option>
          ))}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selectStyle(t)}>
          {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle(t)}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={importStatement} disabled={busy || isCompleted} style={secBtn(t)}>
            <Upload size={13} /> {lang === "es" ? "Importar extracto" : "Import statement"}
          </button>
          {rec && (
            <>
              <button onClick={() => download("xlsx")} style={secBtn(t)}>
                <Download size={13} /> XLSX
              </button>
              <button onClick={() => download("pdf")} style={secBtn(t)}>
                <FileText size={13} /> PDF
              </button>
              {!isCompleted ? (
                <button onClick={complete} disabled={busy} style={primBtn(t)}>
                  <Lock size={13} /> {lang === "es" ? "Cerrar mes" : "Complete"}
                </button>
              ) : (
                <button onClick={reopen} disabled={busy} style={secBtn(t)}>
                  <Unlock size={13} /> {lang === "es" ? "Reabrir" : "Reopen"}
                </button>
              )}
            </>
          )}
          <button onClick={loadWorkspace} style={secBtn(t)}><RefreshCw size={13} /></button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: (t.bad || "#ef4444") + "18", color: t.bad, borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>
          {lang === "es" ? "Cargando…" : "Loading…"}
        </div>
      )}

      {!loading && rec && (
        <>
          {/* Saldos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <BalanceTile t={t}
              label={lang === "es" ? "Saldo inicial (banco)" : "Opening balance (bank)"}
              editable={!isCompleted}
              value={openBank}
              onChange={setOpenBank}
              onBlur={saveBalances} />
            <BalanceTile t={t}
              label={lang === "es" ? "Saldo final (banco)" : "Closing balance (bank)"}
              editable={!isCompleted}
              value={closeBank}
              onChange={setCloseBank}
              onBlur={saveBalances} />
            <div style={tile(t)}>
              <div style={tileLabel(t)}>
                {lang === "es" ? "Saldo final (sistema)" : "Closing balance (system)"}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
                {mxn(rec.closing_balance_system)}
              </div>
            </div>
            <div style={{ ...tile(t), background: diffColor + "18", border: `1px solid ${diffColor}55` }}>
              <div style={tileLabel(t)}>{lang === "es" ? "Diferencia" : "Difference"}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: diffColor, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 6 }}>
                {Math.abs(rec.difference) < 1 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                {mxn(rec.difference)}
              </div>
            </div>
          </div>

          {/* Estado + notas */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: t.panel2, borderRadius: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
                            background: (isCompleted ? t.good : t.warn) + "22",
                            color: isCompleted ? t.good : t.warn }}>
              {isCompleted
                ? (lang === "es" ? "CERRADO" : "COMPLETED")
                : rec.status === "reopened"
                ? (lang === "es" ? "REABIERTO" : "REOPENED")
                : (lang === "es" ? "BORRADOR" : "DRAFT")}
            </span>
            <span style={{ fontSize: 12, color: t.textMid }}>
              {totals?.matched_count} {lang === "es" ? "conciliados" : "matched"} ·
              {" "}{totals?.unmatched_bank_count} {lang === "es" ? "banco pendiente" : "bank pending"} ·
              {" "}{totals?.unmatched_sys_count} {lang === "es" ? "sistema pendiente" : "system pending"}
            </span>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              onBlur={saveBalances}
              disabled={isCompleted}
              placeholder={lang === "es" ? "Notas de la conciliación…" : "Reconciliation notes…"}
              style={{ flex: 1, minWidth: 200, padding: "6px 10px", borderRadius: 6,
                        border: `1px solid ${t.border}`, background: t.panel,
                        color: t.textHi, fontSize: 12, outline: "none" }} />
          </div>

          {/* Filtros */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", background: t.panel2, borderRadius: 8, padding: 3, border: `1px solid ${t.border}` }}>
              {(["unmatched", "matched", "all"] as const).map(k => (
                <button key={k} onClick={() => setFilter(k)}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none",
                            background: filter === k ? t.nova : "transparent",
                            color: filter === k ? "#fff" : t.textMid,
                            cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                  {k === "unmatched" ? (lang === "es" ? "Sin conciliar" : "Unmatched")
                    : k === "matched" ? (lang === "es" ? "Conciliados" : "Matched")
                    : (lang === "es" ? "Todos" : "All")}
                </button>
              ))}
            </div>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder={lang === "es" ? "Buscar por descripción, referencia o monto…" : "Search…"}
                style={{ padding: "8px 12px 8px 32px", borderRadius: 8,
                          border: `1px solid ${t.border}`, background: t.panel2,
                          color: t.textHi, fontSize: 12.5, outline: "none",
                          width: "100%", boxSizing: "border-box" }} />
            </div>
            {selectedBank != null && (
              <div style={{ padding: "6px 12px", background: t.nova + "22", color: t.nova, borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                {lang === "es" ? "Selecciona la transacción del sistema para hacer match" : "Pick a system transaction to match"}
                <button onClick={() => setSelectedBank(null)} style={{ marginLeft: 8, background: "transparent", border: "none", color: t.nova, cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
            )}
          </div>

          {/* Dual pane */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Banco */}
            <div style={paneStyle(t)}>
              <div style={paneHeader(t, t.warn || "#f59e0b")}>
                {lang === "es" ? "Extracto bancario" : "Bank statement"}
                <span style={{ marginLeft: "auto", fontSize: 11, color: t.textLo }}>
                  {filteredBank.length} {lang === "es" ? "movs" : "movs"}
                </span>
              </div>
              <div style={{ maxHeight: 480, overflowY: "auto" }}>
                {filteredBank.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 12 }}>
                    {lang === "es" ? "Sin movimientos. Importa un extracto." : "No movements. Import a statement."}
                  </div>
                ) : filteredBank.map(b => (
                  <BankRow key={b.id} t={t} row={b}
                    selected={selectedBank === b.id}
                    disabled={!!(isCompleted || b.matched_transaction_id)}
                    onSelect={() => setSelectedBank(b.id === selectedBank ? null : b.id)}
                    onUnmatch={() => doUnmatch(b.id)}
                    isCompleted={isCompleted} />
                ))}
              </div>
            </div>

            {/* Sistema */}
            <div style={paneStyle(t)}>
              <div style={paneHeader(t, t.nova || "#33B2F5")}>
                {lang === "es" ? "Transacciones del sistema" : "System transactions"}
                <span style={{ marginLeft: "auto", fontSize: 11, color: t.textLo }}>
                  {filteredSys.length} {lang === "es" ? "movs" : "movs"}
                </span>
              </div>
              <div style={{ maxHeight: 480, overflowY: "auto" }}>
                {filteredSys.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: t.textLo, fontSize: 12 }}>
                    {lang === "es" ? "Sin transacciones del sistema" : "No system transactions"}
                  </div>
                ) : filteredSys.map(s => (
                  <SysRow key={s.id} t={t} row={s}
                    matchable={selectedBank != null && !s.matched && !isCompleted}
                    onMatch={() => doMatch(s.id)} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// ── Subcomponents ──────────────────────────────────────────────────────

function BalanceTile({ t, label, editable, value, onChange, onBlur }: any) {
  return (
    <div style={tile(t)}>
      <div style={tileLabel(t)}>{label}</div>
      {editable ? (
        <input type="number" step="0.01" value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ width: "100%", padding: "5px 8px", borderRadius: 6,
                    border: `1px solid ${t.border}`, background: t.panel2,
                    color: t.textHi, fontSize: 18, fontWeight: 800,
                    fontVariantNumeric: "tabular-nums", textAlign: "left",
                    outline: "none" }} />
      ) : (
        <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
          ${Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}


function BankRow({ t, row, selected, disabled, onSelect, onUnmatch, isCompleted }: any) {
  const isMatched = !!row.matched_transaction_id;
  const dateStr = (row.bank_date || row.created_at || "").slice(0, 10);
  return (
    <div onClick={disabled ? undefined : onSelect}
      style={{
        padding: "10px 12px", borderBottom: `1px solid ${t.border}`,
        cursor: disabled ? "default" : "pointer",
        background: selected ? t.nova + "22" : isMatched ? t.good + "10" : "transparent",
        display: "flex", alignItems: "center", gap: 10,
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 12.5, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.description || row.reference || row.type}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: row.amount >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444"), fontVariantNumeric: "tabular-nums" }}>
            {row.amount >= 0 ? "+" : ""}{mxn(row.amount)}
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2, display: "flex", gap: 8 }}>
          <span>{dateStr}</span>
          {row.reference && <span>· {row.reference}</span>}
          {row.source !== "manual" && <span style={{ color: t.textLo }}>· {row.source}</span>}
        </div>
      </div>
      {isMatched && !isCompleted && (
        <button onClick={(e) => { e.stopPropagation(); onUnmatch(); }}
          title="Desconciliar"
          style={{ padding: 4, borderRadius: 4, border: `1px solid ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer" }}>
          <Unlink size={12} />
        </button>
      )}
      {isMatched && <CheckCircle2 size={14} color={t.good} />}
    </div>
  );
}


function SysRow({ t, row, matchable, onMatch }: any) {
  const dateStr = (row.created_at || "").slice(0, 10);
  const amt = row.type === "income" ? row.amount : -row.amount;
  return (
    <div style={{
      padding: "10px 12px", borderBottom: `1px solid ${t.border}`,
      background: row.matched ? t.good + "10" : "transparent",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 12.5, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.description || row.reference || row.category || row.type}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: amt >= 0 ? (t.good || "#22c55e") : (t.bad || "#ef4444"), fontVariantNumeric: "tabular-nums" }}>
            {amt >= 0 ? "+" : ""}{mxn(amt)}
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2, display: "flex", gap: 8 }}>
          <span>{dateStr}</span>
          {row.category && <span>· {row.category}</span>}
          {row.reference && <span>· {row.reference}</span>}
        </div>
      </div>
      {matchable && (
        <button onClick={onMatch}
          title="Hacer match"
          style={{ padding: "5px 10px", borderRadius: 6, border: "none",
                    background: t.nova, color: "#fff", cursor: "pointer",
                    fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <Link2 size={12} /> Match
        </button>
      )}
      {row.matched && <CheckCircle2 size={14} color={t.good} />}
    </div>
  );
}


// ── Style helpers ──────────────────────────────────────────────────────

const tile = (t: any): React.CSSProperties => ({
  padding: 12, background: t.panel, border: `1px solid ${t.border}`,
  borderRadius: 10,
});
const tileLabel = (t: any): React.CSSProperties => ({
  fontSize: 10.5, color: t.textLo, textTransform: "uppercase",
  letterSpacing: 0.4, marginBottom: 4,
});
const paneStyle = (t: any): React.CSSProperties => ({
  background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10,
  overflow: "hidden",
});
const paneHeader = (t: any, color: string): React.CSSProperties => ({
  padding: "10px 12px", background: t.panel2,
  borderBottom: `2px solid ${color}`, fontSize: 12, fontWeight: 700,
  color: t.textHi, textTransform: "uppercase", letterSpacing: 0.4,
  display: "flex", alignItems: "center",
});
const selectStyle = (t: any): React.CSSProperties => ({
  padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textHi, fontSize: 12.5, outline: "none",
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
