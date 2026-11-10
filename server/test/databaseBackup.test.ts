import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { createDatabaseBackup, inspectDatabase, restoreDatabaseBackup } from "../scripts/database-backup.js";

let directory = "";
let sourcePath = "";
let backupPath = "";

before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-backup-test-"));
  sourcePath = path.join(directory, "source.db");
  backupPath = path.join(directory, "backup.db");
  const database = new Database(sourcePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO schema_migrations (version, name) VALUES (59, 'test');
    CREATE TABLE users (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);
    INSERT INTO users (id, marker) VALUES (1, 'before-backup');
  `);
  database.close();
});

after(() => fs.rmSync(directory, { recursive: true, force: true }));

test("online backup records integrity, size, checksum, schema and core counts", async () => {
  const backup = await createDatabaseBackup(sourcePath, backupPath);
  assert.equal(backup.integrityCheck, "ok");
  assert.equal(backup.migrationVersion, 59);
  assert.equal(backup.tableCounts.users, 1);
  assert.ok(backup.bytes > 0);
  assert.match(backup.sha256, /^[a-f0-9]{64}$/);
  assert.ok(backup.durationMs >= 0);
  await assert.rejects(() => createDatabaseBackup(sourcePath, backupPath), /already exists/);
});

test("inspection snapshots uncheckpointed WAL data instead of hashing only the main file", async () => {
  const livePath = path.join(directory, "live.db");
  const writer = new Database(livePath);
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_autocheckpoint = 0");
  writer.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO schema_migrations (version, name) VALUES (59, 'live');
    CREATE TABLE users (id INTEGER PRIMARY KEY, marker TEXT NOT NULL);
    INSERT INTO users (id, marker) VALUES (1, 'uncheckpointed');
  `);
  try {
    assert.ok(fs.statSync(`${livePath}-wal`).size > 0);
    const inspected = await inspectDatabase(livePath);
    assert.equal(inspected.migrationVersion, 59);
    assert.equal(inspected.tableCounts.users, 1);
    assert.ok(inspected.bytes > fs.statSync(livePath).size);
  } finally {
    writer.close();
  }
});

test("restore preserves the current database and recovers the verified backup", async () => {
  const current = new Database(sourcePath);
  current.prepare("UPDATE users SET marker = 'after-backup' WHERE id = 1").run();
  current.close();

  const restored = await restoreDatabaseBackup(sourcePath, backupPath);
  assert.ok(restored.safetyPath);
  assert.ok(fs.existsSync(restored.safetyPath!));
  assert.equal(restored.sha256, restored.backupSha256);
  const restoredDatabase = new Database(sourcePath, { readonly: true });
  assert.equal((restoredDatabase.prepare("SELECT marker FROM users WHERE id = 1").get() as { marker: string }).marker, "before-backup");
  restoredDatabase.close();
  const safetyDatabase = new Database(restored.safetyPath!, { readonly: true });
  assert.equal((safetyDatabase.prepare("SELECT marker FROM users WHERE id = 1").get() as { marker: string }).marker, "after-backup");
  safetyDatabase.close();
});

test("an invalid backup is rejected before the current database is touched", async () => {
  const invalidPath = path.join(directory, "invalid.db");
  fs.writeFileSync(invalidPath, "not a sqlite database");
  const before = await inspectDatabase(sourcePath);
  const safetyArtifactsBefore = fs.readdirSync(directory).filter((name) => name.includes("before-restore")).sort();
  await assert.rejects(() => restoreDatabaseBackup(sourcePath, invalidPath));
  const after = await inspectDatabase(sourcePath);
  assert.equal(after.sha256, before.sha256);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes("before-restore")).sort(), safetyArtifactsBefore);
});
