import type { CookingPlanDraft, MealProduction } from "@dietdigidose/contracts";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { parseJson, queueMealType, type Row } from "./formatters.js";

export type ProductionTarget = { id: string; planId: string; targetMealId: string; version: number; servings: number; date: string; mealType: "breakfast" | "lunch" | "dinner" | "snack" };
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Group only explicit portions from one session; weekly meals remain separate sessions. */
export function commonProduction(item: Row, candidates: Row[]) {
  const constraints = parseJson<Row>(item.plan_constraints_json, {});
  const draft = (constraints.currentCookingDraft ?? (constraints.savedCookingDraft as { draft?: unknown } | undefined)?.draft) as CookingPlanDraft | undefined;
  const executions = constraints.executionItems as Record<string, CookingPlanDraft["cooking"][number]> | undefined;
  if (!draft || draft.planningMode === "weekly" || !executions?.[String(item.id)]) return null;
  const members = candidates.filter(row => row.plan_id === item.plan_id && row.recipe_id === item.recipe_id && row.status === "planned" && !row.queue_item_id && !row.dining_json && executions[String(row.id)]);
  if (members.length < 2 || !members.some(row => row.id === item.id)) return null;
  members.sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.id).localeCompare(String(b.id)));
  const targets: ProductionTarget[] = members.map(row => {
    const execution = executions[String(row.id)];
    const mealType = queueMealType(row.meal_type);
    if (!mealType || !(execution.servings > 0) || !Number.isFinite(execution.servings)) throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "共用制作的餐次份量不完整，请重新核对");
    return { id: String(row.id), planId: String(row.plan_id), targetMealId: execution.targetMealId, version: Number(row.version) + 1,
      servings: execution.servings, date: String(row.planned_date), mealType };
  });
  const demands = new Map<string, { name: string; amount: number; unit: string }>();
  for (const row of members) for (const demand of executions[String(row.id)].demands) {
    const key = JSON.stringify([demand.food_name, demand.unit]);
    const previous = demands.get(key);
    demands.set(key, { name: demand.food_name, unit: demand.unit, amount: round((previous?.amount ?? 0) + demand.amount_value) });
  }
  const units: Record<string, string> = { piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐" };
  return { targets, servings: round(targets.reduce((sum, target) => sum + target.servings, 0)),
    ingredients: [...demands.values()].map(demand => ({ name: demand.name, amount: `${demand.amount}${units[demand.unit] ?? demand.unit}` })) };
}

export function validateProductionTargets(targets: ProductionTarget[], rows: Row[], production: MealProduction, recipeId: number | null | undefined) {
  if (targets.length < 2 || new Set(targets.map(target => target.id)).size !== targets.length || rows.length !== targets.length
    || targets.some(target => !rows.some(row => String(row.id) === target.id && String(row.plan_id) === target.planId && Number(row.version) === target.version
      && row.plan_status === "active" && !row.deleted_at && !row.plan_deleted_at && !row.dining_json && row.status === "queued" && Number(row.recipe_id) === recipeId))) {
    throw new InventoryQuantityError("MEAL_SOURCE_CONFLICT", "共用制作的餐次已变化，请刷新后重新核对");
  }
  if (round(production.produced_servings) < round(targets.reduce((sum, target) => sum + target.servings, 0))) {
    throw new InventoryQuantityError("MEAL_PRODUCTION_INSUFFICIENT", "实际产出少于共用餐次的总份量，请先核对制作份量与安排");
  }
}

/** Eating now consumes the selected meal first; the rest retain their own dates. */
export function productionReservations(targets: ProductionTarget[], production: MealProduction, mealId: string): CookingPlanDraft["meals"] {
  let eaten = production.eaten_servings;
  const ordered = [...targets].sort((a, b) => Number(b.id === production.plan_item_id) - Number(a.id === production.plan_item_id));
  return ordered.flatMap(target => {
    const consumed = Math.min(eaten, target.servings);
    eaten = round(eaten - consumed);
    const servings = round(target.servings - consumed);
    return servings > 0 ? [{ id: target.targetMealId, date: target.date, mealType: target.mealType, servings, preparedServings: servings, cookServings: 0,
      allocations: [{ preparedMealId: mealId, version: 1, foodName: production.food_name, servings, validationRequired: true as const }] }] : [];
  });
}
