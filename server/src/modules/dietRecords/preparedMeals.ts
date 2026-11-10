import { mealEventIdentity } from "./mealEventIdentity.js";
import { mealProductionSchema, preparedMealEventSchema, type MealProduction, type PreparedMeal, type PreparedMealEventInput } from "@dietdigidose/contracts";
import { currentDateKey, currentTimeKey } from "../../utils/date.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import type { PreparedDietRecord } from "./types.js";

export const roundServings = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function undoMealIntake(meal: PreparedMeal, event: { servings: number; result_json: unknown }) {
  const result = typeof event.result_json === "string" ? JSON.parse(event.result_json) : event.result_json;
  const previous = result as { prepared_meal?: PreparedMeal };
  // Conservatively reject corrections after any subsequent meal mutation.
  if (previous.prepared_meal?.version !== meal.version) {
    throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "这份餐食在食用后已有其他变更，无法直接撤销；可仅删除摄入记录");
  }
  const remaining = roundServings(meal.remaining_servings + Number(event.servings));
  if (remaining > meal.produced_servings || !(Number(event.servings) > 0)) {
    throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT", "食用份量与制作记录不一致，无法撤销");
  }
  return { ...meal, remaining_servings: remaining, version: meal.version + 1 };
}
export function prepareProduction(input: MealProduction): MealProduction {
  const value = mealProductionSchema.parse(input);
  return { ...value, eaten_at: value.eaten_at ?? currentDateKey(), eaten_time: value.eaten_time ?? (value.eaten_at && value.eaten_at !== currentDateKey() ? null : currentTimeKey()) };
}
export function prepareMealEvent(input: PreparedMealEventInput): PreparedMealEventInput & { requestIdentity: string } {
  const value = preparedMealEventSchema.parse(input);
  return { ...value, requestIdentity: mealEventIdentity(value), recorded_at: value.recorded_at ?? currentDateKey(), recorded_time: value.recorded_time ?? (value.recorded_at && value.recorded_at !== currentDateKey() ? null : currentTimeKey()) };
}
export function formatPreparedMeal(row: Record<string, unknown>): PreparedMeal {
  const nutrition = typeof row.nutrition_per_serving_json === "string" ? JSON.parse(row.nutrition_per_serving_json) : row.nutrition_per_serving_json;
  return {
    ...(Array.isArray(row.allocations) ? { allocations: row.allocations as PreparedMeal["allocations"] } : {}),
    reported_cooking_minutes: row.reported_cooking_minutes == null ? null : Number(row.reported_cooking_minutes),
    is_reserved: Boolean(row.is_reserved),
    id: String(row.id), food_name: String(row.food_name), recipe_id: row.recipe_id == null ? null : Number(row.recipe_id),
    produced_servings: Number(row.produced_servings), remaining_servings: Number(row.remaining_servings),
    nutrition_per_serving: nutrition || {}, planned_date: row.planned_date == null ? null : String(row.planned_date),
    meal_type: String(row.meal_type || ""), storage_location: row.storage_location == null ? null : String(row.storage_location),
    produced_at: row.produced_at instanceof Date ? row.produced_at.toISOString() : String(row.produced_at),
    version: Number(row.version), queue_item_id: row.queue_item_id == null ? null : String(row.queue_item_id),
    plan_item_id: row.plan_item_id == null ? null : String(row.plan_item_id),
  };
}
export function mealConsumptionRecord(meal: Pick<PreparedMeal, "food_name" | "meal_type" | "nutrition_per_serving">, portions: number, date: string, time: string | null): PreparedDietRecord {
  const amount = roundServings(portions);
  const nutrient = (name: keyof PreparedMeal["nutrition_per_serving"]) => {
    const value = meal.nutrition_per_serving[name];
    return value == null ? null : name === "calories" ? Math.round(value * amount) : Math.round(value * amount * 1000) / 1000;
  };
  return { food_name: meal.food_name, meal_type: meal.meal_type, amount: `${amount}份`, recorded_at: date,
    recorded_time: time, calories: nutrient("calories"), protein: nutrient("protein"), carbs: nutrient("carbs"), fat: nutrient("fat") };
}
export function transitionMeal(meal: PreparedMeal, input: PreparedMealEventInput) {
  if (meal.version !== input.version) throw new InventoryQuantityError("PREPARED_MEAL_VERSION_CONFLICT", "待吃餐已变化，请刷新后重试");
  if (input.type === "reschedule") return { ...meal, reported_cooking_minutes: input.reported_cooking_minutes === undefined ? meal.reported_cooking_minutes : input.reported_cooking_minutes, is_reserved: input.is_reserved ?? meal.is_reserved, planned_date: input.planned_date === undefined ? meal.planned_date : input.planned_date, meal_type: input.meal_type ?? meal.meal_type, version: meal.version + 1 };
  const amount = input.servings!;
  if (amount > meal.remaining_servings) throw new InventoryQuantityError("PREPARED_MEAL_INSUFFICIENT", "待吃餐剩余份量不足");
  return { ...meal, remaining_servings: roundServings(meal.remaining_servings - amount), version: meal.version + 1 };
}

export function undoHouseholdMealIntake(meal: Record<string,unknown>,event: Record<string,unknown>) {
  const result = typeof event.result_json === "string" ? JSON.parse(event.result_json) : event.result_json;
  const previous = result as { meal?: { version?: number } };
  const servings = Number(event.servings);
  if (Number(meal.version) !== previous.meal?.version || !Number.isFinite(servings) || servings <= 0)
    throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT","家庭批次在此次食用后已有变化，不能直接归还份量；可仅删除个人摄入");
  const remaining = roundServings(Number(meal.remaining_servings)+servings);
  if (!Number.isFinite(remaining) || remaining > Number(meal.produced_servings))
    throw new InventoryQuantityError("PREPARED_MEAL_CORRECTION_CONFLICT","家庭食用份量与批次不一致，无法撤销");
  return remaining;
}
