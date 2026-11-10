import type { UpdateCookingPlanDraftInput, SaveCookingPlanDraftInput } from "@dietdigidose/contracts";
import { requestJson, type ApiFetch } from "./client";

export type MealPlanItemStatus = "planned" | "queued" | "cooking" | "completed" | "skipped";

export interface MealPlanItemPatch {
  version: number;
  recipeId?: number | null;
  plannedDate?: string;
  mealType?: string;
  status?: MealPlanItemStatus;
  dining?: import("@dietdigidose/contracts").HouseholdDiningPlan | null;
}
export type MealPlanChangePreviewInput = { patch: MealPlanItemPatch } | { changeId: string; action: "accept" | "restore" };
export interface MealPlanChangePreviewResult {
  fingerprint: string;
  planVersion: number;
  itemVersion: number;
  canApply: boolean;
  scope: { kind: "current_plan_window"; startDate: string; endDate: string };
  checks: Array<{ code: string; severity: "blocked" | "pending" | "info"; itemIds: string[]; message: string }>;
  ingredientBudget?: Array<{
    food_name: string;
    requested_value: number;
    covered_value: number;
    missing_value: number;
    unit: string;
    fully_covered: boolean;
    quantity_status: "sufficient" | "insufficient" | "unknown" | "unavailable";
  }>;
  time?: {
    knownSequentialMinutes: number;
    budgetMinutes: number;
    sessionBudgetMinutes?: number;
    incomplete: boolean;
    exceedsBudget: boolean;
    isEstimate: boolean;
    missing: string[];
  } | null;
}

export interface MealPlanChange {
  id: string; itemId: string; source: string; reason: string; status: string;
  before: { title?: string; input?: { dining?: import("@dietdigidose/contracts").HouseholdDiningPlan | null; plannedDate?: string; mealType?: string; recipeId?: number | null; status?: string } };
  after: { dining?: import("@dietdigidose/contracts").HouseholdDiningPlan | null; title?: string; plannedDate?: string; mealType?: string; recipeId?: number | null; status?: string };
  beforeVersion: number; afterVersion: number | null; createdAt: string; appliedAt: string | null;
}
export interface MealPlanItem {
  dining?: import("@dietdigidose/contracts").HouseholdDiningPlan | null;
  householdMealId?: string | null;
  householdId?: number | null;
  confirmedAt?: string | null;
  change?: MealPlanChange;
  productionServings?: number | null;
  productionMealCount?: number;
  plannedServings?: number | null;
  targetMealId?: string | null;
  id: string;
  planId: string;
  plannedDate: string;
  mealType: string;
  title: string;
  recipeId: number | null;
  recipeAvailable: boolean;
  recipeImageUrl: string | null;
  cookTime: number;
  difficulty: string | null;
  ingredients: Array<{ name: string; amount: string }>;
  steps: unknown[];
  nutrition: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
  status: MealPlanItemStatus;
  version: number;
  dietRecordId: number | null;
  queueItemId: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MealPlan {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: "draft" | "active" | "completed" | "cancelled";
  source: "agent" | "manual" | string;
  createdByRunId: string | null;
  constraints: Record<string, unknown>;
  version: number;
  undoState: "active" | "undone";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  items: MealPlanItem[];
}

const itemPath = (planId: string, itemId: string) =>
  `/api/v1/meal-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`;

export const mealPlansApi = {
  changePreview: (apiFetch: ApiFetch, planId: string, itemId: string, input: MealPlanChangePreviewInput) =>
    requestJson<MealPlanChangePreviewResult>(apiFetch, `${itemPath(planId, itemId)}/change-preview`, { method: "POST", body: JSON.stringify(input) }),
  changes: (apiFetch: ApiFetch, planId: string) => requestJson<MealPlanChange[]>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(planId)}/changes`),
  reviewChange: (apiFetch: ApiFetch, planId: string, changeId: string, action: "accept" | "reject" | "restore", validationFingerprint?: string) => requestJson<MealPlanItem>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(planId)}/changes/${encodeURIComponent(changeId)}/review`, { method: "POST", body: JSON.stringify({ action, ...(validationFingerprint ? { validationFingerprint } : {}) }) }),
  confirmItem: (apiFetch: ApiFetch, planId: string, itemId: string, version: number) => requestJson<MealPlanItem>(apiFetch, `${itemPath(planId,itemId)}/confirm`, { method: "POST", body: JSON.stringify({ version }) }),
  activateDraft: (apiFetch: ApiFetch, id: string, version: number) =>
    requestJson<{ plan: MealPlan; repeated: boolean }>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({ version }) }),
  updateDraft: async (apiFetch: ApiFetch, id: string, input: UpdateCookingPlanDraftInput) =>
    requestJson<{ plan: MealPlan; repeated: boolean }>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}/draft`, { method: "PATCH", body: JSON.stringify((await import("@dietdigidose/contracts")).updateCookingPlanDraftSchema.parse(input)) }),
  saveDraft: async (apiFetch: ApiFetch, input: SaveCookingPlanDraftInput) =>
    requestJson<{ plan: MealPlan; repeated: boolean }>(apiFetch, "/api/v1/meal-plans/drafts", { method: "POST", body: JSON.stringify((await import("@dietdigidose/contracts")).saveCookingPlanDraftSchema.parse(input)) }),
  list: (apiFetch: ApiFetch, includeArchived = true) =>
    requestJson<MealPlan[]>(apiFetch, `/api/v1/meal-plans?includeArchived=${includeArchived}`),
  get: (apiFetch: ApiFetch, id: string) =>
    requestJson<MealPlan>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`),
  update: (apiFetch: ApiFetch, id: string, input: unknown) =>
    requestJson<MealPlan>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (apiFetch: ApiFetch, id: string, version: number) =>
    requestJson<{ deleted: true }>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ version }) }),
  updateItem: (apiFetch: ApiFetch, planId: string, itemId: string, input: MealPlanItemPatch & { validationFingerprint?: string }) =>
    requestJson<MealPlanItem>(apiFetch, itemPath(planId, itemId), { method: "PATCH", body: JSON.stringify(input) }),
  addShopping: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ added: number; itemIds: string[]; repeated: boolean; scope?: "current_plan"; coverage?: "covered" | "shortfall" | "needs_review"; reviewItems?: Array<{ name: string; reason: string; itemIds?: string[] }> }>(apiFetch, `${itemPath(planId, itemId)}/shopping`, { method: "POST", body: JSON.stringify(input) }),
  addQueue: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ queueItemId: string; added: boolean; repeated: boolean }>(apiFetch, `${itemPath(planId, itemId)}/queue`, { method: "POST", body: JSON.stringify(input) }),
  complete: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ dietRecordId: number; repeated: boolean }>(apiFetch, `${itemPath(planId, itemId)}/complete`, { method: "POST", body: JSON.stringify(input) }),
};
