import api from '../../services/api';

export interface SystemIntegration {
    id: string;
    provider_name: string;
    integration_type: 'PAYMENT_GATEWAY' | 'EMAIL' | 'STORAGE' | 'ACCOUNTING' | 'OTHER';
    is_active: boolean;
    environment: 'SANDBOX' | 'PRODUCTION';
    api_key?: string;
    api_secret?: string;
    webhook_secret?: string;
    meta_data?: Record<string, any>;
}

export interface CompanyProfile {
    id?: string;
    legal_name: string;
    tax_id?: string;
    contact_email?: string;
    contact_phone?: string;
    address?: string;
    base_currency?: string;
    timezone?: string;
    logo_url?: string;
}

const configService = {
    getCompanyProfile: async () => (await api.get<CompanyProfile>('/config/company')).data,
    createCompanyProfile: async (data: CompanyProfile) => (await api.post<CompanyProfile>('/config/company', data)).data,
    updateCompanyProfile: async (data: Partial<CompanyProfile>) => (await api.put<CompanyProfile>('/config/company', data)).data,

    getIntegrations: async () => (await api.get<SystemIntegration[]>('/config/integrations')).data,
    createIntegration: async (data: Omit<SystemIntegration, 'id'>) => (await api.post<SystemIntegration>('/config/integrations', data)).data,
    updateIntegration: async (id: string, data: Partial<SystemIntegration>) => (await api.put<SystemIntegration>(`/config/integrations/${id}`, data)).data,
    deleteIntegration: async (id: string) => { await api.delete(`/config/integrations/${id}`); },
};

export default configService;
