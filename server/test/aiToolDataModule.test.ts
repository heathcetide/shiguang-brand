import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AiToolDataRepository } from "../src/modules/aiToolData/repository.js";
import { AiToolDataService } from "../src/modules/aiToolData/service.js";
import { SqliteAiToolDataRepository } from "../src/modules/aiToolData/sqliteRepository.js";

function repository(overrides: Partial<AiToolDataRepository> = {}): AiToolDataRepository {
  return {
    searchRecipes: async () => [],
    lookupFoodNutrition: async () => [],
    recordDietMeal: async () => 1,
    ...overrides,
  };
}

describe("AI tool data module", () => {
  test("normalizes SQLite text JSON and PostgreSQL JSONB recipe rows", async () => {
    const service = new AiToolDataService(repository({ searchRecipes: async () => [{
      id: 7, title: "番茄蛋", cook_time: 12, difficulty: "简单", calories: 320, protein: 18,
      carbs: 20, fat: 11, tags: ["快手"], ingredients_json: '[{"name":"番茄"}]',
    }] }));
    const result = await service.searchRecipes({ ingredientNames: ["番茄"], limit: 5 });
    assert.deepEqual(result.recipes[0]?.tags, ["快手"]);
    assert.deepEqual(result.recipes[0]?.ingredients, [{ name: "番茄" }]);
    assert.equal(result.recipes[0]?.recipeId, 7);
  });

  test("scales exact and fuzzy nutrition matches", async () => {
    const service = new AiToolDataService(repository({ lookupFoodNutrition: async () => [
      { name: "燕麦", calories_100g: 380, protein_100g: 13.2, carbs_100g: 67.5, fat_100g: 6.5, source: "test" },
      { name: "燕麦片", calories_100g: 400, protein_100g: 10, carbs_100g: 70, fat_100g: 8, source: "test" },
    ] }));
    const result = await service.lookupFoodNutrition("燕麦", 50, "g");
    assert.deepEqual(result.matches[0]?.nutrition, { caloriesKcal: 190, proteinG: 6.6, carbohydrateG: 33.8, fatG: 3.3 });
    assert.equal(result.matches[0]?.matchType, "exact_brand");
    assert.deepEqual(result.matches[1]?.warnings, ["基于模糊食材匹配，品牌和烹饪方式会影响结果"]);
  });

  test("preserves unknown nutrition and distinguishes genuine zero", async () => {
    const service = new AiToolDataService(repository({ lookupFoodNutrition: async () => [
      { name: "番茄", calories_100g: null, protein_100g: undefined, carbs_100g: "", fat_100g: 0 },
    ] }));
    const result = await service.lookupFoodNutrition("番茄", 50, "g");
    assert.deepEqual(result.matches[0]?.nutrition,
      { caloriesKcal: null, proteinG: null, carbohydrateG: null, fatG: 0 });
    assert.ok(result.matches[0]?.warnings.includes("部分营养数据未知，不可按零计算"));
  });

  test("returns the repository-generated diet record id", async () => {
    const service = new AiToolDataService(repository({ recordDietMeal: async (input) => {
      assert.equal(input.foodName, "测试餐");
      return 42;
    } }));
    assert.equal(await service.recordDietMeal({ userId: 1, mealType: "午餐", foodName: "测试餐", amount: "1份",
      calories: 300, protein: 18, carbs: 35, fat: 8, recordedAt: "2026-09-01", recordedTime: "12:00" }), 42);
  });

  test("SQLite adapter owns filtered reads and diet writes", async () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE recipes (id INTEGER PRIMARY KEY, title TEXT, cook_time INTEGER, difficulty TEXT, calories INTEGER,
        protein REAL, carbs REAL, fat REAL, tags TEXT, ingredients_json TEXT, status TEXT, deleted_at TEXT, quality_status TEXT);
      CREATE TABLE ingredients_library (id INTEGER PRIMARY KEY, name TEXT, brands TEXT, calories_100g REAL,
        protein_100g REAL, carbs_100g REAL, fat_100g REAL, source TEXT, deleted_at TEXT);
      CREATE TABLE diet_records (id INTEGER PRIMARY KEY, user_id INTEGER, meal_type TEXT, food_name TEXT, amount TEXT,
        calories INTEGER, protein REAL, carbs REAL, fat REAL, recorded_at TEXT, recorded_time TEXT);
      INSERT INTO recipes VALUES (1, '番茄蛋', 12, '简单', 320, 18, 20, 11, '["快手"]',
        '[{"name":"番茄"}]', 'approved', NULL, 'trusted');
      INSERT INTO ingredients_library VALUES (1, '燕麦', NULL, 380, 13.2, 67.5, 6.5, 'test', NULL);
    `);
    const service = new AiToolDataService(new SqliteAiToolDataRepository(database));
    assert.equal((await service.searchRecipes({ ingredientNames: ["番茄"], maxTimeMinutes: 15,
      maxCalories: 350, minProteinG: 17, limit: 2 })).recipes[0]?.name, "番茄蛋");
    assert.equal((await service.lookupFoodNutrition("燕麦", 100, "g")).matches[0]?.nutrition.caloriesKcal, 380);
    const id = await service.recordDietMeal({ userId: 3, mealType: "午餐", foodName: "番茄蛋", amount: "1份",
      calories: 320, protein: 18, carbs: 20, fat: 11, recordedAt: "2026-09-01", recordedTime: "12:00" });
    assert.equal((database.prepare("SELECT food_name FROM diet_records WHERE id = ?").get(id) as { food_name: string }).food_name, "番茄蛋");
    database.close();
  });
});
