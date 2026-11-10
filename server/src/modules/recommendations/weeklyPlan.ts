import { cookingPlanDraftSchema, type PreparedMeal, type WeeklyPlanPreview, type WeeklyPlanRequest, type KitchenPreferences, type RecipeHandling, type ReviewedRecipeExecution } from "@dietdigidose/contracts";
import { buildCookingDraft } from "./plan.js";
import { allocatePreparedMeals } from "./requirements.js";
import { createPlanningBudget } from "./planningBudget.js";
import { unexpiredInventory } from "./inventoryAvailability.js";
import { buildFefoConsumptionPreviewFromCandidates } from "../../services/inventoryQuantity.js";
import type { Row } from "./types.js";

type Candidate = Parameters<typeof buildCookingDraft>[1][number];
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const mealAliases: Record<string,string> = { 早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 加餐: "snack" };

/** Read-only allocation: existing commitments reserve resources before filling gaps. */
export function buildWeeklyPlan(input: WeeklyPlanRequest, preferences: KitchenPreferences, candidates: Candidate[], inventory: Row[], prepared: PreparedMeal[], existing: Row[], shopping: Row[], reservedPrepared: Array<{ preparedMealId: string; servings: number }> = [], devices: Row[] = [], rules: Map<number, RecipeHandling> = new Map(candidates.flatMap(candidate => candidate.recipe.execution_profile?.handling ? [[candidate.recipeId, candidate.recipe.execution_profile.handling] as const] : [])), profiles: Map<number, ReviewedRecipeExecution> = new Map()): WeeklyPlanPreview {
  const days = Array.from({ length: 7 },(_,index) => { const date = new Date(`${input.startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+index); return date.toISOString().slice(0,10); });
  const mealTypes = [...(input.mealTypes ?? (preferences.usual_meals?.length ? preferences.usual_meals : ["breakfast","lunch","dinner"]))].sort((a,b) => ["breakfast","lunch","dinner","snack"].indexOf(a)-["breakfast","lunch","dinner","snack"].indexOf(b));
  const servings = input.servings ?? preferences.servings ?? 1;
  const timeBudget = preferences.meal_time_minutes ?? 30;
  const { stock,checks,aggregate,consume,unknownCommitment } = createPlanningBudget(inventory,existing.filter(item => String(item.planned_date)>=days[0]),{ startDate: days[0],endDate: days[6] });
  if (preferences.avoid_spicy === true && prepared.length) checks.add("待吃餐辣度未核实，本次不自动分配");
  const budgets: ReturnType<typeof buildFefoConsumptionPreviewFromCandidates> = [];
  const batches = prepared.map(meal => ({ ...meal }));
  for (const reservation of reservedPrepared) { const batch = batches.find(meal => meal.id === reservation.preparedMealId); if (batch) batch.remaining_servings = round(Math.max(0,batch.remaining_servings-reservation.servings)); }
  const slots: WeeklyPlanPreview["slots"] = [];
  const parts: ReturnType<typeof buildCookingDraft>[] = [];
  for (const date of days) for (const mealType of mealTypes) {
    const id = `week:${date}:${mealType}`;
    const preserved = existing.filter(item => String(item.planned_date) === date && (mealAliases[String(item.meal_type)] ?? item.meal_type) === mealType && item.status !== "skipped");
    if (preserved.length) {
      slots.push({ id,date,mealType,servings,titles: preserved.map(item => String(item.title)),preservedItemIds: preserved.map(item => String(item.id)),state: "preserved",reasons: ["保留已有安排"] });
      continue;
    }
    const eligiblePrepared = batches.filter(meal => !meal.planned_date || meal.planned_date === date);
    const requirements = allocatePreparedMeals({ preferences, reheatingDeviceIds: input.reheatingDeviceIds,meals: [{ id,date,mealType,servings }],excludedPreparedMealIds: [] },eligiblePrepared, rules);
    const target = requirements.meals[0];
    const part = buildCookingDraft(requirements,unknownCommitment ? [] : candidates,unexpiredInventory(stock,date),timeBudget, devices, { prepared: eligiblePrepared, profiles });
    if (part.time.exceedsBudget) {
      part.cooking = [];
      target.allocations = []; target.preparedServings = 0; target.cookServings = target.servings; part.totalCookServings = target.servings;
      part.handlingChecks = [];
      part.unresolved = [{ targetMealId: id,reason: "没有在单次制作时间内完成的明确方案，请调整餐次或时间" }];
      part.ingredientBudget = [];
      part.time.reheatingSessions = []; part.time.reheating = [];
      part.time.knownSequentialMinutes = 0; part.time.exceedsBudget = false;
      part.time.incomplete = true; part.time.missing.push("no_feasible_session");
      part.time.schedule = { complete: false, elapsedMinutes: null, sequentialMinutes: 0, tasks: [], batches: [], missing: ["no_feasible_session"], conflicts: [] };
    }
    for (const allocation of target.allocations) {
      const batch = batches.find(meal => meal.id === allocation.preparedMealId)!;
      batch.remaining_servings = round(batch.remaining_servings-allocation.servings);
      checks.add(`「${batch.food_name}」的存放期限和复热条件尚未核实，食用前需确认`);
    }
    if (part.cooking.length) {
      part.ingredientBudget = consume(part.cooking.flatMap(item => item.demands),date,id);
      budgets.push(...part.ingredientBudget);
    }
    parts.push(part);
    slots.push({ id,date,mealType,servings,titles: [...target.allocations.map(item => item.foodName),...part.cooking.map(item => item.title)],preservedItemIds: [],state: part.unresolved.length ? "unresolved" : "proposed",reasons: part.unresolved.map(item => item.reason) });
  }
  if (inventory.some(item => !item.expiration_date)) checks.add("部分库存缺少可用期限，未来餐次使用前需核对");
  if (preferences.carry_meals) checks.add("携带餐的冷藏与复热适用性需要逐餐核对");
  const draft = parts.length ? cookingPlanDraftSchema.parse({
    reheatingDeviceIds: input.reheatingDeviceIds, shoppingWindow: { startDate: days[0],endDate: days[6] },weeklyShopping: [...aggregate.values()],planningMode: "weekly",status: "requires_validation",meals: parts.flatMap(part => part.meals),totalCookServings: round(parts.reduce((sum,part) => sum+part.totalCookServings,0)),
    cooking: parts.flatMap(part => part.cooking),unresolved: parts.flatMap(part => part.unresolved),ingredientBudget: budgets,
    handlingChecks: parts.flatMap(part => part.handlingChecks).slice(0, 3000),
    time: { sessionBudgetMinutes: timeBudget,budgetMinutes: timeBudget*parts.length,knownSequentialMinutes: parts.reduce((sum,part) => sum+part.time.knownSequentialMinutes,0),exceedsBudget: false,isEstimate: true,incomplete: parts.some(part => part.time.incomplete),missing: ["每餐分别制作，不能把一周累计时间当作一次制作时间", ...new Set(parts.flatMap(part => part.time.missing))].slice(0,50),
      reheating: parts.flatMap(part => part.time.reheating ?? []), reheatingSessions: parts.flatMap(part => part.time.reheatingSessions ?? []),
      sessions: parts.map(part => ({ targetMealId: part.meals[0].id, schedule: part.time.schedule! })) },
    checksPending: [...checks].slice(0,50),excludedPreparedMealIds: batches.filter(meal => meal.is_reserved).map(meal => meal.id),effectivePreferences: preferences,
  }) : null;
  return { startDate: days[0],endDate: days[6],status: "requires_validation",slots,shopping: [...aggregate.values()],plannedPurchases: shopping.filter(item => !item.checked).map(item => ({ id: String(item.id),name: String(item.name),amount: String(item.amount) })),checksPending: [...checks],draft };
}
