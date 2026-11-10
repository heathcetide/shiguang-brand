import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminConsoleRepository } from "../src/modules/adminConsole/repository.js";
import { AdminConsoleService } from "../src/modules/adminConsole/service.js";

function repository(overrides: Partial<AdminConsoleRepository> = {}): AdminConsoleRepository {
  return {
    coreLoopSettings: async () => ({ enabled: 0,version: 1,coverage_start: null }), updateCoreLoopSettings: async () => false,
    coreLoopActor: async () => null, updateCoreLoopActor: async () => false,
    coreLoopData: async () => ({ productions: [],intakes: [],logs: [],legacy: [],shared: [],settings: { enabled: 0,version: 1,coverage_start: null } }),
    stats: async () => ({}), funnel: async () => [], auditLogs: async () => ({ items: [], total: 0 }),
    scanJobs: async () => [], scanJob: async () => null, conversations: async () => [],
    conversation: async () => ({ user: null, messages: [] }), runDiagnostic: async () => null,
    trash: async () => ({ community: [], recipes: [], ingredients: [], kitchenware: [] }), restore: async () => false,
    userExists: async () => false, usage: async () => ({ summary: {}, trend: [], failures: [], models: [], endpoints: [], users: [] }),
    trends: async () => [], recent: async () => ({ recentUsers: [], recentPosts: [], pendingFoods: [] }), ...overrides,
  };
}

describe("admin console module", () => {
  test("formats JSONB scans, diagnostics and numeric aggregates like legacy SQLite", async () => {
    const service = new AdminConsoleService(repository({
      scanJobs: async () => [{ id: "scan", resultJson: [{ foodName: "番茄" }] }],
      conversation: async () => ({ user: { id: 7, username: "tester" }, messages: [{ id: 1, status: "failed",
        payloadJson: { agentRunId: "run-1", requestId: "req-1" } }] }),
      runDiagnostic: async () => ({ errorCode: "AI_NOT_CONFIGURED", errorMessage: "missing key sk-supersecret123456789", model: "test-model" }),
      usage: async () => ({ summary: { requests: "2", totalTokens: "12", successRate: "50.0" },
        trend: [], failures: [], models: [], endpoints: [], users: [] }),
    }));
    assert.equal((await service.scanJobs({})).items[0]?.itemCount, 1);
    const detail = await service.conversation(7, "session");
    assert.equal((detail.messages[0]?.payload as Record<string, unknown>).errorType, "configuration");
    assert.doesNotMatch(String((detail.messages[0]?.payload as Record<string, unknown>).errorMessage), /supersecret/);
    assert.equal((await service.usage({ range: "7d" })).summary.totalTokens, 12);
  });

  test("validates console selectors and maps repository misses", async () => {
    const service = new AdminConsoleService(repository());
    await assert.rejects(() => service.scanJob("missing"), /识别任务不存在/);
    await assert.rejects(() => service.conversation(0, "session"), /会话参数无效/);
    await assert.rejects(() => service.restore("unknown", 1, { adminUserId: 1 }), /无效的回收站资源/);
    await assert.rejects(() => service.restore("recipes", 1, { adminUserId: 1 }), /回收站中未找到/);
    await assert.rejects(() => service.usage({ userId: "bad" }), /无效的用户 ID/);
    await assert.rejects(() => service.usage({ userId: 99 }), /用户不存在/);
  });
});
