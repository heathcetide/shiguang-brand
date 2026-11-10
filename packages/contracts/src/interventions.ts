import { z } from "zod";
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const interventionPreferencesSchema = z.object({
  enabled: z.boolean(), expiry_rescue: z.boolean(), dinner_window: z.boolean(),
  time_zone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en",{ timeZone: value }).format(0); return true; } catch { return false; }
  },"时区无效"),
  quiet_start: clock, quiet_end: clock, dinner_time: clock,
  dinner_lead_minutes: z.number().int().min(15).max(180),
  daily_push_limit: z.number().int().min(0).max(3),
  cooldown_minutes: z.number().int().min(60).max(10080),
}).strict();
export const interventionPreferencesUpdateSchema = interventionPreferencesSchema.extend({ version: z.number().int().nonnegative() }).strict();
export type InterventionPreferences = z.infer<typeof interventionPreferencesSchema>;
export type InterventionPreferencesUpdate = z.infer<typeof interventionPreferencesUpdateSchema>;
export const defaultInterventionPreferences: InterventionPreferences = {
  enabled: false,expiry_rescue: false,dinner_window: false,time_zone: "Asia/Shanghai",
  quiet_start: "22:00",quiet_end: "07:00",dinner_time: "18:00",dinner_lead_minutes: 60,
  daily_push_limit: 1,cooldown_minutes: 120,
};

export const interventionActionKindSchema = z.enum(["plan_recipe","view_alternatives","mark_consumed","mark_discarded","snooze","not_cooking_today","not_helpful"]);
export const interventionCardSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  notificationId: z.number().int().positive(),
  kind: z.enum(["expiry_rescue","dinner_window"]),
  status: z.enum(["candidate","suppressed","inbox","sent","acted","expired"]),
  title: z.string().min(1),body: z.string().min(1),whyNow: z.string().min(1),expiresLabel: z.string().min(1),
  expiresAt: z.string().datetime(),localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inventoryIds: z.array(z.number().int().positive()),recipeIds: z.array(z.number().int().positive()).max(3),
  actions: z.array(interventionActionKindSchema).max(7),
  policyVersion: z.string().min(1),decisionReason: z.string().min(1),
}).strict();
export type InterventionCard = z.infer<typeof interventionCardSchema>;

export const interventionFeedbackSchema = z.object({
  action: z.enum(["snooze","not_cooking_today","not_helpful"]),
  confirmed: z.literal(true),
  idempotencyKey: z.string().uuid(),
}).strict();
export type InterventionFeedback = z.infer<typeof interventionFeedbackSchema>;
export const interventionFeedbackResultSchema = z.object({
  interventionId: z.string().regex(/^[a-f0-9]{64}$/),
  action: interventionFeedbackSchema.shape.action,
  idempotencyKey: z.string().uuid(),
  snoozedUntil: z.string().datetime().nullable(),
  notCookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  repeated: z.boolean(),
}).strict();
export type InterventionFeedbackResult = z.infer<typeof interventionFeedbackResultSchema>;
