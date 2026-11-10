import { publicFetch, requestJson } from "./client";
import { ACCOUNT_SECURITY_CAPABILITY, type AccountDeletionProof } from "@dietdigidose/contracts";

const securityHeaders = { "X-Account-Security": ACCOUNT_SECURITY_CAPABILITY };
const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, ...securityHeaders });

export const authApi = {
  login: <T>(identifier: string, password: string) => requestJson<T>(publicFetch, "/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ identifier, password }),
  }),
  register: <T>(identifier: string, username: string, password: string) => requestJson<T>(publicFetch, "/api/v1/auth/register", {
    method: "POST", body: JSON.stringify({ identifier, username, password }),
  }),
  sendSmsCode: <T>(phone: string) => requestJson<T>(publicFetch, "/api/v1/auth/sms/send", {
    method: "POST", body: JSON.stringify({ phone }),
  }),
  verifySmsCode: <T>(challengeId: string, code: string) => requestJson<T>(publicFetch, "/api/v1/auth/sms/verify", {
    method: "POST", headers:securityHeaders, body: JSON.stringify({ challengeId, code, passwordlessRegistration:true }),
  }),
  sendPasswordRecovery: (phone: string) => requestJson<{ challengeId: string; phoneMasked: string; resendAfter: number }>(publicFetch, "/api/v1/auth/password-recovery/send", {
    method: "POST", body: JSON.stringify({ phone }),
  }),
  verifyPasswordRecovery: (challengeId: string, code: string) => requestJson<{ recoveryToken: string; expiresIn: number }>(publicFetch, "/api/v1/auth/password-recovery/verify", {
    method: "POST", body: JSON.stringify({ challengeId, code }),
  }),
  sendEmailRecovery: (email: string) => requestJson<{ challengeId: string; resendAfter: number; expiresIn: number }>(publicFetch, "/api/v1/auth/email-recovery/send", {
    method: "POST", body: JSON.stringify({ email }),
  }),
  verifyEmailRecovery: (challengeId: string, code: string) => requestJson<{ recoveryToken: string; expiresIn: number }>(publicFetch, "/api/v1/auth/email-recovery/verify", {
    method: "POST", body: JSON.stringify({ challengeId, code }),
  }),
  resetPassword: (recoveryToken: string, newPassword: string, channel?: "email") => requestJson<{ success: boolean }>(publicFetch, "/api/v1/auth/password-recovery/reset", {
    method: "POST", body: JSON.stringify({ recoveryToken, newPassword, ...(channel ? { channel } : {}) }),
  }),
  registerWithSms: <T>(registrationToken: string, username: string, password: string) => requestJson<T>(publicFetch, "/api/v1/auth/sms/register", {
    method: "POST", body: JSON.stringify({ registrationToken, username, password }),
  }),
  me: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/auth/me", { headers: authHeaders(token) }),
  updateProfile: <T>(token: string, input: unknown) => requestJson<T>(publicFetch, "/api/v1/auth/profile", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  notificationPreferences: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/notifications/preferences", { headers: authHeaders(token) }),
  notificationHistory: <T>(token: string, input: { filter?: "all" | "pending" | "system"; cursor?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (input.filter) query.set("filter", input.filter);
    if (input.cursor) query.set("cursor", String(input.cursor));
    if (input.limit) query.set("limit", String(input.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<T>(publicFetch, `/api/v1/notifications/history${suffix}`, { headers: authHeaders(token) });
  },
  notificationUnreadCount: (token: string) => requestJson<{ count: number }>(publicFetch, "/api/v1/notifications/unread-count", { headers: authHeaders(token) }),
  markNotificationRead: (token: string, id: number) => requestJson<{ id: number; isRead: boolean }>(publicFetch, `/api/v1/notifications/${id}/read`, {
    method: "PUT", headers: authHeaders(token),
  }),
  markAllNotificationsRead: (token: string) => requestJson<{ updated: number }>(publicFetch, "/api/v1/notifications/read-all", {
    method: "PUT", headers: authHeaders(token),
  }),
  notificationAction: (token: string, id: number, action: "open" | "complete" | "snooze_today" | "plan_recipe", metadata?: Record<string, unknown>) =>
    requestJson<{ id: number; action: string; actionStatus: string }>(publicFetch, `/api/v1/notifications/${id}/actions`, {
      method: "POST", headers: authHeaders(token), body: JSON.stringify({ action, metadata }),
    }),
  recordLocalNotificationEvent: (token: string, input: { kind: "meal" | "water"; title: string; body: string; event: "received" | "opened"; source_id?: string }) =>
    requestJson<{ id: number }>(publicFetch, "/api/v1/notifications/local-event", {
      method: "POST", headers: authHeaders(token), body: JSON.stringify(input),
    }),
  updateNotificationPreferences: <T>(token: string, input: unknown) => requestJson<T>(publicFetch, "/api/v1/notifications/preferences", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  registerPushDevice: (token: string, input: { expo_push_token: string; platform: "ios" | "android" }) => requestJson<void>(publicFetch, "/api/v1/notifications/device", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  deleteAccount: (token: string, proof: string | AccountDeletionProof) => requestJson<{ success: boolean; message: string }>(publicFetch, "/api/v1/auth/account", {
    method: "DELETE", headers: authHeaders(token), body: JSON.stringify({ ...(typeof proof === "string" ? {password:proof} : proof), confirmation: "DELETE" }),
  }),
  exportAIData: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/auth/ai-data", { headers: authHeaders(token) }),
  deleteAIData: (token: string) => requestJson<{ success: boolean; deleted: Record<string, number> }>(publicFetch, "/api/v1/auth/ai-data", {
    method: "DELETE", headers: authHeaders(token),
  }),
};
