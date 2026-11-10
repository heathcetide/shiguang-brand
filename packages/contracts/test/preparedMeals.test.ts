import assert from "node:assert/strict";
import { test } from "node:test";
import { mealProductionSchema, preparedMealEventSchema } from "../src/preparedMeals.js";

test("servings use six decimal places and permit explicitly clearing old tiny remainders", () => {
  for (const amount of [0.000001, 0.0005, 0.9995, 1, 1000]) {
    assert.equal(mealProductionSchema.safeParse({ food_name: "饭", produced_servings: 1, eaten_servings: Math.min(1, amount) }).success, true);
    assert.equal(preparedMealEventSchema.safeParse({ idempotency_key: "precision-event-205", version: 1, type: "eat", servings: amount }).success, true);
  }
  for (const amount of [0, -1, 0.0000001, 0.9999999, 1000.000001, Infinity, NaN]) {
    assert.equal(preparedMealEventSchema.safeParse({ idempotency_key: "precision-event-205", version: 1, type: "discard", servings: amount }).success, false);
  }
  assert.equal(mealProductionSchema.safeParse({ food_name: "饭", produced_servings: 1, eaten_servings: 0.0000001 }).success, false);
});
