// Customers API service. Reuses the shared axios instance from the Sales module.

import axios from "axios";
import api from "../../services/api";
import type { Customer, CustomerDraft, CustomerFilters, PaginatedCustomers, CustomerStats, CustomerDocument } from "./types";

function qs(f: CustomerFilters): string {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

// Only send fields the backend knows; null stays null (clears value).
function toPayload(d: CustomerDraft) {
  const {
    razon_social, nombre_comercial, name, client_type,
    rfc, regimen_fiscal, uso_cfdi, cuenta_contable,
    sucursal, price_list, credit_days, credit_amount, discount_pact,
    account_number, sales_agent, credit_agent, how_heard,
    email, phone, phones,
    pais, estado, municipio, localidad, calle, colonia, codigo_postal,
    no_exterior, no_interior, codigo_colonia, codigo_localidad, referencia, address,
    is_active, notes,
    // Universal ERP
    relationship_type, commission_base_pct, logistics_pct, logistics_fixed,
    cedis_pct, portal_pct, withholding_scheme, withholding_isr_pct, withholding_iva_pct,
    commercial_discount_pct, marketplace_platform, seller_id_external, consignment_settlement_days,
  } = d as any;
  return {
    razon_social: razon_social || null, nombre_comercial: nombre_comercial || null,
    name: name || null, client_type: client_type || null,
    rfc: rfc || null, regimen_fiscal: regimen_fiscal || null,
    uso_cfdi: uso_cfdi || null, cuenta_contable: cuenta_contable || null,
    sucursal: sucursal || null, price_list: price_list || null,
    credit_days: credit_days ?? 0, credit_amount: credit_amount ?? 0,
    discount_pact: discount_pact ?? 0, account_number: account_number || null,
    sales_agent: sales_agent || null, credit_agent: credit_agent || null,
    how_heard: how_heard || null,
    email: email || null, phone: phone || null,
    phones: phones && phones.length ? phones : null,
    pais: pais || null, estado: estado || null, municipio: municipio || null,
    localidad: localidad || null, calle: calle || null, colonia: colonia || null,
    codigo_postal: codigo_postal || null, no_exterior: no_exterior || null,
    no_interior: no_interior || null, codigo_colonia: codigo_colonia || null,
    codigo_localidad: codigo_localidad || null, referencia: referencia || null,
    address: address || null, is_active: is_active ?? true, notes: notes || null,
    // ── Perfil comercial (Universal ERP) ──
    relationship_type: relationship_type || "retail",
    commission_base_pct: commission_base_pct ?? 0,
    logistics_pct: logistics_pct ?? 0,
    logistics_fixed: logistics_fixed ?? 0,
    cedis_pct: cedis_pct ?? 0,
    portal_pct: portal_pct ?? 0,
    withholding_scheme: withholding_scheme || "none",
    withholding_isr_pct: withholding_isr_pct ?? 0,
    withholding_iva_pct: withholding_iva_pct ?? 0,
    commercial_discount_pct: commercial_discount_pct ?? 0,
    marketplace_platform: marketplace_platform || null,
    seller_id_external: seller_id_external || null,
    consignment_settlement_days: consignment_settlement_days ?? 30,
  };
}

export const customersApi = {
  async search(filters: CustomerFilters): Promise<PaginatedCustomers> {
    const { data } = await api.get<PaginatedCustomers>(`/customers/search${qs(filters)}`);
    return data;
  },
  async get(id: number): Promise<Customer> {
    const { data } = await api.get<Customer>(`/customers/${id}`);
    return data;
  },
  async create(draft: CustomerDraft): Promise<Customer> {
    const { data } = await api.post<Customer>(`/customers/`, toPayload(draft));
    return data;
  },
  async update(id: number, draft: CustomerDraft): Promise<Customer> {
    const { data } = await api.put<Customer>(`/customers/${id}`, toPayload(draft));
    return data;
  },
  async stats(): Promise<CustomerStats> {
    const { data } = await api.get<CustomerStats>(`/customers/stats`);
    return data;
  },
  async listDocuments(customerId: number): Promise<CustomerDocument[]> {
    const { data } = await api.get<CustomerDocument[]>(`/customers/${customerId}/documents`);
    return data;
  },
  // Subida directa a Supabase Storage: el navegador pide una URL firmada,
  // sube el archivo DIRECTO a Supabase (sin pasar por nuestro backend) y
  // luego confirma para que se guarde el registro en la base de datos.
  // Esto evita el doble salto navegador→Render→Supabase (lento/propenso a
  // timeout en el plan free de Render) — el archivo va directo al storage,
  // igual que en cualquier sistema de subida de archivos de nivel mundial.
  async uploadDocument(customerId: number, documentType: string, file: File): Promise<CustomerDocument> {
    const mimeType = file.type || "application/octet-stream";

    const { data: signed } = await api.post<{ upload_url: string; path: string }>(
      `/customers/${customerId}/documents/sign-upload`,
      { file_name: file.name, mime_type: mimeType },
    );

    // PUT directo a Supabase: SIN la instancia `api` (no debe llevar el
    // Authorization de nuestro backend; la URL firmada ya autoriza la subida).
    await axios.put(signed.upload_url, file, {
      headers: { "Content-Type": mimeType },
      timeout: 120000,
    });

    const { data } = await api.post<CustomerDocument>(
      `/customers/${customerId}/documents/finalize`,
      { document_type: documentType, file_name: file.name, path: signed.path, mime_type: mimeType },
    );
    return data;
  },
  async deleteDocument(customerId: number, docId: number): Promise<void> {
    await api.delete(`/customers/${customerId}/documents/${docId}`);
  },
};
