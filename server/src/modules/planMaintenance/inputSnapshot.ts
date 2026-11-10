import { createHash } from "node:crypto";
import { parseJson, type Row } from "../mealPlans/formatters.js";

/** Only account-owned planning inputs. Task bookkeeping is deliberately excluded. */
export const maintenanceInputTables = [
  "inventory_items", "inventory_change_logs", "prepared_meals", "meal_plans", "meal_plan_items",
  "shopping_list_items", "cooking_queue_items", "user_health_profiles", "kitchenware_items",
  "plan_maintenance_settings", "recommendation_learning_settings", "recipe_favorites", "diet_records",
  "prepared_meal_allocations", "meal_plan_changes",
] as const;
/** Shared governance inputs are read-only during planning, but part of validation. */
export const maintenanceRuleTables = ["kitchenware_catalog","kitchenware_capabilities","kitchenware_catalog_capabilities",
  "kitchenware_substitutions","recipe_kitchenware_requirements"] as const;
export type MaintenanceInputSnapshot = { fingerprint: string; recipeIds: number[]; data: Record<string,Row[]> };
const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

export function maintenanceRecipeIds(recipeIds: number[], data: Record<string, Row[]>): number[] {
  const ids: number[] = [...recipeIds];
  for (const item of data.meal_plan_items ?? []) {
    if (item?.recipe_id != null) ids.push(Number(item.recipe_id));
  }
  for (const change of data.meal_plan_changes ?? []) {
    if (change?.status !== "pending") continue;
    const after = parseJson<unknown>(change.after_json, null);
    if (isRecord(after) && after.recipeId != null) ids.push(Number(after.recipeId));
  }
  for (const plan of data.meal_plans ?? []) {
    const constraints = parseJson<unknown>(plan?.constraints_json, null);
    if (isRecord(constraints) && isRecord(constraints.executionItems)) {
      for (const item of Object.values(constraints.executionItems)) {
        if (isRecord(item)) {
          const sub = parseJson<unknown>(item.substitution, null);
          if (isRecord(sub) && sub.sourceRecipeId != null) ids.push(Number(sub.sourceRecipeId));
        }
      }
    }
  }
  return [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
export function inputSnapshot(userId: number, recipeIds: number[], data: Record<string,Row[]>): MaintenanceInputSnapshot {
  const ids = [...new Set(recipeIds)].sort((a,b) => a-b);
  if (ids.some(id => !Number.isSafeInteger(id) || id<=0)) throw new Error("Invalid recipe input IDs");
  const normalized = Object.fromEntries(Object.entries(data).map(([key,rows]) => [key,rows.map(row => canonical(row)).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  return { recipeIds: ids,data: structuredClone(data),fingerprint: createHash("sha256").update(JSON.stringify(canonical({ userId,recipeIds: ids,data: normalized }))).digest("hex") };
}
