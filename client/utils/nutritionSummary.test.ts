import { formatNutritionSummary, summarizeNutrition } from "./nutritionSummary";

test("nutrition summaries distinguish absent, unknown, partial and zero records", () => {
  expect(summarizeNutrition([])).toEqual({ total: null, incomplete: false });
  expect(summarizeNutrition([null, undefined])).toEqual({ total: null, incomplete: true });
  expect(formatNutritionSummary(summarizeNutrition([null, 120, 80]), " kcal")).toBe("已知 200 kcal");
  expect(formatNutritionSummary(summarizeNutrition([0]), "g")).toBe("0g");
  expect(formatNutritionSummary(summarizeNutrition([null]), "g")).toBe("未知");
});

test("display removes floating point noise without rounding small nutrients to zero", () => {
  const summary = summarizeNutrition([0.1, 0.2]);
  expect(summary.total).toBe(0.1 + 0.2);
  expect(formatNutritionSummary(summary, " g")).toBe("0.3 g");
  expect(formatNutritionSummary(summarizeNutrition([0.04]), " kcal")).toBe("0.04 kcal");
  expect(formatNutritionSummary(summarizeNutrition([null, 0.01, 0.03]), " kcal")).toBe("已知 0.04 kcal");
});
