import { createRequestGate } from "./requestGate";
import { mergeTaskResponse } from "./taskState";
import { editApprovalField, approvalFields } from "./approvalFields";
import type { AgentRunSummary, Message, AgentRunEvent } from "./types";
const run: AgentRunSummary = { id: "run-1", sessionId: "session-1", modality: "text", source: "assistant", status: "running", artifacts: [], createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:01Z" };
const event = (sequence: number): AgentRunEvent => ({ sequence, agentName: "Supervisor", eventType: "progress", summary: "处理中", createdAt: run.createdAt });
const message: Message = { id: "m1", sender: "ai", text: "处理中", time: "刚刚", agentRun: { run, events: [event(1), event(3)] } };
test("duplicate and out-of-order events converge, and final cards replace old results", () => {
  const next = mergeTaskResponse(message, { mode: "agent", run: { ...run, status: "completed", reply: "完成", updatedAt: "2026-09-18T00:00:03Z" }, events: [event(3), event(2), event(4)], solutionCards: [] });
  expect(next.agentRun?.events.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  expect(next.text).toBe("完成");
  expect(next.status).toBe("completed");
  expect(mergeTaskResponse(next, { mode: "agent", run })).toBe(next);
});
test("a response from a different run cannot replace this card", () => {
  expect(mergeTaskResponse(message, { mode: "agent", run: { ...run, id: "other" } })).toBe(message);
});
test("business form changes quantity while preserving identity, resource version and risk", () => {
  const action = { id: "action-1", actionType: "update_inventory_item", riskLevel: "high" as const, version: 3, summary: "修改鸡蛋数量", payload: { itemId: 42, version: 7, quantityValue: 3, quantityUnit: "piece" } };
  const edited = editApprovalField(action, approvalFields(action)[0], "2");
  expect(edited.payload).toEqual({ ...action.payload, quantityValue: 2 });
  expect(edited.id).toBe(action.id);
  expect(edited.version).toBe(3);
  expect(edited.riskLevel).toBe("high");
  expect(action.payload.quantityValue).toBe(3);
  expect(approvalFields({ ...action, actionType: "unknown" })).toEqual([]);
});

test("reply fragments are deduplicated, reset on retry and replaced by the final answer", () => {
  const stream = [
    { ...event(4), eventType: "reply_started" },
    { ...event(5), eventType: "reply_delta", payload: { delta: "第一句。" } },
    { ...event(6), eventType: "reply_delta", payload: { delta: "第二句。" } },
  ];
  const partial = mergeTaskResponse(message, { mode: "agent", run, events: stream });
  expect(partial.text).toBe("第一句。第二句。");
  expect(mergeTaskResponse(partial, { mode: "agent", run, events: stream }).text).toBe(partial.text);
  const retried = mergeTaskResponse(partial, { mode: "agent", run, events: [{ ...event(7), eventType: "reply_started" }, { ...event(8), eventType: "reply_delta", payload: { delta: "重新生成。" } }] });
  expect(retried.text).toBe("重新生成。");
  expect(mergeTaskResponse(retried, { mode: "agent", run: { ...run, status: "completed", reply: "最终答复" } }).text).toBe("最终答复");
});


test("same-render duplicate sends are serialized without blocking a switched account", () => {
  const gate = createRequestGate();
  const releaseFirst = gate.acquire("account-a:session-a");
  expect(gate.acquire("account-a:session-a")).toBeNull();
  const releaseSecond = gate.acquire("account-b:session-b");
  releaseFirst();
  expect(gate.acquire("account-b:session-b")).toBeNull();
  releaseSecond();
  expect(gate.acquire("account-b:session-b")).not.toBeNull();
});
