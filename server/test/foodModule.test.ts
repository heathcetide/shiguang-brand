import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { FoodDomainError } from "../src/modules/foods/errors.js";
import type { FoodRepository } from "../src/modules/foods/repository.js";
import { FoodService } from "../src/modules/foods/service.js";
import { SqliteFoodRepository } from "../src/modules/foods/sqliteRepository.js";
import type { FoodLibraryRecord } from "../src/modules/foods/types.js";

function food(id: number): FoodLibraryRecord {
  return {
    id,
    name: `番茄${id}`,
    category: "蔬菜",
    calories_100g: 18,
    protein_100g: 0.9,
    carbs_100g: 3.9,
    fat_100g: 0.2,
    image_url: null,
    brands: null,
    barcode: null,
    micronutrients_json: '{"vitaminC":13.7}',
    source: "official",
    quality_status: "trusted",
  };
}

function fakeRepository(overrides: Partial<FoodRepository> = {}): FoodRepository {
  return {
    findByBarcode: async () => null,
    searchTrusted: async () => [],
    recordSearchGap: async () => undefined,
    createCustom: async () => 1,
    ...overrides,
  };
}

describe("foods module", () => {
  test("returns governed local results without an external request", async () => {
    let externalCalls = 0;
    let searched = "";
    const service = new FoodService(fakeRepository({
      searchTrusted: async (query) => {
        searched = query;
        return [1, 2, 3, 4, 5].map(food);
      },
    }), {
      searchExternal: async () => {
        externalCalls += 1;
        return [];
      },
    });

    const results = await service.search(" 蕃茄（新鲜） ");
    assert.equal(searched, "番茄");
    assert.equal(externalCalls, 0);
    assert.deepEqual(results[0]!.micronutrients, { vitaminC: 13.7 });
    assert.equal("micronutrients_json" in results[0]!, false);
  });

  test("records a normalized gap and labels external suggestions as unverified", async () => {
    const gaps: Array<[string, string]> = [];
    const service = new FoodService(fakeRepository({
      recordSearchGap: async (normalized, sample) => { gaps.push([normalized, sample]); },
    }), {
      searchExternal: async () => [{
        name: "Purple carrot",
        calories_100g: 41,
        protein_100g: null,
        carbs_100g: 9.6,
        fat_100g: 0.2,
        source: "open_api",
        source_provider: "usda_fdc",
        fdc_id: 170393,
        source_url: "https://fdc.nal.usda.gov/food-details/170393/nutrients",
      }],
    });

    const results = await service.search("紫胡萝卜");
    assert.deepEqual(gaps, [["紫胡萝卜", "紫胡萝卜"]]);
    assert.equal(results[0]!.quality_status, "external_unverified");
    assert.equal("cacheable" in results[0]! && results[0]!.cacheable, false);
    assert.equal("requires_review" in results[0]! && results[0]!.requires_review, true);
    assert.equal(results[0]!.protein_100g, null);
    assert.equal("fdc_id" in results[0]! && results[0]!.fdc_id, 170393);
    assert.equal("source_provider" in results[0]! && results[0]!.source_provider, "usda_fdc");
    assert.equal("source_url" in results[0]! && results[0]!.source_url, "https://fdc.nal.usda.gov/food-details/170393/nutrients");
  });

  test("rejects queries that normalize to an empty value", async () => {
    const service = new FoodService(fakeRepository(), { searchExternal: async () => [] });
    await assert.rejects(
      () => service.search("（新鲜）"),
      (error: unknown) => error instanceof FoodDomainError && error.code === "INVALID_FOOD_QUERY",
    );
  });

  test("concept references never expose generic nutrition after manual edits or damaged metadata", async () => {
    for (const base_data_payload of [JSON.stringify({ concept_id: 'tomato', nutrition_references: [{ id: 'sample' }] }), '{broken', null]) {
      const edited = { ...food(1), source: 'concept_base', quality_status: 'reference', base_data_payload };
      const service = new FoodService(fakeRepository({ searchTrusted: async () => [edited] }), { searchExternal: async () => [] });
      const [result] = await service.search('番茄');
      assert.deepEqual([result!.calories_100g, result!.protein_100g, result!.carbs_100g, result!.fat_100g], [null, null, null, null]);
      assert.equal(result!.micronutrients, null);
      assert.equal(result!.nutrition_basis, 'unknown');
      assert.equal('automatic_calculation_allowed' in result! && result.automatic_calculation_allowed, false);
      if (base_data_payload?.startsWith('{"')) assert.deepEqual('nutrition_references' in result! && result.nutrition_references, [{ id: 'sample' }]);
    }
  });

  test("SQLite adapter owns barcode, search-gap, trusted search, and custom-food writes", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE ingredients_library (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT,
          calories_100g REAL, protein_100g REAL, carbs_100g REAL, fat_100g REAL,
          image_url TEXT, brands TEXT, barcode TEXT, original_name TEXT, micronutrients_json TEXT,
          source TEXT, quality_status TEXT, source_version TEXT, data_license TEXT,
          preparation_state TEXT, nutrition_basis TEXT, edible_ratio REAL,
          normalized_name TEXT, search_keywords TEXT, deleted_at DATETIME, nutrition_status TEXT, base_data_payload TEXT
        );
        CREATE TABLE ingredient_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ingredient_id INTEGER NOT NULL, normalized_alias TEXT NOT NULL
        );
        CREATE TABLE ingredient_search_gaps (
          normalized_query TEXT PRIMARY KEY, sample_query TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 1,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE user_custom_foods (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
          calories_100g REAL NOT NULL, protein_100g REAL, carbs_100g REAL, fat_100g REAL, status TEXT
        );
      `);
      const inserted = database.prepare(`
        INSERT INTO ingredients_library
          (name, category, calories_100g, image_url, brands, barcode, original_name, micronutrients_json,
           source, quality_status, normalized_name, search_keywords)
        VALUES ('番茄', '蔬菜', 18, NULL, NULL, '6900000000001', 'tomato', '{}',
          'official', 'trusted', '番茄', '西红柿')
      `).run();
      database.prepare("INSERT INTO ingredient_aliases (ingredient_id, normalized_alias) VALUES (?, '西红柿')")
        .run(inserted.lastInsertRowid);

      const repository = new SqliteFoodRepository(database);
      assert.equal((await repository.findByBarcode("6900000000001"))?.name, "番茄");
      assert.equal((await repository.searchTrusted("西红柿", 10))[0]?.name, "番茄");
      database.prepare(`INSERT INTO ingredients_library (name,normalized_name,source,quality_status,nutrition_basis,nutrition_status,base_data_payload)
        VALUES ('马铃薯','土豆','concept_base','reference','unknown','unknown','{"concept_id":"potato","forms":[]}'),
        ('花生','土豆','concept_base','reference','unknown','unknown','{"concept_id":"peanut","forms":[]}'),
        ('待审商品','土豆','base_data','needs_review','unknown','unknown',NULL),
        ('不明来源','土豆','other','reference','unknown','unknown',NULL)`).run();
      let externalCalls = 0;
      const search = new FoodService(repository, { searchExternal: async () => { externalCalls++; return []; } });
      const ambiguous = await search.search('土豆');
      assert.deepEqual(ambiguous.map(item=>item.name), ['马铃薯','花生']);
      assert.equal(ambiguous[0]?.calories_100g, null);
      assert.equal(externalCalls, 0);
      assert.equal('base_data_payload' in ambiguous[0]!, false);
      await repository.recordSearchGap("紫胡萝卜", " 紫胡萝卜 ");
      await repository.recordSearchGap("紫胡萝卜", "紫色胡萝卜");
      assert.deepEqual(database.prepare(`
        SELECT sample_query, hit_count FROM ingredient_search_gaps WHERE normalized_query = '紫胡萝卜'
      `).get(), { sample_query: "紫色胡萝卜", hit_count: 2 });
      const customId = await repository.createCustom(7, {
        name: "家庭豆浆",
        calories_100g: 31,
        protein_100g: 3,
        carbs_100g: 1.2,
        fat_100g: 1.6,
      });
      assert.deepEqual(database.prepare("SELECT user_id, name, status FROM user_custom_foods WHERE id = ?")
        .get(customId), { user_id: 7, name: "家庭豆浆", status: "pending" });
    } finally {
      database.close();
    }
  });
});
