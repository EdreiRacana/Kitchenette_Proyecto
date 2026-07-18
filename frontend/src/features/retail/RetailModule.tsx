// RetailModule.tsx — Sell-out Analytics profesional para PyMES.
// Cada empresa registra sus propias cadenas, tiendas y sell-out.
// KPIs: sell-through %, WOS ponderado, alertas de stock-out y sobreinventario,
// panel de reabasto con sugerencias por tienda × SKU.

import { useEffect, useMemo, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Store, LayoutDashboard, Building2, ShoppingBag, Package, Truck,
  Plus, Pencil, Trash2, X, Search, AlertTriangle, TrendingUp,
  ChevronRight, RefreshCw, Check, Download, Upload, FileText,
  Bell, EyeOff, CheckCircle2, Zap, Warehouse, Grid3x3, BarChart3, ArrowRight,
  FileSpreadsheet, FileDown, LineChart, Network, TrendingDown, DollarSign, Boxes, Clock, Gauge, Grid2x2, Tag,
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
  HeatmapResponse, HeatmapMetric, HeatmapFilters, HeatmapSortStores,
  ABCResponse, SourceWarehouseOption, TransferResponse,
  RetailImportProfile, DetectColumnsResponse, PreviewResponse,
  TrendResponse, DistributionResponse, LostSalesResponse,
  ProfitabilityResponse, ProfitGroupBy, ExcessInventoryResponse, AgingResponse,
  ServiceLevelResponse, ServiceGroupBy, AbcXyzResponse,
  PricingResponse, PriceHistoryResponse,
} from "./types";

type Tokens = any;

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => (n || 0).toLocaleString("es-MX");

async function downloadBlob(fetcher: () => Promise<Blob>, filename: string) {
  const blob = await fetcher();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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

  const retUnits = kpis.total_returns_units ?? 0;
  const retAmt = kpis.total_returns_amount ?? 0;
  const retPct = kpis.return_rate_pct ?? 0;
  const netU = kpis.net_units ?? Math.max(kpis.total_sell_out_units - retUnits, 0);
  const netRev = kpis.net_revenue ?? Math.max(kpis.total_sell_out_revenue - retAmt, 0);
  const retColor = retPct >= 10 ? t.bad : retPct >= 5 ? t.warn : t.good;
  const tiles = [
    { label: "Sell-out (unidades)", value: num(kpis.total_sell_out_units), sub: mxn(kpis.total_sell_out_revenue), color: t.textHi },
    { label: "Devoluciones", value: num(retUnits), sub: `${retPct.toFixed(1)}% · ${mxn(retAmt)}`, color: retColor },
    { label: "Neto", value: num(netU), sub: mxn(netRev), color: t.textHi },
    { label: "Sell-in (unidades)", value: num(kpis.total_sell_in_units), sub: mxn(kpis.total_sell_in_revenue), color: t.textHi },
    { label: "Sell-through", value: `${kpis.sell_through_pct.toFixed(1)}%`, sub: "Sell-out / Sell-in", color: kpis.sell_through_pct >= 70 ? t.good : kpis.sell_through_pct >= 40 ? t.warn : t.bad },
    { label: "On-hand total", value: num(kpis.total_on_hand), sub: `${kpis.stores_active_count} tiendas · ${kpis.skus_active_count} SKUs`, color: t.textHi },
    { label: "WOS promedio", value: `${kpis.avg_wos_weeks.toFixed(1)} sem`, sub: "Weeks of Supply", color: kpis.avg_wos_weeks >= 4 && kpis.avg_wos_weeks <= 12 ? t.good : t.warn },
    { label: "Tiendas críticas", value: num(kpis.critical_stores_count), sub: "WOS < mínimo", color: kpis.critical_stores_count > 0 ? t.bad : t.good },
    { label: "Sobreinventario", value: num(kpis.overstock_stores_count), sub: "WOS > máximo", color: kpis.overstock_stores_count > 0 ? t.nova : t.good },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: t.textLo }}>Últimos {days} días</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${t.border}`,
                background: days === d ? t.nova : "transparent", color: days === d ? "#fff" : t.textMid,
                cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {d}d
            </button>
          ))}
          <div style={{ width: 8 }} />
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.dashboard({ channel_id: channelId || undefined, days }),
              `retail_dashboard_${days}d.xlsx`,
            )}
          />
          <ExcelBtn t={t} label="Reporte ejecutivo (PDF)" icon={FileDown}
            onClick={() => downloadBlob(
              () => retailApi.reports.executivePdf({ channel_id: channelId || undefined, days }),
              `retail_reporte_ejecutivo.pdf`,
            )}
          />
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
  const [returnMaxPct, setReturnMaxPct] = useState(channel?.return_rate_max_pct ?? 5);
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
        return_rate_max_pct: returnMaxPct,
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

        <div style={{ marginTop: 12, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 12, color: t.textLo, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Devoluciones</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, alignItems: "end" }}>
            <div>
              <label style={{ ...labelStyle(t), color: t.bad }}>Tasa máxima (%)</label>
              <input type="number" step={0.5} min={0} max={100}
                value={returnMaxPct} onChange={e => setReturnMaxPct(Number(e.target.value))}
                style={inputStyle(t)} />
            </div>
            <div style={{ fontSize: 10.5, color: t.textLo }}>
              Si las devoluciones superan este % de las ventas en los últimos 28 días, se levanta una alerta de la cadena.
            </div>
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
          <ExcelBtn t={t} label="Exportar datos"
            onClick={() => downloadBlob(
              () => retailApi.reports.sellout({ channel_id: selectedChannel || undefined, limit: 5000 }),
              `retail_sellout.xlsx`,
            )}
          />
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
                <th style={thStyle(t)}>Devueltas</th>
                <th style={thStyle(t)}>Netas</th>
                <th style={thStyle(t)}>Stock</th>
                <th style={thStyle(t)}>Ingreso</th>
                <th style={thStyle(t)}>Neto $</th>
                <th style={thStyle(t)}>Fuente</th>
                <th style={thStyle(t)}></th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && (
                <tr><td colSpan={13} style={{ padding: 30, textAlign: "center", color: t.textLo }}>
                  Sin reportes aún. Registra el primer sell-out.
                </td></tr>
              )}
              {reports.map(r => {
                const ret = r.units_returned || 0;
                const retAmt = r.returns_amount || 0;
                const netU = Math.max((r.units_sold || 0) - ret, 0);
                const netRev = Math.max((r.revenue || 0) - retAmt, 0);
                const retPct = r.units_sold > 0 ? (ret / r.units_sold) * 100 : 0;
                const retColor = retPct >= 10 ? t.bad : retPct >= 5 ? t.warn : t.textMid;
                return (
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
                  <td style={{ ...tdStyle(t), textAlign: "right", color: retColor }}>
                    {ret > 0 ? `${num(ret)} (${retPct.toFixed(1)}%)` : "—"}
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600 }}>{num(netU)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.units_on_hand)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(r.revenue)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(netRev)}</td>
                  <td style={tdStyle(t)}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, background: t.panel3, color: t.textMid }}>
                      {r.source}
                    </span>
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>
                    <button onClick={() => del(r)} style={{ ...iconBtn(t), color: t.bad }}><Trash2 size={12} /></button>
                  </td>
                </tr>
                );
              })}
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
    unidades_vendidas: "Unidades vendidas *",
    unidades_devueltas: "Unidades devueltas",
    unidades_stock: "Stock",
    ingreso: "Ingreso",
    importe_devoluciones: "Importe devoluciones",
    notas: "Notas",
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
                    <th style={thStyle(t)}>Devuelt</th>
                    <th style={thStyle(t)}>Stock</th>
                    <th style={thStyle(t)}>Ingreso</th>
                    <th style={thStyle(t)}>Devol $</th>
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
                      <td style={{ ...tdStyle(t), textAlign: "right", color: (r.normalized.unidades_devueltas ?? 0) > 0 ? t.bad : t.textLo }}>{r.normalized.unidades_devueltas ?? 0}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.normalized.unidades_stock ?? 0}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(r.normalized.ingreso ?? 0)}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right", color: (r.normalized.importe_devoluciones ?? 0) > 0 ? t.bad : t.textLo }}>{mxn(r.normalized.importe_devoluciones ?? 0)}</td>
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


function ExcelBtn({ t, label, onClick, icon }: { t: Tokens; label: string; onClick: () => void; icon?: any }) {
  const [busy, setBusy] = useState(false);
  const Icon = icon || FileSpreadsheet;
  return (
    <button disabled={busy}
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}
      style={{
        padding: "6px 12px", borderRadius: 7,
        border: `1px solid ${t.good}55`, background: t.good + "18",
        color: t.good, cursor: busy ? "wait" : "pointer",
        fontSize: 12, fontWeight: 600,
        display: "inline-flex", alignItems: "center", gap: 5,
      }}
      title={label}>
      <Icon size={13} /> {busy ? "Descargando…" : label}
    </button>
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
  high_return_rate: "Devoluciones altas",
};

function NotifyAlertsModal({ t, channelId, onClose }: {
  t: Tokens; channelId: number | null; onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [useEmail, setUseEmail] = useState(true);
  const [useWhatsapp, setUseWhatsapp] = useState(false);
  const [minSev, setMinSev] = useState<"urgent" | "high" | "medium">("high");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<import("./types").NotifyAlertsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const send = async () => {
    setSending(true); setErr(null); setResult(null);
    try {
      const r = await retailApi.notifyAlerts({
        channel_id: channelId || undefined,
        email: useEmail ? email || undefined : undefined,
        whatsapp_to: useWhatsapp ? whatsapp || undefined : undefined,
        send_email: useEmail, send_whatsapp: useWhatsapp,
        min_severity: minSev,
      });
      setResult(r);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "Error al enviar");
    } finally { setSending(false); }
  };

  const modal = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: "100%", background: t.panel, borderRadius: 12, border: `1px solid ${t.border}`, padding: 22 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>Notificar alertas</h3>
        <p style={{ color: t.textLo, fontSize: 12, marginTop: 4 }}>
          Envía las alertas abiertas por correo y/o WhatsApp al responsable.
        </p>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle(t)}>Severidad mínima a incluir</label>
          <select value={minSev} onChange={e => setMinSev(e.target.value as any)} style={inputStyle(t)}>
            <option value="urgent">Solo urgentes</option>
            <option value="high">Urgentes + alta</option>
            <option value="medium">Urgentes + alta + media</option>
          </select>
        </div>

        <div style={{ marginTop: 14, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={useEmail} onChange={e => setUseEmail(e.target.checked)} />
            <span style={{ fontSize: 13, color: t.textMid, fontWeight: 600 }}>Correo electrónico</span>
          </label>
          {useEmail && (
            <input value={email} onChange={e => setEmail(e.target.value)} type="email"
              placeholder="gerente@empresa.com"
              style={{ ...inputStyle(t), marginTop: 8 }} />
          )}
        </div>

        <div style={{ marginTop: 10, padding: 12, background: t.panel2, borderRadius: 8, border: `1px solid ${t.border}` }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={useWhatsapp} onChange={e => setUseWhatsapp(e.target.checked)} />
            <span style={{ fontSize: 13, color: t.textMid, fontWeight: 600 }}>WhatsApp</span>
          </label>
          {useWhatsapp && (
            <>
              <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
                placeholder="+52 1 55 1234 5678"
                style={{ ...inputStyle(t), marginTop: 8 }} />
              <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 6 }}>
                Requiere configurar el webhook de WhatsApp (Twilio, Meta, n8n…) en el servidor.
              </div>
            </>
          )}
        </div>

        {result && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: t.panel2, border: `1px solid ${t.border}`, fontSize: 12 }}>
            <div style={{ color: t.textMid, marginBottom: 6 }}>{result.alerts_included} alertas incluidas</div>
            {useEmail && (
              <div style={{ color: result.email_sent ? t.good : t.bad, display: "flex", gap: 6, alignItems: "center" }}>
                {result.email_sent ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                Correo: {result.email_sent ? "enviado ✓" : (result.email_error || "no enviado")}
              </div>
            )}
            {useWhatsapp && (
              <div style={{ color: result.whatsapp_sent ? t.good : t.bad, display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                {result.whatsapp_sent ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                WhatsApp: {result.whatsapp_sent ? "enviado ✓" : (result.whatsapp_error || "no enviado")}
              </div>
            )}
          </div>
        )}
        {err && <div style={errStyle(t)}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost(t)}>Cerrar</button>
          <button disabled={sending || (!useEmail && !useWhatsapp)} onClick={send} style={btnPrimary(t)}>
            <Bell size={14} /> {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

function AlertsView({ t, channelId, onChanged }: {
  t: Tokens; channelId: number | null; onChanged: () => void;
}) {
  const [alerts, setAlerts] = useState<RetailAlert[]>([]);
  const [summary, setSummary] = useState<AlertsSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("open");
  const [sevFilter, setSevFilter] = useState<AlertSeverity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const PAGE = 50;
  const [evaluating, setEvaluating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [actioning, setActioning] = useState<{ id: number; kind: "ack" | "resolve" | "dismiss" } | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => setDebSearch(search), 250);
    return () => clearTimeout(h);
  }, [search]);
  // Reset de página al cambiar cualquier filtro
  useEffect(() => { setOffset(0); }, [channelId, statusFilter, sevFilter, typeFilter, debSearch]);

  const load = async () => {
    setLoading(true);
    try {
      const commonFilters = {
        channel_id: channelId || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        severity: sevFilter === "all" ? undefined : sevFilter,
        alert_type: typeFilter === "all" ? undefined : typeFilter,
        q: debSearch || undefined,
      };
      const [a, s, c] = await Promise.all([
        retailApi.listAlerts({ ...commonFilters, limit: PAGE, offset }),
        retailApi.alertsSummary(channelId || undefined),
        retailApi.alertsCount(commonFilters),
      ]);
      setAlerts(a); setSummary(s); setTotal(c);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [channelId, statusFilter, sevFilter, typeFilter, debSearch, offset]);

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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.alerts({
                channel_id: channelId || undefined,
                status: statusFilter === "all" ? undefined : statusFilter,
                severity: sevFilter === "all" ? undefined : sevFilter,
              }),
              `retail_alertas.xlsx`,
            )}
          />
          <button onClick={() => setNotifyOpen(true)} style={btnGhost(t)} title="Enviar alertas por correo o WhatsApp">
            <Bell size={14} /> Notificar
          </button>
          <button disabled={evaluating} onClick={doEvaluate} style={btnPrimary(t)} title="Recorrer todas las cadenas y regenerar alertas">
            <Zap size={14} /> {evaluating ? "Evaluando…" : "Evaluar ahora"}
          </button>
        </div>
      </div>

      {notifyOpen && (
        <NotifyAlertsModal t={t} channelId={channelId} onClose={() => setNotifyOpen(false)} />
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
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

      {/* Búsqueda + tipo + paginación — indispensable con miles de SKUs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={12} color={t.textLo} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por tienda, SKU o producto…"
            style={{ ...inputStyle(t), paddingLeft: 30, marginTop: 0, fontSize: 12, height: 32 }} />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ ...inputStyle(t), width: "auto", fontSize: 12, height: 32, marginTop: 0 }}
          title="Tipo de alerta">
          <option value="all">Todos los tipos</option>
          <option value="stockout">Sin stock</option>
          <option value="stockout_imminent">Stock crítico</option>
          <option value="overstock">Sobreinventario</option>
          <option value="no_movement">Sin movimiento</option>
          <option value="sell_through_low">Sell-through bajo</option>
          <option value="high_return_rate">Devoluciones altas</option>
        </select>
        <div style={{ fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>
          {total > 0
            ? `${(offset + 1).toLocaleString("es-MX")}-${Math.min(offset + PAGE, total).toLocaleString("es-MX")} de ${total.toLocaleString("es-MX")}`
            : "0 resultados"}
        </div>
        {total > PAGE && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
              style={{ padding: "5px 10px", background: offset === 0 ? "transparent" : t.panel3, border: `1px solid ${t.border}`, borderRadius: 6, color: offset === 0 ? t.textLo : t.textMid, cursor: offset === 0 ? "not-allowed" : "pointer", fontSize: 11 }}>
              ← Anterior
            </button>
            <span style={{ fontSize: 11, color: t.textMid }}>
              Pág {Math.floor(offset / PAGE) + 1} / {Math.max(1, Math.ceil(total / PAGE))}
            </span>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
              style={{ padding: "5px 10px", background: offset + PAGE >= total ? "transparent" : t.panel3, border: `1px solid ${t.border}`, borderRadius: 6, color: offset + PAGE >= total ? t.textLo : t.textMid, cursor: offset + PAGE >= total ? "not-allowed" : "pointer", fontSize: 11 }}>
              Siguiente →
            </button>
          </div>
        )}
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
  const [unitsReturned, setUnitsReturned] = useState(0);
  const [unitsOnHand, setUnitsOnHand] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [returnsAmount, setReturnsAmount] = useState(0);
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
        units_returned: unitsReturned || undefined,
        units_on_hand: unitsOnHand,
        revenue,
        returns_amount: returnsAmount || undefined,
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
              <label style={{ ...labelStyle(t), color: t.bad }}>Unidades devueltas</label>
              <input type="number" min={0} value={unitsReturned || ""} onChange={e => setUnitsReturned(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div>
              <label style={{ ...labelStyle(t), color: t.nova }}>Stock final (on-hand)</label>
              <input type="number" min={0} value={unitsOnHand || ""} onChange={e => setUnitsOnHand(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div>
              <label style={labelStyle(t)}>Ingreso bruto (MXN)</label>
              <input type="number" step={0.01} min={0} value={revenue || ""} onChange={e => setRevenue(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div>
              <label style={{ ...labelStyle(t), color: t.bad }}>Importe devoluciones</label>
              <input type="number" step={0.01} min={0} value={returnsAmount || ""} onChange={e => setReturnsAmount(Number(e.target.value) || 0)} style={inputStyle(t)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <div style={{ fontSize: 10, color: t.textLo, marginBottom: 3 }}>Neto</div>
              <div style={{ padding: "7px 10px", background: t.panel3, borderRadius: 6, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: t.textHi }}>{num(Math.max(unitsSold - unitsReturned, 0))} u</div>
                <div style={{ color: t.textMid, fontSize: 11 }}>{mxn(Math.max(revenue - returnsAmount, 0))}</div>
              </div>
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
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.replenishment({ channel_id: channelId || undefined }),
              `retail_reabasto.xlsx`,
            )}
          />
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
        <div style={{ display: "flex", gap: 6 }}>
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.consignment({ channel_id: channelId || undefined }),
              `retail_consignacion.xlsx`,
            )}
          />
          <button onClick={load} style={btnGhost(t)}>
            <RefreshCw size={13} /> Recalcular
          </button>
        </div>
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
type AnalyticsSub = "heatmap" | "trend" | "profitability" | "pricing" | "excess" | "aging" | "service" | "distribution" | "lost_sales" | "abc" | "abcxyz";

function AnalyticsView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [sub, setSub] = useState<AnalyticsSub>("heatmap");
  const tabs: { key: AnalyticsSub; label: string; icon: any }[] = [
    { key: "heatmap", label: "Heatmap tiendas × SKUs", icon: Grid3x3 },
    { key: "trend", label: "Tendencia", icon: LineChart },
    { key: "profitability", label: "Rentabilidad", icon: DollarSign },
    { key: "pricing", label: "Precios", icon: Tag },
    { key: "excess", label: "Exceso de inventario", icon: Boxes },
    { key: "aging", label: "Antigüedad", icon: Clock },
    { key: "service", label: "Nivel de servicio", icon: Gauge },
    { key: "distribution", label: "Distribución (voids)", icon: Network },
    { key: "lost_sales", label: "Venta perdida", icon: TrendingDown },
    { key: "abc", label: "Clasificación ABC", icon: TrendingUp },
    { key: "abcxyz", label: "ABC-XYZ", icon: Grid2x2 },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setSub(key)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "8px 14px", borderRadius: 8,
              border: `1px solid ${sub === key ? t.nova : t.border}`,
              background: sub === key ? t.nova + "22" : "transparent",
              color: sub === key ? t.nova : t.textMid,
              cursor: "pointer", fontSize: 12.5, fontWeight: 700,
            }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {sub === "heatmap" && <HeatmapView t={t} channelId={channelId} />}
      {sub === "trend" && <TrendView t={t} channelId={channelId} />}
      {sub === "profitability" && <ProfitabilityView t={t} channelId={channelId} />}
      {sub === "pricing" && <PricingView t={t} channelId={channelId} />}
      {sub === "excess" && <ExcessInventoryView t={t} channelId={channelId} />}
      {sub === "aging" && <AgingView t={t} channelId={channelId} />}
      {sub === "service" && <ServiceLevelView t={t} channelId={channelId} />}
      {sub === "distribution" && <DistributionView t={t} channelId={channelId} />}
      {sub === "lost_sales" && <LostSalesView t={t} channelId={channelId} />}
      {sub === "abc" && <ABCView t={t} channelId={channelId} />}
      {sub === "abcxyz" && <AbcXyzView t={t} channelId={channelId} />}
    </div>
  );
}


// ── Gráfica de línea SVG (sin librerías externas) ────────────────────────
function LineChartSVG({ t, series, height = 260, formatY }: {
  t: Tokens;
  series: { name: string; color: string; points: { label: string; value: number }[] }[];
  height?: number;
  formatY?: (n: number) => string;
}) {
  const W = 760, H = height;
  const padL = 56, padR = 16, padT = 16, padB = 42;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series[0]?.points.length ?? 0;
  if (n === 0) return <div style={{ padding: 30, textAlign: "center", color: t.textLo }}>Sin datos para graficar</div>;

  const allVals = series.flatMap(s => s.points.map(p => p.value));
  const maxV = Math.max(1, ...allVals);
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => padT + innerH - (innerH * v) / maxV;

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, k) => (maxV * k) / yTicks);
  const labels = series[0].points.map(p => p.label);
  const labelEvery = Math.ceil(n / 12);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 520, height: H }}>
        {ticks.map((tv, k) => (
          <g key={k}>
            <line x1={padL} y1={y(tv)} x2={W - padR} y2={y(tv)} stroke={t.border} strokeWidth={0.6} opacity={0.5} />
            <text x={padL - 8} y={y(tv) + 3} textAnchor="end" fontSize={9} fill={t.textLo}>
              {formatY ? formatY(tv) : Math.round(tv).toLocaleString("es-MX")}
            </text>
          </g>
        ))}
        {labels.map((lb, i) => (
          (i % labelEvery === 0 || i === n - 1) && (
            <text key={i} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill={t.textLo}>{lb}</text>
          )
        ))}
        {series.map((s, si) => {
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.value)} r={2.6} fill={s.color}>
                  <title>{`${p.label}: ${formatY ? formatY(p.value) : p.value.toLocaleString("es-MX")}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 4 }}>
        {series.map((s, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: t.textMid }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function WoWBadge({ t, pct, label }: { t: Tokens; pct: number | null | undefined; label: string }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: up ? t.good : t.bad }}>
      {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
      {up ? "+" : ""}{pct.toFixed(1)}% <span style={{ color: t.textLo, fontWeight: 500 }}>{label}</span>
    </span>
  );
}

function TrendView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<"week" | "month">("week");
  const [weeksBack, setWeeksBack] = useState(26);
  const [metric, setMetric] = useState<"units" | "revenue" | "net_units">("units");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.trend({
          channel_id: channelId || undefined,
          period_type: periodType, weeks_back: weeksBack,
        });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, periodType, weeksBack]);

  const series = useMemo(() => {
    if (!data) return [];
    if (metric === "revenue") {
      return [
        { name: "Ingreso", color: t.nova, points: data.points.map(p => ({ label: p.label, value: p.revenue })) },
        { name: "Ingreso neto", color: t.good, points: data.points.map(p => ({ label: p.label, value: p.net_revenue })) },
      ];
    }
    if (metric === "net_units") {
      return [
        { name: "Vendidas", color: t.nova, points: data.points.map(p => ({ label: p.label, value: p.units_sold })) },
        { name: "Netas", color: t.good, points: data.points.map(p => ({ label: p.label, value: p.net_units })) },
        { name: "Devueltas", color: t.bad, points: data.points.map(p => ({ label: p.label, value: p.units_returned })) },
      ];
    }
    return [{ name: "Unidades vendidas", color: t.nova, points: data.points.map(p => ({ label: p.label, value: p.units_sold })) }];
  }, [data, metric, t]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FilterField t={t} label="Métrica">
            <select value={metric} onChange={e => setMetric(e.target.value as any)}
              style={{ ...inputStyle(t), minWidth: 150, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="units">Unidades vendidas</option>
              <option value="net_units">Vendidas vs netas vs devueltas</option>
              <option value="revenue">Ingreso vs neto</option>
            </select>
          </FilterField>
          <FilterField t={t} label="Granularidad">
            <select value={periodType} onChange={e => setPeriodType(e.target.value as any)}
              style={{ ...inputStyle(t), minWidth: 110, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="week">Semanal</option>
              <option value="month">Mensual</option>
            </select>
          </FilterField>
          <FilterField t={t} label="Historia">
            <select value={weeksBack} onChange={e => setWeeksBack(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 120, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={13}>13 periodos</option>
              <option value={26}>26 periodos</option>
              <option value={52}>52 periodos</option>
            </select>
          </FilterField>
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.trend({ channel_id: channelId || undefined, period_type: periodType, weeks_back: weeksBack }),
            `retail_tendencia.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && data && data.points.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <LineChart size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Aún no hay suficiente historia</div>
          <div style={{ fontSize: 11 }}>Carga sell-out de varias semanas para ver la tendencia.</div>
        </div>
      )}
      {!loading && data && data.points.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Total unidades</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: t.textHi }}>{num(data.total_units)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Total ingreso</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: t.textHi }}>{mxn(data.total_revenue)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <WoWBadge t={t} pct={data.wow_units_pct} label="unidades vs periodo previo" />
              <WoWBadge t={t} pct={data.wow_revenue_pct} label="ingreso vs periodo previo" />
            </div>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
            <LineChartSVG t={t} series={series}
              formatY={metric === "revenue" ? (n) => "$" + Math.round(n).toLocaleString("es-MX") : undefined} />
          </div>
        </>
      )}
    </div>
  );
}

function DistributionView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<DistributionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(28);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.distribution({ channel_id: channelId || undefined, days });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days]);

  const statusColor = (s: string) =>
    s === "excellent" ? t.good : s === "good" ? t.nova : s === "low" ? t.warn : t.bad;
  const statusLabel = (s: string) =>
    s === "excellent" ? "Excelente" : s === "good" ? "Buena" : s === "low" ? "Baja" : "Crítica";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 620 }}>
          Distribución numérica: en cuántas tiendas se está vendiendo cada SKU vs el total.
          Un <b style={{ color: t.textMid }}>void</b> es una tienda que aún no lo vende — oportunidad de expansión de anaquel.
          {data && <span style={{ color: t.textMid }}> · {data.total_stores} tiendas activas.</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <FilterField t={t} label="Ventana">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 110, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={28}>28 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
          </FilterField>
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.distribution({ channel_id: channelId || undefined, days }),
              `retail_distribucion.xlsx`,
            )}
          />
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          Sin ventas en la ventana para medir distribución.
        </div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "68vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                <th style={thStyle(t)}>SKU</th>
                <th style={thStyle(t)}>Producto</th>
                <th style={{ ...thStyle(t), textAlign: "right" }}>Vende en</th>
                <th style={{ ...thStyle(t), textAlign: "right" }}>Con stock</th>
                <th style={{ ...thStyle(t), minWidth: 160 }}>Distribución</th>
                <th style={{ ...thStyle(t), textAlign: "right" }}>Voids</th>
                <th style={{ ...thStyle(t), textAlign: "right" }}>Unidades</th>
                <th style={{ ...thStyle(t), textAlign: "right" }}>Prom u/tienda</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.variant_id ?? i} style={{ borderTop: `1px solid ${t.border}55` }}>
                  <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                  <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.stores_selling)} / {num(r.total_stores)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.stores_stocking)}</td>
                  <td style={tdStyle(t)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: t.panel3, borderRadius: 4, overflow: "hidden", minWidth: 70 }}>
                        <div style={{ width: `${r.distribution_pct}%`, height: "100%", background: statusColor(r.status) }} />
                      </div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: statusColor(r.status), minWidth: 68 }}>
                        {r.distribution_pct.toFixed(1)}% · {statusLabel(r.status)}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: r.void_stores > 0 ? t.warn : t.textLo }}>{num(r.void_stores)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.total_units)}</td>
                  <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.avg_units_per_store.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LostSalesView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<LostSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.lostSales({ channel_id: channelId || undefined });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const sevColor = (s: string) => s === "urgent" ? t.bad : s === "high" ? t.warn : t.nova;
  const sevLabel = (s: string) => s === "urgent" ? "Urgente" : s === "high" ? "Alta" : "Media";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 640 }}>
          Estimación de venta perdida por productos agotados: productos con on-hand en cero
          pero que traían velocidad de venta. <span style={{ color: t.textMid }}>Pérdida = velocidad semanal × semanas sin stock × precio.</span>
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.lostSales({ channel_id: channelId || undefined }),
            `retail_venta_perdida.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <CheckCircle2 size={28} color={t.good} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin venta perdida detectada</div>
          <div style={{ fontSize: 11 }}>Ningún producto con velocidad está agotado. Bien ahí.</div>
        </div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap", padding: "10px 14px", background: t.bad + "12", border: `1px solid ${t.bad}44`, borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Venta perdida estimada</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.bad }}>{mxn(data.total_lost_revenue)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Unidades no vendidas</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{num(data.total_lost_units)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Combos agotados</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{num(data.affected_combos)}</div>
            </div>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "62vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>Severidad</th>
                  <th style={thStyle(t)}>Tienda</th>
                  <th style={thStyle(t)}>SKU</th>
                  <th style={thStyle(t)}>Producto</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Vel. sem</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Sem. agotado</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>U. perdidas</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Perdido $</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={tdStyle(t)}>
                      <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: sevColor(r.severity) + "22", color: sevColor(r.severity), fontWeight: 700 }}>
                        {sevLabel(r.severity)}
                      </span>
                    </td>
                    <td style={tdStyle(t)}>{r.store_name}</td>
                    <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                    <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.avg_weekly_units.toFixed(1)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.weeks_out_of_stock.toFixed(0)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>{num(r.lost_units)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.bad }}>{mxn(r.lost_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}


function ProfitabilityView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<ProfitGroupBy>("sku");
  const [days, setDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.profitability({ channel_id: channelId || undefined, days, group_by: groupBy });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days, groupBy]);

  const dimHeader = groupBy === "sku" ? "SKU" : groupBy === "category" ? "Categoría"
    : groupBy === "store" ? "Tienda" : "Cadena";
  const marginColor = (p: number) => p >= 35 ? t.good : p >= 20 ? t.nova : p >= 8 ? t.warn : t.bad;
  const gmroiColor = (g: number | null | undefined) =>
    g == null ? t.textLo : g >= 3 ? t.good : g >= 1 ? t.nova : t.bad;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FilterField t={t} label="Agrupar por">
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as ProfitGroupBy)}
              style={{ ...inputStyle(t), minWidth: 130, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="sku">SKU / producto</option>
              <option value="category">Categoría</option>
              <option value="store">Tienda</option>
              <option value="channel">Cadena</option>
            </select>
          </FilterField>
          <FilterField t={t} label="Ventana">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 110, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
              <option value={180}>180 días</option>
              <option value={365}>1 año</option>
            </select>
          </FilterField>
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.profitability({ channel_id: channelId || undefined, days, group_by: groupBy }),
            `retail_rentabilidad_${groupBy}.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando márgenes…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <DollarSign size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin datos de rentabilidad</div>
          <div style={{ fontSize: 11 }}>Carga sell-out con SKUs vinculados al catálogo (necesitan costo).</div>
        </div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 12 }}>
            <ProfTile t={t} label="Margen bruto" value={mxn(data.total_gross_margin)} sub={`${data.total_margin_pct.toFixed(1)}% del ingreso`} color={marginColor(data.total_margin_pct)} />
            <ProfTile t={t} label="GMROI" value={data.total_gmroi != null ? data.total_gmroi.toFixed(2) : "—"} sub="$ margen / $ inventario" color={gmroiColor(data.total_gmroi)} />
            <ProfTile t={t} label="Ingreso" value={mxn(data.total_revenue)} sub={`${num(data.total_units)} unidades`} color={t.textHi} />
            <ProfTile t={t} label="Costo vendido (COGS)" value={mxn(data.total_cogs)} sub={`Inv. a costo ${mxn(data.total_inventory_cost)}`} color={t.textMid} />
          </div>

          {data.variants_without_cost > 0 && (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: t.warn + "18", color: t.warn, fontSize: 12, marginBottom: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <AlertTriangle size={13} />
              {data.variants_without_cost} SKU(s) sin costo en el catálogo — su margen se está subestimando. Captura el costo en Inventario para un cálculo exacto.
            </div>
          )}

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "62vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>{dimHeader}</th>
                  {groupBy === "sku" && <th style={thStyle(t)}>Producto</th>}
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Unidades</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Ingreso</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>COGS</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Margen bruto</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Margen %</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>GMROI</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.dimension_id ?? r.dimension_label ?? i} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={{ ...tdStyle(t), fontFamily: groupBy === "sku" ? "monospace" : "inherit", fontWeight: 600 }}>
                      {r.dimension_label}
                      {r.missing_cost && <span title="SKU sin costo — margen subestimado" style={{ color: t.warn, marginLeft: 6 }}>⚠</span>}
                    </td>
                    {groupBy === "sku" && <td style={tdStyle(t)}>{r.product_name || "—"}</td>}
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.units_sold)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{mxn(r.revenue)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textLo }}>{mxn(r.cogs)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>{mxn(r.gross_margin)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: marginColor(r.margin_pct) }}>{r.margin_pct.toFixed(1)}%</span>
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: gmroiColor(r.gmroi) }}>
                      {r.gmroi != null ? r.gmroi.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            <b>GMROI</b> = margen bruto ÷ inventario a costo. Arriba de 1 significa que cada peso invertido en inventario devuelve más de un peso de margen. Meta sana en retail: ≥ 3.
          </div>
        </>
      )}
    </div>
  );
}

function ProfTile({ t, label, value, sub, color }: {
  t: Tokens; label: string; value: string; sub: string; color: string;
}) {
  return (
    <div style={{ padding: 14, background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: t.textLo, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

const ELASTICITY_LABEL_ES: Record<string, string> = {
  elastic: "Elástico", inelastic: "Inelástico", unit: "Unitario", "n/a": "—",
};

function PricingView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [sel, setSel] = useState<{ id: number; sku: string } | null>(null);
  const [hist, setHist] = useState<PriceHistoryResponse | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.pricing({ channel_id: channelId || undefined, days });
        if (!cancelled) { setData(r); setSel(null); setHist(null); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days]);

  const openHistory = async (variantId: number, sku: string) => {
    setSel({ id: variantId, sku }); setHist(null); setHistLoading(true);
    try {
      const h = await retailApi.priceHistory(variantId, { channel_id: channelId || undefined, days: 180 });
      setHist(h);
    } catch { setHist(null); } finally { setHistLoading(false); }
  };

  const elasColor = (l: string) => l === "elastic" ? t.warn : l === "inelastic" ? t.good : l === "unit" ? t.nova : t.textLo;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 640 }}>
          <b style={{ color: t.textMid }}>Inteligencia de precios</b>: precio implícito (ingreso ÷ unidades),
          su volatilidad y la <b>elasticidad</b> precio-demanda. Haz clic en un SKU para ver su historial.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <FilterField t={t} label="Ventana">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 110, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={90}>90 días</option>
              <option value={180}>180 días</option>
              <option value={365}>1 año</option>
            </select>
          </FilterField>
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.pricing({ channel_id: channelId || undefined, days }),
              `retail_precios.xlsx`,
            )}
          />
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Tag size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin ventas para analizar precios</div>
        </div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <>
          {sel && (
            <div style={{ background: t.panel, border: `1px solid ${t.nova}55`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>
                  Historial de {sel.sku} {hist?.product_name ? `· ${hist.product_name}` : ""}
                </div>
                <button onClick={() => { setSel(null); setHist(null); }} style={iconBtn(t)}><X size={14} /></button>
              </div>
              {histLoading && <div style={{ padding: 20, textAlign: "center", color: t.textLo }}>Cargando…</div>}
              {!histLoading && hist && hist.points.length > 0 && (
                <>
                  <div style={{ display: "flex", gap: 20, marginBottom: 8, flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ color: t.textMid }}>Precio prom <b style={{ color: t.textHi }}>{mxn(hist.avg_price)}</b></span>
                    {hist.list_price != null && <span style={{ color: t.textMid }}>Precio lista <b style={{ color: t.textHi }}>{mxn(hist.list_price)}</b></span>}
                    <span style={{ color: t.textMid }}>Elasticidad <b style={{ color: elasColor(hist.elasticity_label) }}>{hist.elasticity != null ? hist.elasticity.toFixed(2) : "—"} ({ELASTICITY_LABEL_ES[hist.elasticity_label]})</b></span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>Precio por semana</div>
                      <LineChartSVG t={t} height={190}
                        series={[{ name: "Precio", color: t.nova, points: hist.points.map(p => ({ label: p.label, value: p.avg_price })) }]}
                        formatY={(n) => "$" + Math.round(n).toLocaleString("es-MX")} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: t.textLo, marginBottom: 4 }}>Demanda (unidades) por semana</div>
                      <LineChartSVG t={t} height={190}
                        series={[{ name: "Unidades", color: t.good, points: hist.points.map(p => ({ label: p.label, value: p.units })) }]} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
                    {hist.elasticity_label === "elastic" && "Demanda sensible al precio: una baja de precio dispara las ventas — buen candidato a promociones."}
                    {hist.elasticity_label === "inelastic" && "Demanda poco sensible al precio: puedes sostener o subir el precio sin perder mucho volumen."}
                    {hist.elasticity_label === "unit" && "Elasticidad cercana a 1: el ingreso se mantiene aunque cambie el precio."}
                    {hist.elasticity_label === "n/a" && "Sin suficiente variación de precio para estimar la elasticidad."}
                  </div>
                </>
              )}
              {!histLoading && (!hist || hist.points.length === 0) && (
                <div style={{ padding: 12, color: t.textLo, fontSize: 12 }}>Sin historial suficiente para este SKU.</div>
              )}
            </div>
          )}

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: sel ? "40vh" : "62vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>SKU</th>
                  <th style={thStyle(t)}>Producto</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Unidades</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Precio prom</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Rango</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Volatilidad</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Δ Precio</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Elasticidad</th>
                  <th style={thStyle(t)}></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.variant_id ?? i}
                    onClick={() => r.variant_id && openHistory(r.variant_id, r.sku || "")}
                    style={{ borderTop: `1px solid ${t.border}55`, cursor: r.variant_id ? "pointer" : "default", background: sel?.id === r.variant_id ? t.nova + "12" : undefined }}>
                    <td style={{ ...tdStyle(t), fontFamily: "monospace", fontWeight: 600 }}>{r.sku || "—"}</td>
                    <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.units_sold)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600 }}>{mxn(r.avg_price)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textLo }}>{mxn(r.min_price)}–{mxn(r.max_price)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: r.price_volatility_pct > 10 ? t.warn : t.textMid }}>{r.price_volatility_pct.toFixed(1)}%</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: r.price_change_pct < 0 ? t.bad : r.price_change_pct > 0 ? t.good : t.textLo }}>
                      {r.price_change_pct > 0 ? "+" : ""}{r.price_change_pct.toFixed(1)}%
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: elasColor(r.elasticity_label) }}>
                        {r.elasticity != null ? r.elasticity.toFixed(2) : "—"}
                      </span>
                      <span style={{ fontSize: 10, color: t.textLo, marginLeft: 4 }}>{ELASTICITY_LABEL_ES[r.elasticity_label]}</span>
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textLo }}>
                      {r.variant_id ? <LineChart size={13} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            <b>Elasticidad</b>: cuánto cambia la demanda ante un cambio de precio. <b>Elástico</b> (|E|{">"}1) = sensible al precio (bueno para promos); <b>Inelástico</b> (|E|{"<"}1) = puedes sostener precio. El precio es el implícito del sell-out, no captura manual.
          </div>
        </>
      )}
    </div>
  );
}

function ExcessInventoryView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ExcessInventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.excessInventory({ channel_id: channelId || undefined });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const sevColor = (s: string) => s === "urgent" ? t.bad : s === "high" ? t.warn : t.nova;
  const sevLabel = (s: string) => s === "urgent" ? "Urgente" : s === "high" ? "Alta" : "Media";
  const turnColor = (tv: number | null | undefined) =>
    tv == null ? t.textLo : tv >= 6 ? t.good : tv >= 3 ? t.nova : t.warn;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 640 }}>
          Dónde tienes <b style={{ color: t.textMid }}>dinero detenido</b>: stock por encima del umbral sano de la cadena
          y productos sin movimiento (dead stock). Incluye rotación anual y días de inventario.
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.excessInventory({ channel_id: channelId || undefined }),
            `retail_exceso_inventario.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando…</div>}
      {!loading && data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10, marginBottom: 12 }}>
            <ProfTile t={t} label="Dinero en exceso" value={mxn(data.total_excess_cost)} sub={`${num(data.total_excess_units)} unidades de más`} color={data.total_excess_cost > 0 ? t.bad : t.good} />
            <ProfTile t={t} label="Dead stock" value={mxn(data.dead_stock_cost)} sub="Sin ventas, con stock" color={data.dead_stock_cost > 0 ? t.warn : t.good} />
            <ProfTile t={t} label="Rotación" value={data.inventory_turnover != null ? `${data.inventory_turnover.toFixed(1)}x` : "—"} sub="veces al año" color={turnColor(data.inventory_turnover)} />
            <ProfTile t={t} label="Días de inventario" value={data.days_of_inventory != null ? `${data.days_of_inventory.toFixed(0)} d` : "—"} sub="cobertura promedio (DOH)" color={t.textHi} />
            <ProfTile t={t} label="Inventario a costo" value={mxn(data.total_inventory_cost)} sub={`${num(data.total_inventory_units)} unidades`} color={t.textMid} />
          </div>

          {data.rows.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
              <CheckCircle2 size={28} color={t.good} />
              <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin exceso de inventario</div>
              <div style={{ fontSize: 11 }}>Tu inventario está dentro del umbral sano. Excelente rotación.</div>
            </div>
          ) : (
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "58vh" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                    <th style={thStyle(t)}>Severidad</th>
                    <th style={thStyle(t)}>Tienda</th>
                    <th style={thStyle(t)}>SKU</th>
                    <th style={thStyle(t)}>Producto</th>
                    <th style={{ ...thStyle(t), textAlign: "right" }}>On-hand</th>
                    <th style={{ ...thStyle(t), textAlign: "right" }}>WOS</th>
                    <th style={{ ...thStyle(t), textAlign: "right" }}>DOH</th>
                    <th style={{ ...thStyle(t), textAlign: "right" }}>Exceso u.</th>
                    <th style={{ ...thStyle(t), textAlign: "right" }}>Detenido $</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                      <td style={tdStyle(t)}>
                        <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: sevColor(r.severity) + "22", color: sevColor(r.severity), fontWeight: 700 }}>
                          {r.is_dead_stock ? "Dead stock" : sevLabel(r.severity)}
                        </span>
                      </td>
                      <td style={tdStyle(t)}>{r.store_name}</td>
                      <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                      <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.on_hand)}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.wos_weeks != null ? r.wos_weeks.toFixed(1) : "∞"}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.doh_days != null ? `${r.doh_days.toFixed(0)}d` : "∞"}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600 }}>{num(r.excess_units)}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.bad }}>{mxn(r.excess_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            <b>Rotación</b> alta = inventario que se mueve rápido (bueno). <b>DOH</b> = días que dura el inventario al ritmo de venta actual.
            El exceso se mide contra el umbral de sobreinventario de cada cadena.
          </div>
        </>
      )}
    </div>
  );
}

const AGING_COLORS: Record<string, (t: Tokens) => string> = {
  "0-30": (t) => t.good,
  "31-60": (t) => t.nova,
  "61-90": (t) => t.warn,
  "90+": (t) => t.bad,
  "never": (t) => t.bad,
};

function AgingView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.aging({ channel_id: channelId || undefined });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const bucketColor = (b: string) => (AGING_COLORS[b] || ((tt: Tokens) => tt.textLo))(t);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 640 }}>
          <b style={{ color: t.textMid }}>Antigüedad del inventario</b>: cuántos días lleva cada producto sin venderse.
          Los de 90+ días y los que nunca han vendido son <b style={{ color: t.bad }}>riesgo de obsolescencia</b>.
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.aging({ channel_id: channelId || undefined }),
            `retail_antiguedad_inventario.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando…</div>}
      {!loading && data && data.total_stock_units === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Clock size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin inventario para analizar</div>
        </div>
      )}
      {!loading && data && data.total_stock_units > 0 && (
        <>
          {/* Barra de distribución por antigüedad */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 12, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.4 }}>Distribución del inventario por antigüedad</div>
              <div style={{ fontSize: 12, color: t.textMid }}>
                Total a costo <b style={{ color: t.textHi }}>{mxn(data.total_stock_value)}</b> ·
                En riesgo <b style={{ color: t.bad }}>{mxn(data.obsolete_value)} ({data.obsolete_pct.toFixed(1)}%)</b>
              </div>
            </div>
            <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", background: t.panel3 }}>
              {data.buckets.filter(b => b.value > 0).map(b => (
                <div key={b.bucket} title={`${b.label}: ${mxn(b.value)} (${b.pct_of_value.toFixed(1)}%)`}
                  style={{ width: `${b.pct_of_value}%`, background: bucketColor(b.bucket), minWidth: b.pct_of_value > 0 ? 2 : 0 }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
              {data.buckets.map(b => (
                <div key={b.bucket} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: bucketColor(b.bucket) }} />
                  <span style={{ color: t.textMid }}>{b.label}</span>
                  <span style={{ color: t.textHi, fontWeight: 700 }}>{mxn(b.value)}</span>
                  <span style={{ color: t.textLo }}>({num(b.units)} u)</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "56vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>Antigüedad</th>
                  <th style={thStyle(t)}>Tienda</th>
                  <th style={thStyle(t)}>SKU</th>
                  <th style={thStyle(t)}>Producto</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>On-hand</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Días sin vender</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Valor a costo</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const bl = data.buckets.find(b => b.bucket === r.bucket)?.label || r.bucket;
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${t.border}55` }}>
                      <td style={tdStyle(t)}>
                        <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: bucketColor(r.bucket) + "22", color: bucketColor(r.bucket), fontWeight: 700 }}>
                          {bl}
                        </span>
                      </td>
                      <td style={tdStyle(t)}>{r.store_name}</td>
                      <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                      <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.on_hand)}</td>
                      <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600, color: r.obsolescence_risk ? t.bad : t.textMid }}>
                        {r.days_since_last_sale != null ? `${r.days_since_last_sale} d` : "Nunca"}
                      </td>
                      <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: t.textHi }}>{mxn(r.stock_value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            La antigüedad se estima por días desde la última venta del producto en esa tienda (el sell-out no trae fecha de lote).
          </div>
        </>
      )}
    </div>
  );
}

function ServiceLevelView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<ServiceLevelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<ServiceGroupBy>("store");
  const [weeks, setWeeks] = useState(12);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.serviceLevel({ channel_id: channelId || undefined, weeks_back: weeks, group_by: groupBy });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, weeks, groupBy]);

  const dimHeader = groupBy === "store" ? "Tienda" : groupBy === "sku" ? "SKU" : "Cadena";
  const sColor = (s: string) => s === "excellent" ? t.good : s === "good" ? t.nova : s === "low" ? t.warn : t.bad;
  const sLabel = (s: string) => s === "excellent" ? "Excelente" : s === "good" ? "Bueno" : s === "low" ? "Bajo" : "Crítico";
  const rateColor = (p: number) => p >= 98 ? t.good : p >= 95 ? t.nova : p >= 90 ? t.warn : t.bad;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FilterField t={t} label="Agrupar por">
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as ServiceGroupBy)}
              style={{ ...inputStyle(t), minWidth: 120, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="store">Tienda</option>
              <option value="sku">SKU</option>
              <option value="channel">Cadena</option>
            </select>
          </FilterField>
          <FilterField t={t} label="Ventana">
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 120, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={8}>8 semanas</option>
              <option value={12}>12 semanas</option>
              <option value={26}>26 semanas</option>
            </select>
          </FilterField>
        </div>
        <ExcelBtn t={t} label="Excel"
          onClick={() => downloadBlob(
            () => retailApi.reports.serviceLevel({ channel_id: channelId || undefined, weeks_back: weeks, group_by: groupBy }),
            `retail_nivel_servicio_${groupBy}.xlsx`,
          )}
        />
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando…</div>}
      {!loading && data && data.combos_evaluated === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Gauge size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin datos suficientes</div>
          <div style={{ fontSize: 11 }}>Carga varias semanas de sell-out para medir el nivel de servicio.</div>
        </div>
      )}
      {!loading && data && data.combos_evaluated > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
            <ProfTile t={t} label="In-stock (OSA)" value={`${data.overall_in_stock_rate_pct.toFixed(1)}%`} sub="disponibilidad en anaquel" color={rateColor(data.overall_in_stock_rate_pct)} />
            <ProfTile t={t} label="Fill rate" value={`${data.overall_fill_rate_pct.toFixed(1)}%`} sub="demanda satisfecha (est.)" color={rateColor(data.overall_fill_rate_pct)} />
            <ProfTile t={t} label="Tasa de quiebre" value={`${data.overall_stockout_rate_pct.toFixed(1)}%`} sub="observaciones en cero" color={data.overall_stockout_rate_pct > 5 ? t.bad : t.good} />
            <ProfTile t={t} label="Unidades perdidas" value={num(data.total_estimated_lost)} sub={`de ${num(data.total_units_sold)} vendidas`} color={t.textMid} />
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "58vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>{dimHeader}</th>
                  {groupBy === "sku" && <th style={thStyle(t)}>Producto</th>}
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Obs.</th>
                  <th style={{ ...thStyle(t), minWidth: 150 }}>In-stock (OSA)</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Vendidas</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Perdidas est.</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Fill rate</th>
                  <th style={{ ...thStyle(t), textAlign: "center" }}>Nivel</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.dimension_id ?? i} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={{ ...tdStyle(t), fontFamily: groupBy === "sku" ? "monospace" : "inherit", fontWeight: 600 }}>{r.dimension_label}</td>
                    {groupBy === "sku" && <td style={tdStyle(t)}>{r.product_name || "—"}</td>}
                    <td style={{ ...tdStyle(t), textAlign: "right", color: t.textLo }}>{num(r.total_periods)}</td>
                    <td style={tdStyle(t)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 7, background: t.panel3, borderRadius: 4, overflow: "hidden", minWidth: 60 }}>
                          <div style={{ width: `${r.in_stock_rate_pct}%`, height: "100%", background: rateColor(r.in_stock_rate_pct) }} />
                        </div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: rateColor(r.in_stock_rate_pct), minWidth: 42 }}>{r.in_stock_rate_pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{num(r.units_sold)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: r.estimated_lost_units > 0 ? t.bad : t.textLo }}>{num(r.estimated_lost_units)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 700, color: rateColor(r.fill_rate_pct) }}>{r.fill_rate_pct.toFixed(1)}%</td>
                    <td style={{ ...tdStyle(t), textAlign: "center" }}>
                      <span style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 10, background: sColor(r.status) + "22", color: sColor(r.status), fontWeight: 700 }}>
                        {sLabel(r.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            <b>In-stock (OSA)</b> = % de cortes con stock disponible. <b>Fill rate</b> = ventas ÷ (ventas + perdidas estimadas por quiebre).
            Benchmark de retail: OSA ≥ 95%. Sólo se evalúan combos con venta (surtido activo).
          </div>
        </>
      )}
    </div>
  );
}

function AbcXyzView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  const [data, setData] = useState<AbcXyzResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [selCell, setSelCell] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.abcXyz({ channel_id: channelId || undefined, days });
        if (!cancelled) { setData(r); setSelCell(null); }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, days]);

  const abcColor = (a: string) => a === "A" ? t.good : a === "B" ? t.nova : t.textLo;
  const cellByKey = (k: string) => data?.matrix.find(c => c.combined === k);
  const visibleRows = data ? (selCell ? data.rows.filter(r => r.combined_class === selCell) : data.rows) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textLo, maxWidth: 640 }}>
          <b style={{ color: t.textMid }}>ABC-XYZ</b>: cruza el valor (ABC por facturación) con la
          previsibilidad de la demanda (XYZ por variabilidad). Cada celda sugiere una estrategia de reabasto.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <FilterField t={t} label="Ventana">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ ...inputStyle(t), minWidth: 110, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value={90}>90 días</option>
              <option value={180}>180 días</option>
              <option value={365}>1 año</option>
            </select>
          </FilterField>
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.abcXyz({ channel_id: channelId || undefined, days }),
              `retail_abc_xyz.xlsx`,
            )}
          />
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Calculando…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Grid2x2 size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>Sin ventas para segmentar</div>
        </div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <>
          {/* Matriz 3×3 clickeable */}
          <div style={{ overflowX: "auto", marginBottom: 14 }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
              <thead>
                <tr>
                  <th></th>
                  {[["X", "Estable"], ["Y", "Variable"], ["Z", "Errático"]].map(([x, lbl]) => (
                    <th key={x} style={{ fontSize: 11, color: t.textLo, fontWeight: 700, padding: "2px 8px", textAlign: "center", minWidth: 150 }}>
                      {x} · {lbl}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["A", "B", "C"] as const).map(a => (
                  <tr key={a}>
                    <th style={{ fontSize: 12, fontWeight: 800, color: abcColor(a), padding: "2px 8px", textAlign: "right" }}>
                      Clase {a}
                    </th>
                    {(["X", "Y", "Z"] as const).map(x => {
                      const key = a + x;
                      const c = cellByKey(key);
                      const active = selCell === key;
                      const count = c?.count ?? 0;
                      return (
                        <td key={x}>
                          <button onClick={() => setSelCell(active ? null : (count > 0 ? key : null))}
                            disabled={count === 0}
                            style={{
                              width: "100%", minWidth: 150, textAlign: "left", cursor: count > 0 ? "pointer" : "default",
                              background: active ? abcColor(a) + "33" : count > 0 ? t.panel : t.panel2,
                              border: `1px solid ${active ? abcColor(a) : t.border}`,
                              borderRadius: 8, padding: "10px 12px",
                              opacity: count === 0 ? 0.5 : 1,
                            }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: abcColor(a) }}>{key}</div>
                            <div style={{ fontSize: 12, color: t.textHi, marginTop: 2 }}>{num(count)} SKUs</div>
                            <div style={{ fontSize: 11, color: t.textLo }}>{(c?.revenue_pct ?? 0).toFixed(1)}% ingreso</div>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: t.textMid }}>
              {selCell
                ? <>Mostrando <b style={{ color: abcColor(selCell[0]) }}>{selCell}</b> · {visibleRows.length} SKUs · <button onClick={() => setSelCell(null)} style={{ background: "none", border: "none", color: t.nova, cursor: "pointer", fontSize: 12 }}>ver todos</button></>
                : <>{data.rows.length} SKUs · {data.weeks} semanas de historia</>}
            </div>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, overflow: "auto", maxHeight: "52vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: t.panel2, position: "sticky", top: 0 }}>
                  <th style={thStyle(t)}>Clase</th>
                  <th style={thStyle(t)}>SKU</th>
                  <th style={thStyle(t)}>Producto</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Ingreso</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>Prom sem</th>
                  <th style={{ ...thStyle(t), textAlign: "right" }}>CV</th>
                  <th style={thStyle(t)}>Estrategia</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, i) => (
                  <tr key={r.variant_id ?? i} style={{ borderTop: `1px solid ${t.border}55` }}>
                    <td style={tdStyle(t)}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: abcColor(r.abc_class) + "22", color: abcColor(r.abc_class), fontWeight: 800 }}>
                        {r.combined_class}
                      </span>
                    </td>
                    <td style={{ ...tdStyle(t), fontFamily: "monospace" }}>{r.sku || "—"}</td>
                    <td style={tdStyle(t)}>{r.product_name || "—"}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", fontWeight: 600 }}>{mxn(r.total_revenue)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right" }}>{r.avg_weekly_units.toFixed(1)}</td>
                    <td style={{ ...tdStyle(t), textAlign: "right", color: r.xyz_class === "Z" ? t.bad : r.xyz_class === "Y" ? t.warn : t.good }}>
                      {r.cv != null ? r.cv.toFixed(2) : "∞"}
                    </td>
                    <td style={{ ...tdStyle(t), fontSize: 11.5, color: t.textLo }}>{r.strategy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: t.textLo, marginTop: 8 }}>
            <b>ABC</b>: A = top 80% de facturación, B = siguiente 15%, C = último 5%. <b>XYZ</b> (coef. de variación): X ≤ 0.5 estable, Y ≤ 1.0 variable, Z {">"} 1.0 errático. Los <b>AX</b> son tu núcleo (automatiza); los <b>CZ</b>, candidatos a descontinuar.
          </div>
        </>
      )}
    </div>
  );
}


function HeatmapView({ t, channelId }: { t: Tokens; channelId: number | null }) {
  // Estado principal
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [filters, setFilters] = useState<HeatmapFilters | null>(null);
  const [metric, setMetric] = useState<HeatmapMetric>("wos");
  const [loading, setLoading] = useState(true);

  // Filtros
  const [storeSearch, setStoreSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [region, setRegion] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [storeFormat, setStoreFormat] = useState<string>("");
  const [sortStores, setSortStores] = useState<HeatmapSortStores>("worst_wos");
  const [limitVariants, setLimitVariants] = useState(30);
  const [storeOffset, setStoreOffset] = useState(0);
  const [storeLimit, setStoreLimit] = useState(50);

  // Densidad visual: compacto (para escanear muchas tiendas) o normal
  const [density, setDensity] = useState<"compact" | "normal">("normal");
  // Índice de SKUs (columna → producto) desplegable
  const [showSkuIndex, setShowSkuIndex] = useState(false);
  // Salto directo a página de tiendas
  const [pageInput, setPageInput] = useState("");

  // Debounce del search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(storeSearch), 250);
    return () => clearTimeout(t);
  }, [storeSearch]);

  // Reset offset cuando cambian filtros
  useEffect(() => { setStoreOffset(0); }, [
    channelId, debouncedSearch, region, state, storeFormat, sortStores, storeLimit,
  ]);

  // Cargar facetas al cambiar cadena
  useEffect(() => {
    retailApi.heatmapFilters(channelId || undefined).then(setFilters).catch(() => setFilters(null));
  }, [channelId]);

  // Cargar heatmap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await retailApi.heatmap({
          channel_id: channelId || undefined,
          metric, limit_variants: limitVariants,
          store_search: debouncedSearch || undefined,
          region: region || undefined,
          state: state || undefined,
          store_format: storeFormat || undefined,
          store_offset: storeOffset, store_limit: storeLimit,
          sort_stores_by: sortStores,
        });
        if (!cancelled) setData(r);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [channelId, metric, limitVariants, debouncedSearch, region, state,
        storeFormat, sortStores, storeOffset, storeLimit]);

  const cellMap = new Map<string, HeatmapResponse["cells"][number]>();
  data?.cells.forEach(c => cellMap.set(`${c.store_id}:${c.variant_id}`, c));

  // Color base por status (tinte translúcido, no saturado — menos invasivo)
  const statusColor = (status?: string) => {
    if (status === "critical") return t.bad;
    if (status === "replenish") return t.warn;
    if (status === "overstock") return t.nova;
    if (status === "healthy") return t.good;
    return null;
  };
  const cellStyle = (c?: HeatmapResponse["cells"][number]) => {
    const col = statusColor(c?.status);
    if (!c || c.status === "no_data" || !col) {
      return { bg: "transparent", fg: t.textLo, bd: `${t.border}22` };
    }
    // Tinte suave de fondo + texto en el color saturado (alto contraste,
    // pero sin el "muro de color" del fondo sólido).
    return { bg: col + "24", fg: col, bd: col + "3a" };
  };

  const fmt = (c?: HeatmapResponse["cells"][number]) => {
    if (!c) return "";
    if (metric === "units_sold") return num(c.units_sold);
    if (metric === "on_hand") return num(c.on_hand);
    return c.value != null ? `${c.value.toFixed(1)}` : "∞";
  };

  const compact = density === "compact";
  const cellW = compact ? 40 : 54;
  const cellH = compact ? 26 : 34;
  const nameW = compact ? 170 : 220;
  const fontSize = compact ? 9 : 10.5;
  const headerH = compact ? 104 : 132;

  const totalStores = data?.total_stores ?? 0;
  const totalVariants = data?.total_variants ?? 0;
  const shownStart = totalStores === 0 ? 0 : storeOffset + 1;
  const shownEnd = Math.min(storeOffset + storeLimit, totalStores);
  const canPrev = storeOffset > 0;
  const canNext = storeOffset + storeLimit < totalStores;
  const totalPages = Math.max(1, Math.ceil(totalStores / storeLimit));
  const currentPage = Math.floor(storeOffset / storeLimit) + 1;
  const jumpToPage = () => {
    const p = parseInt(pageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages) {
      setStoreOffset((p - 1) * storeLimit);
      setPageInput("");
    }
  };

  return (
    <div>
      {/* Barra de controles */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <FilterPill t={t} label="WOS" active={metric === "wos"} onClick={() => setMetric("wos")} />
          <FilterPill t={t} label="Vendidas" active={metric === "units_sold"} onClick={() => setMetric("units_sold")} />
          <FilterPill t={t} label="Stock" active={metric === "on_hand"} onClick={() => setMetric("on_hand")} />
          <div style={{ width: 8 }} />
          <ExcelBtn t={t} label="Excel (vista)"
            onClick={() => downloadBlob(
              () => retailApi.reports.heatmap({
                channel_id: channelId || undefined, metric, limit_variants: limitVariants,
                region: region || undefined, state: state || undefined,
                store_format: storeFormat || undefined, store_search: debouncedSearch || undefined,
                sort_stores_by: sortStores,
              }),
              `retail_heatmap_${metric}.xlsx`,
            )}
          />
          <ExcelBtn t={t} label="Excel completo"
            onClick={() => downloadBlob(
              () => retailApi.reports.heatmap({
                channel_id: channelId || undefined, metric, limit_variants: limitVariants,
                full: true,
                region: region || undefined, state: state || undefined,
                store_format: storeFormat || undefined, store_search: debouncedSearch || undefined,
                sort_stores_by: sortStores,
              }),
              `retail_heatmap_${metric}_completo.xlsx`,
            )}
          />
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 10.5, color: t.textLo, alignItems: "center", flexWrap: "wrap" }}>
          <LegendDot t={t} color={t.bad} label="Crítico" />
          <LegendDot t={t} color={t.warn} label="Resurtir" />
          <LegendDot t={t} color={t.good} label="Sano" />
          <LegendDot t={t} color={t.nova} label="Sobreinventario" />
          <LegendDot t={t} color={t.panel3} label="Sin datos" />
        </div>
      </div>

      {/* Filtros avanzados — cada control con su etiqueta visible */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", padding: "12px 12px 14px", marginBottom: 10, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8 }}>
        <FilterField t={t} label="Buscar tienda" style={{ flex: 1, minWidth: 200 }}>
          <div style={{ position: "relative" }}>
            <Search size={12} color={t.textLo} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
            <input value={storeSearch} onChange={e => setStoreSearch(e.target.value)}
              placeholder="Nombre, código o ciudad…"
              style={{ ...inputStyle(t), paddingLeft: 30, marginTop: 0, fontSize: 12, height: 32, width: "100%" }} />
          </div>
        </FilterField>
        {filters && filters.regions.length > 0 && (
          <FilterField t={t} label="Región">
            <select value={region} onChange={e => setRegion(e.target.value)}
              style={{ ...inputStyle(t), minWidth: 130, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="">Todas</option>
              {filters.regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FilterField>
        )}
        {filters && filters.states.length > 0 && (
          <FilterField t={t} label="Estado">
            <select value={state} onChange={e => setState(e.target.value)}
              style={{ ...inputStyle(t), minWidth: 130, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="">Todos</option>
              {filters.states.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FilterField>
        )}
        {filters && filters.formats.length > 0 && (
          <FilterField t={t} label="Formato">
            <select value={storeFormat} onChange={e => setStoreFormat(e.target.value)}
              style={{ ...inputStyle(t), minWidth: 130, fontSize: 12, height: 32, marginTop: 0 }}>
              <option value="">Todos</option>
              {filters.formats.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </FilterField>
        )}
        <FilterField t={t} label="Ordenar tiendas por">
          <select value={sortStores} onChange={e => setSortStores(e.target.value as HeatmapSortStores)}
            style={{ ...inputStyle(t), minWidth: 155, fontSize: 12, height: 32, marginTop: 0 }}>
            <option value="worst_wos">Peor WOS primero</option>
            <option value="best_wos">Mejor WOS primero</option>
            <option value="most_sales">Más ventas</option>
            <option value="name">Nombre A-Z</option>
          </select>
        </FilterField>
        <FilterField t={t} label="SKUs visibles">
          <select value={limitVariants} onChange={e => setLimitVariants(Number(e.target.value))}
            style={{ ...inputStyle(t), minWidth: 115, fontSize: 12, height: 32, marginTop: 0 }}>
            <option value={20}>Top 20</option>
            <option value={30}>Top 30</option>
            <option value={40}>Top 40</option>
            <option value={60}>Top 60</option>
            <option value={100}>Top 100</option>
          </select>
        </FilterField>
        <FilterField t={t} label="Densidad">
          <select value={density} onChange={e => setDensity(e.target.value as any)}
            style={{ ...inputStyle(t), minWidth: 105, fontSize: 12, height: 32, marginTop: 0 }}>
            <option value="normal">Normal</option>
            <option value="compact">Compacto</option>
          </select>
        </FilterField>
        {(region || state || storeFormat || storeSearch) && (
          <button onClick={() => { setRegion(""); setState(""); setStoreFormat(""); setStoreSearch(""); }}
            style={{ padding: "7px 12px", background: "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: t.textLo, fontSize: 11, cursor: "pointer", height: 32 }}>
            Limpiar
          </button>
        )}
      </div>

      {/* Barra info + paginador */}
      {data && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8, fontSize: 12, color: t.textLo }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              {totalStores === 0 ? "Sin tiendas en el filtro"
                : `Mostrando ${shownStart.toLocaleString("es-MX")}-${shownEnd.toLocaleString("es-MX")} de ${totalStores.toLocaleString("es-MX")} tiendas × ${data.variants.length} de ${totalVariants.toLocaleString("es-MX")} SKUs`}
            </span>
            {data.variants.length > 0 && (
              <button onClick={() => setShowSkuIndex(v => !v)}
                style={{ padding: "3px 10px", background: showSkuIndex ? t.nova : t.panel3, border: `1px solid ${t.border}`, borderRadius: 6, color: showSkuIndex ? "#fff" : t.textMid, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                {showSkuIndex ? "Ocultar índice de SKUs" : "Ver índice de SKUs"}
              </button>
            )}
          </div>
          {totalStores > storeLimit && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button disabled={!canPrev}
                onClick={() => setStoreOffset(Math.max(0, storeOffset - storeLimit))}
                style={{ padding: "4px 10px", background: canPrev ? t.panel3 : "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: canPrev ? t.textMid : t.textLo, cursor: canPrev ? "pointer" : "not-allowed", fontSize: 11 }}>
                ← Anterior
              </button>
              <span style={{ fontSize: 11, color: t.textMid, whiteSpace: "nowrap" }}>
                Pág {currentPage.toLocaleString("es-MX")} / {totalPages.toLocaleString("es-MX")}
              </span>
              <button disabled={!canNext}
                onClick={() => setStoreOffset(storeOffset + storeLimit)}
                style={{ padding: "4px 10px", background: canNext ? t.panel3 : "transparent", border: `1px solid ${t.border}`, borderRadius: 6, color: canNext ? t.textMid : t.textLo, cursor: canNext ? "pointer" : "not-allowed", fontSize: 11 }}>
                Siguiente →
              </button>
              {totalPages > 2 && (
                <form onSubmit={e => { e.preventDefault(); jumpToPage(); }} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input value={pageInput} onChange={e => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="Ir a…" title="Ir a la página"
                    style={{ ...inputStyle(t), width: 62, fontSize: 11, height: 26, marginTop: 0, textAlign: "center" }} />
                  <button type="submit"
                    style={{ padding: "4px 8px", background: t.panel3, border: `1px solid ${t.border}`, borderRadius: 6, color: t.textMid, cursor: "pointer", fontSize: 11 }}>
                    Ir
                  </button>
                </form>
              )}
              <select value={storeLimit} onChange={e => setStoreLimit(Number(e.target.value))}
                style={{ ...inputStyle(t), width: "auto", fontSize: 11, height: 26, marginTop: 0 }}>
                <option value={30}>30/pág</option>
                <option value={50}>50/pág</option>
                <option value={100}>100/pág</option>
                <option value={200}>200/pág</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Índice de SKUs: mapea la columna a producto legible */}
      {data && showSkuIndex && data.variants.length > 0 && (
        <div style={{ marginBottom: 10, padding: 12, background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>
            Índice de columnas · {data.variants.length} SKUs (top por ventas)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 }}>
            {data.variants.map((v, i) => (
              <div key={v.id} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11.5, padding: "2px 0" }}>
                <span style={{ minWidth: 26, color: t.nova, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>#{i + 1}</span>
                <span style={{ fontFamily: "monospace", color: t.textHi, fontWeight: 600 }}>{v.sku || "—"}</span>
                <span style={{ color: t.textLo, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.product_name || ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div style={{ padding: 40, textAlign: "center", color: t.textLo }}>Cargando…</div>}
      {!loading && data && (data.stores.length === 0 || data.variants.length === 0) && (
        <div style={{ padding: 30, textAlign: "center", background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10, color: t.textLo }}>
          <Grid3x3 size={28} />
          <div style={{ marginTop: 8, color: t.textHi, fontSize: 13 }}>
            {totalStores === 0 ? "Ninguna tienda coincide con los filtros" : "Sin ventas registradas para dibujar el heatmap"}
          </div>
          <div style={{ fontSize: 11 }}>Ajusta los filtros o registra sell-out para verlo.</div>
        </div>
      )}
      {!loading && data && data.stores.length > 0 && data.variants.length > 0 && (
        <div style={{
          background: t.panel, border: `1px solid ${t.border}`, borderRadius: 10,
          overflow: "auto", maxHeight: "70vh", position: "relative",
        }}>
          <table style={{
            borderCollapse: "separate", borderSpacing: 0,
            minWidth: nameW + data.variants.length * (cellW + 2),
            fontSize,
          }}>
            <thead>
              <tr>
                <th style={{
                  position: "sticky", top: 0, left: 0, zIndex: 3,
                  background: t.panel2, color: t.textLo,
                  padding: "6px 10px", textAlign: "left",
                  fontWeight: 700, fontSize: fontSize + 0.5,
                  borderRight: `1px solid ${t.border}`,
                  borderBottom: `1px solid ${t.border}`,
                  minWidth: nameW, width: nameW,
                  height: headerH, verticalAlign: "bottom",
                }}>Tienda</th>
                {data.variants.map((v, i) => (
                  <th key={v.id}
                    title={`#${i + 1} · ${v.sku || ""} · ${v.product_name || ""}`}
                    style={{
                      position: "sticky", top: 0, zIndex: 2,
                      background: t.panel2, color: t.textLo,
                      padding: "8px 0 6px", textAlign: "center",
                      fontWeight: 700,
                      borderBottom: `1px solid ${t.border}`,
                      borderLeft: `1px solid ${t.border}33`,
                      minWidth: cellW, width: cellW,
                      height: headerH, verticalAlign: "bottom", whiteSpace: "nowrap",
                    }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end" }}>
                      <div style={{
                        writingMode: "vertical-rl", transform: "rotate(180deg)",
                        fontFamily: "monospace", fontSize: compact ? 9 : 10,
                        color: t.textHi, letterSpacing: 0.3,
                        maxHeight: headerH - 26, overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {v.sku || v.product_name || "—"}
                      </div>
                      <span style={{ fontSize: 9, color: t.nova, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>#{i + 1}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.stores.map(s => (
                <tr key={s.id}>
                  <td style={{
                    position: "sticky", left: 0, zIndex: 1,
                    background: t.panel, borderRight: `1px solid ${t.border}`,
                    padding: compact ? "3px 8px" : "5px 10px",
                    minWidth: nameW, width: nameW,
                    borderBottom: `1px solid ${t.border}44`,
                  }}>
                    <div style={{ fontSize, fontWeight: 700, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: fontSize - 1.5, color: t.textLo, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.channel_name}
                    </div>
                  </td>
                  {data.variants.map(v => {
                    const c = cellMap.get(`${s.id}:${v.id}`);
                    const cs = cellStyle(c);
                    return (
                      <td key={v.id}
                        title={c ? `${s.name} · ${v.sku || v.product_name || ""}\nStock ${c.on_hand} · Vend ${c.units_sold} · WOS ${c.value ?? "∞"}` : ""}
                        style={{
                          background: cs.bg, color: cs.fg,
                          textAlign: "center", fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          minWidth: cellW, width: cellW, height: cellH,
                          padding: 2,
                          borderBottom: `1px solid ${t.border}33`,
                          borderLeft: `1px solid ${t.border}22`,
                        }}>
                        {fmt(c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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

function FilterField({ t, label, children, style }: {
  t: Tokens; label: string; children: ReactNode; style?: CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontSize: 9.5, color: t.textLo, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
        {label}
      </label>
      {children}
    </div>
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[30, 90, 180, 365].map(d => (
            <FilterPill key={d} t={t} label={`${d}d`} active={days === d} onClick={() => setDays(d)} />
          ))}
          <div style={{ width: 6 }} />
          <ExcelBtn t={t} label="Excel"
            onClick={() => downloadBlob(
              () => retailApi.reports.abc({ channel_id: channelId || undefined, days }),
              `retail_abc_${days}d.xlsx`,
            )}
          />
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
