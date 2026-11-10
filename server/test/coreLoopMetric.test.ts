import assert from "node:assert/strict";
import { test } from "node:test";
import { coreLoopWeek, evaluateCoreLoop, summarizeCoreLoopWeek, type CoreLoopFact } from "../src/modules/adminConsole/coreLoopMetric.js";
const original: CoreLoopFact = {
  productionId: "meal-1", actorKey: "actor-1", producerKey: "actor-1", actorClass: "real", environment: "staging", scope: "personal",
  producedAt: "2026-09-06T15:59:00Z", recipeId: 7,
  selection: { requestId: "request", recipeId: 7, selectedAt: "2026-09-01T02:00:00Z", matchedItemIds: [11] },
  stock: [{ itemId: 11, confirmedAt: "2026-08-24T03:00:00Z", confirmed: true, scope: "personal", ownerKey: "actor-1" }],
  deductions: [{ itemId: 11, before: 3, after: 2, amount: 1, verified: true }],
  intake: [{ recordId: "diet-1", actorKey: "actor-1", servings: 1, committedAt: "2026-09-06T16:00:00Z", survivesCorrection: true }],
};
const fact = (patch: Partial<CoreLoopFact> = {}): CoreLoopFact => ({ ...structuredClone(original), ...patch });
const options = { date: "2026-09-12", targetEnvironment: "staging", coverageStart: "2026-08-01T00:00:00Z", now: "2026-09-20T00:00:00Z" };

test("Shanghai ISO weeks handle UTC and year boundaries with an exclusive end", () => {
  assert.deepEqual(coreLoopWeek("2026-01-01"), { startDate: "2025-12-29", endDate: "2026-01-05", start: "2025-12-28T16:00:00.000Z", end: "2026-01-04T16:00:00.000Z" });
  assert.throws(() => coreLoopWeek("2026-02-30"));
  assert.throws(() => coreLoopWeek("09/12/2026"));
  assert.equal(summarizeCoreLoopWeek([fact()], options).users, 1);
  assert.equal(summarizeCoreLoopWeek([fact()], { ...options, date: "2026-09-06" }).users, 0);
});

test("previous-week stock and selection count only in the actual committed intake week", () => {
  assert.equal(evaluateCoreLoop(fact(), "staging").reason, "included");
  assert.equal(summarizeCoreLoopWeek([fact()], options).loops, 1);
  const late = fact({ productionId: "meal-2", intake: [{ ...original.intake[0], committedAt: "2026-09-13T16:00:00Z" }] });
  assert.equal(summarizeCoreLoopWeek([fact(), late], options).loops, 1);
  assert.equal(summarizeCoreLoopWeek([late], { ...options, date: "2026-09-14" }).users, 1);
});

test("retries, devices and multiple meals deduplicate loops and weekly actors separately", () => {
  const report = summarizeCoreLoopWeek([fact(), fact(), fact({ productionId: "meal-2" })], options);
  assert.equal(report.users, 1); assert.equal(report.loops, 2); assert.equal(report.smallSample, true);
});

test("fixed acceptance cases explain exclusions and missing evidence without unrelated-event joins", () => {
  const cases: Array<[Partial<CoreLoopFact>, string]> = [
    [{ environment: "development" }, "non_target_environment"],
    ...(["test", "automation", "demo"] as const).map(actorClass => [{ actorClass }, "excluded_actor"] as [Partial<CoreLoopFact>, string]),
    [{ actorClass: "unknown" }, "actor_unclassified"],
    [{ selection: null }, "selection_missing"],
    [{ selection: { ...original.selection!, recipeId: 9 } }, "selection_mismatch"],
    [{ selection: { ...original.selection!, matchedItemIds: [] } }, "no_inventory_match"],
    [{ stock: [] }, "stock_evidence_missing"],
    [{ stock: [{ ...original.stock[0], confirmed: false }] }, "stock_evidence_missing"],
    [{ deductions: [] }, "no_verified_deduction"],
    [{ deductions: [{ ...original.deductions[0], itemId: 99 }] }, "no_verified_deduction"],
    [{ deductions: [{ ...original.deductions[0], before: null }] }, "deduction_evidence_missing"],
    [{ deductions: [{ ...original.deductions[0], amount: 0, after: 3 }] }, "no_verified_deduction"],
    [{ intake: [] }, "no_surviving_intake"],
    [{ intake: [{ ...original.intake[0], survivesCorrection: false }] }, "no_surviving_intake"],
    [{ producedAt: "2026-09-12 12:00:00" }, "invalid_time"],
  ];
  for (const [patch, reason] of cases) assert.equal(evaluateCoreLoop(fact(patch), "staging").reason, reason);
  const report = summarizeCoreLoopWeek(cases.map(([patch], index) => fact({ ...patch, productionId: `case-${index}` })), options);
  assert.equal(report.verifiedUsers, 0); assert.equal(report.users, null); assert.equal(report.status, "partial");
});

test("shared stock credits only the producing actor who actually eats", () => {
  const shared = fact({ scope: "household", householdKey: "household-1", stock: [{ ...original.stock[0], scope: "household", ownerKey: "household-1" }] });
  assert.equal(evaluateCoreLoop(shared, "staging").reason, "included");
  assert.equal(evaluateCoreLoop({ ...shared, householdKey: "household-2" }, "staging").reason, "stock_evidence_missing");
  assert.equal(evaluateCoreLoop({ ...shared, actorKey: "member-2" }, "staging").reason, "not_producer");
  assert.equal(evaluateCoreLoop({ ...shared, intake: [{ ...original.intake[0], actorKey: "member-2" }] }, "staging").reason, "no_surviving_intake");
});

test("corrections remove the original intake and can move the first surviving completion into another week", () => {
  const corrected = fact({ intake: [{ ...original.intake[0], survivesCorrection: false }, { ...original.intake[0], recordId: "diet-2", committedAt: "2026-09-14T02:00:00Z" }] });
  assert.equal(summarizeCoreLoopWeek([corrected], options).users, 0);
  assert.equal(summarizeCoreLoopWeek([corrected], { ...options, date: "2026-09-14" }).users, 1);
  assert.equal(summarizeCoreLoopWeek([], options).users, 0, "deleted accounts have no retained facts");
});

test("coverage, unknown evidence, true zero, partial weeks and small counts remain distinct", () => {
  assert.equal(summarizeCoreLoopWeek([], { ...options, coverageStart: null }).users, null);
  assert.equal(summarizeCoreLoopWeek([], { ...options, targetEnvironment: "" }).status, "not_collected");
  assert.equal(summarizeCoreLoopWeek([], options).status, "complete");
  assert.equal(summarizeCoreLoopWeek([], { ...options, coverageStart: "2026-09-08T00:00:00Z" }).users, null);
  assert.equal(summarizeCoreLoopWeek([fact()], { ...options, now: "2026-09-12T00:00:00Z" }).status, "in_progress");
  const mixed = summarizeCoreLoopWeek([fact(), fact({ productionId: "legacy", selection: null })], options);
  assert.equal(mixed.users, null); assert.equal(mixed.verifiedUsers, 1); assert.equal(mixed.unknown, 1);
  const thirty = Array.from({ length: 30 }, (_, index) => fact({ actorKey: `actor-${index}`, producerKey: `actor-${index}`,
    stock: [{ ...original.stock[0], ownerKey: `actor-${index}` }], intake: [{ ...original.intake[0], actorKey: `actor-${index}` }] }));
  assert.equal(summarizeCoreLoopWeek(thirty, options).users, 30);
  assert.equal(summarizeCoreLoopWeek(thirty, options).smallSample, false);
});
