import assert from "node:assert/strict";
import test from "node:test";
import { cookingPlanDraftSchema, type CookingPlanDraft } from "../src/index.ts";

const draft: CookingPlanDraft = {
  status: "requires_validation", meals: [{ id: "dinner", date: "2026-09-09", mealType: "dinner", servings: 1.5,
    preparedServings: 0.5, cookServings: 1, allocations: [{ preparedMealId: "53acd578-4595-42c8-8181-1588e8087194",
      version: 2, foodName: "待吃蒸蛋", servings: 0.5, validationRequired: true }] }],
  totalCookServings: 1, cooking: [{ targetMealId: "dinner", recipeId: 1, title: "蒸蛋", servings: 1, recipeYield: 1,
    demands: [{ food_name: "鸡蛋", amount_value: 2, unit: "piece" }] }], unresolved: [], ingredientBudget: [],
  time: { budgetMinutes: 30, knownSequentialMinutes: 15, exceedsBudget: false, isEstimate: true, incomplete: true, missing: ["cleanup"] },
  checksPending: ["storage"], excludedPreparedMealIds: [], effectivePreferences: {},
};

test("drafts preserve fractional production and prepared allocations", () => {
  assert(cookingPlanDraftSchema.safeParse(draft).success);
  const unresolved = structuredClone(draft);
  unresolved.cooking = [];
  unresolved.unresolved = [{ targetMealId: "dinner", reason: "缺少明确用量的菜谱" }];
  assert(cookingPlanDraftSchema.safeParse(unresolved).success);
});

test("drafts reject duplicated, dangling and mismatched production requirements", () => {
  const mutations: Array<(value: CookingPlanDraft) => void> = [
    value => { value.meals.push(structuredClone(value.meals[0])); },
    value => { value.totalCookServings = 2; },
    value => { value.meals[0].servings = 2; },
    value => { value.cooking[0].servings = 2; },
    value => { value.cooking[0].targetMealId = "missing"; },
    value => { value.cooking.push(structuredClone(value.cooking[0])); },
    value => { value.cooking[0].demands = []; },
    value => { value.unresolved = [{ targetMealId: "dinner", reason: "重复" }]; },
    value => { value.time.exceedsBudget = true; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(draft); mutate(value);
    assert.equal(cookingPlanDraftSchema.safeParse(value).success, false, JSON.stringify(value));
  }
});

test("drafts reject reserved batches and duplicate or inconsistent prepared allocations", () => {
  const reserved = structuredClone(draft);
  reserved.excludedPreparedMealIds = [reserved.meals[0].allocations[0].preparedMealId];
  assert.equal(cookingPlanDraftSchema.safeParse(reserved).success, false);
  const repeated = structuredClone(draft);
  repeated.meals[0].allocations.push(structuredClone(repeated.meals[0].allocations[0]));
  assert.equal(cookingPlanDraftSchema.safeParse(repeated).success, false);
  const crossMeal = structuredClone(draft);
  crossMeal.meals.push({ ...structuredClone(crossMeal.meals[0]), id: "lunch", cookServings: 0, servings: 0.5 });
  assert(cookingPlanDraftSchema.safeParse(crossMeal).success);
  crossMeal.meals[1].allocations[0].version += 1;
  assert.equal(cookingPlanDraftSchema.safeParse(crossMeal).success, false);
});
