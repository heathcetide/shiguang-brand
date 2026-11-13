import { requestJson, type ApiFetch } from "./client";

export type MediaUploadScope = "community" | "ai" | "inventory" | "receipt";

export const mediaApi = {
  uploadImage: (apiFetch: ApiFetch, dataUrl: string, scope: MediaUploadScope = "community") =>
    requestJson<{ url: string; objectPath?: string; bytes?: number; mimeType?: string }>(apiFetch, "/api/v1/media/images", {
      method: "POST",
      timeoutMs: 30_000,
      body: JSON.stringify({ data_url: dataUrl, scope }),
    }),
  /** Persist a base64 still to object storage, then return a public URL for vision LLMs. */
  uploadBase64Image: async (apiFetch: ApiFetch, base64: string, mimeType = "image/jpeg", scope: MediaUploadScope = "ai") => {
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    const dataUrl = `data:${mimeType};base64,${clean}`;
    const uploaded = await mediaApi.uploadImage(apiFetch, dataUrl, scope);
    if (!uploaded?.url) throw new Error("图片上传失败，请重试");
    return uploaded.url;
  },
};
