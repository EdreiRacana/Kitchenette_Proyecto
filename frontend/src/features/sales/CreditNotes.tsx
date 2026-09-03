// Componentes de Notas de Credito CFDI 4.0:
//   - CreditNoteModal: crear NC eligiendo lineas + motivo SAT + reingreso stock.
//   - CancelCreditNoteModal: cancela NC ya timbrada con motivo SAT.
//   - CreditNotesPanel: historial de NCs de una venta con acciones (PDF/XML/cancel).
//
// El backend valida todo (motivos SAT, montos, prerequisito de UUID en la
// factura original). Aqui solo damos una UI segura y guiada, y errores
// legibles via errMsg().
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, FileText, XCircle, Loader2, CheckCircle, Download } from "lucide-react";
import type { Order } from "./types";
import type { Tokens } from "./theme";
import { salesApi, type CreditNote, type CreditNoteLineDraft } from "./api";
import { errMsg } from "../../services/api";


function money(n: number) {
  return "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}


// ────────────────────────────────────────────────────────────────────────
// Modal: Crear Nota de Credito
// ────────────────────────────────────────────────────────────────────────
export function CreditNoteModal({ tk, order, onClose, onCreated }: {
  tk: Tokens; order: Order;
  onClose: () => void;
  onCreated: (nc: CreditNote) => void;
}) {
  const [motivos, setMotivos] = useState<{ codigo: string; descripcion: string }[]>([]);
  const [motivo, setMotivo] = useState("03");   // 03 = devolucion (mas comun)
  const [kind, setKind] = useState<"parcial" | "total">("parcial");
  const [reason, setReason] = useState("");
  const [restocks, setRestocks] = useState(true);
  // Cada linea de la venta: { selected, qty }. qty default = qty original.
  const [selection, setSelection] = useState<Record<number, { selected: boolean; qty: number }>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    salesApi.listMotivosSAT().then(r => setMotivos(r.motivos)).catch(() => {});
    // Precarga: todas las lineas seleccionadas con qty original si kind=total,
    // ninguna si kind=parcial (el usuario elige).
    const init: typeof selection = {};
    for (const it of (order.items || [])) {
      init[it.id] = { selected: false, qty: it.quantity };
    }
    setSelection(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    if (kind === "total") {
      setSelection(prev => {
        const next = { ...prev };
        for (const it of (order.items || [])) {
          next[it.id] = { selected: true, qty: it.quantity };
        }
        return next;
      });
    }
  }, [kind, order.items]);

  const linesDraft: CreditNoteLineDraft[] = useMemo(() => {
    return (order.items || [])
      .filter(it => selection[it.id]?.selected && selection[it.id].qty > 0)
      .map(it => ({
        order_item_id: it.id,
        variant_id: it.variant_id,
        product_name: it.product_name,
        sku: it.sku,
        quantity: selection[it.id].qty,
        unit_price: it.unit_price,
        discount_amount: 0,
        tax_rate: it.tax_rate || 16,
      }));
  }, [order.items, selection]);

  const total = useMemo(() => linesDraft.reduce(
    (a, L) => a + L.quantity * L.unit_price, 0), [linesDraft]);

  const canSubmit = motivo && linesDraft.length > 0 && !saving;

  const submit = async () => {
    setSaving(true); setMsg(null);
    try {
      const nc = await salesApi.createCreditNote({
        order_id: order.id,
        motivo_sat: motivo,
        kind,
        reason: reason || undefined,
        restocks_inventory: restocks,
        warehouse_id: order.warehouse_id || undefined,
        lines: linesDraft,
      });
      // Timbrar de inmediato (flujo estandar). Si el usuario prefiere dejar
      // en draft y timbrar despues, el panel de historial permite hacerlo.
      let stamped: CreditNote = nc;
      try {
        stamped = await salesApi.stampCreditNote(nc.id);
        setMsg({ ok: true, text: `NC ${stamped.folio} timbrada. UUID ${stamped.cfdi_uuid?.slice(0, 8)}…` });
      } catch (e: any) {
        setMsg({ ok: false, text: `NC creada en draft pero fallo el timbrado: ${errMsg(e)}` });
      }
      onCreated(stamped);
    } catch (e: any) {
      setMsg({ ok: false, text: errMsg(e, "No se pudo crear la nota de credito") });
    } finally { setSaving(false); }
  };

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 950,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: tk.panel, borderRadius: 14, border: `1px solid ${tk.border}`,
          width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${tk.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: tk.warn + "22", color: tk.warn, borderRadius: 8, padding: 8 }}>
              <FileText size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: tk.textHi }}>
                Emitir nota de crédito
              </h2>
              <div style={{ fontSize: 11.5, color: tk.textLo, marginTop: 2 }}>
                Venta {order.folio} · Total {money(order.total_amount)}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Prerequisito */}
          {!order.cfdi_uuid && (
            <div style={{ padding: 10, borderRadius: 8, background: tk.warn + "18", color: tk.warn,
              fontSize: 12.5, border: `1px dashed ${tk.warn}55` }}>
              ⚠ Esta venta aún no tiene factura timbrada. Timbra primero la factura desde el drawer;
              sin UUID no se puede emitir NC.
            </div>
          )}

          {/* Tipo */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setKind("parcial")}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10,
                border: `1px solid ${kind === "parcial" ? tk.accent : tk.border}`,
                background: kind === "parcial" ? tk.accent + "18" : "transparent",
                color: kind === "parcial" ? tk.accent : tk.textMid,
                fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              Parcial
            </button>
            <button onClick={() => setKind("total")}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10,
                border: `1px solid ${kind === "total" ? tk.bad : tk.border}`,
                background: kind === "total" ? tk.bad + "18" : "transparent",
                color: kind === "total" ? tk.bad : tk.textMid,
                fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
              Total (todas las líneas)
            </button>
          </div>

          {/* Motivo SAT */}
          <div>
            <label style={{ fontSize: 12, color: tk.textMid, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Motivo SAT *
            </label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
                background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none" }}>
              {motivos.map(m => (
                <option key={m.codigo} value={m.codigo}>{m.codigo} — {m.descripcion}</option>
              ))}
            </select>
          </div>

          {/* Reason libre */}
          <div>
            <label style={{ fontSize: 12, color: tk.textMid, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Descripción interna (opcional)
            </label>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Ej. Cliente devolvió la caja abierta"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
                background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>

          {/* Reingreso a inventario */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: tk.textMid, cursor: "pointer" }}>
            <input type="checkbox" checked={restocks} onChange={e => setRestocks(e.target.checked)} />
            Reingresar la mercancía al almacén (devolución física)
          </label>

          {/* Lineas */}
          <div>
            <div style={{ fontSize: 12, color: tk.textMid, fontWeight: 600, marginBottom: 6 }}>
              Líneas a acreditar
            </div>
            <div style={{ border: `1px solid ${tk.border}`, borderRadius: 10, overflow: "hidden" }}>
              {(order.items || []).map(it => {
                const s = selection[it.id] || { selected: false, qty: it.quantity };
                return (
                  <div key={it.id} style={{ padding: "10px 12px", borderBottom: `1px solid ${tk.border}44`,
                    display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center" }}>
                    <input type="checkbox" checked={s.selected} disabled={kind === "total"}
                      onChange={e => setSelection(p => ({ ...p, [it.id]: { ...s, selected: e.target.checked } }))} />
                    <div>
                      <div style={{ fontSize: 13, color: tk.textHi, fontWeight: 600 }}>{it.product_name}</div>
                      <div style={{ fontSize: 11, color: tk.textLo }}>
                        {money(it.unit_price)} c/u · vendidas {it.quantity}
                      </div>
                    </div>
                    <input type="number" min={0.001} max={it.quantity} step="0.001"
                      value={s.qty} disabled={!s.selected || kind === "total"}
                      onChange={e => setSelection(p => ({ ...p, [it.id]: { ...s, qty: Number(e.target.value) } }))}
                      style={{ width: 80, padding: "6px 8px", borderRadius: 6, border: `1px solid ${tk.border}`,
                        background: tk.inputBg, color: tk.textHi, fontSize: 12.5, textAlign: "right", outline: "none" }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, fontVariantNumeric: "tabular-nums", minWidth: 90, textAlign: "right" }}>
                      {money(s.selected ? s.qty * it.unit_price : 0)}
                    </div>
                  </div>
                );
              })}
              {(!order.items || order.items.length === 0) && (
                <div style={{ padding: 20, textAlign: "center", color: tk.textLo, fontSize: 12 }}>
                  Esta venta no tiene líneas.
                </div>
              )}
            </div>
          </div>

          {/* Total NC */}
          <div style={{ padding: "12px 16px", borderRadius: 10, background: tk.panel2,
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: tk.textMid, fontWeight: 600 }}>Total nota de crédito</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: tk.warn, fontVariantNumeric: "tabular-nums" }}>
              −{money(total)}
            </div>
          </div>

          {msg && (
            <div style={{ padding: 10, borderRadius: 8,
              background: (msg.ok ? tk.good : tk.bad) + "18",
              color: msg.ok ? tk.good : tk.bad, fontSize: 12.5, whiteSpace: "pre-wrap" }}>
              {msg.text}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${tk.border}`,
          display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${tk.border}`,
              background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 13 }}>
            Cancelar
          </button>
          <button onClick={submit} disabled={!canSubmit}
            style={{ padding: "10px 22px", borderRadius: 10, border: "none",
              background: canSubmit ? `linear-gradient(135deg, ${tk.warn}, #B45309)` : tk.panel3,
              color: canSubmit ? "#fff" : tk.textLo, cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            {saving && <Loader2 size={14} className="spin" />}
            {saving ? "Timbrando…" : "Emitir y timbrar NC"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ────────────────────────────────────────────────────────────────────────
// Modal: Cancelar Nota de Credito
// ────────────────────────────────────────────────────────────────────────
export function CancelCreditNoteModal({ tk, nc, onClose, onCancelled }: {
  tk: Tokens; nc: CreditNote;
  onClose: () => void;
  onCancelled: (nc: CreditNote) => void;
}) {
  const [motivo, setMotivo] = useState("02");        // 02 = con errores sin relacion (mas comun)
  const [folioSust, setFolioSust] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // c_MotivoCancelacion CFDI 4.0
  const MOTIVOS = [
    { c: "01", d: "Comprobante emitido con errores con relación (requiere folio sustituto)" },
    { c: "02", d: "Comprobante emitido con errores sin relación" },
    { c: "03", d: "No se llevó a cabo la operación" },
    { c: "04", d: "Operación nominativa relacionada en la factura global" },
  ];
  const needsSust = motivo === "01";

  const submit = async () => {
    if (needsSust && !folioSust.trim()) {
      setMsg({ ok: false, text: "Motivo 01 requiere folio sustituto (UUID de reemplazo)." });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      const updated = await salesApi.cancelCreditNote(nc.id, motivo, needsSust ? folioSust.trim() : undefined);
      onCancelled(updated);
    } catch (e: any) {
      setMsg({ ok: false, text: errMsg(e, "No se pudo cancelar la NC") });
    } finally { setSaving(false); }
  };

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 960,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: tk.panel, borderRadius: 14, border: `1px solid ${tk.border}`,
          width: "100%", maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${tk.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: tk.bad + "22", color: tk.bad, borderRadius: 8, padding: 8 }}>
              <XCircle size={18} />
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: tk.textHi }}>
              Cancelar NC {nc.folio} ante el SAT
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: tk.textLo }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: tk.textMid, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Motivo de cancelación (c_MotivoCancelacion SAT) *
            </label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
                background: tk.inputBg, color: tk.textHi, fontSize: 13, outline: "none" }}>
              {MOTIVOS.map(m => (
                <option key={m.c} value={m.c}>{m.c} — {m.d}</option>
              ))}
            </select>
          </div>

          {needsSust && (
            <div>
              <label style={{ fontSize: 12, color: tk.textMid, fontWeight: 600, display: "block", marginBottom: 5 }}>
                Folio sustituto (UUID del CFDI que reemplaza a éste) *
              </label>
              <input value={folioSust} onChange={e => setFolioSust(e.target.value)}
                placeholder="12345678-1234-1234-1234-123456789012"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
                  background: tk.inputBg, color: tk.textHi, fontSize: 12.5, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
            </div>
          )}

          <div style={{ padding: 10, borderRadius: 8, background: tk.bad + "12",
            color: tk.textMid, fontSize: 12, border: `1px dashed ${tk.bad}44` }}>
            La cancelación se envía al SAT y no puede revertirse. El saldo de la venta original
            se restaura al monto original.
          </div>

          {msg && (
            <div style={{ padding: 10, borderRadius: 8,
              background: (msg.ok ? tk.good : tk.bad) + "18",
              color: msg.ok ? tk.good : tk.bad, fontSize: 12.5 }}>
              {msg.text}
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: `1px solid ${tk.border}`,
          display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${tk.border}`,
              background: tk.panel2, color: tk.textMid, cursor: "pointer", fontSize: 13 }}>
            Cerrar
          </button>
          <button onClick={submit} disabled={saving || (needsSust && !folioSust.trim())}
            style={{ padding: "10px 22px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${tk.bad}, #B91C1C)`,
              color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8 }}>
            {saving && <Loader2 size={14} className="spin" />}
            {saving ? "Cancelando…" : "Cancelar ante SAT"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ────────────────────────────────────────────────────────────────────────
// Panel: Historial de NCs de una venta (para embeber dentro del OrderDrawer)
// ────────────────────────────────────────────────────────────────────────
export function CreditNotesPanel({ tk, orderId, refreshKey, onChanged }: {
  tk: Tokens; orderId: number;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<CreditNote | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await salesApi.listCreditNotes(orderId);
      setRows(list);
    } catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderId, refreshKey]);

  const stamp = async (nc: CreditNote) => {
    try {
      await salesApi.stampCreditNote(nc.id);
      await load();
      onChanged?.();
    } catch (e: any) { alert(errMsg(e, "No se pudo timbrar")); }
  };

  if (loading) return (
    <div style={{ padding: 12, color: tk.textLo, fontSize: 12 }}>Cargando notas de crédito…</div>
  );
  if (!rows.length) return null;

  const badge = (nc: CreditNote) => {
    if (nc.status === "stamped") return { txt: "TIMBRADA", color: tk.good };
    if (nc.status === "cancelled") return { txt: "CANCELADA", color: tk.bad };
    return { txt: "DRAFT", color: tk.textLo };
  };

  return (
    <div style={{ marginTop: 14, border: `1px solid ${tk.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: tk.panel2, display: "flex", alignItems: "center", gap: 8 }}>
        <FileText size={14} color={tk.warn} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: tk.textHi }}>
          Notas de crédito · {rows.length}
        </span>
      </div>
      {rows.map(nc => {
        const b = badge(nc);
        return (
          <div key={nc.id} style={{ padding: "10px 14px", borderTop: `1px solid ${tk.border}44`,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi }}>
                {nc.folio} · −{money(nc.total)}
              </div>
              <div style={{ fontSize: 10.5, color: tk.textLo, fontFamily: "monospace" }}>
                {nc.cfdi_uuid || "sin timbrar"} · Motivo {nc.motivo_sat}
              </div>
            </div>
            <span style={{ fontSize: 9.5, fontWeight: 800, padding: "3px 8px", borderRadius: 20,
              background: b.color + "22", color: b.color }}>{b.txt}</span>
            {nc.status === "draft" && (
              <button onClick={() => stamp(nc)}
                style={{ padding: "5px 10px", borderRadius: 6, border: "none",
                  background: tk.warn + "22", color: tk.warn, cursor: "pointer",
                  fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                <CheckCircle size={12} /> Timbrar
              </button>
            )}
            {nc.status === "stamped" && (
              <>
                <button onClick={async () => {
                  try { download(await salesApi.downloadCreditNotePDF(nc.id), `${nc.folio}.pdf`); }
                  catch (e: any) { alert(errMsg(e, "PDF no disponible")); }
                }} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${tk.border}`,
                  background: "transparent", color: tk.textMid, cursor: "pointer",
                  fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                  <Download size={12} /> PDF
                </button>
                <button onClick={async () => {
                  try { download(await salesApi.downloadCreditNoteXML(nc.id), `${nc.folio}.xml`); }
                  catch (e: any) { alert(errMsg(e, "XML no disponible")); }
                }} style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${tk.border}`,
                  background: "transparent", color: tk.textMid, cursor: "pointer",
                  fontSize: 11.5, fontWeight: 600 }}>
                  XML
                </button>
                <button onClick={() => setCancelling(nc)}
                  style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${tk.bad}55`,
                    background: tk.bad + "18", color: tk.bad, cursor: "pointer",
                    fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                  <XCircle size={12} /> Cancelar
                </button>
              </>
            )}
          </div>
        );
      })}

      {cancelling && (
        <CancelCreditNoteModal tk={tk} nc={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={async () => { setCancelling(null); await load(); onChanged?.(); }} />
      )}
    </div>
  );
}
