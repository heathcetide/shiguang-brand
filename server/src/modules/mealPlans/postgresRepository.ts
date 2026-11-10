import type { ActiveMealChangePreviewInput } from "@dietdigidose/contracts";
import { readPostgresReplacementSnapshot } from "./postgresReplacementSnapshot.js";
import { prepareReplacement, replacementRequiresValidation, assertReplacementValidation, replacementPatchRequest, type ReplacementContext } from "./replacementSnapshot.js";
import { preparePersonalShopping, personalShoppingClientId } from "./personalShopping.js";
import { quantityEvidenceStatus } from "../inventory/evidence.js";
import { recipeExecutionProof } from "../recipes/planExecution.js";
import { assertPostgresPlanExecution } from "../recipes/postgresRepository.js";
import { commonProduction } from "./commonProduction.js";
import { cookingEvidenceMatches } from "../recipes/substitutions.js";
import { PostgresMealAllocationsRepository } from "../mealAllocations/postgresRepository.js";
import { preparedAllocationsAvailable } from "./preparedAllocations.js";
import { readPostgresDiningSupply } from "../households/postgresDiningSupply.js";
import { prepareNetDiningShopping } from "../households/diningNetShopping.js";
import { prepareDiningShopping } from "../households/diningShopping.js";
import { validatePostgresDiningPlan } from "../households/postgresDiningPlan.js";
import { replacementAllocation } from "./replacementAllocation.js";
import { lockMealPlanning } from "./postgresLock.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { mealChangeDecision, mealChangeSnapshot, mealChangeFingerprint, formatMealChange, isMealChangeNoop, planMetadataPreservesItem, type PlanMetadataEdit } from "./changePolicy.js";
import { prepareDraftActivation } from "./draftActivation.js";
import type { SaveCookingPlanDraftInput, UpdateCookingPlanDraftInput } from "@dietdigidose/contracts";
import { isDeepStrictEqual } from "node:util";
import { PostgresDietRecordsRepository } from "../dietRecords/postgresRepository.js";
import { consumeInventoryWithPostgresClient } from "../inventory/postgresRepository.js";
import { formatPreparedMeal, prepareProduction } from "../dietRecords/preparedMeals.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { formatMealPlan, formatMealPlanItem, parseJson, queueMealType, type Row } from "./formatters.js";
import type { MealPlansRepository } from "./repository.js";
import type { MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput, MealPlanUpdateInput } from "./types.js";

const activeQueueStatuses = "'waiting', 'preparing', 'ready', 'cooking'";
const itemSelect = `SELECT i.*,
  (SELECT q.recipe_snapshot_json FROM cooking_queue_items q WHERE q.id=i.queue_item_id AND q.user_id=i.user_id) AS queue_snapshot_json,
  (SELECT hm.id FROM household_meal_batches hm WHERE hm.plan_item_id=i.id AND hm.created_by_user_id=i.user_id) AS household_meal_id,
  (SELECT hm.household_id FROM household_meal_batches hm WHERE hm.plan_item_id=i.id AND hm.created_by_user_id=i.user_id) AS household_id, p.constraints_json AS plan_constraints_json, r.title AS recipe_title, r.image_url AS recipe_image_url,
  r.cook_time AS recipe_cook_time, r.difficulty AS recipe_difficulty,
  r.status AS recipe_status, r.deleted_at AS recipe_deleted_at
  FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id LEFT JOIN recipes r ON r.id = i.recipe_id`;

export class PostgresMealPlansRepository implements MealPlansRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  private async prepareChange(userId: number, planId: string, itemId: string, request: ActiveMealChangePreviewInput) {
    const snapshot = await this.transaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return readPostgresReplacementSnapshot(client,userId,request);
    });
    return { request, prepared: await prepareReplacement(snapshot,userId,planId,itemId,request) } satisfies ReplacementContext;
  }
  async previewChange(userId: number, planId: string, itemId: string, request: ActiveMealChangePreviewInput) {
    return (await this.prepareChange(userId,planId,itemId,request)).prepared?.preview ?? null;
  }

  async activateDraft(userId: number, id: string, version: number) {
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
      const selected = await client.query("SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [id,userId]);
      const current = selected.rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const activation = prepareDraftActivation(current, version);
      if (!activation) return { kind: "version_conflict" as const };
      if (activation.repeated) return { kind: "updated" as const, value: { plan: await this.formatPlan(client,current,userId), repeated: true } };
      const batchIds = [...new Set(activation.targets.flatMap(target => target.allocations.map(item => item.preparedMealId)))];
      const batches = batchIds.length
        ? (await client.query("SELECT * FROM prepared_meals WHERE user_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE", [userId, batchIds])).rows.map(formatPreparedMeal) : [];
      const allocations = await new PostgresMealAllocationsRepository(client).list(userId);
      if (!preparedAllocationsAvailable(activation.targets, batches, [{ prepared_allocations: allocations }])) return { kind: "version_conflict" as const };
      if (activation.weekly) {
        const occupied = (await client.query("SELECT i.planned_date,i.meal_type FROM meal_plan_items i JOIN meal_plans p ON p.id=i.plan_id WHERE i.user_id=$1 AND i.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('active','completed') AND i.status<>'skipped'",[userId])).rows as Row[];
        for (const allocation of allocations) {
          if (allocation.status === "conflict" || (allocation.status === "active" && allocation.remainingServings > 0)) {
            occupied.push({ planned_date: allocation.plannedDate, meal_type: allocation.mealType });
          }
        }
        if (activation.targets.some(target => occupied.some(item => String(item.planned_date) === target.date && queueMealType(item.meal_type) === target.mealType))) return { kind: "version_conflict" as const };
      }
      if ((await client.query("SELECT id FROM meal_plan_items WHERE plan_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1", [id,userId])).rowCount) return { kind: "version_conflict" as const };
      const recipes = new Map<number, Row>();
      const recipeIds = [...new Set(activation.items.flatMap(item => [item.recipeId, ...(item.allocation.substitution ? [item.allocation.substitution.sourceRecipeId] : [])]))].sort((a, b) => a-b);
      for (const recipeId of recipeIds) {
        const found = await client.query("SELECT * FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL FOR SHARE", [recipeId]);
        if (!found.rows[0]) return { kind: "recipe_not_available" as const };
        recipes.set(recipeId, found.rows[0]);
      }
      if (activation.items.some(item => !cookingEvidenceMatches(item.allocation, recipes.get(item.allocation.substitution?.sourceRecipeId ?? 0), recipes.get(item.recipeId)))) return { kind: "recipe_not_available" as const };
      Object.assign(activation.constraints, { executionRecipeKeys: Object.fromEntries(activation.items.map(item => [item.id,
        recipeExecutionProof(recipes.get(item.recipeId)!, recipes.get(item.allocation.substitution?.sourceRecipeId ?? 0))])) });
      for (const item of activation.items) await client.query(`INSERT INTO meal_plan_items
        (id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,steps_json,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,CURRENT_TIMESTAMP)`, [item.id,id,userId,item.date,item.mealType,item.title,item.recipeId,JSON.stringify(item.ingredients),JSON.stringify(recipes.get(item.recipeId)!.steps_json)]);
      const updated = await client.query("UPDATE meal_plans SET status='active',constraints_json=$1::jsonb,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND user_id=$3 RETURNING *", [JSON.stringify(activation.constraints),id,userId]);
      await new PostgresMealAllocationsRepository(client).reserve(userId,id,activation.targets);
      return { kind: "updated" as const, value: { plan: await this.formatPlan(client,updated.rows[0],userId), repeated: false } };
    });
  }

  async updateDraft(userId: number, id: string, input: UpdateCookingPlanDraftInput) {
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
      const selected = await client.query("SELECT * FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, userId]);
      const current = selected.rows[0] as Row | undefined;
      if (!current) return { kind: "not_found" as const };
      const constraints = parseJson<Row>(current.constraints_json, {});
      const last = constraints.lastDraftUpdate as UpdateCookingPlanDraftInput | undefined;
      if (last?.idempotencyKey === input.idempotencyKey) {
        if (!isDeepStrictEqual(last, input)) return { kind: "version_conflict" as const };
        return { kind: "updated" as const, value: { plan: await this.formatPlan(client, current, userId), repeated: true } };
      }
      const items = await client.query("SELECT id FROM meal_plan_items WHERE plan_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1", [id, userId]);
      if (Number(current.version) !== input.version || current.status !== "draft" || !constraints.savedCookingDraft || items.rowCount) {
        return { kind: "version_conflict" as const };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      const updated = await client.query(`UPDATE meal_plans SET constraints_json=$1::jsonb,start_date=$2,end_date=$3,version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND user_id=$5 AND version=$6 RETURNING *`,
        [JSON.stringify({ ...constraints, currentCookingDraft: input.draft, lastDraftUpdate: input }), dates[0], dates.at(-1), id, userId, input.version]);
      return { kind: "updated" as const, value: { plan: await this.formatPlan(client, updated.rows[0] as Row, userId), repeated: false } };
    });
  }

  async saveDraft(userId: number, input: SaveCookingPlanDraftInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`meal-plan-draft:${input.id}`]);
      const selected = await client.query("SELECT * FROM meal_plans WHERE id = $1", [input.id]);
      const existing = selected.rows[0] as Row | undefined;
      const snapshot = { title: input.title, draft: input.draft };
      if (existing) {
        if (Number(existing.user_id) !== userId || !isDeepStrictEqual(parseJson<Row>(existing.constraints_json, {}).savedCookingDraft, snapshot)) {
          await client.query("ROLLBACK"); return null;
        }
        const plan = await this.formatPlan(client, existing, userId);
        await client.query("COMMIT"); return { plan, repeated: true };
      }
      const dates = input.draft.meals.map(meal => meal.date).sort();
      const inserted = await client.query(`INSERT INTO meal_plans (id,user_id,title,start_date,end_date,status,source,constraints_json)
        VALUES ($1,$2,$3,$4,$5,'draft','manual',$6::jsonb) RETURNING *`,
        [input.id, userId, input.title, dates[0], dates.at(-1), JSON.stringify({ savedCookingDraft: snapshot })]);
      const plan = await this.formatPlan(client, inserted.rows[0] as Row, userId);
      await client.query("COMMIT"); return { plan, repeated: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async list(userId: number, includeArchived: boolean) {
    const result = await this.pool.query(`SELECT * FROM meal_plans WHERE user_id = $1${includeArchived ? "" : " AND deleted_at IS NULL"}
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, created_at DESC`, [userId]);
    return Promise.all((result.rows as Row[]).map((row) => this.formatPlan(this.pool, row, userId)));
  }

  async find(userId: number, id: string, includeArchived: boolean) {
    const row = await this.getPlan(this.pool, id, userId, includeArchived);
    return row ? this.formatPlan(this.pool, row, userId) : null;
  }

  async updatePlan(userId: number, id: string, input: MealPlanUpdateInput) {
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
    const current = await this.getPlan(client, id, userId, false);
    if (!current) return { kind: "not_found" as const };
    const startDate = input.startDate ?? String(current.start_date);
    const endDate = input.endDate ?? String(current.end_date);
    if (startDate > endDate) return { kind: "invalid_date_range" as const };
    await this.assertPlanEditWithClient(client,userId,id,input);
    if (input.status && ["active", "draft"].includes(input.status) && current.status !== input.status && parseJson<Row>(current.constraints_json, {}).savedCookingDraft) return { kind: "version_conflict" as const };
    const changed = await client.query(`UPDATE meal_plans SET title = $1, start_date = $2, end_date = $3, status = $4,
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $5 AND user_id = $6 AND version = $7 AND deleted_at IS NULL`,
    [input.title ?? current.title, startDate, endDate, input.status ?? current.status, id, userId, input.version]);
    if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
    if (input.status && input.status !== "active") await new PostgresMealAllocationsRepository(client).release(userId,id);
    return { kind: "updated" as const, value: await this.formatPlan(client, (await this.getPlan(client, id, userId, false))!, userId) };
  });
  }

  async removePlan(userId: number, id: string, version: number) {
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
    await this.assertPlanEditWithClient(client,userId,id,{ archive: true });
    const changed = await client.query(`UPDATE meal_plans SET deleted_at = CURRENT_TIMESTAMP, status = 'cancelled',
      version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 AND version = $3 AND deleted_at IS NULL`,
    [id, userId, version]);
    if (changed.rowCount === 1) { await new PostgresMealAllocationsRepository(client).release(userId,id); return "removed" as const; }
    return await this.getPlan(client, id, userId, false) ? "version_conflict" as const : "not_found" as const;
  });
  }

  async assertPlanEditWithClient(client: PoolClient, userId: number, planId: string, edit: PlanMetadataEdit) {
    const items = (await client.query("SELECT * FROM meal_plan_items WHERE plan_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY id FOR UPDATE",[planId,userId])).rows as Row[];
    for (const item of items) {
      const facts = await this.changeFacts(client,item,userId);
      if (!planMetadataPreservesItem(item,facts.decision,edit)) throw new InventoryQuantityError("MEAL_PLAN_PROTECTED", "餐单包含已确认、已采购或已进入制作的安排，或日期将排除已有餐次；请先逐餐审阅调整，原安排已保留");
    }
  }

  private async changeFacts(client: PoolClient, item: Row, userId: number, lock = true) {
    const suffix = lock ? " FOR UPDATE" : "";
    const queue = item.queue_item_id ? (await client.query(`SELECT id,version,status FROM cooking_queue_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL${suffix}`, [item.queue_item_id,userId])).rows[0] as Row | undefined : undefined;
    const purchases = (await client.query(`SELECT id,version,checked FROM shopping_list_items WHERE user_id=$1 AND client_id LIKE $2 ORDER BY id${suffix}`, [userId,`meal-plan:${item.id}:%`])).rows as Row[];
    const sharedPurchases = (await client.query(`SELECT id,version,(checked OR transferred_at IS NOT NULL) AS checked FROM household_shopping_items WHERE source_plan_item_id=$1 ORDER BY id${suffix}`,[item.id])).rows as Row[];
    purchases.push(...sharedPurchases.map(row => ({ ...row,id: `household:${row.id}` })));
    return { decision: mealChangeDecision(item,queue,purchases), snapshot: mealChangeSnapshot(item,queue,purchases) };
  }

  async confirmItem(userId: number, planId: string, itemId: string, version: number) {
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
      const item = await this.getItem(client,planId,itemId,userId,true);
      if (!item) return { kind: "not_found" as const };
      if (Number(item.version) !== version) return { kind: "version_conflict" as const };
      if (!item.confirmed_at) await client.query("UPDATE meal_plan_items SET confirmed_at=CURRENT_TIMESTAMP,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND user_id=$2", [itemId,userId]);
      return { kind: "updated" as const, value: formatMealPlanItem((await this.getItem(client,planId,itemId,userId))!) };
    });
  }

  async listChanges(userId: number, planId: string) {
    return (await this.pool.query("SELECT * FROM meal_plan_changes WHERE user_id=$1 AND plan_id=$2 ORDER BY created_at DESC,id DESC", [userId,planId])).rows.map(formatMealChange);
  }

  async updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排") {
    const validation = input.validationFingerprint ? await this.prepareChange(userId,planId,itemId,replacementPatchRequest(input)) : undefined;
    return this.transaction(client => this.updateItemWithClient(client,userId,planId,itemId,input,source,reason,validation));
  }

  /** Uses the caller's transaction; changes and acknowledgement must commit together. */
  async updateItemWithClient(client: PoolClient, userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source = "manual", reason = "调整餐次安排", validation?: ReplacementContext) {
      await lockMealPlanning(client,userId);
      if (validation) {
        // Successful noops/replayed proposals do not contend for unrelated stock locks.
        const prior = await this.getItem(client,planId,itemId,userId);
        if (prior) {
          if (Number(prior.version) === input.version && isMealChangeNoop(prior,input)) return { kind: "updated" as const,value: formatMealPlanItem(prior) };
          const priorFacts = await this.changeFacts(client,prior,userId,false);
          const repeated = (await client.query("SELECT * FROM meal_plan_changes WHERE user_id=$1 AND fingerprint=$2",[userId,mealChangeFingerprint(itemId,priorFacts.snapshot,input)])).rows[0];
          if (repeated) return { kind: "updated" as const,value: { ...formatMealPlanItem(prior),change: formatMealChange(repeated) } };
        }
        validation.actual = await readPostgresReplacementSnapshot(client,userId,validation.request,true);
      }
      const item = await this.getItem(client,planId,itemId,userId,true);
      if (!item) return { kind: "not_found" as const };
      const facts = await this.changeFacts(client,item,userId);
      if (Number(item.version) === input.version && isMealChangeNoop(item,input)) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      const fingerprint = mealChangeFingerprint(itemId,facts.snapshot,input);
      const existing = (await client.query("SELECT * FROM meal_plan_changes WHERE user_id=$1 AND fingerprint=$2", [userId,fingerprint])).rows[0] as Row | undefined;
      if (existing) return { kind: "updated" as const, value: { ...formatMealPlanItem(item), change: formatMealChange(existing) } };
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      const replacement = input.recipeId ? (await client.query("SELECT title FROM recipes WHERE id=$1 AND status='approved' AND deleted_at IS NULL FOR SHARE",[input.recipeId])).rows[0] as Row | undefined : undefined;
      if (input.recipeId && !replacement) return { kind: "recipe_not_available" as const };
      if (item.dining_json && input.dining === undefined && input.recipeId !== undefined && input.recipeId !== item.recipe_id)
        throw new InventoryQuantityError("DINING_REVIEW_REQUIRED","更换共餐菜谱前，请重新核对所有参与成员的限制并提交共餐安排");
      const dining = input.dining === undefined ? parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan | null>(item.dining_json,null) : input.dining;
      if (dining) await validatePostgresDiningPlan(client,userId,input.recipeId === undefined ? item.recipe_id : input.recipeId,dining);
      if (source === "maintenance" && facts.decision === "apply" && replacementRequiresValidation(item,input)) {
        facts.decision = "suggest";
        reason += "；需先预览当前整套餐单，未自动应用";
      }
      if (input.validationFingerprint && replacementRequiresValidation(item,input))
        assertReplacementValidation(validation?.prepared,validation?.actual,input.validationFingerprint);
      const proposal = { ...input, title: String(replacement?.title || item.recipe_title || item.title) };
      const id = randomUUID();
      let next = formatMealPlanItem(item);
      if (facts.decision === "apply") {
        const applied = await this.applyItemChange(client,userId,planId,itemId,input,validation);
        if (applied.kind !== "updated") return applied;
        next = applied.value;
      }
      const changed = await client.query(`INSERT INTO meal_plan_changes(id,user_id,plan_id,item_id,fingerprint,source,reason,status,before_version,after_version,before_json,after_json,applied_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,CASE WHEN $13::boolean THEN CURRENT_TIMESTAMP ELSE NULL END) RETURNING *`,
        [id,userId,planId,itemId,fingerprint,source,reason,facts.decision === "apply" ? "applied" : facts.decision === "suggest" ? "pending" : "blocked",input.version,
          facts.decision === "apply" ? next.version : null,JSON.stringify(facts.snapshot),JSON.stringify(proposal),facts.decision === "apply"]);
      return { kind: "updated" as const, value: { ...next, change: formatMealChange(changed.rows[0]) } };
  }

  async reviewChange(userId: number, planId: string, changeId: string, action: "accept" | "reject" | "restore", validationFingerprint?: string) {
    const saved = validationFingerprint && action !== "reject" ? (await this.pool.query("SELECT item_id FROM meal_plan_changes WHERE id=$1 AND user_id=$2 AND plan_id=$3",[changeId,userId,planId])).rows[0] as Row | undefined : undefined;
    const validation: ReplacementContext | undefined = saved && action !== "reject" ? await this.prepareChange(userId,planId,String(saved.item_id),{ changeId,action }) : undefined;
    return this.transaction(async client => {
      await lockMealPlanning(client,userId);
      if (validation) {
        const prior = (await client.query("SELECT * FROM meal_plan_changes WHERE id=$1 AND user_id=$2 AND plan_id=$3",[changeId,userId,planId])).rows[0];
        if (prior && ((action === "accept" && prior.status === "applied") || (action === "restore" && prior.status === "reverted"))) {
          const item = await this.getItem(client,planId,String(prior.item_id),userId);
          return item ? { kind: "updated" as const,value: formatMealPlanItem(item) } : { kind: "not_found" as const };
        }
        validation.actual = await readPostgresReplacementSnapshot(client,userId,validation.request,true);
      }
      const change = (await client.query("SELECT * FROM meal_plan_changes WHERE id=$1 AND user_id=$2 AND plan_id=$3 FOR UPDATE", [changeId,userId,planId])).rows[0] as Row | undefined;
      if (!change) return { kind: "not_found" as const };
      const item = await this.getItem(client,planId,String(change.item_id),userId,true);
      if (!item) return { kind: "not_found" as const };
      if ((action === "accept" && change.status === "applied") || (action === "reject" && change.status === "rejected") || (action === "restore" && change.status === "reverted")) return { kind: "updated" as const, value: formatMealPlanItem(item) };
      if (action === "reject" && change.status === "pending") {
        await client.query("UPDATE meal_plan_changes SET status='rejected' WHERE id=$1", [changeId]);
        return { kind: "updated" as const, value: formatMealPlanItem(item) };
      }
      if ((action === "accept" && change.status !== "pending") || (action === "restore" && change.status !== "applied") || action === "reject") return { kind: "version_conflict" as const };
      const facts = await this.changeFacts(client,item,userId);
      const before = parseJson<ReturnType<typeof mealChangeSnapshot>>(change.before_json, {} as ReturnType<typeof mealChangeSnapshot>);
      const expectedVersion = action === "restore" ? Number(change.after_version) : Number(change.before_version);
      const unchangedFacts = { ...facts.snapshot,version:before.version,input:before.input,title:before.title };
      if (facts.decision === "keep" || Number(item.version) !== expectedVersion || !isDeepStrictEqual(unchangedFacts,before)) return { kind: "protected" as const };
      const patch = action === "restore" ? before.input : parseJson<MealPlanItemUpdateInput>(change.after_json, { version: expectedVersion });
      const result = await this.applyItemChange(client,userId,planId,String(item.id),{ ...patch,version:expectedVersion,validationFingerprint },validation);
      if (result.kind !== "updated") return result;
      if (action === "restore") await client.query("UPDATE meal_plan_changes SET status='reverted',after_json=after_json || jsonb_build_object('restoredVersion',$1::integer,'restoredAt',CURRENT_TIMESTAMP) WHERE id=$2",[result.value.version,changeId]);
      else await client.query("UPDATE meal_plan_changes SET status='applied',after_version=$1,applied_at=CURRENT_TIMESTAMP WHERE id=$2",[result.value.version,changeId]);
      return result;
    });
  }

  private async applyItemChange(client: PoolClient, userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, validation?: ReplacementContext) {
    const current = await this.getItem(client, planId, itemId, userId);
    if (!current) return { kind: "not_found" as const };
    if (current.dining_json && input.dining === undefined && input.recipeId !== undefined && input.recipeId !== current.recipe_id)
      throw new InventoryQuantityError("DINING_REVIEW_REQUIRED","更换共餐菜谱前，请重新核对所有参与成员的限制并提交共餐安排");
    const dining = input.dining === undefined ? parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan | null>(current.dining_json,null) : input.dining;
    if (dining) await validatePostgresDiningPlan(client,userId,input.recipeId === undefined ? current.recipe_id : input.recipeId,dining);
    let replacement: Row | undefined;
    if (input.recipeId !== undefined && input.recipeId !== null) {
      const selected = await client.query(`SELECT *
        FROM recipes WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL FOR SHARE`, [input.recipeId]);
      replacement = selected.rows[0] as Row | undefined;
      if (!replacement) return { kind: "recipe_not_available" as const };
    }
    const needsValidation = replacementRequiresValidation(current,input);
    if (needsValidation) assertReplacementValidation(validation?.prepared,validation?.actual,input.validationFingerprint);
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
    const changed = await client.query(`UPDATE meal_plan_items SET planned_date = $1, meal_type = $2, recipe_id = $3, title = $4,
      ingredients_json = $5::jsonb, steps_json = $6::jsonb, calories = $7, protein = $8, carbs = $9, fat = $10, status = $11,
      queue_item_id = CASE WHEN $12::boolean THEN NULL ELSE queue_item_id END, dining_json = $17::jsonb,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13 AND plan_id = $14 AND user_id = $15 AND version = $16 AND deleted_at IS NULL`, [
      input.plannedDate ?? current.planned_date, input.mealType ?? current.meal_type,
      input.recipeId === undefined ? current.recipe_id : input.recipeId,
      replacement?.title ?? current.title, JSON.stringify(allocation?.ingredients ?? current.ingredients_json),
      JSON.stringify(replacement?.steps_json ?? current.steps_json), replacement?.calories ?? current.calories,
      replacement?.protein ?? current.protein, replacement?.carbs ?? current.carbs, replacement?.fat ?? current.fat,
      input.status ?? current.status, input.recipeId !== undefined, itemId, planId, userId, input.version,dining ? JSON.stringify(dining) : null,
    ]);
    if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
    if (allocation?.constraints) await client.query("UPDATE meal_plans SET constraints_json=$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND user_id=$3",
      [JSON.stringify(allocation.constraints),planId,userId]);
    return { kind: "updated" as const, value: formatMealPlanItem((await this.getItem(client, planId, itemId, userId))!) };
  }

  addShopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.transaction(async (client) => {
      await lockMealPlanning(client,userId);
      await this.lockExecution(client, userId, input.idempotencyKey);
      if (input.householdNetFingerprint && !input.householdTotalDemand) throw new InventoryQuantityError("DINING_PLAN_CHANGED","净采购需关联已保存的共餐安排");
      const repeated = await this.repeated(client, userId, input.idempotencyKey, "shopping", itemId);
      if (repeated) {
        if ((input.householdTotalDemand ? (input.householdNetFingerprint ? "net_demand" : "total_demand") : undefined)!==repeated.mode || input.householdNetFingerprint!==repeated.sourceNetFingerprint || (input.householdTotalDemand && (!isDeepStrictEqual(input.householdTotalDemand,repeated.sourceDining) || input.householdRecipeFingerprint!==repeated.sourceRecipeFingerprint)))
          throw new InventoryQuantityError("DINING_PLAN_CHANGED","此采购编号已用于另一份需求，请重新核对原提交");
        return { kind: "completed" as const, value: repeated };
      }
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) {
        if (Number(item.version)!==input.version || item.status!=="planned") return { kind: "version_conflict" as const };
        if (!input.householdTotalDemand) throw new InventoryQuantityError("HOUSEHOLD_SHOPPING_REQUIRED","这是共餐安排，请按共餐总需求核对家庭采购");
        const dining = parseJson<import("@dietdigidose/contracts").HouseholdDiningPlan>(item.dining_json,null!);
        await validatePostgresDiningPlan(client,userId,item.recipe_id,dining);
        const recipe = (await client.query("SELECT * FROM recipes WHERE id=$1",[item.recipe_id])).rows[0] as Row;
        const existing = (await client.query("SELECT * FROM household_shopping_items WHERE source_plan_item_id=$1 ORDER BY id FOR UPDATE",[itemId])).rows as Row[];
        let demands = prepareDiningShopping(dining,input.householdTotalDemand,recipe,existing,input.householdRecipeFingerprint);
        if (input.householdNetFingerprint) demands = prepareNetDiningShopping(await readPostgresDiningSupply(client,userId,dining.householdId,{ planId,itemId,version: input.version },dining.participants.reduce((sum,person) => sum+Math.round(person.servings*1_000_000),0)/1_000_000,input.householdRecipeFingerprint!),input.householdNetFingerprint);
        const itemIds: string[] = [];
        for (const demand of demands) {
          const previous = existing.find(row => row.source_demand_key===demand.key);
          if (previous) {
            if (previous.name!==demand.name || previous.amount!==demand.amount) await client.query("UPDATE household_shopping_items SET name=$1,amount=$2,version=version+1,source_generated_version=version+1,updated_by_user_id=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4",[demand.name,demand.amount,userId,previous.id]);
          } else {
            const id = randomUUID();
            await client.query("INSERT INTO household_shopping_items(id,household_id,name,amount,category,created_by_user_id,updated_by_user_id,source_plan_item_id,source_demand_key,source_generated_version) VALUES($1,$2,$3,$4,'共餐总需求',$5,$5,$6,$7,1)",[id,dining.householdId,demand.name,demand.amount,userId,itemId,demand.key]);
            itemIds.push(id);
          }
        }
        for (const row of existing) if (!demands.some(demand => demand.key===row.source_demand_key)) await client.query("DELETE FROM household_shopping_items WHERE id=$1",[row.id]);
        const value = { added: itemIds.length,itemIds,householdId: dining.householdId,mode: input.householdNetFingerprint ? "net_demand" : "total_demand",...(input.householdNetFingerprint ? { sourceNetFingerprint: input.householdNetFingerprint } : {}),sourceDining: dining,sourceRecipeFingerprint: input.householdRecipeFingerprint,repeated: false };
        await this.saveExecution(client,userId,input.idempotencyKey,"shopping",itemId,value);
        return { kind: "completed" as const,value };
      }
      if (Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      if (input.householdTotalDemand) throw new InventoryQuantityError("DINING_PLAN_CHANGED","这餐已不是共餐安排，请重新核对");
      const plan = (await client.query("SELECT status FROM meal_plans WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",[planId,userId])).rows[0];
      if (!plan || plan.status !== "active" || ["completed","skipped"].includes(String(item.status))) return { kind: "version_conflict" as const };
      const stock = (await client.query(`SELECT inventory_items.*, (SELECT metadata_json FROM inventory_change_logs e
        WHERE e.inventory_item_id=inventory_items.id AND e.user_id=inventory_items.user_id
        AND e.metadata_json->'field_evidence'->>'quantity' IS NOT NULL ORDER BY e.id DESC LIMIT 1) AS quantity_evidence
        FROM inventory_items WHERE user_id=$1 AND is_available=TRUE AND deleted_at IS NULL
        ORDER BY CASE WHEN expiration_date='' THEN 1 ELSE 0 END,expiration_date,id`,[userId])).rows as Row[];
      const shopping = (await client.query("SELECT * FROM shopping_list_items WHERE user_id=$1 AND checked=FALSE AND deleted_at IS NULL",[userId])).rows as Row[];
      const meals = (await client.query(`${itemSelect} WHERE i.plan_id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL`,[planId,userId])).rows as Row[];
      const result = preparePersonalShopping(itemId,meals,stock.map(row => ({ ...row,quantity_evidence_status: quantityEvidenceStatus(row.quantity_evidence,row.version) })),shopping,currentDateKey());
      const itemIds: string[] = [];
      for (const [index,entry] of result.missing.entries()) {
        const id = randomUUID();
        await client.query(`INSERT INTO shopping_list_items (id,user_id,client_id,name,amount,category) VALUES ($1,$2,$3,$4,$5,'餐单')`,
          [id,userId,personalShoppingClientId(itemId,input.idempotencyKey,index),entry.name.slice(0,120),entry.amount.slice(0,80)]);
        itemIds.push(id);
      }
      const value = { added: itemIds.length,itemIds,repeated: false,scope: "current_plan",coverage: result.coverage,reviewItems: result.reviewItems };
      await this.saveExecution(client, userId, input.idempotencyKey, "shopping", itemId, value);
      return { kind: "completed" as const, value };
    },Boolean(input.householdNetFingerprint));
  }

  enqueue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput) {
    return this.transaction(async (client) => {
      await lockMealPlanning(client,userId);
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey, "queue", itemId);
      if (repeated) {
        if ((repeated.combineSameRecipe ?? false) !== (input.combineSameRecipe ?? false)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "该提交编号已用于另一种制作安排，请刷新后重试");
        return { kind: "completed" as const, value: repeated };
      }
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
      if (["completed","skipped"].includes(String(item.status)) || Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      if (!item.recipe_id || item.recipe_status !== "approved" || item.recipe_deleted_at) return { kind: "recipe_unavailable" as const };
      await client.query("SELECT pg_advisory_xact_lock(9471, $1::integer)", [userId]);
      const existing = await client.query(`SELECT id FROM cooking_queue_items WHERE user_id = $1 AND (source_plan_item_id = $2 OR id = $3)
        AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId, itemId, item.queue_item_id ?? null]);
      await assertPostgresPlanExecution(client, [item]);
      if (existing.rows[0] && item.queue_item_id === existing.rows[0].id) {
        const value = { queueItemId: String(existing.rows[0].id), added: false, combineSameRecipe: input.combineSameRecipe ?? false, repeated: false };
        await this.saveExecution(client, userId, input.idempotencyKey, "queue", itemId, value);
        return { kind: "completed" as const, value };
      }
      const group = input.combineSameRecipe ? commonProduction(item, (await client.query(`${itemSelect} WHERE i.plan_id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL ORDER BY i.id FOR UPDATE OF i`,[planId,userId])).rows as Row[]) : null;
      await assertPostgresPlanExecution(client, (await client.query(`${itemSelect} WHERE i.plan_id=$1 AND i.user_id=$2 AND i.deleted_at IS NULL ORDER BY i.id FOR SHARE OF i`, [planId, userId])).rows.filter(row => row.id === itemId || group?.targets.some(target => target.id === row.id)));
      let queueItemId = existing.rows[0]?.id as string | undefined;
      let added = false;
      if (!queueItemId) {
        const count = Number((await client.query(`SELECT COUNT(*)::integer AS count FROM cooking_queue_items WHERE user_id = $1
          AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId])).rows[0]!.count);
        if (count >= 30) return { kind: "queue_full" as const };
        const position = Number((await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM cooking_queue_items WHERE user_id = $1
          AND deleted_at IS NULL AND status IN (${activeQueueStatuses})`, [userId])).rows[0]!.position);
        queueItemId = randomUUID();
        await client.query(`INSERT INTO cooking_queue_items
          (id, user_id, recipe_id, position, meal_type, planned_at, recipe_snapshot_json, idempotency_key, source_plan_item_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`, [queueItemId, userId, item.recipe_id, position,
          queueMealType(item.meal_type), null, JSON.stringify({
            title: item.recipe_title || item.title, imageUrl: item.recipe_image_url || null,
            cookTime: item.recipe_cook_time ?? null, difficulty: item.recipe_difficulty || "难度未知",
            ingredients: group?.ingredients ?? parseJson(item.ingredients_json, []),
            productionPlanItems: group?.targets,
            plannedServings: group?.servings ?? formatMealPlanItem(item).plannedServings, planItemId: itemId, plannedDate: String(item.planned_date),
          }), `meal-plan:${itemId}:${input.version}`, itemId]);
        added = true;
      }
      for (const member of group?.targets ?? [{ id: itemId, version: input.version + 1 }]) {
        const changed = await client.query(`UPDATE meal_plan_items SET queue_item_id = $1, status = 'queued', version = version + 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4`, [queueItemId, member.id, userId, member.version - 1]);
        if (changed.rowCount !== 1) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "共用制作的餐次已变化，请刷新后重试");
      }
      const value = { queueItemId, added, combineSameRecipe: input.combineSameRecipe ?? false, repeated: false };
      await this.saveExecution(client, userId, input.idempotencyKey, "queue", itemId, value);
      return { kind: "completed" as const, value };
    });
  }

  async complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput) {
    if (input.production) {
      if (input.dietRecordId) throw new Error("制作分配不能同时关联旧饮食记录");
      const item = (await this.pool.query(`${itemSelect} WHERE i.plan_id=$1 AND i.id=$2 AND i.user_id=$3`, [planId, itemId, userId])).rows[0];
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
      const value = await new PostgresDietRecordsRepository(this.pool, consumeInventoryWithPostgresClient).completeCooking(userId, {
        idempotency_key: input.idempotencyKey, recipe_id: item.recipe_id == null ? null : Number(item.recipe_id),
        inventory_item_ids: [], inventory_consumptions: input.inventory_consumptions ?? [],
        production: prepareProduction({ ...input.production, plan_item_id: itemId, plan_version: input.version }),
      });
      return { kind: "completed" as const, value };
    }
    return this.transaction(async (client) => {
      await lockMealPlanning(client,userId);
      await this.lockExecution(client, userId, input.idempotencyKey);
      const repeated = await this.repeated(client, userId, input.idempotencyKey, "complete", itemId);
      if (repeated) return { kind: "completed" as const, value: repeated };
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`prepared-meals:${userId}`]);
      const item = await this.getItem(client, planId, itemId, userId, true);
      if (!item) return { kind: "not_found" as const };
      if (item.dining_json) throw new InventoryQuantityError("HOUSEHOLD_PRODUCTION_REQUIRED","这是共餐安排，请从家庭制作入口记录产出");
      const produced = (await client.query("SELECT result_json FROM prepared_meals WHERE user_id=$1 AND (plan_item_id=$2 OR queue_item_id=$3)", [userId, itemId, item.queue_item_id ?? null])).rows[0];
      if (produced) return { kind: "completed" as const, value: { ...produced.result_json, repeated: true } };
      if (item.status === "completed" && item.diet_record_id) {
        return { kind: "completed" as const, value: { dietRecordId: Number(item.diet_record_id), repeated: true } };
      }
      if (item.status === "completed" || Number(item.version) !== input.version) return { kind: "version_conflict" as const };
      await assertPostgresPlanExecution(client, [item]);
      const shared = parseJson<{ productionPlanItems?: unknown[] }>(item.queue_snapshot_json, {}).productionPlanItems;
      if (Array.isArray(shared) && shared.length > 1) throw new InventoryQuantityError("MEAL_SHARED_PRODUCTION_REQUIRED", "这是多餐共用制作，请先保存总产出和实际食用份量；原安排和库存未改变");
      let dietRecordId = input.dietRecordId;
      if (dietRecordId) {
        const record = await client.query("SELECT id FROM diet_records WHERE id = $1 AND user_id = $2", [dietRecordId, userId]);
        if (!record.rows[0]) return { kind: "diet_record_not_found" as const };
      } else {
        const inserted = await client.query(`INSERT INTO diet_records
          (user_id, meal_type, food_name, amount, calories, protein, carbs, fat, recorded_at, recorded_time)
          VALUES ($1, $2, $3, '1份', $4, $5, $6, $7, $8, $9) RETURNING id`, [userId, item.meal_type,
          item.recipe_title || item.title, item.calories, item.protein, item.carbs, item.fat, item.planned_date,
          item.planned_date === currentDateKey() ? currentTimeKey() : null]);
        dietRecordId = Number(inserted.rows[0]!.id);
      }
      const changed = await client.query(`UPDATE meal_plan_items SET status = 'completed', diet_record_id = $1, completed_at = CURRENT_TIMESTAMP,
        version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND version = $4`,
      [dietRecordId, itemId, userId, input.version]);
      if (changed.rowCount !== 1) return { kind: "version_conflict" as const };
      const value = { dietRecordId, repeated: false };
      await this.saveExecution(client, userId, input.idempotencyKey, "complete", itemId, value);
      return { kind: "completed" as const, value };
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>,serializable = false) {
    const client = await this.pool.connect();
    try {
      await client.query(serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (error && typeof error === "object" && "code" in error && error.code === "55P03")
        throw new InventoryQuantityError("MEAL_PLAN_PREVIEW_CHANGED", "餐单或库存正在更新，请重新预览；原安排已保留");
      if (serializable && error && typeof error === "object" && "code" in error && error.code === "40001")
        throw new InventoryQuantityError("DINING_SUPPLY_CHANGED","家庭数据正在变化，请重试原提交；若仍冲突请重新预览净采购调整");
      throw error;
    } finally { client.release(); }
  }

  private async getPlan(client: Pool | PoolClient, id: string, userId: number, includeArchived: boolean) {
    const result = await client.query(`SELECT * FROM meal_plans WHERE id = $1 AND user_id = $2${includeArchived ? "" : " AND deleted_at IS NULL"}`,
      [id, userId]);
    return result.rows[0] as Row | undefined;
  }

  private async getItem(client: Pool | PoolClient, planId: string, itemId: string, userId: number, lock = false) {
    const result = await client.query(`${itemSelect} WHERE i.id = $1 AND i.plan_id = $2 AND i.user_id = $3 AND i.deleted_at IS NULL AND p.deleted_at IS NULL${lock ? " FOR UPDATE OF i" : ""}`,
      [itemId, planId, userId]);
    return result.rows[0] as Row | undefined;
  }

  private async getItems(client: Pool | PoolClient, planId: string, userId: number) {
    const result = await client.query(`${itemSelect} WHERE i.plan_id = $1 AND i.user_id = $2 AND i.deleted_at IS NULL
      ORDER BY i.planned_date, CASE i.meal_type WHEN '早餐' THEN 0 WHEN '午餐' THEN 1 WHEN '晚餐' THEN 2 ELSE 3 END, i.id`,
    [planId, userId]);
    return (result.rows as Row[]).map(formatMealPlanItem);
  }

  private async formatPlan(client: Pool | PoolClient, row: Row, userId: number) {
    return formatMealPlan(row, await this.getItems(client, String(row.id), userId));
  }

  private lockExecution(client: PoolClient, userId: number, key: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`meal-plan:${userId}:${key}`]);
  }

  private async repeated(client: PoolClient, userId: number, key: string, action: string, itemId: string): Promise<import("./types.js").ExecutionResult | null> {
    const result = await client.query("SELECT action, meal_plan_item_id, result_json FROM meal_plan_execution_requests WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
    const row = result.rows[0];
    if (row && (row.action !== action || row.meal_plan_item_id !== itemId)) {
      throw new InventoryQuantityError("MEAL_PLAN_KEY_CONFLICT", "此提交编号已用于其他餐次或操作，请核对原提交后重试");
    }
    return row ? { ...(row.result_json as Record<string, unknown>), repeated: true } : null;
  }

  private saveExecution(client: PoolClient, userId: number, key: string, action: string, itemId: string, result: unknown) {
    return client.query(`INSERT INTO meal_plan_execution_requests
      (user_id, idempotency_key, action, meal_plan_item_id, result_json) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, key, action, itemId, JSON.stringify(result)]);
  }
}
