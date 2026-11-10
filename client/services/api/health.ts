import { requestJson, type ApiFetch } from "./client";
import type { HealthLog } from "./types";
import type { CurrentMeasurements, HealthProfileUpdate } from "@dietdigidose/contracts";
import type { HealthProfile } from "@/utils/healthProfile";

export const healthApi = {
  list: (apiFetch: ApiFetch) => requestJson<HealthLog[]>(apiFetch, "/api/v1/health-data"),
  latest: (apiFetch: ApiFetch) => requestJson<HealthLog | null>(apiFetch, "/api/v1/health-data/latest"),
  saveLog: (apiFetch: ApiFetch, input: unknown) => requestJson<HealthLog>(apiFetch, "/api/v1/health-data/log", { method: "POST", body: JSON.stringify(input) }),
  deleteLog: (apiFetch: ApiFetch, id: number) => requestJson<void>(apiFetch, `/api/v1/health-data/log/${id}`, { method: "DELETE" }),
  profile: <T>(apiFetch: ApiFetch, options: { fresh?: boolean } = {}) => requestJson<T | null>(apiFetch, "/api/v1/health-data/profile", options.fresh ? { cache: "no-store" } : {}),
  saveProfile: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/health-data/profile", { method: "PUT", body: JSON.stringify(input) }),
  patchProfile: <T = HealthProfile>(apiFetch: ApiFetch, input: HealthProfileUpdate) => requestJson<T>(apiFetch, "/api/v1/health-data/profile", { method: "PATCH", body: JSON.stringify(input) }),
  currentMeasurements: (apiFetch: ApiFetch) => requestJson<CurrentMeasurements>(apiFetch, "/api/v1/health-data/current-measurements"),
};
