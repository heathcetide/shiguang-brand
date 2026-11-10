import { activeMealChangePreviewSchema } from "@dietdigidose/contracts";
import type { ActiveMealChangePreviewInput, ActiveMealChangePreview } from "@dietdigidose/contracts";
import { inputSnapshot, maintenanceRuleTables, type MaintenanceInputSnapshot } from "../planMaintenance/inputSnapshot.js";
import { snapshotKitchenware } from "../planMaintenance/snapshotKitchenware.js";
import { currentDateKey } from "../../utils/date.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { parseJson, type Row } from "./formatters.js";
import type { MealPlanItemUpdateInput } from "./types.js";
import { evaluateActiveReplacement } from "./activeReplacement.js";

// Match maintenance's lock order. Read-only computation is kept out of write transactions.
export const replacementInputTables = ["inventory_items", "inventory_change_logs", "prepared_meals", "meal_plans", "meal_plan_items",
  "shopping_list_items", "cooking_queue_items", "user_health_profiles", "kitchenware_items", "prepared_meal_allocations"] as const;
export { maintenanceRuleTables as replacementRuleTables };
export type ReplacementSnapshot = MaintenanceInputSnapshot;
export function replacementRecipeIds(data: Record<string, Row[]>, input: ActiveMealChangePreviewInput) {
  const ids = data.meal_plan_items.map(item => Number(item.recipe_id));
  if ("patch" in input && input.patch.recipeId) ids.push(input.patch.recipeId);
  for (const change of data.meal_plan_changes ?? []) {
    ids.push(Number(parseJson<Row>(change.after_json, {}).recipeId));
    ids.push(Number(parseJson<{ input?: Row }>(change.before_json, {}).input?.recipeId));
  }
  for (const plan of data.meal_plans) for (const item of Object.values(parseJson<Row>(plan.constraints_json, {}).executionItems ?? {}) as Row[]) {
    if (item.substitution) ids.push(Number((item.substitution as Row).sourceRecipeId));
  }
  return [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))].sort((a,b) => a-b);
}
export function finalizeReplacementSnapshot(userId: number, data: Record<string, Row[]>, input: ActiveMealChangePreviewInput) {
  return inputSnapshot(userId, replacementRecipeIds(data, input), data);
}
export function replacementRequiresValidation(current: Row, input: MealPlanItemUpdateInput) {
  if (input.status === "skipped") return input.recipeId !== undefined && input.recipeId !== current.recipe_id;
  return (input.recipeId !== undefined && input.recipeId !== current.recipe_id)
    || (input.plannedDate !== undefined && input.plannedDate !== current.planned_date)
    || (input.mealType !== undefined && input.mealType !== current.meal_type)
    || (input.status === "planned" && current.status === "skipped");
}
export type PreparedReplacement = {
  snapshotFingerprint: string; preview: ActiveMealChangePreview; input: MealPlanItemUpdateInput; today: string;
  result: ReturnType<typeof evaluateActiveReplacement>;
};
export async function prepareReplacement(snapshot: ReplacementSnapshot, userId: number, planId: string, itemId: string, request: ActiveMealChangePreviewInput): Promise<PreparedReplacement | null> {
  const plan = snapshot.data.meal_plans.find(row => row.id === planId && !row.deleted_at);
  const item = snapshot.data.meal_plan_items.find(row => row.id === itemId && row.plan_id === planId && !row.deleted_at);
  if (!plan || !item) return null;
  let input: MealPlanItemUpdateInput;
  if ("patch" in request) input = request.patch;
  else {
    const change = snapshot.data.meal_plan_changes.find(row => row.id === request.changeId && row.plan_id === planId && row.item_id === itemId);
    if (!change) return null;
    input = request.action === "restore" ? { ...parseJson<{ input: MealPlanItemUpdateInput }>(change.before_json, { input: { version: 0 } }).input, version: Number(change.after_version) }
      : { ...parseJson<MealPlanItemUpdateInput>(change.after_json, { version: 0 }), version: Number(change.before_version) };
  }
  delete input.validationFingerprint;
  const data = structuredClone(snapshot.data);
  const kitchen = snapshotKitchenware(snapshot);
  data.recipe_compatibility = await Promise.all(snapshot.recipeIds.map(async recipeId => ({ recipe_id: recipeId, ...await kitchen.evaluateRequirements(userId, recipeId) })));
  const today = currentDateKey();
  const result = evaluateActiveReplacement({ userId, plan, items: data.meal_plan_items.filter(row => row.plan_id === planId), input, itemId, data, today });
  const identity = "patch" in request ? { patch: input } : { changeId: request.changeId, action: request.action, patch: input };
  const fingerprint = inputSnapshot(userId,snapshot.recipeIds,{ operation: [{ version: 1,planId,itemId,today,snapshot: snapshot.fingerprint,identity }] }).fingerprint;
  return { snapshotFingerprint: snapshot.fingerprint, input, today, result, preview: activeMealChangePreviewSchema.parse({
    fingerprint, planVersion: Number(plan.version), itemVersion: Number(item.version), canApply: result.canApply,
    scope: result.scope, checks: result.checks, ingredientBudget: result.ingredientBudget, time: result.time,
  }) };
}
export function assertReplacementValidation(prepared: PreparedReplacement | null | undefined, actual: ReplacementSnapshot | undefined, fingerprint?: string) {
  if (!fingerprint || !prepared) throw new InventoryQuantityError("MEAL_PLAN_PREVIEW_REQUIRED", "请先预览整套餐单的原料、时间与限制，再确认这次变更；原安排已保留");
  if (!actual || actual.fingerprint !== prepared.snapshotFingerprint || fingerprint !== prepared.preview.fingerprint || currentDateKey() !== prepared.today)
    throw new InventoryQuantityError("MEAL_PLAN_PREVIEW_CHANGED", "餐单、库存或验证证据已变化，请重新预览；原安排已保留");
  if (!prepared.preview.canApply) throw new InventoryQuantityError("MEAL_PLAN_REVALIDATION_BLOCKED", prepared.preview.checks.filter(check => check.severity !== "info").map(check => check.message).join("；").slice(0,1000) || "这次变更仍有未核实条件，原安排已保留");
}
export type ReplacementContext = { prepared: PreparedReplacement | null; request: ActiveMealChangePreviewInput; actual?: ReplacementSnapshot };
export function replacementPatchRequest(input: MealPlanItemUpdateInput): ActiveMealChangePreviewInput {
  const { validationFingerprint: _fingerprint, ...patch } = input;
  return { patch };
}
