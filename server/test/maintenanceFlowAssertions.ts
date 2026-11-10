import assert from "node:assert/strict";
import { processMaintenanceJobs } from "../src/modules/planMaintenance/process.js";
import { evaluateMaintenanceJob } from "../src/modules/planMaintenance/evaluate.js";
import type { MaintenanceQueueRepository } from "../src/modules/planMaintenance/queue.js";
import type { Row } from "../src/modules/mealPlans/formatters.js";

export async function verifyMaintenanceFlow(repository: MaintenanceQueueRepository,userId: number,query: (sql: string,args?: unknown[]) => Promise<Row[]>) {
  await query("DELETE FROM plan_maintenance_jobs"); await query("DELETE FROM plan_maintenance_events");
  const ingredients = (food: string) => JSON.stringify([{ name: food,amount: "1个" }]);
  const recipe = async (title: string,food: string) => Number((await query("INSERT INTO recipes(title,ingredients_json,steps_json,status,serving_size,prep_time,cook_time) VALUES(?,?,'[]','approved',1,1,5) RETURNING id",[title,ingredients(food)]))[0].id);
  const original = await recipe("验收原餐","维护验收原料甲XYZ");
  const alternative = await recipe("验收替换餐","维护验收原料乙XYZ");
  const fixed = await recipe("验收确认餐","维护验收原料丙XYZ");
  const stock = async (food: string,quantity: number) => Number((await query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,expiration_date) VALUES(?,?,'其他',?,?,'piece','2035-09-20') RETURNING id",[userId,food,`${quantity}个`,quantity]))[0].id);
  const changedStock = await stock("维护验收原料甲XYZ",0);
  await stock("维护验收原料乙XYZ",1); await stock("维护验收原料丙XYZ",1);
  await query("INSERT INTO meal_plans(id,user_id,title,start_date,end_date,constraints_json) VALUES('flow-plan',?,'完整链路','2035-09-12','2035-09-18',?)",[userId,JSON.stringify({ executionItems: { "flow-target": { servings: 1 },"flow-fixed": { servings: 1 } } })]);
  for (const [id,recipeId,food,confirmed] of [["flow-target",original,"维护验收原料甲XYZ",null],["flow-fixed",fixed,"维护验收原料丙XYZ","2035-09-11T00:00:00Z"]] as const) {
    await query("INSERT INTO meal_plan_items(id,plan_id,user_id,planned_date,meal_type,title,recipe_id,ingredients_json,confirmed_at) VALUES(?,'flow-plan',?,'2035-09-12','午餐',?,?,?,?)",[id,userId,id,recipeId,ingredients(food),confirmed]);
  }
  await query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES('flow-event',?,'inventory_changed','flow-stock-change',?,'2035-09-12T00:00:00Z')",[userId,String(changedStock)]);
  const before = (await query("SELECT * FROM meal_plan_items WHERE id='flow-fixed'"))[0];
  const now = () => new Date("2035-09-12T01:00:00Z");
  assert.equal(await repository.enqueueEvents(now()),1);
  const context = { runId: "flow",taskName: "plan-maintenance-process" as const,leaseOwnerId: "flow",signal: new AbortController().signal,assertActive: async () => {} };
  const result = await processMaintenanceJobs(repository,context,10,now);
  assert.equal(result.succeeded,1); assert.equal(result.failed,0);
  const after = (await query("SELECT * FROM meal_plan_items WHERE id='flow-fixed'"))[0];
  assert.deepEqual(after,before);
  const target = (await query("SELECT recipe_id,version FROM meal_plan_items WHERE id='flow-target'"))[0];
  assert.equal(Number(target.recipe_id),original); assert.equal(Number(target.version),1);
  const proposal = (await query("SELECT status,reason,after_json,applied_at FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0];
  assert.equal(proposal.status,"pending"); assert.match(String(proposal.reason),/需先预览当前整套餐单，未自动应用/);
  const next = typeof proposal.after_json === "string" ? JSON.parse(proposal.after_json) : proposal.after_json as Row;
  assert.equal(Number(next.recipeId),alternative,"the candidate is retained as a suggestion, not silently applied");
  assert.equal(proposal.applied_at,null);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count),1);
  assert.ok((await query("SELECT processed_at FROM plan_maintenance_events WHERE id='flow-event'"))[0].processed_at);
  assert.equal(await repository.enqueueEvents(now()),0);
  assert.equal((await processMaintenanceJobs(repository,context,10,now)).processed,0);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count),1);

  // 1. 保存目标餐次、计划和 pending 变更完整行
  const savedTarget = (await query("SELECT * FROM meal_plan_items WHERE id='flow-target'"))[0];
  const savedPlan = (await query("SELECT * FROM meal_plans WHERE id='flow-plan'"))[0];
  const savedProposal = (await query("SELECT * FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0];

  // 2. 将替代菜谱状态设为非 approved（正式 rejected）
  await query("UPDATE recipes SET status='rejected' WHERE id=?", [alternative]);

  // 3. 插入只影响替代食材的 inventory_changed 事件
  const altStockId = (await query("SELECT id FROM inventory_items WHERE user_id=? AND food_name='维护验收原料乙XYZ'", [userId]))[0].id;
  await query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES('flow-event-alt',?,'inventory_changed','alt-stock-change',?,'2035-09-12T02:00:00Z')", [userId, String(altStockId)]);

  // 4. 运行调度，验证原 scope 为空，但 diagnostics.pendingRevalidations 产出 blocked/不可用
  const later = () => new Date("2035-09-12T03:00:00Z");
  assert.equal(await repository.enqueueEvents(later()), 1);

  const job = await repository.claim(later());
  assert.ok(job);
  const scope = await repository.scope(job, "2035-09-12");
  assert.equal(scope?.items.length, 0);

  const evaluation = await evaluateMaintenanceJob(repository, job, later());
  assert.ok(evaluation);
  assert.equal(evaluation.scope.items.length, 0);
  assert.ok(evaluation.snapshot.recipeIds.includes(alternative), "recipeIds includes the rejected candidate recipe");
  const pendingRev = evaluation.revalidations.evaluations.find(e => e.changeId === String(savedProposal.id));
  assert.ok(pendingRev);
  assert.equal(pendingRev.outcome, "blocked");
  assert.ok(pendingRev.checks.some(c => c.includes("替代菜谱不存在、无访问权限或审核已变化")), "blocked checks specify recipe unavailability rather than missing evidence");

  const applyRes = await repository.applyChanges(job, evaluation.replacements.changes, evaluation.snapshot, {
    ...evaluation.result,
    fromDate: evaluation.fromDate,
    notes: evaluation.revalidations.notes.length ? evaluation.revalidations.notes : undefined,
    pendingRevalidations: evaluation.revalidations.evaluations.length ? evaluation.revalidations.evaluations : undefined,
    checks: evaluation.revalidations.checks,
  });
  assert.equal(applyRes.kind, "completed");

  // 原 target, plan, change 完全不变，pending 数量仍为 1
  const currentTarget = (await query("SELECT * FROM meal_plan_items WHERE id='flow-target'"))[0];
  assert.deepEqual(currentTarget, savedTarget);
  const currentPlan = (await query("SELECT * FROM meal_plans WHERE id='flow-plan'"))[0];
  assert.deepEqual(currentPlan, savedPlan);
  const currentProposal = (await query("SELECT * FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0];
  assert.deepEqual(currentProposal, savedProposal);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count), 1);

  // 任务 diagnostics 包含 pendingRevalidations 结果
  const completedJob = (await query("SELECT result_json FROM plan_maintenance_jobs WHERE id=?", [job.id]))[0];
  const jobResult = typeof completedJob.result_json === "string" ? JSON.parse(completedJob.result_json) : completedJob.result_json as Row;
  assert.equal(jobResult.diagnostics.pendingRevalidations[0].outcome, "blocked");
  assert.ok(jobResult.diagnostics.checks.some((c: string) => c.includes("替代菜谱不存在、无访问权限或审核已变化")));

  // 重复事件/重跑不增建议
  assert.equal(await repository.enqueueEvents(later()), 0);
  assert.equal((await processMaintenanceJobs(repository, context, 10, later)).processed, 0);
  assert.equal(Number((await query("SELECT COUNT(*) AS count FROM meal_plan_changes WHERE plan_id='flow-plan'"))[0].count), 1);

  // 5. 新事件：领取快照后将 pending 状态改为 rejected，applyChanges 必须 input_conflict
  await query("INSERT INTO plan_maintenance_events(id,user_id,event_type,source_id,subject_id,created_at) VALUES('flow-event-conflict',?,'inventory_changed','conflict-stock',?,'2035-09-12T04:00:00Z')", [userId, String(altStockId)]);
  const conflictTime = () => new Date("2035-09-12T05:00:00Z");
  assert.equal(await repository.enqueueEvents(conflictTime()), 1);

  const conflictJob = await repository.claim(conflictTime());
  assert.ok(conflictJob);
  const snapshotBeforeReject = await repository.inputs(conflictJob, await repository.candidateRecipeIds());
  assert.ok(snapshotBeforeReject);

  // 外部修改：将 pending 建议置为 rejected
  await query("UPDATE meal_plan_changes SET status='rejected' WHERE id=?", [savedProposal.id]);

  // 提交时使用旧快照必须发生冲突，任务不完成，事件不确认
  const conflictRes = await repository.applyChanges(conflictJob, [], snapshotBeforeReject, {
    ruleVersion: "maintenance-2026-09-12.1",
    inputFingerprint: snapshotBeforeReject.fingerprint,
    fromDate: "2035-09-12",
    modelCalls: 0,
    cost: 0,
    assessments: [],
    checks: [],
  });
  assert.equal(conflictRes.kind, "input_conflict");
  const uncompletedEvent = (await query("SELECT processed_at FROM plan_maintenance_events WHERE id='flow-event-conflict'"))[0];
  assert.equal(uncompletedEvent.processed_at, null);

  // 失败后使用最新快照重读，正常结束并不复活建议
  await repository.fail(conflictJob, conflictTime(), "maintenance inputs changed; recompute required");
  const retryJob = await repository.claim(new Date("2035-09-12T06:00:00Z"));
  assert.ok(retryJob);
  const freshSnapshot = await repository.inputs(retryJob, await repository.candidateRecipeIds());
  assert.ok(freshSnapshot);
  const freshApply = await repository.applyChanges(retryJob, [], freshSnapshot, {
    ruleVersion: "maintenance-2026-09-12.1",
    inputFingerprint: freshSnapshot.fingerprint,
    fromDate: "2035-09-12",
    modelCalls: 0,
    cost: 0,
    assessments: [],
    checks: [],
  });
  assert.equal(freshApply.kind, "completed");
  const finishedEvent = (await query("SELECT processed_at FROM plan_maintenance_events WHERE id='flow-event-conflict'"))[0];
  assert.ok(finishedEvent.processed_at);
  const finalProposal = (await query("SELECT status FROM meal_plan_changes WHERE id=?", [savedProposal.id]))[0];
  assert.equal(finalProposal.status, "rejected");
}
