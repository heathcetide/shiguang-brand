import { z } from "zod";
export const preferenceLearningUpdateSchema = z.discriminatedUnion("kind",[
  z.object({ kind: z.literal("learning"),version: z.number().int().positive(),enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal("recipe"),version: z.number().int().positive(),recipeId: z.number().int().positive(),value: z.enum(["neutral","dislike"]) }).strict(),
]);
export type PreferenceLearningUpdate = z.infer<typeof preferenceLearningUpdateSchema>;
export type PreferenceLearningState = {
  observations?: PreferenceOutcome[];
  version: number; enabled: boolean; ruleVersion: string;
  items: Array<{ recipeId: number; title: string; origin: "explicit" | "inferred"; explanation: string; updatedAt: string; evidence: Array<{ id: string; at: string; reason: string }> }>;
};
export type PreferenceOutcome = { id: string; recipeId: number | null; title: string; kind: "production" | "eat" | "discard" | "inventory" | "plan_change" | "preference_statement"; at: string; servings?: number; remainingServings?: number; observedAt?: string; quantity?: number; unit?: string; valid: boolean; explanation: string; correctionId?: string; correctedAt?: string };
