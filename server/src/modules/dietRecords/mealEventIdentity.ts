import { createHash } from "node:crypto";
import type { PreparedMealEventInput } from "@dietdigidose/contracts";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";

type Command = PreparedMealEventInput & { requestIdentity?: string };

/** Hash the validated request before adding server-generated dates/times. */
export function mealEventIdentity(input: Command): string {
  if (input.requestIdentity) return input.requestIdentity;
  const fields = Object.entries(input).filter(([key, value]) => key !== "idempotency_key" && value !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function replayMealEvent(existing: { prepared_meal_id: string; event_type: string; servings: number | null; result_json: unknown }, mealId: string, input: Command) {
  const result = (typeof existing.result_json === "string" ? JSON.parse(existing.result_json) : existing.result_json) as Record<string, unknown>;
  const meal = result.prepared_meal as Record<string, unknown> | undefined;
  let matches = existing.prepared_meal_id === mealId;
  if (typeof result.request_identity === "string") matches &&= result.request_identity === mealEventIdentity(input);
  else {
    matches &&= input.allocation_id === undefined && input.release_allocation === undefined;
    // Legacy records cannot prove omitted vs generated timestamps. Verify the
    // recorded action, original version, amount and explicitly supplied edits.
    matches &&= existing.event_type === input.type && Number(meal?.version) === input.version + 1
      && (input.servings === undefined ? existing.servings == null : Number(existing.servings) === input.servings);
    if (input.type === "reschedule") for (const key of ["planned_date", "is_reserved", "reported_cooking_minutes", "meal_type"] as const) {
      if (input[key] !== undefined) matches &&= meal?.[key] === input[key];
    }
  }
  if (!matches) throw new InventoryQuantityError("PREPARED_MEAL_KEY_CONFLICT", "该操作编号已用于不同的待吃餐操作，请恢复原请求重试或为新操作使用新编号");
  return { ...result, repeated: true };
}
