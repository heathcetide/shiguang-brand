import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MealPlansRepository } from "../../src/modules/mealPlans/repository.js";
import type { RecipeExecutionProfile } from "@dietdigidose/contracts";
import type { AdminRecipesService } from "../../src/modules/adminRecipes/service.js";
import type { RecipesService } from "../../src/modules/recipes/service.js";
import type { RecommendationsService } from "../../src/modules/recommendations/service.js";
import type { KitchenwareService } from "../../src/modules/kitchenware/service.js";
import { mealTime } from "../../src/modules/recommendations/plan.js";
import { reviewedExecution } from "../../src/modules/recipes/execution.js";

export const executionFixture: RecipeExecutionProfile = { version: 1, maxBatchServings: 2,
  reference: "合成固定时长回归依据，不代表真实菜谱验收", tools: [
    { key: "pot", name: "测试锅", catalogId: 1, capacity: { kind: "volume", mlPerServing: 500 } },
  ], tasks: [
    { id: "prepare", title: "准备", phase: "preparation", minutes: 5, active: true, dependsOn: [], tools: [] },
    { id: "cook", title: "烹饪", phase: "cooking", minutes: 10, active: false, dependsOn: ["prepare"], tools: ["pot"] },
    { id: "clean", title: "收尾", phase: "cleanup", minutes: 2, active: true, dependsOn: ["cook"], tools: ["pot"] },
  ] };

type Query = (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
export async function verifyRecipeExecution(admin: AdminRecipesService, recipes: RecipesService,
  recommendations: RecommendationsService, kitchenware: KitchenwareService, adminId: number, query: Query, mealPlans: MealPlansRepository) {
  const userId = Number((await query("INSERT INTO users(username,email) VALUES('execution-fixture','execution-fixture@example.invalid') RETURNING id"))[0].id);
  const catalog = await kitchenware.resolveCatalog("平底锅"); assert(catalog && catalog.confidence === 1);
  const device = await kitchenware.create(userId, { name: "平底锅", attributes: { capacityMl: 1000 } });
  const body = { title: "合成排程回归菜谱", ingredients: [{ name: "排程回归原料", amount: "2个" }],
    steps: ["准备", "煮熟", "收尾"], cook_time: 10, prep_time: 5, serving_size: 2, required_kitchenware: ["平底锅"] };
  const context = { adminUserId: adminId };
  const recipeId = (await admin.create(adminId, body, context)).id;
  const profile = { ...executionFixture, handling: { storage: "refrigerated" as const, maxHoldHours: 72, coldServingAllowed: true, carryAllowed: false,
    sourceUrl: "https://example.invalid/handling-fixture", reference: "合成存放审核回归依据", instructions: "合成测试专用，不作为实际菜谱存放和食用依据" }, tools: [{ ...executionFixture.tools[0], name: "平底锅", catalogId: catalog.id }] };
  const keys = await admin.execution(recipeId); assert.equal(keys.execution, null);
  const input = { recipeKey: keys.recipeKey, reviewKey: keys.reviewKey, profile };
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { ...input, profile: { ...profile, tools: [] } }, context));
  const concurrent = await Promise.allSettled([admin.reviewExecution(adminId, recipeId, input, context), admin.reviewExecution(adminId, recipeId, input, context)]);
  assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(item => item.status === "rejected").length, 1);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, input, context), /改变/);
  const stored = (await query("SELECT * FROM recipes WHERE id=?", [recipeId]))[0];
  assert.equal(reviewedExecution(stored)?.reviewedBy, adminId);
  const detail = await recipes.detail(recipeId, { protocol: "http", host: "localhost" });
  assert.deepEqual(detail.execution_profile, profile); assert.equal("execution_json" in detail, false);
  assert.equal("reviewedBy" in (detail.execution_evidence as Record<string, unknown>), false);
  const computed = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert.equal(computed.results.length, 1); assert(computed.results[0].hardConstraints.satisfied.includes("time"));
  assert.equal(computed.results[0].features.cookingSchedule.elapsedMinutes, 17);
  await query("UPDATE kitchenware_catalog SET quality_status='needs_review' WHERE id=?", [catalog.id]);
  const revokedCatalog = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert(revokedCatalog.results.length === 0 || revokedCatalog.results[0].hardConstraints.pending.includes("time"));
  const catalogKeys = await admin.execution(recipeId);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { recipeKey: catalogKeys.recipeKey, reviewKey: catalogKeys.reviewKey, profile }, context), /已审核/);
  await query("UPDATE kitchenware_catalog SET quality_status='trusted' WHERE id=?", [catalog.id]);
  assert.equal((await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 16 })).results.length, 0);
  const draft = await recommendations.cookingPlan(userId, { excludedPreparedMealIds: [], preferences: { meal_time_minutes: 30 },
    meals: [{ id: "execution-dinner", date: "2099-01-01", mealType: "dinner", servings: 3 }] });
  // Other catalogue candidates exist; directly price this reviewed candidate for the requested portions too.
  assert(draft.time.schedule);
  const split = mealTime([{ targetMealId: "dinner", recipeId, title: body.title, servings: 3, recipeYield: 2,
    demands: [{ food_name: "排程回归原料", amount_value: 3, unit: "piece" }] }], computed.results,
  [{ id: device.id, catalog_id: catalog.id, name: "平底锅", attributes_json: { capacityMl: 750 } }], 30, { productionDate: "2099-01-01", effectivePreferences: {}, meals: [{ id: "dinner", date: "2099-01-01", mealType: "dinner", servings: 3, preparedServings: 0, cookServings: 3, allocations: [] }] });
  assert(split.schedule);
  assert.equal(split.schedule.elapsedMinutes, 34); assert.equal(split.exceedsBudget, true);
  await kitchenware.update(userId, Number(device.id), { name: "平底锅", attributes: { capacityMl: null } });
  const unknown = await recommendations.compute(userId, { surface: "meal_plan", search: body.title, maxCookTime: 20 });
  assert(unknown.results[0].hardConstraints.pending.includes("time")); assert.equal(unknown.results[0].features.cookingSchedule.elapsedMinutes, null);
  const beforeEdit = await admin.execution(recipeId);
  await admin.update(adminId, recipeId, { ...body, ingredients: [{ name: "排程回归原料", amount: "3个" }] }, context);
  assert.equal((await admin.execution(recipeId)).execution, null);
  assert.equal((await recipes.detail(recipeId, { protocol: "http", host: "localhost" })).execution_profile, null);
  await assert.rejects(admin.reviewExecution(adminId, recipeId, { recipeKey: beforeEdit.recipeKey, reviewKey: beforeEdit.reviewKey, profile }, context), /改变/);
  const fresh = await admin.execution(recipeId);
  await admin.reviewExecution(adminId, recipeId, { recipeKey: fresh.recipeKey, reviewKey: fresh.reviewKey, profile }, context);
  const reviewed = await admin.execution(recipeId);
  await admin.reviewExecution(adminId, recipeId, { recipeKey: reviewed.recipeKey, reviewKey: reviewed.reviewKey, profile: null }, context);
  assert.equal((await query("SELECT execution_json FROM recipes WHERE id=?", [recipeId]))[0].execution_json, null);
  assert.equal(Number((await query("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE action='recipe.execution_review' AND resource_id=?", [String(recipeId)]))[0].n), 3);
  await kitchenware.update(userId, Number(device.id), { name: "平底锅", attributes: { capacityMl: 1000 } });
  const sourceBody = { ...body, title: "合成替代原菜", ingredients: [{ name: "替代原料甲", amount: "2个" }, { name: "替代共用料", amount: "1个" }] };
  const targetBody = { ...sourceBody, title: "合成替代变体", ingredients: [{ name: "替代原料乙", amount: "200g" }, { name: "替代共用料", amount: "1个" }], steps: ["变体准备", "变体烹饪", "收尾"] };
  const sourceId = (await admin.create(adminId, sourceBody, context)).id;
  const targetId = (await admin.create(adminId, targetBody, context)).id;
  const targetKeys = await admin.execution(targetId);
  await admin.reviewExecution(adminId, targetId, { recipeKey: targetKeys.recipeKey, reviewKey: targetKeys.reviewKey, profile }, context);
  const sourceKeys = await admin.execution(sourceId);
  const substitutions = [{ recipeId: targetId, recipeKey: targetKeys.recipeKey, removedIngredient: "替代原料甲", replacementIngredient: "替代原料乙",
    sourceUrl: "https://example.invalid/substitution-fixture", reference: "合成替代审核回归，不作为真实食品依据" }];
  await assert.rejects(admin.reviewExecution(adminId, sourceId, { recipeKey: sourceKeys.recipeKey, reviewKey: sourceKeys.reviewKey,
    profile: { ...profile, substitutions: [{ ...substitutions[0], recipeKey: "0".repeat(64) }] } }, context), /替代菜谱/);
  await admin.reviewExecution(adminId, sourceId, { recipeKey: sourceKeys.recipeKey, reviewKey: sourceKeys.reviewKey, profile: { ...profile, substitutions } }, context);
  for (const [name, quantity, unit] of [["替代原料乙", 200, "g"], ["替代共用料", 1, "piece"]] as const) await query(
    "INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,?,'其他',?,?,?,'2099-12-31')", [userId, name, `${quantity}${unit}`, quantity, unit]);
  const substitutionDraft = await recommendations.cookingPlan(userId, { excludedPreparedMealIds: [], meals: [{ id: "substitution-dinner", date: "2099-01-01", mealType: "dinner", servings: 2 }] });
  assert.equal(substitutionDraft.cooking[0].recipeId, targetId); assert.equal(substitutionDraft.cooking[0].substitution?.sourceRecipeId, sourceId);
  assert(substitutionDraft.ingredientBudget.every(item => item.fully_covered)); assert(!substitutionDraft.ingredientBudget.some(item => item.food_name === "替代原料甲"));
  const id = randomUUID();
  assert(await mealPlans.saveDraft(userId, { id, title: "合成替代草案", draft: substitutionDraft }));
  const forgedId = randomUUID();
  const forged = { ...substitutionDraft, cooking: substitutionDraft.cooking.map(item => ({ ...item, demands: item.demands.map(demand => ({ ...demand, amount_value: demand.amount_value * 2 })) })) };
  assert(await mealPlans.saveDraft(userId, { id: forgedId, title: "合成错误用量", draft: forged }));
  assert.equal((await mealPlans.activateDraft(userId, forgedId, 1)).kind, "recipe_not_available");
  assert.equal(Number((await query("SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id=?", [forgedId]))[0].n), 0);
  const plain = { ...substitutionDraft, cooking: substitutionDraft.cooking.map(({ substitution: _substitution, ...item }) => item) };
  const original = plain.cooking[0];
  const invalidDemands = [
    { ...original, demands: original.demands.map(item => ({ ...item, amount_value: item.amount_value * 2 })) },
    { ...original, recipeYield: original.recipeYield * 2 },
    { ...original, demands: original.demands.slice(1) },
    { ...original, demands: [...original.demands, original.demands[0]] },
    { ...original, demands: original.demands.map(item => ({ ...item, food_name: "伪造原料" })) },
    { ...original, demands: original.demands.map(item => ({ ...item, unit: "ml" as const })) },
  ];
  for (const cooking of invalidDemands) {
    const rejectedId = randomUUID();
    await mealPlans.saveDraft(userId, { id: rejectedId, title: "无替代字段的伪造用量", draft: { ...plain, cooking: [cooking] } });
    assert.equal((await mealPlans.activateDraft(userId, rejectedId, 1)).kind, "recipe_not_available");
    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM meal_plan_items WHERE plan_id=?", [rejectedId]))[0].n), 0);
    const rejected = await mealPlans.find(userId, rejectedId, false);
    assert.equal(rejected?.status, "draft"); assert.equal(rejected?.version, 1);
  }
  const plainId = randomUUID();
  await mealPlans.saveDraft(userId, { id: plainId, title: "完整用量的独立菜谱", draft: plain });
  await query("UPDATE recipes SET quality_status='needs_review' WHERE id=?", [targetId]);
  assert.equal((await mealPlans.activateDraft(userId, plainId, 1)).kind, "recipe_not_available");
  await query("UPDATE recipes SET quality_status='trusted',ingredients_json=? WHERE id=?", [JSON.stringify([{ name: "替代原料乙", amount: "300g" }, { name: "替代共用料", amount: "1个" }]), targetId]);
  assert.equal((await mealPlans.activateDraft(userId, plainId, 1)).kind, "recipe_not_available", "current recipe changes invalidate captured quantities");
  await query("UPDATE recipes SET ingredients_json=? WHERE id=?", [JSON.stringify([{ name: "替代原料乙", amount: "200g" }, { name: "替代共用料", amount: "1个" }]), targetId]);
  assert.equal((await mealPlans.activateDraft(userId, plainId, 1)).kind, "updated", "a fully specified ordinary recipe remains executable without substitution metadata");
  await query("UPDATE recipes SET quality_status='needs_review' WHERE id=?", [targetId]);
  assert.equal((await mealPlans.activateDraft(userId, id, 1)).kind, "recipe_not_available");
  await query("UPDATE recipes SET quality_status='trusted' WHERE id=?", [targetId]);
  const activation = await mealPlans.activateDraft(userId, id, 1); assert.equal(activation.kind, "updated");
  assert.equal((await mealPlans.activateDraft(userId, id, 1)).kind, "updated");
  const activated = (await query("SELECT recipe_id,ingredients_json FROM meal_plan_items WHERE plan_id=?", [id]))[0];
  assert.equal(Number(activated.recipe_id), targetId);
  const captured = typeof activated.ingredients_json === "string" ? JSON.parse(activated.ingredients_json) : activated.ingredients_json;
  assert(captured.some((item: { name: string; amount: string }) => item.name === "替代原料乙" && item.amount === "200g"));
  const revokedId = randomUUID();
  assert(await mealPlans.saveDraft(userId, { id: revokedId, title: "合成撤审草案", draft: substitutionDraft }));
  const executionItem = (await query("SELECT id,version FROM meal_plan_items WHERE plan_id=?", [id]))[0];
  const variantQueueKey = randomUUID();
  assert.equal((await mealPlans.enqueue(userId, id, String(executionItem.id), { version: Number(executionItem.version), idempotencyKey: variantQueueKey })).kind, "completed");
  const currentSource = await admin.execution(sourceId);
  await admin.reviewExecution(adminId, sourceId, { recipeKey: currentSource.recipeKey, reviewKey: currentSource.reviewKey, profile: null }, context);
  assert.equal((await mealPlans.activateDraft(userId, revokedId, 1)).kind, "recipe_not_available");
  await assert.rejects(mealPlans.enqueue(userId, id, String(executionItem.id), { version: 2, idempotencyKey: randomUUID() }), { code: "MEAL_RECIPE_CHANGED" });
  await assert.rejects(mealPlans.complete(userId, id, String(executionItem.id), { version: 2, idempotencyKey: randomUUID() }), { code: "MEAL_RECIPE_CHANGED" });
  assert.equal((await mealPlans.enqueue(userId, id, String(executionItem.id), { version: Number(executionItem.version), idempotencyKey: variantQueueKey })).kind, "completed", "successful queue receipt replay is preserved");
  assert.equal(Number((await query("SELECT version FROM meal_plan_items WHERE id=?", [String(executionItem.id)]))[0].version), 2);


  // Round-trip a separate heating graph through both real database repositories.
  const reheatKeys = await admin.execution(targetId);
  const reheating = { ...executionFixture, tools: profile.tools, reference: "合成复热专用审核依据", sourceUrl: "https://example.invalid/reheating-fixture",
    instructions: "合成回归测试专用；真实食物温度和冷链必须另行实测核对",
    tasks: profile.tasks.map(task => ({ ...task, minutes: task.phase === "preparation" ? 2 : task.phase === "cooking" ? 5 : 1 })) };
  await admin.reviewExecution(adminId, targetId, { recipeKey: reheatKeys.recipeKey, reviewKey: reheatKeys.reviewKey,
    profile: { ...profile, handling: { ...profile.handling, coldServingAllowed: false, carryAllowed: true }, reheating } }, context);
  assert.deepEqual((await admin.execution(targetId)).execution?.profile.reheating, reheating);
  const preparedId = randomUUID();
  await query("INSERT INTO prepared_meals(id,user_id,idempotency_key,recipe_id,food_name,produced_servings,remaining_servings,storage_location,produced_at) VALUES(?,?,?,?,?,2,2,'冷藏','2099-01-01T00:00:00Z')",
    [preparedId, userId, randomUUID(), targetId, "合成复热待吃餐"]);
  const heatRequest = { productionDate: "2099-01-01", excludedPreparedMealIds: [], preferences: { meal_time_minutes: 20, carry_meals: true, refrigeration_available: true },
    meals: [{ id: "heating-lunch", date: "2099-01-02", mealType: "lunch" as const, servings: 2 }] };
  const noLocation = await recommendations.cookingPlan(userId, heatRequest);
  assert.equal(noLocation.meals[0].preparedServings, 2); assert.equal(noLocation.time.incomplete, true);
  const heated = await recommendations.cookingPlan(userId, { ...heatRequest, reheatingDeviceIds: [Number(device.id)] });
  assert.equal(heated.time.schedule?.elapsedMinutes, 0); assert.equal(heated.time.reheatingSessions?.[0].schedule.elapsedMinutes, 8);
  assert.equal(heated.time.incomplete, false); assert.equal(heated.time.reheating?.[0].preparedMealId, preparedId);
  assert(heated.handlingChecks?.some(check => check.status === "pending"), "a time bound does not certify real food or cold-chain conditions");
  const heatReview = await admin.execution(targetId);
  await admin.reviewExecution(adminId, targetId, { recipeKey: heatReview.recipeKey, reviewKey: heatReview.reviewKey, profile: null }, context);
  const withdrawn = await recommendations.cookingPlan(userId, { ...heatRequest, reheatingDeviceIds: [Number(device.id)] });
  assert.equal(withdrawn.time.incomplete, true); assert.equal(withdrawn.time.reheating?.[0].mode, "unknown");

}
