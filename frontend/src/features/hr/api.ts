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

  downloadBankLayout: (periodId: number, bank?: string) =>
    api.get(`/hr/payroll/periods/${periodId}/bank-layout`, { params: bank ? { bank } : {}, responseType: "blob" }),
  downloadHeadcountReport: () => api.get("/hr/reports/headcount", { responseType: "blob" }),
  downloadVacationReport: () => api.get("/hr/reports/vacations", { responseType: "blob" }),
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
