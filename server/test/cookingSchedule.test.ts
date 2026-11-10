import assert from "node:assert/strict";
import { test } from "node:test";
import { cookingScheduleSchema, recipeExecutionProfileSchema, recipeHandlingSchema } from "@dietdigidose/contracts";
import { QuantityDecimal } from "@dietdigidose/contracts/quantity-decimal";
import { scheduleCooking } from "../src/modules/recommendations/schedule.js";

import { executionFixture as profile } from "./helpers/recipeExecution.js";
const recipe = { title: "测试菜", cook_time: 10, prep_time: 5, serving_size: 2, execution_profile: profile };
const entry = { targetMealId: "dinner", recipeId: 1, servings: 2, recipe };
const device = { id: 7, catalog_id: 1, name: "测试锅", attributes_json: { capacityMl: 1000 } };

test("dependencies, cleanup and device capacity determine actual batch time", () => {
  const single = cookingScheduleSchema.parse(scheduleCooking([entry], [device]));
  assert.equal(single.elapsedMinutes, 17);
  assert.equal(single.tasks[2].phase, "cleanup");
  const small = cookingScheduleSchema.parse(scheduleCooking([{ ...entry, servings: 3 }], [{ ...device, attributes_json: JSON.stringify({ capacityMl: 750 }) }]));
  assert.deepEqual(small.batches.map(batch => batch.servings), [1.5, 1.5]);
  assert.equal(small.elapsedMinutes, 34);
  assert.equal(small.tasks[3].startMinute, 17, "next batch waits for device cleanup");
  for (const attributes_json of [null, "{", {}]) {
    const unknown = scheduleCooking([entry], [{ ...device, attributes_json }]);
    assert.equal(unknown.complete, false); assert.equal(unknown.elapsedMinutes, null);
    assert(unknown.missing[0].startsWith("device_or_capacity:"));
  }
});

test("different devices overlap passive cooking while one person's work never overlaps", () => {
  const other = { ...entry, targetMealId: "other", recipeId: 2, recipe: { ...recipe,
    execution_profile: { ...profile, tools: [{ ...profile.tools[0], catalogId: 2 }] } } };
  const parallel = cookingScheduleSchema.parse(scheduleCooking([entry, other], [device, { ...device, id: 8, catalog_id: 2 }]));
  assert.equal(parallel.sequentialMinutes, 34);
  assert.equal(parallel.elapsedMinutes, 22);
  const shared = cookingScheduleSchema.parse(scheduleCooking([entry, { ...entry, targetMealId: "other" }], [device]));
  assert.equal(shared.elapsedMinutes, 34);
  const active = { ...recipe, execution_profile: { ...profile, tasks: profile.tasks.map(task => ({ ...task, active: true })) } };
  assert.equal(cookingScheduleSchema.parse(scheduleCooking([{ ...entry, recipe: active }, other], [device, { ...device, id: 8, catalog_id: 2 }])).elapsedMinutes, 24);
});

test("unreviewed durations and excessive batch counts cannot manufacture a feasible time", () => {
  const missing = scheduleCooking([{ ...entry, recipe: { ...recipe, execution_profile: null, prep_time: null } }], [device]);
  assert.equal(missing.elapsedMinutes, null); assert.equal(missing.sequentialMinutes, 10);
  const tiny = scheduleCooking([entry], [{ ...device, attributes_json: { capacityMl: 0.001 } }]);
  assert.equal(tiny.complete, false); assert.equal(tiny.tasks.length, 0); assert(tiny.conflicts.length);
});

test("review and saved-schedule validation reject cycles, omitted cleanup and double booking", () => {
  assert.equal(recipeExecutionProfileSchema.safeParse(profile).success, true);
  for (const tasks of [profile.tasks.slice(0, 2), profile.tasks.map(task => task.id === "prepare" ? { ...task, dependsOn: ["clean"] } : task),
    profile.tasks.map(task => task.id === "cook" ? { ...task, tools: ["unlisted"] } : task)]) {
    assert.equal(recipeExecutionProfileSchema.safeParse({ ...profile, tasks }).success, false);
  }
  const schedule = scheduleCooking([entry], [device]);
  assert.equal(cookingScheduleSchema.safeParse({ ...schedule, elapsedMinutes: 15, tasks: schedule.tasks.slice(0, 2) }).success, false);
  schedule.tasks[2].startMinute = 5; schedule.tasks[2].endMinute = 7;
  assert.equal(cookingScheduleSchema.safeParse(schedule).success, false);
});


test("reviewed handling excludes known conflicts and preserves uncertainty about actual food", async () => {
  const { evaluateHandling, preparedHandlingChecks } = await import("../src/modules/recommendations/handling.js");
  const cold = recipeHandlingSchema.parse({ storage: "refrigerated", maxHoldHours: 72, coldServingAllowed: true, carryAllowed: false,
    sourceUrl: "https://example.invalid/reviewed-fixture", reference: "合成测试来源，不用于真实食物", instructions: "合成测试专用，实际存放和冷链条件必须另行核对" });
  const context = { targetMealId: "lunch", recipeId: 1, productionDate: "2099-01-01", targetDate: "2099-01-02", preferences: { refrigeration_available: true } };
  assert.equal(evaluateHandling(cold, context).status, "conditions_match");
  assert.equal(evaluateHandling(undefined, context).status, "pending");
  assert.equal(evaluateHandling(cold, { ...context, preferences: {} }).status, "pending");
  for (const rule of [{ ...cold, maxHoldHours: 24 }, { ...cold, storage: "fresh_only" as const, maxHoldHours: 0 }]) assert.equal(evaluateHandling(rule, context).status, "conflict");
  assert.equal(evaluateHandling(cold, { ...context, preferences: { refrigeration_available: false } }).status, "conflict");
  assert.equal(evaluateHandling(cold, { ...context, preferences: { refrigeration_available: true, carry_meals: true } }).status, "conflict");
  assert.equal(evaluateHandling({ ...cold, coldServingAllowed: false }, { ...context, preferences: { refrigeration_available: true, reheating_available: false } }).status, "conflict");
  assert.equal(evaluateHandling({ ...cold, coldServingAllowed: false }, { ...context, preferences: { refrigeration_available: true, reheating_available: true } }).status, "pending");
  const preparedMealId = "00000000-0000-4000-8000-000000000001";
  assert.equal(evaluateHandling(cold, { ...context, preparedMealId, storageLocation: "冷藏" }).status, "pending");
  assert.equal(evaluateHandling(cold, { ...context, preparedMealId, storageLocation: "常温" }).status, "conflict");
  for (const rule of [{ ...cold, maxHoldHours: 97 }, { ...cold, sourceUrl: "http://example.invalid" }, { ...cold, reference: "" }]) assert.equal(recipeHandlingSchema.safeParse(rule).success, false);
  const draft = { meals: [{ id: "lunch", date: "2099-01-02", allocations: [{ preparedMealId, version: 1, servings: 1 }] }], effectivePreferences: context.preferences } as Parameters<typeof preparedHandlingChecks>[0];
  assert.equal(preparedHandlingChecks(draft, [], new Map([[1, cold]]))[0].status, "conflict", "client evidence cannot replace the actual record");
});

test("audited reheating has independent bounds and cannot omit equipment, checks or cleanup", async () => {
  const { recipeReheatingSchema } = await import("@dietdigidose/contracts");
  const graph = reheatingFixture();
  assert.equal(recipeReheatingSchema.safeParse(graph).success, true);
  for (const value of [{ ...graph, tools: [] }, { ...graph, sourceUrl: "http://example.invalid" }, { ...graph, instructions: "" },
    { ...graph, tasks: graph.tasks.slice(0, 2) }, { ...graph, tasks: graph.tasks.map(task => task.phase === "cooking" ? { ...task, minutes: 0 } : task) },
    { ...graph, tasks: graph.tasks.map(task => task.id === "prepare" ? { ...task, dependsOn: ["clean"] } : task) }]) {
    assert.equal(recipeReheatingSchema.safeParse(value).success, false);
  }
});

function reheatingFixture() {
  return { ...profile, sourceUrl: "https://example.invalid/reheating-fixture", instructions: "合成回归专用；实际温度和冷链须按独立审核条件检查",
    tasks: profile.tasks.map(task => ({ ...task, title: task.phase === "cooking" ? "复热并检查" : task.title, minutes: task.phase === "preparation" ? 2 : task.phase === "cooking" ? 5 : 1 })) };
}

test("future or carried meals use a separate reheating session and explicit eating-location devices", async () => {
  const { mealTime } = await import("../src/modules/recommendations/plan.js");
  const reviewed = { ...recipe, execution_profile: { ...profile, reheating: reheatingFixture() } };
  const candidates = [{ recipeId: 1, recipe: reviewed }] as Parameters<typeof mealTime>[1];
  const cooking = [{ targetMealId: "lunch", recipeId: 1, title: "测试菜", servings: 2, recipeYield: 2, demands: [{ food_name: "番茄", amount_value: 2, unit: "piece" as const }] }];
  const meal = { id: "lunch", date: "2099-01-02", mealType: "lunch" as const, servings: 2, preparedServings: 0, cookServings: 2, allocations: [] };
  const context = { meals: [meal], productionDate: "2099-01-01", effectivePreferences: {} };
  const future = mealTime(cooking, candidates, [device], 20, context);
  assert.equal(future.schedule?.elapsedMinutes, 17); assert.equal(future.reheatingSessions?.[0].schedule.elapsedMinutes, 8);
  assert.equal(future.incomplete, false); assert.equal(future.exceedsBudget, false);
  const carry = { ...context, meals: [{ ...meal, date: context.productionDate }], effectivePreferences: { carry_meals: true } };
  const unknown = mealTime(cooking, candidates, [device], 20, carry);
  assert.equal(unknown.schedule?.elapsedMinutes, 17); assert.equal(unknown.incomplete, true);
  assert(unknown.reheatingSessions?.[0].schedule.missing.includes("reheating_location_devices"));
  for (const ids of [[], [999]]) assert.equal(mealTime(cooking, candidates, [device], 20, { ...carry, reheatingDeviceIds: ids }).incomplete, true);
  assert.equal(mealTime(cooking, candidates, [device], 20, { ...carry, reheatingDeviceIds: [7] }).incomplete, false);
  const noHeat = mealTime(cooking, candidates, [device], 20, { ...context, effectivePreferences: { reheating_available: false } });
  assert.equal(noHeat.reheating?.[0].mode, "unknown"); assert.equal(noHeat.incomplete, true);
  const split = mealTime(cooking, candidates, [{ ...device, attributes_json: { capacityMl: 500 } }], 20, context);
  assert.equal(split.reheatingSessions?.[0].schedule.elapsedMinutes, 16); assert.equal(split.exceedsBudget, true, "production is also split by its actual device capacity");
  const long = [{ recipeId: 1, recipe: { ...reviewed, execution_profile: { ...reviewed.execution_profile,
    reheating: { ...reheatingFixture(), tasks: reheatingFixture().tasks.map(task => ({ ...task, minutes: task.phase === "cooking" ? 25 : task.minutes })) } } } }] as Parameters<typeof mealTime>[1];
  const over = mealTime(cooking, long, [device], 20, context);
  assert.equal(over.schedule?.elapsedMinutes, 17); assert.equal(over.reheatingSessions?.[0].schedule.elapsedMinutes, 28); assert.equal(over.exceedsBudget, true);
});

test("prepared reheating rereads actual recipe and version and shares same-day human and equipment capacity", async () => {
  const { mealTime } = await import("../src/modules/recommendations/plan.js");
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const id = "00000000-0000-4000-8000-000000000001";
  const batch = { id, recipe_id: 1, food_name: "测试待吃餐", version: 1, produced_servings: 2, remaining_servings: 2, is_reserved: false, nutrition_per_serving: {}, planned_date: null,
    meal_type: "", storage_location: "冷藏", produced_at: "2099-01-01T00:00:00Z", queue_item_id: null, plan_item_id: null };
  const review = { recipeKey: "a".repeat(64), reviewedBy: 1, reviewedAt: "2026-10-01T00:00:00Z", profile: { ...profile, reheating: reheatingFixture() } };
  const data = { prepared: [batch], profiles: new Map([[1, review]]) };
  const meal = { id: "dinner", date: "2099-01-01", mealType: "dinner" as const, servings: 4, preparedServings: 2, cookServings: 2,
    allocations: [{ preparedMealId: id, version: 1, foodName: batch.food_name, servings: 2, validationRequired: true as const }] };
  const context = { meals: [meal], productionDate: meal.date, effectivePreferences: {} };
  const candidates = [{ recipeId: 1, recipe }] as Parameters<typeof mealTime>[1];
  const cooking = [{ targetMealId: "dinner", recipeId: 1, title: recipe.title, servings: 2, recipeYield: 2, demands: [{ food_name: "番茄", amount_value: 2, unit: "piece" as const }] }];
  const time = mealTime(cooking, candidates, [device], 30, context, data);
  assert.equal(time.schedule?.elapsedMinutes, 25); assert.equal(time.incomplete, false);
  assert.equal(time.schedule?.batches.filter(batch => batch.kind === "reheating").length, 1);
  cookingScheduleSchema.parse(time.schedule);
  const draft = { ...context, status: "requires_validation" as const, totalCookServings: 2, cooking, unresolved: [], ingredientBudget: [], time, checksPending: [], excludedPreparedMealIds: [] };
  assert.equal(cookingPlanDraftSchema.safeParse(draft).success, true);
  for (const altered of [ { ...time, reheating: [] }, { ...time, reheating: time.reheating!.map(item => ({ ...item, servings: 1 })) },
    { ...time, reheating: time.reheating!.map(item => ({ ...item, targetMealId: "unknown" })) } ]) assert.equal(cookingPlanDraftSchema.safeParse({ ...draft, time: altered }).success, false);
  for (const actual of [{ prepared: [], profiles: data.profiles }, { prepared: [{ ...batch, version: 2 }], profiles: data.profiles }, { prepared: [batch], profiles: new Map() }]) {
    const pending = mealTime(cooking, candidates, [device], 30, context, actual);
    assert.equal(pending.incomplete, true); assert.equal(pending.reheating?.[0].mode, "unknown");
  }
  const cold = { ...review, profile: { ...profile, handling: { storage: "refrigerated" as const, maxHoldHours: 72, coldServingAllowed: true, carryAllowed: true,
    sourceUrl: "https://example.invalid/cold", reference: "合成冷食测试来源", instructions: "合成回归专用，实际冷链必须另行核对" } } };
  const coldTime = mealTime(cooking, candidates, [device], 30, context, { prepared: [batch], profiles: new Map([[1, cold]]) });
  assert.equal(coldTime.schedule?.elapsedMinutes, 17); assert.equal(coldTime.reheating?.[0].mode, "cold"); assert.equal(coldTime.incomplete, false);
  const { buildWeeklyPlan } = await import("../src/modules/recommendations/weeklyPlan.js");
  const handling = { ...cold.profile.handling, coldServingAllowed: false };
  const long = { ...review, profile: { ...review.profile, handling, reheating: { ...reheatingFixture(),
    tasks: reheatingFixture().tasks.map(task => ({ ...task, minutes: task.phase === "cooking" ? 35 : task.minutes })) } } };
  const weekly = buildWeeklyPlan({ startDate: meal.date, mealTypes: ["dinner"], servings: 2 }, { refrigeration_available: true, meal_time_minutes: 30 }, [], [], [batch], [], [], [], [device], new Map([[1, handling]]), new Map([[1, long]]));
  assert.equal(weekly.slots[0].state, "unresolved", "over-budget prepared heating must not become a feasible weekly allocation");
  assert.equal(weekly.draft?.meals[0].allocations.length, 0); assert.equal(weekly.draft?.meals[0].cookServings, 2);
  cookingPlanDraftSchema.parse(weekly.draft);
});


const fractionalProfile = { ...profile, tasks: profile.tasks.map(task => ({ ...task, minutes: 1 })) };
function fractionalSchedule(servings: number, capacity: number, tasks = fractionalProfile.tasks) {
  return scheduleCooking([{ ...entry, servings, recipe: { ...recipe, execution_profile: { ...fractionalProfile, tasks } } }],
    [{ ...device, attributes_json: { capacityMl: capacity * 500 } }]);
}

test("fractional batches preserve exact servings without phantom batches or rounded-away tails", () => {
  for (const [servings, capacity, expected] of [
    [30, 0.6, Array(50).fill(0.6)], [4.2, 0.6, Array(7).fill(0.6)], [2.1, 0.3, Array(7).fill(0.3)], [0.07, 0.01, Array(7).fill(0.01)],
    [4.3, 0.6, [...Array(7).fill(0.6), 0.1]], [4.200001, 0.6, [...Array(7).fill(0.6), 0.000001]],
    [4.200000000000001, 0.6, [...Array(7).fill(0.6), 1e-15]], [0.5999999, 0.6, [0.599999, 0.0000009]],
  ] as Array<[number, number, number[]]>) {
    const schedule = cookingScheduleSchema.parse(fractionalSchedule(servings, capacity));
    assert.equal(schedule.complete, true);
    assert.deepEqual(schedule.batches.map(batch => batch.servings), expected);
    assert(schedule.batches.every(batch => batch.servings > 0 && batch.servings <= capacity));
    assert.equal(schedule.batches.reduce((sum, batch) => sum.add(QuantityDecimal.from(batch.servings)), QuantityDecimal.from(0))
      .compare(QuantityDecimal.from(servings)), 0);
    assert.equal(schedule.elapsedMinutes, expected.length * 3);
    assert.equal(schedule.sequentialMinutes, expected.length * 3);
  }
});

test("exact batching respects both global ceilings without partial batches", () => {
  const atLimit = cookingScheduleSchema.parse(fractionalSchedule(0.001, 0.000002));
  assert.equal(atLimit.complete, true); assert.equal(atLimit.batches.length, 500);
  for (const servings of [0.001001, 30]) {
    const over = cookingScheduleSchema.parse(fractionalSchedule(servings, 0.000002));
    assert.equal(over.complete, false); assert.equal(over.batches.length, 0); assert.equal(over.tasks.length, 0);
  }
  const tasks = Array.from({ length: 20 }, (_, index) => ({ ...fractionalProfile.tasks[index === 0 ? 0 : index === 19 ? 2 : 1],
    id: `task${index}`, dependsOn: index ? [`task${index - 1}`] : [] }));
  const full = fractionalSchedule(0.001, 0.000004, tasks);
  assert.equal(full.complete, true); assert.equal(full.tasks.length, 5000);
  const overflow = scheduleCooking([
    { ...entry, servings: 0.001, recipe: { ...recipe, execution_profile: { ...fractionalProfile, tasks } } }, { ...entry, servings: 0.000004 },
  ], [{ ...device, attributes_json: { capacityMl: 0.002 } }]);
  assert.equal(overflow.complete, false); assert.equal(overflow.batches.length, 250); assert.equal(overflow.tasks.length, 5000);
});

test("fractional cooking survives meal-time and cooking-draft contract validation", async () => {
  const { mealTime } = await import("../src/modules/recommendations/plan.js");
  const { cookingPlanDraftSchema } = await import("@dietdigidose/contracts");
  const servings = 4.2;
  const cooking = [{ targetMealId: "dinner", recipeId: 1, title: recipe.title, servings, recipeYield: 2,
    demands: [{ food_name: "番茄", amount_value: servings, unit: "piece" as const }] }];
  const context = { productionDate: "2099-01-01", effectivePreferences: {}, meals: [{ id: "dinner", date: "2099-01-01",
    mealType: "dinner" as const, servings, preparedServings: 0, cookServings: servings, allocations: [] }] };
  const candidates = [{ recipeId: 1, recipe: { ...recipe, execution_profile: fractionalProfile } }] as Parameters<typeof mealTime>[1];
  const time = mealTime(cooking, candidates, [{ ...device, attributes_json: { capacityMl: 300 } }], 21, context);
  assert.equal(time.schedule?.elapsedMinutes, 21); assert.equal(time.incomplete, false); assert.equal(time.exceedsBudget, false);
  cookingPlanDraftSchema.parse({ ...context, status: "requires_validation", totalCookServings: servings, cooking,
    unresolved: [], ingredientBudget: [], time, checksPending: [], excludedPreparedMealIds: [] });
});
