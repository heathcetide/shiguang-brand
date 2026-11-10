import { createHash } from "node:crypto";
import { reviewedExecution } from "./execution.js";
import { recipeMinutesSchema } from "../../utils/recipeMinutes.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { ensureIngredientGroups, normalizeIngredientGroup } from "../../utils/ingredientGroups.js";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { RecipesError } from "./errors.js";
import type { RecipesRepository } from "./repository.js";
import type {
  NutritionItem, RecipeInput, RecipeRequirementWrite, RecipeSubmissionWrite, Row,
} from "./types.js";

const LEGACY_NUTRIENT_KEYS = new Set(["protein", "carbs", "fat"]);
const DEFAULT_PUBLIC_RECIPE_LIMIT = 24;
const MAX_PUBLIC_RECIPE_LIMIT = 100;

type RequestOrigin = { protocol: string; host?: string };
type CatalogResolver = { resolveCatalog(rawName: string): Promise<{ id: number; confidence: number } | null> };

export function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseNutrition(value: unknown): NutritionItem[] {
  const seen = new Set<string>();
  return parseArray(value)
    .map((item, index) => {
      const nutrient = item as Row;
      const label = String(nutrient?.label || "").trim().slice(0, 20);
      const key = String(nutrient?.key || `custom-${index}-${label}`).trim().slice(0, 40);
      return { key, label, value: Number(nutrient?.value), unit: String(nutrient?.unit || "g").trim().slice(0, 10) };
    })
    .filter((item) => {
      const normalizedKey = item.key.toLowerCase();
      if (!item.label || !Number.isFinite(item.value) || item.value < 0 || item.value > 1_000_000) return false;
      if (LEGACY_NUTRIENT_KEYS.has(normalizedKey) || seen.has(normalizedKey)) return false;
      seen.add(normalizedKey);
      return true;
    })
    .slice(0, 12);
}

export function inferredKitchenware(steps: string[], explicit: unknown) {
  if (Array.isArray(explicit) && explicit.length) return explicit.map((item) => String(item).trim()).filter(Boolean);
  const text = steps.join(" ");
  const names = [
    ...(/空气炸锅/.test(text) ? ["空气炸锅"] : []), ...(/烤箱|烘焙|烘烤/.test(text) ? ["烤箱"] : []),
    ...(/蒸/.test(text) ? ["蒸锅"] : []), ...(/煮|炖|汤|焯/.test(text) ? ["汤锅"] : []),
    ...(/炒|煎|爆/.test(text) ? ["炒锅"] : []), "菜刀",
  ];
  return [...new Set(names)];
}

function normalizedTimestamp(value: unknown) {
  return value instanceof Date ? value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "") : value;
}

function normalizeRowDates(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizedTimestamp(value)])) as Row;
}

export function normalizeRecipeInput(body: Row): RecipeInput {
  const title = String(body.title || "").trim();
  const ingredients = parseArray(body.ingredients ?? body.ingredients_json)
    .map((item) => {
      if (typeof item === "string") return { name: item.trim(), amount: "", group: undefined };
      const value = item as Row;
      return { name: String(value?.name || "").trim(), amount: String(value?.amount || "").trim(),
        group: normalizeIngredientGroup(value?.group) || undefined };
    }).filter((item) => item.name);
  const steps = parseArray(body.steps ?? body.steps_json).map((item) => String(item || "").trim()).filter(Boolean);
  const tags = parseArray(body.tags).map((item) => String(item || "").trim()).filter(Boolean);
  const requiredKitchenware = inferredKitchenware(steps, body.required_kitchenware);
  const optionalKitchenware = Array.isArray(body.optional_kitchenware)
    ? body.optional_kitchenware.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return {
    title, description: String(body.description || "").trim(), imageUrl: String(body.image_url || "").trim(),
    cookTime: recipeMinutesSchema.parse(body.cook_time) ?? 0, difficulty: String(body.difficulty || "简单").trim(),
    calories: Math.max(0, Number(body.calories) || 0), protein: Math.max(0, Number(body.protein) || 0),
    carbs: Math.max(0, Number(body.carbs) || 0), fat: Math.max(0, Number(body.fat) || 0),
    nutrition: parseNutrition(body.nutrition ?? body.nutrition_json), category: String(body.category || "其他").trim(),
    tags, steps, ingredients: ensureIngredientGroups(ingredients, title),
    servingSize: Number(body.serving_size) || 2, prepTime: recipeMinutesSchema.parse(body.prep_time),
    cuisine: body.cuisine ? String(body.cuisine) : null,
    mealTypes: Array.isArray(body.meal_types) ? body.meal_types.map(String) : [],
    requiredKitchenware, optionalKitchenware,
  };
}

function validateRecipe(input: RecipeInput) {
  if (input.title.length < 2 || input.title.length > 80) throw new RecipesError(400, "食谱标题需为 2-80 个字符");
  if (input.description.length > 1000) throw new RecipesError(400, "食谱简介不能超过 1000 个字符");
  if (!input.ingredients.length) throw new RecipesError(400, "请至少填写一种食材");
  if (!input.steps.length) throw new RecipesError(400, "请至少填写一个烹饪步骤");
  if (input.ingredients.length > 50 || input.steps.length > 30) throw new RecipesError(400, "食材或步骤数量过多");
  if (input.nutrition.length > 12) throw new RecipesError(400, "自定义营养项不能超过 12 个");
  if (input.imageUrl.length > 4_000_000) throw new RecipesError(400, "封面图片过大，请压缩后重试");
}

function normalizedContentSet(value: unknown) {
  return new Set(parseArray(value).flatMap((item) => {
    const raw = typeof item === "string" ? item : String((item as Row)?.name || "");
    const normalized = normalizeContentTerm(raw);
    return normalized ? [normalized] : [];
  }));
}

function recipeFingerprint(input: { title: string; ingredients: unknown; steps: unknown }) {
  const payload = {
    title: normalizeContentTerm(input.title),
    ingredients: [...normalizedContentSet(input.ingredients)].sort(),
    steps: parseArray(input.steps).map((step) => normalizeContentTerm(String(step))).filter(Boolean),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class RecipesService {
  private readonly repository: RecipesRepository;
  private readonly catalog: CatalogResolver;

  constructor(repository: RecipesRepository, catalog: CatalogResolver) {
    this.repository = repository;
    this.catalog = catalog;
  }

  async list(userId: number | undefined, query: Row, origin: RequestOrigin) {
    const cursorMode = query.pageSize !== undefined || query.cursor !== undefined;
    const pageSize = Math.min(MAX_PUBLIC_RECIPE_LIMIT, Math.max(1, Number(query.pageSize) || DEFAULT_PUBLIC_RECIPE_LIMIT));
    const requestedMaxCookTime = Number(query.maxCookTime);
    const maxCookTime = Number.isFinite(requestedMaxCookTime) && requestedMaxCookTime > 0 ? Math.floor(requestedMaxCookTime) : null;
    const cursor = query.cursor ? decodeCursor(String(query.cursor)) : null;
    const cursorId = cursor ? Number(cursor.id) : null;
    if (query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
      throw new RecipesError(400, "分页游标无效", "INVALID_CURSOR");
    }
    const scope = typeof query.scope === "string" ? query.scope : undefined;
    if (scope === "personal" && !userId) throw new RecipesError(401, "登录后查看个人食谱库");
    const result = await this.repository.listPublic({
      userId, scope, category: typeof query.category === "string" ? query.category : undefined,
      search: typeof query.search === "string" ? query.search.trim() : undefined,
      maxCookTime, cursorId: cursorMode ? cursorId : null, limit: cursorMode ? pageSize + 1 : pageSize,
    });
    const hasMore = cursorMode && result.rows.length > pageSize;
    const pageRows = cursorMode ? result.rows.slice(0, pageSize) : result.rows;
    const items = await this.formatMany(pageRows, origin);
    if (!cursorMode) return { candidates: result.rows.length, body: items };
    const last = pageRows.at(-1);
    return { candidates: result.rows.length, body: { items, total: result.total,
      nextCursor: hasMore && last?.id ? encodeCursor({ v: 1, id: Number(last.id) }) : null } };
  }

  async summary(userId?: number) {
    const value = await this.repository.librarySummary(userId);
    return { ...value, publicTotal: value.official + value.community,
      scopeContract: "approved_non_deleted_quality_checked_v1", household: { supported: false, count: 0 } };
  }

  async mine(userId: number, origin: RequestOrigin) { return this.formatMany(await this.repository.listMine(userId), origin); }

  async favorites(userId: number, origin: RequestOrigin) {
    return (await this.formatMany(await this.repository.listFavorites(userId), origin))
      .map((recipe) => ({ ...recipe, is_favorited: true }));
  }

  async favoriteCount(userId: number) { return { count: await this.repository.favoriteCount(userId) }; }

  async createSubmission(userId: number, body: Row) {
    const input = normalizeRecipeInput(body);
    validateRecipe(input);
    const id = await this.repository.createSubmission(await this.submissionWrite(userId, input));
    return { success: true, id, status: "pending", message: "食谱投稿成功，等待管理员审核" };
  }

  async updateSubmission(userId: number, recipeId: number, body: Row) {
    const existing = await this.repository.findSubmission(userId, recipeId);
    if (!existing) throw new RecipesError(404, "未找到该投稿");
    if (!["pending", "rejected"].includes(String(existing.status))) {
      throw new RecipesError(400, "已审核通过的食谱不能直接修改，请先撤回");
    }
    const input = normalizeRecipeInput(body);
    validateRecipe(input);
    if (!await this.repository.updateSubmission(recipeId, await this.submissionWrite(userId, input))) {
      throw new RecipesError(404, "未找到该投稿");
    }
    return { success: true, status: "pending", message: "投稿已更新并重新进入审核" };
  }

  async withdrawSubmission(userId: number, recipeId: number) {
    if (!await this.repository.withdrawSubmission(userId, recipeId)) throw new RecipesError(404, "未找到该投稿");
    return { success: true, message: "投稿已撤回" };
  }

  async favoriteStatus(userId: number, recipeId: number) {
    return { is_favorited: await this.repository.isFavorite(userId, recipeId) };
  }

  async addFavorite(userId: number, recipeId: number) {
    if (!await this.repository.addFavorite(userId, recipeId)) throw new RecipesError(404, "未找到该食谱");
    return { success: true, is_favorited: true };
  }

  async removeFavorite(userId: number, recipeId: number) {
    await this.repository.removeFavorite(userId, recipeId);
    return { success: true, is_favorited: false };
  }

  async detail(recipeId: number, origin: RequestOrigin) {
    const recipe = await this.repository.findPublic(recipeId);
    if (!recipe) throw new RecipesError(404, "未找到该食谱");
    return (await this.formatMany([recipe], origin))[0];
  }

  private async submissionWrite(userId: number, recipe: RecipeInput): Promise<RecipeSubmissionWrite> {
    const requirements = await this.mapRequirements(recipe.requiredKitchenware, recipe.optionalKitchenware);
    return { recipe, authorUserId: userId, canonicalKey: normalizeContentTerm(recipe.title),
      sourceContentHash: recipeFingerprint({ title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps }),
      requirements };
  }

  private async mapRequirements(required: string[], optional: string[]): Promise<RecipeRequirementWrite[]> {
    const values: Array<{ rawName: string; role: "required" | "optional" }> = [
      ...[...new Set(required)].map((rawName) => ({ rawName, role: "required" as const })),
      ...[...new Set(optional)].map((rawName) => ({ rawName, role: "optional" as const })),
    ];
    return Promise.all(values.map(async ({ rawName, role }) => {
      const resolved = await this.catalog.resolveCatalog(rawName);
      const accepted = resolved && resolved.confidence === 1 ? resolved : null;
      return { rawName, normalizedName: normalizeContentTerm(rawName), role,
        catalogId: accepted?.id || null, confidence: resolved?.confidence || 0 };
    }));
  }

  private async formatMany(rows: Row[], origin: RequestOrigin) {
    const requirementRows = await this.repository.requirementsForRecipes(rows.map((row) => Number(row.id)));
    const requirements = new Map<number, Row[]>();
    for (const row of requirementRows) {
      const recipeId = Number(row.recipe_id);
      requirements.set(recipeId, [...(requirements.get(recipeId) || []), row]);
    }
    return rows.map((rawRow) => {
      const recipe = normalizeRowDates(rawRow);
      const { base_data_payload: basePayload, quality_issues_json: _qualityIssues, quality_reviewed_by: _qualityReviewer,
        quality_reviewed_at: _qualityReviewedAt, quality_review_reason: _qualityReviewReason, execution_json: _execution, ...publicRecipe } = recipe;
      const execution = reviewedExecution(recipe);
      let concept: Row = {};
      try { concept = typeof basePayload === 'string' ? JSON.parse(basePayload) : (basePayload as Row) || {}; } catch { /* Legacy payload. */ }
      const nutritionUnknown = recipe.nutrition_basis === 'unknown';
      const enrichment = concept.nutrition_enrichment as Row | undefined;
      const imageUrl = typeof recipe.image_url === "string" && recipe.image_url.startsWith("/media/")
        ? `${origin.protocol}://${origin.host || "localhost:9090"}${recipe.image_url}` : recipe.image_url;
      const ingredients = parseArray(recipe.ingredients_json).map((item) => {
        if (typeof item === "string") return { name: item.trim(), amount: "", group: "" };
        const ingredient = item as Row;
        return { name: String(ingredient?.name || "").trim(), amount: String(ingredient?.amount || "").trim(),
          ingredient_id: ingredient?.ingredient_id ?? null, ingredient_concept_id: ingredient?.ingredient_concept_id ?? null,
          ingredient_form_id: ingredient?.ingredient_form_id ?? null, measurement: ingredient?.measurement ?? null,
          group: String(ingredient?.group || "") };
      }).filter((item) => item.name);
      const formattedRequirements = (requirements.get(Number(recipe.id)) || []).map((item) => ({
        role: String(item.role), catalogId: item.catalog_id == null ? null : Number(item.catalog_id),
        catalogName: item.catalog_name == null ? null : String(item.catalog_name),
        capabilityCode: item.capability_code == null ? null : String(item.capability_code),
        confidence: Number(item.confidence), notes: String(item.notes || ""),
      }));
      const legacyNutrition: NutritionItem[] = [
        { key: "protein", label: "蛋白质", value: Math.max(0, Number(recipe.protein) || 0), unit: "g" },
        { key: "carbs", label: "碳水", value: Math.max(0, Number(recipe.carbs) || 0), unit: "g" },
        { key: "fat", label: "脂肪", value: Math.max(0, Number(recipe.fat) || 0), unit: "g" },
      ];
      return { ...publicRecipe, execution_profile: execution?.profile ?? null,
        execution_evidence: execution ? { reference: execution.profile.reference, reviewedAt: execution.reviewedAt } : null,
        quality_status: recipe.quality_status || "trusted",
        nutrition_basis: recipe.nutrition_basis || "source",
        nutrition_is_estimated: !nutritionUnknown && (recipe.nutrition_basis || "source") !== "source", image_url: imageUrl,
        ...(concept.concept_id ? { concept_id: concept.concept_id, recipe_concept_id: concept.recipe_concept_id,
          method_id: concept.method_id, primary_recipe_id: concept.primary_recipe_id, variants: concept.variants,
          missing_fields: concept.missing_fields, equipment_references: concept.equipment_references,
          nutrition_status: enrichment?.status || 'unknown', nutrition_calculation_basis: 'whole_recipe', source_version: concept.enrichment_version || concept.version,
          ...(enrichment ? { nutrition_reference: {
            version: enrichment.version, status: enrichment.status, disclosure: enrichment.disclosure,
            whole_recipe: enrichment.whole_recipe, per_serving: enrichment.per_serving, servings: enrichment.servings,
            gaps: enrichment.gaps, automatic_meal_planning_allowed: false,
            ingredients: parseArray(enrichment.references).map(item => {
              const reference = item as Row;
              return { name: reference.display_name, grams: reference.grams, scope: reference.scope,
                instruction: reference.instruction, source_name: reference.source_name, source_url: reference.source_url,
                source_food_id: reference.source_food_id, source_license: reference.source_license };
            }),
          } } : {}) } : {}),
        tags: parseArray(recipe.tags), steps: parseArray(recipe.steps_json),
        ingredients: ensureIngredientGroups(ingredients, String(recipe.title || "")),
        nutrition: nutritionUnknown ? [] : [...legacyNutrition, ...parseNutrition(recipe.nutrition_json)],
        required_kitchenware: formattedRequirements.filter((item) => item.role === "required"),
        optional_kitchenware: formattedRequirements.filter((item) => item.role !== "required") };
    });
  }
}
