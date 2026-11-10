import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AgentSchedulingRepository } from "../src/modules/agentScheduling/repository.js";
import { AgentSchedulingService } from "../src/modules/agentScheduling/service.js";
import { SqliteAgentSchedulingRepository } from "../src/modules/agentScheduling/sqliteRepository.js";

function repository(overrides: Partial<AgentSchedulingRepository> = {}): AgentSchedulingRepository {
  return {
    claimQueuedRuns: async () => [],
    expireAwaitingApproval: async () => 0,
    resetInterruptedRuns: async () => 0,
    ...overrides,
  };
}

describe("Agent scheduling module", () => {
  test("normalizes concurrency capacity before claiming queued runs", async () => {
    const calls: Array<[number, number]> = [];
    const service = new AgentSchedulingService(repository({
      claimQueuedRuns: async (userId, capacity) => { calls.push([userId, capacity]); return ["run-1"]; },
    }));
    assert.deepEqual(await service.claimQueuedRuns(42), ["run-1"]);
    await service.claimQueuedRuns(42, 0);
    await service.claimQueuedRuns(42, 99.8);
    assert.deepEqual(calls, [[42, 2], [42, 2], [42, 20]]);
  });

  test("delegates approval expiry and interrupted-run recovery", async () => {
    const calls: string[] = [];
    const service = new AgentSchedulingService(repository({
      expireAwaitingApproval: async (runId, userId) => { calls.push(`expire:${runId}:${userId}`); return 3; },
      resetInterruptedRuns: async () => { calls.push("reset"); return 2; },
    }));
    assert.equal(await service.expireAwaitingApproval("run-1", 42), 3);
    assert.equal(await service.resetInterruptedRuns(), 2);
    assert.deepEqual(calls, ["expire:run-1:42", "reset"]);
  });

  test("SQLite atomically claims available slots, expires approvals, and recovers interrupted runs", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL,
        started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      ); CREATE TABLE agent_actions (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id INTEGER NOT NULL,
        status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      database.prepare(`INSERT INTO agent_runs(id,user_id,status,created_at) VALUES
        ('running',42,'running','2026-09-01 00:00:00'),
        ('queued-1',42,'queued','2026-09-01 00:00:01'),
        ('queued-2',42,'queued','2026-09-01 00:00:02')`).run();
      database.prepare(`INSERT INTO agent_actions(id,run_id,user_id,status)
        VALUES('action-1','queued-1',42,'awaiting_approval')`).run();
      const repository = new SqliteAgentSchedulingRepository(database);
      assert.deepEqual(await repository.claimQueuedRuns(42, 2), ["queued-1"]);
      assert.deepEqual(await repository.claimQueuedRuns(42, 2), []);
      assert.equal(await repository.expireAwaitingApproval("queued-1", 42), 1);
      assert.equal(await repository.resetInterruptedRuns(), 2);
      assert.deepEqual(database.prepare("SELECT id FROM agent_runs WHERE status='queued' ORDER BY id")
        .all(), [{ id: "queued-1" }, { id: "queued-2" }, { id: "running" }]);
    } finally {
      database.close();
    }
  });
});
