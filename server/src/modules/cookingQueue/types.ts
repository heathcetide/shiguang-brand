export type QueueRow = Record<string, unknown>;
export type QueueStatus = "waiting" | "preparing" | "ready" | "cooking" | "completed" | "cancelled";

export type QueueCreateInput = {
  interventionId?: string;
  confirmed?: true;
  recommendationRequestId?: string;
  recipeId: number;
  idempotencyKey?: string;
  plannedAt?: string | null;
  mealType?: string | null;
};

export type QueueUpdateInput = {
  version: number;
  status?: QueueStatus;
  plannedAt?: string | null;
  mealType?: string | null;
  preparedIngredientNames?: string[];
  shoppingListSyncedAt?: string | null;
};

export type QueueRecipe = {
  id: number;
  title: unknown;
  image_url: unknown;
  cook_time: unknown;
  calories: unknown;
  difficulty: unknown;
  ingredients_json: unknown;
};

export type QueueEnqueueData = {
  interventionId?: string;
  confirmed?: true;
  id: string;
  userId: number;
  recipeId: number;
  idempotencyKey?: string;
  plannedAt?: string | null;
  mealType?: string | null;
  snapshot: Record<string, unknown>;
};

export type QueueEnqueueResult =
  | { kind: "created" | "existing"; row: QueueRow }
  | { kind: "full" };

export type QueuePatch = {
  status: QueueStatus;
  mealType: unknown;
  plannedAt: unknown;
  preparedIngredients: unknown;
  shoppingListSyncedAt: unknown;
  completedAt: unknown;
};
