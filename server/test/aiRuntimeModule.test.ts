import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AIRuntimeRepository } from "../src/modules/aiRuntime/repository.js";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { SqliteAIRuntimeRepository } from "../src/modules/aiRuntime/sqliteRepository.js";
import { legacyResourceDocument, RESOURCE_SETTING_KEY, type ResourceUpdate } from "../src/modules/aiRuntime/resources.js";
import type { AIUsageWrite } from "../src/modules/aiRuntime/types.js";

async function savePublished(service: AIRuntimeService, input: unknown) {
  const saved = await service.saveResourceConfiguration(input);
  await service.testDraft(saved.revision);
  await service.publishDraft(saved.revision);
  return saved;
}
function repository(overrides: Partial<AIRuntimeRepository> = {}): AIRuntimeRepository {
  return {
    settings: async () => ({}),
    saveSettings: async () => undefined,
    compareAndSaveSetting: async () => true,
    recordUsage: async () => undefined,
    ...overrides,
  };
}

describe("AI runtime module", () => {
  test("resolves scoped providers, legacy fallbacks, and agent model overrides", async () => {
    const values = {
      AI_API_KEY: "global-key", AI_BASE_URL: "https://global.test/v1/", AI_MODEL: "legacy-chat",
      AI_CHAT_API_KEY: "chat-key", AI_CHAT_BASE_URL: "https://chat.test/v1/", AI_CHAT_MODEL: "chat-model",
      AI_VISION_MODEL: "vision-db", AI_ASR_API_KEY: "asr-key", AI_SUPERVISOR_MODEL: "supervisor-db",
    };
    const service = new AIRuntimeService(repository({ settings: async (keys) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => keys.includes(key))) }), {
      AI_VISION_API_KEY: "ignored", AI_ASR_MODEL: "asr-env",
    });
    const config = await service.config();
    assert.deepEqual(config.chat, { apiKey: "chat-key", baseUrl: "https://chat.test/v1", model: "chat-model" });
    assert.deepEqual(config.vision, { apiKey: "global-key", baseUrl: "https://global.test/v1", model: "vision-db" });
    assert.deepEqual(config.asr, { apiKey: "asr-key", baseUrl: "https://global.test/v1", model: "asr-env" });
    assert.equal((await service.agentConfig("SUPERVISOR")).model, "supervisor-db");
    assert.equal((await service.agentConfig("RECIPE")).model, "chat-model");
  });

  test("normalizes costs and redacts oversized failure details before persistence", async () => {
    let stored: AIUsageWrite | undefined;
    const service = new AIRuntimeService(repository({ recordUsage: async (input) => { stored = input; } }), {
      AI_INPUT_COST_PER_MILLION_USD: "2", AI_OUTPUT_COST_PER_MILLION_USD: "4",
    });
    await service.recordUsage({ userId: 7, endpoint: "chat", model: "test", promptTokens: 1_000,
      completionTokens: 500, latencyMs: -3, success: false, failureReason: "x".repeat(700) });
    assert.equal(stored?.totalTokens, 1_500);
    assert.equal(stored?.estimatedCostUsd, 0.004);
    assert.equal(stored?.failureReason?.length, 500);
    assert.equal(stored?.success, false);
  });

  test("keeps usage persistence best-effort", async () => {
    const service = new AIRuntimeService(repository({ recordUsage: async () => { throw new Error("offline"); } }));
    const originalError = console.error;
    console.error = () => undefined;
    try { await assert.doesNotReject(service.recordUsage({ userId: 1, endpoint: "chat", model: "test" })); }
    finally { console.error = originalError; }
  });

  test("SQLite CAS distinguishes missing, empty and stale values and rolls back batch failures", async () => {
    const database = new Database(":memory:");
    database.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
    const adapter = new SqliteAIRuntimeRepository(database);
    try {
      assert.equal(await adapter.compareAndSaveSetting("config", "missing", "wrong"), false);
      assert.equal(await adapter.compareAndSaveSetting("config", null, ""), true);
      assert.equal(await adapter.compareAndSaveSetting("config", null, "wrong"), false);
      assert.equal(await adapter.compareAndSaveSetting("config", "", "first"), true);
      assert.equal(await adapter.compareAndSaveSetting("config", "", "stale"), false);
      assert.deepEqual(await Promise.all([
        adapter.compareAndSaveSetting("config", "first", "winner"),
        adapter.compareAndSaveSetting("config", "first", "loser"),
      ]), [true, false]);
      await adapter.saveSettings([{ key: "role", value: "A" }]);
      assert.equal(await adapter.compareAndSaveSetting("config", "winner", "new", { role: "B" }), false);
      assert.equal(await adapter.compareAndSaveSetting("config", "winner", "winner", { role: "A", absent: null }, [{ key: "role", value: "B" }]), true);
      assert.equal(await adapter.compareAndSaveSetting("config", "winner", "invalid", { role: "A" }), false);
      assert.equal((await adapter.settings(["config", "role"])).role, "B");
      database.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON system_settings WHEN NEW.key = 'reject' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
      await assert.rejects(adapter.saveSettings([{ key: "config", value: "rollback" }, { key: "reject", value: "fixture" }]));
      assert.deepEqual(await adapter.settings(["config", "reject"]), { config: "winner" });
    } finally { database.close(); }
  });

  test("SQLite adapter atomically saves settings and structured usage", async () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE ai_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, model TEXT,
        prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, latency_ms INTEGER, success INTEGER,
        estimated_cost_usd REAL, failure_reason TEXT, run_id TEXT, agent_name TEXT, phase TEXT);
    `);
    const service = new AIRuntimeService(new SqliteAIRuntimeRepository(database));
    await service.saveSettings([{ key: "AI_API_KEY", value: "secret" }, { key: "AI_CHAT_MODEL", value: "model-a" }]);
    assert.deepEqual(await service.settings(["AI_API_KEY", "AI_CHAT_MODEL"]),
      { AI_API_KEY: "secret", AI_CHAT_MODEL: "model-a" });
    await service.saveSettings([{ key: "AI_CHAT_MODEL", value: "model-b" }]);
    assert.equal((await service.config()).chat.model, "model-b");
    await service.recordUsage({ userId: 4, endpoint: "agent:Recipe", model: "model-b", runId: "run-1",
      agentName: "Recipe", phase: "specialist", promptTokens: 12, completionTokens: 8, latencyMs: 25 });
    const usage = database.prepare("SELECT * FROM ai_usage_logs").get() as Record<string, unknown>;
    assert.equal(usage.total_tokens, 20);
    assert.equal(usage.success, 1);
    assert.equal(usage.run_id, "run-1");
    database.close();
  });
});

// Resource/service phase-one contract: no network or paid model calls.
describe("provider resources and business services", () => {
  function memory(initial: Record<string, string> = {}) {
    const values = { ...initial };
    return { values, repository: repository({
      settings: async keys => Object.fromEntries(Object.entries(values).filter(([key]) => keys.includes(key))),
      saveSettings: async entries => { for (const { key, value } of entries) values[key] = value; },
      compareAndSaveSetting: async (key, previous, value, expected = {}, entries = []) => {
        if ((values[key] ?? null) !== previous || Object.entries(expected).some(([name, prior]) => (values[name] ?? null) !== prior)) return false;
        if (value !== null) values[key] = value;
        for (const entry of entries) values[entry.key] = entry.value;
        return true;
      },
    }) };
  }
  function connections(): ResourceUpdate {
    const document = legacyResourceDocument();
    return { ...document, resources: [
      ...document.resources,
      { id: "first", name: "First", kind: "connection", protocol: "openai-compatible", baseUrl: "https://one.test/v1/",
        models: [{ id: "chat-one", capabilities: ["chat"] }], credential: { action: "replace", value: "fixture-first-secret" } },
      { id: "second", name: "Second", kind: "connection", protocol: "openai-compatible", baseUrl: "https://two.test/v1",
        models: [{ id: "vision-two", capabilities: ["vision"] }, { id: "chat-two", capabilities: ["chat"] }],
        credential: { action: "replace", value: "fixture-second-secret" } },
    ], defaults: { ...document.defaults, chat: { resourceId: "first", model: "chat-one" } },
    services: { ...document.services, vision: { resourceId: "second", model: "vision-two" },
      recipe: { resourceId: "second", model: "chat-two" } } };
  }
  test("two independent connections, defaults, service overrides and metadata are resolved without leaking credentials", async () => {
    const store = memory();
    const service = new AIRuntimeService(store.repository, {});
    const result = await savePublished(service, connections());
    assert.equal(JSON.stringify(result).includes("fixture-"), false);
    assert.equal(result.effective.chat.source, "default:chat");
    assert.equal(result.effective.vision.source, "service:vision");
    assert.deepEqual((await service.config()).chat, { apiKey: "fixture-first-secret", baseUrl: "https://one.test/v1", model: "chat-one" });
    assert.equal((await service.config()).vision.apiKey, "fixture-second-secret");
    assert.equal((await service.legacyChatConfig()).baseUrl, "https://api.openai.com/v1");
    assert.equal((await service.legacyChatConfig()).apiKey, "");
    assert.equal((await service.agentConfig("RECIPE")).model, "chat-two");
    assert.equal((await service.agentConfig("SUPERVISOR")).model, "chat-one");
    const update = connections();
    update.revision = 1;
    update.defaults.chat = { resourceId: "second", model: "chat-two" };
    await savePublished(service, update);
    assert.equal((await service.agentConfig("SUPERVISOR")).model, "chat-two");
    assert.equal((await service.agentConfig("RECIPE")).model, "chat-two");
    assert.equal((await service.config()).vision.model, "vision-two");
    await assert.rejects(savePublished(service, update), /版本/);
  });
  test("credentials have explicit keep, replace and clear semantics; clearing never restores environment credentials", async () => {
    const store = memory();
    const service = new AIRuntimeService(store.repository, { AI_API_KEY: "env-fixture" });
    await savePublished(service, connections());
    for (const [revision, credential, expected] of [
      [1, undefined, "fixture-first-secret"], [2, { action: "keep" }, "fixture-first-secret"],
      [3, { action: "replace", value: "replacement-fixture" }, "replacement-fixture"], [4, { action: "clear" }, ""],
    ] as const) {
      const update = connections();
      update.revision = revision;
      const first = update.resources.find(item => item.id === "first")!;
      if (first.kind === "connection") first.credential = credential;
      await savePublished(service, update);
      assert.equal((await service.config()).chat.apiKey, expected);
    }
    const invalid = connections();
    invalid.revision = 5;
    const first = invalid.resources.find(item => item.id === "first")!;
    if (first.kind === "connection") first.credential = { action: "replace", value: "" };
    await assert.rejects(savePublished(service, invalid));
    assert.equal((await service.config()).chat.apiKey, "");
  });
  test("rejects incompatible capabilities, unknown services/protocols, dangling defaults and inherited incompatible role models", async () => {
    const store = memory();
    const service = new AIRuntimeService(store.repository, {});
    for (const mutate of [
      (doc: ResourceUpdate) => { doc.services.vision = { resourceId: "first", model: "chat-one" }; },
      (doc: ResourceUpdate) => { doc.defaults.asr = { resourceId: "absent" }; },
      (doc: ResourceUpdate) => { doc.services.chat = { resourceId: "first" }; },
    ]) {
      const update = connections(); mutate(update);
      await assert.rejects(savePublished(service, update));
      assert.equal(store.values[RESOURCE_SETTING_KEY], undefined);
    }
    await assert.rejects(savePublished(service, { ...connections(), services: { ...connections().services, unsupported_service: { inherit: true } } }));
    const badProtocol = connections();
    await assert.rejects(savePublished(service, { ...badProtocol, resources: [{ ...badProtocol.resources[3], protocol: "search" }] }));
    store.values.AI_SUPERVISOR_MODEL = "unknown-role-model";
    await assert.rejects(savePublished(service, connections()), /角色模型/);
  });
  test("migration preserves field-level legacy overrides, role models, environment changes, policy and unrelated voice settings", async () => {
    const policy = JSON.stringify({ maxModelCalls: 3, maxToolCalls: 2 });
    const store = memory({ AI_API_KEY: "global-fixture", AI_BASE_URL: "https://legacy.test/v1/", AI_MODEL: "global-model",
      AI_CHAT_API_KEY: "chat-fixture", AI_VISION_BASE_URL: "https://vision.test/v1/", AI_ASR_MODEL: "asr-model",
      AI_SUPERVISOR_MODEL: "supervisor-model", AI_NUTRITION_MODEL: "nutrition-model", AI_RECIPE_MODEL: "recipe-model",
      AI_OPERATIONS_MODEL: "operations-model", AI_RUNTIME_POLICY: policy, TTS_PROVIDER: "local-first", AI_SYSTEM_PROMPT: "persona" });
    const environment = { AI_VISION_MODEL: "environment-vision" };
    const service = new AIRuntimeService(store.repository, environment);
    const before = await service.config();
    const roles = await Promise.all((["SUPERVISOR", "NUTRITION", "RECIPE", "OPERATIONS"] as const).map(role => service.agentConfig(role)));
    await service.migrateResources();
    const migrated = store.values[RESOURCE_SETTING_KEY];
    await service.migrateResources();
    assert.equal(store.values[RESOURCE_SETTING_KEY], migrated);
    assert.equal(migrated.includes("fixture"), false);
    const restarted = new AIRuntimeService(store.repository, environment);
    assert.deepEqual(await restarted.config(), before);
    assert.deepEqual(await Promise.all((["SUPERVISOR", "NUTRITION", "RECIPE", "OPERATIONS"] as const).map(role => restarted.agentConfig(role))), roles);
    assert.equal((await restarted.runtimePolicy()).maxModelCalls, 3);
    assert.equal(store.values.AI_RUNTIME_POLICY, policy);
    assert.equal(store.values.TTS_PROVIDER, "local-first");
    assert.equal(store.values.AI_SYSTEM_PROMPT, "persona");
    environment.AI_VISION_MODEL = "new-environment-vision";
    assert.equal((await restarted.config()).vision.model, "new-environment-vision");
    await restarted.saveSettings([{ key: "AI_CHAT_API_KEY", value: "" }, { key: "AI_MODEL", value: "updated-legacy" }]);
    assert.equal((await restarted.config()).chat.apiKey, "global-fixture");
    assert.equal((await restarted.config()).chat.model, "updated-legacy");
  });
  test("failed migrations and saves leave legacy configuration and the last committed document usable", async () => {
    const store = memory({ AI_MODEL: "old-model" });
    const failing = new AIRuntimeService({ ...store.repository, compareAndSaveSetting: async () => { throw new Error("transaction failure"); } }, {});
    await assert.rejects(failing.migrateResources(), /transaction/);
    assert.equal((await failing.config()).chat.model, "old-model");
    assert.equal(store.values[RESOURCE_SETTING_KEY], undefined);
    await savePublished(new AIRuntimeService(store.repository, {}), connections());
    const saved = store.values[RESOURCE_SETTING_KEY];
    const update = connections(); update.revision = 1;
    await assert.rejects(savePublished(failing, update), /transaction/);
    assert.equal(store.values[RESOURCE_SETTING_KEY], saved);
    assert.equal((await failing.config()).chat.model, "chat-one");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import type { Pool } from "pg";

describe("resource storage atomicity", () => {
  test("SQLite migration is idempotent across reopen, rejects stale CAS and rolls back a failing write", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-resources-"));
    const file = join(directory, "settings.sqlite");
    let database = new Database(file);
    try {
      database.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
      let adapter = new SqliteAIRuntimeRepository(database);
      let service = new AIRuntimeService(adapter, { AI_API_KEY: "environment-fixture" });
      await service.saveSettings([{ key: "AI_MODEL", value: "legacy-model" }]);
      const before = await service.config();
      await Promise.all([service.migrateResources(), service.migrateResources()]);
      const raw = (await service.settings())[RESOURCE_SETTING_KEY];
      assert.equal(await adapter.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, "{}"), false);
      assert.equal(await adapter.compareAndSaveSetting(RESOURCE_SETTING_KEY, "stale", "{}"), false);
      database.close(); database = new Database(file);
      adapter = new SqliteAIRuntimeRepository(database);
      service = new AIRuntimeService(adapter, { AI_API_KEY: "environment-fixture" });
      await service.migrateResources();
      assert.equal((await service.settings())[RESOURCE_SETTING_KEY], raw);
      assert.deepEqual(await service.config(), before);
      database.exec(`CREATE TRIGGER fail_resource_update BEFORE UPDATE ON system_settings WHEN NEW.key = '${RESOURCE_SETTING_KEY}' BEGIN SELECT RAISE(ABORT, 'fixture transaction failure'); END`);
      await assert.rejects(savePublished(service, legacyResourceDocument()), /transaction failure/);
      assert.equal((await service.settings())[RESOURCE_SETTING_KEY], raw);
      assert.deepEqual(await service.config(), before);
    } finally { database.close(); rmSync(directory, { recursive: true }); }
  });

  test("PostgreSQL adapter transaction contract uses conflict-safe inserts, guarded updates and rollback/release on error", async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    let released = 0;
    let failWrite = false;
    let rowCount = 1;
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values });
        if (failWrite && sql.startsWith("UPDATE")) throw new Error("fixture postgres failure");
        return { rowCount };
      },
      release: () => { released++; },
    };
    const adapter = new PostgresAIRuntimeRepository({ connect: async () => client } as unknown as Pool);
    assert.equal(await adapter.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, "first"), true);
    assert.match(statements[2].sql, /ON CONFLICT\(key\) DO NOTHING/);
    assert.deepEqual(statements.map(item => item.sql.split(" ")[0]), ["BEGIN", "SELECT", "INSERT", "COMMIT"]);
    statements.length = 0; rowCount = 0;
    assert.equal(await adapter.compareAndSaveSetting(RESOURCE_SETTING_KEY, "stale", "second"), false);
    assert.match(statements[2].sql, /WHERE key = \$2 AND value = \$3/);
    assert.deepEqual(statements[2].values, ["second", RESOURCE_SETTING_KEY, "stale"]);
    statements.length = 0; failWrite = true;
    await assert.rejects(adapter.compareAndSaveSetting(RESOURCE_SETTING_KEY, "first", "second"), /postgres failure/);
    assert.deepEqual(statements.map(item => item.sql.split(" ")[0]), ["BEGIN", "SELECT", "UPDATE", "ROLLBACK"]);
    assert.equal(released, 3);
  });
});

test("legacy admin GET reports independently bound role models from the same settings snapshot", async () => {
  const document = legacyResourceDocument();
  document.resources.push({ id: "independent", name: "Independent", kind: "connection", protocol: "openai-compatible",
    baseUrl: "https://independent.test/v1", apiKey: "fixture-private-key", models: [{ id: "independent-model", capabilities: ["chat"] }] });
  document.services.supervisor = { resourceId: "independent", model: "independent-model" };
  document.services.nutrition = { resourceId: "independent", model: "independent-model" };
  const values = { [RESOURCE_SETTING_KEY]: JSON.stringify(document), AI_SUPERVISOR_MODEL: "legacy-role", AI_MODEL: "legacy-model" };
  const service = new AIRuntimeService(repository({ settings: async () => values }), {});
  const { configureAIRuntimeService } = await import("../src/modules/aiRuntime/runtime.js");
  const { createAdminAIConfigRouter } = await import("../src/routes/admin/ai-config.js");
  configureAIRuntimeService(service);
  const router = createAdminAIConfigRouter();
  const layer = router.stack.find(layer => layer.route?.path === "/ai-config");
  let response: Record<string, any> = {};
  assert.ok(layer?.route);
  await layer.route.stack[0].handle({} as import("express").Request,
    { json: (body: Record<string, any>) => { response = body; } } as import("express").Response, () => {});
  assert.equal(response.agents.supervisorModel, "independent-model");
  assert.equal(response.agents.nutritionModel, "independent-model");
  assert.equal(response.agents.recipeModel, "legacy-model");
  assert.equal(response.effectiveModels[0].baseUrl, "https://independent.test/v1");
  assert.equal(JSON.stringify(response).includes("fixture-private-key"), false);
});
