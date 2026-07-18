import api from "../../services/api";

export interface DailyTrendPoint {
  date: string;
  total: number;
  count: number;
}

export interface SalesBlock {
  today: { total: number; count: number };
  week: { total: number; count: number };
  month: { total: number; count: number };
  prev_month: { total: number; count: number };
  delta_pct: number;
  cogs_month: number;
  gross_margin_month: number;
  margin_pct: number;
  paid_today: number;
  paid_month: number;
  daily_trend: DailyTrendPoint[];
}

export interface AgingBlock {
  total: number;
  overdue: number;
  overdue_pct: number;
  count: number;
}

export interface ExecutiveAlert {
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  page: string;
  query?: string | null;
  amount?: number | null;
  due_date?: string | null;
  id?: string | null;
}

export interface ExecutiveSummary {
  generated_at: string;
  sales: SalesBlock;
  receivables: AgingBlock;
  payables: AgingBlock;
  cash_available: number;
  alerts: {
    critical: number; warning: number; info: number; total: number;
    by_category: Record<string, number>;
    top: ExecutiveAlert[];
  };
  top_products: { name: string; quantity: number; total: number }[];
  top_customers: { name: string; total: number; orders: number }[];
  inventory: { out_of_stock: number; low_stock: number };
}

export interface AgingBucket { bucket: string; amount: number }

export interface AgingSummary {
  buckets: AgingBucket[];
  total: number;
  total_overdue: number;
  overdue_pct: number;
  top_debtors?: { name: string; balance: number }[];
  top_creditors?: { name: string; balance: number }[];
  count: number;
}

export interface OmnichannelChannel {
  channel: string;
  label: string;
  revenue: number;
  units: number;
  orders: number;
  share_pct: number;
}
export interface OmnichannelData {
  period_days: number;
  generated_at: string;
  direct: {
    total_revenue: number;
    total_units: number;
    total_orders: number;
    channels: OmnichannelChannel[];
  };
  indirect_retail: {
    sell_out_units: number;
    sell_out_revenue: number;
    stores_reporting: number;
  };
  inventory: {
    own_units: number;
    own_cost_value: number;
    consignment_units: number;
    consignment_cost_value: number;
    total_cost_value: number;
  };
}

export const biService = {
  executiveSummary: () =>
    api.get<ExecutiveSummary>("/bi/executive-summary").then(r => r.data),
  omnichannel: (days = 30) =>
    api.get<OmnichannelData>("/bi/omnichannel", { params: { days } }).then(r => r.data),
  cxcAging: () =>
    api.get<AgingSummary>("/finance/cxc/aging-summary").then(r => r.data),
  cxpAging: () =>
    api.get<AgingSummary>("/finance/cxp/aging-summary").then(r => r.data),
};
