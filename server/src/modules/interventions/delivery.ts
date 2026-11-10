import { formatInterventionPreferences } from "./preferences.js";
export function interventionDeliveryBlock(row: Record<string,unknown>, preferences: Record<string,unknown> | null,now: number,enabled: boolean): string | null {
  if (!enabled) return "delivery_feature_disabled";
  const expires = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at));
  if (!Number.isFinite(expires) || now>=expires) return "delivery_expired";
  const settings = formatInterventionPreferences(preferences);
  if (!settings.enabled || !(row.kind === "expiry_rescue" ? settings.expiry_rescue : settings.dinner_window)) return "delivery_not_authorized";
  const parts = new Intl.DateTimeFormat("en-GB",{ timeZone: settings.time_zone,hour: "2-digit",minute: "2-digit",hourCycle: "h23" }).formatToParts(now);
  const time = `${parts.find(part => part.type==='hour')!.value}:${parts.find(part => part.type==='minute')!.value}`;
  const start = settings.quiet_start,end = settings.quiet_end;
  if (start!==end && (start<end ? time>=start && time<end : time>=start || time<end)) return "delivery_quiet_hours";
  return null;
}
export type InterventionDeliveryClaim = { id: string; owner: string; userId: number; title: string; body: string; notificationId: number; priority: "normal" | "high"; tokens: string[] };
export type InterventionDeliveryResult = "accepted" | "failed" | "uncertain";
