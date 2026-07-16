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
  consignment_warehouse_id?: number | null;
  consignment_warehouse_name?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at?: string | null;
}

export interface ConsignmentWarehouseOption {
  id: number;
  name: string;
  location?: string | null;
  is_active: boolean;
}

export type ReconStatus = "match" | "over_at_warehouse" | "short_at_warehouse" | "no_data";

export interface ConsignmentReconRow {
  store_id: number;
  store_name: string;
  channel_name?: string | null;
  warehouse_id: number;
  warehouse_name: string;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  reported_on_hand: number;
  reported_at?: string | null;
  warehouse_stock: number;
  difference: number;
  status: ReconStatus;
}

export interface ConsignmentReconResponse {
  generated_at: string;
  channel_id?: number | null;
  total_rows: number;
  matched: number;
  with_diff: number;
  rows: ConsignmentReconRow[];
}

// Heatmap
export type HeatmapMetric = "wos" | "units_sold" | "on_hand";
export interface HeatmapCell {
  store_id: number;
  variant_id: number;
  value?: number | null;
  on_hand: number;
  units_sold: number;
  status: WosStatus;
}
export interface HeatmapStoreRef { id: number; name: string; channel_name?: string | null; }
export interface HeatmapVariantRef { id: number; sku?: string | null; product_name?: string | null; }
export interface HeatmapResponse {
  channel_id?: number | null;
  metric: HeatmapMetric;
  stores: HeatmapStoreRef[];
  variants: HeatmapVariantRef[];
  cells: HeatmapCell[];
  total_stores: number;
  total_variants: number;
  store_offset: number;
  store_limit: number;
}

export interface HeatmapFilters {
  regions: string[];
  states: string[];
  formats: string[];
}

export type HeatmapSortStores = "name" | "worst_wos" | "best_wos" | "most_sales";

// ABC
export type ABCClass = "A" | "B" | "C";
export interface ABCRow {
  rank: number;
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  stores_count: number;
  total_units: number;
  total_revenue: number;
  revenue_pct: number;
  cumulative_pct: number;
  abc_class: ABCClass;
}
export interface ABCResponse {
  channel_id?: number | null;
  total_revenue: number;
  class_a_count: number;
  class_b_count: number;
  class_c_count: number;
  rows: ABCRow[];
}

// Transfer
export interface SourceWarehouseOption { id: number; name: string; location?: string | null; type: string; }
export interface TransferItem { store_id: number; variant_id: number; units: number; notes?: string; }
export interface TransferItemResult {
  store_id: number;
  variant_id: number;
  units_requested: number;
  units_transferred: number;
  status: "transferred" | "insufficient_stock" | "no_consignment" | "error";
  message?: string | null;
  out_movement_id?: number | null;
  in_movement_id?: number | null;
}
export interface TransferResponse {
  source_warehouse_id: number;
  source_warehouse_name: string;
  transferred_lines: number;
  warnings: number;
  total_units: number;
  results: TransferItemResult[];
}

export interface RetailImportProfile {
  id: number;
  channel_id: number;
  channel_name?: string | null;
  name: string;
  notes?: string | null;
  is_active: boolean;
  is_default: boolean;
  file_format: "xlsx" | "csv";
  sheet_name?: string | null;
  header_row: number;
  encoding: string;
  delimiter: string;
  date_format: "auto" | "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY/MM/DD";
  decimal_separator: "." | ",";
  thousands_separator: "" | "," | ".";
  units_multiplier: number;
  revenue_multiplier: number;
  default_period_type: "day" | "week" | "month";
  column_map: Record<string, string>;
  ignore_row_pattern?: string | null;
  default_channel_code?: string | null;
  created_at?: string | null;
}

export interface RetailImportProfileCreate extends Omit<RetailImportProfile, "id" | "channel_name" | "created_at"> {}

export interface DetectColumnsResponse {
  detected_columns: string[];
  sheet_names: string[];
  active_sheet?: string | null;
  proposed_map: Record<string, string>;
  standard_fields: string[];
}

export interface PreviewRow {
  row_number: number;
  raw: Record<string, any>;
  normalized: Record<string, any>;
  errors: string[];
}

export interface PreviewResponse {
  total_rows: number;
  preview_rows: PreviewRow[];
  unmapped_required_fields: string[];
  warnings: string[];
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

export type AlertType =
  | "stockout" | "stockout_imminent" | "overstock" | "no_movement" | "sell_through_low";
export type AlertSeverity = "urgent" | "high" | "medium" | "low";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface RetailAlert {
  id: number;
  channel_id: number;
  channel_name?: string | null;
  store_id: number;
  store_name?: string | null;
  variant_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  alert_type: AlertType;
  severity: AlertSeverity;
  message: string;
  wos_snapshot?: number | null;
  on_hand_snapshot?: number | null;
  weekly_velocity_snapshot?: number | null;
  status: AlertStatus;
  acknowledged_at?: string | null;
  acknowledged_by_user_id?: number | null;
  resolved_at?: string | null;
  resolved_by_user_id?: number | null;
  resolution_notes?: string | null;
  created_at?: string | null;
}

export interface EvaluateAlertsResponse {
  created: number;
  auto_resolved: number;
  total_open: number;
  urgent_open: number;
}

export interface AlertsSummary {
  open: number;
  urgent: number;
  high: number;
  medium: number;
  low: number;
  acknowledged: number;
}
