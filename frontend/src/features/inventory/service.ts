import api from '../../services/api';

export interface Product {
    id: number;
    name: string;
    description?: string;
    category?: string;
    image_url?: string;
    variants: Variant[];
}

export interface Variant {
    id: number;
    sku: string;
    size?: string;
    color?: string;
    price: number;
    stock_levels?: StockLevel[];
}

export interface StockLevel {
    warehouse_id: number;
    quantity: number;
    warehouse: {
        name: string;
    };
}

export const inventoryService = {
    getProducts: async () => {
        const response = await api.get<Product[]>('/inventory/products');
        return response.data;
    },

    getProduct: async (id: number) => {
        const response = await api.get<Product>(`/inventory/products/${id}`);
        return response.data;
    },

    createProduct: async (data: any) => {
        const response = await api.post('/inventory/products', data);
        return response.data;
    },

    createVariant: async (data: any) => {
        const response = await api.post('/inventory/variants', data);
        return response.data;
    }
};
