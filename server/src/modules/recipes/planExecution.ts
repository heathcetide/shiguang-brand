import { isDeepStrictEqual } from "node:util";
import { cookingPlanDraftSchema, type CookingPlanDraft } from "@dietdigidose/contracts";
import { executionRecipeKey, executionReviewKey } from "./execution.js";
import { cookingEvidenceMatches } from "./substitutions.js";
import { recipeDemands } from "../recommendations/quantities.js";
import { parseJson, type Row } from "../mealPlans/formatters.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";

export const recipeExecutionProof = (target: Row, source?: Row) => ({
  recipeKey: executionRecipeKey(target), reviewKey: executionReviewKey(target),
  source: source ? { recipeKey: executionRecipeKey(source), reviewKey: executionReviewKey(source) } : null,
});
const rawAllocation = (item: Row) => (parseJson<Row>(item.plan_constraints_json, {}).executionItems as Record<string, CookingPlanDraft["cooking"][number]> | undefined)?.[String(item.id)];
const allocation = (item: Row) => { const parsed = cookingPlanDraftSchema.shape.cooking.element.safeParse(rawAllocation(item)); return parsed.success ? parsed.data : null; };
export function planExecutionRecipeIds(items: Row[]) {
  return [...new Set(items.flatMap(item => { const entry = allocation(item); return entry ? [entry.recipeId, ...(entry.substitution ? [entry.substitution.sourceRecipeId] : [])] : []; }))].sort((a, b) => a - b);
}

/** Current content and audit are checked inside each execution write transaction. */
export function assertPlanExecution(items: Row[], recipes: Map<number, Row>) {
  const fail = () => { throw new InventoryQuantityError("MEAL_RECIPE_CHANGED", "菜谱内容或审核已变化，请重新生成并核对方案；原安排和库存未改变"); };
  for (const item of items) {
    const constraints = parseJson<Row>(item.plan_constraints_json, {});
    const entry = allocation(item);
    if (!entry) { if (constraints.activatedFromVersion != null || rawAllocation(item) !== undefined) fail(); continue; }
    const target = recipes.get(entry.recipeId), source = recipes.get(entry.substitution?.sourceRecipeId ?? 0);
    if (Number(item.recipe_id) !== entry.recipeId || target?.title !== entry.title || !cookingEvidenceMatches(entry, source, target)) fail();
    const captured = (constraints.executionRecipeKeys as Record<string, ReturnType<typeof recipeExecutionProof>> | undefined);
    if (captured !== undefined && !isDeepStrictEqual(captured?.[String(item.id)], recipeExecutionProof(target!, source))) fail();
    // Legacy activated plans have no hash: still check captured steps and scaled quantities.
    if (!isDeepStrictEqual(parseJson(item.steps_json, []), parseJson(target!.steps_json, []))) fail();
    const actual = recipeDemands(parseJson(item.ingredients_json, []), entry.servings, entry.servings);
    const sorted = (demands: NonNullable<typeof actual>) => demands.map(demand => ({ ...demand, amount_value: Number(demand.amount_value.toFixed(6)) })).sort((a, b) => a.food_name.localeCompare(b.food_name));
    if (!actual || !isDeepStrictEqual(sorted(actual), sorted(entry.demands))) fail();
  }
}
