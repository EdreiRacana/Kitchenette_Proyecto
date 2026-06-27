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

export interface PermissionDef { id: number; module: string; action: string; description?: string; }
export interface ApiRole {
    id: number;
    name: string;
    description?: string;
    color?: string;
    is_system: boolean;
    permissions: PermissionDef[];
}
export interface ApiUser {
    id: number;
    email: string;
    full_name?: string;
    is_active: boolean;
    is_superuser: boolean;
    role?: string;
    role_id?: number | null;
    role_obj?: ApiRole | null;
    created_at: string;
}
export interface ModuleDef { key: string; label: string; }
export interface MyPermissions {
    is_superuser: boolean;
    role: string | null;
    modules: ModuleDef[];
    permissions: Record<string, Record<string, boolean>>;
}

const configService = {
    getCompanyProfile: async () => (await api.get<CompanyProfile>('/config/company')).data,
    createCompanyProfile: async (data: CompanyProfile) => (await api.post<CompanyProfile>('/config/company', data)).data,
    updateCompanyProfile: async (data: Partial<CompanyProfile>) => (await api.put<CompanyProfile>('/config/company', data)).data,

    // ── Usuarios, roles y permisos (RBAC) ──
    getUsers: async () => (await api.get<ApiUser[]>('/auth/users')).data,
    createUser: async (data: any) => (await api.post<ApiUser>('/auth/users', data)).data,
    updateUser: async (id: number, data: any) => (await api.put<ApiUser>(`/auth/users/${id}`, data)).data,
    deleteUser: async (id: number) => { await api.delete(`/auth/users/${id}`); },
    getRoles: async () => (await api.get<ApiRole[]>('/auth/roles')).data,
    createRole: async (data: any) => (await api.post<ApiRole>('/auth/roles', data)).data,
    updateRole: async (id: number, data: any) => (await api.put<ApiRole>(`/auth/roles/${id}`, data)).data,
    deleteRole: async (id: number) => { await api.delete(`/auth/roles/${id}`); },
    getPermissions: async () => (await api.get<PermissionDef[]>('/auth/permissions')).data,
    getMyPermissions: async () => (await api.get<MyPermissions>('/auth/me/permissions')).data,

    getIntegrations: async () => (await api.get<SystemIntegration[]>('/config/integrations')).data,
    createIntegration: async (data: Omit<SystemIntegration, 'id'>) => (await api.post<SystemIntegration>('/config/integrations', data)).data,
    updateIntegration: async (id: string, data: Partial<SystemIntegration>) => (await api.put<SystemIntegration>(`/config/integrations/${id}`, data)).data,
    deleteIntegration: async (id: string) => { await api.delete(`/config/integrations/${id}`); },
};

export default configService;
