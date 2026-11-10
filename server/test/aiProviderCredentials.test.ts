import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { configureAIRuntimeService } from "../src/modules/aiRuntime/runtime.js";
import { legacyResourceDocument, RESOURCE_SETTING_KEY } from "../src/modules/aiRuntime/resources.js";
import { analyzeImage, chatCompletion, testAIConnection } from "../src/services/aiService.js";

function configure(visionKey: string) {
  const document = legacyResourceDocument();
  document.resources.push({ id: "vision-isolated", name: "Vision", kind: "connection", protocol: "openai-compatible",
    baseUrl: "https://vision-isolated.invalid/v1", apiKey: visionKey, models: [{ id: "vision-model", capabilities: ["vision"] }] });
  document.services.vision = { resourceId: "vision-isolated", model: "vision-model" };
  const values = { AI_API_KEY: "chat-fixture-secret", [RESOURCE_SETTING_KEY]: JSON.stringify(document) };
  configureAIRuntimeService(new AIRuntimeService({ settings: async () => values, saveSettings: async () => {},
    compareAndSaveSetting: async () => false, recordUsage: async () => {} }, {}));
}

test("cleared vision and explicit chat credentials never borrow another service's secret", async () => {
  configure("");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: "fixture" } }] })); };
  try {
    await assert.rejects(analyzeImage("fixture-image", "fixture"), /视觉模型尚未配置/);
    await chatCompletion([{ role: "user", content: "fixture" }], { apiKey: "", baseUrl: "https://isolated.invalid/v1" });
    assert.equal(calls, 0, "An explicitly cleared connection must not send the chat credential to another endpoint");
  } finally { globalThis.fetch = originalFetch; }
});

test("undefined vision overrides preserve the complete resolved vision connection", async () => {
  configure("vision-fixture-secret");
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null; model: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), key: new Headers(init?.headers).get("Authorization"), model: JSON.parse(String(init?.body)).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fixture" } }] }));
  };
  try {
    await analyzeImage("fixture-image", "fixture", { apiKey: undefined, baseUrl: undefined, model: undefined });
    assert.deepEqual(calls, [{ url: "https://vision-isolated.invalid/v1/chat/completions", key: "Bearer vision-fixture-secret", model: "vision-model" }]);
  } finally { globalThis.fetch = originalFetch; }
});


test("independent chat binding does not mix its model with the legacy connection test credentials", async () => {
  const document = legacyResourceDocument();
  document.resources.push({ id: "chat-isolated", name: "Chat", kind: "connection", protocol: "openai-compatible",
    baseUrl: "https://chat-isolated.invalid/v1", apiKey: "isolated-fixture-secret", models: [{ id: "isolated-model", capabilities: ["chat"] }] });
  document.services.chat = { resourceId: "chat-isolated", model: "isolated-model" };
  const values = { AI_API_KEY: "legacy-fixture-secret", AI_BASE_URL: "https://legacy.invalid/v1", AI_MODEL: "legacy-model",
    [RESOURCE_SETTING_KEY]: JSON.stringify(document) };
  const service = new AIRuntimeService({ settings: async () => values, saveSettings: async () => {},
    compareAndSaveSetting: async () => false, recordUsage: async () => {} }, {});
  configureAIRuntimeService(service);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null; model: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), key: new Headers(init?.headers).get("Authorization"), model: JSON.parse(String(init?.body)).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fixture" } }] }));
  };
  try {
    assert.equal((await service.config()).chat.model, "isolated-model");
    await testAIConnection();
    assert.deepEqual(calls, [{ url: "https://legacy.invalid/v1/chat/completions", key: "Bearer legacy-fixture-secret", model: "legacy-model" }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("saved service tests select its complete binding and refuse cleared credentials", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; key: string | null; model: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), key: new Headers(init?.headers).get("Authorization"), model: JSON.parse(String(init?.body)).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "fixture" } }] }));
  };
  try {
    configure("vision-fixture-secret");
    await testAIConnection({ service: "vision", baseUrl: "https://wrong.invalid", apiKey: "wrong-key", model: "wrong-model" });
    assert.deepEqual(calls, [{ url: "https://vision-isolated.invalid/v1/chat/completions", key: "Bearer vision-fixture-secret", model: "vision-model" }]);
    configure("");
    await assert.rejects(testAIConnection({ service: "vision" }), /API Key/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
