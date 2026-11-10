import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Database from "better-sqlite3";
import { onboardingUpdateSchema } from "@dietdigidose/contracts";
import { onboardingMigration } from "../src/storage/onboardingMigration.js";
import { OnboardingService } from "../src/modules/onboarding/service.js";
import { SqliteOnboardingRepository } from "../src/modules/onboarding/sqliteRepository.js";
import { validPlan } from "../src/modules/onboarding/domain.js";
import { observeOnboardingSaves } from "../src/modules/onboarding/observeSaves.js";
import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";

function setup() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO users (id) VALUES (1),(2);
    CREATE TABLE inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,food_name TEXT,deleted_at TEXT);
    CREATE TABLE diet_records (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,food_name TEXT);
    CREATE TABLE meal_plans (id TEXT PRIMARY KEY,user_id INTEGER,version INTEGER DEFAULT 1,status TEXT,deleted_at TEXT,constraints_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE meal_plan_items (id TEXT PRIMARY KEY,plan_id TEXT,user_id INTEGER,title TEXT,deleted_at TEXT);
    CREATE TABLE user_health_profiles (id INTEGER PRIMARY KEY,user_id INTEGER,profile_version INTEGER,nutrition_target_source TEXT,nutrition_targets_json TEXT,nutrition_target_version INTEGER);
    CREATE TABLE funnel_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_name TEXT,actor_hash TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  onboardingMigration.up(db);
  return { db, service: new OnboardingService(new SqliteOnboardingRepository(db)) };
}

test("first use starts without personal defaults, resumes and persists per account", async () => {
  const { db, service } = setup();
  try {
    const initial = await service.get(1);
    assert.equal(initial.version, 0);
    assert.equal(initial.selectedTask, null);
    assert.equal(initial.status, "not_started");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_health_profiles").get() && (db.prepare("SELECT COUNT(*) AS count FROM user_health_profiles").get() as { count: number }).count, 0);
    const started = await service.update(1, { version: 0, selectedTask: "inventory", step: "task" });
    const paused = await service.update(1, { version: started.version, status: "paused", dismissed: true });
    const restored = new OnboardingService(new SqliteOnboardingRepository(db));
    assert.deepEqual(await restored.get(1), paused);
    assert.equal((await restored.get(2)).selectedTask, null);
    const resumed = await restored.update(1, { version: paused.version, status: "in_progress", dismissed: false });
    assert.equal(resumed.startedAt, started.startedAt);
    const events = db.prepare("SELECT event_name FROM funnel_events ORDER BY id").all();
    assert.deepEqual(events, [{ event_name: "onboarding_started" }, { event_name: "onboarding_resumed" }]);
  } finally { db.close(); }
});

test("completion requires a newly saved owned object and GET is idempotent", async () => {
  const { db, service } = setup();
  try {
    db.prepare("INSERT INTO inventory_items(user_id,food_name) VALUES (1,'旧库存')").run();
    const state = await service.update(1, { version: 0, selectedTask: "inventory" });
    assert.equal((await service.get(1)).status, "in_progress");
    const other = db.prepare("INSERT INTO inventory_items(user_id,food_name) VALUES (2,'鸡蛋')").run();
    await assert.rejects(service.update(1, { version: state.version, status: "completed", completion: { task: "inventory", resourceId: String(other.lastInsertRowid) } }), { code: "ONBOARDING_TASK_NOT_COMPLETED" });
    const saved = db.prepare("INSERT INTO inventory_items(user_id,food_name) VALUES (1,'番茄')").run();
    const completed = await service.get(1);
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.completion, { task: "inventory", resourceId: String(saved.lastInsertRowid) });
    assert.deepEqual(await service.get(1), completed);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM funnel_events WHERE event_name='onboarding_completed'").get() as { count: number }).count, 1);
    const event = db.prepare("SELECT * FROM funnel_events LIMIT 1").get() as { actor_hash: string };
    assert.match(event.actor_hash, /^[0-9a-f]{64}$/);
  } finally { db.close(); }
});

test("deleted inventory and blank diet records do not complete; switching tasks resets evidence", async () => {
  const { db, service } = setup();
  try {
    const start = await service.update(1, { version: 0, selectedTask: "inventory" });
    db.prepare("INSERT INTO inventory_items(user_id,food_name,deleted_at) VALUES (1,'已删除','today')").run();
    assert.equal((await service.get(1)).status, "in_progress");
    db.prepare("INSERT INTO diet_records(user_id,food_name) VALUES (1,'昨天的饭')").run();
    await service.update(1, { version: start.version, selectedTask: "diet_record" });
    db.prepare("INSERT INTO diet_records(user_id,food_name) VALUES (1,' ') ").run();
    assert.equal((await service.get(1)).status, "in_progress");
    const saved = db.prepare("INSERT INTO diet_records(user_id,food_name) VALUES (1,'今天的饭')").run();
    assert.deepEqual((await service.get(1)).completion, { task: "diet_record", resourceId: String(saved.lastInsertRowid) });
  } finally { db.close(); }
});

test("old nutrition values and unrelated profile edits cannot complete a nutrition task", async () => {
  const { db, service } = setup();
  try {
    db.prepare("INSERT INTO user_health_profiles VALUES (1,1,4,'user',?,4)").run(JSON.stringify({ calories_kcal: 2000 }));
    await service.update(1, { version: 0, selectedTask: "nutrition" });
    db.prepare("UPDATE user_health_profiles SET profile_version=5").run();
    assert.equal((await service.get(1)).status, "in_progress");
    db.prepare("UPDATE user_health_profiles SET nutrition_target_source='legacy_unconfirmed',nutrition_target_version=5").run();
    assert.equal((await service.get(1)).status, "in_progress");
    db.prepare("UPDATE user_health_profiles SET nutrition_target_source='user',nutrition_target_version=6,profile_version=6").run();
    assert.equal((await service.get(1)).status, "completed");
  } finally { db.close(); }
});

test("meal completion requires a valid nonempty saved plan owned by the user", async () => {
  const { db, service } = setup();
  try {
    db.exec("INSERT INTO meal_plans (id,user_id,status) VALUES ('old',1,'active'); INSERT INTO meal_plan_items (id,plan_id,user_id,title) VALUES ('old-item','old',1,'旧菜谱')");
    await service.update(1, { version: 0, selectedTask: "meal_plan" });
    db.exec("INSERT INTO meal_plans (id,user_id,status) VALUES ('empty',1,'active'),('other',2,'active'); INSERT INTO meal_plan_items (id,plan_id,user_id,title) VALUES ('other-item','other',2,'别人的方案')");
    assert.equal((await service.get(1)).status, "in_progress");
    db.exec("UPDATE meal_plans SET version=2 WHERE id='old'");
    assert.deepEqual((await service.get(1)).completion, { task: "meal_plan", resourceId: "old" });
    assert.equal(validPlan({ status: "draft", constraints_json: JSON.stringify({ savedCookingDraft: { draft: { meals: [{}] } } }) }), false);
  } finally { db.close(); }
});

test("version conflicts do not overwrite, retried writes and failure events are idempotent", async () => {
  const { db, service } = setup();
  try {
    const requestKey = randomUUID();
    const input = { version: 0, requestKey, selectedTask: "inventory" as const };
    const first = await service.update(1, input);
    assert.deepEqual(await service.update(1, input), first);
    await assert.rejects(service.update(1, { ...input, selectedTask: "diet_record" }), { code: "ONBOARDING_VERSION_CONFLICT" });
    await assert.rejects(service.update(1, { version: 0, dismissed: true }), { code: "ONBOARDING_VERSION_CONFLICT" });
    const failureKey = randomUUID();
    await service.saveFailed(1, failureKey);
    await service.saveFailed(1, failureKey);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM funnel_events WHERE event_name='onboarding_save_failed'").get() as { count: number }).count, 1);
    assert.equal((await service.get(1)).dismissed, false);
    db.prepare("DELETE FROM users WHERE id=1").run();
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_onboarding").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM onboarding_event_receipts").get() as { count: number }).count, 0);
  } finally { db.close(); }
});

test("the public contract rejects personal draft contents and malformed state changes", () => {
  assert.equal(onboardingUpdateSchema.safeParse({ version: 0, rawTranscript: "身体资料" }).success, false);
  assert.equal(onboardingUpdateSchema.safeParse({ version: -1 }).success, false);
  assert.equal(onboardingUpdateSchema.safeParse({ version: 0, selectedTask: "unknown" }).success, false);
});

test("business response observation checks real completion only after authenticated successful saves", async () => {
  const calls: unknown[][] = [];
  const middleware = observeOnboardingSaves({
    get: async userId => { calls.push(["complete", userId]); return {} as Awaited<ReturnType<OnboardingService["get"]>>; },
    saveFailed: async (userId, key) => { calls.push(["failed", userId, key]); return {} as Awaited<ReturnType<OnboardingService["get"]>>; },
  });
  const makeRequest = (method: string, path: string, userId?: number) => ({ method, path, userId, body: { private: "never recorded" } }) as unknown as Request;
  const response = (statusCode: number) => Object.assign(new EventEmitter(), { statusCode }) as unknown as Response & EventEmitter;
  let nextCalls = 0;
  const next: NextFunction = () => { nextCalls += 1; };
  const successful = response(201);
  middleware(makeRequest("POST", "/api/v1/inventory/bulk-intake", 42), successful, next);
  assert.deepEqual(calls, []);
  successful.emit("finish"); successful.emit("finish");
  assert.deepEqual(calls, [["complete", 42]]);
  const rejected = response(409);
  middleware(makeRequest("PATCH", "/api/v1/health-data/profile", 42), rejected, next);
  rejected.emit("finish");
  assert.equal(calls[1][0], "failed"); assert.equal(calls[1][1], 42); assert.match(String(calls[1][2]), /^[0-9a-f-]{36}$/);
  for (const request of [makeRequest("GET", "/api/v1/inventory", 42), makeRequest("POST", "/api/v1/auth/login", 42), makeRequest("POST", "/api/v1/diet-records")]) {
    const ignored = response(200); middleware(request, ignored, next); ignored.emit("finish");
  }
  assert.equal(calls.length, 2); assert.equal(nextCalls, 5);
  assert.equal(JSON.stringify(calls).includes("private"), false);
});

test("telemetry failures cannot change the already committed business response", async () => {
  const middleware = observeOnboardingSaves({ get: async () => { throw new Error("unavailable"); }, saveFailed: async () => { throw new Error("unavailable"); } });
  const response = Object.assign(new EventEmitter(), { statusCode: 201 }) as unknown as Response & EventEmitter;
  middleware({ method: "POST", path: "/api/v1/diet-records", userId: 42 } as unknown as Request, response, () => undefined);
  assert.doesNotThrow(() => response.emit("finish"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(response.statusCode, 201);
});
