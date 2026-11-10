import { mealProductionSchema } from "@dietdigidose/contracts";
import type { MealPlanItem } from "@/services/api/mealPlans";

export function buildMealPlanProduction(item: MealPlanItem, produced: string, eaten: string) {
  const producedServings = Number(produced);
  return mealProductionSchema.parse({
    food_name: item.title,
    produced_servings: producedServings,
    eaten_servings: Number(eaten),
    meal_type: item.mealType,
    planned_date: item.plannedDate,
    // Recipe nutrition has no verified serving basis for a multi-serving batch.
    nutrition_per_serving: producedServings === 1 ? item.nutrition : {},
  });
}
