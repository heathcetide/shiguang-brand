import { z } from "zod";
import { cookingPlanDraftSchema } from "./mealPlanRequirements.ts";
import { householdDiningPlanSchema } from "./householdDining.ts";

export const activeMealChangePatchSchema = z.object({
  version: z.number().int().positive(), recipeId: z.number().int().positive().nullable().optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), mealType: z.string().trim().min(1).max(30).optional(),
  status: z.enum(["planned", "skipped"]).optional(), dining: householdDiningPlanSchema.nullable().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "version"), "至少提供一个需要更新的字段");
export const activeMealChangePreviewInputSchema = z.union([
  z.object({ patch: activeMealChangePatchSchema }).strict(),
  z.object({ changeId: z.string().uuid(), action: z.enum(["accept", "restore"]) }).strict(),
]);
export const activeMealChangeCheckSchema = z.object({ code: z.string(), severity: z.enum(["blocked", "pending", "info"]), itemIds: z.array(z.string()), message: z.string() });
export const activeMealChangePreviewSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), planVersion: z.number().int().positive(), itemVersion: z.number().int().positive(),
  canApply: z.boolean(), scope: z.object({ kind: z.literal("current_plan_window"), startDate: z.string(), endDate: z.string() }),
  checks: z.array(activeMealChangeCheckSchema), ingredientBudget: cookingPlanDraftSchema.shape.ingredientBudget, time: cookingPlanDraftSchema.shape.time.nullable().optional(),
});
export type ActiveMealChangePreviewInput = z.infer<typeof activeMealChangePreviewInputSchema>;
export type ActiveMealChangePreview = z.infer<typeof activeMealChangePreviewSchema>;
