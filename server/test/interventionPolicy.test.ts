import assert from "node:assert/strict";
import { test } from "node:test";
import { decideIntervention, type InterventionPolicyInput } from "../src/modules/interventions/policy.js";
const instant = (value: string) => Date.parse(value);
function input(): InterventionPolicyInput {
  const now = instant("2026-09-12T09:00:00Z");
  return { now, featureEnabled: true,kind: "expiry_rescue",sourceKey: "expiry:1:2026-09-12",opportunityStartsAt: now-60_000,
    opportunityExpiresAt: now+12*60*60*1000,dataObservedAt: now,recommendationQuality: 0.8,eligibleItemCount: 2,
    alreadyDecided: false,dinnerAlreadyPlanned: false,cookingInProgress: false,notCookingToday: false,
    preferences: { enabled: true,expiryRescue: true,dinnerWindow: false,pushAuthorized: true,hasPushDevice: true,
      timeZone: "Asia/Shanghai",quietStart: "22:00",quietEnd: "07:00",dailyPushLimit: 2,cooldownMinutes: 120 },
    pushReservations: [],lastInterventionAt: null,snoozedUntil: null };
}
test("intervention decisions are deterministic, versioned and do not mutate inputs", () => {
  const candidate = input(),before = structuredClone(candidate);
  assert.deepEqual(decideIntervention(candidate),decideIntervention(candidate));
  assert.equal(decideIntervention(candidate).channel,"push");
  assert.equal(decideIntervention(candidate).priority,"normal");
  assert.equal(decideIntervention(candidate).localDate,"2026-09-12");
  assert.match(decideIntervention(candidate).policyVersion,/^interventions-/);
  assert.deepEqual(candidate,before);
});
test("authorization, freshness, duplicate and business gates suppress opportunities", () => {
  for (const [patch,reason] of [
    [{ featureEnabled: false },"feature_disabled"],[{ alreadyDecided: true },"duplicate_source"],
    [{ eligibleItemCount: 0 },"no_eligible_inventory"],[{ recommendationQuality: 0.69 },"low_recommendation_quality"],
    [{ dataObservedAt: input().now+1 },"stale_data"],[{ dataObservedAt: input().now-86_400_001 },"stale_data"],
    [{ opportunityExpiresAt: input().now },"opportunity_expired"],[{ opportunityStartsAt: input().now+1 },"outside_window"],
    [{ snoozedUntil: input().now+1 },"snoozed"],[{ lastInterventionAt: input().now-1 },"cooldown"],
  ] as const) assert.equal(decideIntervention({ ...input(),...patch }).reason,reason);
  const candidate = input(); candidate.preferences.expiryRescue = false;
  assert.equal(decideIntervention(candidate).reason,"not_authorized");
  candidate.kind = "dinner_window";
  assert.equal(decideIntervention(candidate).reason,"not_authorized");
  candidate.preferences.dinnerWindow = true;
  for (const key of ["dinnerAlreadyPlanned","cookingInProgress","notCookingToday"] as const)
    assert.equal(decideIntervention({ ...candidate,[key]: true }).reason,"dinner_already_resolved");
});
test("quiet hours have inclusive start, exclusive end and cannot be bypassed by urgency", () => {
  for (const [time,channel] of [["21:59","push"],["22:00","inbox_only"],["06:59","inbox_only"],["07:00","push"]] as const) {
    const candidate = input(); candidate.now = instant(`2026-09-12T${time}:00+08:00`);
    candidate.opportunityStartsAt = candidate.now; candidate.opportunityExpiresAt = candidate.now+60_000; candidate.dataObservedAt = candidate.now;
    assert.equal(decideIntervention(candidate).channel,channel,time);
  }
  const candidate = input(); candidate.preferences.quietStart = "16:00"; candidate.preferences.quietEnd = "18:00";
  assert.equal(decideIntervention(candidate).reason,"quiet_hours");
});
test("daily quota follows the configured local day, counting pending reservations", () => {
  const candidate = input(); candidate.preferences.dailyPushLimit = 1;
  candidate.pushReservations = [instant("2026-09-11T16:00:00Z")];
  assert.equal(decideIntervention(candidate).reason,"daily_push_limit");
  candidate.pushReservations = [instant("2026-09-11T15:59:59Z")];
  assert.equal(decideIntervention(candidate).channel,"push");
  candidate.preferences.hasPushDevice = false;
  assert.equal(decideIntervention(candidate).reason,"push_unavailable");
});
test("DST repeated hours remain quiet and invalid policy data fails closed", () => {
  for (const time of ["2026-11-01T05:30:00Z","2026-11-01T06:30:00Z"]) {
    const candidate = input();candidate.now = instant(time); candidate.opportunityStartsAt = candidate.now;candidate.opportunityExpiresAt = candidate.now+60_000;candidate.dataObservedAt = candidate.now;
    candidate.preferences.timeZone = "America/New_York";candidate.preferences.quietStart = "01:00";candidate.preferences.quietEnd = "02:00";
    assert.equal(decideIntervention(candidate).reason,"quiet_hours");
  }
  const candidate = input();candidate.preferences.timeZone = "invalid/zone";
  assert.equal(decideIntervention(candidate).reason,"invalid_time_zone");
  candidate.preferences.quietStart = "25:00";
  assert.equal(decideIntervention(candidate).reason,"invalid_policy_input");
});

test("expiry urgency, cooldown and snooze boundaries are explicit", () => {
  const candidate = input();candidate.opportunityExpiresAt = candidate.now+6*60*60*1000;
  assert.equal(decideIntervention(candidate).priority,"high");
  candidate.opportunityExpiresAt += 1;
  assert.equal(decideIntervention(candidate).priority,"normal");
  candidate.lastInterventionAt = candidate.now-candidate.preferences.cooldownMinutes*60_000;
  candidate.snoozedUntil = candidate.now;
  assert.equal(decideIntervention(candidate).channel,"push");
  candidate.preferences.dailyPushLimit = 0;
  assert.equal(decideIntervention(candidate).channel,"inbox_only");
  candidate.preferences.dailyPushLimit = 1;
  candidate.preferences.quietStart = "17:00";candidate.preferences.quietEnd = "17:00";
  assert.equal(decideIntervention(candidate).channel,"push","equal quiet boundaries disable quiet hours");
  candidate.kind = "dinner_window";candidate.preferences.dinnerWindow = true;candidate.eligibleItemCount = 0;
  assert.equal(decideIntervention(candidate).channel,"push","dinner recommendations need not contain expiring food");
});
