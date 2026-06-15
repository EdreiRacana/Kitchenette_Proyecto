// Create / edit an order or quote, with a live item builder and totals preview.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import type { Tokens, Translator } from "./theme";
import { money, PAYMENT_METHODS, CHANNELS } from "./theme";
import type { Order, OrderDraft, OrderItemDraft, CustomerLite } from "./types";
import type { VariantOption } from "./api";
import { Modal, Field, TextInput, NumberInput, Select, Button, IconButton } from "./ui";

const CFDI_USES = [
  { value: "G01", label: "G01 · Adquisición de mercancías" },
  { value: "G03", label: "G03 · Gastos en general" },
  { value: "P01", label: "P01 · Por definir" },
  { value: "I08", label: "I08 · Otra maquinaria y equipo" },
];

function emptyItem(): OrderItemDraft {
  return { variant_id: null, product_name: "", sku: "", quantity: 1, unit_price: 0, discount_amount: 0, tax_rate: 16 };
}

function blankDraft(): OrderDraft {
  return {
    kind: "order", customer_id: null, payment_method: "transfer", channel: "mostrador",
    status: undefined, discount_type: "amount", discount_value: 0, tax_rate: 16,
    shipping_amount: 0, notes: "", due_date: "", valid_until: "",
    bill_rfc: "", bill_name: "", bill_use: "G03", bill_regime: "", bill_zip: "",
    items: [emptyItem()],
  };
}

function fromOrder(o: Order): OrderDraft {
  return {
    kind: o.kind, customer_id: o.customer_id, payment_method: o.payment_method ?? "",
    channel: o.channel ?? "", status: o.status, discount_type: o.discount_type,
    discount_value: o.discount_value, tax_rate: o.tax_rate, shipping_amount: o.shipping_amount,
    notes: o.notes ?? "", due_date: o.due_date?.slice(0, 10) ?? "", valid_until: o.valid_until?.slice(0, 10) ?? "",
    bill_rfc: o.bill_rfc ?? "", bill_name: o.bill_name ?? "", bill_use: o.bill_use ?? "G03",
    bill_regime: o.bill_regime ?? "", bill_zip: o.bill_zip ?? "",
    items: o.items.map((it) => ({
      variant_id: it.variant_id, product_name: it.product_name ?? "", sku: it.sku ?? "",
      quantity: it.quantity, unit_price: it.unit_price, discount_amount: it.discount_amount, tax_rate: it.tax_rate,
    })),
  };
}

function computeTotals(d: OrderDraft) {
  const subtotal = d.items.reduce((a, it) => a + Math.max(it.unit_price * it.quantity - it.discount_amount, 0), 0);
  const discount = d.discount_type === "percent"
    ? Math.min(subtotal * d.discount_value / 100, subtotal)
    : Math.min(d.discount_value, subtotal);
  const taxable = Math.max(subtotal - discount, 0);
  const tax = taxable * d.tax_rate / 100;
  const total = taxable + tax + d.shipping_amount;
  return { subtotal, discount, tax, total };
}

export function OrderForm({
  tk, tr, open, onClose, onSubmit, editing, customers, variants, saving,
}: {
  tk: Tokens; tr: Translator; open: boolean; onClose: () => void;
  onSubmit: (draft: OrderDraft) => void; editing: Order | null;
  customers: CustomerLite[]; variants: VariantOption[]; saving: boolean;
}) {
  const [draft, setDraft] = useState<OrderDraft>(blankDraft());
  const [showBilling, setShowBilling] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(editing ? fromOrder(editing) : blankDraft());
      setShowBilling(!!editing?.bill_rfc);
    }
  }, [open, editing]);

  const totals = useMemo(() => computeTotals(draft), [draft]);
  const set = (patch: Partial<OrderDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const setItem = (idx: number, patch: Partial<OrderItemDraft>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  const pickVariant = (idx: number, variantId: string) => {
    if (!variantId) { setItem(idx, { variant_id: null }); return; }
    const v = variants.find((x) => String(x.variant_id) === variantId);
    if (v) setItem(idx, { variant_id: v.variant_id, product_name: v.label, sku: v.sku, unit_price: v.price });
  };

  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }));
  const removeItem = (idx: number) =>
    setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, i) => i !== idx) : d.items }));

  const valid = draft.items.length > 0 && draft.items.every((it) => it.quantity > 0 && it.unit_price >= 0
    && (it.variant_id !== null || it.product_name.trim().length > 0));

  const isQuote = draft.kind === "quote";
  const title = editing
    ? `${tr("sales_edit", "Editar")} ${editing.folio ?? ""}`
    : isQuote ? tr("sales_new_quote", "Nueva cotización") : tr("sales_new_order", "Nuevo pedido");

  const variantOpts = variants.map((v) => ({ value: String(v.variant_id), label: `${v.label} — ${money(v.price)}` }));
  const customerOpts = customers.map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <Modal tk={tk} open={open} onClose={onClose} title={title} width={780}
      footer={
        <>
          <Button tk={tk} variant="ghost" onClick={onClose}>{tr("sales_close", "Cancelar")}</Button>
          <Button tk={tk} variant="primary" disabled={!valid || saving} onClick={() => onSubmit(draft)}>
            {saving ? tr("sales_saving", "Guardando…") : tr("sales_save", "Guardar")} · {money(totals.total)}
          </Button>
        </>
      }>
      {/* Doc type toggle (only on create) */}
      {!editing && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {(["order", "quote"] as const).map((k) => (
            <button key={k} onClick={() => set({ kind: k })} style={{
              flex: 1, padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
              border: `1px solid ${draft.kind === k ? tk.accent : tk.border}`,
              background: draft.kind === k ? tk.accent + "1A" : "transparent",
              color: draft.kind === k ? tk.accent : tk.textMid,
            }}>
              {k === "order" ? tr("sales_kind_order", "Pedido") : tr("sales_kind_quote", "Cotización")}
            </button>
          ))}
        </div>
      )}

      {/* Header grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <Field tk={tk} label={tr("sales_col_client", "Cliente")}>
          <Select tk={tk} value={draft.customer_id ? String(draft.customer_id) : ""}
            onChange={(v) => set({ customer_id: v ? Number(v) : null })}
            options={customerOpts} placeholder={tr("sales_no_customer", "Sin cliente / mostrador")} />
        </Field>
        <Field tk={tk} label={tr("sales_detail_payment", "Método de pago")}>
          <Select tk={tk} value={draft.payment_method} onChange={(v) => set({ payment_method: v })} options={PAYMENT_METHODS} placeholder="—" />
        </Field>
        <Field tk={tk} label={tr("sales_channel", "Canal")}>
          <Select tk={tk} value={draft.channel} onChange={(v) => set({ channel: v })} options={CHANNELS} placeholder="—" />
        </Field>
        {isQuote ? (
          <Field tk={tk} label={tr("sales_valid_until", "Vigencia")}>
            <TextInput tk={tk} type="date" value={draft.valid_until} onChange={(v) => set({ valid_until: v })} />
          </Field>
        ) : (
          <Field tk={tk} label={tr("sales_due_date", "Vence (crédito)")}>
            <TextInput tk={tk} type="date" value={draft.due_date} onChange={(v) => set({ due_date: v })} />
          </Field>
        )}
      </div>

      {/* Items */}
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.textHi, margin: "8px 0 10px" }}>
        {tr("sales_detail_products", "Productos")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {draft.items.map((it, idx) => {
          const lineSub = Math.max(it.unit_price * it.quantity - it.discount_amount, 0);
          return (
            <div key={idx} style={{ background: tk.panel2, border: `1px solid ${tk.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "2 1 220px" }}>
                  <Field tk={tk} label={tr("sales_product", "Producto")}>
                    <Select tk={tk} value={it.variant_id ? String(it.variant_id) : ""}
                      onChange={(v) => pickVariant(idx, v)} options={variantOpts}
                      placeholder={tr("sales_manual_product", "Manual / otro")} />
                  </Field>
                </div>
                {it.variant_id === null && (
                  <div style={{ flex: "2 1 180px" }}>
                    <Field tk={tk} label={tr("sales_product_name", "Nombre")}>
                      <TextInput tk={tk} value={it.product_name} onChange={(v) => setItem(idx, { product_name: v })} placeholder="Producto" />
                    </Field>
                  </div>
                )}
                <div style={{ flex: "0 1 70px" }}>
                  <Field tk={tk} label={tr("sales_detail_qty", "Cant.")}>
                    <NumberInput tk={tk} value={it.quantity} min={1} step={1} onChange={(v) => setItem(idx, { quantity: Math.max(1, Math.round(v)) })} />
                  </Field>
                </div>
                <div style={{ flex: "0 1 100px" }}>
                  <Field tk={tk} label={tr("sales_detail_unit_price", "Precio")}>
                    <NumberInput tk={tk} value={it.unit_price} onChange={(v) => setItem(idx, { unit_price: v })} />
                  </Field>
                </div>
                <div style={{ flex: "0 1 90px" }}>
                  <Field tk={tk} label={tr("sales_line_disc", "Desc. $")}>
                    <NumberInput tk={tk} value={it.discount_amount} onChange={(v) => setItem(idx, { discount_amount: v })} />
                  </Field>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: tk.textHi, minWidth: 80, textAlign: "right" }}>
                    {money(lineSub)}
                  </span>
                  <IconButton tk={tk} onClick={() => removeItem(idx)} title={tr("sales_remove", "Quitar")}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        <Button tk={tk} variant="subtle" icon={<Plus size={16} />} onClick={addItem}>
          {tr("sales_add_item", "Agregar producto")}
        </Button>
      </div>

      {/* Charges + totals */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field tk={tk} label={tr("sales_discount", "Descuento global")}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 110 }}>
                <Select tk={tk} value={draft.discount_type} onChange={(v) => set({ discount_type: v as "amount" | "percent" })}
                  options={[{ value: "amount", label: "$" }, { value: "percent", label: "%" }]} />
              </div>
              <NumberInput tk={tk} value={draft.discount_value} onChange={(v) => set({ discount_value: v })} />
            </div>
          </Field>
          <div style={{ display: "flex", gap: 12 }}>
            <Field tk={tk} label={tr("sales_tax", "IVA %")}>
              <NumberInput tk={tk} value={draft.tax_rate} onChange={(v) => set({ tax_rate: v })} />
            </Field>
            <Field tk={tk} label={tr("sales_shipping", "Envío")}>
              <NumberInput tk={tk} value={draft.shipping_amount} onChange={(v) => set({ shipping_amount: v })} />
            </Field>
          </div>
        </div>
        <div style={{ background: tk.panel2, borderRadius: 12, padding: 16, alignSelf: "start" }}>
          {[
            [tr("sales_detail_subtotal", "Subtotal"), money(totals.subtotal)],
            [tr("sales_discount", "Descuento"), "− " + money(totals.discount)],
            [`${tr("sales_tax", "IVA")} (${draft.tax_rate}%)`, money(totals.tax)],
            [tr("sales_shipping", "Envío"), money(draft.shipping_amount)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: tk.textMid, marginBottom: 8 }}>
              <span>{k}</span><span>{v}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 800, color: tk.textHi, borderTop: `1px solid ${tk.border}`, paddingTop: 10 }}>
            <span>Total</span><span>{money(totals.total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginTop: 16 }}>
        <Field tk={tk} label={tr("sales_detail_notes", "Notas")}>
          <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} rows={2}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${tk.border}`,
              background: tk.inputBg, color: tk.textHi, fontSize: 14, boxSizing: "border-box", outline: "none", resize: "vertical", fontFamily: "inherit" }} />
        </Field>
      </div>

      {/* Billing / CFDI */}
      <div style={{ marginTop: 16 }}>
        <Button tk={tk} variant="ghost" icon={<FileText size={16} />} onClick={() => setShowBilling((b) => !b)}>
          {showBilling ? tr("sales_hide_billing", "Ocultar facturación") : tr("sales_add_billing", "Datos de facturación (CFDI)")}
        </Button>
        {showBilling && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
            <Field tk={tk} label="RFC"><TextInput tk={tk} value={draft.bill_rfc} onChange={(v) => set({ bill_rfc: v.toUpperCase() })} placeholder="XAXX010101000" /></Field>
            <Field tk={tk} label={tr("sales_bill_name", "Razón social")}><TextInput tk={tk} value={draft.bill_name} onChange={(v) => set({ bill_name: v })} /></Field>
            <Field tk={tk} label={tr("sales_bill_use", "Uso CFDI")}><Select tk={tk} value={draft.bill_use} onChange={(v) => set({ bill_use: v })} options={CFDI_USES} /></Field>
            <Field tk={tk} label={tr("sales_bill_regime", "Régimen fiscal")}><TextInput tk={tk} value={draft.bill_regime} onChange={(v) => set({ bill_regime: v })} placeholder="601, 612, 626…" /></Field>
            <Field tk={tk} label={tr("sales_bill_zip", "C.P.")}><TextInput tk={tk} value={draft.bill_zip} onChange={(v) => set({ bill_zip: v })} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
