import type { MealPlanItemView, MealPlanView } from "./types.js";

export type Row = Record<string, unknown>;

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === "object") return value as T;
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export function ingredient(value: unknown) {
  if (typeof value === "string") return value.trim() ? { name: value.trim(), amount: "适量" } : null;
  if (!value || typeof value !== "object") return null;
  const item = value as Row;
  const name = String(item.name || item.food_name || "").trim();
  return name ? { name, amount: String(item.amount || item.quantity || "适量").trim() || "适量" } : null;
}

function dateTime(value: unknown) { return value instanceof Date ? value.toISOString() : String(value); }

export function formatMealPlanItem(row: Row): MealPlanItemView {
  const allocation = (parseJson<Row>(row.plan_constraints_json, {}).executionItems as Record<string, { servings?: number }> | undefined)?.[String(row.id)];
  return { plannedServings: allocation?.servings ?? null,
    dining: parseJson(row.dining_json,null),
    householdMealId: row.household_meal_id == null ? null : String(row.household_meal_id),
    householdId: row.household_id == null ? null : Number(row.household_id),
    id: String(row.id),
    planId: String(row.plan_id),
    confirmedAt: row.confirmed_at ? dateTime(row.confirmed_at) : null,
    plannedDate: String(row.planned_date),
    mealType: String(row.meal_type),
    title: String(row.recipe_title || row.title),
    recipeId: row.recipe_id === null ? null : Number(row.recipe_id),
    recipeAvailable: row.recipe_id === null || (row.recipe_status === "approved" && !row.recipe_deleted_at),
    recipeImageUrl: row.recipe_image_url ? String(row.recipe_image_url) : null,
    cookTime: Number(row.recipe_cook_time || 0),
    difficulty: row.recipe_difficulty ? String(row.recipe_difficulty) : null,
    ingredients: parseJson<unknown[]>(row.ingredients_json, []).map(ingredient).filter(Boolean),
    steps: parseJson<unknown[]>(row.steps_json, []),
    nutrition: {
      calories: row.calories === null ? null : Number(row.calories),
      protein: row.protein === null ? null : Number(row.protein),
      carbs: row.carbs === null ? null : Number(row.carbs),
      fat: row.fat === null ? null : Number(row.fat),
    },
    status: String(row.status || "planned"),
    version: Number(row.version || 1),
    dietRecordId: row.diet_record_id === null ? null : Number(row.diet_record_id),
    queueItemId: row.queue_item_id ? String(row.queue_item_id) : null,
    completedAt: row.completed_at ? dateTime(row.completed_at) : null,
    updatedAt: dateTime(row.updated_at),
  };
}

export function formatMealPlan(row: Row, items: MealPlanItemView[]): MealPlanView {
  const archived = Boolean(row.deleted_at);
  const executionItems = parseJson<Row>(row.constraints_json, {}).executionItems as Record<string, { servings?: number; targetMealId?: string }> | undefined;
  const plannedItems: (MealPlanItemView & { plannedServings: number | null; targetMealId: string | null })[] = items.map(item => ({ ...item, plannedServings: executionItems?.[item.id]?.servings ?? null,
    targetMealId: executionItems?.[item.id]?.targetMealId ?? null }));
  const execution = plannedItems.map(item => {
    const common = item.queueItemId ? plannedItems.filter(other => other.queueItemId === item.queueItemId) : [item];
    return { ...item, productionServings: common.every(other => Number(other.plannedServings) > 0) ? common.reduce((sum, other) => sum + Number(other.plannedServings), 0) : null,
      productionMealCount: common.length };
  });
  return {
    id: String(row.id), title: String(row.title), startDate: String(row.start_date), endDate: String(row.end_date),
    status: String(row.status), source: String(row.source || "manual"),
    createdByRunId: row.created_by_run_id ? String(row.created_by_run_id) : null,
    constraints: parseJson<Row>(row.constraints_json, {}), version: Number(row.version || 1),
    undoState: archived && row.source === "agent" ? "undone" : "active", archived,
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at), items: execution,
  };
}

export function normalizedName(value: string) {
  return value.toLocaleLowerCase().replace(/\([^)]*\)|（[^）]*）/g, "").replace(/[\d\s.,，。克千毫升斤个只颗片份盒包袋瓶罐根勺]/g, "");
}

export function queueMealType(value: unknown) {
  const aliases: Record<string, "breakfast" | "lunch" | "dinner" | "snack"> = {
    早餐: "breakfast", 午餐: "lunch", 晚餐: "dinner", 加餐: "snack",
    breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack",
  };
  return aliases[String(value)] || null;
}
