// Sales / CRM API service. Thin typed wrapper over the shared axios instance.

import api from "../../services/api";
import type {
  Order, Paginated, SalesStats, TrendPoint, TopCustomer, TopProduct,
  SalesBySeller, SalesByChannel, OrderFilters, OrderDraft, CustomerLite, AverageReturns, CustomerForecast,
  CustomerPnLReport, CustomerReturn, SellerLite,
} from "./types";

export interface VariantOption {
  variant_id: number;
  label: string;
  sku: string;
  barcode?: string | null;
  price: number;
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
    payment_method: d.payment_method || null,
    channel: d.channel || null,
    status: d.status,
    discount_type: d.discount_type,
    discount_value: d.discount_value,
    tax_rate: d.tax_rate,
    shipping_amount: d.shipping_amount,
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

export const salesApi = {
  async list(filters: OrderFilters): Promise<Paginated<Order>> {
    const { data } = await api.get<Paginated<Order>>(`/sales/${qs(filters)}`);
    return data;
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
  async stats(start?: string, end?: string): Promise<SalesStats> {
    const { data } = await api.get<SalesStats>(`/sales/stats`, { params: { start, end } });
    return data;
  },
  async trend(granularity = "day", days = 30, end?: string, customerId?: number | null): Promise<TrendPoint[]> {
    const { data } = await api.get<TrendPoint[]>(`/sales/analytics/trend`, {
      params: { granularity, days, end, customer_id: customerId ?? undefined },
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
};
