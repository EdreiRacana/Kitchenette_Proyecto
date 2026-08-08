import api from "../../services/api";
import type { ExecutiveDashboardResponse } from "./types";

export const dashboardApi = {
  executive: (opts?: { start?: string; end?: string }) =>
    api.get<ExecutiveDashboardResponse>("/dashboard/executive", { params: opts }).then(r => r.data),
};
