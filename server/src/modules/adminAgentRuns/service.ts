import { AdminAgentRunsError } from "./errors.js";
import type { AdminAgentRunsRepository } from "./repository.js";
import type { PublicCheckpointState, Row } from "./types.js";

const STATUSES = ["queued", "running", "awaiting_input", "awaiting_approval", "completed", "failed", "cancelled", "expired"];
const MODALITIES = ["text", "home", "cooking", "image", "audio", "inventory_scan", "receipt"];
const RANGES: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_NUMBERS = ["userId", "durationMs", "eventCount", "actionCount", "modelCallCount", "promptTokens",
  "completionTokens", "totalTokens", "estimatedCostUsd"];
const USAGE_NUMBERS = ["modelCalls", "promptTokens", "completionTokens", "totalTokens", "estimatedCostUsd", "avgLatencyMs"];

export class AdminAgentRunsService {
  private readonly repository: AdminAgentRunsRepository;
  private readonly checkpointReader: (runId: string) => Promise<PublicCheckpointState>;
  constructor(repository: AdminAgentRunsRepository, checkpointReader: (runId: string) => Promise<PublicCheckpointState> = async () => null) {
    this.repository = repository;
    this.checkpointReader = checkpointReader;
  }

  async list(query: Row) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 25));
    const status = typeof query.status === "string" && STATUSES.includes(query.status) ? query.status : undefined;
    const modality = typeof query.modality === "string" && MODALITIES.includes(query.modality) ? query.modality : undefined;
    const agent = typeof query.agent === "string" && query.agent.trim() ? query.agent.trim().slice(0, 80) : undefined;
    const search = typeof query.query === "string" && query.query.trim() ? query.query.trim().slice(0, 120) : undefined;
    const range = typeof query.range === "string" && query.range in RANGES ? query.range : "30d";
    const data = await this.repository.list({ page, pageSize, status, modality, agent, search, rangeDays: RANGES[range]! });
    const items: Row[] = data.rows.map(({ inputJson, ...row }) => ({ ...this.numeric(row, LIST_NUMBERS),
      hasMedia: Number(Boolean(row.hasMedia)), promptPreview: this.promptPreview(inputJson) }));
    return { items, total: data.total, page, pageSize, range,
    statusCounts: data.statusCounts.map((row) => this.numeric(row, ["count"])),
    usageSummary: this.numeric(data.usageSummary, USAGE_NUMBERS) };
  }

  async detail(runId: string) {
    if (!RUN_ID.test(runId)) throw new AdminAgentRunsError(400, "Agent Run ID 无效");
    const data = await this.repository.detail(runId);
    if (!data) throw new AdminAgentRunsError(404, "Agent Run 不存在");
    const storedResult = this.parseJson(data.run.resultJson, {}) as Record<string, unknown>;
    const storedArtifacts = Array.isArray(storedResult.artifacts) ? storedResult.artifacts : [];
    const safeInput = this.publicInput(data.run.inputJson);
    let checkpointState: PublicCheckpointState = null;
    if (data.checkpointAvailable) {
      try { checkpointState = await this.checkpointReader(runId); } catch { /* Historical recovery is best-effort. */ }
    }
    const actions = data.actions.map(({ payloadJson, beforeJson, resultJson, ...action }) => ({
      ...action, payload: this.parseJson(payloadJson, {}), before: this.parseJson(beforeJson), result: this.parseJson(resultJson),
    }));
    const events = data.events.map(({ payloadJson, ...event }) => {
      const savedPayload = this.parseJson(payloadJson);
      if (savedPayload !== null && savedPayload !== undefined) {
        if (event.agentName === "Supervisor" && event.eventType === "routing_completed" && checkpointState?.goal
          && typeof savedPayload === "object") return { ...event, payload: { ...(savedPayload as Row), goal: checkpointState.goal,
            recoveredFromCheckpoint: true } };
        return { ...event, payload: savedPayload };
      }
      if (event.eventType === "run_created") return { ...event, payload: { input: safeInput, recoveredFromRun: true } };
      if (event.eventType === "agent_completed" && checkpointState?.outputs[event.agentName as string] !== undefined) {
        return { ...event, payload: { ...(checkpointState.outputs[event.agentName as string] as Row), recoveredFromCheckpoint: true } };
      }
      if (event.agentName === "OperationsAgent" && event.eventType === "agent_completed" && actions.length) {
        return { ...event, payload: { actions, recoveredFromRun: true } };
      }
      if (event.eventType === "specialist_results_validated" && storedArtifacts.length) {
        return { ...event, payload: { artifacts: storedArtifacts, recoveredFromRun: true } };
      }
      if (event.agentName === "Supervisor" && event.eventType === "run_completed" && Object.keys(storedResult).length) {
        return { ...event, payload: { ...storedResult, recoveredFromRun: true } };
      }
      if (event.agentName === "Supervisor" && event.eventType === "synthesis_started" && checkpointState) {
        return { ...event, payload: { specialists: checkpointState.specialists, artifactCount: checkpointState.artifactCount,
          actionCount: actions.length, recoveredFromCheckpoint: true } };
      }
      return { ...event, payload: null };
    });
    const row = data.run;
    const run = { id: row.id, userId: Number(row.userId), username: row.username, sessionId: row.sessionId,
      modality: row.modality, source: row.source, status: row.status, input: safeInput, result: storedResult,
      pendingApproval: this.parseJson(row.pendingApprovalJson), pendingInput: this.parseJson(row.pendingInputJson),
      error: row.errorCode || row.errorMessage ? { code: row.errorCode, message: row.errorMessage } : null,
      hasMedia: Boolean(row.hasMedia), checkpointCount: data.checkpointCount, checkpointWriteCount: data.checkpointWriteCount,
      startedAt: row.startedAt, completedAt: row.completedAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
    return { run, events, actions, usage: { summary: this.numeric(data.usageSummary, USAGE_NUMBERS),
      byAgent: data.usageByAgent.map((item) => this.numeric(item, USAGE_NUMBERS)),
      records: data.usageRecords.map((item) => ({ ...this.numeric(item,
        ["id", "promptTokens", "completionTokens", "totalTokens", "estimatedCostUsd", "latencyMs"]),
      success: Number(Boolean(item.success)) })) } };
  }

  private parseJson(value: unknown, fallback: unknown = null): unknown {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }
  private publicInput(value: unknown) {
    const input = this.parseJson(value, {}) as Row;
    const { image: _image, audioBase64: _audio, mediaRef: _mediaRef, ...safe } = input;
    return safe;
  }
  private promptPreview(value: unknown) {
    const input = this.publicInput(value);
    const direct = typeof input.prompt === "string" ? input.prompt : "";
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const latest = [...messages].reverse().find((message) => message && typeof message === "object"
      && (message as { role?: unknown }).role === "user") as { content?: unknown } | undefined;
    const text = direct || (typeof latest?.content === "string" ? latest.content : "")
      || (typeof input.period === "string" ? input.period : "");
    return text.trim().slice(0, 240);
  }
  private numeric(row: Row, keys: string[]): Row { const copy = { ...row }; for (const key of keys) copy[key] = Number(copy[key] || 0); return copy; }
}
