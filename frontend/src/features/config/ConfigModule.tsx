// ConfigModule.tsx — Configuración / Administración Premium
// Pestañas: Empresa · Usuarios · Roles y Permisos · Fiscal · Integraciones · Automatización · Seguridad · Preferencias
// Inspirado en: NetSuite, SAP, Odoo
// Contrato { t, s } igual que App.tsx

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import configService, { type SystemIntegration, type CompanyProfile, type ApiUser, type ApiRole, type PermissionDef } from "./service";
import {
  Building2, Users, Shield, Receipt, Plug, Workflow, Lock, Settings,
  Plus, Search, Edit2, Trash2, Check, X, Mail, Globe,
  FileText, Upload, Download, RefreshCw,
  CheckCircle, AlertTriangle, AlertCircle, Info, ChevronRight,
  Key, Bell, Clock, UserPlus,
  ShoppingBag, Truck, Banknote, Fingerprint, Save,
  ToggleLeft, ToggleRight, Activity, ShieldCheck,
} from "lucide-react";

interface User {
  id: number; name: string; email: string; role: string; department: string;
  status: "active" | "inactive" | "pending"; last_login?: string; avatar_color: string;
  role_id?: number | null; is_superuser?: boolean; is_active?: boolean; branch_id?: number | null;
}
interface Role {
  id: number; name: string; description: string; users_count: number; is_system: boolean;
  color: string; permissions: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }>;
}

// Módulos del sistema: [clave_estable, etiqueta]. La clave debe coincidir con
// el backend (rbac.py); la etiqueta es lo que ve el usuario en la matriz.
const MODULES: [string, string][] = [
  ["dashboard", "Tablero"], ["sales", "Ventas / CRM"], ["customers", "Clientes"],
  ["inventory", "Inventario"], ["finance", "Finanzas"], ["hr", "RH / Nómina"],
  ["reports", "Reportes / BI"], ["config", "Configuración"],
];
const MODULE_LABEL: Record<string, string> = Object.fromEntries(MODULES);
const PERM_ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
const emptyGrant = () => ({ view: false, create: false, edit: false, delete: false, approve: false });
interface Integration {
  id: string; name: string; category: string; icon: any; color: string;
  connected: boolean; last_sync?: string; description: string;
}


// Catálogo de integraciones futuras (ninguna conectada — es una hoja de ruta,
// no estado real; el correo SMTP de arriba sí es una integración funcional).
const AVAILABLE_INTEGRATIONS: Integration[] = [
  { id: "mercadolibre", name: "MercadoLibre", category: "Marketplace", icon: ShoppingBag, color: "#FFE600", connected: false, description: "Sincroniza stock y órdenes con tu tienda de MercadoLibre" },
  { id: "amazon", name: "Amazon Seller", category: "Marketplace", icon: ShoppingBag, color: "#FF9900", connected: false, description: "Conecta tu cuenta de vendedor de Amazon" },
  { id: "shopify", name: "Shopify", category: "Marketplace", icon: ShoppingBag, color: "#96BF48", connected: false, description: "Sincroniza productos, stock y pedidos con Shopify" },
  { id: "bbva", name: "BBVA", category: "Banco", icon: Banknote, color: "#004481", connected: false, description: "Dispersión de nómina y conciliación bancaria" },
  { id: "fedex", name: "FedEx", category: "Paquetería", icon: Truck, color: "#4D148C", connected: false, description: "Generación de guías de envío y rastreo" },
  { id: "estafeta", name: "Estafeta", category: "Paquetería", icon: Truck, color: "#EE3124", connected: false, description: "Generación de guías y rastreo de paquetes" },
  { id: "finkok", name: "Finkok", category: "Facturación", icon: Receipt, color: "#33B2F5", connected: false, description: "PAC para timbrado de CFDI 4.0" },
  { id: "zkteco", name: "ZKTeco", category: "Checador", icon: Fingerprint, color: "#34D399", connected: false, description: "Checador biométrico de huella y rostro" },
];

function errorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: any) => (typeof d === "string" ? d : d?.msg || JSON.stringify(d))).join(" · ") || fallback;
  }
  return typeof detail === "object" ? (detail.msg || JSON.stringify(detail)) : String(detail);
}

const PERM_LABELS = { view: "Ver", create: "Crear", edit: "Editar", delete: "Eliminar", approve: "Aprobar" };
const PERM_COLORS = { view: "#60A5FA", create: "#34D399", edit: "#FBBF24", delete: "#F87171", approve: "#A78BFA" };

export default function ConfigModule({ t, s, company }: { t: any; s: any; company?: any }) {
  const [tab, setTab] = useState<"company" | "users" | "roles" | "fiscal" | "integrations" | "automation" | "security" | "preferences">("company");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permList, setPermList] = useState<PermissionDef[]>([]);
  const [rbacLoading, setRbacLoading] = useState(false);
  const [rbacError, setRbacError] = useState("");
  const integrations = AVAILABLE_INTEGRATIONS;
  const [userForm, setUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roleForm, setRoleForm] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [savingPerm, setSavingPerm] = useState(false);

  // Índice (módulo:acción) -> id de permiso, para mandar permission_ids al backend.
  const permIndex: Record<string, number> = {};
  for (const p of permList) permIndex[`${p.module}:${p.action}`] = p.id;

  const apiRoleToView = useCallback((r: ApiRole, allUsers: ApiUser[]): Role => {
    const grid: Role["permissions"] = {};
    for (const [key] of MODULES) grid[key] = emptyGrant();
    for (const p of r.permissions) {
      if (grid[p.module] && p.action in grid[p.module]) (grid[p.module] as any)[p.action] = true;
    }
    return {
      id: r.id, name: r.name, description: r.description || "", color: r.color || "#94A3B8",
      is_system: r.is_system, users_count: allUsers.filter(u => u.role_id === r.id).length,
      permissions: grid,
    };
  }, []);

  const loadRBAC = useCallback(async () => {
    setRbacLoading(true); setRbacError("");
    try {
      const [us, rs, perms] = await Promise.all([
        configService.getUsers(), configService.getRoles(), configService.getPermissions(),
      ]);
      setPermList(perms);
      setRoles(rs.map(r => apiRoleToView(r, us)));
      setUsers(us.map(u => ({
        id: u.id, name: u.full_name || u.email, email: u.email,
        role: u.role_obj?.name || (u.is_superuser ? "Administrador" : "—"),
        department: "—",
        status: (u.is_active ? "active" : "inactive") as User["status"],
        avatar_color: u.role_obj?.color || "#94A3B8",
        role_id: u.role_id ?? null, is_superuser: u.is_superuser, is_active: u.is_active, branch_id: (u as any).branch_id ?? null,
      })));
    } catch (err: any) {
      setRbacError(errorMessage(err, "No se pudieron cargar usuarios y roles. Verifica que tu cuenta tenga permisos de Configuración."));
      setUsers([]); setRoles([]);
    } finally { setRbacLoading(false); }
  }, [apiRoleToView]);

  useEffect(() => { if (tab === "users" || tab === "roles") loadRBAC(); }, [tab, loadRBAC]);

  // Alterna un permiso de un rol y lo persiste de inmediato (autosave).
  const togglePerm = async (role: Role, moduleKey: string, action: string) => {
    if (role.is_system) return;
    const current = new Set<string>();
    for (const [key] of MODULES) for (const a of PERM_ACTIONS) if ((role.permissions[key] as any)?.[a]) current.add(`${key}:${a}`);
    const pair = `${moduleKey}:${action}`;
    if (current.has(pair)) current.delete(pair); else current.add(pair);
    const permission_ids = [...current].map(k => permIndex[k]).filter((x): x is number => typeof x === "number");
    setSavingPerm(true);
    try {
      await configService.updateRole(role.id, { permission_ids });
      await loadRBAC();
      setSelectedRole(prev => prev && prev.id === role.id
        ? { ...prev, permissions: { ...prev.permissions, [moduleKey]: { ...prev.permissions[moduleKey], [action]: !(prev.permissions[moduleKey] as any)[action] } } }
        : prev);
    } catch (err: any) {
      alert(errorMessage(err, "No se pudo actualizar el permiso."));
    } finally { setSavingPerm(false); }
  };

  const deleteRole = async (role: Role) => {
    if (role.is_system) return;
    if (!confirm(`¿Eliminar el rol "${role.name}"? Los usuarios con este rol quedarán sin rol asignado.`)) return;
    try { await configService.deleteRole(role.id); if (selectedRole?.id === role.id) setSelectedRole(null); await loadRBAC(); }
    catch (err: any) { alert(errorMessage(err, "No se pudo eliminar el rol.")); }
  };

  const deleteUser = async (u: User) => {
    if (!confirm(`¿Eliminar al usuario "${u.name}"? Esta acción no se puede deshacer.`)) return;
    try { await configService.deleteUser(u.id); await loadRBAC(); }
    catch (err: any) { alert(errorMessage(err, "No se pudo eliminar el usuario.")); }
  };
  const [q, setQ] = useState("");
  const [emailIntegration, setEmailIntegration] = useState<SystemIntegration | null>(null);
  const [emailForm, setEmailForm] = useState({ host: "", port: "587", username: "", password: "", from_email: "", from_name: "", use_tls: true, is_active: false });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestTo, setEmailTestTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");

  const [companyExists, setCompanyExists] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyProfile>({
    legal_name: "", tax_id: "", contact_email: "", contact_phone: "", address: "",
    base_currency: "MXN", timezone: "America/Mexico_City", logo_url: "",
    commercial_name: "", brand_color: "#33B2F5", document_footer: "",
    business_mode: "product",
  });
  const [companySaving, setCompanySaving] = useState(false);
  const [companyMsg, setCompanyMsg] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [branches, setBranches] = useState<import("./service").Branch[]>([]);
  const [branchForm, setBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState<import("./service").Branch | null>(null);
  const loadBranches = useCallback(async () => {
    try { setBranches(await configService.getBranches()); } catch { setBranches([]); }
  }, []);
  useEffect(() => { if (tab === "company") loadBranches(); }, [tab, loadBranches]);
  const removeBranch = async (b: import("./service").Branch) => {
    if (!confirm(`¿Eliminar la sucursal "${b.name}"? Sus almacenes y usuarios quedarán sin sucursal.`)) return;
    try { await configService.deleteBranch(b.id); await loadBranches(); }
    catch (err: any) { alert(errorMessage(err, "No se pudo eliminar la sucursal.")); }
  };

  const lang = "es";

  const loadCompanyProfile = useCallback(async () => {
    try {
      const data = await configService.getCompanyProfile();
      setCompanyForm({
        legal_name: data.legal_name || "", tax_id: data.tax_id || "",
        contact_email: data.contact_email || "", contact_phone: data.contact_phone || "",
        address: data.address || "", base_currency: data.base_currency || "MXN",
        timezone: data.timezone || "America/Mexico_City", logo_url: data.logo_url || "",
        commercial_name: data.commercial_name || "", brand_color: data.brand_color || "#33B2F5",
        document_footer: data.document_footer || "",
        business_mode: (data.business_mode as any) || "product",
      });
      setCompanyExists(true);
    } catch { setCompanyExists(false); }
  }, []);

  useEffect(() => { if (tab === "company") loadCompanyProfile(); }, [tab, loadCompanyProfile]);

  const handleSaveCompanyProfile = async () => {
    setCompanySaving(true); setCompanyMsg("");
    try {
      const payload = { ...companyForm, contact_email: companyForm.contact_email?.trim() || undefined };
      if (companyExists) await configService.updateCompanyProfile(payload);
      else await configService.createCompanyProfile(payload);
      setCompanyMsg("Datos de la empresa guardados ✓");
      await loadCompanyProfile();
    } catch (err: any) {
      setCompanyMsg(errorMessage(err, "No se pudo guardar la información de la empresa."));
    } finally {
      setCompanySaving(false);
    }
  };

  // Comprime el logo a un data-URI base64 (máx 256px) y lo guarda EN LA BASE DE
  // DATOS (columna logo_url). Antes se subía a /media/upload, que escribe en el
  // disco efímero del contenedor (se borra en cada redeploy/reinicio en Render),
  // por eso el logo "desaparecía" al recargar. Un data-URI persiste siempre.
  const fileToCompressedDataUri = (file: File, max = 256): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        // SVG: no se rasteriza, se guarda tal cual (vectorial, ligero).
        if (file.type === "image/svg+xml") { resolve(String(reader.result)); return; }
        const img = new Image();
        img.onerror = () => reject(new Error("img"));
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("ctx")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setCompanyMsg("El logo no debe pesar más de 2MB.");
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    if (!companyExists && !companyForm.legal_name) {
      setCompanyMsg("Primero escribe el nombre de la empresa y guarda, luego sube el logo.");
      if (logoInputRef.current) logoInputRef.current.value = "";
      return;
    }
    setLogoUploading(true); setCompanyMsg("");
    try {
      // Nuevo endpoint: sube el archivo real a /uploads/company y regresa la URL.
      // El PDF de cotización/remisión necesita el logo en disco (no data URI).
      const res = await configService.uploadCompanyLogo(file);
      setCompanyForm(f => ({ ...f, logo_url: res.logo_url }));
      setCompanyExists(true);
      setCompanyMsg("Logo actualizado ✓");
    } catch (err: any) {
      setCompanyMsg(errorMessage(err, "No se pudo subir el logo."));
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const loadEmailIntegration = useCallback(async () => {
    try {
      const list = await configService.getIntegrations();
      const found = list.find(i => i.integration_type === "EMAIL") || null;
      setEmailIntegration(found);
      if (found) {
        const meta = found.meta_data || {};
        setEmailForm({
          host: meta.host || "", port: String(meta.port || 587), username: found.api_key || "",
          password: "", from_email: meta.from_email || "", from_name: meta.from_name || "",
          use_tls: meta.use_tls !== false, is_active: found.is_active,
        });
      }
    } catch { /* sin backend (modo demo) */ }
  }, []);

  useEffect(() => { if (tab === "integrations") loadEmailIntegration(); }, [tab, loadEmailIntegration]);

  const handleSaveEmailIntegration = async (): Promise<boolean> => {
    setEmailSaving(true); setEmailMsg("");
    try {
      const payload = {
        provider_name: "OTHER" as const,
        integration_type: "EMAIL" as const,
        is_active: emailForm.is_active,
        environment: "PRODUCTION" as const,
        api_key: emailForm.username,
        api_secret: emailForm.password || (emailIntegration?.api_secret ?? ""),
        meta_data: { host: emailForm.host, port: Number(emailForm.port) || 587, use_tls: emailForm.use_tls, from_email: emailForm.from_email, from_name: emailForm.from_name },
      };
      if (emailIntegration) await configService.updateIntegration(emailIntegration.id, payload);
      else await configService.createIntegration(payload);
      setEmailMsg("Configuración de correo guardada ✓");
      await loadEmailIntegration();
      return true;
    } catch (err: any) {
      setEmailMsg(errorMessage(err, "No se pudo guardar la configuración de correo."));
      return false;
    } finally {
      setEmailSaving(false);
    }
  };

  // Envía un correo de prueba con la configuración vigente (proveedor de
  // plataforma por env, o SMTP guardado) y muestra el resultado REAL.
  const handleTestEmail = async () => {
    setEmailTesting(true); setEmailMsg("");
    try {
      const dest = emailTestTo.trim() || emailForm.from_email || undefined;
      const res = await configService.testEmail(dest);
      if (res.ok) setEmailMsg(`Correo de prueba enviado a ${dest || "el destinatario"} ✓ Revisa la bandeja (y spam).`);
      else setEmailMsg(`No se pudo enviar: ${res.error}`);
    } catch (err: any) {
      setEmailMsg(errorMessage(err, "No se pudo enviar el correo de prueba."));
    } finally {
      setEmailTesting(false);
    }
  };

  // Vidrio: en modo oscuro devuelve panel translúcido + blur; en claro, sólido.
  const glass = (t: any): React.CSSProperties =>
    t?.name === "dark"
      ? { background: "rgba(20,32,68,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: `1px solid ${t.border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }
      : { background: t.panel, border: `1px solid ${t.border}` };

  const comp = company || { name: "Comercializadora del Valle", initials: "CV", color: "#33B2F5" };
  const inp: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 5, display: "block" };
  const tabBtn = (active: boolean): React.CSSProperties => ({ padding: "10px 14px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontWeight: active ? 700 : 500, fontSize: 12.5, background: active ? t.panel : "transparent", color: active ? t.nova : t.textLo, borderBottom: active ? `2px solid ${t.nova}` : "2px solid transparent", transition: "all .15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 });

  const TABS = [
    { id: "company", label: "Empresa", icon: Building2 },
    { id: "users", label: "Usuarios", icon: Users },
    { id: "roles", label: "Roles y Permisos", icon: Shield },
    { id: "fiscal", label: "Fiscal", icon: Receipt },
    { id: "integrations", label: "Integraciones", icon: Plug },
    { id: "automation", label: "Automatización", icon: Workflow },
    { id: "security", label: "Seguridad", icon: Lock },
    { id: "preferences", label: "Preferencias", icon: Settings },
  ] as const;

  // card usa glass — todos los paneles que usan style={card} heredan el vidrio de golpe
  const card: React.CSSProperties = { ...glass(t), borderRadius: 12, padding: 20 };

  const sectionTitle = (icon: any, title: string, color: string) => {
    const Icon = icon;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ background: color + "22", color, borderRadius: 8, padding: 7, display: "flex" }}><Icon size={16} /></div>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: t.textHi }}>{title}</span>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, color: t.textHi, letterSpacing: -0.3 }}>Configuración</h1>
        <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 13 }}>Administración del sistema, usuarios, permisos e integraciones</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 20, overflowX: "auto", gap: 2 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id as any)} style={tabBtn(tab === id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ── TAB: Company ── */}
      {tab === "company" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Building2, "Identidad de la empresa", t.nova)}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                {companyForm.logo_url
                  ? <img src={(companyForm.logo_url.startsWith("http") || companyForm.logo_url.startsWith("data:")) ? companyForm.logo_url : `${(import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "")}${companyForm.logo_url}`}
                      alt="Logo"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      style={{ width: 64, height: 64, borderRadius: 16, objectFit: "cover", border: `1px solid ${t.border}` }} />
                  : <div style={{ width: 64, height: 64, borderRadius: 16, background: comp.color + "26", color: comp.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800 }}>{comp.initials}</div>}
                <div style={{ flex: 1 }}>
                  <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/jpeg" style={{ display: "none" }} onChange={handleLogoChange} />
                  <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                    <Upload size={14} /> {logoUploading ? "Subiendo…" : "Cambiar logo"}
                  </button>
                  {companyForm.logo_url?.includes("/config/company/logo") ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: t.good, marginTop: 6, fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: t.good }} />
                      Guardado en base de datos (persistente)
                    </div>
                  ) : companyForm.logo_url ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: t.warn, marginTop: 6, fontWeight: 600 }}>
                      <AlertCircle size={11} />
                      <span>Vuelve a subir el logo para hacerlo persistente</span>
                    </div>
                  ) : null}
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 4 }}>PNG, JPG o SVG, máx 2MB</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Nombre / razón social</label><input value={companyForm.legal_name} onChange={e => setCompanyForm(f => ({ ...f, legal_name: e.target.value }))} style={inp} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={lbl}>Teléfono</label><input value={companyForm.contact_phone || ""} onChange={e => setCompanyForm(f => ({ ...f, contact_phone: e.target.value }))} style={inp} /></div>
                  <div><label style={lbl}>Email de contacto</label><input value={companyForm.contact_email || ""} onChange={e => setCompanyForm(f => ({ ...f, contact_email: e.target.value }))} style={inp} /></div>
                </div>
              </div>
            </div>
            <div style={card}>
              {sectionTitle(FileText, "Datos fiscales", t.good)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>RFC</label><input value={companyForm.tax_id || ""} onChange={e => setCompanyForm(f => ({ ...f, tax_id: e.target.value }))} style={{ ...inp, fontFamily: "monospace" }} /></div>
                <div><label style={lbl}>Dirección fiscal</label><input value={companyForm.address || ""} onChange={e => setCompanyForm(f => ({ ...f, address: e.target.value }))} style={inp} /></div>
              </div>
            </div>
          </div>

          {/* Branding para documentos PDF (cotización, remisión, factura) */}
          <div style={card}>
            {sectionTitle(FileText, "Documentos y branding", "#8E7BB8")}
            <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 14 }}>Estos datos aparecen en los PDFs de cotización, remisión y pre-factura.</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 12 }}>
              <div><label style={lbl}>Nombre comercial (marca)</label>
                <input value={companyForm.commercial_name || ""} placeholder="Ej. Sthenova, Sears, La Tienda…"
                       onChange={e => setCompanyForm(f => ({ ...f, commercial_name: e.target.value }))} style={inp} />
              </div>
              <div><label style={lbl}>Modo de negocio</label>
                <select value={companyForm.business_mode || "product"} onChange={e => setCompanyForm(f => ({ ...f, business_mode: e.target.value as any }))} style={{ ...inp, cursor: "pointer" }}>
                  <option value="product">Productos con inventario</option>
                  <option value="service">Solo servicios</option>
                  <option value="mixed">Mixto (productos + servicios)</option>
                </select>
              </div>
              <div><label style={lbl}>Color de acento</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="color" value={companyForm.brand_color || "#33B2F5"}
                         onChange={e => setCompanyForm(f => ({ ...f, brand_color: e.target.value }))}
                         style={{ width: 44, height: 38, borderRadius: 6, border: `1px solid ${t.border}`, background: "transparent", cursor: "pointer" }} />
                  <input value={companyForm.brand_color || "#33B2F5"} onChange={e => setCompanyForm(f => ({ ...f, brand_color: e.target.value }))} style={{ ...inp, fontFamily: "monospace" }} />
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Pie de página en documentos (opcional)</label>
              <textarea value={companyForm.document_footer || ""} rows={2}
                        placeholder="Ej. Cotización válida por 15 días. Precios sujetos a cambio. IVA incluido."
                        onChange={e => setCompanyForm(f => ({ ...f, document_footer: e.target.value }))}
                        style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Globe, "Configuración regional", "#A78BFA")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Moneda base</label>
                  <select value={companyForm.base_currency} onChange={e => setCompanyForm(f => ({ ...f, base_currency: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="MXN">MXN - Peso Mexicano</option><option value="USD">USD - Dólar</option>
                  </select>
                </div>
                <div><label style={lbl}>Zona horaria</label>
                  <select value={companyForm.timezone} onChange={e => setCompanyForm(f => ({ ...f, timezone: e.target.value }))} style={{ ...inp, cursor: "pointer" }}>
                    <option value="America/Mexico_City">(GMT-6) Ciudad de México</option><option value="America/Tijuana">(GMT-7) Tijuana</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={card}>
              {sectionTitle(Building2, "Empresas / Sucursales", t.warn)}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {branches.length === 0 && (
                  <div style={{ fontSize: 12.5, color: t.textLo, padding: "8px 2px" }}>Aún no hay sucursales. Agrega la matriz para empezar.</div>
                )}
                {branches.map(b => {
                  const color = b.is_primary ? t.good : t.nova;
                  const initials = (b.code || b.name).slice(0, 2).toUpperCase();
                  return (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, background: t.panel2 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: color + "26", color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: t.textHi, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}{!b.is_active && <span style={{ fontSize: 10, color: t.textLo }}> · inactiva</span>}</div>
                        {(b.legal_name || b.tax_id) && <div style={{ fontSize: 11, color: t.textLo }}>{[b.legal_name, b.tax_id].filter(Boolean).join(" · ")}</div>}
                      </div>
                      {b.is_primary && <span style={{ fontSize: 10, fontWeight: 700, color: t.good, background: t.good + "18", padding: "2px 7px", borderRadius: 6 }}>Matriz</span>}
                      <button onClick={() => { setEditingBranch(b); setBranchForm(true); }} title="Editar" style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}><Edit2 size={14} /></button>
                      <button onClick={() => removeBranch(b)} title="Eliminar" style={{ background: "transparent", border: "none", cursor: "pointer", color: t.bad, display: "flex" }}><Trash2 size={14} /></button>
                    </div>
                  );
                })}
                <button onClick={() => { setEditingBranch(null); setBranchForm(true); }} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 8, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  <Plus size={14} /> Agregar sucursal
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
            {companyMsg && <span style={{ fontSize: 12, color: companyMsg.includes("✓") ? t.good : t.bad }}>{companyMsg}</span>}
            <button onClick={handleSaveCompanyProfile} disabled={companySaving || !companyForm.legal_name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !companyForm.legal_name ? 0.5 : 1 }}>
              <Save size={15} /> {companySaving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Users ── */}
      {tab === "users" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar usuario por nombre o email…" style={{ ...inp, paddingLeft: 34 }} />
            </div>
            <button onClick={() => { setEditingUser(null); setUserForm(true); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <UserPlus size={15} /> Nuevo usuario
            </button>
          </div>
          {/* Tabla sólida */}
          <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Usuario", "Rol", "Departamento", "Último acceso", "Estado", ""].map((h, i) => (
                      <th key={i} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())).map((u, i) => {
                    const statusMeta = { active: { label: "Activo", color: t.good }, inactive: { label: "Inactivo", color: t.bad }, pending: { label: "Invitación enviada", color: t.warn } }[u.status];
                    return (
                      <tr key={u.id} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 99, background: u.avatar_color + "33", color: u.avatar_color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                              {u.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                            </div>
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textHi }}>{u.name}</div>
                              <div style={{ fontSize: 11.5, color: t.textLo }}>{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px" }}><span style={{ fontSize: 12, color: t.nova, background: t.nova + "18", padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>{u.role}</span></td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{u.department}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo }}>{u.last_login || "Nunca"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: statusMeta.color }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: statusMeta.color }} />{statusMeta.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => { setEditingUser(u); setUserForm(true); }} title="Editar" style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", color: t.textLo, cursor: "pointer" }}><Edit2 size={15} /></button>
                            <button onClick={() => deleteUser(u)} title="Eliminar" style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", color: t.bad, cursor: "pointer" }}><Trash2 size={15} /></button>
                          </div>
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

      {/* ── TAB: Roles ── */}
      {tab === "roles" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: t.textLo }}>Define qué puede ver y hacer cada rol en cada módulo del sistema. Los cambios en la matriz se guardan al instante.</p>
            <button onClick={() => setRoleForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Crear rol
            </button>
          </div>
          {rbacError && <div style={{ fontSize: 12.5, color: t.bad, background: t.bad + "12", border: `1px solid ${t.bad}33`, borderRadius: 8, padding: "10px 14px" }}>{rbacError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {roles.map(r => (
              <div key={r.id} onClick={() => setSelectedRole(r)} style={{ ...glass(t), border: `1px solid ${selectedRole?.id === r.id ? r.color : t.border}`, borderRadius: 12, padding: 18, cursor: "pointer", transition: "all .15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ background: r.color + "22", color: r.color, borderRadius: 10, padding: 9, display: "flex" }}><Shield size={18} /></div>
                  {r.is_system && <span style={{ fontSize: 10, fontWeight: 700, color: t.textLo, background: t.panel3, padding: "2px 7px", borderRadius: 6 }}>Sistema</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 4 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: t.textLo, lineHeight: 1.4, marginBottom: 12, minHeight: 32 }}>{r.description}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: t.textMid, display: "flex", alignItems: "center", gap: 5 }}><Users size={13} />{r.users_count} usuario{r.users_count !== 1 ? "s" : ""}</span>
                  <span style={{ fontSize: 12, color: r.color, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>Ver permisos <ChevronRight size={13} /></span>
                </div>
              </div>
            ))}
          </div>
          {selectedRole && (
            <div style={{ ...glass(t), borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ background: selectedRole.color + "22", color: selectedRole.color, borderRadius: 8, padding: 7, display: "flex" }}><Shield size={16} /></div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: t.textHi }}>Matriz de permisos — {selectedRole.name}</div>
                    <div style={{ fontSize: 12, color: t.textLo }}>{selectedRole.description}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {savingPerm && <span style={{ fontSize: 11.5, color: t.textLo }}>Guardando…</span>}
                  {!selectedRole.is_system && (
                    <button onClick={() => deleteRole(selectedRole)} title="Eliminar rol" style={{ background: "transparent", border: `1px solid ${t.bad}55`, color: t.bad, cursor: "pointer", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}><Trash2 size={13} /> Eliminar rol</button>
                  )}
                  <button onClick={() => setSelectedRole(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                  <thead>
                    <tr style={{ background: t.panel2 }}>
                      <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase" }}>Módulo</th>
                      {Object.entries(PERM_LABELS).map(([k, v]) => (
                        <th key={k} style={{ padding: "10px 16px", textAlign: "center", fontSize: 11, fontWeight: 600, color: PERM_COLORS[k as keyof typeof PERM_COLORS], borderBottom: `1px solid ${t.border}`, textTransform: "uppercase" }}>{v}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map(([modKey, modLabel], i) => {
                      const perms = selectedRole.permissions[modKey] || emptyGrant();
                      return (
                        <tr key={modKey} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                          <td style={{ padding: "11px 16px", fontSize: 13, color: t.textHi, fontWeight: 500 }}>{modLabel}</td>
                          {(Object.keys(PERM_LABELS) as (keyof typeof PERM_LABELS)[]).map(perm => (
                            <td key={perm} style={{ padding: "11px 16px", textAlign: "center" }}>
                              <button disabled={selectedRole.is_system || savingPerm}
                                onClick={() => togglePerm(selectedRole, modKey, perm)}
                                style={{ background: "transparent", border: "none", cursor: selectedRole.is_system ? "default" : "pointer", display: "inline-flex" }}>
                                {(perms as any)[perm] ? <CheckCircle size={18} color={PERM_COLORS[perm]} /> : <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${t.border}` }} />}
                              </button>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectedRole.is_system && (
                <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: t.textLo, background: t.panel2, padding: "10px 14px", borderRadius: 8 }}>
                  <Info size={15} /> Los roles de sistema (Administrador, Solo lectura) no se pueden modificar ni eliminar. Crea un rol personalizado para ajustar permisos.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Fiscal ── */}
      {tab === "fiscal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Receipt, "Facturación CFDI 4.0", t.nova)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>PAC (Proveedor de timbrado)</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Finkok</option><option>Facturama</option><option>Solución Factible</option></select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={lbl}>Serie</label><input defaultValue="A" style={inp} /></div>
                  <div><label style={lbl}>Folio actual</label><input defaultValue="1024" style={inp} /></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: t.good + "12", border: `1px solid ${t.good}33` }}>
                  <CheckCircle size={16} color={t.good} />
                  <span style={{ fontSize: 12.5, color: t.good }}>PAC conectado — 4,821 timbres disponibles</span>
                </div>
              </div>
            </div>
            <div style={card}>
              {sectionTitle(Key, "Certificados CSD", t.warn)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ padding: "14px", borderRadius: 8, border: `2px dashed ${t.border}`, textAlign: "center" }}>
                  <Upload size={24} color={t.textLo} style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontSize: 12.5, color: t.textMid }}>Sube tu certificado (.cer)</div>
                </div>
                <div style={{ padding: "14px", borderRadius: 8, border: `2px dashed ${t.border}`, textAlign: "center" }}>
                  <Upload size={24} color={t.textLo} style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontSize: 12.5, color: t.textMid }}>Sube tu llave privada (.key)</div>
                </div>
                <div><label style={lbl}>Contraseña de la llave</label><input type="password" placeholder="••••••••" style={inp} /></div>
              </div>
            </div>
          </div>
          <div style={card}>
            {sectionTitle(FileText, "Impuestos configurados", t.good)}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                <thead>
                  <tr style={{ background: t.panel2 }}>
                    {["Impuesto", "Tipo", "Tasa", "Aplicación", ""].map((h, i) => (
                      <th key={i} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "IVA", type: "Traslado", rate: "16%", apply: "General" },
                    { name: "IVA Frontera", type: "Traslado", rate: "8%", apply: "Zona fronteriza" },
                    { name: "IVA Retención", type: "Retención", rate: "10.67%", apply: "Servicios" },
                    { name: "ISR Retención", type: "Retención", rate: "10%", apply: "Honorarios" },
                  ].map((tax, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: t.textHi, fontWeight: 600 }}>{tax.name}</td>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: t.textMid }}>{tax.type}</td>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: t.nova, fontWeight: 700 }}>{tax.rate}</td>
                      <td style={{ padding: "11px 16px", fontSize: 13, color: t.textMid }}>{tax.apply}</td>
                      <td style={{ padding: "11px 16px" }}><button style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", color: t.textLo, cursor: "pointer" }}><Edit2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Integrations ── */}
      {tab === "integrations" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...glass(t), borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, display: "flex", alignItems: "center", gap: 8 }}><Mail size={16} /> Correo para recordatorios (SMTP)</div>
                <div style={{ fontSize: 12, color: t.textLo, marginTop: 4, maxWidth: 560 }}>Configura tu propio servidor de correo (Gmail, Office 365, tu hosting, etc.) para que el sistema te envíe recordatorios de pagos programados y avisos. Cada empresa usa sus propias credenciales.</div>
              </div>
              {emailIntegration?.is_active && <span style={{ fontSize: 11, fontWeight: 700, color: t.good, background: t.good + "18", padding: "3px 9px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}><span style={{ width: 6, height: 6, borderRadius: 99, background: t.good }} />Activo</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Servidor SMTP</label>
                <input value={emailForm.host} onChange={e => setEmailForm(f => ({ ...f, host: e.target.value }))} placeholder="smtp.gmail.com" style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Puerto</label>
                <input value={emailForm.port} onChange={e => setEmailForm(f => ({ ...f, port: e.target.value }))} placeholder="587" style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Usuario / correo</label>
                <input value={emailForm.username} onChange={e => setEmailForm(f => ({ ...f, username: e.target.value }))} placeholder="empresa@gmail.com" style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Contraseña / token</label>
                <input type="password" value={emailForm.password} onChange={e => setEmailForm(f => ({ ...f, password: e.target.value }))} placeholder={emailIntegration ? "•••••••• (sin cambios)" : "Contraseña de aplicación"} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Correo remitente</label>
                <input value={emailForm.from_email} onChange={e => setEmailForm(f => ({ ...f, from_email: e.target.value }))} placeholder="avisos@empresa.com" style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
              <div><label style={{ fontSize: 11.5, fontWeight: 600, color: t.textMid, marginBottom: 4, display: "block" }}>Nombre remitente</label>
                <input value={emailForm.from_name} onChange={e => setEmailForm(f => ({ ...f, from_name: e.target.value }))} placeholder="Mi Empresa" style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.textMid, cursor: "pointer" }}>
                <input type="checkbox" checked={emailForm.use_tls} onChange={e => setEmailForm(f => ({ ...f, use_tls: e.target.checked }))} /> Usar TLS
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.textMid, cursor: "pointer" }}>
                <input type="checkbox" checked={emailForm.is_active} onChange={e => setEmailForm(f => ({ ...f, is_active: e.target.checked }))} /> Activar envío de correos
              </label>
              <button onClick={handleSaveEmailIntegration} disabled={emailSaving || emailTesting || !emailForm.host || !emailForm.from_email} style={{ marginLeft: "auto", padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: (!emailForm.host || !emailForm.from_email) ? 0.5 : 1 }}>
                {emailSaving ? "Guardando…" : "Guardar SMTP"}
              </button>
            </div>

            {/* Probar correo — funciona con el proveedor de plataforma (Resend/SendGrid) aunque no llenes SMTP */}
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${t.border}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMid, marginBottom: 8 }}>Probar el envío</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={emailTestTo} onChange={e => setEmailTestTo(e.target.value)} placeholder="Enviar prueba a: tucorreo@ejemplo.com" style={{ flex: 1, minWidth: 220, padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
                <button onClick={handleTestEmail} disabled={emailTesting} style={{ padding: "9px 18px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: emailTesting ? 0.6 : 1 }}>
                  {emailTesting ? "Enviando prueba…" : "Probar correo"}
                </button>
              </div>
            </div>
            {emailMsg && <div style={{ fontSize: 12, color: emailMsg.includes("✓") ? t.good : t.bad, marginTop: 10 }}>{emailMsg}</div>}
            <div style={{ fontSize: 11, color: t.textLo, marginTop: 10 }}>El correo de STHENOVA puede enviarse por un proveedor a nivel plataforma (Resend/SendGrid) — en ese caso no necesitas llenar los campos SMTP de arriba; solo pica "Probar correo". Los recordatorios se envían al correo de contacto de la empresa (pestaña "Empresa") cuando un pago programado está por vencer o ya venció.</div>
          </div>

          {["Marketplace", "Banco", "Paquetería", "Facturación", "Checador"].map(cat => {
            const items = integrations.filter(i => i.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.5, marginBottom: 10, textTransform: "uppercase" }}>{cat}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {items.map(intg => (
                    <div key={intg.id} style={{ ...glass(t), border: `1px solid ${intg.connected ? intg.color + "55" : t.border}`, borderRadius: 12, padding: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <div style={{ background: intg.color + "22", color: intg.color, borderRadius: 10, padding: 10, display: "flex" }}><intg.icon size={20} /></div>
                        {intg.connected
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: t.good, background: t.good + "18", padding: "3px 9px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: t.good }} />Conectado</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, color: t.textLo, background: t.panel3, padding: "3px 9px", borderRadius: 20 }}>No conectado</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.textHi, marginBottom: 5 }}>{intg.name}</div>
                      <div style={{ fontSize: 12, color: t.textLo, lineHeight: 1.4, marginBottom: 14, minHeight: 34 }}>{intg.description}</div>
                      {intg.connected && intg.last_sync && (
                        <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                          <RefreshCw size={12} /> Última sync: {intg.last_sync}
                        </div>
                      )}
                      <button onClick={() => alert(`La integración con ${intg.name} estará disponible próximamente. Contáctanos para priorizarla.`)}
                        style={{ width: "100%", padding: "9px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                        Próximamente
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB: Automation ── */}
      {tab === "automation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: t.textLo }}>Crea reglas automáticas: aprobaciones, notificaciones y alertas sin escribir código. <b style={{ color: t.warn }}>Próximamente — los ejemplos de abajo son ilustrativos y aún no se ejecutan.</b></p>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Nueva regla
            </button>
          </div>
          {[
            { icon: ShieldCheck, title: "Aprobación de pedidos grandes", desc: "Pedidos mayores a $50,000 requieren autorización del gerente antes de confirmarse", active: true, color: t.nova, tag: "Aprobación" },
            { icon: Bell, title: "Alerta de stock bajo", desc: "Notificar al jefe de almacén cuando un producto baje de su stock mínimo", active: true, color: t.warn, tag: "Notificación" },
            { icon: Mail, title: "Recordatorio de pago vencido", desc: "Enviar email al cliente 3 días después de vencer una factura por cobrar", active: true, color: t.good, tag: "Email" },
            { icon: Clock, title: "Cierre automático de nómina", desc: "Calcular nómina automáticamente cada quincena el día 14 y 29", active: false, color: "#A78BFA", tag: "Programada" },
            { icon: AlertTriangle, title: "Alerta de contrato por vencer", desc: "Avisar a RH 15 días antes de que venza un contrato temporal o período de prueba", active: true, color: t.bad, tag: "Alerta" },
          ].map((rule, i) => (
            <div key={i} style={{ ...glass(t), borderRadius: 12, padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ background: rule.color + "22", color: rule.color, borderRadius: 10, padding: 10, display: "flex", flexShrink: 0 }}><rule.icon size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>{rule.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: rule.color, background: rule.color + "18", padding: "2px 7px", borderRadius: 6 }}>{rule.tag}</span>
                </div>
                <div style={{ fontSize: 12.5, color: t.textLo, lineHeight: 1.4 }}>{rule.desc}</div>
              </div>
              <button style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", flexShrink: 0 }}>
                {rule.active ? <ToggleRight size={36} color={t.good} /> : <ToggleLeft size={36} color={t.textLo} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB: Security ── */}
      {tab === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ChangePasswordCard t={t} card={card} lbl={lbl} inp={inp} sectionTitle={sectionTitle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Lock, "Política de contraseñas", t.nova)}
              <div style={{ fontSize: 11.5, color: t.textLo, marginBottom: 8 }}>Próximamente configurable — hoy el sistema exige mínimo 6 caracteres.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Mínimo 8 caracteres", on: true },
                  { label: "Requiere mayúsculas y minúsculas", on: true },
                  { label: "Requiere números", on: true },
                  { label: "Requiere caracteres especiales", on: false },
                  { label: "Expira cada 90 días", on: false },
                ].map(p => (
                  <div key={p.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
                    <span style={{ fontSize: 13, color: t.textMid }}>{p.label}</span>
                    {p.on ? <ToggleRight size={30} color={t.good} /> : <ToggleLeft size={30} color={t.textLo} />}
                  </div>
                ))}
              </div>
            </div>
            <TwoFactorCard t={t} card={card} sectionTitle={sectionTitle} />
          </div>
          <AuditLogCard t={t} card={card} sectionTitle={sectionTitle} />
          <DangerZoneCard t={t} card={card} lbl={lbl} inp={inp} sectionTitle={sectionTitle} />
        </div>
      )}

      {/* ── TAB: Preferences ── */}
      {tab === "preferences" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Settings, "Apariencia", t.nova)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Tema</label><select style={{ ...inp, cursor: "pointer" }}><option>Oscuro</option><option>Claro</option><option>Automático (según sistema)</option></select></div>
                <div><label style={lbl}>Idioma de la interfaz</label><select style={{ ...inp, cursor: "pointer" }}><option>Español</option><option>English</option></select></div>
                <div><label style={lbl}>Densidad de la interfaz</label><select style={{ ...inp, cursor: "pointer" }}><option>Cómoda</option><option>Compacta</option></select></div>
              </div>
            </div>
            <div style={card}>
              {sectionTitle(Globe, "Formatos regionales", t.good)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Formato de fecha</label><select style={{ ...inp, cursor: "pointer" }}><option>DD/MM/AAAA</option><option>MM/DD/AAAA</option><option>AAAA-MM-DD</option></select></div>
                <div><label style={lbl}>Formato de números</label><select style={{ ...inp, cursor: "pointer" }}><option>1,234.56</option><option>1.234,56</option></select></div>
                <div><label style={lbl}>Símbolo de moneda</label><select style={{ ...inp, cursor: "pointer" }}><option>$ (MXN)</option><option>US$ (USD)</option></select></div>
              </div>
            </div>
          </div>
          <div style={card}>
            {sectionTitle(Bell, "Notificaciones por email", t.warn)}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "Resumen diario de ventas", on: true },
                { label: "Alertas de stock bajo", on: true },
                { label: "Facturas por cobrar vencidas", on: true },
                { label: "Nuevos pedidos recibidos", on: false },
                { label: "Reportes semanales de BI", on: true },
                { label: "Alertas de seguridad", on: true },
              ].map(n => (
                <div key={n.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${t.borderSoft}` }}>
                  <span style={{ fontSize: 13, color: t.textMid }}>{n.label}</span>
                  {n.on ? <ToggleRight size={30} color={t.good} /> : <ToggleLeft size={30} color={t.textLo} />}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Save size={15} /> Guardar preferencias
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: Crear / Editar usuario ── */}
      {userForm && (
        <UserFormModal t={t} lbl={lbl} inp={inp} roles={roles} branches={branches} editing={editingUser}
          onClose={() => { setUserForm(false); setEditingUser(null); }}
          onSaved={async () => { setUserForm(false); setEditingUser(null); await loadRBAC(); }} />
      )}

      {/* ── MODAL: Crear rol ── */}
      {roleForm && (
        <RoleFormModal t={t} lbl={lbl} inp={inp}
          onClose={() => setRoleForm(false)}
          onSaved={async () => { setRoleForm(false); await loadRBAC(); }} />
      )}

      {/* ── MODAL: Crear / editar sucursal ── */}
      {branchForm && (
        <BranchFormModal t={t} lbl={lbl} inp={inp} editing={editingBranch}
          onClose={() => { setBranchForm(false); setEditingBranch(null); }}
          onSaved={async () => { setBranchForm(false); setEditingBranch(null); await loadBranches(); }} />
      )}
    </div>
  );
}

// ── Modal: crear / editar sucursal ─────────────────────────────────────────
function BranchFormModal({ t, lbl, inp, editing, onClose, onSaved }: any) {
  const [f, setF] = useState({
    name: editing?.name || "", code: editing?.code || "", legal_name: editing?.legal_name || "",
    tax_id: editing?.tax_id || "", address: editing?.address || "", phone: editing?.phone || "",
    email: editing?.email || "", is_primary: editing?.is_primary || false, is_active: editing?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: any) => setF(prev => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload = { ...f, code: f.code || null, legal_name: f.legal_name || null, tax_id: f.tax_id || null, address: f.address || null, phone: f.phone || null, email: f.email || null };
      if (editing) await configService.updateBranch(editing.id, payload);
      else await configService.createBranch(payload);
      await onSaved();
    } catch (err: any) { setError(errorMessage(err, "No se pudo guardar la sucursal.")); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 480, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.warn + "22", color: t.warn, borderRadius: 8, padding: 8, display: "flex" }}><Building2 size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{editing ? "Editar sucursal" : "Nueva sucursal"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <div><label style={lbl}>Nombre *</label><input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Sucursal Centro" style={inp} /></div>
            <div><label style={lbl}>Clave</label><input value={f.code} onChange={e => set({ code: e.target.value })} placeholder="CDMX" style={inp} /></div>
          </div>
          <div><label style={lbl}>Razón social</label><input value={f.legal_name} onChange={e => set({ legal_name: e.target.value })} placeholder="Empresa S.A. de C.V." style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>RFC</label><input value={f.tax_id} onChange={e => set({ tax_id: e.target.value })} placeholder="XAXX010101000" style={inp} /></div>
            <div><label style={lbl}>Teléfono</label><input value={f.phone} onChange={e => set({ phone: e.target.value })} style={inp} /></div>
          </div>
          <div><label style={lbl}>Dirección</label><input value={f.address} onChange={e => set({ address: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Email</label><input value={f.email} onChange={e => set({ email: e.target.value })} style={inp} /></div>
          <div style={{ display: "flex", gap: 18 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: t.textMid, cursor: "pointer" }}>
              <input type="checkbox" checked={f.is_primary} onChange={e => set({ is_primary: e.target.checked })} /> Sucursal matriz
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: t.textMid, cursor: "pointer" }}>
              <input type="checkbox" checked={f.is_active} onChange={e => set({ is_active: e.target.checked })} /> Activa
            </label>
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={save} disabled={saving || !f.name.trim()} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !f.name.trim() ? 0.5 : 1 }}>
            {saving ? "…" : editing ? "Guardar cambios" : "Crear sucursal"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Tarjeta: cambiar mi propia contraseña (real, exige contraseña actual) ───
function ChangePasswordCard({ t, card, lbl, inp, sectionTitle }: any) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const valid = cur && next.length >= 6 && next === confirm;

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      await configService.changeMyPassword(cur, next);
      setMsg("Contraseña actualizada ✓");
      setCur(""); setNext(""); setConfirm("");
    } catch (err: any) { setMsg(errorMessage(err, "No se pudo cambiar la contraseña.")); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ ...card, maxWidth: 520 }}>
      {sectionTitle(Lock, "Cambiar mi contraseña", t.nova)}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={lbl}>Contraseña actual *</label><input type="password" value={cur} onChange={e => setCur(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>Nueva contraseña *</label><input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="Mínimo 6 caracteres" style={inp} /></div>
        <div><label style={lbl}>Confirmar nueva contraseña *</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inp} /></div>
        {next.length > 0 && next.length < 6 && <div style={{ fontSize: 11.5, color: t.warn }}>La nueva contraseña debe tener al menos 6 caracteres.</div>}
        {confirm.length > 0 && next !== confirm && <div style={{ fontSize: 11.5, color: t.bad }}>Las contraseñas no coinciden.</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={save} disabled={saving || !valid} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.5 : 1 }}>
            {saving ? "…" : "Actualizar contraseña"}
          </button>
          {msg && <span style={{ fontSize: 12.5, color: msg.includes("✓") ? t.good : t.bad }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function TwoFactorCard({ t, card, sectionTitle }: any) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    configService.get2faStatus().then(r => setEnabled(r.enabled)).catch(() => setEnabled(false));
  }, []);

  const startSetup = async () => {
    setBusy(true); setError("");
    try { const r = await configService.setup2fa(); setQr(r.qr_data_uri); }
    catch (err: any) { setError(errorMessage(err, "No se pudo iniciar la configuración de 2FA.")); }
    finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    setBusy(true); setError("");
    try {
      const r = await configService.enable2fa(code);
      setBackupCodes(r.backup_codes);
      setQr(""); setCode(""); setEnabled(true);
    } catch (err: any) { setError(errorMessage(err, "Código inválido.")); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!confirm("¿Desactivar la autenticación de dos factores?")) return;
    setBusy(true); setError("");
    try { await configService.disable2fa(); setEnabled(false); setBackupCodes(null); }
    catch (err: any) { setError(errorMessage(err, "No se pudo desactivar 2FA.")); }
    finally { setBusy(false); }
  };

  return (
    <div style={card}>
      {sectionTitle(ShieldCheck, "Autenticación de dos factores (2FA)", t.good)}
      {enabled === null ? (
        <div style={{ fontSize: 12.5, color: t.textLo }}>Cargando…</div>
      ) : backupCodes ? (
        <div>
          <div style={{ background: t.good + "12", border: `1px solid ${t.good}33`, borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 12.5, color: t.good }}>
            2FA activado ✓ Guarda estos códigos de respaldo en un lugar seguro — cada uno funciona una sola vez si pierdes acceso a tu app de autenticación.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: "monospace", fontSize: 13, background: t.panel2, borderRadius: 8, padding: 12 }}>
            {backupCodes.map(c => <span key={c} style={{ color: t.textHi }}>{c}</span>)}
          </div>
          <button onClick={() => setBackupCodes(null)} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            Listo
          </button>
        </div>
      ) : enabled ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: t.panel2 }}>
            <div>
              <div style={{ fontSize: 13, color: t.textHi, fontWeight: 500 }}>Aplicación autenticadora</div>
              <div style={{ fontSize: 11.5, color: t.textLo }}>Activada — Google Authenticator, Authy u otra app TOTP</div>
            </div>
            <ToggleRight size={30} color={t.good} />
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad, marginTop: 10 }}>{error}</div>}
          <button onClick={disable} disabled={busy} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.bad}55`, background: "transparent", color: t.bad, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
            {busy ? "…" : "Desactivar 2FA"}
          </button>
        </div>
      ) : qr ? (
        <div>
          <div style={{ fontSize: 12.5, color: t.textMid, marginBottom: 10 }}>
            Escanea este código con Google Authenticator, Authy o tu app de autenticación preferida, luego ingresa el código de 6 dígitos para confirmar.
          </div>
          <img src={qr} alt="QR 2FA" style={{ width: 180, height: 180, borderRadius: 8, border: `1px solid ${t.border}`, display: "block", margin: "0 auto 14px" }} />
          <div style={{ display: "flex", gap: 8 }}>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" style={{ flex: 1, background: t.inputBg, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.textHi, fontSize: 14, letterSpacing: 2 }} />
            <button onClick={confirmSetup} disabled={busy || code.length < 6} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600, opacity: code.length < 6 ? 0.5 : 1 }}>
              {busy ? "…" : "Confirmar"}
            </button>
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad, marginTop: 10 }}>{error}</div>}
        </div>
      ) : (
        <div>
          <div style={{ background: t.warn + "12", border: `1px solid ${t.warn}33`, borderRadius: 8, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 10 }}>
            <AlertTriangle size={16} color={t.warn} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: t.warn }}>Recomendamos activar 2FA para todos los administradores y usuarios con acceso a finanzas.</span>
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad, marginBottom: 10 }}>{error}</div>}
          <button onClick={startSetup} disabled={busy} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {busy ? "…" : "Activar 2FA"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tarjeta: registro de auditoría (datos reales del backend) ──────────────
function AuditLogCard({ t, card, sectionTitle }: any) {
  const [logs, setLogs] = useState<any[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    configService.getAuditLogs(20).then(setLogs).catch(() => { setLogs([]); setError(true); });
  }, []);

  const fmtTime = (iso: string) => {
    try { return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso; }
  };

  return (
    <div style={card}>
      {sectionTitle(Activity, "Registro de auditoría", "#A78BFA")}
      {logs === null ? (
        <div style={{ fontSize: 12.5, color: t.textLo }}>Cargando…</div>
      ) : error ? (
        <div style={{ fontSize: 12.5, color: t.textLo }}>No se pudo cargar el registro (requiere permisos de superusuario).</div>
      ) : logs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: t.textLo }}>Aún no hay actividad registrada.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {logs.map((log, i) => (
            <div key={log.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < logs.length - 1 ? `1px solid ${t.borderSoft}` : "none" }}>
              <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 7, display: "flex" }}><Shield size={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: t.textHi, fontWeight: 600 }}>{log.action}</span>
                <span style={{ fontSize: 13, color: t.textMid }}> — {log.description || log.module}</span>
              </div>
              <span style={{ fontSize: 11.5, color: t.textLo, whiteSpace: "nowrap" }}>{fmtTime(log.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tarjeta: zona de peligro — reset total de datos (solo superusuario) ────
function DangerZoneCard({ t, card, lbl, inp, sectionTitle }: any) {
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ wiped_tables: string[]; message: string } | null>(null);

  useEffect(() => {
    configService.getMyPermissions().then(p => setIsSuperuser(!!p.is_superuser)).catch(() => setIsSuperuser(false));
  }, []);

  if (!isSuperuser) return null;

  const canSubmit = password.length > 0 && confirmText === "BORRAR TODO" && !busy;

  const runReset = async () => {
    setBusy(true); setError("");
    try {
      const r = await configService.resetAllData(password, confirmText);
      setResult(r);
      localStorage.removeItem("token");
      setTimeout(() => window.location.reload(), 3000);
    } catch (err: any) {
      setError(errorMessage(err, "No se pudo completar el borrado."));
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, border: `1px solid ${t.bad}55` }}>
      {sectionTitle(AlertTriangle, "Zona de peligro", t.bad)}
      {result ? (
        <div style={{ fontSize: 13, color: t.good }}>
          {result.message}
          <div style={{ fontSize: 11.5, color: t.textLo, marginTop: 6 }}>
            {result.wiped_tables.length} tablas vaciadas. Cerrando tu sesión…
          </div>
        </div>
      ) : !open ? (
        <div>
          <div style={{ fontSize: 12.5, color: t.textMid, marginBottom: 12 }}>
            Borra TODOS los datos operativos (usuarios, clientes, ventas, devoluciones, RH, inventario,
            finanzas, contabilidad, ingesta) dejando el esquema vacío para arrancar con datos reales.
            Se conserva la configuración de empresa (perfil, sucursales, integraciones). Esta acción es
            irreversible.
          </div>
          <button onClick={() => setOpen(true)} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${t.bad}`, background: "transparent", color: t.bad, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Borrar todos los datos
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
          <div style={{ background: t.bad + "12", border: `1px solid ${t.bad}33`, borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: t.bad }}>
            Esto es irreversible. Se borrarán todos los datos de todas las empresas/sucursales en esta base de datos.
          </div>
          <div>
            <label style={lbl}>Tu contraseña *</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inp} autoComplete="current-password" />
          </div>
          <div>
            <label style={lbl}>Escribe "BORRAR TODO" para confirmar *</label>
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} style={inp} placeholder="BORRAR TODO" />
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={runReset} disabled={!canSubmit} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: t.bad, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: canSubmit ? 1 : 0.5 }}>
              {busy ? "Borrando…" : "Confirmar borrado total"}
            </button>
            <button onClick={() => { setOpen(false); setPassword(""); setConfirmText(""); setError(""); }} disabled={busy} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal: crear / editar usuario (RBAC real) ──────────────────────────────
function UserFormModal({ t, lbl, inp, roles, branches, editing, onClose, onSaved }: any) {
  const [full_name, setFullName] = useState(editing?.name && editing?.name !== editing?.email ? editing.name : "");
  const [email, setEmail] = useState(editing?.email || "");
  const [roleId, setRoleId] = useState<string>(editing?.role_id ? String(editing.role_id) : "");
  const [branchId, setBranchId] = useState<string>(editing?.branch_id ? String(editing.branch_id) : "");
  const [active, setActive] = useState<boolean>(editing ? editing.is_active !== false : true);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = !!editing;

  const valid = email.trim() && (isEdit || password.length >= 6) && roleId;

  const save = async () => {
    setSaving(true); setError("");
    try {
      const base: any = { email: email.trim(), full_name: full_name.trim() || null, role_id: Number(roleId), branch_id: branchId ? Number(branchId) : null, is_active: active };
      if (isEdit) {
        if (password) base.password = password;
        await configService.updateUser(editing.id, base);
      } else {
        await configService.createUser({ ...base, password });
      }
      await onSaved();
    } catch (err: any) { setError(errorMessage(err, "No se pudo guardar el usuario.")); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><UserPlus size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>{isEdit ? "Editar usuario" : "Nuevo usuario"}</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={lbl}>Nombre completo</label><input value={full_name} onChange={e => setFullName(e.target.value)} placeholder="Nombre del usuario" style={inp} /></div>
          <div><label style={lbl}>Email *</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@empresa.mx" style={inp} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>Rol *</label>
              <select value={roleId} onChange={e => setRoleId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                <option value="">Seleccionar…</option>
                {roles.map((r: Role) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Estado</label>
              <select value={active ? "1" : "0"} onChange={e => setActive(e.target.value === "1")} style={{ ...inp, cursor: "pointer" }}>
                <option value="1">Activo</option><option value="0">Inactivo</option>
              </select>
            </div>
          </div>
          <div><label style={lbl}>Sucursal</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">Sin asignar (todas)</option>
              {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}{b.is_primary ? " (Matriz)" : ""}</option>)}
            </select>
          </div>
          <div><label style={lbl}>{isEdit ? "Nueva contraseña (opcional)" : "Contraseña inicial *"}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={isEdit ? "Dejar vacío para no cambiarla" : "Mínimo 6 caracteres"} style={inp} />
            {!isEdit && password.length > 0 && password.length < 6 && (
              <div style={{ fontSize: 11.5, color: t.warn, marginTop: 5 }}>La contraseña debe tener al menos 6 caracteres (llevas {password.length}).</div>
            )}
          </div>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {!valid && !saving && (
            <div style={{ fontSize: 11.5, color: t.textLo }}>
              Para crear el usuario falta: {[
                !email.trim() && "correo",
                !roleId && "rol",
                !isEdit && password.length < 6 && "contraseña de 6+ caracteres",
              ].filter(Boolean).join(", ")}.
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
            <button onClick={save} disabled={saving || !valid} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !valid ? 0.5 : 1 }}>
              {saving ? "…" : isEdit ? "Guardar cambios" : "Crear usuario"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Modal: crear rol ───────────────────────────────────────────────────────
const ROLE_COLORS = ["#33B2F5", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#60A5FA", "#F87171", "#2DD4BF"];
function RoleFormModal({ t, lbl, inp, onClose, onSaved }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(ROLE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      await configService.createRole({ name: name.trim(), description: description.trim() || null, color, permission_ids: [] });
      await onSaved();
    } catch (err: any) { setError(errorMessage(err, "No se pudo crear el rol.")); }
    finally { setSaving(false); }
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 20px", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 440, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: color + "22", color, borderRadius: 8, padding: 8, display: "flex" }}><Shield size={18} /></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Crear rol</h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={lbl}>Nombre del rol *</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Supervisor de almacén" style={inp} /></div>
          <div><label style={lbl}>Descripción</label><input value={description} onChange={e => setDescription(e.target.value)} placeholder="Qué hace este rol" style={inp} /></div>
          <div><label style={lbl}>Color</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ROLE_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: 8, background: c, border: color === c ? `2px solid ${t.textHi}` : "2px solid transparent", cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div style={{ fontSize: 12, color: t.textLo }}>Después de crearlo, abre el rol para configurar su matriz de permisos.</div>
          {error && <div style={{ fontSize: 12.5, color: t.bad }}>{error}</div>}
        </div>
        <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={save} disabled={saving || !name.trim()} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !name.trim() ? 0.5 : 1 }}>
            {saving ? "…" : "Crear rol"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
