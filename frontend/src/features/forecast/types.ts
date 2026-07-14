// Types del módulo Forecast — reflejan los esquemas Pydantic del backend.

export type PlanStatus = "draft" | "active" | "closed";

export interface ForecastPlan {
  id: number;
  name: string;
  year: number;
  growth_pct: number;
  status: PlanStatus;
  notes?: string | null;
  owner_user_id?: number | null;
  created_at?: string | null;
}

export interface ForecastPlanCreate {
  name: string;
  year: number;
  growth_pct: number;
  status: PlanStatus;
  notes?: string | null;
  owner_user_id?: number | null;
}

export interface ForecastLine {
  id: number;
  plan_id: number;
  customer_id?: number | null;
  variant_id?: number | null;
  salesperson_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  customer_name?: string | null;
  salesperson_name?: string | null;
  unit_price: number;
  m1: number; m2: number; m3: number; m4: number; m5: number; m6: number;
  m7: number; m8: number; m9: number; m10: number; m11: number; m12: number;
  total_units: number;
  total_amount: number;
}

export interface ForecastLineDraft {
  customer_id?: number | null;
  variant_id?: number | null;
  salesperson_id?: number | null;
  product_name?: string | null;
  sku?: string | null;
  customer_name?: string | null;
  salesperson_name?: string | null;
  unit_price: number;
  m1: number; m2: number; m3: number; m4: number; m5: number; m6: number;
  m7: number; m8: number; m9: number; m10: number; m11: number; m12: number;
}

export interface RollupRow { key: string; label: string; units: number; amount: number; }
export interface RollupResponse {
  plan_id: number;
  by_customer: RollupRow[];
  by_product: RollupRow[];
  by_salesperson: RollupRow[];
  monthly_amount: number[];
  monthly_units: number[];
  total_units: number;
  total_amount: number;
}

export interface AttainmentMonth {
  month: number;
  goal_amount: number;
  real_amount: number;
  attainment_pct: number;
}
export interface AttainmentResponse {
  plan_id: number;
  year: number;
  months: AttainmentMonth[];
  goal_year: number;
  real_year: number;
  attainment_year_pct: number;
}

export type BaselineSource = "sell_in" | "sell_out" | "wos_target";

export interface BaselineRequest {
  plan_id: number;
  source_type?: BaselineSource;
  year_source?: number;
  growth_pct?: number;
  customer_id?: number;
  salesperson_id?: number;
  retail_channel_id?: number;
  wos_target_weeks?: number;
  replace?: boolean;
}

export interface BaselineResponse {
  plan_id: number;
  source_type: BaselineSource;
  year_source: number;
  growth_pct: number;
  wos_target_weeks?: number | null;
  retail_channel_id?: number | null;
  lines_created: number;
  lines_deleted: number;
  lines: ForecastLine[];
}

export interface GoalForRangeResponse {
  goal_amount: number;
  plan_id: number | null;
  plan_name: string | null;
  plan_year: number | null;
  months_covered: string[];
}

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResponse {
  plan_id: number;
  lines_created: number;
  lines_skipped: number;
  errors: ImportRowError[];
  lines: ForecastLine[];
}
