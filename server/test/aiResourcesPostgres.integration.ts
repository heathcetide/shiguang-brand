import assert from "node:assert/strict";
import { Pool } from "pg";
import { AIRuntimeService } from "../src/modules/aiRuntime/service.js";
import { PostgresAIRuntimeRepository } from "../src/modules/aiRuntime/postgresRepository.js";
import { legacyResourceDocument, RESOURCE_SETTING_KEY, type ResourceUpdate } from "../src/modules/aiRuntime/resources.js";

// Deliberately never use DATABASE_URL: this check is destructive only inside a fresh, isolated test cluster.
const socket = process.env.AI_RESOURCE_TEST_PG_SOCKET;
assert.ok(socket?.startsWith("/tmp/ddd-review-pg."), "Use a dedicated /tmp/ddd-review-pg.* cluster");
const pool = new Pool({ host: socket, port: 55439, user: process.env.USER, database: "ddd_ai_resources_review" });

async function waitForGate(ready: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Mock provider gate timed out')), 10_000); })]); }
  finally { clearTimeout(timer); }
}

async function verifyDraftLifecycle() {
  await pool.query('CREATE SCHEMA draft_lifecycle');
  const isolated = new Pool({ host: socket, port: 55439, user: process.env.USER, database: "ddd_ai_resources_review", options: '-c search_path=draft_lifecycle' });
  try {
    await isolated.query('CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ)');
    const adapter = new PostgresAIRuntimeRepository(isolated);
    const runtime = new AIRuntimeService(adapter, { AI_API_KEY: 'pg-old-synthetic', AI_MODEL: 'old-model' });
    const input = (revision: number, secret: string): ResourceUpdate => {
      const legacy = legacyResourceDocument();
      return { ...legacy, revision, resources: [...legacy.resources, { id: 'fixture', name: 'PG mock provider', kind: 'connection', protocol: 'openai-compatible',
        baseUrl: 'https://mock.invalid/v1', credential: { action: 'replace', value: secret }, models: [{ id: 'new-model', capabilities: ['chat'] }] }],
        defaults: { ...legacy.defaults, chat: { resourceId: 'fixture', model: 'new-model' } } };
    };
    const before = await runtime.config();
    await runtime.saveResourceConfiguration(input(0, 'pg-draft-synthetic'));
    assert.deepEqual(await runtime.config(), before);
    await assert.rejects(runtime.publishDraft(1), /版本/);
    let release!: (value: { latencyMs: number }) => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let captured: { apiKey: string; model: string } | undefined;
    const probe = runtime.testDraft(1, { service: 'supervisor', run: async config => {
      captured = config; entered();
      return new Promise(resolve => { release = resolve; });
    } });
    try {
      await waitForGate(ready);
      assert.equal(captured?.apiKey, 'pg-draft-synthetic'); assert.equal(captured?.model, 'new-model');
      await runtime.saveResourceConfiguration(input(1, 'pg-published-synthetic'));
    } finally { release?.({ latencyMs: 1 }); }
    await assert.rejects(probe, /版本/); await assert.rejects(runtime.publishDraft(2), /版本/);
    const tested = await runtime.testDraft(2, { service: 'supervisor', run: async config => { assert.equal(config.apiKey, 'pg-published-synthetic'); return { latencyMs: 1 }; } });
    assert.equal(tested.lifecycle.test?.revision, 2); assert.equal(JSON.stringify(tested).includes('pg-published-synthetic'), false);
    await runtime.publishDraft(2); await assert.rejects(runtime.publishDraft(2), /版本/);
    const accepted = await runtime.captureConfigurationSnapshot();
    await runtime.saveResourceConfiguration(input(2, 'pg-next-synthetic')); await runtime.testDraft(3); await runtime.publishDraft(3);
    await accepted(async () => assert.equal((await runtime.agentConfig('SUPERVISOR')).apiKey, 'pg-published-synthetic'));
    assert.equal((await runtime.agentConfig('SUPERVISOR')).apiKey, 'pg-next-synthetic');
    await runtime.saveResourceConfiguration(input(3, 'pg-rollback-synthetic')); await runtime.testDraft(4);
    await isolated.query(`CREATE FUNCTION fail_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`);
    await isolated.query(`CREATE TRIGGER fail_publish BEFORE UPDATE ON system_settings FOR EACH ROW WHEN (NEW.key = '${RESOURCE_SETTING_KEY}') EXECUTE FUNCTION fail_publish()`);
    await assert.rejects(runtime.publishDraft(4), /synthetic rollback/);
    const reopened = new AIRuntimeService(new PostgresAIRuntimeRepository(isolated), {});
    assert.equal((await reopened.resourceConfiguration()).lifecycle.pending, true);
    assert.equal((await reopened.config()).chat.apiKey, 'pg-next-synthetic');
    await isolated.query('DROP TRIGGER fail_publish ON system_settings'); await reopened.publishDraft(4);
    assert.equal((await reopened.config()).chat.apiKey, 'pg-rollback-synthetic');
    await reopened.saveResourceConfiguration(input(4, 'pg-conflict-synthetic')); await reopened.testDraft(5);
    await adapter.saveSettings([{ key: 'AI_MODEL', value: 'concurrent-old-writer' }]);
    await assert.rejects(reopened.publishDraft(5), /版本/);
    assert.equal((await reopened.config()).chat.apiKey, 'pg-rollback-synthetic');
    console.log('Real PostgreSQL draft isolation, stale probe, publish CAS, pinned credentials and atomic rollback passed');
  } finally { await isolated.end(); await pool.query('DROP SCHEMA draft_lifecycle CASCADE'); }
}

try {
  if (process.argv.includes("--verify-restart")) {
    const service = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
    const raw = (await service.settings())[RESOURCE_SETTING_KEY];
    assert.equal(JSON.parse(raw).revision, 6);
    assert.equal((await service.config()).chat.model, "legacy-model");
    assert.equal((await service.agentConfig("RECIPE")).model, "recipe-model");
    assert.equal((await service.resourceConfiguration()).lifecycle.pending, true);
    await service.discardDraft(7);
    await service.migrateResources();
    assert.equal((await service.settings())[RESOURCE_SETTING_KEY], raw);
    assert.match(JSON.stringify((await service.resourceConfiguration()).effective.search), /"status":"unverified"/);
    assert.match(JSON.stringify((await service.resourceConfiguration()).effective.fetch), /"status":"disabled"/);
    assert.equal((await service.toolConfig("search")).apiKey, "pg-persisted-fixture-secret");
    console.log("PostgreSQL persisted configuration after actual cluster restart passed");
  } else {
  await verifyDraftLifecycle();
  await pool.query("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)");
  const repository = new PostgresAIRuntimeRepository(pool);
  const service = new AIRuntimeService(repository, { AI_API_KEY: "pg-environment-fixture" });
  await service.saveSettings([{ key: "AI_MODEL", value: "legacy-model" }, { key: "AI_RECIPE_MODEL", value: "recipe-model" }]);
  const before = await service.config();
  await Promise.all([service.migrateResources(), service.migrateResources()]);
  const initial = (await service.settings())[RESOURCE_SETTING_KEY];
  assert.deepEqual(await service.config(), before);
  assert.equal(await repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, null, "{}"), false);
  const update = legacyResourceDocument();
  const results = await Promise.allSettled([service.saveResourceConfiguration(update), service.saveResourceConfiguration(update)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  await service.testDraft(1); await service.publishDraft(1);
  let saved = (await service.settings())[RESOURCE_SETTING_KEY];
  assert.notEqual(saved, initial);
  assert.equal(JSON.parse(saved).revision, 1);
  assert.equal(await repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, "stale", null, {}, [{ key: "AI_MODEL", value: "wrong" }]), false);
  const snapshot = await service.settings();
  await service.saveValidatedSettings([{ key: "AI_MODEL", value: "temporary-model" }], snapshot, 1);
  await service.testDraft(2); await service.publishDraft(2);
  await assert.rejects(service.saveValidatedSettings([{ key: "AI_MODEL", value: "stale-model" }], snapshot, 1), /版本/);
  assert.equal(await repository.compareAndSaveSetting(RESOURCE_SETTING_KEY, saved, "{}", { ...snapshot, AI_MODEL: "legacy-model" }), false);
  saved = (await service.settings())[RESOURCE_SETTING_KEY];
  await service.saveSettings([{ key: "AI_MODEL", value: "legacy-model" }]);
  const restarted = new AIRuntimeService(new PostgresAIRuntimeRepository(pool), { AI_API_KEY: "pg-environment-fixture" });
  await restarted.migrateResources();
  assert.deepEqual(await restarted.config(), before);
  assert.equal((await restarted.agentConfig("RECIPE")).model, "recipe-model");
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  const toolUpdate: ResourceUpdate = { ...legacyResourceDocument(), revision: 2,
    resources: [...legacyResourceDocument().resources, { id: "web", name: "PG tool fixture", kind: "tool", protocol: "deepseek-tools", baseUrl: "https://api.deepseek.com", tools: ["search", "fetch"], credential: { action: "replace", value: "pg-replaced-fixture-secret" } }],
    defaults: { ...legacyResourceDocument().defaults, search: { resourceId: "web" }, fetch: { resourceId: "web" } },
    services: { ...legacyResourceDocument().services, search: { inherit: true }, fetch: { resourceId: "web" } },
  };
  const tool = toolUpdate.resources.at(-1)!;
  assert.ok(tool.kind === "tool");
  for (const action of ["replace", "keep", "clear", "replace"] as const) {
    const expected = toolUpdate.revision === 5 ? "pg-persisted-fixture-secret" : action === "clear" ? "" : "pg-replaced-fixture-secret";
    tool.credential = action === "replace" ? { action, value: expected } : { action };
    const result = await service.saveResourceConfiguration(toolUpdate);
    await service.testDraft(result.revision); await service.publishDraft(result.revision);
    toolUpdate.revision = result.revision;
    assert.equal((await service.toolConfig("search")).apiKey, expected);
    assert.match(JSON.stringify(result.effective.fetch), /"status":"disabled"/);
    assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
    assert.deepEqual(result.defaults.fetch, { resourceId: "web" });
  }
  saved = (await service.settings())[RESOURCE_SETTING_KEY];
  await pool.query(`CREATE FUNCTION reject_resource_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture write failure'; END $$`);
  await pool.query(`CREATE TRIGGER reject_resource_update BEFORE UPDATE ON system_settings FOR EACH ROW WHEN (NEW.key = '${RESOURCE_SETTING_KEY}') EXECUTE FUNCTION reject_resource_update()`);
  const failedDraft = await restarted.saveResourceConfiguration(toolUpdate);
  await restarted.testDraft(failedDraft.revision);
  await assert.rejects(restarted.publishDraft(failedDraft.revision), /fixture write failure/);
  assert.equal((await restarted.settings())[RESOURCE_SETTING_KEY], saved);
  assert.deepEqual(await restarted.config(), before);
  console.log("PostgreSQL real-cluster migration/CAS/concurrent save/reopen/rollback checks passed");
  }
} finally {
  await pool.end();
}
