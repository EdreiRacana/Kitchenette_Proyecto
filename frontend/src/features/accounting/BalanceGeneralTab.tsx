// Balance General — captura mensual + tabla histórica + descargas oficiales.
// Consume /accounting/balance-sheets (backend PR #193).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Save, X, Download, FileText, RefreshCw, Copy, Trash2, AlertTriangle,
  CheckCircle2, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  balanceService, type BalanceGeneral, type BalanceGeneralInput,
} from "./service";

const mxn = (n: number | null | undefined) =>
  "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const EMPTY_BALANCE = (year: number, month: number): BalanceGeneralInput => ({
  period_year: year, period_month: month, branch_id: null,
  cash_and_equivalents: 0, accounts_receivable: 0, inventory: 0, other_current_assets: 0,
  fixed_assets: 0, intangible_assets: 0, long_term_investments: 0, other_non_current_assets: 0,
  accounts_payable: 0, short_term_debt: 0, taxes_payable: 0, other_current_liabilities: 0,
  long_term_debt: 0, other_non_current_liabilities: 0,
  equity_capital: 0, retained_earnings: 0, period_result: 0,
  status: "draft", notes: "",
});


export default function BalanceGeneralTab({ t, lang }: { t: any; lang: string }) {
  const [balances, setBalances] = useState<BalanceGeneral[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BalanceGeneral | null>(null);
  const [creating, setCreating] = useState(false);
  const [downloadingHist, setDownloadingHist] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await balanceService.list({ limit: 24 });
      setBalances(rows);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Error al cargar balances");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const nextPeriod = useMemo(() => {
    if (!balances.length) return { year: now.getFullYear(), month: now.getMonth() + 1 };
    const latest = balances[0];
    let y = latest.period_year, m = latest.period_month + 1;
    if (m > 12) { m = 1; y++; }
    return { year: y, month: m };
  }, [balances]);

  const openCreate = () => {
    setEditing({ ...EMPTY_BALANCE(nextPeriod.year, nextPeriod.month), id: 0 });
    setCreating(true);
  };

  const openDuplicate = (source: BalanceGeneral) => {
    const { id, created_at, updated_at, created_by_id, updated_by_id, totals, ratios, ...rest } = source;
    setEditing({
      ...(rest as BalanceGeneral),
      id: 0,
      period_year: nextPeriod.year,
      period_month: nextPeriod.month,
      status: "draft",
    });
    setCreating(true);
  };

  const openEdit = (b: BalanceGeneral) => { setEditing(b); setCreating(false); };
  const close = () => { setEditing(null); setCreating(false); };

  const save = async (data: BalanceGeneralInput) => {
    try {
      if (creating) await balanceService.create(data);
      else if (editing) await balanceService.update(editing.id, data);
      await load();
      close();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al guardar");
    }
  };

  const remove = async (b: BalanceGeneral) => {
    if (!confirm(`¿Eliminar balance de ${MONTHS_ES[b.period_month - 1]} ${b.period_year}? Esta acción no se puede deshacer.`)) return;
    try {
      await balanceService.remove(b.id);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al eliminar");
    }
  };

  const downloadPdf = async (b: BalanceGeneral) => {
    try { await balanceService.downloadPdf(b.id, b.period_year, b.period_month); }
    catch { alert("Error al descargar PDF"); }
  };
  const downloadExcel = async (b: BalanceGeneral) => {
    try { await balanceService.downloadExcel(b.id, b.period_year, b.period_month); }
    catch { alert("Error al descargar Excel"); }
  };
  const downloadHistory = async () => {
    setDownloadingHist(true);
    try { await balanceService.downloadHistoryExcel(12); }
    catch { alert("Error al descargar histórico"); }
    finally { setDownloadingHist(false); }
  };

  const ratioColor = (kind: "liquidity" | "debt", v: number | null | undefined): string => {
    if (v == null) return t.textLo;
    if (kind === "liquidity") return v >= 1.5 ? (t.good || "#22c55e") : v >= 1 ? (t.warn || "#f59e0b") : (t.bad || "#ef4444");
    return v <= 0.5 ? (t.good || "#22c55e") : v <= 0.7 ? (t.warn || "#f59e0b") : (t.bad || "#ef4444");
  };

  if (editing) {
    return (
      <BalanceForm
        t={t} lang={lang}
        initial={editing}
        creating={creating}
        onCancel={close}
        onSave={save}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, color: t.textHi, fontWeight: 700 }}>
            {lang === "es" ? "Balance General" : "Balance Sheet"}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3 }}>
            {lang === "es"
              ? "Captura mensual del estado de situación financiera. Alimenta los KPIs Financieros del dashboard."
              : "Monthly capture of the balance sheet. Feeds the dashboard's Financial KPIs."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5 }}>
            <RefreshCw size={14} /> {lang === "es" ? "Actualizar" : "Refresh"}
          </button>
          {balances.length > 0 && (
            <button onClick={downloadHistory} disabled={downloadingHist} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: downloadingHist ? "wait" : "pointer", fontSize: 12.5 }}>
              <Download size={14} /> {downloadingHist ? "…" : lang === "es" ? "Histórico XLSX" : "History XLSX"}
            </button>
          )}
          <button onClick={openCreate} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Plus size={15} /> {lang === "es" ? "Nuevo balance" : "New balance"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: (t.bad || "#ef4444") + "18", color: t.bad, borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}

      {!loading && balances.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", background: t.panel, border: `1px dashed ${t.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 14, color: t.textMid, marginBottom: 6 }}>
            {lang === "es" ? "Sin balances capturados" : "No balances captured"}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginBottom: 14 }}>
            {lang === "es"
              ? "Captura tu primer balance mensual para que los KPIs Financieros se activen en el dashboard."
              : "Capture your first monthly balance to unlock the Financial KPIs on the dashboard."}
          </div>
          <button onClick={openCreate} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Plus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> {lang === "es" ? "Nuevo balance" : "New balance"}
          </button>
        </div>
      )}

      {!loading && balances.length > 0 && (
        <div style={{ overflowX: "auto", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.panel2, color: t.textLo, textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.4 }}>
                <th style={{ padding: "10px 12px", textAlign: "left" }}>{lang === "es" ? "Periodo" : "Period"}</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>{lang === "es" ? "Total Activo" : "Total Assets"}</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>{lang === "es" ? "Total Pasivo" : "Total Liab."}</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>{lang === "es" ? "Capital" : "Equity"}</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Liquidez</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>{lang === "es" ? "Endeud." : "Debt"}</th>
                <th style={{ padding: "10px 12px", textAlign: "center" }}>{lang === "es" ? "Estado" : "Status"}</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>{lang === "es" ? "Acciones" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map(b => {
                const totals = b.totals; const ratios = b.ratios;
                const balanced = totals?.is_balanced ?? false;
                return (
                  <tr key={b.id} style={{ borderTop: `1px solid ${t.border}` }}>
                    <td style={{ padding: "10px 12px", color: t.textHi, fontWeight: 600 }}>
                      <div>{MONTHS_ES[b.period_month - 1]} {b.period_year}</div>
                      {!balanced && (
                        <div style={{ fontSize: 10, color: t.bad, display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                          <AlertTriangle size={10} /> {lang === "es" ? "no cuadra" : "unbalanced"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.textHi }}>{mxn(totals?.total_assets)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMid }}>{mxn(totals?.total_liabilities)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: t.textMid }}>{mxn(totals?.total_equity)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: ratioColor("liquidity", ratios?.current_ratio), fontWeight: 600 }}>
                      {ratios?.current_ratio != null ? ratios.current_ratio.toFixed(2) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: ratioColor("debt", ratios?.debt_ratio), fontWeight: 600 }}>
                      {ratios?.debt_ratio != null ? (ratios.debt_ratio * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <span style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 4, fontWeight: 700, background: (b.status === "posted" ? t.good : t.warn) + "22", color: b.status === "posted" ? t.good : t.warn }}>
                        {b.status === "posted" ? (lang === "es" ? "PUBLICADO" : "POSTED") : (lang === "es" ? "BORRADOR" : "DRAFT")}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button title={lang === "es" ? "Editar" : "Edit"} onClick={() => openEdit(b)} style={iconBtn(t)}><FileText size={13} /></button>
                        <button title={lang === "es" ? "Duplicar al mes siguiente" : "Duplicate next month"} onClick={() => openDuplicate(b)} style={iconBtn(t)}><Copy size={13} /></button>
                        <button title="PDF" onClick={() => downloadPdf(b)} style={iconBtn(t)}><Download size={13} /></button>
                        <button title="XLSX" onClick={() => downloadExcel(b)} style={iconBtn(t)}><Download size={13} /></button>
                        <button title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => remove(b)} style={{ ...iconBtn(t), color: t.bad }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


const iconBtn = (t: any): React.CSSProperties => ({
  padding: 6, borderRadius: 6, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textMid, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});


// ──────────────────────────────────────────────────────────────────────────
// Formulario
// ──────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    key: "current_assets", title: "Activo Circulante", titleEn: "Current Assets", side: "activo",
    fields: [
      { name: "cash_and_equivalents", label: "Caja y equivalentes", labelEn: "Cash & equivalents" },
      { name: "accounts_receivable", label: "Cuentas por cobrar", labelEn: "Accounts receivable" },
      { name: "inventory", label: "Inventarios", labelEn: "Inventory" },
      { name: "other_current_assets", label: "Otros activos circulantes", labelEn: "Other current assets" },
    ],
  },
  {
    key: "non_current_assets", title: "Activo No Circulante", titleEn: "Non-Current Assets", side: "activo",
    fields: [
      { name: "fixed_assets", label: "Activo fijo (neto)", labelEn: "Fixed assets (net)" },
      { name: "intangible_assets", label: "Activos intangibles", labelEn: "Intangible assets" },
      { name: "long_term_investments", label: "Inversiones largo plazo", labelEn: "Long-term investments" },
      { name: "other_non_current_assets", label: "Otros activos no circulantes", labelEn: "Other non-current assets" },
    ],
  },
  {
    key: "current_liabilities", title: "Pasivo Corto Plazo", titleEn: "Current Liabilities", side: "pasivo",
    fields: [
      { name: "accounts_payable", label: "Proveedores", labelEn: "Accounts payable" },
      { name: "short_term_debt", label: "Deuda corto plazo", labelEn: "Short-term debt" },
      { name: "taxes_payable", label: "Impuestos por pagar", labelEn: "Taxes payable" },
      { name: "other_current_liabilities", label: "Otros pasivos circulantes", labelEn: "Other current liabilities" },
    ],
  },
  {
    key: "non_current_liabilities", title: "Pasivo Largo Plazo", titleEn: "Non-Current Liabilities", side: "pasivo",
    fields: [
      { name: "long_term_debt", label: "Deuda largo plazo", labelEn: "Long-term debt" },
      { name: "other_non_current_liabilities", label: "Otros pasivos no circulantes", labelEn: "Other non-current liabilities" },
    ],
  },
  {
    key: "equity", title: "Capital Contable", titleEn: "Equity", side: "capital",
    fields: [
      { name: "equity_capital", label: "Capital social", labelEn: "Share capital" },
      { name: "retained_earnings", label: "Utilidades acumuladas", labelEn: "Retained earnings" },
      { name: "period_result", label: "Resultado del ejercicio", labelEn: "Period result" },
    ],
  },
] as const;


function BalanceForm({
  t, lang, initial, creating, onCancel, onSave,
}: {
  t: any; lang: string; initial: any; creating: boolean;
  onCancel: () => void; onSave: (data: BalanceGeneralInput) => void;
}) {
  const [form, setForm] = useState<BalanceGeneralInput>({ ...initial });
  const [open, setOpen] = useState<Record<string, boolean>>({
    current_assets: true, non_current_assets: true,
    current_liabilities: true, non_current_liabilities: true, equity: true,
  });

  const set = (name: string, value: any) => setForm(prev => ({ ...prev, [name]: value }));
  const setNum = (name: string, v: string) => set(name, v === "" ? 0 : Number(v) || 0);

  const sectionSum = (key: string) => {
    const sec = SECTIONS.find(s => s.key === key);
    if (!sec) return 0;
    return sec.fields.reduce((acc, f) => acc + (Number((form as any)[f.name]) || 0), 0);
  };

  const totalAssets = sectionSum("current_assets") + sectionSum("non_current_assets");
  const totalLiab = sectionSum("current_liabilities") + sectionSum("non_current_liabilities");
  const totalEquity = sectionSum("equity");
  const liabPlusEq = totalLiab + totalEquity;
  const diff = Math.round((totalAssets - liabPlusEq) * 100) / 100;
  const isBalanced = Math.abs(diff) < 1;

  const submit = () => {
    if (!isBalanced && !confirm(
      lang === "es"
        ? `El balance no cuadra por ${mxn(diff)}. ¿Guardar de todos modos?`
        : `Balance is off by ${mxn(diff)}. Save anyway?`
    )) return;
    onSave(form);
  };

  const inp: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 6, border: `1px solid ${t.border}`,
    background: t.inputBg || t.panel2, color: t.textHi, fontSize: 13,
    outline: "none", width: "100%", textAlign: "right",
    fontVariantNumeric: "tabular-nums", boxSizing: "border-box",
  };
  const label: React.CSSProperties = { fontSize: 11.5, color: t.textMid };

  const renderSection = (key: string) => {
    const sec = SECTIONS.find(s => s.key === key)!;
    const isOpen = open[key];
    const sum = sectionSum(key);
    const sectionColor = sec.side === "activo" ? t.nova : sec.side === "pasivo" ? (t.warn || "#f59e0b") : (t.good || "#22c55e");
    return (
      <div key={key} style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          onClick={() => setOpen(p => ({ ...p, [key]: !p[key] }))}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", cursor: "pointer", borderBottom: isOpen ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isOpen ? <ChevronDown size={14} color={t.textMid} /> : <ChevronRight size={14} color={t.textMid} />}
            <div style={{ fontSize: 12.5, fontWeight: 700, color: sectionColor, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {lang === "es" ? sec.title : sec.titleEn}
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>
            {mxn(sum)}
          </div>
        </div>
        {isOpen && (
          <div style={{ padding: 10, display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
            {sec.fields.map(f => (
              <div key={f.name} style={{ display: "grid", gridTemplateColumns: "1fr 160px", alignItems: "center", gap: 8 }}>
                <div style={label}>{lang === "es" ? f.label : f.labelEn}</div>
                <input
                  type="number" step="0.01"
                  value={(form as any)[f.name] || 0}
                  onChange={e => setNum(f.name, e.target.value)}
                  style={inp}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, color: t.textHi, fontWeight: 700 }}>
            {creating ? (lang === "es" ? "Nuevo Balance General" : "New Balance Sheet")
                       : (lang === "es" ? "Editar Balance General" : "Edit Balance Sheet")}
          </div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 3 }}>
            {lang === "es"
              ? "Captura los saldos de cada rubro. La ecuación Activo = Pasivo + Capital se valida en vivo."
              : "Enter each account balance. The equation Assets = Liab. + Equity is validated live."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onCancel} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <X size={14} /> {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={submit} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Save size={14} /> {lang === "es" ? "Guardar" : "Save"}
          </button>
        </div>
      </div>

      {/* Periodo + estado */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, padding: 12 }}>
        <div>
          <div style={label}>{lang === "es" ? "Año" : "Year"}</div>
          <input type="number" min={2000} max={2100} value={form.period_year}
                 onChange={e => set("period_year", Number(e.target.value))}
                 style={{ ...inp, textAlign: "left" }} />
        </div>
        <div>
          <div style={label}>{lang === "es" ? "Mes" : "Month"}</div>
          <select value={form.period_month}
                  onChange={e => set("period_month", Number(e.target.value))}
                  style={{ ...inp, textAlign: "left" }}>
            {MONTHS_ES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <div style={label}>{lang === "es" ? "Estado" : "Status"}</div>
          <select value={form.status || "draft"}
                  onChange={e => set("status", e.target.value)}
                  style={{ ...inp, textAlign: "left" }}>
            <option value="draft">{lang === "es" ? "Borrador" : "Draft"}</option>
            <option value="posted">{lang === "es" ? "Publicado" : "Posted"}</option>
          </select>
        </div>
      </div>

      {/* Body: 2 columnas — Activo | Pasivo+Capital */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {renderSection("current_assets")}
          {renderSection("non_current_assets")}
          <div style={{ padding: "10px 12px", background: t.nova + "18", border: `1px solid ${t.nova}55`, borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: t.nova, textTransform: "uppercase" }}>{lang === "es" ? "Total Activo" : "Total Assets"}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(totalAssets)}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {renderSection("current_liabilities")}
          {renderSection("non_current_liabilities")}
          {renderSection("equity")}
          <div style={{ padding: "10px 12px", background: (t.good || "#22c55e") + "18", border: `1px solid ${(t.good || "#22c55e")}55`, borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: t.good, textTransform: "uppercase" }}>{lang === "es" ? "Pasivo + Capital" : "Liab. + Equity"}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{mxn(liabPlusEq)}</div>
          </div>
        </div>
      </div>

      {/* Validación */}
      <div style={{
        padding: "12px 14px", borderRadius: 8, display: "flex", alignItems: "center", gap: 10,
        background: isBalanced ? (t.good || "#22c55e") + "18" : (t.bad || "#ef4444") + "18",
        border: `1px solid ${(isBalanced ? t.good : t.bad) + "55"}`,
      }}>
        {isBalanced
          ? <CheckCircle2 size={18} color={t.good} />
          : <AlertTriangle size={18} color={t.bad} />}
        <div style={{ fontSize: 13, color: isBalanced ? t.good : t.bad, fontWeight: 600 }}>
          {isBalanced
            ? (lang === "es" ? "Ecuación contable validada — Activo = Pasivo + Capital" : "Accounting equation validated")
            : `${lang === "es" ? "Diferencia" : "Difference"}: ${mxn(diff)}`}
        </div>
      </div>

      {/* Notas */}
      <div>
        <div style={label}>{lang === "es" ? "Notas (opcional)" : "Notes (optional)"}</div>
        <textarea
          value={form.notes || ""}
          onChange={e => set("notes", e.target.value)}
          rows={3}
          style={{ ...inp, textAlign: "left", resize: "vertical", fontFamily: "inherit" }}
          placeholder={lang === "es" ? "Comentarios sobre este periodo…" : "Comments about this period…"}
        />
      </div>
    </div>
  );
}
