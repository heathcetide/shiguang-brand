import { interventionCard } from "../interventions/card.js";
import { CookingQueueError } from "./errors.js";
import type { QueueEnqueueData } from "./types.js";
export function queueInterventionRequest(input: QueueEnqueueData) {
  if (!input.interventionId) return null;
  if (input.confirmed !== true || !input.idempotencyKey) throw new CookingQueueError(409, "请确认将菜谱加入烹饪队列", "INTERVENTION_CONFIRMATION_REQUIRED");
  return { interventionId: input.interventionId, recipeId: input.recipeId, plannedAt: input.plannedAt ?? null,
    mealType: input.mealType ?? null, action: "plan_recipe", confirmed: true, idempotencyKey: input.idempotencyKey };
}
export function validateQueueIntervention(input: QueueEnqueueData, row: Record<string, unknown> | null, previous: Record<string, unknown> | null) {
  const request = queueInterventionRequest(input);
  if (!request) return null;
  if (previous) {
    const saved = typeof previous.request_json === "string" ? JSON.parse(previous.request_json) : previous.request_json;
    if (!saved || Object.keys(saved).length !== Object.keys(request).length || Object.entries(request).some(([key,value]) => saved[key] !== value))
      throw new CookingQueueError(409, "重试内容已变化，请刷新提醒", "INTERVENTION_IDEMPOTENCY_CONFLICT");
    const result = typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
    return String(result.queueItemId);
  }
  if (!row || row.notification_id == null) throw new CookingQueueError(404, "提醒不存在", "INTERVENTION_NOT_FOUND");
  const card = interventionCard(row);
  if (!["inbox","sent"].includes(card.status) || !card.actions.includes("plan_recipe") || !card.recipeIds.includes(input.recipeId))
    throw new CookingQueueError(409, "提醒已失效或菜谱不在建议中，请刷新", "INTERVENTION_NO_LONGER_ACTIONABLE");
  return null;
}
