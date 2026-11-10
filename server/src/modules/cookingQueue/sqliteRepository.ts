import { assertSqlitePlanExecution } from "../recipes/sqliteRepository.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { randomUUID } from "node:crypto";
import { queueInterventionRequest, validateQueueIntervention } from "./intervention.js";
import { CookingQueueError } from "./errors.js";
import type Database from "better-sqlite3";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueEnqueueData, QueuePatch, QueueRecipe, QueueRow } from "./types.js";

const activeStatuses = "'waiting', 'preparing', 'ready', 'cooking'";
const selectQueue = `
  SELECT q.*, r.title AS current_title, r.image_url AS current_image_url,
    r.cook_time AS current_cook_time, r.calories AS current_calories,
    r.difficulty AS current_difficulty, r.ingredients_json AS current_ingredients_json
  FROM cooking_queue_items q
  LEFT JOIN recipes r ON r.id = q.recipe_id AND r.deleted_at IS NULL AND r.status = 'approved'
`;

function jsonValue(value: unknown) {
  return typeof value === "string" || value === null || value === undefined ? value ?? null : JSON.stringify(value);
}

export class SqliteCookingQueueRepository implements CookingQueueRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async recommendationRequest(userId: number, requestId: string) {
    return (this.database.prepare("SELECT id,scoring_version,results_json FROM recipe_recommendation_requests WHERE user_id=? AND id=?").get(userId,requestId) as QueueRow | undefined) ?? null;
  }
  async list(userId: number, includeHistory: boolean) {
    const where = includeHistory ? "q.user_id = ?" : `q.user_id = ? AND q.deleted_at IS NULL AND q.status IN (${activeStatuses})`;
    const order = includeHistory
      ? "CASE WHEN q.status IN ('waiting', 'preparing', 'ready', 'cooking') THEN 0 ELSE 1 END, q.position, q.updated_at DESC"
      : "q.position, q.created_at";
    return this.database.prepare(`${selectQueue} WHERE ${where} ORDER BY ${order}`).all(userId) as QueueRow[];
  }

  async findOwned(id: string, userId: number) { return this.findOwnedRow(id, userId); }

  private findOwnedRow(id: string, userId: number) {
    return (this.database.prepare(`${selectQueue} WHERE q.id = ? AND q.user_id = ?`).get(id, userId) as QueueRow | undefined) ?? null;
  }

  async findApprovedRecipe(recipeId: number) {
    return (this.database.prepare(`
      SELECT id, title, image_url, cook_time, calories, difficulty, ingredients_json
      FROM recipes WHERE id = ? AND deleted_at IS NULL AND status = 'approved'
    `).get(recipeId) as QueueRecipe | undefined) ?? null;
  }

  async enqueue(input: QueueEnqueueData, maximumActive: number) {
    return this.database.transaction(() => {
      const request = queueInterventionRequest(input);
      if (request) {
        const previous = this.database.prepare("SELECT request_json,result_json FROM proactive_intervention_actions WHERE user_id=? AND idempotency_key=?").get(input.userId,input.idempotencyKey) as QueueRow | undefined;
        const intervention = this.database.prepare("SELECT * FROM proactive_interventions WHERE user_id=? AND id=?").get(input.userId,input.interventionId) as QueueRow | undefined;
        const replayId = validateQueueIntervention(input,intervention ?? null,previous ?? null);
        if (replayId) {
          const replay = this.findOwnedRow(replayId,input.userId);
          if (!replay) throw new CookingQueueError(409,"原队列记录已移除","INTERVENTION_IDEMPOTENCY_CONFLICT");
          return { kind: "existing" as const, row: replay };
        }
      }
      const existingId = input.idempotencyKey
        ? (this.database.prepare("SELECT id FROM cooking_queue_items WHERE user_id = ? AND idempotency_key = ?")
          .get(input.userId, input.idempotencyKey) as { id: string } | undefined)?.id
        : undefined;
      const activeId = (this.database.prepare(`
        SELECT id FROM cooking_queue_items
        WHERE user_id = ? AND recipe_id = ? AND source_plan_item_id IS NULL AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId, input.recipeId) as { id: string } | undefined)?.id;
      if (request && existingId) throw new CookingQueueError(409,"幂等标识已用于其他操作","INTERVENTION_IDEMPOTENCY_CONFLICT");
      const foundId = existingId || activeId;
      if (foundId) {
        const row = this.findOwnedRow(foundId,input.userId)!;
        if (request) this.attachIntervention(input,row);
        return { kind: "existing" as const, row };
      }
      const count = Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM cooking_queue_items
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId) as { count: number }).count);
      if (count >= maximumActive) return { kind: "full" as const };
      const position = Number((this.database.prepare(`
        SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})
      `).get(input.userId) as { position: number }).position);
      this.database.prepare(`
        INSERT INTO cooking_queue_items
          (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.id, input.userId, input.recipeId, position, input.mealType ?? null, input.plannedAt ?? null,
        JSON.stringify(input.snapshot), input.idempotencyKey ?? null);
      const row = this.findOwnedRow(input.id,input.userId)!;
      if (request) this.attachIntervention(input,row);
      return { kind: "created" as const, row };
    })();
  }

  private attachIntervention(input: QueueEnqueueData, row: QueueRow) {
    const request = queueInterventionRequest(input)!;
    const at = new Date().toISOString();
    this.database.prepare("INSERT INTO proactive_intervention_actions(id,intervention_id,user_id,idempotency_key,action,request_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(),input.interventionId,input.userId,input.idempotencyKey,"plan_recipe",JSON.stringify(request),JSON.stringify({ queueItemId: row.id, eligibleForStart: row.status !== "cooking" }),at);
    this.database.prepare("UPDATE proactive_interventions SET status='acted',delivery_state=CASE WHEN delivery_state='pending' THEN 'cancelled' ELSE delivery_state END,updated_at=? WHERE user_id=? AND id=?").run(at,input.userId,input.interventionId);
    this.database.prepare("UPDATE user_notification_inbox SET action_status='completed',is_read=1,read_at=?,updated_at=? WHERE user_id=? AND id=(SELECT notification_id FROM proactive_interventions WHERE user_id=? AND id=?)").run(at,at,input.userId,input.userId,input.interventionId);
  }

  private recordInterventionStart(id: string, userId: number) {
    const actions = this.database.prepare("SELECT intervention_id FROM proactive_intervention_actions WHERE user_id=? AND action='plan_recipe' AND json_extract(result_json,'$.queueItemId')=? AND json_extract(result_json,'$.eligibleForStart')=1").all(userId,id) as QueueRow[];
    const insert = this.database.prepare("INSERT INTO proactive_intervention_outcomes(id,intervention_id,user_id,outcome_type,source_type,source_id,occurred_at) VALUES(?,?,?,'cooking_started','cooking_queue',?,?) ON CONFLICT(intervention_id,outcome_type,source_type,source_id) DO NOTHING");
    for (const action of actions) insert.run(randomUUID(),action.intervention_id,userId,id,new Date().toISOString());
  }

  async update(id: string, userId: number, version: number, patch: QueuePatch) {
    return this.database.transaction(() => {
      this.assertPlanSource(id, userId, version, patch.status);
      const result = this.database.prepare(`
        UPDATE cooking_queue_items SET status = ?, meal_type = ?, planned_at = ?, prepared_ingredients_json = ?,
          shopping_list_synced_at = ?, completed_at = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND version = ?
      `).run(patch.status, patch.mealType ?? null, patch.plannedAt ?? null, jsonValue(patch.preparedIngredients),
        patch.shoppingListSyncedAt ?? null, patch.completedAt ?? null, id, userId, version);
      if (result.changes !== 1) return null;
      if (patch.status === "cancelled") this.releasePlanItems(userId, [id]);
      if (patch.status === "cooking") this.recordInterventionStart(id,userId);
      return this.findOwnedRow(id, userId)!;
    })();
  }

  private assertPlanSource(id: string, userId: number, version: number, status: string) {
    const queue = this.findOwnedRow(id, userId);
    if (!["cooking", "completed"].includes(status) || !queue?.source_plan_item_id || Number(queue.version) !== version || ["completed", "cancelled"].includes(String(queue.status))) return;
    const rows = this.database.prepare("SELECT i.*,p.constraints_json AS plan_constraints_json FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=? AND i.queue_item_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' ORDER BY i.id").all(userId, id) as QueueRow[];
    if (!rows.some(row => row.id === queue.source_plan_item_id)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "原餐次已变化，请刷新后重新核对");
    assertSqlitePlanExecution(this.database, rows);
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    try {
      this.database.transaction(() => {
        const active = this.database.prepare(`SELECT id, version FROM cooking_queue_items
          WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`).all(userId) as Array<{ id: string; version: number }>;
        if (active.length !== items.length) throw new Error("VERSION_CONFLICT");
        const versions = new Map(active.map((item) => [item.id, item.version]));
        const update = this.database.prepare(`UPDATE cooking_queue_items SET position = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL AND status IN (${activeStatuses})`);
        items.forEach((item, index) => {
          if (versions.get(item.id) !== item.version || update.run(index, item.id, userId, item.version).changes !== 1) {
            throw new Error("VERSION_CONFLICT");
          }
        });
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") return null;
      throw error;
    }
    return this.database.prepare(`${selectQueue} WHERE q.user_id = ? AND q.deleted_at IS NULL
      AND q.status IN (${activeStatuses}) ORDER BY q.position, q.created_at`).all(userId) as QueueRow[];
  }

  async transition(id: string, userId: number, version: number, status: "cooking" | "completed") {
    return this.database.transaction(() => {
    this.assertPlanSource(id, userId, version, status);
    const result = this.database.prepare(`UPDATE cooking_queue_items SET status = ?,
        planned_at = CASE WHEN ? = 'cooking' THEN NULL ELSE planned_at END,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
      .run(status, status, status, id, userId, version);
    if (result.changes !== 1) return null;
    if (status === "cooking") this.recordInterventionStart(id,userId);
    return this.findOwnedRow(id, userId)!;
    })();
  }

  async cancel(id: string, userId: number) {
    return this.cancelItems(userId, id) === 1;
  }

  async cancelAll(userId: number) {
    return this.cancelItems(userId);
  }

  private cancelItems(userId: number, id?: string) {
    return this.database.transaction(() => {
      const cancelled = this.database.prepare(`UPDATE cooking_queue_items SET status = 'cancelled',
        version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND deleted_at IS NULL AND status IN (${activeStatuses})${id ? " AND id = ?" : ""}
        RETURNING id`).all(...(id ? [userId, id] : [userId])) as Array<{ id: string }>;
      this.releasePlanItems(userId, cancelled.map(item => item.id));
      return cancelled.length;
    })();
  }

  private releasePlanItems(userId: number, queueIds: string[]) {
    const release = this.database.prepare(`UPDATE meal_plan_items SET status = 'planned', queue_item_id = NULL,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND queue_item_id = ? AND status IN ('queued', 'cooking') AND deleted_at IS NULL`);
    for (const id of queueIds) release.run(userId, id);
  }
}
