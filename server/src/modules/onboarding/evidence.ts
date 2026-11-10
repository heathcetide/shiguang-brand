import type { OnboardingCompletion, OnboardingTask } from "@dietdigidose/contracts";
import { confirmedNutrition, validPlan, type Baseline, type OnboardingRecord } from "./domain.js";

type ReadRows = (sql: string, values: Array<string | number>) => Promise<Array<Record<string, unknown>>>;

// Capture database cursors, rather than relying on second-resolution created_at timestamps.
// This prevents an earlier save in the same second from completing a newly selected task.
export async function captureBaseline(read: ReadRows, userId: number, task: OnboardingTask): Promise<Baseline> {
  if (task === "inventory" || task === "diet_record") {
    const table = task === "inventory" ? "inventory_items" : "diet_records";
    const rows = await read(`SELECT MAX(id) AS max_id FROM ${table} WHERE user_id = ?`, [userId]);
    return { afterId: Number(rows[0]?.max_id ?? 0) };
  }
  if (task === "nutrition") {
    const rows = await read("SELECT profile_version FROM user_health_profiles WHERE user_id = ?", [userId]);
    return { profileVersion: Number(rows[0]?.profile_version ?? 0) };
  }
  const rows = await read("SELECT id, version FROM meal_plans WHERE user_id = ?", [userId]);
  return { planVersions: Object.fromEntries(rows.map(row => [String(row.id), Number(row.version)])) };
}

export async function findCompletion(read: ReadRows, userId: number, current: OnboardingRecord, requested?: OnboardingCompletion): Promise<OnboardingCompletion | null> {
  const task = current.state.selectedTask;
  if (!task || !current.state.startedAt || requested && requested.task !== task) return null;
  if (task === "inventory" || task === "diet_record") {
    const table = task === "inventory" ? "inventory_items" : "diet_records";
    const extra = task === "inventory" ? " AND deleted_at IS NULL" : "";
    const idClause = requested ? " AND CAST(id AS TEXT) = ?" : "";
    const values: Array<string | number> = [userId, current.baseline.afterId ?? 0];
    if (requested) values.push(requested.resourceId);
    const rows = await read(`SELECT id FROM ${table} WHERE user_id = ? AND id > ? AND TRIM(food_name) <> ''${extra}${idClause} ORDER BY id LIMIT 1`, values);
    return rows[0] ? { task, resourceId: String(rows[0].id) } : null;
  }
  if (task === "nutrition") {
    const rows = await read("SELECT id, nutrition_targets_json, nutrition_target_source, nutrition_target_version FROM user_health_profiles WHERE user_id = ?", [userId]);
    const row = rows[0];
    return row && confirmedNutrition(row, current.baseline) && (!requested || requested.resourceId === String(row.id)) ? { task, resourceId: String(row.id) } : null;
  }
  const rows = await read(`SELECT p.*, (SELECT COUNT(*) FROM meal_plan_items i WHERE i.plan_id=p.id AND i.user_id=p.user_id AND i.deleted_at IS NULL AND TRIM(i.title) <> '') AS item_count
    FROM meal_plans p WHERE p.user_id = ? AND p.deleted_at IS NULL AND p.status <> 'cancelled'${requested ? " AND p.id = ?" : ""} ORDER BY p.created_at, p.id`, requested ? [userId, requested.resourceId] : [userId]);
  const row = rows.find(plan => Number(plan.version) > (current.baseline.planVersions?.[String(plan.id)] ?? 0) && validPlan(plan));
  return row ? { task, resourceId: String(row.id) } : null;
}
