import { assertPostgresPlanExecution } from "../recipes/postgresRepository.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { randomUUID } from "node:crypto";
import { queueInterventionRequest, validateQueueIntervention } from "./intervention.js";
import { CookingQueueError } from "./errors.js";
import type { Pool, PoolClient } from "pg";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueEnqueueData, QueuePatch, QueueRecipe, QueueRow } from "./types.js";
import { lockMealPlanning } from "../mealPlans/postgresLock.js";

const active = "'waiting', 'preparing', 'ready', 'cooking'";
const selectQueue = `SELECT q.*, r.title AS current_title, r.image_url AS current_image_url,
  r.cook_time AS current_cook_time, r.calories AS current_calories,
  r.difficulty AS current_difficulty, r.ingredients_json AS current_ingredients_json
  FROM cooking_queue_items q LEFT JOIN recipes r
    ON r.id = q.recipe_id AND r.deleted_at IS NULL AND r.status = 'approved'`;
const json = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value ?? null);

async function owned(client: Pool | PoolClient, id: string, userId: number) {
  const result = await client.query(`${selectQueue} WHERE q.id = $1 AND q.user_id = $2`, [id, userId]);
  return (result.rows[0] as QueueRow | undefined) ?? null;
}

export class PostgresCookingQueueRepository implements CookingQueueRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async recommendationRequest(userId: number, requestId: string) {
    return (await this.pool.query("SELECT id,scoring_version,results_json FROM recipe_recommendation_requests WHERE user_id=$1 AND id=$2",[userId,requestId])).rows[0] ?? null;
  }
  async list(userId: number, includeHistory: boolean) {
    const where = includeHistory ? "q.user_id = $1" : `q.user_id = $1 AND q.deleted_at IS NULL AND q.status IN (${active})`;
    const order = includeHistory
      ? "CASE WHEN q.status IN ('waiting', 'preparing', 'ready', 'cooking') THEN 0 ELSE 1 END, q.position, q.updated_at DESC"
      : "q.position, q.created_at";
    return (await this.pool.query(`${selectQueue} WHERE ${where} ORDER BY ${order}`, [userId])).rows as QueueRow[];
  }

  findOwned(id: string, userId: number) { return owned(this.pool, id, userId); }

  async findApprovedRecipe(recipeId: number) {
    const result = await this.pool.query(`SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
      FROM recipes WHERE id = $1 AND deleted_at IS NULL AND status = 'approved'`, [recipeId]);
    return (result.rows[0] as QueueRecipe | undefined) ?? null;
  }

  async enqueue(input: QueueEnqueueData, maximumActive: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = queueInterventionRequest(input);
      if (request) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [input.userId]);
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [input.userId]);
      if (request) {
        const previous = (await client.query("SELECT request_json,result_json FROM proactive_intervention_actions WHERE user_id=$1 AND idempotency_key=$2",[input.userId,input.idempotencyKey])).rows[0];
        const intervention = (await client.query("SELECT * FROM proactive_interventions WHERE user_id=$1 AND id=$2 FOR UPDATE",[input.userId,input.interventionId])).rows[0];
        const replayId = validateQueueIntervention(input,intervention ?? null,previous ?? null);
        if (replayId) {
          const replay = await owned(client,replayId,input.userId);
          if (!replay) throw new CookingQueueError(409,"原队列记录已移除","INTERVENTION_IDEMPOTENCY_CONFLICT");
          await client.query("COMMIT");
          return { kind: "existing" as const, row: replay };
        }
      }
      let foundId: string | undefined;
      if (input.idempotencyKey) {
        foundId = (await client.query("SELECT id FROM cooking_queue_items WHERE user_id = $1 AND idempotency_key = $2",
          [input.userId, input.idempotencyKey])).rows[0]?.id;
      }
      if (request && foundId) throw new CookingQueueError(409,"幂等标识已用于其他操作","INTERVENTION_IDEMPOTENCY_CONFLICT");
      if (!foundId) {
        foundId = (await client.query(`SELECT id FROM cooking_queue_items WHERE user_id = $1 AND recipe_id = $2 AND source_plan_item_id IS NULL
          AND deleted_at IS NULL AND status IN (${active})`, [input.userId, input.recipeId])).rows[0]?.id;
      }
      if (foundId) {
        const row = await owned(client, foundId, input.userId);
        if (request) await this.attachIntervention(client,input,row!);
        await client.query("COMMIT");
        return { kind: "existing" as const, row: row! };
      }
      const count = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM cooking_queue_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})`, [input.userId])).rows[0]!.count);
      if (count >= maximumActive) {
        await client.query("COMMIT");
        return { kind: "full" as const };
      }
      const position = Number((await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items
        WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})`, [input.userId])).rows[0]!.position);
      await client.query(`INSERT INTO cooking_queue_items
        (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`, [input.id, input.userId, input.recipeId, position,
        input.mealType ?? null, input.plannedAt ?? null, JSON.stringify(input.snapshot), input.idempotencyKey ?? null]);
      const row = await owned(client, input.id, input.userId);
      if (request) await this.attachIntervention(client,input,row!);
      await client.query("COMMIT");
      return { kind: "created" as const, row: row! };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async attachIntervention(client: PoolClient, input: QueueEnqueueData, row: QueueRow) {
    const request = queueInterventionRequest(input)!;
    const at = new Date().toISOString();
    await client.query("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",[randomUUID(),input.interventionId,input.userId,input.idempotencyKey,"plan_recipe",JSON.stringify(request),JSON.stringify({ queueItemId: row.id, eligibleForStart: row.status !== "cooking" }),at]);
    await client.query("UPDATE proactive_interventions SET status='acted',delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=$1 WHERE user_id=$2 AND id=$3",[at,input.userId,input.interventionId]);
    await client.query("UPDATE user_notification_inbox SET action_status='completed',is_read=TRUE,read_at=$1,updated_at=$1 WHERE user_id=$2 AND id=(SELECT notification_id FROM proactive_interventions WHERE user_id=$2 AND id=$3)",[at,input.userId,input.interventionId]);
  }
  private async recordInterventionStart(client: PoolClient, id: string, userId: number) {
    const actions = (await client.query("SELECT intervention_id FROM proactive_intervention_actions WHERE user_id=$1 AND action='plan_recipe' AND result_json->>'queueItemId'=$2 AND result_json->>'eligibleForStart'='true'",[userId,id])).rows;
    for (const action of actions) await client.query("INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at) VALUES($1,$2,$3,'cooking_started','cooking_queue',$4,$5) ON CONFLICT(intervention_id,outcome_type,source_type,source_id) DO NOTHING",[randomUUID(),action.intervention_id,userId,id,new Date().toISOString()]);
  }

  async update(id: string, userId: number, version: number, patch: QueuePatch) {
    const update = async (client: PoolClient) => {
      await this.assertPlanSource(client, id, userId, version, patch.status);
      const result = await client.query(`UPDATE cooking_queue_items SET status = $1, meal_type = $2, planned_at = $3,
        prepared_ingredients_json = $4::jsonb, shopping_list_synced_at = $5, completed_at = $6,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $7 AND user_id = $8 AND version = $9`,
      [patch.status, patch.mealType ?? null, patch.plannedAt ?? null, json(patch.preparedIngredients),
        patch.shoppingListSyncedAt ?? null, patch.completedAt ?? null, id, userId, version]);
      if (result.rowCount !== 1) return null;
      if (patch.status === "cancelled") await this.releasePlanItems(client, userId, [id]);
      if (patch.status === "cooking") await this.recordInterventionStart(client,id,userId);
      return owned(client, id, userId);
    };
    return this.queueTransaction(userId, update);
  }

  private async assertPlanSource(client: PoolClient, id: string, userId: number, version: number, status: string) {
    const queue = await owned(client, id, userId);
    if (!["cooking", "completed"].includes(status) || !queue?.source_plan_item_id || Number(queue.version) !== version || ["completed", "cancelled"].includes(String(queue.status))) return;
    const rows = (await client.query("SELECT i.*,p.constraints_json AS plan_constraints_json FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=$1 AND i.queue_item_id=$2 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' ORDER BY i.id FOR SHARE OF i", [userId, id])).rows as QueueRow[];
    if (!rows.some(row => row.id === queue.source_plan_item_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "原餐次已变化，请刷新后重新核对");
    await assertPostgresPlanExecution(client, rows);
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [userId]);
      const current = await client.query(`SELECT id, version FROM cooking_queue_items WHERE user_id = $1
        AND deleted_at IS NULL AND status IN (${active}) FOR UPDATE`, [userId]);
      if (current.rows.length !== items.length) { await client.query("ROLLBACK"); return null; }
      const versions = new Map(current.rows.map((row) => [String(row.id), Number(row.version)]));
      for (const [index, item] of items.entries()) {
        if (versions.get(item.id) !== item.version) { await client.query("ROLLBACK"); return null; }
        const updated = await client.query(`UPDATE cooking_queue_items SET position = $1, version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4
          AND deleted_at IS NULL AND status IN (${active})`, [index, item.id, userId, item.version]);
        if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return null; }
      }
      await client.query("COMMIT");
      return (await client.query(`${selectQueue} WHERE q.user_id = $1 AND q.deleted_at IS NULL
        AND q.status IN (${active}) ORDER BY q.position, q.created_at`, [userId])).rows as QueueRow[];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async transition(id: string, userId: number, version: number, status: "cooking" | "completed") {
    return this.queueTransaction(userId, async client => {
    await this.assertPlanSource(client, id, userId, version, status);
    const result = status === "cooking"
      ? await client.query(`UPDATE cooking_queue_items SET status = 'cooking', planned_at = NULL,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3`, [id, userId, version])
      : await client.query(`UPDATE cooking_queue_items SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3`, [id, userId, version]);
    if (result.rowCount !== 1) return null;
    if (status === "cooking") await this.recordInterventionStart(client,id,userId);
    return owned(client,id,userId);
    });
  }

  async cancel(id: string, userId: number) {
    return await this.cancelItems(userId, id) === 1;
  }

  async cancelAll(userId: number) {
    return this.cancelItems(userId);
  }

  private cancelItems(userId: number, id?: string) {
    return this.queueTransaction(userId, async client => {
      const cancelled = await client.query(`UPDATE cooking_queue_items SET status = 'cancelled', version = version + 1,
        updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND deleted_at IS NULL AND status IN (${active})
        ${id ? "AND id = $2" : ""} RETURNING id`, id ? [userId, id] : [userId]);
      await this.releasePlanItems(client, userId, cancelled.rows.map(row => String(row.id)));
      return cancelled.rows.length;
    });
  }

  private async releasePlanItems(client: Pool | PoolClient, userId: number, queueIds: string[]) {
    if (!queueIds.length) return;
    await client.query(`UPDATE meal_plan_items SET status = 'planned', queue_item_id = NULL,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND queue_item_id = ANY($2::text[]) AND status IN ('queued', 'cooking') AND deleted_at IS NULL`, [userId, queueIds]);
  }

  private async queueTransaction<T>(userId: number, operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockMealPlanning(client, userId);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
