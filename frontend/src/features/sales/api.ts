// Sales / CRM API service. Thin typed wrapper over the shared axios instance.

import api from "../../services/api";
import type {
  Order, Paginated, SalesStats, TrendPoint, TopCustomer, TopProduct,
  SalesBySeller, SalesByChannel, OrderFilters, OrderDraft, CustomerLite, AverageReturns, CustomerForecast,
  CustomerPnLReport, CustomerReturn, SellerLite, PipelineStatsResponse,
} from "./types";

export interface VariantOption {
  variant_id: number;
  label: string;
  sku: string;
  barcode?: string | null;
  price: number;
}

export interface SettlementOrderLine {
  order_id: number;
  folio: string | null;
  external_order_id: string | null;
  created_at: string | null;
  gross: number;
  net_to_seller: number;
  commission: number;
}

export interface SettlementReturnLine {
  return_id: number;
  folio: string | null;
  order_id: number;
  status: string;
  reason: string | null;
  refund_amount: number;
}

export interface SettlementReport {
  customer_id: number;
  period_start: string | null;
  period_end: string | null;
  orders_count: number;
  returns_count: number;
  totals: {
    gross_sales: number;
    commission_total: number;
    net_expected_before_returns: number;
    returns_deducted: number;
    iva_retention?: number;
    isr_retention?: number;
    retention_total?: number;
    iva_retention_pct?: number;
    isr_retention_pct?: number;
    expected_deposit: number;
    deposited: number | null;
    variance: number | null;
  };
  orders: SettlementOrderLine[];
  returns: SettlementReturnLine[];
}

export interface SalesAgent {
  id: number;
  name: string;
  is_external: boolean;
  user_id: number | null;
  commission_pct: number;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at?: string | null;
}

export type SalesAgentDraft = Omit<SalesAgent, "id" | "created_at">;

export interface AgentCommissionRow {
  agent_id: number | null;
  agent_name: string;
  commission_pct: number;
  is_external: boolean;
  orders_count: number;
  sales_base: number;
  paid_base: number;
  commission: number;
  commission_on_paid: number;
}

export interface AgentCommissionReport {
  period_start: string | null;
  period_end: string | null;
  rows: AgentCommissionRow[];
  totals: {
    sales_base: number;
    paid_base: number;
    commission: number;
    commission_on_paid: number;
    agents_count: number;
  };
}

function qs(filters: OrderFilters): string {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

function draftToPayload(d: OrderDraft) {
  return {
    kind: d.kind,
    customer_id: d.customer_id,
    seller_user_id: d.seller_user_id,
    sales_agent_id: d.sales_agent_id ?? null,
    payment_method: d.payment_method || null,
    channel: d.channel || null,
    status: d.status,
    discount_type: d.discount_type,
    discount_value: d.discount_value,
    tax_rate: d.tax_rate,
    shipping_amount: d.shipping_amount,
    shipping_cost: d.shipping_cost ?? 0,
    notes: d.notes || null,
    due_date: d.due_date || null,
    valid_until: d.valid_until || null,
    bill_rfc: d.bill_rfc || null,
    bill_name: d.bill_name || null,
    bill_use: d.bill_use || null,
    bill_regime: d.bill_regime || null,
    bill_zip: d.bill_zip || null,
    items: d.items.map((it) => ({
      variant_id: it.variant_id,
      product_name: it.product_name || null,
      sku: it.sku || null,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount_amount: it.discount_amount,
      tax_rate: it.tax_rate,
    })),
  };
}

// ── Notas de Credito CFDI 4.0 ─────────────────────────────────────────
export interface CreditNoteItem {
  id: number; order_item_id?: number | null;
  product_name: string; sku?: string | null;
  quantity: number; unit_price: number;
  subtotal: number; tax_amount: number; total: number;
}
export interface CreditNote {
  id: number; folio: string; order_id: number;
  kind: "total" | "parcial";
  motivo_sat: string; motivo_sat_label: string;
  reason?: string | null;
  subtotal: number; tax_amount: number; total: number;
  currency: string;
  status: "draft" | "stamped" | "cancelled";
  cfdi_uuid?: string | null; cfdi_serie?: string | null; cfdi_folio?: string | null;
  stamped_at?: string | null; cancelled_at?: string | null;
  cancellation_motivo?: string | null;
  created_at?: string | null;
  items: CreditNoteItem[];
}
export interface CreditNoteLineDraft {
  order_item_id?: number | null; variant_id?: number | null;
  product_name: string; sku?: string | null;
  quantity: number; unit_price: number;
  discount_amount?: number; tax_rate?: number;
  clave_prod_serv?: string | null; clave_unidad?: string | null; unidad?: string | null;
}

export const salesApi = {
  async list(filters: OrderFilters): Promise<Paginated<Order>> {
    const { data } = await api.get<Paginated<Order>>(`/sales/${qs(filters)}`);
    return data;
  },
  // ── CFDI: timbrado + Notas de credito ──
  async stampOrder(id: number): Promise<{ ok: boolean; uuid: string; serie?: string; folio?: string; stamped_at?: string }> {
    const { data } = await api.post(`/sales/orders/${id}/stamp`);
    return data;
  },
  async listMotivosSAT(): Promise<{ motivos: { codigo: string; descripcion: string }[] }> {
    const { data } = await api.get(`/sales/credit-notes/motivos-sat`);
    return data;
  },
  async listCreditNotes(orderId?: number, status?: string): Promise<CreditNote[]> {
    const params: any = {};
    if (orderId) params.order_id = orderId;
    if (status) params.status = status;
    const { data } = await api.get<CreditNote[]>(`/sales/credit-notes`, { params });
    return data;
  },
  async createCreditNote(payload: {
    order_id: number; motivo_sat: string; kind: "total" | "parcial";
    reason?: string; restocks_inventory?: boolean; warehouse_id?: number | null;
    lines: CreditNoteLineDraft[];
  }): Promise<CreditNote> {
    const { data } = await api.post<CreditNote>(`/sales/credit-notes`, payload);
    return data;
  },
  async stampCreditNote(id: number): Promise<CreditNote> {
    const { data } = await api.post<CreditNote>(`/sales/credit-notes/${id}/stamp`);
    return data;
  },
  async cancelCreditNote(id: number, motivo: string, folio_sustituto?: string): Promise<CreditNote> {
    const { data } = await api.post<CreditNote>(`/sales/credit-notes/${id}/cancel`, { motivo, folio_sustituto });
    return data;
  },
  async downloadCreditNotePDF(id: number): Promise<Blob> {
    const res = await api.get(`/sales/credit-notes/${id}/pdf`, { responseType: "blob" });
    return res.data as Blob;
  },
  async downloadCreditNoteXML(id: number): Promise<Blob> {
    const res = await api.get(`/sales/credit-notes/${id}/xml`, { responseType: "blob" });
    return res.data as Blob;
  },
  async get(id: number): Promise<Order> {
    const { data } = await api.get<Order>(`/sales/${id}`);
    return data;
  },
  async create(draft: OrderDraft): Promise<Order> {
    const { data } = await api.post<Order>(`/sales/`, draftToPayload(draft));
    return data;
  },
  async update(id: number, draft: OrderDraft): Promise<Order> {
    const { data } = await api.put<Order>(`/sales/${id}`, draftToPayload(draft));
    return data;
  },
  async changeStatus(id: number, status: string, message?: string): Promise<Order> {
    const { data } = await api.patch<Order>(`/sales/${id}/status`, { status, message });
    return data;
  },
  async addPayment(id: number, amount: number, method?: string, reference?: string, note?: string): Promise<Order> {
    const { data } = await api.post<Order>(`/sales/${id}/payments`, { amount, method, reference, note });
    return data;
  },
  async convert(id: number): Promise<Order> {
    const { data } = await api.post<Order>(`/sales/${id}/convert`, {});
    return data;
  },
  async cancel(id: number): Promise<Order> {
    const { data } = await api.post<Order>(`/sales/${id}/cancel`, {});
    return data;
  },
  async stats(params?: { start?: string; end?: string; status?: string; payment_method?: string; q?: string;
                         relationship_type?: string; client_type?: string; channel?: string }): Promise<SalesStats> {
    const { data } = await api.get<SalesStats>(`/sales/stats`, { params });
    return data;
  },
  async pipelineStats(params?: { start?: string; end?: string; relationship_type?: string; client_type?: string; channel?: string }): Promise<PipelineStatsResponse> {
    const { data } = await api.get<PipelineStatsResponse>(`/sales/pipeline-stats`, { params });
    return data;
  },
  async trend(granularity = "day", days = 30, end?: string, customerId?: number | null,
              extra?: { relationship_type?: string; client_type?: string; channel?: string }): Promise<TrendPoint[]> {
    const { data } = await api.get<TrendPoint[]>(`/sales/analytics/trend`, {
      params: { granularity, days, end, customer_id: customerId ?? undefined, ...extra },
    });
    return data;
  },
  async returnsAvg(customerId?: number | null): Promise<AverageReturns> {
    const { data } = await api.get<AverageReturns>(`/sales/analytics/returns-avg`, {
      params: { customer_id: customerId ?? undefined },
    });
    return data;
  },
  async listSellers(): Promise<SellerLite[]> {
    const { data } = await api.get<SellerLite[]>(`/sales/sellers`);
    return data;
  },

  // ── Agentes de venta / comisionistas ──────────────────────────────────
  async listAgents(includeInactive = false): Promise<SalesAgent[]> {
    const { data } = await api.get<SalesAgent[]>(`/sales/agents`, { params: { include_inactive: includeInactive } });
    return data;
  },
  async createAgent(payload: SalesAgentDraft): Promise<SalesAgent> {
    const { data } = await api.post<SalesAgent>(`/sales/agents`, payload);
    return data;
  },
  async updateAgent(id: number, payload: Partial<SalesAgentDraft>): Promise<SalesAgent> {
    const { data } = await api.patch<SalesAgent>(`/sales/agents/${id}`, payload);
    return data;
  },
  async deleteAgent(id: number): Promise<void> {
    await api.delete(`/sales/agents/${id}`);
  },
  async agentCommissions(params?: { start?: string; end?: string }): Promise<AgentCommissionReport> {
    const { data } = await api.get<AgentCommissionReport>(`/sales/agents/commissions`, { params });
    return data;
  },
  async customerForecast(customerId: number, months = 6): Promise<CustomerForecast> {
    const { data } = await api.get<CustomerForecast>(`/sales/analytics/forecast/${customerId}`, { params: { months } });
    return data;
  },
  async customerPnl(customerId: number, start: string, end: string): Promise<CustomerPnLReport> {
    const { data } = await api.get<CustomerPnLReport>(`/sales/customers/${customerId}/pnl`, { params: { start, end } });
    return data;
  },
  async topCustomers(limit = 5, start?: string, end?: string): Promise<TopCustomer[]> {
    const { data } = await api.get<TopCustomer[]>(`/sales/analytics/top-customers`, { params: { limit, start, end } });
    return data;
  },
  async topProducts(limit = 5, start?: string, end?: string): Promise<TopProduct[]> {
    const { data } = await api.get<TopProduct[]>(`/sales/analytics/top-products`, { params: { limit, start, end } });
    return data;
  },
  async bySeller(start?: string, end?: string): Promise<SalesBySeller[]> {
    const { data } = await api.get<SalesBySeller[]>(`/sales/analytics/by-seller`, { params: { start, end } });
    return data;
  },
  async byChannel(start?: string, end?: string): Promise<SalesByChannel[]> {
    const { data } = await api.get<SalesByChannel[]>(`/sales/analytics/by-channel`, { params: { start, end } });
    return data;
  },
  async heatmap(start?: string, end?: string): Promise<import("./types").HeatmapCell[]> {
    const { data } = await api.get<import("./types").HeatmapCell[]>(`/sales/analytics/heatmap`, { params: { start, end } });
    return data;
  },
  async exportFile(filters: OrderFilters, formato: "csv" | "xlsx"): Promise<Blob> {
    const sep = qs(filters) ? "&" : "?";
    const { data } = await api.get<Blob>(`/sales/export${qs(filters)}${sep}formato=${formato}`, {
      responseType: "blob",
    });
    return data;
  },
  async returns(): Promise<CustomerReturn[]> {
    const { data } = await api.get<CustomerReturn[]>(`/sales/returns`);
    return data;
  },
  async cancelReturn(id: number): Promise<CustomerReturn> {
    const { data } = await api.post<CustomerReturn>(`/sales/returns/${id}/cancel`);
    return data;
  },
  async returnable(orderId: number): Promise<{
    order_id: number; folio: string | null; customer_id: number | null;
    customer_name: string | null; warehouse_id: number | null;
    items: { variant_id: number | null; product_name: string | null; sku: string | null;
             unit_price: number; sold_quantity: number; returned_quantity: number;
             returnable_quantity: number }[];
  }> {
    const { data } = await api.get(`/sales/returns/returnable/${orderId}`);
    return data;
  },
  async createReturn(payload: {
    order_id?: number; customer_id?: number; warehouse_id?: number;
    reason?: string;
    settlement_type: "refund" | "store_credit" | "none";
    notes?: string;
    items: { variant_id?: number | null; product_name?: string | null; sku?: string | null;
             quantity: number; unit_price: number;
             condition?: "sellable" | "damaged" }[];
  }): Promise<any> {
    const { data } = await api.post(`/sales/returns`, payload);
    return data;
  },

  async sendTicketEmail(orderId: number, to?: string): Promise<{ sent: boolean; to?: string; reason?: string }> {
    const { data } = await api.post(`/sales/${orderId}/ticket/email`, { to: to || null });
    return data;
  },
  async getTicketText(orderId: number): Promise<{ text: string; phone?: string | null; customer_name?: string | null }> {
    const { data } = await api.get(`/sales/${orderId}/ticket/text`);
    return data;
  },
  async getOrderBatches(orderId: number): Promise<{ order_id: number; batches: Array<{
    variant_id: number; product_name: string; batch_code?: string | null;
    expiration_date?: string | null; quantity: number;
  }> }> {
    const { data } = await api.get(`/sales/${orderId}/batches`);
    return data;
  },

  // ── Universal ERP ──────────────────────────────────────
  async downloadDocument(orderId: number, kind: "quote" | "remission" | "proforma"): Promise<Blob> {
    const { data } = await api.get<Blob>(`/sales/${orderId}/document/${kind}.pdf`, {
      responseType: "blob",
    });
    return data;
  },
  async listMarketplaceParsers(): Promise<{ parsers: string[] }> {
    const { data } = await api.get<{ parsers: string[] }>(`/sales/marketplace/parsers`);
    return data;
  },
  async importMarketplaceReport(customerId: number, platform: string, file: File): Promise<any> {
    const form = new FormData();
    form.append("customer_id", String(customerId));
    form.append("platform", platform);
    form.append("file", file);
    const { data } = await api.post<any>(`/sales/marketplace/import`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  async customerPnLUniversal(customerId: number, start?: string, end?: string): Promise<any> {
    const { data } = await api.get<any>(`/sales/customers/${customerId}/pnl-universal`, {
      params: { start, end },
    });
    return data;
  },
  async customerSettlement(customerId: number, params: { start?: string; end?: string; deposited_amount?: number }): Promise<SettlementReport> {
    const { data } = await api.get<SettlementReport>(`/sales/customers/${customerId}/settlement`, {
      params,
    });
    return data;
  },
  async receiveReturn(returnId: number, payload: {
    warehouse_id: number;
    items_condition: Record<number, "sellable" | "damaged">;
    notes?: string;
  }): Promise<any> {
    const { data } = await api.post<any>(`/sales/returns/${returnId}/receive`, payload);
    return data;
  },
  async customers(): Promise<CustomerLite[]> {
    const { data } = await api.get<CustomerLite[]>(`/customers/`);
    return data;
  },
  async variantOptions(): Promise<VariantOption[]> {
    type Variant = { id: number; sku: string; barcode?: string | null; price: number; size?: string | null; color?: string | null };
    type Product = { name: string; variants: Variant[] };
    const { data } = await api.get<Product[]>(`/inventory/products`);
    const opts: VariantOption[] = [];
    for (const p of data) {
      for (const v of p.variants ?? []) {
        const attrs = [v.size, v.color].filter(Boolean).join(" ");
        opts.push({
          variant_id: v.id,
          label: attrs ? `${p.name} · ${attrs}` : p.name,
          sku: v.sku,
          barcode: v.barcode ?? null,
          price: v.price,
        });
      }
    }
    return opts;
  },

  // Export XLSX de ventas con los mismos filtros que la tabla del CRM
  downloadOrdersXlsx: async (filters: Record<string, any> = {}) => {
    const res = await api.get(`/sales/export.xlsx`, {
      params: filters, responseType: "blob",
    });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
    a.download = `ventas_${stamp}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};
