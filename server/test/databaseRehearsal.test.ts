import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { rollbackPreviousCandidateFixture } from "../scripts/database-rehearsal.js";
import { runMigrations } from "../src/storage/migrations.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-rehearsal-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(directory, "fixture.db");
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_URL = "";
process.env.ENABLE_DEMO_SEED = "0";
process.env.ADMIN_INITIAL_PASSWORD = "SyntheticRehearsal1234";
let bootstrap: Database.Database;
let snapshot: Buffer;
before(async () => {
  const storage = await import("../src/storage/db.js");
  bootstrap = storage.db;
  storage.initDatabase();
  // Serialized in-memory clones cannot reopen a WAL file.
  bootstrap.pragma("journal_mode = DELETE");
  snapshot = bootstrap.serialize();
});
after(() => { bootstrap?.close(); fs.rmSync(directory, { recursive: true, force: true }); });

function withFixture(run: (database: Database.Database) => void) {
  const database = new Database(snapshot);
  try { run(database); } finally { database.close(); }
}

test("every current migration after 58 has a rollback fixture and re-applies", () => withFixture(database => {
  const original = database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
  rollbackPreviousCandidateFixture(database, 58);
  assert.equal((database.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any).version, 58);
  runMigrations(database);
  assert.deepEqual(database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all(), original);
  assert.deepEqual(database.pragma("foreign_key_check"), []);
  assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
}));

test("unknown future migrations fail closed without changing the fixture", () => withFixture(database => {
  database.exec("INSERT INTO schema_migrations(version,name) VALUES (91,'future_test')");
  const before = database.serialize();
  assert.throws(() => rollbackPreviousCandidateFixture(database, 58), /needs rollback fixtures for migrations: 91/);
  assert.ok(database.serialize().equals(before));
}));

test("migration 89 fixture preserves parents and restores bookmark constraints and index", () => withFixture(database => {
  database.pragma("foreign_keys = ON");
  database.exec(`INSERT INTO users(id,username,password_hash) VALUES (90001,'fixture-owner','synthetic'),(90002,'fixture-reader','synthetic');
    INSERT INTO community_posts(id,user_id,username,content) VALUES (90001,90001,'fixture-owner','synthetic post');`);
  const users = database.prepare("SELECT * FROM users ORDER BY id").all().map(row => { const { email_verified_at: _verified, ...rest } = row as Record<string, unknown>; return rest; });
  const posts = database.prepare("SELECT * FROM community_posts ORDER BY id").all();
  rollbackPreviousCandidateFixture(database, 88);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='community_post_bookmarks' OR name='idx_community_post_bookmarks_post'").all().length, 0);
  assert.equal(database.prepare("SELECT version FROM schema_migrations WHERE version=89").get(), undefined);
  assert.deepEqual(database.prepare("SELECT * FROM users ORDER BY id").all(), users);
  assert.deepEqual(database.prepare("SELECT * FROM community_posts ORDER BY id").all(), posts);
  runMigrations(database);
  assert.deepEqual(database.prepare("PRAGMA index_info(idx_community_post_bookmarks_post)").all(), [{ seqno: 0, cid: 1, name: "post_id" }]);
  const insert = database.prepare("INSERT INTO community_post_bookmarks(user_id,post_id) VALUES (?,?)");
  insert.run(90001, 90001);
  insert.run(90002, 90001);
  assert.throws(() => insert.run(90001, 90001), /UNIQUE constraint/);
  assert.throws(() => insert.run(99999, 90001), /FOREIGN KEY constraint/);
  assert.throws(() => insert.run(90001, 99999), /FOREIGN KEY constraint/);
  assert.throws(() => insert.run(null, 90001), /NOT NULL constraint/);
  assert.throws(() => insert.run(90001, null), /NOT NULL constraint/);
  const bookmarks = database.prepare("SELECT * FROM community_post_bookmarks ORDER BY user_id").all() as Array<{ created_at: string }>;
  assert.ok(bookmarks.every(bookmark => Number.isFinite(Date.parse(bookmark.created_at))));
  const protectedSnapshot = database.serialize();
  assert.throws(() => rollbackPreviousCandidateFixture(database, 58), /Cannot downgrade fixture containing community bookmarks/);
  assert.ok(database.serialize().equals(protectedSnapshot));
  assert.deepEqual(database.prepare("SELECT * FROM community_post_bookmarks ORDER BY user_id").all(), bookmarks);
  assert.ok(database.prepare("SELECT version FROM schema_migrations WHERE version=89").get());
  runMigrations(database);
  assert.deepEqual(database.prepare("SELECT * FROM community_post_bookmarks ORDER BY user_id").all(), bookmarks);
  database.exec("DELETE FROM users WHERE id=90002");
  assert.equal((database.prepare("SELECT COUNT(*) n FROM community_post_bookmarks").get() as any).n, 1);
  database.exec("DELETE FROM community_posts WHERE id=90001");
  assert.equal((database.prepare("SELECT COUNT(*) n FROM community_post_bookmarks").get() as any).n, 0);
  assert.deepEqual(database.pragma("foreign_key_check"), []);
}));


test("email verification migration preserves legacy accounts as unverified and protects evidence", () => withFixture(database => {
  database.exec("INSERT INTO users(id,username,email,password_hash) VALUES(90003,'email-owner','owner@example.invalid','synthetic')");
  assert.equal((database.prepare("SELECT email_verified_at FROM users WHERE id=90003").get() as any).email_verified_at,null);
  rollbackPreviousCandidateFixture(database,89);
  runMigrations(database);
  database.exec("UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=90003");
  const before=database.serialize();
  assert.throws(() => rollbackPreviousCandidateFixture(database,89),/email verification evidence/);
  assert.ok(database.serialize().equals(before));
}));
