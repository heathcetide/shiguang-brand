import assert from "node:assert/strict";
import { test } from "node:test";
import { replacementAllocation } from "../src/modules/mealPlans/replacementAllocation.js";

test("replacement retains planned portions and updates captured execution demands", () => {
  const current = { id: "meal",plan_constraints_json: { executionItems: { meal: { targetMealId: "target",servings: 1.5,recipeId: 1 } } } };
  const result = replacementAllocation(current,{ id: 2,title: "新菜",serving_size: 4,ingredients_json: [{ name: "大米",amount: "200g" }] });
  assert.deepEqual(result?.ingredients,[{ name: "大米",amount: "75g" }]);
  assert.equal(result?.constraints?.executionItems.meal.servings,1.5);
  assert.equal(result?.constraints?.executionItems.meal.targetMealId,"target");
  assert.equal(result?.constraints?.executionItems.meal.recipeId,2);
  assert.deepEqual(result?.constraints?.executionItems.meal.demands,[{ food_name: "大米",amount_value: 75,unit: "g" }]);
  assert.equal(current.plan_constraints_json.executionItems.meal.recipeId,1);
});

test("unknown yield or quantities cannot overwrite a portioned execution plan", () => {
  const current = { id: "meal",plan_constraints_json: JSON.stringify({ executionItems: { meal: { servings: 2 } } }) };
  assert.equal(replacementAllocation(current,{ serving_size: null,ingredients_json: [{ name: "米",amount: "200g" }] }),null);
  assert.equal(replacementAllocation(current,{ serving_size: 2,ingredients_json: [{ name: "米",amount: "适量" }] }),null);
  assert.deepEqual(replacementAllocation({ id: "legacy" },{ ingredients_json: '[{"name":"米","amount":"适量"}]' }),
    { ingredients: [{ name: "米",amount: "适量" }],constraints: null });
});

test("activated execution compares current content, review and captured quantities, including legacy plans", async () => {
  const { assertPlanExecution, recipeExecutionProof } = await import("../src/modules/recipes/planExecution.js");
  const recipe = { id: 1, title: "审核菜", status: "approved", quality_status: "trusted", serving_size: 2, cook_time: 10, prep_time: 5,
    steps_json: ["准备", "制作", "收尾"], ingredients_json: [{ name: "米", amount: "100g" }], execution_json: null };
  const cooking = { recipeId: 1, targetMealId: "dinner", title: recipe.title, servings: 1, recipeYield: 2, demands: [{ food_name: "米", amount_value: 50, unit: "g" }] };
  const constraints = { activatedFromVersion: 1, executionItems: { meal: cooking }, executionRecipeKeys: { meal: recipeExecutionProof(recipe) } };
  const item = { id: "meal", recipe_id: 1, steps_json: recipe.steps_json, ingredients_json: [{ name: "米", amount: "50g" }], plan_constraints_json: constraints };
  assert.doesNotThrow(() => assertPlanExecution([item], new Map([[1, recipe]])));
  for (const changed of [{ ...recipe, execution_json: { changed: "audit" } }, { ...recipe, cook_time: 11 }, { ...recipe, quality_status: "needs_review" }, { ...recipe, deleted_at: "removed" }]) {
    assert.throws(() => assertPlanExecution([item], new Map([[1, changed]])), { code: "MEAL_RECIPE_CHANGED" });
  }
  for (const altered of [{ ...item, ingredients_json: [{ name: "米", amount: "60g" }] }, { ...item, steps_json: ["已改步骤"] },
    { ...item, plan_constraints_json: { ...constraints, executionItems: { meal: { ...cooking, demands: undefined } } } },
    { ...item, plan_constraints_json: { ...constraints, executionRecipeKeys: null } }]) {
    assert.throws(() => assertPlanExecution([altered], new Map([[1, recipe]])), { code: "MEAL_RECIPE_CHANGED" });
  }
  const legacy = { ...item, plan_constraints_json: { executionItems: constraints.executionItems, activatedFromVersion: 1 } };
  assert.doesNotThrow(() => assertPlanExecution([legacy], new Map([[1, recipe]])));
  assert.throws(() => assertPlanExecution([legacy], new Map([[1, { ...recipe, steps_json: ["已改步骤"] }]])), { code: "MEAL_RECIPE_CHANGED" });
});

test("an explicitly selected new recipe drops old substitution evidence and captures its own version", () => {
  const current = { id: "meal", plan_constraints_json: { executionItems: { meal: { targetMealId: "dinner", recipeId: 1, servings: 1,
    substitution: { sourceRecipeId: 9, recipeId: 1 } } }, executionRecipeKeys: { meal: { stale: true } } } };
  const replacement = { id: 2, title: "新菜", serving_size: 2, ingredients_json: [{ name: "米", amount: "100g" }] };
  const result = replacementAllocation(current, replacement);
  assert.equal(result?.constraints?.executionItems.meal.substitution, undefined);
  assert.equal(result?.constraints?.executionItems.meal.recipeId, 2);
  assert.notDeepEqual(result?.constraints?.executionRecipeKeys.meal, { stale: true });
  assert.equal(result?.constraints?.executionNeedsRevalidation, true);
});
