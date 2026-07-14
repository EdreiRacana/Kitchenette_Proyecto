// RetailModule.tsx — Sell-out Analytics profesional para PyMES.
// Cada empresa registra sus propias cadenas, tiendas y sell-out.
// KPIs: sell-through %, WOS ponderado, alertas de stock-out y sobreinventario,
// panel de reabasto con sugerencias por tienda × SKU.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Store, LayoutDashboard, Building2, ShoppingBag, Package, Truck,
  Plus, Pencil, Trash2, X, Search, AlertTriangle, TrendingUp,
  ChevronRight, RefreshCw, Check, Download, Upload, FileText,
  Bell, EyeOff, CheckCircle2, Zap, Warehouse, Grid3x3, BarChart3, ArrowRight,
} from "lucide-react";
import { retailApi } from "./api";
import { salesApi, type VariantOption } from "../sales/api";
import type { CustomerLite } from "../sales/types";
import type {
  RetailChannel, RetailStore, SellOutReport, RetailKPIs,
  StoreVelocityRow, SKUVelocityRow, ReplenishmentResponse,
  ReplenishmentSuggestion, WosStatus, ImportSellOutResponse,
  RetailAlert, AlertStatus, AlertSeverity, AlertsSummary,
  ConsignmentWarehouseOption, ConsignmentReconResponse, ConsignmentReconRow,
  HeatmapResponse, HeatmapMetric, ABCResponse, SourceWarehouseOption, TransferResponse,
  RetailImportProfile, DetectColumnsResponse, PreviewResponse,
} from "./types";

type Tokens = any;

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => (n || 0).toLocaleString("es-MX");

function isoWeekStart(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function isoWeekEnd(startISO: string): string {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function statusInfo(t: Tokens, status: WosStatus) {
  switch (status) {
    case "critical": return { label: "Crítico", color: t.bad, bg: t.bad + "22" };
    case "replenish": return { label: "Resurtir", color: t.warn, bg: t.warn + "22" };
    case "healthy": return { label: "Sano", color: t.good, bg: t.good + "22" };
    case "overstock": return { label: "Sobreinventario", color: t.nova, bg: t.nova + "22" };
    default: return { label: "Sin datos", color: t.textLo, bg: t.panel3 };
  }
}

type TabId = "dashboard" | "channels" | "stores" | "sellout" | "replenishment" | "alerts" | "consignment" | "analytics";

export default function RetailModule({ t }: { t: Tokens }) {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [channels, setChannels] = useState<RetailChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const cs = await retailApi.listChannels();
      setChannels(cs);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const refreshAlertsSummary = async () => {
    try {
      const s = await retailApi.alertsSummary(selectedChannel || undefined);
      setAlertsSummary(s);
    } catch { /* silent */ }
  };
  useEffect(() => { refreshAlertsSummary(); }, [selectedChannel]);

  const tabs: Array<{ id: TabId; label: string; icon: any; badge?: number; badgeColor?: string }> = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "channels", label: "Cadenas", icon: Building2 },
    { id: "stores", label: "Tiendas", icon: Store },
    { id: "sellout", label: "Sell-out", icon: ShoppingBag },
    { id: "replenishment", label: "Reabasto", icon: Truck },
    {
      id: "alerts", label: "Alertas", icon: Bell,
      badge: alertsSummary?.open,
      badgeColor: (alertsSummary?.urgent ?? 0) > 0 ? "urgent" : "normal",
    },
    { id: "consignment", label: "Consignación", icon: Warehouse },
    { id: "analytics", label: "Analíticas", icon: BarChart3 },
  ];

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: t.textHi }}>Retail Analytics</h1>
          <p style={{ color: t.textLo, fontSize: 13, marginTop: 4 }}>
            Control de sell-out, inventarios y reabasto en tus cadenas de retail.
          </p>
        </div>
        {channels.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 11.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Cadena</label>
            <select value={selectedChannel ?? ""} onChange={e => setSelectedChannel(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13 }}>
              <option value="">Todas</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, borderBottom: `1px solid ${t.border}`, display: "flex", gap: 4, flexWrap: "wrap" }}>
        {tabs.map(({ id, label, icon: Icon, badge, badgeColor }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 14px", background: "transparent",
                border: "none", cursor: "pointer",
                color: active ? t.nova : t.textMid, fontSize: 13, fontWeight: active ? 700 : 500,
                borderBottom: `2px solid ${active ? t.nova : "transparent"}`,
              }}>
              <Icon size={14} /> {label}
              {badge !== undefined && badge > 0 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 800,
                  padding: "1px 7px", borderRadius: 10,
                  background: badgeColor === "urgent" ? t.bad : t.warn,
                  color: "#fff",
                  minWidth: 18, textAlign: "center",
                }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}

        {!loading && channels.length === 0 && tab !== "channels" && (
          <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
            <Building2 size={32} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 10, fontSize: 14, color: t.textHi }}>Aún no tienes cadenas registradas</div>
            <div style={{ marginTop: 4, fontSize: 12 }}>Empieza en la pestaña <b>Cadenas</b> para dar de alta a tus clientes de retail.</div>
            <button onClick={() => setTab("channels")}
              style={{ marginTop: 14, padding: "8px 16px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontWeight: 700 }}>
              Ir a Cadenas
            </button>
          </div>
        )}

        {!loading && (channels.length > 0 || tab === "channels") && (
          <>
            {tab === "dashboard" && <DashboardView t={t} channelId={selectedChannel} />}
            {tab === "channels" && <ChannelsView t={t} channels={channels} onChanged={load} />}
            {tab === "stores" && <StoresView t={t} channels={channels} selectedChannel={selectedChannel} />}
            {tab === "sellout" && <SellOutView t={t} channels={channels} selectedChannel={selectedChannel} onChanged={refreshAlertsSummary} />}
            {tab === "replenishment" && <ReplenishmentView t={t} channelId={selectedChannel} />}
            {tab === "alerts" && <AlertsView t={t} channelId={selectedChannel} onChanged={refreshAlertsSummary} />}
            {tab === "consignment" && <ConsignmentView t={t} channelId={selectedChannel} />}
            {tab === "analytics" && <AnalyticsView t={t} channelId={selectedChannel} />}
          </>
        )}
      </div>
    </div>
  );
}


// ── Dashboard ────────────────────────────────────────────────────────────
function DashboardView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [kpis, setKpis] = useState<RetailKPIs | null>(null);
  const [stores, setStores] = useState<StoreVelocityRow[]>([]);
  const [skus, setSkus] = useState<SKUVelocityRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [k, sv, sk] = await Promise.all([
          retailApi.dashboard({ channel_id: channelId || undefined, days }),
          retailApi.storesVelocity(channelId || undefined),
          retailApi.skusVelocity({ channel_id: channelId || undefined, limit: 20 }),
        ]);
        if (!cancelled) { setKpis(k); setStores(sv); setSkus(sk); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days]);

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>Calculando KPIs…</div>;
  if (!kpis) return null;

  const tiles = [
    { label: "Sell-out (unidades)", value: num(kpis.total_sell_out_units), sub: mxn(kpis.total_sell_out_revenue), color: t.textHi },
    { label: "Sell-in (unidades)", value: num(kpis.total_sell_in_units), sub: mxn(kpis.total_sell_in_revenue), color: t.textHi },
    { label: "Sell-through", value: `${kpis.sell_through_pct.toFixed(1)}%`, sub: "Sell-out / Sell-in", color: kpis.sell_through_pct >= 70 ? t.good : kpis.sell_through_pct >= 40 ? t.warn : t.bad },
    { label: "On-hand total", value: num(kpis.total_on_hand), sub: `${kpis.stores_active_count} tiendas · ${kpis.skus_active_count} SKUs`, color: t.textHi },
    { label: "WOS promedio", value: `${kpis.avg_wos_weeks.toFixed(1)} sem`, sub: "Weeks of Supply", color: kpis.avg_wos_weeks >= 4 && kpis.avg_wos_weeks <= 12 ? t.good : t.warn },
    { label: "Tiendas críticas", value: num(kpis.critical_stores_count), sub: "WOS < mínimo", color: kpis.critical_stores_count > 0 ? t.bad : t.good },
    { label: "Sobreinventario", value: num(kpis.overstock_stores_count), sub: "WOS > máximo", color: kpis.overstock_stores_count > 0 ? t.nova : t.good },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: t.textLo }}>Últimos {days} días</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${t.border}`,
                background: days === d ? t.nova : "transparent", color: days === d ? "#fff" : t.textMid,
                cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {tiles.map(tile => (
          <div key={tile.label} style={{ padding: 14, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{tile.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: tile.color, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{tile.value}</div>
            <div style={{ fontSize: 11, color: t.textLo, marginTop: 3 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Tiendas por WOS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {stores.length === 0 && <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>Sin datos aún</div>}
            {stores.slice(0, 15).map(s => {
              const info = statusInfo(t, s.status);
              return (
                <div key={s.store_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: t.panel2, borderRadius: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.store_name}
                    </div>
                    <div style={{ fontSize: 10.5, color: t.textLo }}>{s.channel_name} · {num(s.total_units_sold)} u vend · {num(s.total_on_hand)} en stock</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, marginLeft: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: info.color, fontVariantNumeric: "tabular-nums" }}>
                      {s.status === "no_data" ? "—" : `${s.wos_weeks.toFixed(1)}s`}
                    </div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: info.color, background: info.bg, padding: "1px 6px", borderRadius: 10 }}>
                      {info.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>SKUs más vendidos (4 sem)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {skus.length === 0 && <div style={{ color: t.textLo, fontSize: 12, textAlign: "center", padding: 20 }}>Sin datos aún</div>}
            {skus.slice(0, 15).map((sk, i) => {
              const info = statusInfo(t, sk.status);
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: t.panel2, borderRadius: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: t.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {sk.product_name || sk.sku || "—"}
                    </div>
                    <div style={{ fontSize: 10.5, color: t.textLo }}>{sk.sku || "sin SKU"} · {sk.stores_count} tiendas · {sk.avg_weekly_units.toFixed(1)}/sem</div>
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{num(sk.total_units_sold)}</div>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: info.color, background: info.bg, padding: "1px 6px", borderRadius: 10 }}>
                      {info.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Cadenas ──────────────────────────────────────────────────────────────
function ChannelsView({ t, channels, onChanged }: {
  t: Tokens; channels: RetailChannel[]; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<RetailChannel | "new" | null>(null);

  const del = async (ch: RetailChannel) => {
    if (!confirm(`¿Eliminar cadena "${ch.name}"? Se borrarán sus tiendas y reportes.`)) return;
    await retailApi.deleteChannel(ch.id);
    onChanged();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ color: t.textLo, fontSize: 13 }}>{channels.length} cadenas registradas</div>
        <button onClick={() => setEditing("new")}
          style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: t.nova, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> Nueva cadena
        </button>
      </div>

      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: t.panel2 }}>
              <th style={thStyle(t)}>Nombre</th>
              <th style={thStyle(t)}>Código</th>
              <th style={thStyle(t)}>Cliente vinculado</th>
              <th style={thStyle(t)}>WOS Mín / Meta / Máx</th>
              <th style={thStyle(t)}>Tiendas</th>
              <th style={thStyle(t)}>Estado</th>
              <th style={thStyle(t)}></th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: t.textLo }}>
                Sin cadenas. Da de alta la primera para empezar.
              </td></tr>
            )}
            {channels.map(ch => (
              <tr key={ch.id} style={{ borderTop: `1px solid ${t.border}55` }}>
                <td style={tdStyle(t)}><b style={{ color: t.textHi }}>{ch.name}</b></td>
                <td style={tdStyle(t)}>{ch.code || "—"}</td>
                <td style={tdStyle(t)}>{ch.customer_name || <span style={{ color: t.textLo }}>—</span>}</td>
                <td style={tdStyle(t)}>
                  <span style={{ color: t.bad }}>{ch.critical_wos_weeks}</span> /{" "}
                  <span style={{ color: t.good }}>{ch.target_wos_weeks}</span> /{" "}
                  <span style={{ color: t.nova }}>{ch.overstock_wos_weeks}</span> sem
                </td>
                <td style={tdStyle(t)}>{ch.stores_count}</td>
                <td style={tdStyle(t)}>
                  <span style={{ fontSize: 10.5, fontWeight: 700,
                    color: ch.is_active ? t.good : t.textLo,
                    background: (ch.is_active ? t.good : t.textLo) + "22",
                    padding: "2px 8px", borderRadius: 10 }}>
                    {ch.is_active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td style={{ ...tdStyle(t), textAlign: "right" }}>
                  <button onClick={() => setEditing(ch)} style={iconBtn(t)}><Pencil size={13} /></button>
                  <button onClick={() => del(ch)} style={{ ...iconBtn(t), color: t.bad }}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ChannelModal t={t} channel={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }} />
      )}
    </div>
  );
}


function ChannelModal({ t, channel, onClose, onSaved }: {
  t: Tokens; channel: RetailChannel | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(channel?.name || "");
  const [code, setCode] = useState(channel?.code || "");
  const [customerId, setCustomerId] = useState<number | null>(channel?.customer_id || null);
  const [targetW, setTargetW] = useState(channel?.target_wos_weeks ?? 4);
  const [critW, setCritW] = useState(channel?.critical_wos_weeks ?? 2);
  const [overW, setOverW] = useState(channel?.overstock_wos_weeks ?? 12);
  const [active, setActive] = useState(channel?.is_active ?? true);
  const [notes, setNotes] = useState(channel?.notes || "");
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    salesApi.customers().then(setCustomers).catch(() => setCustomers([]));
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true); setErr(null);
    try {
      const payload = {
        name: name.trim(), code: code || undefined,
        customer_id: customerId || undefined,
        target_wos_weeks: targetW, critical_wos_weeks: critW, overstock_wos_weeks: overW,
        is_active: active, notes: notes || undefined,
      };
      if (channel) await retailApi.updateChannel(channel.id, payload);
      else await retailApi.createChannel(payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>{channel ? "Editar cadena" : "Nueva cadena de retail"}</h3>
        <p style={{ color: t.textLo, fontSize: 12, marginTop: 4 }}>Ej. Walmart, HEB, Costco, Chedraui, Soriana, tiendas independientes que agrupas.</p>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle(t)}>Nombre *</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle(t)} autoFocus />
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Código interno</label>
            <input value={code} onChange={e => setCode(e.target.value)} style={inputStyle(t)} placeholder="WMT, HEB…" />
          </div>
          <div>
            <label style={labelStyle(t)}>Cliente vinculado</label>
            <select value={customerId ?? ""} onChange={e => setCustomerId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(t)}>
              <option value="">— Sin vincular —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 14, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 12, color: t.textLo, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Umbrales de WOS (Weeks of Supply)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ ...labelStyle(t), color: t.bad }}>Mínimo (crítico)</label>
              <input type="number" step={0.5} min={0} value={critW} onChange={e => setCritW(Number(e.target.value))} style={inputStyle(t)} />
            </div>
            <div>
              <label style={{ ...labelStyle(t), color: t.good }}>Meta</label>
              <input type="number" step={0.5} min={0} value={targetW} onChange={e => setTargetW(Number(e.target.value))} style={inputStyle(t)} />
            </div>
            <div>
              <label style={{ ...labelStyle(t), color: t.nova }}>Máximo (sobrestock)</label>
              <input type="number" step={0.5} min={0} value={overW} onChange={e => setOverW(Number(e.target.value))} style={inputStyle(t)} />
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: 10.5, color: t.textLo }}>
            Semanas de inventario objetivo. Debajo del mínimo = urgente resurtir. Arriba del máximo = riesgo de sobreinventario.
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle(t)}>Notas</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ ...inputStyle(t), resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} id="ch-active" />
          <label htmlFor="ch-active" style={{ fontSize: 12.5, color: t.textMid, cursor: "pointer" }}>Cadena activa</label>
        </div>

        {err && <div style={errStyle(t)}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
          <button disabled={!name.trim() || saving} onClick={submit} style={btnPrimary(t)}>
            {saving ? "Guardando…" : channel ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ── Tiendas ──────────────────────────────────────────────────────────────
function StoresView({ t, channels, selectedChannel }: {
  t: Tokens; channels: RetailChannel[]; selectedChannel: number | null;
}) {
  const [stores, setStores] = useState<RetailStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RetailStore | "new" | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const s = await retailApi.listStores({ channel_id: selectedChannel || undefined });
      setStores(s);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [selectedChannel]);

  const del = async (s: RetailStore) => {
    if (!confirm(`¿Eliminar tienda "${s.name}"? Se borrarán sus sell-outs.`)) return;
    await retailApi.deleteStore(s.id);
    load();
  };

  const filtered = stores.filter(s => !q
    || s.name.toLowerCase().includes(q.toLowerCase())
    || (s.city || "").toLowerCase().includes(q.toLowerCase())
    || (s.external_code || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 400 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={13} color={t.textLo} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, ciudad, código…"
              style={{ ...inputStyle(t), paddingLeft: 32 }} />
          </div>
          <div style={{ color: t.textLo, fontSize: 12 }}>{filtered.length} tiendas</div>
        </div>
        <button disabled={channels.length === 0} onClick={() => setEditing("new")} style={btnPrimary(t)}>
          <Plus size={14} /> Nueva tienda
        </button>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: t.panel2 }}>
                <th style={thStyle(t)}>Tienda</th>
                <th style={thStyle(t)}>Cadena</th>
                <th style={thStyle(t)}>Ciudad / Estado</th>
                <th style={thStyle(t)}>Código externo</th>
                <th style={thStyle(t)}>Formato</th>
                <th style={thStyle(t)}>Consignación</th>
                <th style={thStyle(t)}>Estado</th>
                <th style={thStyle(t)}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: t.textLo }}>
                  {stores.length === 0 ? "Sin tiendas. Da de alta la primera." : "Sin resultados"}
                </td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${t.border}55` }}>
                  <td style={tdStyle(t)}>
                    <b style={{ color: t.textHi }}>{s.name}</b>
                    {s.code && <div style={{ fontSize: 10.5, color: t.textLo }}>{s.code}</div>}
                  </td>
                  <td style={tdStyle(t)}>{s.channel_name}</td>
                  <td style={tdStyle(t)}>{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                  <td style={tdStyle(t)}>{s.external_code || "—"}</td>
                  <td style={tdStyle(t)}>{s.store_format || "—"}</td>
                  <td style={tdStyle(t)}>
                    {s.consignment_warehouse_name ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: t.nova, background: t.nova + "22", padding: "2px 8px", borderRadius: 10 }}>
                        <Warehouse size={10} /> {s.consignment_warehouse_name}
                      </span>
                    ) : <span style={{ color: t.textLo, fontSize: 11 }}>—</span>}
                  </td>
                  <td style={tdStyle(t)}>
                    <span style={{ fontSize: 10.5, fontWeight: 700,
                      color: s.is_active ? t.good : t.textLo,
                      background: (s.is_active ? t.good : t.textLo) + "22",
                      padding: "2px 8px", borderRadius: 10 }}>
                      {s.is_active ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>
                    <button onClick={() => setEditing(s)} style={iconBtn(t)}><Pencil size={13} /></button>
                    <button onClick={() => del(s)} style={{ ...iconBtn(t), color: t.bad }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StoreModal t={t} channels={channels}
          store={editing === "new" ? null : editing}
          defaultChannel={selectedChannel || channels[0]?.id || 0}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}


function StoreModal({ t, channels, store, defaultChannel, onClose, onSaved }: {
  t: Tokens; channels: RetailChannel[]; store: RetailStore | null;
  defaultChannel: number; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    channel_id: store?.channel_id || defaultChannel,
    name: store?.name || "",
    code: store?.code || "",
    external_code: store?.external_code || "",
    city: store?.city || "",
    state: store?.state || "",
    region: store?.region || "",
    store_format: store?.store_format || "",
    address: store?.address || "",
    contact_name: store?.contact_name || "",
    contact_phone: store?.contact_phone || "",
    consignment_warehouse_id: store?.consignment_warehouse_id ?? null as number | null,
    is_active: store?.is_active ?? true,
    notes: store?.notes || "",
  });
  const [warehouses, setWarehouses] = useState<ConsignmentWarehouseOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    retailApi.listConsignmentWarehouses()
      .then(ws => setWarehouses(ws.filter(w => w.is_active || w.id === store?.consignment_warehouse_id)))
      .catch(() => setWarehouses([]));
  }, [store?.consignment_warehouse_id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const update = (k: keyof typeof f, v: any) => setF(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!f.name.trim() || !f.channel_id) return;
    setSaving(true); setErr(null);
    try {
      if (store) await retailApi.updateStore(store.id, f);
      else await retailApi.createStore(f as any);
      onSaved();
    } catch (e: any) { setErr(e?.response?.data?.detail || "Error"); }
    finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>{store ? "Editar tienda" : "Nueva tienda"}</h3>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Cadena *</label>
            <select value={f.channel_id} onChange={e => update("channel_id", Number(e.target.value))} style={inputStyle(t)}>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle(t)}>Nombre *</label>
            <input value={f.name} onChange={e => update("name", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Código interno</label>
            <input value={f.code} onChange={e => update("code", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Código externo (nº tienda del cliente)</label>
            <input value={f.external_code} onChange={e => update("external_code", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Ciudad</label>
            <input value={f.city} onChange={e => update("city", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Estado</label>
            <input value={f.state} onChange={e => update("state", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Región</label>
            <input value={f.region} onChange={e => update("region", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Formato</label>
            <input value={f.store_format} onChange={e => update("store_format", e.target.value)} style={inputStyle(t)} placeholder="Supercenter, Express, Bodega…" />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle(t)}>Dirección</label>
          <input value={f.address} onChange={e => update("address", e.target.value)} style={inputStyle(t)} />
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Contacto</label>
            <input value={f.contact_name} onChange={e => update("contact_name", e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Teléfono</label>
            <input value={f.contact_phone} onChange={e => update("contact_phone", e.target.value)} style={inputStyle(t)} />
          </div>
        </div>
        <div style={{ marginTop: 14, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Warehouse size={13} color={t.nova} />
            <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Consignación (opcional)</div>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginBottom: 8 }}>
            Vincula un almacén de consignación. Cada sell-out reportado descuenta stock automáticamente y se conserva la trazabilidad para la reconciliación.
          </div>
          {warehouses.length === 0 ? (
            <div style={{ padding: "8px 10px", borderRadius: 6, background: t.warn + "18", color: t.warn, fontSize: 11.5 }}>
              No hay almacenes de tipo "consignación" en Inventario. Créalos en el módulo Inventario para poder vincularlos aquí.
            </div>
          ) : (
            <select value={f.consignment_warehouse_id ?? ""}
              onChange={e => update("consignment_warehouse_id", e.target.value ? Number(e.target.value) : null)}
              style={inputStyle(t)}>
              <option value="">— Sin consignación —</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.location ? ` · ${w.location}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle(t)}>Notas</label>
          <textarea value={f.notes} onChange={e => update("notes", e.target.value)} rows={2}
            style={{ ...inputStyle(t), resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={f.is_active} onChange={e => update("is_active", e.target.checked)} id="st-active" />
          <label htmlFor="st-active" style={{ fontSize: 12.5, color: t.textMid, cursor: "pointer" }}>Tienda activa</label>
        </div>

        {err && <div style={errStyle(t)}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
          <button disabled={!f.name.trim() || saving} onClick={submit} style={btnPrimary(t)}>
            {saving ? "Guardando…" : store ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ── Sell-out reports ─────────────────────────────────────────────────────
function SellOutView({ t, channels, selectedChannel, onChanged }: {
  t: Tokens; channels: RetailChannel[]; selectedChannel: number | null;
  onChanged?: () => void;
}) {
  const [reports, setReports] = useState<SellOutReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await retailApi.listSellOut({
        channel_id: selectedChannel || undefined,
        limit: 500,
      });
      setReports(r);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [selectedChannel]);

  const reload = () => { load(); onChanged?.(); };

  const del = async (r: SellOutReport) => {
    if (!confirm("¿Eliminar este reporte?")) return;
    await retailApi.deleteSellOut(r.id);
    reload();
  };

  const downloadTemplate = async (format: "xlsx" | "csv") => {
    setDownloading(true);
    try {
      const blob = await retailApi.downloadTemplate(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `retail_sellout_plantilla.${format}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al descargar la plantilla");
    } finally { setDownloading(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: t.textLo, fontSize: 13 }}>{reports.length} reportes de sell-out</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button disabled={downloading} onClick={() => downloadTemplate("xlsx")} style={btnGhost(t)} title="Descargar plantilla Excel con hojas de referencia">
            <FileText size={13} /> {downloading ? "…" : "Plantilla Excel"}
          </button>
          <button disabled={downloading} onClick={() => downloadTemplate("csv")} style={btnGhost(t)} title="Descargar plantilla CSV mínima">
            <Download size={13} /> CSV
          </button>
          <button disabled={channels.length === 0} onClick={() => setImporting(true)} style={{ ...btnGhost(t), background: t.nova + "18", borderColor: t.nova + "55", color: t.nova }}>
            <Upload size={13} /> Importar archivo
          </button>
          <button disabled={channels.length === 0} onClick={() => setAdding(true)} style={btnPrimary(t)}>
            <Plus size={14} /> Registrar sell-out
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.panel2 }}>
                <th style={thStyle(t)}>Periodo</th>
                <th style={thStyle(t)}>Tienda</th>
                <th style={thStyle(t)}>Cadena</th>
                <th style={thStyle(t)}>Producto</th>
                <th style={thStyle(t)}>SKU</th>
                <th style={thStyle(t)}>Vendidas</th>
                <th style={thStyle(t)}>Stock</th>
                <th style={thStyle(t)}>Ingreso</th>
                <th style={thStyle(t)}>Fuente</th>
                <th style={thStyle(t)}></th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: t.textLo }}>
                  Sin reportes aún. Registra el primer sell-out.
                </td></tr>
              )}
              {reports.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${t.border}55` }}>
                  <td style={tdStyle(t)}>
                    {new Date(r.period_start).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" })}
                    {" → "}
                    {new Date(r.period_end).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                  </td>
                  <td style={tdStyle(t)}>{r.store_name}</td>
                  <td style={tdStyle(t)}>{r.channel_name}</td>
                  <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                  <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>{num(r.units_sold)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.units_on_hand)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(r.revenue)}</td>
                  <td style={tdStyle(t)}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: t.panel3, color: t.textMid }}>
                      {r.source}
                    </span>
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>
                    <button onClick={() => del(r)} style={{ ...iconBtn(t), color: t.bad }}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <SellOutModal t={t} channels={channels} defaultChannel={selectedChannel}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); reload(); }} />
      )}
      {importing && (
        <ImportSellOutModal t={t}
          channels={channels} defaultChannel={selectedChannel}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); reload(); }} />
      )}
    </div>
  );
}


function ImportSellOutModal({ t, channels, defaultChannel, onClose, onDone }: {
  t: Tokens; channels: RetailChannel[]; defaultChannel: number | null;
  onClose: () => void; onDone: () => void;
}) {
  type Step = "upload" | "map" | "preview" | "done";
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [channelId, setChannelId] = useState<number | null>(defaultChannel || channels[0]?.id || null);
  const [profiles, setProfiles] = useState<RetailImportProfile[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [profileName, setProfileName] = useState("");
  const [detected, setDetected] = useState<DetectColumnsResponse | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [fileFormat, setFileFormat] = useState<"xlsx" | "csv">("xlsx");
  const [dateFormat, setDateFormat] = useState<"auto" | "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY/MM/DD">("auto");
  const [defaultPeriodType, setDefaultPeriodType] = useState<"day" | "week" | "month">("week");
  const [unitsMultiplier, setUnitsMultiplier] = useState(1);
  const [revenueMultiplier, setRevenueMultiplier] = useState(1);
  const [saveAsProfile, setSaveAsProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportSellOutResponse | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    if (!channelId) return;
    retailApi.listImportProfiles(channelId).then(ps => {
      setProfiles(ps);
      const def = ps.find(p => p.is_default) || ps[0];
      if (def) {
        setProfileId(def.id);
        setProfileName(def.name);
        setColumnMap(def.column_map || {});
        setFileFormat(def.file_format);
        setDateFormat(def.date_format);
        setDefaultPeriodType(def.default_period_type);
        setUnitsMultiplier(def.units_multiplier);
        setRevenueMultiplier(def.revenue_multiplier);
      } else {
        setProfileId(null);
      }
    }).catch(() => setProfiles([]));
  }, [channelId]);

  const handleFile = async (f: File) => {
    const ok = /\.(xlsx|xlsm|csv)$/i.test(f.name);
    if (!ok) { setErr("Solo se acepta .xlsx, .xlsm o .csv"); return; }
    setErr(null); setFile(f);
    const isCsv = /\.csv$/i.test(f.name);
    setFileFormat(isCsv ? "csv" : "xlsx");
    // Auto-detect columnas
    setBusy(true);
    try {
      const d = await retailApi.detectColumns(f, profileId || undefined);
      setDetected(d);
      // Si el perfil ya tiene mapeo, respeta; si no, usa el propuesto
      const existing = columnMap && Object.keys(columnMap).length > 0 ? columnMap : d.proposed_map;
      setColumnMap(existing);
      setStep("map");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "No pude leer el archivo");
    } finally { setBusy(false); }
  };

  const runPreview = async () => {
    if (!file || !channelId) return;
    setBusy(true); setErr(null);
    try {
      let pid = profileId;
      const cfg = {
        channel_id: channelId, name: profileName || `Perfil ${new Date().toLocaleDateString("es-MX")}`,
        file_format: fileFormat, date_format: dateFormat,
        default_period_type: defaultPeriodType,
        units_multiplier: unitsMultiplier, revenue_multiplier: revenueMultiplier,
        column_map: columnMap,
        is_active: true, is_default: false,
        header_row: 1, encoding: "utf-8", delimiter: ",",
        decimal_separator: "." as const, thousands_separator: "" as const,
      };
      if (pid) {
        await retailApi.updateImportProfile(pid, cfg);
      } else if (saveAsProfile) {
        const p = await retailApi.createImportProfile(cfg);
        pid = p.id; setProfileId(p.id);
      } else {
        // crear efímero, borrar tras usar
        const p = await retailApi.createImportProfile({ ...cfg, name: `_tmp_${Date.now()}` });
        pid = p.id;
      }
      const pv = await retailApi.previewImport(pid!, file, 10);
      setPreview(pv);
      setStep("preview");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error en preview");
    } finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!file || !profileId) return;
    setBusy(true); setErr(null);
    try {
      const r = await retailApi.importWithProfile(profileId, file);
      setResult(r);
      setStep("done");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al importar");
    } finally { setBusy(false); }
  };

  const stdFieldLabels: Record<string, string> = {
    cadena_codigo: "Código cadena", cadena_nombre: "Nombre cadena",
    tienda_codigo: "Código tienda (nº externo)", tienda_nombre: "Nombre tienda",
    sku: "SKU", producto_nombre: "Nombre producto",
    periodo_tipo: "Tipo periodo", periodo_inicio: "Inicio periodo",
    periodo_fin: "Fin periodo",
    unidades_vendidas: "Unidades vendidas *", unidades_stock: "Stock",
    ingreso: "Ingreso", notas: "Notas",
  };

  const requiredFields = ["tienda_codigo", "sku", "periodo_inicio", "unidades_vendidas"];
  const mappedCount = Object.keys(columnMap).filter(k => !!columnMap[k]).length;
  const missingRequired = requiredFields.filter(f => !columnMap[f] && !(f === "tienda_codigo" && columnMap["tienda_nombre"]) && !(f === "sku" && columnMap["producto_nombre"]));

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 820, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>

        {/* Stepper */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: t.nova + "22", color: t.nova, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Upload size={16} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Importar sell-out (asistente)</h3>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: t.textLo }}>
            <StepDot t={t} num={1} label="Subir" active={step === "upload"} done={step !== "upload"} />
            <ChevronRight size={12} />
            <StepDot t={t} num={2} label="Mapear" active={step === "map"} done={step === "preview" || step === "done"} />
            <ChevronRight size={12} />
            <StepDot t={t} num={3} label="Preview" active={step === "preview"} done={step === "done"} />
          </div>
        </div>

        {step === "upload" && (
          <>
            <div style={{ marginBottom: 12, padding: "8px 12px",
              background: t.warn + "18", border: `1px dashed ${t.warn}55`,
              borderRadius: 6, fontSize: 11.5, color: t.textMid,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}
              title="Fase 8 pendiente: API keys por perfil, endpoints públicos, cron scheduler y log de ejecuciones. Ver notas del roadmap."
            >
              <span style={{ fontSize: 14 }}>🔌</span>
              <div>
                <b style={{ color: t.warn }}>Automatización por API — próximamente</b>
                <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2 }}>
                  Fase 8: consumo directo de portales (Amazon SP-API, Retail Link, Vendor Portals) con API keys por perfil, cron y log de ejecuciones. Hoy: subida manual del archivo.
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle(t)}>Cadena</label>
              <select value={channelId ?? ""} onChange={e => setChannelId(e.target.value ? Number(e.target.value) : null)}
                style={inputStyle(t)}>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: t.textLo, marginTop: 4 }}>
                {profiles.length > 0
                  ? `Esta cadena tiene ${profiles.length} perfil${profiles.length !== 1 ? "es" : ""} guardado${profiles.length !== 1 ? "s" : ""}. Se detectará automáticamente el mapeo.`
                  : "Primera importación de esta cadena — te guiaré paso a paso para configurar el mapeo de columnas."}
              </div>
            </div>

            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              style={{
                display: "block", padding: "40px 20px",
                border: `2px dashed ${dragOver ? t.nova : t.border}`,
                borderRadius: 12, background: dragOver ? t.nova + "12" : t.panel2,
                textAlign: "center", cursor: busy ? "wait" : "pointer",
                transition: "background .15s, border-color .15s", opacity: busy ? 0.6 : 1,
              }}>
              <input type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }}
                disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Upload size={30} color={dragOver ? t.nova : t.textLo} />
              <div style={{ marginTop: 10, color: t.textHi, fontSize: 14, fontWeight: 600 }}>
                {busy ? "Detectando columnas…" : file ? file.name : "Arrastra el archivo tal como te lo entregó el cliente"}
              </div>
              <div style={{ marginTop: 4, color: t.textLo, fontSize: 11 }}>
                .xlsx, .xlsm o .csv · No necesitas usar la plantilla, cualquier formato sirve
              </div>
            </label>

            {err && <div style={errStyle(t)}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
            </div>
          </>
        )}

        {step === "map" && detected && (
          <>
            <div style={{ marginBottom: 12, padding: "8px 12px", background: t.nova + "18", borderRadius: 6, fontSize: 12, color: t.textMid }}>
              Detecté <b style={{ color: t.textHi }}>{detected.detected_columns.length}</b> columnas en tu archivo. Ya asigné <b style={{ color: t.textHi }}>{mappedCount}</b> automáticamente. Revisa y ajusta si es necesario.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={labelStyle(t)}>Formato fechas</label>
                <select value={dateFormat} onChange={e => setDateFormat(e.target.value as any)} style={inputStyle(t)}>
                  <option value="auto">Auto</option>
                  <option value="YYYY-MM-DD">2026-07-13</option>
                  <option value="DD/MM/YYYY">13/07/2026</option>
                  <option value="MM/DD/YYYY">07/13/2026</option>
                  <option value="YYYY/MM/DD">2026/07/13</option>
                </select>
              </div>
              <div>
                <label style={labelStyle(t)}>Periodo default</label>
                <select value={defaultPeriodType} onChange={e => setDefaultPeriodType(e.target.value as any)} style={inputStyle(t)}>
                  <option value="day">Diario</option>
                  <option value="week">Semanal</option>
                  <option value="month">Mensual</option>
                </select>
              </div>
              <div>
                <label style={labelStyle(t)}>Multiplicador ingreso</label>
                <input type="number" step={0.01} min={0} value={revenueMultiplier}
                  onChange={e => setRevenueMultiplier(Number(e.target.value) || 1)} style={inputStyle(t)} />
              </div>
            </div>

            <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.panel3 }}>
                    <th style={thStyle(t)}>Campo Sthenova</th>
                    <th style={thStyle(t)}>Columna del archivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(detected.standard_fields || Object.keys(stdFieldLabels)).map(f => {
                    const isRequired = requiredFields.includes(f);
                    const val = columnMap[f] || "";
                    return (
                      <tr key={f} style={{ borderTop: `1px solid ${t.border}55` }}>
                        <td style={{ ...tdStyle(t), width: "45%" }}>
                          <span style={{ color: isRequired ? t.textHi : t.textMid, fontWeight: isRequired ? 700 : 500 }}>
                            {stdFieldLabels[f] || f}
                          </span>
                          {isRequired && <span style={{ color: t.bad, marginLeft: 4 }}>*</span>}
                        </td>
                        <td style={tdStyle(t)}>
                          <select value={val}
                            onChange={e => setColumnMap(prev => ({ ...prev, [f]: e.target.value }))}
                            style={{ ...inputStyle(t), background: val ? t.nova + "12" : t.inputBg }}>
                            <option value="">— No mapear —</option>
                            {detected.detected_columns.filter(c => c).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle(t)}>Nombre del perfil (para guardar)</label>
              <input value={profileName} onChange={e => setProfileName(e.target.value)}
                placeholder="Ej. Walmart Retail Link — reporte semanal" style={inputStyle(t)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input type="checkbox" id="save-profile" checked={saveAsProfile} onChange={e => setSaveAsProfile(e.target.checked)} />
              <label htmlFor="save-profile" style={{ fontSize: 12.5, color: t.textMid, cursor: "pointer" }}>
                Guardar como perfil para reusar (recomendado)
              </label>
            </div>

            {missingRequired.length > 0 && (
              <div style={{ padding: "8px 10px", background: t.warn + "18", color: t.warn, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
                <AlertTriangle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                Falta mapear campos requeridos: {missingRequired.map(f => stdFieldLabels[f]).join(", ")}
              </div>
            )}

            {err && <div style={errStyle(t)}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button onClick={() => setStep("upload")} style={btnGhost(t)}>← Cambiar archivo</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
                <button disabled={busy || missingRequired.length > 0} onClick={runPreview} style={btnPrimary(t)}>
                  {busy ? "Preparando…" : "Ver preview →"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div style={{ padding: "10px 12px", background: t.nova + "18", borderRadius: 6, fontSize: 12, color: t.textMid, marginBottom: 12 }}>
              El archivo tiene <b style={{ color: t.textHi }}>{preview.total_rows}</b> filas. Estas son las primeras {preview.preview_rows.length} normalizadas. Verifica y confirma para importar todas.
            </div>

            {preview.unmapped_required_fields.length > 0 && (
              <div style={{ padding: "8px 10px", background: t.warn + "18", color: t.warn, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
                Falta mapear: {preview.unmapped_required_fields.join(", ")}
              </div>
            )}

            <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "auto", marginBottom: 12, maxHeight: 350 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: t.panel3, position: "sticky", top: 0 }}>
                    <th style={thStyle(t)}>#</th>
                    <th style={thStyle(t)}>Cadena</th>
                    <th style={thStyle(t)}>Tienda</th>
                    <th style={thStyle(t)}>SKU</th>
                    <th style={thStyle(t)}>Producto</th>
                    <th style={thStyle(t)}>Inicio</th>
                    <th style={thStyle(t)}>Vend</th>
                    <th style={thStyle(t)}>Stock</th>
                    <th style={thStyle(t)}>Ingreso</th>
                    <th style={thStyle(t)}></th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview_rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${t.border}55`, background: r.errors.length > 0 ? t.bad + "12" : undefined }}>
                      <td style={{ ...tdStyle(t), color: t.textLo, fontFamily: "monospace" }}>{r.row_number}</td>
                      <td style={tdStyle(t)}>{r.normalized.cadena_codigo || r.normalized.cadena_nombre || "—"}</td>
                      <td style={tdStyle(t)}>{r.normalized.tienda_codigo || r.normalized.tienda_nombre || "—"}</td>
                      <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.normalized.sku || "—"}</td>
                      <td style={tdStyle(t)}>{r.normalized.producto_nombre || "—"}</td>
                      <td style={tdStyle(t)}>{r.normalized.periodo_inicio ? new Date(r.normalized.periodo_inicio).toLocaleDateString("es-MX") : "—"}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>{r.normalized.unidades_vendidas ?? 0}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.normalized.unidades_stock ?? 0}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(r.normalized.ingreso ?? 0)}</td>
                      <td style={tdStyle(t)}>
                        {r.errors.length > 0 && (
                          <span title={r.errors.join("; ")} style={{ color: t.bad, cursor: "help" }}>
                            <AlertTriangle size={12} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {err && <div style={errStyle(t)}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button onClick={() => setStep("map")} style={btnGhost(t)}>← Ajustar mapeo</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
                <button disabled={busy || preview.unmapped_required_fields.length > 0} onClick={runImport} style={btnPrimary(t)}>
                  {busy ? "Importando…" : `Confirmar e importar ${preview.total_rows} filas`}
                </button>
              </div>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <div style={{ padding: 14, borderRadius: 10, background: t.panel2, border: `1px solid ${t.border}` }}>
              <div style={{ fontSize: 14, color: t.textHi, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <Check size={16} color={t.good} /> Importación completada
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                <StatMini t={t} label="Filas" value={result.total_rows.toString()} />
                <StatMini t={t} label="Creadas" value={result.created.toString()} color={t.good} />
                <StatMini t={t} label="Actualizadas" value={result.updated.toString()} color={t.nova} />
                <StatMini t={t} label="Omitidas" value={result.skipped.toString()} color={t.textLo} />
              </div>
            </div>

            {result.errors.length > 0 && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: t.bad + "12", border: `1px solid ${t.bad}55` }}>
                <div style={{ color: t.bad, fontWeight: 700, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertTriangle size={13} /> {result.errors.length} fila{result.errors.length !== 1 ? "s" : ""} con problema
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ padding: "5px 8px", borderRadius: 5, background: t.panel3, color: t.textMid }}>
                      <b style={{ color: t.textHi }}>Fila {e.row}:</b> {e.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={onDone} style={btnPrimary(t)}>Listo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


function StepDot({ t, num, label, active, done }: { t: Tokens; num: number; label: string; active: boolean; done: boolean }) {
  const bg = active ? t.nova : done ? t.good : t.panel3;
  const fg = active || done ? "#fff" : t.textLo;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{
        width: 20, height: 20, borderRadius: 10, background: bg, color: fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800,
      }}>{done ? "✓" : num}</span>
      <span style={{ color: active ? t.nova : done ? t.good : t.textLo, fontWeight: active ? 700 : 500 }}>{label}</span>
    </span>
  );
}


function StatMini({ t, label, value, color }: { t: Tokens; label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: 8, background: t.panel, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || t.textHi, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}


// ── Alertas ──────────────────────────────────────────────────────────────
function severityInfo(t: Tokens, s: AlertSeverity) {
  switch (s) {
    case "urgent": return { label: "Urgente", color: t.bad, bg: t.bad + "22" };
    case "high": return { label: "Alta", color: t.warn, bg: t.warn + "22" };
    case "medium": return { label: "Media", color: t.nova, bg: t.nova + "22" };
    default: return { label: "Baja", color: t.textMid, bg: t.panel3 };
  }
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  stockout: "Sin stock",
  stockout_imminent: "Stock crítico",
  overstock: "Sobreinventario",
  no_movement: "Sin movimiento",
  sell_through_low: "Sell-through bajo",
};

function AlertsView({ t, channelId, onChanged }: {
  t: Tokens; channelId: number | null; onChanged: () => void;
}) {
  const [alerts, setAlerts] = useState<RetailAlert[]>([]);
  const [summary, setSummary] = useState<AlertsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("open");
  const [sevFilter, setSevFilter] = useState<AlertSeverity | "all">("all");
  const [evaluating, setEvaluating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [actioning, setActioning] = useState<{ id: number; kind: "ack" | "resolve" | "dismiss" } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        retailApi.listAlerts({
          channel_id: channelId || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          severity: sevFilter === "all" ? undefined : sevFilter,
        }),
        retailApi.alertsSummary(channelId || undefined),
      ]);
      setAlerts(a); setSummary(s);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [channelId, statusFilter, sevFilter]);

  const flashOk = (msg: string) => {
    setFlash(msg); window.setTimeout(() => setFlash(null), 2400);
  };

  const doEvaluate = async () => {
    setEvaluating(true);
    try {
      const r = await retailApi.evaluateAlerts(channelId || undefined);
      flashOk(`Evaluación: ${r.created} nuevas · ${r.auto_resolved} resueltas automáticamente · ${r.total_open} abiertas`);
      await load(); onChanged();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error al evaluar");
    } finally { setEvaluating(false); }
  };

  const doAction = async (a: RetailAlert, kind: "ack" | "resolve" | "dismiss") => {
    let notes: string | undefined = undefined;
    if (kind === "dismiss") {
      const r = window.prompt("Motivo de descarte (opcional):", "");
      if (r === null) return;
      notes = r || undefined;
    } else if (kind === "resolve") {
      const r = window.prompt("Notas de resolución (opcional):", "");
      if (r === null) return;
      notes = r || undefined;
    }
    setActioning({ id: a.id, kind });
    try {
      if (kind === "ack") await retailApi.acknowledgeAlert(a.id, notes);
      if (kind === "resolve") await retailApi.resolveAlert(a.id, notes);
      if (kind === "dismiss") await retailApi.dismissAlert(a.id, notes);
      flashOk(kind === "ack" ? "Alerta reconocida" : kind === "resolve" ? "Alerta resuelta" : "Alerta descartada");
      await load(); onChanged();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Error");
    } finally { setActioning(null); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <SumTile t={t} label="Abiertas" value={summary?.open ?? 0} color={t.textHi} />
          <SumTile t={t} label="Urgentes" value={summary?.urgent ?? 0} color={t.bad} />
          <SumTile t={t} label="Alta" value={summary?.high ?? 0} color={t.warn} />
          <SumTile t={t} label="Media" value={summary?.medium ?? 0} color={t.nova} />
          <SumTile t={t} label="Reconocidas" value={summary?.acknowledged ?? 0} color={t.textMid} />
        </div>
        <button disabled={evaluating} onClick={doEvaluate} style={btnPrimary(t)} title="Recorrer todas las cadenas y regenerar alertas">
          <Zap size={14} /> {evaluating ? "Evaluando…" : "Evaluar ahora"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <FilterPill t={t} label="Todas" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <FilterPill t={t} label="Abiertas" active={statusFilter === "open"} onClick={() => setStatusFilter("open")} />
        <FilterPill t={t} label="Reconocidas" active={statusFilter === "acknowledged"} onClick={() => setStatusFilter("acknowledged")} />
        <FilterPill t={t} label="Resueltas" active={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")} />
        <FilterPill t={t} label="Descartadas" active={statusFilter === "dismissed"} onClick={() => setStatusFilter("dismissed")} />
        <div style={{ width: 12 }} />
        <FilterPill t={t} label="Toda severidad" active={sevFilter === "all"} onClick={() => setSevFilter("all")} />
        <FilterPill t={t} label="Urgentes" active={sevFilter === "urgent"} onClick={() => setSevFilter("urgent")} color={t.bad} />
        <FilterPill t={t} label="Alta" active={sevFilter === "high"} onClick={() => setSevFilter("high")} color={t.warn} />
        <FilterPill t={t} label="Media" active={sevFilter === "medium"} onClick={() => setSevFilter("medium")} color={t.nova} />
      </div>

      {flash && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: t.good + "22", color: t.good, fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          ✓ {flash}
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && alerts.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <CheckCircle2 size={36} color={t.good} />
          <div style={{ marginTop: 10, fontSize: 14, color: t.textHi }}>Sin alertas en este filtro</div>
          <div style={{ fontSize: 12, color: t.textLo, marginTop: 4 }}>Toda la red está dentro de la política. Presiona "Evaluar ahora" si acabas de importar sell-out.</div>
        </div>
      )}
      {!loading && alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map(a => {
            const sev = severityInfo(t, a.severity);
            const isClosed = a.status === "resolved" || a.status === "dismissed";
            const busy = actioning?.id === a.id;
            return (
              <div key={a.id} style={{
                background: t.panel, border: `1px solid ${sev.color}55`,
                borderLeft: `4px solid ${sev.color}`,
                borderRadius: 8, padding: 12,
                opacity: isClosed ? 0.7 : 1,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: sev.color, background: sev.bg, padding: "2px 8px", borderRadius: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
                        {sev.label}
                      </span>
                      <span style={{ fontSize: 10.5, color: t.textLo }}>
                        {ALERT_TYPE_LABEL[a.alert_type] || a.alert_type}
                      </span>
                      <span style={{ fontSize: 10.5, color: t.textLo }}>·</span>
                      <span style={{ fontSize: 10.5, color: t.textLo }}>{a.channel_name}</span>
                      {a.status !== "open" && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.textMid, background: t.panel3, padding: "1px 6px", borderRadius: 10 }}>
                          {a.status === "acknowledged" ? "Reconocida"
                            : a.status === "resolved" ? "Resuelta" : "Descartada"}
                        </span>
                      )}
                    </div>
                    <div style={{ color: t.textHi, fontSize: 13, fontWeight: 600 }}>{a.message}</div>
                    {(a.on_hand_snapshot !== null || a.wos_snapshot !== null) && (
                      <div style={{ fontSize: 11, color: t.textLo, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {a.on_hand_snapshot !== null && <span>Stock <b style={{ color: t.textMid }}>{num(a.on_hand_snapshot ?? 0)}</b></span>}
                        {a.weekly_velocity_snapshot !== null && <span>Vel <b style={{ color: t.textMid }}>{(a.weekly_velocity_snapshot ?? 0).toFixed(1)}/sem</b></span>}
                        {a.wos_snapshot !== null && <span>WOS <b style={{ color: sev.color }}>{(a.wos_snapshot ?? 0).toFixed(1)} sem</b></span>}
                        <span>Creada {a.created_at ? new Date(a.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
                      </div>
                    )}
                    {a.resolution_notes && (
                      <div style={{ marginTop: 6, padding: "5px 8px", background: t.panel2, borderRadius: 4, fontSize: 11, color: t.textLo }}>
                        📝 {a.resolution_notes}
                      </div>
                    )}
                  </div>
                  {!isClosed && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {a.status === "open" && (
                        <button disabled={busy} onClick={() => doAction(a, "ack")}
                          style={{ ...btnGhost(t), fontSize: 11.5 }} title="Reconocer (yo me hago cargo)">
                          <Check size={12} /> Reconocer
                        </button>
                      )}
                      <button disabled={busy} onClick={() => doAction(a, "resolve")}
                        style={{ ...btnGhost(t), color: t.good, borderColor: t.good + "55", background: t.good + "18", fontSize: 11.5 }} title="Marcar como resuelta">
                        <CheckCircle2 size={12} /> Resolver
                      </button>
                      <button disabled={busy} onClick={() => doAction(a, "dismiss")}
                        style={{ ...btnGhost(t), color: t.textLo, fontSize: 11.5 }} title="Descartar (falso positivo)">
                        <EyeOff size={12} /> Descartar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function SumTile({ t, label, value, color }: { t: Tokens; label: string; value: number; color?: string }) {
  return (
    <div style={{ padding: "8px 12px", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 8, minWidth: 90 }}>
      <div style={{ fontSize: 10, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || t.textHi, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}


function FilterPill({ t, label, active, onClick, color }: {
  t: Tokens; label: string; active: boolean; onClick: () => void; color?: string;
}) {
  const c = color || t.nova;
  return (
    <button onClick={onClick}
      style={{
        padding: "5px 10px", borderRadius: 6, border: `1px solid ${active ? c : t.border}`,
        background: active ? c + "22" : "transparent",
        color: active ? c : t.textMid, cursor: "pointer",
        fontSize: 11.5, fontWeight: 600,
      }}>
      {label}
    </button>
  );
}


function SellOutModal({ t, channels, defaultChannel, onClose, onSaved }: {
  t: Tokens; channels: RetailChannel[]; defaultChannel: number | null;
  onClose: () => void; onSaved: () => void;
}) {
  const initChannel = defaultChannel || channels[0]?.id || 0;
  const [channelId, setChannelId] = useState(initChannel);
  const [stores, setStores] = useState<RetailStore[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [periodStart, setPeriodStart] = useState(isoWeekStart());
  const [periodEnd, setPeriodEnd] = useState(isoWeekEnd(isoWeekStart()));
  const [periodType, setPeriodType] = useState<"day" | "week" | "month">("week");
  const [unitsSold, setUnitsSold] = useState(0);
  const [unitsOnHand, setUnitsOnHand] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    salesApi.variantOptions().then(setVariants).catch(() => setVariants([]));
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    if (!channelId) return;
    retailApi.listStores({ channel_id: channelId, active_only: true }).then(ss => {
      setStores(ss);
      if (ss.length > 0 && !ss.find(s => s.id === storeId)) setStoreId(ss[0].id);
    });
  }, [channelId]);

  useEffect(() => {
    if (variantId) {
      const v = variants.find(x => x.variant_id === variantId);
      if (v) {
        setProductName(v.product_name || "");
        setSku(v.sku || "");
      }
    }
  }, [variantId]);

  useEffect(() => {
    // recalcula fin al cambiar tipo o inicio
    const d = new Date(periodStart + "T00:00:00");
    if (periodType === "day") {
      setPeriodEnd(periodStart);
    } else if (periodType === "week") {
      d.setDate(d.getDate() + 6);
      setPeriodEnd(d.toISOString().slice(0, 10));
    } else {
      d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1);
      setPeriodEnd(d.toISOString().slice(0, 10));
    }
  }, [periodType, periodStart]);

  const canSave = !!storeId && (!!variantId || (productName.trim().length > 0));

  const submit = async () => {
    if (!storeId || !canSave) return;
    setSaving(true); setErr(null);
    try {
      await retailApi.createSellOut({
        store_id: storeId,
        variant_id: variantId ?? undefined,
        product_name: productName || undefined,
        sku: sku || undefined,
        period_start: new Date(periodStart + "T00:00:00").toISOString(),
        period_end: new Date(periodEnd + "T23:59:59").toISOString(),
        period_type: periodType,
        units_sold: unitsSold,
        units_on_hand: unitsOnHand,
        revenue,
        notes: notes || undefined,
        source: "manual",
      });
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 620, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Registrar sell-out</h3>
        <p style={{ color: t.textLo, fontSize: 12, marginTop: 4 }}>Captura ventas y stock que la tienda te reportó para el periodo.</p>

        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Cadena</label>
            <select value={channelId} onChange={e => setChannelId(Number(e.target.value))} style={inputStyle(t)}>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle(t)}>Tienda *</label>
            <select value={storeId ?? ""} onChange={e => setStoreId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(t)}>
              {stores.length === 0 && <option value="">— sin tiendas activas —</option>}
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Producto del catálogo</label>
            <select value={variantId ?? ""} onChange={e => setVariantId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(t)}>
              <option value="">— Manual (sin SKU vinculado) —</option>
              {variants.map(v => (
                <option key={v.variant_id} value={v.variant_id}>
                  {v.product_name}{v.sku ? ` · ${v.sku}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle(t)}>SKU (snapshot)</label>
            <input value={sku} onChange={e => setSku(e.target.value)} style={inputStyle(t)} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle(t)}>Nombre del producto *</label>
            <input value={productName} onChange={e => setProductName(e.target.value)} style={inputStyle(t)} />
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle(t)}>Tipo periodo</label>
            <select value={periodType} onChange={e => setPeriodType(e.target.value as any)} style={inputStyle(t)}>
              <option value="day">Diario</option>
              <option value="week">Semanal</option>
              <option value="month">Mensual</option>
            </select>
          </div>
          <div>
            <label style={labelStyle(t)}>Inicio</label>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={inputStyle(t)} />
          </div>
          <div>
            <label style={labelStyle(t)}>Fin</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={inputStyle(t)} />
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ ...labelStyle(t), color: t.good }}>Unidades vendidas</label>
              <input type="number" min={0} value={unitsSold || ""} onChange={e => setUnitsSold(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div>
              <label style={{ ...labelStyle(t), color: t.nova }}>Stock final (on-hand)</label>
              <input type="number" min={0} value={unitsOnHand || ""} onChange={e => setUnitsOnHand(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div>
              <label style={labelStyle(t)}>Ingreso (MXN)</label>
              <input type="number" step={0.01} min={0} value={revenue || ""} onChange={e => setRevenue(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle(t)}>Notas</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            style={{ ...inputStyle(t), resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {err && <div style={errStyle(t)}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
          <button disabled={!canSave || saving} onClick={submit} style={btnPrimary(t)}>
            {saving ? "Guardando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ── Reabasto ─────────────────────────────────────────────────────────────
function ReplenishmentView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ReplenishmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showTransfer, setShowTransfer] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await retailApi.replenishment(channelId || undefined);
      setData(r);
      setSelected({});
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [channelId]);

  const keyOf = (s: ReplenishmentSuggestion) => `${s.store_id}:${s.variant_id ?? "x"}`;
  const eligibleForTransfer = (data?.suggestions || []).filter(s => s.variant_id);
  const selectedItems = eligibleForTransfer.filter(s => selected[keyOf(s)]);
  const allSelected = eligibleForTransfer.length > 0 && selectedItems.length === eligibleForTransfer.length;
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allSelected) eligibleForTransfer.forEach(s => { next[keyOf(s)] = true; });
    setSelected(next);
  };

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>Calculando sugerencias…</div>;
  if (!data) return null;

  const prioMeta = (p: string) => p === "urgent"
    ? { label: "Urgente", color: t.bad, icon: AlertTriangle }
    : p === "high"
    ? { label: "Alta", color: t.warn, icon: TrendingUp }
    : { label: "Normal", color: t.nova, icon: Truck };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: t.textLo }}>
          Meta {data.target_wos_weeks} sem · Mínimo {data.critical_wos_weeks} sem ·
          Generado {new Date(data.generated_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={selectedItems.length === 0} onClick={() => setShowTransfer(true)}
            style={{ ...btnPrimary(t), opacity: selectedItems.length === 0 ? 0.5 : 1 }}
            title="Crea el movimiento de inventario del almacén origen al de consignación de cada tienda">
            <ArrowRight size={13} /> Generar traslado ({selectedItems.length})
          </button>
          <button onClick={load} style={btnGhost(t)}>
            <RefreshCw size={13} /> Recalcular
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <div style={{ padding: 14, background: t.panel, border: `1px solid ${t.bad}55`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Urgentes</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: t.bad, marginTop: 4 }}>{data.urgent_count}</div>
        </div>
        <div style={{ padding: 14, background: t.panel, border: `1px solid ${t.warn}55`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Alta prioridad</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: t.warn, marginTop: 4 }}>{data.high_count}</div>
        </div>
        <div style={{ padding: 14, background: t.panel, border: `1px solid ${t.nova}55`, borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Rutinarias</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: t.nova, marginTop: 4 }}>{data.normal_count}</div>
        </div>
      </div>

      {data.suggestions.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: t.textLo, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <Check size={28} color={t.good} />
          <div style={{ marginTop: 10, color: t.textHi }}>Toda la red por encima de la meta de WOS</div>
          <div style={{ fontSize: 12 }}>No hay sugerencias de reabasto por ahora.</div>
        </div>
      )}

      <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: t.panel2 }}>
              <th style={{ ...thStyle(t), width: 30 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  title="Seleccionar todas las que pueden trasladarse (con SKU)" />
              </th>
              <th style={thStyle(t)}>Prioridad</th>
              <th style={thStyle(t)}>Tienda</th>
              <th style={thStyle(t)}>Producto</th>
              <th style={thStyle(t)}>Stock</th>
              <th style={thStyle(t)}>Vel. sem</th>
              <th style={thStyle(t)}>WOS</th>
              <th style={thStyle(t)}>Sugerido</th>
              <th style={thStyle(t)}>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {data.suggestions.map((s, i) => {
              const meta = prioMeta(s.priority);
              const Icon = meta.icon;
              const k = keyOf(s);
              const eligible = !!s.variant_id;
              return (
                <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                  <td style={{ ...tdStyle(t), textAlign: "center" }}>
                    <input type="checkbox" disabled={!eligible}
                      checked={!!selected[k]}
                      onChange={e => setSelected(prev => ({ ...prev, [k]: e.target.checked }))}
                      title={eligible ? "Incluir en traslado" : "Sin SKU en catálogo"} />
                  </td>
                  <td style={tdStyle(t)}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: meta.color, background: meta.color + "22", padding: "2px 8px", borderRadius: 10 }}>
                      <Icon size={11} /> {meta.label}
                    </span>
                  </td>
                  <td style={tdStyle(t)}>
                    <b style={{ color: t.textHi }}>{s.store_name}</b>
                    <div style={{ fontSize: 10.5, color: t.textLo }}>{s.channel_name}</div>
                  </td>
                  <td style={tdStyle(t)}>
                    <div style={{ color: t.textHi }}>{s.product_name || "—"}</div>
                    <div style={{ fontSize: 10.5, color: t.textLo, fontFamily: "monospace" }}>{s.sku || ""}</div>
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(s.current_on_hand)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{s.avg_weekly_units.toFixed(1)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right", color: meta.color, fontWeight: 700 }}>{s.wos_weeks.toFixed(1)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 800, color: t.textHi, fontSize: 14 }}>{num(s.suggested_units)}</td>
                  <td style={{ ...tdStyle(t), color: t.textLo, fontSize: 11.5 }}>{s.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showTransfer && (
        <TransferModal t={t}
          items={selectedItems}
          onClose={() => setShowTransfer(false)}
          onDone={() => { setShowTransfer(false); load(); }}
        />
      )}
    </div>
  );
}


function TransferModal({ t, items, onClose, onDone }: {
  t: Tokens; items: ReplenishmentSuggestion[]; onClose: () => void; onDone: () => void;
}) {
  const [warehouses, setWarehouses] = useState<SourceWarehouseOption[]>([]);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResponse | null>(null);
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {};
    items.forEach(s => { o[`${s.store_id}:${s.variant_id ?? "x"}`] = s.suggested_units; });
    return o;
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const ws = await retailApi.listSourceWarehouses();
        setWarehouses(ws);
        if (ws.length > 0) setSourceId(ws[0].id);
      } catch { setErr("No pude cargar los almacenes origen."); }
      finally { setLoading(false); }
    })();
  }, []);

  const totalUnits = items.reduce((a, s) => a + (qty[`${s.store_id}:${s.variant_id ?? "x"}`] || 0), 0);

  const submit = async () => {
    if (!sourceId) return;
    setSaving(true); setErr(null);
    try {
      const payload = items
        .filter(s => s.variant_id)
        .map(s => ({
          store_id: s.store_id, variant_id: s.variant_id!,
          units: qty[`${s.store_id}:${s.variant_id}`] || 0,
        }))
        .filter(x => x.units > 0);
      if (payload.length === 0) { setErr("Nada por trasladar"); return; }
      const r = await retailApi.createTransfer(sourceId, payload);
      setResult(r);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al crear traslado");
    } finally { setSaving(false); }
  };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 720, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: t.nova + "22", color: t.nova, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Truck size={16} />
          </div>
          <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Generar traslado a consignación</h3>
        </div>
        <p style={{ color: t.textLo, fontSize: 12, marginTop: 0 }}>
          Se crea un par de movimientos de inventario (salida del origen + entrada al almacén de consignación de cada tienda). El costo unitario se toma FIFO del origen.
        </p>

        {!result && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle(t)}>Almacén origen</label>
              {loading ? (
                <div style={{ color: t.textLo, fontSize: 12, padding: 8 }}>Cargando…</div>
              ) : warehouses.length === 0 ? (
                <div style={errStyle(t)}>No hay almacenes disponibles como origen. Crea uno en Inventario.</div>
              ) : (
                <select value={sourceId ?? ""} onChange={e => setSourceId(Number(e.target.value))} style={inputStyle(t)}>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}{w.location ? ` · ${w.location}` : ""}</option>)}
                </select>
              )}
            </div>

            <div style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.panel3 }}>
                    <th style={thStyle(t)}>Tienda</th>
                    <th style={thStyle(t)}>Producto</th>
                    <th style={thStyle(t)}>Sugerido</th>
                    <th style={thStyle(t)}>A trasladar</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s, i) => {
                    const k = `${s.store_id}:${s.variant_id ?? "x"}`;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                        <td style={tdStyle(t)}>
                          <b style={{ color: t.textHi }}>{s.store_name}</b>
                          <div style={{ fontSize: 10.5, color: t.textLo }}>{s.channel_name}</div>
                        </td>
                        <td style={tdStyle(t)}>
                          <div style={{ color: t.textHi }}>{s.product_name}</div>
                          <div style={{ fontSize: 10.5, color: t.textLo, fontFamily: "monospace" }}>{s.sku}</div>
                        </td>
                        <td style={{ ...tdStyle(t), textAlign: "right", color: t.textMid }}>{num(s.suggested_units)}</td>
                        <td style={{ ...tdStyle(t), textAlign: "right" }}>
                          <input type="number" min={0} value={qty[k] || 0}
                            onChange={e => setQty(prev => ({ ...prev, [k]: Math.max(0, parseInt(e.target.value || "0", 10)) }))}
                            style={{ ...inputStyle(t), textAlign: "right", width: 90 }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: 10, background: t.panel2, borderRadius: 6, fontSize: 12.5, color: t.textMid, marginBottom: 12 }}>
              Total a trasladar: <b style={{ color: t.textHi }}>{num(totalUnits)}</b> unidades en {items.length} línea{items.length !== 1 ? "s" : ""}.
            </div>

            {err && <div style={errStyle(t)}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose} style={btnGhost(t)}>Cancelar</button>
              <button disabled={saving || !sourceId || totalUnits === 0} onClick={submit} style={btnPrimary(t)}>
                {saving ? "Trasladando…" : "Confirmar traslado"}
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <div style={{ marginTop: 8, padding: 14, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Check size={16} color={t.good} />
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>Traslado registrado desde {result.source_warehouse_name}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                <StatMini t={t} label="Líneas trasladadas" value={result.transferred_lines.toString()} color={t.good} />
                <StatMini t={t} label="Unidades" value={num(result.total_units)} />
                <StatMini t={t} label="Advertencias" value={result.warnings.toString()} color={result.warnings > 0 ? t.warn : t.textLo} />
              </div>
            </div>

            {result.warnings > 0 && (
              <div style={{ marginTop: 12, padding: 12, background: t.warn + "18", border: `1px solid ${t.warn}55`, borderRadius: 8 }}>
                <div style={{ color: t.warn, fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>Líneas con problema</div>
                <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 11.5, display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.results.filter(r => r.status !== "transferred").map((r, i) => (
                    <div key={i} style={{ padding: "5px 8px", background: t.panel3, borderRadius: 5, color: t.textMid }}>
                      Tienda #{r.store_id} · SKU #{r.variant_id}: <b style={{ color: t.textHi }}>{r.status}</b> — {r.message || "—"}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={onDone} style={btnPrimary(t)}>Listo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}


// ── Estilos compartidos ──────────────────────────────────────────────────
const thStyle = (t: Tokens): React.CSSProperties => ({
  padding: "10px 12px", textAlign: "left", fontSize: 11,
  color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4,
  borderBottom: `1px solid ${t.border}`, fontWeight: 700,
});
const tdStyle = (t: Tokens): React.CSSProperties => ({
  padding: "10px 12px", color: t.textMid, verticalAlign: "middle",
});
const inputStyle = (t: Tokens): React.CSSProperties => ({
  width: "100%", padding: "8px 12px", borderRadius: 7,
  border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi,
  fontSize: 13, marginTop: 4, boxSizing: "border-box",
});
const labelStyle = (t: Tokens): React.CSSProperties => ({
  fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4,
});
const errStyle = (t: Tokens): React.CSSProperties => ({
  marginTop: 10, padding: "8px 10px", borderRadius: 6,
  background: t.bad + "18", color: t.bad, fontSize: 12,
});
const btnPrimary = (t: Tokens): React.CSSProperties => ({
  padding: "8px 16px", borderRadius: 8, border: "none",
  background: t.nova, color: "#fff", cursor: "pointer",
  fontWeight: 700, fontSize: 12.5,
  display: "inline-flex", alignItems: "center", gap: 6,
});
const btnGhost = (t: Tokens): React.CSSProperties => ({
  padding: "7px 12px", borderRadius: 7, border: `1px solid ${t.border}`,
  background: t.panel2, color: t.textMid, cursor: "pointer",
  fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6,
});
const iconBtn = (t: Tokens): React.CSSProperties => ({
  padding: 6, borderRadius: 6, border: "none",
  background: "transparent", color: t.textMid, cursor: "pointer",
  marginLeft: 4,
});


// ── Consignación ─────────────────────────────────────────────────────────
function reconStatusInfo(t: Tokens, s: string) {
  switch (s) {
    case "match": return { label: "Cuadra", color: t.good, bg: t.good + "22" };
    case "short_at_warehouse": return { label: "Faltante en tu almacén", color: t.bad, bg: t.bad + "22" };
    case "over_at_warehouse": return { label: "Sobrante en tu almacén", color: t.nova, bg: t.nova + "22" };
    default: return { label: "Sin datos", color: t.textLo, bg: t.panel3 };
  }
}

function ConsignmentView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ConsignmentReconResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "diffs" | "shorts">("diffs");

  const load = async () => {
    setLoading(true);
    try {
      const r = await retailApi.consignmentReconciliation(channelId || undefined);
      setData(r);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [channelId]);

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>Calculando reconciliación…</div>;
  if (!data) return null;

  const rows = data.rows.filter(r =>
    filter === "all" ? true
      : filter === "shorts" ? r.status === "short_at_warehouse"
      : r.status !== "match"
  );

  const totalStores = new Set(data.rows.map(r => r.store_id)).size;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <SumTile t={t} label="Tiendas con consignación" value={totalStores} color={t.textHi} />
          <SumTile t={t} label="SKUs revisados" value={data.total_rows} color={t.textHi} />
          <SumTile t={t} label="Cuadran" value={data.matched} color={t.good} />
          <SumTile t={t} label="Con descuadre" value={data.with_diff} color={t.bad} />
        </div>
        <button onClick={load} style={btnGhost(t)}>
          <RefreshCw size={13} /> Recalcular
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <FilterPill t={t} label="Sólo descuadres" active={filter === "diffs"} onClick={() => setFilter("diffs")} color={t.bad} />
        <FilterPill t={t} label="Sólo faltantes" active={filter === "shorts"} onClick={() => setFilter("shorts")} color={t.bad} />
        <FilterPill t={t} label="Todo" active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      {totalStores === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <Warehouse size={30} color={t.textLo} />
          <div style={{ marginTop: 10, color: t.textHi, fontSize: 14 }}>Ninguna tienda tiene almacén de consignación asignado</div>
          <div style={{ marginTop: 4, color: t.textLo, fontSize: 12 }}>
            Edita una tienda y vincula un almacén con tipo "consignación" del módulo Inventario para activar la trazabilidad automática.
          </div>
        </div>
      )}

      {rows.length === 0 && totalStores > 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <CheckCircle2 size={30} color={t.good} />
          <div style={{ marginTop: 10, color: t.textHi, fontSize: 14 }}>Todo cuadra en este filtro</div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.panel2 }}>
                <th style={thStyle(t)}>Tienda</th>
                <th style={thStyle(t)}>Almacén</th>
                <th style={thStyle(t)}>SKU</th>
                <th style={thStyle(t)}>Reportado</th>
                <th style={thStyle(t)}>En almacén</th>
                <th style={thStyle(t)}>Diferencia</th>
                <th style={thStyle(t)}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const info = reconStatusInfo(t, r.status);
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={tdStyle(t)}>
                      <b style={{ color: t.textHi }}>{r.store_name}</b>
                      <div style={{ fontSize: 10.5, color: t.textLo }}>{r.channel_name}</div>
                    </td>
                    <td style={tdStyle(t)}>{r.warehouse_name}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ color: t.textHi }}>{r.product_name || "—"}</div>
                      <div style={{ fontSize: 10.5, color: t.textLo, fontFamily: "monospace" }}>{r.sku || ""}</div>
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>
                      <div>{num(r.reported_on_hand)}</div>
                      {r.reported_at && (
                        <div style={{ fontSize: 10, color: t.textLo }}>
                          {new Date(r.reported_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.warehouse_stock)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: info.color, fontWeight: 800 }}>
                      {r.difference >= 0 ? "+" : ""}{num(r.difference)}
                    </td>
                    <td style={tdStyle(t)}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: info.color, background: info.bg, padding: "2px 8px", borderRadius: 10 }}>
                        {info.label}
                      </span>
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


// ── Analíticas: Heatmap + ABC ────────────────────────────────────────────
function AnalyticsView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [sub, setSub] = useState<"heatmap" | "abc">("heatmap");
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        <button onClick={() => setSub("heatmap")}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 8,
            border: `1px solid ${sub === "heatmap" ? t.nova : t.border}`,
            background: sub === "heatmap" ? t.nova + "22" : "transparent",
            color: sub === "heatmap" ? t.nova : t.textMid,
            cursor: "pointer", fontSize: 12.5, fontWeight: 700,
          }}>
          <Grid3x3 size={13} /> Heatmap tiendas × SKUs
        </button>
        <button onClick={() => setSub("abc")}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "8px 14px", borderRadius: 8,
            border: `1px solid ${sub === "abc" ? t.nova : t.border}`,
            background: sub === "abc" ? t.nova + "22" : "transparent",
            color: sub === "abc" ? t.nova : t.textMid,
            cursor: "pointer", fontSize: 12.5, fontWeight: 700,
          }}>
          <TrendingUp size={13} /> Clasificación ABC
        </button>
      </div>
      {sub === "heatmap" && <HeatmapView t={t} channelId={channelId} />}
      {sub === "abc" && <ABCView t={t} channelId={channelId} />}
    </div>
  );
}


function HeatmapView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [metric, setMetric] = useState<HeatmapMetric>("wos");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.heatmap({
          channel_id: channelId || undefined, metric, limit_variants: 40,
        });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, metric]);

  const cellMap = new Map<string, HeatmapResponse["cells"][number]>();
  data?.cells.forEach(c => cellMap.set(`${c.store_id}:${c.variant_id}`, c));

  const cellBg = (c?: HeatmapResponse["cells"][number]) => {
    if (!c || c.status === "no_data") return t.panel3;
    if (c.status === "critical") return t.bad;
    if (c.status === "replenish") return t.warn;
    if (c.status === "overstock") return t.nova;
    return t.good;
  };

  const fmt = (c?: HeatmapResponse["cells"][number]) => {
    if (!c) return "";
    if (metric === "units_sold") return num(c.units_sold);
    if (metric === "on_hand") return num(c.on_hand);
    return c.value != null ? `${c.value.toFixed(1)}` : "∞";
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <FilterPill t={t} label="WOS" active={metric === "wos"} onClick={() => setMetric("wos")} />
          <FilterPill t={t} label="Unidades vendidas" active={metric === "units_sold"} onClick={() => setMetric("units_sold")} />
          <FilterPill t={t} label="Stock actual" active={metric === "on_hand"} onClick={() => setMetric("on_hand")} />
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 10.5, color: t.textLo, alignItems: "center", flexWrap: "wrap" }}>
          <LegendDot t={t} color={t.bad} label="Crítico" />
          <LegendDot t={t} color={t.warn} label="Resurtir" />
          <LegendDot t={t} color={t.good} label="Sano" />
          <LegendDot t={t} color={t.nova} label="Sobreinventario" />
          <LegendDot t={t} color={t.panel3} label="Sin datos" />
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && data && (data.stores.length === 0 || data.variants.length === 0) && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Grid3x3 size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin suficientes datos para dibujar el heatmap</div>
          <div style={{ fontSize: 11 }}>Registra sell-out por tienda × SKU para verlo.</div>
        </div>
      )}
      {!loading && data && data.stores.length > 0 && data.variants.length > 0 && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 10, overflowX: "auto" }}>
          <div style={{ display: "inline-block", minWidth: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: `220px repeat(${data.variants.length}, 60px)`, gap: 3, alignItems: "stretch" }}>
              <div />
              {data.variants.map(v => (
                <div key={v.id}
                  title={`${v.product_name || ""} · ${v.sku || ""}`}
                  style={{
                    fontSize: 9.5, color: t.textLo, textAlign: "center",
                    padding: 4, wordBreak: "break-word", fontFamily: "monospace",
                    background: t.panel2, borderRadius: 4,
                  }}>
                  {(v.sku || v.product_name || "—").slice(0, 8)}
                </div>
              ))}
              {data.stores.map(s => (
                <>
                  <div key={`s${s.id}`} style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "3px 8px", background: t.panel2, borderRadius: 4 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 9.5, color: t.textLo, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.channel_name}
                    </div>
                  </div>
                  {data.variants.map(v => {
                    const c = cellMap.get(`${s.id}:${v.id}`);
                    const bg = cellBg(c);
                    return (
                      <div key={`c${s.id}-${v.id}`}
                        title={c ? `${s.name} · ${v.sku || v.product_name || ""}\nStock ${c.on_hand} · Vend ${c.units_sold} · WOS ${c.value ?? "∞"}` : ""}
                        style={{
                          background: bg, color: c && c.status !== "no_data" ? "#fff" : t.textLo,
                          borderRadius: 4, padding: 4, textAlign: "center",
                          fontSize: 10.5, fontWeight: 700, minHeight: 34,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                        {fmt(c)}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function LegendDot({ t, color, label }: { t: Tokens; color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}


function ABCView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ABCResponse | null>(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.abc({ channel_id: channelId || undefined, days });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days]);

  if (loading) return <div style={{ padding: 40, color: t.textLo, textAlign: "center" }}>Calculando ABC…</div>;
  if (!data) return null;

  const classInfo = (c: "A" | "B" | "C") => c === "A"
    ? { color: t.good, bg: t.good + "22", desc: "80% del ingreso · productos ancla" }
    : c === "B"
    ? { color: t.nova, bg: t.nova + "22", desc: "Siguiente 15% · complementarios" }
    : { color: t.textLo, bg: t.panel3, desc: "Últimos 5% · long tail" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 90, 180, 365].map(d => (
            <FilterPill key={d} t={t} label={`${d}d`} active={days === d} onClick={() => setDays(d)} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: t.textLo }}>
          Ingreso total: <b style={{ color: t.textHi }}>{mxn(data.total_revenue)}</b>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        {(["A", "B", "C"] as const).map(cls => {
          const info = classInfo(cls);
          const count = cls === "A" ? data.class_a_count : cls === "B" ? data.class_b_count : data.class_c_count;
          return (
            <div key={cls} style={{ padding: 14, background: t.panel, border: `1px solid ${info.color}55`, borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: info.color, background: info.bg, width: 32, height: 32, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {cls}
                </span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: t.textHi }}>{count} SKUs</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>{info.desc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data.rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: t.textLo, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          Sin ventas registradas en la ventana seleccionada.
        </div>
      ) : (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.panel2 }}>
                <th style={thStyle(t)}>Rank</th>
                <th style={thStyle(t)}>Producto</th>
                <th style={thStyle(t)}>Tiendas</th>
                <th style={thStyle(t)}>Unidades</th>
                <th style={thStyle(t)}>Ingreso</th>
                <th style={thStyle(t)}>%</th>
                <th style={thStyle(t)}>Acum.</th>
                <th style={thStyle(t)}>Clase</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => {
                const info = classInfo(r.abc_class);
                return (
                  <tr key={r.rank} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={{ ...tdStyle(t), color: t.textLo, fontFamily: "monospace" }}>#{r.rank}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ color: t.textHi }}>{r.product_name || "—"}</div>
                      <div style={{ fontSize: 10.5, color: t.textLo, fontFamily: "monospace" }}>{r.sku || ""}</div>
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.stores_count}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.total_units)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textHi, fontWeight: 700 }}>{mxn(r.total_revenue)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.revenue_pct.toFixed(1)}%</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textLo }}>{r.cumulative_pct.toFixed(1)}%</td>
                    <td style={tdStyle(t)}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: info.color, background: info.bg, padding: "2px 8px", borderRadius: 10 }}>
                        {r.abc_class}
                      </span>
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
