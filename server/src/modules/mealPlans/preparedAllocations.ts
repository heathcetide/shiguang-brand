import { cookingPlanDraftSchema, type CookingPlanDraft, type PreparedMeal } from "@dietdigidose/contracts";
import { parseJson, type Row } from "./formatters.js";

export function activePreparedAllocations(plans: Row[]) {
  return plans.flatMap<{ preparedMealId: string; servings: number }>(plan => {
    if (Array.isArray(plan.prepared_allocations)) return plan.prepared_allocations.filter(row => row.status === "active" || row.status === "conflict")
      .map(row => ({ preparedMealId: String(row.preparedMealId), servings: row.status === "conflict" ? Number.MAX_SAFE_INTEGER : Number(row.remainingServings) }));
    const constraints = parseJson<Row>(plan.constraints_json, {});
    const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
    const draft = cookingPlanDraftSchema.safeParse(constraints.currentCookingDraft ?? saved?.draft);
    return draft.success ? draft.data.meals.flatMap(meal => meal.allocations) : [];
  });
}

/** A plan reserves portions until it is explicitly changed or cancelled, even after its date. */
export function unallocatedPreparedMeals(prepared: PreparedMeal[], plans: Row[]) {
  const reserved = new Map<string, number>();
  for (const item of activePreparedAllocations(plans)) {
    reserved.set(item.preparedMealId, (reserved.get(item.preparedMealId) ?? 0) + item.servings);
  }
  return prepared.map(meal => ({ ...meal, remaining_servings: Math.max(0,
    Math.round((meal.remaining_servings - (reserved.get(meal.id) ?? 0)) * 1_000_000) / 1_000_000) }));
}

export function preparedAllocationsAvailable(targets: CookingPlanDraft["meals"], prepared: PreparedMeal[], plans: Row[]) {
  const available = new Map(unallocatedPreparedMeals(prepared, plans).map(meal => [meal.id, meal]));
  const labels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
  for (const target of targets) for (const allocation of target.allocations) {
    const meal = available.get(allocation.preparedMealId);
    if (!meal || meal.is_reserved || meal.version !== allocation.version
      || (meal.planned_date && meal.planned_date !== target.date)
      || (meal.meal_type && ![target.mealType, labels[target.mealType]].includes(meal.meal_type))
      || meal.produced_at.slice(0, 10) > target.date
      || allocation.servings > meal.remaining_servings + 0.000001) return false;
    meal.remaining_servings = Math.round((meal.remaining_servings - allocation.servings) * 1_000_000) / 1_000_000;
  }
  return true;
}
