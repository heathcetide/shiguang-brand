import assert from "node:assert/strict";
import type { MealPlansRepository } from "../src/modules/mealPlans/repository.js";

/** Legacy portion captures prove neither the current recipe nor a whole-plan schedule. */
export async function verifyPortionReplacement(repository: MealPlansRepository, userId: number, originalId: number, replacementId: number,
  allocation: () => Promise<{ recipeId: number; demands: { amount_value: number }[] }>) {
  const before = await repository.find(userId,"portion-plan",false);
  const captured = structuredClone(await allocation());
  assert.equal(captured.recipeId,originalId);
  const input = { version: 1,recipeId: replacementId };
  await assert.rejects(repository.updateItem(userId,"portion-plan","portion-meal",input), { code: "MEAL_PLAN_PREVIEW_REQUIRED" });
  const preview = await repository.previewChange(userId,"portion-plan","portion-meal",{ patch: input });
  assert(preview); assert.equal(preview.canApply,false);
  assert(preview.checks.some(check => ["execution_missing","execution_review_missing","production_configuration_missing"].includes(check.code) && check.severity !== "info"));
  await assert.rejects(repository.updateItem(userId,"portion-plan","portion-meal",{ ...input,validationFingerprint: preview.fingerprint }), { code: "MEAL_PLAN_REVALIDATION_BLOCKED" });
  assert.deepEqual(await repository.find(userId,"portion-plan",false),before,"blocked legacy replacement leaves the whole plan unchanged");
  assert.deepEqual(await allocation(),captured,"captured original portions cannot be silently recalculated or replaced");
  assert.deepEqual(await repository.listChanges(userId,"portion-plan"),[],"a rejected change creates no applied history to restore");
}
