// Forecast API service.
import api from "../../services/api";
import type {
  ForecastPlan, ForecastPlanCreate, ForecastLine, ForecastLineDraft,
  RollupResponse, AttainmentResponse, BaselineRequest, BaselineResponse,
} from "./types";

export const forecastApi = {
  async listPlans(): Promise<ForecastPlan[]> {
    const { data } = await api.get<ForecastPlan[]>("/forecast/plans");
    return data;
  },
  async createPlan(payload: ForecastPlanCreate): Promise<ForecastPlan> {
    const { data } = await api.post<ForecastPlan>("/forecast/plans", payload);
    return data;
  },
  async updatePlan(id: number, payload: Partial<ForecastPlanCreate>): Promise<ForecastPlan> {
    const { data } = await api.put<ForecastPlan>(`/forecast/plans/${id}`, payload);
    return data;
  },
  async deletePlan(id: number): Promise<void> {
    await api.delete(`/forecast/plans/${id}`);
  },

  async listLines(planId: number): Promise<ForecastLine[]> {
    const { data } = await api.get<ForecastLine[]>(`/forecast/plans/${planId}/lines`);
    return data;
  },
  async createLine(planId: number, payload: ForecastLineDraft): Promise<ForecastLine> {
    const { data } = await api.post<ForecastLine>(`/forecast/plans/${planId}/lines`, payload);
    return data;
  },
  async updateLine(lineId: number, payload: Partial<ForecastLineDraft>): Promise<ForecastLine> {
    const { data } = await api.put<ForecastLine>(`/forecast/lines/${lineId}`, payload);
    return data;
  },
  async deleteLine(lineId: number): Promise<void> {
    await api.delete(`/forecast/lines/${lineId}`);
  },

  async baseline(payload: BaselineRequest): Promise<BaselineResponse> {
    const { data } = await api.post<BaselineResponse>("/forecast/baseline", payload);
    return data;
  },

  async rollup(planId: number): Promise<RollupResponse> {
    const { data } = await api.get<RollupResponse>(`/forecast/plans/${planId}/rollup`);
    return data;
  },
  async attainment(planId: number): Promise<AttainmentResponse> {
    const { data } = await api.get<AttainmentResponse>(`/forecast/plans/${planId}/attainment`);
    return data;
  },
};
