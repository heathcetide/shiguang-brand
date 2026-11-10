import { activePreparedAllocations, unallocatedPreparedMeals } from "../mealPlans/preparedAllocations.js";
import { interventionDates, interventionRecommendations } from "../interventions/snapshot.js";
import { weeklyHistoryStart } from "./shoppingWindow.js";
import { formatOutcomeEvidence } from "./outcomeEvidence.js";
import { effectiveDislikeRecipeIds, learningOverrides, formatLearningState } from "./preferenceEvidence.js";
import { preferenceLearningUpdateSchema, type PreferenceLearningUpdate } from "@dietdigidose/contracts";
import { buildWeeklyPlan } from "./weeklyPlan.js";
import { reviewedExecution } from "../recipes/execution.js";
import { preparedHandlingChecks } from "./handling.js";
import { weeklyPlanRequestSchema, type WeeklyPlanRequest } from "@dietdigidose/contracts";
import { parseJson } from "../mealPlans/formatters.js";
import { buildCookingDraft, replaceCookingDraft } from "./plan.js";
import { cookingPlanDraftSchema, replaceCookingPlanItemSchema, mealPlanRequirementsSchema, type ReplaceCookingPlanItemInput, type MealPlanRequirementsInput } from "@dietdigidose/contracts";
import { formatPreparedMeal } from "../dietRecords/preparedMeals.js";
import { allocatePreparedMeals } from "./requirements.js";
import { resolveKitchenPreferences, type KitchenPreferences } from "@dietdigidose/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { KitchenwareService } from "../kitchenware/service.js";
import { currentDateKey } from "../../utils/date.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { RecommendationsError } from "./errors.js";
import type { RecommendationsRepository } from "./repository.js";
import { formatRecommendationProfile, parseArray, RECIPE_CANDIDATE_VERSION, RECIPE_SCORING_VERSION, scoreRecipeRecommendations } from "./scoring.js";
import type { RecommendationDataset, RecommendationEventInput, RecommendationInput, Row } from "./types.js";

const executionProfiles = (rows: Row[]) => new Map(rows.flatMap(row => {
  const review = reviewedExecution(row); return review ? [[Number(row.id), review] as const] : [];
}));

export class RecommendationsService {
  private readonly repository: RecommendationsRepository;
  private readonly kitchenware: Pick<KitchenwareService, "requirements" | "evaluateRequirements">;
  constructor(repository: RecommendationsRepository, kitchenware: Pick<KitchenwareService, "requirements" | "evaluateRequirements">) {
    this.repository = repository;
    this.kitchenware = kitchenware;
  }

  async interventionSnapshot(userId: number,now: number,timeZone: string) {
    const dates = interventionDates(now,timeZone);
    const [computed,stock,state] = await Promise.all([
      this.compute(userId,{ surface: "inventory",mealType: "dinner" },{},dates[0]),
      this.repository.inventory(userId),this.repository.planningState(userId,dates[0],dates[1]),
    ]);
    return { dates,recommendations: interventionRecommendations(computed.results),items: state.items,plans: state.plans,
      inventory: stock.map(row => ({ id: Number(row.id),userId,expirationDate: typeof row.expiration_date === "string" ? row.expiration_date : null,
        available: true,deleted: false,remaining: row.quantity_evidence_status === "unknown" ? 0 : Number(row.quantity_value) })) };
  }

  async learningState(userId: number) {
    const [data,outcomes] = await Promise.all([this.repository.learningData(userId),this.repository.preferenceOutcomes(userId)]);
    return { ...formatLearningState(data),observations: formatOutcomeEvidence(outcomes.production,outcomes.events,outcomes.inventory,outcomes.changes,outcomes.statements) };
  }
  async updateLearning(userId: number,input: PreferenceLearningUpdate) {
    const request = preferenceLearningUpdateSchema.parse(input);
    if (request.kind === "recipe" && !await this.repository.recipeAvailable(request.recipeId)) {
      const own = await this.repository.learningData(userId);
      if (request.value !== "neutral" || (!learningOverrides(own.settings)[String(request.recipeId)] && !own.events.some(event => Number(event.recipe_id) === request.recipeId))) throw new RecommendationsError(404,"菜谱不存在或当前不可设置偏好","RECIPE_NOT_AVAILABLE");
    }
    if (!await this.repository.updateLearning(userId,request)) throw new RecommendationsError(409,"偏好已更新，请刷新后重试","PREFERENCE_VERSION_CONFLICT");
    return this.learningState(userId);
  }
  async weeklyPlan(userId: number, input: WeeklyPlanRequest) {
    const request = weeklyPlanRequestSchema.parse(input);
    const end = new Date(`${request.startDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+6);
    const endDate = end.toISOString().slice(0,10);
    const [computed,stock,batches,state] = await Promise.all([this.compute(userId,{ surface: "meal_plan" }, request.reheatingDeviceIds?.length ? { reheating_available: true } : {}),this.repository.inventory(userId),this.repository.preparedMeals(userId),this.repository.planningState(userId,request.startDate,endDate)]);
    const reservations = activePreparedAllocations(state.plans);
    const items = [...state.items];
    for (const plan of state.plans) {
      if (Array.isArray(plan.prepared_allocations)) {
        for (const row of plan.prepared_allocations) if (row.status === "active" && row.remainingServings > 0 && row.plannedDate >= request.startDate) {
          items.push({ id: `prepared-plan:${row.id}`, planned_date: row.plannedDate, meal_type: row.mealType,
            title: String(batches.find(batch => String(batch.id) === row.preparedMealId)?.food_name ?? "已安排待吃餐"), prepared_only: true, status: "planned" });
        }
        continue;
      }
      const constraints = parseJson<Row>(plan.constraints_json,{});
      const saved = constraints.savedCookingDraft as { draft?: unknown } | undefined;
      const draft = cookingPlanDraftSchema.safeParse(constraints.currentCookingDraft ?? saved?.draft);
      if (!draft.success) continue;
      for (const meal of draft.data.meals) {
        if (meal.date < request.startDate) continue;
        if (meal.cookServings === 0) items.push({ id: `prepared-plan:${plan.id}:${meal.id}`,planned_date: meal.date,meal_type: meal.mealType,title: meal.allocations.map(item => item.foodName).join("、"),prepared_only: true,status: "planned" });
      }
    }
    const profiles = executionProfiles(batches.length ? await this.repository.recipes({ timeBudget: null }) : []);
    const rules = new Map([...profiles].flatMap(([id, review]) => review.profile.handling ? [[id, review.profile.handling] as const] : []));
    return buildWeeklyPlan(request,computed.profile.kitchen,computed.results,stock,batches.map(formatPreparedMeal),items,state.shopping,reservations, await this.repository.kitchenware(userId), rules, profiles);
  }

  async planRequirements(userId: number, input: MealPlanRequirementsInput) {
    const request = mealPlanRequirementsSchema.parse(input);
    const dates = request.meals.map(meal => meal.date).sort();
    const [profile, prepared, state] = await Promise.all([this.repository.profile(userId), this.repository.preparedMeals(userId),
      this.repository.planningState(userId, dates[0], dates[dates.length - 1])]);
    const preferences = resolveKitchenPreferences(formatRecommendationProfile(profile).kitchen,{ ...request.preferences, ...(request.reheatingDeviceIds?.length ? { reheating_available: true } : {}) });
    const rules = new Map((prepared.length ? await this.repository.recipes({ timeBudget: null }) : []).flatMap(row => {
      const rule = reviewedExecution(row)?.profile.handling;
      return rule ? [[Number(row.id), rule] as const] : [];
    }));
    return allocatePreparedMeals({ ...request,preferences }, unallocatedPreparedMeals(prepared.map(formatPreparedMeal), state.plans), rules);
  }

  async cookingPlan(userId: number, input: MealPlanRequirementsInput) {
    const requirements = await this.planRequirements(userId, input);
    const candidates = await this.compute(userId, { surface: "meal_plan" }, { ...input.preferences, ...(input.reheatingDeviceIds?.length ? { reheating_available: true } : {}) });
    const hasPrepared = requirements.meals.some(meal => meal.allocations.length);
    const [stock, devices, prepared, rows] = await Promise.all([this.repository.inventory(userId), this.repository.kitchenware(userId),
      hasPrepared ? this.repository.preparedMeals(userId) : Promise.resolve([]), hasPrepared ? this.repository.recipes({ timeBudget: null }) : Promise.resolve([])]);
    return cookingPlanDraftSchema.parse(buildCookingDraft({ ...requirements, effectivePreferences: candidates.profile.kitchen }, candidates.results, stock, candidates.timeBudget!, devices,
      { prepared: prepared.map(formatPreparedMeal), profiles: executionProfiles(rows) }));
  }

  async replaceCookingItem(userId: number, input: ReplaceCookingPlanItemInput) {
    const request = replaceCookingPlanItemSchema.parse(input);
    const candidates = await this.compute(userId, { surface: "meal_plan" }, request.draft.effectivePreferences);
    const dates = request.draft.meals.map(meal => meal.date).sort();
    const [stock, devices, prepared, recipes, state] = await Promise.all([
      this.repository.inventory(userId), this.repository.kitchenware(userId), this.repository.preparedMeals(userId),
      request.draft.meals.some(meal => meal.allocations.length) ? this.repository.recipes({ timeBudget: null }) : Promise.resolve([]),
      request.draft.planningMode === "weekly" ? this.repository.planningState(userId,weeklyHistoryStart(request.draft),request.draft.shoppingWindow?.endDate ?? dates[dates.length-1]) : Promise.resolve(null),
    ]);
    const rules = new Map(recipes.flatMap(row => { const rule = reviewedExecution(row)?.profile.handling; return rule ? [[Number(row.id), rule] as const] : []; }));
    return replaceCookingDraft(request.draft, request.targetMealId, request.recipeId, candidates.results, stock,state?.items ?? [], devices,
      preparedHandlingChecks(request.draft, prepared.map(formatPreparedMeal), rules), { prepared: prepared.map(formatPreparedMeal), profiles: executionProfiles(recipes) });
  }

  versions() { return { scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION }; }

  async compute(userId: number, input: Omit<RecommendationInput, "cursor" | "pageSize">, override: KitchenPreferences = {}, date = currentDateKey()) {
    const profile = formatRecommendationProfile(await this.repository.profile(userId));
    profile.kitchen = resolveKitchenPreferences(profile.kitchen, override);
    const timeBudget = input.maxCookTime ?? resolveKitchenPreferences(profile.kitchen).meal_time_minutes;
    const [inventory, kitchenware, recipes, favoriteIds, recentIds, learning, diet, dailyCaloriesTarget] = await Promise.all([
      this.repository.inventory(userId), this.repository.kitchenware(userId), this.repository.recipes({
        category: input.category, search: input.search, timeBudget,
      }), this.repository.favoriteRecipeIds(userId), this.repository.recentRecipeIds(userId),
      this.repository.learningData(userId), this.repository.dietTotals(userId, date),
      this.repository.dailyCaloriesTarget(userId),
    ]);
    const requirementEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.requirements(Number(recipe.id))] as const));
    const compatibilityEntries = await Promise.all(recipes.map(async (recipe) => [Number(recipe.id), await this.kitchenware.evaluateRequirements(userId, Number(recipe.id))] as const));
    const dataset: RecommendationDataset = {
      profile, inventory, kitchenware, recipes, favoriteIds, recentIds, skippedIds: effectiveDislikeRecipeIds(learning), explicitDislikedIds: Object.entries(learningOverrides(learning.settings)).filter(([,value]) => value.value === "dislike").map(([id]) => Number(id)), diet, dailyCaloriesTarget,
      requirements: new Map(requirementEntries) as RecommendationDataset["requirements"],
      compatibility: new Map(compatibilityEntries) as RecommendationDataset["compatibility"],
    };
    return scoreRecipeRecommendations(dataset, input, timeBudget, date);
  }

  async page(userId: number, input: RecommendationInput) {
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor); const requestId = cursor?.requestId; const offset = Number(cursor?.offset);
      if (cursor?.v !== 1 || typeof requestId !== "string" || !Number.isInteger(offset) || offset < 0) {
        throw new RecommendationsError(400, "推荐游标格式不正确", "INVALID_RECOMMENDATION_CURSOR");
      }
      const snapshot = await this.repository.findRequest(userId, requestId);
      if (!snapshot || snapshot.scoring_version !== RECIPE_SCORING_VERSION) {
        throw new RecommendationsError(410, "本轮推荐已过期，请重新获取", "RECOMMENDATION_CURSOR_EXPIRED");
      }
      const results = parseArray(snapshot.results_json) as Row[]; const items = results.slice(offset, offset + input.pageSize);
      const dataUpdatedAt = snapshot.data_updated_at instanceof Date
        ? snapshot.data_updated_at.toISOString()
        : snapshot.data_updated_at ? String(snapshot.data_updated_at) : null;
      return { requestId, scoringVersion: String(snapshot.scoring_version), candidateVersion: String(snapshot.candidate_version),
        dataUpdatedAt, items, total: results.length,
        nextCursor: offset + items.length < results.length ? encodeCursor({ v: 1, requestId, offset: offset + items.length }) : null };
    }
    const computed = await this.compute(userId, input); const requestId = randomUUID();
    const inputSnapshot = { ...input, timeBudgetMinutes: computed.timeBudget, inventoryUpdatedAt: computed.dataUpdatedAt };
    const inputJson = JSON.stringify(inputSnapshot);
    await this.repository.createRequest({ id: requestId, userId, surface: input.surface, scoringVersion: RECIPE_SCORING_VERSION,
      candidateVersion: RECIPE_CANDIDATE_VERSION, inputHash: createHash("sha256").update(inputJson).digest("hex"),
      inputSnapshot, results: computed.results, dataUpdatedAt: computed.dataUpdatedAt });
    const items = computed.results.slice(0, input.pageSize);
    return { requestId, scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION,
      dataUpdatedAt: computed.dataUpdatedAt, items, total: computed.results.length,
      nextCursor: items.length < computed.results.length ? encodeCursor({ v: 1, requestId, offset: items.length }) : null };
  }

  async event(userId: number, input: RecommendationEventInput) {
    const existing = await this.repository.findEvent(userId, input.idempotencyKey);
    const assertIdentity = (event: Row) => {
      if ((event.request_id ?? null) !== (input.requestId ?? null) || Number(event.recipe_id) !== input.recipeId
        || event.event_type !== input.eventType || event.scoring_version !== input.scoringVersion || event.surface !== input.surface)
        throw new RecommendationsError(409, "此操作编号已用于另一条推荐反馈", "RECOMMENDATION_EVENT_CONFLICT");
    };
    if (existing) { assertIdentity(existing); return { eventId: String(existing.id), repeated: true }; }
    if (!await this.repository.recipeAvailable(input.recipeId)) {
      throw new RecommendationsError(404, "菜谱不存在或当前不可推荐", "RECIPE_NOT_AVAILABLE");
    }
    // Client metadata must never supply the evidence later used by metrics.
    const metadata = { ...input.metadata };
    delete metadata.selectionEvidence;
    if (input.requestId) {
      const request = await this.repository.requestEvidence(userId, input.requestId);
      if (!request) throw new RecommendationsError(404, "推荐请求不存在", "RECOMMENDATION_REQUEST_NOT_FOUND");
      if (request.scoring_version !== input.scoringVersion) throw new RecommendationsError(409, "评分版本与推荐请求不一致", "RECOMMENDATION_VERSION_MISMATCH");
      const candidate = (parseArray(request.results_json) as Row[]).find(row => Number(row.recipeId) === input.recipeId);
      if (!candidate) throw new RecommendationsError(409, "菜谱不属于本轮推荐，请刷新后重试", "RECOMMENDATION_RECIPE_MISMATCH");
      const features = candidate.features as Row | undefined;
      // A view only proves opening the recipe. Cooking/intake evidence must be
      // linked separately before any weekly metric can count this selection.
      if (["view", "queue", "start"].includes(input.eventType)) metadata.selectionEvidence = {
        version: 1, requestId: input.requestId, recipeId: input.recipeId,
        inventory: features?.inventoryEvidence ?? null,
      };
    }
    const result = await this.repository.createEvent(randomUUID(), userId, { ...input, metadata });
    if (result.repeated) {
      const winner = await this.repository.findEvent(userId, input.idempotencyKey);
      if (!winner) throw new RecommendationsError(409, "推荐反馈已变化，请重试", "RECOMMENDATION_EVENT_CONFLICT");
      assertIdentity(winner);
    }
    return { eventId: result.id, repeated: result.repeated };
  }
}
