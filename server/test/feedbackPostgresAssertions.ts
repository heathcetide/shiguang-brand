import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresFeedbackRepository } from "../src/modules/feedback/postgresRepository.js";
import { FeedbackService } from "../src/modules/feedback/service.js";
export async function verifyFeedbackPostgres(pool: Pool, adminId: number) {
  const userId = Number((await pool.query("INSERT INTO users(username,email,password_hash) VALUES('feedback-pg','feedback-pg@example.com','fixture') RETURNING id")).rows[0].id);
  const service = new FeedbackService(new PostgresFeedbackRepository(pool));
  const body = { requestKey: randomUUID(), category: "issue" as const, content: "PG 反馈问题内容", context: { page: "feedback", platform: "web" as const } };
  const [first, replay] = await Promise.all([service.create(userId, body), service.create(userId, body)]);
  assert.equal(first.id, replay.id);
  await assert.rejects(service.create(userId, { ...body, content: "different" }), /同一请求/);
  assert.equal((await service.list(userId, { limit: 20 })).items.length, 1);
  await assert.rejects(service.detail(adminId, first.id), /不存在/);
  const reply = { requestKey: randomUUID(), content: "请补充详情", version: 1, status: "waiting_user" as const };
  const duplicates = await Promise.all([service.reply(adminId, true, first.id, reply), service.reply(adminId, true, first.id, reply)]);
  assert.equal(duplicates[0].version, 2); assert.equal(duplicates[1].messages.length, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM user_notification_inbox WHERE feedback_id=$1", [first.id])).rows[0].n, 1);
  await service.reply(adminId, true, first.id, { requestKey: randomUUID(), content: "内部核查内容", version: 2, visibility: "internal" });
  assert.equal((await service.detail(userId, first.id)).messages.length, 1);
  assert.equal((await service.detail(null, first.id)).messages.length, 2);
  const races = await Promise.allSettled(["第一次补充", "第二次补充"].map(content => service.reply(userId, false, first.id, { requestKey: randomUUID(), content, version: 3 })));
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  await pool.query("CREATE FUNCTION feedback_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='feedback_reply' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER feedback_fixture_failure BEFORE INSERT ON user_notification_inbox FOR EACH ROW EXECUTE FUNCTION feedback_fixture_failure()");
  try {
    await assert.rejects(service.reply(adminId, true, first.id, { requestKey: randomUUID(), content: "解决了", version: 4, status: "resolved" }));
    assert.equal((await service.detail(userId, first.id)).version, 4);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM admin_audit_logs WHERE resource_type='feedback' AND resource_id=$1", [String(first.id)])).rows[0].n, 2);
  } finally {
    await pool.query("DROP TRIGGER feedback_fixture_failure ON user_notification_inbox");
    await pool.query("DROP FUNCTION feedback_fixture_failure()");
  }
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM feedback_messages WHERE feedback_id=$1", [first.id])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM user_notification_inbox WHERE feedback_id=$1", [first.id])).rows[0].n, 0);
}
