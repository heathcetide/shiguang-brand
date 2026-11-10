import { unexpiredInventory } from "./inventoryAvailability.js";
import { reviewedExecution } from "../recipes/execution.js";
import { scheduleCooking } from "./schedule.js";
import { evaluateHandling } from "./handling.js";
import { recipeDemands } from "./quantities.js";
import { buildFefoConsumptionPreviewFromCandidates } from "../../services/inventoryQuantity.js";
import type { RecommendationDataset, RecommendationInput, Row } from "./types.js";

export const RECIPE_SCORING_VERSION = "rules-2026-10-01.4";
export const RECIPE_CANDIDATE_VERSION = "sql-public-v1";
export const RECOMMENDATION_WEIGHTS = Object.freeze({
  inventoryCoverage: 35, expiringUse: 20, missingPenalty: 20, timeFit: 15, nutritionFit: 10,
  skillFit: 5, favorite: 5, recentRepeatPenalty: 15, skipPenalty: 8,
});

const INGREDIENT_ALIASES: Record<string, string> = {
  西红柿: "番茄", 圣女果: "番茄", 小番茄: "番茄", 青花菜: "西兰花", 马铃薯: "土豆",
  番薯: "红薯", 地瓜: "红薯", 牛油果: "鳄梨", 电饭锅: "电饭煲", 不粘锅: "平底锅",
};
const ALLERGEN_ALIASES: Record<string, string[]> = {
  坚果: ["坚果", "花生", "核桃", "杏仁", "腰果", "榛子", "开心果"], 花生: ["花生", "花生酱", "花生油"],
  乳糖: ["牛奶", "乳糖", "奶油", "奶酪", "芝士", "酸奶", "炼乳"], 大豆: ["大豆", "黄豆", "豆浆", "豆腐", "豆皮", "酱油"],
  海鲜: ["海鲜", "虾", "蟹", "贝", "鱼", "鱿鱼", "章鱼"], 麸质: ["小麦", "面粉", "面包", "面条", "麸质"],
  鸡蛋: ["鸡蛋", "蛋液", "蛋黄", "蛋白"],
};

export function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
export function parseObject(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {}; } catch { return {}; }
}
export function normalizeRecommendationName(value: string) {
  let normalized = value.toLocaleLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/\d+(?:\.\d+)?\s*(?:kg|千克|ml|毫升|[g克升个只颗片份盒包根勺])/gi, "")
    .replace(/新鲜|有机|优质|原切|水培|冷冻|冷藏/g, "").replace(/[\s·、，,。()（）/\\_-]/g, "");
  for (const [alias, canonical] of Object.entries(INGREDIENT_ALIASES)) normalized = normalized.replaceAll(alias.toLocaleLowerCase(), canonical);
  return normalized;
}
function nameMatches(left: string, right: string) {
  const a = normalizeRecommendationName(left); const b = normalizeRecommendationName(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}
function ingredientList(row: Row) {
  return parseArray(row.ingredients_json).flatMap((raw) => {
    if (typeof raw === "string") return raw.trim() ? [{ name: raw.trim(), amount: "" }] : [];
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Row; const name = String(item.name || "").trim();
    return name ? [{ name, amount: String(item.amount || "").trim() }] : [];
  });
}
function requiredTools(row: Row) {
  const text = `${row.title || ""} ${row.tags || ""} ${row.steps_json || ""}`;
  const rules: Array<[RegExp, string]> = [[/空气炸锅/, "空气炸锅"], [/微波炉/, "微波炉"],
    [/(?:破壁机|料理机|搅拌机)/, "破壁机"], [/(?:烤箱|烘焙)/, "烤箱"], [/(?:电饭煲|电饭锅)/, "电饭煲"], [/(?:蒸锅|蒸笼)/, "蒸锅"]];
  return rules.filter(([pattern]) => pattern.test(text)).map(([, tool]) => tool);
}
export function allergyTerms(name: string) {
  const normalized = normalizeRecommendationName(name);
  const alias = Object.entries(ALLERGEN_ALIASES).find(([key]) => normalized.includes(normalizeRecommendationName(key)));
  return [...new Set([name, ...(alias?.[1] || [])])].map(normalizeRecommendationName).filter(Boolean);
}
function daysUntil(dateKey: string, today: string) {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
function timestamp(value: unknown) { return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null; }

export function formatRecommendationProfile(row: Row | null) {
  return {
    allergies: parseArray(row?.allergies_json).map((item) => item as Row),
    restrictions: parseArray(row?.dietary_restrictions_json).map(String),
    disliked: String(row?.disliked_foods || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    kitchen: parseObject(row?.kitchen_constraints_json), nutrition: parseObject(row?.nutrition_targets_json),
    updatedAt: timestamp(row?.updated_at),
  };
}

function recipeSummary(row: Row, requirements: Array<Row & { role: string }>) {
  const execution = reviewedExecution(row);
  const nutritionUnknown = row.nutrition_basis === "unknown";
  const nutrient = (value: unknown) => nutritionUnknown || value == null ? null : Number(value);
  return {
    id: Number(row.id), title: String(row.title), description: String(row.description || ""),
    image_url: row.image_url ? String(row.image_url) : null, cook_time: Number(row.cook_time || 0),
    difficulty: String(row.difficulty || "简单"), calories: nutrient(row.calories), protein: nutrient(row.protein),
    carbs: nutrient(row.carbs), fat: nutrient(row.fat), category: String(row.category || "其他"),
    tags: parseArray(row.tags).map(String), steps: parseArray(row.steps_json).map(String), ingredients: ingredientList(row),
    serving_size: row.serving_size == null ? null : Number(row.serving_size),
    prep_time: row.prep_time == null ? null : Number(row.prep_time),
    execution_profile: execution?.profile ?? null,
    execution_evidence: execution ? { recipeKey: execution.recipeKey, reviewedAt: execution.reviewedAt, reference: execution.profile.reference } : null,
    quality_status: String(row.quality_status || "trusted"), nutrition_basis: String(row.nutrition_basis || "source"),
    nutrition_is_estimated: !nutritionUnknown && String(row.nutrition_basis || "source") !== "source",
    required_kitchenware: requirements.length ? requirements.filter((item) => item.role === "required")
      : requiredTools(row).map((name) => ({ role: "required", catalogName: name, capabilityCode: null })),
  };
}

function hardConflict(recipe: Row, ingredients: Array<{ name: string }>, dataset: RecommendationDataset,
  ownedTools: string[], timeBudget: number | null) {
  const profile = dataset.profile;
  const recipeText = normalizeRecommendationName(`${recipe.title || ""}${recipe.description || ""}${ingredients.map((item) => item.name).join("")}`);
  for (const allergy of profile.allergies) {
    const name = String(allergy.name || "").trim();
    if (name && allergyTerms(name).some((term) => recipeText.includes(term))) return true;
  }
  if (profile.kitchen.avoid_spicy === true) {
    const knownSpicy = /辣椒|辣酱|辣油|辣粉|剁椒|朝天椒|小米椒|花椒|藤椒|芥末/.test(ingredients.map(item => item.name).join("、"));
    const spicyTags = parseArray(recipe.tags).some(tag => /辣/.test(String(tag)) && !/不辣|无辣/.test(String(tag)));
    if (!ingredients.length || knownSpicy || spicyTags) return true;
  }
  const restrictionText = profile.restrictions.join("、");
  if (/素食|纯素/.test(restrictionText) && /(猪|牛|羊|鸡|鸭|鱼|虾|蟹|肉|蛋|奶)/.test(recipeText)) return true;
  if (/清真/.test(restrictionText) && /(猪|料酒|酒精)/.test(recipeText)) return true;
  const knownPreparation = recipe.prep_time == null ? 0 : Number(recipe.prep_time);
  if (!reviewedExecution(recipe) && timeBudget && Number(recipe.cook_time || 0) + knownPreparation > timeBudget) return true;
  const governed = dataset.compatibility.get(Number(recipe.id));
  const missingTools = governed?.requirements.length ? governed.blocking.map((required) =>
    String(required.catalogName || required.capabilityCode || "未映射厨具能力"))
    : requiredTools(recipe).filter((required) => !ownedTools.some((owned) => nameMatches(required, owned)));
  return missingTools.length > 0;
}

export function scoreRecipeRecommendations(dataset: RecommendationDataset,
  input: Omit<RecommendationInput, "cursor" | "pageSize">, timeBudget: number | null, today: string) {
  dataset = { ...dataset, inventory: unexpiredInventory(dataset.inventory, today) };
  const favorites = new Set(dataset.favoriteIds); const recent = new Set(dataset.recentIds); const skipped = new Set(dataset.skippedIds.filter(id => !favorites.has(id) || dataset.explicitDislikedIds?.includes(id)));
  const ownedTools = dataset.kitchenware.map((item) => String(item.name));
  const targetCalories = Number(dataset.profile.nutrition.calories_kcal || dataset.dailyCaloriesTarget || 2000);
  const targetProtein = Number(dataset.profile.nutrition.protein_g || 0);
  const remainingCalories = Math.max(0, targetCalories - dataset.diet.calories);
  const remainingProtein = Math.max(0, targetProtein - dataset.diet.protein);
  const mealShare = input.mealType === "snack" ? 0.12 : 0.3;
  const expectedCalories = Math.max(100, remainingCalories * mealShare);
  const expectedProtein = remainingProtein > 0 ? remainingProtein * mealShare : null;
  const dataTimes = [dataset.profile.updatedAt, ...dataset.inventory.map((item) => timestamp(item.updated_at)),
    ...dataset.kitchenware.map((item) => timestamp(item.updated_at)), ...dataset.recipes.map((item) => timestamp(item.updated_at))]
    .filter((value): value is string => typeof value === "string").sort();
  const dataUpdatedAt = dataTimes.at(-1) || null;
  const results = dataset.recipes.flatMap((recipe) => {
    const ingredients = ingredientList(recipe);
    if (hardConflict(recipe, ingredients, dataset, ownedTools, timeBudget)) return [];
    const nameMatched = ingredients.filter((ingredient) => dataset.inventory.some((item) => nameMatches(ingredient.name, String(item.food_name))));
    const servings = Number(dataset.profile.kitchen.servings) || Number(recipe.serving_size) || 1;
    const summary = recipeSummary(recipe, dataset.requirements.get(Number(recipe.id)) || []);
    if (evaluateHandling(summary.execution_profile?.handling, { targetMealId: "candidate", recipeId: Number(recipe.id),
      productionDate: today, targetDate: today, preferences: dataset.profile.kitchen }).status === "conflict") return [];
    const schedule = scheduleCooking([{ targetMealId: "candidate", recipeId: Number(recipe.id), servings, recipe: summary }], dataset.kitchenware);
    if (schedule.complete && timeBudget && schedule.elapsedMinutes! > timeBudget) return [];
    const timeVerified = schedule.complete && !(dataset.profile.kitchen.carry_meals === true && summary.execution_profile?.handling?.coldServingAllowed !== true);
    const demands = ingredients.map(ingredient => recipeDemands([ingredient], Number(recipe.serving_size) || null, servings)?.[0]);
    const knownDemands = demands.filter((demand): demand is NonNullable<typeof demand> => !!demand);
    const preview = buildFefoConsumptionPreviewFromCandidates(dataset.inventory.map(item => ({ id: item.id, food_name: item.food_name,
      quantity_value: item.quantity_value, quantity_unit: item.quantity_unit, expiration_date: item.expiration_date,
      batch_code: item.batch_code, version: item.version, quantity_evidence_status: item.quantity_evidence_status as "known" | "estimated" | "unknown" | undefined })), knownDemands);
    let previewIndex = 0;
    const states = demands.map(demand => demand ? preview[previewIndex++].quantity_status : "unknown");
    const matched = ingredients.filter((_, index) => states[index] === "sufficient");
    const missing = ingredients.filter((_, index) => ["insufficient", "unavailable"].includes(states[index]));
    const uncertain = ingredients.filter((_, index) => states[index] === "unknown");
    const expiring = matched.flatMap((ingredient) => dataset.inventory.filter((item) => nameMatches(ingredient.name, String(item.food_name))
      && daysUntil(String(item.expiration_date), today) >= 0 && daysUntil(String(item.expiration_date), today) <= 3)
      .map((item) => ({ name: String(item.food_name), daysLeft: daysUntil(String(item.expiration_date), today) })));
    const coverage = ingredients.length ? matched.length / ingredients.length : 0;
    if (input.category === "冰箱可做" && nameMatched.length === 0) return [];
    if (input.matchStatus === "full" && (!ingredients.length || missing.length > 0 || uncertain.length > 0)) return [];
    if (input.matchStatus === "missing_few" && (missing.length < 1 || missing.length > 2 || uncertain.length > 0)) return [];
    if (input.matchStatus === "expiring" && expiring.length === 0) return [];
    const cookTime = Number(recipe.cook_time || 0);
    const knownTime = schedule.elapsedMinutes ?? cookTime + Number(recipe.prep_time ?? 0);
    const timeFit = timeBudget ? Math.max(0, 1 - Math.abs(timeBudget - knownTime) / Math.max(timeBudget, 1)) : Math.max(0, 1 - knownTime / 120);
    const calorieFit = Math.max(0, 1 - Math.abs(Number(recipe.calories || 0) - expectedCalories) / Math.max(expectedCalories, 1));
    const proteinFit = expectedProtein ? Math.max(0, 1 - Math.abs(Number(recipe.protein || 0) - expectedProtein) / Math.max(expectedProtein, 1)) : calorieFit;
    const nutritionFit = (calorieFit + proteinFit) / 2;
    const level = String(dataset.profile.kitchen.cooking_level || ""); const difficulty = String(recipe.difficulty || "简单");
    const skillFit = level === "beginner" && /困难|大师/.test(difficulty) ? 0 : level === "advanced" ? 1 : 0.8;
    const dislikedPenalty = dataset.profile.disliked.some((name) => ingredients.some((item) => nameMatches(name, item.name))) ? 8 : 0;
    const score = Math.round((coverage * RECOMMENDATION_WEIGHTS.inventoryCoverage + Math.min(1, expiring.length / 2) * RECOMMENDATION_WEIGHTS.expiringUse
      - Math.min(1, missing.length / Math.max(ingredients.length, 1)) * RECOMMENDATION_WEIGHTS.missingPenalty + timeFit * RECOMMENDATION_WEIGHTS.timeFit
      + nutritionFit * RECOMMENDATION_WEIGHTS.nutritionFit + skillFit * RECOMMENDATION_WEIGHTS.skillFit
      + (favorites.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.favorite : 0) - (recent.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.recentRepeatPenalty : 0)
      - (skipped.has(Number(recipe.id)) ? RECOMMENDATION_WEIGHTS.skipPenalty : 0) - dislikedPenalty) * 100) / 100;
    const reasons: string[] = [];
    if (skipped.has(Number(recipe.id))) reasons.push(dataset.explicitDislikedIds?.includes(Number(recipe.id)) ? "按你明确设置的不喜欢降低排序" : "近30天多次明确表示长期不喜欢，暂时降低排序；不会排除菜谱");
    if (expiring.length) reasons.push(`可优先使用 ${expiring.slice(0, 2).map((item) => item.name).join("、")} 等临期食材`);
    if (coverage > 0) reasons.push(`已知用量覆盖 ${Math.round(coverage * 100)}%，${matched.length} 项原料数量足够`);
    if (schedule.complete) reasons.push(`按已审核流程分 ${schedule.batches.length} 批，含准备、烹饪和收尾约 ${schedule.elapsedMinutes} 分钟`);
    else if (cookTime > 0) reasons.push(recipe.prep_time == null
      ? `烹饪约 ${cookTime} 分钟，准备与收尾时间待核实`
      : `准备与烹饪约 ${cookTime + Number(recipe.prep_time)} 分钟，尚未计入收尾及多菜设备安排`);
    if (schedule.complete && !timeVerified) reasons.push("携带餐的复热设备与用时仍须核对");
    if (!reasons.length) reasons.push("通过公开权限、质量与安全硬约束检查");
    if (uncertain.length) reasons.unshift(`${uncertain.length} 项原料的用量或库存数量待核对`);
    const degraded: string[] = [];
    if (uncertain.length) degraded.push("inventory_quantity_unknown");
    if (!ingredients.length) degraded.push("ingredients_unstructured");
    if (dataset.profile.kitchen.avoid_spicy === true) degraded.push("spiciness_requires_ingredient_confirmation");
    if (!timeVerified) degraded.push("whole_plan_time_unverified");
    if (!schedule.complete && (!cookTime || recipe.prep_time == null)) degraded.push("preparation_time_unknown");
    if (dataset.profile.kitchen.budget_per_meal) degraded.push("recipe_price_unavailable");
    if (dataset.profile.kitchen.servings && !(Number(recipe.serving_size) > 0)) degraded.push("recipe_yield_unavailable");
    return [{ recipeId: Number(recipe.id), recipe: summary, score,
      scoringVersion: RECIPE_SCORING_VERSION, candidateVersion: RECIPE_CANDIDATE_VERSION,
      hardConstraints: { satisfied: ["quality", "permission", "allergy", "kitchenware", ...(timeVerified ? ["time"] : [])], unmet: [] as string[], pending: timeVerified ? [] : ["time"] },
      features: { inventoryEvidence: { version: 1, scope: "personal", allocations: preview.flatMap(item => item.deductions.map(deduction => ({
        itemId: Number(deduction.item_id), itemVersion: Number(deduction.version), amount: Number(deduction.amount_value), unit: String(deduction.unit),
      }))) }, inventoryCoverage: Math.round(coverage * 100), matchedIngredients: matched, expiringIngredients: expiring,
        missingIngredients: missing, uncertainIngredients: uncertain, nameMatchedIngredients: nameMatched, timeBudgetMinutes: timeBudget, estimatedTimeMinutes: knownTime, cookingSchedule: schedule, nutritionFit: Math.round(nutritionFit * 100),
        favorite: favorites.has(Number(recipe.id)), recentRepeat: recent.has(Number(recipe.id)), skippedRecently: skipped.has(Number(recipe.id)) },
      reasons: reasons.slice(0, 3), dataUpdatedAt, degraded }];
  }).sort((a, b) => b.score - a.score || a.recipeId - b.recipeId);
  return { results, dataUpdatedAt, timeBudget, profile: dataset.profile };
}
