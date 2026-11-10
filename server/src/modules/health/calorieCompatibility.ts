import type Database from "better-sqlite3";
import type { PoolClient } from "pg";
import { calorieTarget, jsonObject } from "./projections.js";

/** Called inside the account repository transaction; null keeps legacy PUT semantics. */
export function syncLegacyCaloriesSqlite(database: Database.Database, userId: number, value: number | null | undefined) {
  if (value == null) return;
  database.prepare("INSERT OR IGNORE INTO user_health_profiles (user_id,gender,health_goal,activity_level,dietary_preference) VALUES (?,NULL,NULL,NULL,NULL)").run(userId);
  const profile = database.prepare("SELECT nutrition_targets_json,nutrition_target_source FROM user_health_profiles WHERE user_id=?").get(userId) as Record<string, unknown>;
  const current = calorieTarget(profile);
  if (current.value === value || (current.value == null && value === current.referenceValue)) {
    database.prepare("UPDATE users SET daily_calories_target=? WHERE id=?").run(current.value, userId);
    return;
  }
  database.prepare("UPDATE user_health_profiles SET nutrition_targets_json=?,nutrition_target_source='legacy_unconfirmed',nutrition_target_version=NULL,profile_version=profile_version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
    .run(JSON.stringify({ ...jsonObject(profile.nutrition_targets_json), calories_kcal: value }), userId);
}
/** Called with the account repository's transaction client. */
export async function syncLegacyCaloriesPostgres(client: PoolClient, userId: number, value: number | null | undefined) {
  if (value == null) return;
  await client.query("INSERT INTO user_health_profiles (user_id,gender,health_goal,activity_level,dietary_preference) VALUES ($1,NULL,NULL,NULL,NULL) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const profile = (await client.query("SELECT nutrition_targets_json,nutrition_target_source FROM user_health_profiles WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
  const current = calorieTarget(profile);
  if (current.value === value || (current.value == null && value === current.referenceValue)) {
    await client.query("UPDATE users SET daily_calories_target=$1 WHERE id=$2", [current.value, userId]);
    return;
  }
  await client.query("UPDATE user_health_profiles SET nutrition_targets_json=COALESCE(nutrition_targets_json,'{}'::jsonb)||jsonb_build_object('calories_kcal',$1::integer),nutrition_target_source='legacy_unconfirmed',nutrition_target_version=NULL,profile_version=profile_version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$2", [value, userId]);
}
