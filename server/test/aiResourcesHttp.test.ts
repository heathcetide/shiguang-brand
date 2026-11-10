import { writableConfiguration, type ResourceConfiguration } from "../../admin/src/services/aiResources.js";
import { legacyConfigPatch } from "../../admin/src/services/legacyAIConfig.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { legacyResourceDocument } from "../src/modules/aiRuntime/resources.js";

const directory = mkdtempSync(join(tmpdir(), "ai-resources-http-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_DRIVER: "sqlite", DATABASE_URL: "", DATABASE_PATH: join(directory, "test.db"),
  JWT_SECRET: "resource-http-fixture-jwt-secret-over-32-characters", ADMIN_INITIAL_PASSWORD: "AdminPassword1234",
  ENABLE_DEMO_SEED: "0", REGISTER_RATE_LIMIT: "1000", REGISTER_GLOBAL_RATE_LIMIT: "5000",
});
let server: Server;
let db: typeof import("../src/storage/db.js").db;
let baseUrl: string;
async function request(path: string, method = "GET", token?: string, body?: unknown, autoPublish = true): Promise<{ status: number; body: Record<string, any> }> {
  if (path === '/admin/ai-config' && method === 'PUT' && body && typeof body === 'object') {
    const current = await request('/admin/ai-config', 'GET', token);
    body = { ...body, draftRevision: current.body.draftRevision ?? 0 };
  }
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = { status: response.status, body: await response.json() as Record<string, any> };
  if (autoPublish && response.status === 200 && method === 'PUT' && ['/admin/ai-config', '/admin/ai-config/resources'].includes(path)) {
    const draft = await request('/admin/ai-config/resources', 'GET', token);
    assert.equal((await request('/admin/ai-config/resources/test', 'POST', token, { revision: draft.body.revision })).status, 200);
    assert.equal((await request('/admin/ai-config/resources/publish', 'POST', token, { revision: draft.body.revision })).status, 200);
  }
  return result;
}
before(async () => {
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

test("resource routes require a current admin session and never serialize credentials or invalid input", async () => {
  const regular = await request("/auth/register", "POST", undefined, { identifier: "resource-review@example.test", username: "review", password: "Password1234" });
  assert.equal(regular.status, 201);
  const login = await request("/auth/login", "POST", undefined, { identifier: "admin", password: "AdminPassword1234" });
  assert.equal(login.status, 200);
  for (const [path, method] of [["/admin/ai-config", "GET"], ["/admin/ai-config/resources", "GET"], ["/admin/ai-config/resources", "PUT"], ["/admin/ai-config/resources/migrate", "POST"], ["/admin/ai-config/resources/test", "POST"], ["/admin/ai-config/resources/publish", "POST"], ["/admin/ai-config/resources/discard", "POST"]]) {
    assert.equal((await request(path, method)).status, 401);
    assert.equal((await request(path, method, regular.body.token)).status, 403);
    assert.equal((await request(path, method, login.body.token)).status, 403); // initial password must change
  }
  db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const token = login.body.token;
  const migrated = await request("/admin/ai-config/resources/migrate", "POST", token);
  assert.equal(migrated.status, 200);
  const document = legacyResourceDocument();
  const secret = "isolated-resource-fixture-SECRET";
  const update = { ...document, resources: [...document.resources, {
    id: "review", kind: "connection", name: "review", protocol: "openai-compatible", baseUrl: "https://fixture.invalid/v1",
    models: [{ id: "review-model", capabilities: ["chat"] }], credential: { action: "replace", value: secret },
  }, {
    id: "web", kind: "tool", name: "Synthetic web", protocol: "deepseek-tools", baseUrl: "https://api.deepseek.com",
    tools: ["search", "fetch"], credential: { action: "replace", value: secret },
  }], defaults: { ...document.defaults, search: { resourceId: "web" }, fetch: { resourceId: "web" } }, services: { ...document.services, chat: { resourceId: "review", model: "review-model" }, search: { inherit: true }, fetch: { resourceId: "web" } } };
  const saved = await request("/admin/ai-config/resources", "PUT", token, update);
  assert.equal(saved.status, 200);
  const publicTools = await request("/admin/ai-config/resources", "GET", token);
  assert.equal(publicTools.body.effective.search.status, "unverified");
  assert.equal(publicTools.body.effective.fetch.status, "disabled");
  for (const result of [saved, await request("/admin/ai-config/resources", "GET", token), await request("/admin/ai-config", "GET", token)]) {
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.body).includes(secret), false);
    assert.equal(JSON.stringify(result.body).includes('"apiKey"'), false);
  }
  const invalid = await request("/admin/ai-config/resources", "PUT", token, { ...update, revision: 1, invalidSecret: secret });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.stringify(invalid.body).includes(secret), false);
  assert.equal((await request("/admin/ai-config/resources", "PUT", token, update)).status, 409); // stale revision
  const audits = db.prepare("SELECT summary FROM admin_audit_logs WHERE action LIKE 'ai_resources.%'").all();
  assert.ok(audits.length >= 2);
  assert.equal(JSON.stringify(audits).includes(secret), false);
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE username = 'admin'").run();
  assert.equal((await request("/admin/ai-config/resources", "GET", token)).status, 401);
});

test("UI projection over real HTTP preserves tools, credential actions, atomic CAS and storage rollback", async () => {
  const login = await request('/auth/login', 'POST', undefined, { identifier: 'admin', password: 'AdminPassword1234' });
  const token = login.body.token;
  const read = async () => (await request('/admin/ai-config/resources', 'GET', token)).body as ResourceConfiguration;
  const stored = () => JSON.parse((db.prepare("SELECT value FROM system_settings WHERE key='AI_RESOURCE_CONFIG_V1'").get() as { value: string }).value);
  let current = await read();
  const originalTool = stored().resources.find((r: any) => r.id === 'web');
  const projected = writableConfiguration(current);
  projected.resources.find(r => r.id === 'review')!.name = 'UI name-only edit';
  const saved = await request('/admin/ai-config/resources', 'PUT', token, projected);
  assert.equal(saved.status, 200);
  assert.deepEqual(stored().resources.find((r: any) => r.id === 'web'), originalTool);
  assert.deepEqual(saved.body.defaults.search, current.defaults.search);
  assert.deepEqual(saved.body.defaults.fetch, current.defaults.fetch);
  assert.deepEqual(saved.body.services.search, current.services.search);
  assert.deepEqual(saved.body.services.fetch, current.services.fetch);
  assert.equal(saved.body.effective.fetch.status, 'disabled');
  for (const action of ['keep', 'replace', 'clear'] as const) {
    current = await read(); const update = writableConfiguration(current);
    for (const resource of update.resources) if (resource.kind !== 'legacy') resource.credential = action === 'replace' ? { action, value: 'HTTP-SYNTHETIC-REPLACEMENT' } : { action };
    const result = await request('/admin/ai-config/resources', 'PUT', token, update);
    assert.equal(result.status, 200);
    for (const resource of stored().resources) if (resource.kind !== 'legacy') {
      assert.equal(resource.apiKey, action === 'keep' ? 'isolated-resource-fixture-SECRET' : action === 'replace' ? 'HTTP-SYNTHETIC-REPLACEMENT' : '');
    }
    assert.equal(JSON.stringify(result.body).includes('HTTP-SYNTHETIC-REPLACEMENT'), false);
  }
  current = await read(); const simultaneous = writableConfiguration(current);
  const concurrent = await Promise.all([request('/admin/ai-config/resources', 'PUT', token, simultaneous), request('/admin/ai-config/resources', 'PUT', token, simultaneous)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  assert.equal(concurrent.find(r => r.status === 409)!.body.code, 'AI_RESOURCE_CONFLICT');
  current = await read(); const invalid = writableConfiguration(current);
  invalid.services.chat = { resourceId: 'web' };
  const rejected = await request('/admin/ai-config/resources', 'PUT', token, invalid);
  assert.equal(rejected.status, 400); assert.equal(rejected.body.code, 'AI_RESOURCE_INVALID');
  assert.equal((await read()).revision, current.revision);
  const badTool = writableConfiguration(current); (badTool.services as any).search = { resourceId: 'web', model: 'must-not-exist' };
  assert.equal((await request('/admin/ai-config/resources', 'PUT', token, badTool)).status, 400);
  const before = stored();
  db.exec("CREATE TRIGGER reject_resource_ui BEFORE UPDATE ON system_settings WHEN NEW.key='AI_RESOURCE_CONFIG_V1' BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END");
  try {
    const draft = await request('/admin/ai-config/resources', 'PUT', token, writableConfiguration(current), false);
    assert.equal(draft.status, 200);
    assert.equal((await request('/admin/ai-config/resources/test', 'POST', token, { revision: draft.body.revision })).status, 200);
    const failure = await request('/admin/ai-config/resources/publish', 'POST', token, { revision: draft.body.revision });
    assert.equal(failure.status, 500);
    assert.equal((await request('/admin/ai-config/resources/discard', 'POST', token, { revision: draft.body.revision })).status, 200);
    assert.equal(JSON.stringify(failure.body).includes('synthetic storage failure'), false);
    assert.deepEqual(stored(), before);
  } finally { db.exec('DROP TRIGGER reject_resource_ui'); }
});

test("raw legacy editing over HTTP never leaks keys or writes effective resource values on a budget-only change", async () => {
  const login = await request('/auth/login', 'POST', undefined, { identifier: 'admin', password: 'AdminPassword1234' });
  const token = login.body.token;
  const runtime = (await import('../src/modules/aiRuntime/runtime.js')).aiRuntimeService();
  const entries = {
    AI_API_KEY: 'raw-global-SECRET', AI_CHAT_API_KEY: 'raw-chat-SECRET', AI_VISION_API_KEY: 'raw-vision-SECRET', AI_ASR_API_KEY: 'raw-asr-SECRET',
    AI_BASE_URL: 'https://legacy-global.invalid/v1', AI_CHAT_BASE_URL: 'https://legacy-chat.invalid/v1', AI_VISION_BASE_URL: '', AI_ASR_BASE_URL: '',
    AI_MODEL: 'raw-global-model', AI_CHAT_MODEL: 'raw-chat-model', AI_VISION_MODEL: '', AI_ASR_MODEL: '',
    AI_SUPERVISOR_MODEL: '', AI_NUTRITION_MODEL: '', AI_RECIPE_MODEL: 'review-model', AI_OPERATIONS_MODEL: '', AI_SYSTEM_PROMPT: '',
  };
  await runtime.saveSettings(Object.entries(entries).map(([key, value]) => ({ key, value })));
  const response = await request('/admin/ai-config', 'GET', token);
  assert.equal(response.status, 200);
  const data = response.body;
  const effective = (await request('/admin/ai-config/resources', 'GET', token)).body.effective;
  for (const [role, service] of Object.entries({ 对话: 'chat', 主助手: 'supervisor', 菜谱: 'recipe', 运营: 'operations', 规划: 'nutrition', 图片: 'vision' })) {
    const entry = data.effectiveModels.find((item: { role: string }) => item.role === role);
    assert.equal(entry.model, effective[service].model);
    assert.equal(entry.baseUrl, effective[service].baseUrl);
  }
  assert.equal(data.chat.model, 'review-model'); assert.equal(data.editable.chatModel, 'raw-chat-model');
  assert.equal(data.editable.model, 'raw-global-model'); assert.equal(data.editable.supervisorModel, '');
  assert.equal(data.editable.visionModel, ''); assert.equal(data.maskedKey, '********');
  assert.deepEqual(data.credentialState, { global: true, chat: true, vision: true, asr: true });
  for (const secret of ['raw-global-SECRET', 'raw-chat-SECRET', 'raw-vision-SECRET', 'raw-asr-SECRET']) assert.equal(JSON.stringify(data).includes(secret), false);
  assert.equal(JSON.stringify(data.editable).includes('apiKey'), false);
  assert.equal(JSON.stringify(data.editable).includes('AI_RESOURCE_CONFIG_V1'), false);
  const initial = { ...data.editable, model: data.editable.chatModel, chatModel: data.editable.chatModel, runtimePolicy: data.runtimePolicy };
  const policy = { ...data.runtimePolicy, maxToolCalls: data.runtimePolicy.maxToolCalls + 1 };
  const patch = legacyConfigPatch({ ...initial, runtimePolicy: policy }, initial, { apiKey: '', chatApiKey: '', visionApiKey: '', asrApiKey: '' });
  assert.deepEqual(Object.keys(patch), ['runtimePolicy']);
  assert.equal((await request('/admin/ai-config', 'PUT', token, patch)).status, 200);
  const after = await runtime.settings();
  for (const [key, value] of Object.entries(entries)) assert.equal(after[key], value, `unchanged ${key}`);
  assert.equal(JSON.parse(after.AI_RUNTIME_POLICY).maxToolCalls, policy.maxToolCalls);
  assert.equal((await request('/admin/ai-config', 'PUT', token, { recipeModel: '', systemPrompt: '' })).status, 200);
  assert.equal((await runtime.settings()).AI_RECIPE_MODEL, '');
  assert.equal((await runtime.agentConfig('RECIPE')).model, 'review-model');
});

test("legacy clearing and chat-policy rejection keep server validation authoritative", async () => {
  const login = await request('/auth/login', 'POST', undefined, { identifier: 'admin', password: 'AdminPassword1234' });
  const token = login.body.token;
  const runtime = (await import('../src/modules/aiRuntime/runtime.js')).aiRuntimeService();
  const old = await runtime.settings();
  const cleared = await request('/admin/ai-config', 'PUT', token, { chatApiKey: '', visionApiKey: '', asrApiKey: '', apiKey: '' });
  assert.equal(cleared.status, 200);
  const audit = db.prepare("SELECT details_json FROM admin_audit_logs WHERE action='ai_config.update' ORDER BY id DESC LIMIT 1").get() as { details_json: string };
  assert.equal(JSON.parse(audit.details_json).apiKeyChanged, true);
  for (const key of ['AI_API_KEY', 'AI_CHAT_API_KEY', 'AI_VISION_API_KEY', 'AI_ASR_API_KEY']) assert.equal((await runtime.settings())[key], '');
  assert.equal((await runtime.legacyChatConfig()).baseUrl, 'https://legacy-chat.invalid/v1');
  assert.equal((await runtime.config()).chat.baseUrl, 'https://fixture.invalid/v1');
  const current = (await request('/admin/ai-config/resources', 'GET', token)).body as ResourceConfiguration;
  const update = writableConfiguration(current);
  update.resources.push({ id: 'thinking', name: 'Thinking fixture', kind: 'connection', protocol: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', models: [{ id: 'Pro/deepseek-ai/DeepSeek-V4', capabilities: ['chat'] }], credential: { action: 'clear' } });
  for (const role of ['supervisor', 'nutrition', 'recipe', 'operations'] as const) update.services[role] = { resourceId: 'thinking', model: 'Pro/deepseek-ai/DeepSeek-V4' };
  assert.equal((await request('/admin/ai-config/resources', 'PUT', token, update)).status, 200);
  const policy = (await request('/admin/ai-config', 'GET', token)).body.runtimePolicy;
  assert.equal((await request('/admin/ai-config', 'PUT', token, { runtimePolicy: { ...policy, main: { ...policy.main, thinking: 'high' } } })).status, 400);
  const invalidRecipe = await request('/admin/recipes/1/execution', 'PUT', token, { recipeKey: 'a'.repeat(64), reviewKey: 'b'.repeat(64), profile: { version: 1, reference: '', maxBatchServings: 0, tools: [], tasks: [] } });
  assert.equal(invalidRecipe.status, 400); assert.equal(invalidRecipe.body.code, 'VALIDATION_ERROR');
  assert.ok(invalidRecipe.body.details.some((issue: { path: string }) => issue.path.startsWith('profile')));
  await assert.rejects(runtime.saveValidatedSettings([{ key: 'AI_MODEL', value: 'stale' }], old, -1), /版本/);
});
