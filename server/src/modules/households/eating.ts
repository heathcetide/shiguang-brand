import type { HouseholdMealEatingInput } from "@dietdigidose/contracts";
import { mealConsumptionRecord, roundServings } from "../dietRecords/preparedMeals.js";
import { HouseholdsError } from "./errors.js";
import type { Row } from "./types.js";
export function eatingRequest(input: HouseholdMealEatingInput) {
  return { membershipId: input.membershipId,version: input.version,servings: input.servings,recordedDate: input.recordedDate,recordedTime: input.recordedTime,mealType: input.mealType };
}
export function repeatEating(event: Row,householdId: number,mealId: string,input: HouseholdMealEatingInput) {
  const request = typeof event.request_json === "string" ? JSON.parse(event.request_json) : event.request_json;
  if (Number(event.household_id) !== householdId || event.meal_id !== mealId || JSON.stringify(eatingRequest(request)) !== JSON.stringify(eatingRequest(input)))
    throw new HouseholdsError(409,"食用编号已用于其他记录","EATING_KEY_CONFLICT");
  const result = typeof event.result_json === "string" ? JSON.parse(event.result_json) : event.result_json;
  return { ...result,repeated: true };
}
export function prepareEating(meal: Row,input: HouseholdMealEatingInput, reservations: { total: number; mine: number } = { total: 0,mine: 0 }) {
  if (Number(meal.version) !== input.version) throw new HouseholdsError(409,"家庭待吃量已变化，请刷新后重试","MEAL_VERSION_CONFLICT");
  if (input.servings > Number(meal.remaining_servings)) throw new HouseholdsError(409,"家庭待吃量不足","MEAL_INSUFFICIENT");
  if (input.servings > roundServings(Number(meal.remaining_servings)-reservations.total+reservations.mine)) throw new HouseholdsError(409,"这部分餐食已为其他成员预留","MEAL_RESERVED");
  const nutrition = typeof meal.nutrition_per_serving_json === "string" ? JSON.parse(meal.nutrition_per_serving_json) : meal.nutrition_per_serving_json;
  return { reservedUsed: Math.min(input.servings,reservations.mine),remaining: roundServings(Number(meal.remaining_servings)-input.servings),
    record: mealConsumptionRecord({ food_name: String(meal.food_name),meal_type: input.mealType,nutrition_per_serving: nutrition ?? {} },input.servings,input.recordedDate,input.recordedTime) };
}
