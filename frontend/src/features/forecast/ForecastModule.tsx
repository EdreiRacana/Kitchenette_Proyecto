// Forecast de ventas (estilo Skullcandy) — módulo principal.
//
// UX:
//   • Selector de plan (año) arriba, con botón "Nuevo plan".
//   • Tarjetas: Meta anual · Venta real · % de avance con barra de color.
//   • Gráfica de barras meta vs. real por mes.
//   • Cuadrícula editable: fila = (cliente/producto/vendedor) × 12 meses.
//   • Modal "Agregar línea" con selectores, servicio libre, precio, % crecimiento
//     y botón "Generar desde historial" (POST /forecast/baseline).
//   • Concentrado por dimensión (cliente/producto/vendedor) con barras.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Sparkles, Target, TrendingUp, Trash2, Save, X, RefreshCw,
  Users, Package, UserCircle2, ChevronDown, FileText, Download, Upload,
  Info, AlertTriangle, Pencil,
} from "lucide-react";

import { forecastApi } from "./api";
import type {
  AttainmentResponse, ForecastLine, ForecastLineDraft, ForecastPlan,
  ForecastPlanCreate, ImportResponse, PlanStatus, RollupResponse,
} from "./types";
import { customersApi } from "../customers/api";
import { salesApi } from "../sales/api";
import type { VariantOption } from "../sales/api";
import type { CustomerLite, SellerLite } from "../sales/types";
import { resolveTheme, makeTr } from "../sales/theme";
import type { Tokens } from "../sales/theme";

const MON_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_COLS: (keyof ForecastLine)[] = [
  "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12",
];

function money(n: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", maximumFractionDigits: 2,
  }).format(n || 0);
}
function moneyShort(n: number): string {
  const v = Math.abs(n || 0);
  if (v >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function attainmentColor(tk: Tokens, pct: number): string {
  if (pct >= 100) return tk.good;
  if (pct >= 75) return tk.accent;
  if (pct >= 50) return tk.warn;
  return tk.bad;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props { t?: unknown; s?: unknown; }

// ── Root component ──────────────────────────────────────────────────────────

export default function ForecastModule({ t, s }: Props) {
  const tk = resolveTheme(t as Record<string, unknown>);
  const tr = makeTr(s);

  const [plans, setPlans] = useState<ForecastPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [showEditPlan, setShowEditPlan] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);

  const [lines, setLines] = useState<ForecastLine[]>([]);
  const [rollup, setRollup] = useState<RollupResponse | null>(null);
  const [attainment, setAttainment] = useState<AttainmentResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [sellers, setSellers] = useState<SellerLite[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);

  const [rollupDim, setRollupDim] = useState<"customer" | "product" | "salesperson">("customer");

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const list = await forecastApi.listPlans();
      setPlans(list);
      if (list.length && selectedPlanId === null) {
        setSelectedPlanId(list[0].id);
      } else if (!list.length) {
        setSelectedPlanId(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      setPlansError(msg);
    } finally {
      setPlansLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  useEffect(() => {
    (async () => {
      try {
        const [custRes, sellersRes, varsRes] = await Promise.all([
          customersApi.search({ limit: 200, sort_by: "name", sort_dir: "asc" }).catch(() => ({ items: [] as unknown[] })),
          salesApi.listSellers().catch(() => [] as SellerLite[]),
          salesApi.variantOptions().catch(() => [] as VariantOption[]),
        ]);
        const items = (custRes as { items?: unknown[] }).items ?? [];
        setCustomers(items.map((r): CustomerLite => {
          const c = r as { id?: number; name?: string };
          return { id: Number(c.id), name: c.name ?? "" };
        }));
        setSellers(sellersRes);
        setVariants(varsRes);
      } catch { /* catálogos opcionales, no rompen la vista */ }
    })();
  }, []);

  const loadPlanData = useCallback(async (planId: number) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [ls, ro, att] = await Promise.all([
        forecastApi.listLines(planId),
        forecastApi.rollup(planId),
        forecastApi.attainment(planId),
      ]);
      setLines(ls);
      setRollup(ro);
      setAttainment(att);
    } catch (e) {
      setDataError(e instanceof Error ? e.message : "Error");
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPlanId != null) void loadPlanData(selectedPlanId);
  }, [selectedPlanId, loadPlanData]);

  const refreshDerived = useCallback(async () => {
    if (selectedPlanId == null) return;
    try {
      const [ro, att] = await Promise.all([
        forecastApi.rollup(selectedPlanId),
        forecastApi.attainment(selectedPlanId),
      ]);
      setRollup(ro);
      setAttainment(att);
    } catch { /* silencioso */ }
  }, [selectedPlanId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const onCreatePlan = async (data: ForecastPlanCreate) => {
    const plan = await forecastApi.createPlan(data);
    await loadPlans();
    setSelectedPlanId(plan.id);
    setShowNewPlan(false);
  };

  const onUpdatePlan = async (patch: Partial<ForecastPlanCreate>) => {
    if (selectedPlanId == null) return;
    await forecastApi.updatePlan(selectedPlanId, patch);
    await loadPlans();
    setShowEditPlan(false);
    void loadPlanData(selectedPlanId);
  };

  const onDeletePlan = async () => {
    if (selectedPlanId == null) return;
    if (!window.confirm("¿Eliminar este plan? Se borrarán todas sus líneas y no se puede deshacer.")) return;
    await forecastApi.deletePlan(selectedPlanId);
    setShowEditPlan(false);
    setSelectedPlanId(null);
    await loadPlans();
  };

  const onAddLine = async (draft: ForecastLineDraft) => {
    if (selectedPlanId == null) return;
    const line = await forecastApi.createLine(selectedPlanId, draft);
    setLines((prev) => [...prev, line]);
    setShowAddLine(false);
    void refreshDerived();
  };

  const onUpdateLine = async (id: number, patch: Partial<ForecastLineDraft>) => {
    const line = await forecastApi.updateLine(id, patch);
    setLines((prev) => prev.map((l) => (l.id === id ? line : l)));
    void refreshDerived();
  };

  const onDeleteLine = async (id: number) => {
    await forecastApi.deleteLine(id);
    setLines((prev) => prev.filter((l) => l.id !== id));
    void refreshDerived();
  };

  const onGenerateBaseline = async (
    replace: boolean, yearSource?: number, growthPct?: number,
    opts?: { source_type?: "sell_in" | "sell_out" | "wos_target";
              retail_channel_id?: number; wos_target_weeks?: number },
  ) => {
    if (selectedPlanId == null) return null;
    const res = await forecastApi.baseline({
      plan_id: selectedPlanId,
      year_source: yearSource,
      growth_pct: growthPct,
      source_type: opts?.source_type,
      retail_channel_id: opts?.retail_channel_id,
      wos_target_weeks: opts?.wos_target_weeks,
      replace,
    });
    await loadPlanData(selectedPlanId);
    return res;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHead
        tk={tk}
        tr={tr}
        plans={plans}
        selectedPlan={selectedPlan}
        onSelectPlan={(id) => { setSelectedPlanId(id); setShowPlanDropdown(false); }}
        onOpenNewPlan={() => setShowNewPlan(true)}
        onOpenEditPlan={() => setShowEditPlan(true)}
        showDropdown={showPlanDropdown}
        setShowDropdown={setShowPlanDropdown}
      />

      {plansError && (
        <div style={{ padding: 16, background: tk.bad + "1a", color: tk.bad, borderRadius: 10, marginBottom: 12 }}>
          {tr("forecast.loadError", "No se pudieron cargar los planes.")} {plansError}
        </div>
      )}

      {!plansLoading && plans.length === 0 && (
        <EmptyPlans tk={tk} tr={tr} onCreate={() => setShowNewPlan(true)} />
      )}

      {selectedPlan && attainment && rollup && (
        <>
          <StatsRow tk={tk} tr={tr} plan={selectedPlan} attainment={attainment} rollup={rollup} />
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 12, marginBottom: 12 }}>
            <MetaVsRealChart tk={tk} tr={tr} attainment={attainment} />
            <ByDimensionCard
              tk={tk} tr={tr}
              rollup={rollup}
              dim={rollupDim}
              onDimChange={setRollupDim}
            />
          </div>

          <LineGrid
            tk={tk} tr={tr}
            lines={lines}
            loading={dataLoading}
            error={dataError}
            onAdd={() => setShowAddLine(true)}
            onGenerateBaseline={onGenerateBaseline}
            onUpdateLine={onUpdateLine}
            onDeleteLine={onDeleteLine}
            plan={selectedPlan}
            hasCustomers={customers.length > 0}
            onImported={() => selectedPlanId != null && loadPlanData(selectedPlanId)}
          />
        </>
      )}

      {showNewPlan && (
        <NewPlanModal tk={tk} tr={tr} onClose={() => setShowNewPlan(false)} onCreate={onCreatePlan} />
      )}

      {showEditPlan && selectedPlan && (
        <EditPlanModal
          tk={tk} tr={tr} plan={selectedPlan}
          onClose={() => setShowEditPlan(false)}
          onSave={onUpdatePlan}
          onDelete={onDeletePlan}
        />
      )}

      {showAddLine && selectedPlan && (
        <AddLineModal
          tk={tk} tr={tr}
          plan={selectedPlan}
          customers={customers}
          sellers={sellers}
          variants={variants}
          onClose={() => setShowAddLine(false)}
          onAdd={onAddLine}
          onGenerateBaseline={onGenerateBaseline}
        />
      )}
    </div>
  );
}

// ── Page head ────────────────────────────────────────────────────────────────

function PageHead({
  tk, tr, plans, selectedPlan, onSelectPlan, onOpenNewPlan, onOpenEditPlan,
  showDropdown, setShowDropdown,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  plans: ForecastPlan[];
  selectedPlan: ForecastPlan | null;
  onSelectPlan: (id: number) => void;
  onOpenNewPlan: () => void;
  onOpenEditPlan: () => void;
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: tk.textHi, letterSpacing: -0.3 }}>
          {tr("forecast.title", "Forecast de ventas")}
        </h1>
        <p style={{ margin: "6px 0 0", color: tk.textLo, fontSize: 13.5 }}>
          {tr("forecast.subtitle", "Proyección anual por cliente, producto y vendedor; contra venta real.")}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
        {plans.length > 0 && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10,
                padding: "9px 14px", color: tk.textHi, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
              }}
            >
              <Target size={16} color={tk.accent} />
              {selectedPlan ? `${selectedPlan.name} · ${selectedPlan.year}` : tr("forecast.pickPlan", "Elegir plan")}
              <ChevronDown size={14} color={tk.textLo} />
            </button>
            {showDropdown && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 320,
                background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 10,
                boxShadow: "0 16px 40px rgba(0,0,0,.35)", overflow: "hidden", zIndex: 40,
              }}>
                {plans.map((p) => {
                  const isActive = selectedPlan?.id === p.id;
                  return (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center",
                      background: isActive ? tk.accent + "18" : "transparent",
                    }}>
                      <button
                        onClick={() => onSelectPlan(p.id)}
                        style={{
                          flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "10px 14px", border: "none", cursor: "pointer",
                          background: "transparent", color: tk.textHi, fontSize: 13, textAlign: "left",
                        }}
                      >
                        <span>
                          {p.name}
                          <span style={{ marginLeft: 8, fontSize: 10, color: tk.textLo, padding: "2px 6px", borderRadius: 999, border: `1px solid ${tk.border}` }}>
                            {p.status}
                          </span>
                        </span>
                        <span style={{ color: tk.textLo, fontSize: 12 }}>{p.year}</span>
                      </button>
                      {isActive && (
                        <button
                          onClick={onOpenEditPlan}
                          title={tr("forecast.editPlan", "Editar plan")}
                          style={{
                            marginRight: 8, padding: 6, borderRadius: 6, border: "none",
                            background: "transparent", color: tk.textMid, cursor: "pointer",
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {selectedPlan && (
          <button
            onClick={onOpenEditPlan}
            title={tr("forecast.editPlan", "Editar plan")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: tk.panel2, color: tk.textHi, border: `1px solid ${tk.border}`,
              borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
            }}
          >
            <Pencil size={14} color={tk.accent} />
            {tr("forecast.editPlan", "Editar plan")}
          </button>
        )}
        <button
          onClick={onOpenNewPlan}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
            background: `linear-gradient(135deg, ${tk.accent}, ${tk.panel2})`,
            color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "10px 16px", borderRadius: 10,
            boxShadow: `0 6px 18px ${tk.accent}2e`,
          }}
        >
          <Plus size={16} /> {tr("forecast.newPlan", "Nuevo plan")}
        </button>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyPlans({ tk, tr, onCreate }: { tk: Tokens; tr: (k: string, fb: string) => string; onCreate: () => void }) {
  return (
    <div style={{
      background: tk.panel, border: `1px dashed ${tk.border}`, borderRadius: 14,
      padding: 48, textAlign: "center",
    }}>
      <Target size={40} color={tk.accent} />
      <h3 style={{ margin: "12px 0 6px", color: tk.textHi, fontSize: 17 }}>
        {tr("forecast.emptyTitle", "Crea tu primer plan de forecast")}
      </h3>
      <p style={{ margin: 0, color: tk.textLo, fontSize: 13.5, maxWidth: 480, marginInline: "auto" }}>
        {tr("forecast.emptyBody", "Define el año, meta de crecimiento y luego proyecta mes a mes por cliente/producto/vendedor. Puedes generar la línea base desde tu historial real.")}
      </p>
      <button
        onClick={onCreate}
        style={{
          marginTop: 16, background: `linear-gradient(135deg, ${tk.accent}, ${tk.panel2})`,
          color: "#fff", border: "none", padding: "10px 18px", borderRadius: 10, cursor: "pointer",
          fontSize: 13.5, fontWeight: 600, display: "inline-flex", gap: 7, alignItems: "center",
        }}
      >
        <Plus size={16} /> {tr("forecast.newPlan", "Nuevo plan")}
      </button>
    </div>
  );
}

// ── Stats row ────────────────────────────────────────────────────────────────

function StatsRow({
  tk, tr, plan, attainment, rollup,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  plan: ForecastPlan;
  attainment: AttainmentResponse;
  rollup: RollupResponse;
}) {
  const pct = attainment.attainment_year_pct;
  const c = attainmentColor(tk, pct);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12 }}>
      <StatCard
        tk={tk}
        icon={<Target size={16} color={tk.accent} />}
        label={tr("forecast.goalYear", "Meta anual")}
        value={money(attainment.goal_year)}
        hint={`${plan.year} · ${rollup.total_units.toLocaleString("es-MX")} ${tr("forecast.units", "unidades")}`}
      />
      <StatCard
        tk={tk}
        icon={<TrendingUp size={16} color={tk.good} />}
        label={tr("forecast.realYear", "Venta real")}
        value={money(attainment.real_year)}
        hint={`${plan.year}`}
      />
      <div style={{
        background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 14,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: tk.textLo, fontWeight: 600 }}>
            <Sparkles size={14} color={c} /> {tr("forecast.progress", "% de avance")}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: c }} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: tk.textHi, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
          {pct.toFixed(1)}%
        </div>
        <div style={{ height: 8, background: tk.panel3, borderRadius: 999, overflow: "hidden", marginTop: 8 }}>
          <div style={{
            width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 999,
            background: `linear-gradient(90deg, ${c}, ${c}cc)`,
            transition: "width 400ms ease",
          }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: tk.textLo }}>
          {tr("forecast.growthLabel", "Crecimiento")}: <b style={{ color: tk.textHi }}>{plan.growth_pct.toFixed(1)}%</b>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  tk, icon, label, value, hint,
}: { tk: Tokens; icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div style={{
      background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: tk.textLo, fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: tk.textHi, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12, color: tk.textLo }}>{hint}</div>}
    </div>
  );
}

// ── Meta vs. Real chart (bars) ───────────────────────────────────────────────

function MetaVsRealChart({
  tk, tr, attainment,
}: { tk: Tokens; tr: (k: string, fb: string) => string; attainment: AttainmentResponse }) {
  const rows = attainment.months;
  const max = Math.max(1, ...rows.flatMap((r) => [r.goal_amount, r.real_amount]));
  return (
    <div style={{
      background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, minHeight: 260,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Target size={16} color={tk.accent} />
          <span style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>
            {tr("forecast.metaChartTitle", "Meta vs. venta real por mes")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12, color: tk.textMid }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: tk.accent }} />{tr("forecast.meta", "Meta")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: tk.good }} />{tr("forecast.real", "Real")}
          </span>
        </div>
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 8,
        alignItems: "flex-end", height: 190,
      }}>
        {rows.map((r) => {
          const goalH = Math.round((r.goal_amount / max) * 160);
          const realH = Math.round((r.real_amount / max) * 160);
          const barColor = attainmentColor(tk, r.attainment_pct);
          const label = MON_ES[r.month - 1];
          return (
            <div key={r.month} title={`${label}: Meta ${money(r.goal_amount)} · Real ${money(r.real_amount)} · ${r.attainment_pct.toFixed(1)}%`}
                 style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%" }}>
              <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 170 }}>
                <div style={{
                  width: 10, height: Math.max(2, goalH), borderRadius: "3px 3px 0 0",
                  background: `${tk.accent}b3`, border: `1px solid ${tk.accent}66`,
                }} />
                <div style={{
                  width: 10, height: Math.max(2, realH), borderRadius: "3px 3px 0 0",
                  background: barColor, boxShadow: `0 0 8px ${barColor}66`,
                }} />
              </div>
              <div style={{ fontSize: 10, color: tk.textLo }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── By-dimension rollup card ─────────────────────────────────────────────────

function ByDimensionCard({
  tk, tr, rollup, dim, onDimChange,
}: {
  tk: Tokens; tr: (k: string, fb: string) => string; rollup: RollupResponse;
  dim: "customer" | "product" | "salesperson";
  onDimChange: (d: "customer" | "product" | "salesperson") => void;
}) {
  const rows = dim === "customer" ? rollup.by_customer : dim === "product" ? rollup.by_product : rollup.by_salesperson;
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const DimBtn = ({ v, icon, label }: { v: "customer" | "product" | "salesperson"; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => onDimChange(v)}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
        borderRadius: 8, border: "none", cursor: "pointer",
        background: dim === v ? tk.accent + "22" : "transparent",
        color: dim === v ? tk.accent : tk.textMid, fontSize: 12, fontWeight: 600,
      }}
    >
      {icon}{label}
    </button>
  );
  return (
    <div style={{
      background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, minHeight: 260,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>
          {tr("forecast.concentradoTitle", "Concentrado")}
        </span>
        <div style={{ display: "flex", gap: 4, background: tk.panel2, padding: 4, borderRadius: 10, border: `1px solid ${tk.border}` }}>
          <DimBtn v="customer" icon={<Users size={12} />} label={tr("forecast.byCustomer", "Cliente")} />
          <DimBtn v="product" icon={<Package size={12} />} label={tr("forecast.byProduct", "Producto")} />
          <DimBtn v="salesperson" icon={<UserCircle2 size={12} />} label={tr("forecast.bySalesperson", "Vendedor")} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 210, overflowY: "auto" }}>
        {rows.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: tk.textLo, fontSize: 13 }}>
            {tr("forecast.noRollupRows", "Aún no hay líneas para concentrar.")}
          </div>
        )}
        {rows.slice(0, 20).map((r) => {
          const pct = (r.amount / max) * 100;
          return (
            <div key={r.key}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4, color: tk.textMid }}>
                <span style={{ maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                <span style={{ color: tk.textHi, fontWeight: 600 }}>{money(r.amount)}</span>
              </div>
              <div style={{ height: 6, background: tk.panel3, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${tk.accent}, ${tk.accent}66)` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Editable line grid ──────────────────────────────────────────────────────

function LineGrid({
  tk, tr, lines, loading, error, onAdd, onGenerateBaseline, onUpdateLine, onDeleteLine, plan,
  hasCustomers, onImported,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  lines: ForecastLine[];
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onGenerateBaseline: (
    replace: boolean, yearSource?: number, growthPct?: number,
    opts?: { source_type?: "sell_in" | "sell_out" | "wos_target";
              retail_channel_id?: number; wos_target_weeks?: number },
  ) => Promise<unknown>;
  onUpdateLine: (id: number, patch: Partial<ForecastLineDraft>) => Promise<void>;
  onDeleteLine: (id: number) => Promise<void>;
  plan: ForecastPlan;
  hasCustomers: boolean;
  onImported: () => void;
}) {
  const [busyBaseline, setBusyBaseline] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBaselineMenu, setShowBaselineMenu] = useState(false);
  const [showRetailBaseline, setShowRetailBaseline] = useState<null | "sell_out" | "wos_target">(null);
  const [baselineResult, setBaselineResult] = useState<string | null>(null);

  const grandUnits = lines.reduce((a, l) => a + l.total_units, 0);
  const grandAmount = lines.reduce((a, l) => a + l.total_amount, 0);

  const runBaselineSellIn = async () => {
    setShowBaselineMenu(false);
    setBusyBaseline(true);
    try {
      const r = await onGenerateBaseline(false) as { lines_created?: number };
      setBaselineResult(`${r?.lines_created ?? 0} líneas creadas (sell-in)`);
      setTimeout(() => setBaselineResult(null), 3000);
    } finally { setBusyBaseline(false); }
  };

  const runBaselineWithOpts = async (opts: {
    source_type: "sell_out" | "wos_target"; retail_channel_id?: number; wos_target_weeks?: number;
  }) => {
    setBusyBaseline(true);
    try {
      const r = await onGenerateBaseline(false, undefined, undefined, opts) as { lines_created?: number };
      setBaselineResult(
        opts.source_type === "sell_out"
          ? `${r?.lines_created ?? 0} líneas creadas (sell-out)`
          : `${r?.lines_created ?? 0} líneas creadas (WOS objetivo)`
      );
      setShowRetailBaseline(null);
      setTimeout(() => setBaselineResult(null), 4000);
    } finally { setBusyBaseline(false); }
  };

  const download = async (format: "xlsx" | "csv", mode: "template" | "export") => {
    setBusyExport(true);
    try {
      const blob = mode === "template"
        ? await forecastApi.downloadTemplate(format, plan.year)
        : await forecastApi.exportPlan(plan.id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = mode === "template"
        ? `forecast_plantilla_${plan.year}.${format}`
        : `forecast_${plan.name.replace(/\s+/g, "_")}_${plan.year}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusyExport(false);
    }
  };

  return (
    <div style={{
      background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, marginTop: 12, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px", borderBottom: `1px solid ${tk.border}`, gap: 8, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: tk.textHi }}>
            {tr("forecast.gridTitle", "Cuadrícula de forecast")}
          </div>
          <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>
            {tr("forecast.gridSub", "Edita las unidades directamente. Los totales y el % de avance se recalculan al guardar.")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <DownloadMenu
            tk={tk} tr={tr} disabled={busyExport}
            onPick={(fmt, mode) => download(fmt, mode)}
            hasLines={lines.length > 0}
          />
          <button
            onClick={() => setShowImport(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, background: tk.panel2, color: tk.textHi,
              border: `1px solid ${tk.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600,
            }}
          >
            <Upload size={14} color={tk.accent} />
            {tr("forecast.import", "Cargar Excel/CSV")}
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowBaselineMenu(v => !v)}
              disabled={busyBaseline}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, background: tk.panel2, color: tk.textHi,
                border: `1px solid ${tk.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer",
                fontSize: 12.5, fontWeight: 600, opacity: busyBaseline ? 0.6 : 1,
              }}
            >
              <Sparkles size={14} color={tk.accent} />
              {busyBaseline ? "Generando…" : tr("forecast.baselineAdd", "Generar baseline")}
              <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
            </button>
            {showBaselineMenu && (
              <>
                <div onClick={() => setShowBaselineMenu(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
                  minWidth: 280, background: tk.panel, border: `1px solid ${tk.border}`,
                  borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.35)", overflow: "hidden",
                }}>
                  <BaselineOption
                    tk={tk} icon="📊"
                    title="Sell-in (ventas históricas)"
                    subtitle="Del año anterior. Facturación al cliente."
                    onClick={runBaselineSellIn}
                  />
                  <BaselineOption
                    tk={tk} icon="🏪"
                    title="Sell-out (retail)"
                    subtitle="Demanda real de las tiendas. Más preciso."
                    onClick={() => { setShowBaselineMenu(false); setShowRetailBaseline("sell_out"); }}
                  />
                  <BaselineOption
                    tk={tk} icon="🎯"
                    title="WOS objetivo"
                    subtitle="Proyecta para mantener N semanas de stock."
                    onClick={() => { setShowBaselineMenu(false); setShowRetailBaseline("wos_target"); }}
                  />
                </div>
              </>
            )}
          </div>
          {baselineResult && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px",
              background: tk.good + "22", color: tk.good, borderRadius: 6, fontSize: 11.5, fontWeight: 700 }}>
              ✓ {baselineResult}
            </span>
          )}
          <button
            onClick={onAdd}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: `linear-gradient(135deg, ${tk.accent}, ${tk.panel2})`,
              color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600,
            }}
          >
            <Plus size={14} /> {tr("forecast.addLine", "Agregar línea")}
          </button>
        </div>
      </div>

      {!hasCustomers && (
        <div style={{
          padding: "10px 16px", background: tk.warn + "18", color: tk.textHi, fontSize: 12.5,
          display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${tk.border}`,
        }}>
          <Info size={14} color={tk.warn} />
          <span>
            {tr(
              "forecast.noCustomersHint",
              "Aún no tienes clientes en el catálogo. Ve al módulo Clientes para dar de alta el primero — luego aparecerán en el selector.",
            )}
          </span>
        </div>
      )}

      {showImport && (
        <ImportModal
          tk={tk} tr={tr} planId={plan.id}
          onClose={() => setShowImport(false)}
          onImported={(res) => { onImported(); if (res.errors.length === 0) setShowImport(false); }}
        />
      )}

      {showRetailBaseline && (
        <RetailBaselineModal
          tk={tk} tr={tr} kind={showRetailBaseline}
          busy={busyBaseline}
          onClose={() => setShowRetailBaseline(null)}
          onRun={runBaselineWithOpts}
        />
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: tk.textLo }}>
          <RefreshCw size={16} className="spin" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 6 }} />
          {tr("forecast.loading", "Cargando…")}
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: 20, textAlign: "center", color: tk.bad, fontSize: 13 }}>{error}</div>
      )}

      {!loading && !error && lines.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: tk.textLo }}>
          <FileText size={22} color={tk.textLo} />
          <div style={{ marginTop: 8, fontSize: 13.5 }}>
            {tr("forecast.emptyLines", "El plan aún no tiene líneas.")}
          </div>
          <div style={{ marginTop: 4, fontSize: 12 }}>
            {tr("forecast.emptyLinesHint", "Agrega una manualmente o genera la línea base desde el historial real.")}
          </div>
        </div>
      )}

      {!loading && !error && lines.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12, minWidth: 1100 }}>
            <thead>
              <tr style={{ background: tk.panel2 }}>
                <Th tk={tk}>{tr("forecast.col.customer", "Cliente")}</Th>
                <Th tk={tk}>{tr("forecast.col.product", "Producto / SKU")}</Th>
                <Th tk={tk}>{tr("forecast.col.salesperson", "Vendedor")}</Th>
                <Th tk={tk} align="right">{tr("forecast.col.price", "Precio")}</Th>
                {MON_ES.map((m) => (<Th key={m} tk={tk} align="right">{m}</Th>))}
                <Th tk={tk} align="right">{tr("forecast.col.units", "Unid.")}</Th>
                <Th tk={tk} align="right">{tr("forecast.col.total", "Total")}</Th>
                <Th tk={tk}>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <LineRow
                  key={l.id} tk={tk} tr={tr} line={l}
                  onUpdate={onUpdateLine} onDelete={onDeleteLine}
                />
              ))}
              <tr style={{ background: tk.panel2, fontWeight: 700 }}>
                <td colSpan={4} style={{ padding: "10px 12px", color: tk.textHi, borderTop: `1px solid ${tk.border}` }}>
                  {tr("forecast.grandTotal", "Gran total")}
                </td>
                {MON_ES.map((_m, i) => {
                  const monthTotal = lines.reduce((a, l) => a + Number(l[MONTH_COLS[i]] || 0) * (l.unit_price || 0), 0);
                  return (
                    <td key={i} style={{ padding: "10px 8px", textAlign: "right", color: tk.textMid, borderTop: `1px solid ${tk.border}`, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                      {moneyShort(monthTotal)}
                    </td>
                  );
                })}
                <td style={{ padding: "10px 12px", textAlign: "right", color: tk.textHi, borderTop: `1px solid ${tk.border}`, fontVariantNumeric: "tabular-nums" }}>
                  {grandUnits.toLocaleString("es-MX")}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", color: tk.textHi, borderTop: `1px solid ${tk.border}`, fontVariantNumeric: "tabular-nums" }}>
                  {money(grandAmount)}
                </td>
                <td style={{ borderTop: `1px solid ${tk.border}` }} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "10px 16px", fontSize: 11, color: tk.textLo, borderTop: `1px solid ${tk.border}`, background: tk.panel2 }}>
        {tr("forecast.gridFoot", "Plan")}: <b style={{ color: tk.textMid }}>{plan.name}</b> · {plan.year} · %{tr("forecast.growthLabel", "Crecimiento")}: {plan.growth_pct.toFixed(1)}%
      </div>
    </div>
  );
}

function Th({ tk, align, children }: { tk: Tokens; align?: "right" | "left"; children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: align ?? "left", padding: "10px 8px", color: tk.textLo, fontWeight: 600,
      fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1px solid ${tk.border}`,
      position: "sticky", top: 0, background: tk.panel2, zIndex: 1,
    }}>
      {children}
    </th>
  );
}

function LineRow({
  tk, tr, line, onUpdate, onDelete,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  line: ForecastLine;
  onUpdate: (id: number, patch: Partial<ForecastLineDraft>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(() => {
    const d: Record<string, number> = { unit_price: line.unit_price };
    for (const c of MONTH_COLS) d[c as string] = Number(line[c] || 0);
    return d;
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d: Record<string, number> = { unit_price: line.unit_price };
    for (const c of MONTH_COLS) d[c as string] = Number(line[c] || 0);
    setDraft(d);
    setDirty(false);
  }, [line]);

  const setField = (k: string, v: number) => {
    setDraft((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const totalUnits = MONTH_COLS.reduce((a, c) => a + Number(draft[c as string] || 0), 0);
  const totalAmount = totalUnits * Number(draft.unit_price || 0);

  const save = async () => {
    setSaving(true);
    try {
      const patch: Partial<ForecastLineDraft> = { unit_price: draft.unit_price };
      for (const c of MONTH_COLS) (patch as Record<string, number>)[c as string] = draft[c as string];
      await onUpdate(line.id, patch);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!window.confirm(tr("forecast.confirmDelete", "¿Eliminar esta línea?"))) return;
    await onDelete(line.id);
  };

  return (
    <tr style={{ background: dirty ? tk.warn + "0f" : "transparent" }}>
      <td style={{ padding: "8px 12px", color: tk.textHi, borderBottom: `1px solid ${tk.border}` }}>
        {line.customer_name ?? tr("forecast.noCustomer", "Sin cliente")}
      </td>
      <td style={{ padding: "8px 12px", color: tk.textHi, borderBottom: `1px solid ${tk.border}` }}>
        <div>{line.product_name ?? "—"}</div>
        {line.sku && <div style={{ fontSize: 10.5, color: tk.textLo }}>{line.sku}</div>}
      </td>
      <td style={{ padding: "8px 12px", color: tk.textMid, borderBottom: `1px solid ${tk.border}` }}>
        {line.salesperson_name ?? tr("forecast.noSalesperson", "—")}
      </td>
      <td style={{ padding: "8px 8px", borderBottom: `1px solid ${tk.border}` }}>
        <NumInput tk={tk} value={draft.unit_price} onChange={(v) => setField("unit_price", v)} step={0.01} />
      </td>
      {MONTH_COLS.map((c) => (
        <td key={c as string} style={{ padding: "6px 4px", borderBottom: `1px solid ${tk.border}` }}>
          <NumInput tk={tk} value={draft[c as string] ?? 0} onChange={(v) => setField(c as string, v)} />
        </td>
      ))}
      <td style={{ padding: "8px 8px", textAlign: "right", color: tk.textMid, borderBottom: `1px solid ${tk.border}`, fontVariantNumeric: "tabular-nums" }}>
        {totalUnits.toLocaleString("es-MX")}
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", color: tk.textHi, borderBottom: `1px solid ${tk.border}`, fontVariantNumeric: "tabular-nums" }}>
        {money(totalAmount)}
      </td>
      <td style={{ padding: "6px 8px", borderBottom: `1px solid ${tk.border}`, whiteSpace: "nowrap" }}>
        {dirty && (
          <button onClick={save} disabled={saving} title={tr("forecast.save", "Guardar")}
                  style={{ background: tk.good, color: "#0F172A", border: "none", padding: "4px 8px",
                    borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, marginRight: 4 }}>
            <Save size={12} />
          </button>
        )}
        <button onClick={confirmDelete} title={tr("forecast.delete", "Eliminar")}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.bad, padding: 4 }}>
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

function NumInput({ tk, value, onChange, step = 1 }: { tk: Tokens; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={0}
      onChange={(e) => onChange(Number(e.target.value))}
      onFocus={(e) => e.currentTarget.select()}
      style={{
        width: "100%", minWidth: 56, textAlign: "right", padding: "5px 6px",
        border: `1px solid ${tk.border}`, borderRadius: 6, background: tk.inputBg,
        color: tk.textHi, fontSize: 12, fontVariantNumeric: "tabular-nums",
      }}
    />
  );
}

// ── New plan modal ──────────────────────────────────────────────────────────

function NewPlanModal({
  tk, tr, onClose, onCreate,
}: { tk: Tokens; tr: (k: string, fb: string) => string; onClose: () => void; onCreate: (data: ForecastPlanCreate) => Promise<void> }) {
  const nowYear = new Date().getFullYear();
  const [name, setName] = useState<string>(`Forecast ${nowYear}`);
  const [year, setYear] = useState<number>(nowYear);
  const [growth, setGrowth] = useState<number>(10);
  const [status, setStatus] = useState<PlanStatus>("draft");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ name: name.trim(), year, growth_pct: growth, status });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  return (
    <ModalShell tk={tk} tr={tr} title={tr("forecast.newPlan", "Nuevo plan")} onClose={onClose}>
      <Field tk={tk} label={tr("forecast.planName", "Nombre del plan")}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(tk)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Field tk={tk} label={tr("forecast.year", "Año")}>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
        <Field tk={tk} label={tr("forecast.growth", "% Crecimiento")}>
          <input type="number" step={0.1} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
        <Field tk={tk} label={tr("forecast.status", "Estado")}>
          <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} style={inputStyle(tk)}>
            <option value="draft">{tr("forecast.status.draft", "Borrador")}</option>
            <option value="active">{tr("forecast.status.active", "Activo")}</option>
            <option value="closed">{tr("forecast.status.closed", "Cerrado")}</option>
          </select>
        </Field>
      </div>
      {err && <div style={{ color: tk.bad, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={secondaryBtn(tk)}>{tr("forecast.cancel", "Cancelar")}</button>
        <button disabled={busy} onClick={submit} style={primaryBtn(tk)}>
          {busy ? tr("forecast.creating", "Creando…") : tr("forecast.create", "Crear")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Edit plan modal (rename, año, growth, status, delete) ───────────────────

function EditPlanModal({
  tk, tr, plan, onClose, onSave, onDelete,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  plan: ForecastPlan;
  onClose: () => void;
  onSave: (patch: Partial<ForecastPlanCreate>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState<string>(plan.name);
  const [year, setYear] = useState<number>(plan.year);
  const [growth, setGrowth] = useState<number>(plan.growth_pct);
  const [status, setStatus] = useState<PlanStatus>(plan.status);
  const [notes, setNotes] = useState<string>(plan.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setErr(tr("forecast.err.needName", "El plan necesita un nombre."));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        year,
        growth_pct: growth,
        status,
        notes: notes.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      await onDelete();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  return (
    <ModalShell tk={tk} tr={tr} title={tr("forecast.editPlanTitle", "Editar plan de forecast")} onClose={onClose}>
      <Field tk={tk} label={tr("forecast.planName", "Nombre del plan")}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle(tk)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Field tk={tk} label={tr("forecast.year", "Año")}>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
        <Field tk={tk} label={tr("forecast.growth", "% Crecimiento")}>
          <input type="number" step={0.1} value={growth} onChange={(e) => setGrowth(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
        <Field tk={tk} label={tr("forecast.status", "Estado")}>
          <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} style={inputStyle(tk)}>
            <option value="draft">{tr("forecast.status.draft", "Borrador")}</option>
            <option value="active">{tr("forecast.status.active", "Activo")}</option>
            <option value="closed">{tr("forecast.status.closed", "Cerrado")}</option>
          </select>
        </Field>
      </div>
      <Field tk={tk} label={tr("forecast.notes", "Notas (opcional)")}>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          style={{ ...inputStyle(tk), resize: "vertical", fontFamily: "inherit" }}
          placeholder={tr("forecast.notesPh", "Ej. Meta anual definida con dirección comercial")}
        />
      </Field>
      <div style={{ fontSize: 12, color: tk.textLo, marginTop: 8, background: tk.panel2, padding: "8px 10px", borderRadius: 8, border: `1px solid ${tk.border}` }}>
        <b style={{ color: tk.textMid }}>{tr("forecast.statusHelp", "Estados")}:</b> {tr("forecast.statusHelpBody", "Borrador = en preparación, no afecta el tablero. Activo = alimenta la meta del tablero. Cerrado = archivado, no se toma en cuenta.")}
      </div>
      {err && <div style={{ color: tk.bad, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={del} disabled={busy}
                style={{ ...secondaryBtn(tk), color: tk.bad, borderColor: tk.bad + "55" }}>
          <Trash2 size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          {tr("forecast.deletePlan", "Eliminar plan")}
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtn(tk)}>{tr("forecast.cancel", "Cancelar")}</button>
          <button disabled={busy} onClick={save} style={primaryBtn(tk)}>
            {busy ? tr("forecast.saving", "Guardando…") : tr("forecast.saveChanges", "Guardar cambios")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Add-line modal ──────────────────────────────────────────────────────────

function AddLineModal({
  tk, tr, plan, customers, sellers, variants, onClose, onAdd, onGenerateBaseline,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  plan: ForecastPlan;
  customers: CustomerLite[];
  sellers: SellerLite[];
  variants: VariantOption[];
  onClose: () => void;
  onAdd: (draft: ForecastLineDraft) => Promise<void>;
  onGenerateBaseline: (replace: boolean, yearSource?: number, growthPct?: number) => Promise<unknown>;
}) {
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [salespersonId, setSalespersonId] = useState<number | null>(null);
  const [freeService, setFreeService] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [monthly, setMonthly] = useState<number>(0);
  const [growth, setGrowth] = useState<number>(plan.growth_pct);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const selectedVariant = variants.find((v) => v.variant_id === variantId) ?? null;

  useEffect(() => {
    if (selectedVariant && unitPrice === 0) setUnitPrice(selectedVariant.price);
  }, [selectedVariant, unitPrice]);

  const productLabel = selectedVariant?.label ?? freeService.trim();

  const submit = async () => {
    if (!productLabel) {
      setErr(tr("forecast.err.needProduct", "Elige un producto o escribe un servicio."));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const draft: ForecastLineDraft = {
        customer_id: customerId ?? null,
        variant_id: variantId ?? null,
        salesperson_id: salespersonId ?? null,
        product_name: selectedVariant ? selectedVariant.label : freeService.trim(),
        sku: selectedVariant?.sku ?? null,
        unit_price: unitPrice,
        m1: monthly, m2: monthly, m3: monthly, m4: monthly, m5: monthly, m6: monthly,
        m7: monthly, m8: monthly, m9: monthly, m10: monthly, m11: monthly, m12: monthly,
      };
      await onAdd(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  };

  const runBaseline = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await onGenerateBaseline(false, plan.year - 1, growth) as { lines_created?: number };
      setGenMsg(tr("forecast.baselineGenerated", "Se generaron líneas desde el historial: ") + (res?.lines_created ?? 0));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell tk={tk} tr={tr} title={tr("forecast.addLine", "Agregar línea")} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field tk={tk} label={tr("forecast.customer", "Cliente")}>
          <select value={customerId ?? ""} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(tk)}>
            <option value="">{tr("forecast.pickCustomer", "— Cliente —")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field tk={tk} label={tr("forecast.salesperson", "Vendedor")}>
          <select value={salespersonId ?? ""} onChange={(e) => setSalespersonId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(tk)}>
            <option value="">{tr("forecast.pickSalesperson", "— Vendedor —")}</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name || s.email || `#${s.id}`}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field tk={tk} label={tr("forecast.product", "Producto (SKU)")}>
        <select value={variantId ?? ""} onChange={(e) => setVariantId(e.target.value ? Number(e.target.value) : null)} style={inputStyle(tk)}>
          <option value="">{tr("forecast.pickVariant", "— Producto del catálogo —")}</option>
          {variants.map((v) => (
            <option key={v.variant_id} value={v.variant_id}>{v.label} · {v.sku}</option>
          ))}
        </select>
      </Field>
      <Field tk={tk} label={tr("forecast.freeService", "…o servicio de texto libre")}>
        <input value={freeService} onChange={(e) => { setFreeService(e.target.value); setVariantId(null); }} placeholder={tr("forecast.freeServicePh", "Ej. Instalación en obra")} style={inputStyle(tk)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field tk={tk} label={tr("forecast.priceLabel", "Precio unitario")}>
          <input type="number" step={0.01} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
        <Field tk={tk} label={tr("forecast.monthlyUnits", "Unidades por mes (relleno)")}>
          <input type="number" step={1} value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} style={inputStyle(tk)} />
        </Field>
      </div>

      <div style={{ marginTop: 10, padding: 12, background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: tk.textHi, fontSize: 13, fontWeight: 600 }}>
            <Sparkles size={14} color={tk.accent} /> {tr("forecast.baselineTitle", "Generar desde historial")}
          </span>
          <span style={{ fontSize: 11, color: tk.textLo }}>{tr("forecast.baselineHint", "Toma ventas reales del año anterior y aplica el % de crecimiento.")}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: tk.textLo }}>{tr("forecast.growth", "% Crecimiento")}</label>
          <input type="number" step={0.1} value={growth} onChange={(e) => setGrowth(Number(e.target.value))}
                 style={{ ...inputStyle(tk), maxWidth: 100 }} />
          <button disabled={busy} onClick={runBaseline} style={secondaryBtn(tk)}>
            <Sparkles size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
            {tr("forecast.generate", "Generar")}
          </button>
        </div>
        {genMsg && <div style={{ marginTop: 6, fontSize: 12, color: tk.good }}>{genMsg}</div>}
      </div>

      {err && <div style={{ color: tk.bad, fontSize: 12, marginTop: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={secondaryBtn(tk)}>{tr("forecast.close", "Cerrar")}</button>
        <button disabled={busy} onClick={submit} style={primaryBtn(tk)}>
          {busy ? tr("forecast.saving", "Guardando…") : tr("forecast.addLine", "Agregar línea")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function ModalShell({
  tk, tr, title, onClose, children,
}: { tk: Tokens; tr: (k: string, fb: string) => string; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 640, maxWidth: "100%", maxHeight: "94vh", overflowY: "auto",
        background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 14, padding: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: tk.textHi }}>{title}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo }}>
            <X size={18} /> <span style={{ display: "none" }}>{tr("forecast.close", "Cerrar")}</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ tk, label, children }: { tk: Tokens; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11.5, color: tk.textLo, fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      {children}
    </div>
  );
}

function inputStyle(tk: Tokens): React.CSSProperties {
  return {
    width: "100%", padding: "8px 10px", borderRadius: 8,
    border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi,
    fontSize: 13, boxSizing: "border-box",
  };
}
function primaryBtn(tk: Tokens): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, ${tk.accent}, ${tk.panel2})`, color: "#fff",
    border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer",
    fontSize: 13, fontWeight: 600,
  };
}
function secondaryBtn(tk: Tokens): React.CSSProperties {
  return {
    background: tk.panel2, color: tk.textHi, border: `1px solid ${tk.border}`,
    borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600,
  };
}

// ── Download menu (plantilla / export en XLSX o CSV) ────────────────────────

function DownloadMenu({
  tk, tr, disabled, hasLines, onPick,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  disabled: boolean;
  hasLines: boolean;
  onPick: (fmt: "xlsx" | "csv", mode: "template" | "export") => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-forecast-download]")) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div data-forecast-download style={{ position: "relative" }}>
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, background: tk.panel2, color: tk.textHi,
          border: `1px solid ${tk.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer",
          fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.6 : 1,
        }}
      >
        <Download size={14} color={tk.accent} />
        {tr("forecast.download", "Descargar")}
        <ChevronDown size={12} color={tk.textLo} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 240, zIndex: 30,
          background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 10,
          boxShadow: "0 16px 40px rgba(0,0,0,.35)", overflow: "hidden",
        }}>
          <MenuItem tk={tk} label={tr("forecast.tplXlsx", "Plantilla Excel (.xlsx)")} onClick={() => { setOpen(false); onPick("xlsx", "template"); }} />
          <MenuItem tk={tk} label={tr("forecast.tplCsv", "Plantilla CSV")} onClick={() => { setOpen(false); onPick("csv", "template"); }} />
          <div style={{ borderTop: `1px solid ${tk.border}` }} />
          <MenuItem tk={tk} disabled={!hasLines} label={tr("forecast.exportXlsx", "Este plan · Excel (.xlsx)")} onClick={() => { setOpen(false); onPick("xlsx", "export"); }} />
          <MenuItem tk={tk} disabled={!hasLines} label={tr("forecast.exportCsv", "Este plan · CSV")} onClick={() => { setOpen(false); onPick("csv", "export"); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ tk, label, disabled, onClick }: { tk: Tokens; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
        border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: "transparent", color: disabled ? tk.textLo : tk.textHi, fontSize: 13,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ── Import modal ────────────────────────────────────────────────────────────

function ImportModal({
  tk, tr, planId, onClose, onImported,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  planId: number;
  onClose: () => void;
  onImported: (res: ImportResponse) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await forecastApi.importPlan(planId, file);
      setResult(res);
      onImported(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell tk={tk} tr={tr} title={tr("forecast.importTitle", "Cargar forecast desde archivo")} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: tk.textMid, lineHeight: 1.5, marginBottom: 12 }}>
        {tr(
          "forecast.importHelp",
          "Sube el Excel o CSV que preparaste. El sistema matchea cliente por RFC, producto por SKU y vendedor por email. Si algún dato no está en el catálogo, la línea igual se guarda como texto libre.",
        )}
      </div>

      <div style={{
        padding: 20, border: `2px dashed ${tk.border}`, borderRadius: 10, background: tk.panel2,
        textAlign: "center",
      }}>
        <Upload size={22} color={tk.accent} />
        <div style={{ marginTop: 8, color: tk.textMid, fontSize: 13 }}>
          {file ? file.name : tr("forecast.pickFile", "Selecciona un archivo .xlsx, .xlsm o .csv")}
        </div>
        <label style={{
          display: "inline-block", marginTop: 10, padding: "6px 12px", borderRadius: 8,
          background: tk.accent, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
        }}>
          {tr("forecast.pickFileBtn", "Elegir archivo")}
          <input type="file" accept=".xlsx,.xlsm,.csv" style={{ display: "none" }}
                 onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </label>
      </div>

      {result && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: tk.good + "18", color: tk.textHi }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            {tr("forecast.importDone", "Importación completada")}
          </div>
          <div style={{ fontSize: 12.5, color: tk.textMid, marginTop: 4 }}>
            {tr("forecast.linesCreated", "Líneas creadas")}: <b style={{ color: tk.textHi }}>{result.lines_created}</b> ·{" "}
            {tr("forecast.linesSkipped", "Omitidas")}: {result.lines_skipped}
          </div>
          {result.errors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: tk.warn, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} /> {tr("forecast.rowsWithError", "Filas con problema")}: {result.errors.length}
              </div>
              <ul style={{ marginTop: 6, padding: "0 0 0 18px", color: tk.textMid, fontSize: 12 }}>
                {result.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>{tr("forecast.rowLbl", "Fila")} {e.row}: {e.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {err && <div style={{ color: tk.bad, fontSize: 12, marginTop: 8 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={secondaryBtn(tk)}>{tr("forecast.close", "Cerrar")}</button>
        <button disabled={busy || !file} onClick={submit} style={primaryBtn(tk)}>
          {busy ? tr("forecast.uploading", "Subiendo…") : tr("forecast.upload", "Subir")}
        </button>
      </div>
    </ModalShell>
  );
}


// ── Baseline: opción del menú y modal Sell-out/WOS ─────────────────────────

function BaselineOption({ tk, icon, title, subtitle, onClick }: {
  tk: Tokens; icon: string; title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 14px", background: "transparent", border: "none",
        borderBottom: `1px solid ${tk.border}55`, cursor: "pointer",
        textAlign: "left",
      }}>
      <div style={{ fontSize: 20, width: 26, textAlign: "center" }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: tk.textHi }}>{title}</div>
        <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2 }}>{subtitle}</div>
      </div>
    </button>
  );
}


function RetailBaselineModal({ tk, tr, kind, busy, onClose, onRun }: {
  tk: Tokens; tr: (k: string, fb: string) => string;
  kind: "sell_out" | "wos_target"; busy: boolean;
  onClose: () => void;
  onRun: (opts: { source_type: "sell_out" | "wos_target"; retail_channel_id?: number; wos_target_weeks?: number }) => Promise<void>;
}) {
  const [channels, setChannels] = useState<Array<{ id: number; name: string; target_wos_weeks: number }>>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [wosWeeks, setWosWeeks] = useState<number>(4);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const mod = await import("../retail/api");
        const list = await mod.retailApi.listChannels();
        setChannels(list.map((c: any) => ({ id: c.id, name: c.name, target_wos_weeks: c.target_wos_weeks })));
      } catch {
        setErr("No se pudieron cargar las cadenas de retail. Registra al menos una en el módulo Retail.");
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (channelId && kind === "wos_target") {
      const c = channels.find(x => x.id === channelId);
      if (c) setWosWeeks(c.target_wos_weeks);
    }
  }, [channelId, kind, channels]);

  const title = kind === "sell_out"
    ? tr("forecast.baselineSellOutTitle", "Baseline por sell-out (retail)")
    : tr("forecast.baselineWosTitle", "Baseline por WOS objetivo");
  const hint = kind === "sell_out"
    ? "Usa la demanda real reportada por las tiendas del año anterior. Más preciso que sell-in porque no refleja distorsiones de embarques."
    : "Proyecta 12 meses para mantener el nivel de stock que quieres en la red. Basado en la velocidad de los últimos 3 meses.";

  const submit = async () => {
    if (kind === "wos_target" && (!wosWeeks || wosWeeks <= 0)) return;
    await onRun({
      source_type: kind,
      retail_channel_id: channelId || undefined,
      wos_target_weeks: kind === "wos_target" ? wosWeeks : undefined,
    });
  };

  return (
    <ModalShell tk={tk} title={title} onClose={onClose}>
      <div style={{ padding: "0 4px 8px", color: tk.textLo, fontSize: 12.5 }}>{hint}</div>

      {loading && <div style={{ padding: 20, textAlign: "center", color: tk.textLo }}>Cargando cadenas…</div>}
      {err && <div style={{ padding: 12, background: tk.warn + "18", color: tk.warn, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}

      {!loading && !err && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field tk={tk} label="Cadena (opcional — todas si no eliges)">
            <select value={channelId ?? ""} onChange={e => setChannelId(e.target.value ? Number(e.target.value) : null)}
              style={inputStyle(tk)}>
              <option value="">— Todas las cadenas —</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {kind === "wos_target" && (
            <Field tk={tk} label="Semanas de stock objetivo por SKU">
              <input type="number" min={0.5} step={0.5} value={wosWeeks || ""}
                onChange={e => setWosWeeks(Number(e.target.value) || 0)}
                style={inputStyle(tk)} />
              <div style={{ fontSize: 11, color: tk.textLo, marginTop: 4 }}>
                Con 4 semanas mantienes un mes de inventario en la red.
              </div>
            </Field>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <button onClick={onClose} style={secondaryBtn(tk)}>Cancelar</button>
        <button disabled={busy || loading || !!err} onClick={submit} style={primaryBtn(tk)}>
          {busy ? "Generando…" : "Generar líneas"}
        </button>
      </div>
    </ModalShell>
  );
}
