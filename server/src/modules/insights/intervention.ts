import { interventionCard } from "../interventions/card.js";
import { InsightsError } from "./errors.js";
import type { InventoryOutcomeCreateInput } from "./types.js";

export function interventionOutcomeRequest(input: InventoryOutcomeCreateInput) {
  if (!input.interventionId) return null;
  if (input.scope !== "personal" || input.confirmed !== true || !input.itemVersion || !input.closeItem || input.source !== "reminder" ||
    !["used", "discarded"].includes(input.outcome) || input.occurredAt !== undefined)
    throw new InsightsError(400, "请明确确认提醒中这一批库存的使用或丢弃结果", "INTERVENTION_CONFIRMATION_REQUIRED");
  return { interventionId: input.interventionId, itemId: input.itemId, itemVersion: input.itemVersion,
    action: input.outcome === "used" ? "mark_consumed" : "mark_discarded", confirmed: true, idempotencyKey: input.idempotencyKey };
}
export function validateInterventionOutcome(input: InventoryOutcomeCreateInput, row: Record<string, unknown> | null,
  previous: Record<string, unknown> | null, replay: boolean, now: number) {
  const request = interventionOutcomeRequest(input);
  if (!request) return;
  if (previous) {
    const saved = typeof previous.request_json === "string" ? JSON.parse(previous.request_json) : previous.request_json;
    if (!replay || JSON.stringify(saved) !== JSON.stringify(request)) {
      // PostgreSQL jsonb does not preserve key order.
      if (!replay || !saved || Object.keys(saved).length !== Object.keys(request).length || Object.entries(request).some(([key, value]) => saved[key] !== value))
        throw new InsightsError(409, "重试内容已变化，请刷新提醒", "INTERVENTION_IDEMPOTENCY_CONFLICT");
    }
    return;
  }
  if (replay) throw new InsightsError(409, "幂等标识已用于其他操作", "INTERVENTION_IDEMPOTENCY_CONFLICT");
  if (!row || row.notification_id == null) throw new InsightsError(404, "提醒不存在", "INTERVENTION_NOT_FOUND");
  const card = interventionCard(row, now);
  if (!["inbox", "sent"].includes(card.status) || !card.actions.includes(request.action as "mark_consumed" | "mark_discarded") || !card.inventoryIds.includes(input.itemId))
    throw new InsightsError(409, "提醒已失效或库存不在此建议中，请刷新", "INTERVENTION_NO_LONGER_ACTIONABLE");
}
