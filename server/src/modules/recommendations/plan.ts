import { weeklyShoppingWindow } from "./shoppingWindow.js";
import { scheduleCooking, type ScheduleEntry } from "./schedule.js";
import { evaluateHandling } from "./handling.js";
import { createPlanningBudget } from "./planningBudget.js";
import { currentDateKey } from "../../utils/date.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { recipeDemands } from "./quantities.js";
import { substitutionMatches } from "../recipes/substitutions.js";
import { cookingPlanDraftSchema, type CookingPlanDraft, type MealHandlingCheck, type RecipeSubstitutionEvidence, type PreparedMeal, type ReviewedRecipeExecution } from "@dietdigidose/contracts";
import { RecommendationsError } from "./errors.js";
import { buildFefoConsumptionPreviewFromCandidates, type InventoryUnit } from "../../services/inventoryQuantity.js";
import type { allocatePreparedMeals } from "./requirements.js";
import type { scoreRecipeRecommendations } from "./scoring.js";
import type { Row } from "./types.js";

type Candidate = ReturnType<typeof scoreRecipeRecommendations>["results"][number];
type Demand = { food_name: string; amount_value: number; unit: InventoryUnit };
const demands = (candidate: Candidate, portions: number) => recipeDemands(candidate.recipe.ingredients, candidate.recipe.serving_size, portions);
export type ReheatingData = { prepared: PreparedMeal[]; profiles: Map<number, ReviewedRecipeExecution> };
const noReheatingData: ReheatingData = { prepared: [], profiles: new Map() };


function substitutionLinks(candidates: Candidate[]) {
  // ponytail: one reviewed variant hop; multiple ingredient swaps need a separately reviewed complete variant.
  const byId = new Map(candidates.map(candidate => [candidate.recipeId, candidate]));
  const links = new Map<number, Array<{ source: Candidate; evidence: RecipeSubstitutionEvidence }>>();
  for (const source of candidates) for (const rule of source.recipe.execution_profile?.substitutions ?? []) {
    const target = byId.get(rule.recipeId);
    if (!target?.recipe.execution_profile || target.recipe.execution_evidence?.recipeKey !== rule.recipeKey || !source.recipe.execution_evidence
      || !substitutionMatches(source.recipe, target.recipe, rule)) continue;
    const entries = links.get(rule.recipeId) ?? [];
    entries.push({ source, evidence: { ...rule, sourceRecipeId: source.recipeId, sourceRecipeKey: source.recipe.execution_evidence.recipeKey, sourceTitle: source.recipe.title } });
    links.set(rule.recipeId, entries);
  }
  return links;
}
function stockSubstitution(candidate: Candidate, links: ReturnType<typeof substitutionLinks>, stock: Parameters<typeof buildFefoConsumptionPreviewFromCandidates>[0], committed: Demand[], servings: number, sourceId?: number) {
  const needed = demands(candidate, servings);
  if (!needed || !buildFefoConsumptionPreviewFromCandidates(stock, [...committed, ...needed]).slice(committed.length).every(item => item.fully_covered && item.quantity_status === "sufficient")) return undefined;
  return links.get(candidate.recipeId)?.find(({ source, evidence }) => {
    if (sourceId !== undefined && source.recipeId !== sourceId) return false;
    const original = demands(source, servings);
    return original && buildFefoConsumptionPreviewFromCandidates(stock, [...committed, ...original]).slice(committed.length)
      .some(item => item.food_name === evidence.removedIngredient && ["insufficient", "unavailable"].includes(item.quantity_status!));
  })?.evidence;
}

/** Production and eating on another date/location have separate time budgets. */
export function mealTime(cooking: CookingPlanDraft["cooking"], candidates: Candidate[], devices: Row[], budgetMinutes: number,
  context: Pick<CookingPlanDraft, "meals" | "effectivePreferences" | "reheatingDeviceIds"> & { productionDate: string; unresolved?: boolean }, data = noReheatingData): CookingPlanDraft["time"] {
  const production: ScheduleEntry[] = cooking.flatMap(item => {
    const recipe = candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe;
    return recipe ? [{ ...item, recipe }] : [];
  });
  const mainMissing = cooking.filter(item => !candidates.some(candidate => candidate.recipeId === item.recipeId)).map(item => `recipe_unavailable:${item.recipeId}`);
  if (cooking.some(item => { const recipe = candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe;
    return !recipe || (!recipe.execution_profile && (!recipe.cook_time || recipe.prep_time == null)); })) mainMissing.push("preparation_or_cooking");
  if (context.unresolved) mainMissing.push("unresolved_cooking");
  const reheating: NonNullable<CookingPlanDraft["time"]["reheating"]> = [];
  const reheatingSessions: NonNullable<CookingPlanDraft["time"]["reheatingSessions"]> = [];
  const away = context.effectivePreferences.carry_meals === true || (context.effectivePreferences.eating_location != null && context.effectivePreferences.eating_location !== "home");
  const allowedDeviceIds = context.reheatingDeviceIds ?? (away ? [] : devices.map(row => Number(row.id)));
  const finish = (entries: ScheduleEntry[], missing: string[]) => {
    const schedule = scheduleCooking(entries, devices);
    schedule.missing = [...new Set([...schedule.missing, ...missing])];
    if (schedule.missing.length) { schedule.complete = false; schedule.elapsedMinutes = null; }
    return schedule;
  };
  for (const meal of context.meals) {
    const entries: ScheduleEntry[] = [], missing: string[] = [];
    const items = [
      ...meal.allocations.map(allocation => {
        const batch = data.prepared.find(batch => batch.id === allocation.preparedMealId && batch.version === allocation.version);
        const review = batch?.recipe_id == null ? undefined : data.profiles.get(batch.recipe_id);
        return { preparedMealId: allocation.preparedMealId, recipeId: batch?.recipe_id ?? null, title: allocation.foodName, servings: allocation.servings, profile: review?.profile };
      }),
      ...cooking.filter(item => item.targetMealId === meal.id && (away || meal.date > context.productionDate)).map(item => ({
        preparedMealId: undefined, recipeId: item.recipeId, title: item.title, servings: item.servings, profile: candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe.execution_profile ?? undefined,
      })),
    ];
    for (const item of items) {
      const graph = item.profile?.reheating;
      const cold = item.profile?.handling?.coldServingAllowed === true;
      const mode = cold ? "cold" : graph && context.effectivePreferences.reheating_available !== false ? "reheating" : "unknown";
      reheating.push({ targetMealId: meal.id, recipeId: item.recipeId, ...(item.preparedMealId ? { preparedMealId: item.preparedMealId } : {}), servings: item.servings, mode });
      if (mode === "cold") continue;
      if (mode === "unknown" || item.recipeId == null) { missing.push(item.preparedMealId ? "prepared_reheating_time" : "future_reheating_schedule"); continue; }
      if (away && context.reheatingDeviceIds === undefined) missing.push("reheating_location_devices");
      if (allowedDeviceIds.some(id => !devices.some(device => Number(device.id) === id))) missing.push("reheating_device_unavailable");
      entries.push({ kind: "reheating", targetMealId: meal.id, recipeId: item.recipeId, preparedMealId: item.preparedMealId,
        servings: item.servings, allowedDeviceIds, recipe: { title: item.title, cook_time: 0, prep_time: 0, serving_size: graph!.maxBatchServings, execution_profile: graph! } });
    }
    if (!entries.length && !missing.length) continue;
    if (!away && meal.date === context.productionDate) { production.push(...entries); mainMissing.push(...missing); }
    else reheatingSessions.push({ targetMealId: meal.id, budgetMinutes, schedule: finish(entries, missing) });
  }
  const schedule = finish(production, mainMissing);
  const all = [schedule, ...reheatingSessions.map(session => session.schedule)];
  return { budgetMinutes, knownSequentialMinutes: schedule.sequentialMinutes, schedule, reheating, reheatingSessions,
    exceedsBudget: all.some(schedule => (schedule.elapsedMinutes ?? schedule.sequentialMinutes) > budgetMinutes),
    isEstimate: true, incomplete: all.some(schedule => !schedule.complete) || reheating.some(item => item.mode === "unknown"),
    missing: [...new Set(all.flatMap(schedule => schedule.missing))].slice(0, 50) };
}

export function buildCookingDraft(requirements: ReturnType<typeof allocatePreparedMeals>, candidates: Candidate[], inventory: Row[], timeBudget: number, devices: Row[] = [], data = noReheatingData) {
  const stock = unexpiredInventory(inventory, [currentDateKey(), requirements.productionDate].sort()[1]).map(item => ({ id: item.id, food_name: item.food_name, quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value,
    quantity_unit: item.quantity_unit, expiration_date: item.expiration_date, batch_code: item.batch_code, version: item.version }));
  const planned: CookingPlanDraft["cooking"] = [];
  const links = substitutionLinks(candidates);
  const unresolved: Array<{ targetMealId: string; reason: string }> = [];
  let budget: Demand[] = [];
  for (const target of requirements.meals) {
    if (target.cookServings <= 0) continue;
    const rejected: string[] = [];
    const choices = candidates.flatMap(candidate => {
      const handling = evaluateHandling(candidate.recipe.execution_profile?.handling, { targetMealId: target.id, recipeId: candidate.recipeId,
        productionDate: requirements.productionDate, targetDate: target.date, preferences: requirements.effectivePreferences ?? {} });
      if (handling.status === "conflict") { rejected.push(`${candidate.recipe.title}：${handling.reasons.join("；")}`); return []; }
      const needed = demands(candidate, target.cookServings);
      if (!needed) return [];
      const preview = buildFefoConsumptionPreviewFromCandidates(stock, [...budget, ...needed]);
      // Compare unmet demand items, never add incompatible mass/count quantities.
      const unresolvedCount = preview.filter(item => !item.fully_covered).length;
      const unknownCount = preview.filter(item => item.quantity_status === "unknown").length;
      const time = mealTime([...planned, { targetMealId: target.id, recipeId: candidate.recipeId, title: candidate.recipe.title,
        servings: target.cookServings, recipeYield: candidate.recipe.serving_size!, demands: needed }], candidates, devices, timeBudget, requirements, data);
      const substitution = stockSubstitution(candidate, links, stock, budget, target.cookServings);
      return [{ candidate, handling, needed, substitution, unresolvedCount, unknownCount, exceedsTime: time.exceedsBudget }];
    }).sort((a, b) => Number(a.exceedsTime) - Number(b.exceedsTime) || Number(a.handling.status === "pending") - Number(b.handling.status === "pending") || a.unresolvedCount - b.unresolvedCount || a.unknownCount - b.unknownCount || Number(!a.substitution) - Number(!b.substitution) || b.candidate.score - a.candidate.score);
    const chosen = choices[0];
    if (!chosen) { unresolved.push({ targetMealId: target.id, reason: rejected.length ? `已审核条件冲突：${rejected.slice(0, 3).join("；")}`.slice(0, 1000) : "没有通过候选约束且有明确份数与原料用量的菜谱" }); continue; }
    const recipe = chosen.candidate.recipe;
    budget = [...budget, ...chosen.needed];
    planned.push({ targetMealId: target.id, recipeId: chosen.candidate.recipeId, title: recipe.title,
      servings: target.cookServings, recipeYield: recipe.serving_size!, demands: chosen.needed, ...(chosen.substitution ? { substitution: chosen.substitution } : {}) });
  }
  const ingredientBudget = buildFefoConsumptionPreviewFromCandidates(stock, budget);
  const time = mealTime(planned, candidates, devices, timeBudget, { ...requirements, unresolved: unresolved.length > 0 }, data);
  const handlingChecks = [...requirements.handlingChecks, ...planned.map(item => evaluateHandling(candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe.execution_profile?.handling,
    { targetMealId: item.targetMealId, recipeId: item.recipeId, productionDate: requirements.productionDate,
      targetDate: requirements.meals.find(meal => meal.id === item.targetMealId)!.date, preferences: requirements.effectivePreferences ?? {} }))];
  return { ...requirements, handlingChecks, cooking: planned, unresolved, ingredientBudget,
    time,
    status: "requires_validation" as const,
    checksPending: [...requirements.checksPending, "storage_and_carry_suitability", "substitution_validation", "execution_stock_refresh"] };
}

/** Reprice the entire draft while changing exactly one cooking entry. */
export function replaceCookingDraft(draft: CookingPlanDraft, targetMealId: string, recipeId: number | undefined, candidates: Candidate[], inventory: Row[], existing: Row[] = [], devices: Row[] = [], preparedChecks?: MealHandlingCheck[], data = noReheatingData) {
  const shoppingWindow = draft.planningMode === "weekly" ? weeklyShoppingWindow(draft,existing) : undefined;
  const targets = draft.cooking.filter(item => item.targetMealId === targetMealId);
  if (targets.length !== 1) throw new RecommendationsError(409, "请先指定唯一需要替换的新做菜", "COOKING_PLAN_TARGET_AMBIGUOUS");
  const target = targets[0];
  const productionDate = draft.productionDate ?? draft.meals.map(meal => meal.date).sort()[0];
  const links = substitutionLinks(candidates);
  const staleSubstitutions = draft.cooking.filter(item => item.targetMealId !== targetMealId && item.substitution && !links.get(item.recipeId)?.some(link =>
    Object.entries(item.substitution!).every(([key, value]) => link.evidence[key as keyof typeof link.evidence] === value)));
  const choices = candidates.filter(candidate => candidate.recipeId !== target.recipeId && (recipeId === undefined || candidate.recipeId === recipeId)).flatMap(candidate => {
    const meal = draft.meals.find(meal => meal.id === targetMealId)!;
    const handling = evaluateHandling(candidate.recipe.execution_profile?.handling, { targetMealId, recipeId: candidate.recipeId,
      productionDate: draft.planningMode === "weekly" ? meal.date : productionDate, targetDate: meal.date, preferences: draft.effectivePreferences });
    if (handling.status === "conflict") return [];
    const needed = demands(candidate, target.servings);
    if (!needed) return [];
    const replacement: CookingPlanDraft["cooking"][number] = { targetMealId, recipeId: candidate.recipeId, title: candidate.recipe.title,
      servings: target.servings, recipeYield: candidate.recipe.serving_size!, demands: needed };
    const cooking = draft.cooking.map(item => item.targetMealId === targetMealId ? replacement : item);
    const singleBudget = buildFefoConsumptionPreviewFromCandidates(unexpiredInventory(inventory, [currentDateKey(), productionDate].sort()[1]).map(item => ({ id: item.id, food_name: item.food_name,
      quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined, quantity_value: item.quantity_value, quantity_unit: item.quantity_unit, expiration_date: item.expiration_date,
      batch_code: item.batch_code, version: item.version })), cooking.flatMap(item => item.demands));
    const weeklyBudget = draft.planningMode === "weekly" ? createPlanningBudget(inventory,existing.filter(item => !shoppingWindow || String(item.planned_date)>=shoppingWindow.startDate),shoppingWindow) : null;
    let substitution: RecipeSubstitutionEvidence | undefined;
    const ingredientBudget = weeklyBudget ? [...draft.meals].sort((a,b) => a.date.localeCompare(b.date) || ["breakfast","lunch","dinner","snack"].indexOf(a.mealType)-["breakfast","lunch","dinner","snack"].indexOf(b.mealType)).flatMap(meal => {
      if (meal.id === targetMealId && !weeklyBudget.unknownCommitment) substitution = stockSubstitution(candidate, links,
        unexpiredInventory(weeklyBudget.stock, meal.date) as Parameters<typeof buildFefoConsumptionPreviewFromCandidates>[0], [], target.servings, target.recipeId);
      return weeklyBudget.consume(cooking.filter(item => item.targetMealId === meal.id).flatMap(item => item.demands),meal.date,meal.id);
    }) : singleBudget;
    if (!weeklyBudget) substitution = stockSubstitution(candidate, links, unexpiredInventory(inventory, [currentDateKey(), productionDate].sort()[1]) as Parameters<typeof buildFefoConsumptionPreviewFromCandidates>[0],
      draft.cooking.filter(item => item.targetMealId !== targetMealId).flatMap(item => item.demands), target.servings, target.recipeId);
    if (substitution && ingredientBudget.every(item => item.fully_covered && item.quantity_status === "sufficient")) replacement.substitution = substitution;
    const sessions = draft.planningMode === "weekly" ? draft.meals.map(meal => ({ targetMealId: meal.id,
      time: mealTime(cooking.filter(item => item.targetMealId === meal.id), candidates, devices, draft.time.sessionBudgetMinutes ?? draft.time.budgetMinutes,
        { ...draft, meals: [meal], productionDate: meal.date, unresolved: draft.unresolved.some(item => item.targetMealId === meal.id) }, data) })) : [];
    let time = mealTime(cooking, candidates, devices, draft.time.budgetMinutes, { ...draft, productionDate, unresolved: draft.unresolved.length > 0 }, data);
    if (sessions.length) {
      const { schedule: _schedule, ...totals } = time;
      const elapsed = sessions.every(session => session.time.schedule?.complete) ? sessions.reduce((sum, session) => sum + session.time.schedule!.elapsedMinutes!, 0)
        : sessions.reduce((sum, session) => sum + session.time.knownSequentialMinutes, 0);
      const reheatingSessions = sessions.flatMap(session => session.time.reheatingSessions ?? []);
      time = { ...totals, knownSequentialMinutes: sessions.reduce((sum, session) => sum + session.time.knownSequentialMinutes, 0), incomplete: sessions.some(session => session.time.incomplete),
        exceedsBudget: elapsed > draft.time.budgetMinutes || reheatingSessions.some(session => (session.schedule.elapsedMinutes ?? session.schedule.sequentialMinutes) > session.budgetMinutes),
        reheating: sessions.flatMap(session => session.time.reheating ?? []), reheatingSessions,
        missing: [...new Set(sessions.flatMap(session => session.time.missing))].slice(0, 50),
        sessions: sessions.map(session => ({ targetMealId: session.targetMealId, schedule: session.time.schedule! })) };
    }
    const handlingChecks = [...(preparedChecks ?? draft.meals.flatMap(meal => meal.allocations.map(allocation => ({ targetMealId: meal.id, recipeId: null,
      preparedMealId: allocation.preparedMealId, status: "pending" as const, reasons: ["未重新读取实际待吃餐记录"], reference: null, sourceUrl: null, instructions: null })))), ...cooking.map(item => {
      const meal = draft.meals.find(meal => meal.id === item.targetMealId)!;
      return evaluateHandling(candidates.find(candidate => candidate.recipeId === item.recipeId)?.recipe.execution_profile?.handling,
        { targetMealId: item.targetMealId, recipeId: item.recipeId, productionDate: draft.planningMode === "weekly" ? meal.date : productionDate, targetDate: meal.date, preferences: draft.effectivePreferences });
    })];
    return [{ cooking, handlingChecks, handling, ingredientBudget, time, substitution: replacement.substitution, sessionExceeds: sessions.some(session => session.time.exceedsBudget), weeklyBudget, score: candidate.score,
      exceedsBudget: time.exceedsBudget,
      shortageCount: ingredientBudget.filter(item => !item.fully_covered).length }];
  }).sort((a, b) => Number(a.exceedsBudget || a.sessionExceeds) - Number(b.exceedsBudget || b.sessionExceeds) || Number(a.handling.status === "pending") - Number(b.handling.status === "pending") || a.shortageCount - b.shortageCount || Number(!a.substitution) - Number(!b.substitution) || b.score - a.score);
  const chosen = choices[0];
  if (!chosen) throw new RecommendationsError(409, "没有符合当前条件且用量明确的替代菜，原方案保持不变", "COOKING_PLAN_NO_REPLACEMENT");
  const conflicts: string[] = [...(chosen.weeklyBudget?.checks ?? []), ...staleSubstitutions.map(item => `「${item.title}」的替代审核已改变，请重新生成后再转为餐单`)];
  for (const check of chosen.handlingChecks) if (check.status !== "conditions_match") conflicts.push(...check.reasons);
  if (chosen.weeklyBudget?.unknownCommitment) conflicts.push("已有安排用量未核实，新增餐次的库存覆盖仅为暂算");
  for (const item of chosen.ingredientBudget) {
    if (item.quantity_status === "unknown") conflicts.push(`${item.food_name} 的库存数量或单位换算未知`);
    else if (!item.fully_covered) conflicts.push(`${item.food_name} 的整套需求超过已知库存`);
  }
  if (chosen.sessionExceeds) conflicts.push(`替换后的单次制作超过 ${draft.time.sessionBudgetMinutes} 分钟上限`);
  for (const session of chosen.time.reheatingSessions ?? []) if ((session.schedule.elapsedMinutes ?? session.schedule.sequentialMinutes) > session.budgetMinutes) conflicts.push(`食用前复热超过 ${session.budgetMinutes} 分钟上限`);
  if (chosen.exceedsBudget && (chosen.time.schedule?.elapsedMinutes ?? chosen.time.knownSequentialMinutes) > draft.time.budgetMinutes) conflicts.push(`整套${chosen.time.incomplete ? "已知顺序" : "排程"}耗时 ${chosen.time.schedule?.elapsedMinutes ?? chosen.time.knownSequentialMinutes} 分钟，超过 ${draft.time.budgetMinutes} 分钟上限`);
  if (chosen.time.incomplete) conflicts.push("替换后的完整制作时间或设备容量仍需核实");
  return { draft: cookingPlanDraftSchema.parse({ ...draft, ...(draft.planningMode === "weekly" ? {} : { productionDate }), ...(shoppingWindow ? { shoppingWindow } : {}), cooking: chosen.cooking, ingredientBudget: chosen.ingredientBudget,
    handlingChecks: chosen.handlingChecks, time: { ...chosen.time, sessionBudgetMinutes: draft.time.sessionBudgetMinutes },
    weeklyShopping: chosen.weeklyBudget ? [...chosen.weeklyBudget.aggregate.values()] : draft.weeklyShopping,
    checksPending: [...new Set([...draft.checksPending,...conflicts])].slice(0,50),
    status: "requires_validation" }), shopping: chosen.weeklyBudget ? [...chosen.weeklyBudget.aggregate.values()] : undefined, conflicts: [...new Set(conflicts)] };
}
