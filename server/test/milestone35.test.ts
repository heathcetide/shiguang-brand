import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDirectory = mkdtempSync(path.join(tmpdir(), "dietdigidose-26w35-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.DATABASE_PATH = path.join(testDirectory, "milestone35.db");
process.env.JWT_SECRET = "milestone-35-test-secret-at-least-32-characters";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";
process.env.ENABLE_DEMO_SEED = "0";
process.env.REGISTER_RATE_LIMIT = "3";
process.env.REGISTER_GLOBAL_RATE_LIMIT = "100";
process.env.REGISTER_RATE_LIMIT_WINDOW_MS = "60000";
process.env.COMMUNITY_SHARE_RATE_LIMIT = "4";
process.env.COMMUNITY_SHARE_RATE_LIMIT_WINDOW_MS = "60000";

type JsonObject = Record<string, any>;

let server: Server;
let baseUrl = "";
let db: typeof import("../src/storage/db.js").db;

async function api(pathname: string, options: RequestInit & { token?: string } = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null) as JsonObject | JsonObject[] | null;
  return { response, body };
}

function clearRateLimits(namespace?: string) {
  if (namespace) {
    db.prepare("DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?").run(`${namespace}:%`);
  } else {
    db.prepare("DELETE FROM rate_limit_buckets").run();
  }
}

async function register(identifier: string) {
  clearRateLimits("registration-ip");
  clearRateLimits("registration-global");
  const result = await api("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      identifier,
      username: `周测${identifier.split("@")[0]}`,
      password: "Password1234",
    }),
  });
  assert.equal(result.response.status, 201);
  return result.body as JsonObject;
}

before(async () => {
  const [{ createApp }, database] = await Promise.all([
    import("../src/app.js"),
    import("../src/storage/db.js"),
  ]);
  db = database.db;
  const app = await createApp();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (db) db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("26w35 milestone regressions", () => {
  test("registration is IP-limited before async hashing and recovers after the window", async () => {
    clearRateLimits();
    const registrations = [1, 2, 3].map((index) => api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({
        identifier: `rate-${index}@example.com`,
        username: `限流用户${index}`,
        password: "Password1234",
      }),
    }));
    const healthStartedAt = performance.now();
    const health = await api("/api/v1/health");
    const healthDurationMs = performance.now() - healthStartedAt;
    const results = await Promise.all(registrations);

    assert.equal(health.response.status, 200);
    assert.ok(healthDurationMs < 600, `health check waited ${healthDurationMs.toFixed(1)}ms`);
    assert.deepEqual(results.map((result) => result.response.status), [201, 201, 201]);

    const blocked = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ identifier: "rate-4@example.com", username: "限流用户四", password: "Password1234" }),
    });
    assert.equal(blocked.response.status, 429);
    assert.equal((blocked.body as JsonObject).code, "REGISTER_RATE_LIMITED");
    assert.ok(Number(blocked.response.headers.get("retry-after")) >= 1);

    db.prepare(`
      UPDATE rate_limit_buckets
      SET window_started_at = 0, blocked_until = 0
      WHERE bucket_key LIKE 'registration-ip:%' OR bucket_key LIKE 'registration-global:%'
    `).run();
    const recovered = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ identifier: "rate-recovered@example.com", username: "限流恢复用户", password: "Password1234" }),
    });
    assert.equal(recovered.response.status, 201);
    clearRateLimits();
  });

  test("account deletion transfers owned households and preserves shared records", async () => {
    const owner = await register("owner-delete@example.com");
    const member = await register("member-stays@example.com");
    const created = await api("/api/v1/households", {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({ name: "注销保全家庭" }),
    });
    assert.equal(created.response.status, 201);
    const household = created.body as JsonObject;
    const joined = await api("/api/v1/households/join", {
      method: "POST",
      token: member.token,
      body: JSON.stringify({ invite_code: household.invite_code }),
    });
    assert.equal(joined.response.status, 201);
    const inventory = await api(`/api/v1/households/${household.id}/inventory`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({
        food_name: "共享番茄",
        category: "蔬菜",
        quantity: "3个",
        expiration_date: "2030-01-01",
        storage_location: "冷藏",
      }),
    });
    assert.equal(inventory.response.status, 201);
    const shopping = await api(`/api/v1/households/${household.id}/shopping-list`, {
      method: "POST",
      token: owner.token,
      body: JSON.stringify({ name: "共享牛奶", amount: "2盒", category: "乳制品", storageLocation: "冷藏" }),
    });
    assert.equal(shopping.response.status, 201);

    const deleted = await api("/api/v1/auth/account", {
      method: "DELETE",
      token: owner.token,
      body: JSON.stringify({ password: "Password1234", confirmation: "DELETE" }),
    });
    assert.equal(deleted.response.status, 200);

    const retainedHousehold = db.prepare("SELECT owner_id FROM households WHERE id = ?").get(household.id) as { owner_id: number };
    assert.equal(retainedHousehold.owner_id, member.user.id);
    assert.deepEqual(
      db.prepare("SELECT user_id, role FROM household_members WHERE household_id = ?").all(household.id),
      [{ user_id: member.user.id, role: "owner" }],
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM household_inventory_items WHERE household_id = ?").get(household.id) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM household_shopping_items WHERE household_id = ?").get(household.id) as { count: number }).count, 1);
    const retainedActivity = db.prepare("SELECT operator_user_id FROM household_activity_logs WHERE household_id = ?").all(household.id) as Array<{ operator_user_id: number }>;
    assert.ok(retainedActivity.length >= 2);
    assert.ok(retainedActivity.every((entry) => entry.operator_user_id === member.user.id));
    const memberInventory = await api(`/api/v1/households/${household.id}/inventory`, { token: member.token });
    assert.equal(memberInventory.response.status, 200);
    assert.equal((memberInventory.body as JsonObject[])[0].food_name, "共享番茄");

    const solo = await register("solo-delete@example.com");
    const soloHousehold = await api("/api/v1/households", {
      method: "POST",
      token: solo.token,
      body: JSON.stringify({ name: "单人家庭" }),
    });
    const soloHouseholdId = (soloHousehold.body as JsonObject).id;
    const soloDeleted = await api("/api/v1/auth/account", {
      method: "DELETE",
      token: solo.token,
      body: JSON.stringify({ password: "Password1234", confirmation: "DELETE" }),
    });
    assert.equal(soloDeleted.response.status, 200);
    assert.equal(db.prepare("SELECT id FROM households WHERE id = ?").get(soloHouseholdId), undefined);
  });

  test("share codes are reused, rate-limited, concurrent-safe and lazily cleaned", async () => {
    const author = await register("share-author@example.com");
    const createdPost = await api("/api/v1/community/posts", {
      method: "POST",
      token: author.token,
      body: JSON.stringify({ content: "分享码并发回归", category: "寻味", image_urls: [] }),
    });
    const postId = (createdPost.body as JsonObject).id;
    clearRateLimits("community-share-ip");
    db.prepare("DELETE FROM community_share_codes WHERE post_id = ?").run(postId);

    const concurrent = await Promise.all(Array.from({ length: 4 }, () => api(`/api/v1/community/posts/${postId}/share`, { method: "POST" })));
    assert.ok(concurrent.every((result) => [200, 201].includes(result.response.status)));
    assert.equal(new Set(concurrent.map((result) => (result.body as JsonObject).code)).size, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM community_share_codes WHERE post_id = ?").get(postId) as { count: number }).count, 1);

    const blocked = await api(`/api/v1/community/posts/${postId}/share`, { method: "POST" });
    assert.equal(blocked.response.status, 429);
    assert.equal((blocked.body as JsonObject).code, "COMMUNITY_SHARE_RATE_LIMITED");

    clearRateLimits("community-share-ip");
    const signedInFirst = await api(`/api/v1/community/posts/${postId}/share`, { method: "POST", token: author.token });
    const signedInSecond = await api(`/api/v1/community/posts/${postId}/share`, { method: "POST", token: author.token });
    assert.equal(signedInFirst.response.status, 201);
    assert.equal(signedInSecond.response.status, 200);
    assert.equal((signedInFirst.body as JsonObject).code, (signedInSecond.body as JsonObject).code);
    const landing = await fetch(`${baseUrl}/share/posts/${(signedInFirst.body as JsonObject).code}`);
    const landingHtml = await landing.text();
    assert.equal(landing.status, 200);
    assert.match(landingHtml, /分享码并发回归/);
    assert.match(landingHtml, new RegExp(`dietdigidose://post-detail\\?id=${postId}`));

    db.prepare(`
      INSERT INTO community_share_codes (code, post_id, created_by, expires_at)
      VALUES ('EXPIRED35', ?, NULL, '2020-01-01 00:00:00')
    `).run(postId);
    await api(`/api/v1/community/posts/${postId}/share`, { method: "POST", token: author.token });
    assert.equal(db.prepare("SELECT code FROM community_share_codes WHERE code = 'EXPIRED35'").get(), undefined);
  });

  test("legacy public list calls stay bounded with 10,000 records and cursors remain available", async () => {
    const author = db.prepare("SELECT id, username FROM users ORDER BY id LIMIT 1").get() as { id: number; username: string };
    const insertPost = db.prepare(`
      INSERT INTO community_posts (user_id, username, category, content, created_at)
      VALUES (?, ?, '寻味', ?, datetime('2026-01-01', ?))
    `);
    const insertRecipe = db.prepare(`
      INSERT INTO recipes (
        title, description, cook_time, difficulty, calories, protein, carbs, fat,
        category, tags, steps_json, ingredients_json, source, status, quality_status
      ) VALUES (?, '默认分页压力测试', 15, '简单', 300, 20, 30, 10,
        '快手菜', '[]', '["完成"]', '[{"name":"番茄"}]', 'official', 'approved', 'trusted')
    `);
    db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        insertPost.run(author.id, author.username, `默认分页动态-${index}`, `+${index} seconds`);
        insertRecipe.run(`默认分页食谱-${index}`);
      }
    })();

    const community = await api("/api/v1/community/posts");
    assert.equal(community.response.status, 200);
    assert.ok(Array.isArray(community.body));
    assert.equal((community.body as JsonObject[]).length, 12);
    assert.ok(Number(community.response.headers.get("x-pagination-candidates")) <= 12);

    const recipes = await api("/api/v1/recipes");
    assert.equal(recipes.response.status, 200);
    assert.ok(Array.isArray(recipes.body));
    assert.equal((recipes.body as JsonObject[]).length, 24);
    assert.ok(Number(recipes.response.headers.get("x-pagination-candidates")) <= 24);

    const communityPage = await api("/api/v1/community/posts?pageSize=7");
    assert.equal((communityPage.body as JsonObject).items.length, 7);
    assert.equal(typeof (communityPage.body as JsonObject).nextCursor, "string");
    const recipePage = await api("/api/v1/recipes?pageSize=7");
    assert.equal((recipePage.body as JsonObject).items.length, 7);
    assert.equal(typeof (recipePage.body as JsonObject).nextCursor, "string");
  });

  test("new and returning users receive server-side defaults before AI use", async () => {
    const account = await register("first-ai@example.com");
    assert.ok(db.prepare("SELECT user_id FROM user_health_profiles WHERE user_id = ?").get(account.user.id));
    const immediateAi = await api("/api/v1/ai/home-recommendations", {
      method: "POST",
      token: account.token,
      body: JSON.stringify({ period: "晚餐", requestKey: "first-ai-use" }),
    });
    assert.equal(immediateAi.response.status, 200);
    assert.ok(Array.isArray((immediateAi.body as JsonObject).cards));

    db.prepare("DELETE FROM user_health_profiles WHERE user_id = ?").run(account.user.id);
    const login = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: "first-ai@example.com", password: "Password1234" }),
    });
    assert.equal(login.response.status, 200);
    assert.ok(db.prepare("SELECT user_id FROM user_health_profiles WHERE user_id = ?").get(account.user.id));
  });
});
