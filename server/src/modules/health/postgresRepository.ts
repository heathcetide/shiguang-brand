import type { Pool, PoolClient } from "pg";
import type { HealthRepository } from "./repository.js";
import type { HealthLogInput, HealthProfilePatch } from "./types.js";
import type { HealthProfileUpdate } from "@dietdigidose/contracts";
import { calorieTarget, measurementKeys } from "./projections.js";
import { legacySafetyStatus, prepareProfilePatch } from "./profilePatch.js";
import { currentDateKey } from "../../utils/date.js";

const optional = (value: unknown) => value === undefined ? null : value;
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value);

async function selectProfile(client: Pool | PoolClient, userId: number) {
  const result = await client.query("SELECT * FROM user_health_profiles WHERE user_id = $1", [userId]);
  return result.rows[0] as Record<string, unknown>;
}

export class PostgresHealthRepository implements HealthRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async latestLog(userId: number) {
    const result = await this.pool.query(`
      SELECT * FROM health_logs WHERE user_id = $1 ORDER BY recorded_date DESC, id DESC LIMIT 1
    `, [userId]);
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async measurementLogs(userId: number) {
    return (await this.pool.query(`SELECT * FROM health_logs WHERE ${measurementKeys.map(key => `id=(SELECT id FROM health_logs WHERE user_id=$1 AND ${key} IS NOT NULL ORDER BY recorded_date DESC,id DESC LIMIT 1)`).join(" OR ")}`, [userId])).rows as Record<string, unknown>[];
  }

  private async writeCurrentWeight(client: PoolClient, userId: number, value: unknown) {
    if (typeof value !== "number") return;
    const date = currentDateKey();
    await client.query("SELECT pg_advisory_xact_lock($1::integer,hashtext($2))", [userId, date]);
    const existing = (await client.query("SELECT id FROM health_logs WHERE user_id=$1 AND recorded_date=$2 ORDER BY id DESC LIMIT 1", [userId, date])).rows[0];
    if (existing) await client.query("UPDATE health_logs SET weight=$1 WHERE id=$2", [value, existing.id]);
    else await client.query("INSERT INTO health_logs (user_id,weight,recorded_date) VALUES ($1,$2,$3)", [userId, value, date]);
  }

  async patchProfile(userId: number, input: HealthProfileUpdate) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      await client.query("INSERT INTO user_health_profiles (user_id,gender,health_goal,activity_level,dietary_preference) VALUES ($1,NULL,NULL,NULL,NULL) ON CONFLICT (user_id) DO NOTHING", [userId]);
      const existing = (await client.query("SELECT * FROM user_health_profiles WHERE user_id=$1 FOR UPDATE", [userId])).rows[0];
      if (Number(existing.profile_version) !== input.version) { await client.query("COMMIT"); return null; }
      const values = prepareProfilePatch(existing, input);
      const entries = Object.entries(values);
      const result = await client.query(`UPDATE user_health_profiles SET ${entries.map(([key], index) => `${key}=$${index + 1}${key.endsWith("_json") ? "::jsonb" : ""}`).join(",")},profile_version=profile_version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=$${entries.length + 1} AND profile_version=$${entries.length + 2} RETURNING *`,
        [...entries.map(([key, value]) => key.endsWith("_json") ? JSON.stringify(value) : value), userId, input.version]);
      const profile = result.rows[0] as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(input.nutrition_targets || {}, "calories_kcal")) await client.query("UPDATE users SET daily_calories_target=$1 WHERE id=$2", [calorieTarget(profile).value, userId]);
      await this.writeCurrentWeight(client, userId, input.weight);
      await client.query("COMMIT");
      return profile;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async listLogs(userId: number, limit: number) {
    const result = await this.pool.query(`
      SELECT * FROM health_logs WHERE user_id = $1 ORDER BY recorded_date DESC LIMIT $2
    `, [userId, limit]);
    return result.rows as Array<Record<string, unknown>>;
  }

  async upsertLog(userId: number, recordedDate: string, input: HealthLogInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::integer, hashtext($2))", [userId, recordedDate]);
      const existing = await client.query<{ id: number }>(`
        SELECT id FROM health_logs WHERE user_id = $1 AND recorded_date = $2 ORDER BY id DESC LIMIT 1
      `, [userId, recordedDate]);
      const values = [
        optional(input.weight), optional(input.body_fat), optional(input.water_ml), optional(input.height_cm),
        optional(input.waist_cm), optional(input.hip_cm), optional(input.resting_heart_rate),
        optional(input.blood_pressure_systolic), optional(input.blood_pressure_diastolic),
        optional(input.blood_glucose_mmol), optional(input.sleep_hours),
      ];
      let created: boolean;
      let log: Record<string, unknown>;
      if (existing.rowCount === 1) {
        const updated = await client.query(`
          UPDATE health_logs SET
            weight = COALESCE($1, weight), body_fat = COALESCE($2, body_fat), water_ml = COALESCE($3, water_ml),
            height_cm = COALESCE($4, height_cm), waist_cm = COALESCE($5, waist_cm), hip_cm = COALESCE($6, hip_cm),
            resting_heart_rate = COALESCE($7, resting_heart_rate),
            blood_pressure_systolic = COALESCE($8, blood_pressure_systolic),
            blood_pressure_diastolic = COALESCE($9, blood_pressure_diastolic),
            blood_glucose_mmol = COALESCE($10, blood_glucose_mmol),
            cycle_status = CASE WHEN $11 THEN $12 ELSE cycle_status END,
            sleep_hours = COALESCE($13, sleep_hours)
          WHERE id = $14 RETURNING *
        `, [
          ...values.slice(0, 10),
          Object.prototype.hasOwnProperty.call(input, "cycle_status"),
          optional(input.cycle_status),
          values[10],
          existing.rows[0]!.id,
        ]);
        created = false;
        log = updated.rows[0]!;
      } else {
        const inserted = await client.query(`
          INSERT INTO health_logs (
            user_id, weight, body_fat, water_ml, height_cm, waist_cm, hip_cm,
            resting_heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
            blood_glucose_mmol, cycle_status, sleep_hours, recorded_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `, [
          userId,
          ...values.slice(0, 10),
          optional(input.cycle_status),
          values[10],
          recordedDate,
        ]);
        created = true;
        log = inserted.rows[0]!;
      }
      await client.query("COMMIT");
      return { created, log };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeLog(userId: number, id: number) {
    const result = await this.pool.query("DELETE FROM health_logs WHERE id = $1 AND user_id = $2", [id, userId]);
    return result.rowCount === 1;
  }

  async getOrCreateProfile(userId: number) {
    await this.pool.query(`
      INSERT INTO user_health_profiles (user_id,gender,health_goal,activity_level,dietary_preference) VALUES ($1,NULL,NULL,NULL,NULL) ON CONFLICT (user_id) DO NOTHING
    `, [userId]);
    return selectProfile(this.pool, userId);
  }

  async upsertProfile(userId: number, input: HealthProfilePatch) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      await client.query(`
        INSERT INTO user_health_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING
      `, [userId]);
      const previous = await selectProfile(client, userId);
      const result = await client.query(`
        UPDATE user_health_profiles SET
          gender = COALESCE($1, gender), age = COALESCE($2, age), height = COALESCE($3, height),
          weight = COALESCE($4, weight), target_weight = COALESCE($5, target_weight),
          health_goal = COALESCE($6, health_goal), activity_level = COALESCE($7, activity_level),
          dietary_preference = COALESCE($8, dietary_preference),
          allergies_json = COALESCE($9::jsonb, allergies_json), medications = COALESCE($10, medications),
          medical_conditions_json = COALESCE($11::jsonb, medical_conditions_json),
          medical_notes = COALESCE($12, medical_notes),
          dietary_restrictions_json = COALESCE($13::jsonb, dietary_restrictions_json),
          disliked_foods = COALESCE($14, disliked_foods),
          kitchen_constraints_json = COALESCE(kitchen_constraints_json, '{}'::jsonb) || COALESCE($15::jsonb, '{}'::jsonb),
          nutrition_targets_json = COALESCE($16::jsonb, nutrition_targets_json),
          tracking_enabled = COALESCE($17, tracking_enabled), updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $18 RETURNING *
      `, [
        optional(input.gender), optional(input.age), optional(input.height), optional(input.weight), optional(input.target_weight),
        optional(input.health_goal), optional(input.activity_level), optional(input.dietary_preference), json(input.allergies_json),
        optional(input.medications), json(input.medical_conditions_json), optional(input.medical_notes),
        json(input.dietary_restrictions_json), optional(input.disliked_foods), json(input.kitchen_constraints_json),
        json(input.nutrition_targets_json), optional(input.tracking_enabled), userId,
      ]);
      const profile = result.rows[0] as Record<string, unknown>;
      const target = calorieTarget(profile);
      await client.query("UPDATE user_health_profiles SET profile_version=profile_version+1,safety_status=$1,nutrition_target_source=$2 WHERE user_id=$3", [legacySafetyStatus(profile), input.nutrition_targets_json === undefined || target.value === calorieTarget(previous).value ? profile.nutrition_target_source : target.value == null ? "unset" : "legacy_unconfirmed", userId]);
      if (input.nutrition_targets_json !== undefined) await client.query("UPDATE users SET daily_calories_target=$1 WHERE id=$2", [target.value, userId]);
      if (input.nutrition_targets_json !== undefined && target.value !== calorieTarget(previous).value) await client.query("UPDATE user_health_profiles SET nutrition_target_version=NULL WHERE user_id=$1", [userId]);
      await this.writeCurrentWeight(client, userId, input.weight);
      const updated = await selectProfile(client, userId);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
