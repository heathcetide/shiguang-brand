import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { Pool } from "pg";
import type { AdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/repository.js";
import { AdminFoodAssetsService } from "../src/modules/adminFoodAssets/service.js";
import { SqliteAdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/sqliteRepository.js";
import { PostgresAdminFoodAssetsRepository } from "../src/modules/adminFoodAssets/postgresRepository.js";
import { adminIngredientSchema, adminIngredientUpdateSchema } from "../src/validation/schemas.js";
import { validateIngredientQuality } from "../src/utils/ingredientQuality.js";

function repository(overrides: Partial<AdminFoodAssetsRepository> = {}): AdminFoodAssetsRepository {
  return {
    listIngredients: async () => ({ items: [], total: 0 }), createIngredient: async () => 1,
    updateIngredient: async () => false, removeIngredient: async () => false,
    addAlias: async () => ({ kind: "missing" }), mergeIngredient: async () => ({ kind: "missing" }),
    coverage: async () => ({ categories: [], gaps: [], anomalies: [] }), pendingCustomFoods: async () => [],
    approveCustomFood: async () => ({ kind: "missing" }), rejectCustomFood: async () => ({ kind: "missing" }),
    ...overrides,
  };
}

describe("admin food assets module", () => {
  test("preserves legacy JSON strings while normalizing pagination", async () => {
    const service = new AdminFoodAssetsService(repository({
      listIngredients: async () => ({ items: [{ id: 2, aliases_json: ["西红柿"], micronutrients_json: { iron: 1 } }], total: 1 }),
    }));
    const result = await service.ingredients({ page: -3, pageSize: 500 });
    assert.equal(result.page, 1); assert.equal(result.pageSize, 100);
    assert.equal(result.items[0]?.aliases_json, '["西红柿"]');
    assert.equal(result.items[0]?.micronutrients_json, '{"iron":1}');
  });

  test("enforces quality and maps repository misses without a database driver", async () => {
    const service = new AdminFoodAssetsService(repository());
    await assert.rejects(() => service.createIngredient({
      name: "异常食材", calories_100g: 1001, protein_100g: 0, carbs_100g: 0, fat_100g: 0,
      source: "official", source_version: "v1", data_license: "test", aliases: [],
    }, { adminUserId: 1 }), /质量校验未通过/);
    await assert.rejects(() => service.removeIngredient(99, { adminUserId: 1 }), /食材未找到/);
    await assert.rejects(() => service.mergeIngredient(1, { targetId: 1 }, { adminUserId: 1 }), /目标食材无效/);
    await assert.rejects(() => service.approveCustomFood(99, { adminUserId: 1 }), /记录未找到/);
  });

  test("admin validation distinguishes unknown, measured zero and invalid nutrition", () => {
    const missing = adminIngredientSchema.parse({ name: "未知食材" });
    assert.equal(missing.calories_100g, null);
    assert.equal(missing.protein_100g, null);
    assert.equal(missing.carbs_100g, null);
    assert.equal(missing.fat_100g, null);
    assert.equal(adminIngredientSchema.parse({ name: "零值", calories_100g: 0 }).calories_100g, 0);
    for (const value of [-1, 1001, "", "0", Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(adminIngredientSchema.safeParse({ name: "非法值", calories_100g: value }).success, false);
    }
    assert.ok(validateIngredientQuality({ calories100g: null, protein100g: Number.NaN,
      source: "official", sourceVersion: "v1", dataLicense: "test" }).includes("invalid_macronutrient"));
    const update = adminIngredientUpdateSchema.parse({ name: "修改名称", calories_100g: null });
    for (const key of ["source", "aliases", "search_keywords", "preparation_state", "source_version", "data_license", "edible_ratio"]) {
      assert.equal(key in update, false, `${key} must not receive a default during editing`);
    }
    assert.equal(update.calories_100g, null);
    for (const key of ["protein_100g", "carbs_100g", "fat_100g", "category"]) assert.equal(key in update, false);
    assert.equal("calories_100g" in adminIngredientUpdateSchema.parse({ name: "只改名称" }), false);
    assert.deepEqual(adminIngredientUpdateSchema.parse({ name: "清空别名", aliases: [] }).aliases, []);
  });

  test("SQLite preserves unknown nutrition and does not promote review status", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(nutritionTestSchema("sqlite"));
      await verifyNutritionWrites(new SqliteAdminFoodAssetsRepository(database), async (sql) => database.prepare(sql).get() as Record<string, unknown>,
        async (sql) => { database.exec(sql); });
    } finally { database.close(); }
  });

  test("PostgreSQL preserves unknown nutrition and does not promote review status", {
    skip: !process.env.ADMIN_FOOD_ASSETS_TEST_DATABASE_URL,
  }, async () => {
    const pool = new Pool({ connectionString: process.env.ADMIN_FOOD_ASSETS_TEST_DATABASE_URL, max: 1 });
    try {
      // Temporary tables are confined to this test connection, even when run in a shared test database.
      await pool.query(nutritionTestSchema("postgres"));
      await verifyNutritionWrites(new PostgresAdminFoodAssetsRepository(pool), async (sql) => (await pool.query(sql)).rows[0],
        async (sql) => { await pool.query(sql); });
    } finally { await pool.end(); }
  });
});

function nutritionTestSchema(driver: "sqlite" | "postgres") {
  const table = driver === "postgres" ? "CREATE TEMP TABLE" : "CREATE TABLE";
  return `${table} ingredients_library (
    id ${driver === "sqlite" ? "INTEGER PRIMARY KEY" : "INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY"},
    name TEXT, normalized_name TEXT, aliases_json ${driver === "sqlite" ? "TEXT" : "JSONB"}, search_keywords TEXT,
    preparation_state TEXT, calories_100g REAL, protein_100g REAL, carbs_100g REAL, fat_100g REAL,
    category TEXT, source TEXT, source_version TEXT, source_updated_at TIMESTAMP, data_license TEXT,
    edible_ratio REAL, nutrition_status TEXT, quality_status TEXT, deleted_at TIMESTAMP
  );
  ${table} ingredient_aliases (ingredient_id INTEGER, alias TEXT, normalized_alias TEXT, alias_type TEXT,
    UNIQUE(ingredient_id, normalized_alias));
  ${table} admin_audit_logs (admin_user_id INTEGER, action TEXT, resource_type TEXT, resource_id TEXT,
    summary TEXT, details_json ${driver === "sqlite" ? "TEXT" : "JSONB"}, ip_address TEXT, user_agent TEXT);`;
}

async function verifyNutritionWrites(repository: AdminFoodAssetsRepository,
  row: (sql: string) => Promise<Record<string, unknown>>, exec: (sql: string) => Promise<void>) {
  const service = new AdminFoodAssetsService(repository);
  const context = { adminUserId: 1 };
  const input = { name: "营养测试", calories_100g: 0, protein_100g: null, carbs_100g: 0 };
  const { id } = await service.createIngredient(adminIngredientSchema.parse(input), context);
  const nutrition = () => row(`SELECT calories_100g, protein_100g, carbs_100g, fat_100g, nutrition_status, quality_status
    FROM ingredients_library WHERE id=${id}`);
  assert.deepEqual(await nutrition(), { calories_100g: 0, protein_100g: null, carbs_100g: 0, fat_100g: null,
    nutrition_status: "incomplete", quality_status: "needs_review" });
  await service.updateIngredient(id, adminIngredientSchema.parse({ name: input.name }), context);
  assert.deepEqual(await nutrition(), { calories_100g: null, protein_100g: null, carbs_100g: null, fat_100g: null,
    nutrition_status: "unknown", quality_status: "needs_review" });
  const complete = adminIngredientSchema.parse({ ...input, protein_100g: 0, fat_100g: 0 });
  await service.updateIngredient(id, complete, context);
  assert.equal((await nutrition()).nutrition_status, "core_complete");
  assert.equal((await nutrition()).quality_status, "needs_review");
  await exec(`UPDATE ingredients_library SET quality_status='reference' WHERE id=${id}`);
  await service.updateIngredient(id, complete, context);
  assert.equal((await nutrition()).quality_status, "reference");
  await exec(`UPDATE ingredients_library SET quality_status='trusted' WHERE id=${id}`);
  await service.updateIngredient(id, adminIngredientSchema.parse({ ...complete, calories_100g: null }), context);
  assert.equal((await nutrition()).calories_100g, null);
  assert.equal((await nutrition()).quality_status, "needs_review");
  const verifiedZero = await service.createIngredient(complete, context);
  assert.deepEqual(await row(`SELECT calories_100g, protein_100g, carbs_100g, fat_100g, nutrition_status, quality_status
    FROM ingredients_library WHERE id=${verifiedZero.id}`), { calories_100g: 0, protein_100g: 0, carbs_100g: 0,
    fat_100g: 0, nutrition_status: "core_complete", quality_status: "trusted" });

  const imported = await service.createIngredient(adminIngredientSchema.parse({ ...complete, source: "taiwan_fda",
    aliases: ["来源别名"], search_keywords: "来源关键字", preparation_state: "raw",
    source_version: "TFDA-2026", data_license: "OGDL-1.0", edible_ratio: 0.5 }), context);
  await exec(`UPDATE ingredients_library SET source_updated_at='2020-01-01 00:00:00' WHERE id=${imported.id}`);
  const metadata = () => row(`SELECT source, aliases_json, search_keywords, preparation_state, source_version,
    data_license, edible_ratio, source_updated_at FROM ingredients_library WHERE id=${imported.id}`);
  const before = await metadata();
  await service.updateIngredient(imported.id, adminIngredientUpdateSchema.parse({ ...input, name: "更名营养测试", calories_100g: null }), context);
  assert.deepEqual(await metadata(), before);
  assert.equal((await row(`SELECT alias FROM ingredient_aliases WHERE ingredient_id=${imported.id} AND alias_type='canonical'`)).alias,
    "更名营养测试");
  assert.equal(Number((await row(`SELECT COUNT(*) AS count FROM ingredient_aliases WHERE ingredient_id=${imported.id}
    AND alias='来源别名'`)).count), 1);
  assert.equal((await row(`SELECT calories_100g FROM ingredients_library WHERE id=${imported.id}`)).calories_100g, null);
  await service.updateIngredient(imported.id, adminIngredientUpdateSchema.parse({ ...input, name: "来源别名" }), context);
  assert.equal((await row(`SELECT alias_type FROM ingredient_aliases WHERE ingredient_id=${imported.id} AND alias='来源别名'`)).alias_type,
    "synonym");
  assert.equal(Number((await row(`SELECT COUNT(*) AS count FROM ingredient_aliases WHERE ingredient_id=${imported.id}
    AND alias_type='canonical'`)).count), 0);
  await service.updateIngredient(imported.id, adminIngredientUpdateSchema.parse({ ...input, name: "无规范别名" }), context);
  assert.equal(Number((await row(`SELECT COUNT(*) AS count FROM ingredient_aliases WHERE ingredient_id=${imported.id}
    AND alias_type='canonical'`)).count), 1);
  assert.equal((await row(`SELECT alias FROM ingredient_aliases WHERE ingredient_id=${imported.id} AND alias_type='canonical'`)).alias,
    "无规范别名");
  assert.equal((await row(`SELECT alias_type FROM ingredient_aliases WHERE ingredient_id=${imported.id} AND alias='来源别名'`)).alias_type,
    "synonym");
  await service.updateIngredient(imported.id, adminIngredientUpdateSchema.parse({ ...input, aliases: [], search_keywords: "",
    source_version: "TFDA-2027" }), context);
  const after = await metadata();
  assert.deepEqual(typeof after.aliases_json === "string" ? JSON.parse(after.aliases_json) : after.aliases_json, []);
  assert.equal(after.search_keywords, "");
  assert.equal(after.source_version, "TFDA-2027");
  assert.equal(after.data_license, "OGDL-1.0");
  assert.equal(Number((await row(`SELECT COUNT(*) AS count FROM ingredient_aliases WHERE ingredient_id=${imported.id}
    AND alias_type <> 'canonical'`)).count), 0);

  const partial = await service.createIngredient(adminIngredientSchema.parse({ name: "部分更新", category: "蔬菜",
    calories_100g: 200, protein_100g: 20, carbs_100g: 20, fat_100g: 5, source: "taiwan_fda",
    source_version: "TFDA-2026", data_license: "OGDL-1.0" }), context);
  const partialNutrition = () => row(`SELECT category, calories_100g, protein_100g, carbs_100g, fat_100g,
    nutrition_status, quality_status FROM ingredients_library WHERE id=${partial.id}`);
  const originalNutrition = await partialNutrition();
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称" }), context);
  assert.deepEqual(await partialNutrition(), originalNutrition);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source_version: "TFDA-2027" }), context);
  assert.deepEqual(await partialNutrition(), originalNutrition);
  const auditCount = Number((await row("SELECT COUNT(*) AS count FROM admin_audit_logs")).count);
  await assert.rejects(() => service.updateIngredient(partial.id,
    adminIngredientUpdateSchema.parse({ name: "只改名称", protein_100g: 100 }), context), /质量校验未通过/);
  assert.deepEqual(await partialNutrition(), originalNutrition);
  assert.equal(Number((await row("SELECT COUNT(*) AS count FROM admin_audit_logs")).count), auditCount);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", calories_100g: null }), context);
  assert.deepEqual(await partialNutrition(), { ...originalNutrition, calories_100g: null,
    nutrition_status: "incomplete", quality_status: "needs_review" });
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", category: null }), context);
  assert.equal((await partialNutrition()).category, null);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", protein_100g: null,
    carbs_100g: null, fat_100g: null }), context);
  assert.deepEqual(await partialNutrition(), { category: null, calories_100g: null, protein_100g: null,
    carbs_100g: null, fat_100g: null, nutrition_status: "unknown", quality_status: "needs_review" });
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", calories_100g: 0,
    protein_100g: 0, carbs_100g: 0, fat_100g: 0 }), context);
  assert.deepEqual(await partialNutrition(), { category: null, calories_100g: 0, protein_100g: 0,
    carbs_100g: 0, fat_100g: 0, nutrition_status: "core_complete", quality_status: "needs_review" });

  const provenance = () => row(`SELECT source, source_version, data_license, source_updated_at
    FROM ingredients_library WHERE id=${partial.id}`);
  await exec(`UPDATE ingredients_library SET source_updated_at='2020-01-01 00:00:00' WHERE id=${partial.id}`);
  const originalProvenance = await provenance();
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source: "taiwan_fda" }), context);
  assert.deepEqual(await provenance(), originalProvenance);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称" }), context);
  assert.deepEqual(await provenance(), originalProvenance);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source: "usda" }), context);
  assert.deepEqual(await provenance(), { source: "usda", source_version: null, data_license: null, source_updated_at: null });
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称" }), context);
  assert.deepEqual(await provenance(), { source: "usda", source_version: null, data_license: null, source_updated_at: null });
  await exec(`UPDATE ingredients_library SET source_updated_at='2020-02-01 00:00:00' WHERE id=${partial.id}`);
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source: "open_food_facts",
    source_version: "OFF-2026", data_license: "ODbL-1.0" }), context);
  assert.deepEqual(await provenance(), { source: "open_food_facts", source_version: "OFF-2026", data_license: "ODbL-1.0", source_updated_at: null });
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source: "taiwan_fda",
    source_version: "TFDA-2028" }), context);
  assert.deepEqual(await provenance(), { source: "taiwan_fda", source_version: "TFDA-2028", data_license: null, source_updated_at: null });
  await service.updateIngredient(partial.id, adminIngredientUpdateSchema.parse({ name: "只改名称", source: "usda",
    data_license: "CC0-1.0" }), context);
  assert.deepEqual(await provenance(), { source: "usda", source_version: null, data_license: "CC0-1.0", source_updated_at: null });

  const trusted = await service.createIngredient(adminIngredientSchema.parse({ ...complete, name: "已审核来源",
    source: "taiwan_fda", source_version: "TFDA-2026", data_license: "OGDL-1.0" }), context);
  const trustedQuality = () => row(`SELECT quality_status FROM ingredients_library WHERE id=${trusted.id}`);
  await service.updateIngredient(trusted.id, adminIngredientUpdateSchema.parse({ name: "已审核来源", source: "taiwan_fda" }), context);
  assert.equal((await trustedQuality()).quality_status, "trusted");
  await service.updateIngredient(trusted.id, adminIngredientUpdateSchema.parse({ name: "已审核来源", source: "usda" }), context);
  assert.equal((await trustedQuality()).quality_status, "needs_review");
  await exec(`UPDATE ingredients_library SET quality_status='trusted' WHERE id=${trusted.id}`);
  await service.updateIngredient(trusted.id, adminIngredientUpdateSchema.parse({ name: "已审核来源", source: "open_food_facts",
    source_version: "OFF-2026", data_license: "ODbL-1.0" }), context);
  assert.equal((await trustedQuality()).quality_status, "needs_review");
}
