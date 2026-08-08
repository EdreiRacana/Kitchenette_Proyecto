export interface ExecKPI {
  key: string;
  label: string;
  value: number;
  display: string;
  sub?: string | null;
  delta_pct?: number | null;
  color_hint?: "good" | "warn" | "bad" | "neutral" | null;
}

export interface MetaVsRealPoint {
  period: string;
  goal: number;
  real: number;
  achieved_pct: number;
  basis?: "forecast" | "previous_period" | "none";
}

export interface TrendPoint {
  period: string;
  label: string;
  revenue: number;
  prev_revenue: number;
  expenses: number;
}

export interface TopCustomerRow {
  customer_id?: number | null;
  name: string;
  total: number;
  orders: number;
  delta_pct?: number | null;
}

export interface GeoStateRow {
  state_code: string;
  state_name: string;
  revenue: number;
  units: number;
  share_pct: number;
  orders_count: number;
}

export interface GeoResponse {
  total_revenue: number;
  total_units: number;
  by_state: GeoStateRow[];
  top5: GeoStateRow[];
}

export interface ChannelSalesRow {
  channel: string;
  label: string;
  revenue: number;
  orders: number;
  share_pct: number;
}

export interface ChannelSalesResponse {
  total_revenue: number;
  channels: ChannelSalesRow[];
}

export interface AlertRow {
  severity: string;
  label: string;
  module: string;
  title: string;
  subtitle?: string | null;
  reference?: string | null;
  created_at?: string | null;
}

export interface OperationalKPIRow {
  key: string;
  label: string;
  value_pct: number;
  color_hint: "good" | "warn" | "bad";
  hint?: string | null;
}

export interface FinancialKPIRow {
  key: string;
  label: string;
  display: string;
  value?: number | null;
  status: "good" | "warn" | "bad" | "pending";
  subtitle?: string | null;
  available: boolean;
}

export interface ExecutiveDashboardResponse {
  generated_at: string;
  period_start: string;
  period_end: string;
  prev_period_start: string;
  prev_period_end: string;
  kpis: ExecKPI[];
  meta_vs_real: MetaVsRealPoint;
  trend_sales: TrendPoint[];
  trend_income_expenses: TrendPoint[];
  top_customers: TopCustomerRow[];
  geographic: GeoResponse;
  operational_kpis: OperationalKPIRow[];
  channel_sales: ChannelSalesResponse;
  alerts: AlertRow[];
  financial_kpis: FinancialKPIRow[];
}
