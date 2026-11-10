import { coreLoopInventoryIds } from "./coreLoopProjection.js";
import type { Pool, PoolClient } from "pg";
import type { AdminConsoleRepository } from "./repository.js";
import type { AdminAudit, AuditQuery, Row, ScanQuery, TrashResource, UsageQuery } from "./types.js";

const TABLES: Record<TrashResource, string> = {
  community: "community_posts", recipes: "recipes", ingredients: "ingredients_library", kitchenware: "kitchenware_items",
};

export class PostgresAdminConsoleRepository implements AdminConsoleRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async coreLoopSettings() { return (await this.pool.query("SELECT * FROM core_loop_metric_settings WHERE id=1")).rows[0] ?? { enabled: 0,coverage_start: null,version: 1 }; }
  async updateCoreLoopSettings(enabled: boolean, version: number, environment: string | null, audit: AdminAudit) { return this.tx(async client => {
    await client.query("INSERT INTO core_loop_metric_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING");
    const result = await client.query("UPDATE core_loop_metric_settings SET enabled=$1,coverage_start=CASE WHEN $1=1 THEN CASE WHEN environment=$3 THEN COALESCE(coverage_start,CURRENT_TIMESTAMP) ELSE CURRENT_TIMESTAMP END ELSE coverage_start END,environment=CASE WHEN $1=1 THEN $3 ELSE environment END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND version=$2 RETURNING id",[Number(enabled),version,environment]);
    if (!result.rowCount) return false; await this.insertAudit(client,audit); return true;
  }); }
  async coreLoopActor(userId: number) { return (await this.pool.query("SELECT u.id AS user_id,COALESCE(c.kind,'unknown') AS kind,COALESCE(c.version,0) AS version FROM users u LEFT JOIN core_loop_actor_classifications c ON c.user_id=u.id WHERE u.id=$1",[userId])).rows[0] ?? null; }
  async updateCoreLoopActor(userId: number, kind: string, version: number, audit: AdminAudit) { return this.tx(async client => {
    if (!(await client.query("SELECT id FROM users WHERE id=$1 FOR KEY SHARE",[userId])).rowCount) return false;
    const result = version === 0 ? await client.query("INSERT INTO core_loop_actor_classifications(user_id,kind,classified_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING RETURNING user_id",[userId,kind,audit.adminUserId])
      : await client.query("UPDATE core_loop_actor_classifications SET kind=$1,classified_by=$2,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$3 AND version=$4 RETURNING user_id",[kind,audit.adminUserId,userId,version]);
    if (!result.rowCount) return false; await this.insertAudit(client,audit); return true;
  }); }
  async coreLoopData(start: string, end: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const productions = (await client.query(`SELECT m.id,m.user_id,m.idempotency_key,m.recipe_id,m.produced_at,c.kind,
        jsonb_build_object('selection_evidence',m.result_json->'selection_evidence','inventory_consumption_changes',m.result_json->'inventory_consumption_changes','metric_environment',m.result_json->'metric_environment') AS result_json,
        r.created_at AS selection_created_at FROM prepared_meals m JOIN users u ON u.id=m.user_id LEFT JOIN core_loop_actor_classifications c ON c.user_id=m.user_id
        LEFT JOIN recipe_recommendation_requests r ON r.id=m.result_json->'selection_evidence'->>'requestId' AND r.user_id=m.user_id
        WHERE EXISTS(SELECT 1 FROM prepared_meal_events e WHERE e.prepared_meal_id=m.id AND e.event_type='eat' AND e.created_at>=$1::timestamptz AND e.created_at<$2::timestamptz)`,[start,end])).rows as Row[];
      const ids = productions.map(row => row.id);
      const intakes = (await client.query(`SELECT e.prepared_meal_id,e.user_id,e.servings,e.created_at,e.diet_record_id,d.id IS NOT NULL AS record_exists,
        EXISTS(SELECT 1 FROM prepared_meal_intake_corrections c WHERE c.event_id=e.id) AS corrected
        FROM prepared_meal_events e LEFT JOIN diet_records d ON d.id=e.diet_record_id AND d.user_id=e.user_id
        WHERE e.event_type='eat' AND e.prepared_meal_id=ANY($1::text[])`,[ids])).rows as Row[];
      const logs = (await client.query("SELECT user_id,inventory_item_id,action,source,quantity_before,quantity_after,delta_value,idempotency_key,created_at,metadata_json->>'acceptance' AS acceptance FROM inventory_change_logs WHERE inventory_item_id=ANY($1::integer[]) AND (action='created' OR source='cooking')",[coreLoopInventoryIds(productions)])).rows as Row[];
      const legacy = (await client.query(`SELECT m.id,m.user_id,m.recipe_id,m.diet_record_id,m.created_at,c.kind,d.id IS NOT NULL AS record_exists
        FROM cooking_completions m JOIN users u ON u.id=m.user_id LEFT JOIN core_loop_actor_classifications c ON c.user_id=m.user_id
        LEFT JOIN diet_records d ON d.id=m.diet_record_id AND d.user_id=m.user_id WHERE m.created_at>=$1::timestamptz AND m.created_at<$2::timestamptz`,[start,end])).rows as Row[];
      const shared = (await client.query(`SELECT m.id,m.household_id,m.created_by_user_id,m.idempotency_key,m.created_at AS produced_at,c.kind,p.recipe_id,
        e.diet_record_id,e.user_id AS diner_user_id,e.servings,e.created_at AS intake_at,
        m.inventory_json,m.request_json,m.dining_json
        FROM household_meal_batches m JOIN household_meal_events e ON e.meal_id=m.id
        JOIN diet_records d ON d.id=e.diet_record_id AND d.user_id=e.user_id
        LEFT JOIN meal_plan_items p ON p.id=m.plan_item_id
        LEFT JOIN core_loop_actor_classifications c ON c.user_id=m.created_by_user_id
        WHERE EXISTS(SELECT 1 FROM household_meal_events candidate WHERE candidate.meal_id=m.id AND candidate.created_at>=$1::timestamptz AND candidate.created_at<$2::timestamptz)
          AND NOT EXISTS(SELECT 1 FROM household_meal_intake_corrections x WHERE x.event_id=e.id)`,[start,end])).rows as Row[];
      const settings = (await client.query("SELECT * FROM core_loop_metric_settings WHERE id=1")).rows[0] ?? { enabled: 0,version: 1,coverage_start: null };
      await client.query("COMMIT"); return { productions,intakes,logs,legacy,shared,settings };
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async stats() { return (await this.pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM users) AS users,
    (SELECT COUNT(*)::integer FROM community_posts WHERE deleted_at IS NULL) AS posts,
    (SELECT COUNT(*)::integer FROM recipes WHERE deleted_at IS NULL) AS recipes,
    (SELECT COUNT(*)::integer FROM inventory_items) AS inventory,
    (SELECT COUNT(*)::integer FROM ingredients_library) AS ingredients,
    (SELECT COUNT(*)::integer FROM kitchenware_items WHERE deleted_at IS NULL) AS kitchenware,
    (SELECT COUNT(*)::integer FROM kitchenware_catalog) AS "kitchenwareCatalog"`)).rows[0] as Row; }

  async funnel(days: number) { return (await this.pool.query(`SELECT event_name AS "eventName",COUNT(*)::integer AS events,
    COUNT(DISTINCT actor_hash)::integer AS users FROM funnel_events WHERE created_at >= NOW()-($1::integer*INTERVAL '1 day')
    GROUP BY event_name ORDER BY event_name`, [days])).rows as Row[]; }

  async auditLogs(input: AuditQuery) { const filters: string[] = []; const values: unknown[] = [];
    if (input.action) { values.push(input.action); filters.push(`l.action=$${values.length}`); }
    if (input.resourceType) { values.push(input.resourceType); filters.push(`l.resource_type=$${values.length}`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = Number((await this.pool.query(`SELECT COUNT(*)::integer AS count FROM admin_audit_logs l ${where}`, values)).rows[0]?.count);
    values.push(input.pageSize, (input.page - 1) * input.pageSize);
    const items = (await this.pool.query(`SELECT l.id,l.admin_user_id AS "adminUserId",COALESCE(u.username,'已删除管理员') AS "adminName",
      l.action,l.resource_type AS "resourceType",l.resource_id AS "resourceId",l.summary,l.details_json AS "detailsJson",
      l.ip_address AS "ipAddress",l.user_agent AS "userAgent",l.created_at AS "createdAt" FROM admin_audit_logs l
      LEFT JOIN users u ON u.id=l.admin_user_id ${where} ORDER BY l.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows as Row[];
    return { items, total };
  }

  async scanJobs(input: ScanQuery) { const filters: string[] = []; const values: unknown[] = [];
    if (input.status) { values.push(input.status); filters.push(`j.status=$${values.length}`); }
    if (input.user) { values.push(`%${input.user}%`); const value = `$${values.length}`;
      filters.push(`(u.username ILIKE ${value} OR CAST(u.id AS TEXT) ILIKE ${value})`); }
    return (await this.pool.query(`SELECT j.id,j.status,j.result_json AS "resultJson",j.error_message AS "errorMessage",
      j.created_at AS "createdAt",j.updated_at AS "updatedAt",u.id AS "userId",u.username FROM inventory_scan_jobs j
      JOIN users u ON u.id=j.user_id ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY j.created_at DESC LIMIT 100`, values)).rows as Row[]; }

  async scanJob(id: string) { return ((await this.pool.query(`SELECT j.id,j.status,j.result_json AS "resultJson",j.error_message AS "errorMessage",
    j.created_at AS "createdAt",j.updated_at AS "updatedAt",u.id AS "userId",u.username FROM inventory_scan_jobs j
    JOIN users u ON u.id=j.user_id WHERE j.id=$1`, [id])).rows[0] as Row | undefined) || null; }

  async conversations(query?: string) { const values: unknown[] = query ? [`%${query}%`] : []; return (await this.pool.query(`
    SELECT m.user_id AS "userId",m.session_id AS "sessionId",u.username,
      COUNT(*) FILTER (WHERE m.role='user')::integer AS "turnCount",
      COUNT(*) FILTER (WHERE m.role IN ('user','assistant'))::integer AS "messageCount",
      ROUND(AVG(m.response_time_ms) FILTER (WHERE m.role='assistant' AND m.status='completed'))::integer AS "avgResponseTimeMs",
      COUNT(*) FILTER (WHERE m.role='assistant' AND m.status='failed')::integer AS "failedCount",
      STRING_AGG(DISTINCT m.source, ',') AS sources,MAX(m.created_at) AS "updatedAt",
      (SELECT content FROM ai_chat_messages x WHERE x.user_id=m.user_id AND x.session_id=m.session_id AND x.role='user'
       ORDER BY x.id DESC LIMIT 1) AS "lastUserMessage"
    FROM ai_chat_messages m JOIN users u ON u.id=m.user_id ${query ? "WHERE u.username ILIKE $1 OR CAST(u.id AS TEXT) ILIKE $1" : ""}
    GROUP BY m.user_id,m.session_id,u.username ORDER BY MAX(m.id) DESC LIMIT 100`, values)).rows as Row[]; }

  async conversation(userId: number, sessionId: string) {
    const user = ((await this.pool.query("SELECT id,username FROM users WHERE id=$1", [userId])).rows[0] as Row | undefined) || null;
    const messages = (await this.pool.query(`SELECT m.id,m.role,m.content,m.response_time_ms AS "responseTimeMs",m.source,m.status,
      m.payload_json AS "payloadJson",m.created_at AS "createdAt",c.status AS "confirmationStatus" FROM ai_chat_messages m
      LEFT JOIN ai_write_confirmations c ON c.id=m.confirmation_id WHERE m.user_id=$1 AND m.session_id=$2 ORDER BY m.id`, [userId, sessionId])).rows as Row[];
    return { user, messages };
  }

  async runDiagnostic(userId: number, runId: string) { const row = (await this.pool.query(`SELECT
    (SELECT error_code FROM agent_runs WHERE id=$1 AND user_id=$2) AS "errorCode",
    (SELECT error_message FROM agent_runs WHERE id=$1 AND user_id=$2) AS "errorMessage",
    (SELECT model FROM ai_usage_logs WHERE run_id=$1 ORDER BY id DESC LIMIT 1) AS model`, [runId, userId])).rows[0] as Row;
    const diagnostic = { errorCode: row.errorCode ? String(row.errorCode) : null, errorMessage: row.errorMessage ? String(row.errorMessage) : null,
      model: row.model ? String(row.model) : null };
    return diagnostic.errorCode || diagnostic.errorMessage || diagnostic.model ? diagnostic : null; }

  async trash() { const list = async (table: string, title: string) => (await this.pool.query(`SELECT id,${title} AS title,
    deleted_at AS "deletedAt" FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows as Row[]; return {
    community: await list("community_posts", "content"), recipes: await list("recipes", "title"),
    ingredients: await list("ingredients_library", "name"), kitchenware: await list("kitchenware_items", "name"),
  }; }

  async restore(resource: TrashResource, id: number, audit: AdminAudit) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE ${TABLES[resource]} SET deleted_at=NULL,deleted_by=NULL
      WHERE id=$1 AND deleted_at IS NOT NULL`, [id]); if (result.rowCount !== 1) return false;
    await this.insertAudit(client, audit); return true;
  }); }

  async userExists(userId: number) { return Boolean((await this.pool.query("SELECT 1 FROM users WHERE id=$1", [userId])).rowCount); }

  async usage(input: UsageQuery) { const filters: string[] = []; const values: unknown[] = [];
    if (input.rangeDays !== null) { values.push(input.rangeDays); filters.push(`created_at >= NOW()-($${values.length}::integer*INTERVAL '1 day')`); }
    if (input.userId !== null) { values.push(input.userId); filters.push(`user_id=$${values.length}`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const summary = (await this.pool.query(`SELECT COUNT(*)::integer AS requests,COALESCE(SUM(prompt_tokens),0)::integer AS "promptTokens",
      COALESCE(SUM(completion_tokens),0)::integer AS "completionTokens",COALESCE(SUM(total_tokens),0)::integer AS "totalTokens",
      COALESCE(ROUND(SUM(estimated_cost_usd)::numeric,6),0) AS "estimatedCostUsd",COALESCE(ROUND(AVG(latency_ms)),0) AS "avgLatencyMs",
      COALESCE(ROUND(100.0*COUNT(*) FILTER (WHERE success)/NULLIF(COUNT(*),0),1),0) AS "successRate",
      COUNT(DISTINCT user_id)::integer AS "activeUsers" FROM ai_usage_logs ${where}`, values)).rows[0] as Row;
    const trend = (await this.pool.query(`SELECT created_at::date::text AS date,COUNT(*)::integer AS requests,
      COALESCE(SUM(prompt_tokens),0)::integer AS "promptTokens",COALESCE(SUM(completion_tokens),0)::integer AS "completionTokens",
      COALESCE(SUM(total_tokens),0)::integer AS "totalTokens" FROM ai_usage_logs ${where}
      GROUP BY created_at::date ORDER BY created_at::date`, values)).rows as Row[];
    const failures = (await this.pool.query(`SELECT endpoint,model,failure_reason AS "failureReason",latency_ms AS "latencyMs",
      created_at AS "createdAt" FROM ai_usage_logs ${where ? `${where} AND success=FALSE` : "WHERE success=FALSE"}
      ORDER BY created_at DESC LIMIT 20`, values)).rows as Row[];
    const models = (await this.pool.query(`SELECT model,COUNT(*)::integer AS requests,COALESCE(SUM(total_tokens),0)::integer AS "totalTokens"
      FROM ai_usage_logs ${where} GROUP BY model ORDER BY "totalTokens" DESC,requests DESC`, values)).rows as Row[];
    const endpoints = (await this.pool.query(`SELECT endpoint,COUNT(*)::integer AS requests,COALESCE(SUM(total_tokens),0)::integer AS "totalTokens"
      FROM ai_usage_logs ${where} GROUP BY endpoint ORDER BY "totalTokens" DESC,requests DESC`, values)).rows as Row[];
    const userValues: unknown[] = []; const join = input.rangeDays === null ? "" : "AND l.created_at >= NOW()-($1::integer*INTERVAL '1 day')";
    if (input.rangeDays !== null) userValues.push(input.rangeDays);
    const users = (await this.pool.query(`SELECT u.id,u.username,u.avatar_url AS "avatarUrl",COUNT(l.id)::integer AS requests,
      COALESCE(SUM(l.prompt_tokens),0)::integer AS "promptTokens",COALESCE(SUM(l.completion_tokens),0)::integer AS "completionTokens",
      COALESCE(SUM(l.total_tokens),0)::integer AS "totalTokens",COALESCE(ROUND(AVG(l.latency_ms)),0) AS "avgLatencyMs",
      COALESCE(ROUND(100.0*COUNT(l.id) FILTER (WHERE l.success)/NULLIF(COUNT(l.id),0),1),0) AS "successRate",
      MAX(l.created_at) AS "lastUsedAt" FROM users u LEFT JOIN ai_usage_logs l ON l.user_id=u.id ${join}
      GROUP BY u.id ORDER BY "totalTokens" DESC,requests DESC,u.id`, userValues)).rows as Row[];
    return { summary, trend, failures, models, endpoints, users };
  }

  async trends(days: number) { return (await this.pool.query(`SELECT day::date::text AS date,
    (SELECT COUNT(*)::integer FROM users WHERE created_at::date=day::date) AS users,
    (SELECT COUNT(*)::integer FROM diet_records WHERE created_at::date=day::date) AS records,
    (SELECT COUNT(*)::integer FROM community_posts WHERE deleted_at IS NULL AND created_at::date=day::date) AS posts
    FROM generate_series(CURRENT_DATE-($1::integer-1),CURRENT_DATE,INTERVAL '1 day') AS day ORDER BY day`, [days])).rows as Row[]; }

  async recent() { return {
    recentUsers: (await this.pool.query("SELECT id,username,avatar_url,created_at FROM users ORDER BY created_at DESC LIMIT 5")).rows as Row[],
    recentPosts: (await this.pool.query(`SELECT id,username,content,image_url,category,created_at FROM community_posts
      WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`)).rows as Row[],
    pendingFoods: (await this.pool.query(`SELECT f.id,f.name,f.calories_100g,f.created_at,u.username AS author_name FROM user_custom_foods f
      LEFT JOIN users u ON u.id=f.user_id WHERE f.status='pending' ORDER BY f.created_at DESC LIMIT 5`)).rows as Row[],
  }; }

  private insertAudit(client: PoolClient, audit: AdminAudit) { return client.query(`INSERT INTO admin_audit_logs
    (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [audit.adminUserId,audit.action,audit.resourceType,String(audit.resourceId),audit.summary,audit.ipAddress || null,audit.userAgent || null]); }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
