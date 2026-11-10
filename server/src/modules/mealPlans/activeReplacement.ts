import { quantityEvidenceStatus } from "../inventory/evidence.js";
import { cookingPlanDraftSchema, type CookingPlanDraft } from "@dietdigidose/contracts";
import { assertPlanExecution } from "../recipes/planExecution.js";
import { reviewedExecution } from "../recipes/execution.js";
import { createPlanningBudget } from "../recommendations/planningBudget.js";
import { mealTime } from "../recommendations/plan.js";
import { evaluateHandling } from "../recommendations/handling.js";
import { formatRecommendationProfile, scoreRecipeRecommendations } from "../recommendations/scoring.js";
import type { RecommendationDataset } from "../recommendations/types.js";
import { parseJson, type Row } from "./formatters.js";
import { replacementAllocation } from "./replacementAllocation.js";
import type { MealPlanItemUpdateInput } from "./types.js";

export type ActiveReplacementCheck = { code: string; severity: "blocked" | "pending" | "info"; itemIds: string[]; message: string };
export type ActiveReplacementArguments = { userId: number; plan: Row; items: Row[]; input: MealPlanItemUpdateInput; itemId: string; data: Record<string, Row[]>; today: string };
const terminal = (item: Row) => ["completed", "skipped"].includes(String(item.status));
const owned = (row: Row, userId: number) => Number(row.user_id) === userId;
const mealTypes: Record<string, "breakfast" | "lunch" | "dinner" | "snack"> = { 早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 加餐: "snack", breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack" };

/** Read-only revalidation of the actual active rows, never of the old draft's meals. */
export function evaluateActiveReplacement({ userId, plan, items, input, itemId, data, today }: ActiveReplacementArguments) {
  const checks: ActiveReplacementCheck[] = [];
  const add = (code: string, severity: ActiveReplacementCheck["severity"], message: string, itemIds = [itemId]) => checks.push({ code, severity, itemIds, message });
  const scope = { kind: "current_plan_window" as const, startDate: String(plan.start_date), endDate: String(plan.end_date) };
  let allocation: { ingredients: unknown; constraints: Row & { executionItems: Record<string, Row> } } | null = null;
  let ingredientBudget: ReturnType<ReturnType<typeof createPlanningBudget>["consume"]> = [];
  let time: CookingPlanDraft["time"] | null = null;
  const finish = () => ({ canApply: !checks.some(check => check.severity !== "info"), checks, scope, ingredientBudget, time, allocation });
  const current = items.find(item => String(item.id) === itemId && String(item.plan_id) === String(plan.id));
  if (!owned(plan, userId) || plan.status !== "active" || !current) { add("active_plan_required", "blocked", "只能验证本人已激活餐单中的餐次"); return finish(); }
  if (Number(current.version) !== input.version) { add("version_conflict", "blocked", "餐次版本已变化，请刷新后重新预览"); return finish(); }
  if (!["planned", "skipped"].includes(String(current.status)) || (data.cooking_queue_items ?? []).some(row => (String(row.source_plan_item_id) === itemId || (current.queue_item_id != null && String(row.id) === String(current.queue_item_id))) && !row.deleted_at && !["completed", "cancelled"].includes(String(row.status)))) {
    add("item_locked", "blocked", "已入队、烹饪中或已结束餐次不能换菜"); return finish();
  }
  // Releasing a commitment is not a new cooking allocation. Existing review/fact guards
  // still protect purchases and started cooking; restoring a skipped meal goes below.
  if (input.status === "skipped" && (input.recipeId === undefined || input.recipeId === current.recipe_id)
    && (input.dining === undefined || (input.dining === null && parseJson(current.dining_json,null) === null))) {
    add("commitment_released", "info", "仅跳过这餐并释放未制作承诺，不新增菜谱或库存需求");
    return finish();
  }
  if (input.recipeId === null || (input.dining !== undefined && !(input.dining === null && parseJson(current.dining_json, null) === null)) || input.status === "skipped") {
    add("replacement_only", "blocked", "本次验证不支持删除菜谱、跳过餐次或更改共餐设置"); return finish();
  }
  const recipeId = input.recipeId ?? Number(current.recipe_id);
  const proposed: Row[] = items.map(item => String(item.id) === itemId ? { ...item, planned_date: input.plannedDate ?? item.planned_date, meal_type: input.mealType ?? item.meal_type, status: input.status ?? item.status } : item);
  const live = proposed.filter(item => String(item.plan_id) === String(plan.id) && !terminal(item) && !item.deleted_at).sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.id).localeCompare(String(b.id)));
  if (live.some(item => item.household_id != null || item.household_meal_id != null || parseJson(item.dining_json, null) != null)) add("personal_only", "blocked", "共餐安排需要独立验证，不能使用个人换菜流程", live.filter(item => item.household_id != null || item.household_meal_id != null || parseJson(item.dining_json, null) != null).map(item => String(item.id)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(scope.endDate) || scope.startDate > scope.endDate || live.some(item => String(item.planned_date) < scope.startDate || String(item.planned_date) > scope.endDate)) add("invalid_scope", "blocked", "餐单日期范围或餐次日期不完整");
  const constraints = parseJson<Row>(plan.constraints_json, {});
  const executions = parseJson<Record<string, Row>>(constraints.executionItems, {});
  const draft = parseJson<Row>(constraints.currentCookingDraft ?? parseJson<Row>(constraints.savedCookingDraft, {}).draft, {});
  const recipes = (data.recipes ?? []).filter(row => row.status === "approved" && !row.deleted_at && (row.quality_status == null || row.quality_status === "trusted") && (row.visibility === "public" || row.visibility == null || owned(row, userId)));
  const weekly = draft.planningMode === "weekly";
  const productionDate = typeof draft.productionDate === "string" ? draft.productionDate : "";
  if (!Object.keys(draft).length || (!weekly && !/^\d{4}-\d{2}-\d{2}$/.test(productionDate))) add("production_configuration_missing", "pending", "缺少已保存的制作模式或制作日期证据，不能从餐单起始日推测制作会话");
  const recipe = recipes.find(row => Number(row.id) === recipeId);
  if (!recipe) { add("recipe_unavailable", "blocked", "替代菜谱不存在、无访问权限或审核已变化"); return finish(); }
  if (!executions[itemId] || !(Number(executions[itemId].servings) > 0)) { add("execution_missing", "blocked", "餐次缺少已保存的制作份数和执行依据，不能从旧草案猜测"); return finish(); }
  const replacement = replacementAllocation({ ...current, plan_constraints_json: constraints }, recipe);
  if (!replacement?.constraints) { add("quantities_missing", "blocked", "替代菜谱缺少可验证的产量或明确原料用量"); return finish(); }
  allocation = { ingredients: replacement.ingredients, constraints: replacement.constraints };
  if (recipeId === Number(current.recipe_id)) {
    // Date/type/restoration changes retain captured quantities and substitution evidence.
    // A stale existing recipe must fail validation rather than be silently recaptured.
    allocation = { ingredients: parseJson(current.ingredients_json, []), constraints: { ...constraints, executionItems: { ...executions } } };
  }
  // Preserve plan-wide legacy state; this result certifies only this proposed change.
  if (constraints.executionNeedsRevalidation === undefined) delete allocation.constraints.executionNeedsRevalidation;
  else allocation.constraints.executionNeedsRevalidation = constraints.executionNeedsRevalidation;
  const revised: Row[] = live.map(item => String(item.id) === itemId && recipeId !== Number(current.recipe_id) ? { ...item, recipe_id: recipeId, title: recipe.title, steps_json: recipe.steps_json, ingredients_json: allocation!.ingredients } : { ...item });
  const revisedExecutions = allocation.constraints.executionItems as Record<string, Row>;
  revisedExecutions[itemId] = { ...revisedExecutions[itemId], plannedDate: input.plannedDate ?? current.planned_date, mealType: mealTypes[input.mealType ?? String(current.meal_type)] };
  const recipeMap = new Map((data.recipes ?? []).map(row => [Number(row.id), row]));
  const cooking: CookingPlanDraft["cooking"] = [];
  const meals: CookingPlanDraft["meals"] = [];
  for (const item of revised) {
    const id = String(item.id), entry = cookingPlanDraftSchema.shape.cooking.element.safeParse(revisedExecutions[id]);
    if (!entry.success || !mealTypes[String(item.meal_type)]) { add("execution_missing", "blocked", "现有餐次缺少完整执行依据或有效餐别", [id]); continue; }
    try { assertPlanExecution([{ ...item, plan_constraints_json: allocation.constraints }], recipeMap); }
    catch { add("execution_changed", "blocked", "现有餐次的菜谱、原料或审核已变化", [id]); }
    // Live item ID is the canonical target, including after earlier date moves/replacements.
    cooking.push({ ...entry.data, targetMealId: id });
    meals.push({ id, date: String(item.planned_date), mealType: mealTypes[String(item.meal_type)], servings: entry.data.servings, cookServings: entry.data.servings, preparedServings: 0, allocations: [] });
  }
  if (!Array.isArray(data.prepared_meal_allocations)) add("prepared_evidence_missing", "pending", "未读取当前待吃餐分配，无法确认本次换菜保留其承诺");
  else {
    const activePrepared = data.prepared_meal_allocations.filter(row => String(row.plan_id) === String(plan.id) && ["active", "conflict"].includes(String(row.status)));
    const related = activePrepared.filter(row => draft.planningMode !== "weekly" || String(row.target_meal_id) === String(executions[itemId]?.targetMealId) || (String(row.planned_date) === String(input.plannedDate ?? current.planned_date) && mealTypes[String(row.meal_type)] === mealTypes[input.mealType ?? String(current.meal_type)]));
    if (related.length) add("prepared_allocation_pending", "pending", "本次制作会话有待吃餐分配，实际存放、剩余份数和复热仍须核对；本次不修改或复活这些分配");
    if (activePrepared.length > related.length) add("prepared_allocations_preserved", "info", "其他制作会话的待吃餐分配原样保留，不重新扣除生原料");
  }
  const profile = formatRecommendationProfile((data.user_health_profiles ?? []).find(row => owned(row, userId)) ?? null);
  const devices = (data.kitchenware_items ?? []).filter(row => owned(row, userId) && !row.deleted_at && row.status !== "维修中").map(row => {
    const catalog = data.kitchenware_catalog?.find(value => value.quality_status === "trusted" && (Number(value.id) === Number(row.catalog_id) || (row.catalog_id == null && value.name === row.name)));
    return data.kitchenware_catalog ? { ...row, catalog_id: catalog?.id ?? null } : { ...row };
  });
  const compatibility: RecommendationDataset["compatibility"] = new Map((data.recipe_compatibility ?? []).map(row => [Number(row.recipe_id), { requirements: parseJson<Row[]>(row.requirements, []), blocking: parseJson<Row[]>(row.blocking, []) }]));
  const requirements: RecommendationDataset["requirements"] = new Map();
  for (const row of data.recipe_kitchenware_requirements ?? []) { const id = Number(row.recipe_id); requirements.set(id, [...(requirements.get(id) ?? []), { ...row, role: String(row.role) }]); }
  for (const entry of cooking) if ((requirements.get(entry.recipeId)?.length ?? 0) > 0 && !compatibility.has(entry.recipeId)) add("kitchenware_evidence_missing", "pending", "缺少当前厨具治理校验结果", [entry.targetMealId]);
  const inventory = (data.inventory_items ?? []).filter(row => owned(row, userId) && Boolean(row.is_available) && !row.deleted_at).map(row => {
    const evidence = (data.inventory_change_logs ?? []).filter(log => owned(log, userId) && Number(log.inventory_item_id) === Number(row.id) && parseJson<Row>(parseJson<Row>(log.metadata_json, {}).field_evidence, {}).quantity != null).sort((a, b) => Number(b.id) - Number(a.id))[0];
    return { ...row, quantity_evidence_status: quantityEvidenceStatus(evidence?.metadata_json, row.version) };
  });
  const dataset: RecommendationDataset = { profile, inventory, kitchenware: devices, recipes, favoriteIds: [], recentIds: [], skippedIds: [], diet: { calories: 0, protein: 0 }, dailyCaloriesTarget: 2000, requirements, compatibility };
  const candidates = scoreRecipeRecommendations(dataset, { surface: "meal_plan" }, null, today).results;
  for (const entry of cooking) {
    if (!candidates.some(candidate => candidate.recipeId === entry.recipeId)) add("hard_constraint", "blocked", "菜谱不符合当前过敏、忌口或厨具硬限制", [entry.targetMealId]);
    if (!reviewedExecution(recipeMap.get(entry.recipeId) ?? {})) add("execution_review_missing", "blocked", "缺少当前已审核的制作排程依据", [entry.targetMealId]);
  }
  const externalPlans = new Set((data.meal_plans ?? []).filter(row => owned(row, userId) && row.status === "active" && !row.deleted_at && String(row.id) !== String(plan.id)).map(row => String(row.id)));
  const existing = (data.meal_plan_items ?? []).filter(row => externalPlans.has(String(row.plan_id)) && !row.deleted_at && !terminal(row) && String(row.planned_date) >= scope.startDate && String(row.planned_date) <= scope.endDate).sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)) || String(a.id).localeCompare(String(b.id)));
  const ledger = createPlanningBudget(inventory, existing, scope);
  for (const item of revised) {
    const entry = cooking.find(value => value.targetMealId === String(item.id));
    if (entry) ingredientBudget.push(...ledger.consume(entry.demands, [today, weekly ? String(item.planned_date) : productionDate].sort()[1], String(item.id)));
  }
  if (ledger.unknownCommitment) add("commitment_unknown", "pending", "窗口内其他已激活安排的原料承诺尚不明确");
  for (const part of ingredientBudget) {
    if (part.quantity_status === "unknown") add("inventory_unknown", "pending", `${part.food_name} 的库存数量或换算尚未核实`);
    else if (!part.fully_covered) add("inventory_shortage", "blocked", `${part.food_name} 不足以覆盖当前餐单与窗口内已承诺用量`);
  }
  const configuration = parseJson<Row>(draft.time, {});
  const budget = Number(configuration.budgetMinutes ?? profile.kitchen.meal_time_minutes);
  const sessionBudget = Number(configuration.sessionBudgetMinutes ?? profile.kitchen.meal_time_minutes ?? budget);
  if (!(budget > 0) || !Number.isFinite(budget) || !(sessionBudget > 0) || !Number.isFinite(sessionBudget)) add("time_budget_missing", "pending", "缺少有效的整套或单次制作时间上限");
  else {
    const grouped = new Map<string, typeof meals>();
    for (const meal of meals) { const key = `${meal.date}:${meal.mealType}`; grouped.set(key, [...(grouped.get(key) ?? []), meal]); }
    const sessions = weekly ? [...grouped.values()].map(targets => ({ meals: targets, cooking: cooking.filter(entry => targets.some(meal => meal.id === entry.targetMealId)), productionDate: targets[0].date })) : [{ meals, cooking, productionDate }];
    const evaluated = sessions.map(session => mealTime(session.cooking, candidates, devices, weekly ? sessionBudget : budget, { meals: session.meals, effectivePreferences: profile.kitchen, productionDate: session.productionDate }));
    const elapsed = evaluated.reduce((sum, result) => sum + (result.schedule?.elapsedMinutes ?? result.knownSequentialMinutes), 0);
    time = { ...evaluated[0], budgetMinutes: budget, sessionBudgetMinutes: sessionBudget, knownSequentialMinutes: evaluated.reduce((sum, result) => sum + result.knownSequentialMinutes, 0), incomplete: evaluated.some(result => result.incomplete), exceedsBudget: elapsed > budget || evaluated.some(result => result.exceedsBudget), missing: [...new Set(evaluated.flatMap(result => result.missing))], sessions: evaluated.flatMap((result, index) => result.schedule ? [{ targetMealId: sessions[index].meals[0]?.id ?? itemId, schedule: result.schedule }] : []), reheating: evaluated.flatMap(result => result.reheating ?? []), reheatingSessions: evaluated.flatMap(result => result.reheatingSessions ?? []) };
    if (time.incomplete) add("schedule_incomplete", "pending", "整套制作、设备容量或复热排程尚未核实");
    if (time.exceedsBudget) add("time_exceeded", "blocked", "换菜后整套制作、单次制作或复热超过时间上限");
    for (const session of sessions) for (const entry of session.cooking) {
      const handling = evaluateHandling(reviewedExecution(recipeMap.get(entry.recipeId) ?? {})?.profile.handling, { targetMealId: entry.targetMealId, recipeId: entry.recipeId, productionDate: session.productionDate, targetDate: session.meals.find(meal => meal.id === entry.targetMealId)!.date, preferences: profile.kitchen });
      if (handling.status !== "conditions_match") add("handling_" + handling.status, handling.status === "conflict" ? "blocked" : "pending", handling.reasons.join("；"), [entry.targetMealId]);
    }
  }
  return finish();
}

export type ActiveReplacementEvaluation = ReturnType<typeof evaluateActiveReplacement>;
