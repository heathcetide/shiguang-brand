import type Database from "better-sqlite3";
import { jsonObject } from "../modules/health/projections.js";

export const healthProfileMigration = {
  version: 84,
  name: "health_profile_versions_and_canonical_targets",
  up(database: Database.Database) {
    const columns = new Set((database.prepare("PRAGMA table_info(user_health_profiles)").all() as { name: string }[]).map(row => row.name));
    for (const [name, definition] of [["profile_version", "INTEGER NOT NULL DEFAULT 1"], ["nutrition_target_source", "TEXT NOT NULL DEFAULT 'unset'"], ["nutrition_target_legacy_json", "TEXT NOT NULL DEFAULT '{}'"], ["nutrition_target_version", "INTEGER"], ["safety_status", "TEXT NOT NULL DEFAULT 'unknown'"]]) {
      if (!columns.has(name)) database.exec(`ALTER TABLE user_health_profiles ADD COLUMN ${name} ${definition}`);
    }
    database.prepare("INSERT OR IGNORE INTO user_health_profiles (user_id) SELECT id FROM users WHERE daily_calories_target IS NOT NULL").run();
    const rows = database.prepare("SELECT p.*,u.daily_calories_target FROM user_health_profiles p JOIN users u ON u.id=p.user_id").all() as Record<string, unknown>[];
    const update = database.prepare("UPDATE user_health_profiles SET nutrition_targets_json=?,nutrition_target_source=?,nutrition_target_legacy_json=?,safety_status=? WHERE user_id=?");
    for (const row of rows) {
      const targets = jsonObject(row.nutrition_targets_json);
      const legacy = row.daily_calories_target == null ? null : Number(row.daily_calories_target);
      const value = targets.calories_kcal == null ? legacy : Number(targets.calories_kcal);
      if (value != null) targets.calories_kcal = value;
      const hasList = (raw: unknown) => { try { const parsed = typeof raw === "string" ? JSON.parse(raw) : raw; return Array.isArray(parsed) && parsed.length > 0; } catch { return false; } };
      const provided = hasList(row.allergies_json) || hasList(row.dietary_restrictions_json) || hasList(row.medical_conditions_json) || Boolean(String(row.medications || "").trim());
      update.run(JSON.stringify(targets), value == null ? "unset" : "legacy_unconfirmed", JSON.stringify({ daily_calories_target: legacy, nutrition_targets: jsonObject(row.nutrition_targets_json) }), provided ? "provided" : "unknown", row.user_id);
      database.prepare("UPDATE users SET daily_calories_target=? WHERE id=?").run(value, row.user_id);
    }
  },
};
