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
}

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
