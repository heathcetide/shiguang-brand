import type { MealPlanRequirementsInput, PreparedMeal, RecipeHandling, MealHandlingCheck } from "@dietdigidose/contracts";
import { currentDateKey } from "../../utils/date.js";
import { evaluateHandling } from "./handling.js";

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

export function allocatePreparedMeals(input: MealPlanRequirementsInput, prepared: PreparedMeal[], rules = new Map<number, RecipeHandling>()) {
  const productionDate = input.productionDate ?? input.meals.map(meal => meal.date).sort()[0];
  const handlingChecks: MealHandlingCheck[] = [];
  const excluded = new Set(input.excludedPreparedMealIds);
  const remaining = new Map(prepared.map(meal => [meal.id, meal.remaining_servings]));
  const candidates = prepared.filter(meal => input.preferences?.avoid_spicy !== true && !meal.is_reserved && !excluded.has(meal.id) && meal.remaining_servings > 0)
    .sort((a, b) => a.produced_at.localeCompare(b.produced_at) || a.id.localeCompare(b.id));
  const meals = [...input.meals].sort((a, b) => a.date.localeCompare(b.date) || ["breakfast", "lunch", "dinner", "snack"].indexOf(a.mealType) - ["breakfast", "lunch", "dinner", "snack"].indexOf(b.mealType) || a.id.localeCompare(b.id)).map(target => {
    let required = target.servings;
    const allocations: Array<{ preparedMealId: string; version: number; foodName: string; servings: number; validationRequired: true }> = [];
    for (const batch of candidates) {
      if (required <= 0) break;
      if (batch.planned_date && batch.planned_date !== target.date) continue;
      if (batch.meal_type && ![target.mealType, mealLabels[target.mealType]].includes(batch.meal_type)) continue;
      const produced = new Date(batch.produced_at);
      if (Number.isFinite(produced.getTime()) && currentDateKey(produced) > target.date) continue;
      const handling = evaluateHandling(batch.recipe_id == null ? undefined : rules.get(batch.recipe_id), {
        targetMealId: target.id, recipeId: batch.recipe_id ?? null, preparedMealId: batch.id,
        productionDate: Number.isFinite(produced.getTime()) ? currentDateKey(produced) : "", targetDate: target.date,
        preferences: input.preferences ?? {}, storageLocation: batch.storage_location,
      });
      if (handling.status === "conflict") { handlingChecks.push(handling); continue; }
      const portions = Math.min(required, remaining.get(batch.id) ?? 0);
      if (portions <= 0) continue;
      handlingChecks.push(handling);
      allocations.push({ preparedMealId: batch.id, version: batch.version, foodName: batch.food_name, servings: portions, validationRequired: true });
      remaining.set(batch.id, round((remaining.get(batch.id) ?? 0) - portions));
      required = round(required - portions);
    }
    return { ...target, preparedServings: round(target.servings - required), cookServings: required, allocations };
  });
  return { productionDate, ...(input.reheatingDeviceIds ? { reheatingDeviceIds: input.reheatingDeviceIds } : {}), effectivePreferences: input.preferences ?? {}, handlingChecks: handlingChecks.slice(0, 2800), meals, totalCookServings: round(meals.reduce((total, meal) => total + meal.cookServings, 0)),
    status: "requires_validation" as const,
    checksPending: [...(input.preferences?.avoid_spicy === true && prepared.length ? ["待吃餐辣度未核实，本次不自动分配"] : []),"prepared_meal_storage_and_food_safety", "allergies_and_reheating", "recipe_quantities", "whole_plan_time"],
    excludedPreparedMealIds: prepared.filter(meal => meal.is_reserved || excluded.has(meal.id)).map(meal => meal.id) };
}
