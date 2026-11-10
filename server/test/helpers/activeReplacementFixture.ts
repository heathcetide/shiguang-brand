import type { ActiveReplacementArguments } from "../../src/modules/mealPlans/activeReplacement.js";
import { executionRecipeKey } from "../../src/modules/recipes/execution.js";
import { recipeExecutionProof } from "../../src/modules/recipes/planExecution.js";
import { executionFixture } from "./recipeExecution.js";
import type { Row } from "../../src/modules/mealPlans/formatters.js";

export function activeReplacementFixture(): ActiveReplacementArguments {
  const recipes: Row[] = [1, 2].map(id => ({
    id,
    title: `菜${id}`,
    status: "approved",
    quality_status: "trusted",
    visibility: "public",
    serving_size: 2,
    cook_time: 10,
    prep_time: 5,
    steps_json: ["准备", "煮熟", "收尾"],
    ingredients_json: [{ name: "米", amount: "100g" }],
  }));
  for (const row of recipes) {
    row.execution_json = {
      recipeKey: executionRecipeKey(row),
      reviewedBy: 1,
      reviewedAt: "2026-10-20T00:00:00Z",
      profile: {
        ...executionFixture,
        handling: {
          storage: "fresh_only",
          maxHoldHours: 0,
          coldServingAllowed: true,
          carryAllowed: false,
          sourceUrl: "https://example.invalid/review",
          reference: "合成测试存放依据",
          instructions: "仅用于自动测试的合成依据，不代表真实食品安全保证",
        },
      },
    };
  }
  const executions = Object.fromEntries(
    ["a", "b"].map(id => [
      id,
      {
        targetMealId: `old-${id}`,
        recipeId: 1,
        title: "菜1",
        servings: 2,
        recipeYield: 2,
        demands: [{ food_name: "米", amount_value: 100, unit: "g" }],
      },
    ]),
  );
  const items = ["a", "b"].map(id => ({
    id,
    version: 1,
    plan_id: "p",
    status: "planned",
    planned_date: "2026-10-21",
    meal_type: "午餐",
    recipe_id: 1,
    title: "菜1",
    steps_json: recipes[0].steps_json,
    ingredients_json: recipes[0].ingredients_json,
  }));
  return {
    userId: 1,
    itemId: "a",
    today: "2026-10-21",
    input: { version: 1, recipeId: 2 },
    items,
    plan: {
      id: "p",
      user_id: 1,
      status: "active",
      start_date: "2026-10-21",
      end_date: "2026-10-23",
      constraints_json: {
        executionItems: executions,
        executionRecipeKeys: {
          a: recipeExecutionProof(recipes[0]),
          b: recipeExecutionProof(recipes[0]),
        },
        currentCookingDraft: {
          productionDate: "2026-10-21",
          time: { budgetMinutes: 60 },
          meals: [{ id: "stale", date: "1999-01-01" }],
          cooking: [{ recipeId: 999 }],
        },
      },
    },
    data: {
      recipes,
      prepared_meal_allocations: [],
      prepared_meals: [],
      cooking_queue_items: [],
      user_health_profiles: [
        { user_id: 1, kitchen_constraints_json: { meal_time_minutes: 60 } },
      ],
      inventory_items: [
        {
          id: 1,
          user_id: 1,
          is_available: 1,
          food_name: "米",
          quantity_value: 300,
          quantity_unit: "g",
          version: 1,
          expiration_date: "2026-11-01",
          quantity_evidence_status: "known",
        },
      ],
      kitchenware_items: [
        { id: 1, user_id: 1, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } },
      ],
      recipe_kitchenware_requirements: [],
      recipe_compatibility: [],
      meal_plans: [],
      meal_plan_items: [],
    },
  };
}

export const validPendingRevalidationFixture = activeReplacementFixture;
