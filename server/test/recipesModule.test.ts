import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RecipesRepository } from "../src/modules/recipes/repository.js";
import { RecipesService } from "../src/modules/recipes/service.js";
import type { RecipeSubmissionWrite } from "../src/modules/recipes/types.js";
import { recipeSubmissionSchema } from "../src/validation/schemas.js";

function repository(overrides: Partial<RecipesRepository> = {}): RecipesRepository {
  return {
    listPublic: async () => ({ rows: [], total: 0 }), librarySummary: async () => ({ official: 0, community: 0, personal: 0, favorites: 0 }),
    listMine: async () => [], listFavorites: async () => [], favoriteCount: async () => 0, requirementsForRecipes: async () => [],
    createSubmission: async () => 1, findSubmission: async () => null, updateSubmission: async () => false,
    withdrawSubmission: async () => false, isFavorite: async () => false, addFavorite: async () => false,
    removeFavorite: async () => undefined, findPublic: async () => null, ...overrides,
  };
}

describe("recipes module", () => {
  test('publishes scoped nutrition disclosure without exposing internal histories or raw observations', async () => {
    const service = new RecipesService(repository({findPublic: async () => ({id: 8, title:'番茄炒蛋',
      nutrition_basis:'ingredient_estimate', quality_status:'reference', calories:184, protein:11, carbs:8, fat:13,
      base_data_payload:{concept_id:'tomato-eggs', enrichment_version:'v2', nutrition_enrichment_history:[{private:true}],
        nutrition_enrichment:{version:'v2', status:'core_complete_under_declared_assumptions', disclosure:'按生可食部称量',
          whole_recipe:{calories:368}, per_serving:{calories:184}, servings:2, gaps:[],
          references:[{display_name:'鸡蛋', grams:150, instruction:'去壳称量', source_url:'https://data.gov.tw/dataset/8543',
            source_food_id:'TFDA:egg', nutrients_per_100g:{private:true}}]}}})}), {resolveCatalog:async()=>null});
    const row = await service.detail(8,{protocol:'https'});
    assert.equal(row.nutrition_is_estimated,true);
    assert.equal(row.nutrition_status,'core_complete_under_declared_assumptions');
    const reference = row.nutrition_reference as Record<string,unknown>;
    assert.equal(reference.disclosure,'按生可食部称量');
    assert.equal(reference.automatic_meal_planning_allowed,false);
    assert.equal('nutrition_enrichment_history' in row,false);
    assert.equal(JSON.stringify(row).includes('private'),false);
  });
  test('incomplete enrichment retains null calories and empty per-serving nutrition', async () => {
    const service = new RecipesService(repository({findPublic:async()=>({id:8,title:'醋溜土豆丝',nutrition_basis:'unknown',calories:null,
      base_data_payload:{concept_id:'potato',nutrition_enrichment:{status:'incomplete',whole_recipe:{calories:360,protein:null},
        per_serving:null,gaps:[{name:'米醋',reason_text:'来源缺少蛋白质'}],references:[]}}})}),{resolveCatalog:async()=>null});
    const row = await service.detail(8,{protocol:'https'});
    assert.deepEqual(row.nutrition,[]);
    assert.equal((row as Record<string, unknown>).calories,null);
    assert.equal(row.nutrition_status,'incomplete');
  });
  test('concept recipes retain unknown nutrition, stable ingredient links and alternative methods', async () => {
    const service = new RecipesService(repository({
      findPublic: async () => ({ id: 8, title: '番茄炒蛋', nutrition_basis: 'unknown', quality_status: 'reference',
        calories: null, protein: null, carbs: null, fat: null, ingredients_json: [{ name:'番茄',amount:'200g',ingredient_id:3,ingredient_concept_id:'tomato',ingredient_form_id:'raw-tomato' }],
        base_data_payload: { concept_id:'tomato-eggs', variants:[{ recipe_id:8,is_primary:true },{ recipe_id:9,is_primary:false }] } }),
    }), { resolveCatalog: async () => null });
    const row = await service.detail(8,{protocol:'https'});
    assert.deepEqual(row.nutrition,[]);
    assert.equal((row as Record<string,unknown>).calories,null);
    assert.equal(row.nutrition_is_estimated,false);
    assert.equal(row.ingredients[0]?.ingredient_concept_id,'tomato');
    assert.equal((row.variants as unknown[]).length,2);
    assert.equal('base_data_payload' in row,false);
  });
  test("formats PostgreSQL JSONB rows and batches kitchenware requirements", async () => {
    const calls: number[][] = [];
    const service = new RecipesService(repository({
      listPublic: async (input) => ({ rows: [{ id: 8, title: "番茄蛋", protein: 12, carbs: 8, fat: 5,
        tags: ["快手"], steps_json: ["煎熟"], ingredients_json: [{ name: "番茄", amount: "1个", group: "main" }],
        nutrition_json: [{ key: "fiber", label: "膳食纤维", value: 2, unit: "g" }],
        quality_status: "trusted", nutrition_basis: "source", updated_at: new Date("2026-09-01T01:02:03Z") }], total: 1 }),
      requirementsForRecipes: async (ids) => { calls.push(ids); return [{ recipe_id: 8, role: "required", catalog_id: 3,
        catalog_name: "平底锅", capability_code: null, confidence: 1, notes: "" }]; },
    }), { resolveCatalog: async () => null });
    const result = await service.list(undefined, { pageSize: "10" }, { protocol: "https", host: "api.example.test" });
    assert.deepEqual(calls, [[8]]);
    const body = result.body as { items: Array<Record<string, unknown>>; total: number };
    assert.equal(body.total, 1);
    assert.deepEqual(body.items[0]?.tags, ["快手"]);
    assert.equal((body.items[0]?.nutrition as unknown[]).length, 4);
    assert.equal((body.items[0]?.required_kitchenware as Array<{ catalogName: string }>)[0]?.catalogName, "平底锅");
    assert.equal(body.items[0]?.updated_at, "2026-09-01 01:02:03");
  });

  test("maps submission requirements before one repository write", async () => {
    let captured: RecipeSubmissionWrite | undefined;
    const service = new RecipesService(repository({
      createSubmission: async (input) => { captured = input; return 42; },
    }), { resolveCatalog: async (name) => name === "空气炸锅" ? { id: 9, confidence: 1 } : { id: 9,confidence: 0.72 } });
    const result = await service.createSubmission(7, {
      title: "空气炸锅番茄", description: "", image_url: "", cook_time: 12, difficulty: "简单",
      calories: 100, protein: 4, carbs: 10, fat: 3, category: "晚餐", tags: ["快手"],
      steps: ["空气炸锅烤熟"], ingredients: [{ name: "番茄", amount: "1个" }],
      required_kitchenware: ["空气炸锅", "未知器具"], optional_kitchenware: [],
    });
    assert.equal(result.id, 42);
    assert.equal(captured?.authorUserId, 7);
    assert.equal(captured?.recipe.prepTime, null);
    assert.equal(captured?.sourceContentHash.length, 64);
    assert.deepEqual(captured?.requirements.map((item) => [item.rawName, item.catalogId]),
      [["空气炸锅", 9], ["未知器具", null]]);
  });

  test("preserves ownership and public-visibility errors independently of the driver", async () => {
    const service = new RecipesService(repository(), { resolveCatalog: async () => null });
    await assert.rejects(() => service.updateSubmission(2, 99, {}), /未找到该投稿/);
    await assert.rejects(() => service.addFavorite(2, 99), /未找到该食谱/);
    await assert.rejects(() => service.list(undefined, { scope: "personal" }, { protocol: "http" }), /登录后查看个人食谱库/);
  });
});

test("recipe duration input keeps unknown distinct from explicit zero and rejects invalid minutes", () => {
  const body = { title: "时间依据测试", steps: ["烹饪"], ingredients: [{ name: "番茄" }] };
  for (const prep_time of [undefined, null, "", "  "]) assert.equal(recipeSubmissionSchema.parse({ ...body, prep_time }).prep_time, null);
  for (const prep_time of [0, "0", "0分钟"]) assert.equal(recipeSubmissionSchema.parse({ ...body, prep_time }).prep_time, 0);
  assert.equal(recipeSubmissionSchema.parse({ ...body, cook_time: "15分钟", prep_time: "5" }).cook_time, 15);
  for (const value of [-1, 1.5, Infinity, "未知", "NaN", "1.5", true]) {
    assert.equal(recipeSubmissionSchema.safeParse({ ...body, prep_time: value }).success, false);
    assert.equal(recipeSubmissionSchema.safeParse({ ...body, cook_time: value }).success, false);
  }
});
