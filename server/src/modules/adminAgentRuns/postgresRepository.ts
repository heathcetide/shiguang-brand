import type { Pool } from "pg";
import type { AdminAgentRunsRepository } from "./repository.js";
import type { AgentRunDetailData, AgentRunListQuery, Row } from "./types.js";

export class PostgresAdminAgentRunsRepository implements AdminAgentRunsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async list(input: AgentRunListQuery) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.status) conditions.push(`r.status=${bind(input.status)}`);
    if (input.modality) conditions.push(`r.modality=${bind(input.modality)}`);
    if (input.rangeDays !== null) conditions.push(`r.created_at>=NOW()-(${bind(input.rangeDays)}::integer*INTERVAL '1 day')`);
    if (input.search) { const value = bind(`%${input.search}%`); conditions.push(`(r.id ILIKE ${value} OR r.session_id ILIKE ${value}
      OR u.username ILIKE ${value} OR CAST(u.id AS TEXT) ILIKE ${value})`); }
    if (input.agent) conditions.push(`EXISTS(SELECT 1 FROM agent_run_events af WHERE af.run_id=r.id AND af.agent_name=${bind(input.agent)})`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const listValues = [...values, input.pageSize, (input.page - 1) * input.pageSize];
    const [totalResult, rowsResult, statusResult, usageResult] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::integer AS count FROM agent_runs r JOIN users u ON u.id=r.user_id ${where}`, values),
      this.pool.query(`SELECT r.id,r.user_id AS "userId",u.username,r.session_id AS "sessionId",r.modality,r.source,r.status,
        r.input_json AS "inputJson",r.error_code AS "errorCode",r.error_message AS "errorMessage",r.started_at AS "startedAt",
        r.completed_at AS "completedAt",r.created_at AS "createdAt",r.updated_at AS "updatedAt",
        ROUND(EXTRACT(EPOCH FROM (COALESCE(r.completed_at,r.updated_at)-COALESCE(r.started_at,r.created_at)))*1000)::integer AS "durationMs",
        (SELECT COUNT(*)::integer FROM agent_run_events e WHERE e.run_id=r.id) AS "eventCount",
        (SELECT COUNT(*)::integer FROM agent_actions a WHERE a.run_id=r.id) AS "actionCount",
        (SELECT COUNT(*)::integer FROM ai_usage_logs l WHERE l.run_id=r.id) AS "modelCallCount",
        (SELECT COALESCE(SUM(l.prompt_tokens),0)::integer FROM ai_usage_logs l WHERE l.run_id=r.id) AS "promptTokens",
        (SELECT COALESCE(SUM(l.completion_tokens),0)::integer FROM ai_usage_logs l WHERE l.run_id=r.id) AS "completionTokens",
        (SELECT COALESCE(SUM(l.total_tokens),0)::integer FROM ai_usage_logs l WHERE l.run_id=r.id) AS "totalTokens",
        (SELECT COALESCE(ROUND(SUM(l.estimated_cost_usd)::numeric,6),0) FROM ai_usage_logs l WHERE l.run_id=r.id) AS "estimatedCostUsd",
        EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id=r.id) AS "hasMedia",
        (SELECT STRING_AGG(s.agent_name,',' ORDER BY s.first_sequence) FROM (SELECT e.agent_name,MIN(e.sequence) AS first_sequence
          FROM agent_run_events e WHERE e.run_id=r.id AND e.agent_name NOT IN ('Supervisor','PolicyGate') GROUP BY e.agent_name) s) AS specialists,
        (SELECT e.summary FROM agent_run_events e WHERE e.run_id=r.id ORDER BY e.sequence DESC LIMIT 1) AS "lastEventSummary"
        FROM agent_runs r JOIN users u ON u.id=r.user_id ${where} ORDER BY r.created_at DESC,r.id DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues),
      this.pool.query(`SELECT r.status,COUNT(*)::integer AS count FROM agent_runs r JOIN users u ON u.id=r.user_id
        ${where} GROUP BY r.status`, values),
      this.pool.query(`SELECT COUNT(l.id)::integer AS "modelCalls",COALESCE(SUM(l.prompt_tokens),0)::integer AS "promptTokens",
        COALESCE(SUM(l.completion_tokens),0)::integer AS "completionTokens",COALESCE(SUM(l.total_tokens),0)::integer AS "totalTokens",
        COALESCE(ROUND(SUM(l.estimated_cost_usd)::numeric,6),0) AS "estimatedCostUsd" FROM agent_runs r JOIN users u ON u.id=r.user_id
        LEFT JOIN ai_usage_logs l ON l.run_id=r.id ${where}`, values),
    ]);
    return { rows: rowsResult.rows as Row[], total: Number(totalResult.rows[0]?.count), statusCounts: statusResult.rows as Row[],
      usageSummary: usageResult.rows[0] as Row };
  }

  async detail(runId: string): Promise<AgentRunDetailData | null> {
    const run = (await this.pool.query(`SELECT r.id,r.user_id AS "userId",u.username,r.session_id AS "sessionId",r.modality,r.source,
      r.status,r.input_json AS "inputJson",r.result_json AS "resultJson",r.pending_approval_json AS "pendingApprovalJson",
      r.pending_input_json AS "pendingInputJson",r.error_code AS "errorCode",r.error_message AS "errorMessage",
      r.checkpoint_thread_id AS "checkpointThreadId",r.started_at AS "startedAt",r.completed_at AS "completedAt",
      r.created_at AS "createdAt",r.updated_at AS "updatedAt",EXISTS(SELECT 1 FROM agent_run_media m WHERE m.run_id=r.id) AS "hasMedia"
      FROM agent_runs r JOIN users u ON u.id=r.user_id WHERE r.id=$1`, [runId])).rows[0] as Row | undefined;
    if (!run) return null;
    const [events, actions, usageRecords, usageSummary, usageByAgent, checkpointCounts] = await Promise.all([
      this.pool.query(`SELECT sequence,agent_name AS "agentName",event_type AS "eventType",summary,payload_json AS "payloadJson",
        created_at AS "createdAt" FROM agent_run_events WHERE run_id=$1 ORDER BY sequence`, [runId]),
      this.pool.query(`SELECT id,action_type AS "actionType",risk_level AS "riskLevel",status,payload_json AS "payloadJson",
        before_json AS "beforeJson",result_json AS "resultJson",version,expires_at AS "expiresAt",approval_decision AS "approvalDecision",
        approved_by_user_id AS "approvedByUserId",approved_at AS "approvedAt",executed_at AS "executedAt",undone_at AS "undoneAt",
        created_at AS "createdAt",updated_at AS "updatedAt" FROM agent_actions WHERE run_id=$1 ORDER BY created_at,id`, [runId]),
      this.pool.query(`SELECT id,agent_name AS "agentName",phase,endpoint,model,prompt_tokens AS "promptTokens",
        completion_tokens AS "completionTokens",total_tokens AS "totalTokens",estimated_cost_usd AS "estimatedCostUsd",
        latency_ms AS "latencyMs",success,failure_reason AS "failureReason",created_at AS "createdAt"
        FROM ai_usage_logs WHERE run_id=$1 ORDER BY id`, [runId]),
      this.pool.query(`SELECT COUNT(*)::integer AS "modelCalls",COALESCE(SUM(prompt_tokens),0)::integer AS "promptTokens",
        COALESCE(SUM(completion_tokens),0)::integer AS "completionTokens",COALESCE(SUM(total_tokens),0)::integer AS "totalTokens",
        COALESCE(ROUND(SUM(estimated_cost_usd)::numeric,6),0) AS "estimatedCostUsd",
        COALESCE(ROUND(AVG(latency_ms)),0)::integer AS "avgLatencyMs" FROM ai_usage_logs WHERE run_id=$1`, [runId]),
      this.pool.query(`SELECT COALESCE(agent_name,'Unknown') AS "agentName",COUNT(*)::integer AS "modelCalls",
        COALESCE(SUM(prompt_tokens),0)::integer AS "promptTokens",COALESCE(SUM(completion_tokens),0)::integer AS "completionTokens",
        COALESCE(SUM(total_tokens),0)::integer AS "totalTokens",COALESCE(ROUND(SUM(estimated_cost_usd)::numeric,6),0) AS "estimatedCostUsd"
        FROM ai_usage_logs WHERE run_id=$1 GROUP BY COALESCE(agent_name,'Unknown') ORDER BY "totalTokens" DESC,"modelCalls" DESC`, [runId]),
      this.pool.query(`SELECT
        (SELECT COUNT(*)::integer FROM checkpoints WHERE thread_id=$1) AS "checkpointCount",
        (SELECT COUNT(*)::integer FROM checkpoint_writes WHERE thread_id=$1) AS "checkpointWriteCount"`,
      [String(run.checkpointThreadId)]),
    ]);
    return { run, checkpointAvailable: true,
      checkpointCount: Number(checkpointCounts.rows[0]?.checkpointCount || 0),
      checkpointWriteCount: Number(checkpointCounts.rows[0]?.checkpointWriteCount || 0), events: events.rows as Row[],
      actions: actions.rows as Row[], usageRecords: usageRecords.rows as Row[], usageSummary: usageSummary.rows[0] as Row,
      usageByAgent: usageByAgent.rows as Row[] };
  }
}
