import type Database from "better-sqlite3";
import type { AdminAgentRunsRepository } from "./repository.js";
import type { AgentRunDetailData, AgentRunListQuery, Row } from "./types.js";

export class SqliteAdminAgentRunsRepository implements AdminAgentRunsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async list(input: AgentRunListQuery) {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (input.status) { conditions.push("r.status=?"); params.push(input.status); }
    if (input.modality) { conditions.push("r.modality=?"); params.push(input.modality); }
    if (input.rangeDays !== null) { conditions.push("r.created_at>=datetime('now',?)"); params.push(`-${input.rangeDays} days`); }
    if (input.search) { const pattern = `%${input.search}%`; conditions.push(`(r.id LIKE ? OR r.session_id LIKE ?
      OR u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?)`); params.push(pattern, pattern, pattern, pattern); }
    if (input.agent) { conditions.push(`EXISTS(SELECT 1 FROM agent_run_events af
      WHERE af.run_id=r.id AND af.agent_name=?)`); params.push(input.agent); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM agent_runs r JOIN users u ON u.id=r.user_id ${where}`)
      .get(...params) as { count: number }).count);
    const rows = this.database.prepare(`SELECT r.id,r.user_id AS userId,u.username,r.session_id AS sessionId,
      r.modality,r.source,r.status,r.input_json AS inputJson,r.error_code AS errorCode,r.error_message AS errorMessage,
      r.started_at AS startedAt,r.completed_at AS completedAt,r.created_at AS createdAt,r.updated_at AS updatedAt,
      ROUND((julianday(COALESCE(r.completed_at,r.updated_at))-julianday(COALESCE(r.started_at,r.created_at)))*86400000) AS durationMs,
      (SELECT COUNT(*) FROM agent_run_events e WHERE e.run_id=r.id) AS eventCount,
      (SELECT COUNT(*) FROM agent_actions a WHERE a.run_id=r.id) AS actionCount,
      (SELECT COUNT(*) FROM ai_usage_logs l WHERE l.run_id=r.id) AS modelCallCount,
      (SELECT COALESCE(SUM(l.prompt_tokens),0) FROM ai_usage_logs l WHERE l.run_id=r.id) AS promptTokens,
      (SELECT COALESCE(SUM(l.completion_tokens),0) FROM ai_usage_logs l WHERE l.run_id=r.id) AS completionTokens,
      (SELECT COALESCE(SUM(l.total_tokens),0) FROM ai_usage_logs l WHERE l.run_id=r.id) AS totalTokens,
      (SELECT COALESCE(ROUND(SUM(l.estimated_cost_usd),6),0) FROM ai_usage_logs l WHERE l.run_id=r.id) AS estimatedCostUsd,
      EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id=r.id) AS hasMedia,
      (SELECT GROUP_CONCAT(agent_name,',') FROM (SELECT DISTINCT e.agent_name FROM agent_run_events e
        WHERE e.run_id=r.id AND e.agent_name NOT IN ('Supervisor','PolicyGate') ORDER BY e.sequence)) AS specialists,
      (SELECT e.summary FROM agent_run_events e WHERE e.run_id=r.id ORDER BY e.sequence DESC LIMIT 1) AS lastEventSummary
      FROM agent_runs r JOIN users u ON u.id=r.user_id ${where}
      ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?`).all(...params, input.pageSize,
      (input.page - 1) * input.pageSize) as Row[];
    const statusCounts = this.database.prepare(`SELECT r.status,COUNT(*) AS count FROM agent_runs r JOIN users u ON u.id=r.user_id
      ${where} GROUP BY r.status`).all(...params) as Row[];
    const usageSummary = this.database.prepare(`SELECT COUNT(l.id) AS modelCalls,COALESCE(SUM(l.prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(l.completion_tokens),0) AS completionTokens,COALESCE(SUM(l.total_tokens),0) AS totalTokens,
      COALESCE(ROUND(SUM(l.estimated_cost_usd),6),0) AS estimatedCostUsd FROM agent_runs r JOIN users u ON u.id=r.user_id
      LEFT JOIN ai_usage_logs l ON l.run_id=r.id ${where}`).get(...params) as Row;
    return { rows, total, statusCounts, usageSummary };
  }

  async detail(runId: string): Promise<AgentRunDetailData | null> {
    const run = this.database.prepare(`SELECT r.id,r.user_id AS userId,u.username,r.session_id AS sessionId,r.modality,r.source,
      r.status,r.input_json AS inputJson,r.result_json AS resultJson,r.pending_approval_json AS pendingApprovalJson,
      r.pending_input_json AS pendingInputJson,r.error_code AS errorCode,r.error_message AS errorMessage,
      r.checkpoint_thread_id AS checkpointThreadId,r.started_at AS startedAt,r.completed_at AS completedAt,
      r.created_at AS createdAt,r.updated_at AS updatedAt,EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id=r.id) AS hasMedia
      FROM agent_runs r JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(runId) as Row | undefined;
    if (!run) return null;
    const checkpointAvailable = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checkpoints'").get());
    const writesAvailable = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='writes'").get());
    const threadId = String(run.checkpointThreadId);
    const checkpointCount = checkpointAvailable ? Number((this.database.prepare("SELECT COUNT(*) AS count FROM checkpoints WHERE thread_id=?")
      .get(threadId) as { count: number }).count) : 0;
    const checkpointWriteCount = writesAvailable ? Number((this.database.prepare("SELECT COUNT(*) AS count FROM writes WHERE thread_id=?")
      .get(threadId) as { count: number }).count) : 0;
    const events = this.database.prepare(`SELECT sequence,agent_name AS agentName,event_type AS eventType,summary,
      payload_json AS payloadJson,created_at AS createdAt FROM agent_run_events WHERE run_id=? ORDER BY sequence`).all(runId) as Row[];
    const actions = this.database.prepare(`SELECT id,action_type AS actionType,risk_level AS riskLevel,status,payload_json AS payloadJson,
      before_json AS beforeJson,result_json AS resultJson,version,expires_at AS expiresAt,approval_decision AS approvalDecision,
      approved_by_user_id AS approvedByUserId,approved_at AS approvedAt,executed_at AS executedAt,undone_at AS undoneAt,
      created_at AS createdAt,updated_at AS updatedAt FROM agent_actions WHERE run_id=? ORDER BY created_at,id`).all(runId) as Row[];
    const usageRecords = this.database.prepare(`SELECT id,agent_name AS agentName,phase,endpoint,model,prompt_tokens AS promptTokens,
      completion_tokens AS completionTokens,total_tokens AS totalTokens,estimated_cost_usd AS estimatedCostUsd,latency_ms AS latencyMs,
      success,failure_reason AS failureReason,created_at AS createdAt FROM ai_usage_logs WHERE run_id=? ORDER BY id`).all(runId) as Row[];
    const usageSummary = this.database.prepare(`SELECT COUNT(*) AS modelCalls,COALESCE(SUM(prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(completion_tokens),0) AS completionTokens,COALESCE(SUM(total_tokens),0) AS totalTokens,
      COALESCE(ROUND(SUM(estimated_cost_usd),6),0) AS estimatedCostUsd,COALESCE(ROUND(AVG(latency_ms)),0) AS avgLatencyMs
      FROM ai_usage_logs WHERE run_id=?`).get(runId) as Row;
    const usageByAgent = this.database.prepare(`SELECT COALESCE(agent_name,'Unknown') AS agentName,COUNT(*) AS modelCalls,
      COALESCE(SUM(prompt_tokens),0) AS promptTokens,COALESCE(SUM(completion_tokens),0) AS completionTokens,
      COALESCE(SUM(total_tokens),0) AS totalTokens,COALESCE(ROUND(SUM(estimated_cost_usd),6),0) AS estimatedCostUsd
      FROM ai_usage_logs WHERE run_id=? GROUP BY COALESCE(agent_name,'Unknown') ORDER BY totalTokens DESC,modelCalls DESC`).all(runId) as Row[];
    return { run, checkpointAvailable, checkpointCount, checkpointWriteCount, events, actions, usageSummary, usageByAgent, usageRecords };
  }
}
