import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { parseJson, type Row } from "./formatters.js";
import type { MealPlanItemUpdateInput } from "./types.js";

export type MealChangeDecision = "apply" | "suggest" | "keep";
export function mealChangeDecision(item: Row, queue: Row | undefined, purchases: Row[]): MealChangeDecision {
  if (["completed", "cooking", "queued"].includes(String(item.status)) || ["waiting", "preparing", "ready", "cooking", "completed"].includes(String(queue?.status))) return "keep";
  if (item.confirmed_at || purchases.some(row => Boolean(row.checked) || row.inventory_item_id != null)) return "suggest";
  return "apply";
}
export function mealChangeSnapshot(item: Row, queue: Row | undefined, purchases: Row[]) {
  return {
    title: String(item.recipe_title || item.title), version: Number(item.version), confirmedAt: item.confirmed_at instanceof Date ? item.confirmed_at.toISOString() : item.confirmed_at ?? null,
    queue: queue ? { id: queue.id, version: Number(queue.version), status: queue.status } : null,
    purchases: purchases.map(row => ({ id: row.id, version: Number(row.version), checked: Boolean(row.checked), inventoryItemId: row.inventory_item_id ?? null })),
    input: { dining: parseJson(item.dining_json,null),plannedDate: String(item.planned_date), mealType: String(item.meal_type), recipeId: item.recipe_id == null ? null : Number(item.recipe_id), status: item.status === "skipped" ? "skipped" as const : "planned" as const },
  };
}
export function mealChangeFingerprint(itemId: string, snapshot: unknown, input: MealPlanItemUpdateInput) {
  return createHash("sha256").update(JSON.stringify({ itemId, snapshot, input: {
    dining: input.dining === undefined ? "unchanged" : input.dining,plannedDate: input.plannedDate ?? null, mealType: input.mealType ?? null, recipeId: input.recipeId === undefined ? "unchanged" : input.recipeId, status: input.status ?? null,
  } })).digest("hex");
}
export function formatMealChange(row: Row) {
  return { id: String(row.id), itemId: String(row.item_id), reason: String(row.reason), source: String(row.source), status: String(row.status),
    before: parseJson<Row>(row.before_json, {}), after: parseJson<Row>(row.after_json, {}), beforeVersion: Number(row.before_version),
    afterVersion: row.after_version == null ? null : Number(row.after_version), createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at == null ? null : String(row.applied_at) };
}

export function isMealChangeNoop(item: Row, input: MealPlanItemUpdateInput) {
  return (input.dining === undefined || isDeepStrictEqual(input.dining,parseJson(item.dining_json,null)))
    && (input.plannedDate === undefined || input.plannedDate === item.planned_date)
    && (input.mealType === undefined || input.mealType === item.meal_type)
    && (input.recipeId === undefined || input.recipeId === (item.recipe_id == null ? null : Number(item.recipe_id)))
    && (input.status === undefined || input.status === item.status);
}

export type PlanMetadataEdit = { startDate?: string; endDate?: string; status?: string; constraints?: unknown; archive?: boolean };
export function planMetadataPreservesItem(item: Row, decision: MealChangeDecision, edit: PlanMetadataEdit) {
  if (item.status === "skipped") return true;
  if ((edit.startDate && String(item.planned_date) < edit.startDate) || (edit.endDate && String(item.planned_date) > edit.endDate)) return false;
  if (item.status === "completed") return true;
  const endsExecution = edit.archive || ["cancelled", "completed", "draft"].includes(edit.status ?? "");
  return !(decision !== "apply" && (endsExecution || edit.constraints !== undefined));
}
