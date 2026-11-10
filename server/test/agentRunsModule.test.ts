import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AgentRunsRepository } from "../src/modules/agentRuns/repository.js";
import { AgentRunsService } from "../src/modules/agentRuns/service.js";
import { SqliteAgentRunsRepository } from "../src/modules/agentRuns/sqliteRepository.js";

function fakeRepository(overrides: Partial<AgentRunsRepository> = {}): AgentRunsRepository {
  return {
    createRun: async () => ({ id: "run-1", sessionId: "session-1" }), media: async () => undefined,
    run: async () => undefined, reusableRun: async () => undefined, setStatus: async () => true,
    appendEvent: async () => 1, events: async () => [], saveActions: async () => [],
    updateActionStatus: async () => {}, recordActionDecision: async () => {}, actions: async () => [],
    reviseActions: async () => {}, recoverableRuns: async () => [], deleteUserData: async () => 0,
    ...overrides,
  };
}

describe("Agent runs module", () => {
  test("normalizes reuse windows, event summaries, sequences, and decision IDs", async () => {
    const calls: unknown[][] = [];
    const service = new AgentRunsService(fakeRepository({
      reusableRun: async (...args) => { calls.push(["reuse", ...args]); return undefined; },
      appendEvent: async (...args) => { calls.push(["event", ...args]); return 7; },
      events: async (...args) => { calls.push(["events", ...args]); return []; },
      recordActionDecision: async (...args) => { calls.push(["decision", ...args]); },
    }));
    await service.reusableRun(42, "key", 999);
    assert.equal(await service.appendEvent("run-1", 42, "Supervisor", "test", "x".repeat(600)), 7);
    await service.events("run-1", 42, -9.8);
    await service.recordActionDecision(["a", "a", "b"], 42, "approve");
    assert.deepEqual(calls[0], ["reuse", 42, "key", 60]);
    assert.equal(String(calls[1]?.[5]).length, 500);
    assert.deepEqual(calls[2], ["events", "run-1", 42, 0]);
    assert.deepEqual(calls[3], ["decision", ["a", "b"], 42, "approve"]);
  });

  test("SQLite persists sanitized runs, ordered events, idempotent actions, and atomic revisions", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,session_id TEXT NOT NULL,modality TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'assistant',
        status TEXT NOT NULL DEFAULT 'queued',input_json TEXT NOT NULL,result_json TEXT,pending_approval_json TEXT,pending_input_json TEXT,
        error_code TEXT,error_message TEXT,checkpoint_thread_id TEXT NOT NULL,started_at TEXT,completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ); CREATE TABLE agent_run_media (
        id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,kind TEXT NOT NULL,mime_type TEXT,data_base64 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ); CREATE TABLE agent_run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,sequence INTEGER NOT NULL,
        agent_name TEXT NOT NULL,event_type TEXT NOT NULL,summary TEXT NOT NULL,payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(run_id,sequence)
      ); CREATE TABLE agent_actions (
        id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,action_type TEXT NOT NULL,risk_level TEXT NOT NULL,
        status TEXT NOT NULL,payload_json TEXT NOT NULL,before_json TEXT,result_json TEXT,idempotency_key TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,expires_at TEXT,executed_at TEXT,undone_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approval_decision TEXT,approved_by_user_id INTEGER,approved_at TEXT,UNIQUE(user_id,idempotency_key)
      )`);
      const repository = new SqliteAgentRunsRepository(database);
      const created = await repository.createRun(42, {
        modality: "image", source: "assistant", sessionId: " session-1 ", prompt: "识别番茄",
        image: "data:image/png;base64,c2VjcmV0", mimeType: "image/png", idempotencyKey: "request-1",
      });
      assert.equal(created.sessionId, "session-1");
      assert.deepEqual(await repository.createRun(42, {
        modality: "image", source: "assistant", sessionId: "different-session", prompt: "重复请求",
        image: "different-media", mimeType: "image/png", idempotencyKey: "request-1",
      }), created);
      const stored = await repository.run(created.id, 42);
      assert(stored);
      assert.equal(stored.input_json.includes("c2VjcmV0"), false);
      assert.equal((await repository.media(created.id, 42))?.data_base64, "data:image/png;base64,c2VjcmV0");
      assert.equal(await repository.appendEvent(created.id, 42, "VisionAgent", "agent_started", "开始"), 2);
      assert.deepEqual((await repository.events(created.id, 42, 0)).map((event) => event.sequence), [1, 2]);
      assert.equal((await repository.reusableRun(42, "request-1", 15))?.id, created.id);

      const proposals = [{ actionType: "record_diet_meal" as const, riskLevel: "high" as const,
        summary: "记录晚餐", payload: { foodName: "番茄" } }];
      const saved = await repository.saveActions(created.id, 42, proposals);
      assert.equal(saved.length, 1);
      assert.equal((await repository.saveActions(created.id, 42, proposals))[0]?.id, saved[0]?.id);
      await assert.rejects(() => repository.saveActions(created.id, 42, [
        { ...proposals[0], actionType: "record_health_log" as const },
      ]), /bundle 已变化/);
      await assert.rejects(() => repository.saveActions(created.id, 42, []), /bundle 已变化/);
      const orderedRun = await repository.createRun(42, {
        modality: "text", prompt: "验证 action 顺序", idempotencyKey: "request-2",
      });
      const orderedProposals = [
        proposals[0],
        { actionType: "record_health_log" as const, riskLevel: "high" as const,
          summary: "记录饮水", payload: { waterMl: 300 } },
      ];
      await repository.saveActions(orderedRun.id, 42, orderedProposals);
      database.prepare("UPDATE agent_actions SET id='z-first' WHERE run_id=? AND action_type='record_diet_meal'")
        .run(orderedRun.id);
      database.prepare("UPDATE agent_actions SET id='a-second' WHERE run_id=? AND action_type='record_health_log'")
        .run(orderedRun.id);
      const replayed = await repository.saveActions(orderedRun.id, 42, orderedProposals);
      assert.deepEqual(replayed.map((action) => [action.id, action.actionType]), [
        ["z-first", "record_diet_meal"], ["a-second", "record_health_log"],
      ]);
      assert.deepEqual((await repository.actions(orderedRun.id, 42)).map((action) => action.actionType),
        ["record_diet_meal", "record_health_log"]);
      await assert.rejects(() => repository.reviseActions(created.id, 42, [
        { ...proposals[0], id: saved[0]?.id, payload: { foodName: "鸡蛋" } },
        { ...proposals[0], id: "missing", payload: { foodName: "应回滚" } },
      ]), /已变化/);
      assert.deepEqual((await repository.actions(created.id, 42))[0]?.payload, { foodName: "番茄" });
      await repository.recordActionDecision([saved[0]!.id], 42, "approve");
      await repository.updateActionStatus(saved[0]!.id, "executed", { result: { dietRecordId: 7 } });
      assert.deepEqual((await repository.actions(created.id, 42))[0]?.result, { dietRecordId: 7 });

      await repository.setStatus(created.id, "completed", { result: { reply: "完成" }, pendingApproval: null });
      assert.equal((await repository.run(created.id, 42))?.status, "completed");
      assert.equal(await repository.setStatus(created.id, "cancelled", {}), false);
      assert.equal((await repository.run(created.id, 42))?.status, "completed");
      assert.equal(await repository.deleteUserData(42), 2);
      assert.equal(await repository.run(created.id, 42), undefined);
      const photoInput = { modality: "inventory_scan" as const, image: "cGhvdG8=", idempotencyKey: "inventory-photo:test" };
      const photo = await repository.createRun(42, photoInput);
      database.prepare("UPDATE agent_runs SET status='completed',created_at=datetime('now','-2 days') WHERE id=?").run(photo.id);
      assert.equal((await repository.createRun(42, photoInput)).id, photo.id);
      assert.notEqual((await repository.createRun(43, photoInput)).id, photo.id);
      database.prepare("UPDATE agent_runs SET status='failed' WHERE id=?").run(photo.id);
      assert.notEqual((await repository.createRun(42, photoInput)).id, photo.id);


    } finally {
      database.close();
    }
  });
});
