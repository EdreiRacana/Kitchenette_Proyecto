// Customers / CRM module — orchestrator. Drops into App.tsx with the { t, s }
// contract, same as SalesCRM. Block/progressive loading: list and KPIs load
// independently so neither blocks the other.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Plus, Users, BadgeCheck, CreditCard, Wallet, ChevronRight, ArrowUp, ArrowDown, Info,
} from "lucide-react";
import { resolveTheme, makeTr, money } from "../sales/theme";
import type { Tokens } from "../sales/theme";
import { Badge, Button, EmptyState, Spinkeyframes } from "../sales/ui";
import { customersApi } from "./api";
import type { Customer, CustomerDraft, CustomerFilters, CustomerStats } from "./types";
import { CustomerForm } from "./CustomerForm";
import { SUCURSALES, PRICE_LISTS, CLIENT_TYPES } from "./catalogs";
import Customer360 from "./Customer360";

const PAGE = 20;

const typeColor = (tk: Tokens, t: string | null): string => {
  switch (t) {
    case "VIP": return tk.accent;
    case "Crédito": return tk.warn;
    case "Distribuidor": return tk.good;
    case "Mayorista": return tk.good;
    default: return tk.textLo;
  }
};

export default function CustomersModule({ t, s, initialQuery }: { t: unknown; s: unknown; initialQuery?: string }) {
  const tk = useMemo<Tokens>(() => resolveTheme(t as Record<string, unknown>), [t]);
  const tr = useMemo(() => makeTr(s), [s]);

  const [items, setItems] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<CustomerStats | null>(null);

  const [listLoading, setListLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState(initialQuery || "");
  useEffect(() => { if (initialQuery) setQ(initialQuery); }, [initialQuery]);
  const [sucursal, setSucursal] = useState("");
  const [clientType, setClientType] = useState("");
  const [priceList, setPriceList] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);

  const filters = useMemo<CustomerFilters>(() => ({
    q: q || undefined, sucursal: sucursal || undefined, client_type: clientType || undefined,
    price_list: priceList || undefined, sort_by: sortBy, sort_dir: sortDir,
    skip: page * PAGE, limit: PAGE,
  }), [q, sucursal, clientType, priceList, sortBy, sortDir, page]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await customersApi.search(filters);
      setItems(res.items); setTotal(res.total); setError(null);
    } catch (e) {
      setError(extractErr(e));
      setItems([]); setTotal(0);
    } finally { setListLoading(false); }
  }, [filters]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try { setStats(await customersApi.stats()); } catch { /* banner from list */ } finally { setStatsLoading(false); }
  }, []);

  const refresh = useCallback(async () => { await loadList(); loadStats(); }, [loadList, loadStats]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { setPage(0); }, [q, sucursal, clientType, priceList]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = async (c: Customer) => {
    try { setEditing(await customersApi.get(c.id)); } catch { setEditing(c); }
    setFormOpen(true);
  };

  const handleSubmit = useCallback(async (draft: CustomerDraft, pendingDocs: { docType: string; file: File }[]) => {
    setSaving(true);
    try {
      if (editing) {
        await customersApi.update(editing.id, draft);
      } else {
        const created = await customersApi.create(draft);
        for (const p of pendingDocs) {
          await customersApi.uploadDocument(created.id, p.docType, p.file);
        }
      }
      setFormOpen(false); setEditing(null);
      await refresh();
    } catch (e) { alert(extractErr(e)); } finally { setSaving(false); }
  }, [editing, refresh]);

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((dd) => (dd === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  const inputBase: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 14, outline: "none" };
  const thBase: React.CSSProperties = { padding: "11px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textTransform: "uppercase", letterSpacing: 0.4 };

  const Kpi = ({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 180 }}>
      <div style={{ background: color + "22", color, borderRadius: 10, padding: 9, display: "flex" }}>{icon}</div>
      <div><div style={{ fontSize: 12, color: tk.textLo, marginBottom: 2 }}>{label}</div><div style={{ fontSize: 19, fontWeight: 800, color: tk.textHi }}>{value}</div></div>
    </div>
  );
  const KpiSkel = () => (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 180 }}>
      <Skel tk={tk} w={38} h={38} r={10} /><div style={{ flex: 1 }}><Skel tk={tk} w="60%" h={10} style={{ marginBottom: 8 }} /><Skel tk={tk} w="42%" h={16} /></div>
    </div>
  );

  const SortHead = ({ col, label }: { col: string; label: string }) => (
    <th onClick={() => toggleSort(col)} style={{ ...thBase, cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{label}{sortBy === col && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "20px 0" }}>
      <Spinkeyframes />
      <ShimmerKeyframes />

      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: tk.bad + "16", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <Info size={16} /> {tr("cust_error", "No se pudo conectar con el servidor de clientes.")} {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {statsLoading && !stats ? (
          Array.from({ length: 4 }).map((_, i) => <KpiSkel key={i} />)
        ) : (
          <>
            <Kpi icon={<Users size={20} />} label={tr("cust_kpi_total", "Clientes")} value={String(stats?.total ?? 0)} color={tk.accent} />
            <Kpi icon={<BadgeCheck size={20} />} label={tr("cust_kpi_active", "Activos")} value={String(stats?.active ?? 0)} color={tk.good} />
            <Kpi icon={<CreditCard size={20} />} label={tr("cust_kpi_credit", "Con crédito")} value={String(stats?.credit ?? 0)} color={tk.warn} />
            <Kpi icon={<Wallet size={20} />} label={tr("cust_kpi_exposure", "Crédito otorgado")} value={money(stats?.credit_exposure ?? 0)} color={tk.accent} />
          </>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: tk.textLo }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("cust_search", "Buscar nombre, RFC o No. de cliente…")}
            style={{ ...inputBase, width: "100%", paddingLeft: 34, boxSizing: "border-box" }} />
        </div>
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("cust_f_sucursal", "Sucursal")}</option>
          {SUCURSALES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={clientType} onChange={(e) => setClientType(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("cust_f_type", "Tipo")}</option>
          {CLIENT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={priceList} onChange={(e) => setPriceList(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("cust_f_pricelist", "Lista")}</option>
          {PRICE_LISTS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <Button tk={tk} variant="primary" icon={<Plus size={16} />} onClick={openNew}>{tr("cust_new", "Nuevo cliente")}</Button>
      </div>

      {/* Table */}
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead><tr style={{ background: tk.panel2 }}>
              <SortHead col="client_number" label={tr("cust_col_num", "No.")} />
              <SortHead col="name" label={tr("cust_col_name", "Cliente")} />
              <th style={thBase}>RFC</th>
              <th style={thBase}>{tr("cust_col_sucursal", "Sucursal")}</th>
              <th style={thBase}>{tr("cust_col_type", "Tipo")}</th>
              <th style={thBase}>{tr("cust_col_pricelist", "Lista")}</th>
              <SortHead col="credit_amount" label={tr("cust_col_credit", "Crédito")} />
              <th style={thBase}>{tr("cust_col_status", "Estado")}</th>
              <th style={{ borderBottom: `1px solid ${tk.border}` }}></th>
            </tr></thead>
            <tbody>
              {listLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                    {Array.from({ length: 8 }).map((__, c) => <td key={c} style={{ padding: "12px 16px" }}><Skel tk={tk} w={c === 1 ? "75%" : "55%"} h={12} /></td>)}
                    <td style={{ padding: "12px 16px" }}><Skel tk={tk} w={16} h={12} /></td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={9}><EmptyState tk={tk} title={tr("cust_empty", "Sin clientes")} hint={tr("cust_empty_hint", "Ajusta los filtros o registra un nuevo cliente.")} /></td></tr>
              ) : (
                items.map((c, i) => (
                  <tr key={c.id} onClick={() => setViewing(c)} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = tk.panel3)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? tk.panel : tk.panel2)}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.accent, fontWeight: 700, whiteSpace: "nowrap" }}>{c.client_number ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi }}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      {c.razon_social && c.razon_social !== c.name && <div style={{ fontSize: 12, color: tk.textLo }}>{c.razon_social}</div>}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid, fontFamily: "monospace" }}>{c.rfc ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{c.sucursal ?? "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge tk={tk} bg={typeColor(tk, c.client_type) + "22"} color={typeColor(tk, c.client_type)} border={typeColor(tk, c.client_type) + "55"}>{c.client_type ?? "—"}</Badge>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: tk.textMid }}>{c.price_list ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textHi }}>
                      {(c.credit_amount ?? 0) > 0 ? <span>{money(c.credit_amount)} <span style={{ color: tk.textLo, fontSize: 12 }}>· {c.credit_days ?? 0}d</span></span> : <span style={{ color: tk.textLo }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge tk={tk} bg={(c.is_active ? tk.good : tk.bad) + "22"} color={c.is_active ? tk.good : tk.bad} border={(c.is_active ? tk.good : tk.bad) + "55"}>
                        {c.is_active ? tr("active", "Activo") : tr("inactive", "Inactivo")}
                      </Badge>
                    </td>
                    <td style={{ padding: "12px 16px" }}><ChevronRight size={16} color={tk.textLo} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: `1px solid ${tk.border}` }}>
            <span style={{ fontSize: 13, color: tk.textLo }}>{total} {tr("cust_results", "clientes")}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button tk={tk} variant="subtle" disabled={page === 0 || listLoading} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</Button>
              <span style={{ fontSize: 13, color: tk.textMid }}>{page + 1} / {pages}</span>
              <Button tk={tk} variant="subtle" disabled={page + 1 >= pages || listLoading} onClick={() => setPage((p) => p + 1)}>›</Button>
            </div>
          </div>
        )}
      </div>

      {/* Vista 360° del cliente */}
      {viewing && (
        <Customer360
          tk={tk}
          customer={viewing}
          onClose={() => setViewing(null)}
          onEdit={(c) => { setViewing(null); openEdit(c); }}
        />
      )}

      <CustomerForm tk={tk} tr={tr} open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={handleSubmit} editing={editing} saving={saving} />
    </div>
  );
}

function Skel({ tk, w, h, r = 8, style }: { tk: Tokens; w: number | string; h: number | string; r?: number; style?: React.CSSProperties }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: `linear-gradient(90deg, ${tk.panel2} 25%, ${tk.panel3} 37%, ${tk.panel2} 63%)`, backgroundSize: "400% 100%", animation: "kt-shimmer 1.4s ease infinite", ...style }} />;
}
function ShimmerKeyframes() { return <style>{`@keyframes kt-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>; }
function extractErr(e: unknown): string {
  const a = e as { response?: { data?: { detail?: unknown } }; message?: string };
  const d = a?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) { const f = d[0] as { msg?: string }; return f?.msg ?? "Error de validación."; }
  return a?.message ?? "Ocurrió un error.";
}
