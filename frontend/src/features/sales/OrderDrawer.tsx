// Slide-over detail panel for an order/quote: info, items, payments, audit log,
// and all lifecycle actions + printable ticket.

import { useEffect, useState } from "react";
import {
  X, CreditCard, CheckCircle, XCircle, Pencil, ArrowRightLeft, Printer, FileText, MessageCircle, Mail,
  Stamp, FileMinus,
} from "lucide-react";
import type { Tokens, Translator } from "./theme";
import { money, dateTime, paymentLabel, statusColors, statusMeta } from "./theme";
import type { Order } from "./types";
import { Badge, Button, IconButton } from "./ui";
import configService from "../config/service";
import { resolveMediaUrl, errMsg } from "../../services/api";
import { openWhatsApp } from "../../utils/whatsapp";
import { salesApi } from "./api";
import { CreditNoteModal, CreditNotesPanel } from "./CreditNotes";

async function emailTicket(order: Order) {
  const suggested = order.customer?.email || "";
  const to = window.prompt(
    `Enviar ticket ${order.folio || "#" + order.id} por correo a:`,
    suggested
  );
  if (to === null) return;
  const dest = to.trim();
  if (!dest) { alert("Escribe un correo válido."); return; }
  try {
    const r = await salesApi.sendTicketEmail(order.id, dest);
    if (r.sent) alert(`✅ Ticket enviado a ${r.to}`);
    else alert(`No se envió: ${r.reason || "error desconocido"}`);
  } catch (e: any) {
    alert(e?.response?.data?.detail || e?.message || "Error al enviar el correo");
  }
}

function whatsappTicketMessage(order: Order): string {
  const lines = order.items.map((it) => `· ${it.quantity}x ${it.product_name ?? ""} — ${money((it.subtotal ?? it.unit_price * it.quantity))}`);
  return [
    `*${order.kind === "quote" ? "Cotización" : "Pedido"} ${order.folio ?? ""}*`,
    ...lines,
    `Total: ${money(order.total_amount)}`,
    `Saldo: ${money(order.balance)}`,
  ].join("\n");
}

async function printTicket(order: Order) {
  const w = window.open("", "_blank", "width=480,height=720");
  let company: { legal_name?: string; logo_url?: string } = {};
  try { company = await configService.getCompanyProfile(); } catch { /* sin perfil configurado */ }
  const businessName = company.legal_name || "Kitchenette";
  // El logo viene del backend con URL relativa (ej: '/static/company/logo.webp').
  // La ventana que abrimos con window.open('') hereda el origen del frontend
  // (sthenova-frontend.onrender.com), NO el del backend, así que un src="/static/…"
  // pega 404 y el navegador muestra el placeholder de imagen rota. resolveMediaUrl
  // antepone BACKEND_ORIGIN a las rutas relativas y deja intactas las absolutas.
  const resolvedLogo = resolveMediaUrl(company.logo_url);
  const logoHtml = resolvedLogo
    ? `<img src="${resolvedLogo}" alt="logo" style="max-height:48px;max-width:160px;object-fit:contain;margin-bottom:6px" />`
    : "";
  const rows = order.items.map((it) =>
    `<tr><td>${it.product_name ?? ""}${it.sku ? ` <span class="sku">${it.sku}</span>` : ""}</td>
      <td class="r">${it.quantity}</td><td class="r">${money(it.unit_price)}</td>
      <td class="r">${money((it.subtotal ?? it.unit_price * it.quantity))}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${order.folio ?? "Ticket"}</title>
    <style>
      *{font-family:'Segoe UI',Arial,sans-serif;color:#111}
      body{max-width:420px;margin:24px auto;padding:0 16px}
      h1{font-size:20px;margin:0} .muted{color:#666;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
      th,td{padding:6px 4px;border-bottom:1px solid #eee;text-align:left}
      .r{text-align:right} .sku{color:#999;font-size:11px}
      .tot{display:flex;justify-content:space-between;font-size:14px;margin:4px 0}
      .grand{font-size:18px;font-weight:800;border-top:2px solid #111;padding-top:8px;margin-top:8px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px}
    </style></head><body>
    <div class="head"><div>${logoHtml}<h1>${businessName}</h1><div class="muted">${order.kind === "quote" ? "Cotización" : "Pedido"} ${order.folio ?? ""}</div></div>
    <div class="muted r">${dateTime(order.created_at)}</div></div>
    <div class="muted" style="margin-top:10px">Cliente: ${order.customer?.name ?? "Mostrador"}<br>
    Pago: ${paymentLabel(order.payment_method)} · Estado: ${statusMeta(order.status).label}</div>
    <table><thead><tr><th>Producto</th><th class="r">Cant</th><th class="r">P.U.</th><th class="r">Importe</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:14px">
      <div class="tot"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
      <div class="tot"><span>Descuento</span><span>− ${money(order.discount_amount)}</span></div>
      <div class="tot"><span>IVA (${order.tax_rate}%)</span><span>${money(order.tax_amount)}</span></div>
      <div class="tot"><span>Envío</span><span>${money(order.shipping_amount)}</span></div>
      <div class="tot grand"><span>TOTAL</span><span>${money(order.total_amount)}</span></div>
      <div class="tot"><span>Pagado</span><span>${money(order.paid_amount)}</span></div>
      <div class="tot"><span>Saldo</span><span>${money(order.balance)}</span></div>
    </div>
    <p class="muted" style="text-align:center;margin-top:24px">¡Gracias por su compra!</p>
    <script>window.onload=()=>{window.print()}</script></body></html>`;
  if (w) { w.document.write(html); w.document.close(); }
}

function Section({ tk, title, children }: { tk: Tokens; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export function OrderDrawer({
  tk, tr, order, onClose, onEdit, onPay, onMarkPaid, onConvert, onCancel, onInvoice,
}: {
  tk: Tokens; tr: Translator; order: Order | null; onClose: () => void;
  onEdit: (o: Order) => void; onPay: (o: Order) => void; onMarkPaid: (o: Order) => void;
  onConvert: (o: Order) => void; onCancel: (o: Order) => void; onInvoice: (o: Order) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Lotes despachados (solo perecederos). Se cargan lazy al abrir la orden
  // — así el CRM ve exactamente qué caducidades le van a llegar al cliente
  // antes de imprimir la remisión o antes de un recall.
  const [batches, setBatches] = useState<Array<{
    variant_id: number; product_name: string; batch_code?: string | null;
    expiration_date?: string | null; quantity: number;
  }>>([]);
  useEffect(() => {
    if (!order) { setBatches([]); return; }
    let cancelled = false;
    salesApi.getOrderBatches(order.id)
      .then(r => { if (!cancelled) setBatches(r.batches || []); })
      .catch(() => { if (!cancelled) setBatches([]); });
    return () => { cancelled = true; };
  }, [order?.id]);

  // Estado local para acciones CFDI (timbrar factura + emitir NC).
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [ncRefreshKey, setNcRefreshKey] = useState(0);
  const [stampingInvoice, setStampingInvoice] = useState(false);
  const [invoiceMsg, setInvoiceMsg] = useState<string | null>(null);

  // Edicion in-place de datos fiscales del pedido
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [fiscalSaving, setFiscalSaving] = useState(false);
  const [fiscalForm, setFiscalForm] = useState({
    rfc: "", name: "", regime: "612", use: "G03", zip: "", save_to_customer: true,
  });
  useEffect(() => {
    if (order) {
      setFiscalForm({
        rfc: order.bill_rfc || (order.customer as any)?.rfc || "",
        name: order.bill_name || order.customer?.name || "",
        regime: (order as any).bill_regime || (order.customer as any)?.regimen_fiscal || "612",
        use: (order as any).bill_use || (order.customer as any)?.uso_cfdi || "G03",
        zip: (order as any).bill_zip || (order.customer as any)?.codigo_postal || "",
        save_to_customer: true,
      });
    }
  }, [order?.id]);
  const saveFiscal = async () => {
    if (!order) return;
    if (!fiscalForm.rfc || fiscalForm.rfc.length < 12) {
      setInvoiceMsg("El RFC es obligatorio (12-13 caracteres)."); return;
    }
    setFiscalSaving(true); setInvoiceMsg(null);
    try {
      await salesApi.patchFiscalData(order.id, {
        rfc: fiscalForm.rfc.toUpperCase().trim(),
        name: fiscalForm.name.trim(),
        regime: fiscalForm.regime, use: fiscalForm.use,
        zip: fiscalForm.zip.trim(),
        save_to_customer: fiscalForm.save_to_customer,
      });
      setInvoiceMsg("✓ Datos fiscales guardados" + (fiscalForm.save_to_customer ? " (y en el cliente)." : "."));
      setFiscalOpen(false);
      setNcRefreshKey(k => k + 1);
    } catch (e: any) {
      setInvoiceMsg(errMsg(e, "No se pudieron guardar los datos fiscales"));
    } finally { setFiscalSaving(false); }
  };

  const stampInvoice = async () => {
    if (!order) return;
    if (!window.confirm(
      "¿Timbrar la factura CFDI 4.0 de esta venta ante el SAT?\n\n" +
      "Se usarán las credenciales de Sufactura de esta empresa. Una vez timbrada, " +
      "cualquier corrección deberá hacerse con nota de crédito."
    )) return;
    setStampingInvoice(true); setInvoiceMsg(null);
    try {
      const r = await salesApi.stampOrder(order.id);
      setInvoiceMsg(`✓ Factura timbrada. UUID ${r.uuid?.slice(0, 8)}…`);
      // Recargar la orden desde el server para que aparezcan cfdi_uuid/status
      // Como no tenemos setter aqui, forzamos refresh del panel NC.
      setNcRefreshKey(k => k + 1);
    } catch (e: any) {
      setInvoiceMsg(errMsg(e, "No se pudo timbrar la factura"));
    } finally { setStampingInvoice(false); }
  };

  if (!order) return null;
  const sc = statusColors(tk, order.status);
  const isQuote = order.kind === "quote";
  const closed = order.status === "cancelled" || order.status === "converted";
  const canStampInvoice = !isQuote && !order.cfdi_uuid && order.status !== "cancelled";
  const canEmitCreditNote = !isQuote && !!order.cfdi_uuid && order.status !== "cancelled";
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, color: tk.textMid };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.6)", zIndex: 900 }} />
      <div style={{
        position: "fixed", top: 64, right: 0, height: "calc(100vh - 64px)", width: 480, maxWidth: "96vw",
        background: tk.panel, borderLeft: `1px solid ${tk.border}`, zIndex: 901,
        display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.45)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 22px", borderBottom: `1px solid ${tk.border}` }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: 18, color: tk.textHi }}>{order.folio}</span>
              <Badge tk={tk} bg={sc.bg} color={sc.text} border={sc.border}>{statusMeta(order.status).label}</Badge>
              {isQuote && <Badge tk={tk} bg={tk.accent + "1A"} color={tk.accent} border={tk.accent + "44"}>Cotización</Badge>}
              {order.channel === "pos" && (
                <Badge tk={tk} bg={tk.good + "1F"} color={tk.good} border={tk.good + "55"}>POS</Badge>
              )}
              {order.channel === "marketplace" && (
                <Badge tk={tk} bg="#A78BFA1F" color="#A78BFA" border="#A78BFA55">Marketplace</Badge>
              )}
              {order.channel === "chain_sellthrough" && (
                <Badge tk={tk} bg="#F59E0B1F" color="#F59E0B" border="#F59E0B55">Sell-through</Badge>
              )}
            </div>
            <div style={{ fontSize: 13, color: tk.textMid, marginTop: 4 }}>{order.customer?.name ?? tr("sales_no_customer", "Mostrador")}</div>
          </div>
          <IconButton tk={tk} onClick={onClose} title={tr("sales_close", "Cerrar")}><X size={20} /></IconButton>
        </div>

        <div style={{ padding: 22, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Info grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              [tr("sales_col_date", "Fecha"), dateTime(order.created_at)],
              [tr("sales_col_seller", "Vendedor"), order.seller?.full_name ?? "—"],
              [tr("sales_detail_payment", "Pago"), paymentLabel(order.payment_method)],
              [tr("sales_channel", "Canal"), order.channel ?? "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ background: tk.panel2, borderRadius: 8, padding: "9px 12px" }}>
                <div style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 13, color: tk.textHi, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          {order.notes && (
            <div style={{ background: tk.panel2, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{tr("sales_detail_notes", "Notas")}</div>
              <div style={{ fontSize: 13, color: tk.textMid, lineHeight: 1.5 }}>{order.notes}</div>
            </div>
          )}

          {/* Items */}
          <Section tk={tk} title={tr("sales_detail_products", "Productos")}>
            <div style={{ background: tk.panel2, borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{[tr("sales_product", "Producto"), tr("sales_detail_qty", "Cant"), tr("sales_detail_unit_price", "P.U."), tr("sales_detail_subtotal", "Importe")].map((h, i) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: tk.textLo, borderBottom: `1px solid ${tk.border}`, textAlign: i === 0 ? "left" : "right", textTransform: "uppercase" }}>{h}</th>
                ))}</tr></thead>
                <tbody>
                  {order.items.map((it, i) => {
                    const rq = it.returned_quantity ?? 0;
                    const net = it.net_quantity ?? (it.quantity - rq);
                    const fullyReturned = rq > 0 && net === 0;
                    const dim = fullyReturned ? 0.55 : 1;
                    return (
                      <tr key={i} style={{ opacity: dim }}>
                        <td style={td}>
                          <span style={{ color: tk.textHi, textDecoration: fullyReturned ? "line-through" : "none" }}>{it.product_name}</span>
                          {it.sku && <span style={{ color: tk.textLo, fontSize: 11 }}> · {it.sku}</span>}
                          {rq > 0 && (
                            <div style={{ fontSize: 10.5, color: tk.warn, marginTop: 2, fontWeight: 600 }}>
                              {rq} devuelt{rq === 1 ? "a" : "as"} · {net} netas
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {rq > 0 ? (
                            <>
                              <span style={{ color: tk.textLo, textDecoration: "line-through" }}>{it.quantity}</span>
                              <span style={{ color: tk.textHi, marginLeft: 4, fontWeight: 700 }}>{net}</span>
                            </>
                          ) : it.quantity}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{money(it.unit_price)}</td>
                        <td style={{ ...td, textAlign: "right", color: tk.textHi, fontWeight: 600 }}>
                          {money((net || 0) * it.unit_price)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Totals */}
            <div style={{ marginTop: 12, paddingRight: 4 }}>
              {[
                [tr("sales_detail_subtotal", "Subtotal"), money(order.subtotal)],
                [tr("sales_discount", "Descuento"), "− " + money(order.discount_amount)],
                [`${tr("sales_tax", "IVA")} (${order.tax_rate}%)`, money(order.tax_amount)],
                [tr("sales_shipping", "Envío"), money(order.shipping_amount)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: tk.textMid, marginBottom: 6 }}><span>{k}</span><span>{v}</span></div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, color: tk.textHi, borderTop: `1px solid ${tk.border}`, paddingTop: 8 }}><span>Total</span><span>{money(order.total_amount)}</span></div>
              {!isQuote && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: tk.good, marginTop: 6 }}><span>{tr("sales_paid", "Pagado")}</span><span>{money(order.paid_amount)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: order.balance > 0 ? tk.warn : tk.good }}><span>{tr("sales_balance", "Saldo")}</span><span>{money(order.balance)}</span></div>
                </>
              )}
            </div>
          </Section>

          {/* Lotes despachados (perecederos) — trazabilidad para recall */}
          {batches.length > 0 && (
            <Section tk={tk} title={tr("sales_lots_dispatched", "Lotes despachados") + " · " + tr("sales_expiry_short", "Caducidad")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {batches.map((b, i) => {
                  const days = b.expiration_date ? Math.floor((new Date(b.expiration_date).getTime() - Date.now()) / 86400000) : null;
                  const color = days == null ? tk.textLo : days < 0 ? tk.bad : days <= 7 ? tk.bad : days <= 30 ? tk.warn : tk.good;
                  return (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: tk.panel2, borderRadius: 8, padding: "10px 12px",
                      borderLeft: `3px solid ${color}`,
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: tk.textHi, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.product_name}</div>
                        <div style={{ fontSize: 11, color: tk.textLo, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {b.batch_code && <span style={{ fontFamily: "monospace" }}>Lote {b.batch_code}</span>}
                          {b.expiration_date && (
                            <span style={{ color }}>
                              Cad: {new Date(b.expiration_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" })}
                              {days !== null && (days < 0 ? ` · caducó hace ${-days}d` : ` · en ${days}d`)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: tk.textHi, fontVariantNumeric: "tabular-nums" }}>{b.quantity}</div>
                        <div style={{ fontSize: 10.5, color: tk.textLo }}>unid.</div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontSize: 11, color: tk.textLo, marginTop: 4, lineHeight: 1.5 }}>
                  {tr("sales_lots_hint",
                    "Se despachó por FEFO (primero los que caducan antes). Estas caducidades ya aparecen en la remisión / ticket / correo.")}
                </div>
              </div>
            </Section>
          )}

          {/* Payments */}
          {order.payments.length > 0 && (
            <Section tk={tk} title={tr("sales_payments", "Pagos")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {order.payments.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: tk.panel2, borderRadius: 8, padding: "8px 12px" }}>
                    <div><div style={{ fontSize: 13, color: tk.textHi, fontWeight: 600 }}>{money(p.amount)}</div><div style={{ fontSize: 11, color: tk.textLo }}>{paymentLabel(p.method)}{p.reference ? ` · ${p.reference}` : ""}</div></div>
                    <div style={{ fontSize: 11, color: tk.textLo }}>{dateTime(p.created_at)}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Estado CFDI + panel de Notas de Credito */}
          {!isQuote && (
            <Section tk={tk} title={tr("sales_detail_cfdi", "Facturación CFDI 4.0")}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: tk.textMid, flexWrap: "wrap" }}>
                {order.cfdi_uuid ? (
                  <>
                    <CheckCircle size={14} color={tk.good} />
                    <span>Factura timbrada</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: tk.textLo }}>
                      {order.cfdi_uuid}
                    </span>
                  </>
                ) : (
                  <>
                    <FileText size={14} color={tk.textLo} />
                    <span>Sin factura timbrada</span>
                  </>
                )}
              </div>
              {!order.cfdi_uuid && (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 10, background: tk.panel2, border: `1px solid ${tk.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: tk.textMid }}>
                      <div style={{ fontWeight: 700, color: tk.textHi, marginBottom: 2 }}>Datos fiscales</div>
                      {order.bill_rfc
                        ? <span>{order.bill_rfc} · {(order as any).bill_regime || "—"} · CP {(order as any).bill_zip || "—"}</span>
                        : <span style={{ color: tk.warn }}>Faltan datos fiscales — captúralos antes de timbrar.</span>}
                    </div>
                    <button onClick={() => setFiscalOpen(o => !o)}
                      style={{ background: "transparent", border: `1px solid ${tk.border}`, color: tk.textMid, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>
                      {fiscalOpen ? "Cerrar" : (order.bill_rfc ? "Editar" : "Capturar")}
                    </button>
                  </div>
                  {fiscalOpen && (
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Razón social</label>
                        <input value={fiscalForm.name} onChange={e => setFiscalForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Ej. Sanborns Hermanos S.A. de C.V."
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${tk.border}`, background: tk.panel, color: tk.textHi, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>RFC *</label>
                        <input value={fiscalForm.rfc} onChange={e => setFiscalForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                          maxLength={13} placeholder="AAA010101AAA"
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${tk.border}`, background: tk.panel, color: tk.textHi, fontFamily: "monospace", fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>CP</label>
                        <input value={fiscalForm.zip} onChange={e => setFiscalForm(f => ({ ...f, zip: e.target.value }))}
                          maxLength={5} placeholder="03100"
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${tk.border}`, background: tk.panel, color: tk.textHi, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Régimen fiscal</label>
                        <select value={fiscalForm.regime} onChange={e => setFiscalForm(f => ({ ...f, regime: e.target.value }))}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${tk.border}`, background: tk.panel, color: tk.textHi, fontSize: 12 }}>
                          <option value="601">601 · General Ley Personas Morales</option>
                          <option value="603">603 · Personas Morales con Fines no Lucrativos</option>
                          <option value="605">605 · Sueldos y Salarios</option>
                          <option value="606">606 · Arrendamiento</option>
                          <option value="612">612 · Personas Físicas Actividad Empresarial</option>
                          <option value="616">616 · Sin obligaciones fiscales</option>
                          <option value="621">621 · Incorporación Fiscal</option>
                          <option value="626">626 · RESICO</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>Uso CFDI</label>
                        <select value={fiscalForm.use} onChange={e => setFiscalForm(f => ({ ...f, use: e.target.value }))}
                          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${tk.border}`, background: tk.panel, color: tk.textHi, fontSize: 12 }}>
                          <option value="G01">G01 · Adquisición de mercancías</option>
                          <option value="G03">G03 · Gastos en general</option>
                          <option value="I01">I01 · Construcciones</option>
                          <option value="P01">P01 · Por definir</option>
                          <option value="D01">D01 · Honorarios médicos</option>
                          <option value="S01">S01 · Sin efectos fiscales</option>
                        </select>
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <input type="checkbox" checked={fiscalForm.save_to_customer}
                          onChange={e => setFiscalForm(f => ({ ...f, save_to_customer: e.target.checked }))} />
                        <label style={{ fontSize: 11, color: tk.textMid }}>
                          Guardar también en la ficha del cliente para futuras ventas
                        </label>
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <Button tk={tk} variant="primary" onClick={saveFiscal} disabled={fiscalSaving}>
                          {fiscalSaving ? "Guardando…" : "Guardar datos fiscales"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {order.cfdi_uuid && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Button tk={tk} variant="ghost" icon={<FileText size={14} />}
                    onClick={async () => {
                      try {
                        const blob = await salesApi.downloadOrderCFDIPDF(order.id);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = `CFDI_${order.folio || order.id}.pdf`;
                        document.body.appendChild(a); a.click(); a.remove();
                        URL.revokeObjectURL(url);
                      } catch (e: any) { setInvoiceMsg(errMsg(e, "No se pudo descargar el PDF")); }
                    }}>PDF de la factura</Button>
                  <Button tk={tk} variant="ghost" icon={<FileText size={14} />}
                    onClick={async () => {
                      try {
                        const blob = await salesApi.downloadOrderCFDIXML(order.id);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = `CFDI_${order.folio || order.id}.xml`;
                        document.body.appendChild(a); a.click(); a.remove();
                        URL.revokeObjectURL(url);
                      } catch (e: any) { setInvoiceMsg(errMsg(e, "No se pudo descargar el XML")); }
                    }}>XML timbrado</Button>
                </div>
              )}
              {invoiceMsg && (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6,
                  background: invoiceMsg.startsWith("✓") ? tk.good + "18" : tk.bad + "18",
                  color: invoiceMsg.startsWith("✓") ? tk.good : tk.bad, fontSize: 12 }}>
                  {invoiceMsg}
                </div>
              )}
              <CreditNotesPanel tk={tk} orderId={order.id}
                refreshKey={ncRefreshKey} onChanged={() => setNcRefreshKey(k => k + 1)} />
            </Section>
          )}

          {/* Audit timeline */}
          {order.events && order.events.length > 0 && (
            <Section tk={tk} title={tr("sales_detail_history", "Bitácora")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {order.events.map((ev) => {
                  const c = statusColors(tk, ev.to_status ?? "");
                  return (
                    <div key={ev.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ width: 8, height: 8, borderRadius: 999, background: c.text, flexShrink: 0, marginTop: 5 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: tk.textHi }}>{ev.message ?? ev.event_type}</div>
                        <div style={{ fontSize: 11, color: tk.textLo }}>{dateTime(ev.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>

        {/* Actions */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${tk.border}`, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {isQuote ? (
            !closed && (
              <>
                <Button tk={tk} variant="primary" icon={<ArrowRightLeft size={16} />} onClick={() => onConvert(order)}>{tr("sales_convert", "Convertir a pedido")}</Button>
                <Button tk={tk} variant="ghost" icon={<FileText size={16} />} onClick={async () => {
                  try {
                    const blob = await (await import("./api")).salesApi.downloadDocument(order.id, "quote");
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `cotizacion_${order.folio || order.id}.pdf`;
                    document.body.appendChild(a); a.click(); a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch (e: any) { alert(e?.response?.data?.detail || "Error al descargar PDF"); }
                }}>PDF cotización</Button>
                <Button tk={tk} variant="ghost" icon={<Mail size={16} />} onClick={() => emailTicket(order)}>{tr("sales_email_quote", "Enviar por correo")}</Button>
                {order.customer?.phone && (
                  <Button tk={tk} variant="ghost" icon={<MessageCircle size={16} />} onClick={() => openWhatsApp(order.customer!.phone!, whatsappTicketMessage(order))}>{tr("sales_whatsapp", "Enviar por WhatsApp")}</Button>
                )}
                <Button tk={tk} variant="ghost" icon={<Pencil size={16} />} onClick={() => onEdit(order)}>{tr("sales_edit", "Editar")}</Button>
                <Button tk={tk} variant="danger" icon={<XCircle size={16} />} onClick={() => onCancel(order)}>{tr("sales_btn_cancel_quote", "Cancelar cotización")}</Button>
              </>
            )
          ) : (
            <>
              {order.balance > 0 && order.status !== "cancelled" && (
                <Button tk={tk} variant="success" icon={<CreditCard size={16} />} onClick={() => onPay(order)}>{tr("sales_register_payment", "Registrar pago")}</Button>
              )}
              {order.balance > 0 && order.status !== "cancelled" && (
                <Button tk={tk} variant="ghost" icon={<CheckCircle size={16} />} onClick={() => onMarkPaid(order)}>{tr("sales_btn_mark_paid", "Marcar pagado")}</Button>
              )}
              {order.channel === "pos" ? (
                <>
                  <Button tk={tk} variant="ghost" icon={<Printer size={16} />} onClick={async () => {
                    try {
                      const { posApi } = await import("../pos/api");
                      const blob = await posApi.downloadTicket(order.id, 80);
                      const url = URL.createObjectURL(blob);
                      const w = window.open(url, "_blank");
                      if (w) setTimeout(() => w.print(), 500);
                    } catch { alert("Error al imprimir ticket POS"); }
                  }}>Ticket 80mm</Button>
                  <Button tk={tk} variant="ghost" icon={<Printer size={16} />} onClick={async () => {
                    try {
                      const { posApi } = await import("../pos/api");
                      const blob = await posApi.downloadTicket(order.id, 58);
                      const url = URL.createObjectURL(blob);
                      const w = window.open(url, "_blank");
                      if (w) setTimeout(() => w.print(), 500);
                    } catch { alert("Error al imprimir ticket POS"); }
                  }}>Ticket 58mm</Button>
                </>
              ) : (
                <Button tk={tk} variant="ghost" icon={<Printer size={16} />} onClick={() => printTicket(order)}>{tr("sales_print", "Imprimir ticket")}</Button>
              )}
              <Button tk={tk} variant="ghost" icon={<FileText size={16} />} onClick={async () => {
                try {
                  const blob = await (await import("./api")).salesApi.downloadDocument(order.id, "remission");
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `remision_${order.folio || order.id}.pdf`;
                  document.body.appendChild(a); a.click(); a.remove();
                  window.URL.revokeObjectURL(url);
                } catch (e: any) { alert(e?.response?.data?.detail || "Error al descargar PDF"); }
              }}>PDF remisión</Button>
              {order.customer?.phone && (
                <Button tk={tk} variant="ghost" icon={<MessageCircle size={16} />} onClick={() => openWhatsApp(order.customer!.phone!, whatsappTicketMessage(order))}>{tr("sales_whatsapp", "Enviar por WhatsApp")}</Button>
              )}
              <Button tk={tk} variant="ghost" icon={<Mail size={16} />} onClick={() => emailTicket(order)}>{tr("sales_email_ticket", "Enviar por correo")}</Button>
              <Button tk={tk} variant="ghost" icon={<FileText size={16} />} onClick={() => onInvoice(order)}>{tr("sales_invoice", "CFDI")}</Button>
              {!closed && order.status !== "paid" && <Button tk={tk} variant="ghost" icon={<Pencil size={16} />} onClick={() => onEdit(order)}>{tr("sales_edit", "Editar")}</Button>}
              {canStampInvoice && (
                <Button tk={tk} variant="primary" icon={<Stamp size={16} />}
                  onClick={stampInvoice}
                  disabled={stampingInvoice}>
                  {stampingInvoice ? "Timbrando…" : "Timbrar factura"}
                </Button>
              )}
              {canEmitCreditNote && (
                <Button tk={tk} variant="ghost" icon={<FileMinus size={16} />}
                  onClick={() => setCreditNoteOpen(true)}>
                  Emitir nota de crédito
                </Button>
              )}
              <div style={{ flex: 1 }} />
              {order.status !== "cancelled" && <Button tk={tk} variant="danger" icon={<XCircle size={16} />} onClick={() => onCancel(order)}>{tr("sales_btn_cancel", "Cancelar venta")}</Button>}
            </>
          )}
        </div>
      </div>
      {creditNoteOpen && (
        <CreditNoteModal tk={tk} order={order}
          onClose={() => setCreditNoteOpen(false)}
          onCreated={() => { setCreditNoteOpen(false); setNcRefreshKey(k => k + 1); }} />
      )}
    </>
  );
}
