import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import {
  buildUpsertStatement,
  exportMigrationArchive,
  postgresParameter,
  readArchive,
  topologicalTableOrder,
  transformValue,
  type BaselineManifest,
} from "../src/storage/database/postgres/migration.js";

const baseline: BaselineManifest = {
  version: 1,
  sourceSchemaSha256: "unit-test-schema",
  tableCount: 2,
  indexCount: 0,
  foreignKeyCount: 1,
  tables: [
    {
      name: "parents",
      autoIncrement: true,
      primaryKey: ["id"],
      foreignKeys: [],
      columns: [
        { name: "id", sqliteType: "INTEGER", postgresType: "integer", transform: "identity", nullable: false },
        { name: "enabled", sqliteType: "INTEGER", postgresType: "boolean", transform: "0/1 -> false/true", nullable: false },
        { name: "payload_json", sqliteType: "TEXT", postgresType: "jsonb", transform: "JSON text -> jsonb", nullable: false },
        { name: "created_at", sqliteType: "DATETIME", postgresType: "timestamp with time zone", transform: "SQLite UTC datetime -> timestamptz", nullable: false },
      ],
    },
    {
      name: "children",
      autoIncrement: false,
      primaryKey: ["parent_id", "name"],
      foreignKeys: [{
        column: "parent_id",
        referencedTable: "parents",
        referencedColumn: "id",
        onUpdate: "no action",
        onDelete: "cascade",
      }],
      columns: [
        { name: "parent_id", sqliteType: "INTEGER", postgresType: "integer", transform: "identity", nullable: false },
        { name: "name", sqliteType: "TEXT", postgresType: "text", transform: "identity", nullable: false },
      ],
    },
  ],
};

describe("SQLite to PostgreSQL migration archive", () => {
  test("exports deterministic transformed rows without changing the source", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-migration-test-"));
    const sqlitePath = path.join(directory, "source.db");
    const archivePath = path.join(directory, "archive");
    const database = new Database(sqlitePath);
    context.after(() => {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE parents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enabled INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at DATETIME NOT NULL
      );
      CREATE TABLE children (
        parent_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (parent_id, name),
        FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
      );
      INSERT INTO parents (enabled, payload_json, created_at)
      VALUES (1, '{"z":1,"a":{"two":2,"one":1}}', '2026-09-01 08:30:00');
      INSERT INTO children (parent_id, name) VALUES (1, 'child');
    `);

    const manifest = exportMigrationArchive({ database, sqlitePath, outputDirectory: archivePath, baseline });
    assert.equal(manifest.sourceFileSha256Before, manifest.sourceFileSha256After);
    assert.equal(manifest.version, 2);
    assert.equal(manifest.langgraph.sourcePresent, false);
    assert.equal(manifest.langgraph.checkpoints.rowCount, 0);
    assert.deepEqual(manifest.tables.map((table) => [table.name, table.rowCount]), [["parents", 1], ["children", 1]]);
    const parentRow = JSON.parse(fs.readFileSync(path.join(archivePath, "parents.ndjson"), "utf8"));
    assert.deepEqual(parentRow, {
      created_at: "2026-09-01T08:30:00.000Z",
      enabled: true,
      id: 1,
      payload_json: { a: { one: 1, two: 2 }, z: 1 },
    });
    assert.equal(readArchive(archivePath, baseline).manifest.tables.length, 2);
  });

  test("archives SQLiteSaver typed checkpoints and writes without lossy JSON conversion", async (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-checkpoint-archive-test-"));
    const sqlitePath = path.join(directory, "source.db");
    const archivePath = path.join(directory, "archive");
    const database = new Database(sqlitePath);
    context.after(() => {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, enabled INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at DATETIME NOT NULL);
      CREATE TABLE children (parent_id INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (parent_id, name), FOREIGN KEY (parent_id) REFERENCES parents(id));
    `);
    const saver = new SqliteSaver(database);
    const config = await saver.put(
      { configurable: { thread_id: "run-1", checkpoint_ns: "" } },
      {
        v: 4, id: "00000000-0000-6000-8000-000000000001", ts: new Date(0).toISOString(),
        channel_values: { payload: new Uint8Array([0, 1, 255]) }, channel_versions: { payload: "1" }, versions_seen: {},
      },
      { source: "input", step: 0, parents: {} },
    );
    await saver.putWrites(config, [["result", { ok: true }]], "task-1");

    const manifest = exportMigrationArchive({ database, sqlitePath, outputDirectory: archivePath, baseline });
    assert.equal(manifest.langgraph.sourcePresent, true);
    assert.deepEqual([manifest.langgraph.checkpoints.rowCount, manifest.langgraph.writes.rowCount], [1, 1]);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(archivePath, manifest.langgraph.checkpoints.file), "utf8"));
    const write = JSON.parse(fs.readFileSync(path.join(archivePath, manifest.langgraph.writes.file), "utf8"));
    assert.equal(Buffer.from(checkpoint.checkpoint_base64, "base64").length > 0, true);
    assert.equal(Buffer.from(write.value_base64, "base64").length > 0, true);
    assert.equal(readArchive(archivePath, baseline).manifest.langgraph.checkpoints.sha256,
      manifest.langgraph.checkpoints.sha256);
    fs.appendFileSync(path.join(archivePath, manifest.langgraph.writes.file), "{}\n");
    assert.throws(() => readArchive(archivePath, baseline), /checksum mismatch/);
  });

  test("rejects a changed archive file", (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dietdigidose-migration-tamper-"));
    const sqlitePath = path.join(directory, "source.db");
    const archivePath = path.join(directory, "archive");
    const database = new Database(sqlitePath);
    context.after(() => {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    database.pragma("foreign_keys = ON");
    database.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY AUTOINCREMENT, enabled INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at DATETIME NOT NULL);
      CREATE TABLE children (parent_id INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (parent_id, name), FOREIGN KEY (parent_id) REFERENCES parents(id));
    `);
    exportMigrationArchive({ database, sqlitePath, outputDirectory: archivePath, baseline });
    fs.appendFileSync(path.join(archivePath, "parents.ndjson"), "{}\n");
    assert.throws(() => readArchive(archivePath, baseline), /checksum mismatch/);
  });

  test("orders parent tables and rejects dependency cycles", () => {
    assert.deepEqual(topologicalTableOrder(baseline.tables).map((table) => table.name), ["parents", "children"]);
    const cyclic = structuredClone(baseline.tables);
    cyclic[0]!.foreignKeys.push({
      column: "id",
      referencedTable: "children",
      referencedColumn: "parent_id",
      onUpdate: "no action",
      onDelete: "no action",
    });
    assert.throws(() => topologicalTableOrder(cyclic), /dependency cycle/);
  });

  test("builds idempotent composite-key upserts", () => {
    const statement = buildUpsertStatement(baseline.tables[1]!, 2);
    assert.match(statement, /ON CONFLICT \("parent_id", "name"\) DO NOTHING$/);
    assert.match(statement, /\(\$1, \$2\), \(\$3, \$4\)/);
  });

  test("fails closed on invalid booleans, JSON, and timestamps", () => {
    assert.throws(() => transformValue(2, baseline.tables[0]!.columns[1]!), /invalid SQLite boolean/);
    assert.throws(() => transformValue("{", baseline.tables[0]!.columns[2]!), /invalid JSON/);
    assert.throws(() => transformValue("not-a-date", baseline.tables[0]!.columns[3]!), /invalid datetime/);
  });

  test("serializes JSON arrays explicitly instead of PostgreSQL array literals", () => {
    assert.equal(postgresParameter(["空气炸锅烤箱"], baseline.tables[0]!.columns[2]!), '["空气炸锅烤箱"]');
  });
});
