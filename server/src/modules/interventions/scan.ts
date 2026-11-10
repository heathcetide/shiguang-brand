import { InterventionReadTimeout, withInterventionReadDeadline } from "./readDeadline.js";
import type { NotificationsRepository } from "../notifications/repository.js";
import type { RecommendationsService } from "../recommendations/service.js";
import type { WorkerTaskContext } from "../worker/types.js";
import { interventionDinnerState } from "./snapshot.js";
import { interventionOpportunities } from "./opportunities.js";
import { formatInterventionPreferences } from "./preferences.js";

export async function scanInterventions(repository: NotificationsRepository,recommendations: Pick<RecommendationsService,"interventionSnapshot">,context: WorkerTaskContext,readTimeoutMs = 10_000) {
  const result = { scanned: 0,candidates: 0,failed: 0 };
  if (process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") return result;
  await context.assertActive();context.signal.throwIfAborted();
  let afterId = await repository.interventionScanCursor();
  const checkpoint = async (next: number) => {
    await context.assertActive();context.signal.throwIfAborted();
    if (!await repository.advanceInterventionScan(afterId,next,context.leaseOwnerId)) throw new Error("Intervention scan checkpoint lease or cursor changed");
    afterId = next;
  };
  const users = await repository.interventionScanUsers(afterId,25);
  if (!users.length) { await checkpoint(0);return result; }
  for (const userId of users) {
    await context.assertActive();context.signal.throwIfAborted();
    if (process.env.PROACTIVE_INTERVENTIONS_ENABLED !== "1") return result;
    let timedOut = false;
    try {
      const data = await withInterventionReadDeadline(async signal => {
        const row = await repository.interventionPreferences(userId);
        signal.throwIfAborted();
        const { version: _version,...preferences } = formatInterventionPreferences(row);
        if (!preferences.enabled) return null;
        const observedAt = Date.now();
        const [snapshot,queue,snoozedUntil] = await Promise.all([recommendations.interventionSnapshot(userId,observedAt,preferences.time_zone),repository.interventionQueue(userId),repository.activeInterventionSnooze(userId,observedAt)]);
        signal.throwIfAborted();
        return { row,preferences,observedAt,snapshot,queue,snoozedUntil };
      },context.signal,readTimeoutMs);
      if (!data) { await checkpoint(userId);continue; }
      const { row,preferences,observedAt,snapshot,queue,snoozedUntil } = data;
      const state = interventionDinnerState(snapshot.dates,preferences.time_zone,snapshot.items,snapshot.plans,queue,typeof row?.not_cooking_date === "string" ? row.not_cooking_date : null);
      const candidates = interventionOpportunities({ userId,now: Date.now(),dataObservedAt: observedAt,preferences,
        inventory: snapshot.inventory,recommendations: snapshot.recommendations,...state });
      for (const candidate of candidates) {
        if (candidate.kind === "expiry_rescue" && snoozedUntil!==null && snoozedUntil>Date.now()) continue;
        await context.assertActive();context.signal.throwIfAborted();
        const day = state.dinnerDays.find(item => item.localDate===candidate.localDate);
        const reserved = await repository.reserveIntervention({ candidate,now: Date.now(),featureEnabled: process.env.PROACTIVE_INTERVENTIONS_ENABLED === "1",
          // Explicit intervention consent authorizes pushes only when an active Expo device exists (checked atomically in reserve).
          pushAuthorized: preferences.enabled,dinnerAlreadyPlanned: day?.alreadyPlanned ?? true,cookingInProgress: state.cookingInProgress,notCookingToday: day?.notCooking ?? true });
        if (reserved.deferred!==true) result.candidates += 1;
      }
      result.scanned += 1;
    } catch (error) {
      await context.assertActive();context.signal.throwIfAborted();
      result.failed += 1;
      timedOut = error instanceof InterventionReadTimeout;
    }
    await checkpoint(userId);
    // Stop this batch after a slow account; the next run resumes after it without accumulating more abandoned reads.
    if (timedOut) return result;
  }
  if (users.length<25) await checkpoint(0);
  return result;
}
