import assert from "node:assert/strict";
import { AdminRecipesService } from "../../src/modules/adminRecipes/service.js";

import type { AdminRecipesRepository } from "../../src/modules/adminRecipes/repository.js";

type Query = (sql: string, values?: (string | number | null)[]) => Promise<Record<string, unknown>[]>;

/** Synthetic licensed-import fixture, not real imported nutritional evidence. */
export async function verifyAdminRecipeMetadata(service: AdminRecipesService, adminId: number, query: Query, repository: AdminRecipesRepository) {
  const recipeId = Number((await query(`INSERT INTO recipes
    (title,source,status,quality_status,nutrition_basis,serving_size,cook_time,prep_time,
     ingredients_json,steps_json,required_kitchenware_json,optional_kitchenware_json,
     source_url,data_license,source_revision,source_attribution,source_content_hash,cuisine,meal_types_json)
    VALUES('元数据回归','wikibooks_zh','approved','estimated','ingredient_estimate',4,20,5,
    '[{"name":"米","amount":"400g"}]','["清洗","煮熟"]','["汤锅"]','[]',
    'https://zh.wikibooks.org/wiki/Cookbook','CC-BY-SA-4.0','fixture-r1','合成来源署名','fixture-source-hash','合成菜系','["晚餐"]') RETURNING id`))[0].id);
  const read = async () => (await query("SELECT * FROM recipes WHERE id=?", [recipeId]))[0];
  await query("UPDATE recipes SET calories=NULL,protein=NULL,carbs=NULL,fat=NULL WHERE id=?", [recipeId]);
  const before = await read();
  await service.update(adminId, recipeId, { title: "仅修改标题" }, { adminUserId: adminId });
  let after = await read();
  for (const key of ['serving_size', 'source', 'source_url', 'data_license', 'source_revision', 'source_attribution', 'source_content_hash',
    'calories', 'protein', 'carbs', 'fat', 'nutrition_basis', 'quality_status', 'status', 'prep_time', 'cuisine', 'meal_types_json', 'required_kitchenware_json']) {
    assert.deepEqual(after[key], before[key], `omitted ${key} must survive a title edit`);
  }
  assert.equal(after.title, "仅修改标题");
  await service.update(adminId, recipeId, { serving_size: "6", source_url: "https://example.org/reviewed-source", data_license: "CC-BY-4.0",
    source_revision: "fixture-r2", source_attribution: "新的明确署名" }, { adminUserId: adminId });
  after = await read();
  assert.equal(after.serving_size, 6); assert.equal(after.data_license, "CC-BY-4.0");
  assert.equal(after.source_url, "https://example.org/reviewed-source");
  assert.equal(after.source_revision, "fixture-r2"); assert.equal(after.source_attribution, "新的明确署名");
  for (const change of [{ serving_size: null }, { serving_size: 0 }, { serving_size: 1.5 }, { serving_size: "not-a-number" },
    { source_url: "javascript:alert(1)" }, { source_url: "https://user:secret@example.org" }, { source_revision: {} },
    { data_license: null }, { data_license: "" }]) {
    await assert.rejects(service.update(adminId, recipeId, change, { adminUserId: adminId }));
    assert.deepEqual(await read(), after, "invalid explicit metadata must not write");
  }
  await service.update(adminId, recipeId, { source_url: null, source_revision: null, source_attribution: null }, { adminUserId: adminId });
  await service.update(adminId, recipeId, { title: "缺失来源保持缺失" }, { adminUserId: adminId });
  after = await read();
  for (const key of ['source_url', 'source_revision', 'source_attribution']) assert.equal(after[key], null);
  assert.equal(after.source_content_hash, before.source_content_hash);
  assert.equal(after.serving_size, 6);

  // Legacy JSON scalars must compare as JSON, not be mistaken for raw SQL text.
  for (const tags of ['"legacy"', 'null']) {
    await query("UPDATE recipes SET tags=? WHERE id=?", [tags, recipeId]);
    await service.update(adminId, recipeId, { title: "旧格式仍可编辑" }, { adminUserId: adminId });
    assert.equal((await read()).title, "旧格式仍可编辑");
  }

  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const staleService = new AdminRecipesService(repository, { resolveCatalog: async () => { reached(); await resume; return null; } });
  const staleWrite = staleService.update(adminId, recipeId, { title: "过期标题不能覆盖" }, { adminUserId: adminId });
  const rejected = assert.rejects(staleWrite, { status: 409, code: "RECIPE_UPDATE_CONFLICT" });
  await blocked;
  await service.update(adminId, recipeId, { source_attribution: "并发更新署名" }, { adminUserId: adminId });
  const committed = await read();
  const auditCount = await query("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE resource_id=? AND action='recipe.update'", [String(recipeId)]);
  release();
  await rejected;
  assert.deepEqual(await read(), committed, "stale title update must not overwrite concurrent metadata");
  assert.equal(committed.source_attribution, "并发更新署名");
  assert.deepEqual(await query("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE resource_id=? AND action='recipe.update'", [String(recipeId)]), auditCount,
    "rejected stale write must not create an audit event");
}
