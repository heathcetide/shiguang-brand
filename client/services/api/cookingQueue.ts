import { requestJson, type ApiFetch } from "./client";

export type CookingQueueStatus = "waiting" | "preparing" | "ready" | "cooking" | "completed" | "cancelled";
export type CookingQueueMealType = "breakfast" | "lunch" | "dinner" | "snack";

export type CookingQueueItem = {
  productionMeals?: Array<{ date: string; mealType: CookingQueueMealType; servings: number }>;
  plannedServings?: number | null;
  sourcePlanItemId?: string | null;
  plannedDate?: string | null;
  id: string;
  recipeId: number;
  position: number;
  status: CookingQueueStatus;
  mealType: CookingQueueMealType | null;
  plannedAt: string | null;
  version: number;
  title: string;
  imageUrl: string | null;
  cookTime: number | null;
  calories: number;
  difficulty: string;
  ingredients: Array<{ name: string; amount: string; group?: string }>;
  preparedIngredientNames: string[];
  shoppingListSyncedAt: string | null;
  recipeAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export const cookingQueueApi = {
  list: (apiFetch: ApiFetch, includeHistory = false) => requestJson<CookingQueueItem[]>(
    apiFetch,
    `/api/v1/cooking-queue${includeHistory ? "?includeHistory=true" : ""}`,
  ),
  add: (apiFetch: ApiFetch, input: {
    interventionId?: string;
    confirmed?: true;
    recommendationRequestId?: string;
    recipeId: number;
    idempotencyKey?: string;
    plannedAt?: string | null;
    mealType?: CookingQueueMealType | null;
  }) => requestJson<{ item: CookingQueueItem; added: boolean }>(apiFetch, "/api/v1/cooking-queue", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  update: (apiFetch: ApiFetch, id: string, input: {
    version: number;
    status?: CookingQueueStatus;
    plannedAt?: string | null;
    mealType?: CookingQueueMealType | null;
    preparedIngredientNames?: string[];
    shoppingListSyncedAt?: string | null;
  }) => requestJson<CookingQueueItem>(apiFetch, `/api/v1/cooking-queue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  }),
  reorder: (apiFetch: ApiFetch, items: Array<{ id: string; version: number }>) => requestJson<CookingQueueItem[]>(
    apiFetch,
    "/api/v1/cooking-queue/reorder",
    { method: "POST", body: JSON.stringify({ items }) },
  ),
  start: (apiFetch: ApiFetch, id: string, version: number) => requestJson<CookingQueueItem>(
    apiFetch,
    `/api/v1/cooking-queue/${encodeURIComponent(id)}/start`,
    { method: "POST", body: JSON.stringify({ version }) },
  ),
  complete: (apiFetch: ApiFetch, id: string, version: number) => requestJson<CookingQueueItem>(
    apiFetch,
    `/api/v1/cooking-queue/${encodeURIComponent(id)}/complete`,
    { method: "POST", body: JSON.stringify({ version }) },
  ),
  remove: (apiFetch: ApiFetch, id: string) => requestJson<{ success: true }>(
    apiFetch,
    `/api/v1/cooking-queue/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  ),
  clear: (apiFetch: ApiFetch) => requestJson<{ success: true; count: number }>(
    apiFetch,
    "/api/v1/cooking-queue",
    { method: "DELETE" },
  ),
};
