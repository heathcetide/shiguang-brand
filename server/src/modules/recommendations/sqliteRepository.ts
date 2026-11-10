import { SqliteMealAllocationsRepository } from "../mealAllocations/sqliteRepository.js";
import { effectiveDislikeRecipeIds, learningOverrides } from "./preferenceEvidence.js";
import { quantityEvidenceStatus } from "../inventory/evidence.js";
import type Database from "better-sqlite3";
import type { RecommendationRequestWrite, RecipeQuery, RecommendationsRepository } from "./repository.js";
import type { RecommendationEventInput, Row } from "./types.js";
import { calorieTarget } from "../health/projections.js";

export class SqliteRecommendationsRepository implements RecommendationsRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }
  async planningState(userId: number, startDate: string, _endDate: string) {
    const allocations = new SqliteMealAllocationsRepository(this.database).list(userId);
    return {
      items: this.database.prepare("SELECT i.* FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.planned_date>=? ORDER BY i.planned_date,i.id").all(userId,startDate) as Row[],
      plans: (this.database.prepare("SELECT id,constraints_json FROM meal_plans WHERE user_id=? AND deleted_at IS NULL AND status='active'").all(userId) as Row[]).map(plan => ({ ...plan, prepared_allocations: allocations.filter(row => row.planId === plan.id) })),
      shopping: this.database.prepare("SELECT id,name,amount,checked FROM shopping_list_items WHERE user_id=? AND deleted_at IS NULL ORDER BY id").all(userId) as Row[],
    };
  }
  async preparedMeals(userId: number) { return this.database.prepare("SELECT * FROM prepared_meals WHERE user_id=? AND remaining_servings>0 ORDER BY produced_at,id").all(userId) as Row[]; }
  async profile(userId: number) { return (this.database.prepare(`SELECT allergies_json, dietary_restrictions_json, disliked_foods,
    kitchen_constraints_json, nutrition_targets_json, updated_at FROM user_health_profiles WHERE user_id = ?`).get(userId) as Row | undefined) || null; }
  async inventory(userId: number): Promise<Row[]> { const rows = this.database.prepare(`SELECT id, food_name, expiration_date, updated_at, quantity_value, quantity_unit, batch_code, version, (SELECT metadata_json FROM inventory_change_logs e WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence FROM inventory_items
    WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL ORDER BY CASE WHEN expiration_date = '' THEN 1 ELSE 0 END, expiration_date, id`).all(userId) as Row[]; return rows.map(row => ({ ...row, quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence, row.version) })); }
  async kitchenware(userId: number) { return this.database.prepare(`SELECT k.id, k.name, k.updated_at, k.attributes_json,
    (SELECT c.id FROM kitchenware_catalog c WHERE c.quality_status='trusted' AND (c.id=k.catalog_id OR (k.catalog_id IS NULL AND c.name=k.name)) LIMIT 1) AS catalog_id
    FROM kitchenware_items k WHERE k.user_id = ? AND k.deleted_at IS NULL AND k.status <> '维修中' ORDER BY k.id`).all(userId) as Row[]; }
  async recipes(query: RecipeQuery) {
    const filters = ["deleted_at IS NULL", "status = 'approved'", "COALESCE(quality_status, 'trusted') NOT IN ('needs_review','reference')"];
    const params: Array<string | number> = [];
    if (query.category && query.category !== "全部" && query.category !== "冰箱可做") { filters.push("category = ?"); params.push(query.category); }
    if (query.search) { filters.push("(title LIKE ? OR description LIKE ? OR tags LIKE ? OR ingredients_json LIKE ?)");
      const term = `%${query.search}%`; params.push(term, term, term, term); }
    if (query.timeBudget) { filters.push("(cook_time <= ? OR execution_json IS NOT NULL)"); params.push(query.timeBudget); }
    return this.database.prepare(`SELECT * FROM recipes WHERE ${filters.join(" AND ")} ORDER BY id`).all(...params) as Row[];
  }
  async favoriteRecipeIds(userId: number) { return (this.database.prepare("SELECT recipe_id FROM recipe_favorites WHERE user_id = ?")
    .all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id); }
  async recentRecipeIds(userId: number) { return (this.database.prepare(`SELECT DISTINCT recipe_id FROM cooking_queue_items
    WHERE user_id = ? AND status = 'completed' AND updated_at >= datetime('now', '-30 day')`).all(userId) as Array<{ recipe_id: number }>).map((row) => row.recipe_id); }
  async preferenceOutcomes(userId: number) {
    const production = this.database.prepare("SELECT id,recipe_id,food_name,produced_servings,remaining_servings,updated_at,produced_at,reported_cooking_minutes FROM prepared_meals WHERE user_id=? AND produced_at>=datetime('now','-30 day')").all(userId) as Row[];
    const events = this.database.prepare(`SELECT e.id,e.event_type,e.servings,e.created_at,e.diet_record_id,m.recipe_id,m.food_name,c.id AS correction_id,c.mode AS correction_mode,c.created_at AS corrected_at
      FROM prepared_meal_events e JOIN prepared_meals m ON m.id=e.prepared_meal_id AND m.user_id=e.user_id
      LEFT JOIN prepared_meal_intake_corrections c ON c.event_id=e.id AND c.user_id=e.user_id
      WHERE e.user_id=? AND (e.created_at>=datetime('now','-30 day') OR c.created_at>=datetime('now','-30 day'))`).all(userId) as Row[];
    const inventory = this.database.prepare(`SELECT l.id,l.created_at,l.quantity_after,l.quantity_unit,l.metadata_json,i.food_name,i.deleted_at,u.id AS undo_id
      FROM inventory_change_logs l JOIN inventory_items i ON i.id=l.inventory_item_id AND i.user_id=l.user_id
      LEFT JOIN inventory_change_logs u ON u.inventory_item_id=l.inventory_item_id AND u.user_id=l.user_id AND json_extract(u.metadata_json,'$.intake_undo_job') IS NOT NULL
      WHERE l.user_id=? AND l.action='created' AND json_extract(l.metadata_json,'$.acceptance') IN ('manual','automatic') AND l.created_at>=datetime('now','-30 day')`).all(userId) as Row[];
    const changes = this.database.prepare("SELECT id,status,after_json,created_at,applied_at FROM meal_plan_changes WHERE user_id=? AND status IN ('applied','reverted') AND created_at>=datetime('now','-30 day')").all(userId) as Row[];
    const statements = this.database.prepare(`SELECT a.id,a.status,a.before_json,a.result_json,a.created_at,a.executed_at,h.kitchen_constraints_json AS current_preferences
      FROM agent_actions a JOIN agent_runs r ON r.id=a.run_id AND r.user_id=a.user_id
      LEFT JOIN user_health_profiles h ON h.user_id=a.user_id
      WHERE a.user_id=? AND r.source='assistant' AND a.action_type='update_kitchen_preferences' AND a.status IN ('executed','undone') AND a.created_at>=datetime('now','-30 day')`).all(userId) as Row[];
    return { production,events,inventory,changes,statements };
  }
  async learningData(userId: number) {
    const settings = this.database.prepare("SELECT * FROM recommendation_learning_settings WHERE user_id=?").get(userId) as Row | undefined;
    const events = this.database.prepare("SELECT id,recipe_id,event_type,metadata_json,idempotency_key,created_at FROM recipe_recommendation_events WHERE user_id=? AND event_type='skip' AND created_at>=datetime('now','-30 day')").all(userId) as Row[];
    const ids = [...new Set([...events.map(event => Number(event.recipe_id)),...Object.keys(learningOverrides(settings ?? null)).map(Number)])];
    const recipes = ids.length ? this.database.prepare(`SELECT id,title FROM recipes WHERE status='approved' AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[] : [];
    return { settings: settings ?? null,events,recipes };
  }
  async updateLearning(userId: number,input: import("@dietdigidose/contracts").PreferenceLearningUpdate) {
    return this.database.transaction(() => {
      this.database.prepare("INSERT INTO recommendation_learning_settings(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING").run(userId);
      const current = this.database.prepare("SELECT * FROM recommendation_learning_settings WHERE user_id=?").get(userId) as Row;
      if (Number(current.version) !== input.version) return false;
      const overrides = learningOverrides(current);
      if (input.kind === "recipe") overrides[String(input.recipeId)] = { value: input.value,updatedAt: new Date().toISOString() };
      this.database.prepare("UPDATE recommendation_learning_settings SET enabled=?,overrides_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(input.kind === "learning" ? Number(input.enabled) : current.enabled,JSON.stringify(overrides),userId);
      return true;
    })();
  }
  async skippedRecipeIds(userId: number) { return effectiveDislikeRecipeIds(await this.learningData(userId)); }
  async dietTotals(userId: number, date: string) { const row = this.database.prepare(`SELECT COALESCE(SUM(calories), 0) AS calories,
    COALESCE(SUM(protein), 0) AS protein FROM diet_records WHERE user_id = ? AND recorded_at = ?`).get(userId, date) as { calories: number; protein: number };
    return { calories: Number(row.calories), protein: Number(row.protein) }; }
  async dailyCaloriesTarget(userId: number) { const row = this.database.prepare("SELECT nutrition_targets_json,nutrition_target_source FROM user_health_profiles WHERE user_id = ?").get(userId) as Row | undefined;
    const target = calorieTarget(row); return target.value ?? target.referenceValue; }
  async findRequest(userId: number, requestId: string) { return (this.database.prepare(`SELECT * FROM recipe_recommendation_requests
    WHERE id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP`).get(requestId, userId) as Row | undefined) || null; }
  async createRequest(input: RecommendationRequestWrite) { this.database.prepare(`INSERT INTO recipe_recommendation_requests
    (id, user_id, surface, scoring_version, candidate_version, input_hash, input_snapshot_json, results_json, data_updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hour'))`).run(input.id, input.userId, input.surface, input.scoringVersion,
    input.candidateVersion, input.inputHash, JSON.stringify(input.inputSnapshot), JSON.stringify(input.results), input.dataUpdatedAt); }
  async findEvent(userId: number, idempotencyKey: string) { return (this.database.prepare(`SELECT * FROM recipe_recommendation_events
    WHERE user_id = ? AND idempotency_key = ?`).get(userId, idempotencyKey) as Row | undefined) || null; }
  async recipeAvailable(recipeId: number) { return Boolean(this.database.prepare(`SELECT id FROM recipes
    WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(recipeId)); }
  async requestEvidence(userId: number, requestId: string) { return (this.database.prepare(`SELECT id,scoring_version,results_json FROM recipe_recommendation_requests
    WHERE id = ? AND user_id = ?`).get(requestId, userId) as Row | undefined) ?? null; }
  async createEvent(id: string, userId: number, input: RecommendationEventInput) {
    try {
      this.database.prepare(`INSERT INTO recipe_recommendation_events
        (id, user_id, request_id, recipe_id, event_type, scoring_version, surface, metadata_json, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ?='skip' THEN json_set(?,'$.learningPaused',json(CASE WHEN EXISTS(SELECT 1 FROM recommendation_learning_settings WHERE user_id=? AND enabled=0) THEN 'true' ELSE 'false' END)) ELSE ? END, ?)`).run(id, userId, input.requestId ?? null, input.recipeId, input.eventType,
        input.scoringVersion, input.surface,input.eventType, JSON.stringify(input.metadata ?? {}),userId,JSON.stringify(input.metadata ?? {}), input.idempotencyKey);
      return { id, repeated: false };
    } catch (error) {
      if (!(typeof error === "object" && error && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT"))) throw error;
      const existing = await this.findEvent(userId, input.idempotencyKey);
      if (!existing) throw error;
      return { id: String(existing.id), repeated: true };
    }
  }
}
