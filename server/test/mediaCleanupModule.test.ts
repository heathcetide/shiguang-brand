import Database from "better-sqlite3";
import { SqliteMediaCleanupRepository } from "../src/modules/mediaCleanup/sqliteRepository.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MediaCleanupRepository } from "../src/modules/mediaCleanup/repository.js";
import { MediaCleanupService, sanitizeMediaCleanupError } from "../src/modules/mediaCleanup/service.js";

function repository(overrides: Partial<MediaCleanupRepository> = {}): MediaCleanupRepository {
  return {
    enqueue: async () => 1,
    claim: async () => null,
    complete: async () => false,
    release: async () => undefined,
    pending: async () => [],
    job: async () => null,
    list: async () => ({ rows: [], total: 0, summary: {} }),
    ...overrides,
  };
}

describe("media cleanup module", () => {
  test("claims, deletes JSONB references and commits only with the claim token", async () => {
    const completed: Array<[number, string]> = [];
    const deleted: unknown[] = [];
    const service = new MediaCleanupService(repository({
      claim: async () => ({ id: 9, owner_user_id: 3, urls_json: ["/media/uploads/a.png"],
        objects_json: [{ backend: "local", path: "/tmp/a.png" }], status: "processing", attempts: 1,
        last_error: null, created_at: new Date(), updated_at: new Date(), completed_at: null,
        claim_token: "claim-9", claimed_at: new Date() }),
      complete: async (id, token) => { completed.push([id, token]); return true; },
    }), async (references) => { deleted.push(...references); });
    assert.equal(await service.process(9), true);
    assert.deepEqual(deleted, [{ backend: "local", path: "/tmp/a.png" }]);
    assert.deepEqual(completed, [[9, "claim-9"]]);
  });

  test("releases failed jobs with a redacted error", async () => {
    let released = "";
    const service = new MediaCleanupService(repository({
      claim: async () => ({ id: 4, owner_user_id: 3, urls_json: [], objects_json: [], status: "processing", attempts: 1,
        last_error: null, created_at: "2026-09-01", updated_at: "2026-09-01", completed_at: null,
        claim_token: "claim-4", claimed_at: "2026-09-01" }),
      release: async (_id, _token, error) => { released = error; },
    }), async () => { throw new Error("service_role_key=secret https://private.example/object"); });
    await assert.rejects(() => service.process(4));
    assert.equal(released.includes("secret"), false);
    assert.equal(released.includes("private.example"), false);
    assert.match(sanitizeMediaCleanupError("/media/uploads/private.png"), /已隐藏媒体路径/);
  });

  test("keeps legacy jobs pending across an origin change and retries after configuration is restored", async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const oldOrigin = "https://old-project.example";
    const url = `${oldOrigin}/storage/v1/object/public/community-media/community/3/photo.png`;
    let attempt = 0;
    let releasedError = "";
    const deleted: unknown[] = [];
    const completed: Array<[number, string]> = [];
    const service = new MediaCleanupService(repository({
      claim: async () => {
        attempt += 1;
        return { id: 8, owner_user_id: 3, urls_json: [url], objects_json: null, status: "processing", attempts: attempt,
          last_error: null, created_at: new Date(), updated_at: new Date(), completed_at: null,
          claim_token: `claim-${attempt}`, claimed_at: new Date() };
      },
      complete: async (id, token) => { completed.push([id, token]); return true; },
      release: async (_id, _token, error) => { releasedError = error; },
    }), async (references) => { deleted.push(...references); });

    try {
      process.env.SUPABASE_URL = "https://new-project.example";
      await assert.rejects(() => service.process(8), /无法定位任何存储对象/);
      assert.deepEqual(deleted, []);
      assert.deepEqual(completed, []);
      assert.match(releasedError, /保留等待重试/);

      process.env.SUPABASE_URL = oldOrigin;
      assert.equal(await service.process(8), true);
      assert.deepEqual(deleted, [{
        backend: "supabase",
        origin: oldOrigin,
        bucket: "community-media",
        objectPath: "community/3/photo.png",
      }]);
      assert.deepEqual(completed, [[8, "claim-2"]]);
    } finally {
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
    }
  });
});


test("failed legacy batches rotate behind untouched jobs and remain recoverable", async (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE media_cleanup_jobs (
    id INTEGER PRIMARY KEY, owner_user_id INTEGER, urls_json TEXT, objects_json TEXT,
    status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, last_error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT, claim_token TEXT, claimed_at TEXT
  )`);
  const repo = new SqliteMediaCleanupRepository(db);
  const oldOrigin = "https://retired.example";
  const previous = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://current.example";
  t.after(() => { if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous; });
  for (let id = 1; id <= 25; id += 1) {
    db.prepare("INSERT INTO media_cleanup_jobs(id,owner_user_id,urls_json) VALUES(?,3,?)").run(id,
      JSON.stringify([`${oldOrigin}/storage/v1/object/public/community-media/community/3/${id}.png`]));
  }
  const validId = await repo.enqueue(3, ["/media/uploads/valid.png"], [{ backend: "local", path: "/tmp/valid.png" }]);
  const deleted: unknown[] = [];
  const service = new MediaCleanupService(repo, async refs => { deleted.push(...refs); });
  t.mock.method(console, "error", () => undefined);
  assert.deepEqual(await service.processPending(), { checked: 25, completed: 0, failed: 25 });
  assert.equal((await service.processPending()).completed, 1);
  assert.equal((await service.job(validId))?.status, "completed");
  assert.deepEqual(deleted, [{ backend: "local", path: "/tmp/valid.png" }]);
  assert.equal((await service.job(1))?.status, "pending");
  process.env.SUPABASE_URL = oldOrigin;
  assert.equal((await service.processPending()).completed, 25);
  assert.equal((await service.job(1))?.status, "completed");
  const id = await repo.enqueue(3, [], []);
  assert.ok(await repo.claim(id, "winner", 30));
  assert.equal(await repo.claim(id, "loser", 30), null);
  assert.equal(await repo.complete(id, "loser"), false);
  assert.equal(await repo.complete(id, "winner"), true);
});
