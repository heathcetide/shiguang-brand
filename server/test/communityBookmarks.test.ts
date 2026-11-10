import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { SqliteCommunityRepository } from "../src/modules/community/sqliteRepository.js";
const directory = mkdtempSync(path.join(tmpdir(), "community-bookmarks-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.JWT_SECRET = "bookmark-test-secret-at-least-32-characters";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";
process.env.ENABLE_DEMO_SEED = "0";
let server: Server;
let db: typeof import("../src/storage/db.js").db;
let base: string;
let owner: { token: string; user: { id: number } };
let other: typeof owner;
let postId: number;
async function request(route: string, method = "GET", token?: string, body?: unknown) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() as any };
}
before(async () => {
  const { createApp } = await import("../src/app.js");
  db = (await import("../src/storage/db.js")).db;
  const app = await createApp();
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = (await request("/auth/register", "POST", undefined, { identifier: "bookmark-owner@example.com", username: "收藏用户", password: "Password1234" })).data;
  other = (await request("/auth/register", "POST", undefined, { identifier: "bookmark-other@example.com", username: "其他用户", password: "Password1234" })).data;
  assert.ok(owner.token); assert.ok(other.token);
  const created = await request("/community/posts", "POST", owner.token, { category: "寻味", content: "分享我的健康早餐与日常饮食经验" });
  assert.equal(created.status, 201); postId = created.data.id;
});
after(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); db?.close(); rmSync(directory, { recursive: true, force: true }); });
test("bookmarks require authentication, persist independently and isolate accounts", async () => {
  const route = `/community/posts/${postId}/bookmark`;
  assert.equal((await request(route, "PUT")).status, 401);
  assert.equal((await request(route, "DELETE")).status, 401);
  assert.equal((await request(`/community/posts/${postId}`, "GET", owner.token)).data.is_bookmarked, false);
  const results = await Promise.all(Array.from({ length: 4 }, () => request(route, "PUT", owner.token)));
  for (const result of results) { assert.equal(result.status, 200); assert.deepEqual(result.data, { bookmarked: true }); }
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_post_bookmarks WHERE post_id=?").get(postId) as any).n, 1);
  assert.equal((await request(`/community/posts/${postId}`, "GET", owner.token)).data.is_bookmarked, true);
  assert.equal((await request(`/community/posts/${postId}`, "GET", other.token)).data.is_bookmarked, false);
  assert.equal((await request(`/community/posts/${postId}`)).data.is_bookmarked, false);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM recipe_favorites WHERE user_id=?").get(owner.user.id) as any).n, 0);
  const like = await request(`/community/posts/${postId}/like`, "POST", owner.token);
  assert.equal(like.status, 200); assert.equal(like.data.is_liked, true);
  assert.equal(like.data.likes_count, 1);
  const unlike = await request(`/community/posts/${postId}/like`, "POST", owner.token);
  assert.equal(unlike.data.is_liked, false); assert.equal(unlike.data.likes_count, 0);
  assert.equal((await request(`/community/posts/${postId}`, "GET", owner.token)).data.is_bookmarked, true);
  const reopened = new Database(process.env.DATABASE_PATH!);
  try { assert.equal(Boolean((await new SqliteCommunityRepository(reopened).viewPost(owner.user.id, postId))?.is_bookmarked), true); }
  finally { reopened.close(); }
  const { runMigrations } = await import("../src/storage/migrations.js");
  runMigrations(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_post_bookmarks WHERE post_id=?").get(postId) as any).n, 1);
  await request(route, "PUT", other.token);
  for (let i = 0; i < 2; i++) assert.deepEqual((await request(route, "DELETE", owner.token)).data, { bookmarked: false });
  assert.equal((await request(`/community/posts/${postId}`, "GET", other.token)).data.is_bookmarked, true);
  db.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").run(owner.user.id);
  assert.equal((await request(route, "PUT", owner.token)).status, 401);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_post_bookmarks WHERE user_id=?").get(owner.user.id) as any).n, 0);
  db.prepare("UPDATE users SET session_version=session_version-1 WHERE id=?").run(owner.user.id);
});
test("invalid or removed posts never report successful saves and physical deletion cascades", async () => {
  assert.equal((await request("/community/posts/0/bookmark", "PUT", owner.token)).status, 400);
  assert.equal((await request("/community/posts/99999999/bookmark", "PUT", owner.token)).status, 404);
  db.prepare("UPDATE community_posts SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(postId);
  assert.equal((await request(`/community/posts/${postId}`, "GET", other.token)).status, 404);
  for (const method of ["PUT", "DELETE"]) assert.equal((await request(`/community/posts/${postId}/bookmark`, method, other.token)).status, 404);
  db.prepare("DELETE FROM community_posts WHERE id=?").run(postId);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_post_bookmarks WHERE post_id=?").get(postId) as any).n, 0);
  const created = await request("/community/posts", "POST", owner.token, { category: "寻味", content: "新的一篇健康早餐经验分享" });
  await request(`/community/posts/${created.data.id}/bookmark`, "PUT", other.token);
  db.prepare("DELETE FROM users WHERE id=?").run(other.user.id);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_post_bookmarks WHERE user_id=?").get(other.user.id) as any).n, 0);
});
