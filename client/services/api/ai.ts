import { requestJson, type ApiFetch } from "./client";
import { APP_VERSION } from "@/utils/appVersion";

type PollableAgentRun = {
  id: string;
  status: string;
  reply?: string;
  transcript?: string;
  artifacts?: Array<{ type: string; title?: string; data: unknown }>;
  pendingApproval?: unknown;
  error?: { code?: string; message?: string };
  durationMs?: number;
};

const terminalAgentStatuses = new Set(["completed", "failed", "cancelled", "expired", "awaiting_approval", "awaiting_input"]);

export async function waitForAgentRun<T extends PollableAgentRun>(apiFetch: ApiFetch, initialRun: T, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let run = initialRun;
  while (!terminalAgentStatuses.has(run.status)) {
    if (Date.now() >= deadline) throw new Error("Agent 任务仍在执行，请稍后到任务卡片查看进度");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const response = await requestJson<{ run: T }>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(run.id)}`);
    run = response.run;
  }
  if (run.status === "failed") throw new Error(run.error?.message || "Agent 执行失败");
  if (run.status === "cancelled" || run.status === "expired") throw new Error("Agent 任务已取消或过期");
  return run;
}

export const aiApi = {
  chat: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/ai/chat", { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }),
  deleteConversation: <T>(apiFetch: ApiFetch, sessionId: string) => requestJson<T>(apiFetch, `/api/v1/ai/chat-conversations/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),
  commitWriteConfirmation: <T>(apiFetch: ApiFetch, confirmationId: string, idempotencyKey: string) => requestJson<T>(apiFetch, `/api/v1/ai/write-confirmations/${confirmationId}/commit`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }),
  homeRecommendations: <T>(apiFetch: ApiFetch, period: string, requestKey: string, signal?: AbortSignal) => requestJson<T>(apiFetch, "/api/v1/ai/home-recommendations", { method: "POST", body: JSON.stringify({ period, requestKey }), signal, timeoutMs: 15_000 }),
  visionFood: <T>(apiFetch: ApiFetch, image: string, userPrompt?: string) => requestJson<T>(apiFetch, "/api/v1/ai/vision-food", { method: "POST", body: JSON.stringify({ image, userPrompt }), timeoutMs: 60_000 }),
  createInventoryScan: <T>(apiFetch: ApiFetch, image: string, signal?: AbortSignal) => requestJson<T>(apiFetch, "/api/v1/ai/inventory-scan-jobs", { method: "POST", body: JSON.stringify({ image }), signal, timeoutMs: 20_000 }),
  inventoryScan: <T>(apiFetch: ApiFetch, jobId: string) => requestJson<T>(apiFetch, `/api/v1/ai/inventory-scan-jobs/${jobId}`),
  scanReceipt: <T>(apiFetch: ApiFetch, image: string) => requestJson<T>(apiFetch, "/api/v1/ai/scan-receipt", { method: "POST", body: JSON.stringify({ image }), timeoutMs: 60_000 }),
  voiceCommand: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/ai/voice-command", { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }),
  transcribe: <T>(apiFetch: ApiFetch, audioBase64: string, mimeType: string) => requestJson<T>(apiFetch, "/api/v1/ai/transcribe", { method: "POST", body: JSON.stringify({ audioBase64, mimeType }), timeoutMs: 60_000 }),
  agentRun: <T>(apiFetch: ApiFetch, runId: string, afterSequence = 0) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}?afterSequence=${afterSequence}`),
  agentMedia: <T>(apiFetch: ApiFetch, runId: string) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}/media`),
  resumeAgentRun: <T>(apiFetch: ApiFetch, runId: string, input: unknown) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: JSON.stringify(input), timeoutMs: 60_000 }),
  cancelAgentRun: <T>(apiFetch: ApiFetch, runId: string) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  retryAgentRun: <T>(apiFetch: ApiFetch, runId: string) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}/retry`, { method: "POST", timeoutMs: 60_000 }),
  undoAgentRun: <T>(apiFetch: ApiFetch, runId: string) => requestJson<T>(apiFetch, `/api/v1/ai/agent-runs/${encodeURIComponent(runId)}/undo`, { method: "POST" }),
};

export interface RealtimeVoiceSession {
  id: string;
  recipeId: number;
  status: "active" | "muted" | "closed" | "expired" | "fallback";
  platform: "android" | "ios" | "web";
  version: number;
  connectedAt: string;
  expiresAt: string;
  metrics: { firstTranscriptMs: number | null; firstResponseMs: number | null; interruptions: number; reconnects: number; fallbacks: number };
}

export type RealtimeVoiceEvent = { sequence: number; type: string; payload: Record<string, unknown>; createdAt: string };

export const realtimeVoiceApi = {
  create: (apiFetch: ApiFetch, input: unknown) => requestJson<{ session: RealtimeVoiceSession; repeated: boolean }>(apiFetch, "/api/v1/ai/realtime-voice/sessions", {
    method: "POST", body: JSON.stringify(input),
  }),
  heartbeat: (apiFetch: ApiFetch, sessionId: string, input: unknown) => requestJson<{ session: RealtimeVoiceSession }>(apiFetch, `/api/v1/ai/realtime-voice/sessions/${sessionId}/heartbeat`, {
    method: "POST", body: JSON.stringify(input),
  }),
  audioChunk: (apiFetch: ApiFetch, sessionId: string, input: unknown) => requestJson<{
    turnId: string; sequence: number; transcript: string; final: boolean; latencyMs: number; repeated: boolean;
  }>(apiFetch, `/api/v1/ai/realtime-voice/sessions/${sessionId}/audio-chunks`, {
    method: "POST", body: JSON.stringify(input), timeoutMs: 35_000,
  }),
  turn: (apiFetch: ApiFetch, sessionId: string, input: unknown) => requestJson<{
    turnId: string;
    intent: "control" | "confirmation_required" | "question";
    action?: { action?: string; seconds?: number; requiresConfirmation?: boolean; message?: string };
    repeated: boolean;
  }>(apiFetch, `/api/v1/ai/realtime-voice/sessions/${sessionId}/turns`, { method: "POST", body: JSON.stringify(input), timeoutMs: 30_000 }),
  events: (apiFetch: ApiFetch, sessionId: string, after: number) => requestJson<{ session: RealtimeVoiceSession; events: RealtimeVoiceEvent[] }>(apiFetch, `/api/v1/ai/realtime-voice/sessions/${sessionId}/events?after=${after}`),
  close: (apiFetch: ApiFetch, sessionId: string) => requestJson<{ session: RealtimeVoiceSession }>(apiFetch, `/api/v1/ai/realtime-voice/sessions/${sessionId}`, { method: "DELETE" }),
};

export type VoicePackManifest = {
  voiceId: string;
  name: string;
  version: string;
  distribution?: "public" | "internal-test";
  language: "zh-CN";
  gender?: "male" | "female" | "neutral" | "unspecified";
  deviceRequirements?: string[];
  sampleRate: number;
  outputFormat: "pcm-f32";
  minimumAppVersion: string;
  minimumMemoryMb: number;
  license: { name: string; url: string; speakerAuthorization: string; modelNotice: string };
  resources: Array<{ path: string; url: string; sha256: string; bytes: number }>;
  model: {
    path: string;
    vocabularyPath: string;
    textProcessor?: { type: "character-v1" } | { type: "token-map-v1"; mappingPath: string };
    inputNames: { tokens: string; lengths: string; scales?: string; speakerId?: string };
    outputName?: string;
    speakerId?: number;
  };
  previewUrl?: string;
};

export const voicePackApi = {
  catalog: (apiFetch: ApiFetch) => requestJson<{
    items: VoicePackManifest[];
    revoked: Array<{ voiceId: string; version: string }>;
    catalogVersion: string;
    authority: "database";
    syntheticVoiceDisclosure: string;
  }>(apiFetch, "/api/v1/ai/voice-packs", { headers: { "x-client-version": APP_VERSION } }),
  preference: (apiFetch: ApiFetch) => requestJson<VoicePreferenceRecord>(apiFetch, "/api/v1/ai/voice-packs/preference"),
  updatePreference: (apiFetch: ApiFetch, input: VoicePreferenceRecord) => requestJson<VoicePreferenceRecord>(apiFetch, "/api/v1/ai/voice-packs/preference", {
    method: "PUT", body: JSON.stringify(input),
  }),
  synthesize: (apiFetch: ApiFetch, text: string, selection?: { voiceId: string; version: string }) => requestJson<{
    audioBase64: string;
    mimeType: "audio/mpeg";
    source: "server";
  }>(apiFetch, "/api/v1/ai/voice-packs/synthesize", {
    method: "POST", body: JSON.stringify({ text, ...selection }), timeoutMs: 35_000,
  }),
};

export type VoicePreferenceRecord = {
  selectedVoiceId: string | null;
  selectedVersion: string | null;
  preference: "automatic" | "system-only";
  version: number;
  updatedAt?: string | null;
};
