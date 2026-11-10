import { parseJson, type Row } from "../mealPlans/formatters.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";

/** A conservative sequential subtotal, never a guarantee including unknown cleanup/capacity. */
export function maintenanceSessionTime(snapshot: MaintenanceInputSnapshot, item: Row, budgetMinutes: number) {
  const plan = snapshot.data.meal_plans.find(row => row.id === item.plan_id);
  const constraints = parseJson<Row | null>(plan?.constraints_json,{}) ?? {};
  const allocations = constraints.executionItems as Record<string,Row> | undefined;
  const rows = snapshot.data.meal_plan_items.filter(row => row.plan_id === item.plan_id && row.planned_date === item.planned_date && row.meal_type === item.meal_type
    && !row.deleted_at && !["completed","skipped"].includes(String(row.status)) && !String(row.id).startsWith("reserved-original:"));
  let knownSequentialMinutes = 0;
  let preparationOrCookingUnknown = false;
  for (const row of rows) {
    const recipe = snapshot.data.recipes.find(value => Number(value.id) === Number(row.recipe_id));
    const yieldServings = Number(recipe?.serving_size);
    const servings = Number(allocations?.[String(row.id)]?.servings ?? recipe?.serving_size);
    const cooking = Number(recipe?.cook_time), preparation = Number(recipe?.prep_time);
    if (!recipe || !Number.isFinite(yieldServings) || yieldServings<=0 || !Number.isFinite(servings) || servings<=0
      || !Number.isFinite(cooking) || cooking<=0 || recipe.prep_time == null || !Number.isFinite(preparation) || preparation<0) {
      preparationOrCookingUnknown = true; continue;
    }
    knownSequentialMinutes += (cooking+preparation)*Math.ceil(servings/yieldServings);
  }
  return { budgetMinutes,knownSequentialMinutes,exceedsBudget: knownSequentialMinutes>budgetMinutes,
    preparationOrCookingUnknown,isEstimate: true as const,incomplete: true as const,
    missing: ["cleanup","equipment_capacity",...(preparationOrCookingUnknown ? ["preparation_or_cooking"] : [])] };
}
