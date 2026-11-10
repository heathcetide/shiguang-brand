import { PostgresMealAllocationsRepository } from "../mealAllocations/postgresRepository.js";
import { effectiveDislikeRecipeIds, learningOverrides } from "./preferenceEvidence.js";
import { quantityEvidenceStatus } from "../inventory/evidence.js";
import type { Pool } from "pg";
import type { RecommendationRequestWrite, RecipeQuery, RecommendationsRepository } from "./repository.js";
import type { RecommendationEventInput, Row } from "./types.js";
import { calorieTarget } from "../health/projections.js";

export class PostgresRecommendationsRepository implements RecommendationsRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async planningState(userId: number, startDate: string, _endDate: string) {
    const [items,plans,shopping] = await Promise.all([
      this.pool.query("SELECT i.* FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=$1 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.planned_date>=$2 ORDER BY i.planned_date,i.id",[userId,startDate]),
      this.pool.query("SELECT id,constraints_json FROM meal_plans WHERE user_id=$1 AND deleted_at IS NULL AND status='active'",[userId]),
      this.pool.query("SELECT id,name,amount,checked FROM shopping_list_items WHERE user_id=$1 AND deleted_at IS NULL ORDER BY id",[userId]),
    ]);
    const allocations = await new PostgresMealAllocationsRepository(this.pool).list(userId);
    return { items: items.rows,plans: plans.rows.map(plan => ({ ...plan, prepared_allocations: allocations.filter(row => row.planId === plan.id) })),shopping: shopping.rows };
  }
  async preparedMeals(userId: number) { return (await this.pool.query("SELECT * FROM prepared_meals WHERE user_id=$1 AND remaining_servings>0 ORDER BY produced_at,id", [userId])).rows as Row[]; }
  async profile(userId: number) { return ((await this.pool.query(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = $1`, [userId])).rows[0] as Row | undefined) || null; }
  async inventory(userId: number): Promise<Row[]> { const rows = (await this.pool.query(`SELECT id, food_name, expiration_date, updated_at, quantity_value, quantity_unit, batch_code, version, (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id AND e.metadata_json->'field_evidence'->>'quantity' IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence FROM inventory_items
    WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date, id`, [userId])).rows as Row[]; return rows.map(row => ({ ...row, quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence, row.version) })); }
  async kitchenware(userId: number) { return (await this.pool.query(`SELECT k.id, k.name, k.updated_at, k.attributes_json,
    (SELECT c.id FROM kitchenware_catalog c WHERE c.quality_status='trusted' AND (c.id=k.catalog_id OR (k.catalog_id IS NULL AND c.name=k.name)) LIMIT 1) AS catalog_id
    FROM kitchenware_items k WHERE k.user_id = $1 AND k.deleted_at IS NULL AND k.status <> '维修中' ORDER BY k.id`, [userId])).rows as Row[]; }
  async recipes(query: RecipeQuery) {
    const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') NOT IN ('needs_review','reference')"];
    const params: Array<string | number> = [];
    const parameter = (value: string | number) => { params.push(value); return `$${params.length}`; };
    if (query.category && query.category !== "全部" && query.category !== "冰箱可做") filters.push(`category = ${parameter(query.category)}`);
    if (query.search) { const term = parameter(`%${query.search}%`); filters.push(`(title ILIKE ${term} OR description ILIKE ${term}
      OR tags::text ILIKE ${term} OR ingredients_json::text ILIKE ${term})`); }
    if (query.timeBudget) filters.push(`(cook_time <= ${parameter(query.timeBudget)} OR execution_json IS NOT NULL)`);
    return (await this.pool.query(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`, params)).rows as Row[];
  }
  async favoriteRecipeIds(userId: number) { return (await this.pool.query("SELECT recipe_id FROM recipe_favorites WHERE user_id = $1", [userId])).rows.map((row) => Number(row.recipe_id)); }
  async recentRecipeIds(userId: number) { return (await this.pool.query(`SELECT DISTINCT recipe_id FROM cooking_queue_items
    WHERE user_id = $1 AND status = 'completed' AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`, [userId])).rows.map((row) => Number(row.recipe_id)); }
  async preferenceOutcomes(userId: number) {
    const [production,events] = await Promise.all([
      this.pool.query("SELECT id,recipe_id,food_name,produced_servings,remaining_servings,updated_at,produced_at,reported_cooking_minutes FROM prepared_meals WHERE user_id=$1 AND produced_at>=CURRENT_TIMESTAMP-INTERVAL '30 days'",[userId]),
      this.pool.query(`SELECT e.id,e.event_type,e.servings,e.created_at,e.diet_record_id,m.recipe_id,m.food_name,c.id AS correction_id,c.mode AS correction_mode,c.created_at AS corrected_at
        FROM prepared_meal_events e JOIN prepared_meals m ON m.id=e.prepared_meal_id AND m.user_id=e.user_id
        LEFT JOIN prepared_meal_intake_corrections c ON c.event_id=e.id AND c.user_id=e.user_id
        WHERE e.user_id=$1 AND (e.created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days' OR c.created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days')`,[userId]),
    ]);
    const [inventory,changes] = await Promise.all([
      this.pool.query(`SELECT l.id,l.created_at,l.quantity_after,l.quantity_unit,l.metadata_json,i.food_name,i.deleted_at,u.id AS undo_id
        FROM inventory_change_logs l JOIN inventory_items i ON i.id=l.inventory_item_id AND i.user_id=l.user_id
        LEFT JOIN inventory_change_logs u ON u.inventory_item_id=l.inventory_item_id AND u.user_id=l.user_id AND u.metadata_json->>'intake_undo_job' IS NOT NULL
        WHERE l.user_id=$1 AND l.action='created' AND l.metadata_json->>'acceptance' IN ('manual','automatic') AND l.created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days'`,[userId]),
      this.pool.query("SELECT id,status,after_json,created_at,applied_at FROM meal_plan_changes WHERE user_id=$1 AND status IN ('applied','reverted') AND created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days'",[userId]),
    ]);
    const statements = (await this.pool.query(`SELECT a.id,a.status,a.before_json,a.result_json,a.created_at,a.executed_at,h.kitchen_constraints_json AS current_preferences
      FROM agent_actions a JOIN agent_runs r ON r.id=a.run_id AND r.user_id=a.user_id
      LEFT JOIN user_health_profiles h ON h.user_id=a.user_id
      WHERE a.user_id=$1 AND r.source='assistant' AND a.action_type='update_kitchen_preferences' AND a.status IN ('executed','undone') AND a.created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days'`,[userId])).rows as Row[];
    return { production: production.rows as Row[],events: events.rows as Row[],inventory: inventory.rows as Row[],changes: changes.rows as Row[],statements };
  }
  async learningData(userId: number) {
    const settings = (await this.pool.query("SELECT * FROM recommendation_learning_settings WHERE user_id=$1",[userId])).rows[0] as Row | undefined;
    const events = (await this.pool.query("SELECT id,recipe_id,event_type,metadata_json,idempotency_key,created_at FROM recipe_recommendation_events WHERE user_id=$1 AND event_type='skip' AND created_at>=CURRENT_TIMESTAMP-INTERVAL '30 days'",[userId])).rows as Row[];
    const ids = [...new Set([...events.map(event => Number(event.recipe_id)),...Object.keys(learningOverrides(settings ?? null)).map(Number)])];
    const recipes = ids.length ? (await this.pool.query("SELECT id,title FROM recipes WHERE status='approved' AND deleted_at IS NULL AND id=ANY($1::integer[])",[ids])).rows as Row[] : [];
    return { settings: settings ?? null,events,recipes };
  }
  async updateLearning(userId: number,input: import("@dietdigidose/contracts").PreferenceLearningUpdate) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO recommendation_learning_settings(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[userId]);
      const current = (await client.query("SELECT * FROM recommendation_learning_settings WHERE user_id=$1 FOR UPDATE",[userId])).rows[0] as Row;
      if (Number(current.version) !== input.version) { await client.query("ROLLBACK"); return false; }
      const overrides = learningOverrides(current);
      if (input.kind === "recipe") overrides[String(input.recipeId)] = { value: input.value,updatedAt: new Date().toISOString() };
      await client.query("UPDATE recommendation_learning_settings SET enabled=$1,overrides_json=$2::jsonb,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$3",[input.kind === "learning" ? input.enabled : current.enabled,JSON.stringify(overrides),userId]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async skippedRecipeIds(userId: number) { return effectiveDislikeRecipeIds(await this.learningData(userId)); }
  async dietTotals(userId: number, date: string) { const row = (await this.pool.query(`SELECT COALESCE(SUM(calories), 0) AS calories,
    COALESCE(SUM(protein), 0) AS protein FROM diet_records WHERE user_id = $1 AND recorded_at = $2`, [userId, date])).rows[0];
    return { calories: Number(row.calories), protein: Number(row.protein) }; }
  async dailyCaloriesTarget(userId: number) { const row = (await this.pool.query("SELECT nutrition_targets_json,nutrition_target_source FROM user_health_profiles WHERE user_id = $1", [userId])).rows[0];
    const target = calorieTarget(row); return target.value ?? target.referenceValue; }
  async findRequest(userId: number, requestId: string) { return ((await this.pool.query(`SELECT * FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2 AND expires_at > CURRENT_TIMESTAMP`, [requestId, userId])).rows[0] as Row | undefined) || null; }
  async createRequest(input: RecommendationRequestWrite) { await this.pool.query(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, CURRENT_TIMESTAMP + INTERVAL '24 hours')`, [input.id, input.userId,
    input.surface, input.scoringVersion, input.candidateVersion, input.inputHash, JSON.stringify(input.inputSnapshot), JSON.stringify(input.results), input.dataUpdatedAt]); }
  async findEvent(userId: number, idempotencyKey: string) { return ((await this.pool.query(`SELECT * FROM recipe_recommendation_events
    WHERE user_id = $1 AND idempotency_key = $2`, [userId, idempotencyKey])).rows[0] as Row | undefined) || null; }
  async recipeAvailable(recipeId: number) { return Boolean((await this.pool.query(`SELECT id FROM recipes
    WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL`, [recipeId])).rows[0]); }
  async requestEvidence(userId: number, requestId: string) { return (await this.pool.query(`SELECT id,scoring_version,results_json FROM recipe_recommendation_requests
    WHERE id = $1 AND user_id = $2`, [requestId, userId])).rows[0] ?? null; }
  async createEvent(id: string, userId: number, input: RecommendationEventInput) {
    const result = await this.pool.query(`INSERT INTO recipe_recommendation_events
      (id, user_id, request_id, recipe_id, event_type, scoring_version, surface, metadata_json, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5='skip' THEN jsonb_set($8::jsonb,'{learningPaused}',to_jsonb(EXISTS(SELECT 1 FROM recommendation_learning_settings WHERE user_id=$2 AND enabled=FALSE))) ELSE $8::jsonb END, $9) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
    [id, userId, input.requestId ?? null, input.recipeId, input.eventType, input.scoringVersion, input.surface,
      JSON.stringify(input.metadata ?? {}), input.idempotencyKey]);
    if (result.rows[0]) return { id, repeated: false };
    const existing = await this.findEvent(userId, input.idempotencyKey);
    if (!existing) throw new Error("RECOMMENDATION_EVENT_CONFLICT");
    return { id: String(existing.id), repeated: true };
  }
}
