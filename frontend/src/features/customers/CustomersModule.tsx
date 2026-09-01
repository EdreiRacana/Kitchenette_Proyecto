// Customers / CRM module — orchestrator. Drops into App.tsx with the { t, s }
// contract, same as SalesCRM. Block/progressive loading: list and KPIs load
// independently so neither blocks the other.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, Users, BadgeCheck, CreditCard, Wallet, ChevronRight, ArrowUp, ArrowDown, Info,
  Star, Award, Save, Trash2, X, RefreshCw, MessageCircle, Mail,
} from "lucide-react";
import { loyaltyApi, type LoyaltyTier, type LoyaltyProgramConfig } from "./loyaltyApi";
import { resolveTheme, makeTr, money } from "../sales/theme";
import { tr as trI18n, detectLang } from "../../utils/i18n";
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
  // El `tr` de Sales busca la key en `s`. Si `s` no la trae (App le pasa el
  // bundle base sin diccionario custom), cae al fallback ES; ese fallback lo
  // pasamos por el util compartido para traducir a EN cuando aplique.
  const langMode = detectLang(s);
  const trBase = useMemo(() => makeTr(s), [s]);
  const tr = (key: string, fallback: string) => trI18n(trBase(key, fallback), langMode);

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
  const [relationshipType, setRelationshipType] = useState("");
  const [marketplacePlatform, setMarketplacePlatform] = useState("");
  const [priceList, setPriceList] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [tierOpts, setTierOpts] = useState<LoyaltyTier[]>([]);
  useEffect(() => { loyaltyApi.listTiers(false).then(setTierOpts).catch(() => setTierOpts([])); }, []);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [view, setView] = useState<"list" | "loyalty">("list");

  const filters = useMemo<CustomerFilters>(() => ({
    q: q || undefined, sucursal: sucursal || undefined, client_type: clientType || undefined,
    relationship_type: relationshipType || undefined,
    marketplace_platform: marketplacePlatform || undefined,
    price_list: priceList || undefined, sort_by: sortBy, sort_dir: sortDir,
    tier_id: tierFilter ? Number(tierFilter) : undefined,
    birthday_month: birthdayMonth ? Number(birthdayMonth) : undefined,
    skip: page * PAGE, limit: PAGE,
  }), [q, sucursal, clientType, relationshipType, marketplacePlatform, priceList, tierFilter, birthdayMonth, sortBy, sortDir, page]);

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
  useEffect(() => { setPage(0); }, [q, sucursal, clientType, relationshipType, marketplacePlatform, priceList, tierFilter, birthdayMonth]);

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

  // Panel de mezcla clickeable: cada bucket es un chip que actúa como filtro.
  // Clic en el mismo chip lo desmarca (setState a "").
  const MixCard = ({ tk: mk, title, buckets, active, onSelect }: {
    tk: Tokens; title: string;
    buckets: { label: string; count: number }[];
    active: string; onSelect: (v: string) => void;
  }) => {
    const total = buckets.reduce((a, b) => a + b.count, 0);
    if (buckets.length === 0) {
      return (
        <div style={{ background: mk.panel, border: `1px solid ${mk.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: mk.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 12, color: mk.textLo, opacity: 0.6 }}>Sin datos</div>
        </div>
      );
    }
    return (
      <div style={{ background: mk.panel, border: `1px solid ${mk.border}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: mk.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{title}</div>
          <div style={{ fontSize: 11, color: mk.textLo }}>{total} total</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {buckets.slice(0, 8).map((b) => {
            const isActive = active === b.label;
            const pct = total ? Math.round((b.count / total) * 100) : 0;
            return (
              <button key={b.label} onClick={() => onSelect(b.label)} type="button"
                style={{
                  padding: "6px 10px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${isActive ? mk.accent : mk.border}`,
                  background: isActive ? mk.accent + "22" : mk.inputBg,
                  color: isActive ? mk.accent : mk.textMid,
                  fontSize: 12, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                <span>{b.label}</span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>{b.count} · {pct}%</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

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

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${tk.border}` }}>
        {([
          { id: "list", label: tr("cust_tab_list", "Clientes"), icon: Users },
          { id: "loyalty", label: tr("cust_tab_loyalty", "Programa de fidelidad"), icon: Award },
        ] as const).map(tab => {
          const active = view === tab.id;
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setView(tab.id)}
              style={{
                padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none",
                cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13,
                background: active ? tk.panel : "transparent",
                color: active ? tk.accent : tk.textLo,
                borderBottom: active ? `2px solid ${tk.accent}` : "2px solid transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {view === "loyalty" ? (
        <LoyaltyProgramView tk={tk} />
      ) : (<>

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

      {/* Desgloses (mezcla real de la cartera). Clic → filtra la lista. */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <MixCard tk={tk} title={langMode === "en" ? "By business relationship" : "Por relación comercial"} buckets={stats.by_relationship_type ?? []}
            active={relationshipType}
            onSelect={(v) => setRelationshipType(v === relationshipType ? "" : v)} />
          <MixCard tk={tk} title={langMode === "en" ? "By type (credit/cash)" : "Por tipo (crédito/contado)"} buckets={stats.by_client_type ?? []}
            active={clientType}
            onSelect={(v) => setClientType(v === clientType ? "" : v)} />
          <MixCard tk={tk} title={langMode === "en" ? "By origin (branch)" : "Por origen (sucursal)"} buckets={stats.by_origin ?? []}
            active={sucursal}
            onSelect={(v) => setSucursal(v === sucursal ? "" : v)} />
          <MixCard tk={tk} title={langMode === "en" ? "By marketplace" : "Por marketplace"} buckets={stats.by_marketplace_platform ?? []}
            active={marketplacePlatform}
            onSelect={(v) => setMarketplacePlatform(v === marketplacePlatform ? "" : v)} />
        </div>
      )}

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
        <select value={relationshipType} onChange={(e) => setRelationshipType(e.target.value)} style={{ ...inputBase, cursor: "pointer" }} title="Relación comercial">
          <option value="">Relación</option>
          <option value="retail">Retail / Mostrador</option>
          <option value="wholesale">Mayorista B2B</option>
          <option value="marketplace">Marketplace</option>
          <option value="consignment">Consignación</option>
          <option value="chain_physical">Cadena tienda física</option>
        </select>
        <select value={marketplacePlatform} onChange={(e) => setMarketplacePlatform(e.target.value)} style={{ ...inputBase, cursor: "pointer" }} title="Plataforma marketplace">
          <option value="">Plataforma</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="mercadolibre">Mercado Libre</option>
          <option value="liverpool">Liverpool</option>
          <option value="coppel">Coppel</option>
          <option value="walmart">Walmart</option>
        </select>
        <select value={priceList} onChange={(e) => setPriceList(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">{tr("cust_f_pricelist", "Lista")}</option>
          {PRICE_LISTS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">Tier</option>
          {tierOpts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={birthdayMonth} onChange={(e) => setBirthdayMonth(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
          <option value="">Cumpleaños</option>
          {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
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
              <th style={thBase}>Tier / LP</th>
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
                <tr><td colSpan={10}><EmptyState tk={tk} title={tr("cust_empty", "Sin clientes")} hint={tr("cust_empty_hint", "Ajusta los filtros o registra un nuevo cliente.")} /></td></tr>
              ) : (
                items.map((c, i) => (
                  <tr key={c.id} onClick={() => setViewing(c)} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = tk.panel3)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? tk.panel : tk.panel2)}>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.accent, fontWeight: 700, whiteSpace: "nowrap" }}>{c.client_number ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 14, color: tk.textHi }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        {(c as any).source === "pos" && (
                          <span title="Cliente particular del punto de venta (no pertenece a una empresa)"
                            style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                                     background: tk.warn + "22", color: tk.warn, letterSpacing: 0.3 }}>
                            POS
                          </span>
                        )}
                      </div>
                      {c.razon_social && c.razon_social !== c.name && <div style={{ fontSize: 12, color: tk.textLo }}>{c.razon_social}</div>}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid, fontFamily: "monospace" }}>{c.rfc ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: tk.textMid }}>{c.sucursal ?? "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge tk={tk} bg={typeColor(tk, c.client_type) + "22"} color={typeColor(tk, c.client_type)} border={typeColor(tk, c.client_type) + "55"}>{c.client_type ?? "—"}</Badge>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: tk.textMid }}>{c.price_list ?? "—"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12 }}>
                      {(() => {
                        const t = tierOpts.find(x => x.id === c.tier_id);
                        if (!t) return <span style={{ color: tk.textLo }}>—</span>;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ padding: "2px 8px", borderRadius: 999, background: (t.color_hex || tk.accent) + "22", color: t.color_hex || tk.accent, fontWeight: 700, fontSize: 11, display: "inline-block", width: "fit-content" }}>
                              {t.name} · {t.discount_pct.toFixed(0)}%
                            </span>
                            {c.loyalty_code && <span style={{ fontFamily: "monospace", fontSize: 10, color: tk.textLo }}>{c.loyalty_code}</span>}
                          </div>
                        );
                      })()}
                    </td>
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
      </>)}
    </div>
  );
}


function LoyaltyProgramView({ tk }: { tk: Tokens }) {
  const [cfg, setCfg] = useState<LoyaltyProgramConfig | null>(null);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [stats, setStats] = useState<import("./loyaltyApi").ProgramStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const [c, ts, st] = await Promise.all([
        loyaltyApi.getProgram(),
        loyaltyApi.listTiers(),
        loyaltyApi.stats().catch(() => null),
      ]);
      setCfg(c); setTiers(ts); setStats(st);
    } catch (e) { setErr(extractErr(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveCfg = async () => {
    if (!cfg) return;
    setSavingCfg(true);
    try { setCfg(await loyaltyApi.updateProgram(cfg)); }
    catch (e) { alert(extractErr(e)); }
    finally { setSavingCfg(false); }
  };

  const runJob = async (job: "birthday" | "recompute") => {
    setBusyJob(job);
    try {
      const res = job === "birthday" ? await loyaltyApi.jobBirthdayEmails()
                                     : await loyaltyApi.jobRecomputeAllTiers();
      alert("Listo: " + JSON.stringify(res));
    } catch (e) { alert(extractErr(e)); }
    finally { setBusyJob(null); }
  };

  const addTier = async () => {
    try {
      const t = await loyaltyApi.createTier({
        name: "Nuevo tier", color_hex: "#94A3B8", rank: (tiers.length + 1),
        discount_pct: 0, min_spend: 0, min_orders: 0, min_avg_ticket: 0,
        perks: "", is_active: true,
      });
      setTiers(prev => [...prev, t]);
    } catch (e) { alert(extractErr(e)); }
  };
  const updateTierField = (id: number, field: keyof LoyaltyTier, value: unknown) => {
    setTiers(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };
  const saveTier = async (t: LoyaltyTier) => {
    try { await loyaltyApi.updateTier(t.id, t); }
    catch (e) { alert(extractErr(e)); }
  };
  const removeTier = async (id: number) => {
    if (!confirm("¿Eliminar este tier? Los clientes ligados a él quedarán sin nivel.")) return;
    try { await loyaltyApi.deleteTier(id); setTiers(prev => prev.filter(t => t.id !== id)); }
    catch (e) { alert(extractErr(e)); }
  };

  const inp: React.CSSProperties = { padding: "8px 11px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, display: "block" };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: tk.textLo }}>Cargando…</div>;
  if (err) return <div style={{ padding: 20, color: tk.bad, background: tk.bad + "18", borderRadius: 10 }}>{err}</div>;
  if (!cfg) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Estadísticas del programa */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatCard tk={tk} label="Inscritos al programa" value={stats.enrolled_in_program} sub={`de ${stats.total_active_customers} activos`} color={tk.accent} />
          <StatCard tk={tk} label="Opt-in marketing" value={stats.opt_in_marketing} sub="pueden recibir campañas" color={tk.good} />
          <StatCard tk={tk} label="Con cumpleaños" value={stats.with_birthday} sub={`${stats.birthdays_next_30_days} en próx. 30 días`} color={tk.warn} />
          <StatCard tk={tk} label="Distribución por tier" value={stats.by_tier.reduce((a, b) => a + b.count, 0)}
            sub={stats.by_tier.map(b => `${b.name}: ${b.count}`).join(" · ") || "—"} color={tk.accent} />
        </div>
      )}

      {/* Botón campañas */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setCampaignOpen(true)}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${tk.accent}, ${tk.navy || tk.accent})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={14} /> Nueva campaña
        </button>
      </div>

      {/* Estado global del programa */}
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: tk.textHi, display: "flex", alignItems: "center", gap: 8 }}>
              <Award size={18} color={tk.accent} /> Configuración general
            </div>
            <div style={{ fontSize: 12, color: tk.textLo, marginTop: 4 }}>
              Cuando el programa está apagado los clientes no reciben descuentos automáticos, tarjetas ni correos.
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={cfg.is_enabled} onChange={e => setCfg({ ...cfg, is_enabled: e.target.checked })} />
            <span style={{ fontSize: 14, fontWeight: 700, color: cfg.is_enabled ? tk.good : tk.textLo }}>
              {cfg.is_enabled ? "Programa activo" : "Programa apagado"}
            </span>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <label style={label}>Nombre del programa</label>
            <input value={cfg.program_name} onChange={e => setCfg({ ...cfg, program_name: e.target.value })} style={inp} />
          </div>
          <div>
            <label style={label}>Tagline (opcional)</label>
            <input value={cfg.tagline || ""} onChange={e => setCfg({ ...cfg, tagline: e.target.value })} placeholder="Ej. Recompensa tu preferencia" style={inp} />
          </div>
          <div>
            <label style={label}>Ventana para tier (meses)</label>
            <input type="number" min={1} max={120} value={cfg.tier_lookback_months || 12} onChange={e => setCfg({ ...cfg, tier_lookback_months: Number(e.target.value) })} style={inp} />
          </div>
          <div>
            <label style={label}>Vigencia de la tarjeta (días)</label>
            <input type="number" min={30} max={3650} value={cfg.card_validity_days} onChange={e => setCfg({ ...cfg, card_validity_days: Number(e.target.value) })} style={inp} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 14 }}>
          {(["card_bg_color", "card_text_color", "card_accent_color"] as const).map(k => (
            <div key={k}>
              <label style={label}>{k === "card_bg_color" ? "Color fondo tarjeta" : k === "card_text_color" ? "Color texto" : "Color acento"}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="color" value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: e.target.value })}
                  style={{ width: 44, height: 34, border: "none", padding: 0, background: "transparent", cursor: "pointer" }} />
                <input value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} style={{ ...inp, fontFamily: "monospace" }} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${tk.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 8 }}>Aviso de privacidad</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>URL del aviso (recomendado)</label>
              <input value={cfg.privacy_policy_url || ""} onChange={e => setCfg({ ...cfg, privacy_policy_url: e.target.value })}
                placeholder="https://tudominio.com/aviso-privacidad" style={inp} />
            </div>
            <div>
              <label style={label}>Texto corto in-line</label>
              <input value={cfg.privacy_policy_text || ""} onChange={e => setCfg({ ...cfg, privacy_policy_text: e.target.value })}
                placeholder="Tus datos se usan solo para..." style={inp} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${tk.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            Correos automáticos
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400, fontSize: 12, color: tk.textMid, marginLeft: "auto" }}>
              <input type="checkbox" checked={cfg.birthday_email_enabled}
                onChange={e => setCfg({ ...cfg, birthday_email_enabled: e.target.checked })} />
              Enviar cumpleaños
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label style={label}>Asunto</label>
              <input value={cfg.birthday_email_subject} onChange={e => setCfg({ ...cfg, birthday_email_subject: e.target.value })} style={inp} />
            </div>
            <div>
              <label style={label}>Cuerpo (usa {"{name}"} y {"{program}"})</label>
              <textarea value={cfg.birthday_email_body || ""} onChange={e => setCfg({ ...cfg, birthday_email_body: e.target.value })}
                rows={2} style={{ ...inp, resize: "vertical" }} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button disabled={busyJob !== null} onClick={() => runJob("recompute")}
            style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={13} /> Recalcular todos los tiers
          </button>
          <button disabled={busyJob !== null} onClick={() => runJob("birthday")}
            style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 12.5 }}>
            Correr correos de cumpleaños
          </button>
          <button disabled={savingCfg} onClick={saveCfg}
            style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${tk.accent}, ${tk.navy || tk.accent})`, color: "#fff", cursor: savingCfg ? "wait" : "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <Save size={14} /> {savingCfg ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </div>

      {/* Tiers */}
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: tk.textHi, display: "flex", alignItems: "center", gap: 8 }}>
              <Star size={16} color={tk.accent} /> Niveles / Tiers
            </div>
            <div style={{ fontSize: 12, color: tk.textLo, marginTop: 3 }}>
              Cada tier se asigna automáticamente al cliente que cumple TODOS los umbrales configurados en la ventana definida arriba.
            </div>
          </div>
          <button onClick={addTier} style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${tk.accent}55`, background: tk.accent + "18", color: tk.accent, cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> Nuevo tier
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 780 }}>
            <thead>
              <tr style={{ background: tk.panel2 }}>
                {["Rank", "Color", "Nombre", "Descuento %", "Gasto mín.", "Compras mín.", "Ticket prom. mín.", "Beneficios", "Activo", ""].map((h, i) => (
                  <th key={i} style={{ padding: "10px 8px", textAlign: "left", fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i) => (
                <tr key={t.id} style={{ background: i % 2 === 0 ? tk.panel : tk.panel2 }}>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="number" value={t.rank} onChange={e => updateTierField(t.id, "rank", Number(e.target.value))} style={{ ...inp, width: 50, padding: "6px 8px" }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="color" value={t.color_hex || "#94A3B8"} onChange={e => updateTierField(t.id, "color_hex", e.target.value)}
                      style={{ width: 40, height: 30, border: "none", padding: 0, cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input value={t.name} onChange={e => updateTierField(t.id, "name", e.target.value)} style={{ ...inp, width: 130 }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="number" step="0.5" value={t.discount_pct} onChange={e => updateTierField(t.id, "discount_pct", Number(e.target.value))} style={{ ...inp, width: 80 }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="number" value={t.min_spend} onChange={e => updateTierField(t.id, "min_spend", Number(e.target.value))} style={{ ...inp, width: 100 }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="number" value={t.min_orders} onChange={e => updateTierField(t.id, "min_orders", Number(e.target.value))} style={{ ...inp, width: 70 }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input type="number" value={t.min_avg_ticket} onChange={e => updateTierField(t.id, "min_avg_ticket", Number(e.target.value))} style={{ ...inp, width: 90 }} />
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <input value={t.perks || ""} onChange={e => updateTierField(t.id, "perks", e.target.value)} placeholder="Ej. Envío gratis" style={{ ...inp, width: 180 }} />
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "center" }}>
                    <input type="checkbox" checked={t.is_active} onChange={e => updateTierField(t.id, "is_active", e.target.checked)} />
                  </td>
                  <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                    <button title="Guardar tier" onClick={() => saveTier(t)}
                      style={{ border: "none", background: tk.good + "22", color: tk.good, cursor: "pointer", padding: "6px 8px", borderRadius: 6, marginRight: 4 }}>
                      <Save size={13} />
                    </button>
                    <button title="Eliminar" onClick={() => removeTier(t.id)}
                      style={{ border: "none", background: tk.bad + "22", color: tk.bad, cursor: "pointer", padding: "6px 8px", borderRadius: 6 }}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {tiers.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: tk.textLo }}>Aún no hay tiers configurados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {campaignOpen && (
        <CampaignModal tk={tk} tiers={tiers} onClose={() => setCampaignOpen(false)} />
      )}
    </div>
  );
}


function StatCard({ tk, label, value, sub, color }: {
  tk: Tokens; label: string; value: number | string; sub?: string; color: string;
}) {
  return (
    <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: tk.textLo, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}


function CampaignModal({ tk, tiers, onClose }: {
  tk: Tokens; tiers: LoyaltyTier[]; onClose: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("¡Hola {name}!\n\nTe compartimos un código exclusivo para tu próxima compra: {code}\n\nGracias por ser parte de {program}.");
  const [code, setCode] = useState("");
  const [selectedTiers, setSelectedTiers] = useState<number[]>([]);
  const [onlyOptIn, setOnlyOptIn] = useState(true);
  const [birthdayMonth, setBirthdayMonth] = useState<number | "">("");
  const [inactiveDays, setInactiveDays] = useState<number | "">("");
  const [preview, setPreview] = useState<{ count: number; sample: { id: number; name: string; email: string | null }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const label: React.CSSProperties = { fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, display: "block" };

  const segment = () => ({
    tier_ids: selectedTiers.length ? selectedTiers : null,
    only_opt_in: onlyOptIn,
    birthday_month: birthdayMonth || null,
    min_last_order_days_ago: inactiveDays || null,
  });

  const doPreview = async () => {
    setBusy(true); setMsg(null);
    try { setPreview(await loyaltyApi.previewSegment(segment())); }
    catch (e) { setMsg(extractErr(e)); }
    finally { setBusy(false); }
  };
  const doSend = async () => {
    if (!subject.trim() || !body.trim()) { setMsg("Asunto y cuerpo obligatorios"); return; }
    if (!preview || preview.count === 0) { setMsg("Primero previsualiza el segmento"); return; }
    if (!window.confirm(`Enviar a ${preview.count} clientes. ¿Continuar?`)) return;
    setBusy(true); setMsg(null);
    try {
      const html = body.split("\n").map(l => `<p>${l}</p>`).join("");
      const res = await loyaltyApi.sendCampaign({
        subject, body_html: html, discount_code: code || null, segment: segment(),
      });
      alert(`Campaña enviada.\nObjetivo: ${res.targeted}\nEnviados: ${res.sent}\nFallidos: ${res.failed}\nSin email: ${res.skipped_no_email}`);
      onClose();
    } catch (e) { setMsg(extractErr(e)); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 14, width: "min(720px, 100%)", maxHeight: "92vh", overflow: "auto" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${tk.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageCircle size={18} color={tk.accent} />
            <div style={{ fontSize: 16, fontWeight: 700, color: tk.textHi }}>Nueva campaña por correo</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo }}><X size={20} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>Segmento</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>Tiers a incluir (vacío = todos)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tiers.map(t => {
                  const sel = selectedTiers.includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      onClick={() => setSelectedTiers(prev => sel ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                      style={{
                        padding: "6px 12px", borderRadius: 999,
                        border: `1px solid ${sel ? (t.color_hex || tk.accent) : tk.border}`,
                        background: sel ? (t.color_hex || tk.accent) + "22" : "transparent",
                        color: sel ? (t.color_hex || tk.accent) : tk.textMid,
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>{t.name}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={label}>Cumpleaños en mes</label>
              <select value={birthdayMonth} onChange={e => setBirthdayMonth(e.target.value ? Number(e.target.value) : "")} style={{ ...inp, cursor: "pointer" }}>
                <option value="">Cualquier mes</option>
                {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Inactivos hace al menos (días)</label>
              <input type="number" value={inactiveDays} onChange={e => setInactiveDays(e.target.value ? Number(e.target.value) : "")} placeholder="Ej. 60 = no compran hace 60 días" style={inp} />
            </div>
            <div>
              <label style={label}>Marketing opt-in</label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, cursor: "pointer" }}>
                <input type="checkbox" checked={onlyOptIn} onChange={e => setOnlyOptIn(e.target.checked)} />
                <span style={{ color: tk.textHi, fontSize: 13 }}>Solo clientes con opt-in</span>
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={doPreview} disabled={busy}
              style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Previsualizar segmento
            </button>
            {preview && (
              <div style={{ fontSize: 13, color: tk.textHi }}>
                <b style={{ color: tk.accent }}>{preview.count}</b> clientes serán contactados
                {preview.sample.length > 0 && (
                  <span style={{ marginLeft: 8, color: tk.textLo, fontSize: 12 }}>
                    (ej: {preview.sample.slice(0, 3).map(s => s.name).join(", ")}…)
                  </span>
                )}
              </div>
            )}
          </div>

          <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginTop: 8 }}>Contenido del correo</div>
          <div>
            <label style={label}>Asunto</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={label}>Código de descuento (opcional)</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Ej. VERANO25" style={{ ...inp, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={label}>Cuerpo (puedes usar {"{name}"}, {"{code}"}, {"{program}"})</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ fontSize: 11, color: tk.textLo, marginTop: 4 }}>
              El aviso de privacidad y el link de baja se agregan automáticamente al final.
            </div>
          </div>

          {msg && (
            <div style={{ padding: "10px 14px", background: tk.bad + "18", border: `1px solid ${tk.bad}55`, color: tk.bad, borderRadius: 10, fontSize: 13 }}>
              {msg}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${tk.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, cursor: "pointer", fontSize: 13 }}>
            Cancelar
          </button>
          <button onClick={doSend} disabled={busy || !preview}
            style={{ padding: "10px 22px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${tk.good}, #059669)`, color: "#fff", cursor: (busy || !preview) ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
            <Mail size={14} /> {busy ? "Enviando…" : `Enviar a ${preview?.count || 0}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
