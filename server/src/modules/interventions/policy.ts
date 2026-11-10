import { z } from "zod";

export const INTERVENTION_POLICY_VERSION = "interventions-2026-09-12.1";
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const inputSchema = z.object({
  now: timestamp,
  featureEnabled: z.boolean(),
  kind: z.enum(["expiry_rescue", "dinner_window"]),
  sourceKey: z.string().min(1).max(300),
  opportunityStartsAt: timestamp,
  opportunityExpiresAt: timestamp,
  dataObservedAt: timestamp,
  recommendationQuality: z.number().finite().min(0).max(1),
  eligibleItemCount: z.number().int().nonnegative(),
  alreadyDecided: z.boolean(),
  dinnerAlreadyPlanned: z.boolean(),
  cookingInProgress: z.boolean(),
  notCookingToday: z.boolean(),
  preferences: z.object({
    enabled: z.boolean(), expiryRescue: z.boolean(), dinnerWindow: z.boolean(),
    pushAuthorized: z.boolean(), hasPushDevice: z.boolean(),
    timeZone: z.string().min(1).max(100), quietStart: clock, quietEnd: clock,
    dailyPushLimit: z.number().int().min(0).max(3),
    cooldownMinutes: z.number().int().min(60).max(10_080),
  }).strict(),
  // These are persisted facts read by the scheduler, never client counters.
  pushReservations: z.array(timestamp),
  lastInterventionAt: timestamp.nullable(),
  snoozedUntil: timestamp.nullable(),
}).strict();
export type InterventionPolicyInput = z.infer<typeof inputSchema>;
export type InterventionDecision = {
  policyVersion: string;
  channel: "push" | "inbox_only" | "suppressed";
  reason: string;
  priority: "normal" | "high" | null;
  decidedAt: number;
  localDate: string | null;
};
const MIN_QUALITY = 0.7;
const MAX_DATA_AGE_MS = 24 * 60 * 60 * 1000;
function localParts(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time));
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minutes: Number(value("hour"))*60+Number(value("minute")) };
}
const minutes = (value: string) => Number(value.slice(0,2))*60+Number(value.slice(3));

/** Pure policy: callers must atomically reserve the returned decision with source_key and the user's quota. */
export function decideIntervention(raw: InterventionPolicyInput): InterventionDecision {
  const parsed = inputSchema.safeParse(raw);
  let localDate: string | null = null;
  const result = (channel: InterventionDecision["channel"], reason: string, priority: InterventionDecision["priority"] = null): InterventionDecision => ({
    policyVersion: INTERVENTION_POLICY_VERSION,channel,reason,priority,
    decidedAt: parsed.success ? parsed.data.now : 0,localDate,
  });
  if (!parsed.success) return result("suppressed","invalid_policy_input");
  const input = parsed.data;
  let local: ReturnType<typeof localParts>;
  try { local = localParts(input.now,input.preferences.timeZone); } catch { return result("suppressed","invalid_time_zone"); }
  localDate = local.date;
  if (!input.featureEnabled) return result("suppressed","feature_disabled");
  if (!input.preferences.enabled || !(input.kind === "expiry_rescue" ? input.preferences.expiryRescue : input.preferences.dinnerWindow))
    return result("suppressed","not_authorized");
  if (input.alreadyDecided) return result("suppressed","duplicate_source");
  if (input.opportunityStartsAt >= input.opportunityExpiresAt) return result("suppressed","invalid_window");
  if (input.now >= input.opportunityExpiresAt) return result("suppressed","opportunity_expired");
  if (input.now < input.opportunityStartsAt) return result("suppressed","outside_window");
  if (input.dataObservedAt > input.now || input.now-input.dataObservedAt > MAX_DATA_AGE_MS) return result("suppressed","stale_data");
  if (input.recommendationQuality < MIN_QUALITY) return result("suppressed","low_recommendation_quality");
  if (input.kind === "expiry_rescue" && input.eligibleItemCount === 0) return result("suppressed","no_eligible_inventory");
  if (input.kind === "dinner_window" && (input.dinnerAlreadyPlanned || input.cookingInProgress || input.notCookingToday))
    return result("suppressed","dinner_already_resolved");
  if (input.snoozedUntil !== null && input.now < input.snoozedUntil) return result("suppressed","snoozed");
  if (input.lastInterventionAt !== null && input.now-input.lastInterventionAt < input.preferences.cooldownMinutes*60_000)
    return result("suppressed","cooldown");
  const start = minutes(input.preferences.quietStart), end = minutes(input.preferences.quietEnd);
  const quiet = start !== end && (start < end ? local.minutes >= start && local.minutes < end : local.minutes >= start || local.minutes < end);
  if (quiet) return result("inbox_only","quiet_hours");
  if (!input.preferences.pushAuthorized || !input.preferences.hasPushDevice) return result("inbox_only","push_unavailable");
  // Count reservations, including pending delivery; awaiting tickets must not free quota.
  const reservedToday = input.pushReservations.filter(time => localParts(time,input.preferences.timeZone).date === local.date).length;
  if (reservedToday >= input.preferences.dailyPushLimit) return result("inbox_only","daily_push_limit");
  const urgent = input.kind === "expiry_rescue" && input.opportunityExpiresAt-input.now <= 6*60*60*1000;
  return result("push",urgent ? "urgent_expiry_opportunity" : "actionable_opportunity",urgent ? "high" : "normal");
}
