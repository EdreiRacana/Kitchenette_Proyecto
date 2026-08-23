// Selector de empresa activa (multi-tenant). Aparece en el Topbar.
// Al cambiar, guarda el ID en localStorage (via setActiveCompanyId) y
// recarga la app para que todas las queries vuelvan con el nuevo header.

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import api, { getActiveCompanyId, setActiveCompanyId } from "../services/api";

interface Company {
  id: string;
  legal_name: string;
  commercial_name?: string | null;
  tax_id?: string | null;
  is_active: boolean;
  is_default?: boolean;
  role_in_company?: string | null;
  // Multi-marca (Fase 1a)
  logo_url?: string | null;
  brand_color?: string | null;
  business_model?: string | null;   // 'direct' | 'agency'
  is_demo?: boolean;
}

// Etiqueta discreta "DEMO" para marcas de showcase — se filtran de
// reportes corporativos y sirven para presentar el ERP a prospectos
// sin exponer datos reales de clientes en operación.
function DemoTag({ t }: { t: any }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 5px", borderRadius: 4,
      background: (t.warn || "#F59E0B") + "26",
      color: t.warn || "#F59E0B",
      fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
      flex: "0 0 auto",
    }}>DEMO</span>
  );
}

// Miniatura de marca: logo si hay, iniciales con brand_color si no.
function BrandAvatar({ c, size = 18 }: { c: Company; size?: number }) {
  if (c.logo_url) {
    return (
      <img src={c.logo_url} alt={c.commercial_name || c.legal_name}
        style={{ width: size, height: size, borderRadius: 4, objectFit: "cover",
                 flex: "0 0 auto" }} />
    );
  }
  const initials = (c.commercial_name || c.legal_name || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase() || "").join("");
  return (
    <span style={{
      width: size, height: size, borderRadius: 4, flex: "0 0 auto",
      background: c.brand_color || "#33B2F5",
      color: "#fff", fontSize: Math.max(9, Math.floor(size * 0.5)),
      fontWeight: 700, display: "grid", placeItems: "center",
    }}>{initials || "?"}</span>
  );
}

export default function CompanySwitcher({ t, isMobile, lang }: { t: any; isMobile: boolean; lang: string }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getActiveCompanyId());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Company[]>("/me/companies");
      setCompanies(r.data || []);
      if (!activeId && r.data?.length) {
        const def = r.data.find(c => c.is_default) || r.data[0];
        setActiveId(def.id);
        setActiveCompanyId(def.id);
      }
    } catch {
      // Sin backend / sin permisos: no rompemos la app
    } finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const active = companies.find(c => c.id === activeId) || companies[0];

  const switchTo = async (id: string) => {
    if (id === activeId) { setOpen(false); return; }
    setActiveCompanyId(id);
    setActiveId(id);
    // Persistir como default del usuario en backend (best-effort)
    try { await api.post("/me/switch-company", { company_id: id }); }
    catch { /* si falla, la próxima sesión vuelve al default anterior */ }
    // Recarga para que todos los módulos usen el nuevo tenant
    window.location.reload();
  };

  if (loading || companies.length === 0) return null;

  // Si solo hay 1 empresa: badge no-clickeable, sin dropdown
  if (companies.length === 1) {
    const c = companies[0];
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        height: 36, padding: "0 11px", borderRadius: 10,
        background: t.panel2, border: `1px solid ${t.border}`,
        color: t.textMid, fontSize: 12.5, fontWeight: 600,
        whiteSpace: "nowrap", maxWidth: isMobile ? 150 : 220,
        overflow: "hidden", textOverflow: "ellipsis",
      }} title={c.legal_name}>
        <BrandAvatar c={c} size={18} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {c.commercial_name || c.legal_name}
        </span>
        {c.is_demo && <DemoTag t={t} />}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          height: 36, padding: "0 11px", borderRadius: 10,
          background: open ? t.nova + "18" : t.panel2,
          border: `1px solid ${open ? t.nova + "77" : t.border}`,
          color: t.textHi, fontSize: 12.5, fontWeight: 600,
          cursor: "pointer", maxWidth: isMobile ? 170 : 260,
        }}>
        {active
          ? <BrandAvatar c={active} size={20} />
          : <Building2 size={14} color={t.nova} />}
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {active?.commercial_name || active?.legal_name || "—"}
        </span>
        {active?.is_demo && <DemoTag t={t} />}
        <ChevronDown size={13} style={{ transition: "transform .12s", transform: open ? "rotate(180deg)" : "none" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 42, right: 0, minWidth: 280,
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          padding: 6, zIndex: 50,
        }}>
          <div style={{
            padding: "6px 10px", fontSize: 10.5, color: t.textLo,
            textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700,
          }}>
            {lang === "es" ? "Cambiar empresa" : "Switch company"}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {companies.map(c => (
              <button key={c.id} onClick={() => switchTo(c.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 6, border: "none",
                  background: c.id === activeId ? t.nova + "18" : "transparent",
                  color: t.textHi, cursor: "pointer", textAlign: "left",
                }}>
                <BrandAvatar c={c} size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                 display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.commercial_name || c.legal_name}
                    </span>
                    {c.is_demo && <DemoTag t={t} />}
                  </div>
                  <div style={{ fontSize: 10.5, color: t.textLo }}>
                    {c.tax_id || (lang === "es" ? "sin RFC" : "no tax ID")}
                    {c.business_model === "agency" && (
                      <span style={{ marginLeft: 6, color: t.warn }}>· agencia</span>
                    )}
                    {c.role_in_company && <span style={{ marginLeft: 6, color: t.nova }}>· {c.role_in_company}</span>}
                  </div>
                </div>
                {c.id === activeId && <Check size={14} color={t.nova} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
