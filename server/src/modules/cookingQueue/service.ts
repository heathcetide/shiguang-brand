import { randomUUID } from "node:crypto";
import { CookingQueueError } from "./errors.js";
import type { CookingQueueRepository } from "./repository.js";
import type { QueueCreateInput, QueueRow, QueueUpdateInput } from "./types.js";

function parseJson<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === "object") return value as T;
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export function formatQueueItem(row: QueueRow) {
  const snapshot = parseJson<Record<string, unknown>>(row.recipe_snapshot_json, {});
  const rawCookTime = Object.hasOwn(row, "current_cook_time") ? row.current_cook_time : snapshot.cookTime;
  const minutes = typeof rawCookTime === "number" || typeof rawCookTime === "string" && rawCookTime.trim() !== "" ? Number(rawCookTime) : NaN;
  const currentIngredients = parseJson<unknown[]>(row.current_ingredients_json, []);
  return {
    productionMeals: Array.isArray(snapshot.productionPlanItems) ? snapshot.productionPlanItems.map((target: { date: string; mealType: string; servings: number }) => ({ date: target.date, mealType: target.mealType, servings: target.servings })) : [],
    plannedServings: Number(snapshot.plannedServings) > 0 ? Number(snapshot.plannedServings) : null,
    sourcePlanItemId: row.source_plan_item_id ? String(row.source_plan_item_id) : null,
    plannedDate: typeof snapshot.plannedDate === "string" ? snapshot.plannedDate : null,
    id: String(row.id),
    recipeId: Number(row.recipe_id),
    position: Number(row.position),
    status: String(row.status),
    mealType: row.meal_type ? String(row.meal_type) : null,
    plannedAt: row.planned_at ? String(row.planned_at) : null,
    version: Number(row.version),
    title: String(row.current_title || snapshot.title || "已失效菜谱"),
    imageUrl: row.current_image_url === null || row.current_image_url === undefined
      ? (typeof snapshot.imageUrl === "string" ? snapshot.imageUrl : null)
      : String(row.current_image_url),
    cookTime: Number.isFinite(minutes) && minutes >= 0 ? minutes : null,
    calories: Number(row.current_calories ?? snapshot.calories ?? 0),
    difficulty: String(row.current_difficulty || snapshot.difficulty || "难度未知"),
    ingredients: row.source_plan_item_id && Array.isArray(snapshot.ingredients) ? snapshot.ingredients : currentIngredients.length ? currentIngredients : Array.isArray(snapshot.ingredients) ? snapshot.ingredients : [],
    preparedIngredientNames: parseJson<string[]>(row.prepared_ingredients_json, []),
    shoppingListSyncedAt: row.shopping_list_synced_at ? String(row.shopping_list_synced_at) : null,
    recipeAvailable: Boolean(row.current_title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

const transitions: Record<string, Set<string>> = {
  waiting: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
  preparing: new Set(["waiting", "preparing", "ready", "cooking", "cancelled"]),
  ready: new Set(["preparing", "ready", "cooking", "cancelled"]),
  cooking: new Set(["cooking", "completed", "cancelled"]),
  completed: new Set(["completed"]),
  cancelled: new Set(["cancelled"]),
};

const notFound = () => new CookingQueueError(404, "烹饪队列项不存在", "COOKING_QUEUE_ITEM_NOT_FOUND");
const versionConflict = () => new CookingQueueError(409, "烹饪队列已在其他设备更新，请刷新后重试", "COOKING_QUEUE_VERSION_CONFLICT");
const invalidTransition = (message = "当前烹饪状态不能执行该操作") =>
  new CookingQueueError(409, message, "COOKING_QUEUE_INVALID_TRANSITION");

function assertSharedProductionSaved(current: QueueRow, nextStatus: string) {
  const snapshot = parseJson<{ productionPlanItems?: unknown[] }>(current.recipe_snapshot_json, {});
  if (nextStatus === "completed" && current.status !== "completed" && Array.isArray(snapshot.productionPlanItems) && snapshot.productionPlanItems.length > 1) {
    throw invalidTransition("这是多餐共用制作，请先保存总产出和实际食用份量");
  }
}

export class CookingQueueService {
  private readonly repository: CookingQueueRepository;

  constructor(repository: CookingQueueRepository) {
    this.repository = repository;
  }

  async list(userId: number, includeHistory: boolean) {
    return (await this.repository.list(userId, includeHistory)).map(formatQueueItem);
  }

  async create(userId: number, input: QueueCreateInput) {
    const recipe = await this.repository.findApprovedRecipe(input.recipeId);
    if (!recipe) throw new CookingQueueError(404, "菜谱不存在或尚未通过审核", "RECIPE_NOT_AVAILABLE");
    let selectionEvidence: Record<string, unknown> | null = null;
    if (input.recommendationRequestId) {
      const request = await this.repository.recommendationRequest(userId, input.recommendationRequestId);
      const candidate = parseJson<Array<Record<string, unknown>>>(request?.results_json, []).find(item => Number(item.recipeId) === input.recipeId);
      if (!request || !candidate) throw new CookingQueueError(409, "推荐来源已失效或与菜谱不符，请返回推荐页重试", "RECOMMENDATION_SOURCE_MISMATCH");
      selectionEvidence = { version: 1, selectedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), requestId: input.recommendationRequestId, recipeId: input.recipeId,
        scoringVersion: request.scoring_version, inventory: (candidate.features as Record<string, unknown> | undefined)?.inventoryEvidence ?? null };
    }
    const result = await this.repository.enqueue({
      id: randomUUID(), userId, recipeId: input.recipeId, idempotencyKey: input.idempotencyKey,
      interventionId: input.interventionId, confirmed: input.confirmed,
      plannedAt: input.plannedAt, mealType: input.mealType,
      snapshot: {
        selectionEvidence,
        title: recipe.title, imageUrl: recipe.image_url, cookTime: recipe.cook_time,
        calories: recipe.calories, difficulty: recipe.difficulty,
        ingredients: parseJson<unknown[]>(recipe.ingredients_json, []),
      },
    }, 30);
    if (result.kind === "full") throw new CookingQueueError(409, "烹饪队列最多保留 30 道菜", "COOKING_QUEUE_FULL");
    return { item: formatQueueItem(result.row), added: result.kind === "created" };
  }

  async update(id: string, userId: number, input: QueueUpdateInput) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (Number(current.version) !== input.version) throw versionConflict();
    if (input.status && !transitions[String(current.status)]?.has(input.status)) throw invalidTransition();
    const nextStatus = input.status ?? String(current.status);
    assertSharedProductionSaved(current, nextStatus);
    const updated = await this.repository.update(id, userId, input.version, {
      status: nextStatus as QueueUpdateInput["status"] & string,
      mealType: input.mealType === undefined ? current.meal_type : input.mealType,
      plannedAt: input.plannedAt === undefined ? current.planned_at : input.plannedAt,
      preparedIngredients: input.preparedIngredientNames === undefined
        ? current.prepared_ingredients_json : [...new Set(input.preparedIngredientNames)],
      shoppingListSyncedAt: input.shoppingListSyncedAt === undefined
        ? current.shopping_list_synced_at : input.shoppingListSyncedAt,
      completedAt: nextStatus === "completed" ? new Date().toISOString() : current.completed_at,
    });
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async reorder(userId: number, items: Array<{ id: string; version: number }>) {
    const rows = await this.repository.reorder(userId, items);
    if (!rows) throw versionConflict();
    return rows.map(formatQueueItem);
  }

  async start(id: string, userId: number, version: number) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (current.status === "cooking") return formatQueueItem(current);
    if (!["waiting", "preparing", "ready"].includes(String(current.status))) throw invalidTransition("这道菜当前不能开始烹饪");
    const updated = await this.repository.transition(id, userId, version, "cooking");
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async complete(id: string, userId: number, version: number) {
    const current = await this.repository.findOwned(id, userId);
    if (!current) throw notFound();
    if (current.status === "completed") return formatQueueItem(current);
    if (current.status !== "cooking") throw invalidTransition("请先开始烹饪再完成");
    assertSharedProductionSaved(current, "completed");
    const updated = await this.repository.transition(id, userId, version, "completed");
    if (!updated) throw versionConflict();
    return formatQueueItem(updated);
  }

  async cancel(id: string, userId: number) {
    if (!await this.repository.cancel(id, userId)) throw notFound();
    return { success: true as const };
  }

  async cancelAll(userId: number) {
    return { success: true as const, count: await this.repository.cancelAll(userId) };
  }
}
