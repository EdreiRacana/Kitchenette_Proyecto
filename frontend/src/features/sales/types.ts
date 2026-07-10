// Domain types for the Sales / CRM module. Mirror the backend Pydantic schemas.

export type OrderKind = "order" | "quote";

export type OrderStatus =
  | "draft" | "pending" | "partial" | "paid" | "cancelled"
  | "sent" | "accepted" | "rejected" | "expired" | "converted";

export interface OrderItem {
  id?: number;
  order_id?: number;
  variant_id: number | null;
  product_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  subtotal?: number;
  total?: number;
}

export interface Payment {
  id: number;
  order_id: number;
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  created_at: string;
}

export interface OrderEvent {
  id: number;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  message: string | null;
  created_at: string;
}

export interface CustomerLite {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface SellerLite {
  id: number;
  full_name?: string | null;
  email?: string | null;
}

export interface Order {
  id: number;
  folio: string | null;
  kind: OrderKind;
  customer_id: number | null;
  user_id: number | null;
  warehouse_id: number | null;
  status: OrderStatus;
  payment_method: string | null;
  channel: string | null;
  currency: string;
  subtotal: number;
  discount_type: "amount" | "percent";
  discount_value: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  shipping_amount: number;
  total_amount: number;
  paid_amount: number;
  balance: number;
  due_date: string | null;
  valid_until: string | null;
  notes: string | null;
  bill_rfc: string | null;
  bill_name: string | null;
  bill_use: string | null;
  bill_regime: string | null;
  bill_zip: string | null;
  cfdi_uuid: string | null;
  cfdi_status: string | null;
  invoiced_at: string | null;
  created_at: string;
  updated_at: string | null;
  items: OrderItem[];
  payments: Payment[];
  events?: OrderEvent[];
  customer: CustomerLite | null;
  seller: SellerLite | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

export interface SalesStats {
  total_sold: number;
  orders_count: number;
  pending_orders: number;
  pending_amount: number;
  paid_rate: number;
  avg_ticket: number;
  quotes_count: number;
}

export interface TrendPoint { period: string; total: number; count: number; returns_total: number; goal: number | null; }
export interface TopCustomer { customer_id: number | null; name: string; total: number; orders: number; }
export interface AverageReturns { customer_id: number | null; average_amount: number; count: number; total_returns: number; total_sales: number; return_rate_pct: number; }
export interface CustomerForecast {
  customer_id: number | null;
  customer_name: string;
  history_months: string[];
  history_totals: number[];
  avg_monthly: number;
  forecast_next_month: number;
  trend_pct: number | null;
  goal_month: string | null;
  goal_amount: number | null;
  goal_share_pct: number | null;
  goal_allocated: number | null;
  variance_vs_goal: number | null;
}
export interface TopProduct { variant_id: number | null; name: string; quantity: number; total: number; }
export interface SalesBySeller { user_id: number | null; name: string; total: number; orders: number; }
export interface SalesByChannel { channel: string; total: number; orders: number; }
export interface HeatmapCell { dow: number; hour: number; orders: number; total: number; }

export interface CustomerPnLBreakdown {
  gross_sales: number; returns: number; allowances: number; discounts: number;
  net_sales: number; cogs: number; gross_margin: number; shipping_costs: number;
  withholdings: number; net_contribution: number; orders_count: number;
}
export interface CustomerTransaction {
  id: string; type: "venta" | "devolucion" | "nota_credito" | "pago";
  date: string; ref: string; amount: number; status: string;
}
export interface CustomerReturnLine {
  id: string; date: string; ref: string; product: string; qty: number; amount: number; reason?: string | null;
}
export interface CustomerPnLReport {
  customer: CustomerLite;
  period_start: string; period_end: string;
  current: CustomerPnLBreakdown; previous: CustomerPnLBreakdown;
  transactions: CustomerTransaction[]; returns: CustomerReturnLine[];
}

export interface CustomerReturnItem {
  id: number;
  return_id: number;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  condition: "sellable" | "damaged";
  subtotal: number;
}
export interface CustomerReturn {
  id: number;
  folio?: string | null;
  order_id?: number | null;
  customer_id?: number | null;
  warehouse_id?: number | null;
  user_id?: number | null;
  status: "completed" | "cancelled";
  reason?: string | null;
  settlement_type: "refund" | "store_credit" | "none";
  refund_amount: number;
  notes?: string | null;
  created_at: string;
  completed_at?: string | null;
  items: CustomerReturnItem[];
  customer_name?: string | null;
  order_folio?: string | null;
}

export interface OrderFilters {
  q?: string;
  kind?: OrderKind;
  status?: string;
  customer_id?: number;
  seller_id?: number;
  payment_method?: string;
  channel?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  skip?: number;
  limit?: number;
}

export interface OrderItemDraft {
  variant_id: number | null;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
}

export interface OrderDraft {
  kind: OrderKind;
  customer_id: number | null;
  seller_user_id: number | null;
  payment_method: string;
  channel: string;
  status?: string;
  discount_type: "amount" | "percent";
  discount_value: number;
  tax_rate: number;
  shipping_amount: number;
  notes: string;
  due_date: string;
  valid_until: string;
  bill_rfc: string;
  bill_name: string;
  bill_use: string;
  bill_regime: string;
  bill_zip: string;
  items: OrderItemDraft[];
}
