// InventoryModule.tsx — Módulo de Inventario Premium
// Arquitectura de pestañas: Dashboard · Productos · Almacenes · Entradas · Movimientos · Ajustes
// Sistema de diseño: mismo contrato { t, s } que App.tsx
// Modo demo automático si el backend no responde

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Package, Warehouse, ArrowDownToLine, ArrowUpFromLine,
  SlidersHorizontal, Search, Plus, Download, Upload, ChevronRight,
  AlertTriangle, TrendingDown, TrendingUp, BoxSelect, RefreshCw,
  BarChart3, Filter, X, Check, Info, FileSpreadsheet, Truck,
  ShoppingBag, RotateCcw, ArrowLeftRight, Eye, Edit2, Trash2,
  ChevronDown, ChevronUp, Tag, DollarSign, Hash, Calendar,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Variant {
  id: number;
  sku: string;
  size?: string;
  color?: string;
  material?: string;
  price: number;
  cost_price?: number;
  is_active: boolean;
  stock_levels?: { warehouse_id: number; quantity: number; warehouse: { name: string } }[];
}
interface Product {
  id: number;
  name: string;
  description?: string;
  category?: string;
  image_url?: string;
  is_active: boolean;
  created_at: string;
  variants: Variant[];
}
interface Warehouse_ {
  id: number;
  name: string;
  location?: string;
  is_active: boolean;
  type?: "own" | "marketplace" | "consignment" | "transit";
}
interface Movement {
  id: number;
  variant_id: number;
  warehouse_id: number;
  quantity: number;
  movement_type: "IN" | "OUT" | "ADJUSTMENT";
  reference?: string;
  notes?: string;
  created_at: string;
  product_name?: string;
  sku?: string;
  warehouse_name?: string;
}

// ── Demo Data ─────────────────────────────────────────────────────────────
const DEMO_PRODUCTS: Product[] = [
  { id: 1, name: "Cemento gris CPC 30R", description: "Bolsa 50kg", category: "Construcción", is_active: true, created_at: "2026-06-01", variants: [{ id: 1, sku: "CEM-GR-50", price: 215, cost_price: 160, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 480, warehouse: { name: "Almacén Principal" } }, { warehouse_id: 2, quantity: 120, warehouse: { name: "Sucursal Norte" } }] }] },
  { id: 2, name: "Varilla corrugada 3/8\"", description: "Barra 6m", category: "Acero", is_active: true, created_at: "2026-06-01", variants: [{ id: 2, sku: "VAR-38-6M", price: 178, cost_price: 130, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 1320, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 3, name: "Pintura vinílica blanca 19L", description: "Cubeta 19 litros", category: "Pinturas", is_active: true, created_at: "2026-06-01", variants: [{ id: 3, sku: "PIN-VB-19L", price: 1290, cost_price: 890, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 96, warehouse: { name: "Almacén Principal" } }, { warehouse_id: 3, quantity: 24, warehouse: { name: "MercadoLibre" } }] }] },
  { id: 4, name: "Tubo PVC hidráulico 4\"", description: "Tubo 6m", category: "Plomería", is_active: true, created_at: "2026-06-01", variants: [{ id: 4, sku: "TUB-PVC-4", price: 340, cost_price: 240, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 12, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 5, name: "Block hueco 15x20x40", description: "Pieza unitaria", category: "Construcción", is_active: true, created_at: "2026-06-01", variants: [{ id: 5, sku: "BLK-15-20", price: 18, cost_price: 12, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 0, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 6, name: "Cable THW cal. 12", description: "Rollo 100m", category: "Eléctrico", is_active: true, created_at: "2026-06-02", variants: [{ id: 6, sku: "CAB-THW-12", price: 28, cost_price: 19, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 220, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 7, name: "Impermeabilizante 5 años 19L", description: "Cubeta 19 litros", category: "Pinturas", is_active: true, created_at: "2026-06-03", variants: [{ id: 7, sku: "IMP-5A-19L", price: 1490, cost_price: 1050, is_active: true, stock_levels: [{ warehouse_id: 1, quantity: 64, warehouse: { name: "Almacén Principal" } }, { warehouse_id: 3, quantity: 8, warehouse: { name: "MercadoLibre" } }] }] },
];
const DEMO_WAREHOUSES: Warehouse_[] = [
  { id: 1, name: "Almacén Principal", location: "CDMX - Bodega Central", is_active: true, type: "own" },
  { id: 2, name: "Sucursal Norte", location: "Monterrey", is_active: true, type: "own" },
  { id: 3, name: "MercadoLibre", location: "Fulfillment ML", is_active: true, type: "marketplace" },
  { id: 4, name: "Consignación Robles", location: "Constructora Robles - Obra Norte", is_active: true, type: "consignment" },
];
const DEMO_MOVEMENTS: Movement[] = [
  { id: 1, variant_id: 1, warehouse_id: 1, quantity: 200, movement_type: "IN", reference: "OC-2041", notes: "Compra proveedor", created_at: "2026-06-10T09:00:00Z", product_name: "Cemento gris CPC 30R", sku: "CEM-GR-50", warehouse_name: "Almacén Principal" },
  { id: 2, variant_id: 3, warehouse_id: 3, quantity: 24, movement_type: "IN", reference: "ENV-ML-001", notes: "Envío a Fulfillment MercadoLibre", created_at: "2026-06-09T14:30:00Z", product_name: "Pintura vinílica blanca 19L", sku: "PIN-VB-19L", warehouse_name: "MercadoLibre" },
  { id: 3, variant_id: 2, warehouse_id: 1, quantity: -80, movement_type: "OUT", reference: "VTA-2041", notes: "Venta pedido", created_at: "2026-06-09T11:00:00Z", product_name: "Varilla corrugada 3/8\"", sku: "VAR-38-6M", warehouse_name: "Almacén Principal" },
  { id: 4, variant_id: 5, warehouse_id: 1, quantity: -50, movement_type: "OUT", reference: "VTA-2039", notes: "Venta pedido", created_at: "2026-06-08T16:00:00Z", product_name: "Block hueco 15x20x40", sku: "BLK-15-20", warehouse_name: "Almacén Principal" },
  { id: 5, variant_id: 6, warehouse_id: 1, quantity: 5, movement_type: "ADJUSTMENT", reference: "AJU-001", notes: "Corrección conteo físico", created_at: "2026-06-07T10:00:00Z", product_name: "Cable THW cal. 12", sku: "CAB-THW-12", warehouse_name: "Almacén Principal" },
];

const CATEGORIES = ["Construcción", "Acero", "Pinturas", "Plomería", "Eléctrico", "Herramienta", "Madera", "Vidrio", "Otro"];
const WAREHOUSE_TYPES = { own: { label: "Propio", color: "#33B2F5" }, marketplace: { label: "Marketplace", color: "#FBBF24" }, consignment: { label: "Consignación", color: "#A78BFA" }, transit: { label: "Tránsito", color: "#34D399" } };
const MOVEMENT_TYPES = { IN: { label: "Entrada", color: "#34D399", icon: ArrowDownToLine }, OUT: { label: "Salida", color: "#F87171", icon: ArrowUpFromLine }, ADJUSTMENT: { label: "Ajuste", color: "#FBBF24", icon: SlidersHorizontal } };

// ── Helpers ────────────────────────────────────────────────────────────────
const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalStock = (p: Product) => p.variants.reduce((a, v) => a + (v.stock_levels?.reduce((s, l) => s + l.quantity, 0) || 0), 0);
const inventoryValue = (p: Product) => p.variants.reduce((a, v) => a + (v.cost_price || v.price) * (v.stock_levels?.reduce((s, l) => s + l.quantity, 0) || 0), 0);
const margin = (v: Variant) => v.cost_price && v.price ? Math.round(((v.price - v.cost_price) / v.price) * 100) : null;

// ── Main Component ─────────────────────────────────────────────────────────
export default function InventoryModule({ t, s }: { t: any; s: any }) {
  const [tab, setTab] = useState<"dashboard" | "products" | "warehouses" | "entries" | "movements" | "adjustments">("dashboard");
  const [demo, setDemo] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse_[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms
  const [productForm, setProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [warehouseForm, setWarehouseForm] = useState(false);
  const [entryForm, setEntryForm] = useState(false);
  const [adjustForm, setAdjustForm] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [whFilter, setWhFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");

  const lang = s?.nav ? "es" : "en";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, wh] = await Promise.all([
        fetch("/api/v1/inventory/products").then(r => r.json()),
        fetch("/api/v1/inventory/warehouses").then(r => r.json()),
      ]);
      setProducts(pr); setWarehouses(wh); setDemo(false);
    } catch {
      setDemo(true);
      setProducts(DEMO_PRODUCTS);
      setWarehouses(DEMO_WAREHOUSES);
      setMovements(DEMO_MOVEMENTS);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalVal = products.reduce((a, p) => a + inventoryValue(p), 0);
    const outOfStock = products.filter(p => totalStock(p) === 0).length;
    const lowStock = products.filter(p => { const s = totalStock(p); return s > 0 && s < 20; }).length;
    const totalProds = products.length;
    const activeProds = products.filter(p => p.is_active).length;
    return { totalVal, outOfStock, lowStock, totalProds, activeProds };
  }, [products]);

  const filteredProducts = useMemo(() => products.filter(p => {
    const qs = q.toLowerCase();
    const matchQ = !q || p.name.toLowerCase().includes(qs) || p.variants.some(v => v.sku.toLowerCase().includes(qs)) || (p.category || "").toLowerCase().includes(qs);
    const matchCat = !catFilter || p.category === catFilter;
    const matchWh = !whFilter || p.variants.some(v => v.stock_levels?.some(l => String(l.warehouse_id) === whFilter));
    const matchStatus = !statusFilter || (statusFilter === "active" ? p.is_active : !p.is_active) || (statusFilter === "out" ? totalStock(p) === 0 : true) || (statusFilter === "low" ? (totalStock(p) > 0 && totalStock(p) < 20) : true);
    return matchQ && matchCat && matchWh && matchStatus;
  }), [products, q, catFilter, whFilter, statusFilter]);

  const filteredMovements = useMemo(() => movements.filter(m => {
    const matchType = !movTypeFilter || m.movement_type === movTypeFilter;
    const matchQ = !q || (m.product_name || "").toLowerCase().includes(q.toLowerCase()) || (m.sku || "").toLowerCase().includes(q.toLowerCase());
    return matchType && matchQ;
  }), [movements, movTypeFilter, q]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const tabBtn = (active: boolean) => ({ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s" });

  const TABS = [
    { id: "dashboard", label: lang === "es" ? "Dashboard" : "Dashboard", icon: LayoutDashboard },
    { id: "products", label: lang === "es" ? "Productos" : "Products", icon: Package },
    { id: "warehouses", label: lang === "es" ? "Almacenes" : "Warehouses", icon: Warehouse },
    { id: "entries", label: lang === "es" ? "Entradas" : "Entries", icon: ArrowDownToLine },
    { id: "movements", label: lang === "es" ? "Movimientos" : "Movements", icon: ArrowLeftRight },
    { id: "adjustments", label: lang === "es" ? "Ajustes" : "Adjustments", icon: SlidersHorizontal },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Demo banner */}
      {demo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: t.warn + "18", border: `1px solid ${t.warn}44`, color: t.warn, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          <Info size={16} /> {lang === "es" ? "Modo demo: backend no disponible. Los cambios no se guardan." : "Demo mode: backend unavailable. Changes won't be saved."}
        </div>
      )}

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>{lang === "es" ? "Inventario" : "Inventory"}</h1>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>{lang === "es" ? "Control total de existencias, almacenes y movimientos" : "Full stock, warehouse and movement control"}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
            <RefreshCw size={15} /> {lang === "es" ? "Actualizar" : "Refresh"}
          </button>
          <button onClick={() => setProductForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Plus size={15} /> {lang === "es" ? "Nuevo producto" : "New product"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as any)} style={tabBtn(tab === id)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon size={14} />{label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: Dashboard ── */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            {[
              { label: lang === "es" ? "Valor del inventario" : "Inventory value", value: mxn(kpis.totalVal), icon: DollarSign, color: t.nova, sub: lang === "es" ? "al costo" : "at cost" },
              { label: lang === "es" ? "Total productos" : "Total products", value: String(kpis.totalProds), icon: Package, color: t.good, sub: `${kpis.activeProds} ${lang === "es" ? "activos" : "active"}` },
              { label: lang === "es" ? "Agotados" : "Out of stock", value: String(kpis.outOfStock), icon: BoxSelect, color: t.bad, sub: lang === "es" ? "requieren reorden" : "need reorder" },
              { label: lang === "es" ? "Stock bajo" : "Low stock", value: String(kpis.lowStock), icon: AlertTriangle, color: t.warn, sub: lang === "es" ? "menos de 20 uds" : "less than 20 units" },
              { label: lang === "es" ? "Almacenes" : "Warehouses", value: String(warehouses.filter(w => w.is_active).length), icon: Warehouse, color: "#A78BFA", sub: lang === "es" ? "activos" : "active" },
            ].map((k) => (
              <div key={k.label} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: k.color + "22", color: k.color, borderRadius: 10, padding: 10, display: "flex" }}><k.icon size={20} /></div>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 3 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 2 }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          {(kpis.outOfStock > 0 || kpis.lowStock > 0) && (
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} color={t.warn} /> {lang === "es" ? "Alertas de stock" : "Stock alerts"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {products.filter(p => totalStock(p) === 0).map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, background: t.bad + "12", border: `1px solid ${t.bad}30` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <BoxSelect size={15} color={t.bad} />
                      <span style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: t.textLo }}>{p.variants[0]?.sku}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.bad, background: t.bad + "18", padding: "3px 10px", borderRadius: 20 }}>{lang === "es" ? "AGOTADO" : "OUT OF STOCK"}</span>
                  </div>
                ))}
                {products.filter(p => totalStock(p) > 0 && totalStock(p) < 20).map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 8, background: t.warn + "12", border: `1px solid ${t.warn}30` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AlertTriangle size={15} color={t.warn} />
                      <span style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{p.name}</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.warn }}>{totalStock(p)} {lang === "es" ? "uds. restantes" : "units left"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top products by value */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart3 size={16} color={t.nova} /> {lang === "es" ? "Top productos por valor" : "Top products by value"}
            </div>
            {[...products].sort((a, b) => inventoryValue(b) - inventoryValue(a)).slice(0, 5).map((p, i) => {
              const val = inventoryValue(p);
              const maxVal = inventoryValue([...products].sort((a, b) => inventoryValue(b) - inventoryValue(a))[0]);
              const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
              return (
                <div key={p.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: t.textHi }}>{i + 1}. {p.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.nova }}>{mxn(val)}</span>
                  </div>
                  <div style={{ height: 6, background: t.panel3, borderRadius: 99 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${t.nova}, ${t.navy})` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent movements */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <ArrowLeftRight size={16} color={t.nova} /> {lang === "es" ? "Movimientos recientes" : "Recent movements"}
            </div>
            {movements.slice(0, 5).map(m => {
              const mt = MOVEMENT_TYPES[m.movement_type];
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                  <div style={{ background: mt.color + "22", color: mt.color, borderRadius: 8, padding: 7, display: "flex" }}><mt.icon size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{m.product_name}</div>
                    <div style={{ fontSize: 11.5, color: t.textLo }}>{m.sku} · {m.warehouse_name} · {m.reference}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: mt.color }}>{m.quantity > 0 ? "+" : ""}{m.quantity}</div>
                    <div style={{ fontSize: 11, color: t.textLo }}>{new Date(m.created_at).toLocaleDateString("es-MX")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Products ── */}
      {tab === "products" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === "es" ? "Buscar producto, SKU, categoría…" : "Search product, SKU, category…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Categoría" : "Category"}</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Almacén" : "Warehouse"}</option>
              {warehouses.map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Estado" : "Status"}</option>
              <option value="active">{lang === "es" ? "Activos" : "Active"}</option>
              <option value="out">{lang === "es" ? "Agotados" : "Out of stock"}</option>
              <option value="low">{lang === "es" ? "Stock bajo" : "Low stock"}</option>
            </select>
            {(q || catFilter || whFilter || statusFilter) && (
              <button onClick={() => { setQ(""); setCatFilter(""); setWhFilter(""); setStatusFilter(""); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 13 }}>
                <X size={13} /> {lang === "es" ? "Limpiar" : "Clear"}
              </button>
            )}
          </div>

          {/* Summary */}
          <div style={{ fontSize: 12.5, color: t.textLo }}>{filteredProducts.length} {lang === "es" ? "productos" : "products"}</div>

          {/* Table */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Producto" : "Product", "SKU", lang === "es" ? "Categoría" : "Category", lang === "es" ? "Stock total" : "Total stock", lang === "es" ? "Valor inventario" : "Inv. value", lang === "es" ? "Precio venta" : "Sale price", lang === "es" ? "Margen" : "Margin", lang === "es" ? "Estado" : "Status", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((__, c) => (
                          <td key={c} style={{ padding: "14px 16px" }}>
                            <div style={{ height: 12, borderRadius: 6, background: t.panel3, width: c === 0 ? "70%" : "50%", animation: "shimmer 1.4s ease infinite" }} />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))
                  ) : filteredProducts.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 48, color: t.textLo, fontSize: 14 }}>
                      {lang === "es" ? "Sin productos. Ajusta los filtros o agrega uno nuevo." : "No products. Adjust filters or add a new one."}
                    </td></tr>
                  ) : filteredProducts.map((p, i) => {
                    const stock = totalStock(p);
                    const val = inventoryValue(p);
                    const v = p.variants[0];
                    const mg = v ? margin(v) : null;
                    const stockColor = stock === 0 ? t.bad : stock < 20 ? t.warn : t.good;
                    return (
                      <tr key={p.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2, cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.background = t.panel3)}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? t.panel : t.panel2)}
                        onClick={() => setSelectedProduct(p)}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi }}>{p.name}</div>
                          {p.description && <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2 }}>{p.description}</div>}
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: 12.5, color: t.nova, fontFamily: "monospace", fontWeight: 600 }}>{v?.sku || "—"}</td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ fontSize: 11.5, color: t.textMid, background: t.panel3, padding: "3px 8px", borderRadius: 6 }}>{p.category || "—"}</span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: stockColor }}>{stock}</span>
                          {stock === 0 && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: t.bad, background: t.bad + "18", padding: "2px 6px", borderRadius: 4 }}>AGOTADO</span>}
                          {stock > 0 && stock < 20 && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: t.warn, background: t.warn + "18", padding: "2px 6px", borderRadius: 4 }}>BAJO</span>}
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{mxn(val)}</td>
                        <td style={{ padding: "14px 16px", fontSize: 13.5, color: t.textHi }}>{v ? mxn(v.price) : "—"}</td>
                        <td style={{ padding: "14px 16px" }}>
                          {mg !== null ? (
                            <span style={{ fontSize: 13, fontWeight: 700, color: mg >= 30 ? t.good : mg >= 15 ? t.warn : t.bad }}>{mg}%</span>
                          ) : "—"}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: p.is_active ? t.good : t.bad, background: (p.is_active ? t.good : t.bad) + "18", padding: "3px 9px", borderRadius: 20 }}>
                            {p.is_active ? (lang === "es" ? "Activo" : "Active") : (lang === "es" ? "Inactivo" : "Inactive")}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}><ChevronRight size={16} color={t.textLo} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Warehouses ── */}
      {tab === "warehouses" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setWarehouseForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nuevo almacén" : "New warehouse"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {warehouses.map(w => {
              const wt = WAREHOUSE_TYPES[w.type || "own"];
              const stockInWh = products.reduce((a, p) => a + p.variants.reduce((b, v) => b + (v.stock_levels?.filter(l => l.warehouse_id === w.id).reduce((c, l) => c + l.quantity, 0) || 0), 0), 0);
              const skusInWh = products.filter(p => p.variants.some(v => v.stock_levels?.some(l => l.warehouse_id === w.id && l.quantity > 0))).length;
              return (
                <div key={w.id} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ background: wt.color + "22", color: wt.color, borderRadius: 10, padding: 9, display: "flex" }}><Warehouse size={18} /></div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{w.name}</div>
                        <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>{w.location || "—"}</div>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: wt.color, background: wt.color + "18", padding: "3px 8px", borderRadius: 6 }}>{wt.label}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: t.textLo, marginBottom: 3 }}>{lang === "es" ? "Unidades" : "Units"}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{stockInWh.toLocaleString()}</div>
                    </div>
                    <div style={{ background: t.panel2, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 11, color: t.textLo, marginBottom: 3 }}>{lang === "es" ? "SKUs" : "SKUs"}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: t.textHi }}>{skusInWh}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: w.is_active ? t.good : t.bad }} />
                    <span style={{ fontSize: 12, color: w.is_active ? t.good : t.bad }}>{w.is_active ? (lang === "es" ? "Activo" : "Active") : (lang === "es" ? "Inactivo" : "Inactive")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: Entries ── */}
      {tab === "entries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {[
              { icon: FileSpreadsheet, title: lang === "es" ? "Entrada manual" : "Manual entry", desc: lang === "es" ? "Registra entradas producto por producto" : "Register entries one by one", color: t.nova, action: () => setEntryForm(true) },
              { icon: Upload, title: lang === "es" ? "Importar plantilla" : "Import template", desc: lang === "es" ? "Sube un CSV/Excel con múltiples productos" : "Upload a CSV/Excel with multiple products", color: t.good, action: () => alert(lang === "es" ? "Próximamente: importación por plantilla Excel" : "Coming soon: Excel template import") },
              { icon: Truck, title: lang === "es" ? "Orden de compra" : "Purchase order", desc: lang === "es" ? "Recibe mercancía de una orden existente" : "Receive goods from an existing order", color: "#A78BFA", action: () => alert(lang === "es" ? "Próximamente: órdenes de compra" : "Coming soon: purchase orders") },
              { icon: RotateCcw, title: lang === "es" ? "Devolución de cliente" : "Customer return", desc: lang === "es" ? "Regresa stock por devolución" : "Return stock from customer return", color: t.warn, action: () => alert(lang === "es" ? "Próximamente: devoluciones" : "Coming soon: returns") },
            ].map(card => (
              <button key={card.title} onClick={card.action} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, textAlign: "left", cursor: "pointer", transition: "transform .12s, box-shadow .12s" }}
                onMouseEnter={e => { (e.currentTarget as any).style.transform = "translateY(-2px)"; (e.currentTarget as any).style.boxShadow = `0 8px 24px rgba(0,0,0,0.18)`; }}
                onMouseLeave={e => { (e.currentTarget as any).style.transform = ""; (e.currentTarget as any).style.boxShadow = ""; }}>
                <div style={{ background: card.color + "22", color: card.color, borderRadius: 10, padding: 10, display: "inline-flex", marginBottom: 12 }}><card.icon size={20} /></div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 6 }}>{card.title}</div>
                <div style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>{card.desc}</div>
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 4, color: card.color, fontSize: 12.5, fontWeight: 600 }}>
                  {lang === "es" ? "Comenzar" : "Start"} <ChevronRight size={13} />
                </div>
              </button>
            ))}
          </div>

          {/* Recent entries */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>{lang === "es" ? "Entradas recientes" : "Recent entries"}</div>
            {movements.filter(m => m.movement_type === "IN").slice(0, 5).map(m => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                <div style={{ background: t.good + "22", color: t.good, borderRadius: 8, padding: 7, display: "flex" }}><ArrowDownToLine size={14} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{m.product_name}</div>
                  <div style={{ fontSize: 11.5, color: t.textLo }}>{m.reference} · {m.warehouse_name} · {m.notes}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.good }}>+{m.quantity}</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>{new Date(m.created_at).toLocaleDateString("es-MX")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Movements ── */}
      {tab === "movements" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === "es" ? "Buscar producto o SKU…" : "Search product or SKU…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <select value={movTypeFilter} onChange={e => setMovTypeFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Tipo" : "Type"}</option>
              <option value="IN">{lang === "es" ? "Entradas" : "Entries"}</option>
              <option value="OUT">{lang === "es" ? "Salidas" : "Exits"}</option>
              <option value="ADJUSTMENT">{lang === "es" ? "Ajustes" : "Adjustments"}</option>
            </select>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
              <Download size={14} /> {lang === "es" ? "Exportar" : "Export"}
            </button>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Tipo", "Producto", "SKU", "Almacén", "Cantidad", "Referencia", "Notas", "Fecha"].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: t.textLo }}>{lang === "es" ? "Sin movimientos" : "No movements"}</td></tr>
                  ) : filteredMovements.map((m, i) => {
                    const mt = MOVEMENT_TYPES[m.movement_type];
                    return (
                      <tr key={m.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: mt.color, background: mt.color + "18", padding: "4px 10px", borderRadius: 20, width: "fit-content" }}>
                            <mt.icon size={12} />{mt.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{m.product_name}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: t.nova, fontFamily: "monospace" }}>{m.sku}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{m.warehouse_name}</td>
                        <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: mt.color }}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textMid }}>{m.reference || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo }}>{m.notes || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>{new Date(m.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Adjustments ── */}
      {tab === "adjustments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: t.warn + "14", border: `1px solid ${t.warn}44`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertTriangle size={16} color={t.warn} style={{ marginTop: 1 }} />
            <div style={{ fontSize: 13, color: t.warn, lineHeight: 1.5 }}>
              {lang === "es" ? "Los ajustes modifican el stock directamente. Úsalos solo para correcciones de conteo físico o mermas. Cada ajuste queda registrado con usuario y fecha." : "Adjustments directly modify stock. Use only for physical count corrections or losses. Each adjustment is logged with user and date."}
            </div>
          </div>
          <button onClick={() => setAdjustForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, width: "fit-content" }}>
            <SlidersHorizontal size={15} /> {lang === "es" ? "Nuevo ajuste de inventario" : "New inventory adjustment"}
          </button>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", fontSize: 14, fontWeight: 600, color: t.textHi, borderBottom: `1px solid ${t.border}` }}>{lang === "es" ? "Ajustes recientes" : "Recent adjustments"}</div>
            {movements.filter(m => m.movement_type === "ADJUSTMENT").length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin ajustes registrados" : "No adjustments recorded"}</div>
            ) : movements.filter(m => m.movement_type === "ADJUSTMENT").map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${t.borderSoft}`, background: i % 2 === 0 ? t.panel : t.panel2 }}>
                <div style={{ background: t.warn + "22", color: t.warn, borderRadius: 8, padding: 7, display: "flex" }}><SlidersHorizontal size={14} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{m.product_name} <span style={{ fontSize: 12, color: t.textLo, fontFamily: "monospace" }}>({m.sku})</span></div>
                  <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 2 }}>{m.warehouse_name} · {m.notes}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: m.quantity >= 0 ? t.good : t.bad }}>{m.quantity >= 0 ? "+" : ""}{m.quantity}</div>
                  <div style={{ fontSize: 11, color: t.textLo }}>{new Date(m.created_at).toLocaleDateString("es-MX")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL: Product Detail ── */}
      {selectedProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setSelectedProduct(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, height: "100vh", background: t.panel, borderLeft: `1px solid ${t.border}`, padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.textHi }}>{selectedProduct.name}</h2>
              <button onClick={() => setSelectedProduct(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, background: t.panel3, color: t.textMid, padding: "3px 10px", borderRadius: 6 }}>{selectedProduct.category || "Sin categoría"}</span>
              <span style={{ fontSize: 11.5, background: (selectedProduct.is_active ? t.good : t.bad) + "18", color: selectedProduct.is_active ? t.good : t.bad, padding: "3px 10px", borderRadius: 6 }}>{selectedProduct.is_active ? "Activo" : "Inactivo"}</span>
            </div>
            {selectedProduct.description && <p style={{ margin: 0, fontSize: 13, color: t.textLo, lineHeight: 1.6 }}>{selectedProduct.description}</p>}

            <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textLo, letterSpacing: 0.5, marginBottom: 12 }}>VARIANTES</div>
              {selectedProduct.variants.map(v => {
                const stockV = v.stock_levels?.reduce((a, l) => a + l.quantity, 0) || 0;
                const mg = margin(v);
                return (
                  <div key={v.id} style={{ background: t.panel2, borderRadius: 10, padding: 14, marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.nova, fontFamily: "monospace" }}>{v.sku}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: stockV === 0 ? t.bad : stockV < 20 ? t.warn : t.good }}>{stockV} uds.</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div><div style={{ fontSize: 10.5, color: t.textLo }}>Precio venta</div><div style={{ fontSize: 13, fontWeight: 600, color: t.textHi }}>{mxn(v.price)}</div></div>
                      <div><div style={{ fontSize: 10.5, color: t.textLo }}>Costo</div><div style={{ fontSize: 13, fontWeight: 600, color: t.textHi }}>{v.cost_price ? mxn(v.cost_price) : "—"}</div></div>
                      <div><div style={{ fontSize: 10.5, color: t.textLo }}>Margen</div><div style={{ fontSize: 13, fontWeight: 700, color: mg !== null ? (mg >= 30 ? t.good : mg >= 15 ? t.warn : t.bad) : t.textLo }}>{mg !== null ? `${mg}%` : "—"}</div></div>
                    </div>
                    {v.stock_levels && v.stock_levels.length > 0 && (
                      <div style={{ marginTop: 10, borderTop: `1px solid ${t.border}`, paddingTop: 8 }}>
                        <div style={{ fontSize: 10.5, color: t.textLo, marginBottom: 6 }}>POR ALMACÉN</div>
                        {v.stock_levels.map(l => (
                          <div key={l.warehouse_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: t.textMid, marginBottom: 3 }}>
                            <span>{l.warehouse.name}</span>
                            <span style={{ fontWeight: 600, color: t.textHi }}>{l.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
              <button onClick={() => { setEditingProduct(selectedProduct); setSelectedProduct(null); setProductForm(true); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Edit2 size={14} /> {lang === "es" ? "Editar" : "Edit"}
              </button>
              <button onClick={() => { setEntryForm(true); setSelectedProduct(null); }} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <ArrowDownToLine size={14} /> {lang === "es" ? "Entrada" : "Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Product Form ── */}
      {productForm && <ProductFormModal t={t} s={s} lang={lang} warehouses={warehouses} editing={editingProduct} onClose={() => { setProductForm(false); setEditingProduct(null); }} onSave={async (data) => { if (demo) { alert(lang === "es" ? "Modo demo: guardado simulado ✓" : "Demo mode: simulated save ✓"); } setProductForm(false); setEditingProduct(null); await load(); }} />}

      {/* ── MODAL: Entry Form ── */}
      {entryForm && <EntryFormModal t={t} lang={lang} products={products} warehouses={warehouses} onClose={() => setEntryForm(false)} onSave={async (data) => { if (demo) { alert(lang === "es" ? "Modo demo: entrada simulada ✓" : "Demo mode: simulated entry ✓"); } setEntryForm(false); await load(); }} />}

      {/* ── MODAL: Adjustment Form ── */}
      {adjustForm && <AdjustmentFormModal t={t} lang={lang} products={products} warehouses={warehouses} onClose={() => setAdjustForm(false)} onSave={async () => { if (demo) { alert(lang === "es" ? "Modo demo: ajuste simulado ✓" : "Demo mode: simulated adjustment ✓"); } setAdjustForm(false); await load(); }} />}

      {/* ── MODAL: Warehouse Form ── */}
      {warehouseForm && <WarehouseFormModal t={t} lang={lang} onClose={() => setWarehouseForm(false)} onSave={async () => { if (demo) { alert(lang === "es" ? "Modo demo: almacén simulado ✓" : "Demo mode: simulated warehouse ✓"); } setWarehouseForm(false); await load(); }} />}

      <style>{`@keyframes shimmer{0%{opacity:.4}50%{opacity:.8}100%{opacity:.4}}`}</style>
    </div>
  );
}

// ── Product Form Modal ─────────────────────────────────────────────────────
function ProductFormModal({ t, s, lang, warehouses, editing, onClose, onSave }: any) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: editing?.name || "", description: editing?.description || "",
    category: editing?.category || "", image_url: editing?.image_url || "",
    is_active: editing?.is_active ?? true,
  });
  const [variants, setVariants] = useState(editing?.variants?.map((v: any) => ({
    sku: v.sku, price: v.price, cost_price: v.cost_price || "", size: v.size || "", color: v.color || "", material: v.material || "",
  })) || [{ sku: "", price: "", cost_price: "", size: "", color: "", material: "" }]);
  const [stockInit, setStockInit] = useState<Record<string, Record<number, number>>>({});

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };

  const addVariant = () => setVariants((v: any[]) => [...v, { sku: "", price: "", cost_price: "", size: "", color: "", material: "" }]);
  const removeVariant = (i: number) => setVariants((v: any[]) => v.filter((_: any, idx: number) => idx !== i));
  const updateVariant = (i: number, field: string, val: any) => setVariants((v: any[]) => v.map((vv: any, idx: number) => idx === i ? { ...vv, [field]: val } : vv));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ form, variants, stockInit }); } finally { setSaving(false); }
  };

  const STEPS = [lang === "es" ? "Información" : "Info", lang === "es" ? "Variantes" : "Variants", lang === "es" ? "Stock inicial" : "Initial stock"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 600, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", maxHeight: "90vh", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.textHi }}>{editing ? (lang === "es" ? "Editar producto" : "Edit product") : (lang === "es" ? "Nuevo producto" : "New product")}</h2>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {STEPS.map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 99, background: step > i + 1 ? t.good : step === i + 1 ? t.nova : t.panel3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: step >= i + 1 ? "#fff" : t.textLo }}>
                    {step > i + 1 ? <Check size={12} /> : i + 1}
                  </div>
                  <span style={{ fontSize: 12, color: step === i + 1 ? t.nova : t.textLo }}>{st}</span>
                  {i < STEPS.length - 1 && <ChevronRight size={12} color={t.borderSoft} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div><label style={label}>{lang === "es" ? "Nombre del producto *" : "Product name *"}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={lang === "es" ? "Ej: Cemento gris CPC 30R" : "E.g: Grey cement CPC 30R"} style={inp} /></div>
              <div><label style={label}>{lang === "es" ? "Descripción" : "Description"}</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} style={{ ...inp, resize: "vertical" }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={label}>{lang === "es" ? "Categoría" : "Category"}</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={label}>{lang === "es" ? "URL imagen" : "Image URL"}</label><input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} placeholder="https://…" style={inp} /></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" id="active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <label htmlFor="active" style={{ fontSize: 13, color: t.textMid, cursor: "pointer" }}>{lang === "es" ? "Producto activo" : "Active product"}</label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {variants.map((v: any, i: number) => (
                <div key={i} style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{lang === "es" ? `Variante ${i + 1}` : `Variant ${i + 1}`}</span>
                    {variants.length > 1 && <button onClick={() => removeVariant(i)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.bad }}><Trash2 size={15} /></button>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div><label style={label}>SKU *</label><input value={v.sku} onChange={e => updateVariant(i, "sku", e.target.value)} placeholder="CEM-GR-50" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Precio venta *" : "Sale price *"}</label><input type="number" value={v.price} onChange={e => updateVariant(i, "price", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Costo" : "Cost"}</label><input type="number" value={v.cost_price} onChange={e => updateVariant(i, "cost_price", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Talla/Tamaño" : "Size"}</label><input value={v.size} onChange={e => updateVariant(i, "size", e.target.value)} placeholder="50kg, M, XL…" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Color" : "Color"}</label><input value={v.color} onChange={e => updateVariant(i, "color", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Material" : "Material"}</label><input value={v.material} onChange={e => updateVariant(i, "material", e.target.value)} style={inp} /></div>
                  </div>
                  {v.price && v.cost_price && (
                    <div style={{ marginTop: 10, fontSize: 12, color: t.textLo }}>
                      {lang === "es" ? "Margen:" : "Margin:"} <span style={{ fontWeight: 700, color: ((v.price - v.cost_price) / v.price * 100) >= 30 ? t.good : t.warn }}>{Math.round((v.price - v.cost_price) / v.price * 100)}%</span>
                    </div>
                  )}
                </div>
              ))}
              <button onClick={addVariant} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px", borderRadius: 10, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 13, justifyContent: "center" }}>
                <Plus size={15} /> {lang === "es" ? "Agregar variante" : "Add variant"}
              </button>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: t.textLo }}>{lang === "es" ? "Define el stock inicial por almacén para cada variante. Puedes dejarlo en 0 y hacer una entrada después." : "Set initial stock per warehouse for each variant. You can leave it at 0 and do an entry later."}</p>
              {variants.map((v: any, vi: number) => (
                <div key={vi} style={{ background: t.panel2, border: `1px solid ${t.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.nova, fontFamily: "monospace", marginBottom: 12 }}>{v.sku || `Variante ${vi + 1}`}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {warehouses.map((w: any) => (
                      <div key={w.id}>
                        <label style={label}>{w.name}</label>
                        <input type="number" min={0} value={stockInit[v.sku]?.[w.id] || ""} onChange={e => setStockInit(s => ({ ...s, [v.sku]: { ...s[v.sku], [w.id]: Number(e.target.value) } }))} placeholder="0" style={inp} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {step === 1 ? (lang === "es" ? "Cancelar" : "Cancel") : (lang === "es" ? "Anterior" : "Back")}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(s => s + 1)} disabled={step === 1 && !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: step === 1 && !form.name ? 0.5 : 1 }}>
              {lang === "es" ? "Siguiente" : "Next"} →
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              {saving ? "…" : (lang === "es" ? "Guardar producto" : "Save product")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Entry Form Modal ───────────────────────────────────────────────────────
function EntryFormModal({ t, lang, products, warehouses, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ variant_id: "", warehouse_id: "", quantity: "", reference: "", notes: "", entry_type: "purchase" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const allVariants = products.flatMap((p: Product) => p.variants.map((v: Variant) => ({ ...v, product_name: p.name })));
  const ENTRY_TYPES = [
    { value: "purchase", label: lang === "es" ? "Compra a proveedor" : "Purchase from supplier" },
    { value: "return", label: lang === "es" ? "Devolución de cliente" : "Customer return" },
    { value: "production", label: lang === "es" ? "Producción propia" : "Own production" },
    { value: "consignment", label: lang === "es" ? "Consignación recibida" : "Consignment received" },
    { value: "transfer", label: lang === "es" ? "Transferencia entre almacenes" : "Warehouse transfer" },
  ];
  const handleSave = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 480, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.good + "22", color: t.good, borderRadius: 8, padding: 8, display: "flex" }}><ArrowDownToLine size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Registrar entrada" : "Register entry"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={label}>{lang === "es" ? "Tipo de entrada" : "Entry type"}</label>
            <select value={form.entry_type} onChange={e => setForm(f => ({ ...f, entry_type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {ENTRY_TYPES.map(et => <option key={et.value} value={et.value}>{et.label}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Producto / Variante *" : "Product / Variant *"}</label>
            <select value={form.variant_id} onChange={e => setForm(f => ({ ...f, variant_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {allVariants.map((v: any) => <option key={v.id} value={v.id}>{v.product_name} — {v.sku}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Almacén destino *" : "Destination warehouse *"}</label>
            <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>{lang === "es" ? "Cantidad *" : "Quantity *"}</label><input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={inp} /></div>
            <div><label style={label}>{lang === "es" ? "Referencia" : "Reference"}</label><input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder={lang === "es" ? "Folio, factura…" : "Invoice, order…"} style={inp} /></div>
          </div>
          <div><label style={label}>{lang === "es" ? "Notas" : "Notes"}</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button onClick={handleSave} disabled={saving || !form.variant_id || !form.warehouse_id || !form.quantity} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!form.variant_id || !form.warehouse_id || !form.quantity) ? 0.5 : 1 }}>
            {saving ? "…" : (lang === "es" ? "Registrar entrada" : "Register entry")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Adjustment Form Modal ──────────────────────────────────────────────────
function AdjustmentFormModal({ t, lang, products, warehouses, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ variant_id: "", warehouse_id: "", quantity: "", reference: "", notes: "", reason: "count" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const allVariants = products.flatMap((p: Product) => p.variants.map((v: Variant) => ({ ...v, product_name: p.name })));
  const REASONS = [
    { value: "count", label: lang === "es" ? "Conteo físico" : "Physical count" },
    { value: "damage", label: lang === "es" ? "Merma / Daño" : "Loss / Damage" },
    { value: "theft", label: lang === "es" ? "Robo / Extravío" : "Theft / Loss" },
    { value: "expiry", label: lang === "es" ? "Caducidad" : "Expiry" },
    { value: "other", label: lang === "es" ? "Otro" : "Other" },
  ];
  const qty = Number(form.quantity);
  const handleSave = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 480, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.warn + "22", color: t.warn, borderRadius: 8, padding: 8, display: "flex" }}><SlidersHorizontal size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Ajuste de inventario" : "Inventory adjustment"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={label}>{lang === "es" ? "Motivo del ajuste" : "Adjustment reason"}</label>
            <select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Producto / Variante *" : "Product / Variant *"}</label>
            <select value={form.variant_id} onChange={e => setForm(f => ({ ...f, variant_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {allVariants.map((v: any) => <option key={v.id} value={v.id}>{v.product_name} — {v.sku}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Almacén *" : "Warehouse *"}</label>
            <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Cantidad (negativa para reducir, positiva para aumentar) *" : "Quantity (negative to reduce, positive to increase) *"}</label>
            <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="-5 o +10" style={{ ...inp, color: qty < 0 ? t.bad : qty > 0 ? t.good : t.textHi }} />
            {form.quantity && <div style={{ marginTop: 5, fontSize: 12, color: qty < 0 ? t.bad : qty > 0 ? t.good : t.textLo }}>
              {qty < 0 ? `↓ ${lang === "es" ? "Reducirá" : "Will reduce"} ${Math.abs(qty)} ${lang === "es" ? "unidades" : "units"}` : qty > 0 ? `↑ ${lang === "es" ? "Aumentará" : "Will increase"} ${qty} ${lang === "es" ? "unidades" : "units"}` : ""}
            </div>}
          </div>
          <div><label style={label}>{lang === "es" ? "Notas / Justificación *" : "Notes / Justification *"}</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder={lang === "es" ? "Describe el motivo del ajuste…" : "Describe the reason for this adjustment…"} style={{ ...inp, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button onClick={handleSave} disabled={saving || !form.variant_id || !form.warehouse_id || !form.quantity || !form.notes} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!form.variant_id || !form.warehouse_id || !form.quantity || !form.notes) ? 0.5 : 1 }}>
            {saving ? "…" : (lang === "es" ? "Aplicar ajuste" : "Apply adjustment")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Warehouse Form Modal ───────────────────────────────────────────────────
function WarehouseFormModal({ t, lang, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", location: "", type: "own", is_active: true });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => { setSaving(true); try { await onSave(form); } finally { setSaving(false); } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 440, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><Warehouse size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Nuevo almacén" : "New warehouse"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={label}>{lang === "es" ? "Nombre *" : "Name *"}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={lang === "es" ? "Almacén Principal" : "Main Warehouse"} style={inp} /></div>
          <div><label style={label}>{lang === "es" ? "Ubicación" : "Location"}</label><input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="CDMX, Monterrey…" style={inp} /></div>
          <div><label style={label}>{lang === "es" ? "Tipo de almacén" : "Warehouse type"}</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              {Object.entries(WAREHOUSE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={{ background: t.panel2, borderRadius: 8, padding: 12, fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>
            {form.type === "own" && (lang === "es" ? "Almacén propio: control total de entradas, salidas y transferencias." : "Own warehouse: full control of entries, exits and transfers.")}
            {form.type === "marketplace" && (lang === "es" ? "Marketplace: stock enviado a plataforma (MercadoLibre, Amazon, etc.). Las ventas descuentan automáticamente." : "Marketplace: stock sent to platform (MercadoLibre, Amazon, etc.). Sales auto-discount.")}
            {form.type === "consignment" && (lang === "es" ? "Consignación: stock en poder de un tercero. Se descuenta solo al confirmarse la venta." : "Consignment: stock held by a third party. Only deducted when sale is confirmed.")}
            {form.type === "transit" && (lang === "es" ? "Tránsito: stock en movimiento entre almacenes. No disponible para venta." : "Transit: stock moving between warehouses. Not available for sale.")}
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button onClick={handleSave} disabled={saving || !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.name ? 0.5 : 1 }}>
            {saving ? "…" : (lang === "es" ? "Crear almacén" : "Create warehouse")}
          </button>
        </div>
      </div>
    </div>
  );
}
