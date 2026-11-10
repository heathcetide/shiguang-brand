import type { PreparedMeal } from "@dietdigidose/contracts";

/** Completed meals remain as versioned tombstones so an old replay cannot revive them. */
export function mergePreparedMeals(current: PreparedMeal[], incoming: PreparedMeal[], refreshAllocations = false): PreparedMeal[] {
  const meals = new Map(current.map(meal => [meal.id, meal]));
  for (const meal of incoming) {
    const previous = meals.get(meal.id);
    if (!previous || meal.version > previous.version) meals.set(meal.id, meal);
    else if (refreshAllocations && meal.version === previous.version && meal.allocations !== undefined) meals.set(meal.id, { ...previous, allocations: meal.allocations });
  }
  return [...meals.values()];
}
