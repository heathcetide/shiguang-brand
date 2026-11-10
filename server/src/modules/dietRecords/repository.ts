import type { PreparedMeal, PreparedMealEventInput } from "@dietdigidose/contracts";
import type { CookingCompletionResult, PreparedCookingCompletion, PreparedDietRecord } from "./types.js";
import type { FunnelEventName } from "../../services/funnelEvents.js";

/** Driver-neutral persistence port for diet records and atomic cooking completion. */
export interface DietRecordsRepository {
  recordFunnelEvent(eventName: FunnelEventName, actorHash: string): Promise<void>;
  list(userId: number, date?: string): Promise<Array<Record<string, unknown>>>;
  create(userId: number, record: PreparedDietRecord): Promise<Record<string, unknown>>;
  remove(userId: number, id: number, mode?: "undo_eating" | "delete_intake"): Promise<boolean>;
  listPreparedMeals(userId: number): Promise<PreparedMeal[]>;
  applyMealEvent(userId: number, mealId: string, input: PreparedMealEventInput): Promise<CookingCompletionResult>;
  completeCooking(userId: number, input: PreparedCookingCompletion): Promise<CookingCompletionResult>;
}
