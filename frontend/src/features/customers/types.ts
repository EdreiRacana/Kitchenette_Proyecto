// Types for the Customers module.

export interface Customer {
  id: number;
  client_number: string | null;
  client_type: string | null;
  razon_social: string | null;
  nombre_comercial: string | null;
  name: string;

  rfc: string | null;
  regimen_fiscal: string | null;
  uso_cfdi: string | null;
  cuenta_contable: string | null;

  sucursal: string | null;
  price_list: string | null;
  credit_days: number | null;
  credit_amount: number | null;
  discount_pact: number | null;
  account_number: string | null;
  sales_agent: string | null;
  credit_agent: string | null;
  how_heard: string | null;

  email: string | null;
  phone: string | null;
  phones: string[] | null;

  pais: string | null;
  estado: string | null;
  municipio: string | null;
  localidad: string | null;
  calle: string | null;
  colonia: string | null;
  codigo_postal: string | null;
  no_exterior: string | null;
  no_interior: string | null;
  codigo_colonia: string | null;
  codigo_localidad: string | null;
  referencia: string | null;
  address: string | null;

  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string | null;

  // ── Perfil comercial universal ──
  relationship_type?: "retail" | "b2b_firm" | "b2b_consignment" | "marketplace" | "chain_physical" | null;
  commission_base_pct?: number | null;
  logistics_pct?: number | null;
  logistics_fixed?: number | null;
  cedis_pct?: number | null;
  portal_pct?: number | null;
  withholding_scheme?: string | null;
  withholding_isr_pct?: number | null;
  withholding_iva_pct?: number | null;
  commercial_discount_pct?: number | null;
  marketplace_platform?: string | null;
  seller_id_external?: string | null;
  consignment_settlement_days?: number | null;
}

export const WITHHOLDING_SCHEMES = [
  { key: "none",                label: "Sin retención",                        isr: 0.0,  iva: 0.0    },
  { key: "honorarios",          label: "Honorarios (PF)",                      isr: 10.0, iva: 10.667 },
  { key: "arrendamiento",       label: "Arrendamiento (PF)",                   isr: 10.0, iva: 10.667 },
  { key: "fletes",              label: "Fletes / autotransporte",              isr: 4.0,  iva: 4.0    },
  { key: "comisiones",          label: "Comisiones mercantiles (PF)",          isr: 10.0, iva: 10.667 },
  { key: "marketplace_pf_min",  label: "Marketplace PF — bajo (0.4%)",         isr: 0.4,  iva: 8.0    },
  { key: "marketplace_pf_mid",  label: "Marketplace PF — medio (2%)",          isr: 2.0,  iva: 8.0    },
  { key: "marketplace_pf_max",  label: "Marketplace PF — alto (5.4%)",         isr: 5.4,  iva: 8.0    },
  { key: "custom",              label: "Personalizado",                        isr: 0.0,  iva: 0.0    },
] as const;

export const RELATIONSHIP_TYPES = [
  { key: "retail",           label: "Retail / mostrador",          icon: "🛍️",  desc: "Venta directa al público (persona final)." },
  { key: "b2b_firm",         label: "B2B — Pedido en firme",       icon: "📋",  desc: "Empresa, factura a crédito, cobranza en plazo." },
  { key: "b2b_consignment",  label: "B2B — Consignación",          icon: "📦",  desc: "Entregas mercancía y pagan lo que se va vendiendo." },
  { key: "marketplace",      label: "Marketplace",                 icon: "🌐",  desc: "Vendes en plataforma (Liverpool, Amazon, ML)." },
  { key: "chain_physical",   label: "Cadena con tiendas físicas",  icon: "🏪",  desc: "Sears/Chedraui/Costco: CEDIS + sell-through." },
] as const;

// Editable draft (everything the form can set). `id` only present when editing.
export type CustomerDraft = Omit<Customer, "id" | "client_number" | "created_at" | "updated_at"> & {
  id?: number;
};

export interface CustomerFilters {
  q?: string;
  sucursal?: string;
  client_type?: string;
  price_list?: string;
  is_active?: boolean;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  skip?: number;
  limit?: number;
}

export interface PaginatedCustomers {
  items: Customer[];
  total: number;
  skip: number;
  limit: number;
}

export interface CustomerStats {
  total: number;
  active: number;
  credit: number;
  credit_exposure: number;
}

export interface CustomerDocument {
  id: number;
  customer_id: number;
  document_type: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  status: string;
  upload_date: string;
  verified_at: string | null;
  verified_by_id: number | null;
}
