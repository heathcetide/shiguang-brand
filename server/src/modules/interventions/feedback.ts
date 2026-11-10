import { interventionFeedbackSchema, interventionFeedbackResultSchema, type InterventionFeedback, type InterventionFeedbackResult } from "@dietdigidose/contracts";
import { dailyCheckOccurrence } from "../planMaintenance/schedule.js";
import { formatInterventionPreferences } from "./preferences.js";
import { interventionDates } from "./snapshot.js";

export type InterventionFeedbackDecision = { ok: true; result: InterventionFeedbackResult } | { ok: false; status: 404 | 409; code: string };
const conflict = (code: string): InterventionFeedbackDecision => ({ ok: false,status: 409,code });
export function feedbackRequest(id: string,input: InterventionFeedback) {
  const value = interventionFeedbackSchema.parse(input);
  return { interventionId: id,action: value.action,confirmed: value.confirmed,idempotencyKey: value.idempotencyKey };
}
/** Replay is checked before current state, so an acknowledged action remains replayable after expiry. */
export function replayInterventionFeedback(row: Record<string,unknown> | null,id: string,input: InterventionFeedback): InterventionFeedbackDecision | null {
  if (!row) return null;
  const saved = (typeof row.request_json === "string" ? JSON.parse(row.request_json) : row.request_json) as Record<string,unknown>;
  const expected = feedbackRequest(id,input);
  if (Object.entries(expected).some(([key,value]) => saved[key]!==value)) return conflict("INTERVENTION_IDEMPOTENCY_CONFLICT");
  const result = interventionFeedbackResultSchema.parse(typeof row.result_json === "string" ? JSON.parse(row.result_json) : row.result_json);
  return { ok: true,result: { ...result,repeated: true } };
}

/** Produces the write intent; the repository must apply it with its action record in one owner-locked transaction. */
export function decideInterventionFeedback(row: Record<string,unknown> | null,preferences: Record<string,unknown> | null,input: InterventionFeedback,now: number): InterventionFeedbackDecision {
  const request = interventionFeedbackSchema.parse(input);
  if (!row || row.notification_id==null) return { ok: false,status: 404,code: "INTERVENTION_NOT_FOUND" };
  if (!Number.isFinite(now)) throw new Error("Invalid feedback clock");
  const candidate = (typeof row.candidate_json === "string" ? JSON.parse(row.candidate_json) : row.candidate_json) as Record<string,unknown>;
  const expiry = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at).includes("T") ? String(row.expires_at) : String(row.expires_at).replace(" ","T")+"Z");
  if (!Number.isFinite(expiry) || now>=expiry || !["inbox","sent"].includes(String(row.status))) return conflict("INTERVENTION_NO_LONGER_ACTIONABLE");
  if (!Array.isArray(candidate.actions) || !candidate.actions.includes(request.action)) return conflict("INTERVENTION_ACTION_UNAVAILABLE");
  if (!preferences) return conflict("INTERVENTION_SETTINGS_UNAVAILABLE");
  const settings = formatInterventionPreferences(preferences);
  let snoozedUntil: string | null = null,notCookingDate: string | null = null;
  if (request.action === "snooze") {
    if (row.kind!=="expiry_rescue") return conflict("INTERVENTION_ACTION_UNAVAILABLE");
    const tomorrow = interventionDates(now,settings.time_zone)[1];
    const occurrence = dailyCheckOccurrence(tomorrow,{ timeZone: settings.time_zone,localTime: settings.quiet_start===settings.quiet_end ? "07:00" : settings.quiet_end });
    if (!occurrence) return conflict("INTERVENTION_NEXT_DAY_UNAVAILABLE");
    snoozedUntil = occurrence.scheduledAt;
  } else if (request.action === "not_cooking_today") {
    if (row.kind!=="dinner_window" || typeof candidate.localDate!=="string" || !interventionDates(now,settings.time_zone).includes(candidate.localDate)) return conflict("INTERVENTION_ACTION_UNAVAILABLE");
    notCookingDate = candidate.localDate;
  }
  return { ok: true,result: interventionFeedbackResultSchema.parse({ interventionId: row.id,action: request.action,idempotencyKey: request.idempotencyKey,snoozedUntil,notCookingDate,repeated: false }) };
}
