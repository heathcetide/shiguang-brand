import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
const directory = mkdtempSync(path.join(tmpdir(), "feedback-flow-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "feedback-test-secret-at-least-32-characters";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";
process.env.ENABLE_DEMO_SEED = "0";
let server: Server;
let db: typeof import("../src/storage/db.js").db;
let base: string;
let owner: { token: string; user: { id: number } };
let other: typeof owner;
let admin: typeof owner;
async function request(route: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}/api/v1${route}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() as any };
}
before(async () => {
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = (await request("/auth/register", undefined, { identifier: "feedback-owner@example.com", username: "反馈用户", password: "Password1234" })).data;
  other = (await request("/auth/register", undefined, { identifier: "feedback-other@example.com", username: "其他用户", password: "Password1234" })).data;
  db.prepare("UPDATE users SET must_change_password=0 WHERE username='admin'").run();
  admin = (await request("/auth/login", undefined, { identifier: "admin", password: "AdminPassword1234" })).data;
  assert.ok(owner.token); assert.ok(admin.token);
});
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); db?.close(); rmSync(directory, { recursive: true, force: true }); });
let feedbackId: number;
test("submission is idempotent, discoverable, scoped and rejects changed replay", async () => {
  const body = { requestKey: randomUUID(), category: "issue", content: "无法查看我的菜谱内容", context: { page: "recipes", appVersion: "1.0.6", platform: "web" } };
  const created = await request("/feedback", owner.token, body);
  assert.equal(created.status, 201); feedbackId = created.data.id;
  assert.equal((await request("/feedback", owner.token, body)).data.id, feedbackId);
  assert.equal((await request("/feedback", owner.token, { ...body, content: "不同的反馈内容" })).status, 409);
  const list = await request("/feedback", owner.token);
  assert.equal(list.data.items.length, 1); assert.equal(list.data.items[0].status, "received");
  assert.equal((await request(`/feedback/${feedbackId}`, other.token)).status, 404);
  assert.equal((await request("/feedback/admin", owner.token)).status, 403);
  assert.equal((await request("/feedback")).status, 401);
  assert.equal((await request("/feedback?limit=0", owner.token)).status, 400);
});
test("public reply, internal notes and user follow-up stay in the same thread", async () => {
  const reply = { requestKey: randomUUID(), content: "请提供发生问题的页面和步骤", version: 1, status: "waiting_user", visibility: "public" };
  const first = await request(`/feedback/admin/${feedbackId}/replies`, admin.token, reply);
  assert.equal(first.status, 200); assert.equal(first.data.version, 2);
  const replay = await request(`/feedback/admin/${feedbackId}/replies`, admin.token, reply);
  assert.equal(replay.status, 200); assert.equal(replay.data.messages.length, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM user_notification_inbox WHERE feedback_id=?").get(feedbackId) as { n: number }).n, 1);
  assert.equal((await request(`/feedback/admin/${feedbackId}/replies`, admin.token, { ...reply, requestKey: randomUUID() })).status, 409);
  const note = await request(`/feedback/admin/${feedbackId}/replies`, admin.token, { requestKey: randomUUID(), content: "仅管理员可见的排查备注", version: 2, visibility: "internal" });
  assert.equal(note.status, 200); assert.equal(note.data.messages.length, 2);
  const visible = await request(`/feedback/${feedbackId}`, owner.token);
  assert.equal(visible.data.messages.length, 1); assert.doesNotMatch(JSON.stringify(visible.data), /排查备注/);
  const extra = await request(`/feedback/${feedbackId}/replies`, owner.token, { requestKey: randomUUID(), content: "在我的菜谱点击详情时发生", version: 3 });
  assert.equal(extra.status, 200); assert.equal(extra.data.status, "processing"); assert.equal(extra.data.messages.length, 2);
  assert.equal((await request(`/feedback/${feedbackId}/replies`, other.token, { requestKey: randomUUID(), content: "越权补充", version: 4 })).status, 404);
  assert.equal((await request(`/feedback/${feedbackId}/replies`, owner.token, { requestKey: randomUUID(), content: "越权改状态", version: 4, status: "closed" })).status, 400);
  const notifications = await request("/notifications/history", owner.token);
  assert.equal(notifications.status, 200);
  assert.match(JSON.stringify(notifications.data), /feedback_reply/);
  assert.match(JSON.stringify(notifications.data), /"feedbackId":1/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE resource_type='feedback' AND resource_id=?").get(String(feedbackId)) as { n: number }).n, 2);
});
test("closed threads reject user changes and concurrent replies obey version", async () => {
  const responses = await Promise.all(["处理完成", "需要再核对"].map(content => request(`/feedback/admin/${feedbackId}/replies`, admin.token, { requestKey: randomUUID(), content, version: 4, status: "closed" })));
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 409]);
  assert.equal((await request(`/feedback/${feedbackId}/replies`, owner.token, { requestKey: randomUUID(), content: "关闭后的补充", version: 5 })).status, 409);
});
test("failed notification rolls back message, status and audit together", async () => {
  db.exec("CREATE TRIGGER fail_feedback_notification BEFORE INSERT ON user_notification_inbox WHEN NEW.type='feedback_reply' BEGIN SELECT RAISE(ABORT,'fixture notification failure'); END;");
  try {
    const result = await request(`/feedback/admin/${feedbackId}/replies`, admin.token, { requestKey: randomUUID(), content: "重新处理", version: 5, status: "processing" });
    assert.equal(result.status, 500);
    assert.equal((await request(`/feedback/${feedbackId}`, owner.token)).data.version, 5);
  } finally { db.exec("DROP TRIGGER fail_feedback_notification"); }
});
test("pagination and account deletion cover feedback, messages and notifications", async () => {
  await request("/feedback", owner.token, { requestKey: randomUUID(), category: "suggestion", content: "希望增加一个功能按钮" });
  const first = await request("/feedback?limit=1", owner.token);
  assert.equal(first.data.items.length, 1); assert.ok(first.data.nextCursor);
  const second = await request(`/feedback?limit=1&before=${first.data.nextCursor}`, owner.token);
  assert.equal(second.data.items[0].id, feedbackId);
  db.prepare("DELETE FROM users WHERE id=?").run(owner.user.id);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM user_feedback WHERE user_id=?").get(owner.user.id) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM feedback_messages WHERE feedback_id=?").get(feedbackId) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM user_notification_inbox WHERE feedback_id=?").get(feedbackId) as { n: number }).n, 0);
});
