import api from '../../services/api';

export interface Account {
    id: number;
    code: string;
    name: string;
    account_type: 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'costo' | 'gasto' | 'orden';
    nature: 'deudora' | 'acreedora';
    level: number;
    parent_id?: number | null;
    sat_code?: string | null;
    is_postable: boolean;
    is_active: boolean;
}

export interface JournalLine {
    id?: number;
    account_id: number;
    account_code?: string;
    account_name?: string;
    debit: number;
    credit: number;
    description?: string | null;
}

export interface JournalEntry {
    id: number;
    folio?: string;
    date: string;
    entry_type: 'ingreso' | 'egreso' | 'diario';
    concept?: string | null;
    source: string;
    status: 'posted' | 'cancelled';
    total_debit: number;
    total_credit: number;
}

export interface JournalEntryDetail extends JournalEntry {
    lines: JournalLine[];
}

export interface LedgerMovement {
    entry_id: number;
    folio?: string;
    date: string;
    concept?: string | null;
    debit: number;
    credit: number;
    balance: number;
}

export interface LedgerReport {
    account_id: number;
    account_code: string;
    account_name: string;
    nature: string;
    opening_balance: number;
    total_debit: number;
    total_credit: number;
    closing_balance: number;
    movements: LedgerMovement[];
}

export const accountingService = {
    // Catálogo de cuentas
    getAccounts: async (onlyActive = false) =>
        (await api.get<Account[]>('/accounting/accounts', { params: { only_active: onlyActive } })).data,
    seedDefault: async () => (await api.post<{ created: number }>('/accounting/accounts/seed-default')).data,
    createAccount: async (data: any) => (await api.post<Account>('/accounting/accounts', data)).data,
    updateAccount: async (id: number, data: any) => (await api.put<Account>(`/accounting/accounts/${id}`, data)).data,
    deleteAccount: async (id: number) => { await api.delete(`/accounting/accounts/${id}`); },

    // Pólizas
    getEntries: async (params?: any) => (await api.get<JournalEntry[]>('/accounting/entries', { params })).data,
    createEntry: async (data: any) => (await api.post<JournalEntryDetail>('/accounting/entries', data)).data,
    getEntry: async (id: number) => (await api.get<JournalEntryDetail>(`/accounting/entries/${id}`)).data,
    cancelEntry: async (id: number) => (await api.post<JournalEntryDetail>(`/accounting/entries/${id}/cancel`)).data,

    // Mayor / auxiliar
    getLedger: async (accountId: number, params?: any) =>
        (await api.get<LedgerReport>(`/accounting/ledger/${accountId}`, { params })).data,
};
