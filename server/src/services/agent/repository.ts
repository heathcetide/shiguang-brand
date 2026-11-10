import { agentRunsService } from "../../modules/agentRuns/runtime.js";
import { publicAIErrorMessage } from "../aiErrors.js";
import type { AgentRunRow } from "../../modules/agentRuns/repository.js";
import type {
  AgentActionBundle,
  AgentActionProposal,
  AgentInput,
  AgentRunStatus,
  AgentRunSummary,
  SpecialistName,
} from "./types.js";

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function createAgentRun(userId: number, input: AgentInput) {
  return agentRunsService().createRun(userId, input);
}

export function getAgentRunMedia(runId: string, userId: number) {
  return agentRunsService().media(runId, userId);
}

export function getAgentRunRow(runId: string, userId?: number) {
  return agentRunsService().run(runId, userId);
}

export function findReusableAgentRun(userId: number, idempotencyKey: string, maxAgeMinutes = 15) {
  return agentRunsService().reusableRun(userId, idempotencyKey, maxAgeMinutes);
}

export async function getAgentRunInput(runId: string): Promise<{ userId: number; input: AgentInput; threadId: string } | undefined> {
  const row = await getAgentRunRow(runId);
  if (!row) return undefined;
  return {
    userId: row.user_id,
    input: parseJson<AgentInput>(row.input_json, { modality: row.modality }),
    threadId: row.checkpoint_thread_id,
  };
}

export function setAgentRunStatus(runId: string, status: AgentRunStatus, fields: {
  result?: Record<string, unknown>;
  pendingApproval?: AgentActionBundle | null;
  pendingInput?: { question: string } | null;
  errorCode?: string | null;
  errorMessage?: string | null;
} = {}) {
  return agentRunsService().setStatus(runId, status, fields);
}

export function appendAgentEvent(runId: string, userId: number, agentName: SpecialistName,
  eventType: string, summary: string, payload?: unknown) {
  return agentRunsService().appendEvent(runId, userId, agentName, eventType, summary, payload);
}

export function listAgentEvents(runId: string, userId: number, afterSequence = 0) {
  return agentRunsService().events(runId, userId, afterSequence);
}

export function saveAgentActions(runId: string, userId: number, proposals: AgentActionProposal[]) {
  return agentRunsService().saveActions(runId, userId, proposals);
}

export function updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown } = {}) {
  return agentRunsService().updateActionStatus(actionId, status, fields);
}

export function recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit") {
  return agentRunsService().recordActionDecision(actionIds, userId, decision);
}

export function getRunActions(runId: string, userId: number) {
  return agentRunsService().actions(runId, userId);
}

export function reviseRunActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>) {
  return agentRunsService().reviseActions(runId, userId, actions);
}

export function toAgentRunSummary(row: AgentRunRow): AgentRunSummary {
  const result = parseJson<{ reply?: string; transcript?: string; artifacts?: AgentRunSummary["artifacts"] }>(row.result_json, {});
  const timestampMs = (value: string | null) => {
    if (!value) return Number.NaN;
    return Date.parse(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  };
  const startedMs = timestampMs(row.started_at);
  const completedMs = timestampMs(row.completed_at);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
    ? Math.max(0, completedMs - startedMs)
    : undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    modality: row.modality,
    source: row.source,
    status: row.status,
    reply: result.reply,
    transcript: result.transcript,
    artifacts: result.artifacts || [],
    pendingApproval: parseJson<AgentActionBundle | undefined>(row.pending_approval_json, undefined),
    pendingInput: parseJson<{ question: string } | undefined>(row.pending_input_json, undefined),
    error: row.error_code || row.error_message
      ? { code: row.error_code || "AI_AGENT_FAILED", message: publicAIErrorMessage(row.error_code) }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    durationMs,
  };
}

export function listRecoverableAgentRuns() { return agentRunsService().recoverableRuns(); }
export function deleteUserAgentData(userId: number) { return agentRunsService().deleteUserData(userId); }
