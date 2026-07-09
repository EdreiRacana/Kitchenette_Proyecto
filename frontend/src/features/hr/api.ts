import api from "../../services/api";

export const hrApi = {
  dashboard: () => api.get("/hr/dashboard").then(r => r.data),
  alerts: () => api.get("/hr/alerts").then(r => r.data),

  employees: () => api.get("/hr/employees").then(r => r.data),
  createEmployee: (data: any) => api.post("/hr/employees", data).then(r => r.data),
  updateEmployee: (id: number, data: any) => api.patch(`/hr/employees/${id}`, data).then(r => r.data),
  deleteEmployee: (id: number) => api.delete(`/hr/employees/${id}`).then(r => r.data),

  attendance: (date?: string) => api.get("/hr/attendance", { params: date ? { date } : {} }).then(r => r.data),
  createAttendance: (data: any) => api.post("/hr/attendance", data).then(r => r.data),

  periods: () => api.get("/hr/payroll/periods").then(r => r.data),
  createPeriod: (data: any) => api.post("/hr/payroll/periods", data).then(r => r.data),
  periodDetail: (id: number) => api.get(`/hr/payroll/periods/${id}`).then(r => r.data),
  calculatePeriod: (id: number) => api.post(`/hr/payroll/periods/${id}/calculate`).then(r => r.data),
  approvePeriod: (id: number) => api.post(`/hr/payroll/periods/${id}/approve`).then(r => r.data),
  dispersePeriod: (id: number) => api.post(`/hr/payroll/periods/${id}/disperse`).then(r => r.data),

  downloadBankLayout: (periodId: number, bank: string, originAccount?: string, loteNumber?: string) =>
    api.get(`/hr/payroll/periods/${periodId}/bank-layout`, {
      params: { bank, origin_account: originAccount || undefined, lote_number: loteNumber || undefined },
      responseType: "blob",
    }),
  dispersionSummary: (periodId: number) =>
    api.get(`/hr/payroll/periods/${periodId}/dispersion-summary`).then(r => r.data),

  // Recibos PDF y aguinaldo
  downloadReceipt: (periodId: number, employeeId: number) =>
    api.get(`/hr/payroll/periods/${periodId}/receipts/${employeeId}.pdf`, { responseType: "blob" }),
  downloadReceiptsZip: (periodId: number) =>
    api.get(`/hr/payroll/periods/${periodId}/receipts.zip`, { responseType: "blob" }),
  createAguinaldo: (year: number, paymentDate: string) =>
    api.post(`/hr/payroll/aguinaldo`, { year, payment_date: paymentDate }).then(r => r.data),

  updatePayrollDetail: (periodId: number, employeeId: number, data: {
    bonus?: number; food_vouchers?: number; savings_fund?: number;
    loan_deduction?: number; notes?: string;
  }) => api.patch(`/hr/payroll/periods/${periodId}/details/${employeeId}`, data).then(r => r.data),

  employeeAttendance: (employeeId: number, startDate?: string, endDate?: string) =>
    api.get(`/hr/employees/${employeeId}/attendance`, {
      params: { start_date: startDate, end_date: endDate },
    }).then(r => r.data),

  downloadBulkTemplate: (periodId: number, format: "xlsx" | "csv" = "xlsx") =>
    api.get(`/hr/payroll/periods/${periodId}/bulk-template`, {
      params: { format }, responseType: "blob",
    }),
  // JSON preview de reportes (sin descargar)
  reportHeadcountData: () => api.get("/hr/reports/headcount/data").then(r => r.data),
  reportVacationsData: () => api.get("/hr/reports/vacations/data").then(r => r.data),
  reportOvertimeData: (start: string, end: string) =>
    api.get("/hr/reports/overtime/data", { params: { start_date: start, end_date: end } }).then(r => r.data),
  reportAnnualData: (year: number) =>
    api.get("/hr/reports/annual-accumulated/data", { params: { year } }).then(r => r.data),
  reportPTUData: (year: number, totalUtilidad: number) =>
    api.post("/hr/reports/ptu/data", { year, total_utilidad: totalUtilidad }).then(r => r.data),
  reportInfonavitData: () => api.get("/hr/reports/infonavit/data").then(r => r.data),
  reportSUAData: (periodId: number) =>
    api.get(`/hr/reports/sua/${periodId}/data`).then(r => r.data),

  bulkImportDetail: (periodId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/hr/payroll/periods/${periodId}/bulk-import`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  downloadHeadcountReport: () => api.get("/hr/reports/headcount", { responseType: "blob" }),
  downloadVacationReport: () => api.get("/hr/reports/vacations", { responseType: "blob" }),
  downloadOvertimeReport: (startDate: string, endDate: string) =>
    api.get("/hr/reports/overtime", { params: { start_date: startDate, end_date: endDate }, responseType: "blob" }),
  downloadAnnualAccumulatedReport: (year: number) =>
    api.get("/hr/reports/annual-accumulated", { params: { year }, responseType: "blob" }),
  downloadPTUReport: (year: number, totalUtilidad: number) =>
    api.post("/hr/reports/ptu", { year, total_utilidad: totalUtilidad }, { responseType: "blob" }),
  downloadInfonavitReport: () => api.get("/hr/reports/infonavit", { responseType: "blob" }),
  downloadSUAReport: (periodId: number) => api.get(`/hr/reports/sua/${periodId}`, { responseType: "blob" }),
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
