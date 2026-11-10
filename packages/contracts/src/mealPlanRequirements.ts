import { inventoryUnitSchema } from "./inventory.ts";
import { cookingScheduleSchema, mealHandlingCheckSchema, recipeSubstitutionEvidenceSchema, reheatingDeviceIdsSchema } from "./recipeExecution.ts";
import { kitchenPreferencesSchema } from "./mealPreferences.ts";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
export const mealPlanRequirementsSchema = z.object({
  productionDate: date.optional(), reheatingDeviceIds: reheatingDeviceIdsSchema.optional(),
  preferences: kitchenPreferencesSchema.optional(),
  meals: z.array(z.object({
    id: z.string().trim().min(1).max(80), date,
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: z.number().finite().min(0.001).max(30),
  }).strict()).min(1).max(28),
  excludedPreparedMealIds: z.array(z.string().uuid()).max(100).default([]),
}).strict().refine(value => new Set(value.meals.map(meal => meal.id)).size === value.meals.length, "餐次标识不能重复")
  .refine(value => !value.productionDate || value.meals.every(meal => meal.date >= value.productionDate!), "制作日期不能晚于目标餐次");
export type MealPlanRequirementsInput = z.infer<typeof mealPlanRequirementsSchema>;

const amount = z.number().finite().nonnegative();
const positiveAmount = z.number().finite().positive();
export const weeklyShoppingSchema = z.array(z.object({
  foodName: z.string().max(200),unit: z.string().max(40),uncertain: z.boolean(),required: amount,covered: amount,missing: amount,
  sources: z.array(z.object({ mealId: z.string().max(100),required: amount,missing: amount })).max(2800),
})).max(2800);
export const cookingPlanDraftSchema = z.object({
  productionDate: date.optional(), reheatingDeviceIds: reheatingDeviceIdsSchema.optional(),
  handlingChecks: z.array(mealHandlingCheckSchema).max(3000).optional(),
  weeklyShopping: weeklyShoppingSchema.optional(),
  shoppingWindow: z.object({ startDate: date,endDate: date }).strict().refine(value => Date.parse(value.endDate)-Date.parse(value.startDate) === 6*86_400_000,"采购范围必须为七天").optional(),
  planningMode: z.enum(["single_session", "weekly"]).optional(),
  status: z.literal("requires_validation"),
  meals: z.array(z.object({
    id: z.string().min(1).max(80), date, mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: positiveAmount.max(30), preparedServings: amount, cookServings: amount,
    allocations: z.array(z.object({ preparedMealId: z.string().uuid(), version: z.number().int().positive(),
      foodName: z.string().max(200), servings: positiveAmount, validationRequired: z.literal(true) })).max(100),
  })).min(1).max(28),
  totalCookServings: amount,
  cooking: z.array(z.object({ targetMealId: z.string().max(80), recipeId: z.number().int().positive(),
    substitution: recipeSubstitutionEvidenceSchema.optional(),
    title: z.string().max(200), servings: positiveAmount, recipeYield: positiveAmount,
    demands: z.array(z.object({ food_name: z.string().max(200), amount_value: positiveAmount, unit: inventoryUnitSchema })).max(100),
  })).max(28),
  unresolved: z.array(z.object({ targetMealId: z.string().max(80), reason: z.string().max(1000) })).max(28),
  ingredientBudget: z.array(z.object({ food_name: z.string().max(200), covered_value: amount, missing_value: amount,
    unit: inventoryUnitSchema, fully_covered: z.boolean(), requested_value: amount.optional(), name_available: z.boolean().optional(),
    deductions: z.array(z.object({ item_id: z.number().int().positive(), version: z.number().int().positive(),
      food_name: z.string().max(200), expiration_date: z.string().max(40), batch_code: z.string().max(200).nullable(),
      mode: z.enum(["all", "amount"]), amount_value: positiveAmount, unit: inventoryUnitSchema,
    })).max(1000).optional(),
    quantity_status: z.enum(["sufficient", "insufficient", "unknown", "unavailable"]).optional(),
  })).max(2800),
  time: z.object({ sessionBudgetMinutes: positiveAmount.optional(), budgetMinutes: positiveAmount, knownSequentialMinutes: amount, exceedsBudget: z.boolean(),
    isEstimate: z.boolean(), incomplete: z.boolean(), missing: z.array(z.string().max(200)).max(50),
    reheating: z.array(z.object({ targetMealId: z.string().max(80), recipeId: z.number().int().positive().nullable(), preparedMealId: z.string().uuid().optional(),
      servings: positiveAmount, mode: z.enum(["cold", "reheating", "unknown"]) })).max(2828).optional(),
    reheatingSessions: z.array(z.object({ targetMealId: z.string().max(80), budgetMinutes: positiveAmount, schedule: cookingScheduleSchema })).max(28).optional(),
    schedule: cookingScheduleSchema.optional(),
    sessions: z.array(z.object({ targetMealId: z.string().max(80), schedule: cookingScheduleSchema })).max(28).optional() }),
  checksPending: z.array(z.string().max(200)).max(50),
  excludedPreparedMealIds: z.array(z.string().uuid()).max(100),
  effectivePreferences: kitchenPreferencesSchema,
}).superRefine((draft, context) => {
  const close = (left: number, right: number) => Math.abs(left - right) <= 0.00001;
  const invalid = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (draft.shoppingWindow && (draft.planningMode !== "weekly" || draft.meals.some(meal => meal.date < draft.shoppingWindow!.startDate || meal.date > draft.shoppingWindow!.endDate))) {
    invalid(["shoppingWindow"],"七日采购范围必须包含方案餐次");
  }
  const ids = new Set(draft.meals.map(meal => meal.id));
  if (draft.productionDate && (draft.planningMode === "weekly" || draft.meals.some(meal => meal.date < draft.productionDate!))) invalid(["productionDate"], "单次制作日期不能用于周计划或晚于目标餐次");
  if (draft.handlingChecks?.some(check => !ids.has(check.targetMealId))) invalid(["handlingChecks"], "存放核对必须属于方案餐次");
  const handlingIds = draft.handlingChecks?.map(check => `${check.targetMealId}:${check.preparedMealId ?? `recipe:${check.recipeId}`}`) ?? [];
  if (new Set(handlingIds).size !== handlingIds.length) invalid(["handlingChecks"], "同一餐次的同一食物不能重复核对");
  if (draft.handlingChecks?.some(check => !check.preparedMealId && !draft.cooking.some(item => item.targetMealId === check.targetMealId && item.recipeId === check.recipeId))) invalid(["handlingChecks"], "新做菜的存放核对必须对应实际菜谱");
  if (ids.size !== draft.meals.length) invalid(["meals"], "餐次标识不能重复");
  const excluded = new Set(draft.excludedPreparedMealIds);
  const batchVersions = new Map<string, number>();
  draft.meals.forEach((meal, index) => {
    if (!close(meal.preparedServings + meal.cookServings, meal.servings)) invalid(["meals", index], "待吃份量与补做份量之和必须等于需求份量");
    if (!close(meal.allocations.reduce((sum, item) => sum + item.servings, 0), meal.preparedServings)) invalid(["meals", index, "allocations"], "待吃分配之和必须等于待吃份量");
    if (new Set(meal.allocations.map(item => item.preparedMealId)).size !== meal.allocations.length) invalid(["meals", index, "allocations"], "同一餐次不能重复分配同一待吃批次");
    meal.allocations.forEach((allocation, allocationIndex) => {
      if (excluded.has(allocation.preparedMealId)) invalid(["meals", index, "allocations", allocationIndex], "保留或排除的待吃餐不能被分配");
      const version = batchVersions.get(allocation.preparedMealId);
      if (version !== undefined && version !== allocation.version) invalid(["meals", index, "allocations", allocationIndex], "同一待吃批次的版本必须一致");
      batchVersions.set(allocation.preparedMealId, allocation.version);
    });
    const cooking = draft.cooking.filter(item => item.targetMealId === meal.id);
    const unresolved = draft.unresolved.filter(item => item.targetMealId === meal.id);
    if (meal.cookServings > 0) {
      if (cooking.length + unresolved.length !== 1) invalid(["meals", index], "补做餐次必须有唯一的新做菜或待解决原因");
      if (cooking.length === 1 && !close(cooking[0].servings, meal.cookServings)) invalid(["meals", index], "新做菜的份量必须等于该餐次补做份量");
    } else if (cooking.length || unresolved.length) invalid(["meals", index], "无需补做的餐次不能重复安排新做菜");
  });
  draft.cooking.forEach((item, index) => {
    if (item.substitution && (item.substitution.recipeId !== item.recipeId || !item.demands.some(demand => demand.food_name === item.substitution!.replacementIngredient) || item.demands.some(demand => demand.food_name === item.substitution!.removedIngredient))) invalid(["cooking", index, "substitution"], "替代依据必须对应实际菜谱与原料");
    if (!ids.has(item.targetMealId)) invalid(["cooking", index, "targetMealId"], "新做菜必须属于现有餐次");
    if (!item.demands.length) invalid(["cooking", index, "demands"], "新做菜必须有明确原料用量");
  });
  draft.unresolved.forEach((item, index) => {
    if (!ids.has(item.targetMealId)) invalid(["unresolved", index, "targetMealId"], "待解决项必须属于现有餐次");
  });
  if (!close(draft.totalCookServings, draft.meals.reduce((sum, meal) => sum + meal.cookServings, 0))) invalid(["totalCookServings"], "总补做份量与各餐次不一致");
  const elapsed = draft.time.schedule?.elapsedMinutes ?? (draft.time.sessions?.length && draft.time.sessions.every(session => session.schedule.complete)
    ? draft.time.sessions.reduce((sum, session) => sum + session.schedule.elapsedMinutes!, 0) : draft.time.knownSequentialMinutes);
  if (draft.time.exceedsBudget !== (elapsed > draft.time.budgetMinutes || (draft.time.reheatingSessions?.some(session => (session.schedule.elapsedMinutes ?? session.schedule.sequentialMinutes) > session.budgetMinutes) ?? false))) invalid(["time", "exceedsBudget"], "超时状态与时间预算不一致");
  if ((draft.time.schedule && draft.planningMode === "weekly") || (draft.time.sessions && draft.planningMode !== "weekly")) invalid(["time"], "单次与分次排程不能混用");
  if (draft.time.sessions && (new Set(draft.time.sessions.map(session => session.targetMealId)).size !== draft.time.sessions.length || draft.time.sessions.some(session => !ids.has(session.targetMealId)))) invalid(["time", "sessions"], "分次排程必须属于唯一现有餐次");
  if (draft.time.sessions && draft.time.sessions.length !== draft.meals.length) invalid(["time", "sessions"], "分次排程必须覆盖每个餐次");
  const reheating = draft.time.reheating ?? [];
  const reheatingId = (item: Pick<typeof reheating[number], "targetMealId" | "preparedMealId" | "recipeId">) => `${item.targetMealId}:${item.preparedMealId ?? `recipe:${item.recipeId}`}`;
  if (new Set(reheating.map(reheatingId)).size !== reheating.length || reheating.some(item => !ids.has(item.targetMealId)
    || (item.preparedMealId ? !draft.meals.find(meal => meal.id === item.targetMealId)?.allocations.some(allocation => allocation.preparedMealId === item.preparedMealId && close(allocation.servings, item.servings))
      : !draft.cooking.some(cooking => cooking.targetMealId === item.targetMealId && cooking.recipeId === item.recipeId && close(cooking.servings, item.servings))))) invalid(["time", "reheating"], "复热需求必须对应唯一实际食物和份量");
  if (draft.time.reheatingSessions && (new Set(draft.time.reheatingSessions.map(session => session.targetMealId)).size !== draft.time.reheatingSessions.length
    || draft.time.reheatingSessions.some(session => !ids.has(session.targetMealId)))) invalid(["time", "reheatingSessions"], "食用前排程必须对应唯一实际餐次");
  const schedules = draft.time.schedule ? [{ schedule: draft.time.schedule, targetMealId: undefined }] : draft.time.sessions ?? [];
  const allSchedules = [...schedules, ...(draft.time.reheatingSessions ?? [])];
  if (allSchedules.length && draft.time.incomplete !== (allSchedules.some(item => !item.schedule.complete) || reheating.some(item => item.mode === "unknown"))) invalid(["time", "incomplete"], "完整时间状态必须与全部排程一致");
  for (const { schedule, targetMealId } of schedules) {
    const cooking = draft.cooking.filter(item => targetMealId === undefined || item.targetMealId === targetMealId);
    if (schedule.batches.some(batch => batch.kind === "reheating" ? !reheating.some(item => reheatingId(item) === reheatingId(batch) && item.recipeId === batch.recipeId && item.mode === "reheating") : !cooking.some(item => item.targetMealId === batch.targetMealId && item.recipeId === batch.recipeId))) invalid(["time"], "排程批次必须属于对应的新做菜");
    if (schedule.complete && (cooking.some(item => !close(item.servings, schedule.batches.filter(batch => batch.kind !== "reheating" && batch.targetMealId === item.targetMealId && batch.recipeId === item.recipeId).reduce((sum, batch) => sum + batch.servings, 0)))
      || draft.unresolved.some(item => targetMealId === undefined || item.targetMealId === targetMealId))) invalid(["time"], "完整排程不能遗漏制作份量、未解决餐次或复热时间");
  }
  for (const session of draft.time.reheatingSessions ?? []) if (session.schedule.batches.some(batch => batch.kind !== "reheating" || batch.targetMealId !== session.targetMealId
    || !reheating.some(item => reheatingId(item) === reheatingId(batch) && item.recipeId === batch.recipeId && item.mode === "reheating"))) invalid(["time", "reheatingSessions"], "食用前排程不能包含无关制作任务");
  const away = draft.effectivePreferences.carry_meals === true || (draft.effectivePreferences.eating_location != null && draft.effectivePreferences.eating_location !== "home");
  if (!draft.time.incomplete && draft.cooking.some(item => (away || (draft.planningMode !== "weekly" && draft.meals.find(meal => meal.id === item.targetMealId)!.date > (draft.productionDate ?? draft.meals.map(meal => meal.date).sort()[0])))
    && !reheating.some(heat => heat.targetMealId === item.targetMealId && !heat.preparedMealId && heat.recipeId === item.recipeId && heat.mode !== "unknown"))) invalid(["time"], "完整时间不能遗漏未来或携带餐的复热核对");
  if (!draft.time.incomplete && (allSchedules.length || draft.time.reheating !== undefined) && draft.meals.some(meal => meal.allocations.some(allocation => !reheating.some(item => item.targetMealId === meal.id && item.preparedMealId === allocation.preparedMealId && item.mode !== "unknown")))) invalid(["time"], "完整时间不能遗漏待吃餐的复热核对");
  if (reheating.some(item => item.mode !== "unknown" && item.recipeId === null)) invalid(["time", "reheating"], "已审核食用方式必须对应实际菜谱");
  if (!draft.time.incomplete) for (const item of reheating.filter(item => item.mode === "reheating")) {
    const servings = allSchedules.flatMap(session => session.schedule.batches).filter(batch => batch.kind === "reheating" && reheatingId(item) === reheatingId(batch)).reduce((sum, batch) => sum + batch.servings, 0);
    if (!close(servings, item.servings)) invalid(["time", "reheating"], "完整排程不能遗漏或重复复热份量");
  }
});
export type CookingPlanDraft = z.infer<typeof cookingPlanDraftSchema>;
export const saveCookingPlanDraftSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(120), draft: cookingPlanDraftSchema,
}).strict();
export type SaveCookingPlanDraftInput = z.infer<typeof saveCookingPlanDraftSchema>;

export const replaceCookingPlanItemSchema = z.object({
  draft: cookingPlanDraftSchema,
  targetMealId: z.string().min(1).max(80),
  recipeId: z.number().int().positive().optional(),
}).strict();
export type ReplaceCookingPlanItemInput = z.infer<typeof replaceCookingPlanItemSchema>;

export const updateCookingPlanDraftSchema = z.object({
  version: z.number().int().positive(), idempotencyKey: z.string().uuid(), draft: cookingPlanDraftSchema,
}).strict();
export type UpdateCookingPlanDraftInput = z.infer<typeof updateCookingPlanDraftSchema>;
