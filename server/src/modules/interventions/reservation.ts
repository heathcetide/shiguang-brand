import { decideIntervention } from "./policy.js";
import { formatInterventionPreferences } from "./preferences.js";
import type { InterventionCandidate } from "./opportunities.js";
export type InterventionReservation = {
  candidate: InterventionCandidate;
  now: number;
  featureEnabled: boolean;
  pushAuthorized: boolean;
  dinnerAlreadyPlanned: boolean;
  cookingInProgress: boolean;
  notCookingToday: boolean;
};
/** Caller-provided facts are server snapshots; persisted consent and quota always win. */
export function reservationDecision(input: InterventionReservation, preferences: Record<string,unknown> | null,
  history: Array<Record<string,unknown>>, hasPushDevice: boolean) {
  const candidate = input.candidate, settings = formatInterventionPreferences(preferences);
  const time = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(String(value).includes('T') ? String(value) : String(value).replace(' ','T')+'Z');
  const reservations = history.filter(row => row.push_reserved_at != null).map(row => time(row.push_reserved_at));
  const last = history.filter(row => row.decided_at != null && (row.channel === 'push' || row.channel === 'inbox_only')).map(row => time(row.decided_at));
  const snoozes = history.filter(row => row.kind===candidate.kind && row.snoozed_until!=null).map(row => time(row.snoozed_until)).filter(Number.isFinite);
  return decideIntervention({ now: input.now,featureEnabled: input.featureEnabled,kind: candidate.kind,sourceKey: candidate.sourceKey,
    opportunityStartsAt: candidate.startsAt,opportunityExpiresAt: candidate.expiresAt,dataObservedAt: candidate.dataObservedAt,
    recommendationQuality: candidate.recommendationQuality,eligibleItemCount: candidate.inventoryIds.length,alreadyDecided: false,
    dinnerAlreadyPlanned: input.dinnerAlreadyPlanned,cookingInProgress: input.cookingInProgress,notCookingToday: input.notCookingToday || preferences?.not_cooking_date===candidate.localDate,
    preferences: { enabled: settings.enabled,expiryRescue: settings.expiry_rescue,dinnerWindow: settings.dinner_window,
      pushAuthorized: input.pushAuthorized,hasPushDevice,timeZone: settings.time_zone,quietStart: settings.quiet_start,quietEnd: settings.quiet_end,
      dailyPushLimit: settings.daily_push_limit,cooldownMinutes: settings.cooldown_minutes },
    pushReservations: reservations,lastInterventionAt: last.length ? Math.max(...last) : null,snoozedUntil: snoozes.length ? Math.max(...snoozes) : null,
  });
}
