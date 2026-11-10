import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AiContextRepository } from "../src/modules/aiContext/repository.js";
import { aiContextService, configureAiContextService } from "../src/modules/aiContext/runtime.js";
import { AiContextService } from "../src/modules/aiContext/service.js";
import { SqliteAiContextRepository } from "../src/modules/aiContext/sqliteRepository.js";

function repository(overrides: Partial<AiContextRepository> = {}): AiContextRepository {
  return {
    load: async () => ({ user: null, inventory: [], kitchenware: [], todayDiet: [], latestHealth: null,
      healthProfile: null, personaPrompt: "" }),
    ...overrides,
  };
}

describe("AI context module", () => {
  test("normalizes SQLite text JSON and PostgreSQL JSONB values", async () => {
    const service = new AiContextService(repository({ load: async () => ({
      user: { username: "小林", daily_calories_target: "1800" },
      inventory: [{ food_name: "番茄", quantity: "250g", expiration_date: "2026-09-03", storage_location: "冷藏" }],
      kitchenware: [{ name: "炒锅", category: "锅具", status: "正常" }],
      todayDiet: [{ meal_type: "早餐", food_name: "燕麦", calories: "320", protein: "12", carbs: 55, fat: 7 }],
      latestHealth: { weight: "62.5", body_fat: null, water_ml: "1500" },
      healthProfile: {
        age: 31, dietary_preference: "清淡", allergies_json: [{ name: "花生", type: "过敏", severity: "重度" }],
        medications: "", medical_conditions_json: '["孕期"]', medical_notes: "",
        dietary_restrictions_json: ["低盐"], disliked_foods: "香菜",
        kitchen_constraints_json: '{"meal_time_minutes":20}', nutrition_targets_json: { calories_kcal: 1750, protein_g: 90 }, nutrition_target_source: "user",
      },
      personaPrompt: "  自定义人设  ",
    }) }));
    const result = await service.load(3, "2026-09-01");
    assert.equal(result.dailyCaloriesTarget, 1750);
    assert.equal(result.calorieTarget?.source, "user");
    assert.equal(result.latestHealth?.weight, 62.5);
    assert.equal(result.latestHealth?.body_fat, undefined);
    assert.deepEqual(result.healthProfile?.medical_conditions, ["孕期"]);
    assert.deepEqual(result.healthProfile?.allergies, [{ name: "花生", type: "过敏", severity: "重度" }]);
    assert.equal(result.healthProfile?.kitchen_constraints.meal_time_minutes, 20);
    assert.equal(result.personaPrompt, "自定义人设");
  });

  test("uses safe defaults for absent and malformed values", async () => {
    const service = new AiContextService(repository({ load: async () => ({
      user: null, inventory: [], kitchenware: [], todayDiet: [], latestHealth: { weight: "invalid" },
      healthProfile: { allergies_json: "not-json", medical_conditions_json: null,
        dietary_restrictions_json: "", kitchen_constraints_json: "bad", nutrition_targets_json: undefined },
      personaPrompt: "",
    }) }));
    const result = await service.load(9, "2026-09-01");
    assert.equal(result.username, "用户");
    assert.equal(result.dailyCaloriesTarget, 2000);
    assert.equal(result.latestHealth?.weight, undefined);
    assert.deepEqual(result.healthProfile?.allergies, []);
    assert.deepEqual(result.healthProfile?.kitchen_constraints, {});
  });

  test("SQLite adapter owns all context reads and filters unavailable rows", async () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, daily_calories_target INTEGER);
      CREATE TABLE inventory_items (id INTEGER PRIMARY KEY, user_id INTEGER, food_name TEXT, quantity TEXT,
        expiration_date TEXT, storage_location TEXT, is_available INTEGER, version INTEGER DEFAULT 1, quantity_value REAL, quantity_unit TEXT, batch_code TEXT, deleted_at TEXT);
      CREATE TABLE meal_plans(id TEXT,user_id INTEGER,status TEXT,deleted_at TEXT);
      CREATE TABLE prepared_meal_allocations(id TEXT,user_id INTEGER,plan_id TEXT,prepared_meal_id TEXT,planned_date TEXT,meal_type TEXT);
      CREATE TABLE prepared_meals (id TEXT PRIMARY KEY,user_id INTEGER,remaining_servings REAL,produced_at TEXT);
      CREATE TABLE kitchenware_items (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, category TEXT, status TEXT,
        deleted_at TEXT, updated_at TEXT);
      CREATE TABLE diet_records (id INTEGER PRIMARY KEY, user_id INTEGER, meal_type TEXT, food_name TEXT,
        calories REAL, protein REAL, carbs REAL, fat REAL, recorded_at TEXT);
      CREATE TABLE health_logs (id INTEGER PRIMARY KEY, user_id INTEGER, weight REAL, body_fat REAL, water_ml INTEGER,
        height_cm REAL,waist_cm REAL,hip_cm REAL,resting_heart_rate REAL,blood_pressure_systolic REAL,
        blood_pressure_diastolic REAL,blood_glucose_mmol REAL,sleep_hours REAL,recorded_date TEXT);
      CREATE TABLE user_health_profiles (user_id INTEGER PRIMARY KEY, age INTEGER, dietary_preference TEXT,
        allergies_json TEXT, medications TEXT, medical_conditions_json TEXT, medical_notes TEXT,
        dietary_restrictions_json TEXT, disliked_foods TEXT, kitchen_constraints_json TEXT, nutrition_targets_json TEXT);
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO users VALUES (1, '小林', 1900);
      INSERT INTO inventory_items(id,user_id,food_name,quantity,expiration_date,storage_location,is_available) VALUES (1, 1, '番茄', '2个', '2026-09-02', '冷藏', 1);
      INSERT INTO inventory_items(id,user_id,food_name,quantity,expiration_date,storage_location,is_available) VALUES (2, 1, '过期隐藏', '1个', '2026-09-01', '冷藏', 0);
      INSERT INTO kitchenware_items VALUES (1, 1, '炒锅', '锅具', '正常', NULL, '2026-09-01');
      INSERT INTO kitchenware_items VALUES (2, 1, '坏锅', '锅具', '维修中', NULL, '2026-09-01');
      INSERT INTO diet_records VALUES (1, 1, '午餐', '番茄蛋', 320, 18, 20, 11, '2026-09-01 12:00');
      INSERT INTO health_logs(id,user_id,weight,body_fat,water_ml,recorded_date) VALUES (1, 1, 62.5, 21.2, 1600,'2026-09-01');
      INSERT INTO user_health_profiles VALUES (1, 31, '清淡', '[]', '', '[]', '', '["低盐"]', '', '{}', '{}');
      INSERT INTO system_settings VALUES ('AI_SYSTEM_PROMPT', 'SQLite 人设');
    `);
    const service = new AiContextService(new SqliteAiContextRepository(database));
    const result = await service.load(1, "2026-09-01");
    assert.equal(result.inventory.length, 1);
    assert.equal(result.inventory[0].id, 1);
    assert.equal(result.inventory[0].version, 1);
    assert.equal(result.inventory[0].quantity_value, null);
    assert.equal(result.kitchenware.length, 1);
    assert.equal(result.todayDiet[0]?.calories, 320);
    assert.deepEqual(result.healthProfile?.dietary_restrictions, ["低盐"]);
    assert.equal(result.personaPrompt, "SQLite 人设");
    database.close();
  });

  test("runtime returns the configured service", () => {
    const service = new AiContextService(repository());
    configureAiContextService(service);
    assert.equal(aiContextService(), service);
  });
});
