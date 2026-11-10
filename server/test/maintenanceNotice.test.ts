import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceNotice } from "../src/modules/planMaintenance/notice.js";
const job = (changes: unknown[],checks: string[] = []) => ({ id: "job",status: "completed",attempts: 1,result_json: { changes,diagnostics: { checks } } });
test("small automatic adjustments stay silent", () => {
  assert.equal(maintenanceNotice(job([{ change: { id: "change",status: "applied" } }])),null);
});
test("unchanged decisions and checks share a reminder key across runs", () => {
  const one = maintenanceNotice(job([{ change: { id: "pending",status: "pending" } }],["核对复热","核对份量"]));
  const two = maintenanceNotice({ ...job([{ change: { id: "pending",status: "pending" } }],["核对份量","核对复热","核对份量"]),id: "later" });
  assert.equal(one?.key,two?.key);
  assert.notEqual(one?.key,maintenanceNotice(job([{ change: { id: "new-pending",status: "pending" } }],["核对份量","核对复热"]))?.key);
});
test("each final failure is actionable without exposing internal errors", () => {
  const notice = maintenanceNotice({ id: "failed",status: "failed",attempts: 3,last_error: "private database error" });
  assert.equal(notice?.action,true); assert.equal(notice?.key,"maintenance:failed");
  assert.equal(JSON.stringify(notice).includes("private"),false);
});


test("informational skipped results do not produce action reminders", () => {
  assert.equal(maintenanceNotice({ ...job([]),result_json: { diagnostics: { checks: [],notes: ["每日检查已关闭，跳过该定时事件"] } } }),null);
});
