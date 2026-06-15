// Register a (partial) payment against an order's balance.

import { useEffect, useState } from "react";
import type { Tokens, Translator } from "./theme";
import { money, PAYMENT_METHODS } from "./theme";
import type { Order } from "./types";
import { Modal, Field, NumberInput, TextInput, Select, Button } from "./ui";

export function PaymentModal({
  tk, tr, open, onClose, order, onSubmit, saving,
}: {
  tk: Tokens; tr: Translator; open: boolean; onClose: () => void;
  order: Order | null; saving: boolean;
  onSubmit: (amount: number, method: string, reference: string, note: string) => void;
}) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && order) {
      setAmount(order.balance);
      setMethod(order.payment_method ?? "transfer");
      setReference(""); setNote("");
    }
  }, [open, order]);

  if (!order) return null;
  const overpay = amount > order.balance + 0.001;
  const valid = amount > 0 && !overpay;

  return (
    <Modal tk={tk} open={open} onClose={onClose} width={460}
      title={`${tr("sales_register_payment", "Registrar pago")} · ${order.folio ?? ""}`}
      footer={
        <>
          <Button tk={tk} variant="ghost" onClick={onClose}>{tr("sales_close", "Cancelar")}</Button>
          <Button tk={tk} variant="success" disabled={!valid || saving}
            onClick={() => onSubmit(amount, method, reference, note)}>
            {saving ? tr("sales_saving", "Guardando…") : tr("sales_confirm_payment", "Confirmar pago")}
          </Button>
        </>
      }>
      <div style={{ display: "flex", justifyContent: "space-between", background: tk.panel2, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>{tr("sales_total", "Total")}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: tk.textHi }}>{money(order.total_amount)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: tk.textLo, textTransform: "uppercase", letterSpacing: 0.5 }}>{tr("sales_balance", "Saldo")}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: tk.warn }}>{money(order.balance)}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field tk={tk} label={tr("sales_amount", "Monto")} hint={overpay ? tr("sales_overpay", "El monto excede el saldo") : undefined}>
          <NumberInput tk={tk} value={amount} onChange={setAmount} />
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          {[0.5, 1].map((f) => (
            <Button key={f} tk={tk} variant="subtle" onClick={() => setAmount(Math.round(order.balance * f * 100) / 100)}>
              {f === 1 ? tr("sales_full", "Saldo completo") : "50%"}
            </Button>
          ))}
        </div>
        <Field tk={tk} label={tr("sales_detail_payment", "Método")}>
          <Select tk={tk} value={method} onChange={setMethod} options={PAYMENT_METHODS} />
        </Field>
        <Field tk={tk} label={tr("sales_reference", "Referencia")}>
          <TextInput tk={tk} value={reference} onChange={setReference} placeholder={tr("sales_reference_ph", "Folio bancario, autorización…")} />
        </Field>
        <Field tk={tk} label={tr("sales_note", "Nota")}>
          <TextInput tk={tk} value={note} onChange={setNote} />
        </Field>
      </div>
    </Modal>
  );
}
