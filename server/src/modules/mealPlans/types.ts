import type { MealProduction } from "@dietdigidose/contracts";
import type { InventoryConsumption } from "../../services/inventoryQuantity.js";
export type MealPlanUpdateInput = {
  version: number;
  title?: string;
  startDate?: string;
  endDate?: string;
  status?: "draft" | "active" | "completed" | "cancelled";
};

export type MealPlanItemUpdateInput = {
  validationFingerprint?: string;
  dining?: import("@dietdigidose/contracts").HouseholdDiningPlan | null;
  version: number;
  plannedDate?: string;
  mealType?: string;
  recipeId?: number | null;
  status?: "planned" | "skipped";
};

export type MealPlanExecutionInput = { combineSameRecipe?: boolean; householdNetFingerprint?: string; householdRecipeFingerprint?: string; householdTotalDemand?: import("@dietdigidose/contracts").HouseholdDiningPlan; version: number; idempotencyKey: string };
export type MealPlanCompleteInput = MealPlanExecutionInput & { dietRecordId?: number; production?: MealProduction; inventory_consumptions?: InventoryConsumption[] };
export type MealPlanView = Record<string, unknown> & { id: string; version: number };
export type MealPlanItemView = Record<string, unknown> & { id: string; version: number };
export type ExecutionResult = Record<string, unknown> & { repeated: boolean };

export type MutationResult<T> =
  | { kind: "updated"; value: T }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "invalid_date_range" }
  | { kind: "recipe_not_available" }
  | { kind: "protected" };

export type ExecutionRepositoryResult =
  | { kind: "completed"; value: ExecutionResult }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "recipe_unavailable" }
  | { kind: "queue_full" }
  | { kind: "diet_record_not_found" };

export type MealPlanChangeReview = "accept" | "reject" | "restore";
