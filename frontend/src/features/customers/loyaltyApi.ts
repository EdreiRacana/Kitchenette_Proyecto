import api from '../../services/api';

export interface LoyaltyTier {
  id: number;
  name: string;
  color_hex?: string | null;
  rank: number;
  discount_pct: number;
  min_spend: number;
  min_orders: number;
  min_avg_ticket: number;
  perks?: string | null;
  is_active: boolean;
}

export interface LoyaltyProgramConfig {
  id: number;
  is_enabled: boolean;
  program_name: string;
  tagline?: string | null;
  tier_lookback_months?: number | null;
  card_validity_days: number;
  recalc_on_each_sale: boolean;
  card_bg_color: string;
  card_text_color: string;
  card_accent_color: string;
  privacy_policy_url?: string | null;
  privacy_policy_text?: string | null;
  birthday_email_enabled: boolean;
  birthday_email_subject: string;
  birthday_email_body?: string | null;
}

export interface LoyaltyCustomerLite {
  id: number;
  client_number?: string | null;
  loyalty_code?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  accepts_marketing: boolean;
  total_spent_lifetime: number;
  total_orders_lifetime: number;
  last_order_at?: string | null;
  tier?: {
    id: number; name: string; color_hex?: string | null;
    discount_pct: number; perks?: string | null;
  } | null;
  loyalty_expires_at?: string | null;
}

export interface LoyaltyHistoryItem {
  id: number;
  folio?: string | null;
  kind?: "sale" | "return";
  created_at?: string | null;
  total_amount: number;
  status: string;
  settlement_type?: string;
  reason?: string | null;
  items: {
    variant_id?: number | null;
    product_name?: string | null;
    sku?: string | null;
    quantity: number;
    unit_price: number;
  }[];
}

export interface LoyaltyRecommendation {
  variant_id: number;
  product_name: string;
  sku: string;
  price: number;
  category?: string | null;
}

export interface QuickRegisterPayload {
  name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string | null;
  sex?: string;
  codigo_postal?: string;
  how_heard?: string;
  rfc?: string;
  accepts_marketing: boolean;
  privacy_accepted: boolean;
  pos_terminal_name?: string;
}

export const loyaltyApi = {
  // Program config
  getProgram: async () => (await api.get<LoyaltyProgramConfig>('/loyalty/program')).data,
  updateProgram: async (data: Partial<LoyaltyProgramConfig>) =>
    (await api.put<LoyaltyProgramConfig>('/loyalty/program', data)).data,

  // Tiers CRUD
  listTiers: async (onlyActive = false) =>
    (await api.get<LoyaltyTier[]>('/loyalty/tiers', { params: { only_active: onlyActive } })).data,
  createTier: async (data: Omit<LoyaltyTier, 'id'>) =>
    (await api.post<LoyaltyTier>('/loyalty/tiers', data)).data,
  updateTier: async (id: number, data: Partial<LoyaltyTier>) =>
    (await api.put<LoyaltyTier>(`/loyalty/tiers/${id}`, data)).data,
  deleteTier: async (id: number) =>
    (await api.delete(`/loyalty/tiers/${id}`)).data,

  // POS-side operations
  lookup: async (q: string) =>
    (await api.get<LoyaltyCustomerLite>('/loyalty/lookup', { params: { q } })).data,
  // Autocomplete de identificación: match parcial en nombre/tel/correo/etc.
  search: async (q: string, limit = 8) =>
    (await api.get<LoyaltyCustomerLite[]>('/loyalty/search', { params: { q, limit } })).data,
  history: async (customerId: number, limit = 20) =>
    (await api.get<LoyaltyHistoryItem[]>(`/loyalty/customers/${customerId}/history`, { params: { limit } })).data,
  recommendations: async (customerId: number, limit = 5) =>
    (await api.get<LoyaltyRecommendation[]>(`/loyalty/customers/${customerId}/recommendations`, { params: { limit } })).data,
  recomputeTier: async (customerId: number) =>
    (await api.post(`/loyalty/customers/${customerId}/recompute-tier`)).data,
  loyaltyCardUrl: (customerId: number) =>
    `/loyalty/customers/${customerId}/loyalty-card.pdf`,
  downloadLoyaltyCard: async (customerId: number): Promise<Blob> => {
    const resp = await api.post(`/loyalty/customers/${customerId}/loyalty-card.pdf`,
      undefined, { responseType: 'blob' });
    return resp.data as Blob;
  },
  quickRegister: async (data: QuickRegisterPayload) =>
    (await api.post<LoyaltyCustomerLite>('/loyalty/quick-register', data)).data,

  // Jobs
  jobRecomputeAllTiers: async () =>
    (await api.post('/loyalty/jobs/recompute-all-tiers')).data,
  jobBirthdayEmails: async () =>
    (await api.post('/loyalty/jobs/birthday-emails')).data,

  // Override manual de tier
  setTier: async (customerId: number, tierId: number | null, manual = true) =>
    (await api.put<LoyaltyCustomerLite>(`/loyalty/customers/${customerId}/tier`,
      { tier_id: tierId, manual })).data,

  // Enviar tarjeta por correo
  emailLoyaltyCard: async (customerId: number, message?: string) =>
    (await api.post(`/loyalty/customers/${customerId}/loyalty-card/email`,
      { message: message || null })).data,

  // Campañas y segmentación
  previewSegment: async (filters: SegmentFilters) =>
    (await api.post<{ count: number; sample: { id: number; name: string; email: string | null; tier_id: number | null }[] }>(
      '/loyalty/segments/preview', filters)).data,
  sendCampaign: async (payload: CampaignPayload) =>
    (await api.post<{ targeted: number; sent: number; failed: number; skipped_no_email: number }>(
      '/loyalty/campaigns/send', payload)).data,

  // Stats
  stats: async () =>
    (await api.get<ProgramStats>('/loyalty/stats')).data,
};

export interface SegmentFilters {
  tier_ids?: number[] | null;
  only_opt_in?: boolean;
  birthday_month?: number | null;
  min_last_order_days_ago?: number | null;
}
export interface CampaignPayload {
  subject: string;
  body_html: string;
  discount_code?: string | null;
  segment: SegmentFilters;
}
export interface ProgramStats {
  total_active_customers: number;
  enrolled_in_program: number;
  opt_in_marketing: number;
  with_birthday: number;
  birthdays_next_30_days: number;
  by_tier: { tier_id: number; name: string; color_hex: string | null; count: number }[];
}
