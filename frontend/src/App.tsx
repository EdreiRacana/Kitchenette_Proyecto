// Application shell: theme provider + sidebar navigation + routing.
// Hosts the Sales/CRM module and the Inventory module. Rebuilt from scratch
// because the previous App.tsx in the repo was a truncated fragment that
// broke the production build.

import { Component, useState } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { ShoppingCart, Boxes, Menu } from "lucide-react";

import SalesCRM from "./features/sales/SalesCRM";
import ProductList from "./features/inventory/ProductList";
import ProductForm from "./features/inventory/ProductForm";

// ── Theme tokens (navy). Exposes BOTH naming schemes so every module — which
//    may read good/nova/bad or success/accent/danger — resolves correctly. ──
const t = {
  bg: "#070E24", panel: "#0E1838", panel2: "#131F44", panel3: "#1A2856",
  border: "#1E2E5C", inputBg: "#0A1430",
  textHi: "#F2F6FF", textMid: "#AFBEDF", textLo: "#7C9AD0",
  text: "#F2F6FF", textPrimary: "#F2F6FF", textSecondary: "#AFBEDF",
  nova: "#33B2F5", accent: "#33B2F5", primary: "#33B2F5",
  good: "#34D399", success: "#34D399",
  warn: "#FBBF24", warning: "#FBBF24",
  bad: "#F87171", danger: "#F87171", error: "#F87171",
};

// ── Minimal i18n. Modules use fallbacks, so this only needs the common keys. ──
const STRINGS: Record<string, string> = {
  app_title: "Kitchenette",
  nav_sales: "Ventas",
  nav_inventory: "Inventario",
  sales_search_placeholder: "Buscar folio, cliente o estado…",
  sales_kpi_sold: "Total vendido",
  sales_kpi_pending_orders: "Pedidos pendientes",
  sales_kpi_pending_amount: "Por cobrar",
  sales_kpi_paid_rate: "Tasa pagados",
  sales_new: "Nuevo",
};
const s = (key: string): string => STRINGS[key] ?? key;

// ── Error boundary so a single module can't white-screen the whole app. ──────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: t.textMid }}>
          <h2 style={{ color: t.bad, marginBottom: 8 }}>Algo salió mal en este módulo</h2>
          <pre style={{ fontSize: 12, color: t.textLo, whiteSpace: "pre-wrap" }}>{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const NAV = [
  { to: "/sales", label: "Ventas", icon: ShoppingCart },
  { to: "/inventory", label: "Inventario", icon: Boxes },
];

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: t.bg, color: t.textHi, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* Sidebar */}
      <aside style={{ width: open ? 220 : 64, transition: "width .2s", background: t.panel, borderRight: `1px solid ${t.border}`, display: "flex", flexDirection: "column", padding: "16px 10px", gap: 6, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 16px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: t.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <ShoppingCart size={18} color="#06122B" />
          </div>
          {open && <span style={{ fontWeight: 800, fontSize: 17 }}>Kitchenette</span>}
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} style={({ isActive }) => ({
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10,
            textDecoration: "none", fontSize: 14, fontWeight: 600,
            color: isActive ? t.accent : t.textMid, background: isActive ? t.accent + "1A" : "transparent",
          })}>
            <Icon size={18} style={{ flexShrink: 0 }} />{open && label}
          </NavLink>
        ))}
        <button onClick={() => setOpen((o) => !o)} style={{ marginTop: "auto", background: "transparent", border: `1px solid ${t.border}`, color: t.textLo, borderRadius: 8, padding: 8, cursor: "pointer", display: "flex", justifyContent: "center" }}>
          <Menu size={18} />
        </button>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, minWidth: 0, padding: "0 28px", maxWidth: 1400, margin: "0 auto", width: "100%" }}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/sales" replace />} />
          <Route path="/sales" element={<SalesCRM t={t} s={s} />} />
          <Route path="/inventory" element={<ProductList />} />
          <Route path="/inventory/new" element={<ProductForm />} />
          <Route path="*" element={<Navigate to="/sales" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
