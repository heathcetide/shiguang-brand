import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cookingPlanDraftSchema, type PreparedMeal } from "@dietdigidose/contracts";
import type { MealPlansRepository } from "../../src/modules/mealPlans/repository.js";
import { CookingQueueService } from "../../src/modules/cookingQueue/service.js";
import type { CookingQueueRepository } from "../../src/modules/cookingQueue/repository.js";
import type { DietRecordsService } from "../../src/modules/dietRecords/service.js";

type Query = (sql: string, values?: (string | number)[]) => Promise<Record<string, unknown>[]>;
export async function verifyCommonProduction(plans: MealPlansRepository, diet: DietRecordsService, userId: number, query: Query, queue: CookingQueueRepository,
  injectFailure: (operation: () => Promise<unknown>) => Promise<void>) {
  const recipeId = Number((await query("INSERT INTO recipes(title,status,steps_json,ingredients_json,serving_size,cook_time) VALUES(?,'approved','[]','[{\"name\":\"共做鸡蛋\",\"amount\":\"1个\"}]',1,NULL) RETURNING id", ["共用制作回归"]))[0].id);
  const stockId = Number((await query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,'共做鸡蛋','其他','6个',6,'piece','2099-12-31') RETURNING id", [userId]))[0].id);
  const planId = randomUUID();
  const draft = cookingPlanDraftSchema.parse({ planningMode: "single_session", status: "requires_validation",
    meals: ["10", "11", "12"].map(day => ({ id: `meal-${day}`, date: `2099-09-${day}`, mealType: "dinner", servings: 1, preparedServings: 0, cookServings: 1, allocations: [] })),
    cooking: ["10", "11", "12"].map(day => ({ targetMealId: `meal-${day}`, recipeId, title: "共用制作回归", servings: 1, recipeYield: 1, demands: [{ food_name: "共做鸡蛋", amount_value: 1, unit: "piece" }] })),
    totalCookServings: 3, unresolved: [], ingredientBudget: [], time: { budgetMinutes: 30, knownSequentialMinutes: 10, exceedsBudget: false, isEstimate: true, incomplete: true, missing: ["storage"] }, checksPending: ["storage"], excludedPreparedMealIds: [], effectivePreferences: {} });
  await plans.saveDraft(userId, { id: planId, title: "一次制作三餐", draft });
  assert.equal((await plans.activateDraft(userId, planId, 1)).kind, "updated");
  const items = (await query("SELECT id,version FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]));
  // A newly queued execution must still match the content captured during activation.
  await query("UPDATE recipes SET ingredients_json='[{\"name\":\"共做鸡蛋\",\"amount\":\"2个\"}]' WHERE id=?", [recipeId]);
  await assert.rejects(plans.enqueue(userId, planId, String(items[0].id), { version: 1, idempotencyKey: randomUUID(), combineSameRecipe: true }), { code: "MEAL_RECIPE_CHANGED" });
  assert((await query("SELECT status,version FROM meal_plan_items WHERE plan_id=?", [planId])).every(row => row.status === "planned" && Number(row.version) === 1));
  assert.equal((await query("SELECT id FROM cooking_queue_items WHERE source_plan_item_id=?", [String(items[0].id)])).length, 0);
  await query("UPDATE recipes SET ingredients_json='[{\"name\":\"共做鸡蛋\",\"amount\":\"1个\"}]' WHERE id=?", [recipeId]);
  const queueKey = randomUUID();
  const queued = await plans.enqueue(userId, planId, String(items[0].id), { version: 1, idempotencyKey: queueKey, combineSameRecipe: true });
  await assert.rejects(plans.enqueue(userId, planId, String(items[0].id), { version: 1, idempotencyKey: queueKey, combineSameRecipe: false }), { code: "MEAL_SOURCE_CONFLICT" });
  assert.equal(queued.kind, "completed");
  if (queued.kind !== "completed") throw new Error("queue missing");
  let queueId = String(queued.value.queueItemId);
  let linked = await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]);
  assert(linked.every(row => row.queue_item_id === queueId && row.version === 2 && row.status === "queued"));
  const queuedAgain = await plans.enqueue(userId, planId, String(items[1].id), { version: 2, idempotencyKey: randomUUID(), combineSameRecipe: true });
  assert.equal(queuedAgain.kind, "completed");
  assert.deepEqual(await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]), linked);
  assert.equal(await queue.cancel(queueId, userId), true);
  const released = await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]);
  assert(released.every(row => row.queue_item_id === null && row.status === "planned" && row.version === 3));
  const regrouped = await plans.enqueue(userId, planId, String(items[0].id), { version: 3, idempotencyKey: randomUUID(), combineSameRecipe: true });
  assert.equal(regrouped.kind, "completed");
  if (regrouped.kind !== "completed") throw new Error("regroup missing");
  queueId = String(regrouped.value.queueItemId);
  linked = await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]);
  assert(linked.every(row => row.queue_item_id === queueId && row.status === "queued" && row.version === 4));
  const rawSnapshot = (await query("SELECT recipe_snapshot_json FROM cooking_queue_items WHERE id=?", [queueId]))[0].recipe_snapshot_json;
  const snapshot = typeof rawSnapshot === "string" ? JSON.parse(rawSnapshot) : rawSnapshot as Record<string, unknown>;
  assert.equal(snapshot.plannedServings, 3);
  assert.deepEqual(snapshot.ingredients, [{ name: "共做鸡蛋", amount: "3个" }]);
  const legacyBefore = await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]);
  await assert.rejects(plans.complete(userId, planId, String(items[1].id), { version: 4, idempotencyKey: randomUUID() }), { code: "MEAL_SHARED_PRODUCTION_REQUIRED" });
  assert.deepEqual(await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]), legacyBefore);
  assert.deepEqual(await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]), linked);
  const queueService = new CookingQueueService(queue);
  assert.equal(snapshot.cookTime, null);
  assert.equal((await queueService.list(userId, false)).find(row => row.id === queueId)!.cookTime, null);
  await query("UPDATE recipes SET cook_time=10 WHERE id=?", [recipeId]);
  assert.equal((await queueService.list(userId, false)).find(row => row.id === queueId)!.cookTime, 10);
  await query("UPDATE recipes SET cook_time=0 WHERE id=?", [recipeId]);
  assert.equal((await queueService.list(userId, false)).find(row => row.id === queueId)!.cookTime, 0);
  await query("UPDATE recipes SET cook_time=NULL WHERE id=?", [recipeId]);
  assert.equal((await queueService.list(userId, false)).find(row => row.id === queueId)!.cookTime, null);

  await query("UPDATE recipes SET steps_json='[\"后来改变的步骤\"]' WHERE id=?", [recipeId]);
  await assert.rejects(queueService.start(queueId, userId, 1), { code: "MEAL_RECIPE_CHANGED" });
  await assert.rejects(queueService.update(queueId, userId, { version: 1, status: "cooking" }), { code: "MEAL_RECIPE_CHANGED" });
  assert.equal((await queue.findOwned(queueId, userId))!.status, "waiting");
  assert.equal(Number((await queue.findOwned(queueId, userId))!.version), 1);
  await query("UPDATE recipes SET steps_json='[]' WHERE id=?", [recipeId]);
  const started = await queueService.start(queueId, userId, 1);
  await assert.rejects(queueService.complete(queueId, userId, started.version), { code: "COOKING_QUEUE_INVALID_TRANSITION" });
  await assert.rejects(queueService.update(queueId, userId, { version: started.version, status: "completed" }), { code: "COOKING_QUEUE_INVALID_TRANSITION" });
  assert.equal((await queue.findOwned(queueId, userId))!.status, "cooking");
  const input = { idempotency_key: randomUUID(), inventory_item_ids: [], inventory_consumptions: [{ item_id: stockId, version: 1, mode: "amount" as const, amount_value: 3, unit: "piece" as const }],
    production: { food_name: "共用制作回归", produced_servings: 3, eaten_servings: 1, eaten_at: "2099-09-10", meal_type: "晚餐", queue_item_id: queueId, queue_version: started.version, nutrition_per_serving: {} } };
  const priorStock = await query("SELECT quantity_value,version FROM inventory_items WHERE id=?", [stockId]);
  await query("UPDATE recipes SET quality_status='needs_review' WHERE id=?", [recipeId]);
  await assert.rejects(diet.completeCooking(userId, input), { code: "MEAL_RECIPE_CHANGED" });
  await assert.rejects(plans.complete(userId, planId, String(items[0].id), { version: 4, idempotencyKey: randomUUID(), production: { ...input.production, queue_item_id: undefined, queue_version: undefined } }), { code: "MEAL_RECIPE_CHANGED" });
  assert.deepEqual(await query("SELECT quantity_value,version FROM inventory_items WHERE id=?", [stockId]), priorStock);
  assert.equal((await query("SELECT id FROM prepared_meals WHERE queue_item_id=?", [queueId])).length, 0);
  assert.deepEqual(await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]), linked);
  await query("UPDATE recipes SET quality_status='trusted' WHERE id=?", [recipeId]);
  await assert.rejects(diet.completeCooking(userId, { ...input, production: { ...input.production, produced_servings: 2 } }), { code: "MEAL_PRODUCTION_INSUFFICIENT" });
  await query("UPDATE meal_plan_items SET version=version+1 WHERE id=?", [String(items[2].id)]);
  await assert.rejects(diet.completeCooking(userId, input), { code: "MEAL_SOURCE_CONFLICT" });
  await query("UPDATE meal_plan_items SET version=version-1 WHERE id=?", [String(items[2].id)]);
  const before = await query("SELECT quantity_value,version FROM inventory_items WHERE id=?", [stockId]);
  const intakeBefore = await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]);
  await injectFailure(() => diet.completeCooking(userId, input));
  assert.deepEqual(await query("SELECT quantity_value,version FROM inventory_items WHERE id=?", [stockId]), before);
  assert.equal((await query("SELECT id FROM prepared_meals WHERE queue_item_id=?", [queueId])).length, 0);
  assert.deepEqual(await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]), intakeBefore);
  assert.deepEqual(await query("SELECT id,queue_item_id,version,status FROM meal_plan_items WHERE plan_id=? ORDER BY planned_date", [planId]), linked);
  const results = await Promise.all([diet.completeCooking(userId, input), diet.completeCooking(userId, { ...input, idempotency_key: randomUUID() })]);
  assert.deepEqual(results.map(result => result.repeated).sort(), [false, true]);
  const made = results.find(result => !result.repeated)!.prepared_meal as PreparedMeal;
  assert.equal(made.remaining_servings, 2);
  const intake = results.find(result => !result.repeated)!.diet_record as Record<string, unknown>;
  assert.equal(intake.amount, "1份");
  assert.equal(intake.recorded_at, "2099-09-10");
  assert.equal(intake.calories, null);
  assert.deepEqual(made.allocations!.map(row => [row.plannedDate, row.remainingServings]), [["2099-09-11", 1], ["2099-09-12", 1]]);
  assert.equal(Number((await query("SELECT quantity_value FROM inventory_items WHERE id=?", [stockId]))[0].quantity_value), 3);
  assert((await query("SELECT status FROM meal_plan_items WHERE plan_id=?", [planId])).every(row => row.status === "completed"));
  await query("UPDATE recipes SET steps_json='[\"完成后内容改变\"]' WHERE id=?", [recipeId]);
  assert.equal((await diet.completeCooking(userId, input)).repeated, true, "committed production replay survives later content changes");
  const fromOtherMeal = await plans.complete(userId, planId, String(items[2].id), { version: 2, idempotencyKey: randomUUID(), production: { ...input.production, queue_item_id: undefined, queue_version: undefined } });
  assert.equal(fromOtherMeal.kind, "completed");
  if (fromOtherMeal.kind === "completed") assert.equal((fromOtherMeal.value.prepared_meal as PreparedMeal).id, made.id);
  const legacyReplay = await plans.complete(userId, planId, String(items[1].id), { version: 4, idempotencyKey: randomUUID() });
  assert.equal(legacyReplay.kind, "completed");
  if (legacyReplay.kind === "completed") assert.equal((legacyReplay.value.prepared_meal as PreparedMeal).id, made.id);
  assert.equal((await queueService.complete(queueId, userId, started.version)).status, "completed");
  const second = made.allocations![0];
  const eating = { idempotency_key: randomUUID(), version: 1, type: "eat" as const, servings: 0.5, recorded_at: "2099-09-11", allocation_id: second.id, allocation_version: 1 };
  const beforeEating = await diet.listPreparedMeals(userId);
  const beforeEatingRecords = await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]);
  // Physical leftovers from another target are not available to this meal.
  await assert.rejects(diet.applyMealEvent(userId, made.id, { ...eating, servings: 1.5 }), { code: "MEAL_ALLOCATION_INSUFFICIENT" });
  await assert.rejects(diet.applyMealEvent(userId, made.id, { ...eating, allocation_id: null, allocation_version: undefined }), { code: "MEAL_ALLOCATION_INSUFFICIENT" });
  assert.deepEqual(await diet.listPreparedMeals(userId), beforeEating);
  assert.deepEqual(await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]), beforeEatingRecords);
  const eaten = await diet.applyMealEvent(userId, made.id, eating);
  assert.equal((eaten.diet_record as Record<string, unknown>).amount, "0.5份");
  assert.equal((eaten.diet_record as Record<string, unknown>).recorded_at, "2099-09-11");
  const meal = eaten.prepared_meal as PreparedMeal;
  assert.equal(meal.remaining_servings, 1.5);
  const discarding = { idempotency_key: randomUUID(), version: meal.version, type: "discard" as const, servings: 0.5, allocation_id: second.id, allocation_version: 2 };
  const discarded = await diet.applyMealEvent(userId, made.id, discarding);
  assert.equal(discarded.diet_record, null);
  const final = (await diet.listPreparedMeals(userId)).find(row => row.id === made.id)!;
  assert.equal(final.remaining_servings, 1);
  assert.equal(final.allocations!.find(row => row.targetMealId === "meal-12")!.remainingServings, 1);
  const recordsAfterDiscard = await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]);
  assert.equal(recordsAfterDiscard.length, beforeEatingRecords.length + 1, "discard never creates intake");
  assert.equal((await diet.applyMealEvent(userId, made.id, eating)).repeated, true, "retry remains safe after a later discard");
  assert.equal((await diet.applyMealEvent(userId, made.id, discarding)).repeated, true);
  for (const changed of [{ ...eating, servings: 0.25 }, { ...discarding, type: "eat" as const }]) {
    await assert.rejects(diet.applyMealEvent(userId, made.id, changed), { code: "PREPARED_MEAL_KEY_CONFLICT" });
  }
  assert.deepEqual((await diet.listPreparedMeals(userId)).find(row => row.id === made.id), final);
  assert.deepEqual(await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]), recordsAfterDiscard);
  const last = final.allocations!.find(row => row.targetMealId === "meal-12")!;
  const finished = await diet.applyMealEvent(userId, made.id, { idempotency_key: randomUUID(), version: final.version,
    type: "eat", servings: 1, recorded_at: "2099-09-12", allocation_id: last.id, allocation_version: last.version });
  const settled = finished.prepared_meal as PreparedMeal;
  assert.equal(settled.remaining_servings, 0);
  assert(settled.allocations!.every(row => row.status === "settled" && row.remainingServings === 0));
  const recordsAfterSettlement = await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]);
  await assert.rejects(diet.applyMealEvent(userId, made.id, { idempotency_key: randomUUID(), version: settled.version,
    type: "discard", servings: 0.1 }), { code: "PREPARED_MEAL_INSUFFICIENT" });
  assert.deepEqual(await query("SELECT id FROM diet_records WHERE user_id=? ORDER BY id", [userId]), recordsAfterSettlement);
  assert.equal((await diet.listPreparedMeals(userId)).find(row => row.id === made.id)?.remaining_servings, 0);
  assert.equal(Number((await query("SELECT quantity_value FROM inventory_items WHERE id=?", [stockId]))[0].quantity_value), 3);
}
