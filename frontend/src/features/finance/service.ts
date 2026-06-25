import api from '../../services/api';

export interface Transaction {
    id: number;
    type: 'income' | 'expense';
    amount: number;
    category?: string;
    description?: string;
    reference?: string;
    created_at: string;
}

export interface FinanceDashboard {
    total_income: number;
    total_expenses: number;
    net_profit: number;
    transaction_count: number;
}

export interface AgingItem {
    id: number;
    name: string;
    reference: string;
    total: number;
    paid: number;
    balance: number;
    due_date?: string;
    aging: 'current' | '1-30' | '31-60' | '61-90' | '90+';
    status: 'pending' | 'partial' | 'overdue' | 'paid';
}

export interface BankAccount {
    id: number;
    name: string;
    bank?: string;
    account_number?: string;
    type: 'checking' | 'savings' | 'credit';
    balance: number;
    currency: string;
    is_active?: boolean;
    created_at: string;
}

export interface BankTransaction {
    id: number;
    bank_account_id: number;
    type: 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out';
    amount: number;
    description?: string;
    reference?: string;
    created_at: string;
}

export interface FlowPoint {
    period: string;
    income: number;
    expenses: number;
    net: number;
}

export interface BankImportResult {
    total_rows: number;
    imported: number;
    skipped_duplicates: number;
    errors: { row: number; error: string }[];
    new_balance: number;
}

export const financeService = {
    getDashboard: async () => (await api.get<FinanceDashboard>('/finance/dashboard')).data,

    getTransactions: async (params?: { type?: string; skip?: number; limit?: number }) =>
        (await api.get<Transaction[]>('/finance/transactions', { params })).data,
    createTransaction: async (data: any) => (await api.post<Transaction>('/finance/transactions', data)).data,
    updateTransaction: async (id: number, data: any) => (await api.put<Transaction>(`/finance/transactions/${id}`, data)).data,
    deleteTransaction: async (id: number) => (await api.delete(`/finance/transactions/${id}`)).data,

    getCXC: async () => (await api.get<AgingItem[]>('/finance/cxc')).data,
    payCXC: async (orderId: number, data: any) => (await api.post(`/finance/cxc/${orderId}/pay`, data)).data,

    getCXP: async () => (await api.get<AgingItem[]>('/finance/cxp')).data,
    payCXP: async (poId: number, data: any) => (await api.post(`/finance/cxp/${poId}/pay`, data)).data,

    getBanks: async () => (await api.get<BankAccount[]>('/finance/banks')).data,
    createBank: async (data: any) => (await api.post<BankAccount>('/finance/banks', data)).data,
    deactivateBank: async (id: number) => (await api.delete<BankAccount>(`/finance/banks/${id}`)).data,
    getBankTransactions: async (id: number) => (await api.get<BankTransaction[]>(`/finance/banks/${id}/transactions`)).data,
    createBankTransaction: async (id: number, data: any) => (await api.post<BankAccount>(`/finance/banks/${id}/transactions`, data)).data,
    transferBank: async (id: number, data: any) => (await api.post<BankAccount>(`/finance/banks/${id}/transfer`, data)).data,
    importBankStatement: async (id: number, file: File) => {
        const form = new FormData();
        form.append('file', file);
        return (await api.post<BankImportResult>(`/finance/banks/${id}/import`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })).data;
    },

    getCashFlow: async (months = 6) => (await api.get<FlowPoint[]>('/finance/cash-flow', { params: { months } })).data,
};

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
    const esc = (v: string | number) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}
