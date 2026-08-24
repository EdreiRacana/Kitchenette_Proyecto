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
  const [createOpen, setCreateOpen] = useState(false);
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

  if (loading) return null;
  // Con 0 o 1 empresa, seguimos mostrando el dropdown para que el
  // usuario pueda dar de alta la siguiente marca desde el header.

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
          {/* Botón "Nueva empresa" — abre modal para dar de alta otra marca */}
          <div style={{ borderTop: `1px solid ${t.border}`, marginTop: 4, paddingTop: 4 }}>
            <button onClick={() => { setOpen(false); setCreateOpen(true); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6, border: "none",
                background: "transparent", color: t.nova, cursor: "pointer",
                fontSize: 12.5, fontWeight: 600, textAlign: "left",
              }}>
              <Plus size={14} />
              {lang === "es" ? "Nueva empresa" : "New company"}
            </button>
          </div>
        </div>
      )}
      {createOpen && (
        <CreateCompanyModal t={t} lang={lang}
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => {
            setCreateOpen(false);
            await load();
            // Cambia automáticamente a la marca recién creada
            setActiveCompanyId(id);
            setActiveId(id);
            try { await api.post("/me/switch-company", { company_id: id }); } catch {}
            window.location.reload();
          }} />
      )}
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────────
// Modal para dar de alta una nueva empresa. Solo superuser puede hacerlo.
// Captura los campos esenciales + logo (data URI, redimensionado a 256px).
// ──────────────────────────────────────────────────────────────────────
interface CreateForm {
  legal_name: string;
  commercial_name: string;
  tax_id: string;
  regimen_fiscal: string;
  brand_color: string;
  business_model: "direct" | "agency";
  commission_default_pct: number;
  commission_base: "gross" | "subtotal" | "net";
  is_demo: boolean;
  logo_url: string;
}

function CreateCompanyModal({
  t, lang, onClose, onCreated,
}: {
  t: any; lang: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [f, setF] = useState<CreateForm>({
    legal_name: "", commercial_name: "", tax_id: "", regimen_fiscal: "",
    brand_color: "#33B2F5", business_model: "direct",
    commission_default_pct: 0, commission_base: "net",
    is_demo: false, logo_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setF(prev => ({ ...prev, logo_url: canvas.toDataURL("image/png") }));
      };
      img.src = String(ev.target?.result || "");
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!f.legal_name.trim()) {
      setErr(lang === "es" ? "El nombre / razón social es obligatorio" : "Legal name is required");
      return;
    }
    setBusy(true); setErr("");
    try {
      const payload = {
        legal_name: f.legal_name.trim(),
        commercial_name: f.commercial_name.trim() || undefined,
        tax_id: f.tax_id.trim() || undefined,
        regimen_fiscal: f.regimen_fiscal.trim() || undefined,
        brand_color: f.brand_color,
        logo_url: f.logo_url || undefined,
        business_model: f.business_model,
        commission_default_pct: f.commission_default_pct || 0,
        commission_base: f.commission_base,
        is_demo: f.is_demo,
      };
      const r = await api.post("/companies", payload);
      const id = (r.data as any)?.id;
      if (id) onCreated(id);
      else onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally { setBusy(false); }
  };

  const lbl = { fontSize: 11, fontWeight: 600, color: t.textMid,
                display: "block", marginBottom: 4 };
  const inp = {
    width: "100%", padding: "8px 10px", borderRadius: 8,
    background: t.panel2, border: `1px solid ${t.border}`,
    color: t.textHi, fontSize: 13, outline: "none",
  } as any;

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "grid", placeItems: "center", zIndex: 200, padding: 16,
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 14, padding: 20, width: "100%", maxWidth: 520,
          maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: t.nova + "22", color: t.nova,
            display: "grid", placeItems: "center",
          }}>
            <Building2 size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.textHi }}>
              {lang === "es" ? "Nueva empresa" : "New company"}
            </div>
            <div style={{ fontSize: 11.5, color: t.textLo }}>
              {lang === "es"
                ? "Da de alta una marca del corporativo"
                : "Register a corporate brand"}
            </div>
          </div>
        </div>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 10,
            background: t.panel2, border: `1px solid ${t.border}`,
            display: "grid", placeItems: "center", overflow: "hidden",
          }}>
            {f.logo_url
              ? <img src={f.logo_url} alt="logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <Building2 size={22} color={t.textLo} />}
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ ...lbl, marginBottom: 4 }}>
              {lang === "es" ? "Logo (opcional)" : "Logo (optional)"}
            </label>
            <input type="file" accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0])}
              style={{ fontSize: 12, color: t.textMid }} />
          </div>
        </div>

        {/* Nombres */}
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>{lang === "es" ? "Nombre comercial" : "Commercial name"}</label>
          <input value={f.commercial_name} placeholder="Ej. Twelve South"
            onChange={(e) => setF(p => ({ ...p, commercial_name: e.target.value }))}
            style={inp} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>
            {lang === "es" ? "Nombre / razón social *" : "Legal name *"}
          </label>
          <input value={f.legal_name} placeholder="Ej. Twelve South México SA de CV"
            onChange={(e) => setF(p => ({ ...p, legal_name: e.target.value }))}
            style={inp} />
        </div>

        {/* Fiscal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={lbl}>RFC</label>
            <input value={f.tax_id}
              onChange={(e) => setF(p => ({ ...p, tax_id: e.target.value.toUpperCase() }))}
              style={{ ...inp, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={lbl}>{lang === "es" ? "Régimen SAT" : "SAT regime"}</label>
            <input value={f.regimen_fiscal} placeholder="601"
              onChange={(e) => setF(p => ({ ...p, regimen_fiscal: e.target.value }))}
              style={inp} />
          </div>
        </div>

        {/* Color + demo */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={lbl}>{lang === "es" ? "Color de marca" : "Brand color"}</label>
            <input type="color" value={f.brand_color}
              onChange={(e) => setF(p => ({ ...p, brand_color: e.target.value }))}
              style={{ ...inp, height: 38, padding: 4, cursor: "pointer" }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                             color: t.textMid, fontSize: 12.5 }}>
              <input type="checkbox" checked={f.is_demo}
                onChange={(e) => setF(p => ({ ...p, is_demo: e.target.checked }))} />
              {lang === "es" ? "Es marca demo / showcase" : "Demo brand"}
            </label>
          </div>
        </div>

        {/* Modelo comercial */}
        <div style={{ padding: 12, borderRadius: 10, background: t.panel2,
                       border: `1px solid ${t.border}`, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.textHi, marginBottom: 8 }}>
            {lang === "es" ? "Modelo comercial" : "Business model"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl}>{lang === "es" ? "Modelo" : "Model"}</label>
              <select value={f.business_model}
                onChange={(e) => setF(p => ({ ...p, business_model: e.target.value as any }))}
                style={{ ...inp, cursor: "pointer" }}>
                <option value="direct">
                  {lang === "es" ? "Directo (empresa factura y cobra)" : "Direct"}
                </option>
                <option value="agency">
                  {lang === "es" ? "Agencia (matriz factura, cobra comisión)" : "Agency"}
                </option>
              </select>
            </div>
            {f.business_model === "agency" && (
              <>
                <div>
                  <label style={lbl}>% comisión default</label>
                  <input type="number" min={0} max={100} step={0.5}
                    value={f.commission_default_pct}
                    onChange={(e) => setF(p => ({ ...p, commission_default_pct: parseFloat(e.target.value) || 0 }))}
                    style={inp} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={lbl}>{lang === "es" ? "Base de cálculo" : "Calculation base"}</label>
                  <select value={f.commission_base}
                    onChange={(e) => setF(p => ({ ...p, commission_base: e.target.value as any }))}
                    style={{ ...inp, cursor: "pointer" }}>
                    <option value="gross">{lang === "es" ? "Bruto (total)" : "Gross"}</option>
                    <option value="subtotal">{lang === "es" ? "Subtotal (sin IVA)" : "Subtotal"}</option>
                    <option value="net">{lang === "es" ? "Neto (post descuentos)" : "Net"}</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {err && (
          <div style={{ padding: 10, borderRadius: 8, background: (t.bad || "#ef4444") + "15",
                         color: t.bad || "#ef4444", fontSize: 12.5, marginBottom: 10 }}>
            {err}
          </div>
        )}

        {/* Botones */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy}
            style={{
              padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`,
              background: "transparent", color: t.textMid, fontSize: 12.5,
              fontWeight: 600, cursor: busy ? "wait" : "pointer",
            }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button onClick={save} disabled={busy}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "none",
              background: t.nova, color: "#fff", fontSize: 12.5, fontWeight: 700,
              cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            }}>
            {busy
              ? (lang === "es" ? "Creando…" : "Creating…")
              : (lang === "es" ? "Crear empresa" : "Create company")}
          </button>
        </div>
      </div>
    </div>
  );
}
