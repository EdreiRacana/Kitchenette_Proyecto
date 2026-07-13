export interface RetailChannel {
  id: number;
  name: string;
  code?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  target_wos_weeks: number;
  critical_wos_weeks: number;
  overstock_wos_weeks: number;
  is_active: boolean;
  notes?: string | null;
  stores_count: number;
  created_at?: string | null;
}

export interface RetailChannelCreate {
  name: string;
  code?: string | null;
  customer_id?: number | null;
  target_wos_weeks?: number;
  critical_wos_weeks?: number;
  overstock_wos_weeks?: number;
  is_active?: boolean;
  notes?: string | null;
}

export interface RetailStore {
  id: number;
  channel_id: number;
  channel_name?: string | null;
  name: string;
  code?: string | null;
  external_code?: string | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  store_format?: string | null;
  address?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at?: string | null;
}

export interface RetailStoreCreate extends Omit<RetailStore, "id" | "channel_name" | "created_at"> {}

export interface SellOutReport {
  id: number;
  store_id: number;
  store_name?: string | null;
  channel_id?: number | null;
  channel_name?: string | null;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  period_start: string;
  period_end: string;
  period_type: "day" | "week" | "month";
  units_sold: number;
  units_on_hand: number;
  revenue: number;
  source: string;
  notes?: string | null;
  created_at?: string | null;
}

export interface SellOutReportCreate {
  store_id: number;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  period_start: string;
  period_end: string;
  period_type?: "day" | "week" | "month";
  units_sold: number;
  units_on_hand: number;
  revenue?: number;
  notes?: string | null;
  source?: "manual" | "csv" | "excel" | "edi" | "api";
}

export interface RetailKPIs {
  channel_id?: number | null;
  channel_name?: string | null;
  period_start: string;
  period_end: string;
  total_sell_out_units: number;
  total_sell_out_revenue: number;
  total_sell_in_units: number;
  total_sell_in_revenue: number;
  sell_through_pct: number;
  total_on_hand: number;
  avg_wos_weeks: number;
  critical_stores_count: number;
  overstock_stores_count: number;
  stores_active_count: number;
  skus_active_count: number;
}

export type WosStatus = "critical" | "replenish" | "healthy" | "overstock" | "no_data";

export interface StoreVelocityRow {
  store_id: number;
  store_name: string;
  channel_name?: string | null;
  total_units_sold: number;
  avg_weekly_units: number;
  total_on_hand: number;
  wos_weeks: number;
  status: WosStatus;
}

export interface SKUVelocityRow {
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  stores_count: number;
  total_units_sold: number;
  avg_weekly_units: number;
  total_on_hand: number;
  wos_weeks: number;
  status: WosStatus;
}

export interface ReplenishmentSuggestion {
  store_id: number;
  store_name: string;
  channel_id: number;
  channel_name: string;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  current_on_hand: number;
  avg_weekly_units: number;
  wos_weeks: number;
  suggested_units: number;
  priority: "urgent" | "high" | "normal";
  reason: string;
}

export interface ReplenishmentResponse {
  channel_id?: number | null;
  generated_at: string;
  target_wos_weeks: number;
  critical_wos_weeks: number;
  suggestions: ReplenishmentSuggestion[];
  urgent_count: number;
  high_count: number;
  normal_count: number;
}

export interface ImportRowError {
  row: number;
  reason: string;
  raw?: Record<string, any> | null;
}

export interface ImportSellOutResponse {
  total_rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
}
