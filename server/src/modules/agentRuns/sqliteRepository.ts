import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AgentActionProposal, AgentInput, AgentRunEvent, AgentRunStatus, SpecialistName } from "../../services/agent/types.js";
import { agentActionProposalIndex } from "./repository.js";
import type {
  AgentRunAction,
  AgentRunMedia,
  AgentRunRow,
  AgentRunsRepository,
  AgentRunStatusFields,
} from "./repository.js";

export class SqliteAgentRunsRepository implements AgentRunsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async createRun(userId: number, input: AgentInput) {
    const id = randomUUID();
    const sessionId = input.sessionId?.trim().slice(0, 120) || randomUUID();
    const mediaData = input.image || input.audioBase64;
    const mediaRef = mediaData ? randomUUID() : undefined;
    const persistedInput: AgentInput = { ...input, sessionId, mediaRef, image: undefined, audioBase64: undefined };
    return this.database.transaction(() => {
      if (input.idempotencyKey) {
        const reusable = this.database.prepare(`SELECT id,session_id FROM agent_runs WHERE user_id=?
          AND json_extract(input_json,'$.idempotencyKey')=?
          AND status IN ('queued','running','awaiting_approval','completed')
          AND (created_at >= datetime('now','-15 minutes') OR (?=1 AND modality='inventory_scan')) ORDER BY created_at DESC LIMIT 1`)
          .get(userId, input.idempotencyKey, input.modality === "inventory_scan" && input.idempotencyKey.startsWith("inventory-photo:") ? 1 : 0) as { id: string; session_id: string } | undefined;
        if (reusable) return { id: reusable.id, sessionId: reusable.session_id };
      }
      this.database.prepare(`INSERT INTO agent_runs
        (id,user_id,session_id,modality,source,input_json,checkpoint_thread_id) VALUES(?,?,?,?,?,?,?)`)
        .run(id, userId, sessionId, input.modality, input.source || "assistant", JSON.stringify(persistedInput), id);
      if (mediaRef && mediaData) {
        this.database.prepare(`INSERT INTO agent_run_media
          (id,run_id,user_id,kind,mime_type,data_base64) VALUES(?,?,?,?,?,?)`)
          .run(mediaRef, id, userId, input.audioBase64 ? "audio" : "image", input.mimeType || null, mediaData);
      }
      const { mediaRef: _mediaRef, image: _image, audioBase64: _audioBase64, ...publicEventInput } = persistedInput;
      this.insertEvent(id, userId, "Supervisor", "run_created", "已创建 AI Agent 任务", {
        input: publicEventInput,
        hasMedia: Boolean(mediaRef),
      });
      return { id, sessionId };
    })();
  }

  async media(runId: string, userId: number) {
    return this.database.prepare(`SELECT id,kind,mime_type,data_base64 FROM agent_run_media
      WHERE run_id=? AND user_id=? LIMIT 1`).get(runId, userId) as AgentRunMedia | undefined;
  }

  async run(runId: string, userId?: number) {
    return (userId === undefined
      ? this.database.prepare("SELECT * FROM agent_runs WHERE id=?").get(runId)
      : this.database.prepare("SELECT * FROM agent_runs WHERE id=? AND user_id=?").get(runId, userId)) as AgentRunRow | undefined;
  }

  async reusableRun(userId: number, idempotencyKey: string, maxAgeMinutes: number) {
    return this.database.prepare(`SELECT * FROM agent_runs WHERE user_id=?
      AND json_extract(input_json,'$.idempotencyKey')=?
      AND status IN ('queued','running','awaiting_approval','completed')
      AND created_at >= datetime('now',?) ORDER BY created_at DESC LIMIT 1`)
      .get(userId, idempotencyKey, `-${maxAgeMinutes} minutes`) as AgentRunRow | undefined;
  }

  async setStatus(runId: string, status: AgentRunStatus, fields: AgentRunStatusFields) {
    const updated = this.database.prepare(`UPDATE agent_runs SET status=?,result_json=COALESCE(?,result_json),
      pending_approval_json=CASE WHEN ?=1 THEN ? ELSE pending_approval_json END,
      pending_input_json=CASE WHEN ?=1 THEN ? ELSE pending_input_json END,
      error_code=?,error_message=?,
      started_at=CASE WHEN ?='queued' THEN NULL WHEN ?='running' AND started_at IS NULL
        THEN strftime('%Y-%m-%d %H:%M:%f','now') ELSE started_at END,
      completed_at=CASE WHEN ?='queued' THEN NULL WHEN ? IN ('completed','failed','cancelled','expired')
        THEN strftime('%Y-%m-%d %H:%M:%f','now') ELSE completed_at END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?
      AND (status NOT IN ('completed','failed','cancelled','expired') OR (?='queued' AND status='failed'))`).run(
      status,
      fields.result === undefined ? null : JSON.stringify(fields.result),
      fields.pendingApproval === undefined ? 0 : 1,
      fields.pendingApproval ? JSON.stringify(fields.pendingApproval) : null,
      fields.pendingInput === undefined ? 0 : 1,
      fields.pendingInput ? JSON.stringify(fields.pendingInput) : null,
      fields.errorCode ?? null,
      fields.errorMessage ?? null,
      status, status, status, status, runId, status,
    );
    return updated.changes === 1;
  }

  async appendEvent(runId: string, userId: number, agentName: SpecialistName, eventType: string,
    summary: string, payload?: unknown) {
    return this.database.transaction(() => this.insertEvent(runId, userId, agentName, eventType, summary, payload))();
  }

  async events(runId: string, userId: number, afterSequence: number) {
    return (this.database.prepare(`SELECT sequence,agent_name,event_type,summary,payload_json,created_at
      FROM agent_run_events WHERE run_id=? AND user_id=? AND sequence>? ORDER BY sequence ASC LIMIT 200`)
      .all(runId, userId, afterSequence) as Array<Record<string, unknown>>).map((row): AgentRunEvent => ({
        sequence: Number(row.sequence),
        agentName: row.agent_name as SpecialistName,
        eventType: String(row.event_type),
        summary: String(row.summary),
        payload: this.json(String(row.payload_json || ""), undefined),
        createdAt: String(row.created_at),
      }));
  }

  async saveActions(runId: string, userId: number, proposals: AgentActionProposal[]) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`SELECT id,action_type,idempotency_key,version FROM agent_actions
        WHERE run_id=? AND user_id=?`).all(runId, userId) as Array<{
          id: string; action_type: string; idempotency_key: string; version: number;
        }>;
      if (existing.length) {
        const byIdempotencyKey = new Map(existing.map((item) => [item.idempotency_key, item]));
        if (existing.length !== proposals.length
          || proposals.some((proposal, index) => {
            const item = byIdempotencyKey.get(`${runId}:${index}:${proposal.actionType}`);
            return !item || item.action_type !== proposal.actionType;
          })) {
          throw new Error("Agent action bundle 已变化，请刷新后重试");
        }
        return proposals.map((proposal, index) => {
          const item = byIdempotencyKey.get(`${runId}:${index}:${proposal.actionType}`)!;
          return { ...proposal, id: item.id, version: item.version };
        });
      }
      const insert = this.database.prepare(`INSERT INTO agent_actions
        (id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key,expires_at)
        VALUES(?,?,?,?,?,?,?,?,datetime('now','+24 hours'))`);
      return proposals.map((proposal, index) => {
        const id = randomUUID();
        insert.run(id, runId, userId, proposal.actionType, proposal.riskLevel,
          proposal.riskLevel === "low" ? "proposed" : "awaiting_approval",
          JSON.stringify(proposal.payload), `${runId}:${index}:${proposal.actionType}`);
        return { ...proposal, id, version: 1 };
      });
    })();
  }

  async updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown }) {
    this.database.prepare(`UPDATE agent_actions SET status=?,before_json=COALESCE(?,before_json),
      result_json=COALESCE(?,result_json),executed_at=CASE WHEN ?='executed' THEN CURRENT_TIMESTAMP ELSE executed_at END,
      undone_at=CASE WHEN ?='undone' THEN CURRENT_TIMESTAMP ELSE undone_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, fields.before === undefined ? null : JSON.stringify(fields.before),
        fields.result === undefined ? null : JSON.stringify(fields.result), status, status, actionId);
  }

  async recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit") {
    this.database.transaction(() => {
      const update = this.database.prepare(`UPDATE agent_actions SET approval_decision=?,approved_by_user_id=?,
        approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='awaiting_approval'`);
      for (const id of actionIds) update.run(decision, userId, id, userId);
    })();
  }

  async actions(runId: string, userId: number) {
    const rows = this.database.prepare("SELECT * FROM agent_actions WHERE run_id=? AND user_id=? ORDER BY created_at,id")
      .all(runId, userId) as Array<Record<string, unknown>>;
    rows.sort((left, right) => agentActionProposalIndex(runId, left.idempotency_key)
      - agentActionProposalIndex(runId, right.idempotency_key));
    return rows.map((row): AgentRunAction => ({
        id: String(row.id),
        actionType: String(row.action_type) as AgentActionProposal["actionType"],
        riskLevel: String(row.risk_level) as AgentActionProposal["riskLevel"],
        status: String(row.status),
        payload: this.json(String(row.payload_json), {}),
        before: this.json(String(row.before_json || ""), undefined),
        result: this.json(String(row.result_json || ""), undefined),
        version: Number(row.version),
        createdAt: String(row.created_at),
        executedAt: row.executed_at ? String(row.executed_at) : undefined,
    }));
  }

  async reviseActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>) {
    this.database.transaction(() => {
      const update = this.database.prepare(`UPDATE agent_actions SET action_type=?,risk_level=?,payload_json=?,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND run_id=? AND user_id=? AND status='awaiting_approval'`);
      for (const action of actions) {
        if (!action.id) throw new Error("编辑后的操作缺少 ID");
        if (update.run(action.actionType, action.riskLevel, JSON.stringify(action.payload), action.id, runId, userId).changes !== 1) {
          throw new Error("待批准操作已变化，请刷新后重试");
        }
      }
    })();
  }

  async recoverableRuns() {
    return this.database.prepare(`SELECT id FROM agent_runs WHERE status IN ('queued','running')
      ORDER BY created_at ASC LIMIT 100`).all() as Array<{ id: string }>;
  }

  async deleteUserData(userId: number) {
    return this.database.transaction(() => {
      const threads = this.database.prepare("SELECT checkpoint_thread_id FROM agent_runs WHERE user_id=?")
        .all(userId) as Array<{ checkpoint_thread_id: string }>;
      const hasCheckpoints = Boolean(this.database.prepare(`SELECT name FROM sqlite_master
        WHERE type='table' AND name='checkpoints'`).get());
      if (hasCheckpoints) {
        const deleteCheckpoint = this.database.prepare("DELETE FROM checkpoints WHERE thread_id=?");
        const deleteWrites = this.database.prepare("DELETE FROM writes WHERE thread_id=?");
        for (const thread of threads) {
          deleteWrites.run(thread.checkpoint_thread_id);
          deleteCheckpoint.run(thread.checkpoint_thread_id);
        }
      }
      return this.database.prepare("DELETE FROM agent_runs WHERE user_id=?").run(userId).changes;
    })();
  }

  private insertEvent(runId: string, userId: number, agentName: SpecialistName, eventType: string,
    summary: string, payload?: unknown) {
    const next = this.database.prepare(`SELECT COALESCE(MAX(sequence),0)+1 AS sequence
      FROM agent_run_events WHERE run_id=?`).get(runId) as { sequence: number };
    this.database.prepare(`INSERT INTO agent_run_events
      (run_id,user_id,sequence,agent_name,event_type,summary,payload_json) VALUES(?,?,?,?,?,?,?)`)
      .run(runId, userId, next.sequence, agentName, eventType, summary,
        payload === undefined ? null : JSON.stringify(payload));
    return next.sequence;
  }

  private json<T>(value: string | null, fallback: T): T {
    if (!value) return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
}
