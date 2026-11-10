import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { AIRuntimeService } from '../src/modules/aiRuntime/service.js';
import { SqliteAIRuntimeRepository } from '../src/modules/aiRuntime/sqliteRepository.js';
import { legacyResourceDocument, RESOURCE_SETTING_KEY, type ResourceUpdate } from '../src/modules/aiRuntime/resources.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
function update(revision = 0, key = 'synthetic-secret'): ResourceUpdate {
  const doc = legacyResourceDocument();
  return { ...doc, revision, resources: [...doc.resources, { id: 'fixture', name: 'Fixture', kind: 'connection',
    protocol: 'openai-compatible', baseUrl: 'https://fixture.invalid/v1', credential: { action: 'replace', value: key },
    models: [{ id: 'fixture-model', capabilities: ['chat'] }] }], defaults: { ...doc.defaults, chat: { resourceId: 'fixture', model: 'fixture-model' } } };
}
function setup(file = ':memory:') {
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)');
  const repository = new SqliteAIRuntimeRepository(db);
  return { db, service: new AIRuntimeService(repository, { AI_API_KEY: 'legacy-synthetic', AI_MODEL: 'legacy-model' }) };
}
async function publish(service: AIRuntimeService, revision: number) { await service.testDraft(revision); return service.publishDraft(revision); }
test('save/test/publish isolate production, redact secrets, invalidate edited tests and reject duplicates', async () => {
  const { db, service } = setup();
  try {
    const before = await service.config(); const saved = await service.saveResourceConfiguration(update());
    assert.equal(saved.lifecycle.pending, true);
    assert.deepEqual(saved.lifecycle.changedServices.sort(), ['chat', 'nutrition', 'operations', 'recipe', 'supervisor']);
    assert.equal(JSON.stringify(saved).includes('synthetic'), false);
    assert.deepEqual(await service.config(), before);
    await assert.rejects(service.publishDraft(1), /版本/);
    const tested = await service.testDraft(1);
    assert.deepEqual(tested.lifecycle.test, { revision: 1, scope: 'configuration-validation', success: true });
    assert.deepEqual(await service.config(), before);
    await service.saveResourceConfiguration(update(1, 'replacement-synthetic'));
    await assert.rejects(service.publishDraft(1), /版本/); await assert.rejects(service.publishDraft(2), /版本/);
    await assert.rejects(service.saveResourceConfiguration(update(1)), /版本/);
    await publish(service, 2); assert.equal((await service.config()).chat.apiKey, 'replacement-synthetic');
    assert.equal((await service.resourceConfiguration()).lifecycle.pending, false);
    await assert.rejects(service.publishDraft(2), /版本/); await assert.rejects(service.testDraft(2), /版本/);
  } finally { db.close(); }
});
test('in-flight requests pin credentials/models/policy across publication; new requests use new values', async () => {
  const { db, service } = setup();
  try {
    await service.saveResourceConfiguration(update()); await publish(service, 1);
    let entered!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { resume = resolve; });
    const inFlight = service.withConfigurationSnapshot(async () => {
      const first = await service.config(); entered(); await gate;
      assert.deepEqual(await service.config(), first); assert.equal((await service.agentConfig('SUPERVISOR')).apiKey, 'synthetic-secret');
      assert.equal((await service.runtimePolicy()).maxModelCalls, 12);
    });
    await ready; await service.saveResourceConfiguration(update(1, 'next-synthetic'));
    await service.saveValidatedSettings([{ key: 'AI_RUNTIME_POLICY', value: JSON.stringify({ maxModelCalls: 3 }) }], await service.draftSettings(), 2);
    await publish(service, 3); resume(); await inFlight;
    await service.withConfigurationSnapshot(async () => {
      assert.equal((await service.config()).chat.apiKey, 'next-synthetic'); assert.equal((await service.runtimePolicy()).maxModelCalls, 3);
    });
  } finally { db.close(); }
});
test('legacy draft CAS and credential keep/clear/discard preserve published values', async () => {
  const { db, service } = setup();
  try {
    await service.saveValidatedSettings([{ key: 'AI_API_KEY', value: 'legacy-replacement-synthetic' }], await service.draftSettings(), 0);
    assert.equal((await service.config()).chat.apiKey, 'legacy-synthetic');
    await assert.rejects(service.saveValidatedSettings([], await service.draftSettings(), 0), /版本/); await publish(service, 1);
    await service.saveResourceConfiguration(update(1)); await publish(service, 2);
    const keep = update(2); const resource = keep.resources.at(-1)!;
    if (resource.kind === 'connection') resource.credential = { action: 'keep' };
    await service.saveResourceConfiguration(keep); await publish(service, 3); assert.equal((await service.config()).chat.apiKey, 'synthetic-secret');
    keep.revision = 3; if (resource.kind === 'connection') resource.credential = { action: 'clear' };
    await service.saveResourceConfiguration(keep); assert.equal((await service.config()).chat.apiKey, 'synthetic-secret');
    await service.discardDraft(4); assert.equal((await service.config()).chat.apiKey, 'synthetic-secret');
    keep.revision = 5; await service.saveResourceConfiguration(keep); await publish(service, 6); assert.equal((await service.config()).chat.apiKey, '');
  } finally { db.close(); }
});
test('baseline conflicts, atomic rollback, idempotent migration and restart preserve effective values', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-draft-')); const file = join(directory, 'settings.db'); let current = setup(file);
  try {
    await current.service.migrateResources(); await current.service.migrateResources(); const before = await current.service.config();
    await current.service.saveResourceConfiguration(update()); await current.service.testDraft(1); current.db.close(); current = setup(file);
    assert.deepEqual(await current.service.config(), before); assert.equal((await current.service.resourceConfiguration()).lifecycle.test?.revision, 1);
    current.db.exec(`CREATE TRIGGER fail_publish BEFORE UPDATE ON system_settings WHEN NEW.key = '${RESOURCE_SETTING_KEY}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    await assert.rejects(current.service.publishDraft(1), /synthetic failure/);
    assert.equal((await current.service.resourceConfiguration()).lifecycle.pending, true); assert.deepEqual(await current.service.config(), before);
    current.db.exec('DROP TRIGGER fail_publish'); await current.service.saveSettings([{ key: 'AI_MODEL', value: 'concurrent-legacy' }]);
    assert.equal((await current.service.resourceConfiguration()).lifecycle.conflict, true); await assert.rejects(current.service.publishDraft(1), /版本/);
    await current.service.discardDraft(1); assert.equal((await current.service.config()).chat.model, 'concurrent-legacy');
  } finally { current.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('mock provider probe uses exact draft credentials, records revision/service, never changes published config', async () => {
  const { db, service } = setup();
  const { configureAIRuntimeService } = await import('../src/modules/aiRuntime/runtime.js');
  const { testAIConnection } = await import('../src/services/aiService.js');
  configureAIRuntimeService(service);
  const originalFetch = globalThis.fetch;
  try {
    const before = await service.config(); await service.saveResourceConfiguration(update());
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://fixture.invalid/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-secret');
      assert.equal(JSON.parse(String(init?.body)).model, 'fixture-model');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic-secret echoed by unsafe provider' } }] }));
    };
    const result = await service.testDraft(1, { service: 'supervisor', run: testAIConnection });
    assert.equal(result.lifecycle.test?.scope, 'connection-probe'); assert.equal(result.lifecycle.test?.service, 'supervisor');
    assert.equal(result.lifecycle.test?.revision, 1); assert.equal(result.lifecycle.test?.success, true);
    assert.equal(JSON.stringify(result).includes('synthetic-secret'), false); assert.deepEqual(await service.config(), before);
    globalThis.fetch = async () => new Response('synthetic-secret', { status: 401 });
    const failed = await service.testDraft(1, { service: 'supervisor', run: testAIConnection });
    assert.equal(failed.lifecycle.test?.success, false); assert.equal(JSON.stringify(failed).includes('synthetic-secret'), false);
    await assert.rejects(service.publishDraft(1), /版本/);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});

test('late and cancelled provider probes cannot certify an edited draft; nested new execution gets fresh version', async () => {
  const { db, service } = setup();
  try {
    await service.saveResourceConfiguration(update());
    let release!: (value: { latencyMs: number }) => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = service.testDraft(1, { service: 'chat', run: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
    await ready; await service.saveResourceConfiguration(update(1, 'edited-synthetic')); release({ latencyMs: 1 });
    await assert.rejects(pending, /版本/); assert.equal((await service.resourceConfiguration()).lifecycle.test, null);
    const abort = new AbortController();
    await assert.rejects(service.testDraft(2, { service: 'chat', signal: abort.signal, run: async () => { abort.abort(); return { latencyMs: 1 }; } }));
    assert.equal((await service.resourceConfiguration()).lifecycle.test, null);
    await service.withConfigurationSnapshot(async () => {
      assert.equal((await service.config()).chat.model, 'legacy-model');
      await publish(service, 2);
      assert.equal((await service.config()).chat.model, 'legacy-model');
      await service.withConfigurationSnapshot(async () => assert.equal((await service.config()).chat.apiKey, 'edited-synthetic'), true);
      assert.equal((await service.config()).chat.model, 'legacy-model');
    });
  } finally { db.close(); }
});


test('accepted request snapshots survive a later publication, while newly accepted requests use the new version', async () => {
  const { db, service } = setup();
  try {
    const accepted = await service.captureConfigurationSnapshot();
    await service.saveResourceConfiguration(update()); await publish(service, 1);
    await accepted(async () => {
      assert.equal((await service.config()).chat.model, 'legacy-model');
      await service.withConfigurationSnapshot(async () => assert.equal((await service.config()).chat.model, 'legacy-model'));
    });
    const next = await service.captureConfigurationSnapshot();
    await next(async () => assert.equal((await service.config()).chat.apiKey, 'synthetic-secret'));
  } finally { db.close(); }
});
