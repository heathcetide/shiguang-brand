import { z } from "zod";

export const kitchenPreferencesSchema = z.object({
  avoid_spicy: z.boolean().nullable().optional().describe("明确不吃辣；本次条件只作用于请求，不覆盖长期设置"),
  meal_time_minutes: z.number().int().min(5).max(300).nullable().optional(),
  budget_per_meal: z.number().finite().min(0).max(100_000).nullable().optional(),
  cooking_level: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  servings: z.number().int().min(1).max(30).nullable().optional(),
  eating_out_frequency: z.enum(["rarely", "sometimes", "often"]).nullable().optional(),
  usual_meals: z.array(z.enum(["breakfast", "lunch", "dinner", "snack"])).max(4).optional(),
  eating_location: z.enum(["home", "work", "school", "other"]).nullable().optional(),
  carry_meals: z.boolean().nullable().optional(),
  refrigeration_available: z.boolean().nullable().optional(),
  reheating_available: z.boolean().nullable().optional(),
}).strict();
export type KitchenPreferences = z.infer<typeof kitchenPreferencesSchema>;

// The override is request-local; this helper never mutates stored preferences.
export function resolveKitchenPreferences(stored: KitchenPreferences = {}, override: KitchenPreferences = {}) {
  const effective = { ...stored, ...override };
  return { ...effective, meal_time_minutes: effective.meal_time_minutes ?? 30 };
}
