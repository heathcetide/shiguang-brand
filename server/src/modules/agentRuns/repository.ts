import type {
  AgentActionBundle,
  AgentActionProposal,
  AgentInput,
  AgentRunEvent,
  AgentRunStatus,
  SpecialistName,
} from "../../services/agent/types.js";

export function agentActionProposalIndex(runId: string, idempotencyKey: unknown) {
  const value = String(idempotencyKey || "");
  const prefix = `${runId}:`;
  if (!value.startsWith(prefix)) return Number.MAX_SAFE_INTEGER;
  const separator = value.indexOf(":", prefix.length);
  const index = Number(value.slice(prefix.length, separator < 0 ? undefined : separator));
  return Number.isSafeInteger(index) && index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export type AgentRunRow = {
  id: string;
  user_id: number;
  session_id: string;
  modality: AgentInput["modality"];
  source: string;
  status: AgentRunStatus;
  input_json: string;
  result_json: string | null;
  pending_approval_json: string | null;
  pending_input_json: string | null;
  error_code: string | null;
  error_message: string | null;
  checkpoint_thread_id: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRunMedia = {
  id: string;
  kind: "image" | "audio";
  mime_type: string | null;
  data_base64: string;
};

export type AgentRunAction = {
  id: string;
  actionType: AgentActionProposal["actionType"];
  riskLevel: AgentActionProposal["riskLevel"];
  status: string;
  payload: Record<string, unknown>;
  before?: unknown;
  result?: unknown;
  version: number;
  createdAt: string;
  executedAt?: string;
};

export type AgentRunStatusFields = {
  result?: Record<string, unknown>;
  pendingApproval?: AgentActionBundle | null;
  pendingInput?: { question: string } | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export interface AgentRunsRepository {
  createRun(userId: number, input: AgentInput): Promise<{ id: string; sessionId: string }>;
  media(runId: string, userId: number): Promise<AgentRunMedia | undefined>;
  run(runId: string, userId?: number): Promise<AgentRunRow | undefined>;
  reusableRun(userId: number, idempotencyKey: string, maxAgeMinutes: number): Promise<AgentRunRow | undefined>;
  setStatus(runId: string, status: AgentRunStatus, fields: AgentRunStatusFields): Promise<boolean>;
  appendEvent(runId: string, userId: number, agentName: SpecialistName, eventType: string,
    summary: string, payload?: unknown): Promise<number>;
  events(runId: string, userId: number, afterSequence: number): Promise<AgentRunEvent[]>;
  saveActions(runId: string, userId: number, proposals: AgentActionProposal[]): Promise<Array<AgentActionProposal & { id: string }>>;
  updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown }): Promise<void>;
  recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit"): Promise<void>;
  actions(runId: string, userId: number): Promise<AgentRunAction[]>;
  reviseActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>): Promise<void>;
  recoverableRuns(): Promise<Array<{ id: string }>>;
  deleteUserData(userId: number): Promise<number>;
}
