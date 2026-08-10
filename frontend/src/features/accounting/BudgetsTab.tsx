// Presupuestos vs Real — matriz editable + comparativo con semáforo.
// Dos vistas: Captura (edición) y Variación (real vs presupuesto).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Download, Save, Copy, Plus, Search,
  ChevronUp, ChevronDown, TrendingUp, Info,
} from "lucide-react";
import { budgetService, accountingService, type BudgetRow, type BudgetVariance, type Account } from "./service";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
                "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_KEYS = ["m1","m2","m3","m4","m5","m6","m7","m8","m9","m10","m11","m12"] as const;

const mxn = (n: number | null | undefined, showZero = false) => {
  if (n == null || (!showZero && !n)) return "—";
  return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

type View = "capture" | "variance";

export default function BudgetsTab({ t, lang }: { t: any; lang: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [view, setView] = useState<View>("capture");
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [variance, setVariance] = useState<BudgetVariance | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Record<number, Partial<BudgetRow>>>({});
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [copyingYear, setCopyingYear] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [b, a] = await Promise.all([
        budgetService.list(year),
        accountingService.getAccounts(true),
      ]);
      setBudgets(b); setAccounts(a); setDirty({});
      if (view === "variance") {
        const v = await budgetService.variance(year);
        setVariance(v);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Error");
    } finally { setLoading(false); }
  }, [year, view]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 2; y >= 2020; y--) arr.push(y);
    return arr;
  }, [now]);

  const postableAccounts = useMemo(
    () => accounts.filter(a => a.is_postable && a.is_active),
    [accounts]
  );

  const availableAccounts = useMemo(() => {
    const used = new Set(budgets.map(b => b.account_id));
    return postableAccounts.filter(a => !used.has(a.id));
  }, [postableAccounts, budgets]);

  const filteredBudgets = useMemo(() => {
    return budgets.filter(b => {
      if (typeFilter !== "all" && b.account_type !== typeFilter) return false;
      if (q) {
        const qs = q.toLowerCase();
        if (!b.account_code.toLowerCase().includes(qs)
            && !b.account_name.toLowerCase().includes(qs)) return false;
      }
      return true;
    });
  }, [budgets, typeFilter, q]);

  const filteredVariance = useMemo(() => {
    if (!variance) return null;
    return {
      ...variance,
      rows: variance.rows.filter(r => {
        if (typeFilter !== "all" && r.account_type !== typeFilter) return false;
        if (q) {
          const qs = q.toLowerCase();
          if (!r.account_code.toLowerCase().includes(qs)
              && !r.account_name.toLowerCase().includes(qs)) return false;
        }
        return true;
      }),
    };
  }, [variance, typeFilter, q]);

  const setMonthValue = (budgetId: number, month: string, value: string) => {
    const n = value === "" ? 0 : Number(value) || 0;
    setBudgets(prev => prev.map(b => b.id === budgetId ? { ...b, [month]: n } : b));
    setDirty(prev => ({ ...prev, [budgetId]: { ...(prev[budgetId] || {}), [month]: n } }));
  };

  const saveRow = async (b: BudgetRow) => {
    setSavingRow(b.id);
    try {
      const payload: any = { year, account_id: b.account_id };
      for (const k of MONTH_KEYS) payload[k] = b[k];
      const updated = await budgetService.upsert(payload);
      setBudgets(prev => prev.map(x => x.id === b.id ? { ...updated } : x));
      setDirty(prev => { const { [b.id]: _, ...rest } = prev; return rest; });
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    } finally { setSavingRow(null); }
  };

  const addAccount = async (acct: Account) => {
    try {
      const payload: any = { year, account_id: acct.id };
      for (const k of MONTH_KEYS) payload[k] = 0;
      const created = await budgetService.upsert(payload);
      setBudgets(prev => [...prev, created].sort((x, y) => x.account_code.localeCompare(y.account_code)));
      setShowAddAccount(false);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    }
  };

  const removeRow = async (b: BudgetRow) => {
    if (!confirm(`¿Eliminar presupuesto de ${b.account_code} — ${b.account_name}?`)) return;
    try {
      await budgetService.remove(b.id);
      setBudgets(prev => prev.filter(x => x.id !== b.id));
    } catch { alert("Error"); }
  };

  const copyPrevYear = async () => {
    const factorStr = prompt(
      lang === "es"
        ? `Copia presupuesto ${year - 1} → ${year}. Factor multiplicador (ej. 1.05 = +5% inflación):`
        : `Copy budget ${year - 1} → ${year}. Multiplier (e.g. 1.05 = +5%):`,
      "1.00"
    );
    if (factorStr == null) return;
    const factor = Number(factorStr) || 1.0;
    setCopyingYear(true);
    try {
      const r = await budgetService.copyFromYear(year - 1, year, factor);
      alert(lang === "es" ? `Copiadas ${r.copied} cuentas` : `Copied ${r.copied} accounts`);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setCopyingYear(false); }
  };

  const downloadXlsx = async () => {
    try { await budgetService.downloadVarianceXlsx(year); }
    catch { alert("Error"); }
  };

  const accountTypes = ["all", "ingreso", "gasto", "costo", "activo", "pasivo", "capital"];

  // Totales de captura
  const captureTotals = useMemo(() => {
    const totals = { annual: 0, byMonth: [0,0,0,0,0,0,0,0,0,0,0,0] };
    for (const b of filteredBudgets) {
      for (let i = 0; i < 12; i++) totals.byMonth[i] += (b as any)[MONTH_KEYS[i]] || 0;
      totals.annual += b.annual_total || 0;
    }
    return totals;
  }, [filteredBudgets]);

  const varianceColor = (variance: number, budget: number, nature: string): string => {
    // Para cuentas deudoras (gastos, costos): más real que presupuesto = malo (rojo)
    // Para cuentas acreedoras (ingresos): más real que presupuesto = bueno (verde)
    if (Math.abs(budget) < 0.01) return t.textLo;
    const isFavorable = nature === "acreedora" ? variance >= 0 : variance <= 0;
    return isFavorable ? (t.good || "#22c55e") : (t.bad || "#ef4444");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, color: t.textHi, fontWeight: 700 }}>
            {lang === "es" ? "Presupuestos" : "Budgets"}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3, maxWidth: 640 }}>
            {lang === "es"
              ? "Captura el presupuesto anual por cuenta contable (12 columnas mensuales) y compara contra la ejecución real de tus pólizas."
              : "Capture annual budget per account (12 monthly columns) and compare against actual journal entries."}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 12, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.3 }}>
            {lang === "es" ? "Ejercicio" : "Year"}
          </div>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            style={selectStyle(t)}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", background: t.panel2, borderRadius: 8, padding: 3, border: `1px solid ${t.border}` }}>
          <button onClick={() => setView("capture")}
            style={{ ...viewBtn(t, view === "capture"), fontSize: 12 }}>
            {lang === "es" ? "Captura" : "Capture"}
          </button>
          <button onClick={() => setView("variance")}
            style={{ ...viewBtn(t, view === "variance"), fontSize: 12 }}>
            {lang === "es" ? "Variación" : "Variance"}
          </button>
        </div>

        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={lang === "es" ? "Buscar cuenta…" : "Search account…"}
            style={{ padding: "8px 12px 8px 30px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textHi, fontSize: 12.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
        </div>

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={selectStyle(t)}>
          {accountTypes.map(tp => (
            <option key={tp} value={tp}>
              {tp === "all" ? (lang === "es" ? "Todos los tipos" : "All types") : tp.charAt(0).toUpperCase() + tp.slice(1)}
            </option>
          ))}
        </select>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={copyPrevYear} disabled={copyingYear}
            style={secBtn(t)}>
            <Copy size={13} /> {copyingYear ? "…" : (lang === "es" ? `Copiar ${year - 1}` : `Copy ${year - 1}`)}
          </button>
          {view === "variance" && (
            <button onClick={downloadXlsx} style={secBtn(t)}>
              <Download size={13} /> XLSX
            </button>
          )}
          <button onClick={() => setShowAddAccount(v => !v)}
            disabled={availableAccounts.length === 0}
            style={{ ...primBtn(t), opacity: availableAccounts.length === 0 ? 0.5 : 1 }}>
            <Plus size={13} /> {lang === "es" ? "Agregar cuenta" : "Add account"}
          </button>
          <button onClick={loadAll} style={secBtn(t)}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Modal simple: agregar cuenta */}
      {showAddAccount && (
        <div style={{ padding: 12, background: t.panel, border: `1px solid ${t.nova}`, borderRadius: 10 }}>
          <div style={{ fontSize: 12.5, color: t.textHi, fontWeight: 700, marginBottom: 8 }}>
            {lang === "es" ? "Selecciona cuenta a presupuestar" : "Select account to budget"}
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {availableAccounts.map(a => (
              <div key={a.id} onClick={() => addAccount(a)}
                style={{ padding: "8px 10px", background: t.panel2, borderRadius: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span><b style={{ color: t.textHi }}>{a.code}</b> · {a.name}</span>
                <span style={{ color: t.textLo, fontSize: 11 }}>{a.account_type}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setShowAddAccount(false)}
            style={{ marginTop: 8, ...secBtn(t) }}>Cerrar</button>
        </div>
      )}

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

      {/* Vista Captura */}
      {!loading && view === "capture" && (
        filteredBudgets.length === 0 ? (
          <EmptyState t={t} lang={lang} onAdd={() => setShowAddAccount(true)} />
        ) : (
          <div style={{ overflowX: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3, position: "sticky", top: 0 }}>
                  <th style={{ ...th(), position: "sticky", left: 0, background: t.panel2, minWidth: 220, zIndex: 2 }}>{lang === "es" ? "Cuenta" : "Account"}</th>
                  {MONTHS.map(m => <th key={m} style={{ ...th(), textAlign: "right", minWidth: 90 }}>{m}</th>)}
                  <th style={{ ...th(), textAlign: "right", minWidth: 110, background: t.panel2 }}>{lang === "es" ? "Anual" : "Annual"}</th>
                  <th style={{ ...th(), textAlign: "center", minWidth: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredBudgets.map(b => (
                  <tr key={b.id} style={{ borderTop: `1px solid ${t.border}` }}>
                    <td style={{ ...td(), position: "sticky", left: 0, background: t.panel, zIndex: 1 }}>
                      <div style={{ color: t.textHi, fontWeight: 600 }}>{b.account_code}</div>
                      <div style={{ color: t.textLo, fontSize: 11 }}>{b.account_name}</div>
                    </td>
                    {MONTH_KEYS.map(mk => (
                      <td key={mk} style={{ ...td(), padding: "4px 6px" }}>
                        <input type="number" step="0.01"
                          value={(b as any)[mk] || 0}
                          onChange={e => setMonthValue(b.id, mk, e.target.value)}
                          style={{ width: "100%", padding: "5px 6px", borderRadius: 4, border: `1px solid ${t.border}`, background: dirty[b.id]?.[mk as keyof BudgetRow] !== undefined ? t.nova + "18" : t.panel2, color: t.textHi, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, outline: "none" }} />
                      </td>
                    ))}
                    <td style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums", background: t.panel2 }}>
                      {mxn(b.annual_total, true)}
                    </td>
                    <td style={{ ...td(), textAlign: "center" }}>
                      {dirty[b.id] ? (
                        <button onClick={() => saveRow(b)} disabled={savingRow === b.id}
                          style={{ ...primBtn(t), padding: "5px 10px", fontSize: 11 }}>
                          <Save size={12} /> {savingRow === b.id ? "…" : "OK"}
                        </button>
                      ) : (
                        <button onClick={() => removeRow(b)}
                          title={lang === "es" ? "Eliminar" : "Delete"}
                          style={{ padding: 5, borderRadius: 4, border: `1px solid ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer" }}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: t.panel2, borderTop: `2px solid ${t.nova}` }}>
                  <td style={{ ...td(), position: "sticky", left: 0, background: t.panel2, color: t.textHi, fontWeight: 800 }}>{lang === "es" ? "TOTAL" : "TOTAL"}</td>
                  {captureTotals.byMonth.map((v, i) => (
                    <td key={i} style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(v, true)}</td>
                  ))}
                  <td style={{ ...td(), textAlign: "right", color: t.nova, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mxn(captureTotals.annual, true)}</td>
                  <td style={td()}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Vista Variación */}
      {!loading && view === "variance" && (
        !filteredVariance || filteredVariance.rows.length === 0 ? (
          <EmptyState t={t} lang={lang} onAdd={() => setView("capture")} isVariance />
        ) : (
          <div style={{ overflowX: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3 }}>
                  <th style={{ ...th(), position: "sticky", left: 0, background: t.panel2, minWidth: 220, zIndex: 2 }}>{lang === "es" ? "Cuenta" : "Account"}</th>
                  <th style={{ ...th(), textAlign: "right", minWidth: 110 }}>{lang === "es" ? "Presupuesto YTD" : "Budget YTD"}</th>
                  <th style={{ ...th(), textAlign: "right", minWidth: 110 }}>{lang === "es" ? "Real YTD" : "Actual YTD"}</th>
                  <th style={{ ...th(), textAlign: "right", minWidth: 110 }}>{lang === "es" ? "Variación" : "Variance"}</th>
                  <th style={{ ...th(), textAlign: "right", minWidth: 70 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {filteredVariance.rows.map(r => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${t.border}` }}>
                    <td style={{ ...td(), position: "sticky", left: 0, background: t.panel, zIndex: 1 }}>
                      <div style={{ color: t.textHi, fontWeight: 600 }}>{r.account_code}</div>
                      <div style={{ color: t.textLo, fontSize: 11 }}>{r.account_name}</div>
                    </td>
                    <td style={{ ...td(), textAlign: "right", color: t.textMid, fontVariantNumeric: "tabular-nums" }}>{mxn(r.budget_ytd, true)}</td>
                    <td style={{ ...td(), textAlign: "right", color: t.textHi, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{mxn(r.real_ytd, true)}</td>
                    <td style={{ ...td(), textAlign: "right", color: varianceColor(r.variance_ytd, r.budget_ytd, r.nature), fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {r.variance_ytd > 0 ? "+" : ""}{mxn(r.variance_ytd, true)}
                    </td>
                    <td style={{ ...td(), textAlign: "right", color: varianceColor(r.variance_ytd, r.budget_ytd, r.nature), fontVariantNumeric: "tabular-nums" }}>
                      {r.variance_pct_ytd != null ? (r.variance_pct_ytd > 0 ? "+" : "") + r.variance_pct_ytd.toFixed(1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: t.panel2, borderTop: `2px solid ${t.nova}` }}>
                  <td style={{ ...td(), position: "sticky", left: 0, background: t.panel2, color: t.textHi, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(filteredVariance.totals.budget_ytd, true)}</td>
                  <td style={{ ...td(), textAlign: "right", color: t.textHi, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mxn(filteredVariance.totals.real_ytd, true)}</td>
                  <td style={{ ...td(), textAlign: "right", color: t.nova, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mxn(filteredVariance.totals.variance_ytd, true)}</td>
                  <td style={td()}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {view === "variance" && (
        <div style={{ padding: "10px 12px", background: t.nova + "12", border: `1px solid ${t.nova}44`, borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: t.textMid }}>
          <Info size={14} color={t.nova} style={{ marginTop: 1 }} />
          <div>
            {lang === "es"
              ? <>El semáforo considera la naturaleza de la cuenta: en <b>ingresos</b> una variación positiva es favorable; en <b>gastos/costos</b> una variación negativa es favorable.</>
              : <>Semaphore considers account nature: for <b>income</b> a positive variance is favorable; for <b>expenses/costs</b> a negative variance is favorable.</>}
          </div>
        </div>
      )}
    </div>
  );
}


function EmptyState({ t, lang, onAdd, isVariance }: any) {
  return (
    <div style={{ padding: 40, textAlign: "center", background: t.panel, border: `1px dashed ${t.border}`, borderRadius: 10 }}>
      <TrendingUp size={28} color={t.textLo} style={{ margin: "0 auto 10px" }} />
      <div style={{ fontSize: 14, color: t.textMid, marginBottom: 6 }}>
        {isVariance
          ? (lang === "es" ? "Sin presupuestos capturados para este año" : "No budgets for this year")
          : (lang === "es" ? "Aún no capturas presupuesto para este año" : "No budget captured yet")}
      </div>
      <div style={{ fontSize: 12, color: t.textLo, marginBottom: 14 }}>
        {lang === "es"
          ? "Agrega cuentas y captura el presupuesto mensual, luego compara contra la ejecución real de las pólizas."
          : "Add accounts and capture the monthly budget, then compare with actual journal entries."}
      </div>
      <button onClick={onAdd} style={{ ...primBtn(t), padding: "10px 20px" }}>
        <Plus size={14} /> {isVariance ? (lang === "es" ? "Ir a captura" : "Go to capture") : (lang === "es" ? "Agregar cuenta" : "Add account")}
      </button>
    </div>
  );
}


// Style helpers
const th = (): React.CSSProperties => ({ padding: "10px 12px", textAlign: "left", whiteSpace: "nowrap" });
const td = (): React.CSSProperties => ({ padding: "8px 12px", verticalAlign: "middle" });
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
const viewBtn = (t: any, active: boolean): React.CSSProperties => ({
  padding: "5px 12px", borderRadius: 6, border: "none",
  background: active ? t.nova : "transparent",
  color: active ? "#fff" : t.textMid, cursor: "pointer", fontWeight: 600,
});
