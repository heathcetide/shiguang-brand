import type { QueueEnqueueData, QueueEnqueueResult, QueuePatch, QueueRecipe, QueueRow } from "./types.js";

/** Driver-neutral persistence port for durable cooking queue state. */
export interface CookingQueueRepository {
  recommendationRequest(userId: number, requestId: string): Promise<QueueRow | null>;
  list(userId: number, includeHistory: boolean): Promise<QueueRow[]>;
  findOwned(id: string, userId: number): Promise<QueueRow | null>;
  findApprovedRecipe(recipeId: number): Promise<QueueRecipe | null>;
  enqueue(input: QueueEnqueueData, maximumActive: number): Promise<QueueEnqueueResult>;
  update(id: string, userId: number, version: number, patch: QueuePatch): Promise<QueueRow | null>;
  reorder(userId: number, items: Array<{ id: string; version: number }>): Promise<QueueRow[] | null>;
  transition(id: string, userId: number, version: number, status: "cooking" | "completed"): Promise<QueueRow | null>;
  cancel(id: string, userId: number): Promise<boolean>;
  cancelAll(userId: number): Promise<number>;
}
