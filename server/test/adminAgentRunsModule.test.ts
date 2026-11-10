import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AdminAgentRunsRepository } from "../src/modules/adminAgentRuns/repository.js";
import { AdminAgentRunsService } from "../src/modules/adminAgentRuns/service.js";
import type { AgentRunDetailData, AgentRunListData } from "../src/modules/adminAgentRuns/types.js";

const runId = "11111111-1111-4111-8111-111111111111";
const emptyList: AgentRunListData = { rows: [], total: 0, statusCounts: [], usageSummary: {} };
function detailData(): AgentRunDetailData {
  return {
    run: { id: runId, userId: 42, username: "tester", sessionId: "session-1", modality: "image", source: "vision-food",
      status: "completed", inputJson: { prompt: "识别沙拉", mediaRef: "secret", image: "raw" },
      resultJson: JSON.stringify({ reply: "蔬菜沙拉", artifacts: [{ type: "vision" }] }), pendingApprovalJson: null,
      pendingInputJson: null, errorCode: null, errorMessage: null, hasMedia: true, createdAt: "2026-09-01" },
    checkpointAvailable: true, checkpointCount: 2, checkpointWriteCount: 3,
    events: [
      { sequence: 1, agentName: "Supervisor", eventType: "run_created", summary: "创建", payloadJson: null },
      { sequence: 2, agentName: "VisionAgent", eventType: "agent_completed", summary: "完成", payloadJson: null },
      { sequence: 3, agentName: "OperationsAgent", eventType: "agent_completed", summary: "动作", payloadJson: null },
      { sequence: 4, agentName: "Supervisor", eventType: "run_completed", summary: "结束", payloadJson: null },
    ],
    actions: [{ id: "action-1", payloadJson: { foodName: "生菜" }, beforeJson: null, resultJson: null }],
    usageSummary: { modelCalls: "1", totalTokens: "40", estimatedCostUsd: "0.002" },
    usageByAgent: [{ agentName: "VisionAgent", modelCalls: "1", totalTokens: "40" }],
    usageRecords: [{ id: "7", agentName: "VisionAgent", totalTokens: "40", success: true }],
  };
}
function repository(overrides: Partial<AdminAgentRunsRepository> = {}): AdminAgentRunsRepository {
  return { list: async () => emptyList, detail: async () => null, ...overrides };
}

describe("admin Agent Runs module", () => {
  test("normalizes list filters, numeric aggregates, media booleans and prompt previews", async () => {
    let captured: unknown;
    const service = new AdminAgentRunsService(repository({ list: async (input) => { captured = input; return {
      rows: [{ id: runId, userId: "42", inputJson: { messages: [{ role: "user", content: "最新问题" }], mediaRef: "secret" },
        hasMedia: true, eventCount: "3", estimatedCostUsd: "0.001" }], total: 1,
      statusCounts: [{ status: "completed", count: "1" }], usageSummary: { modelCalls: "2", totalTokens: "300" },
    }; } }));
    const result = await service.list({ page: "0", pageSize: "500", status: "invalid", modality: "image", agent: " VisionAgent ",
      query: " query ", range: "all" });
    assert.deepEqual(captured, { page: 1, pageSize: 100, status: undefined, modality: "image", agent: "VisionAgent",
      search: "query", rangeDays: null });
    assert.equal(result.items[0]?.promptPreview, "最新问题");
    assert.equal(result.items[0]?.hasMedia, 1);
    assert.equal(result.items[0]?.eventCount, 3);
    assert.equal(result.usageSummary.totalTokens, 300);
  });

  test("normalizes SQLite text and PostgreSQL JSONB while recovering missing event payloads", async () => {
    const service = new AdminAgentRunsService(repository({ detail: async () => detailData() }), async () => ({
      goal: "识别食物", specialists: ["VisionAgent"], outputs: { VisionAgent: { confidence: 0.91 } }, artifactCount: 1,
    }));
    const result = await service.detail(runId);
    assert.equal(result.run.input.prompt, "识别沙拉");
    assert.equal(result.run.input.mediaRef, undefined);
    assert.equal(result.run.checkpointCount, 2);
    assert.deepEqual(result.events[0]?.payload, { input: { prompt: "识别沙拉" }, recoveredFromRun: true });
    assert.deepEqual(result.events[1]?.payload, { confidence: 0.91, recoveredFromCheckpoint: true });
    assert.equal((result.events[2]?.payload as { actions: Array<{ payload: { foodName: string } }> }).actions[0]?.payload.foodName, "生菜");
    assert.equal((result.events[3]?.payload as { reply: string }).reply, "蔬菜沙拉");
    assert.equal(result.usage.summary.totalTokens, 40);
    assert.equal(result.usage.records[0]?.success, 1);
  });

  test("validates run identifiers and maps missing rows", async () => {
    const service = new AdminAgentRunsService(repository());
    await assert.rejects(() => service.detail("invalid"), /Agent Run ID 无效/);
    await assert.rejects(() => service.detail(runId), /Agent Run 不存在/);
  });
});
