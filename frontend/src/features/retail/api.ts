import api from "../../services/api";
import type {
  RetailChannel, RetailChannelCreate, RetailStore, RetailStoreCreate,
  SellOutReport, SellOutReportCreate, RetailKPIs,
  StoreVelocityRow, SKUVelocityRow, ReplenishmentResponse,
  ImportSellOutResponse,
  RetailAlert, AlertsSummary, EvaluateAlertsResponse,
  AlertStatus, AlertSeverity,
} from "./types";

export const retailApi = {
  // Channels
  listChannels: () => api.get<RetailChannel[]>("/retail/channels").then(r => r.data),
  createChannel: (data: RetailChannelCreate) =>
    api.post<RetailChannel>("/retail/channels", data).then(r => r.data),
  updateChannel: (id: number, data: Partial<RetailChannelCreate>) =>
    api.patch<RetailChannel>(`/retail/channels/${id}`, data).then(r => r.data),
  deleteChannel: (id: number) => api.delete(`/retail/channels/${id}`),

  // Stores
  listStores: (opts?: { channel_id?: number; active_only?: boolean }) =>
    api.get<RetailStore[]>("/retail/stores", { params: opts }).then(r => r.data),
  createStore: (data: Partial<RetailStoreCreate> & { channel_id: number; name: string }) =>
    api.post<RetailStore>("/retail/stores", data).then(r => r.data),
  bulkCreateStores: (channel_id: number, stores: Array<Partial<RetailStoreCreate>>) =>
    api.post<{ created: number; skipped: number; stores: RetailStore[] }>(
      "/retail/stores/bulk",
      { channel_id, stores },
    ).then(r => r.data),
  updateStore: (id: number, data: Partial<RetailStoreCreate>) =>
    api.patch<RetailStore>(`/retail/stores/${id}`, data).then(r => r.data),
  deleteStore: (id: number) => api.delete(`/retail/stores/${id}`),
  storePerformance: (id: number, weeks_back = 12) =>
    api.get(`/retail/stores/${id}/performance`, { params: { weeks_back } }).then(r => r.data),

  // Sell-out
  listSellOut: (opts?: {
    channel_id?: number; store_id?: number; variant_id?: number;
    period_start_gte?: string; period_start_lt?: string; limit?: number;
  }) => api.get<SellOutReport[]>("/retail/sellout", { params: opts }).then(r => r.data),
  createSellOut: (data: SellOutReportCreate) =>
    api.post<SellOutReport>("/retail/sellout", data).then(r => r.data),
  updateSellOut: (id: number, data: Partial<SellOutReportCreate>) =>
    api.patch<SellOutReport>(`/retail/sellout/${id}`, data).then(r => r.data),
  deleteSellOut: (id: number) => api.delete(`/retail/sellout/${id}`),

  // Dashboard / analíticas
  dashboard: (opts?: { channel_id?: number; days?: number }) =>
    api.get<RetailKPIs>("/retail/dashboard", { params: opts }).then(r => r.data),
  storesVelocity: (channel_id?: number) =>
    api.get<StoreVelocityRow[]>("/retail/stores-velocity", { params: { channel_id } }).then(r => r.data),
  skusVelocity: (opts?: { channel_id?: number; limit?: number }) =>
    api.get<SKUVelocityRow[]>("/retail/skus-velocity", { params: opts }).then(r => r.data),
  replenishment: (channel_id?: number) =>
    api.get<ReplenishmentResponse>("/retail/replenishment", { params: { channel_id } }).then(r => r.data),

  // Plantilla + import
  downloadTemplate: (format: "xlsx" | "csv" = "xlsx") =>
    api.get(`/retail/sellout/template`, { params: { format }, responseType: "blob" })
      .then(r => r.data as Blob),
  importSellOut: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<ImportSellOutResponse>("/retail/sellout/import", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },

  // Alertas
  listAlerts: (opts?: {
    channel_id?: number; status?: AlertStatus; severity?: AlertSeverity; limit?: number;
  }) => api.get<RetailAlert[]>("/retail/alerts", { params: opts }).then(r => r.data),
  alertsSummary: (channel_id?: number) =>
    api.get<AlertsSummary>("/retail/alerts/summary", { params: { channel_id } }).then(r => r.data),
  evaluateAlerts: (channel_id?: number) =>
    api.post<EvaluateAlertsResponse>("/retail/alerts/evaluate", null, { params: { channel_id } }).then(r => r.data),
  acknowledgeAlert: (id: number, notes?: string) =>
    api.post<RetailAlert>(`/retail/alerts/${id}/acknowledge`, { notes: notes || undefined }).then(r => r.data),
  resolveAlert: (id: number, notes?: string) =>
    api.post<RetailAlert>(`/retail/alerts/${id}/resolve`, { notes: notes || undefined }).then(r => r.data),
  dismissAlert: (id: number, notes?: string) =>
    api.post<RetailAlert>(`/retail/alerts/${id}/dismiss`, { notes: notes || undefined }).then(r => r.data),

  // Consignación
  listConsignmentWarehouses: () =>
    api.get<import("./types").ConsignmentWarehouseOption[]>("/retail/consignment/warehouses").then(r => r.data),
  consignmentReconciliation: (channel_id?: number) =>
    api.get<import("./types").ConsignmentReconResponse>("/retail/consignment/reconciliation", { params: { channel_id } }).then(r => r.data),

  // Analíticas
  heatmap: (opts?: { channel_id?: number; metric?: "wos" | "units_sold" | "on_hand"; limit_variants?: number }) =>
    api.get<import("./types").HeatmapResponse>("/retail/analytics/heatmap", { params: opts }).then(r => r.data),
  abc: (opts?: { channel_id?: number; days?: number }) =>
    api.get<import("./types").ABCResponse>("/retail/analytics/abc", { params: opts }).then(r => r.data),

  // Traslados
  listSourceWarehouses: () =>
    api.get<import("./types").SourceWarehouseOption[]>("/retail/replenishment/source-warehouses").then(r => r.data),
  createTransfer: (source_warehouse_id: number, items: import("./types").TransferItem[]) =>
    api.post<import("./types").TransferResponse>("/retail/replenishment/transfer", {
      source_warehouse_id, items,
    }).then(r => r.data),

  // Perfiles de importación
  listImportProfiles: (channel_id?: number) =>
    api.get<import("./types").RetailImportProfile[]>("/retail/import-profiles", { params: { channel_id } }).then(r => r.data),
  createImportProfile: (data: Partial<import("./types").RetailImportProfileCreate> & { channel_id: number; name: string }) =>
    api.post<import("./types").RetailImportProfile>("/retail/import-profiles", data).then(r => r.data),
  updateImportProfile: (id: number, data: Partial<import("./types").RetailImportProfileCreate>) =>
    api.patch<import("./types").RetailImportProfile>(`/retail/import-profiles/${id}`, data).then(r => r.data),
  deleteImportProfile: (id: number) => api.delete(`/retail/import-profiles/${id}`),
  detectColumns: (file: File, profile_id?: number) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<import("./types").DetectColumnsResponse>("/retail/import-profiles/detect-columns", form, {
      params: profile_id ? { profile_id } : undefined,
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  previewImport: (profile_id: number, file: File, limit = 10) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<import("./types").PreviewResponse>(`/retail/import-profiles/${profile_id}/preview`, form, {
      params: { limit },
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  importWithProfile: (profile_id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<import("./types").ImportSellOutResponse>(`/retail/import-profiles/${profile_id}/import`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },

  // Reportes descargables
  reports: {
    sellout: (params?: { channel_id?: number; store_id?: number; variant_id?: number;
                          period_start_gte?: string; period_start_lt?: string; limit?: number }) =>
      api.get(`/retail/reports/sellout.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    dashboard: (params?: { channel_id?: number; days?: number }) =>
      api.get(`/retail/reports/dashboard.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    heatmap: (params?: { channel_id?: number; metric?: "wos" | "units_sold" | "on_hand"; limit_variants?: number }) =>
      api.get(`/retail/reports/heatmap.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    abc: (params?: { channel_id?: number; days?: number }) =>
      api.get(`/retail/reports/abc.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    replenishment: (params?: { channel_id?: number }) =>
      api.get(`/retail/reports/replenishment.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    alerts: (params?: { channel_id?: number; status?: string; severity?: string }) =>
      api.get(`/retail/reports/alerts.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    consignment: (params?: { channel_id?: number }) =>
      api.get(`/retail/reports/consignment.xlsx`, { params, responseType: "blob" }).then(r => r.data as Blob),
    executivePdf: (params?: { channel_id?: number; days?: number }) =>
      api.get(`/retail/reports/executive.pdf`, { params, responseType: "blob" }).then(r => r.data as Blob),
  },
};
