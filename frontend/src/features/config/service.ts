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

export interface Branch {
    id: number;
    name: string;
    code?: string;
    legal_name?: string;
    tax_id?: string;
    address?: string;
    phone?: string;
    email?: string;
    is_primary: boolean;
    is_active: boolean;
    created_at: string;
}

const configService = {
    getCompanyProfile: async () => (await api.get<CompanyProfile>('/config/company')).data,

    // ── Sucursales (multi-empresa) ──
    getBranches: async () => (await api.get<Branch[]>('/config/branches')).data,
    createBranch: async (data: any) => (await api.post<Branch>('/config/branches', data)).data,
    updateBranch: async (id: number, data: any) => (await api.put<Branch>(`/config/branches/${id}`, data)).data,
    deleteBranch: async (id: number) => { await api.delete(`/config/branches/${id}`); },
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
    changeMyPassword: async (current_password: string, new_password: string) =>
        (await api.post('/auth/me/password', { current_password, new_password })).data,

    // ── Autenticación de dos factores (2FA) ──
    get2faStatus: async () => (await api.get<{ enabled: boolean }>('/auth/me/2fa/status')).data,
    setup2fa: async () => (await api.post<{ qr_data_uri: string }>('/auth/me/2fa/setup')).data,
    enable2fa: async (code: string) => (await api.post<{ backup_codes: string[] }>('/auth/me/2fa/enable', { code })).data,
    disable2fa: async () => { await api.post('/auth/me/2fa/disable'); },

    getIntegrations: async () => (await api.get<SystemIntegration[]>('/config/integrations')).data,
    createIntegration: async (data: Omit<SystemIntegration, 'id'>) => (await api.post<SystemIntegration>('/config/integrations', data)).data,
    updateIntegration: async (id: string, data: Partial<SystemIntegration>) => (await api.put<SystemIntegration>(`/config/integrations/${id}`, data)).data,
    deleteIntegration: async (id: string) => { await api.delete(`/config/integrations/${id}`); },
    testEmail: async (to?: string) => (await api.post<{ ok: boolean; error: string | null; to: string | null }>('/config/integrations/email/test', { to: to || null })).data,

    // ── Zona de peligro: reset total de datos (solo superusuario) ──
    resetAllData: async (password: string, confirm: string) =>
        (await api.post<{ wiped_tables: string[]; message: string }>('/config/danger/reset-data', { password, confirm })).data,
};

export default configService;
