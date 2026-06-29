// Customers API service. Reuses the shared axios instance from the Sales module.

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
  } = d;
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
  async uploadDocument(customerId: number, documentType: string, file: File): Promise<CustomerDocument> {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post<CustomerDocument>(
      `/customers/${customerId}/documents`, fd,
      { params: { document_type: documentType } },
    );
    return data;
  },
  async deleteDocument(customerId: number, docId: number): Promise<void> {
    await api.delete(`/customers/${customerId}/documents/${docId}`);
  },
};
