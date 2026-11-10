import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HealthRepository } from "../src/modules/health/repository.js";
import { HealthService } from "../src/modules/health/service.js";
import Database from "better-sqlite3";
import { SqliteHealthRepository } from "../src/modules/health/sqliteRepository.js";
import { healthProfileMigration } from "../src/storage/healthProfileMigration.js";
import { syncLegacyCaloriesSqlite } from "../src/modules/health/calorieCompatibility.js";
import { SqliteRecommendationsRepository } from "../src/modules/recommendations/sqliteRepository.js";
import { healthProfilePatchSchema } from "@dietdigidose/contracts";

function profileDatabase() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,daily_calories_target INTEGER);
    CREATE TABLE user_health_profiles(id INTEGER PRIMARY KEY,user_id INTEGER UNIQUE,gender TEXT,age INTEGER,height REAL,weight REAL,target_weight REAL,
      health_goal TEXT DEFAULT 'healthy',activity_level TEXT DEFAULT 'moderate',dietary_preference TEXT DEFAULT '无特别偏好',
      allergies_json TEXT DEFAULT '[]',medications TEXT DEFAULT '',medical_conditions_json TEXT DEFAULT '[]',medical_notes TEXT DEFAULT '',
      dietary_restrictions_json TEXT DEFAULT '[]',disliked_foods TEXT DEFAULT '',kitchen_constraints_json TEXT DEFAULT '{}',nutrition_targets_json TEXT DEFAULT '{}',
      tracking_enabled INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE health_logs(id INTEGER PRIMARY KEY,user_id INTEGER,weight REAL,body_fat REAL,water_ml INTEGER,height_cm REAL,waist_cm REAL,hip_cm REAL,
      resting_heart_rate REAL,blood_pressure_systolic REAL,blood_pressure_diastolic REAL,blood_glucose_mmol REAL,sleep_hours REAL,cycle_status TEXT,recorded_date TEXT);
    INSERT INTO users VALUES(1,2000),(2,1800),(3,NULL);
    INSERT INTO user_health_profiles(user_id,weight,height,nutrition_targets_json,allergies_json,medications)
      VALUES(2,68,171,'{"calories_kcal":1650,"protein_g":90}','[{"name":"坚果","type":"allergy","severity":"severe"}]','按时服药');`);
  healthProfileMigration.up(db);
  return db;
}

function fakeRepository(overrides: Partial<HealthRepository> = {}) {
  const repository: HealthRepository = {
    latestLog: async () => null,
    measurementLogs: async () => [],
    patchProfile: async () => null,
    listLogs: async () => [],
    upsertLog: async (_userId, recordedDate) => ({ created: true, log: { recorded_date: recordedDate } }),
    removeLog: async () => true,
    getOrCreateProfile: async (userId) => ({
      user_id: userId,
      allergies_json: JSON.stringify([{ name: "坚果" }]),
      medical_conditions_json: ["高血压"],
      dietary_restrictions_json: "[]",
      kitchen_constraints_json: { servings: 2 },
      nutrition_targets_json: "{}",
      tracking_enabled: 1,
    }),
    upsertProfile: async (userId, input) => ({ user_id: userId, ...input }),
    ...overrides,
  };
  return repository;
}

describe("health module", () => {
  test("migration preserves legacy defaults and conflicting source values without creating new targets", async () => {
    const db = profileDatabase();
    try {
      const service = new HealthService(new SqliteHealthRepository(db));
      const old = await service.getProfile(1);
      assert.deepEqual(old.calorieTarget, { value: 2000, source: "legacy_unconfirmed", referenceValue: 2000 });
      const conflict = await service.getProfile(2);
      assert.equal(conflict.calorieTarget.value, 1650);
      assert.equal(conflict.safety_status, "provided");
      const stored = db.prepare("SELECT * FROM user_health_profiles WHERE user_id=2").get() as Record<string, unknown>;
      assert.equal(JSON.parse(String(stored.nutrition_target_legacy_json)).daily_calories_target, 1800);
      assert.equal(stored.nutrition_target_version, null);
      assert.equal((await service.getProfile(3)).calorieTarget.value, null);
      assert.equal((db.prepare("SELECT daily_calories_target FROM users WHERE id=3").get() as Record<string, unknown>).daily_calories_target, null);
    } finally { db.close(); }
  });

  test("versioned PATCH merges nested values, clears explicit null and prevents stale overwrites", async () => {
    const db = profileDatabase();
    try {
      const service = new HealthService(new SqliteHealthRepository(db));
      const first = await service.patchProfile(2, { version: 1, age: 34, kitchen_constraints: { servings: 2, meal_time_minutes: 20 }, nutrition_targets: { calories_kcal: 1700 } });
      assert.equal(first.updated, true);
      assert.equal(first.profile.version, 2);
      assert.equal((first.profile as Record<string, unknown>).nutrition_target_version, 2);
      assert.deepEqual(first.profile.nutrition_targets, { calories_kcal: 1700, protein_g: 90 });
      assert.equal(await new SqliteRecommendationsRepository(db).dailyCaloriesTarget(2), 1700);
      const stale = await service.patchProfile(2, { version: 1, age: 35 });
      assert.equal(stale.updated, false);
      assert.equal((stale.profile as Record<string, unknown>).age, 34);
      const cleared = await service.patchProfile(2, { version: 2, age: null, height: null, nutrition_targets: { calories_kcal: null }, kitchen_constraints: { servings: null } });
      assert.equal((cleared.profile as Record<string, unknown>).age, null);
      assert.equal((cleared.profile as Record<string, unknown>).height, null);
      assert.deepEqual(cleared.profile.kitchen_constraints, { servings: null, meal_time_minutes: 20 });
      assert.deepEqual(cleared.profile.nutrition_targets, { calories_kcal: null, protein_g: 90 });
      assert.equal(cleared.profile.calorieTarget.source, "unset");
      assert.equal((db.prepare("SELECT daily_calories_target FROM users WHERE id=2").get() as Record<string, unknown>).daily_calories_target, null);
      assert.equal(await new SqliteRecommendationsRepository(db).dailyCaloriesTarget(2), 2000);
    } finally { db.close(); }
  });

  test("confirming no dietary limits requires explicit clearing and preserves other health information", async () => {
    const db = profileDatabase();
    try {
      const service = new HealthService(new SqliteHealthRepository(db));
      await assert.rejects(service.patchProfile(2, { version: 1, safety_status: "none" }), { code: "SAFETY_STATUS_CONFLICT" });
      assert.equal((await service.getProfile(2)).version, 1);
      const saved = await service.patchProfile(2, { version: 1, safety_status: "none", allergies: [], dietary_restrictions: [] });
      assert.equal(saved.profile.safety_status, "none");
      assert.equal((saved.profile as Record<string, unknown>).medications, "按时服药");
      assert.equal(healthProfilePatchSchema.safeParse({ version: 2 }).success, false);
      assert.equal(healthProfilePatchSchema.safeParse({ version: 2, nutrition_target_source: "user" }).success, false);
    } finally { db.close(); }
  });

  test("legacy PUT keeps null-as-unchanged and account calorie writes share the canonical target", async () => {
    const db = profileDatabase();
    try {
      const service = new HealthService(new SqliteHealthRepository(db));
      const profile = await service.upsertProfile(2, { height: null, nutrition_targets: { calories_kcal: 1900 } });
      assert.equal((profile as Record<string, unknown>).height, 171);
      assert.deepEqual(profile.nutrition_targets, { calories_kcal: 1900 });
      assert.equal(profile.calorieTarget.source, "legacy_unconfirmed");
      db.transaction(() => {
        db.prepare("UPDATE users SET daily_calories_target=2100 WHERE id=2").run();
        syncLegacyCaloriesSqlite(db, 2, 2100);
      })();
      const updated = await service.getProfile(2);
      assert.equal(updated.calorieTarget.value, 2100);
      assert.equal(updated.version, 3);
      assert.equal((updated as Record<string, unknown>).nutrition_target_version, null);
      assert.equal(updated.calorieTarget.source, "legacy_unconfirmed");
      syncLegacyCaloriesSqlite(db, 2, null);
      assert.equal((await service.getProfile(2)).version, 3);
      assert.equal((await service.getProfile(1)).calorieTarget.value, 2000);
      syncLegacyCaloriesSqlite(db, 1, 2000);
      assert.equal((await service.getProfile(1)).calorieTarget.source, "legacy_unconfirmed");
      assert.equal((await service.getProfile(1)).version, 1);
      await service.patchProfile(2, { version: 3, nutrition_targets: { calories_kcal: null } });
      db.prepare("UPDATE users SET daily_calories_target=2000 WHERE id=2").run();
      syncLegacyCaloriesSqlite(db, 2, 2000);
      assert.equal((await service.getProfile(2)).calorieTarget.value, null);
      assert.equal((db.prepare("SELECT daily_calories_target FROM users WHERE id=2").get() as Record<string, unknown>).daily_calories_target, null);
    } finally { db.close(); }
  });

  test("current measurements select each latest dated metric with baseline fallback and account isolation", async () => {
    const db = profileDatabase();
    try {
      const service = new HealthService(new SqliteHealthRepository(db));
      db.exec(`INSERT INTO health_logs(id,user_id,weight,recorded_date) VALUES(1,2,66,'2026-08-01'),(2,2,65,'2026-09-01'),(4,2,67,'2026-08-02'),(5,1,99,'2026-09-03');
        INSERT INTO health_logs(id,user_id,water_ml,recorded_date) VALUES(3,2,1700,'2026-09-02');`);
      const projected = await service.currentMeasurements(2);
      assert.deepEqual(projected.weight, { value: 65, recordedDate: "2026-09-01", source: "log" });
      assert.equal(projected.water_ml?.value, 1700);
      assert.deepEqual(projected.height_cm, { value: 171, recordedDate: null, source: "legacy_profile" });
      await service.removeLog(2, 2);
      assert.equal((await service.currentMeasurements(2)).weight?.value, 67);
      await service.upsertProfile(2, { weight: 64 });
      assert.equal((await service.currentMeasurements(2)).weight?.value, 64);
      assert.equal((await service.currentMeasurements(1)).weight?.value, 99);
    } finally { db.close(); }
  });
  test("normalizes SQLite text JSON and PostgreSQL JSONB through one service shape", async () => {
    const service = new HealthService(fakeRepository());
    const profile = await service.getProfile(7);
    assert.deepEqual(profile.allergies, [{ name: "坚果" }]);
    assert.deepEqual(profile.medical_conditions, ["高血压"]);
    assert.deepEqual(profile.kitchen_constraints, { servings: 2 });
    assert.equal(profile.tracking_enabled, true);
    assert.equal("allergies_json" in profile, false);
  });

  test("uses the current date when a health log omits recorded_date", async () => {
    let capturedDate = "";
    const service = new HealthService(fakeRepository({
      upsertLog: async (_userId, recordedDate) => {
        capturedDate = recordedDate;
        return { created: true, log: {} };
      },
    }));
    await service.upsertLog(7, { weight: 65 });
    assert.match(capturedDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("maps structured profile fields to driver-neutral JSON values", async () => {
    let captured: Record<string, unknown> = {};
    const service = new HealthService(fakeRepository({
      upsertProfile: async (_userId, input) => {
        captured = input;
        return { ...input, tracking_enabled: input.tracking_enabled ?? false };
      },
    }));
    await service.upsertProfile(7, {
      allergies: [{ name: "坚果" }],
      medical_conditions: ["高血压"],
      kitchen_constraints: { servings: 2 },
      tracking_enabled: true,
    });
    assert.deepEqual(captured.allergies_json, [{ name: "坚果" }]);
    assert.deepEqual(captured.medical_conditions_json, ["高血压"]);
    assert.deepEqual(captured.kitchen_constraints_json, { servings: 2 });
  });
});
