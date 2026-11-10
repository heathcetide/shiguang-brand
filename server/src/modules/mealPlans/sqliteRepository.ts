import type { ActiveMealChangePreviewInput } from "@dietdigidose/contracts";
import { readSqliteReplacementSnapshot } from "./sqliteReplacementSnapshot.js";
import { prepareReplacement, replacementRequiresValidation, assertReplacementValidation, replacementPatchRequest, type ReplacementContext } from "./replacementSnapshot.js";
import { preparePersonalShopping, personalShoppingClientId } from "./personalShopping.js";
import { quantityEvidenceStatus } from "../inventory/evidence.js";
import { recipeExecutionProof } from "../recipes/planExecution.js";
import { assertSqlitePlanExecution } from "../recipes/sqliteRepository.js";
import { commonProduction } from "./commonProduction.js";
import { cookingEvidenceMatches } from "../recipes/substitutions.js";
import { SqliteMealAllocationsRepository } from "../mealAllocations/sqliteRepository.js";
import { preparedAllocationsAvailable } from "./preparedAllocations.js";
import { readSqliteDiningSupply } from "../households/sqliteDiningSupply.js";
import { prepareNetDiningShopping } from "../households/diningNetShopping.js";
import { prepareDiningShopping } from "../households/diningShopping.js";
import { validateSqliteDiningPlan } from "../households/sqliteDiningPlan.js";
import { replacementAllocation } from "./replacementAllocation.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { mealChangeDecision, mealChangeSnapshot, mealChangeFingerprint, formatMealChange, isMealChangeNoop, planMetadataPreservesItem, type PlanMetadataEdit } from "./changePolicy.js";
import { prepareDraftActivation } from "./draftActivation.js";
import type { SaveCookingPlanDraftInput, UpdateCookingPlanDraftInput } from "@dietdigidose/contracts";
import { isDeepStrictEqual } from "node:util";
import { SqliteDietRecordsRepository } from "../dietRecords/sqliteRepository.js";
import { prepareProduction } from "../dietRecords/preparedMeals.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const itemSelect = `SELECT i.*,
  (SELECT q.recipe_snapshot_json FROM cooking_queue_items q WHERE q.id=i.queue_item_id AND q.user_id=i.user_id) AS queue_snapshot_json,
  (SELECT hm.id FROM household_meal_batches hm WHERE hm.plan_item_id=i.id AND hm.created_by_user_id=i.user_id) AS household_meal_id,
  (SELECT hm.household_id FROM household_meal_batches hm WHERE hm.plan_item_id=i.id AND hm.created_by_user_id=i.user_id) AS household_id, p.constraints_json AS plan_constraints_json, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class SqliteMealPlansRepository implements MealPlansRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) { this.database = database; }

  private readonly readRows = (sql: string, parameters: unknown[]): Row[] => this.database.prepare(sql).all(...parameters) as Row[];
  private async prepareChange(userId: number, planId: string, itemId: string, request: ActiveMealChangePreviewInput) {
    const snapshot = this.database.transaction(() => readSqliteReplacementSnapshot(this.readRows,userId,request))();
    return { request, prepared: await prepareReplacement(snapshot,userId,planId,itemId,request) } satisfies ReplacementContext;
  }
  async previewChange(userId: number, planId: string, itemId: string, request: ActiveMealChangePreviewInput) {
    return (await this.prepareChange(userId,planId,itemId,request)).prepared?.preview ?? null;
  }

  async activateDraft(userId: number, id: string, version: number) {
    return this.database.transaction(() => {
      const current = this.getPlan(id, userId, false);
      if (!current) return { kind: "not_found" as const };
      const activation = prepareDraftActivation(current, version);
      if (!activation) return { kind: "version_conflict" as const };
      if (activation.repeated) return { kind: "updated" as const, value: { plan: this.formatPlan(current, userId), repeated: true } };
      const batches = activation.targets.some(target => target.allocations.length)
        ? new SqliteDietRecordsRepository(this.database).listPreparedMealsInTransaction(userId) : [];
      const allocations = new SqliteMealAllocationsRepository(this.database).list(userId);
      if (!preparedAllocationsAvailable(activation.targets, batches, [{ prepared_allocations: allocations }])) return { kind: "version_conflict" as const };
      if (activation.weekly) {
        const occupied = this.database.prepare("SELECT i.planned_date,i.meal_type FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=? AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.status<>'skipped'").all(userId) as Row[];
        for (const allocation of allocations) {
          if (allocation.status === "conflict" || (allocation.status === "active" && allocation.remainingServings > 0)) {
            occupied.push({ planned_date: allocation.plannedDate, meal_type: allocation.mealType });
          }
        }
        if (activation.targets.some(target => occupied.some(item => String(item.planned_date) === target.date && queueMealType(item.meal_type) === target.mealType))) return { kind: "version_conflict" as const };
      }
      if (this.getItems(id, userId).length) return { kind: "version_conflict" as const };
      const recipeIds = [...new Set(activation.items.flatMap(item => [item.recipeId, ...(item.allocation.substitution ? [item.allocation.substitution.sourceRecipeId] : [])]))].sort((a, b) => a-b);
      const recipes = new Map(recipeIds.map(recipeId => [recipeId, this.database.prepare("SELECT * FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL").get(recipeId) as Row | undefined]));
      if (activation.items.some(item => !recipes.get(item.recipeId) || !cookingEvidenceMatches(item.allocation, recipes.get(item.allocation.substitution?.sourceRecipeId ?? 0), recipes.get(item.recipeId)))) return { kind: "recipe_not_available" as const };
      Object.assign(activation.constraints, { executionRecipeKeys: Object.fromEntries(activation.items.map(item => [item.id,
        recipeExecutionProof(recipes.get(item.recipeId)!, recipes.get(item.allocation.substitution?.sourceRecipeId ?? 0))])) });
      activation.items.forEach(item => this.database.prepare(`INSERT INTO meal_plan_items
        (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,confirmed_at)
        VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(item.id,id,userId,item.date,item.mealType,item.title,item.recipeId,JSON.stringify(item.ingredients),recipes.get(item.recipeId)!.steps_json));
      this.database.prepare("UPDATE meal_plans SET status='active',constraints_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .run(JSON.stringify(activation.constraints),id,userId);
      new SqliteMealAllocationsRepository(this.database).reserve(userId,id,activation.targets);
      return { kind: "updated" as const, value: { plan: this.formatPlan(this.getPlan(id,userId,false)!,userId), repeated: false } };
    })();
  }

  async updateDraft(userId: number, id: string, input: UpdateCookingPlanDraftInput) {
    return this.database.transaction(() => {
      const current = this.getPlan(id, userId, false);
      if (!current) return { kind: "not_found" as const };
      const constraints = parseJson<Row>(current.constraints_json, {});
      const last = constraints.lastDraftUpdate as UpdateCookingPlanDraftInput | undefined;
      if (last?.idempotencyKey === input.idempotencyKey) {
        if (!isDeepStrictEqual(last, input)) return { kind: "version_conflict" as const };
        return { kind: "updated" as const, value: { plan: this.formatPlan(current, userId), repeated: true } };
      }
      if (Number(current.version) !== input.version || current.status !== "draft" || !constraints.savedCookingDraft || this.getItems(id, userId).length) {
        return { kind: "version_conflict" as const };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      this.database.prepare(`UPDATE meal_plans SET constraints_json=?,start_date=?,end_date=?,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND version=?`).run(
        JSON.stringify({ ...constraints, currentCookingDraft: input.draft, lastDraftUpdate: input }), dates[0], dates.at(-1), id, userId, input.version);
      return { kind: "updated" as const, value: { plan: this.formatPlan(this.getPlan(id, userId, false)!, userId), repeated: false } };
    })();
  }

  async saveDraft(userId: number, input: SaveCookingPlanDraftInput) {
    return this.database.transaction(() => {
      const existing = this.database.prepare("SELECT * FROM meal_plans WHERE id = ?").get(input.id) as Row | undefined;
      const snapshot = { title: input.title, draft: input.draft };
      if (existing) {
        if (Number(existing.user_id) !== userId || !isDeepStrictEqual(parseJson<Row>(existing.constraints_json, {}).savedCookingDraft, snapshot)) return null;
        return { plan: this.formatPlan(existing, userId), repeated: true };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      this.database.prepare(`INSERT INTO meal_plans (id,user_id,title,start_date,end_date,status,source,constraints_json)
        VALUES (?,?,?,?,?,'draft','manual',?)`).run(input.id, userId, input.title, dates[0], dates.at(-1),
        JSON.stringify({ savedCookingDraft: snapshot }));
      return { plan: this.formatPlan(this.getPlan(input.id, userId, false)!, userId), repeated: false };
    })();
  }

  async list(userId: number, includeArchived: boolean) {
    const rows = this.database.prepare(`SELECT * FROM meal_plans WHERE user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, created_at DESC`).all(userId) as Row[];
    return rows.map((row) => this.formatPlan(row, userId));
  }

  async find(userId: number, id: string, includeArchived: boolean) {
    const row = this.getPlan(id, userId, includeArchived);
    return row ? this.formatPlan(row, userId) : null;
  }

  async updatePlan(userId: number, id: string, input: MealPlanUpdateInput) {
    return this.database.transaction(() => {
    const current = this.getPlan(id, userId, false);
    if (!current) return { kind: "not_found" as const };
    const startDate = input.startDate ?? String(current.start_date);
    const endDate = input.endDate ?? String(current.end_date);
    if (startDate > endDate) return { kind: "invalid_date_range" as const };
    this.assertPlanEditInTransaction(userId,id,input);
    if (input.status && ["active", "draft"].includes(input.status) && current.status !== input.status && parseJson<Row>(current.constraints_json, {}).savedCookingDraft) return { kind: "version_conflict" as const };
    const changed = this.database.prepare(`UPDATE meal_plans SET title = ?, start_date = ?, end_date = ?, status = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(input.title ?? current.title, startDate, endDate, input.status ?? current.status, id, userId, input.version);
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    if (input.status && input.status !== "active") new SqliteMealAllocationsRepository(this.database).release(userId,id);
    return { kind: "updated" as const, value: this.formatPlan(this.getPlan(id, userId, false)!, userId) };
  })();
  }

  async removePlan(userId: number, id: string, version: number) {
    return this.database.transaction(() => {
    this.assertPlanEditInTransaction(userId,id,{ archive: true });
    const changed = this.database.prepare(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`)
      .run(id, userId, version);
    if (changed.changes === 1) { new SqliteMealAllocationsRepository(this.database).release(userId,id); return "removed" as const; }
    return this.getPlan(id, userId, false) ? "version_conflict" as const : "not_found" as const;
  })();
  }

  assertPlanEditInTransaction(userId: number, planId: string, edit: PlanMetadataEdit) {
    const items = this.readRows("SELECT * FROM meal_plan_items WHERE plan_id=? AND user_id=? AND deleted_at IS NULL ORDER BY id",[planId,userId]);
    for (const item of items) {
      const facts = this.changeFacts(item,userId);
      if (!planMetadataPreservesItem(item,facts.decision,edit)) throw new InventoryQuantityError("MEAL_PLAN_PROTECTED", "餐单包含已确认、已采购或已进入制作的安排，或日期将排除已有餐次；请先逐餐审阅调整，原安排已保留");
    }
  }

  private changeFacts(item: Row, userId: number) {
    const queue = item.queue_item_id ? this.database.prepare("SELECT id,version,status FROM cooking_queue_items WHERE id=? AND user_id=? AND deleted_at IS NULL").get(item.queue_item_id, userId) as Row | undefined : undefined;
    const purchases = this.readRows("SELECT id,version,checked FROM shopping_list_items WHERE user_id=? AND client_id LIKE ? ORDER BY id",[userId, `meal-plan:${item.id}:%`]);
    const sharedPurchases = this.readRows("SELECT id,version,(checked OR transferred_at IS NOT NULL) AS checked FROM household_shopping_items WHERE source_plan_item_id=? ORDER BY id",[item.id]);
    purchases.push(...sharedPurchases.map(row => ({ ...row,id: `household:${row.id}` })));
    return { decision: mealChangeDecision(item, queue, purchases), snapshot: mealChangeSnapshot(item, queue, purchases) };
  }

  async confirmItem(userId: number, planId: string, itemId: string, version: number) {
    return this.database.transaction(() => {
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== version) return { kind: "version_conflict" as const };
      if (!item.confirmed_at) this.database.prepare("UPDATE meal_plan_items SET confirmed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(itemId, userId);
      return { kind: "updated" as const, value: formatMealPlanItem(this.getItem(planId, itemId, userId)!) };
    })();
  }

  async listChanges(userId: number, planId: string) {
    return (this.readRows("SELECT * FROM meal_plan_changes WHERE user_id=? AND plan_id=? ORDER BY created_at DESC,id DESC",[userId,planId])).map(formatMealChange);
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排") {
    const validation = input.validationFingerprint ? await this.prepareChange(userId,planId,itemId,replacementPatchRequest(input)) : undefined;
    return this.updateItemInTransaction(userId,planId,itemId,input,source,reason,validation);
  }

  /** Synchronous so maintenance can atomically commit a whole batch and its acknowledgement. */
  updateItemInTransaction(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排", validation?: ReplacementContext) {
    return this.database.transaction(() => {
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      const facts = this.changeFacts(item, userId);
      if (Number(item.version) === input.version && isMealChangeNoop(item,input)) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      const fingerprint = mealChangeFingerprint(itemId, facts.snapshot, input);
      const existing = this.database.prepare("SELECT * FROM meal_plan_changes WHERE user_id=? AND fingerprint=?").get(userId, fingerprint) as Row | undefined;
      if (existing) return { kind: "updated" as const, value: { ...formatMealPlanItem(item), change: formatMealChange(existing) } };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const replacement = input.recipeId ? this.database.prepare("SELECT title FROM recipes WHERE id=? AND status='approved' AND deleted_at IS NULL").get(input.recipeId) as Row | undefined : undefined;
      if (input.recipeId && !replacement) return { kind: "recipe_not_available" as const };
      if (item.dining_json && input.dining === undefined && input.recipeId !== undefined && input.recipeId !== item.recipe_id)
        throw new InventoryQuantityError("DINING_REVIEW_REQUIRED","更换共餐菜谱前，请重新核对所有参与成员的限制并提交共餐安排");
      const dining = input.dining === undefined ? parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan | null>(item.dining_json,null) : input.dining;
      if (dining) validateSqliteDiningPlan(this.database,userId,input.recipeId === undefined ? item.recipe_id : input.recipeId,dining);
      if (source === "maintenance" && facts.decision === "apply" && replacementRequiresValidation(item,input)) {
        facts.decision = "suggest";
        reason += "；需先预览当前整套餐单，未自动应用";
      }
      if (input.validationFingerprint && replacementRequiresValidation(item,input))
        assertReplacementValidation(validation?.prepared,validation ? readSqliteReplacementSnapshot(this.readRows,userId,validation.request) : undefined,input.validationFingerprint);
      const proposal = { ...input, title: String(replacement?.title || item.recipe_title || item.title) };
      const id = randomUUID();
      let next = formatMealPlanItem(item);
      if (facts.decision === "apply") {
        const applied = this.applyItemChange(userId, planId, itemId, input, validation);
        if (applied.kind !== "updated") return applied;
        next = applied.value;
      }
      this.database.prepare(`INSERT INTO meal_plan_changes(id,user_id,plan_id,item_id,fingerprint,source,reason,status,before_version,after_version,before_json,after_json,applied_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)`).run(id,userId,planId,itemId,fingerprint,source,reason,
        facts.decision === "apply" ? "applied" : facts.decision === "suggest" ? "pending" : "blocked", input.version,
        facts.decision === "apply" ? next.version : null,JSON.stringify(facts.snapshot),JSON.stringify(proposal),facts.decision === "apply" ? 1 : 0);
      return { kind: "updated" as const, value: { ...next, change: formatMealChange(this.database.prepare("SELECT * FROM meal_plan_changes WHERE id=?").get(id) as Row) } };
    })();
  }

  async reviewChange(userId: number, planId: string, changeId: string, action: "accept" | "reject" | "restore", validationFingerprint?: string) {
    const saved = validationFingerprint && action !== "reject" ? this.readRows("SELECT item_id FROM meal_plan_changes WHERE id=? AND user_id=? AND plan_id=?",[changeId,userId,planId])[0] : undefined;
    const validation = saved && action !== "reject" ? await this.prepareChange(userId,planId,String(saved.item_id),{ changeId,action }) : undefined;
    return this.database.transaction(() => {
      const change = this.database.prepare("SELECT * FROM meal_plan_changes WHERE id=? AND user_id=? AND plan_id=?").get(changeId,userId,planId) as Row | undefined;
      if (!change) return { kind: "not_found" as const };
      const item = this.getItem(planId,String(change.item_id),userId);
      if (!item) return { kind: "not_found" as const };
      if ((action === "accept" && change.status === "applied") || (action === "reject" && change.status === "rejected") || (action === "restore" && change.status === "reverted")) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      if (action === "reject" && change.status === "pending") {
        this.database.prepare("UPDATE meal_plan_changes SET status='rejected' WHERE id=?").run(changeId);
        return { kind: "updated" as const, value: formatMealPlanItem(item) };
      }
      if ((action === "accept" && change.status !== "pending") || (action === "restore" && change.status !== "applied") || action === "reject") return { kind: "version_conflict" as const };
      const facts = this.changeFacts(item,userId);
      const before = parseJson<ReturnType<typeof mealChangeSnapshot>>(change.before_json, {} as ReturnType<typeof mealChangeSnapshot>);
      const expectedVersion = action === "restore" ? Number(change.after_version) : Number(change.before_version);
      const unchangedFacts = { ...facts.snapshot, version: before.version, input: before.input,title: before.title };
      if (facts.decision === "keep" || Number(item.version) !== expectedVersion || !isDeepStrictEqual(unchangedFacts,before)) return { kind: "protected" as const };
      const patch = action === "restore" ? before.input : parseJson<MealPlanItemUpdateInput>(change.after_json, { version: expectedVersion });
      const result = this.applyItemChange(userId,planId,String(item.id),{ ...patch, version: expectedVersion,validationFingerprint },validation);
      if (result.kind !== "updated") return result;
      if (action === "restore") this.database.prepare("UPDATE meal_plan_changes SET status='reverted',after_json=json_set(after_json,'$.restoredVersion',?,'$.restoredAt',CURRENT_TIMESTAMP) WHERE id=?").run(result.value.version,changeId);
      else this.database.prepare("UPDATE meal_plan_changes SET status='applied',after_version=?,applied_at=CURRENT_TIMESTAMP WHERE id=?").run(result.value.version,changeId);
      return result;
    })();
  }

  private applyItemChange(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, validation?: ReplacementContext) {
    const current = this.getItem(planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    if (current.dining_json && input.dining === undefined && input.recipeId !== undefined && input.recipeId !== current.recipe_id)
      throw new InventoryQuantityError("DINING_REVIEW_REQUIRED","更换共餐菜谱前，请重新核对所有参与成员的限制并提交共餐安排");
    const dining = input.dining === undefined ? parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan | null>(current.dining_json,null) : input.dining;
    if (dining) validateSqliteDiningPlan(this.database,userId,input.recipeId === undefined ? current.recipe_id : input.recipeId,dining);
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      replacement = this.database.prepare(`SELECT *
        FROM recipes WHERE id = ? AND status = 'approved' AND deleted_at IS NULL`).get(input.recipeId) as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const needsValidation = replacementRequiresValidation(current,input);
    if (needsValidation) assertReplacementValidation(validation?.prepared, validation ? readSqliteReplacementSnapshot(this.readRows,userId,validation.request) : undefined,input.validationFingerprint);
    const allocation = needsValidation ? validation!.prepared!.result.allocation : replacement ? replacementAllocation(current,replacement) : undefined;
    if (allocation === null) return { kind: "protected" as const };
    if (needsValidation && allocation?.constraints) {
      const prior = (allocation.constraints as Row).executionValidationByItem as Record<string, unknown> | undefined;
      (allocation.constraints as Row).executionValidationByItem = { ...prior,[itemId]: {
        status: "change_verified", itemVersion: input.version + 1, fingerprint: validation!.prepared!.preview.fingerprint,
        checkedDate: validation!.prepared!.today, scope: validation!.prepared!.preview.scope,
        checks: validation!.prepared!.preview.checks,
      } };
    }
    const changed = this.database.prepare(`UPDATE meal_plan_items SET planned_date = ?, meal_type = ?, recipe_id = ?, title = ?,
      ingredients_json = ?, steps_json = ?, calories = ?, protein = ?, carbs = ?, fat = ?, status = ?,
      queue_item_id = CASE WHEN ? THEN NULL ELSE queue_item_id END, dining_json = ?,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND plan_id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`).run(
      input.plannedDate ?? current.planned_date, input.mealType ?? current.meal_type,
      input.recipeId === undefined ? current.recipe_id : input.recipeId,
      replacement?.title ?? current.title, allocation ? JSON.stringify(allocation.ingredients) : current.ingredients_json,
      replacement?.steps_json ?? current.steps_json, replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      input.status ?? current.status, input.recipeId !== undefined ? 1 : 0,dining ? JSON.stringify(dining) : null,
      itemId, planId, userId, input.version,
    );
    if (changed.changes !== 1) return { kind: "version_conflict" as const };
    if (allocation?.constraints) this.database.prepare("UPDATE meal_plans SET constraints_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
      .run(JSON.stringify(allocation.constraints),planId,userId);
    return { kind: "updated" as const, value: formatMealPlanItem(this.getItem(planId, itemId, userId)!) };
  }

  async addShopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.database.transaction(() => {
      if (input.householdNetFingerprint && !input.householdTotalDemand) throw new InventoryQuantityError("DINING_PLAN_CHANGED","净采购需关联已保存的共餐安排");
      const repeated = this.repeated(userId, input.idempotencyKey, "shopping", itemId);
      if (repeated) {
        if ((input.householdTotalDemand ? (input.householdNetFingerprint ? "net_demand" : "total_demand") : undefined)!==repeated.mode || input.householdNetFingerprint!==repeated.sourceNetFingerprint || (input.householdTotalDemand && (!isDeepStrictEqual(input.householdTotalDemand,repeated.sourceDining) || input.householdRecipeFingerprint!==repeated.sourceRecipeFingerprint)))
          throw new InventoryQuantityError("DINING_PLAN_CHANGED","此采购编号已用于另一份需求，请重新核对原提交");
        return { kind: "completed" as const, value: repeated };
      }
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) {
        if (Number(item.version)!==input.version || item.status!=="planned") return { kind: "version_conflict" as const };
        if (!input.householdTotalDemand) throw new InventoryQuantityError("HOUSEHOLD_SHOPPING_REQUIRED","这是共餐安排，请按共餐总需求核对家庭采购");
        const dining = parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan>(item.dining_json,null!);
        validateSqliteDiningPlan(this.database,userId,item.recipe_id,dining);
        const recipe = this.database.prepare("SELECT * FROM recipes WHERE id=?").get(item.recipe_id) as Row;
        const existing = this.database.prepare("SELECT * FROM household_shopping_items WHERE source_plan_item_id=? ORDER BY id").all(itemId) as Row[];
        let demands = prepareDiningShopping(dining,input.householdTotalDemand,recipe,existing,input.householdRecipeFingerprint);
        if (input.householdNetFingerprint) demands = prepareNetDiningShopping(readSqliteDiningSupply(this.database,userId,dining.householdId,{ planId,itemId,version: input.version },dining.participants.reduce((sum,person) => sum+Math.round(person.servings*1_000_000),0)/1_000_000,input.householdRecipeFingerprint!),input.householdNetFingerprint);
        const itemIds: string[] = [];
        for (const demand of demands) {
          const previous = existing.find(row => row.source_demand_key===demand.key);
          if (previous) {
            if (previous.name!==demand.name || previous.amount!==demand.amount) this.database.prepare("UPDATE household_shopping_items SET name=?,amount=?,version=version+1,source_generated_version=version+1,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(demand.name,demand.amount,userId,previous.id);
          } else {
            const id = randomUUID();
            this.database.prepare("INSERT INTO household_shopping_items(id,household_id,name,amount,category,created_by_user_id,updated_by_user_id,source_plan_item_id,source_demand_key,source_generated_version) VALUES(?,?,?,?,'共餐总需求',?,?,?,?,1)").run(id,dining.householdId,demand.name,demand.amount,userId,userId,itemId,demand.key);
            itemIds.push(id);
          }
        }
        for (const row of existing) if (!demands.some(demand => demand.key===row.source_demand_key)) this.database.prepare("DELETE FROM household_shopping_items WHERE id=?").run(row.id);
        const value = { added: itemIds.length,itemIds,householdId: dining.householdId,mode: input.householdNetFingerprint ? "net_demand" : "total_demand",...(input.householdNetFingerprint ? { sourceNetFingerprint: input.householdNetFingerprint } : {}),sourceDining: dining,sourceRecipeFingerprint: input.householdRecipeFingerprint,repeated: false };
        this.saveExecution(userId,input.idempotencyKey,"shopping",itemId,value);
        return { kind: "completed" as const,value };
      }
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      if (input.householdTotalDemand) throw new InventoryQuantityError("DINING_PLAN_CHANGED","这餐已不是共餐安排，请重新核对");
      const plan = this.getPlan(planId,userId,false);
      if (!plan || plan.status !== "active" || ["completed","skipped"].includes(String(item.status))) return { kind: "version_conflict" as const };
      const stock = this.database.prepare(`SELECT inventory_items.*, (SELECT metadata_json FROM inventory_change_logs e
        WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
        AND json_extract(e.metadata_json,'$.field_evidence.quantity.status') IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
        FROM inventory_items WHERE user_id=? AND is_available=1 AND deleted_at IS NULL
        ORDER BY CASE WHEN expiration_date='' THEN 1 ELSE 0 END,expiration_date,id`).all(userId) as Row[];
      const shopping = this.database.prepare("SELECT * FROM shopping_list_items WHERE user_id=? AND checked=0 AND deleted_at IS NULL").all(userId) as Row[];
      const result = preparePersonalShopping(itemId,this.getItems(planId,userId),stock.map(row => ({ ...row,quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence,row.version) })),shopping,currentDateKey());
      const insert = this.database.prepare(`INSERT INTO shopping_list_items (id,user_id,client_id,name,amount,category) VALUES (?,?,?,?,?,'餐单')`);
      const itemIds = result.missing.map((entry,index) => {
        const id = randomUUID();
        insert.run(id,userId,personalShoppingClientId(itemId,input.idempotencyKey,index),entry.name.slice(0,120),entry.amount.slice(0,80));
        return id;
      });
      const value = { added: itemIds.length,itemIds,repeated: false,scope: "current_plan",coverage: result.coverage,reviewItems: result.reviewItems };
      this.saveExecution(userId, input.idempotencyKey, "shopping", itemId, value);
      return { kind: "completed" as const, value };
    })();
  }

  async enqueue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    try {
      return this.database.transaction(() => {
        const repeated = this.repeated(userId, input.idempotencyKey, "queue", itemId);
        if (repeated) {
          if ((repeated.combineSameRecipe ?? false) !== (input.combineSameRecipe ?? false)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "该提交编号已用于另一种制作安排，请刷新后重试");
          return { kind: "completed" as const, value: repeated };
        }
        const item = this.getItem(planId, itemId, userId);
        if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
        if (["completed","skipped"].includes(String(item.status)) || Number(item.version) !== input.version) return { kind: "version_conflict" as const };
        if (!item.recipe_id || item.recipe_status !== "approved" || item.recipe_deleted_at) return { kind: "recipe_unavailable" as const };
        const existing = this.database.prepare(`SELECT id FROM cooking_queue_items WHERE user_id = ? AND (source_plan_item_id = ? OR id = ?)
          AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId, itemId, item.queue_item_id ?? null) as { id: string } | undefined;
        assertSqlitePlanExecution(this.database, [item]);
        if (existing && item.queue_item_id === existing.id) {
          const value = { queueItemId: existing.id, added: false, combineSameRecipe: input.combineSameRecipe ?? false, repeated: false };
          this.saveExecution(userId, input.idempotencyKey, "queue", itemId, value);
          return { kind: "completed" as const, value };
        }
        const group = input.combineSameRecipe ? commonProduction(item, this.getItems(planId, userId)) : null;
        assertSqlitePlanExecution(this.database, this.getItems(planId, userId).filter(row => row.id === itemId || group?.targets.some(target => target.id === row.id)));
        let queueItemId = existing?.id;
        let added = false;
        if (!queueItemId) {
          const count = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM cooking_queue_items WHERE user_id = ?
            AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId) as { count: number }).count);
          if (count >= 30) return { kind: "queue_full" as const };
          const position = Number((this.database.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items WHERE user_id = ?
            AND deleted_at IS NULL AND status IN ('waiting', 'preparing', 'ready', 'cooking')`).get(userId) as { position: number }).position);
          queueItemId = randomUUID();
          this.database.prepare(`INSERT INTO cooking_queue_items
            (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key, source_plan_item_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(queueItemId, userId, item.recipe_id, position, queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time ?? null, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: group?.ingredients ?? parseJson(item.ingredients_json, []),
            productionPlanItems: group?.targets,
            plannedServings: group?.servings ?? formatMealPlanItem(item).plannedServings, planItemId: itemId, plannedDate: String(item.planned_date),
          }), `meal-plan:${itemId}:${input.version}`, itemId);
          added = true;
        }
        for (const member of group?.targets ?? [{ id: itemId, version: input.version + 1 }]) {
          const changed = this.database.prepare(`UPDATE meal_plan_items SET queue_item_id = ?, status = 'queued', version = version + 1,
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`).run(queueItemId, member.id, userId, member.version - 1);
          if (changed.changes !== 1) throw new Error("MEAL_PLAN_VERSION_CONFLICT");
        }
        const value = { queueItemId, added, combineSameRecipe: input.combineSameRecipe ?? false, repeated: false };
        this.saveExecution(userId, input.idempotencyKey, "queue", itemId, value);
        return { kind: "completed" as const, value };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_PLAN_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  async complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    if (input.production) {
      if (input.dietRecordId) throw new Error("制作分配不能同时关联旧饮食记录");
      const item = this.getItem(planId, itemId, userId);
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
      const value = await new SqliteDietRecordsRepository(this.database).completeCooking(userId, {
        idempotency_key: input.idempotencyKey, recipe_id: item.recipe_id == null ? null : Number(item.recipe_id),
        inventory_item_ids: [], inventory_consumptions: input.inventory_consumptions ?? [],
        production: prepareProduction({ ...input.production, plan_item_id: itemId, plan_version: input.version }),
      });
      return { kind: "completed" as const, value };
    }
    try {
      return this.database.transaction(() => {
        const repeated = this.repeated(userId, input.idempotencyKey, "complete", itemId);
        if (repeated) return { kind: "completed" as const, value: repeated };
        const item = this.getItem(planId, itemId, userId);
        if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
        const produced = this.database.prepare("SELECT result_json FROM prepared_meals WHERE user_id=? AND (plan_item_id=? OR queue_item_id=?)")
          .get(userId, itemId, item.queue_item_id ?? null) as { result_json: string } | undefined;
        if (produced) return { kind: "completed" as const, value: { ...JSON.parse(produced.result_json), repeated: true } };
        if (item.status === "completed" && item.diet_record_id) {
          return { kind: "completed" as const, value: { dietRecordId: Number(item.diet_record_id), repeated: true } };
        }
        if (item.status === "completed" || Number(item.version) !== input.version) return { kind: "version_conflict" as const };
        assertSqlitePlanExecution(this.database, [item]);
        const shared = parseJson<{ productionPlanItems?: unknown[] }>(item.queue_snapshot_json, {}).productionPlanItems;
        if (Array.isArray(shared) && shared.length > 1) throw new InventoryQuantityError("MEAL_SHARED_PRODUCTION_REQUIRED", "这是多餐共用制作，请先保存总产出和实际食用份量；原安排和库存未改变");
        let dietRecordId = input.dietRecordId;
        if (dietRecordId) {
          if (!this.database.prepare("SELECT id FROM diet_records WHERE id = ? AND user_id = ?").get(dietRecordId, userId)) {
            return { kind: "diet_record_not_found" as const };
          }
        } else {
          const inserted = this.database.prepare(`INSERT INTO diet_records
            (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
            VALUES (?, ?, ?, '1份', ?, ?, ?, ?, ?, ?)`).run(userId, item.meal_type, item.recipe_title || item.title,
            item.calories, item.protein, item.carbs, item.fat, item.planned_date,
            item.planned_date === currentDateKey() ? currentTimeKey() : null);
          dietRecordId = Number(inserted.lastInsertRowid);
        }
        const changed = this.database.prepare(`UPDATE meal_plan_items SET status = 'completed', diet_record_id = ?, completed_at = CURRENT_TIMESTAMP,
          version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ?`)
          .run(dietRecordId, itemId, userId, input.version);
        if (changed.changes !== 1) throw new Error("MEAL_PLAN_VERSION_CONFLICT");
        const value = { dietRecordId, repeated: false };
        this.saveExecution(userId, input.idempotencyKey, "complete", itemId, value);
        return { kind: "completed" as const, value };
      })();
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_PLAN_VERSION_CONFLICT") return { kind: "version_conflict" as const };
      throw error;
    }
  }

  private getPlan(id: string, userId: number, includeArchived: boolean) {
    return this.database.prepare(`SELECT * FROM meal_plans WHERE id = ? AND user_id = ?${includeArchived ? "" : " AND deleted_at IS NULL"}`)
      .get(id, userId) as Row | undefined;
  }
  private getItem(planId: string, itemId: string, userId: number) {
    return this.database.prepare(`${itemSelect} WHERE i.id = ? AND i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL AND p.deleted_at IS NULL`)
      .get(itemId, planId, userId) as Row | undefined;
  }
  private getItems(planId: string, userId: number) {
    return this.database.prepare(`${itemSelect} WHERE i.plan_id = ? AND i.user_id = ? AND i.deleted_at IS NULL
      ORDER BY i.planned_date, CASE i.meal_type WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 WHEN '晚餐' THEN 2 ELSE 3 END, i.id`)
      .all(planId, userId) as Row[];
  }
  private formatPlan(row: Row, userId: number) { return formatMealPlan(row, this.getItems(String(row.id), userId).map(formatMealPlanItem)); }
  private repeated(userId: number, key: string, action: string, itemId: string) {
    const row = this.database.prepare("SELECT action, meal_plan_item_id, result_json FROM meal_plan_execution_requests WHERE user_id = ? AND idempotency_key = ?")
      .get(userId, key) as { action: string; meal_plan_item_id: string; result_json: string } | undefined;
    if (row && (row.action !== action || row.meal_plan_item_id !== itemId)) {
      throw new InventoryQuantityError("MEAL_PLAN_KEY_CONFLICT", "此提交编号已用于其他餐次或操作，请核对原提交后重试");
    }
    return row ? { ...JSON.parse(row.result_json), repeated: true } : null;
  }
  private saveExecution(userId: number, key: string, action: string, itemId: string, result: unknown) {
    this.database.prepare(`INSERT INTO meal_plan_execution_requests
      (user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, key, action, itemId, JSON.stringify(result));
  }
}
