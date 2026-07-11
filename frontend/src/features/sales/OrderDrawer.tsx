// Slide-over detail panel for an order/quote: info, items, payments, audit log,
// and all lifecycle actions + printable ticket.

import { useEffect } from "react";
import {
  X, CreditCard, CheckCircle, XCircle, Pencil, ArrowRightLeft, Printer, FileText, MessageCircle,
} from "lucide-react";
import type { Tokens, Translator } from "./theme";
import { money, dateTime, paymentLabel, statusColors, statusMeta } from "./theme";
import type { Order } from "./types";
import { Badge, Button, IconButton } from "./ui";
import configService from "../config/service";
import { openWhatsApp } from "../../utils/whatsapp";

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
  const logoHtml = company.logo_url
    ? `<img src="${company.logo_url}" alt="logo" style="max-height:48px;max-width:160px;object-fit:contain;margin-bottom:6px" />`
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

  if (!order) return null;
  const sc = statusColors(tk, order.status);
  const isQuote = order.kind === "quote";
  const closed = order.status === "cancelled" || order.status === "converted";
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, color: tk.textMid };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,8,22,0.6)", zIndex: 50 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, height: "100%", width: 460, maxWidth: "96vw",
        background: tk.panel, borderLeft: `1px solid ${tk.border}`, zIndex: 55,
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
                  {order.items.map((it, i) => (
                    <tr key={i}>
                      <td style={td}><span style={{ color: tk.textHi }}>{it.product_name}</span>{it.sku && <span style={{ color: tk.textLo, fontSize: 11 }}> · {it.sku}</span>}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.quantity}</td>
                      <td style={{ ...td, textAlign: "right" }}>{money(it.unit_price)}</td>
                      <td style={{ ...td, textAlign: "right", color: tk.textHi, fontWeight: 600 }}>{money(it.subtotal ?? it.unit_price * it.quantity)}</td>
                    </tr>
                  ))}
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
              <Button tk={tk} variant="ghost" icon={<FileText size={16} />} onClick={() => onInvoice(order)}>{tr("sales_invoice", "CFDI")}</Button>
              {!closed && order.status !== "paid" && <Button tk={tk} variant="ghost" icon={<Pencil size={16} />} onClick={() => onEdit(order)}>{tr("sales_edit", "Editar")}</Button>}
              <div style={{ flex: 1 }} />
              {order.status !== "cancelled" && <Button tk={tk} variant="danger" icon={<XCircle size={16} />} onClick={() => onCancel(order)}>{tr("sales_btn_cancel", "Cancelar venta")}</Button>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
