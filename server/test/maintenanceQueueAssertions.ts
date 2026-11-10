import type { PlanMaintenanceRepository } from "../src/modules/planMaintenance/repository.js";
import { evaluateMaintenanceJob } from "../src/modules/planMaintenance/evaluate.js";
import assert from "node:assert/strict";
import type { MaintenanceQueueRepository } from "../src/modules/planMaintenance/queue.js";

export async function verifyMaintenanceQueue(harness: {
  repository: () => MaintenanceQueueRepository;
  settings: PlanMaintenanceRepository;
  repeatReport: (jobId: string) => Promise<string>;
  noticeCount: (jobId: string) => Promise<number>;
  seed: (id: string,userId: number,at: string) => Promise<void>;
  unprocessed: () => Promise<number>;
  users: [number,number];
  seedMeals: (userId: number) => Promise<void>;
  mealState: (id: string) => Promise<{ version: number; plannedDate: string }>;
  changeCount: () => Promise<number>;
  jobResult: (id: string) => Promise<{ diagnostics?: { inputFingerprint: string; checks: string[] } } | null>;
  mutateInventory: (userId: number) => Promise<void>;
}) {
  const now = new Date(Date.now()+3_600_000);
  const later = (ms: number) => new Date(now.getTime()+ms);
  for (const [id,user] of [["queue-a",harness.users[0]],["queue-b",harness.users[0]],["queue-c",harness.users[1]]] as const) {
    await harness.seed(id,user,later(-31_000).toISOString());
  }
  await harness.seed("queue-fresh",harness.users[0],now.toISOString());
  assert.equal(await harness.repository().enqueueEvents(now,1),1);
  assert.equal(await harness.repository().enqueueEvents(now),2);
  assert.equal(await harness.repository().enqueueEvents(now),0);
  const claimed = await Promise.all([harness.repository().claim(now),harness.repository().claim(now)]);
  assert.ok(claimed[0]); assert.ok(claimed[1]);
  assert.notEqual(claimed[0].userId,claimed[1].userId);
  const first = claimed.find(job => job?.userId === harness.users[0])!;
  const other = claimed.find(job => job?.userId === harness.users[1])!;
  assert.deepEqual(first.eventIds,["queue-a","queue-b"]);
  assert.deepEqual(other.eventIds,["queue-c"]);
  assert.equal(await harness.repository().claim(now),null);
  assert.equal(await harness.repository().fail(first,now,"temporary\nfailure"),true);
  assert.equal(await harness.repository().fail(first,now,"stale failure"),false);
  assert.equal(await harness.repository().claim(later(29_000)),null);
  const retry = await harness.repository().claim(later(31_000),1000);
  assert.ok(retry); assert.equal(retry.id,first.id); assert.equal(retry.attempt,2);
  assert.notEqual(retry.leaseToken,first.leaseToken);
  const recovered = await harness.repository().claim(later(32_001),1000);
  assert.ok(recovered); assert.equal(recovered.id,first.id); assert.equal(recovered.attempt,3);
  assert.equal(await harness.repository().fail(retry,later(32_002),"late"),false);
  assert.equal(await harness.repository().fail(recovered,later(32_002),"final"),true);
  assert.equal(await harness.repository().claim(later(33_000)),null);
  // Recover a crashed job twice, then stop after its third expired attempt.
  const otherRetry = await harness.repository().claim(later(300_001),1000);
  assert.ok(otherRetry); assert.equal(otherRetry.id,other.id); assert.equal(otherRetry.attempt,2);
  const otherFinal = await harness.repository().claim(later(301_002),1000);
  assert.ok(otherFinal); assert.equal(otherFinal.attempt,3);
  assert.equal(await harness.repository().claim(later(302_003)),null);
  assert.equal(await harness.repository().enqueueEvents(later(303_000)),1);
  const fresh = await harness.repository().claim(later(303_000));
  assert.ok(fresh); assert.equal(fresh.attempt,1); assert.deepEqual(fresh.eventIds,["queue-fresh"]);
  assert.equal(await harness.unprocessed(),4);
  assert.equal(await harness.repository().enqueueEvents(later(304_000)),0);
  await harness.seedMeals(harness.users[0]);
  const scope = await harness.repository().scope(fresh,"2026-09-12");
  assert.ok(scope); assert.deepEqual(scope.items,[]); assert.equal(scope.checks.length,1);
  assert.equal(scope.checks[0].eventId,"queue-fresh");
  assert.deepEqual(await harness.repository().scope({ ...fresh,eventIds: ["queue-c"] },"2026-09-12"),scope);
  assert.equal(await harness.repository().scope({ ...fresh,userId: harness.users[1] },"2026-09-12"),null);
  assert.equal(await harness.repository().scope(first,"2026-09-12"),null);
  const candidateIds = await harness.repository().candidateRecipeIds();
  let captured = await harness.repository().inputs(fresh,candidateIds);
  assert.ok(captured);
  assert.equal((await harness.repository().inputs(fresh,candidateIds))?.fingerprint,captured.fingerprint);
  const evaluated = await evaluateMaintenanceJob(harness.repository(),fresh,"2026-09-12");
  assert.ok(evaluated); assert.equal(evaluated.snapshot.fingerprint,captured.fingerprint);
  assert.deepEqual(evaluated.scope,scope); assert.equal(evaluated.result.modelCalls,0);
  assert.equal(await evaluateMaintenanceJob(harness.repository(),first,"2026-09-12"),null);
  const apply = (job: Parameters<MaintenanceQueueRepository["applyChanges"]>[0],changes: Parameters<MaintenanceQueueRepository["applyChanges"]>[1]) =>
    harness.repository().applyChanges(job,changes,captured!,{ ruleVersion: "test-rule",inputFingerprint: captured!.fingerprint,fromDate: "2026-09-12",modelCalls: 0,cost: 0,assessments: [],checks: ["核对复热"] });
  const change = (itemId: string,version = 1) => ({ planVersion: 1,planId: "maintenance-plan",itemId,
    input: { version,plannedDate: "2026-09-13" },reason: "关联库存变化" });
  assert.deepEqual(await apply(first,[change("maintenance-mutable")]),{ kind: "lease_lost" });
  assert.deepEqual(await apply(fresh,[change("maintenance-mutable"),change("maintenance-confirmed",99)]),{ kind: "input_conflict" });
  assert.deepEqual(await apply(fresh,[{ ...change("maintenance-mutable"),planVersion: 99 }]),{ kind: "input_conflict" });
  assert.deepEqual(await apply(fresh,[{ ...change("maintenance-mutable"),input: { version: 1,plannedDate: "2026-10-01" } }]),{ kind: "input_conflict" });
  assert.deepEqual(await harness.mealState("maintenance-mutable"),{ version: 1,plannedDate: "2026-09-12" });
  assert.equal(await harness.changeCount(),0);
  assert.equal(await harness.unprocessed(),4);
  await harness.mutateInventory(harness.users[0]);
  assert.deepEqual(await apply(fresh,[change("maintenance-mutable")]),{ kind: "input_conflict" });
  assert.equal(await harness.changeCount(),0);
  assert.equal(await harness.unprocessed(),4);
  assert.equal(await harness.jobResult(fresh.id),null);
  const previousFingerprint = captured.fingerprint;
  captured = await harness.repository().inputs(fresh,candidateIds);
  assert.ok(captured); assert.notEqual(captured.fingerprint,previousFingerprint);
  const applied = await apply(fresh,["mutable","confirmed","cooking","purchased"].map(kind => change(`maintenance-${kind}`)));
  assert.equal(applied.kind,"completed");
  assert.deepEqual((await harness.jobResult(fresh.id))?.diagnostics,{ ruleVersion: "test-rule",inputFingerprint: captured.fingerprint,fromDate: "2026-09-12",modelCalls: 0,cost: 0,assessments: [],checks: ["核对复热"] });
  if (applied.kind !== "completed") assert.fail("expected completion");
  assert.deepEqual(applied.changes.map(item => (item.change as { status: string }).status),["pending","pending","blocked","pending"]);
  assert.deepEqual(await harness.mealState("maintenance-mutable"),{ version: 1,plannedDate: "2026-09-12" });
  assert.match(String((applied.changes[0].change as { reason: string }).reason),/需先预览当前整套餐单，未自动应用/);
  for (const kind of ["confirmed","cooking","purchased","untouched"]) assert.deepEqual(await harness.mealState(`maintenance-${kind}`),{ version: 1,plannedDate: "2026-09-12" });
  assert.equal(await harness.unprocessed(),3);
  assert.equal(await harness.changeCount(),4);
  const history = await harness.settings.runs(harness.users[0]);
  const summary = history.find(row => row.id === fresh.id)!;
  assert.deepEqual([summary.applied,summary.suggested,summary.kept],[0,3,1]);
  assert.deepEqual(summary.checks,["核对复热"]);
  assert.equal(summary.status,"completed");
  assert.equal((await harness.settings.runs(harness.users[1])).some(row => row.id === fresh.id),false);
  assert.equal(JSON.stringify(history).includes("leaseToken"),false);
  assert.deepEqual(await apply(fresh,[]),{ kind: "lease_lost" });
  assert.equal(await harness.changeCount(),4);
  // Daily dispatch advances its next occurrence without claiming successful completion.
  const dailyUser = harness.users[1];
  const dailyNow = new Date("2030-09-12T05:00:00Z");
  assert.equal(await harness.settings.saveSettings(dailyUser,0,{ enabled: true,timeZone: "Asia/Shanghai",localTime: "12:00",
    nextCheckAt: "2030-09-10T04:00:00Z",nextLocalDate: "2030-09-10",lastCompletedLocalDate: null,version: 0 }),true);
  const dispatched = await Promise.all([harness.repository().enqueueDaily(dailyNow),harness.repository().enqueueDaily(dailyNow)]);
  assert.equal(dispatched.reduce((a,b) => a+b,0),1);
  assert.equal((await harness.settings.settings(dailyUser))?.nextLocalDate,"2030-09-13");
  assert.equal((await harness.settings.settings(dailyUser))?.lastCompletedLocalDate,null);
  assert.equal(await harness.repository().enqueueDaily(dailyNow),0);
  await harness.repository().enqueueEvents(new Date(dailyNow.getTime()+31_000));
  const dailyJob = await harness.repository().claim(new Date(dailyNow.getTime()+32_000));
  assert.ok(dailyJob); assert.equal(dailyJob.userId,dailyUser);
  const dailyInput = await harness.repository().inputs(dailyJob); assert.ok(dailyInput);
  assert.deepEqual(dailyInput.data.maintenance_events.map(event => event.subject_id),["2030-09-12"]);
  assert.equal((await harness.repository().applyChanges(dailyJob,[],dailyInput)).kind,"completed");
  const settings = (await harness.settings.settings(dailyUser))!;
  assert.equal(settings.lastCompletedLocalDate,"2030-09-12");
  // Time edits can point back to an already dispatched date; the event key still deduplicates.
  assert.equal(await harness.settings.saveSettings(dailyUser,settings.version,{ ...settings,nextCheckAt: "2030-09-12T04:00:00Z",nextLocalDate: "2030-09-12" }),true);
  assert.equal(await harness.repository().enqueueDaily(dailyNow),0);
  const latest = (await harness.settings.settings(dailyUser))!;
  assert.equal(await harness.settings.saveSettings(dailyUser,latest.version,{ ...latest,enabled: false,nextCheckAt: null,nextLocalDate: null }),true);
  assert.equal(await harness.repository().enqueueDaily(new Date("2030-09-14T05:00:00Z")),0);

  await Promise.all([harness.repository().publishResults(),harness.repository().publishResults()]);
  assert.equal(await harness.noticeCount(fresh.id),1);
  assert.equal(await harness.noticeCount(first.id),1);
  assert.equal(await harness.noticeCount(other.id),1);
  assert.equal(await harness.noticeCount(dailyJob.id),0);
  assert.equal(await harness.repository().publishResults(),0);
  assert.equal(await harness.noticeCount(fresh.id),1);

  const duplicateReport = await harness.repeatReport(fresh.id);
  await harness.repository().publishResults();
  assert.equal(await harness.noticeCount(duplicateReport),0);
  assert.equal(await harness.noticeCount(fresh.id),1);

}
