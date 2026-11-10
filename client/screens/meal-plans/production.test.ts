import { buildMealPlanProduction } from "./production";
import type { MealPlanItem } from "@/services/api/mealPlans";

const item = {
  title: "番茄炒蛋", mealType: "午餐", plannedDate: "2026-09-12",
  nutrition: { calories: 320, protein: 18, carbs: 12, fat: 22 },
} as MealPlanItem;

it.each(["0", "0.5", "1"])("preserves known nutrition for one produced serving with %s eaten", eaten => {
  const production = buildMealPlanProduction(item, "1", eaten);
  expect(production.nutrition_per_serving).toEqual(item.nutrition);
  expect(production.eaten_servings).toBe(Number(eaten));
});

it("keeps unknown nutrients unknown", () => {
  const nutrition = { calories: 320, protein: null, carbs: null, fat: null };
  expect(buildMealPlanProduction({ ...item, nutrition }, "1", "1").nutrition_per_serving).toEqual(nutrition);
});

it("does not infer per-serving nutrition for a multi-serving batch", () => {
  expect(buildMealPlanProduction(item, "2", "1").nutrition_per_serving).toEqual({});
});

it("rejects eating more than the produced amount", () => {
  expect(() => buildMealPlanProduction(item, "1", "2")).toThrow();
});
