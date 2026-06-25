import api from '../../services/api';

export interface Transaction {
    id: number;
    type: 'income' | 'expense';
    amount: number;
    category?: string;
    description?: string;
    reference?: string;
    created_by_id?: number;
    attachment_url?: string;
    created_at: string;
}

export interface FinanceDashboard {
    total_income: number;
    total_expenses: number;
    net_profit: number;
    transaction_count: number;
    projected_balance?: number;
    bank_balance?: number;
    cxc_balance?: number;
    cxp_balance?: number;
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
    late_fee: number;
}

export interface Budget {
    id: number;
    category: string;
    type: 'income' | 'expense';
    period: string;
    amount: number;
    created_at: string;
}

export interface BudgetComparisonItem {
    category: string;
    type: string;
    period: string;
    budgeted: number;
    actual: number;
    variance: number;
    percent_used: number;
}

export interface RecurringTransaction {
    id: number;
    type: 'income' | 'expense';
    amount: number;
    category?: string;
    description?: string;
    frequency: 'weekly' | 'monthly';
    next_run_date: string;
    is_active: boolean;
    created_at: string;
}

export interface PnLCategory { category: string; amount: number; }

export interface PnLReport {
    period_start: string;
    period_end: string;
    total_income: number;
    total_expenses: number;
    net_profit: number;
    income_by_category: PnLCategory[];
    expenses_by_category: PnLCategory[];
}

export interface PeriodComparison {
    current: PnLReport;
    previous: PnLReport;
    income_change_pct?: number;
    expenses_change_pct?: number;
    net_change_pct?: number;
}

export interface AuditLogItem {
    id: string;
    action: string;
    description?: string;
    details?: any;
    user_id?: number;
    timestamp: string;
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
    reconciled?: boolean;
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
    uploadAttachment: async (id: number, file: File) => {
        const form = new FormData();
        form.append('file', file);
        return (await api.post<Transaction>(`/finance/transactions/${id}/attachment`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })).data;
    },

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
    importBankStatement: async (id: number, file: File, password?: string) => {
        const form = new FormData();
        form.append('file', file);
        if (password) form.append('password', password);
        return (await api.post<BankImportResult>(`/finance/banks/${id}/import`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })).data;
    },

    getCashFlow: async (months = 6) => (await api.get<FlowPoint[]>('/finance/cash-flow', { params: { months } })).data,

    reconcileMovement: async (movementId: number, reconciled = true) =>
        (await api.put<BankTransaction>(`/finance/bank-transactions/${movementId}/reconcile`, { reconciled })).data,

    getBudgets: async (period?: string) => (await api.get<Budget[]>('/finance/budgets', { params: { period } })).data,
    createBudget: async (data: any) => (await api.post<Budget>('/finance/budgets', data)).data,
    deleteBudget: async (id: number) => (await api.delete(`/finance/budgets/${id}`)).data,
    getBudgetComparison: async (period: string) =>
        (await api.get<BudgetComparisonItem[]>('/finance/budgets/comparison', { params: { period } })).data,

    getRecurring: async () => (await api.get<RecurringTransaction[]>('/finance/recurring')).data,
    createRecurring: async (data: any) => (await api.post<RecurringTransaction>('/finance/recurring', data)).data,
    updateRecurring: async (id: number, data: any) => (await api.put<RecurringTransaction>(`/finance/recurring/${id}`, data)).data,
    deleteRecurring: async (id: number) => (await api.delete(`/finance/recurring/${id}`)).data,

    getPnL: async (start: string, end: string) =>
        (await api.get<PnLReport>('/finance/reports/pnl', { params: { start, end } })).data,
    getPeriodComparison: async (start: string, end: string) =>
        (await api.get<PeriodComparison>('/finance/reports/comparison', { params: { start, end } })).data,
    exportPnLPdf: async (start: string, end: string) => {
        const res = await api.get('/finance/reports/pnl/export', { params: { start, end }, responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `pnl_${start}_${end}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    },

    getAuditLogs: async (skip = 0, limit = 100) =>
        (await api.get<AuditLogItem[]>('/finance/audit-logs', { params: { skip, limit } })).data,
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
