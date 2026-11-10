import { requestJson, type ApiFetch } from "./client";
export type FeedbackCategory = "issue" | "suggestion" | "support";
export type FeedbackStatus = "received" | "processing" | "waiting_user" | "resolved" | "closed";
export const feedbackStatusLabels: Record<FeedbackStatus, string> = { received: "已收到", processing: "处理中", waiting_user: "待补充", resolved: "已解决", closed: "已关闭" };
export type FeedbackContext = { page?: string; recipeId?: number; recipeTitle?: string; appVersion?: string; snapshot?: string; platform?: "ios" | "android" | "web" };
export type FeedbackItem = { id: number; category: FeedbackCategory; content: string; context: FeedbackContext | null; status: FeedbackStatus; version: number; createdAt: string; updatedAt: string };
export type FeedbackDetail = FeedbackItem & { messages: Array<{ id: number; authorRole: "user" | "admin"; content: string; status: FeedbackStatus; createdAt: string }> };
export const feedbackApi = {
  create: (apiFetch: ApiFetch, payload: { requestKey?: string; category: FeedbackCategory; content: string; context?: FeedbackContext }) =>
    requestJson<{ id: number; status: "received" }>(apiFetch, "/api/v1/feedback", { method: "POST", body: JSON.stringify(payload) }),
  list: (apiFetch: ApiFetch, before?: number) => requestJson<{ items: FeedbackItem[]; nextCursor: number | null }>(apiFetch, `/api/v1/feedback${before ? `?before=${before}` : ""}`),
  detail: (apiFetch: ApiFetch, id: number) => requestJson<FeedbackDetail>(apiFetch, `/api/v1/feedback/${id}`),
  reply: (apiFetch: ApiFetch, id: number, payload: { requestKey: string; content: string; version: number }) => requestJson<FeedbackDetail>(apiFetch, `/api/v1/feedback/${id}/replies`, { method: "POST", body: JSON.stringify(payload) }),
};
