import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPostgresBackup,inspectPostgresBackup,restorePostgresBackup } from "../src/services/backup/postgres.js";

export async function verifyPostgresBackup(connectionString: string) {
  const admin = new Pool({ connectionString });
  const suffix = randomUUID().replaceAll("-","");
  const sourceName = `backup_source_${suffix}`; const targetName = `backup_target_${suffix}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),"dietdigidose-pg-backup-"));
  let source: Pool | undefined; let target: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${sourceName}"`); await admin.query(`CREATE DATABASE "${targetName}"`);
    const sourceUrl = new URL(connectionString); sourceUrl.pathname=`/${sourceName}`;
    const targetUrl = new URL(connectionString); targetUrl.pathname=`/${targetName}`;
    source = new Pool({ connectionString: sourceUrl.toString() }); target = new Pool({ connectionString: targetUrl.toString() });
    await source.query("CREATE TABLE users(id integer PRIMARY KEY,name text NOT NULL); CREATE TABLE inventory_items(id integer PRIMARY KEY,user_id integer REFERENCES users(id),quantity numeric); CREATE TABLE schema_migrations(version integer PRIMARY KEY); INSERT INTO schema_migrations VALUES(77); INSERT INTO users VALUES(1,'甲'),(2,'乙'); INSERT INTO inventory_items VALUES(1,1,1.25),(2,2,4.5)");
    await source.query("CREATE SCHEMA backup_transaction_probe; CREATE FUNCTION public.restore_guard() RETURNS integer LANGUAGE sql AS 'SELECT 1'");
    const backup = path.join(directory,"snapshot");
    const report = await createPostgresBackup(sourceUrl.toString(),backup,{ owner: "integration-test",candidateSha: "a".repeat(40) });
    assert.equal(report.migrationVersion,77);
    assert.equal(report.tables.find(row => row.name==='inventory_items')?.rows,'2');
    // Windows reports synthetic POSIX mode bits; ACL permissions are not represented here.
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(backup)).mode & 0o777,0o700);
      assert.equal((await fs.stat(path.join(backup,'database.dump'))).mode & 0o777,0o600);
    }
    await assert.rejects(() => createPostgresBackup(sourceUrl.toString(),backup,{ owner: "test",candidateSha: "a".repeat(40) }),/exist/);
    await source.query("UPDATE inventory_items SET quantity=99 WHERE id=1");
    await assert.rejects(() => restorePostgresBackup(sourceUrl.toString(),backup),/not empty/);
    assert.equal(String((await source.query("SELECT quantity FROM inventory_items WHERE id=1")).rows[0].quantity),'99');
    // A conflicting function causes pg_restore to fail after schema creation.
    // The relation-empty guard permits this target, so the transaction itself must roll back.
    await target.query("CREATE FUNCTION public.restore_guard() RETURNS integer LANGUAGE sql AS 'SELECT 2'");
    await assert.rejects(() => restorePostgresBackup(targetUrl.toString(),backup),/pg_restore failed/);
    assert.equal((await target.query("SELECT to_regnamespace('backup_transaction_probe') AS schema")).rows[0].schema,null);
    assert.equal((await target.query("SELECT to_regclass('public.users') AS relation")).rows[0].relation,null);
    assert.equal((await target.query("SELECT public.restore_guard() AS value")).rows[0].value,2);
    await target.query("DROP FUNCTION public.restore_guard()");
    const restored = await restorePostgresBackup(targetUrl.toString(),backup);
    assert.equal((await target.query("SELECT public.restore_guard() AS value")).rows[0].value,1);
    assert.equal(restored.verified,true); assert.deepEqual(restored.tables,report.tables);
    assert.deepEqual((await target.query("SELECT user_id,quantity::text FROM inventory_items ORDER BY id")).rows,[{ user_id: 1,quantity: '1.25' },{ user_id: 2,quantity: '4.5' }]);
    await assert.rejects(() => target!.query("INSERT INTO inventory_items VALUES(3,99,1)"),/foreign key/);
    await assert.rejects(() => restorePostgresBackup(targetUrl.toString(),backup),/not empty/);
    await fs.appendFile(path.join(backup,'database.dump'),'corruption');
    await assert.rejects(() => inspectPostgresBackup(backup),/checksum|size/);
    await assert.rejects(() => restorePostgresBackup(targetUrl.toString(),backup),/checksum|size/);
    assert.equal((await target.query("SELECT COUNT(*)::int AS n FROM inventory_items")).rows[0].n,2);
  } finally {
    await source?.end(); await target?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${sourceName}"`); await admin.query(`DROP DATABASE IF EXISTS "${targetName}"`);
    await admin.end(); await fs.rm(directory,{ recursive: true,force: true });
  }
}
