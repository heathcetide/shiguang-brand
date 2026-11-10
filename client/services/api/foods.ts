import { requestJson, publicFetch, type ApiFetch } from "./client";

export const foodsApi = {
  search: <T>(query: string) => requestJson<T[]>(publicFetch, `/api/v1/foods/search?query=${encodeURIComponent(query)}`),
  submitCustom: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/foods/custom", { method: "POST", body: JSON.stringify(input) }),
  barcode: <T>(barcode: string) => requestJson<T>(publicFetch, `/api/v1/foods/barcode/${encodeURIComponent(barcode)}`),
};
