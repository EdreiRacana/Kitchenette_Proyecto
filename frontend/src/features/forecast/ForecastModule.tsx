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
  Users, Package, UserCircle2, ChevronDown, FileText,
} from "lucide-react";

import { forecastApi } from "./api";
import type {
  AttainmentResponse, ForecastLine, ForecastLineDraft, ForecastPlan,
  ForecastPlanCreate, PlanStatus, RollupResponse,
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
          customersApi.search({ limit: 500 }).catch(() => ({ items: [] as unknown[] })),
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

  const onGenerateBaseline = async (replace: boolean, yearSource?: number, growthPct?: number) => {
    if (selectedPlanId == null) return null;
    const res = await forecastApi.baseline({
      plan_id: selectedPlanId,
      year_source: yearSource,
      growth_pct: growthPct,
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
          />
        </>
      )}

      {showNewPlan && (
        <NewPlanModal tk={tk} tr={tr} onClose={() => setShowNewPlan(false)} onCreate={onCreatePlan} />
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
  tk, tr, plans, selectedPlan, onSelectPlan, onOpenNewPlan,
  showDropdown, setShowDropdown,
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  plans: ForecastPlan[];
  selectedPlan: ForecastPlan | null;
  onSelectPlan: (id: number) => void;
  onOpenNewPlan: () => void;
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
                position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 260,
                background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 10,
                boxShadow: "0 16px 40px rgba(0,0,0,.35)", overflow: "hidden", zIndex: 40,
              }}>
                {plans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSelectPlan(p.id)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      width: "100%", padding: "10px 14px", border: "none", cursor: "pointer",
                      background: selectedPlan?.id === p.id ? tk.accent + "18" : "transparent",
                      color: tk.textHi, fontSize: 13, textAlign: "left",
                    }}
                  >
                    <span>{p.name}</span>
                    <span style={{ color: tk.textLo, fontSize: 12 }}>{p.year}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
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
}: {
  tk: Tokens;
  tr: (k: string, fb: string) => string;
  lines: ForecastLine[];
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onGenerateBaseline: (replace: boolean, yearSource?: number, growthPct?: number) => Promise<unknown>;
  onUpdateLine: (id: number, patch: Partial<ForecastLineDraft>) => Promise<void>;
  onDeleteLine: (id: number) => Promise<void>;
  plan: ForecastPlan;
}) {
  const [busyBaseline, setBusyBaseline] = useState(false);

  const grandUnits = lines.reduce((a, l) => a + l.total_units, 0);
  const grandAmount = lines.reduce((a, l) => a + l.total_amount, 0);

  const runBaseline = async (replace: boolean) => {
    setBusyBaseline(true);
    try {
      await onGenerateBaseline(replace);
    } finally {
      setBusyBaseline(false);
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
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => runBaseline(false)}
            disabled={busyBaseline}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, background: tk.panel2, color: tk.textHi,
              border: `1px solid ${tk.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer",
              fontSize: 12.5, fontWeight: 600, opacity: busyBaseline ? 0.6 : 1,
            }}
          >
            <Sparkles size={14} color={tk.accent} />
            {tr("forecast.baselineAdd", "Generar desde historial")}
          </button>
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
