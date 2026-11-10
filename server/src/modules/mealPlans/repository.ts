import type { ActiveMealChangePreviewInput, ActiveMealChangePreview } from "@dietdigidose/contracts";
import type { SaveCookingPlanDraftInput, UpdateCookingPlanDraftInput } from "@dietdigidose/contracts";
import type {
  ExecutionRepositoryResult, MealPlanCompleteInput, MealPlanExecutionInput, MealPlanItemUpdateInput,
  MealPlanItemView, MealPlanUpdateInput, MealPlanView, MutationResult,
} from "./types.js";

export interface MealPlansRepository {
  previewChange(userId: number, planId: string, itemId: string, input: ActiveMealChangePreviewInput): Promise<ActiveMealChangePreview | null>;
  listChanges(userId: number, planId: string): Promise<Record<string, unknown>[]>;
  reviewChange(userId: number, planId: string, changeId: string, action: "accept" | "reject" | "restore", validationFingerprint?: string): Promise<MutationResult<MealPlanItemView>>;
  confirmItem(userId: number, planId: string, itemId: string, version: number): Promise<MutationResult<MealPlanItemView>>;
  activateDraft(userId: number, id: string, version: number): Promise<MutationResult<{ plan: MealPlanView; repeated: boolean }>>;
  updateDraft(userId: number, id: string, input: UpdateCookingPlanDraftInput): Promise<MutationResult<{ plan: MealPlanView; repeated: boolean }>>;
  saveDraft(userId: number, input: SaveCookingPlanDraftInput): Promise<{ plan: MealPlanView; repeated: boolean } | null>;
  list(userId: number, includeArchived: boolean): Promise<MealPlanView[]>;
  find(userId: number, id: string, includeArchived: boolean): Promise<MealPlanView | null>;
  updatePlan(userId: number, id: string, input: MealPlanUpdateInput): Promise<MutationResult<MealPlanView>>;
  removePlan(userId: number, id: string, version: number): Promise<"removed" | "not_found" | "version_conflict">;
  updateItem(userId: number, planId: string, itemId: string, input: MealPlanItemUpdateInput, source?: string, reason?: string): Promise<MutationResult<MealPlanItemView>>;
  addShopping(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput): Promise<ExecutionRepositoryResult>;
  enqueue(userId: number, planId: string, itemId: string, input: MealPlanExecutionInput): Promise<ExecutionRepositoryResult>;
  complete(userId: number, planId: string, itemId: string, input: MealPlanCompleteInput): Promise<ExecutionRepositoryResult>;
}
