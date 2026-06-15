// Built-in demo dataset so the module renders even with no backend reachable.

import type { Order, CustomerLite } from "./types";
import type { VariantOption } from "./api";

export const DEMO_CUSTOMERS: CustomerLite[] = [
  { id: 1, name: "Restaurante El Fogón" },
  { id: 2, name: "Taquería Los Compadres" },
  { id: 3, name: "Hotel Gran Plaza" },
  { id: 4, name: "Catering Eventos MX" },
];

export const DEMO_VARIANTS: VariantOption[] = [
  { variant_id: 1, label: "Pollo entero", sku: "POLLO-001", price: 220 },
  { variant_id: 2, label: "Costilla de res", sku: "COST-001", price: 380 },
  { variant_id: 3, label: "Chorizo artesanal", sku: "CHOR-001", price: 150 },
  { variant_id: 4, label: "Filete de res", sku: "FILE-001", price: 350 },
  { variant_id: 5, label: "Camarón mediano", sku: "CAMA-001", price: 430 },
];

function mk(
  id: number, folio: string, kind: Order["kind"], customer: string | null, status: Order["status"],
  total: number, paid: number, method: string, daysAgo: number,
  items: { name: string; qty: number; price: number }[],
): Order {
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const subtotal = items.reduce((a, it) => a + it.qty * it.price, 0);
  return {
    id, folio, kind, customer_id: customer ? id : null, user_id: 1, warehouse_id: 1,
    status, payment_method: method, channel: "mostrador", currency: "MXN",
    subtotal, discount_type: "amount", discount_value: 0, discount_amount: 0,
    tax_rate: 16, tax_amount: Math.round(subtotal * 0.16 * 100) / 100, shipping_amount: 0,
    total_amount: total, paid_amount: paid, balance: Math.round((total - paid) * 100) / 100,
    due_date: null, valid_until: null, notes: null,
    bill_rfc: null, bill_name: null, bill_use: null, bill_regime: null, bill_zip: null,
    cfdi_uuid: null, cfdi_status: "none", invoiced_at: null,
    created_at: created, updated_at: null,
    items: items.map((it, i) => ({
      id: i, variant_id: i + 1, product_name: it.name, sku: null, quantity: it.qty,
      unit_price: it.price, discount_amount: 0, tax_rate: 16,
      subtotal: it.qty * it.price, total: it.qty * it.price * 1.16,
    })),
    payments: paid > 0 ? [{ id, order_id: id, amount: paid, method, reference: null, note: null, created_at: created }] : [],
    events: [{ id, event_type: "created", from_status: null, to_status: status, message: "Pedido creado", created_at: created }],
    customer: customer ? { id, name: customer } : null,
    seller: { id: 1, full_name: "Vendedor Demo" },
  };
}

export const DEMO_ORDERS: Order[] = [
  mk(1, "ORD-000001", "order", "Restaurante El Fogón", "paid", 5220, 5220, "transfer", 1,
    [{ name: "Pollo entero", qty: 10, price: 220 }, { name: "Costilla de res", qty: 5, price: 380 }]),
  mk(2, "ORD-000002", "order", "Taquería Los Compadres", "pending", 2668, 0, "cash", 2,
    [{ name: "Chorizo artesanal", qty: 6, price: 150 }, { name: "Filete de res", qty: 3, price: 350 }]),
  mk(3, "ORD-000003", "order", "Hotel Gran Plaza", "partial", 10150, 5000, "credit", 3,
    [{ name: "Filete de res", qty: 15, price: 350 }, { name: "Camarón mediano", qty: 8, price: 430 }]),
  mk(4, "ORD-000004", "order", "Catering Eventos MX", "draft", 3712, 0, "card", 0,
    [{ name: "Costilla de res", qty: 8, price: 380 }]),
  mk(5, "COT-000001", "quote", "Hotel Gran Plaza", "sent", 6960, 0, "transfer", 4,
    [{ name: "Camarón mediano", qty: 14, price: 430 }]),
];
