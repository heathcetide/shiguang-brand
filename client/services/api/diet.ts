import type { MealProduction, PreparedMeal, PreparedMealEventInput } from "@dietdigidose/contracts";
import { requestJson, type ApiFetch } from "./client";
import type { DietRecord } from "./types";

export type DietRecordInput = Omit<DietRecord, "id" | "prepared_meal_id" | "household_meal_id"> & { idempotency_key?: string };

export type DietNutritionSummary = {
  days: 7 | 30;
  timezone: string;
  from: string;
  to: string;
  targets: {
    calories_kcal?: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
  };
  daily: Array<{
    date: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    recordCount: number;
    incompleteCalories?: boolean;
    incompleteProtein?: boolean;
    incompleteCarbs?: boolean;
    incompleteFat?: boolean;
  }>;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    recordCount: number;
    loggedDays: number;
  };
  adherence: {
    calorieDaysMet: number;
    calorieDaysTracked: number;
    proteinDaysMet: number;
    proteinDaysTracked: number;
    calorieAdherencePct: number | null;
    proteinAdherencePct: number | null;
  };
  today: {
    date: string;
    remainingCalories: number | null;
    remainingProtein: number | null;
    remainingCarbs: number | null;
    remainingFat: number | null;
  };
};

export const dietApi = {
  list: (apiFetch: ApiFetch, date?: string) => requestJson<DietRecord[]>(apiFetch, `/api/v1/diet-records${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  summary: (apiFetch: ApiFetch, days: 7 | 30 = 7) =>
    requestJson<DietNutritionSummary>(apiFetch, `/api/v1/diet-records/summary?days=${days}`),
  create: (apiFetch: ApiFetch, input: DietRecordInput) => requestJson<DietRecord & {repeated?:boolean}>(apiFetch, "/api/v1/diet-records", {
    method: "POST", body: JSON.stringify(input),
  }),
  completeCooking: (apiFetch: ApiFetch, input: {
    idempotency_key: string;
    recipe_id?: number | null;
    inventory_item_ids?: number[];
    inventory_consumptions?: Array<{
      item_id: number;
      version: number;
      mode: "amount" | "all";
      amount_value?: number;
      unit?: string;
    }>;
    diet_record?: DietRecordInput;
    production?: MealProduction;
  }) => requestJson<{ diet_record: DietRecord | null; prepared_meal?: PreparedMeal; consumed_inventory_item_ids: number[]; repeated: boolean }>(
    apiFetch,
    "/api/v1/diet-records/cooking-completions",
    { method: "POST", body: JSON.stringify(input) },
  ),
  preparedMeals: (apiFetch: ApiFetch) => requestJson<PreparedMeal[]>(apiFetch, "/api/v1/diet-records/prepared-meals"),
  mealEvent: (apiFetch: ApiFetch, id: string, input: PreparedMealEventInput) => requestJson<{ prepared_meal: PreparedMeal; diet_record: DietRecord | null; repeated: boolean }>(apiFetch, `/api/v1/diet-records/prepared-meals/${encodeURIComponent(id)}/events`, { method: "POST", body: JSON.stringify(input) }),
  remove: (apiFetch: ApiFetch, id: number, mode?: "undo_eating" | "delete_intake") => requestJson<{ message: string }>(apiFetch, `/api/v1/diet-records/${id}${mode ? `?mode=${mode}` : ""}`, { method: "DELETE" }),
};
