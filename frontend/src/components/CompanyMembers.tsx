// Miembros de la marca activa — invitar, listar, cambiar rol, quitar.
// Se auto-scopa a la marca activa (via header X-Company-Id que el
// interceptor de axios ya envía). Superuser puede operar cualquiera;
// admin de la marca puede operar la suya.
import { useCallback, useEffect, useState } from "react";
import { UserPlus, Trash2, Check, Search, Building2 } from "lucide-react";
import api, { getActiveCompanyId } from "../services/api";

interface Member {
  user_id: number;
  email: string;
  full_name: string | null;
  role_in_company: string;
  is_default: boolean;
}

interface Company {
  id: string;
  legal_name: string;
  commercial_name?: string | null;
  is_demo?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  manager: "Gerente",
  member: "Miembro",
  viewer: "Solo lectura",
};

const ROLES: [string, string][] = [
  ["admin", "Administrador (control total de la marca)"],
  ["manager", "Gerente (edita módulos operativos)"],
  ["member", "Miembro (opera día a día)"],
  ["viewer", "Solo lectura (dashboards y reportes)"],
];

export default function CompanyMembers({ t }: { t: any }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const active = getActiveCompanyId();
      const [companiesRes, membersRes] = await Promise.all([
        api.get<Company[]>("/me/companies"),
        active ? api.get(`/companies/${active}/members`) : Promise.resolve({ data: [] }),
      ]);
      const found = (companiesRes.data || []).find(c => c.id === active) || (companiesRes.data || [])[0];
      setCompany(found || null);
      setMembers((membersRes.data as any) || []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeMember = async (userId: number) => {
    if (!company) return;
    if (!window.confirm("¿Quitar este usuario de la marca?")) return;
    try {
      await api.delete(`/companies/${company.id}/members/${userId}`);
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Error");
    }
  };

  const changeRole = async (userId: number, newRole: string, isDefault: boolean) => {
    if (!company) return;
    try {
      await api.post(`/companies/${company.id}/members`, {
        user_id: userId, company_id: company.id,
        role_in_company: newRole, is_default: isDefault,
      });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.detail || e?.message || "Error");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: t.textLo }}>
        Cargando miembros…
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: 24, borderRadius: 12, background: t.panel2,
                     border: `1px solid ${t.border}`, color: t.textMid }}>
        Elige una marca en el selector superior para ver sus miembros.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 16, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Building2 size={18} color={t.nova} />
            <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>
              Miembros de{" "}
              <span style={{ color: t.nova }}>
                {company.commercial_name || company.legal_name}
              </span>
              {company.is_demo && (
                <span style={{
                  marginLeft: 8, padding: "2px 7px", borderRadius: 4,
                  fontSize: 9.5, fontWeight: 700,
                  background: (t.warn || "#F59E0B") + "22",
                  color: t.warn || "#F59E0B", verticalAlign: "middle",
                }}>DEMO</span>
              )}
            </h3>
          </div>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 12.5 }}>
            Personas con acceso a esta marca. Cada una ve solo los datos de aquí.
          </p>
        </div>
        <button onClick={() => setInviteOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 14px", borderRadius: 8, border: "none",
            background: t.nova, color: "#fff", fontSize: 12.5,
            fontWeight: 700, cursor: "pointer",
          }}>
          <UserPlus size={14} />
          Invitar usuario
        </button>
      </div>

      {err && (
        <div style={{ padding: 10, borderRadius: 8, background: (t.bad || "#ef4444") + "18",
                       color: t.bad || "#ef4444", fontSize: 12.5, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {members.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 12, background: t.panel2,
                       border: `1px solid ${t.border}`, color: t.textMid,
                       textAlign: "center" }}>
          Aún no hay miembros. Invita al primero.
        </div>
      ) : (
        <div style={{ background: t.panel2, border: `1px solid ${t.border}`,
                       borderRadius: 12, overflow: "hidden" }}>
          {members.map((m, i) => (
            <div key={m.user_id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px",
                borderTop: i === 0 ? "none" : `1px solid ${t.border}`,
              }}>
              <div style={{
                width: 34, height: 34, borderRadius: 999,
                background: `linear-gradient(135deg, ${t.nova}, ${t.navy})`,
                color: "#fff", fontWeight: 700, fontSize: 12,
                display: "grid", placeItems: "center", flex: "0 0 auto",
              }}>
                {(m.full_name || m.email || "?").split(/\s+/).slice(0, 2)
                  .map(w => w[0]?.toUpperCase()).join("")}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textHi,
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.full_name || m.email}
                  {m.is_default && (
                    <span style={{
                      marginLeft: 8, padding: "1px 6px", borderRadius: 4,
                      fontSize: 9.5, fontWeight: 700,
                      background: (t.good || "#22c55e") + "26",
                      color: t.good || "#22c55e",
                    }}>PRINCIPAL</span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: t.textLo }}>{m.email}</div>
              </div>
              <select value={m.role_in_company}
                onChange={(e) => changeRole(m.user_id, e.target.value, m.is_default)}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  background: t.panel, border: `1px solid ${t.border}`,
                  color: t.textHi, fontSize: 12, cursor: "pointer",
                }}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button onClick={() => removeMember(m.user_id)}
                title="Quitar de la marca"
                style={{
                  padding: 8, borderRadius: 6, border: "none",
                  background: "transparent", color: t.bad || "#ef4444",
                  cursor: "pointer",
                }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {inviteOpen && (
        <InviteModal t={t} companyId={company.id}
          onClose={() => setInviteOpen(false)}
          onDone={() => { setInviteOpen(false); load(); }} />
      )}
    </div>
  );
}


function InviteModal({
  t, companyId, onClose, onDone,
}: {
  t: any; companyId: string;
  onClose: () => void; onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [existing, setExisting] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("member");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const check = async () => {
    if (!email.trim() || !email.includes("@")) {
      setErr("Email inválido"); return;
    }
    setChecking(true); setErr(""); setExisting(null);
    try {
      const r = await api.get("/users");
      const users = (r.data as any) || [];
      const hit = users.find((u: any) =>
        u.email?.toLowerCase() === email.trim().toLowerCase()
      );
      if (hit) setExisting(hit);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || "Error");
    } finally { setChecking(false); }
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      let userId = existing?.id;
      if (!userId) {
        if (!name.trim() || !password.trim() || password.length < 6) {
          setErr("Nombre y contraseña (mín 6) son obligatorios");
          setBusy(false); return;
        }
        const cr = await api.post("/users", {
          email: email.trim().toLowerCase(),
          full_name: name.trim(),
          password: password,
          is_active: true,
        });
        userId = (cr.data as any)?.id;
      }
      await api.post(`/companies/${companyId}/members`, {
        user_id: userId,
        company_id: companyId,
        role_in_company: role,
        is_default: isDefault,
      });
      onDone();
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
          borderRadius: 14, padding: 20, width: "100%", maxWidth: 500,
          maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: t.nova + "22", color: t.nova,
            display: "grid", placeItems: "center",
          }}>
            <UserPlus size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.textHi }}>
              Invitar usuario
            </div>
            <div style={{ fontSize: 11.5, color: t.textLo }}>
              Si el email ya existe, solo se asigna a esta marca. Si no, se crea la cuenta.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Email *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={email} type="email" placeholder="persona@empresa.com"
              onChange={(e) => { setEmail(e.target.value); setExisting(null); }}
              style={{ ...inp, flex: 1 }} />
            <button onClick={check} disabled={checking || !email.includes("@")}
              style={{
                padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.border}`,
                background: t.panel2, color: t.textHi, fontSize: 12.5,
                fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
              }}>
              <Search size={13} />
              {checking ? "…" : "Verificar"}
            </button>
          </div>
        </div>

        {existing && (
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 12,
            background: (t.good || "#22c55e") + "15",
            color: t.good || "#22c55e", fontSize: 12.5,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Check size={14} />
            Ya existe: {existing.full_name || existing.email}. Se agregará a esta marca.
          </div>
        )}

        {!existing && email.includes("@") && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Nombre completo *</label>
              <input value={name} placeholder="Nombre Apellido"
                onChange={(e) => setName(e.target.value)} style={inp} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>
                Contraseña temporal * (mín. 6, avísale al usuario)
              </label>
              <input value={password} type="text"
                placeholder="ej. Twelve2026!"
                onChange={(e) => setPassword(e.target.value)} style={inp} />
            </div>
          </>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Rol en la marca</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            style={{ ...inp, cursor: "pointer" }}>
            {ROLES.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8,
                           cursor: "pointer", color: t.textMid, fontSize: 12.5 }}>
            <input type="checkbox" checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)} />
            Establecer esta marca como su marca por defecto al iniciar sesión
          </label>
        </div>

        {err && (
          <div style={{ padding: 10, borderRadius: 8,
                         background: (t.bad || "#ef4444") + "15",
                         color: t.bad || "#ef4444", fontSize: 12.5, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy}
            style={{
              padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`,
              background: "transparent", color: t.textMid, fontSize: 12.5,
              fontWeight: 600, cursor: busy ? "wait" : "pointer",
            }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !email.includes("@")}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "none",
              background: t.nova, color: "#fff", fontSize: 12.5, fontWeight: 700,
              cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1,
            }}>
            {busy
              ? "Enviando…"
              : (existing ? "Asignar a la marca" : "Crear e invitar")}
          </button>
        </div>
      </div>
    </div>
  );
}
