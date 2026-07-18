export interface RetailChannel {
  id: number;
  name: string;
  code?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  target_wos_weeks: number;
  critical_wos_weeks: number;
  overstock_wos_weeks: number;
  return_rate_max_pct?: number;
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
  return_rate_max_pct?: number;
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

// ABC-XYZ (segmentación de surtido)
export interface AbcXyzRow {
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  total_units: number;
  total_revenue: number;
  revenue_pct: number;
  cumulative_pct: number;
  avg_weekly_units: number;
  cv?: number | null;
  abc_class: "A" | "B" | "C";
  xyz_class: "X" | "Y" | "Z";
  combined_class: string;
  strategy: string;
}
export interface AbcXyzMatrixCell {
  combined: string;
  abc_class: "A" | "B" | "C";
  xyz_class: "X" | "Y" | "Z";
  count: number;
  units: number;
  revenue: number;
  revenue_pct: number;
}
export interface AbcXyzResponse {
  channel_id?: number | null;
  days: number;
  weeks: number;
  total_revenue: number;
  matrix: AbcXyzMatrixCell[];
  rows: AbcXyzRow[];
}

// Tendencia (time-series)
export interface TrendPoint {
  period_start: string;
  period_end?: string | null;
  label: string;
  units_sold: number;
  units_returned: number;
  net_units: number;
  revenue: number;
  returns_amount: number;
  net_revenue: number;
  on_hand: number;
  stores_reporting: number;
}
export interface TrendResponse {
  channel_id?: number | null;
  variant_id?: number | null;
  store_id?: number | null;
  period_type: "day" | "week" | "month";
  points: TrendPoint[];
  total_units: number;
  total_revenue: number;
  wow_units_pct?: number | null;
  wow_revenue_pct?: number | null;
}

// Distribución numérica (voids)
export type DistributionStatus = "excellent" | "good" | "low" | "critical";
export interface DistributionRow {
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  stores_selling: number;
  stores_stocking: number;
  total_stores: number;
  distribution_pct: number;
  void_stores: number;
  total_units: number;
  avg_units_per_store: number;
  status: DistributionStatus;
}
export interface DistributionResponse {
  channel_id?: number | null;
  total_stores: number;
  rows: DistributionRow[];
}

// Venta perdida por stockout
export interface LostSalesRow {
  store_id: number;
  store_name: string;
  channel_id?: number | null;
  channel_name?: string | null;
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  avg_weekly_units: number;
  weeks_out_of_stock: number;
  lost_units: number;
  unit_price: number;
  lost_revenue: number;
  severity: "urgent" | "high" | "medium";
}
export interface LostSalesResponse {
  channel_id?: number | null;
  generated_at: string;
  total_lost_units: number;
  total_lost_revenue: number;
  affected_combos: number;
  rows: LostSalesRow[];
}

// Rentabilidad (márgenes + GMROI)
export type ProfitGroupBy = "sku" | "category" | "store" | "channel";
export interface ProfitabilityRow {
  dimension_id?: number | null;
  dimension_label: string;
  sku?: string | null;
  product_name?: string | null;
  units_sold: number;
  revenue: number;
  cogs: number;
  gross_margin: number;
  margin_pct: number;
  inventory_cost: number;
  gmroi?: number | null;
  missing_cost: boolean;
}
export interface ProfitabilityResponse {
  channel_id?: number | null;
  group_by: ProfitGroupBy;
  days: number;
  total_units: number;
  total_revenue: number;
  total_cogs: number;
  total_gross_margin: number;
  total_margin_pct: number;
  total_inventory_cost: number;
  total_gmroi?: number | null;
  variants_without_cost: number;
  rows: ProfitabilityRow[];
}

// Exceso de inventario + rotación
export interface ExcessInventoryRow {
  store_id: number;
  store_name: string;
  channel_id?: number | null;
  channel_name?: string | null;
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  on_hand: number;
  avg_weekly_units: number;
  wos_weeks?: number | null;
  doh_days?: number | null;
  overstock_threshold_weeks: number;
  excess_units: number;
  unit_cost: number;
  excess_cost: number;
  is_dead_stock: boolean;
  severity: "urgent" | "high" | "medium";
}
export interface ExcessInventoryResponse {
  channel_id?: number | null;
  generated_at: string;
  total_inventory_units: number;
  total_inventory_cost: number;
  inventory_turnover?: number | null;
  days_of_inventory?: number | null;
  avg_doh_days?: number | null;
  total_excess_units: number;
  total_excess_cost: number;
  dead_stock_cost: number;
  affected_combos: number;
  rows: ExcessInventoryRow[];
}

// Antigüedad de inventario (aging)
export type AgingBucketKey = "0-30" | "31-60" | "61-90" | "90+" | "never";
export interface AgingRow {
  store_id: number;
  store_name: string;
  channel_id?: number | null;
  channel_name?: string | null;
  variant_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  on_hand: number;
  last_sale_date?: string | null;
  days_since_last_sale?: number | null;
  bucket: AgingBucketKey;
  unit_cost: number;
  stock_value: number;
  obsolescence_risk: boolean;
}
export interface AgingBucket {
  bucket: AgingBucketKey;
  label: string;
  units: number;
  value: number;
  pct_of_value: number;
}
export interface AgingResponse {
  channel_id?: number | null;
  generated_at: string;
  total_stock_units: number;
  total_stock_value: number;
  obsolete_value: number;
  obsolete_pct: number;
  buckets: AgingBucket[];
  rows: AgingRow[];
}

// Nivel de servicio / fill rate
export type ServiceGroupBy = "store" | "sku" | "channel";
export interface ServiceLevelRow {
  dimension_id?: number | null;
  dimension_label: string;
  sku?: string | null;
  product_name?: string | null;
  total_periods: number;
  in_stock_periods: number;
  in_stock_rate_pct: number;
  units_sold: number;
  estimated_lost_units: number;
  fill_rate_pct: number;
  status: "excellent" | "good" | "low" | "critical";
}
export interface ServiceLevelResponse {
  channel_id?: number | null;
  generated_at: string;
  weeks_back: number;
  group_by: ServiceGroupBy;
  overall_in_stock_rate_pct: number;
  overall_stockout_rate_pct: number;
  overall_fill_rate_pct: number;
  total_units_sold: number;
  total_estimated_lost: number;
  combos_evaluated: number;
  rows: ServiceLevelRow[];
}

// Notificación de alertas
export interface NotifyAlertsResponse {
  alerts_included: number;
  email_sent: boolean;
  email_error?: string | null;
  whatsapp_sent: boolean;
  whatsapp_error?: string | null;
  email_configured: boolean;
  whatsapp_configured: boolean;
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
  units_returned: number;
  units_on_hand: number;
  revenue: number;
  returns_amount: number;
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
  units_returned?: number;
  units_on_hand: number;
  revenue?: number;
  returns_amount?: number;
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
  total_returns_units?: number;
  total_returns_amount?: number;
  return_rate_pct?: number;
  net_units?: number;
  net_revenue?: number;
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
  | "stockout" | "stockout_imminent" | "overstock" | "no_movement"
  | "sell_through_low" | "high_return_rate";
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
