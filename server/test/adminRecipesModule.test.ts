import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminRecipesRepository } from "../src/modules/adminRecipes/repository.js";
import { adminRecipeUpdateSchema } from "../src/modules/adminRecipes/schema.js";
import { AdminRecipesService } from "../src/modules/adminRecipes/service.js";
import type { AdminRecipeWrite } from "../src/modules/adminRecipes/types.js";

function repository(overrides: Partial<AdminRecipesRepository> = {}): AdminRecipesRepository {
  return {
    list: async () => ({ rows: [], summary: { total: 0, platform: 0, user: 0, pending: 0, needs_review: 0 } }),
    duplicateSources: async () => [], create: async () => 1, update: async () => false, find: async () => null,
    replaceKitchenware: async () => false, scanDuplicates: async () => undefined,
    coverage: async () => ({ byCategory: [], byDifficulty: [], byTime: [], sources: [], qualityFailures: [], duplicates: [], baselines: [] }),
    approve: async () => false, reviewQuality: async () => false, reviewExecution: async () => false, reject: async () => false, remove: async () => false,
    ...overrides,
  };
}

describe("admin recipes module", () => {
  test("admin update validation preserves omission and permits explicit nullable metadata", () => {
    assert.deepEqual(adminRecipeUpdateSchema.parse({ title: "只改标题" }), { title: "只改标题" });
    const cleared = { source_url: null, source_revision: null, source_attribution: null, prep_time: null };
    assert.deepEqual(adminRecipeUpdateSchema.parse(cleared), cleared);
    assert.equal(adminRecipeUpdateSchema.safeParse({ serving_size: null }).success, false);
    assert.equal(adminRecipeUpdateSchema.safeParse({ unknown: "field" }).success, false);
  });
  test("maps catalog and review requirements before one atomic repository create", async () => {
    let captured: AdminRecipeWrite | undefined;
    const service = new AdminRecipesService(repository({
      duplicateSources: async () => [{ id: 9, title: "空气炸锅番茄", ingredients_json: [{ name: "番茄" }], steps_json: ["切块", "烤熟"] }],
      create: async (input) => { captured = input; return 42; },
    }), { resolveCatalog: async (name) => name === "空气炸锅" ? { id: 3, confidence: 1, capabilities: [{ code: "dry_heat" }] } : { id: 3,confidence: 0.72,capabilities: [{ code: "dry_heat" }] } });
    const result = await service.create(7, {
      title: "空气炸锅番茄", description: "", cook_time: 15, difficulty: "简单", calories: 100,
      protein: 3, carbs: 12, fat: 2, category: "晚餐", tags: ["快手"], steps: ["切块", "烤熟"],
      ingredients: [{ name: "番茄" }], required_kitchenware: ["空气炸锅", "未知锅"], serving_size: 2,
    }, { adminUserId: 7, ipAddress: "127.0.0.1" });
    assert.deepEqual(result, { success: true, id: 42 });
    assert.equal(captured?.sourceContentHash?.length, 64);
    assert.equal(captured?.prepTime, null);
    assert.deepEqual(captured?.requirements.map((item) => [item.rawName, item.catalogId, item.capabilityCode]), [
      ["空气炸锅", 3, "dry_heat"], ["未知锅", null, null],
    ]);
    assert.deepEqual(captured?.duplicates.map((item) => item.candidateRecipeId), [9]);
  });

  test("retains legacy creation defaults independently of stricter update validation", async () => {
    let captured: AdminRecipeWrite | undefined;
    const service = new AdminRecipesService(repository({ create: async input => { captured = input; return 1; } }), { resolveCatalog: async () => null });
    await service.create(1, { title: "创建兼容", cook_time: 10, ingredients: [{ name: "米" }], steps: ["清洗", "煮熟"],
      serving_size: 0, data_license: "", source_revision: "", source_attribution: "", source_url: "ftp://example.org/source" }, { adminUserId: 1 });
    assert.equal(captured?.servingSize, 2);
    assert.equal(captured?.dataLicense, "DietDigiDose-Original");
    assert.equal(captured?.sourceRevision, "manual-v1");
    assert.equal(captured?.sourceAttribution, "DietDigiDose 编辑团队");
    assert.equal(captured?.sourceUrl, "ftp://example.org/source");
    assert.equal(captured?.calories, 0);
  });

  test("reports existing publication blockers without granting approval or nutrition trust", async () => {
    const row = { id: 1, title: "缺少来源证据", status: "pending", quality_status: "needs_review", nutrition_basis: "unknown",
      data_license: null, serving_size: null, cook_time: 10, ingredients_json: '[{"name":"米"}]', steps_json: '["清洗","煮熟"]',
      required_kitchenware_json: '["汤锅"]' };
    const service = new AdminRecipesService(repository({ list: async () => ({ rows: [row], summary: { total: 1, platform: 1, user: 0, pending: 1, needs_review: 1 } }) }), { resolveCatalog: async () => null });
    const result = await service.list({});
    assert(Array.isArray(result));
    assert.deepEqual(result[0].diagnostics.publicationIssues, ["missing_license", "missing_serving_size"]);
    assert.equal(result[0].status, "pending");
    assert.equal(result[0].nutrition_basis, "unknown");
    assert.equal(result[0].quality_status, "needs_review");
  });

  test("keeps cursor and publication errors independent of the database driver", async () => {
    const service = new AdminRecipesService(repository(), { resolveCatalog: async () => null });
    await assert.rejects(() => service.list({ cursor: "invalid" }), /分页游标无效/);
    await assert.rejects(() => service.create(1, {
      title: "缺少步骤", ingredients: [{ name: "番茄" }], steps: [], cook_time: 10,
    }, { adminUserId: 1 }), /食谱发布质量校验未通过/);
    await assert.rejects(() => service.remove(1, 999, { adminUserId: 1 }), /食谱未找到/);
  });
});
