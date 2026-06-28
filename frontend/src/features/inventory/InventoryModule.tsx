// InventoryModule.tsx — Módulo de Inventario Premium
// Arquitectura de pestañas: Dashboard · Productos · Almacenes · Proveedores · Entradas · Movimientos · Ajustes · Compras · Recetas · Producción
// Sistema de diseño: mismo contrato { t, s } que App.tsx
// Modo demo automático si el backend no responde

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Package, Warehouse, ArrowDownToLine, ArrowUpFromLine,
  SlidersHorizontal, Search, Plus, Download, Upload, ChevronRight,
  AlertTriangle, BoxSelect, RefreshCw,
  BarChart3, X, Check, Info, FileSpreadsheet, Truck,
  RotateCcw, ArrowLeftRight, Eye, Edit2, Trash2, Trash,
  DollarSign,
  Users, ClipboardList, Factory, FlaskConical,
  FileText, Mail,
} from "lucide-react";
import {
  inventoryService,
  type Product, type Variant, type Warehouse as WarehouseT, type Movement,
  type Supplier, type ReorderAlert, type PurchaseOrder, type PurchaseOrderItem,
  type Recipe, type RecipeItem, type RecipeCostBreakdown, type ProductionOrder,
  type BulkImportResult, type CustomerReturn,
} from "./service";
import { resolveMediaUrl } from "../../services/api";
import ReturnModal from "./ReturnModal";

type Warehouse_ = WarehouseT;

// ── Demo Data ─────────────────────────────────────────────────────────────
const DEMO_PRODUCTS: Product[] = [
  { id: 1, name: "Cemento gris CPC 30R", description: "Bolsa 50kg", category: "Construcción", is_active: true, created_at: "2026-06-01", variants: [{ id: 1, sku: "CEM-GR-50", price: 215, cost_price: 160, is_active: true, stock_levels: [{ variant_id: 1, warehouse_id: 1, quantity: 480, warehouse: { name: "Almacén Principal" } }, { variant_id: 1, warehouse_id: 2, quantity: 120, warehouse: { name: "Sucursal Norte" } }] }] },
  { id: 2, name: "Varilla corrugada 3/8\"", description: "Barra 6m", category: "Acero", is_active: true, created_at: "2026-06-01", variants: [{ id: 2, sku: "VAR-38-6M", price: 178, cost_price: 130, is_active: true, stock_levels: [{ variant_id: 2, warehouse_id: 1, quantity: 1320, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 3, name: "Pintura vinílica blanca 19L", description: "Cubeta 19 litros", category: "Pinturas", is_active: true, created_at: "2026-06-01", variants: [{ id: 3, sku: "PIN-VB-19L", price: 1290, cost_price: 890, is_active: true, stock_levels: [{ variant_id: 3, warehouse_id: 1, quantity: 96, warehouse: { name: "Almacén Principal" } }, { variant_id: 3, warehouse_id: 3, quantity: 24, warehouse: { name: "MercadoLibre" } }] }] },
  { id: 4, name: "Tubo PVC hidráulico 4\"", description: "Tubo 6m", category: "Plomería", is_active: true, created_at: "2026-06-01", variants: [{ id: 4, sku: "TUB-PVC-4", price: 340, cost_price: 240, is_active: true, stock_levels: [{ variant_id: 4, warehouse_id: 1, quantity: 12, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 5, name: "Block hueco 15x20x40", description: "Pieza unitaria", category: "Construcción", is_active: true, created_at: "2026-06-01", variants: [{ id: 5, sku: "BLK-15-20", price: 18, cost_price: 12, is_active: true, stock_levels: [{ variant_id: 5, warehouse_id: 1, quantity: 0, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 6, name: "Cable THW cal. 12", description: "Rollo 100m", category: "Eléctrico", is_active: true, created_at: "2026-06-02", variants: [{ id: 6, sku: "CAB-THW-12", price: 28, cost_price: 19, is_active: true, stock_levels: [{ variant_id: 6, warehouse_id: 1, quantity: 220, warehouse: { name: "Almacén Principal" } }] }] },
  { id: 7, name: "Impermeabilizante 5 años 19L", description: "Cubeta 19 litros", category: "Pinturas", is_active: true, created_at: "2026-06-03", variants: [{ id: 7, sku: "IMP-5A-19L", price: 1490, cost_price: 1050, is_active: true, stock_levels: [{ variant_id: 7, warehouse_id: 1, quantity: 64, warehouse: { name: "Almacén Principal" } }, { variant_id: 7, warehouse_id: 3, quantity: 8, warehouse: { name: "MercadoLibre" } }] }] },
];
const DEMO_WAREHOUSES: Warehouse_[] = [
  { id: 1, name: "Almacén Principal", location: "CDMX - Bodega Central", is_active: true, type: "own" },
  { id: 2, name: "Sucursal Norte", location: "Monterrey", is_active: true, type: "own" },
  { id: 3, name: "MercadoLibre", location: "Fulfillment ML", is_active: true, type: "marketplace" },
  { id: 4, name: "Consignación Robles", location: "Constructora Robles - Obra Norte", is_active: true, type: "consignment" },
];
const DEMO_MOVEMENTS: Movement[] = [
  { id: 1, variant_id: 1, warehouse_id: 1, quantity: 200, movement_type: "in", reference: "OC-2041", notes: "Compra proveedor", created_at: "2026-06-10T09:00:00Z", product_name: "Cemento gris CPC 30R", sku: "CEM-GR-50", warehouse_name: "Almacén Principal" },
  { id: 2, variant_id: 3, warehouse_id: 3, quantity: 24, movement_type: "in", reference: "ENV-ML-001", notes: "Envío a Fulfillment MercadoLibre", created_at: "2026-06-09T14:30:00Z", product_name: "Pintura vinílica blanca 19L", sku: "PIN-VB-19L", warehouse_name: "MercadoLibre" },
  { id: 3, variant_id: 2, warehouse_id: 1, quantity: -80, movement_type: "out", reference: "VTA-2041", notes: "Venta pedido", created_at: "2026-06-09T11:00:00Z", product_name: "Varilla corrugada 3/8\"", sku: "VAR-38-6M", warehouse_name: "Almacén Principal" },
  { id: 4, variant_id: 5, warehouse_id: 1, quantity: -50, movement_type: "out", reference: "VTA-2039", notes: "Venta pedido", created_at: "2026-06-08T16:00:00Z", product_name: "Block hueco 15x20x40", sku: "BLK-15-20", warehouse_name: "Almacén Principal" },
  { id: 5, variant_id: 6, warehouse_id: 1, quantity: 5, movement_type: "adjustment", reference: "AJU-001", notes: "Corrección conteo físico", created_at: "2026-06-07T10:00:00Z", product_name: "Cable THW cal. 12", sku: "CAB-THW-12", warehouse_name: "Almacén Principal" },
];

const WAREHOUSE_TYPES = { own: { label: "Propio", color: "#33B2F5" }, marketplace: { label: "Marketplace", color: "#FBBF24" }, consignment: { label: "Consignación", color: "#A78BFA" }, transit: { label: "Tránsito", color: "#34D399" } };
const MOVEMENT_TYPES = { in: { label: "Entrada", color: "#34D399", icon: ArrowDownToLine }, out: { label: "Salida", color: "#F87171", icon: ArrowUpFromLine }, adjustment: { label: "Ajuste", color: "#FBBF24", icon: SlidersHorizontal } };
const PO_STATUS = { draft: { label: "Borrador", color: "#94A3B8" }, ordered: { label: "Enviada", color: "#33B2F5" }, received: { label: "Recibida", color: "#34D399" }, cancelled: { label: "Cancelada", color: "#F87171" } };
const PROD_STATUS = { draft: { label: "Borrador", color: "#94A3B8" }, completed: { label: "Completada", color: "#34D399" }, cancelled: { label: "Cancelada", color: "#F87171" } };

// ── Helpers ────────────────────────────────────────────────────────────────
const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalStock = (p: Product) => p.variants.reduce((a, v) => a + (v.stock_levels?.reduce((s, l) => s + l.quantity, 0) || 0), 0);
const inventoryValue = (p: Product) => p.variants.reduce((a, v) => a + (v.cost_price || v.price) * (v.stock_levels?.reduce((s, l) => s + l.quantity, 0) || 0), 0);
const margin = (v: Variant) => v.cost_price && v.price ? Math.round(((v.price - v.cost_price) / v.price) * 100) : null;

// Vidrio: en modo oscuro devuelve panel translúcido + blur; en claro, sólido.
const glass = (t: any): React.CSSProperties =>
  t?.name === "dark"
    ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
    : { background: t.panel, border: `1px solid ${t.border}` };

const isNetworkError = (err: any) => !err?.response;

const csvEscape = (v: any) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCSV = (filename: string, rows: (string | number)[][]) => {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const exportMovementsCSV = (movements: Movement[]) => {
  const header = ["Tipo", "Producto", "SKU", "Almacén", "Cantidad", "Costo unitario", "Referencia", "Notas", "Fecha"];
  const rows = movements.map(m => [
    m.movement_type, m.product_name || "", m.sku || "", m.warehouse_name || "",
    m.quantity, m.unit_cost ?? "", m.reference || "", m.notes || "",
    new Date(m.created_at).toLocaleString("es-MX"),
  ]);
  downloadCSV(`movimientos_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
};

type Tab = "dashboard" | "products" | "warehouses" | "suppliers" | "entries" | "movements" | "adjustments" | "purchase-orders" | "recipes" | "production" | "import";

// ── Main Component ─────────────────────────────────────────────────────────
export default function InventoryModule({ t, s, initialQuery }: { t: any; s: any; initialQuery?: string }) {
  const [tab, setTab] = useState<Tab>(initialQuery ? "products" : "dashboard");
  const [demo, setDemo] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse_[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string; is_primary: boolean }[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reorderAlerts, setReorderAlerts] = useState<ReorderAlert[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms
  const [productForm, setProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [warehouseForm, setWarehouseForm] = useState(false);
  const [entryForm, setEntryForm] = useState(false);
  const [returnModal, setReturnModal] = useState(false);
  const [returns, setReturns] = useState<CustomerReturn[]>([]);
  const [adjustForm, setAdjustForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseT | null>(null);
  const [poForm, setPoForm] = useState(false);
  const [editingPO, setEditingPO] = useState<PurchaseOrder | null>(null);
  const [recipeForm, setRecipeForm] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [prodOrderForm, setProdOrderForm] = useState(false);
  const [recipeCostView, setRecipeCostView] = useState<{ recipe: Recipe; cost: RecipeCostBreakdown } | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Carga masiva
  const [productsImportBusy, setProductsImportBusy] = useState(false);
  const [productsImportResult, setProductsImportResult] = useState<BulkImportResult | null>(null);
  const [productsImportError, setProductsImportError] = useState<string | null>(null);
  const [productsDragging, setProductsDragging] = useState(false);
  const [recipesImportBusy, setRecipesImportBusy] = useState(false);
  const [recipesImportResult, setRecipesImportResult] = useState<BulkImportResult | null>(null);
  const [recipesImportError, setRecipesImportError] = useState<string | null>(null);
  const [recipesDragging, setRecipesDragging] = useState(false);

  // Filters
  const [q, setQ] = useState(initialQuery || "");
  useEffect(() => { if (initialQuery) { setQ(initialQuery); setTab("products"); } }, [initialQuery]);
  const [catFilter, setCatFilter] = useState("");
  const [whFilter, setWhFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [supQ, setSupQ] = useState("");
  const [poQ, setPoQ] = useState("");
  const [recipeQ, setRecipeQ] = useState("");
  const [prodOrderQ, setProdOrderQ] = useState("");

  const lang = s?.nav ? "es" : "en";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, wh, mv, sup, alerts, pos, recs, prods] = await Promise.all([
        inventoryService.getProducts(),
        inventoryService.getWarehouses(),
        inventoryService.getMovements(),
        inventoryService.getSuppliers(),
        inventoryService.getReorderAlerts(),
        inventoryService.getPurchaseOrders(),
        inventoryService.getRecipes(),
        inventoryService.getProductionOrders(),
      ]);
      setProducts(pr); setWarehouses(wh); setMovements(mv); setSuppliers(sup);
      setReorderAlerts(alerts); setPurchaseOrders(pos); setRecipes(recs); setProductionOrders(prods);
      inventoryService.getBranches().then(setBranches).catch(() => setBranches([]));
      inventoryService.getReturns().then(setReturns).catch(() => setReturns([]));
      setDemo(false);
    } catch (err) {
      if (isNetworkError(err)) {
        setDemo(true);
        setProducts(DEMO_PRODUCTS);
        setWarehouses(DEMO_WAREHOUSES);
        setMovements(DEMO_MOVEMENTS);
        setSuppliers([]); setReorderAlerts([]); setPurchaseOrders([]); setRecipes([]); setProductionOrders([]);
      } else {
        setDemo(false);
        console.error("Error cargando inventario:", err);
      }
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
    const openPOs = purchaseOrders.filter(po => po.status === "draft" || po.status === "ordered").length;
    const activeRecipes = recipes.filter(r => r.is_active).length;
    return { totalVal, outOfStock, lowStock, totalProds, activeProds, openPOs, activeRecipes };
  }, [products, purchaseOrders, recipes]);

  const filteredProducts = useMemo(() => products.filter(p => {
    const qs = q.toLowerCase();
    const matchQ = !q || p.name.toLowerCase().includes(qs) || p.variants.some(v => v.sku.toLowerCase().includes(qs)) || (p.category || "").toLowerCase().includes(qs);
    const matchCat = !catFilter || p.category === catFilter;
    const matchWh = !whFilter || p.variants.some(v => v.stock_levels?.some(l => String(l.warehouse_id) === whFilter));
    const matchStatus = !statusFilter
      || (statusFilter === "active" && p.is_active)
      || (statusFilter === "inactive" && !p.is_active)
      || (statusFilter === "out" && totalStock(p) === 0)
      || (statusFilter === "low" && totalStock(p) > 0 && totalStock(p) < 20);
    return matchQ && matchCat && matchWh && matchStatus;
  }), [products, q, catFilter, whFilter, statusFilter]);

  const availableCategories = useMemo(() => {
    return Array.from(new Set(products.map(p => (p.category || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);

  const filteredMovements = useMemo(() => movements.filter(m => {
    const matchType = !movTypeFilter || m.movement_type === movTypeFilter;
    const matchQ = !q || (m.product_name || "").toLowerCase().includes(q.toLowerCase()) || (m.sku || "").toLowerCase().includes(q.toLowerCase());
    return matchType && matchQ;
  }), [movements, movTypeFilter, q]);

  const allVariantsWithProduct = useMemo(() => products.flatMap(p => p.variants.map(v => ({ ...v, product_name: p.name }))), [products]);
  const productNameByVariant = useMemo(() => {
    const map = new Map<number, string>();
    products.forEach(p => p.variants.forEach(v => map.set(v.id, p.name)));
    return map;
  }, [products]);
  const warehouseNameById = useMemo(() => {
    const map = new Map<number, string>();
    warehouses.forEach(w => map.set(w.id, w.name));
    return map;
  }, [warehouses]);
  const supplierNameById = useMemo(() => {
    const map = new Map<number, string>();
    suppliers.forEach(sup => map.set(sup.id, sup.name));
    return map;
  }, [suppliers]);
  const recipeNameById = useMemo(() => {
    const map = new Map<number, string>();
    recipes.forEach(r => map.set(r.id, r.name || `${lang === "es" ? "Receta" : "Recipe"} #${r.id}`));
    return map;
  }, [recipes, lang]);

  const filteredSuppliers = useMemo(() => suppliers.filter(sup => {
    if (!supQ) return true;
    const qs = supQ.toLowerCase();
    return sup.name.toLowerCase().includes(qs) || (sup.contact_name || "").toLowerCase().includes(qs) || (sup.email || "").toLowerCase().includes(qs) || (sup.phone || "").toLowerCase().includes(qs) || (sup.rfc || "").toLowerCase().includes(qs);
  }), [suppliers, supQ]);

  const filteredPurchaseOrders = useMemo(() => purchaseOrders.filter(po => {
    if (!poQ) return true;
    const qs = poQ.toLowerCase();
    const supName = supplierNameById.get(po.supplier_id) || "";
    const whName = warehouseNameById.get(po.warehouse_id) || "";
    return (po.folio || `PO-${po.id}`).toLowerCase().includes(qs) || supName.toLowerCase().includes(qs) || whName.toLowerCase().includes(qs);
  }), [purchaseOrders, poQ, supplierNameById, warehouseNameById]);

  const filteredRecipes = useMemo(() => recipes.filter(r => {
    if (!recipeQ) return true;
    const qs = recipeQ.toLowerCase();
    const outName = productNameByVariant.get(r.output_variant_id) || "";
    return (r.name || "").toLowerCase().includes(qs) || outName.toLowerCase().includes(qs);
  }), [recipes, recipeQ, productNameByVariant]);

  const filteredProductionOrders = useMemo(() => productionOrders.filter(po => {
    if (!prodOrderQ) return true;
    const qs = prodOrderQ.toLowerCase();
    const recName = recipeNameById.get(po.recipe_id) || "";
    const whName = warehouseNameById.get(po.warehouse_id) || "";
    return (po.folio || `PR-${po.id}`).toLowerCase().includes(qs) || recName.toLowerCase().includes(qs) || whName.toLowerCase().includes(qs);
  }), [productionOrders, prodOrderQ, recipeNameById, warehouseNameById]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const tabBtn = (active: boolean) => ({ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 13, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s" });

  const TABS = [
    { id: "dashboard", label: lang === "es" ? "Dashboard" : "Dashboard", icon: LayoutDashboard },
    { id: "products", label: lang === "es" ? "Productos" : "Products", icon: Package },
    { id: "warehouses", label: lang === "es" ? "Almacenes" : "Warehouses", icon: Warehouse },
    { id: "suppliers", label: lang === "es" ? "Proveedores" : "Suppliers", icon: Users },
    { id: "entries", label: lang === "es" ? "Entradas" : "Entries", icon: ArrowDownToLine },
    { id: "movements", label: lang === "es" ? "Movimientos" : "Movements", icon: ArrowLeftRight },
    { id: "adjustments", label: lang === "es" ? "Ajustes" : "Adjustments", icon: SlidersHorizontal },
    { id: "purchase-orders", label: lang === "es" ? "Compras" : "Purchase orders", icon: ClipboardList },
    { id: "recipes", label: lang === "es" ? "Construcción" : "Recipes / BOM", icon: FlaskConical },
    { id: "production", label: lang === "es" ? "Producción" : "Production", icon: Factory },
    { id: "import", label: lang === "es" ? "Carga masiva" : "Bulk import", icon: Upload },
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
          <button key={id} onClick={() => setTab(id as Tab)} style={tabBtn(tab === id)}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><Icon size={14} />{label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: Dashboard ── */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {[
              { label: lang === "es" ? "Valor del inventario" : "Inventory value", value: mxn(kpis.totalVal), icon: DollarSign, color: t.nova, sub: lang === "es" ? "al costo" : "at cost" },
              { label: lang === "es" ? "Total productos" : "Total products", value: String(kpis.totalProds), icon: Package, color: t.good, sub: `${kpis.activeProds} ${lang === "es" ? "activos" : "active"}` },
              { label: lang === "es" ? "Agotados" : "Out of stock", value: String(kpis.outOfStock), icon: BoxSelect, color: t.bad, sub: lang === "es" ? "requieren reorden" : "need reorder" },
              { label: lang === "es" ? "Almacenes" : "Warehouses", value: String(warehouses.filter(w => w.is_active).length), icon: Warehouse, color: "#A78BFA", sub: lang === "es" ? "activos" : "active" },
              { label: lang === "es" ? "Compras abiertas" : "Open purchase orders", value: String(kpis.openPOs), icon: ClipboardList, color: "#33B2F5", sub: lang === "es" ? "pendientes de recibir" : "pending receipt" },
              { label: lang === "es" ? "Recetas activas" : "Active recipes", value: String(kpis.activeRecipes), icon: FlaskConical, color: t.warn, sub: lang === "es" ? "BOM en producción" : "BOM in production" },
            ].map((k) => (
              <div key={k.label} style={{ ...glass(t), borderRadius: 12, padding: "14px 14px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ background: k.color + "22", color: k.color, borderRadius: 9, padding: 8, display: "flex", width: "fit-content" }}><k.icon size={16} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: t.textLo, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: t.textHi, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.value}</div>
                  <div style={{ fontSize: 10.5, color: t.textLo, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Reorder alerts (real data) or heuristic fallback (demo) */}
          {!demo && reorderAlerts.length > 0 && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={16} color={t.warn} /> {lang === "es" ? "Alertas de reorden" : "Reorder alerts"}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr>
                      {[lang === "es" ? "SKU" : "SKU", lang === "es" ? "Producto" : "Product", lang === "es" ? "Almacén" : "Warehouse", lang === "es" ? "Disponible" : "Available", lang === "es" ? "Punto reorden" : "Reorder pt.", lang === "es" ? "Stock seg." : "Safety stock", lang === "es" ? "Nivel" : "Level", lang === "es" ? "Proveedor" : "Supplier", lang === "es" ? "Lead time" : "Lead time"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.borderSoft}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reorderAlerts.map((a, i) => (
                      <tr key={`${a.variant_id}-${a.warehouse_id}`} style={{ background: i % 2 === 0 ? "transparent" : (t.name === "dark" ? "rgba(255,255,255,0.02)" : t.panel2) }}>
                        <td style={{ padding: "10px 12px", fontSize: 12, color: t.nova, fontFamily: "monospace", fontWeight: 600 }}>{a.sku}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, color: t.textHi, fontWeight: 600 }}>{a.product_name}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid }}>{a.warehouse_name}</td>
                        <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: a.level === "red" ? t.bad : t.warn }}>{a.available}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid }}>{a.reorder_point}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid }}>{a.safety_stock}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: a.level === "red" ? t.bad : t.warn, background: (a.level === "red" ? t.bad : t.warn) + "18", padding: "3px 9px", borderRadius: 20 }}>{a.level === "red" ? (lang === "es" ? "CRÍTICO" : "CRITICAL") : (lang === "es" ? "BAJO" : "LOW")}</span>
                        </td>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textMid }}>{a.preferred_supplier_name || "—"}</td>
                        <td style={{ padding: "10px 12px", fontSize: 12.5, color: t.textLo }}>{a.lead_time_days != null ? `${a.lead_time_days} ${lang === "es" ? "días" : "days"}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(demo && (kpis.outOfStock > 0 || kpis.lowStock > 0)) && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
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
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
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
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <ArrowLeftRight size={16} color={t.nova} /> {lang === "es" ? "Movimientos recientes" : "Recent movements"}
            </div>
            {movements.slice(0, 5).map(m => {
              const mt = MOVEMENT_TYPES[String(m.movement_type).toLowerCase()] || MOVEMENT_TYPES.adjustment;
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
              {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Almacén" : "Warehouse"}</option>
              {warehouses.map(w => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: "auto", cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Estado" : "Status"}</option>
              <option value="active">{lang === "es" ? "Activos" : "Active"}</option>
              <option value="inactive">{lang === "es" ? "Inactivos" : "Inactive"}</option>
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

          {/* Table (sólida para legibilidad) */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Imagen" : "Image", lang === "es" ? "Producto" : "Product", "SKU", lang === "es" ? "Categoría" : "Category", lang === "es" ? "Stock total" : "Total stock", lang === "es" ? "Valor inventario" : "Inv. value", lang === "es" ? "Precio venta" : "Sale price", lang === "es" ? "Margen" : "Margin", lang === "es" ? "Estado" : "Status", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 9 }).map((__, c) => (
                          <td key={c} style={{ padding: "14px 16px" }}>
                            <div style={{ height: 12, borderRadius: 6, background: t.panel3, width: c === 0 ? "70%" : "50%", animation: "shimmer 1.4s ease infinite" }} />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))
                  ) : filteredProducts.length === 0 ? (
                    <tr><td colSpan={10} style={{ textAlign: "center", padding: 48, color: t.textLo, fontSize: 14 }}>
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
                        <td style={{ padding: "10px 16px" }}>
                          {p.image_url
                            ? <img src={resolveMediaUrl(p.image_url)} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: `1px solid ${t.border}`, display: "block" }}
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; const sib = e.currentTarget.nextElementSibling as HTMLElement; if (sib) sib.style.display = "flex"; }} />
                            : null}
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: t.panel3, border: `1px solid ${t.border}`, display: p.image_url ? "none" : "flex", alignItems: "center", justifyContent: "center", color: t.textLo }}><Package size={16} /></div>
                        </td>
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
            <button onClick={() => { setEditingWarehouse(null); setWarehouseForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nuevo almacén" : "New warehouse"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {warehouses.map(w => {
              const wt = WAREHOUSE_TYPES[w.type || "own"] || WAREHOUSE_TYPES.own;
              const stockInWh = products.reduce((a, p) => a + p.variants.reduce((b, v) => b + (v.stock_levels?.filter(l => l.warehouse_id === w.id).reduce((c, l) => c + l.quantity, 0) || 0), 0), 0);
              const skusInWh = products.filter(p => p.variants.some(v => v.stock_levels?.some(l => l.warehouse_id === w.id && l.quantity > 0))).length;
              return (
                <div key={w.id} onClick={() => { setWhFilter(String(w.id)); setTab("products"); }} title={lang === "es" ? "Ver productos de este almacén" : "View this warehouse's products"} style={{ ...glass(t), borderRadius: 12, padding: 20, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ background: wt.color + "22", color: wt.color, borderRadius: 10, padding: 9, display: "flex" }}><Warehouse size={18} /></div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{w.name}</div>
                        <div style={{ fontSize: 12, color: t.textLo, marginTop: 2 }}>{w.location || "—"}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: wt.color, background: wt.color + "18", padding: "3px 8px", borderRadius: 6 }}>{wt.label}</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditingWarehouse(w); setWarehouseForm(true); }} title={lang === "es" ? "Editar almacén" : "Edit warehouse"} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}>
                        <Edit2 size={14} />
                      </button>
                    </div>
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

      {/* ── TAB: Suppliers ── */}
      {tab === "suppliers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={supQ} onChange={e => setSupQ(e.target.value)} placeholder={lang === "es" ? "Buscar proveedor…" : "Search supplier…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => { setEditingSupplier(null); setSupplierForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nuevo proveedor" : "New supplier"}
            </button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Proveedor" : "Supplier", lang === "es" ? "Contacto" : "Contact", lang === "es" ? "Teléfono/Email" : "Phone/Email", lang === "es" ? "Lead time" : "Lead time", lang === "es" ? "Términos de pago" : "Payment terms", lang === "es" ? "Estado" : "Status", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin proveedores registrados" : "No suppliers registered"}</td></tr>
                  ) : filteredSuppliers.map((sup, i) => (
                    <tr key={sup.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2, cursor: "pointer" }} onClick={() => { setEditingSupplier(sup); setSupplierForm(true); }}>
                      <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{sup.name}{sup.rfc && <div style={{ fontSize: 11, color: t.textLo, fontFamily: "monospace" }}>{sup.rfc}</div>}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{sup.contact_name || "—"}</td>
                      <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textMid }}>{[sup.phone, sup.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{sup.lead_time_days != null ? `${sup.lead_time_days} ${lang === "es" ? "días" : "days"}` : "—"}</td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{sup.payment_terms || "—"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: sup.is_active ? t.good : t.bad, background: (sup.is_active ? t.good : t.bad) + "18", padding: "3px 9px", borderRadius: 20 }}>
                          {sup.is_active ? (lang === "es" ? "Activo" : "Active") : (lang === "es" ? "Inactivo" : "Inactive")}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
                        <Edit2 size={14} color={t.textLo} />
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          const action = sup.is_active ? (lang === "es" ? "desactivar" : "deactivate") : (lang === "es" ? "reactivar" : "reactivate");
                          if (!confirm(lang === "es" ? `¿Seguro que quieres ${action} a ${sup.name}?` : `Are you sure you want to ${action} ${sup.name}?`)) return;
                          try { await inventoryService.updateSupplier(sup.id, { ...sup, is_active: !sup.is_active }); await load(); } catch (err) { console.error(err); alert(lang === "es" ? "Error al actualizar el proveedor" : "Error updating supplier"); }
                        }} title={sup.is_active ? (lang === "es" ? "Desactivar proveedor" : "Deactivate supplier") : (lang === "es" ? "Reactivar proveedor" : "Reactivate supplier")} style={{ background: "transparent", border: "none", cursor: "pointer", color: sup.is_active ? t.bad : t.good, display: "flex" }}>
                          <Trash2 size={14} />
                        </button>
                        <button onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(lang === "es" ? `Eliminar permanentemente a ${sup.name}. Esta acción no se puede deshacer y solo la puede hacer el encargado de inventarios o el administrador general. ¿Continuar?` : `Permanently delete ${sup.name}. This cannot be undone and is restricted to inventory managers / admins. Continue?`)) return;
                          try { await inventoryService.deleteSupplier(sup.id); await load(); } catch (err: any) { console.error(err); alert(err?.response?.data?.detail || (lang === "es" ? "No tienes permiso para eliminar proveedores, o el proveedor tiene órdenes de compra asociadas." : "You don't have permission to delete suppliers, or the supplier has associated purchase orders.")); }
                        }} title={lang === "es" ? "Eliminar proveedor (solo Inventario/Admin)" : "Delete supplier (Inventory/Admin only)"} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.bad, display: "flex" }}>
                          <Trash size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Entries ── */}
      {tab === "entries" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {[
              { icon: FileSpreadsheet, title: lang === "es" ? "Entrada manual" : "Manual entry", desc: lang === "es" ? "Registra entradas producto por producto" : "Register entries one by one", color: t.nova, action: () => setEntryForm(true) },
              { icon: Upload, title: lang === "es" ? "Importar plantilla" : "Import template", desc: lang === "es" ? "Sube un CSV/Excel con múltiples productos" : "Upload a CSV/Excel with multiple products", color: t.good, action: () => setTab("import") },
              { icon: Truck, title: lang === "es" ? "Orden de compra" : "Purchase order", desc: lang === "es" ? "Recibe mercancía de una orden existente" : "Receive goods from an existing order", color: "#A78BFA", action: () => setTab("purchase-orders") },
              { icon: RotateCcw, title: lang === "es" ? "Devolución de cliente" : "Customer return", desc: lang === "es" ? "Regresa stock por devolución" : "Return stock from customer return", color: t.warn, action: () => demo ? alert(lang === "es" ? "Modo demo: backend no disponible para devoluciones." : "Demo mode: backend unavailable for returns.") : setReturnModal(true) },
            ].map(card => (
              <button key={card.title} onClick={card.action} style={{ ...glass(t), borderRadius: 12, padding: 20, textAlign: "left", cursor: "pointer", transition: "transform .12s, box-shadow .12s" }}
                onMouseEnter={e => { (e.currentTarget as any).style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { (e.currentTarget as any).style.transform = ""; }}>
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
          <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14 }}>{lang === "es" ? "Entradas recientes" : "Recent entries"}</div>
            {movements.filter(m => m.movement_type === "in").slice(0, 5).map(m => (
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

          {/* Recent customer returns */}
          {returns.length > 0 && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.textHi, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <RotateCcw size={16} color={t.warn} /> {lang === "es" ? "Devoluciones recientes" : "Recent returns"}
              </div>
              {returns.slice(0, 6).map(r => {
                const units = r.items.reduce((a, it) => a + (it.quantity || 0), 0);
                const cancelled = r.status === "cancelled";
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}`, opacity: cancelled ? 0.5 : 1 }}>
                    <div style={{ background: t.warn + "22", color: t.warn, borderRadius: 8, padding: 7, display: "flex" }}><RotateCcw size={14} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>
                        <span style={{ fontFamily: "monospace", color: t.nova }}>{r.folio || `#${r.id}`}</span>
                        {r.order_folio && <span style={{ color: t.textLo, fontWeight: 400 }}> · {lang === "es" ? "pedido" : "order"} {r.order_folio}</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: t.textLo }}>
                        {units} {lang === "es" ? "uds." : "units"}{r.customer_name ? ` · ${r.customer_name}` : ""}{r.reason ? ` · ${r.reason}` : ""}
                        {r.settlement_type === "refund" && ` · ${lang === "es" ? "Reembolso" : "Refund"} ${mxn(r.refund_amount)}`}
                        {r.settlement_type === "store_credit" && ` · ${lang === "es" ? "Saldo a favor" : "Store credit"} ${mxn(r.refund_amount)}`}
                      </div>
                    </div>
                    {cancelled
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: t.bad, background: t.bad + "18", padding: "3px 9px", borderRadius: 20 }}>{lang === "es" ? "CANCELADA" : "CANCELLED"}</span>
                      : (
                        <button onClick={async () => {
                          if (!confirm(lang === "es" ? `¿Cancelar la devolución ${r.folio}? Se revertirá el stock re-ingresado y el reembolso.` : `Cancel return ${r.folio}? Restocked items and refund will be reversed.`)) return;
                          try { await inventoryService.cancelReturn(r.id); load(); }
                          catch { alert(lang === "es" ? "No se pudo cancelar" : "Could not cancel"); }
                        }} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: t.textLo, fontSize: 11.5 }}>
                          {lang === "es" ? "Cancelar" : "Cancel"}
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          )}
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
              <option value="in">{lang === "es" ? "Entradas" : "Entries"}</option>
              <option value="out">{lang === "es" ? "Salidas" : "Exits"}</option>
              <option value="adjustment">{lang === "es" ? "Ajustes" : "Adjustments"}</option>
            </select>
            <button onClick={() => exportMovementsCSV(filteredMovements)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>
              <Download size={14} /> {lang === "es" ? "Exportar" : "Export"}
            </button>
          </div>

          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Tipo", "Producto", "SKU", "Almacén", "Cantidad", "Costo unit.", "Referencia", "Notas", "Fecha"].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: t.textLo }}>{lang === "es" ? "Sin movimientos" : "No movements"}</td></tr>
                  ) : filteredMovements.map((m, i) => {
                    const mt = MOVEMENT_TYPES[String(m.movement_type).toLowerCase()] || MOVEMENT_TYPES.adjustment;
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
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textMid }}>{m.unit_cost != null ? mxn(m.unit_cost) : "—"}</td>
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
            {movements.filter(m => m.movement_type === "adjustment").length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin ajustes registrados" : "No adjustments recorded"}</div>
            ) : movements.filter(m => m.movement_type === "adjustment").map((m, i) => (
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
                <button onClick={async () => {
                  if (!confirm(lang === "es" ? `¿Revertir este ajuste? Se creará un ajuste contrario de ${-m.quantity} unidades para corregir el error, sin borrar el registro original.` : `Revert this adjustment? An opposite adjustment of ${-m.quantity} units will be created to fix the mistake, without deleting the original record.`)) return;
                  try {
                    await inventoryService.adjustStock({
                      variant_id: m.variant_id, warehouse_id: m.warehouse_id, quantity: -m.quantity,
                      movement_type: "adjustment", notes: `${lang === "es" ? "Reversión del ajuste" : "Reversal of adjustment"} #${m.id}`,
                    });
                    await load();
                  } catch (err) { console.error(err); alert(lang === "es" ? "Error al revertir el ajuste" : "Error reverting adjustment"); }
                }} title={lang === "es" ? "Revertir (crea un ajuste contrario)" : "Revert (creates an opposite adjustment)"} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: t.textLo, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                  <RotateCcw size={13} /> {lang === "es" ? "Revertir" : "Revert"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB: Purchase Orders ── */}
      {tab === "purchase-orders" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={poQ} onChange={e => setPoQ(e.target.value)} placeholder={lang === "es" ? "Buscar folio, proveedor o almacén…" : "Search folio, supplier or warehouse…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => { setEditingPO(null); setPoForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nueva orden" : "New order"}
            </button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Folio" : "Folio", lang === "es" ? "Proveedor" : "Supplier", lang === "es" ? "Almacén" : "Warehouse", lang === "es" ? "Estado" : "Status", lang === "es" ? "Artículos" : "Items", lang === "es" ? "Creada" : "Created", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchaseOrders.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin órdenes de compra" : "No purchase orders"}</td></tr>
                  ) : filteredPurchaseOrders.map((po, i) => {
                    const st = PO_STATUS[po.status] || PO_STATUS.draft;
                    const canReceive = po.status === "draft" || po.status === "ordered";
                    return (
                      <tr key={po.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.nova, fontFamily: "monospace", fontWeight: 700 }}>{po.folio || `PO-${po.id}`}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{supplierNameById.get(po.supplier_id) || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{warehouseNameById.get(po.warehouse_id) || "—"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.color + "18", padding: "3px 9px", borderRadius: 20 }}>{st.label}</span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{po.items?.length || 0}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>{new Date(po.created_at).toLocaleDateString("es-MX")}</td>
                        <td style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={async () => {
                            if (demo) { alert(lang === "es" ? "Modo demo: PDF no disponible" : "Demo mode: PDF unavailable"); return; }
                            try { await inventoryService.downloadPurchaseOrderPdf(po.id, po.folio); } catch (err) { console.error(err); alert(lang === "es" ? "Error al generar el PDF" : "Error generating PDF"); }
                          }} title={lang === "es" ? "Descargar PDF" : "Download PDF"} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                            <FileText size={14} /> PDF
                          </button>
                          <button onClick={async () => {
                            if (demo) { alert(lang === "es" ? "Modo demo: correo no disponible" : "Demo mode: email unavailable"); return; }
                            const to = prompt(lang === "es" ? "Correo del destinatario (vacío = usar el del proveedor):" : "Recipient email (empty = use supplier's):", "");
                            if (to === null) return;
                            try {
                              const r = await inventoryService.emailPurchaseOrder(po.id, to || undefined);
                              alert(r.sent ? (lang === "es" ? `Orden enviada a ${r.to}` : `Order sent to ${r.to}`) : (lang === "es" ? "No se pudo enviar: revisa la configuración de correo (Configuración > Integraciones)." : "Could not send: check email settings (Settings > Integrations)."));
                            } catch (err: any) { console.error(err); alert(err?.response?.data?.detail || (lang === "es" ? "Error al enviar el correo" : "Error sending email")); }
                          }} title={lang === "es" ? "Enviar por correo" : "Send by email"} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                            <Mail size={14} /> {lang === "es" ? "Correo" : "Email"}
                          </button>
                          {canReceive && (
                            <button onClick={() => { setEditingPO(po); setPoForm(true); }} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              {lang === "es" ? "Editar" : "Edit"}
                            </button>
                          )}
                          {canReceive && (
                            <button onClick={async () => {
                              if (!confirm(lang === "es" ? "¿Recibir esta orden? Esto generará lotes FIFO y actualizará el stock. Esta acción es irreversible." : "Receive this order? This will create FIFO lots and update stock. This action is irreversible.")) return;
                              try { await inventoryService.receivePurchaseOrder(po.id); await load(); } catch (err) { console.error(err); alert(lang === "es" ? "Error al recibir la orden" : "Error receiving order"); }
                            }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: t.good, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              {lang === "es" ? "Recibir" : "Receive"}
                            </button>
                          )}
                          {canReceive && (
                            <button onClick={async () => {
                              if (!confirm(lang === "es" ? "¿Cancelar esta orden de compra? No podrá recibirse después." : "Cancel this purchase order? It can't be received afterwards.")) return;
                              try { await inventoryService.cancelPurchaseOrder(po.id); await load(); } catch (err) { console.error(err); alert(lang === "es" ? "Error al cancelar la orden" : "Error cancelling order"); }
                            }} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.bad, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              {lang === "es" ? "Cancelar" : "Cancel"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Recipes / BOM ── */}
      {tab === "recipes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={recipeQ} onChange={e => setRecipeQ(e.target.value)} placeholder={lang === "es" ? "Buscar receta o producto…" : "Search recipe or product…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => { setEditingRecipe(null); setRecipeForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nueva receta" : "New recipe"}
            </button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Producto resultante" : "Output product", lang === "es" ? "Nombre" : "Name", lang === "es" ? "Rendimiento" : "Yield", lang === "es" ? "Mano de obra" : "Labor cost", lang === "es" ? "Indirectos" : "Overhead", lang === "es" ? "Estado" : "Status", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecipes.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin recetas registradas" : "No recipes registered"}</td></tr>
                  ) : filteredRecipes.map((r, i) => {
                    const outName = productNameByVariant.get(r.output_variant_id) || "—";
                    return (
                      <tr key={r.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{outName}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{r.name || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{r.yield_quantity}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{mxn(r.labor_cost)}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{mxn(r.overhead_cost)}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: 11.5, fontWeight: 600, color: r.is_active ? t.good : t.bad, background: (r.is_active ? t.good : t.bad) + "18", padding: "3px 9px", borderRadius: 20 }}>
                            {r.is_active ? (lang === "es" ? "Activa" : "Active") : (lang === "es" ? "Inactiva" : "Inactive")}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
                          <button onClick={async () => {
                            try { const cost = await inventoryService.getRecipeCost(r.id); setRecipeCostView({ recipe: r, cost }); } catch (err) { console.error(err); alert(lang === "es" ? "Error al calcular el costo" : "Error computing cost"); }
                          }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12 }}>
                            <Eye size={13} /> {lang === "es" ? "Ver costo" : "View cost"}
                          </button>
                          <button onClick={() => { setEditingRecipe(r); setRecipeForm(true); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><Edit2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Production Orders ── */}
      {tab === "production" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={prodOrderQ} onChange={e => setProdOrderQ(e.target.value)} placeholder={lang === "es" ? "Buscar folio, receta o almacén…" : "Search folio, recipe or warehouse…"} style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => setProdOrderForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> {lang === "es" ? "Nueva orden de producción" : "New production order"}
            </button>
          </div>
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {[lang === "es" ? "Folio" : "Folio", lang === "es" ? "Receta" : "Recipe", lang === "es" ? "Almacén" : "Warehouse", lang === "es" ? "Corridas" : "Runs", lang === "es" ? "Estado" : "Status", lang === "es" ? "Costo unitario" : "Unit cost", lang === "es" ? "Fecha" : "Date", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProductionOrders.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: t.textLo, fontSize: 14 }}>{lang === "es" ? "Sin órdenes de producción" : "No production orders"}</td></tr>
                  ) : filteredProductionOrders.map((po, i) => {
                    const st = PROD_STATUS[po.status] || PROD_STATUS.draft;
                    return (
                      <tr key={po.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.nova, fontFamily: "monospace", fontWeight: 700 }}>{po.folio || `PR-${po.id}`}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>{recipeNameById.get(po.recipe_id) || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{warehouseNameById.get(po.warehouse_id) || "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{po.runs}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.color + "18", padding: "3px 9px", borderRadius: 20 }}>{st.label}</span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{po.unit_cost_result != null ? mxn(po.unit_cost_result) : "—"}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: t.textLo, whiteSpace: "nowrap" }}>{new Date(po.completed_at || po.created_at).toLocaleDateString("es-MX")}</td>
                        <td style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={async () => {
                            if (demo) { alert(lang === "es" ? "Modo demo: PDF no disponible" : "Demo mode: PDF unavailable"); return; }
                            try { await inventoryService.downloadProductionOrderPdf(po.id, po.folio); } catch (err) { console.error(err); alert(lang === "es" ? "Error al generar el PDF" : "Error generating PDF"); }
                          }} title={lang === "es" ? "Descargar PDF" : "Download PDF"} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                            <FileText size={14} /> PDF
                          </button>
                          {po.status === "draft" && (
                            <button onClick={async () => {
                              if (!confirm(lang === "es" ? "¿Completar esta orden de producción? Esto consumirá los materiales vía FIFO y no se puede revertir." : "Complete this production order? This will consume materials via FIFO and cannot be undone.")) return;
                              try { await inventoryService.completeProductionOrder(po.id); await load(); } catch (err) { console.error(err); alert(lang === "es" ? "Error al completar la orden" : "Error completing order"); }
                            }} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: t.good, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              {lang === "es" ? "Completar" : "Complete"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Carga masiva ── */}
      {tab === "import" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <BulkImportCard
            t={t} lang={lang}
            title={lang === "es" ? "Productos e insumos" : "Products & raw materials"}
            description={lang === "es"
              ? "Descarga la plantilla, llénala con tus productos terminados e insumos (materia prima) y súbela aquí. Ideal para catálogos grandes (miles de SKUs)."
              : "Download the template, fill it with your finished products and raw materials, and upload it here. Ideal for large catalogs (thousands of SKUs)."}
            onDownloadTemplate={() => inventoryService.downloadProductsTemplate()}
            busy={productsImportBusy}
            dragging={productsDragging}
            setDragging={setProductsDragging}
            result={productsImportResult}
            error={productsImportError}
            onFile={async (file) => {
              setProductsImportBusy(true);
              setProductsImportError(null);
              setProductsImportResult(null);
              try {
                const res = await inventoryService.uploadProductsBulkImport(file);
                setProductsImportResult(res);
                await load();
              } catch (err: any) {
                setProductsImportError(err?.response?.data?.detail || (lang === "es" ? "Error al procesar el archivo" : "Error processing file"));
              } finally {
                setProductsImportBusy(false);
              }
            }}
          />
          <BulkImportCard
            t={t} lang={lang}
            title={lang === "es" ? "Recetas / BOM (incluye costo de maquila)" : "Recipes / BOM (includes tooling cost)"}
            description={lang === "es"
              ? "Vincula insumos a un producto fabricado, con cantidades, mano de obra/maquila y gastos indirectos. Los SKU deben existir previamente (cárgalos primero con la plantilla de productos)."
              : "Link raw materials to a manufactured product, with quantities, labor/tooling cost and overhead. SKUs must already exist (load them first with the products template)."}
            onDownloadTemplate={() => inventoryService.downloadRecipesTemplate()}
            busy={recipesImportBusy}
            dragging={recipesDragging}
            setDragging={setRecipesDragging}
            result={recipesImportResult}
            error={recipesImportError}
            onFile={async (file) => {
              setRecipesImportBusy(true);
              setRecipesImportError(null);
              setRecipesImportResult(null);
              try {
                const res = await inventoryService.uploadRecipesBulkImport(file);
                setRecipesImportResult(res);
                await load();
              } catch (err: any) {
                setRecipesImportError(err?.response?.data?.detail || (lang === "es" ? "Error al procesar el archivo" : "Error processing file"));
              } finally {
                setRecipesImportBusy(false);
              }
            }}
          />
        </div>
      )}

      {/* ── MODAL: Product Detail (drawer sólido) ── */}
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
                    {(v.reorder_point != null || v.safety_stock != null) && (
                      <div style={{ marginTop: 10, display: "flex", gap: 10, fontSize: 11.5, color: t.textLo }}>
                        {v.reorder_point != null && <span>{lang === "es" ? "Punto reorden" : "Reorder pt."}: <b style={{ color: t.textMid }}>{v.reorder_point}</b></span>}
                        {v.safety_stock != null && <span>{lang === "es" ? "Stock seg." : "Safety stock"}: <b style={{ color: t.textMid }}>{v.safety_stock}</b></span>}
                      </div>
                    )}
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

      {/* ── MODAL: Recipe Cost Breakdown ── */}
      {recipeCostView && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }} onClick={() => setRecipeCostView(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Desglose de costo" : "Cost breakdown"}</h2>
              <button onClick={() => setRecipeCostView(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                [lang === "es" ? "Materiales" : "Materials", mxn(recipeCostView.cost.materials_cost)],
                [lang === "es" ? "Mano de obra" : "Labor", mxn(recipeCostView.cost.labor_cost)],
                [lang === "es" ? "Indirectos" : "Overhead", mxn(recipeCostView.cost.overhead_cost)],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: t.textMid }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: t.textHi }}>{val}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Costo total" : "Total cost"}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: t.nova }}>{mxn(recipeCostView.cost.total_cost)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: t.textMid }}>{lang === "es" ? "Costo unitario" : "Unit cost"}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi }}>{mxn(recipeCostView.cost.unit_cost)}</span>
              </div>
              {recipeCostView.cost.missing_cost_inputs?.length > 0 && (
                <div style={{ marginTop: 8, background: t.warn + "14", border: `1px solid ${t.warn}44`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <AlertTriangle size={14} color={t.warn} style={{ marginTop: 1 }} />
                    <div style={{ fontSize: 12, color: t.warn, lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{lang === "es" ? "Costos faltantes" : "Missing cost inputs"}</div>
                      {recipeCostView.cost.missing_cost_inputs.map((m, i) => <div key={i}>· {m}</div>)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Product Form ── */}
      {productForm && (
        <ProductFormModal
          t={t} s={s} lang={lang} warehouses={warehouses} suppliers={suppliers} editing={editingProduct} categories={availableCategories}
          onClose={() => { setProductForm(false); setEditingProduct(null); }}
          onSave={async (data: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: guardado simulado ✓" : "Demo mode: simulated save ✓"); setProductForm(false); setEditingProduct(null); return; }
            const { form, variants, stockInit } = data;
            const productPayload = { name: form.name, description: form.description, category: form.category, image_url: form.image_url?.trim() || undefined, is_active: form.is_active, item_type: form.item_type };
            const product = editingProduct
              ? await inventoryService.updateProduct(editingProduct.id, productPayload)
              : await inventoryService.createProduct(productPayload);
            for (let i = 0; i < variants.length; i++) {
              const v = variants[i];
              const variantPayload = {
                product_id: product.id, sku: v.sku, barcode: v.barcode || undefined, price: Number(v.price) || 0, cost_price: v.cost_price ? Number(v.cost_price) : undefined,
                size: v.size || undefined, color: v.color || undefined, material: v.material || undefined,
                reorder_point: v.reorder_point ? Number(v.reorder_point) : undefined, safety_stock: v.safety_stock ? Number(v.safety_stock) : undefined,
                lead_time_days: v.lead_time_days ? Number(v.lead_time_days) : undefined, preferred_supplier_id: v.preferred_supplier_id ? Number(v.preferred_supplier_id) : undefined,
              };
              const savedVariant = editingProduct?.variants?.[i]
                ? await inventoryService.updateVariant(editingProduct.variants[i].id, variantPayload)
                : await inventoryService.createVariant(variantPayload);
              const cellsForSku = stockInit[v.sku];
              if (cellsForSku) {
                for (const [warehouseId, qty] of Object.entries(cellsForSku)) {
                  const quantity = Number(qty);
                  if (quantity > 0) {
                    await inventoryService.adjustStock({ variant_id: savedVariant.id, warehouse_id: Number(warehouseId), quantity, movement_type: "in", reference: "Stock inicial" });
                  }
                }
              }
            }
            setProductForm(false); setEditingProduct(null);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Entry Form ── */}
      {entryForm && (
        <EntryFormModal
          t={t} lang={lang} products={products} warehouses={warehouses}
          onClose={() => setEntryForm(false)}
          onSave={async (form: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: entrada simulada ✓" : "Demo mode: simulated entry ✓"); setEntryForm(false); return; }
            await inventoryService.adjustStock({
              variant_id: Number(form.variant_id), warehouse_id: Number(form.warehouse_id), quantity: Number(form.quantity),
              movement_type: "in", reference: form.reference || undefined, notes: form.notes || undefined,
            });
            setEntryForm(false);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Customer Return ── */}
      {returnModal && (
        <ReturnModal t={t} lang={lang} onClose={() => setReturnModal(false)} onSaved={() => load()} />
      )}

      {/* ── MODAL: Adjustment Form ── */}
      {adjustForm && (
        <AdjustmentFormModal
          t={t} lang={lang} products={products} warehouses={warehouses}
          onClose={() => setAdjustForm(false)}
          onSave={async (form: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: ajuste simulado ✓" : "Demo mode: simulated adjustment ✓"); setAdjustForm(false); return; }
            await inventoryService.adjustStock({
              variant_id: Number(form.variant_id), warehouse_id: Number(form.warehouse_id), quantity: Number(form.quantity),
              movement_type: "adjustment", notes: form.notes || undefined,
            });
            setAdjustForm(false);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Warehouse Form ── */}
      {warehouseForm && (
        <WarehouseFormModal
          t={t} lang={lang} editing={editingWarehouse} branches={branches}
          onClose={() => { setWarehouseForm(false); setEditingWarehouse(null); }}
          onSave={async (form: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: almacén simulado ✓" : "Demo mode: simulated warehouse ✓"); setWarehouseForm(false); setEditingWarehouse(null); return; }
            if (editingWarehouse) await inventoryService.updateWarehouse(editingWarehouse.id, form);
            else await inventoryService.createWarehouse(form);
            setWarehouseForm(false);
            setEditingWarehouse(null);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Supplier Form ── */}
      {supplierForm && (
        <SupplierFormModal
          t={t} lang={lang} editing={editingSupplier}
          onClose={() => { setSupplierForm(false); setEditingSupplier(null); }}
          onSave={async (form: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: proveedor simulado ✓" : "Demo mode: simulated supplier ✓"); setSupplierForm(false); setEditingSupplier(null); return; }
            if (editingSupplier) await inventoryService.updateSupplier(editingSupplier.id, form);
            else await inventoryService.createSupplier(form);
            setSupplierForm(false); setEditingSupplier(null);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Purchase Order Form ── */}
      {poForm && (
        <PurchaseOrderFormModal
          t={t} lang={lang} suppliers={suppliers} warehouses={warehouses} products={products} editing={editingPO}
          onClose={() => { setPoForm(false); setEditingPO(null); }}
          onSave={async (data: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: orden simulada ✓" : "Demo mode: simulated order ✓"); setPoForm(false); setEditingPO(null); return; }
            const payload = {
              supplier_id: Number(data.supplier_id), warehouse_id: Number(data.warehouse_id), notes: data.notes || undefined,
              items: data.items.map((it: any) => ({ variant_id: Number(it.variant_id), quantity: Number(it.quantity), unit_cost: Number(it.unit_cost) })),
            };
            if (editingPO) {
              await inventoryService.updatePurchaseOrder(editingPO.id, payload);
            } else {
              await inventoryService.createPurchaseOrder(payload);
            }
            setPoForm(false);
            setEditingPO(null);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Recipe Form ── */}
      {recipeForm && (
        <RecipeFormModal
          t={t} lang={lang} products={products} editing={editingRecipe}
          onClose={() => { setRecipeForm(false); setEditingRecipe(null); }}
          onSave={async (data: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: receta simulada ✓" : "Demo mode: simulated recipe ✓"); setRecipeForm(false); setEditingRecipe(null); return; }
            const payload = {
              output_variant_id: Number(data.output_variant_id), name: data.name || undefined,
              labor_cost: Number(data.labor_cost) || 0, overhead_cost: Number(data.overhead_cost) || 0,
              yield_quantity: Number(data.yield_quantity) || 1, is_active: data.is_active,
              items: data.items.map((it: any) => ({ input_variant_id: Number(it.input_variant_id), quantity: Number(it.quantity) })),
            };
            if (editingRecipe) await inventoryService.updateRecipe(editingRecipe.id, payload);
            else await inventoryService.createRecipe(payload);
            setRecipeForm(false); setEditingRecipe(null);
            await load();
          }}
        />
      )}

      {/* ── MODAL: Production Order Form ── */}
      {prodOrderForm && (
        <ProductionOrderFormModal
          t={t} lang={lang} recipes={recipes} warehouses={warehouses} productNameByVariant={productNameByVariant}
          onClose={() => setProdOrderForm(false)}
          onSave={async (form: any) => {
            if (demo) { alert(lang === "es" ? "Modo demo: orden simulada ✓" : "Demo mode: simulated order ✓"); setProdOrderForm(false); return; }
            await inventoryService.createProductionOrder({
              recipe_id: Number(form.recipe_id), warehouse_id: Number(form.warehouse_id), runs: Number(form.runs) || 1, notes: form.notes || undefined,
            });
            setProdOrderForm(false);
            await load();
          }}
        />
      )}

      <style>{`@keyframes shimmer{0%{opacity:.4}50%{opacity:.8}100%{opacity:.4}}`}</style>
    </div>
  );
}

// ── Bulk Import Card (dropzone + plantilla + resultados) ──────────────────
function BulkImportCard({ t, lang, title, description, onDownloadTemplate, busy, dragging, setDragging, result, error, onFile }: {
  t: any; lang: string; title: string; description: string;
  onDownloadTemplate: () => Promise<void> | void;
  busy: boolean; dragging: boolean; setDragging: (v: boolean) => void;
  result: BulkImportResult | null; error: string | null;
  onFile: (file: File) => void;
}) {
  const inputId = useMemo(() => `bulk-import-${Math.random().toString(36).slice(2)}`, []);
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: t.textHi }}>{title}</h3>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: t.textLo, lineHeight: 1.6 }}>{description}</p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => onDownloadTemplate()} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <Download size={15} /> {lang === "es" ? "Descargar plantilla" : "Download template"}
        </button>
      </div>

      <label
        htmlFor={inputId}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "32px 16px", borderRadius: 12, cursor: busy ? "wait" : "pointer",
          border: `2px dashed ${dragging ? t.nova : t.border}`,
          background: dragging ? t.nova + "0d" : t.panel2,
          transition: "all .15s",
        }}
      >
        <input
          id={inputId} type="file" accept=".xlsx,.xls,.csv" disabled={busy}
          style={{ display: "none" }}
          onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }}
        />
        {busy ? (
          <>
            <RefreshCw size={26} className="spin" style={{ color: t.nova }} />
            <span style={{ fontSize: 13, color: t.textMid }}>{lang === "es" ? "Procesando archivo…" : "Processing file…"}</span>
          </>
        ) : (
          <>
            <FileSpreadsheet size={26} style={{ color: t.textLo }} />
            <span style={{ fontSize: 13.5, color: t.textHi, fontWeight: 600 }}>
              {lang === "es" ? "Arrastra tu archivo aquí o haz clic para elegirlo" : "Drag your file here or click to choose it"}
            </span>
            <span style={{ fontSize: 12, color: t.textLo }}>.xlsx, .xls, .csv</span>
          </>
        )}
      </label>

      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          <AlertTriangle size={16} style={{ marginTop: 1, flexShrink: 0 }} /> {error}
        </div>
      )}

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: t.good, background: t.good + "18", padding: "5px 12px", borderRadius: 20 }}>
              <Check size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              {result.created} {lang === "es" ? "creados" : "created"}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: t.nova, background: t.nova + "18", padding: "5px 12px", borderRadius: 20 }}>
              {result.updated} {lang === "es" ? "actualizados" : "updated"}
            </span>
            {result.errors.length > 0 && (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: t.bad, background: t.bad + "18", padding: "5px 12px", borderRadius: 20 }}>
                {result.errors.length} {lang === "es" ? "con error" : "with errors"}
              </span>
            )}
            <span style={{ fontSize: 12.5, color: t.textLo, padding: "5px 0" }}>
              {result.total_rows} {lang === "es" ? "filas procesadas" : "rows processed"}
            </span>
          </div>
          {result.errors.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: "auto", background: t.panel3, borderRadius: 10, padding: "10px 14px" }}>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontSize: 12.5, color: t.textMid, padding: "4px 0", borderBottom: i < result.errors.length - 1 ? `1px solid ${t.border}` : "none" }}>
                  <strong style={{ color: t.bad }}>{lang === "es" ? "Fila" : "Row"} {e.row}:</strong> {e.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Product Form Modal ─────────────────────────────────────────────────────
function ProductFormModal({ t, s, lang, warehouses, suppliers, editing, onClose, onSave, categories }: any) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: editing?.name || "", description: editing?.description || "",
    category: editing?.category || "", image_url: editing?.image_url || "",
    is_active: editing?.is_active ?? true,
    item_type: editing?.item_type || "finished_good",
  });
  const [uploadingImg, setUploadingImg] = useState(false);
  const [variants, setVariants] = useState(editing?.variants?.map((v: any) => ({
    sku: v.sku, barcode: v.barcode || "", price: v.price, cost_price: v.cost_price || "", size: v.size || "", color: v.color || "", material: v.material || "",
    reorder_point: v.reorder_point ?? "", safety_stock: v.safety_stock ?? "", lead_time_days: v.lead_time_days ?? "", preferred_supplier_id: v.preferred_supplier_id ?? "",
  })) || [{ sku: "", barcode: "", price: "", cost_price: "", size: "", color: "", material: "", reorder_point: "", safety_stock: "", lead_time_days: "", preferred_supplier_id: "" }]);
  const [stockInit, setStockInit] = useState<Record<string, Record<number, number>>>({});

  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };

  const addVariant = () => setVariants((v: any[]) => [...v, { sku: "", barcode: "", price: "", cost_price: "", size: "", color: "", material: "", reorder_point: "", safety_stock: "", lead_time_days: "", preferred_supplier_id: "" }]);
  const removeVariant = (i: number) => setVariants((v: any[]) => v.filter((_: any, idx: number) => idx !== i));
  const updateVariant = (i: number, field: string, val: any) => setVariants((v: any[]) => v.map((vv: any, idx: number) => idx === i ? { ...vv, [field]: val } : vv));

  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave({ form, variants, stockInit }); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al guardar el producto" : "Error saving product")); }
    finally { setSaving(false); }
  };

  const STEPS = [lang === "es" ? "Información" : "Info", lang === "es" ? "Variantes" : "Variants", lang === "es" ? "Stock inicial" : "Initial stock"];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 600, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
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
                    {(categories || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label style={label}>{lang === "es" ? "Tipo de ítem *" : "Item type *"}</label>
                  <select value={form.item_type} onChange={e => setForm(f => ({ ...f, item_type: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="finished_good">{lang === "es" ? "Producto terminado" : "Finished good"}</option>
                    <option value="raw_material">{lang === "es" ? "Insumo" : "Raw material"}</option>
                    <option value="consumable">{lang === "es" ? "Consumible" : "Consumable"}</option>
                    <option value="other">{lang === "es" ? "Otro" : "Other"}</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={label}>{lang === "es" ? "Imagen del producto" : "Product image"}</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {form.image_url && <img src={resolveMediaUrl(form.image_url)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", border: `1px solid ${t.border}` }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.outline = `2px solid ${t.bad}`; }} />}
                  <input value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} placeholder="https://…" style={{ ...inp, flex: 1 }} />
                  <label style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {uploadingImg ? "…" : (lang === "es" ? "Subir" : "Upload")}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingImg(true);
                      try { const { url } = await inventoryService.uploadProductImage(file); setForm(f => ({ ...f, image_url: url })); }
                      catch (err) { console.error(err); alert(lang === "es" ? "Error al subir la imagen" : "Error uploading image"); }
                      finally { setUploadingImg(false); }
                    }} />
                  </label>
                </div>
                <div style={{ fontSize: 11, color: t.textLo, marginTop: 4 }}>{lang === "es" ? "Las imágenes subidas se comprimen automáticamente a WebP." : "Uploaded images are automatically compressed to WebP."}</div>
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
                    <div><label style={label}>{lang === "es" ? "Código de barras (EAN/UPC)" : "Barcode (EAN/UPC)"}</label><input value={v.barcode || ""} onChange={e => updateVariant(i, "barcode", e.target.value)} placeholder="7501234567890" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Precio venta *" : "Sale price *"}</label><input type="number" value={v.price} onChange={e => updateVariant(i, "price", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Costo" : "Cost"}</label><input type="number" value={v.cost_price} onChange={e => updateVariant(i, "cost_price", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Talla/Tamaño" : "Size"}</label><input value={v.size} onChange={e => updateVariant(i, "size", e.target.value)} placeholder="50kg, M, XL…" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Color" : "Color"}</label><input value={v.color} onChange={e => updateVariant(i, "color", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Material" : "Material"}</label><input value={v.material} onChange={e => updateVariant(i, "material", e.target.value)} style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Punto de reorden" : "Reorder point"}</label><input type="number" value={v.reorder_point} onChange={e => updateVariant(i, "reorder_point", e.target.value)} placeholder="0" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Stock de seguridad" : "Safety stock"}</label><input type="number" value={v.safety_stock} onChange={e => updateVariant(i, "safety_stock", e.target.value)} placeholder="0" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Lead time (días)" : "Lead time (days)"}</label><input type="number" value={v.lead_time_days} onChange={e => updateVariant(i, "lead_time_days", e.target.value)} placeholder="0" style={inp} /></div>
                    <div><label style={label}>{lang === "es" ? "Proveedor preferido" : "Preferred supplier"}</label>
                      <select value={v.preferred_supplier_id} onChange={e => updateVariant(i, "preferred_supplier_id", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                        <option value="">{lang === "es" ? "Sin asignar" : "Unassigned"}</option>
                        {suppliers.map((sup: Supplier) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                      </select>
                    </div>
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
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
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
    </div>
  );
}

// ── Entry Form Modal ───────────────────────────────────────────────────────
function EntryFormModal({ t, lang, products, warehouses, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave(form); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al registrar la entrada" : "Error registering entry")); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
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
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !form.variant_id || !form.warehouse_id || !form.quantity} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.good}, #059669)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!form.variant_id || !form.warehouse_id || !form.quantity) ? 0.5 : 1 }}>
              {saving ? "…" : (lang === "es" ? "Registrar entrada" : "Register entry")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Adjustment Form Modal ──────────────────────────────────────────────────
function AdjustmentFormModal({ t, lang, products, warehouses, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave(form); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al aplicar el ajuste" : "Error applying adjustment")); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
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
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !form.variant_id || !form.warehouse_id || !form.quantity || !form.notes} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.warn}, #D97706)`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!form.variant_id || !form.warehouse_id || !form.quantity || !form.notes) ? 0.5 : 1 }}>
              {saving ? "…" : (lang === "es" ? "Aplicar ajuste" : "Apply adjustment")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Warehouse Form Modal ───────────────────────────────────────────────────
function WarehouseFormModal({ t, lang, editing, branches, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: editing?.name || "", location: editing?.location || "",
    type: editing?.type || "own", branch_id: editing?.branch_id ?? null, is_active: editing?.is_active ?? true,
  });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave(form); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al guardar el almacén" : "Error saving warehouse")); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 440, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><Warehouse size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? (lang === "es" ? "Editar almacén" : "Edit warehouse") : (lang === "es" ? "Nuevo almacén" : "New warehouse")}</h2>
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
          {(branches?.length > 0) && (
            <div><label style={label}>{lang === "es" ? "Sucursal" : "Branch"}</label>
              <select value={form.branch_id ?? ""} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value ? Number(e.target.value) : null }))} style={{ ...inp, cursor: "pointer" }}>
                <option value="">{lang === "es" ? "Sin asignar" : "Unassigned"}</option>
                {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}{b.is_primary ? (lang === "es" ? " (Matriz)" : " (HQ)") : ""}</option>)}
              </select>
            </div>
          )}
          {editing && (
            <div>
              <label style={label}>{lang === "es" ? "Estado" : "Status"}</label>
              <select value={form.is_active ? "1" : "0"} onChange={e => setForm(f => ({ ...f, is_active: e.target.value === "1" }))} style={{ ...inp, cursor: "pointer" }}>
                <option value="1">{lang === "es" ? "Activo" : "Active"}</option>
                <option value="0">{lang === "es" ? "Inactivo" : "Inactive"}</option>
              </select>
            </div>
          )}
          <div style={{ background: t.panel2, borderRadius: 8, padding: 12, fontSize: 12.5, color: t.textLo, lineHeight: 1.5 }}>
            {form.type === "own" && (lang === "es" ? "Almacén propio: control total de entradas, salidas y transferencias." : "Own warehouse: full control of entries, exits and transfers.")}
            {form.type === "marketplace" && (lang === "es" ? "Marketplace: stock enviado a plataforma (MercadoLibre, Amazon, etc.). Las ventas descuentan automáticamente." : "Marketplace: stock sent to platform (MercadoLibre, Amazon, etc.). Sales auto-discount.")}
            {form.type === "consignment" && (lang === "es" ? "Consignación: stock en poder de un tercero. Se descuenta solo al confirmarse la venta." : "Consignment: stock held by a third party. Only deducted when sale is confirmed.")}
            {form.type === "transit" && (lang === "es" ? "Tránsito: stock en movimiento entre almacenes. No disponible para venta." : "Transit: stock moving between warehouses. Not available for sale.")}
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.name ? 0.5 : 1 }}>
              {saving ? "…" : (editing ? (lang === "es" ? "Guardar cambios" : "Save changes") : (lang === "es" ? "Crear almacén" : "Create warehouse"))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Supplier Form Modal ────────────────────────────────────────────────────
function SupplierFormModal({ t, lang, editing, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: editing?.name || "", contact_name: editing?.contact_name || "", email: editing?.email || "",
    phone: editing?.phone || "", rfc: editing?.rfc || "", address: editing?.address || "",
    lead_time_days: editing?.lead_time_days ?? "", payment_terms: editing?.payment_terms || "",
    notes: editing?.notes || "", is_active: editing?.is_active ?? true,
  });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await onSave({
        ...form,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : undefined,
      });
    } catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al guardar el proveedor" : "Error saving supplier")); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 520, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><Users size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? (lang === "es" ? "Editar proveedor" : "Edit supplier") : (lang === "es" ? "Nuevo proveedor" : "New supplier")}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div><label style={label}>{lang === "es" ? "Nombre *" : "Name *"}</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>{lang === "es" ? "Persona de contacto" : "Contact name"}</label><input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} style={inp} /></div>
            <div><label style={label}>RFC</label><input value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value }))} style={inp} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>Email</label><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inp} /></div>
            <div><label style={label}>{lang === "es" ? "Teléfono" : "Phone"}</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
          </div>
          <div><label style={label}>{lang === "es" ? "Dirección" : "Address"}</label><textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>{lang === "es" ? "Lead time (días)" : "Lead time (days)"}</label><input type="number" value={form.lead_time_days} onChange={e => setForm(f => ({ ...f, lead_time_days: e.target.value }))} style={inp} /></div>
            <div><label style={label}>{lang === "es" ? "Términos de pago" : "Payment terms"}</label><input value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder={lang === "es" ? "30 días, contado…" : "Net 30, COD…"} style={inp} /></div>
          </div>
          <div><label style={label}>{lang === "es" ? "Notas" : "Notes"}</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" id="sup_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            <label htmlFor="sup_active" style={{ fontSize: 13, color: t.textMid, cursor: "pointer" }}>{lang === "es" ? "Proveedor activo" : "Active supplier"}</label>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !form.name} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !form.name ? 0.5 : 1 }}>
              {saving ? "…" : (lang === "es" ? "Guardar proveedor" : "Save supplier")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Purchase Order Form Modal ──────────────────────────────────────────────
function PurchaseOrderFormModal({ t, lang, suppliers, warehouses, products, editing, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [supplierId, setSupplierId] = useState(editing ? String(editing.supplier_id) : "");
  const [warehouseId, setWarehouseId] = useState(editing ? String(editing.warehouse_id) : "");
  const [dueDate, setDueDate] = useState(editing?.due_date ? String(editing.due_date).slice(0, 10) : "");
  const [notes, setNotes] = useState(editing?.notes || "");
  const [items, setItems] = useState(
    editing?.items?.length
      ? editing.items.map((it: any) => ({ variant_id: String(it.variant_id), quantity: String(it.quantity), unit_cost: String(it.unit_cost) }))
      : [{ variant_id: "", quantity: "", unit_cost: "" }]
  );
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const allVariants = products.flatMap((p: Product) => p.variants.map((v: Variant) => ({ ...v, product_name: p.name })));

  const addItem = () => setItems(i => [...i, { variant_id: "", quantity: "", unit_cost: "" }]);
  const removeItem = (idx: number) => setItems(i => i.filter((_, k) => k !== idx));
  const updateItem = (idx: number, field: string, val: any) => setItems(i => i.map((it, k) => k === idx ? { ...it, [field]: val } : it));

  const total = items.reduce((a, it) => a + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0);
  const valid = supplierId && warehouseId && items.length > 0 && items.every(it => it.variant_id && it.quantity && it.unit_cost);

  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave({ supplier_id: supplierId, warehouse_id: warehouseId, due_date: dueDate || undefined, notes, items }); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al crear la orden de compra" : "Error creating purchase order")); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 620, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><ClipboardList size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? (lang === "es" ? "Editar orden de compra" : "Edit purchase order") : (lang === "es" ? "Nueva orden de compra" : "New purchase order")}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={label}>{lang === "es" ? "Proveedor *" : "Supplier *"}</label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                {suppliers.map((sup: Supplier) => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
              </select>
            </div>
            <div><label style={label}>{lang === "es" ? "Almacén destino *" : "Destination warehouse *"}</label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div><label style={label}>{lang === "es" ? "Fecha de vencimiento (pago)" : "Due date (payment)"}</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inp} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 10 }}>{lang === "es" ? "Artículos" : "Items"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
                  <div>
                    {i === 0 && <label style={label}>{lang === "es" ? "Producto / Variante" : "Product / Variant"}</label>}
                    <select value={it.variant_id} onChange={e => updateItem(i, "variant_id", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                      <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                      {allVariants.map((v: any) => <option key={v.id} value={v.id}>{v.product_name} — {v.sku}</option>)}
                    </select>
                  </div>
                  <div>
                    {i === 0 && <label style={label}>{lang === "es" ? "Cantidad" : "Quantity"}</label>}
                    <input type="number" min={1} value={it.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} style={inp} />
                  </div>
                  <div>
                    {i === 0 && <label style={label}>{lang === "es" ? "Costo unit." : "Unit cost"}</label>}
                    <input type="number" min={0} value={it.unit_cost} onChange={e => updateItem(i, "unit_cost", e.target.value)} style={inp} />
                  </div>
                  <button onClick={() => removeItem(i)} disabled={items.length === 1} style={{ background: "transparent", border: "none", cursor: items.length === 1 ? "default" : "pointer", color: items.length === 1 ? t.textLo : t.bad, opacity: items.length === 1 ? 0.4 : 1 }}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <button onClick={addItem} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 12.5 }}>
              <Plus size={14} /> {lang === "es" ? "Agregar artículo" : "Add item"}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 14, fontWeight: 700, color: t.textHi }}>
            {lang === "es" ? "Total estimado:" : "Estimated total:"} <span style={{ color: t.nova, marginLeft: 6 }}>{mxn(total)}</span>
          </div>

          <div><label style={label}>{lang === "es" ? "Notas" : "Notes"}</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !valid} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.5 : 1 }}>
              {saving ? "…" : editing ? (lang === "es" ? "Guardar cambios" : "Save changes") : (lang === "es" ? "Crear orden" : "Create order")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Recipe Form Modal ──────────────────────────────────────────────────────
function RecipeFormModal({ t, lang, products, editing, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outputVariantId, setOutputVariantId] = useState(String(editing?.output_variant_id || ""));
  const [name, setName] = useState(editing?.name || "");
  const [laborCost, setLaborCost] = useState(String(editing?.labor_cost ?? ""));
  const [overheadCost, setOverheadCost] = useState(String(editing?.overhead_cost ?? ""));
  const [yieldQty, setYieldQty] = useState(String(editing?.yield_quantity ?? "1"));
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [items, setItems] = useState(editing?.items?.map((it: RecipeItem) => ({ input_variant_id: String(it.input_variant_id), quantity: String(it.quantity) })) || [{ input_variant_id: "", quantity: "" }]);
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const allVariants = products.flatMap((p: Product) => p.variants.map((v: Variant) => ({ ...v, product_name: p.name })));
  const insumoVariants = products.filter((p: Product) => p.item_type === "raw_material").flatMap((p: Product) => p.variants.map((v: Variant) => ({ ...v, product_name: p.name })));

  const addItem = () => setItems((i: any[]) => [...i, { input_variant_id: "", quantity: "" }]);
  const removeItem = (idx: number) => setItems((i: any[]) => i.filter((_, k) => k !== idx));
  const updateItem = (idx: number, field: string, val: any) => setItems((i: any[]) => i.map((it, k) => k === idx ? { ...it, [field]: val } : it));

  const valid = outputVariantId && yieldQty && items.length > 0 && items.every((it: any) => it.input_variant_id && it.quantity);

  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave({ output_variant_id: outputVariantId, name, labor_cost: laborCost, overhead_cost: overheadCost, yield_quantity: yieldQty, is_active: isActive, items }); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al guardar la receta" : "Error saving recipe")); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 620, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}`, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><FlaskConical size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? (lang === "es" ? "Editar receta" : "Edit recipe") : (lang === "es" ? "Nueva receta" : "New recipe")}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          <div><label style={label}>{lang === "es" ? "Producto / Variante resultante *" : "Output product / variant *"}</label>
            <select value={outputVariantId} onChange={e => setOutputVariantId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {allVariants.map((v: any) => <option key={v.id} value={v.id}>{v.product_name} — {v.sku}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Nombre de la receta" : "Recipe name"}</label><input value={name} onChange={e => setName(e.target.value)} placeholder={lang === "es" ? "Ej: Mezcla estándar" : "E.g: Standard mix"} style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div><label style={label}>{lang === "es" ? "Rendimiento *" : "Yield *"}</label><input type="number" min={1} value={yieldQty} onChange={e => setYieldQty(e.target.value)} style={inp} /></div>
            <div><label style={label}>{lang === "es" ? "Mano de obra" : "Labor cost"}</label><input type="number" min={0} value={laborCost} onChange={e => setLaborCost(e.target.value)} style={inp} /></div>
            <div><label style={label}>{lang === "es" ? "Indirectos" : "Overhead cost"}</label><input type="number" min={0} value={overheadCost} onChange={e => setOverheadCost(e.target.value)} style={inp} /></div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textHi, marginBottom: 10 }}>{lang === "es" ? "Materiales (insumos)" : "Materials (inputs)"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it: any, i: number) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8, alignItems: "end" }}>
                  <div>
                    {i === 0 && <label style={label}>{lang === "es" ? "Insumo" : "Input"}</label>}
                    <select value={it.input_variant_id} onChange={e => updateItem(i, "input_variant_id", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                      <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                      {insumoVariants.map((v: any) => <option key={v.id} value={v.id}>{v.product_name} — {v.sku}</option>)}
                    </select>
                    {insumoVariants.length === 0 && <div style={{ fontSize: 11, color: t.warn, marginTop: 4 }}>{lang === "es" ? "No hay productos clasificados como insumo. Edítalos en Productos." : "No products classified as raw material. Edit them in Products."}</div>}
                  </div>
                  <div>
                    {i === 0 && <label style={label}>{lang === "es" ? "Cantidad" : "Quantity"}</label>}
                    <input type="number" min={0} step="any" value={it.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} style={inp} />
                  </div>
                  <button onClick={() => removeItem(i)} disabled={items.length === 1} style={{ background: "transparent", border: "none", cursor: items.length === 1 ? "default" : "pointer", color: items.length === 1 ? t.textLo : t.bad, opacity: items.length === 1 ? 0.4 : 1 }}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <button onClick={addItem} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 12.5 }}>
              <Plus size={14} /> {lang === "es" ? "Agregar insumo" : "Add input"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" id="recipe_active" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            <label htmlFor="recipe_active" style={{ fontSize: 13, color: t.textMid, cursor: "pointer" }}>{lang === "es" ? "Receta activa" : "Active recipe"}</label>
          </div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !valid} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.5 : 1 }}>
              {saving ? "…" : (lang === "es" ? "Guardar receta" : "Save recipe")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Production Order Form Modal ────────────────────────────────────────────
function ProductionOrderFormModal({ t, lang, recipes, warehouses, productNameByVariant, onClose, onSave }: any) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ recipe_id: "", warehouse_id: "", runs: "1", notes: "" });
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const handleSave = async () => {
    setSaving(true); setError("");
    try { await onSave(form); }
    catch (err: any) { setError(err?.response?.data?.detail || (lang === "es" ? "Error al crear la orden de producción" : "Error creating production order")); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 480, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><Factory size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Nueva orden de producción" : "New production order"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={label}>{lang === "es" ? "Receta *" : "Recipe *"}</label>
            <select value={form.recipe_id} onChange={e => setForm(f => ({ ...f, recipe_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {recipes.map((r: Recipe) => <option key={r.id} value={r.id}>{r.name || productNameByVariant.get(r.output_variant_id) || `Receta #${r.id}`}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Almacén destino *" : "Destination warehouse *"}</label>
            <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
              <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
              {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div><label style={label}>{lang === "es" ? "Corridas (multiplicador del rendimiento) *" : "Runs (yield multiplier) *"}</label><input type="number" min={1} value={form.runs} onChange={e => setForm(f => ({ ...f, runs: e.target.value }))} style={inp} /></div>
          <div><label style={label}>{lang === "es" ? "Notas" : "Notes"}</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
            <button onClick={handleSave} disabled={saving || !form.recipe_id || !form.warehouse_id || !form.runs} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!form.recipe_id || !form.warehouse_id || !form.runs) ? 0.5 : 1 }}>
              {saving ? "…" : (lang === "es" ? "Crear orden" : "Create order")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
