import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AgentActionProposal, AgentInput, AgentRunEvent, AgentRunStatus, SpecialistName } from "../../services/agent/types.js";
import { agentActionProposalIndex } from "./repository.js";
import type {
  AgentRunAction,
  AgentRunMedia,
  AgentRunRow,
  AgentRunsRepository,
  AgentRunStatusFields,
} from "./repository.js";

type Row = Record<string, unknown>;

export class PostgresAgentRunsRepository implements AgentRunsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async createRun(userId: number, input: AgentInput) {
    const id = randomUUID();
    const sessionId = input.sessionId?.trim().slice(0, 120) || randomUUID();
    const mediaData = input.image || input.audioBase64;
    const mediaRef = mediaData ? randomUUID() : undefined;
    const persistedInput: AgentInput = { ...input, sessionId, mediaRef, image: undefined, audioBase64: undefined };
    return this.transaction(async (client) => {
      if (input.idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`agent-run-idempotency:${userId}:${input.idempotencyKey}`]);
        const reusable = (await client.query(`SELECT id,session_id FROM agent_runs WHERE user_id=$1
          AND input_json->>'idempotencyKey'=$2
          AND status IN ('queued','running','awaiting_approval','completed')
          AND (created_at >= CURRENT_TIMESTAMP-INTERVAL '15 minutes' OR ($3::boolean AND modality='inventory_scan')) ORDER BY created_at DESC LIMIT 1`,
        [userId, input.idempotencyKey, input.modality === "inventory_scan" && input.idempotencyKey.startsWith("inventory-photo:")])).rows[0] as Row | undefined;
        if (reusable) return { id: String(reusable.id), sessionId: String(reusable.session_id) };
      }
      await client.query(`INSERT INTO agent_runs
        (id,user_id,session_id,modality,source,input_json,checkpoint_thread_id)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [id, userId, sessionId, input.modality, input.source || "assistant", JSON.stringify(persistedInput), id]);
      if (mediaRef && mediaData) {
        await client.query(`INSERT INTO agent_run_media
          (id,run_id,user_id,kind,mime_type,data_base64) VALUES($1,$2,$3,$4,$5,$6)`,
        [mediaRef, id, userId, input.audioBase64 ? "audio" : "image", input.mimeType || null, mediaData]);
      }
      const { mediaRef: _mediaRef, image: _image, audioBase64: _audioBase64, ...publicEventInput } = persistedInput;
      await this.insertEvent(client, id, userId, "Supervisor", "run_created", "已创建 AI Agent 任务", {
        input: publicEventInput,
        hasMedia: Boolean(mediaRef),
      }, false);
      return { id, sessionId };
    });
  }

  async media(runId: string, userId: number) {
    const row = (await this.pool.query(`SELECT id,kind,mime_type,data_base64 FROM agent_run_media
      WHERE run_id=$1 AND user_id=$2 LIMIT 1`, [runId, userId])).rows[0] as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      kind: String(row.kind) as AgentRunMedia["kind"],
      mime_type: row.mime_type == null ? null : String(row.mime_type),
      data_base64: String(row.data_base64),
    };
  }

  async run(runId: string, userId?: number) {
    const result = userId === undefined
      ? await this.pool.query("SELECT * FROM agent_runs WHERE id=$1", [runId])
      : await this.pool.query("SELECT * FROM agent_runs WHERE id=$1 AND user_id=$2", [runId, userId]);
    return result.rows[0] ? this.runRow(result.rows[0] as Row) : undefined;
  }

  async reusableRun(userId: number, idempotencyKey: string, maxAgeMinutes: number) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    const row = (await this.pool.query(`SELECT * FROM agent_runs WHERE user_id=$1
      AND input_json->>'idempotencyKey'=$2
      AND status IN ('queued','running','awaiting_approval','completed')
      AND created_at >= $3::timestamptz ORDER BY created_at DESC LIMIT 1`,
    [userId, idempotencyKey, cutoff])).rows[0] as Row | undefined;
    return row ? this.runRow(row) : undefined;
  }

  async setStatus(runId: string, status: AgentRunStatus, fields: AgentRunStatusFields) {
    const updated = await this.pool.query(`UPDATE agent_runs SET status=$1,result_json=COALESCE($2::jsonb,result_json),
      pending_approval_json=CASE WHEN $3::boolean THEN $4::jsonb ELSE pending_approval_json END,
      pending_input_json=CASE WHEN $5::boolean THEN $6::jsonb ELSE pending_input_json END,
      error_code=$7,error_message=$8,
      started_at=CASE WHEN $1='queued' THEN NULL WHEN $1='running' AND started_at IS NULL
        THEN CURRENT_TIMESTAMP ELSE started_at END,
      completed_at=CASE WHEN $1='queued' THEN NULL WHEN $1 IN ('completed','failed','cancelled','expired')
        THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$9
      AND (status NOT IN ('completed','failed','cancelled','expired') OR ($1='queued' AND status='failed'))`, [
      status,
      fields.result === undefined ? null : JSON.stringify(fields.result),
      fields.pendingApproval !== undefined,
      fields.pendingApproval ? JSON.stringify(fields.pendingApproval) : null,
      fields.pendingInput !== undefined,
      fields.pendingInput ? JSON.stringify(fields.pendingInput) : null,
      fields.errorCode ?? null,
      fields.errorMessage ?? null,
      runId,
    ]);
    return updated.rowCount === 1;
  }

  async appendEvent(runId: string, userId: number, agentName: SpecialistName, eventType: string,
    summary: string, payload?: unknown) {
    return this.transaction((client) => this.insertEvent(client, runId, userId, agentName, eventType, summary, payload, true));
  }

  async events(runId: string, userId: number, afterSequence: number) {
    const rows = (await this.pool.query(`SELECT sequence,agent_name,event_type,summary,payload_json,created_at
      FROM agent_run_events WHERE run_id=$1 AND user_id=$2 AND sequence>$3
      ORDER BY sequence ASC LIMIT 200`, [runId, userId, afterSequence])).rows as Row[];
    return rows.map((row): AgentRunEvent => ({
      sequence: Number(row.sequence),
      agentName: String(row.agent_name) as SpecialistName,
      eventType: String(row.event_type),
      summary: String(row.summary),
      payload: row.payload_json ?? undefined,
      createdAt: this.iso(row.created_at),
    }));
  }

  async saveActions(runId: string, userId: number, proposals: AgentActionProposal[]) {
    return this.transaction(async (client) => {
      const owner = await client.query("SELECT id FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE", [runId, userId]);
      if (!owner.rows[0]) throw new Error("Agent Run 不存在或无权操作");
      const existing = (await client.query(`SELECT id,action_type,idempotency_key,version FROM agent_actions
        WHERE run_id=$1 AND user_id=$2`, [runId, userId])).rows as Row[];
      if (existing.length) {
        const byIdempotencyKey = new Map(existing.map((item) => [String(item.idempotency_key), item]));
        if (existing.length !== proposals.length
          || proposals.some((proposal, index) => {
            const item = byIdempotencyKey.get(`${runId}:${index}:${proposal.actionType}`);
            return !item || item.action_type !== proposal.actionType;
          })) {
          throw new Error("Agent action bundle 已变化，请刷新后重试");
        }
        return proposals.map((proposal, index) => {
          const item = byIdempotencyKey.get(`${runId}:${index}:${proposal.actionType}`)!;
          return { ...proposal, id: String(item.id), version: Number(item.version) };
        });
      }
      const saved: Array<AgentActionProposal & { id: string }> = [];
      for (const [index, proposal] of proposals.entries()) {
        const id = randomUUID();
        await client.query(`INSERT INTO agent_actions
          (id,run_id,user_id,action_type,risk_level,status,payload_json,idempotency_key,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,CURRENT_TIMESTAMP+INTERVAL '24 hours')`, [
          id, runId, userId, proposal.actionType, proposal.riskLevel,
          proposal.riskLevel === "low" ? "proposed" : "awaiting_approval",
          JSON.stringify(proposal.payload), `${runId}:${index}:${proposal.actionType}`,
        ]);
        saved.push({ ...proposal, id, version: 1 });
      }
      return saved;
    });
  }

  async updateActionStatus(actionId: string, status: string, fields: { before?: unknown; result?: unknown }) {
    await this.pool.query(`UPDATE agent_actions SET status=$1,before_json=COALESCE($2::jsonb,before_json),
      result_json=COALESCE($3::jsonb,result_json),executed_at=CASE WHEN $1='executed' THEN CURRENT_TIMESTAMP ELSE executed_at END,
      undone_at=CASE WHEN $1='undone' THEN CURRENT_TIMESTAMP ELSE undone_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
    [status, fields.before === undefined ? null : JSON.stringify(fields.before),
      fields.result === undefined ? null : JSON.stringify(fields.result), actionId]);
  }

  async recordActionDecision(actionIds: string[], userId: number, decision: "approve" | "reject" | "edit") {
    if (!actionIds.length) return;
    await this.pool.query(`UPDATE agent_actions SET approval_decision=$1,approved_by_user_id=$2,
      approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=ANY($3::text[]) AND user_id=$2 AND status='awaiting_approval'`, [decision, userId, actionIds]);
  }

  async actions(runId: string, userId: number) {
    const rows = (await this.pool.query(`SELECT * FROM agent_actions WHERE run_id=$1 AND user_id=$2
      ORDER BY created_at,id`, [runId, userId])).rows as Row[];
    rows.sort((left, right) => agentActionProposalIndex(runId, left.idempotency_key)
      - agentActionProposalIndex(runId, right.idempotency_key));
    return rows.map((row): AgentRunAction => ({
      id: String(row.id),
      actionType: String(row.action_type) as AgentActionProposal["actionType"],
      riskLevel: String(row.risk_level) as AgentActionProposal["riskLevel"],
      status: String(row.status),
      payload: (row.payload_json ?? {}) as Record<string, unknown>,
      before: row.before_json ?? undefined,
      result: row.result_json ?? undefined,
      version: Number(row.version),
      createdAt: this.iso(row.created_at),
      executedAt: row.executed_at == null ? undefined : this.iso(row.executed_at),
    }));
  }

  async reviseActions(runId: string, userId: number, actions: Array<AgentActionProposal & { id?: string }>) {
    await this.transaction(async (client) => {
      await client.query("SELECT id FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE", [runId, userId]);
      for (const action of actions) {
        if (!action.id) throw new Error("编辑后的操作缺少 ID");
        const updated = await client.query(`UPDATE agent_actions SET action_type=$1,risk_level=$2,payload_json=$3::jsonb,
          version=version+1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$4 AND run_id=$5 AND user_id=$6 AND status='awaiting_approval'`,
        [action.actionType, action.riskLevel, JSON.stringify(action.payload), action.id, runId, userId]);
        if (updated.rowCount !== 1) throw new Error("待批准操作已变化，请刷新后重试");
      }
    });
  }

  async recoverableRuns() {
    const rows = (await this.pool.query(`SELECT id FROM agent_runs WHERE status IN ('queued','running')
      ORDER BY created_at ASC LIMIT 100`)).rows as Row[];
    return rows.map((row) => ({ id: String(row.id) }));
  }

  async deleteUserData(userId: number) {
    const deleted = await this.pool.query("DELETE FROM agent_runs WHERE user_id=$1", [userId]);
    return deleted.rowCount ?? 0;
  }

  private async insertEvent(client: PoolClient, runId: string, userId: number, agentName: SpecialistName,
    eventType: string, summary: string, payload: unknown, lock: boolean) {
    if (lock) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`agent-run-event:${runId}`]);
    }
    const inserted = await client.query(`INSERT INTO agent_run_events
      (run_id,user_id,sequence,agent_name,event_type,summary,payload_json)
      SELECT $1,$2,COALESCE(MAX(sequence),0)+1,$3,$4,$5,$6::jsonb FROM agent_run_events WHERE run_id=$1
      RETURNING sequence`, [runId, userId, agentName, eventType, summary,
      payload === undefined ? null : JSON.stringify(payload)]);
    return Number(inserted.rows[0]?.sequence);
  }

  private runRow(row: Row): AgentRunRow {
    const json = (value: unknown) => value == null ? null : JSON.stringify(value);
    return {
      id: String(row.id),
      user_id: Number(row.user_id),
      session_id: String(row.session_id),
      modality: String(row.modality) as AgentInput["modality"],
      source: String(row.source),
      status: String(row.status) as AgentRunStatus,
      input_json: json(row.input_json) || "{}",
      result_json: json(row.result_json),
      pending_approval_json: json(row.pending_approval_json),
      pending_input_json: json(row.pending_input_json),
      error_code: row.error_code == null ? null : String(row.error_code),
      error_message: row.error_message == null ? null : String(row.error_message),
      checkpoint_thread_id: String(row.checkpoint_thread_id),
      started_at: row.started_at == null ? null : this.iso(row.started_at),
      completed_at: row.completed_at == null ? null : this.iso(row.completed_at),
      created_at: this.iso(row.created_at),
      updated_at: this.iso(row.updated_at),
    };
  }

  private iso(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
