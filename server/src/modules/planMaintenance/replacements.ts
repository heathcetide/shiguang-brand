import { maintenanceSessionTime } from "./sessionTime.js";
import { resolveKitchenPreferences } from "@dietdigidose/contracts";
import { replacementAllocation } from "../mealPlans/replacementAllocation.js";
import { type Row } from "../mealPlans/formatters.js";
import { formatRecommendationProfile, scoreRecipeRecommendations, parseObject } from "../recommendations/scoring.js";
import type { RecommendationDataset } from "../recommendations/types.js";
import { effectiveDislikeRecipeIds, learningOverrides } from "../recommendations/preferenceEvidence.js";
import type { MaintenanceInputSnapshot } from "./inputSnapshot.js";
import type { MaintenanceScope } from "./scope.js";
import type { MaintenanceChange } from "./queue.js";
import { recalculateMaintenanceQuantities } from "./recalculate.js";

type Compatibility = Map<number,{ requirements: Row[]; blocking: Row[] }>;

/** Rule-based proposals; callers must still commit through the input and #195 guards. */
export function selectMaintenanceReplacements(snapshot: MaintenanceInputSnapshot, scope: MaintenanceScope, compatibility: Compatibility, fromDate: string) {
  const working = structuredClone(snapshot);
  const changes: MaintenanceChange[] = [];
  const checks: string[] = [];
  for (const target of scope.items) {
    const before = recalculateMaintenanceQuantities(working,scope,fromDate);
    const assessment = before.assessments.find(value => value.itemId === target.itemId);
    if (!assessment || assessment.decision === "keep") continue;
    const item = working.data.meal_plan_items.find(value => String(value.id) === target.itemId)!;
    if (item.dining_json) {
      checks.push(`餐次 ${target.itemId} 的共餐安排需重新核对参与成员、共享原料与份量，未自动换菜`);
      continue;
    }
    const plan = working.data.meal_plans.find(value => String(value.id) === target.planId)!;
    const constraints = parseObject(plan.constraints_json);
    const saved = parseObject(constraints.savedCookingDraft);
    const draft = parseObject(constraints.currentCookingDraft ?? saved.draft);
    const profile = formatRecommendationProfile(working.data.user_health_profiles?.[0] ?? null);
    profile.kitchen = resolveKitchenPreferences({ ...profile.kitchen,...parseObject(draft.effectivePreferences) });
    const originalRecipe = working.data.recipes.find(recipe => Number(recipe.id) === Number(item.recipe_id));
    const allocation = (constraints.executionItems as Record<string,Row> | undefined)?.[target.itemId];
    const portions = Number(allocation?.servings ?? originalRecipe?.serving_size);
    if (!(portions>0) || !Number.isFinite(portions)) { checks.push(`餐次 ${target.itemId} 份量不明，未自动换菜`); continue; }
    profile.kitchen.servings = portions;
    const dataset: RecommendationDataset = {
      profile, inventory: working.data.inventory_items.filter(row => Boolean(row.is_available) && !row.deleted_at),
      kitchenware: working.data.kitchenware_items.filter(row => !row.deleted_at && row.status !== "维修中"),
      recipes: working.data.recipes.filter(recipe => recipe.status === "approved" && !recipe.deleted_at && recipe.quality_status !== "needs_review"),
      favoriteIds: (working.data.recipe_favorites ?? []).map(row => Number(row.recipe_id)),recentIds: [],
      explicitDislikedIds: Object.entries(learningOverrides(working.data.recommendation_learning_settings?.[0] ?? null)).filter(([,value]) => value.value === "dislike").map(([id]) => Number(id)),
      skippedIds: effectiveDislikeRecipeIds({ settings: working.data.recommendation_learning_settings?.[0] ?? null,
        events: working.data.recipe_recommendation_events ?? [],recipes: working.data.recipes }),
      diet: (working.data.diet_records ?? []).filter(row => String(row.recorded_at) === assessment.date).reduce<{ calories: number; protein: number }>((sum,row) => ({ calories: sum.calories+Number(row.calories ?? 0),protein: sum.protein+Number(row.protein ?? 0) }),{ calories: 0,protein: 0 }),
      dailyCaloriesTarget: Number(profile.nutrition.calories_kcal) || 2000,
      requirements: new Map([...compatibility].map(([id,value]) => [id,value.requirements.map(row => ({ ...row,role: String(row.role) }))])),compatibility,
    };
    const budget = Number(profile.kitchen.meal_time_minutes);
    const ranked = scoreRecipeRecommendations(dataset,{ surface: "meal_plan" },budget,assessment.date).results;
    if (assessment.status === "covered" && ranked.some(candidate => candidate.recipeId === Number(item.recipe_id))) continue;
    if (assessment.status === "unknown") { checks.push(`餐次 ${target.itemId} 数量不确定，未自动换菜`); continue; }
    if (profile.kitchen.budget_per_meal != null || profile.kitchen.carry_meals === true || profile.kitchen.avoid_spicy === true) {
      checks.push(`餐次 ${target.itemId} 的价格、携带或辣度条件需进一步核实，保留原安排`); continue;
    }
    let found = false;
    for (const candidate of ranked) {
      if (candidate.recipeId === Number(item.recipe_id)) continue;
      const governed = compatibility.get(candidate.recipeId);
      if (!governed || governed.blocking.length || governed.requirements.some(row => (row.substitution as Row | null)?.relationType === "conditional")) continue;
      const recipe = working.data.recipes.find(row => Number(row.id) === candidate.recipeId)!;
      if (!(Number(recipe.cook_time)>0) || recipe.prep_time == null) continue;
      if (!allocation && Number(recipe.serving_size) !== portions) continue;
      const scaled = replacementAllocation({ ...item,plan_constraints_json: constraints },recipe);
      if (!scaled) continue;
      const trial = structuredClone(working);
      const trialItem = trial.data.meal_plan_items.find(row => String(row.id) === target.itemId)!;
      Object.assign(trialItem,{ recipe_id: recipe.id,title: recipe.title,ingredients_json: scaled.ingredients });
      // A suggestion has not released its original commitment. Reserve it as well
      // so later proposals cannot promise inventory contingent on its acceptance.
      if (assessment.decision === "suggest") trial.data.meal_plan_items.push({ ...item,id: `reserved-original:${item.id}` });
      const result = recalculateMaintenanceQuantities(trial,scope,fromDate);
      if (result.assessments.find(value => value.itemId === target.itemId)?.status !== "covered") continue;
      if (before.assessments.some(previous => previous.status === "covered" && result.assessments.find(value => value.itemId === previous.itemId)?.status !== "covered")) continue;
      const time = maintenanceSessionTime(trial,trialItem,budget);
      if (time.preparationOrCookingUnknown || time.exceedsBudget) continue;
      changes.push({ ...target,input: { version: target.version,recipeId: candidate.recipeId },reason: "业务变化后原安排有原料缺口或约束冲突，替换为当前库存可覆盖的菜谱" });
      checks.push(`${String(item.planned_date)} ${String(item.meal_type)}：按计划份量分批顺序制作约 ${time.knownSequentialMinutes} 分钟，预算 ${time.budgetMinutes} 分钟；收尾与设备容量尚待核对`);
      Object.assign(working,trial);
      found = true; break;
    }
    if (!found) checks.push(`餐次 ${target.itemId} 暂无满足已知份量、原料、时间与厨具条件的替换，保留原安排`);
  }
  return { changes,checks };
}
