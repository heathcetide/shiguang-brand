import { requestJson, type ApiFetch } from "./client";

export const shoppingListApi = {
  list: <T>(apiFetch: ApiFetch) => requestJson<T>(apiFetch, "/api/v1/shopping-list"),
  create: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/shopping-list", { method: "POST", body: JSON.stringify(input) }),
  update: <T>(apiFetch: ApiFetch, id: string, input: unknown) => requestJson<T>(apiFetch, `/api/v1/shopping-list/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: <T>(apiFetch: ApiFetch, id: string) => requestJson<T>(apiFetch, `/api/v1/shopping-list/${encodeURIComponent(id)}`, { method: "DELETE" }),
  import: <T>(apiFetch: ApiFetch, importKey: string, items: unknown[]) => requestJson<T>(apiFetch, "/api/v1/shopping-list/import", { method: "POST", body: JSON.stringify({ importKey, items }) }),
};
