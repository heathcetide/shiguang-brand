import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from 'better-sqlite3';
import { SqliteRecommendationsRepository } from '../src/modules/recommendations/sqliteRepository.js';
import { RecommendationsError } from "../src/modules/recommendations/errors.js";
import type { RecommendationsRepository } from "../src/modules/recommendations/repository.js";
import { configureRecommendationsService, recommendationsService } from "../src/modules/recommendations/runtime.js";
import { RecommendationsService } from "../src/modules/recommendations/service.js";

function repository(overrides: Partial<RecommendationsRepository> = {}) {
  return {
    preferenceOutcomes: async () => ({ production: [],events: [] }),
    learningData: async () => ({ settings: null,events: [],recipes: [] }),
    planningState: async () => ({ items: [],plans: [],shopping: [] }),
    preparedMeals: async () => [], profile: async () => null, inventory: async () => [], kitchenware: async () => [],
    recipes: async () => [{ id: 1, title: "番茄汤", ingredients_json: [{ name: "番茄" }], steps_json: ["煮熟"], status: "approved" }],
    favoriteRecipeIds: async () => [], recentRecipeIds: async () => [], skippedRecipeIds: async () => [],
    dietTotals: async () => ({ calories: 0, protein: 0 }), dailyCaloriesTarget: async () => 2000,
    createRequest: async () => {},
    ...overrides,
  } as RecommendationsRepository;
}
const kitchenware = {
  requirements: async () => [],
  evaluateRequirements: async () => ({ requirements: [], blocking: [] }),
};

test("reviewed full plans recompute parallel time on replacement and keep weekly sessions separate", async () => {
  const { executionFixture } = await import("./helpers/recipeExecution.js");
  const { executionRecipeKey } = await import("../src/modules/recipes/execution.js");
  const { replaceCookingDraft } = await import("../src/modules/recommendations/plan.js");
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const rows = [1, 2].map(id => {
    const row = { id, title: `排程菜${id}`, serving_size: 2, cook_time: 10, prep_time: 5, ingredients_json: [{ name: "番茄", amount: "2个" }],
      steps_json: ["准备", "烹饪", "收尾"], required_kitchenware_json: [], optional_kitchenware_json: [] };
    return { ...row, execution_json: { recipeKey: executionRecipeKey(row), reviewedBy: 1, reviewedAt: "2026-10-01T00:00:00Z",
      profile: { ...executionFixture, handling: { storage: "refrigerated", maxHoldHours: 72, coldServingAllowed: true, carryAllowed: false,
        sourceUrl: "https://example.invalid/handling-fixture", reference: "合成存放审核回归依据", instructions: "合成测试专用，不作为真实食物的存放食用依据" }, tools: [{ ...executionFixture.tools[0], catalogId: id }] } } };
  });
  const devices = rows.map(row => ({ id: row.id, catalog_id: row.id, name: `测试锅${row.id}`, attributes_json: { capacityMl: 1000 } }));
  const stock = [{ id: 1, food_name: "番茄", quantity_value: 100, quantity_unit: "piece", expiration_date: "2099-12-31", version: 1 }];
  const service = new RecommendationsService(repository({ recipes: async () => rows, kitchenware: async () => devices, inventory: async () => stock }), kitchenware);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], preferences: { meal_time_minutes: 30 }, meals: [
    { id: "dinner", date: "2099-01-01", mealType: "dinner", servings: 2 },
    { id: "lunch", date: "2099-01-02", mealType: "lunch", servings: 2 },
  ] });
  assert.equal(draft.time.schedule?.elapsedMinutes, 22); assert.equal(draft.time.exceedsBudget, false);
  const computed = await service.compute(7, { surface: "meal_plan", maxCookTime: 30 });
  const first = draft.cooking[0], second = draft.cooking[1]; assert.notEqual(first.recipeId, second.recipeId);
  const replacement = replaceCookingDraft(draft, second.targetMealId, first.recipeId, computed.results, stock, [], devices);
  assert.equal(replacement.draft.time.schedule?.elapsedMinutes, 34); assert.equal(replacement.draft.time.exceedsBudget, true);
  assert(replacement.conflicts.some(conflict => conflict.includes("34")));
  const weekly = await service.weeklyPlan(7, { startDate: "2099-01-01", mealTypes: ["dinner"], servings: 2 });
  assert.equal(weekly.draft?.time.incomplete, false); assert.equal(weekly.draft?.time.schedule, undefined);
  assert.equal(weekly.draft?.time.sessions?.length, 7); assert(weekly.draft?.time.sessions?.every(session => session.schedule.elapsedMinutes === 17));
  assert(weekly.draft);
  assert.equal(cookingPlanDraftSchema.safeParse({ ...weekly.draft, time: { ...weekly.draft.time, sessions: [...weekly.draft.time.sessions!, weekly.draft.time.sessions![0]] } }).success, false);
  const over = await service.weeklyPlan(7, { startDate: "2099-01-01", mealTypes: ["dinner"], servings: 3 });
  assert.equal(over.draft?.time.incomplete, true); assert(over.draft?.time.sessions?.every(session => !session.schedule.complete));
});

describe("recommendations module", () => {
  test('reference catalogue recipes are not automatic nutrition recommendation candidates', async () => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE recipes(id INTEGER,title TEXT,status TEXT,quality_status TEXT,deleted_at TEXT);
        INSERT INTO recipes VALUES(1,'参考配方','approved','reference',NULL),(2,'已核验','approved','trusted',NULL),(3,'待审','approved','needs_review',NULL);`);
      const rows = await new SqliteRecommendationsRepository(db).recipes({ timeBudget: null });
      assert.deepEqual(rows.map(row=>row.id),[2]);
    } finally { db.close(); }
  });
  test("shares the composed service with AI and Agent consumers", () => {
    const service = new RecommendationsService(repository(), kitchenware);
    configureRecommendationsService(service);
    assert.equal(recommendationsService(), service);
  });

  test("scores PostgreSQL-style JSON values and persists a driver-neutral snapshot", async () => {
    let stored: unknown;
    const service = new RecommendationsService(repository({ createRequest: async (input) => { stored = input; } }), kitchenware);
    const page = await service.page(7, { surface: "home", matchStatus: "all", pageSize: 10 });
    assert.equal(page.total, 1);
    assert.equal((page.items[0]?.recipe as Record<string, unknown>).title, "番茄汤");
    assert.equal(typeof page.scoringVersion, "string");
    assert(stored);
  });

  test("maps missing and mismatched request versions to stable errors", async () => {
    const missing = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestEvidence: async () => null,
    }), kitchenware);
    await assert.rejects(missing.event(7, { requestId: "missing", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0001" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_REQUEST_NOT_FOUND"); return true;
    });
    const mismatch = new RecommendationsService(repository({
      findEvent: async () => null, recipeAvailable: async () => true, requestEvidence: async () => ({ scoring_version: "v2" }),
    }), kitchenware);
    await assert.rejects(mismatch.event(7, { requestId: "request", recipeId: 1, eventType: "view", scoringVersion: "v1",
      surface: "home", idempotencyKey: "event-key-0002" }), (error: unknown) => {
      assert(error instanceof RecommendationsError); assert.equal(error.code, "RECOMMENDATION_VERSION_MISMATCH"); return true;
    });
  });
});

test("recommendations apply the shared default time and never claim whole-plan feasibility from cook time", async () => {
  const recipe = { id: 1, title: "准备较久的汤", ingredients_json: [{ name: "番茄", amount: "2个" }],
    steps_json: ["煮熟"], status: "approved", cook_time: 20, prep_time: 20, serving_size: 3 };
  const defaults = new RecommendationsService(repository({ recipes: async () => [recipe] }), kitchenware);
  assert.equal((await defaults.compute(7, { surface: "meal_plan" })).timeBudget, 30);
  assert.equal((await defaults.compute(7, { surface: "meal_plan" })).results.length, 0);
  const saved = new RecommendationsService(repository({ recipes: async () => [recipe],
    profile: async () => ({ kitchen_constraints_json: { meal_time_minutes: 45 } }),
  }), kitchenware);
  const result = await saved.compute(7, { surface: "meal_plan" });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].recipe.serving_size, 3);
  assert.equal(result.results[0].recipe.prep_time, 20);
  assert(result.results[0].degraded.includes("whole_plan_time_unverified"));
  assert.equal(result.results[0].hardConstraints.satisfied.includes("time"), false);
  assert.deepEqual(result.results[0].hardConstraints.pending, ["time"]);
  assert.equal(result.results[0].features.estimatedTimeMinutes, 40);
  assert.doesNotMatch(result.results[0].reasons.join(" "), /符合.*分钟/);
  assert.equal((await saved.compute(7, { surface: "meal_plan", maxCookTime: 30 })).results.length, 0);
});

test("unknown recipe preparation remains pending in drafts and cannot feed automatic dinner offers", async () => {
  const { interventionRecommendations } = await import("../src/modules/interventions/snapshot.js");
  const recipe = { id: 1, title: "准备待核实的汤", ingredients_json: [{ name: "番茄", amount: "1个" }],
    steps_json: ["煮熟"], status: "approved", cook_time: 10, prep_time: null, serving_size: 1 };
  const service = new RecommendationsService(repository({ recipes: async () => [recipe], inventory: async () => [
    { id: 1, food_name: "番茄", quantity_value: 2, quantity_unit: "piece", expiration_date: "2099-09-20", version: 1 },
  ] }), kitchenware);
  const computed = await service.compute(7, { surface: "meal_plan" });
  assert.equal(computed.results[0].recipe.prep_time, null);
  assert(computed.results[0].degraded.includes("preparation_time_unknown"));
  assert.deepEqual(interventionRecommendations(computed.results), []);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "dinner", date: "2099-09-09", mealType: "dinner", servings: 1 },
  ] });
  assert.equal(draft.time.knownSequentialMinutes, 10);
  assert.equal(draft.time.incomplete, true);
  assert(draft.time.missing.includes("preparation_or_cooking"));
});

test("cooking drafts scale portions and share stock across meals without claiming time feasibility", async () => {
  const recipe = { id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }],
    steps_json: ["蒸熟"], status: "approved", cook_time: 15, prep_time: 5, serving_size: 1 };
  const stock = { id: 1, food_name: "鸡蛋", quantity_value: 3, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1, batch_code: "egg" };
  const service = new RecommendationsService(repository({ recipes: async () => [recipe], inventory: async () => [stock] }), kitchenware);
  const result = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 1 },
    { id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 },
  ] });
  assert.equal(result.cooking.length, 2);
  assert.deepEqual(result.ingredientBudget.map(item => item.covered_value), [2,1]);
  assert.equal(result.ingredientBudget[1].missing_value, 1);
  assert.equal(result.time.knownSequentialMinutes, 40);
  assert.equal(result.time.exceedsBudget, true);
  assert.equal(result.status, "requires_validation");
  assert.equal(stock.quantity_value, 3);
  const unknownYield = new RecommendationsService(repository({ recipes: async () => [{ ...recipe, serving_size: null }] }), kitchenware);
  const unavailable = await unknownYield.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 3 },
  ] });
  assert.equal(unavailable.cooking.length, 0);
  assert.equal(unavailable.unresolved.length, 1);
});

test("one-time plan preferences reach candidate filtering and do not replace long-term defaults", async () => {
  const stored = { kitchen_constraints_json: { meal_time_minutes: 45, servings: 1, refrigeration_available: true } };
  const recipe = { id: 1, title: "慢炖汤", ingredients_json: [{ name: "番茄", amount: "2个" }],
    steps_json: ["煮熟"], status: "approved", cook_time: 30, prep_time: 5, serving_size: 1 };
  const service = new RecommendationsService(repository({ profile: async () => stored, recipes: async () => [recipe] }), kitchenware);
  const request = { excludedPreparedMealIds: [], meals: [{ id: "lunch", date: "2030-09-09", mealType: "lunch" as const, servings: 1 }] };
  const overridden = await service.cookingPlan(7, { ...request, preferences: { meal_time_minutes: 20, refrigeration_available: false } });
  assert.equal(overridden.time.budgetMinutes, 20);
  assert.equal(overridden.cooking.length, 0);
  assert.equal(overridden.effectivePreferences.refrigeration_available, false);
  const next = await service.cookingPlan(7, request);
  assert.equal(next.time.budgetMinutes, 45);
  assert.equal(next.cooking.length, 1);
  assert.equal(next.effectivePreferences.refrigeration_available, true);
  assert.deepEqual(stored.kitchen_constraints_json, { meal_time_minutes: 45, servings: 1, refrigeration_available: true });
});

test("local replacement preserves other cooking entries and allocations while recomputing shared stock and time", async () => {
  const recipes = [
    { id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 },
    { id: 2, title: "厚蛋烧", ingredients_json: [{ name: "鸡蛋", amount: "3枚" }], steps_json: ["煎熟"], status: "approved", cook_time: 15, prep_time: 5, serving_size: 1 },
  ];
  const stock = { id: 1, food_name: "鸡蛋", quantity_value: 4, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1, batch_code: "egg" };
  let offerReplacement = false;
  const service = new RecommendationsService(repository({ recipes: async () => offerReplacement ? recipes : [recipes[0]], inventory: async () => [stock] }), kitchenware);
  const generated = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [
    { id: "lunch", date: "2030-09-09", mealType: "lunch", servings: 1 },
    { id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 },
  ] });
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const draft = cookingPlanDraftSchema.parse(generated);
  assert.deepEqual(draft.cooking.map(item => item.recipeId), [1, 1]);
  draft.meals[0].servings = 1.5;
  draft.meals[0].preparedServings = 0.5;
  draft.meals[0].allocations = [{ preparedMealId: "52a6a5f0-4fa8-45a2-812f-8dbb1461d194", version: 3,
    foodName: "昨天的待吃餐", servings: 0.5, validationRequired: true }];
  draft.excludedPreparedMealIds = ["a7ed002b-e9c1-428a-851d-44d27ae68194"];
  const original = structuredClone(draft);
  offerReplacement = true;
  const replaced = await service.replaceCookingItem(7, { draft, targetMealId: "dinner", recipeId: 2 });
  assert.equal(replaced.draft.cooking[1].recipeId, 2);
  assert.deepEqual(replaced.draft.cooking[0], original.cooking[0]);
  assert.deepEqual(replaced.draft.meals, original.meals);
  assert.deepEqual(replaced.draft.excludedPreparedMealIds, original.excludedPreparedMealIds);
  assert.equal(replaced.draft.ingredientBudget[1].missing_value, 1);
  assert.equal(replaced.draft.time.knownSequentialMinutes, 35);
  assert.equal(replaced.draft.time.exceedsBudget, true);
  assert(replaced.conflicts.some(message => message.includes("鸡蛋")));
  assert(replaced.conflicts.some(message => message.includes("35")));
  assert.deepEqual(draft, original);
  assert.equal(stock.quantity_value, 4);
  await assert.rejects(service.replaceCookingItem(7, { draft, targetMealId: "missing" }), (error: unknown) => {
    assert(error instanceof RecommendationsError); assert.equal(error.code, "COOKING_PLAN_TARGET_AMBIGUOUS"); return true;
  });
  await assert.rejects(service.replaceCookingItem(7, { draft, targetMealId: "dinner", recipeId: 999 }), (error: unknown) => {
    assert(error instanceof RecommendationsError); assert.equal(error.code, "COOKING_PLAN_NO_REPLACEMENT"); return true;
  });
  assert.deepEqual(draft, original);
});


test("cooking drafts do not count estimated inventory as a certain supply", async () => {
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }],
      steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }],
    inventory: async () => [{ id: 1, food_name: "鸡蛋", quantity_value: 10, quantity_unit: "piece", expiration_date: "2030-09-20",
      version: 1, batch_code: "scan", quantity_evidence_status: "estimated" }],
  }), kitchenware);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [{ id: "dinner", date: "2030-09-09", mealType: "dinner", servings: 1 }] });
  assert.equal(draft.ingredientBudget[0].quantity_status, "unknown");
  assert.equal(draft.ingredientBudget[0].fully_covered, false);
  assert.equal(draft.ingredientBudget[0].covered_value, 0);
});

test("full-stock recommendations require enough known quantities for the requested portions", async () => {
  let stock: Record<string, unknown> = { id: 1, food_name: "鸡蛋", quantity_value: 1, quantity_unit: "piece", expiration_date: "2030-09-20", version: 1 };
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"],
      status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }], inventory: async () => [stock],
  }), kitchenware);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "missing_few" })).results.length, 1);
  stock = { ...stock, quantity_value: 2 };
  const full = await service.compute(7, { surface: "inventory", matchStatus: "full" });
  assert.equal(full.results.length, 1);
  assert.equal(full.results[0].features.inventoryCoverage, 100);
  assert.deepEqual(full.results[0].features.inventoryEvidence, { version: 1, scope: "personal", allocations: [{ itemId: 1, itemVersion: 1, amount: 2, unit: "piece" }] });
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" }, { servings: 2 })).results.length, 0);
  stock = { ...stock, expiration_date: "2000-01-01" };
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  const expired = await service.compute(7, { surface: "inventory" });
  assert.equal(expired.results[0].features.inventoryCoverage, 0);
  assert.deepEqual(expired.results[0].features.inventoryEvidence.allocations, []);
  assert.deepEqual(expired.results[0].features.missingIngredients, [{ name: "鸡蛋", amount: "2枚" }]);
  stock = { ...stock, expiration_date: "2030-09-20" };
  stock = { ...stock, quantity_evidence_status: "estimated" };
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "full" })).results.length, 0);
  assert.equal((await service.compute(7, { surface: "inventory", matchStatus: "missing_few" })).results.length, 0);
  const unknown = await service.compute(7, { surface: "inventory" });
  assert.equal(unknown.results[0].features.uncertainIngredients.length, 1);
  assert.equal(unknown.results[0].features.missingIngredients.length, 0);
});

test("cooking drafts do not allocate expired raw ingredients", async () => {
  const service = new RecommendationsService(repository({
    recipes: async () => [{ id: 1, title: "蒸蛋", ingredients_json: [{ name: "鸡蛋", amount: "2枚" }], steps_json: ["蒸熟"], status: "approved", cook_time: 10, prep_time: 5, serving_size: 1 }],
    inventory: async () => [{ id: 1, food_name: "鸡蛋", quantity_value: 100, quantity_unit: "piece", expiration_date: "2000-01-01", version: 1 }],
  }), kitchenware);
  const draft = await service.cookingPlan(7, { excludedPreparedMealIds: [], meals: [{ id: "dinner", date: "2030-09-10", mealType: "dinner", servings: 1 }] });
  assert.equal(draft.ingredientBudget[0].fully_covered, false);
  assert.deepEqual(draft.ingredientBudget[0].deductions, []);
});

test("weekly replacement reloads current commitments for the owner and week", async () => {
  const recipes = [1,2].map(id => ({ id,title: `蛋羹${id}`,ingredients_json: [{ name: "鸡蛋",amount: "1个" }],steps_json: ["蒸熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 }));
  const stock = { id: 1,food_name: "鸡蛋",quantity_value: 4,quantity_unit: "piece",expiration_date: "2099-09-30",version: 1,batch_code: null };
  let committed = false;
  const service = new RecommendationsService(repository({ recipes: async () => recipes,inventory: async () => [stock],planningState: async (userId,start,end) => {
    assert.equal(userId,7); assert.equal(start,"2099-09-12"); assert.equal(end,"2099-09-18");
    return { plans: [],shopping: [],items: committed ? [{ id: "other",planned_date: "2099-09-12",meal_type: "晚餐",title: "已确认",status: "planned",ingredients_json: [{ name: "鸡蛋",amount: "2个" }] }] : [] };
  } }),kitchenware);
  const preview = await service.weeklyPlan(7,{ startDate: "2099-09-12",mealTypes: ["lunch"] });
  committed = true;
  const target = preview.draft!.cooking[0];
  const updated = await service.replaceCookingItem(7,{ draft: preview.draft!,targetMealId: target.targetMealId,recipeId: target.recipeId === 1 ? 2 : 1 });
  assert.equal(updated.draft.weeklyShopping![0].required,9);
  assert.equal(updated.draft.weeklyShopping![0].missing,5);
});

test("today's no-spicy condition filters known spicy recipes without saving long-term preferences",async () => {
  const stored = { kitchen_constraints_json: { avoid_spicy: false,meal_time_minutes: 30 } };
  const recipes = [
    { id: 1,title: "辣椒炒蛋",ingredients_json: [{ name: "辣椒",amount: "1个" }],tags: [] as string[],steps_json: ["炒熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 },
    { id: 2,title: "蒸蛋",ingredients_json: [{ name: "鸡蛋",amount: "1个" }],tags: [] as string[],steps_json: ["蒸熟"],status: "approved",cook_time: 5,prep_time: 2,serving_size: 1 },
  ];
  recipes.push({ ...recipes[1],id: 3,title: "辣味标记",tags: ["香辣"] } as typeof recipes[number]);
  recipes.push({ ...recipes[1],id: 4,title: "原料不明",ingredients_json: [] });
  const service = new RecommendationsService(repository({ profile: async () => stored,recipes: async () => recipes }),kitchenware);
  const transient = await service.compute(7,{ surface: "meal_plan" },{ avoid_spicy: true });
  assert.deepEqual(transient.results.map(item => item.recipeId),[2]);
  assert.equal(stored.kitchen_constraints_json.avoid_spicy,false);
  assert.equal((await service.compute(7,{ surface: "meal_plan" })).results.length,4);
  stored.kitchen_constraints_json.avoid_spicy = true;
  assert.deepEqual((await service.compute(7,{ surface: "meal_plan" })).results.map(item => item.recipeId),[2]);
  assert.equal((await service.compute(7,{ surface: "meal_plan" },{ avoid_spicy: false })).results.length,4);
  assert.equal(stored.kitchen_constraints_json.avoid_spicy,true);
});

test("selection evidence is taken from the saved candidate and cannot be forged in client metadata", async () => {
  let stored: Record<string, unknown> | undefined;
  let candidates: unknown = [{ recipeId: 1, features: { inventoryEvidence: { version: 1, scope: "personal", allocations: [{ itemId: 12, itemVersion: 3, amount: 1, unit: "piece" }] } } }];
  const service = new RecommendationsService(repository({
    findEvent: async () => null, recipeAvailable: async () => true,
    requestEvidence: async () => ({ scoring_version: "v1", results_json: candidates }),
    createEvent: async (_id, _userId, input) => { stored = input; return { id: "event", repeated: false }; },
  }), kitchenware);
  const input = { requestId: "request", recipeId: 1, eventType: "view", scoringVersion: "v1", surface: "inventory", idempotencyKey: "evidence-key", metadata: { selectionEvidence: { forged: true } } };
  await service.event(7, input);
  assert.deepEqual(stored?.metadata, { selectionEvidence: { version: 1, requestId: "request", recipeId: 1,
    inventory: { version: 1, scope: "personal", allocations: [{ itemId: 12, itemVersion: 3, amount: 1, unit: "piece" }] } } });
  candidates = JSON.stringify([{ recipeId: 1, features: {} }]);
  await service.event(7, input);
  assert.equal(((stored?.metadata as Record<string, unknown>).selectionEvidence as Record<string, unknown>).inventory, null, "historical missing evidence stays unknown");
  await service.event(7, { ...input, requestId: undefined });
  assert.deepEqual(stored?.metadata, {}, "standalone events cannot invent request provenance");
  await assert.rejects(service.event(7, { ...input, recipeId: 2 }), (error: unknown) => error instanceof RecommendationsError && error.code === "RECOMMENDATION_RECIPE_MISMATCH");
});

test("feedback keys cannot be reused for another recipe or for a different concurrent winner", async () => {
  const input = { recipeId: 1, eventType: "view", scoringVersion: "v1", surface: "inventory", idempotencyKey: "identity-key" };
  const winner = { id: "winner", request_id: null, recipe_id: 2, event_type: "view", scoring_version: "v1", surface: "inventory" };
  for (const race of [false, true]) {
    let reads = 0;
    const service = new RecommendationsService(repository({
      findEvent: async () => race && reads++ === 0 ? null : winner,
      recipeAvailable: async () => true,
      createEvent: async () => ({ id: "winner", repeated: true }),
    }), kitchenware);
    await assert.rejects(service.event(7, input), (error: unknown) => error instanceof RecommendationsError && error.code === "RECOMMENDATION_EVENT_CONFLICT");
  }
});

test("intervention snapshots use local-day stock and preserve engine hard-constraint filtering", async () => {
  const dates: string[] = [];
  const stock = [{ id: 11,food_name: "番茄",expiration_date: "2026-09-12",quantity_value: 5,quantity_unit: "piece",version: 1 }];
  const recipe = { id: 1,title: "番茄汤",ingredients_json: [{ name: "番茄",amount: "1个" }],steps_json: ["煮熟"],status: "approved",cook_time: 10,prep_time: 5,serving_size: 1 };
  const service = new RecommendationsService(repository({ inventory: async () => stock,recipes: async () => [recipe],
    planningState: async (_user,start,end) => { dates.push(start,end);return { items: [],plans: [],shopping: [] }; },
    dietTotals: async (_user,date) => { dates.push(date);return { calories: 0,protein: 0 }; },
  }),kitchenware);
  const snapshot = await service.interventionSnapshot(7,Date.parse("2026-09-13T00:30:00Z"),"America/Los_Angeles");
  assert.deepEqual(snapshot.dates,["2026-09-12","2026-09-13"]);
  assert.deepEqual(dates.sort(),["2026-09-12","2026-09-12","2026-09-13"]);
  assert.equal(snapshot.inventory[0].userId,7);
  assert.deepEqual(snapshot.recommendations,[], "whole preparation, cleanup and device time are still unverified");
  const sameDay = await service.compute(7,{ surface: "inventory",mealType: "dinner" },{},snapshot.dates[0]);
  assert.deepEqual(sameDay.results[0].features.inventoryEvidence.allocations.map(item => item.itemId),[11]);
  const nextDay = await service.compute(7,{ surface: "inventory",mealType: "dinner" },{},snapshot.dates[1]);
  assert.deepEqual(nextDay.results[0].features.inventoryEvidence.allocations,[]);
  const blocked = new RecommendationsService(repository({ inventory: async () => stock,recipes: async () => [recipe],
    profile: async () => ({ allergies_json: [{ name: "番茄" }] }),planningState: async () => ({ items: [],plans: [],shopping: [] }),
  }),kitchenware);
  assert.deepEqual((await blocked.interventionSnapshot(7,Date.parse("2026-09-13T00:30:00Z"),"America/Los_Angeles")).recommendations,[]);
  assert.equal((await blocked.compute(7,{ surface: "inventory" },{},snapshot.dates[0])).results.length,0);
});

test("single-session recommendations use only unallocated portions across all active plans", async () => {
  const batch = { id: "52a6a5f0-4fa8-45a2-812f-8dbb1461d194", version: 1, food_name: "昨天的饭", remaining_servings: 2,
    produced_servings: 2, produced_at: "2030-09-08T12:00:00Z", nutrition_per_serving_json: {} };
  let plans: Array<Record<string, unknown>> = [];
  const service = new RecommendationsService(repository({ preparedMeals: async () => [batch], planningState: async () => ({ items: [], shopping: [], plans }) }), kitchenware);
  const request = { meals: [{ id: "dinner", date: "2030-09-09", mealType: "dinner" as const, servings: 1 }], excludedPreparedMealIds: [] };
  const initial = await service.cookingPlan(7, request);
  const draft = { ...initial, productionDate: "2030-09-08", meals: initial.meals.map(meal => ({ ...meal, date: "2030-09-08" })) };
  plans = [{ constraints_json: JSON.stringify({ savedCookingDraft: { draft } }) }];
  const partial = await service.planRequirements(7, { ...request, meals: [{ ...request.meals[0], servings: 2 }] });
  assert.equal(partial.meals[0].preparedServings, 1);
  assert.equal(partial.meals[0].cookServings, 1);
  plans.push({ constraints_json: { currentCookingDraft: initial } });
  assert.equal((await service.planRequirements(7, request)).meals[0].preparedServings, 0);
  plans = [];
  assert.equal((await service.planRequirements(7, request)).meals[0].preparedServings, 1);
  assert.equal(batch.remaining_servings, 2, "recommendation must not consume the batch");
});


test("plans use current reviewed handling for future meals, replacement and independent weekly cooking", async () => {
  const { executionFixture } = await import("./helpers/recipeExecution.js");
  const { executionRecipeKey } = await import("../src/modules/recipes/execution.js");
  const source = { sourceUrl: "https://example.invalid/handling-fixture", reference: "合成存放审核回归依据", instructions: "合成测试专用，不作为真实食物的存放食用依据" };
  const rows = [1, 2].map(id => {
    const row = { id, title: `存放测试菜${id}`, serving_size: 2, cook_time: 10, prep_time: 5,
      ingredients_json: [{ name: "番茄", amount: "2个" }], steps_json: ["准备", "烹饪", "收尾"], required_kitchenware_json: [], optional_kitchenware_json: [] };
    return { ...row, execution_json: { recipeKey: executionRecipeKey(row), reviewedBy: 1, reviewedAt: "2026-10-01T00:00:00Z",
      profile: { ...executionFixture, handling: { ...source, storage: id === 1 ? "fresh_only" as const : "refrigerated" as const,
        maxHoldHours: id === 1 ? 0 : 72, coldServingAllowed: true, carryAllowed: false } } } };
  });
  const service = new RecommendationsService(repository({ recipes: async () => rows,
    profile: async () => ({ kitchen_constraints_json: { refrigeration_available: true } }),
    kitchenware: async () => [{ id: 1, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } }],
    inventory: async () => [{ id: 1, food_name: "番茄", quantity_value: 100, quantity_unit: "piece", expiration_date: "2099-12-31", version: 1 }],
  }), kitchenware);
  const input = { productionDate: "2099-01-01", excludedPreparedMealIds: [], meals: [{ id: "lunch", date: "2099-01-02", mealType: "lunch" as const, servings: 2 }] };
  const draft = await service.cookingPlan(7, input);
  assert.equal(draft.cooking[0].recipeId, 2); assert.equal(draft.handlingChecks?.[0].status, "conditions_match");
  assert.equal(draft.productionDate, input.productionDate);
  await assert.rejects(service.replaceCookingItem(7, { draft, targetMealId: "lunch", recipeId: 1 }), /没有符合/);
  const noFridge = await service.cookingPlan(7, { ...input, preferences: { refrigeration_available: false } });
  assert.equal(noFridge.cooking.length, 0); assert.equal(noFridge.unresolved.length, 1);
  rows[1].execution_json.profile.handling.coldServingAllowed = false;
  const hot = await service.cookingPlan(7, { ...input, preferences: { reheating_available: true } });
  assert.equal(hot.time.incomplete, true); assert(hot.time.reheatingSessions?.[0].schedule.missing.includes("future_reheating_schedule"));
  const noHeat = await service.cookingPlan(7, { ...input, preferences: { reheating_available: false } });
  assert.equal(noHeat.cooking.length, 0);
  const carry = await service.cookingPlan(7, { ...input, preferences: { carry_meals: true } });
  assert.equal(carry.cooking.length, 0);
  assert.equal((await service.compute(7, { surface: "home" }, { carry_meals: true })).results.length, 0);
  const week = await service.weeklyPlan(7, { startDate: "2099-01-01", mealTypes: ["dinner"], servings: 2 });
  assert.equal(week.draft?.productionDate, undefined); assert.equal(week.draft?.cooking.length, 7);
  assert(week.draft?.handlingChecks?.every(check => check.status === "conditions_match"));
  const handlingBefore = rows.map(row => structuredClone(row.execution_json.profile.handling));
  rows.forEach(row => { row.execution_json.profile.handling.storage = "refrigerated"; row.execution_json.profile.handling.maxHoldHours = 72;
    row.execution_json.profile.handling.carryAllowed = true; row.execution_json.profile.handling.coldServingAllowed = false; });
  const carryCandidates = (await service.compute(7, { surface: "home" }, { carry_meals: true, reheating_available: true })).results;
  assert.equal(carryCandidates.length, 2); assert(carryCandidates.every(candidate => candidate.hardConstraints.pending.includes("time") && !candidate.hardConstraints.satisfied.includes("time")));
  const { interventionRecommendations } = await import("../src/modules/interventions/snapshot.js");
  assert.equal(interventionRecommendations(carryCandidates).length, 0, "unverified reheating cannot authorize an automatic dinner intervention");
  const sameDayCarry = await service.cookingPlan(7, { ...input, productionDate: "2099-01-02", preferences: { carry_meals: true, reheating_available: true } });
  assert.equal(sameDayCarry.time.incomplete, true); assert(sameDayCarry.time.reheatingSessions?.[0].schedule.missing.includes("future_reheating_schedule"));
  const carryReplacement = await service.replaceCookingItem(7, { draft: sameDayCarry, targetMealId: "lunch", recipeId: sameDayCarry.cooking[0].recipeId === 1 ? 2 : 1 });
  assert.equal(carryReplacement.draft.time.incomplete, true); assert(carryReplacement.draft.time.reheatingSessions?.[0].schedule.missing.includes("future_reheating_schedule"));
  const carryWeekly = await service.replaceCookingItem(7, { draft: { ...sameDayCarry, productionDate: undefined, planningMode: "weekly", shoppingWindow: { startDate: "2099-01-02", endDate: "2099-01-08" }, time: { ...sameDayCarry.time, schedule: undefined, sessions: [{ targetMealId: "lunch", schedule: sameDayCarry.time.schedule! }] } },
    targetMealId: "lunch", recipeId: sameDayCarry.cooking[0].recipeId === 1 ? 2 : 1 });
  assert.equal(carryWeekly.draft.time.incomplete, true); assert(carryWeekly.draft.time.reheatingSessions?.[0].schedule.missing.includes("future_reheating_schedule"));
  const freshHome = await service.cookingPlan(7, { ...input, productionDate: "2099-01-02", preferences: { carry_meals: false } });
  assert.equal(freshHome.time.incomplete, false, "fresh home cooking does not invent a separate reheating session");
  rows.forEach(row => { row.execution_json.profile.handling.coldServingAllowed = true; });
  const coldCarry = await service.cookingPlan(7, { ...input, productionDate: "2099-01-02", preferences: { carry_meals: true, reheating_available: false } });
  assert.equal(coldCarry.time.incomplete, false, "reviewed cold serving does not require an invented reheating duration");
  rows.forEach((row, index) => { row.execution_json.profile.handling = handlingBefore[index]; });
  rows[1].ingredients_json[0].amount = "3个";
  const stale = await service.cookingPlan(7, input);
  assert.equal(stale.cooking[0].recipeId, 2); assert.equal(stale.handlingChecks?.[0].status, "pending", "content changes invalidate handling too");
});


test("reviewed ingredient variants consume their own quantities and never bypass current candidate constraints", async () => {
  const { executionFixture } = await import("./helpers/recipeExecution.js");
  const { executionRecipeKey } = await import("../src/modules/recipes/execution.js");
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const rows = [1, 2, 3].map(id => {
    const row = { id, title: `替代测试菜${id}`, serving_size: 2, cook_time: 10, prep_time: 5,
      ingredients_json: [{ name: "番茄", amount: "1个" }, ...(id === 3 ? [] : [{ name: id === 1 ? "鸡蛋" : "豆腐", amount: id === 1 ? "2个" : "200g" }])],
      steps_json: ["准备", "烹饪", "收尾"], required_kitchenware_json: [], optional_kitchenware_json: [] };
    return { ...row, execution_json: { recipeKey: executionRecipeKey(row), reviewedBy: 1, reviewedAt: "2026-10-01T00:00:00Z", profile: { ...executionFixture } } };
  });
  const rule = { recipeId: 2, recipeKey: executionRecipeKey(rows[1]), removedIngredient: "鸡蛋", replacementIngredient: "豆腐",
    sourceUrl: "https://example.invalid/substitution-fixture", reference: "合成替代审核依据，不用于实际食品" };
  rows[0].execution_json.profile.substitutions = [rule];
  let pool = rows;
  let eggs = 0, tofu = 200;
  let allergies: Array<{ name: string }> = [];
  const stock = () => [{ id: 1, food_name: "番茄", quantity_value: 2, quantity_unit: "piece", expiration_date: "2099-12-31", version: 1 },
    { id: 2, food_name: "豆腐", quantity_value: tofu, quantity_unit: "g", expiration_date: "2099-12-31", version: 1 },
    { id: 3, food_name: "鸡蛋", quantity_value: eggs, quantity_unit: "piece", expiration_date: "2099-12-31", version: 1 }];
  const service = new RecommendationsService(repository({ recipes: async () => pool, inventory: async () => stock(),
    profile: async () => ({ allergies_json: allergies }), favoriteRecipeIds: async () => [3],
    kitchenware: async () => [{ id: 1, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } }],
  }), kitchenware);
  const input = { excludedPreparedMealIds: [], meals: [{ id: "dinner", date: "2099-01-01", mealType: "dinner" as const, servings: 2 }] };
  const draft = await service.cookingPlan(7, input);
  assert.equal(draft.cooking[0].recipeId, 2, "reviewed stocked variant takes priority over another fully stocked recipe");
  assert.deepEqual(draft.cooking[0].substitution?.removedIngredient, "鸡蛋");
  assert(draft.ingredientBudget.every(item => item.fully_covered)); assert(!draft.ingredientBudget.some(item => item.food_name === "鸡蛋"));
  assert.equal(draft.time.schedule?.elapsedMinutes, 17);
  assert.equal(cookingPlanDraftSchema.safeParse({ ...draft, cooking: [{ ...draft.cooking[0], substitution: { ...draft.cooking[0].substitution!, recipeId: 3 } }] }).success, false);
  const two = await service.cookingPlan(7, { ...input, meals: [...input.meals, { ...input.meals[0], id: "another" }] });
  assert.equal(two.cooking.filter(item => item.substitution).length, 1, "the same tofu cannot satisfy both meals");
  assert(two.ingredientBudget.every(item => item.fully_covered));
  pool = rows.slice(0, 2); eggs = 2; tofu = 0;
  const original = await service.cookingPlan(7, input); assert.equal(original.cooking[0].recipeId, 1);
  eggs = 0; tofu = 200;
  const replacement = await service.replaceCookingItem(7, { draft: original, targetMealId: "dinner", recipeId: 2 });
  assert(replacement.draft.cooking[0].substitution); assert(replacement.draft.ingredientBudget.every(item => item.fully_covered));
  allergies = [{ name: "豆腐" }];
  await assert.rejects(service.replaceCookingItem(7, { draft: original, targetMealId: "dinner", recipeId: 2 }), /没有符合/);
  allergies = [];
  rows[1].ingredients_json[1].amount = "300g";
  assert.equal((await service.cookingPlan(7, input)).cooking.some(item => item.substitution), false, "changing target quantities invalidates the link");
});

test("reviewed heating participates in full-plan choices, replacement and per-meal weekly budgets", async () => {
  const { executionFixture } = await import("./helpers/recipeExecution.js");
  const { executionRecipeKey } = await import("../src/modules/recipes/execution.js");
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const rows = [1, 2].map(id => {
    const row = { id, title: `合成复热菜${id}`, serving_size: 2, cook_time: 10, prep_time: 5,
      ingredients_json: [{ name: id === 1 ? "足量原料" : "缺货原料", amount: "2个" }], steps_json: ["准备", "烹饪", "收尾"], required_kitchenware_json: [], optional_kitchenware_json: [] };
    return { ...row, execution_json: { recipeKey: executionRecipeKey(row), reviewedBy: 1, reviewedAt: "2026-10-01T00:00:00Z", profile: { ...executionFixture,
      handling: { storage: "refrigerated" as const, maxHoldHours: 72, coldServingAllowed: false, carryAllowed: true, sourceUrl: "https://example.invalid/handling", reference: "合成存放回归专用来源", instructions: "合成测试专用，实际冷链与温度须独立核对" },
      reheating: { ...executionFixture, sourceUrl: "https://example.invalid/reheating", instructions: "合成测试专用，加热完成后还须核对实际温度",
        tasks: executionFixture.tasks.map(task => ({ ...task, minutes: task.phase === "cooking" ? id === 1 ? 35 : 5 : 1 })) } } } };
  });
  const devices = [{ id: 7, catalog_id: 1, name: "合成设备", attributes_json: { capacityMl: 1000 } }];
  const stock = [{ id: 1, food_name: "足量原料", quantity_value: 100, quantity_unit: "piece", expiration_date: "2099-12-31", version: 1 }];
  const service = new RecommendationsService(repository({ recipes: async () => rows, kitchenware: async () => devices, inventory: async () => stock,
    profile: async () => ({ kitchen_constraints_json: { carry_meals: true, refrigeration_available: true, servings: 2 } }) }), kitchenware);
  const draft = await service.cookingPlan(7, { productionDate: "2099-01-01", reheatingDeviceIds: [7], excludedPreparedMealIds: [],
    preferences: { refrigeration_available: true, meal_time_minutes: 30 }, meals: [{ id: "lunch", date: "2099-01-02", mealType: "lunch", servings: 2 }] });
  assert.equal(draft.cooking[0].recipeId, 2, "feasible reheating is considered before ingredient shortages");
  assert.equal(draft.time.schedule?.elapsedMinutes, 17); assert.equal(draft.time.reheatingSessions?.[0].schedule.elapsedMinutes, 7); assert.equal(draft.time.incomplete, false);
  const replacement = await service.replaceCookingItem(7, { draft, targetMealId: "lunch", recipeId: 1 });
  assert.equal(replacement.draft.time.exceedsBudget, true); assert(replacement.conflicts.some(reason => reason.includes("复热超过")));
  const removed = { ...draft, time: { ...draft.time, reheating: [], reheatingSessions: [] } };
  assert.equal(cookingPlanDraftSchema.safeParse(removed).success, false, "a complete future-meal time cannot omit heating requirements");
  const weekly = await service.weeklyPlan(7, { startDate: "2099-01-01", mealTypes: ["lunch"], servings: 2, reheatingDeviceIds: [7] });
  assert.equal(weekly.draft?.time.reheatingSessions?.length, 7); assert.equal(weekly.draft?.time.incomplete, false);
  assert(weekly.draft?.cooking.every(item => item.recipeId === 2));
  const weekReplacement = await service.replaceCookingItem(7, { draft: weekly.draft!, targetMealId: weekly.draft!.meals[0].id, recipeId: 1 });
  assert.equal(weekReplacement.draft.time.exceedsBudget, true); assert(weekReplacement.conflicts.some(reason => reason.includes("复热超过")));
  rows[0].execution_json.profile.reheating.tasks[1].minutes = 5;
  rows[1].execution_json.profile.reheating.tasks[1].minutes = 35;
  const changed = await service.replaceCookingItem(7, { draft, targetMealId: "lunch", recipeId: 1 });
  assert.equal(changed.draft.time.reheatingSessions?.[0].schedule.elapsedMinutes, 7, "replacement rereads current reviewed bounds");
});

test("recommendation recipe summaries preserve unknown nutrients and real zero", async () => {
  const values = [
    { id: 11, nutrition_basis: "unknown", calories: 0, protein: 0, carbs: 0, fat: 0 },
    { id: 12, nutrition_basis: "source", calories: null, protein: null, carbs: null, fat: null },
    { id: 13, nutrition_basis: "source", calories: 0, protein: 0, carbs: 0, fat: 0 },
  ];
  const service = new RecommendationsService(repository({ recipes: async () => values.map(value => ({
    ...value, title: "合成营养回归", ingredients_json: [{ name: "水", amount: "100ml" }], steps_json: ["仅用于测试"],
  })) }), kitchenware);
  const page = await service.page(7, { surface: "home", matchStatus: "all", pageSize: 10 });
  for (const id of [11, 12, 13]) {
    const recipe = page.items.find(item => item.recipeId === id)!.recipe as Record<string, unknown>;
    for (const key of ["calories", "protein", "carbs", "fat"]) assert.equal(recipe[key], id === 13 ? 0 : null);
    assert.equal(recipe.nutrition_is_estimated, false);
  }
});

test("learned taste preferences dynamically update candidate scoring, preserve non-dislike skips and honor user corrections", async () => {
  const baseRecipe = {
    id: 1, title: "排骨汤", status: "approved", ingredients_json: [{ name: "排骨", amount: "500g" }], steps_json: ["煮熟"],
    serving_size: 2, cook_time: 20, prep_time: 10,
  };
  const recentIso = new Date(Date.now() - 3600000).toISOString();
  const skipEvent = (id: string, reason = "dislike", scope = "long_term") => ({
    id, recipe_id: 1, event_type: "skip", metadata_json: { reason, scope }, idempotency_key: id, created_at: recentIso,
  });

  // 1. Without learning data: normal baseline score, no skip reasons
  let learningDataState: any = { settings: null, events: [], recipes: [baseRecipe] };
  const service = new RecommendationsService(repository({
    recipes: async () => [baseRecipe],
    learningData: async () => learningDataState,
  }), kitchenware);

  const baseline = await service.compute(7, { surface: "meal_plan" });
  assert.equal(baseline.results.length, 1);
  const baseScore = baseline.results[0].score;
  assert.equal(baseline.results[0].reasons.some(r => r.includes("不喜欢")), false);

  // 2. Three long-term dislike skip events: score drops by 8 (skipPenalty), reason is present, recipe NOT excluded
  learningDataState = {
    settings: { enabled: true, overrides_json: {} },
    events: [skipEvent("a"), skipEvent("b"), skipEvent("c")],
    recipes: [baseRecipe],
  };
  const withInferredDislike = await service.compute(7, { surface: "meal_plan" });
  assert.equal(withInferredDislike.results.length, 1);
  assert.equal(withInferredDislike.results[0].score, Math.round((baseScore - 8) * 100) / 100);
  assert(withInferredDislike.results[0].reasons.some(r => r.includes("近30天多次明确表示长期不喜欢，暂时降低排序；不会排除菜谱")));

  // 3. User corrects preference to neutral: penalty is cleared immediately and reason is removed
  learningDataState = {
    settings: { enabled: true, overrides_json: { 1: { value: "neutral", updatedAt: "2026-09-12T11:00:00Z" } } },
    events: [skipEvent("a"), skipEvent("b"), skipEvent("c")],
    recipes: [baseRecipe],
  };
  const withNeutralCorrection = await service.compute(7, { surface: "meal_plan" });
  assert.equal(withNeutralCorrection.results.length, 1);
  assert.equal(withNeutralCorrection.results[0].score, baseScore);
  assert.equal(withNeutralCorrection.results[0].reasons.some(r => r.includes("不喜欢")), false);

  // 4. User explicitly dislikes recipe: score drops by 8 (skipPenalty), explicit reason present
  learningDataState = {
    settings: { enabled: true, overrides_json: { 1: { value: "dislike", updatedAt: "2026-09-12T11:00:00Z" } } },
    events: [],
    recipes: [baseRecipe],
  };
  const withExplicitDislike = await service.compute(7, { surface: "meal_plan" });
  assert.equal(withExplicitDislike.results.length, 1);
  assert.equal(withExplicitDislike.results[0].score, Math.round((baseScore - 8) * 100) / 100);
  assert(withExplicitDislike.results[0].reasons.some(r => r.includes("按你明确设置的不喜欢降低排序")));

  // 5. When learning is paused (enabled: false): inferred dislike is not applied
  learningDataState = {
    settings: { enabled: false, overrides_json: {} },
    events: [skipEvent("a"), skipEvent("b"), skipEvent("c")],
    recipes: [baseRecipe],
  };
  const withPausedLearning = await service.compute(7, { surface: "meal_plan" });
  assert.equal(withPausedLearning.results[0].score, baseScore);
  assert.equal(withPausedLearning.results[0].reasons.some(r => r.includes("不喜欢")), false);

  // 6. Temporary skips (no_time / too_much) never penalize taste
  for (const reason of ["no_time", "too_much"]) {
    learningDataState = {
      settings: { enabled: true, overrides_json: {} },
      events: [skipEvent("a", reason, "session"), skipEvent("b", reason, "session"), skipEvent("c", reason, "session")],
      recipes: [baseRecipe],
    };
    const withTempSkip = await service.compute(7, { surface: "meal_plan" });
    assert.equal(withTempSkip.results[0].score, baseScore);
    assert.equal(withTempSkip.results[0].reasons.some(r => r.includes("不喜欢")), false);
  }
});
