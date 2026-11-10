import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { RateLimitsService, hashRateLimitKey } from "../src/modules/rateLimits/service.js";
import { SqliteRateLimitsRepository } from "../src/modules/rateLimits/sqliteRepository.js";

function service() {
  const database = new Database(":memory:");
  database.exec(`CREATE TABLE rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return { database, value: new RateLimitsService(new SqliteRateLimitsRepository(database)) };
}

describe("rate limits module", () => {
  test("hashes raw identifiers before persistence", () => {
    const key = hashRateLimitKey("login-account", "person@example.com");
    assert.match(key, /^login-account:[a-f0-9]{64}$/);
    assert.equal(key.includes("person@example.com"), false);
  });

  test("consumes a shared window and recovers after expiry", async () => {
    const { database, value } = service();
    try {
      assert.equal((await value.consume("registration-ip", "127.0.0.1", 2, 1_000, 10_000)).blocked, false);
      assert.equal((await value.consume("registration-ip", "127.0.0.1", 2, 1_000, 10_100)).blocked, false);
      assert.deepEqual(await value.consume("registration-ip", "127.0.0.1", 2, 1_000, 10_200), {
        blocked: true, retryAfterSeconds: 1,
      });
      assert.equal((await value.consume("registration-ip", "127.0.0.1", 2, 1_000, 11_001)).blocked, false);
    } finally { database.close(); }
  });

  test("blocks repeated account failures and clears only that account", async () => {
    const { database, value } = service();
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await value.recordLoginFailure("Person@Example.com", "127.0.0.1", 20_000 + attempt);
      }
      const blocked = await value.loginStatus("person@example.com", "192.0.2.1", 20_010);
      assert.equal(blocked.blocked, true);
      assert.equal(blocked.retryAfterSeconds, 900);
      await value.clearLoginFailures("PERSON@example.com");
      assert.equal((await value.loginStatus("person@example.com", "192.0.2.1", 20_011)).blocked, false);
      assert.equal((await value.loginStatus("another@example.com", "127.0.0.1", 20_011)).blocked, false);
    } finally { database.close(); }
  });
});
