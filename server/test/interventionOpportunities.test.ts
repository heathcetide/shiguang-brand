import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultInterventionPreferences } from "@dietdigidose/contracts";
import { interventionOpportunities,interventionCandidateId,type OpportunityInput } from "../src/modules/interventions/opportunities.js";
function fixture(): OpportunityInput {
  return { userId: 1,now: Date.parse("2026-09-12T17:00:00+08:00"),dataObservedAt: Date.parse("2026-09-12T16:59:00+08:00"),
    preferences: { ...defaultInterventionPreferences,enabled: true,expiry_rescue: true,dinner_window: true },
    inventory: [{ id: 1,userId: 1,expirationDate: "2026-09-12",available: true,remaining: 1,deleted: false },{ id: 2,userId: 1,expirationDate: "2026-09-15",available: true,remaining: 2,deleted: false }],
    recommendations: [{ recipeId: 5,quality: 0.8,hardConstraintsPassed: true,inventoryIds: [2] }],cookingInProgress: false,dinnerDays: [{ localDate: "2026-09-12",alreadyPlanned: false,notCooking: false }] };
}
test("opportunities merge only owned usable three-day inventory and keep stable restart identities", () => {
  const input = fixture(),before = structuredClone(input);
  const results = interventionOpportunities(input);
  assert.deepEqual(input,before);
  assert.equal(results.length,2);assert.deepEqual(results[0].inventoryIds,[1,2]);
  assert.equal(results[0].expiresAt,Date.parse("2026-09-13T00:00:00+08:00"));
  const id = interventionCandidateId(results[0]);
  input.inventory.reverse(); input.now += 60_000;
  assert.equal(interventionCandidateId(interventionOpportunities(input)[0]),id);
  assert.deepEqual(before.inventory.map(row => row.id),[1,2]);
  for (const patch of [{ userId: 2 },{ available: false },{ remaining: 0 },{ deleted: true },{ expirationDate: "2026-09-11" },{ expirationDate: "2026-09-16" },{ expirationDate: "2026-02-30" }]) {
    const changed = fixture(); changed.inventory = changed.inventory.map(item => ({ ...item,...patch }));
    assert.equal(interventionOpportunities(changed).some(row => row.kind === "expiry_rescue"),false);
  }
});
test("recommendations need hard constraints, quality and a relevant inventory allocation", () => {
  for (const patch of [{ quality: 0.69 },{ hardConstraintsPassed: false },{ inventoryIds: [99] }]) {
    const input = fixture();input.recommendations = input.recommendations.map(row => ({ ...row,...patch }));
    assert.equal(interventionOpportunities(input).some(row => row.kind === "expiry_rescue"),false);
  }
  const input = fixture();input.recommendations.push({ ...input.recommendations[0],recipeId: 3 });
  assert.deepEqual(interventionOpportunities(input)[0].recipeIds,[3,5]);
});
test("dinner is opt-in, bounded by the local meal time and suppressed by existing plans", () => {
  for (const [time,expected] of [["16:59",false],["17:00",true],["17:59",true],["18:00",false]] as const) {
    const input = fixture();input.now = Date.parse(`2026-09-12T${time}:00+08:00`);
    assert.equal(interventionOpportunities(input).some(row => row.kind === "dinner_window"),expected);
  }
  for (const key of ["alreadyPlanned","notCooking"] as const) {
    const input = fixture(); input.dinnerDays[0][key] = true;
    assert.equal(interventionOpportunities(input).some(row => row.kind === "dinner_window"),false);
  }
  const cooking = fixture(); cooking.cookingInProgress = true;
  assert.equal(interventionOpportunities(cooking).some(row => row.kind === "dinner_window"),false);
  const input = fixture();input.preferences.dinner_window = false;
  assert.equal(interventionOpportunities(input).length,1);
  input.preferences.enabled = false;assert.deepEqual(interventionOpportunities(input),[]);
});
test("expiry cutoff uses the real DST midnight rather than adding 24 hours", () => {
  const input = fixture();input.preferences.time_zone = "America/New_York";input.now = Date.parse("2026-03-08T12:00:00-04:00");
  input.inventory = [{ ...input.inventory[0],id: 2,expirationDate: "2026-03-08" }];
  const candidate = interventionOpportunities(input)[0];
  assert.equal(candidate.expiresAt-candidate.startsAt,23*60*60*1000);
});

test("midnight-crossing dinner windows keep the target meal date and identity across midnight", () => {
  const input = fixture();input.preferences.dinner_time = "00:30";
  input.now = Date.parse("2026-09-12T23:45:00+08:00");
  input.dinnerDays.push({ localDate: "2026-09-13",alreadyPlanned: false,notCooking: false });
  const first = interventionOpportunities(input).find(row => row.kind === "dinner_window")!;
  assert(first);assert.equal(first.localDate,"2026-09-13");
  assert.equal(first.expiresAt,Date.parse("2026-09-13T00:30:00+08:00"));
  input.now = Date.parse("2026-09-13T00:15:00+08:00");
  const second = interventionOpportunities(input).find(row => row.kind === "dinner_window")!;
  assert.equal(interventionCandidateId(first),interventionCandidateId(second));
  input.dinnerDays[1].notCooking = true;
  assert.equal(interventionOpportunities(input).some(row => row.kind === "dinner_window"),false);
  input.dinnerDays = [];
  assert.equal(interventionOpportunities(input).some(row => row.kind === "dinner_window"),false,"unknown day status cannot permit a reminder");
});
