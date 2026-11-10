import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AIConversationsRepository } from "../src/modules/aiConversations/repository.js";
import { AIConversationsService } from "../src/modules/aiConversations/service.js";
import type { StoredChatTurn } from "../src/modules/aiConversations/types.js";

function repository(overrides: Partial<AIConversationsRepository> = {}): AIConversationsRepository {
  return {
    recordTurn: async () => true,
    deleteConversation: async () => 0,
    legacyInventoryScanJob: async () => null,
    ...overrides,
  };
}

describe("AI conversations module", () => {
  test("normalizes and bounds chat audit data", async () => {
    let stored: StoredChatTurn | undefined;
    const service = new AIConversationsService(repository({ recordTurn: async (turn) => { stored = turn; return true; } }));
    const requestedAt = Date.parse("2026-09-01T08:00:00.000Z");
    assert.equal(await service.recordTurn({
      userId: 42,
      sessionId: " session-1 ",
      source: "assistant",
      userContent: "u".repeat(13_000),
      assistantContent: "a".repeat(13_000),
      systemContents: [" safe ", "safe", "", "x".repeat(13_000)],
      payload: { trace: "p".repeat(60_000) },
      responseTimeMs: -10.4,
      requestedAt,
      respondedAt: requestedAt + 20,
    }), true);
    assert(stored);
    assert.equal(stored.sessionId, "session-1");
    assert.equal(stored.userContent.length, 12_000);
    assert.equal(stored.assistantContent.length, 12_000);
    assert.deepEqual(stored.systemContents.map((content) => content.length), [4, 12_000]);
    assert.deepEqual(Object.keys(stored.payload ?? {}), ["truncated", "preview"]);
    assert.equal(stored.responseTimeMs, 0);
    assert.equal(stored.requestedAt, "2026-09-01T08:00:00.000Z");
  });

  test("preserves lifecycle results and forwards owned legacy jobs", async () => {
    const calls: Array<[number, string]> = [];
    const job = { id: "job-1", status: "completed", result: [{ foodName: "番茄" }], errorMessage: null,
      createdAt: "2026-09-01", updatedAt: "2026-09-01" };
    const service = new AIConversationsService(repository({
      deleteConversation: async (userId, sessionId) => { calls.push([userId, sessionId]); return 3; },
      legacyInventoryScanJob: async (id, userId) => id === "job-1" && userId === 42 ? job : null,
    }));
    assert.equal(await service.deleteConversation(42, " session-1 "), 3);
    assert.deepEqual(calls, [[42, "session-1"]]);
    assert.deepEqual(await service.legacyInventoryScanJob("job-1", 42), job);
    assert.equal(await service.legacyInventoryScanJob("job-1", 7), null);
  });

  test("rejects invalid session identifiers and timestamps before persistence", async () => {
    const service = new AIConversationsService(repository());
    await assert.rejects(() => service.deleteConversation(42, ""), /AI_CHAT_SESSION_INVALID/);
    await assert.rejects(() => service.deleteConversation(42, "x".repeat(121)), /AI_CHAT_SESSION_INVALID/);
    await assert.rejects(() => service.recordTurn({ userId: 42, sessionId: "session-1", source: "assistant",
      userContent: "问题", assistantContent: "回答", responseTimeMs: 10, requestedAt: Number.NaN, respondedAt: Date.now() }),
    /AI_CHAT_TIMESTAMP_INVALID/);
  });

  test("returns the repository deletion guard result", async () => {
    const service = new AIConversationsService(repository({ recordTurn: async () => false }));
    const now = Date.now();
    assert.equal(await service.recordTurn({ userId: 42, sessionId: "deleted-session", source: "assistant",
      userContent: "旧问题", assistantContent: "迟到回答", responseTimeMs: 10, requestedAt: now, respondedAt: now + 10 }), false);
  });
});
