import type { MealProduction } from "@dietdigidose/contracts";
import type { InventoryConsumption } from "../../services/inventoryQuantity.js";

export type DietRecordInput = {
  idempotency_key?: string;
  meal_type: string;
  food_name: string;
  amount: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  recorded_at?: string;
  recorded_time?: string | null;
  image_url?: string | null;
};

export type PreparedDietRecord = DietRecordInput & {
  request_identity?: string;
  recorded_at: string;
  recorded_time: string | null;
};

export type CookingCompletionInput = {
  idempotency_key: string;
  recipe_id?: number | null;
  inventory_item_ids: number[];
  inventory_consumptions: InventoryConsumption[];
  diet_record?: DietRecordInput;
  production?: MealProduction;
};

export type PreparedCookingCompletion = Omit<CookingCompletionInput, "diet_record"> & {
  inventory_item_ids: number[];
  diet_record?: PreparedDietRecord;
};

export type CookingCompletionResult = Record<string, unknown> & { repeated: boolean };
