import api from "../../services/api";

export interface POSTerminal {
  id: number;
  name: string;
  code?: string;
  warehouse_id?: number;
  warehouse_name?: string;
  printer_ip?: string;
  default_price_list?: string;
  is_active: boolean;
  notes?: string;
  open_session_id?: number | null;
  open_cashier_name?: string | null;
}

export interface POSSession {
  id: number;
  terminal_id: number;
  terminal_name: string;
  cashier_id: number;
  cashier_name: string;
  status: "open" | "closed" | "reconciled";
  opened_at: string;
  closed_at?: string;
  opening_balance: number;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  total_sales_amount: number;
  total_sales_count: number;
  total_cash_in: number;
  total_cash_out: number;
  total_refunds: number;
  denominations_json?: Record<string, number>;
  opening_notes?: string;
  closing_notes?: string;
}

export interface POSProduct {
  variant_id: number;
  product_id: number;
  sku?: string;
  barcode?: string;
  product_name: string;
  variant_label?: string;
  unit_price: number;
  unit_cost: number;
}

export interface POSSaleItem {
  variant_id?: number;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
  is_service?: boolean;
}

export const posApi = {
  listTerminals: () => api.get<POSTerminal[]>("/pos/terminals").then(r => r.data),
  createTerminal: (data: Partial<POSTerminal>) => api.post<POSTerminal>("/pos/terminals", data).then(r => r.data),
  updateTerminal: (id: number, data: Partial<POSTerminal>) => api.patch<POSTerminal>(`/pos/terminals/${id}`, data).then(r => r.data),

  currentSession: () => api.get<POSSession | { session: null }>("/pos/session/current").then(r => r.data),
  previousSession: (opts?: { terminal_id?: number; scope?: "auto" | "me" | "terminal" | "any" }) =>
    api.get<PreviousSessionReport>("/pos/session/previous", { params: opts }).then(r => r.data),
  openSession: (data: { terminal_id: number; opening_balance: number; opening_notes?: string }) =>
    api.post<POSSession>("/pos/session/open", data).then(r => r.data),
  closeSession: (data: { session_id: number; denominations: Record<string, number>; closing_notes?: string }) =>
    api.post<POSSession>("/pos/session/close", data).then(r => r.data),
  getSession: (id: number) => api.get<POSSession>(`/pos/session/${id}`).then(r => r.data),
  sessionReport: (id: number) => api.get<any>(`/pos/session/${id}/report`).then(r => r.data),

  cashMovement: (data: { session_id: number; type: "cash_in" | "cash_out"; amount: number; notes?: string }) =>
    api.post<any>("/pos/session/cash-movement", data).then(r => r.data),

  registerSale: (data: {
    session_id: number;
    customer_id?: number;
    items: POSSaleItem[];
    payments: Record<string, number>;
    discount_amount?: number;
    tax_rate?: number;
    shipping_amount?: number;
    notes?: string;
  }) => api.post<any>("/pos/sale", data).then(r => r.data),

  searchProducts: (q: string, limit = 20) =>
    api.get<POSProduct[]>("/pos/products/search", { params: { q, limit } }).then(r => r.data),

  downloadTicket: (orderId: number, width: 58 | 80 = 80) =>
    api.get<Blob>(`/pos/sale/${orderId}/ticket.pdf`, { params: { width }, responseType: "blob" }).then(r => r.data),
  downloadSessionReport: (sessionId: number, kind: "Z" | "X" = "Z") =>
    api.get<Blob>(`/pos/session/${sessionId}/report.pdf`, { params: { kind }, responseType: "blob" }).then(r => r.data),
  sessionSales: (sessionId: number) =>
    api.get<SessionSale[]>(`/pos/session/${sessionId}/sales`).then(r => r.data),

  // Reconciliación post-cierre
  bankAccountsForPos: () =>
    api.get<PosBankAccount[]>("/pos/bank-accounts").then(r => r.data),
  reconcileMovement: (sessionId: number, data: {
    type: "bank_deposit" | "float_next_shift" | "adjustment";
    amount: number;
    notes?: string;
    bank_account_id?: number;
  }) => api.post<any>(`/pos/session/${sessionId}/reconcile`, data).then(r => r.data),
  updateSessionNotes: (sessionId: number, data: { closing_notes?: string; opening_notes?: string }) =>
    api.patch<PreviousSessionReport>(`/pos/session/${sessionId}/notes`, data).then(r => r.data),
  markReconciled: (sessionId: number) =>
    api.post<PreviousSessionReport>(`/pos/session/${sessionId}/mark-reconciled`).then(r => r.data),
};

export interface PosBankAccount {
  id: number;
  name: string;
  bank?: string | null;
  account_number?: string | null;
  currency: string;
  balance: number;
}

export interface SessionSale {
  order_id: number;
  folio: string | null;
  created_at: string | null;
  status: string;
  total_amount: number;
  paid_amount: number;
  change: number;
  items_count: number;
  customer_id: number | null;
  customer_name: string | null;
  payment_methods: string[];
  payments: { method: string; amount: number }[];
}

export type POSTransactionType =
  | "opening" | "closing" | "sale" | "refund" | "cash_in" | "cash_out"
  | "bank_deposit" | "float_next_shift" | "adjustment";

export interface POSTransactionRow {
  id: number;
  type: POSTransactionType;
  amount: number;
  payment_method?: string | null;
  order_id?: number | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface PreviousSessionReport extends POSSession {
  sales_by_method: Record<string, number>;
  transactions: POSTransactionRow[];
  total_deposited: number;
  total_float_next: number;
  total_adjustments: number;
  cash_remaining_after: number;
}

// Denominaciones para arqueo
export const DENOMINATIONS: number[] = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];
