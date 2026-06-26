import api from '../../services/api';

export interface Variant {
    id: number;
    sku: string;
    size?: string;
    color?: string;
    material?: string;
    price: number;
    cost_price?: number;
    reorder_point?: number;
    safety_stock?: number;
    lead_time_days?: number;
    preferred_supplier_id?: number;
    is_active: boolean;
    stock_levels?: StockLevel[];
}

export type ProductItemType = 'finished_good' | 'raw_material' | 'consumable' | 'other';

export interface Product {
    id: number;
    name: string;
    description?: string;
    category?: string;
    image_url?: string;
    is_active: boolean;
    is_manufactured?: boolean;
    item_type?: ProductItemType;
    created_at: string;
    variants: Variant[];
}

export interface StockLevel {
    variant_id: number;
    warehouse_id: number;
    quantity: number;
    reserved_quantity?: number;
    warehouse: { name: string };
}

export interface Warehouse {
    id: number;
    name: string;
    location?: string;
    type: 'own' | 'marketplace' | 'consignment' | 'transit';
    is_active: boolean;
}

export interface SupplierContact { name: string; role?: string; phone?: string; email?: string; }
export interface SupplierDocument {
    id: number;
    supplier_id: number;
    doc_type: string;
    file_url: string;
    file_name?: string;
    created_at: string;
}

export interface Supplier {
    id: number;
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    rfc?: string;
    address?: string;
    lead_time_days?: number;
    payment_terms?: string;
    commercial_terms?: string;
    extra_contacts?: SupplierContact[];
    notes?: string;
    is_active: boolean;
    created_at: string;
    documents?: SupplierDocument[];
}

export interface Movement {
    id: number;
    variant_id: number;
    warehouse_id: number;
    quantity: number;
    movement_type: 'in' | 'out' | 'adjustment';
    unit_cost?: number;
    reference?: string;
    notes?: string;
    created_at: string;
    product_name?: string;
    sku?: string;
    warehouse_name?: string;
}

export interface ReorderAlert {
    variant_id: number;
    sku: string;
    product_name: string;
    warehouse_id: number;
    warehouse_name: string;
    available: number;
    reserved: number;
    reorder_point: number;
    safety_stock: number;
    level: 'yellow' | 'red';
    preferred_supplier_id?: number;
    preferred_supplier_name?: string;
    lead_time_days?: number;
}

export interface CategoryValue { category: string; value: number; pct: number; }
export interface InventoryStats {
    total_value: number;
    total_units: number;
    out_of_stock: number;
    low_stock: number;
    by_category: CategoryValue[];
}

export interface PurchaseOrderItem { variant_id: number; quantity: number; unit_cost: number; }
export interface PurchaseOrder {
    id: number;
    folio?: string;
    supplier_id: number;
    warehouse_id: number;
    status: 'draft' | 'ordered' | 'received' | 'cancelled';
    notes?: string;
    created_at: string;
    received_at?: string;
    items: PurchaseOrderItem[];
}

export interface RecipeItem { input_variant_id: number; quantity: number; }
export interface Recipe {
    id: number;
    output_variant_id: number;
    name?: string;
    labor_cost: number;
    overhead_cost: number;
    yield_quantity: number;
    is_active: boolean;
    items: RecipeItem[];
}
export interface RecipeCostBreakdown {
    recipe_id: number;
    materials_cost: number;
    labor_cost: number;
    overhead_cost: number;
    total_cost: number;
    unit_cost: number;
    missing_cost_inputs: string[];
}

export interface ProductionOrder {
    id: number;
    folio?: string;
    recipe_id: number;
    warehouse_id: number;
    runs: number;
    status: 'draft' | 'completed' | 'cancelled';
    unit_cost_result?: number;
    notes?: string;
    created_at: string;
    completed_at?: string;
}

export interface BulkImportRowError { row: number; message: string; }
export interface BulkImportResult {
    total_rows: number;
    created: number;
    updated: number;
    errors: BulkImportRowError[];
}

function downloadBlob(blob: Blob, filename: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

export const inventoryService = {
    // Products
    getProducts: async (itemType?: ProductItemType) => (await api.get<Product[]>('/inventory/products', { params: itemType ? { item_type: itemType } : {} })).data,
    getProduct: async (id: number) => (await api.get<Product>(`/inventory/products/${id}`)).data,
    createProduct: async (data: any) => (await api.post('/inventory/products', data)).data,
    updateProduct: async (id: number, data: any) => (await api.put(`/inventory/products/${id}`, data)).data,
    uploadProductImage: async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        return (await api.post<{ url: string }>('/inventory/products/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },

    // Variants
    createVariant: async (data: any) => (await api.post('/inventory/variants', data)).data,
    updateVariant: async (id: number, data: any) => (await api.put(`/inventory/variants/${id}`, data)).data,

    // Suppliers
    getSuppliers: async () => (await api.get<Supplier[]>('/inventory/suppliers')).data,
    createSupplier: async (data: any) => (await api.post('/inventory/suppliers', data)).data,
    updateSupplier: async (id: number, data: any) => (await api.put(`/inventory/suppliers/${id}`, data)).data,
    deleteSupplier: async (id: number) => (await api.delete(`/inventory/suppliers/${id}`)).data,
    uploadSupplierDocument: async (id: number, docType: string, file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        return (await api.post<SupplierDocument>(`/inventory/suppliers/${id}/documents`, fd, { params: { doc_type: docType }, headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    deleteSupplierDocument: async (supplierId: number, docId: number) => (await api.delete(`/inventory/suppliers/${supplierId}/documents/${docId}`)).data,

    // Warehouses
    getWarehouses: async () => (await api.get<Warehouse[]>('/inventory/warehouses')).data,
    createWarehouse: async (data: any) => (await api.post('/inventory/warehouses', data)).data,
    updateWarehouse: async (id: number, data: any) => (await api.put(`/inventory/warehouses/${id}`, data)).data,

    // Stock / movements
    adjustStock: async (data: any) => (await api.post('/inventory/stock/adjust', data)).data,
    getStockLevels: async (variantId: number) => (await api.get<StockLevel[]>(`/inventory/stock/${variantId}`)).data,
    getMovements: async () => (await api.get<Movement[]>('/inventory/movements')).data,

    // Reorder alerts
    getReorderAlerts: async () => (await api.get<ReorderAlert[]>('/inventory/reorder-alerts')).data,
    getStats: async () => (await api.get<InventoryStats>('/inventory/stats')).data,

    // Purchase orders
    getPurchaseOrders: async () => (await api.get<PurchaseOrder[]>('/inventory/purchase-orders')).data,
    createPurchaseOrder: async (data: any) => (await api.post('/inventory/purchase-orders', data)).data,
    updatePurchaseOrder: async (id: number, data: any) => (await api.put(`/inventory/purchase-orders/${id}`, data)).data,
    receivePurchaseOrder: async (id: number) => (await api.post(`/inventory/purchase-orders/${id}/receive`)).data,
    cancelPurchaseOrder: async (id: number) => (await api.post(`/inventory/purchase-orders/${id}/cancel`)).data,

    // Recipes (BOM)
    getRecipes: async () => (await api.get<Recipe[]>('/inventory/recipes')).data,
    createRecipe: async (data: any) => (await api.post('/inventory/recipes', data)).data,
    updateRecipe: async (id: number, data: any) => (await api.put(`/inventory/recipes/${id}`, data)).data,
    getRecipeCost: async (id: number) => (await api.get<RecipeCostBreakdown>(`/inventory/recipes/${id}/cost`)).data,

    // Production orders
    getProductionOrders: async () => (await api.get<ProductionOrder[]>('/inventory/production-orders')).data,
    createProductionOrder: async (data: any) => (await api.post('/inventory/production-orders', data)).data,
    completeProductionOrder: async (id: number) => (await api.post(`/inventory/production-orders/${id}/complete`)).data,

    // Carga masiva (Excel/CSV)
    downloadProductsTemplate: async () => {
        const res = await api.get('/inventory/products/bulk-import/template', { responseType: 'blob' });
        downloadBlob(res.data, 'plantilla_productos_insumos.xlsx');
    },
    uploadProductsBulkImport: async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        const { data } = await api.post<BulkImportResult>('/inventory/products/bulk-import', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
    },
    downloadRecipesTemplate: async () => {
        const res = await api.get('/inventory/recipes/bulk-import/template', { responseType: 'blob' });
        downloadBlob(res.data, 'plantilla_recetas_bom.xlsx');
    },
    uploadRecipesBulkImport: async (file: File) => {
        const form = new FormData();
        form.append('file', file);
        const { data } = await api.post<BulkImportResult>('/inventory/recipes/bulk-import', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });
        return data;
    },
};
