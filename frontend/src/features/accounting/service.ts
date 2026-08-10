import api from '../../services/api';

async function downloadXml(url: string, params: any) {
    const res = await api.get(url, { params, responseType: 'blob' });
    const cd = (res.headers as any)['content-disposition'] || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const filename = m ? m[1] : 'contabilidad_electronica.xml';
    const blobUrl = window.URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(blobUrl);
}

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

// ── Estados financieros (Fase 2) ───────────────────────────────────────────
export interface ReportLine { account_id: number; code: string; name: string; level: number; amount: number; }
export interface TrialBalanceRow {
    account_id: number; code: string; name: string; level: number; is_postable: boolean;
    nature: string; saldo_inicial: number; cargos: number; abonos: number; saldo_final: number;
}
export interface TrialBalance {
    date_from?: string; date_to?: string; rows: TrialBalanceRow[];
    total_cargos: number; total_abonos: number;
}
export interface BalanceSheet {
    as_of?: string;
    activo: ReportLine[]; total_activo: number;
    pasivo: ReportLine[]; total_pasivo: number;
    capital: ReportLine[]; resultado_ejercicio: number; total_capital: number;
    balanced: boolean; difference: number;
}
export interface IncomeStatement {
    date_from?: string; date_to?: string;
    ingresos: ReportLine[]; total_ingresos: number;
    costos: ReportLine[]; total_costos: number;
    gastos: ReportLine[]; total_gastos: number;
    utilidad_bruta: number; utilidad_neta: number;
}

export interface AccountMapItem {
    role: string;
    label: string;
    account_id?: number | null;
    account_code?: string | null;
    account_name?: string | null;
}

// ── Activos fijos y depreciación (Hook 9) ────────────────────────────────────
export interface FixedAsset {
    id?: number;
    name: string;
    category?: string;
    acquisition_date: string;
    acquisition_cost: number;
    salvage_value?: number;
    annual_rate_pct: number;
    useful_life_months?: number;
    asset_account_id?: number | null;
    accumulated_depr_account_id?: number | null;
    expense_account_id?: number | null;
    is_active?: boolean;
    disposed_at?: string | null;
    accumulated_depreciation?: number;
    branch_id?: number | null;
    notes?: string | null;
    created_at?: string;
}

// ── Políticas contables (Fase 4) — versionadas por effective_from ─────────────
export interface WithholdingRate { isr: number; iva: number; }
export interface AccountingPolicy {
    id?: number;
    branch_id?: number | null;
    iva_acreditable_scheme: 'pending_payment' | 'direct_paid';
    iva_trasladado_scheme: 'pending_collection' | 'direct_collected';
    cogs_scheme: 'perpetual' | 'analytic';
    purchase_recognition: 'on_receive' | 'on_bill' | 'on_pay';
    payroll_scheme: 'itemized' | 'consolidated' | 'admin_expense';
    expense_basis: 'accrual' | 'cash';
    withholding_enabled: boolean;
    withholding_rates?: Record<string, WithholdingRate>;
    fx_scheme: 'transaction_date' | 'month_end_close';
    labor_benefits_scheme: 'monthly_provision' | 'at_payment';
    depreciation_scheme: 'straight_line_monthly' | 'manual';
    effective_from: string;
    status?: string;
    notes?: string | null;
    created_at?: string;
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

    // Estados financieros
    getTrialBalance: async (params?: any) =>
        (await api.get<TrialBalance>('/accounting/reports/trial-balance', { params })).data,
    getBalanceSheet: async (params?: any) =>
        (await api.get<BalanceSheet>('/accounting/reports/balance-sheet', { params })).data,
    getIncomeStatement: async (params?: any) =>
        (await api.get<IncomeStatement>('/accounting/reports/income-statement', { params })).data,

    // Configuración contable (mapeo de cuentas para pólizas automáticas)
    getAccountMap: async () => (await api.get<AccountMapItem[]>('/accounting/config/account-map')).data,
    setAccountMap: async (mapping: Record<string, number | null>) =>
        (await api.put('/accounting/config/account-map', { mapping })).data,

    // Políticas contables — el contador escoge el flujo que mejor le acomode
    getCurrentPolicy: async () => (await api.get<AccountingPolicy>('/accounting/policies/current')).data,
    upsertPolicy: async (data: Partial<AccountingPolicy>) =>
        (await api.put<AccountingPolicy>('/accounting/policies', data)).data,
    listPolicies: async () => (await api.get<AccountingPolicy[]>('/accounting/policies')).data,

    // Cierre anual del ejercicio (Hook 10)
    closeYear: async (year: number) => (await api.post<{
        year: number; total_ingresos: number; total_costos_gastos: number;
        utilidad_neta: number; cuentas_cerradas: number;
    }>(`/accounting/close-year/${year}`)).data,

    // Activos fijos y depreciación (Hook 9)
    listFixedAssets: async (onlyActive = true) =>
        (await api.get<FixedAsset[]>('/accounting/fixed-assets', { params: { only_active: onlyActive } })).data,
    createFixedAsset: async (data: Partial<FixedAsset>) =>
        (await api.post<FixedAsset>('/accounting/fixed-assets', data)).data,
    disposeFixedAsset: async (id: number) =>
        (await api.post<FixedAsset>(`/accounting/fixed-assets/${id}/dispose`)).data,
    runDepreciation: async (year: number, month: number) =>
        (await api.post<{ year: number; month: number; total: number; assets_depreciated: any[] } | { skipped: boolean; reason: string }>(`/accounting/depreciation/run/${year}/${month}`)).data,

    // Contabilidad Electrónica SAT (XML del Anexo 24)
    downloadSatCatalogo: (params: any) => downloadXml('/accounting/sat/catalogo', params),
    downloadSatBalanza: (params: any) => downloadXml('/accounting/sat/balanza', params),
    downloadSatPolizas: (params: any) => downloadXml('/accounting/sat/polizas', params),

    // Cierre de período
    listPeriodCloses: async () =>
        (await api.get<PeriodClose[]>('/accounting/period-close')).data,
    closePeriod: async (year: number, month: number, notes?: string) =>
        (await api.post<{ id: number; year: number; month: number; period: string; status: string; closed_at: string; message: string }>(
            '/accounting/period-close', null, { params: { year, month, notes } })).data,
    reopenPeriod: async (year: number, month: number, reason?: string) =>
        (await api.post<{ period: string; status: string; reopened_at: string }>(
            `/accounting/period-close/${year}/${month}/reopen`, null, { params: { reason } })).data,
};

export interface PeriodClose {
    id: number;
    year: number;
    month: number;
    period: string;
    status: 'closed' | 'reopened';
    closed_at: string;
    reopened_at?: string;
    closed_by_id?: number;
    notes?: string;
}


// ── Balance General (captura manual mensual) ──────────────────────────────

export interface BalanceGeneralInput {
    period_year: number;
    period_month: number;
    branch_id?: number | null;
    cash_and_equivalents: number;
    accounts_receivable: number;
    inventory: number;
    other_current_assets: number;
    fixed_assets: number;
    intangible_assets: number;
    long_term_investments: number;
    other_non_current_assets: number;
    accounts_payable: number;
    short_term_debt: number;
    taxes_payable: number;
    other_current_liabilities: number;
    long_term_debt: number;
    other_non_current_liabilities: number;
    equity_capital: number;
    retained_earnings: number;
    period_result: number;
    status?: 'draft' | 'posted';
    notes?: string | null;
}

export interface BalanceGeneralTotals {
    current_assets_total: number;
    non_current_assets_total: number;
    total_assets: number;
    current_liabilities_total: number;
    non_current_liabilities_total: number;
    total_liabilities: number;
    total_equity: number;
    liabilities_plus_equity: number;
    is_balanced: boolean;
}

export interface FinancialRatios {
    current_ratio: number | null;
    quick_ratio: number | null;
    debt_ratio: number | null;
    debt_to_equity: number | null;
    working_capital: number | null;
    roe: number | null;
    roa: number | null;
}

export interface BalanceGeneral extends BalanceGeneralInput {
    id: number;
    created_at?: string;
    updated_at?: string;
    created_by_id?: number;
    updated_by_id?: number;
    totals?: BalanceGeneralTotals;
    ratios?: FinancialRatios;
}

async function downloadBlob(url: string, filename: string) {
    const res = await api.get(url, { responseType: 'blob' });
    const cd = (res.headers as any)['content-disposition'] || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const name = m ? m[1] : filename;
    const blobUrl = window.URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(blobUrl);
}

export const balanceService = {
    list: async (params?: { limit?: number; offset?: number; branch_id?: number }) =>
        (await api.get<BalanceGeneral[]>('/accounting/balance-sheets', { params })).data,
    latest: async (branch_id?: number) =>
        (await api.get<BalanceGeneral>('/accounting/balance-sheets/latest', { params: { branch_id } })).data,
    getByPeriod: async (year: number, month: number, branch_id?: number) =>
        (await api.get<BalanceGeneral>(
            `/accounting/balance-sheets/period/${year}/${month}`, { params: { branch_id } })).data,
    get: async (id: number) => (await api.get<BalanceGeneral>(`/accounting/balance-sheets/${id}`)).data,
    create: async (data: BalanceGeneralInput) =>
        (await api.post<BalanceGeneral>('/accounting/balance-sheets', data)).data,
    update: async (id: number, data: Partial<BalanceGeneralInput>) =>
        (await api.put<BalanceGeneral>(`/accounting/balance-sheets/${id}`, data)).data,
    remove: async (id: number) => { await api.delete(`/accounting/balance-sheets/${id}`); },
    downloadPdf: (id: number, year: number, month: number) =>
        downloadBlob(`/accounting/balance-sheets/${id}/pdf`, `balance_${year}_${String(month).padStart(2, '0')}.pdf`),
    downloadExcel: (id: number, year: number, month: number) =>
        downloadBlob(`/accounting/balance-sheets/${id}/excel`, `balance_${year}_${String(month).padStart(2, '0')}.xlsx`),
    downloadHistoryExcel: (months = 12) =>
        downloadBlob(`/accounting/balance-sheets/history/excel?months=${months}`, `balances_historico.xlsx`),
};


// ── DIOT (SAT A29) ────────────────────────────────────────────────────────

export interface DiotRow {
    supplier_id?: number | null;
    supplier_name: string;
    third_type: string;
    third_type_label: string;
    operation_type: string;
    operation_type_label: string;
    rfc?: string | null;
    country_code?: string | null;
    value_16: number;
    iva_16: number;
    value_0: number;
    value_exempt: number;
    iva_withheld: number;
    iva_non_deductible: number;
    total_paid: number;
    total_iva: number;
    warnings: string[];
}

export interface DiotPreview {
    period_year: number;
    period_month: number;
    rows: DiotRow[];
    totals: {
        rows: number;
        total_paid: number;
        total_iva: number;
        warnings_count: number;
    };
}

export const diotService = {
    preview: async (year: number, month: number, branch_id?: number) =>
        (await api.get<DiotPreview>('/accounting/diot/preview', { params: { year, month, branch_id } })).data,
    downloadTxt: (year: number, month: number, branch_id?: number) => {
        const qs = new URLSearchParams({ year: String(year), month: String(month) });
        if (branch_id) qs.set('branch_id', String(branch_id));
        return downloadBlob(`/accounting/diot/download.txt?${qs}`, `DIOT_${year}_${String(month).padStart(2, '0')}.txt`);
    },
    downloadXlsx: (year: number, month: number, branch_id?: number) => {
        const qs = new URLSearchParams({ year: String(year), month: String(month) });
        if (branch_id) qs.set('branch_id', String(branch_id));
        return downloadBlob(`/accounting/diot/download.xlsx?${qs}`, `DIOT_${year}_${String(month).padStart(2, '0')}.xlsx`);
    },
};
