import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresHealthRepository } from "../src/modules/health/postgresRepository.js";
import { HealthService } from "../src/modules/health/service.js";
import { PostgresRecommendationsRepository } from "../src/modules/recommendations/postgresRepository.js";
import { syncLegacyCaloriesPostgres } from "../src/modules/health/calorieCompatibility.js";

/** Uses a dedicated disposable account so it does not disturb migration fixtures. */
export async function verifyHealthProfilePostgres(pool: Pool) {
  const created = await pool.query("INSERT INTO users(username,password_hash,daily_calories_target) VALUES($1,'test-only',NULL) RETURNING id", [`health-patch-${randomUUID()}`]);
  const userId = Number(created.rows[0].id);
  const service = new HealthService(new PostgresHealthRepository(pool));
  try {
    const empty = await service.getProfile(userId);
    assert.equal(empty.calorieTarget.value, null);
    assert.equal((empty as Record<string, unknown>).health_goal, null);
    const concurrent = await Promise.all([
      service.patchProfile(userId, { version: 1, nutrition_targets: { calories_kcal: 1750, protein_g: 95 }, age: 30 }),
      service.patchProfile(userId, { version: 1, nutrition_targets: { calories_kcal: 1850, protein_g: 95 }, age: 30 }),
    ]);
    assert.equal(concurrent.filter(result => result.updated).length, 1);
    const winner = concurrent.find(result => result.updated)!.profile;
    assert.equal(winner.version, 2);
    assert.equal(winner.calorieTarget.source, "user");
    assert.equal(Number((winner as Record<string, unknown>).nutrition_target_version), 2);
    assert.equal(await new PostgresRecommendationsRepository(pool).dailyCaloriesTarget(userId), winner.calorieTarget.value);
    const cleared = await service.patchProfile(userId, { version: 2, age: null, nutrition_targets: { calories_kcal: null } });
    assert.equal((cleared.profile as Record<string, unknown>).age, null);
    assert.deepEqual(cleared.profile.nutrition_targets, { calories_kcal: null, protein_g: 95 });
    assert.equal((await pool.query("SELECT daily_calories_target FROM users WHERE id=$1", [userId])).rows[0].daily_calories_target, null);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE users SET daily_calories_target=2000 WHERE id=$1", [userId]);
      await syncLegacyCaloriesPostgres(client, userId, 2000);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    assert.equal((await service.getProfile(userId)).calorieTarget.value, null);
    assert.equal((await service.getProfile(userId)).version, 3);
    await service.upsertLog(userId, { weight: 66, recorded_date: "2001-01-01" });
    const latestWeight = await service.upsertLog(userId, { weight: 65, recorded_date: "2001-01-02" });
    await service.upsertLog(userId, { water_ml: 1600, recorded_date: "2001-01-03" });
    const current = await service.currentMeasurements(userId);
    assert.deepEqual(current.weight, { value: 65, recordedDate: "2001-01-02", source: "log" });
    assert.equal(current.water_ml?.value, 1600);
    await service.removeLog(userId, Number(latestWeight.log.id));
    assert.equal((await service.currentMeasurements(userId)).weight?.value, 66);
  } finally { await pool.query("DELETE FROM users WHERE id=$1", [userId]); }
}
