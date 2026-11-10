import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { conversationContext } from "../src/services/agent/conversation.js";
import { runtimePolicySchema, thinkingParameters, isTransientModelError } from "../src/modules/aiRuntime/policy.js";

const directory = mkdtempSync(path.join(tmpdir(), "agent-conversation-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "agent-conversation-test-secret-at-least-32-characters";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";
process.env.ENABLE_DEMO_SEED = "0";
let provider: Server;
let appServer: Server;
let db: typeof import("../src/storage/db.js").db;
let runtime: typeof import("../src/services/agent/runtime.js");
let userId: number;
let userToken: string;
let providerGate: (() => Promise<void>) | undefined;
let providerKeys: string[] = [];
let calls: Array<{ messages: Array<{ content: string }>; [key: string]: unknown }> = [];
let answers: unknown[] = [];

async function waitForGate(ready: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Mock provider gate timed out')), 10_000); })]); }
  finally { clearTimeout(timer); }
}

// Direct-assistant scenarios explicitly opt in; production defaults to compatibility.
beforeEach(() => { process.env.AI_MAIN_ASSISTANT_ENABLED = "true"; });
before(async () => {
  provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    providerKeys.push(String(req.headers.authorization));
    const gate = providerGate; providerGate = undefined;
    await gate?.();
    const answer = answers.shift() as Record<string, unknown> | undefined;
    res.setHeader("content-type", "application/json");
    if (answer?.httpStatus) { res.statusCode = Number(answer.httpStatus); res.end(JSON.stringify({ error: { message: "fixture failure" } })); return; }
    if (calls.at(-1)?.stream) {
      res.setHeader("content-type", "text/event-stream");
      const content = JSON.stringify(answer || { reply: "流式答复。" });
      for (let offset = 0; offset < content.length; offset += 3) {
        res.write(`data: ${JSON.stringify({ id: "mock-stream", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { content: content.slice(offset, offset + 3) }, finish_reason: null }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id: "mock-stream", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    const toolCall = answer?.toolCall as { name: string; args: unknown } | undefined;
    const message = toolCall
      ? { role: "assistant", content: null, tool_calls: [{ id: `tool-${calls.length}`, type: "function", function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }] }
      : { role: "assistant", content: typeof answer === "string" ? answer : JSON.stringify(answer || { goal: "问答", specialists: [], reply: "你好", candidates: [] }) };
    res.end(JSON.stringify({ id: `mock-${calls.length}`, object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message, finish_reason: toolCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  process.env.AI_API_KEY = "fixture-key";
  process.env.AI_BASE_URL = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
  process.env.AI_MODEL = "fixture";
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>((resolve) => { appServer = app.listen(0, "127.0.0.1", () => resolve()); });
  const response = await fetch(`http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "agent-test@example.com", username: "Agent测试", password: "Password1234" }) });
  const result = await response.json() as { user: { id: number }; token: string };
  assert.equal(response.status, 201);
  userId = result.user.id; userToken = result.token;
  runtime = await import("../src/services/agent/runtime.js");
});
after(async () => {
  if (provider) await new Promise<void>((resolve) => provider.close(() => resolve()));
  if (appServer) await new Promise<void>((resolve) => appServer.close(() => resolve()));
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

test("unset or disabled main assistant uses the compatibility route without direct tools", async () => {
  for (const flag of [undefined, "false"]) {
    if (flag === undefined) delete process.env.AI_MAIN_ASSISTANT_ENABLED;
    else process.env.AI_MAIN_ASSISTANT_ENABLED = flag;
    calls = [];
    answers = [
      { goal: "烹饪咨询", specialists: ["RecipeCookingAgent"] },
      { summary: "番茄先炒出汁，再加入炒好的鸡蛋。", artifacts: [] },
      { reply: "番茄先炒出汁，再加入炒好的鸡蛋。" },
    ];
    const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "番茄炒蛋怎么做？" }, 10000);
    assert.equal(response.run.status, "completed", JSON.stringify(response.run.error));
    assert.equal(calls.length, 3);
    assert.equal((calls[0].tools as unknown[] | undefined)?.length || 0, 0);
    assert.match(JSON.stringify(calls[0].messages), /兼容模式/);
    assert.match(response.run.reply!, /番茄先炒出汁/);
    const { getAgentRunInput } = await import("../src/services/agent/repository.js");
    assert.equal((await getAgentRunInput(response.run.id))?.input.metadata?.mainAssistantEnabled, false);
  }
});

test("ordinary chat consumes history and completes with one provider call", async () => {
  calls = [];
  answers = [{ goal: "替换第二份", specialists: [], reply: "第二份改成不辣的版本，第一份保持不变。", candidates: [] }];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "第二份不要辣", messages: [{ role: "assistant", content: "方案 plan-123：第一份番茄面，第二份辣椒炒蛋" }, { role: "user", content: "第二份不要辣" }] }, 10000);
  assert.equal(response.run.status, "completed", JSON.stringify(response.run.error));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].response_format, { type: "json_object" });
  assert.ok((calls[0].tools as unknown[]).length > 0);
  assert.match(JSON.stringify(calls[0].messages), /plan-123/);
  assert.match(response.run.reply!, /第二份/);
});

test("read-only tool round trip reaches its final answer within the shared budget", async () => {
  calls = [];
  answers = [
    { toolCall: { name: "get_user_nutrition_context", args: {} } },
    { goal: "查询库存", specialists: [], reply: "你的库存目前为空。", candidates: [] },
  ];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "查询我的库存，只读取，不修改。" }, 10000);
  assert.equal(response.run.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id=?").get(response.run.id)));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.some(message => (message as { role?: string }).role === "tool"));
  assert.match(response.run.reply!, /库存目前为空/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=?").get(response.run.id) as { count: number }).count, 0);
});

test("provider ignoring JSON mode still fails closed without accepting plain text", async () => {
  calls = [];
  answers = ["你好，我已经为你保存了记录。"];
  const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好，不要保存记录。" }, 10000);
  assert.equal(response.run.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(response.run.reply, undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=?").get(response.run.id) as { count: number }).count, 0);
});

test("clarification retains the original opt-in policy after the rollout flag is disabled", async () => {
  calls = [];
  answers = [{ goal: "人数", specialists: [], needsInput: "为几个人？" }];
  const created = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "安排备餐" }, 10000);
  assert.equal(created.run.status, "awaiting_input", JSON.stringify(created.run.error));
  process.env.AI_MAIN_ASSISTANT_ENABLED = "false";
  answers = [{ goal: "两人备餐", specialists: [], reply: "按两个人安排。" }];
  const resumed = await runtime.resumeSupervisorRun(userId, created.run.id, { input: "两个人" }, 10000);
  assert.equal(resumed.id, created.run.id);
  assert.equal(resumed.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id = ?").get(resumed.id)));
  assert.match(JSON.stringify(calls.at(-1)?.messages), /两个人/);
  assert.ok((calls.at(-1)?.tools as unknown[]).length > 0);
});

test("awaiting_input expires after 24 hours and enforces user boundary", async () => {
  calls = [];
  answers = [{ goal: "人数", specialists: [], needsInput: "为几个人？" }];
  const created = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "安排备餐" }, 10000);
  assert.equal(created.run.status, "awaiting_input");

  // Foreign user cannot resume or hijack another user's awaiting run
  await assert.rejects(runtime.resumeSupervisorRun(999999, created.run.id, { input: "外人" }), /不存在或无权/);

  // Valid awaiting_input run with SQLite naive timestamp (without Z) 18 hours ago in UTC does not expire
  const naiveRecentTime = new Date(Date.now() - 18 * 3600 * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  db.prepare("UPDATE agent_runs SET updated_at=?, created_at=? WHERE id=?").run(naiveRecentTime, naiveRecentTime, created.run.id);
  // Stale awaiting_input run past 24 hours fails closed and transitions to expired (also testing SQLite naive format)
  const staleNaiveTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  db.prepare("UPDATE agent_runs SET updated_at=?, created_at=? WHERE id=?").run(staleNaiveTime, staleNaiveTime, created.run.id);

  await assert.rejects(runtime.resumeSupervisorRun(userId, created.run.id, { input: "过期提交" }), /待补充信息已过期/);
  const row = db.prepare("SELECT status, error_code, error_message FROM agent_runs WHERE id=?").get(created.run.id) as { status: string; error_code: string; error_message: string };
  assert.equal(row.status, "expired");
  assert.equal(row.error_code, "AGENT_INPUT_EXPIRED");
});

test("allergy consultation proceeds but actual unsafe candidates are blocked", async () => {
  db.prepare("UPDATE user_health_profiles SET allergies_json = ? WHERE user_id = ?").run(JSON.stringify([{ name: "花生", severity: "severe" }]), userId);
  for (const prompt of ["花生过敏可以用什么替代", "不要加入花生"]) {
    answers = [{ goal: "咨询", specialists: [], reply: "会遵守你的限制，请核对替代食品的配料和交叉污染信息。" }];
    const response = await runtime.startSupervisorRun(userId, { modality: "text", prompt }, 10000);
    assert.equal(response.run.status, "completed");
    assert.match(response.run.reply!, /会遵守/);
  }
  answers = [{ goal: "早餐", specialists: [], reply: "建议花生酱面包", candidates: [{ name: "面包", ingredients: ["花生酱", "不要加入花生只是无关说明"] }] }];
  const blocked = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "安排早餐" }, 10000);
  assert.equal(blocked.run.status, "completed");
  assert.match(blocked.run.reply!, /不会生成、保存或采购/);
  assert.deepEqual(blocked.run.artifacts, []);
});

test("total budget prevents downstream model calls", async () => {
  const settings = (await import("../src/modules/aiRuntime/runtime.js")).aiRuntimeService();
  const policy = runtimePolicySchema.parse({ maxModelCalls: 1 });
  await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) }]);
  calls = [];
  answers = [{ goal: "复杂规划", specialists: ["NutritionPlanningAgent"] }];
  try {
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "复杂多餐规划" }, 10000);
    assert.equal(result.run.status, "failed");
    assert.equal(calls.length, 1);
  } finally { await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: "" }]); }
});

test("transient retries share the call budget and permission errors do not retry", async () => {
  const settings = (await import("../src/modules/aiRuntime/runtime.js")).aiRuntimeService();
  const policy = runtimePolicySchema.parse({ main: { retries: 1 }, maxModelCalls: 2 });
  await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: JSON.stringify(policy) }]);
  try {
    calls = [];
    answers = [{ httpStatus: 429 }, { goal: "问答", specialists: [], reply: "你好" }];
    const retried = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好" }, 10000);
    assert.equal(retried.run.status, "completed", JSON.stringify(retried.run.error));
    assert.equal(calls.length, 2);
    calls = [];
    answers = [{ httpStatus: 401 }];
    const denied = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "你好" }, 10000);
    assert.equal(denied.run.status, "failed");
    assert.equal(calls.length, 1);
  } finally { await settings.saveSettings([{ key: "AI_RUNTIME_POLICY", value: "" }]); }
});

test("business proposals wait for approval and edits execute once", async () => {
  calls = [];
  answers = [{ goal: "记录喝水", specialists: ["OperationsAgent"] }, { actions: [{ actionType: "record_health_log", summary: "喝水", payload: { waterMl: 300 } }] }];
  const created = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "记录喝水300毫升" }, 10000);
  assert.equal(created.run.status, "awaiting_approval", JSON.stringify({ error: created.run.error, systems: calls.map((call) => call.messages.map((message) => message.content).slice(0, 1)) }));
  const action = created.run.pendingApproval!.actions[0];
  answers = [{ reply: "已记录饮水500毫升。" }];
  const completed = await runtime.resumeSupervisorRun(userId, created.run.id, { decision: "edit", actions: [{ ...action, payload: { ...action.payload, waterMl: 500 } }] }, 10000);
  assert.equal(completed.status, "completed", JSON.stringify(db.prepare("SELECT error_message FROM agent_runs WHERE id = ?").get(completed.id)));
  await assert.rejects(runtime.resumeSupervisorRun(userId, created.run.id, { decision: "approve" }), /当前不等待/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM agent_actions WHERE run_id=? AND status='executed'").get(created.run.id) as { count: number }).count, 1);
});

test("history is bounded and retains latest references", () => {
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content: "前置方案 plan-archive-999 详细描述超长文本内容".repeat(500) }, { role: "assistant", content: "方案 plan-new" }, { role: "user", content: "第二份不要辣" }] }, 120);
  assert.match(result, /plan-new/);
  assert.match(result, /第二份不要辣/);
  assert.match(result, /plan-archive-999/);
  assert.ok(result.length < 500);
});

test("history preserves a plan reference appearing only before the truncated tail", () => {
  const result = conversationContext({
    modality: "text",
    messages: [{ role: "user", content: "plan-old-123 " + "x".repeat(300) }],
  }, 80);
  const messages = JSON.parse(result.split("\n")[1]) as Array<{ content: string }>;
  assert.ok(messages.reduce((sum, message) => sum + message.content.length, 0) <= 80);
  assert.match(result, /\bplan-old-123\b/);
});

function parseConversationMessages(result: string): Array<{ role: string; content: string }> {
  if (!result) return [];
  const lines = result.split("\n");
  return JSON.parse(lines[1]);
}

function extractCompletePlanIds(text: string): string[] {
  return [...text.matchAll(/\bplan-[a-z0-9_-]+\b/gi)].map((m) => m[0]);
}

test("history boundary: retains complete plan-only and tail ending within budget", () => {
  const content = "plan-only " + ".".repeat(100) + " END";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 40);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 40);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-only"));
  assert.match(result, /END/);
});

test("history boundary: retains all three distinct complete IDs when another is already in tail", () => {
  const content = "plan-a plan-b plan-c " + ".".repeat(100) + " plan-c END";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 50);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 50);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-a"));
  assert.ok(ids.includes("plan-b"));
  assert.ok(ids.includes("plan-c"));
});

test("history boundary: retains both distinct IDs without confusing plan-a with substring of plan-abc", () => {
  const content = "plan-a " + ".".repeat(100) + " plan-abc END";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 40);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 40);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-a"));
  assert.ok(ids.includes("plan-abc"));
});

test("history boundary: deduplicates repeated copies of omitted plan ID in prefix", () => {
  const content = "plan-dup plan-dup plan-dup " + ".".repeat(100) + " END";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 40);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 40);
  assert.match(result, /\[引用:plan-dup\]/);
  assert.doesNotMatch(result, /\[引用:[^\]]*plan-dup,plan-dup/);
  const ids = extractCompletePlanIds(result);
  assert.equal(ids.filter((id) => id === "plan-dup").length, 1);
});

test("history boundary: retains complete plan ID overlapping truncation boundary", () => {
  const content = ".".repeat(20) + " plan-alpha-999 " + ".".repeat(30);
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 40);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 40);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-alpha-999"));
});

test("history boundary: obeys tiny budgets and exact-prefix-fit boundary without slice zero overflow", () => {
  const content = "plan-only " + ".".repeat(100) + " END";
  for (const budget of [0, 1, 8, 9, 14, 15, 16]) {
    const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, budget);
    if (budget === 0) {
      assert.equal(result, "");
      continue;
    }
    const messages = parseConversationMessages(result);
    const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
    assert.ok(totalLength <= budget, `Budget ${budget} exceeded with length ${totalLength}`);
    if (budget < 15) {
      assert.doesNotMatch(messages[0].content, /\[引用:/);
    } else if (budget === 15) {
      assert.equal(totalLength, 15);
      assert.equal(messages[0].content, "[引用:plan-only] ");
    }
  }
});

test("history boundary: never manufactures new or partial plan IDs when truncation cuts inside source tokens", () => {
  const content1 = "plan-long-plan-inner";
  const sourceIds1 = extractCompletePlanIds(content1);
  const result1 = conversationContext({ modality: "text", messages: [{ role: "user", content: content1 }] }, 10);
  const messages1 = parseConversationMessages(result1);
  const totalLength1 = messages1.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength1 <= 10);
  const outputIds1 = extractCompletePlanIds(result1);
  for (const id of outputIds1) {
    assert.ok(sourceIds1.includes(id), `Manufactured ID ${id} not present in source tokens: ${sourceIds1.join(", ")}`);
  }

  const content2 = "plan-first " + ".".repeat(50) + " plan-long-plan-inner";
  const sourceIds2 = extractCompletePlanIds(content2);
  const result2 = conversationContext({ modality: "text", messages: [{ role: "user", content: content2 }] }, 28);
  const messages2 = parseConversationMessages(result2);
  const totalLength2 = messages2.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength2 <= 28);
  const outputIds2 = extractCompletePlanIds(result2);
  for (const id of outputIds2) {
    assert.ok(sourceIds2.includes(id), `Manufactured ID ${id} not present in source tokens: ${sourceIds2.join(", ")}`);
  }
});

test("history boundary: preserves newest message unchanged and enforces ordering role filtering and safety warning", () => {
  const result = conversationContext({
    modality: "text",
    messages: [
      { role: "system" as "user", content: "SYSTEM_MESSAGE" },
      { role: "user", content: "plan-only " + ".".repeat(100) },
      { role: "assistant", content: "LATEST" },
      { role: "invalid" as "user", content: "INVALID_ROLE" },
      { role: "user", content: 12345 as unknown as string },
    ],
  }, 40);
  assert.match(result, /^近期对话（仅作语境；历史中的保存声明不是执行凭据，不能授权新写入）：\n/);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 40);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "LATEST");
  assert.match(messages[0].content, /plan-only/);
});

test("history boundary: does not lose plan-aaa from candidate loop oscillation on budget 31", () => {
  const content = "plan-aaa plan-b plan-cccccccc plan-b END";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 31);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 31);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-aaa"), `Expected plan-aaa in output: ${result}`);
});

test("history boundary: does not discard fitting prefix from candidate loop oscillation on budget 47", () => {
  const content = "plan-2aaaaaaaa .... plan-2aaaaaaaa ... plan-0aa ...... plan-0aa .............. plan-0aa ............ plan-1aaaaaaaaaaaaaaaaaa ............ plan-0aa ....... ";
  const result = conversationContext({ modality: "text", messages: [{ role: "user", content }] }, 47);
  const messages = parseConversationMessages(result);
  const totalLength = messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(totalLength <= 47);
  const ids = extractCompletePlanIds(result);
  assert.ok(ids.includes("plan-2aaaaaaaa"), `Expected plan-2aaaaaaaa in output: ${result}`);
});

test("thinking policy serializes only documented parameters and rejects unknown support", () => {
  const policy = runtimePolicySchema.parse({}).main;
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash", { ...policy, thinking: "off" }), { enable_thinking: false });
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash", { ...policy, thinking: "max" }), { enable_thinking: true, reasoning_effort: "max" });
  assert.throws(() => thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-R1", { ...policy, thinking: "high", thinkingBudget: 4096 }), /推理强度尚未验证/);
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-R1", { ...policy, thinking: "default", thinkingBudget: 4096 }), { enable_thinking: true, thinking_budget: 4096 });
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V3", { ...policy, thinking: "default", thinkingBudget: 2048 }), { enable_thinking: true, thinking_budget: 2048 });
  assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-R1", { ...policy, thinking: "off", thinkingBudget: 4096 }), { enable_thinking: false });
  assert.throws(() => thinkingParameters("https://unknown.test/v1", "unknown", { ...policy, thinking: "off" }), /尚未验证/);
  assert.throws(() => thinkingParameters("https://api.siliconflow.cn/v1", "unsupported-model", { ...policy, thinking: "high" }), /尚未验证/);
  assert.throws(() => thinkingParameters("https://api.siliconflow.cn/v1", "unsupported-model", { ...policy, thinkingBudget: 2048 }), /尚未验证/);
  assert.deepEqual(thinkingParameters("https://unknown.test/v1", "unknown", policy), {});

  // Transient error classification
  assert.equal(isTransientModelError({ status: 400 }), false);
  assert.equal(isTransientModelError({ status: 401 }), false);
  assert.equal(isTransientModelError({ status: 403 }), false);
  assert.equal(isTransientModelError({ status: 404 }), false);
  assert.equal(isTransientModelError({ status: 422 }), false);
  assert.equal(isTransientModelError({ status: 429 }), true);
  assert.equal(isTransientModelError({ status: 500 }), true);
  assert.equal(isTransientModelError({ status: 502 }), true);
  assert.equal(isTransientModelError({ status: 503 }), true);
  assert.equal(isTransientModelError(new Error("fetch failed")), true);
  assert.equal(isTransientModelError(new Error("ECONNRESET")), true);
  assert.equal(isTransientModelError(new Error("ETIMEDOUT")), true);
  assert.equal(isTransientModelError(new Error("socket hang up")), true);
  assert.equal(isTransientModelError(new Error("模型调用预算已用尽")), false);
  assert.equal(isTransientModelError(new Error("工具调用预算已用尽")), false);
  assert.equal(isTransientModelError(new Error("AGENT_RUN_CANCELLED")), false);
  assert.equal(isTransientModelError(null), false);
});

test("legacy and distill models reject high and max reasoning effort while default yields empty parameters", () => {
  const policy = runtimePolicySchema.parse({}).main;
  const legacyAndDistillModels = [
    "deepseek-ai/DeepSeek-R1",
    "deepseek-ai/DeepSeek-V3",
    "Pro/deepseek-ai/DeepSeek-R1",
    "Pro/deepseek-ai/DeepSeek-V3",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
  ];

  for (const model of legacyAndDistillModels) {
    assert.deepEqual(thinkingParameters("https://api.siliconflow.cn/v1", model, { ...policy, thinking: "default" }), {});
    for (const effort of ["high", "max"] as const) {
      assert.throws(
        () => thinkingParameters("https://api.siliconflow.cn/v1", model, { ...policy, thinking: effort }),
        /推理强度尚未验证/,
      );
      assert.throws(
        () => thinkingParameters("https://api.siliconflow.cn/v1", model, { ...policy, thinking: effort, thinkingBudget: 2048 }),
        /推理强度尚未验证/,
      );
    }
  }
});


test("candidate safety includes aliases, compound ingredients and edited shopping payloads", async () => {
  const { findCandidateSafetyConflict, validateAgentActions, AgentSafetyConflictError } = await import("../src/services/agent/policy.js");
  const { buildUserContext } = await import("../src/services/contextBuilder.js");
  const context = await buildUserContext(userId);
  for (const ingredient of ["peanut butter", "落花生", "花生醬", "混合酱（配料不详）", "秘制调料", "特调酱（未知成分）"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [ingredient] }, context), ingredient);
  }
  assert.equal(findCandidateSafetyConflict({ ingredients: ["番茄", "土豆"] }, context), null);
  assert.throws(() => validateAgentActions([{ actionType: "update_shopping_item", summary: "替换食材", payload: { itemId: "shopping-1", name: "peanut butter", note: "不要花生" } }], context), AgentSafetyConflictError);

  // Test expanded allergen classes: seafood, egg, soy, wheat
  const seafoodContext = { healthProfile: { allergies: [{ name: "海鲜", severity: "severe" }] } } as Parameters<typeof findCandidateSafetyConflict>[1];
  for (const seafood of ["三文鱼", "金枪鱼", "大明虾", "鲍鱼", "梭子蟹", "鱿鱼", "seafood salad"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [seafood] }, seafoodContext), seafood);
  }
  assert.throws(() => validateAgentActions([{ actionType: "add_shopping_items", summary: "采购海鲜", payload: { items: [{ name: "金枪鱼罐头", amount: "1罐" }] } }], seafoodContext), AgentSafetyConflictError);

  const eggContext = { healthProfile: { allergies: [{ name: "鸡蛋", severity: "severe" }] } } as Parameters<typeof findCandidateSafetyConflict>[1];
  for (const egg of ["蛋黄", "蛋清", "全蛋液", "荷包蛋", "egg whites", "boiled eggs", "egg"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [egg] }, eggContext), egg);
  }
  // Verify food-token aware matching: eggplant / egg plant does not trigger egg allergy conflict
  assert.equal(findCandidateSafetyConflict({ ingredients: ["eggplant"] }, eggContext), null);
  assert.equal(findCandidateSafetyConflict({ ingredients: ["egg plant"] }, eggContext), null);
  assert.equal(findCandidateSafetyConflict({ ingredients: ["grilled eggplant with garlic"] }, eggContext), null);
  assert.equal(findCandidateSafetyConflict({ ingredients: ["crabapple jelly"] }, seafoodContext), null);

  assert.throws(() => validateAgentActions([{ actionType: "create_meal_plan", summary: "创建餐单", payload: { title: "蛋料理", startDate: "2026-11-01", endDate: "2026-11-07", constraints: {}, items: [{ date: "2026-11-01", mealType: "breakfast", title: "荷包蛋", ingredients: ["全蛋液"], steps: ["煎熟"] }] } }], eggContext), AgentSafetyConflictError);

  const soyContext = { healthProfile: { allergies: [{ name: "大豆", severity: "high" }] } } as Parameters<typeof findCandidateSafetyConflict>[1];
  for (const soy of ["豆浆", "嫩豆腐", "腐竹", "tofu"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [soy] }, soyContext), soy);
  }

  const wheatContext = { healthProfile: { allergies: [{ name: "小麦", severity: "severe" }] } } as Parameters<typeof findCandidateSafetyConflict>[1];
  for (const wheat of ["面粉", "手擀面条", "面筋", "wheat flour", "gluten free note but contains 面粉"]) {
    assert.ok(findCandidateSafetyConflict({ ingredients: [wheat] }, wheatContext), wheat);
  }
});


test("opt-in final reply stream persists only decoded answer fragments", async () => {
  process.env.AI_REPLY_STREAM_ENABLED = "true";
  calls = [];
  answers = [{ goal: "复杂规划", specialists: ["NutritionPlanningAgent"] }, { summary: "可按两人准备番茄炒蛋。", artifacts: [] }, { reply: "两人份方案已经准备好。可以按需调整份量。" }];
  try {
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt: "请规划复杂多餐，不保存业务记录" }, 10000);
    assert.equal(result.run.status, "completed", JSON.stringify(result.run.error));
    const events = db.prepare("SELECT event_type, payload_json FROM agent_run_events WHERE run_id = ? ORDER BY sequence").all(result.run.id) as Array<{ event_type: string; payload_json: string }>;
    const deltas = events.filter((event) => event.event_type === "reply_delta").map((event) => JSON.parse(event.payload_json).delta).join("");
    assert.equal(deltas, "两人份方案已经准备好。可以按需调整份量。");
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1)?.stream, true);
  } finally { delete process.env.AI_REPLY_STREAM_ENABLED; }
});


test("five turns deliver the latest constraints and plan reference without persisting preferences", async () => {
  const before = db.prepare("SELECT allergies_json FROM user_health_profiles WHERE user_id=?").get(userId);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "assistant", content: "方案 plan-123：第一份番茄面，第二份辣椒炒蛋" }];
  const prompts = ["换一个", "第二份不要辣", "保留第一份", "改成两人份", "仍只给建议，不保存"];
  for (const prompt of prompts) {
    messages.push({ role: "user", content: prompt });
    answers = [{ goal: "局部修改", specialists: [], reply: "plan-123：第一份番茄面保持，第二份番茄炒蛋，两人份，不放辣椒。" }];
    const result = await runtime.startSupervisorRun(userId, { modality: "text", prompt, messages }, 10000);
    assert.equal(result.run.status, "completed");
    const delivered = JSON.stringify(calls.at(-1)?.messages);
    assert.match(delivered, /plan-123/);
    assert.ok(delivered.includes(prompt));
    messages.push({ role: "assistant", content: result.run.reply! });
  }
  assert.deepEqual(db.prepare("SELECT allergies_json FROM user_health_profiles WHERE user_id=?").get(userId), before);
});


test("HTTP Agent keeps model and credential version through a tool round trip while publishing", async () => {
  const settings = (await import('../src/modules/aiRuntime/runtime.js')).aiRuntimeService();
  const { legacyResourceDocument } = await import('../src/modules/aiRuntime/resources.js');
  const legacy = legacyResourceDocument();
  const make = (revision: number, key: string, model: string) => ({ ...legacy, revision,
    resources: [...legacy.resources, { id: 'versioned', name: 'Synthetic provider', kind: 'connection', protocol: 'openai-compatible',
      baseUrl: process.env.AI_BASE_URL!, models: [{ id: model, capabilities: ['chat'] }], credential: { action: 'replace', value: key } }],
    defaults: { ...legacy.defaults, chat: { resourceId: 'versioned', model } } });
  const publish = async (key: string, model: string) => {
    const current = await settings.resourceConfiguration();
    const draft = await settings.saveResourceConfiguration(make(current.revision, key, model));
    await settings.testDraft(draft.revision); await settings.publishDraft(draft.revision);
  };
  await publish('fixture-before-publish', 'fixture-before');
  calls = []; providerKeys = [];
  answers = [{ toolCall: { name: 'get_user_nutrition_context', args: {} } }, { goal: '只读咨询', specialists: [], reply: '旧请求完成。', candidates: [] }];
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  providerGate = async () => { entered(); await gate; };
  let runId: string | undefined;
  try {
  const http = await fetch(`http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/v1/ai/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ prompt: '读取我的营养上下文，不保存、不执行操作。' }), signal: AbortSignal.timeout(10_000),
  });
  const response = await http.json() as { run: { id: string } };
  runId = response.run?.id; assert.equal(http.status, 202); assert.ok(runId); await waitForGate(ready);
  await publish('fixture-after-publish', 'fixture-after');
  } finally {
    providerGate = undefined; release();
    if (runId) await runtime.waitForSupervisorRunCompletion(runId).catch(() => undefined);
  }
  const completed = await runtime.waitForSupervisorRunCompletion(runId!);
  assert.equal(completed.status, 'completed', JSON.stringify(completed.error));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.model), ['fixture-before', 'fixture-before']);
  assert.deepEqual(providerKeys, ['Bearer fixture-before-publish', 'Bearer fixture-before-publish']);
  answers = [{ goal: '新请求', specialists: [], reply: '新请求完成。', candidates: [] }];
  const next = await runtime.startSupervisorRun(userId, { modality: 'text', prompt: '你好，只给建议。' }, 10000);
  assert.equal(next.run.status, 'completed');
  assert.equal(calls.at(-1)?.model, 'fixture-after'); assert.equal(providerKeys.at(-1), 'Bearer fixture-after-publish');
  const serializedEvents = JSON.stringify(db.prepare('SELECT payload_json FROM agent_run_events WHERE run_id IN (?,?)').all(runId!, next.run.id));
  assert.equal(serializedEvents.includes('fixture-before-publish'), false); assert.equal(serializedEvents.includes('fixture-after-publish'), false);
});


test('automatic recovery never replaces a lost accepted snapshot; explicit retry starts a new segment', async () => {
  const settings = (await import('../src/modules/aiRuntime/runtime.js')).aiRuntimeService();
  const { legacyResourceDocument } = await import('../src/modules/aiRuntime/resources.js');
  const legacy = legacyResourceDocument();
  const current = await settings.resourceConfiguration();
  const draft = await settings.saveResourceConfiguration({ ...legacy, revision: current.revision,
    resources: [...legacy.resources, { id: 'recovery', name: 'Recovery fixture', kind: 'connection', protocol: 'openai-compatible', baseUrl: process.env.AI_BASE_URL!,
      models: [{ id: 'recovery-model', capabilities: ['chat'] }], credential: { action: 'replace', value: 'recovery-synthetic' } }],
    defaults: { ...legacy.defaults, chat: { resourceId: 'recovery', model: 'recovery-model' } } });
  await settings.testDraft(draft.revision); await settings.publishDraft(draft.revision);
  const { createAgentRun } = await import('../src/services/agent/repository.js');
  const lost = await createAgentRun(userId, { modality: 'text', prompt: '只读咨询，不执行操作。', metadata: { runtimeVersion: 2, configurationSnapshotRequired: true, mainAssistantEnabled: true } });
  db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(lost.id);
  calls = []; providerKeys = [];
  await runtime.recoverAgentRuntime();
  const failed = await runtime.waitForSupervisorRunCompletion(lost.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error?.code, 'AI_CONFIGURATION_SNAPSHOT_LOST');
  assert.equal(calls.length, 0);
  answers = [{ goal: '明确重试', specialists: [], reply: '新的执行完成。', candidates: [] }];
  const retried = await runtime.retrySupervisorRun(userId, lost.id, 10000);
  assert.equal(retried.status, 'completed', JSON.stringify(retried.error));
  assert.equal(calls.at(-1)?.model, 'recovery-model'); assert.equal(providerKeys.at(-1), 'Bearer recovery-synthetic');
});
