import { z } from "zod";
import { cookingCompletionSchema } from "../../validation/schemas.js";
import { preparedMealEventSchema } from "@dietdigidose/contracts";
import { prepareProduction, prepareMealEvent } from "../../modules/dietRecords/preparedMeals.js";

export function agentMealProduction(payload: Record<string, unknown>, key: string) {
  const input = cookingCompletionSchema.parse({ ...payload, idempotency_key: key });
  if (!input.production || input.diet_record) throw new Error("请确认实际制作份量和本人已吃份量");
  return { ...input, diet_record: undefined, production: prepareProduction(input.production) };
}
export function agentPreparedMealEvent(payload: Record<string, unknown>, key: string) {
  const mealId = z.string().uuid().parse(payload.mealId);
  const { mealId: _mealId, ...event } = payload;
  return { mealId, input: prepareMealEvent(preparedMealEventSchema.parse({ ...event, idempotency_key: key })) };
}
