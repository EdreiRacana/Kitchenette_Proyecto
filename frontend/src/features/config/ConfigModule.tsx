// ConfigModule.tsx — Configuración / Administración Premium
// Pestañas: Empresa · Usuarios · Roles y Permisos · Fiscal · Integraciones · Automatización · Seguridad · Preferencias
// Inspirado en: NetSuite, SAP, Odoo
// Contrato { t, s } igual que App.tsx

import { useState } from "react";
import {
  Building2, Users, Shield, Receipt, Plug, Workflow, Lock, Settings,
  Plus, Search, Edit2, Trash2, Check, X, Mail, Globe,
  FileText, Upload, Download, RefreshCw,
  CheckCircle, AlertTriangle, Info, ChevronRight,
  Key, Bell, Clock, UserPlus,
  ShoppingBag, Truck, Banknote, Fingerprint, Save,
  ToggleLeft, ToggleRight, Activity, ShieldCheck,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  status: "active" | "inactive" | "pending";
  last_login?: string;
  avatar_color: string;
}
interface Role {
  id: number;
  name: string;
  description: string;
  users_count: number;
  is_system: boolean;
  color: string;
  permissions: Record<string, { view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }>;
}
interface Integration {
  id: string;
  name: string;
  category: string;
  icon: any;
  color: string;
  connected: boolean;
  last_sync?: string;
  description: string;
}

// ── Demo Data ─────────────────────────────────────────────────────────────
const DEMO_USERS: User[] = [
  { id: 1, name: "Edrei Racana", email: "edrei@empresa.mx", role: "Administrador", department: "Dirección", status: "active", last_login: "Hace 5 min", avatar_color: "#33B2F5" },
  { id: 2, name: "Ana Torres", email: "a.torres@empresa.mx", role: "Contador", department: "Contabilidad", status: "active", last_login: "Hace 2 horas", avatar_color: "#34D399" },
  { id: 3, name: "Carlos Mendoza", email: "c.mendoza@empresa.mx", role: "Gerente Ventas", department: "Ventas", status: "active", last_login: "Hace 1 día", avatar_color: "#FBBF24" },
  { id: 4, name: "Miguel Sánchez", email: "m.sanchez@empresa.mx", role: "Almacén", department: "Almacén", status: "active", last_login: "Hace 3 horas", avatar_color: "#A78BFA" },
  { id: 5, name: "Laura Jiménez", email: "l.jimenez@empresa.mx", role: "Ventas", department: "Ventas", status: "pending", avatar_color: "#F472B6" },
  { id: 6, name: "Roberto Flores", email: "r.flores@empresa.mx", role: "Solo lectura", department: "Operaciones", status: "inactive", last_login: "Hace 2 semanas", avatar_color: "#94A3B8" },
];

const MODULES_LIST = ["Tablero", "Ventas / CRM", "Clientes", "Inventario", "Finanzas", "RH / Nómina", "Reportes / BI", "Configuración"];

const DEMO_ROLES: Role[] = [
  {
    id: 1, name: "Administrador", description: "Acceso total al sistema", users_count: 1, is_system: true, color: "#33B2F5",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: true, create: true, edit: true, delete: true, approve: true } }), {}),
  },
  {
    id: 2, name: "Gerente Ventas", description: "Gestión completa de ventas y clientes", users_count: 1, is_system: false, color: "#FBBF24",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: true, create: ["Ventas / CRM", "Clientes", "Tablero", "Reportes / BI"].includes(m), edit: ["Ventas / CRM", "Clientes"].includes(m), delete: false, approve: m === "Ventas / CRM" } }), {}),
  },
  {
    id: 3, name: "Contador", description: "Finanzas, nómina y reportes", users_count: 1, is_system: false, color: "#34D399",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: true, create: ["Finanzas", "RH / Nómina"].includes(m), edit: ["Finanzas", "RH / Nómina"].includes(m), delete: false, approve: ["Finanzas", "RH / Nómina"].includes(m) } }), {}),
  },
  {
    id: 4, name: "Almacén", description: "Control de inventario y movimientos", users_count: 1, is_system: false, color: "#A78BFA",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: ["Inventario", "Tablero", "Ventas / CRM"].includes(m), create: m === "Inventario", edit: m === "Inventario", delete: false, approve: false } }), {}),
  },
  {
    id: 5, name: "Ventas", description: "Crear pedidos y cotizaciones", users_count: 1, is_system: false, color: "#F472B6",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: ["Ventas / CRM", "Clientes", "Tablero", "Inventario"].includes(m), create: ["Ventas / CRM", "Clientes"].includes(m), edit: m === "Ventas / CRM", delete: false, approve: false } }), {}),
  },
  {
    id: 6, name: "Solo lectura", description: "Solo visualización de información", users_count: 1, is_system: true, color: "#94A3B8",
    permissions: MODULES_LIST.reduce((acc, m) => ({ ...acc, [m]: { view: true, create: false, edit: false, delete: false, approve: false } }), {}),
  },
];

const DEMO_INTEGRATIONS: Integration[] = [
  { id: "mercadolibre", name: "MercadoLibre", category: "Marketplace", icon: ShoppingBag, color: "#FFE600", connected: true, last_sync: "Hace 5 min", description: "Sincroniza stock y órdenes con tu tienda de MercadoLibre" },
  { id: "amazon", name: "Amazon Seller", category: "Marketplace", icon: ShoppingBag, color: "#FF9900", connected: false, description: "Conecta tu cuenta de vendedor de Amazon" },
  { id: "shopify", name: "Shopify", category: "Marketplace", icon: ShoppingBag, color: "#96BF48", connected: true, last_sync: "Hace 12 min", description: "Sincroniza productos, stock y pedidos con Shopify" },
  { id: "bbva", name: "BBVA", category: "Banco", icon: Banknote, color: "#004481", connected: true, last_sync: "Hace 1 hora", description: "Dispersión de nómina y conciliación bancaria" },
  { id: "fedex", name: "FedEx", category: "Paquetería", icon: Truck, color: "#4D148C", connected: false, description: "Generación de guías de envío y rastreo" },
  { id: "estafeta", name: "Estafeta", category: "Paquetería", icon: Truck, color: "#EE3124", connected: false, description: "Generación de guías y rastreo de paquetes" },
  { id: "finkok", name: "Finkok", category: "Facturación", icon: Receipt, color: "#33B2F5", connected: true, last_sync: "Activo", description: "PAC para timbrado de CFDI 4.0" },
  { id: "zkteco", name: "ZKTeco", category: "Checador", icon: Fingerprint, color: "#34D399", connected: false, description: "Checador biométrico de huella y rostro" },
];

const PERM_LABELS = { view: "Ver", create: "Crear", edit: "Editar", delete: "Eliminar", approve: "Aprobar" };
const PERM_COLORS = { view: "#60A5FA", create: "#34D399", edit: "#FBBF24", delete: "#F87171", approve: "#A78BFA" };

// ── Main Component ─────────────────────────────────────────────────────────
export default function ConfigModule({ t, s, company }: { t: any; s: any; company?: any }) {
  const [tab, setTab] = useState<"company" | "users" | "roles" | "fiscal" | "integrations" | "automation" | "security" | "preferences">("company");
  const [users, setUsers] = useState<User[]>(DEMO_USERS);
  const [roles, setRoles] = useState<Role[]>(DEMO_ROLES);
  const [integrations, setIntegrations] = useState<Integration[]>(DEMO_INTEGRATIONS);
  const [userForm, setUserForm] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [q, setQ] = useState("");

  const lang = "es";
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

  const card: React.CSSProperties = { background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 };
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
            {/* Identity */}
            <div style={card}>
              {sectionTitle(Building2, "Identidad de la empresa", t.nova)}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: comp.color + "26", color: comp.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800 }}>{comp.initials}</div>
                <div>
                  <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                    <Upload size={14} /> Cambiar logo
                  </button>
                  <div style={{ fontSize: 11, color: t.textLo, marginTop: 6 }}>PNG o SVG, máx 2MB</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Nombre comercial</label><input defaultValue={comp.name} style={inp} /></div>
                <div><label style={lbl}>Razón social</label><input defaultValue="Comercializadora del Valle S.A. de C.V." style={inp} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={lbl}>Teléfono</label><input defaultValue="55 1234 5678" style={inp} /></div>
                  <div><label style={lbl}>Email</label><input defaultValue="contacto@empresa.mx" style={inp} /></div>
                </div>
              </div>
            </div>

            {/* Fiscal data */}
            <div style={card}>
              {sectionTitle(FileText, "Datos fiscales", t.good)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>RFC</label><input defaultValue="CVA180921AB2" style={{ ...inp, fontFamily: "monospace" }} /></div>
                <div><label style={lbl}>Régimen fiscal</label>
                  <select style={{ ...inp, cursor: "pointer" }}>
                    <option>601 - General de Ley Personas Morales</option>
                    <option>612 - Personas Físicas con Actividades Empresariales</option>
                    <option>626 - Régimen Simplificado de Confianza</option>
                  </select>
                </div>
                <div><label style={lbl}>Dirección fiscal</label><input defaultValue="Av. Reforma 123, Col. Centro" style={inp} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><label style={lbl}>Código postal</label><input defaultValue="06000" style={inp} /></div>
                  <div><label style={lbl}>Ciudad</label><input defaultValue="CDMX" style={inp} /></div>
                </div>
              </div>
            </div>
          </div>

          {/* Regional + companies */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Globe, "Configuración regional", "#A78BFA")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Moneda base</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>MXN - Peso Mexicano</option><option>USD - Dólar</option></select>
                </div>
                <div><label style={lbl}>Zona horaria</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>(GMT-6) Ciudad de México</option><option>(GMT-7) Tijuana</option></select>
                </div>
                <div><label style={lbl}>Inicio de año fiscal</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Enero</option><option>Abril</option><option>Julio</option></select>
                </div>
                <div><label style={lbl}>Idioma</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Español</option><option>English</option></select>
                </div>
              </div>
            </div>

            <div style={card}>
              {sectionTitle(Building2, "Empresas / Sucursales", t.warn)}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[{ name: "Comercializadora del Valle", initials: "CV", color: "#33B2F5", main: true }, { name: "Insumos del Norte", initials: "IN", color: "#34D399" }, { name: "Grupo Azteca Retail", initials: "GA", color: "#FBBF24" }].map(c => (
                  <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, background: t.panel2 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: c.color + "26", color: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{c.initials}</div>
                    <span style={{ flex: 1, fontSize: 13, color: t.textHi, fontWeight: 500 }}>{c.name}</span>
                    {c.main && <span style={{ fontSize: 10, fontWeight: 700, color: t.good, background: t.good + "18", padding: "2px 7px", borderRadius: 6 }}>Principal</span>}
                  </div>
                ))}
                <button style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 8, border: `2px dashed ${t.border}`, background: "transparent", color: t.textLo, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  <Plus size={14} /> Agregar empresa
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Save size={15} /> Guardar cambios
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
            <button onClick={() => setUserForm(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <UserPlus size={15} /> Invitar usuario
            </button>
          </div>

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
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: 12, color: t.nova, background: t.nova + "18", padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>{u.role}</span>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: t.textMid }}>{u.department}</td>
                        <td style={{ padding: "12px 16px", fontSize: 12.5, color: t.textLo }}>{u.last_login || "Nunca"}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: statusMeta.color }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: statusMeta.color }} />{statusMeta.label}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", color: t.textLo, cursor: "pointer" }}><Edit2 size={15} /></button>
                            <button style={{ padding: 6, borderRadius: 6, border: "none", background: "transparent", color: t.bad, cursor: "pointer" }}><Trash2 size={15} /></button>
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
            <p style={{ margin: 0, fontSize: 13, color: t.textLo }}>Define qué puede ver y hacer cada rol en cada módulo del sistema.</p>
            <button style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              <Plus size={15} /> Crear rol
            </button>
          </div>

          {/* Role cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {roles.map(r => (
              <div key={r.id} onClick={() => setSelectedRole(r)} style={{ background: t.panel, border: `1px solid ${selectedRole?.id === r.id ? r.color : t.border}`, borderRadius: 12, padding: 18, cursor: "pointer", transition: "all .15s" }}>
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

          {/* Permission matrix */}
          {selectedRole && (
            <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ background: selectedRole.color + "22", color: selectedRole.color, borderRadius: 8, padding: 7, display: "flex" }}><Shield size={16} /></div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: t.textHi }}>Matriz de permisos — {selectedRole.name}</div>
                    <div style={{ fontSize: 12, color: t.textLo }}>{selectedRole.description}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedRole(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={18} /></button>
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
                    {MODULES_LIST.map((mod, i) => {
                      const perms = selectedRole.permissions[mod];
                      return (
                        <tr key={mod} style={{ background: i % 2 === 0 ? t.panel : t.panel2 }}>
                          <td style={{ padding: "11px 16px", fontSize: 13, color: t.textHi, fontWeight: 500 }}>{mod}</td>
                          {(Object.keys(PERM_LABELS) as (keyof typeof PERM_LABELS)[]).map(perm => (
                            <td key={perm} style={{ padding: "11px 16px", textAlign: "center" }}>
                              <button disabled={selectedRole.is_system} style={{ background: "transparent", border: "none", cursor: selectedRole.is_system ? "default" : "pointer", display: "inline-flex" }}>
                                {perms[perm]
                                  ? <CheckCircle size={18} color={PERM_COLORS[perm]} />
                                  : <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${t.border}` }} />}
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
                  <Info size={15} /> Los roles de sistema no se pueden modificar. Duplica este rol para crear uno personalizado.
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

          {/* Taxes */}
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
          {["Marketplace", "Banco", "Paquetería", "Facturación", "Checador"].map(cat => {
            const items = integrations.filter(i => i.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: t.textLo, letterSpacing: 0.5, marginBottom: 10, textTransform: "uppercase" }}>{cat}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {items.map(intg => (
                    <div key={intg.id} style={{ background: t.panel, border: `1px solid ${intg.connected ? intg.color + "55" : t.border}`, borderRadius: 12, padding: 18 }}>
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
                      <button onClick={() => setIntegrations(prev => prev.map(p => p.id === intg.id ? { ...p, connected: !p.connected, last_sync: !p.connected ? "Hace un momento" : undefined } : p))} style={{ width: "100%", padding: "9px", borderRadius: 8, border: intg.connected ? `1px solid ${t.border}` : "none", background: intg.connected ? t.panel2 : `linear-gradient(135deg, ${intg.color}, ${intg.color}cc)`, color: intg.connected ? t.textMid : "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                        {intg.connected ? "⚙ Configurar" : "Conectar"}
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
            <p style={{ margin: 0, fontSize: 13, color: t.textLo }}>Crea reglas automáticas: aprobaciones, notificaciones y alertas sin escribir código.</p>
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
            <div key={i} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Lock, "Política de contraseñas", t.nova)}
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

            <div style={card}>
              {sectionTitle(ShieldCheck, "Autenticación de dos factores (2FA)", t.good)}
              <div style={{ background: t.warn + "12", border: `1px solid ${t.warn}33`, borderRadius: 8, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 10 }}>
                <AlertTriangle size={16} color={t.warn} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12.5, color: t.warn }}>Recomendamos activar 2FA para todos los administradores y usuarios con acceso a finanzas.</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { method: "Aplicación autenticadora", desc: "Google Authenticator, Authy", on: true },
                  { method: "SMS", desc: "Código por mensaje de texto", on: false },
                  { method: "Email", desc: "Código por correo electrónico", on: true },
                ].map(m => (
                  <div key={m.method} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: t.panel2 }}>
                    <div>
                      <div style={{ fontSize: 13, color: t.textHi, fontWeight: 500 }}>{m.method}</div>
                      <div style={{ fontSize: 11.5, color: t.textLo }}>{m.desc}</div>
                    </div>
                    {m.on ? <ToggleRight size={30} color={t.good} /> : <ToggleLeft size={30} color={t.textLo} />}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Audit log */}
          <div style={card}>
            {sectionTitle(Activity, "Registro de auditoría", "#A78BFA")}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { user: "Edrei Racana", action: "Modificó permisos del rol 'Ventas'", time: "Hace 12 min", icon: Shield, color: t.nova },
                { user: "Ana Torres", action: "Generó nómina de la quincena Jun 16-30", time: "Hace 2 horas", icon: Receipt, color: t.good },
                { user: "Carlos Mendoza", action: "Aprobó pedido VTA-2041 por $84,200", time: "Hace 3 horas", icon: CheckCircle, color: t.good },
                { user: "Sistema", action: "Sincronización automática con MercadoLibre", time: "Hace 5 horas", icon: RefreshCw, color: "#FFE600" },
                { user: "Miguel Sánchez", action: "Ajuste de inventario: Block hueco -50 uds", time: "Hace 1 día", icon: Edit2, color: t.warn },
              ].map((log, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < 4 ? `1px solid ${t.borderSoft}` : "none" }}>
                  <div style={{ background: log.color + "22", color: log.color, borderRadius: 8, padding: 7, display: "flex" }}><log.icon size={14} /></div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: t.textHi, fontWeight: 600 }}>{log.user}</span>
                    <span style={{ fontSize: 13, color: t.textMid }}> — {log.action}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: t.textLo, whiteSpace: "nowrap" }}>{log.time}</span>
                </div>
              ))}
            </div>
            <button style={{ marginTop: 14, padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Download size={14} /> Exportar registro completo
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Preferences ── */}
      {tab === "preferences" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              {sectionTitle(Settings, "Apariencia", t.nova)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Tema</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Oscuro</option><option>Claro</option><option>Automático (según sistema)</option></select>
                </div>
                <div><label style={lbl}>Idioma de la interfaz</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Español</option><option>English</option></select>
                </div>
                <div><label style={lbl}>Densidad de la interfaz</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Cómoda</option><option>Compacta</option></select>
                </div>
              </div>
            </div>

            <div style={card}>
              {sectionTitle(Globe, "Formatos regionales", t.good)}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={lbl}>Formato de fecha</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>DD/MM/AAAA</option><option>MM/DD/AAAA</option><option>AAAA-MM-DD</option></select>
                </div>
                <div><label style={lbl}>Formato de números</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>1,234.56</option><option>1.234,56</option></select>
                </div>
                <div><label style={lbl}>Símbolo de moneda</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>$ (MXN)</option><option>US$ (USD)</option></select>
                </div>
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

      {/* ── MODAL: Invite User ── */}
      {userForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 460, background: t.panel, borderRadius: 16, border: `1px solid ${t.border}` }}>
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ background: t.nova + "22", color: t.nova, borderRadius: 8, padding: 8, display: "flex" }}><UserPlus size={18} /></div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.textHi }}>Invitar usuario</h2>
              </div>
              <button onClick={() => setUserForm(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo }}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={lbl}>Nombre completo *</label><input placeholder="Nombre del usuario" style={inp} /></div>
              <div><label style={lbl}>Email *</label><input type="email" placeholder="correo@empresa.mx" style={inp} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Rol *</label>
                  <select style={{ ...inp, cursor: "pointer" }}>{roles.map(r => <option key={r.id}>{r.name}</option>)}</select>
                </div>
                <div><label style={lbl}>Departamento</label>
                  <select style={{ ...inp, cursor: "pointer" }}><option>Ventas</option><option>Contabilidad</option><option>Almacén</option><option>Dirección</option></select>
                </div>
              </div>
              <div style={{ background: t.nova + "12", border: `1px solid ${t.nova}33`, borderRadius: 8, padding: "12px 14px", display: "flex", gap: 10 }}>
                <Mail size={16} color={t.nova} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12.5, color: t.textMid }}>Se enviará una invitación por email. El usuario configurará su contraseña al aceptar.</span>
              </div>
            </div>
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${t.border}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setUserForm(false)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${t.border}`, background: t.panel2, color: t.textMid, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
              <button onClick={() => setUserForm(false)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Enviar invitación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
