import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cookingPlanDraftSchema } from "@dietdigidose/contracts";
import type { MealPlansRepository } from "../../src/modules/mealPlans/repository.js";

export async function verifyPreparedAllocations(repository: MealPlansRepository, userId: number, batchId: string, mutate: () => Promise<void>) {
  const draft = cookingPlanDraftSchema.parse({ status: "requires_validation", meals: [{ id: "dinner", date: "2099-09-10", mealType: "dinner", servings: 1,
    preparedServings: 1, cookServings: 0, allocations: [{ preparedMealId: batchId, version: 1, foodName: "份量安排", servings: 1, validationRequired: true }] }], totalCookServings: 0,
    cooking: [], unresolved: [], ingredientBudget: [], time: { budgetMinutes: 30, knownSequentialMinutes: 0, exceedsBudget: false, isEstimate: true, incomplete: true, missing: ["storage"] },
    checksPending: ["storage"], excludedPreparedMealIds: [], effectivePreferences: {} });
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) assert(await repository.saveDraft(userId, { id, title: "待吃安排", draft }));
  const results = await Promise.all(ids.map(id => repository.activateDraft(userId, id, 1)));
  assert.deepEqual(results.map(result => result.kind).sort(), ["updated", "version_conflict"]);
  const winner = ids[results.findIndex(result => result.kind === "updated")];
  const loser = ids[results.findIndex(result => result.kind === "version_conflict")];
  const replay = await repository.activateDraft(userId, winner, 1);
  assert.equal(replay.kind, "updated");
  if (replay.kind === "updated") assert.equal(replay.value.repeated, true);
  assert.equal((await repository.find(userId, loser, false))?.status, "draft");
  assert.equal(await repository.removePlan(userId, winner, 2), "removed");
  assert.equal((await repository.activateDraft(userId, loser, 1)).kind, "updated", "cancellation releases the reservation");
  assert.equal(await repository.removePlan(userId, loser, 2), "removed");
  await mutate();
  const staleId = randomUUID();
  await repository.saveDraft(userId, { id: staleId, title: "已变化批次", draft });
  assert.equal((await repository.activateDraft(userId, staleId, 1)).kind, "version_conflict");
  assert.equal((await repository.activateDraft(userId + 1, staleId, 1)).kind, "not_found");
}

export async function verifyAllocationLifecycle(repository: MealPlansRepository, diet: import("../../src/modules/dietRecords/service.js").DietRecordsService, userId: number, injectFailure?: (operation: () => Promise<unknown>) => Promise<void>) {
  const production = await diet.completeCooking(userId, { idempotency_key: `ledger-production:${randomUUID()}`, inventory_item_ids: [], inventory_consumptions: [],
    production: { food_name: "三餐同一批", produced_servings: 3, eaten_servings: 0, meal_type: "", nutrition_per_serving: {} } });
  const batchId = String((production.prepared_meal as Record<string, unknown>).id);
  const planId = randomUUID();
  const draft = cookingPlanDraftSchema.parse({ status: "requires_validation", meals: ["10","11","12"].map(day => ({ id: `meal-${day}`, date: `2099-09-${day}`, mealType: "dinner", servings: 1,
    preparedServings: 1, cookServings: 0, allocations: [{ preparedMealId: batchId, version: 1, foodName: "三餐同一批", servings: 1, validationRequired: true }] })),
    totalCookServings: 0, cooking: [], unresolved: [], ingredientBudget: [],
    time: { budgetMinutes: 30, knownSequentialMinutes: 0, exceedsBudget: false, isEstimate: true, incomplete: true, missing: [] },
    checksPending: [], excludedPreparedMealIds: [], effectivePreferences: {} });
  await repository.saveDraft(userId, { id: planId, title: "分配三餐", draft });
  assert.equal((await repository.activateDraft(userId, planId, 1)).kind, "updated");
  assert.equal((await repository.updatePlan(userId,planId,{ version: 2,status: "draft" })).kind,"version_conflict");
  const get = async () => (await diet.listPreparedMeals(userId)).find(meal => meal.id === batchId)!;
  const before = await get();
  assert.equal(before.allocations?.length, 3);
  const key = `ledger-eat:${randomUUID()}`;
  const input = { idempotency_key: key, type: "eat" as const, version: 1, servings: 0.5 };
  await assert.rejects(diet.applyMealEvent(userId, batchId, input), /选择/);
  assert.equal((await get()).remaining_servings, 3);
  const first = before.allocations![0];
  if (injectFailure) {
    await injectFailure(() => diet.applyMealEvent(userId,batchId,{ ...input,idempotency_key: "ledger-injected-failure",allocation_id: first.id,allocation_version: first.version }));
    const rolledBack = await get();
    assert.equal(rolledBack.version,before.version); assert.equal(rolledBack.remaining_servings,3);
    assert.deepEqual(rolledBack.allocations,before.allocations);
  }

  const eaten = await diet.applyMealEvent(userId, batchId, { ...input, allocation_id: first.id, allocation_version: first.version });
  assert.equal((await get()).allocations![0].remainingServings, 0.5);
  await diet.remove(userId, Number((eaten.diet_record as Record<string, unknown>).id), "undo_eating");
  let meal = await get();
  assert.equal(meal.remaining_servings, 3); assert.equal(meal.allocations![0].remainingServings, 1);
  await diet.applyMealEvent(userId, batchId, { idempotency_key: `ledger-eat-full:${randomUUID()}`, type: "eat", version: meal.version, servings: 1,
    allocation_id: first.id, allocation_version: meal.allocations![0].version });
  meal = await get();
  assert.equal(meal.allocations![0].status, "settled"); assert.equal(meal.remaining_servings, 2);
  const second = meal.allocations![1];
  await diet.applyMealEvent(userId, batchId, { idempotency_key: `ledger-delay:${randomUUID()}`, type: "reschedule", version: meal.version,
    planned_date: "2099-09-15", allocation_id: second.id, allocation_version: second.version });
  meal = await get();
  assert.equal(meal.planned_date, null);
  assert.equal(meal.allocations!.find(row => row.id === second.id)!.plannedDate, "2099-09-15");
  const extra = await diet.completeCooking(userId, { idempotency_key: `ledger-weekly:${randomUUID()}`, inventory_item_ids: [], inventory_consumptions: [],
    production: { food_name: "另一批", produced_servings: 1, eaten_servings: 0, meal_type: "", nutrition_per_serving: {} } });
  const extraId = String((extra.prepared_meal as Record<string, unknown>).id);
  for (const [date, expected] of [["2099-09-15", "version_conflict"], ["2099-09-11", "updated"]] as const) {
    const weeklyId = randomUUID();
    const weekly = cookingPlanDraftSchema.parse({ ...draft, planningMode: "weekly", meals: [{ ...draft.meals[0], date,
      allocations: [{ ...draft.meals[0].allocations[0], preparedMealId: extraId }] }] });
    await repository.saveDraft(userId, { id: weeklyId, title: "延期后的周计划", draft: weekly });
    assert.equal((await repository.activateDraft(userId, weeklyId, 1)).kind, expected, "weekly activation uses current allocation dates");
    assert.equal(await repository.removePlan(userId, weeklyId, expected === "updated" ? 2 : 1), "removed");
  }
  const third = meal.allocations!.find(row => row.targetMealId === "meal-12")!;
  await diet.applyMealEvent(userId, batchId, { idempotency_key: `ledger-discard:${randomUUID()}`, type: "discard", version: meal.version, servings: 0.5,
    allocation_id: third.id, allocation_version: third.version });
  meal = await get(); assert.equal(meal.remaining_servings, 1.5);
  assert.equal(meal.allocations!.find(row => row.id === third.id)!.remainingServings, 0.5);
  await diet.applyMealEvent(userId,batchId,{ idempotency_key: `ledger-release:${randomUUID()}`,type: "reschedule",version: meal.version,
    allocation_id: third.id,allocation_version: meal.allocations!.find(row => row.id===third.id)!.version,release_allocation: true });
  meal=await get(); assert.equal(meal.remaining_servings,1.5);
  assert.equal(meal.allocations!.find(row => row.id===third.id)!.status,"released");
  assert.equal(meal.allocations!.find(row => row.id===second.id)!.status,"active");
  await diet.applyMealEvent(userId,batchId,{ idempotency_key: `ledger-free:${randomUUID()}`,type: "eat",version: meal.version,servings: 0.5,allocation_id: null });
  meal=await get(); assert.equal(meal.remaining_servings,1);
  assert.equal(await repository.removePlan(userId, planId, 2), "removed");
  meal = await get(); assert.equal(meal.remaining_servings, 1); assert.deepEqual(meal.allocations, []);
}
