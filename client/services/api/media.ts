import { requestJson, type ApiFetch } from "./client";

export const mediaApi = {
  uploadImage: (apiFetch: ApiFetch, dataUrl: string, scope: "community" = "community") =>
    requestJson<{ url: string; objectPath: string; bytes: number; mimeType: string }>(apiFetch, "/api/v1/media/images", {
      method: "POST",
      timeoutMs: 30_000,
      body: JSON.stringify({ data_url: dataUrl, scope }),
    }),
};
