import type { CookingPlanDraft, PreparedMeal, KitchenPreferences, MealHandlingCheck, RecipeHandling } from "@dietdigidose/contracts";
import { currentDateKey } from "../../utils/date.js";

export function preparedHandlingChecks(draft: CookingPlanDraft, prepared: PreparedMeal[], rules: Map<number, RecipeHandling>): MealHandlingCheck[] {
  const allocated = new Map<string, number>();
  for (const meal of draft.meals) for (const allocation of meal.allocations) allocated.set(allocation.preparedMealId, (allocated.get(allocation.preparedMealId) ?? 0) + allocation.servings);
  return draft.meals.flatMap(meal => meal.allocations.map(allocation => {
    const batch = prepared.find(item => item.id === allocation.preparedMealId);
    const produced = new Date(batch?.produced_at ?? "");
    const check = evaluateHandling(batch?.recipe_id == null ? undefined : rules.get(batch.recipe_id), {
      targetMealId: meal.id, recipeId: batch?.recipe_id ?? null, preparedMealId: allocation.preparedMealId,
      productionDate: Number.isFinite(produced.getTime()) ? currentDateKey(produced) : "", targetDate: meal.date,
      preferences: draft.effectivePreferences, storageLocation: batch?.storage_location,
    });
    if (!batch || batch.version !== allocation.version || batch.is_reserved || batch.remaining_servings < allocated.get(allocation.preparedMealId)!) {
      check.status = "conflict"; check.reasons.push("待吃餐已变化或不可用，请重新生成分配");
    }
    return check;
  }));
}

/** Matches reviewed planning conditions, never certifies the actual food or cold chain. */
export function evaluateHandling(rule: RecipeHandling | undefined, context: {
  targetMealId: string; recipeId: number | null; productionDate: string; targetDate: string;
  preferences: KitchenPreferences; preparedMealId?: string; storageLocation?: string | null;
}): MealHandlingCheck {
  const result: MealHandlingCheck = { targetMealId: context.targetMealId, recipeId: context.recipeId,
    ...(context.preparedMealId ? { preparedMealId: context.preparedMealId } : {}), status: "pending", reasons: [],
    reference: rule?.reference ?? null, sourceUrl: rule?.sourceUrl ?? null, instructions: rule?.instructions ?? null };
  if (!rule) { result.reasons.push("缺少该菜谱的存放、携带和复热审核依据"); return result; }
  const days = (Date.parse(context.targetDate) - Date.parse(context.productionDate)) / 86_400_000;
  const conflicts: string[] = [], missing: string[] = [];
  if (!Number.isFinite(days) || days < 0) conflicts.push("目标餐次早于制作日期或日期未知");
  if (context.preferences.carry_meals === true) {
    if (!rule.carryAllowed) conflicts.push("该审核规则不支持携带");
    else missing.push("携带时的包装、途中温度与到达后的存放仍须核对");
  }
  if (rule.storage === "fresh_only") {
    if (days > 0) conflicts.push("该菜谱仅支持现做现吃，不能安排到制作日之后");
    if (context.preparedMealId) missing.push("现做现吃规则不能证明这份已做餐仍适用");
  } else if (days > 0 || context.preparedMealId || context.preferences.carry_meals === true) {
    // Dates lack a serving time. Cover the entire target day instead of assuming midnight consumption.
    if ((days + 1) * 24 > rule.maxHoldHours) conflicts.push(`餐次日期不能保证落在审核的 ${rule.maxHoldHours} 小时冷藏期限内`);
    if (context.preferences.refrigeration_available === false) conflicts.push("已明确没有所需的冷藏条件");
    else if (context.preferences.refrigeration_available !== true) missing.push("冷藏条件尚未确认");
    if (!rule.coldServingAllowed) {
      if (context.preferences.reheating_available === false) conflicts.push("该菜谱需复热，但已明确没有复热条件");
      else if (context.preferences.reheating_available !== true) missing.push("复热条件尚未确认");
      missing.push("食用前的复热设备、用时与实际温度仍须核对");
    }
    if (context.preparedMealId && context.storageLocation === "常温") conflicts.push("已做餐记录为常温存放，与冷藏审核条件冲突");
    if (context.preparedMealId && context.storageLocation !== "冷藏") missing.push("已做餐缺少与该冷藏规则相符的实际存放记录");
  }
  if (context.preparedMealId) missing.push("已做餐的实际冷却、存放温度和冷链连续性尚未核实");
  result.reasons = [...new Set([...conflicts, ...missing])];
  result.status = conflicts.length ? "conflict" : missing.length ? "pending" : "conditions_match";
  return result;
}
