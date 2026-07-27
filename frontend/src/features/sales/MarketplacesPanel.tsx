/**
 * MarketplacesPanel.tsx
 * Gestión de conexiones a marketplaces desde el CRM Ventas.
 * Lista/crea/actualiza credenciales y dispara sync manual.
 *
 * Diseño: la config sensible (access tokens) NUNCA vuelve al frontend —
 * el backend expone solo `has_credentials` y `credential_keys`. Editar
 * un valor manda solo esa clave (merge parcial en backend).
 */

import { useEffect, useState } from "react";
import { Plug, Plus, RefreshCw, Trash2, ExternalLink, CheckCircle2, AlertTriangle, X } from "lucide-react";
import api from "../../services/api";
import type { Tokens } from "./theme";

interface PlatformField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: string[];
  default?: string;
}
interface PlatformInfo {
  key: string;
  label: string;
  fields: PlatformField[];
  docs_url?: string | null;
}
interface Connection {
  id: number;
  platform: string;
  name: string;
  is_active: boolean;
  customer_id?: number | null;
  default_warehouse_id?: number | null;
  last_sync_at?: string | null;
  last_sync_orders: number;
  last_error?: string | null;
  has_credentials: boolean;
  credential_keys: string[];
}
interface SyncResult {
  connection_id: number;
  platform: string;
  orders_imported: number;
  orders_skipped_duplicate?: number;
  error?: string | null;
}

const marketplaceApi = {
  platforms: async (): Promise<PlatformInfo[]> => (await api.get("/marketplaces/platforms")).data,
  list: async (): Promise<Connection[]> => (await api.get("/marketplaces/connections")).data,
  create: async (data: Partial<Connection> & { platform: string; credentials: Record<string, string> }): Promise<Connection> =>
    (await api.post("/marketplaces/connections", data)).data,
  update: async (id: number, data: Partial<Connection> & { credentials?: Record<string, string> }): Promise<Connection> =>
    (await api.patch(`/marketplaces/connections/${id}`, data)).data,
  remove: async (id: number): Promise<void> => { await api.delete(`/marketplaces/connections/${id}`); },
  sync: async (id: number): Promise<SyncResult> => (await api.post(`/marketplaces/connections/${id}/sync`)).data,
};

export function MarketplacesPanel({ tk }: { tk: Tokens }) {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ conn?: Connection; platform: string } | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [p, c] = await Promise.all([marketplaceApi.platforms(), marketplaceApi.list()]);
      setPlatforms(p); setConns(c);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "No se pudo cargar el listado de marketplaces");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const doSync = async (c: Connection) => {
    setSyncingId(c.id); setSyncResult(null);
    try {
      const r = await marketplaceApi.sync(c.id);
      setSyncResult(r);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Falló el sync");
    } finally { setSyncingId(null); }
  };

  const doDelete = async (c: Connection) => {
    if (!confirm(`¿Eliminar la conexión "${c.name}"? Las ventas ya importadas se mantienen.`)) return;
    try { await marketplaceApi.remove(c.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.detail || "No se pudo eliminar"); }
  };

  const platformByKey = new Map(platforms.map(p => [p.key, p]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && (
        <div style={{ padding: "10px 14px", background: tk.bad + "18", border: `1px solid ${tk.bad}44`, color: tk.bad, borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {syncResult && (
        <div style={{ padding: "10px 14px", background: syncResult.error ? tk.warn + "18" : tk.good + "18",
                     border: `1px solid ${syncResult.error ? tk.warn : tk.good}55`,
                     color: syncResult.error ? tk.warn : tk.good, borderRadius: 10, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            {syncResult.error
              ? <><AlertTriangle size={14} /> {syncResult.error}</>
              : <><CheckCircle2 size={14} /> Importadas {syncResult.orders_imported} órdenes nuevas
                  {syncResult.orders_skipped_duplicate ? ` · ${syncResult.orders_skipped_duplicate} duplicadas` : ""}.</>}
          </div>
          <button onClick={() => setSyncResult(null)} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Plataformas disponibles */}
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tk.textHi }}>Conectar marketplace</div>
            <div style={{ fontSize: 12, color: tk.textLo, marginTop: 2 }}>Los pedidos entran como ventas del CRM con canal = plataforma.</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {platforms.map(p => (
            <button key={p.key} onClick={() => setEditing({ platform: p.key })}
              style={{ padding: "14px 12px", borderRadius: 10, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textHi, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
              <Plug size={16} color={tk.accent} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{p.label}</div>
                {p.docs_url && <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2 }}>Ver docs oficiales</div>}
              </div>
              <Plus size={14} color={tk.textLo} />
            </button>
          ))}
        </div>
      </div>

      {/* Conexiones existentes */}
      <div style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12 }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${tk.border}`, fontSize: 14, fontWeight: 700, color: tk.textHi }}>
          Conexiones configuradas
        </div>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: tk.textLo, fontSize: 13 }}>Cargando…</div>
        ) : conns.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: tk.textLo, fontSize: 13 }}>
            Aún no hay conexiones. Elige una plataforma arriba para empezar.
          </div>
        ) : (
          <div>
            {conns.map((c, i) => {
              const p = platformByKey.get(c.platform);
              return (
                <div key={c.id} style={{ padding: "14px 16px", borderBottom: i < conns.length - 1 ? `1px solid ${tk.border}` : "none", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: tk.textHi }}>{c.name}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.is_active ? tk.good : tk.textLo, background: (c.is_active ? tk.good : tk.textLo) + "18", padding: "2px 8px", borderRadius: 999 }}>
                        {c.is_active ? "Activa" : "Pausada"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: tk.textLo, marginTop: 3 }}>
                      {p?.label || c.platform}
                      {c.has_credentials
                        ? <> · <CheckCircle2 size={11} style={{ verticalAlign: -1 }} /> Credenciales OK ({c.credential_keys.join(", ")})</>
                        : <> · <AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Sin credenciales</>}
                    </div>
                    <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2 }}>
                      {c.last_sync_at
                        ? `Último sync: ${new Date(c.last_sync_at).toLocaleString("es-MX")} · ${c.last_sync_orders} órdenes`
                        : "Nunca sincronizado"}
                      {c.last_error && <span style={{ color: tk.warn }}> · Error: {c.last_error}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => doSync(c)} disabled={syncingId === c.id || !c.is_active || !c.has_credentials}
                      title={!c.has_credentials ? "Falta configurar credenciales" : !c.is_active ? "Activa la conexión primero" : "Sincronizar ahora"}
                      style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${tk.accent}55`, background: tk.accent + "18", color: tk.accent, cursor: syncingId === c.id || !c.is_active || !c.has_credentials ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, opacity: !c.is_active || !c.has_credentials ? 0.5 : 1 }}>
                      <RefreshCw size={12} className={syncingId === c.id ? "spin" : ""} /> {syncingId === c.id ? "Sincronizando…" : "Sync"}
                    </button>
                    <button onClick={() => setEditing({ conn: c, platform: c.platform })}
                      style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 12 }}>
                      Editar
                    </button>
                    <button onClick={() => doDelete(c)} title="Eliminar"
                      style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${tk.bad}44`, background: "transparent", color: tk.bad, cursor: "pointer", display: "flex", alignItems: "center" }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <EditModal tk={tk} platform={platformByKey.get(editing.platform)!}
          conn={editing.conn} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}

      <style>{`.spin{animation:spinKey 1s linear infinite}@keyframes spinKey{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}


function EditModal({ tk, platform, conn, onClose, onSaved }: {
  tk: Tokens; platform: PlatformInfo; conn?: Connection;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(conn?.name || `${platform.label} - Cuenta principal`);
  const [isActive, setIsActive] = useState(conn?.is_active ?? true);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr("El nombre no puede estar vacío"); return; }
    setSaving(true); setErr(null);
    try {
      // Solo mandamos las credenciales que el usuario tocó (merge parcial).
      const credsPayload = Object.fromEntries(Object.entries(creds).filter(([, v]) => v && v.trim()));
      if (conn) {
        await marketplaceApi.update(conn.id, {
          name: name.trim(), is_active: isActive,
          credentials: Object.keys(credsPayload).length ? credsPayload : undefined,
        });
      } else {
        await marketplaceApi.create({
          platform: platform.key, name: name.trim(), is_active: isActive,
          credentials: credsPayload,
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "No se pudo guardar la conexión");
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.75)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxWidth: "100%", background: tk.base, border: `1px solid ${tk.border}`, borderRadius: 14, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${tk.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Plug size={18} color={tk.accent} />
            <div style={{ fontSize: 15, fontWeight: 800, color: tk.textHi }}>
              {conn ? `Editar: ${conn.name}` : `Conectar ${platform.label}`}
            </div>
          </div>
          {platform.docs_url && (
            <a href={platform.docs_url} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: tk.accent, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
              Docs <ExternalLink size={11} />
            </a>
          )}
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>Nombre interno</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", marginTop: 4, borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, boxSizing: "border-box", outline: "none" }} />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: tk.textMid }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            Activa (sincroniza automáticamente cuando se dispare)
          </label>

          <div style={{ borderTop: `1px solid ${tk.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: tk.textLo, marginBottom: 10 }}>
              {conn?.has_credentials
                ? "Las credenciales guardadas no se muestran. Deja los campos vacíos para no cambiarlas."
                : "Configura las credenciales que pide la plataforma."}
            </div>
            {platform.fields.map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
                  {f.label} {f.required && <span style={{ color: tk.warn }}>*</span>}
                </label>
                {f.type === "select" ? (
                  <select value={creds[f.key] || f.default || ""}
                    onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", marginTop: 4, borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, boxSizing: "border-box", outline: "none", cursor: "pointer" }}>
                    {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === "password" ? "password" : "text"}
                    value={creds[f.key] || ""} placeholder={f.placeholder || ""}
                    onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                    style={{ width: "100%", padding: "9px 12px", marginTop: 4, borderRadius: 8, border: `1px solid ${tk.border}`, background: tk.inputBg, color: tk.textHi, fontSize: 13, boxSizing: "border-box", outline: "none", fontFamily: f.type === "password" ? "monospace" : undefined }} />
                )}
                {f.hint && <div style={{ fontSize: 11, color: tk.textLo, marginTop: 4 }}>{f.hint}</div>}
              </div>
            ))}
          </div>

          {err && (
            <div style={{ padding: "10px 14px", background: tk.bad + "18", border: `1px solid ${tk.bad}55`, color: tk.bad, borderRadius: 10, fontSize: 13 }}>
              {err}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${tk.border}`, background: tk.panel, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${tk.border}`, background: "transparent", color: tk.textMid, cursor: "pointer", fontSize: 13 }}>
            Cancelar
          </button>
          <button disabled={saving} onClick={submit}
            style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${tk.accent}, ${tk.accent})`, color: "#fff", cursor: saving ? "wait" : "pointer", fontSize: 13, fontWeight: 700 }}>
            {saving ? "Guardando…" : (conn ? "Guardar cambios" : "Crear conexión")}
          </button>
        </div>
      </div>
    </div>
  );
}
