import { reheatingDeviceIdsSchema } from "./recipeExecution.ts";
import { z } from "zod";
import type { CookingPlanDraft } from "./mealPlanRequirements.ts";
export const weeklyPlanRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
  }, "日期无效"),
  mealTypes: z.array(z.enum(["breakfast","lunch","dinner","snack"])).min(1).max(4).refine(values => new Set(values).size === values.length,"餐次不能重复").optional(),
  reheatingDeviceIds: reheatingDeviceIdsSchema.optional(),
  servings: z.number().int().min(1).max(30).optional(),
}).strict();
export type WeeklyPlanRequest = z.infer<typeof weeklyPlanRequestSchema>;
export type WeeklyPlanPreview = {
  startDate: string; endDate: string; status: "requires_validation";
  slots: Array<{ id: string; date: string; mealType: string; servings: number; titles: string[]; preservedItemIds: string[]; state: "preserved" | "proposed" | "unresolved"; reasons: string[] }>;
  shopping: Array<{ foodName: string; unit: string; uncertain: boolean; required: number; covered: number; missing: number; sources: Array<{ mealId: string; required: number; missing: number }> }>;
  plannedPurchases: Array<{ id: string; name: string; amount: string }>;
  checksPending: string[]; draft: CookingPlanDraft | null;
};
