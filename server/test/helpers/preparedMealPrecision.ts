import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PreparedMeal } from "@dietdigidose/contracts";
import type { DietRecordsService } from "../../src/modules/dietRecords/service.js";

/** The same conservation, replay and concurrency assertions run against both drivers. */
export async function verifyPreparedMealPrecision(diet: DietRecordsService, userId: number) {
  const prefix = `precision-205:${randomUUID()}`;
  const produce = async (suffix: string, eatenServings: number) => {
    const result = await diet.completeCooking(userId, {
      idempotency_key: `${prefix}:${suffix}`, inventory_item_ids: [], inventory_consumptions: [],
      production: { food_name: `小余量 ${suffix}`, produced_servings: 1, eaten_servings: eatenServings, meal_type: "午餐", nutrition_per_serving: {} },
    });
    return result.prepared_meal as PreparedMeal;
  };
  const current = async (id: string) => (await diet.listPreparedMeals(userId)).find(meal => meal.id === id)!;
  const intakeCount = async (id: string) => (await diet.list(userId)).filter(record => record.prepared_meal_id === id).length;

  for (const remaining of [0.0005, 0.000001]) {
    for (const type of ["eat", "discard"] as const) {
      const meal = await produce(`${type}:${remaining}`, 1 - remaining);
      assert.equal(meal.remaining_servings, remaining);
      const input = { idempotency_key: `${prefix}:${type}:clear:${remaining}`, version: meal.version, type, servings: remaining };
      const results = await Promise.all([diet.applyMealEvent(userId, meal.id, input), diet.applyMealEvent(userId, meal.id, input)]);
      assert.deepEqual(results.map(result => result.repeated).sort(), [false, true]);
      assert.equal((await current(meal.id)).remaining_servings, 0);
      assert.equal((await current(meal.id)).version, meal.version + 1);
      assert.equal(await intakeCount(meal.id), type === "eat" ? 2 : 1);
      if (type === "eat") assert.equal((results[0].diet_record as { amount: string }).amount, `${remaining}份`);
      else assert.equal(results[0].diet_record, null);
      await assert.rejects(diet.applyMealEvent(userId, meal.id, { ...input, idempotency_key: `${prefix}:${type}:stale:${remaining}` }), /刷新/);
      await assert.rejects(diet.applyMealEvent(userId, meal.id, { ...input, idempotency_key: `${prefix}:${type}:excess:${remaining}`, version: meal.version + 1, servings: 0.000001 }), /不足/);
      assert.equal((await diet.applyMealEvent(userId, meal.id, input)).repeated, true);
      assert.equal(await intakeCount(meal.id), type === "eat" ? 2 : 1);
    }
  }

  const decimalMeal = await produce("decimal-sequence", 0);
  const decimalRemainders = [0.90005, 0.8001, 0.70015, 0.6002, 0.50025, 0.4003, 0.30035, 0.2004, 0.10045, 0.0005];
  for (const [index, expected] of decimalRemainders.entries()) {
    await diet.applyMealEvent(userId, decimalMeal.id, {
      idempotency_key: `${prefix}:decimal:${index}`, version: index + 1, type: "eat", servings: 0.09995,
    });
    assert.equal((await current(decimalMeal.id)).remaining_servings, expected);
  }
  assert.equal((await current(decimalMeal.id)).remaining_servings, 0.0005);
  await diet.applyMealEvent(userId, decimalMeal.id, { idempotency_key: `${prefix}:decimal:clear`, version: 11, type: "discard", servings: 0.0005 });
  assert.equal((await current(decimalMeal.id)).remaining_servings, 0);
  assert.equal(await intakeCount(decimalMeal.id), 10);

  const concurrentMeal = await produce("concurrent", 0.9995);
  const attempts = [0, 1].map(index => ({ idempotency_key: `${prefix}:concurrent:${index}`, version: 1, type: "eat" as const, servings: 0.0005 }));
  const outcomes = await Promise.allSettled(attempts.map(input => diet.applyMealEvent(userId, concurrentMeal.id, input)));
  assert.deepEqual(outcomes.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "PREPARED_MEAL_VERSION_CONFLICT");
  assert.equal((await current(concurrentMeal.id)).remaining_servings, 0);
  assert.equal((await current(concurrentMeal.id)).version, 2);
  assert.equal(await intakeCount(concurrentMeal.id), 2);
}
