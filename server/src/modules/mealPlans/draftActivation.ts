import { randomUUID } from "node:crypto";
import { cookingPlanDraftSchema } from "@dietdigidose/contracts";
import { parseJson, type Row } from "./formatters.js";

export function prepareDraftActivation(current: Row, version: number) {
  const constraints = parseJson<Row>(current.constraints_json, {});
  if (constraints.activatedFromVersion === version) return { repeated: true as const, constraints, items: [] };
  if (current.status !== "draft" || Number(current.version) !== version) return null;
  const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
  const parsed = cookingPlanDraftSchema.safeParse(constraints.currentCookingDraft ?? saved?.draft);
  if (!parsed.success || parsed.data.unresolved.length) return null;
  const units: Record<string, string> = { piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐" };
  const items = parsed.data.cooking.map(cooking => {
    const target = parsed.data.meals.find(meal => meal.id === cooking.targetMealId)!;
    return { id: randomUUID(), recipeId: cooking.recipeId, title: cooking.title, date: target.date, mealType: ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" })[target.mealType],
      ingredients: cooking.demands.map(demand => ({ name: demand.food_name, amount: `${Number(demand.amount_value.toFixed(6))}${units[demand.unit] ?? demand.unit}` })),
      allocation: { ...cooking, plannedDate: target.date, mealType: target.mealType } };
  });
  return { repeated: false as const, weekly: parsed.data.planningMode === "weekly", targets: parsed.data.meals, items, constraints: { ...constraints, activatedFromVersion: version,
    executionItems: Object.fromEntries(items.map(item => [item.id, item.allocation])) } };
}
