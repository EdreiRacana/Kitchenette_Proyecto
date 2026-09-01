// Panel de aprobaciones de eliminación de productos.
// Solo visible para superuser o rol con inventory.approve. Muestra las
// solicitudes pending y permite aprobar (ejecuta soft delete) o rechazar.
import { useCallback, useEffect, useState } from "react";
import { Check, X, Trash2, Clock, ShieldCheck } from "lucide-react";
import { inventoryService } from "../features/inventory/service";
import { errMsg } from "../services/api";

interface DeletionRequest {
  id: number;
  product_id: number;
  product_name?: string | null;
  reason: string;
  status: string;
  requested_by_user_id: number;
  requested_by_name?: string | null;
  approved_by_user_id?: number | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  executed_at?: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "PENDIENTE", color: "#F59E0B", bg: "#F59E0B22" },
  executed: { label: "APROBADA",  color: "#22C55E", bg: "#22C55E22" },
  rejected: { label: "RECHAZADA", color: "#EF4444", bg: "#EF444422" },
};

export default function ProductDeletionApprovals({ t }: { t: any }) {
  const [items, setItems] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rejecting, setRejecting] = useState<DeletionRequest | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const rows = await inventoryService.listDeletionRequests(filter);
      setItems(rows || []);
    } catch (e: any) {
      setErr(errMsg(e));
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const approve = async (r: DeletionRequest) => {
    if (!window.confirm(`Aprobar la eliminación de "${r.product_name}"? El producto quedará inactivo.`))
      return;
    try {
      await inventoryService.approveDeletionRequest(r.id);
      await load();
    } catch (e: any) {
      alert(errMsg(e));
    }
  };

  const rejectSubmit = async (motivo: string) => {
    if (!rejecting) return;
    try {
      await inventoryService.rejectDeletionRequest(rejecting.id, motivo);
      setRejecting(null);
      await load();
    } catch (e: any) {
      alert(errMsg(e));
    }
  };

  const fmt = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 14, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={18} color={t.nova} />
            <h3 style={{ margin: 0, fontSize: 16, color: t.textHi }}>
              Solicitudes de eliminación de productos
            </h3>
          </div>
          <p style={{ margin: "4px 0 0", color: t.textLo, fontSize: 12.5 }}>
            Cada eliminación de un producto requiere aprobación de un administrador.
            Al aprobar se marca el producto como inactivo — el historial queda intacto.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["pending", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: "6px 12px", borderRadius: 8,
                border: `1px solid ${filter === f ? t.nova : t.border}`,
                background: filter === f ? t.nova + "18" : "transparent",
                color: filter === f ? t.nova : t.textMid,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
              {f === "pending" ? "Pendientes" : "Todas"}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div style={{ padding: 10, borderRadius: 8,
                       background: (t.bad || "#ef4444") + "18",
                       color: t.bad || "#ef4444", fontSize: 12.5, marginBottom: 12 }}>
          {typeof err === "string" ? err : JSON.stringify(err)}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: t.textLo }}>
          Cargando…
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 12, background: t.panel2,
                       border: `1px solid ${t.border}`, color: t.textMid,
                       textAlign: "center" }}>
          {filter === "pending"
            ? "No hay solicitudes pendientes. Todo al día."
            : "No hay solicitudes registradas."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(r => {
            const st = STATUS_STYLES[r.status] || STATUS_STYLES.pending;
            return (
              <div key={r.id} style={{
                background: t.panel2, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: 14,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12,
                                justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8,
                                    marginBottom: 4 }}>
                      <Trash2 size={14} color={st.color} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: t.textHi }}>
                        {r.product_name || `Producto #${r.product_id}`}
                      </span>
                      <span style={{
                        padding: "2px 7px", borderRadius: 4,
                        fontSize: 9.5, fontWeight: 700,
                        background: st.bg, color: st.color,
                      }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: t.textMid, marginBottom: 6 }}>
                      <strong>Motivo:</strong> {r.reason}
                    </div>
                    <div style={{ fontSize: 11, color: t.textLo,
                                    display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span><Clock size={11} style={{ verticalAlign: "middle" }} /> {fmt(r.created_at)}</span>
                      <span>Solicita: <strong style={{ color: t.textMid }}>{r.requested_by_name || `#${r.requested_by_user_id}`}</strong></span>
                      {r.approved_by_name && (
                        <span>{r.status === "rejected" ? "Rechaza" : "Aprueba"}: <strong style={{ color: t.textMid }}>{r.approved_by_name}</strong></span>
                      )}
                    </div>
                    {r.rejection_reason && (
                      <div style={{ marginTop: 8, padding: 8, borderRadius: 6,
                                      background: (t.bad || "#ef4444") + "12",
                                      color: t.bad || "#ef4444", fontSize: 11.5 }}>
                        <strong>Rechazado:</strong> {r.rejection_reason}
                      </div>
                    )}
                  </div>
                  {r.status === "pending" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => approve(r)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          padding: "7px 12px", borderRadius: 6, border: "none",
                          background: (t.good || "#22c55e"), color: "#fff",
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                        }}>
                        <Check size={13} /> Aprobar
                      </button>
                      <button onClick={() => setRejecting(r)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          padding: "7px 12px", borderRadius: 6,
                          border: `1px solid ${t.bad || "#ef4444"}`,
                          background: "transparent",
                          color: t.bad || "#ef4444",
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}>
                        <X size={13} /> Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rejecting && (
        <RejectModal t={t} request={rejecting}
          onClose={() => setRejecting(null)}
          onSubmit={rejectSubmit} />
      )}
    </div>
  );
}


function RejectModal({
  t, request, onClose, onSubmit,
}: {
  t: any; request: DeletionRequest;
  onClose: () => void; onSubmit: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "grid", placeItems: "center", zIndex: 200, padding: 16,
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: t.panel, border: `1px solid ${t.border}`,
          borderRadius: 14, padding: 20, width: "100%", maxWidth: 480,
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15, color: t.textHi }}>
          Rechazar solicitud
        </h3>
        <div style={{ fontSize: 12.5, color: t.textLo, marginBottom: 12 }}>
          Producto: <strong style={{ color: t.textMid }}>{request.product_name}</strong>
        </div>
        <label style={{ fontSize: 11, fontWeight: 600, color: t.textMid,
                         display: "block", marginBottom: 4 }}>
          Motivo del rechazo (obligatorio)
        </label>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)}
          rows={4} placeholder="Ej. El producto aún tiene stock que hay que agotar antes."
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 8,
            background: t.panel2, border: `1px solid ${t.border}`,
            color: t.textHi, fontSize: 13, outline: "none", resize: "vertical",
            fontFamily: "inherit",
          }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} disabled={busy}
            style={{
              padding: "9px 16px", borderRadius: 8,
              border: `1px solid ${t.border}`, background: "transparent",
              color: t.textMid, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>Cancelar</button>
          <button
            disabled={busy || motivo.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit(motivo.trim()); } finally { setBusy(false); }
            }}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "none",
              background: t.bad || "#ef4444", color: "#fff",
              fontSize: 12.5, fontWeight: 700,
              cursor: motivo.trim().length < 3 ? "not-allowed" : "pointer",
              opacity: motivo.trim().length < 3 ? 0.5 : 1,
            }}>
            {busy ? "Enviando…" : "Rechazar solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
