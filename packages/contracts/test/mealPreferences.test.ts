import assert from "node:assert/strict";
import test from "node:test";
import { kitchenPreferencesSchema, resolveKitchenPreferences } from "../src/index.ts";

test("kitchen defaults preserve explicit values and temporary overrides do not mutate the profile", () => {
  const saved = { servings: 1, meal_time_minutes: 45, refrigeration_available: false, reheating_available: null };
  assert.equal(resolveKitchenPreferences().meal_time_minutes, 30);
  assert.equal(resolveKitchenPreferences(saved).meal_time_minutes, 45);
  const oneTime = resolveKitchenPreferences(saved, { servings: 2, meal_time_minutes: 20 });
  assert.equal(oneTime.servings, 2);
  assert.equal(oneTime.meal_time_minutes, 20);
  assert.equal(oneTime.refrigeration_available, false);
  assert.equal(oneTime.reheating_available, null);
  assert.equal(resolveKitchenPreferences(saved).servings, 1);
  assert.equal(kitchenPreferencesSchema.safeParse({ refrigeration_available: "unknown" }).success, false);
});
