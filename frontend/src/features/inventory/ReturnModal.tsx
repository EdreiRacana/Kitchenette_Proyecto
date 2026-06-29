// ReturnModal.tsx — Devolución de cliente (MVP)
// Flujo: busca el pedido → elige partidas y cantidades → condición (revendible/
// dañado) → motivo + liquidación → registra. Reusa el theme { t } de InventoryModule.
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Search, RotateCcw, AlertTriangle, Check } from "lucide-react";
import { inventoryService, type ReturnableOrder, type OrderLite } from "./service";

const mxn = (n: number) => "$" + (n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Line = {
  variant_id?: number; product_name?: string; sku?: string;
  unit_price: number; returnable: number; qty: number; condition: "sellable" | "damaged";
};

export default function ReturnModal({ t, lang, onClose, onSaved }: {
  t: any; lang: "es" | "en"; onClose: () => void; onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OrderLite[]>([]);
  const [order, setOrder] = useState<ReturnableOrder | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<"none" | "refund" | "store_credit">("none");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${t.border}`, background: t.inputBg, color: t.textHi, fontSize: 13.5, outline: "none", width: "100%" };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: t.textMid, marginBottom: 6, display: "block" };

  const REASONS = lang === "es"
    ? ["Producto defectuoso", "Artículo equivocado", "Dañado en transporte", "Cliente se arrepintió", "Otro"]
    : ["Defective product", "Wrong item", "Damaged in transit", "Customer changed mind", "Other"];

  // Autocompletar: busca en vivo conforme se escribe (debounce 300 ms).
  useEffect(() => {
    if (order) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try { setResults(await inventoryService.searchOrders(term)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [q, order]);

  const pick = async (o: OrderLite) => {
    setError(null);
    try {
      const ro = await inventoryService.getReturnableOrder(o.id);
      setOrder(ro); setResults([]);
      setLines(ro.items.map(i => ({
        variant_id: i.variant_id, product_name: i.product_name, sku: i.sku,
        unit_price: i.unit_price, returnable: i.returnable_quantity, qty: 0, condition: "sellable",
      })));
    } catch { setError(lang === "es" ? "No se pudo cargar el pedido" : "Could not load order"); }
  };

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const refundPreview = lines.reduce((a, l) => a + (l.qty > 0 ? l.qty * l.unit_price : 0), 0);
  const anyQty = lines.some(l => l.qty > 0);

  const submit = async () => {
    if (!order || !anyQty) { setError(lang === "es" ? "Indica al menos una cantidad a devolver" : "Set at least one quantity"); return; }
    setSaving(true); setError(null);
    try {
      await inventoryService.createReturn({
        order_id: order.order_id, reason: reason || undefined,
        settlement_type: settlement, notes: notes || undefined,
        items: lines.filter(l => l.qty > 0).map(l => ({
          variant_id: l.variant_id, product_name: l.product_name, sku: l.sku,
          quantity: l.qty, unit_price: l.unit_price, condition: l.condition,
        })),
      });
      onSaved(); onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || (lang === "es" ? "Error al registrar la devolución" : "Error creating return"));
    } finally { setSaving(false); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 16, width: "100%", maxWidth: 820, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.4)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: `1px solid ${t.border}`, position: "sticky", top: 0, background: t.panel }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: t.warn + "22", color: t.warn, borderRadius: 10, padding: 8, display: "flex" }}><RotateCcw size={18} /></div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.textHi }}>{lang === "es" ? "Devolución de cliente" : "Customer return"}</div>
              <div style={{ fontSize: 12, color: t.textLo }}>{lang === "es" ? "Regresa stock y registra la liquidación" : "Restock and record the settlement"}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: t.textLo, display: "flex" }}><X size={20} /></button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bad + "18", border: `1px solid ${t.bad}44`, color: t.bad, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {/* Paso 1: elegir pedido (autocompletar) */}
          {!order && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={label}>{lang === "es" ? "Busca el pedido a devolver (folio o cliente)" : "Find the order to return (folio or customer)"}</label>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.textLo }} />
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={lang === "es" ? "Empieza a escribir: ORD-000123 o nombre del cliente…" : "Start typing: ORD-000123 or customer name…"} style={{ ...inp, paddingLeft: 34, paddingRight: 34 }} />
                {searching && <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: t.textLo }}>…</div>}
              </div>
              {/* Dropdown de resultados en vivo */}
              {q.trim().length >= 2 && (results.length > 0 || !searching) && (
                <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden", background: t.panel }}>
                  {results.length > 0 ? results.map(o => (
                    <div key={o.id} onClick={() => pick(o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", cursor: "pointer", borderBottom: `1px solid ${t.borderSoft}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = t.panel2)} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.nova, fontFamily: "monospace" }}>{o.folio || `#${o.id}`}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: t.textLo, background: t.panel3, padding: "2px 7px", borderRadius: 6 }}>{o.status}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: t.textMid, whiteSpace: "nowrap" }}>{mxn(o.total_amount)} · {new Date(o.created_at).toLocaleDateString("es-MX")}</div>
                    </div>
                  )) : (
                    <div style={{ padding: "12px 14px", fontSize: 12.5, color: t.textLo }}>{lang === "es" ? "Sin coincidencias. Prueba con el folio o el nombre del cliente." : "No matches. Try the folio or customer name."}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Paso 2: partidas */}
          {order && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: t.panel2, borderRadius: 10, padding: "10px 14px" }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.textHi, fontFamily: "monospace" }}>{order.folio || `#${order.order_id}`}</span>
                  {order.customer_name && <span style={{ fontSize: 12.5, color: t.textLo }}> · {order.customer_name}</span>}
                </div>
                <button onClick={() => { setOrder(null); setLines([]); }} style={{ background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", color: t.textLo, fontSize: 12 }}>
                  {lang === "es" ? "Cambiar pedido" : "Change order"}
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead>
                    <tr>
                      {[lang === "es" ? "Producto" : "Product", "SKU", lang === "es" ? "Devolvible" : "Returnable", lang === "es" ? "Cantidad" : "Quantity", lang === "es" ? "Condición" : "Condition", lang === "es" ? "Importe" : "Amount"].map((h, i) => (
                        <th key={i} style={{ padding: "8px 10px", textAlign: i >= 2 ? "center" : "left", fontSize: 11, fontWeight: 600, color: t.textLo, borderBottom: `1px solid ${t.border}`, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={idx} style={{ opacity: l.returnable === 0 ? 0.45 : 1 }}>
                        <td style={{ padding: "10px 10px", fontSize: 13, color: t.textHi }}>{l.product_name || "—"}</td>
                        <td style={{ padding: "10px 10px", fontSize: 12, color: t.nova, fontFamily: "monospace" }}>{l.sku || "—"}</td>
                        <td style={{ padding: "10px 10px", textAlign: "center", fontSize: 13, color: t.textMid }}>{l.returnable}</td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          <input type="number" min={0} max={l.returnable} value={l.qty} disabled={l.returnable === 0}
                            onChange={e => { const v = Math.max(0, Math.min(l.returnable, Number(e.target.value) || 0)); setLine(idx, { qty: v }); }}
                            style={{ ...inp, width: 70, textAlign: "center", padding: "6px 8px" }} />
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "center" }}>
                          <select value={l.condition} disabled={l.qty === 0} onChange={e => setLine(idx, { condition: e.target.value as any })} style={{ ...inp, width: "auto", padding: "6px 8px", cursor: "pointer" }}>
                            <option value="sellable">{lang === "es" ? "Revendible" : "Sellable"}</option>
                            <option value="damaged">{lang === "es" ? "Dañado (merma)" : "Damaged (scrap)"}</option>
                          </select>
                        </td>
                        <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, fontWeight: 600, color: t.textHi }}>{mxn(l.qty * l.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Motivo + liquidación */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={label}>{lang === "es" ? "Motivo" : "Reason"}</label>
                  <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                    <option value="">{lang === "es" ? "— Selecciona —" : "— Select —"}</option>
                    {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>{lang === "es" ? "Liquidación" : "Settlement"}</label>
                  <select value={settlement} onChange={e => setSettlement(e.target.value as any)} style={{ ...inp, cursor: "pointer" }}>
                    <option value="none">{lang === "es" ? "Sin liquidación" : "None"}</option>
                    <option value="refund">{lang === "es" ? "Reembolso (sale dinero)" : "Refund (cash out)"}</option>
                    <option value="store_credit">{lang === "es" ? "Saldo a favor del cliente" : "Store credit"}</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={label}>{lang === "es" ? "Notas (opcional)" : "Notes (optional)"}</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} style={inp} />
              </div>

              {/* Footer */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: `1px solid ${t.borderSoft}` }}>
                <div style={{ fontSize: 13, color: t.textMid }}>
                  {settlement !== "none"
                    ? <>{lang === "es" ? "A liquidar:" : "To settle:"} <strong style={{ color: t.textHi }}>{mxn(refundPreview)}</strong></>
                    : <span style={{ color: t.textLo }}>{lang === "es" ? "Sin liquidación monetaria" : "No monetary settlement"}</span>}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${t.border}`, background: "transparent", color: t.textMid, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
                  <button onClick={submit} disabled={saving || !anyQty} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, border: "none", background: anyQty ? `linear-gradient(135deg, ${t.nova}, ${t.navy})` : t.panel3, color: anyQty ? "#fff" : t.textLo, cursor: anyQty ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
                    <Check size={15} /> {saving ? (lang === "es" ? "Guardando…" : "Saving…") : (lang === "es" ? "Registrar devolución" : "Register return")}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
