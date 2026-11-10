import { test } from "node:test";
import assert from "node:assert/strict";
import { processMaintenanceJobs } from "../src/modules/planMaintenance/process.js";
import { inputSnapshot, maintenanceInputTables, maintenanceRuleTables } from "../src/modules/planMaintenance/inputSnapshot.js";
import { activeReplacementFixture } from "./helpers/activeReplacementFixture.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";
import type { MaintenanceQueueRepository, MaintenanceApplication } from "../src/modules/planMaintenance/queue.js";
import type { WorkerTaskContext } from "../src/modules/worker/types.js";

function fixture() {
  const controller = new AbortController();
  const context: WorkerTaskContext = { runId: "run",taskName: "plan-maintenance-process",leaseOwnerId: "run",signal: controller.signal,assertActive: async () => { controller.signal.throwIfAborted(); } };
  const data = Object.fromEntries([...maintenanceInputTables,...maintenanceRuleTables,"recipes","maintenance_events"].map(table => [table,[]]));
  const snapshot = inputSnapshot(1,[],data);
  let claims = 0; let commits = 0; let failures = 0;
  let application: MaintenanceApplication = { kind: "completed",changes: [] };
  let diagnostics: unknown;
  const repository: MaintenanceQueueRepository = {
    publishResults: async () => 0,enqueueDaily: async () => 0,enqueueEvents: async () => 0,scope: async () => null,candidateRecipeIds: async () => [],
    claim: async () => ++claims === 1 ? { id: "job",userId: 1,attempt: 1,leaseToken: "token",eventIds: [] } : null,
    inputs: async () => snapshot,
    applyChanges: async (_job,_changes,_snapshot,result) => { commits++; diagnostics = result; return application; },
    fail: async () => { failures++; return true; },
  };
  return { repository,context,controller,snapshot,setApplication: (value: MaintenanceApplication) => { application = value; },counts: () => ({ commits,failures }),diagnostics: () => diagnostics };
}

test("processor persists zero-cost diagnostics using the account local date", async () => {
  const f = fixture();
  f.snapshot.data.plan_maintenance_settings = [{ time_zone: "America/Los_Angeles" }];
  const result = await processMaintenanceJobs(f.repository,f.context,10,() => new Date("2026-09-12T01:00:00Z"));
  assert.equal(result.succeeded,1);
  assert.ok((f.diagnostics() as { evaluationDurationMs: number }).evaluationDurationMs >= 0);
  assert.equal((f.diagnostics() as { fromDate: string }).fromDate,"2026-09-11");
  assert.equal((f.diagnostics() as { cost: number }).cost,0);
});

test("input conflicts retry while lost leases do not mutate another attempt", async () => {
  for (const kind of ["input_conflict","lease_lost"] as const) {
    const f = fixture(); f.setApplication({ kind });
    const result = await processMaintenanceJobs(f.repository,f.context);
    assert.equal(result.failed,1); assert.equal(result.succeeded,0);
    assert.equal(f.counts().failures,kind === "input_conflict" ? 1 : 0);
  }
});

test("cancellation during evaluation prevents commit and late failure writes", async () => {
  const f = fixture();
  f.repository.inputs = async () => { f.controller.abort(new Error("timeout")); return f.snapshot; };
  await assert.rejects(processMaintenanceJobs(f.repository,f.context),/timeout/);
  assert.deepEqual(f.counts(),{ commits: 0,failures: 0 });
});

test("evaluation errors use the durable bounded retry path", async () => {
  const f = fixture(); f.repository.candidateRecipeIds = async () => { throw new Error("database unavailable"); };
  const result = await processMaintenanceJobs(f.repository,f.context);
  assert.equal(result.failed,1); assert.deepEqual(f.counts(),{ commits: 0,failures: 1 });
});

test("processor preserves previous notes from result and appends revalidation notes", async () => {
  // 1. disabled daily check produces old note
  const f1 = fixture();
  f1.snapshot.data.plan_maintenance_settings = [{ enabled: 0, time_zone: "Asia/Shanghai" }];
  f1.snapshot.data.maintenance_events = [{ id: "e1", user_id: 1, event_type: "daily_check", details_json: "{}" }];
  const r1 = await processMaintenanceJobs(f1.repository, f1.context, 10, () => new Date("2026-09-12T01:00:00Z"));
  assert.equal(r1.succeeded, 1);
  const diag1 = f1.diagnostics() as { notes: string[] };
  assert.ok(Array.isArray(diag1.notes));
  assert.ok(diag1.notes.includes("每日检查已关闭，跳过该定时事件"));

  // 2. disabled daily check + inventory_changed (effective) + valid pending fixture
  const f2 = fixture();
  const validArgs = activeReplacementFixture();
  f2.snapshot.data.plan_maintenance_settings = [{ enabled: 0, time_zone: "Asia/Shanghai" }];
  f2.snapshot.data.maintenance_events = [
    { id: "e1", user_id: 1, event_type: "daily_check", details_json: "{}" },
    { id: "e2", user_id: 1, event_type: "inventory_changed", subject_id: "1", details_json: "{}" },
  ];
  // Retain original 2026-10-21 date throughout
  const item: Row = { ...validArgs.items[0], user_id: 1 };
  const plan = { ...validArgs.plan };
  f2.snapshot.data.meal_plans = [plan];
  f2.snapshot.data.meal_plan_items = [item];
  f2.snapshot.data.recipes = validArgs.data.recipes;
  f2.snapshot.data.inventory_items = validArgs.data.inventory_items;
  f2.snapshot.data.kitchenware_items = validArgs.data.kitchenware_items;
  // Trusted catalog evidence matching 测试锅 catalog_id: 1
  f2.snapshot.data.kitchenware_catalog = [{ id: 1, name: "测试锅", quality_status: "trusted" }];
  f2.snapshot.data.user_health_profiles = validArgs.data.user_health_profiles;
  f2.snapshot.data.meal_plan_changes = [{
    id: "change-1",
    user_id: 1,
    plan_id: String(plan.id),
    item_id: String(item.id),
    status: "pending",
    before_version: 1,
    after_json: JSON.stringify({ version: 1, recipeId: 2, title: "替代菜2" }),
  }];
  f2.snapshot.recipeIds = (validArgs.data.recipes ?? []).map(r => Number(r.id));
  f2.repository.candidateRecipeIds = async () => f2.snapshot.recipeIds;

  // Process now also uses 2026-10-21
  const r2 = await processMaintenanceJobs(f2.repository, f2.context, 10, () => new Date("2026-10-21T01:00:00Z"));
  assert.equal(r2.succeeded, 1);
  const diag2 = f2.diagnostics() as { notes: string[]; pendingRevalidations?: { changeId: string; outcome: string }[] };
  assert.ok(Array.isArray(diag2.notes));
  assert.ok(diag2.notes.includes("每日检查已关闭，跳过该定时事件"));
  assert.ok(diag2.notes.some(n => n.includes("本次快照检查通过，仍待确认，接受时须重新预览")));
  assert.ok(diag2.pendingRevalidations);
  const rev = diag2.pendingRevalidations.find(p => p.changeId === "change-1");
  assert.ok(rev);
  assert.equal(rev.outcome, "checked");
  const uniqueNotes = new Set(diag2.notes);
  assert.equal(uniqueNotes.size, diag2.notes.length);
});
