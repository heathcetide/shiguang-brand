import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MemorySaver, type Checkpoint, type CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import type Database from "better-sqlite3";
import type { PoolClient } from "pg";

export type BaselineColumn = {
  name: string;
  sqliteType: string;
  postgresType: string;
  transform: "identity" | "0/1 -> false/true" | "safe integer -> bigint" | "JSON text -> jsonb" | "SQLite UTC datetime -> timestamptz";
  nullable: boolean;
};

export type BaselineTable = {
  name: string;
  autoIncrement: boolean;
  primaryKey: string[];
  foreignKeys: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
    onUpdate: string;
    onDelete: string;
  }>;
  columns: BaselineColumn[];
};

export type BaselineManifest = {
  version: number;
  sourceSchemaSha256: string;
  tableCount: number;
  indexCount: number;
  foreignKeyCount: number;
  tables: BaselineTable[];
};

export type ArchiveTable = {
  name: string;
  file: string;
  rowCount: number;
  sha256: string;
};

export type ArchiveManifest = {
  version: 2;
  exportedAt: string;
  sourceFileSha256Before: string;
  sourceFileSha256After: string;
  baselineSchemaSha256: string;
  tables: ArchiveTable[];
  langgraph: {
    version: 1;
    sourcePresent: boolean;
    checkpoints: ArchiveTable;
    writes: ArchiveTable;
  };
  criticalMetrics: Record<string, number>;
};

type ArchivedCheckpoint = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string;
  checkpoint_base64: string;
  metadata_base64: string;
};

type ArchivedCheckpointWrite = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  task_id: string;
  idx: number;
  channel: string;
  type: string;
  value_base64: string;
};

type SqliteExportTable = Pick<BaselineTable, "name" | "primaryKey"> & { columns: Array<{ name: string }> };

const LANGGRAPH_SQLITE_TABLES = {
  checkpoints: {
    name: "checkpoints",
    primaryKey: ["thread_id", "checkpoint_ns", "checkpoint_id"],
    columns: ["thread_id", "checkpoint_ns", "checkpoint_id", "parent_checkpoint_id", "type", "checkpoint", "metadata"]
      .map((name) => ({ name })),
  },
  writes: {
    name: "writes",
    primaryKey: ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx"],
    columns: ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx", "channel", "type", "value"]
      .map((name) => ({ name })),
  },
} satisfies Record<string, SqliteExportTable>;

const CRITICAL_METRICS = [
  { name: "inventory.quantity_value", table: "inventory_items", column: "quantity_value" },
  { name: "diet.calories", table: "diet_records", column: "calories" },
  { name: "health.weight", table: "health_logs", column: "weight" },
  { name: "ai.total_tokens", table: "ai_usage_logs", column: "total_tokens" },
] as const;

export function quotePgIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function stableValue(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __bytea_base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function transformValue(value: unknown, column: BaselineColumn): unknown {
  if (value == null) return null;
  if (column.transform === "0/1 -> false/true") {
    if (value === true || value === 1 || value === "1") return true;
    if (value === false || value === 0 || value === "0") return false;
    throw new Error(`${column.name} contains an invalid SQLite boolean: ${String(value)}`);
  }
  if (column.transform === "safe integer -> bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`${column.name} contains an unsafe JavaScript integer: ${String(value)}`);
    return number;
  }
  if (column.transform === "JSON text -> jsonb") {
    if (typeof value === "string") {
      try {
        return stableValue(JSON.parse(value));
      } catch {
        throw new Error(`${column.name} contains invalid JSON`);
      }
    }
    return stableValue(value);
  }
  if (column.transform === "SQLite UTC datetime -> timestamptz") {
    const date = value instanceof Date
      ? value
      : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(value))
        ? String(value)
        : `${String(value).replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) throw new Error(`${column.name} contains an invalid datetime: ${String(value)}`);
    return date.toISOString();
  }
  if (column.postgresType === "bytea") {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    return { __bytea_base64: bytes.toString("base64") };
  }
  return value;
}

export function postgresParameter(value: unknown, column: BaselineColumn) {
  if (value == null) return null;
  if (column.postgresType === "jsonb") return JSON.stringify(value);
  if (column.postgresType === "bytea" && typeof value === "object" && "__bytea_base64" in value) {
    return Buffer.from(String((value as { __bytea_base64: unknown }).__bytea_base64), "base64");
  }
  return value;
}

export function topologicalTableOrder(tables: BaselineTable[]) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const dependencies = new Map(tables.map((table) => [
    table.name,
    new Set(table.foreignKeys.map((foreignKey) => foreignKey.referencedTable).filter((name) => name !== table.name)),
  ]));
  for (const [tableName, parents] of dependencies) {
    for (const parent of parents) if (!byName.has(parent)) throw new Error(`${tableName} references unknown table ${parent}`);
  }
  const ordered: BaselineTable[] = [];
  const remaining = new Set(byName.keys());
  while (remaining.size) {
    const ready = [...remaining].filter((name) => [...dependencies.get(name)!].every((parent) => !remaining.has(parent))).sort();
    if (!ready.length) throw new Error(`PostgreSQL import dependency cycle: ${[...remaining].sort().join(", ")}`);
    for (const name of ready) {
      ordered.push(byName.get(name)!);
      remaining.delete(name);
    }
  }
  return ordered;
}

function sha256File(filePath: string) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function writeArchiveRows(outputDirectory: string, name: string, file: string, rows: Iterable<Record<string, unknown>>) {
  const filePath = path.join(outputDirectory, file);
  const descriptor = fs.openSync(filePath, "wx");
  const hash = createHash("sha256");
  let rowCount = 0;
  try {
    for (const row of rows) {
      const line = `${canonicalJson(row)}\n`;
      fs.writeSync(descriptor, line);
      hash.update(line);
      rowCount += 1;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { name, file, rowCount, sha256: hash.digest("hex") } satisfies ArchiveTable;
}

function requiredBlobBase64(value: unknown, label: string) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new Error(`${label} is not a SQLite blob`);
  return Buffer.from(value).toString("base64");
}

function* mapRows<T>(rows: Iterable<T>, transform: (row: T) => Record<string, unknown>) {
  for (const row of rows) yield transform(row);
}

function exportLangGraphArchive(database: Database.Database, outputDirectory: string) {
  const checkpointColumns = sqliteTableColumns(database, LANGGRAPH_SQLITE_TABLES.checkpoints.name);
  const writeColumns = sqliteTableColumns(database, LANGGRAPH_SQLITE_TABLES.writes.name);
  if (Boolean(checkpointColumns.length) !== Boolean(writeColumns.length)) {
    throw new Error("SQLite LangGraph checkpoint schema is incomplete");
  }
  const sourcePresent = checkpointColumns.length > 0;
  if (sourcePresent) {
    for (const [table, actualColumns] of [
      [LANGGRAPH_SQLITE_TABLES.checkpoints, checkpointColumns],
      [LANGGRAPH_SQLITE_TABLES.writes, writeColumns],
    ] as const) {
      const actual = new Set(actualColumns.map((column) => column.name));
      const missing = table.columns.filter((column) => !actual.has(column.name)).map((column) => column.name);
      if (missing.length) throw new Error(`SQLite LangGraph ${table.name} is missing columns: ${missing.join(", ")}`);
    }
  }
  const checkpointRows = sourcePresent
    ? tableRows(database, LANGGRAPH_SQLITE_TABLES.checkpoints)
    : [];
  const checkpoints = writeArchiveRows(outputDirectory, "langgraph_checkpoints", "langgraph-checkpoints.ndjson",
    mapRows(checkpointRows, (row) => ({
      thread_id: String(row.thread_id), checkpoint_ns: String(row.checkpoint_ns), checkpoint_id: String(row.checkpoint_id),
      parent_checkpoint_id: row.parent_checkpoint_id == null ? null : String(row.parent_checkpoint_id),
      type: String(row.type || "json"),
      checkpoint_base64: requiredBlobBase64(row.checkpoint, "checkpoints.checkpoint"),
      metadata_base64: requiredBlobBase64(row.metadata, "checkpoints.metadata"),
    })));
  const writeRows = sourcePresent
    ? tableRows(database, LANGGRAPH_SQLITE_TABLES.writes)
    : [];
  const writes = writeArchiveRows(outputDirectory, "langgraph_writes", "langgraph-writes.ndjson",
    mapRows(writeRows, (row) => ({
      thread_id: String(row.thread_id), checkpoint_ns: String(row.checkpoint_ns), checkpoint_id: String(row.checkpoint_id),
      task_id: String(row.task_id), idx: Number(row.idx), channel: String(row.channel), type: String(row.type || "json"),
      value_base64: requiredBlobBase64(row.value, "writes.value"),
    })));
  return { version: 1 as const, sourcePresent, checkpoints, writes };
}

function sqliteTableColumns(database: Database.Database, tableName: string) {
  return database.prepare(`PRAGMA table_info(${quotePgIdentifier(tableName)})`).all() as Array<{ name: string }>;
}

function assertSourceSchema(database: Database.Database, baseline: BaselineManifest) {
  const integrity = database.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error(`SQLite integrity_check failed: ${canonicalJson(integrity)}`);
  const foreignKeyFailures = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyFailures.length) throw new Error(`SQLite foreign_key_check failed: ${canonicalJson(foreignKeyFailures.slice(0, 20))}`);
  for (const table of baseline.tables) {
    const actual = sqliteTableColumns(database, table.name);
    if (!actual.length) throw new Error(`SQLite source is missing table ${table.name}`);
    const actualNames = new Set(actual.map((column) => column.name));
    const missing = table.columns.filter((column) => !actualNames.has(column.name)).map((column) => column.name);
    if (missing.length) throw new Error(`SQLite source ${table.name} is missing columns: ${missing.join(", ")}`);
  }
}

function tableRows(database: Database.Database, table: SqliteExportTable) {
  const columns = table.columns.map((column) => quotePgIdentifier(column.name)).join(", ");
  const order = table.primaryKey.map(quotePgIdentifier).join(", ");
  return database.prepare(`SELECT ${columns} FROM ${quotePgIdentifier(table.name)} ORDER BY ${order}`).iterate() as Iterable<Record<string, unknown>>;
}

function transformedRow(row: Record<string, unknown>, table: BaselineTable) {
  return Object.fromEntries(table.columns.map((column) => [column.name, transformValue(row[column.name], column)]));
}

function criticalMetricsFromSqlite(database: Database.Database, baseline: BaselineManifest) {
  const tableNames = new Set(baseline.tables.map((table) => table.name));
  return Object.fromEntries(CRITICAL_METRICS.filter((metric) => tableNames.has(metric.table)).map((metric) => {
    const row = database.prepare(`SELECT COALESCE(SUM(${quotePgIdentifier(metric.column)}), 0) AS value FROM ${quotePgIdentifier(metric.table)}`).get() as { value: number };
    return [metric.name, Number(row.value)];
  }));
}

export function exportMigrationArchive(options: {
  database: Database.Database;
  sqlitePath: string;
  outputDirectory: string;
  baseline: BaselineManifest;
}) {
  const sourcePath = path.resolve(options.sqlitePath);
  const outputDirectory = path.resolve(options.outputDirectory);
  if (outputDirectory === path.parse(outputDirectory).root || outputDirectory === path.dirname(outputDirectory)) {
    throw new Error(`Unsafe migration archive directory: ${outputDirectory}`);
  }
  if (fs.existsSync(outputDirectory)) throw new Error(`Migration archive directory already exists: ${outputDirectory}`);
  assertSourceSchema(options.database, options.baseline);
  const dataVersionBefore = options.database.pragma("data_version", { simple: true }) as number;
  const sourceFileSha256Before = sha256File(sourcePath);
  fs.mkdirSync(outputDirectory, { recursive: false });
  const archiveTables: ArchiveTable[] = [];
  for (const table of topologicalTableOrder(options.baseline.tables)) {
    const file = `${table.name}.ndjson`;
    archiveTables.push(writeArchiveRows(outputDirectory, table.name, file,
      mapRows(tableRows(options.database, table), (row) => transformedRow(row, table))));
  }
  const langgraph = exportLangGraphArchive(options.database, outputDirectory);
  const sourceFileSha256After = sha256File(sourcePath);
  const dataVersionAfter = options.database.pragma("data_version", { simple: true }) as number;
  if (dataVersionAfter !== dataVersionBefore) throw new Error("SQLite source received writes while exporting; discard the archive and retry during a write freeze");
  if (sourceFileSha256After !== sourceFileSha256Before) throw new Error("SQLite source changed while exporting; discard the archive and retry during a write freeze");
  const manifest: ArchiveManifest = {
    version: 2,
    exportedAt: new Date().toISOString(),
    sourceFileSha256Before,
    sourceFileSha256After,
    baselineSchemaSha256: options.baseline.sourceSchemaSha256,
    tables: archiveTables,
    langgraph,
    criticalMetrics: criticalMetricsFromSqlite(options.database, options.baseline),
  };
  fs.writeFileSync(path.join(outputDirectory, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export function readArchive(archiveDirectory: string, baseline: BaselineManifest) {
  const root = path.resolve(archiveDirectory);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "archive-manifest.json"), "utf8")) as ArchiveManifest;
  if (manifest.version !== 2) throw new Error(`Unsupported archive version: ${manifest.version}`);
  if (manifest.baselineSchemaSha256 !== baseline.sourceSchemaSha256) throw new Error("Archive and PostgreSQL baseline schema hashes differ");
  if (manifest.langgraph?.version !== 1) throw new Error("Unsupported LangGraph archive version");
  if (!manifest.langgraph.sourcePresent
    && (manifest.langgraph.checkpoints.rowCount || manifest.langgraph.writes.rowCount)) {
    throw new Error("LangGraph archive contains rows but reports no source schema");
  }
  for (const table of [...manifest.tables, manifest.langgraph.checkpoints, manifest.langgraph.writes]) {
    const filePath = path.join(root, table.file);
    if (path.dirname(filePath) !== root) throw new Error(`Unsafe archive file path: ${table.file}`);
    if (sha256File(filePath) !== table.sha256) throw new Error(`Archive checksum mismatch: ${table.file}`);
  }
  return { root, manifest };
}

function readNdjson(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content) return [];
  return content.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

const checkpointSerde = new MemorySaver().serde;

function archivedBytes(base64: string, label: string) {
  if (typeof base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error(`${label} contains invalid base64`);
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) throw new Error(`${label} contains non-canonical base64`);
  return bytes;
}

async function loadArchivedValue(type: string, base64: string, label: string) {
  if (!type || typeof base64 !== "string") throw new Error(`${label} is missing typed serialization data`);
  try {
    return await checkpointSerde.loadsTyped(type, archivedBytes(base64, label));
  } catch (error) {
    throw new Error(`${label} cannot be deserialized: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function postgresMetadata(metadata: CheckpointMetadata) {
  const [, bytes] = await checkpointSerde.dumpsTyped(metadata);
  try {
    return JSON.parse(new TextDecoder().decode(bytes).replaceAll("\0", "")) as Record<string, unknown>;
  } catch {
    throw new Error("LangGraph checkpoint metadata cannot be represented as PostgreSQL JSONB");
  }
}

async function importLangGraphArchive(client: PoolClient, root: string, manifest: ArchiveManifest["langgraph"]) {
  const checkpoints = readNdjson(path.join(root, manifest.checkpoints.file)) as ArchivedCheckpoint[];
  const writes = readNdjson(path.join(root, manifest.writes.file)) as ArchivedCheckpointWrite[];
  if (checkpoints.length !== manifest.checkpoints.rowCount) throw new Error("Archive row count mismatch: langgraph_checkpoints");
  if (writes.length !== manifest.writes.rowCount) throw new Error("Archive row count mismatch: langgraph_writes");
  const threadIds = [...new Set([...checkpoints, ...writes].map((row) => row.thread_id))];
  if (threadIds.length) {
    const owners = await client.query<{ checkpoint_thread_id: string }>(
      "SELECT checkpoint_thread_id FROM agent_runs WHERE checkpoint_thread_id=ANY($1::text[])", [threadIds],
    );
    const owned = new Set(owners.rows.map((row) => row.checkpoint_thread_id));
    const orphans = threadIds.filter((threadId) => !owned.has(threadId));
    if (orphans.length) throw new Error(`LangGraph archive references missing Agent Runs: ${orphans.join(", ")}`);
  }
  for (const row of checkpoints) {
    const checkpoint = await loadArchivedValue(row.type, row.checkpoint_base64,
      `checkpoint ${row.thread_id}/${row.checkpoint_id}`) as Checkpoint;
    if (!checkpoint || typeof checkpoint !== "object" || checkpoint.id !== row.checkpoint_id) {
      throw new Error(`LangGraph checkpoint identity mismatch: ${row.thread_id}/${row.checkpoint_id}`);
    }
    const metadata = await loadArchivedValue(row.type, row.metadata_base64,
      `checkpoint metadata ${row.thread_id}/${row.checkpoint_id}`) as CheckpointMetadata;
    const channelValues = checkpoint.channel_values ?? {};
    for (const [channel, version] of Object.entries(checkpoint.channel_versions ?? {})) {
      const [type, bytes] = channel in channelValues
        ? await checkpointSerde.dumpsTyped(channelValues[channel])
        : ["empty", null] as const;
      await client.query(`INSERT INTO checkpoint_blobs (thread_id,checkpoint_ns,channel,version,type,blob)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (thread_id,checkpoint_ns,channel,version) DO UPDATE SET type=EXCLUDED.type,blob=EXCLUDED.blob`,
      [row.thread_id, row.checkpoint_ns, channel, String(version), type, bytes ? Buffer.from(bytes) : null]);
    }
    const storedCheckpoint = { ...checkpoint } as Record<string, unknown>;
    delete storedCheckpoint.channel_values;
    await client.query(`INSERT INTO checkpoints
      (thread_id,checkpoint_ns,checkpoint_id,parent_checkpoint_id,checkpoint,metadata)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (thread_id,checkpoint_ns,checkpoint_id) DO UPDATE SET
        parent_checkpoint_id=EXCLUDED.parent_checkpoint_id,checkpoint=EXCLUDED.checkpoint,metadata=EXCLUDED.metadata`,
    [row.thread_id, row.checkpoint_ns, row.checkpoint_id, row.parent_checkpoint_id,
      storedCheckpoint, await postgresMetadata(metadata)]);
  }
  for (const row of writes) {
    if (!Number.isSafeInteger(row.idx)) throw new Error(`LangGraph write has invalid index: ${String(row.idx)}`);
    await client.query(`INSERT INTO checkpoint_writes
      (thread_id,checkpoint_ns,checkpoint_id,task_id,idx,channel,type,blob)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (thread_id,checkpoint_ns,checkpoint_id,task_id,idx) DO UPDATE SET
        channel=EXCLUDED.channel,type=EXCLUDED.type,blob=EXCLUDED.blob`,
    [row.thread_id, row.checkpoint_ns, row.checkpoint_id, row.task_id, row.idx, row.channel, row.type,
      archivedBytes(row.value_base64, `write ${row.thread_id}/${row.checkpoint_id}/${row.task_id}/${row.idx}`)]);
  }
}

export function buildUpsertStatement(table: BaselineTable, rowCount: number) {
  if (rowCount < 1) throw new Error("rowCount must be positive");
  const columns = table.columns.map((column) => quotePgIdentifier(column.name));
  const values = Array.from({ length: rowCount }, (_unused, rowIndex) => `(${columns.map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`).join(", ");
  const updates = table.columns.filter((column) => !table.primaryKey.includes(column.name));
  const conflict = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${quotePgIdentifier(column.name)} = EXCLUDED.${quotePgIdentifier(column.name)}`).join(", ")}`
    : "DO NOTHING";
  return `INSERT INTO ${quotePgIdentifier(table.name)} (${columns.join(", ")}) VALUES ${values} ON CONFLICT (${table.primaryKey.map(quotePgIdentifier).join(", ")}) ${conflict}`;
}

export async function importMigrationArchive(client: PoolClient, archiveDirectory: string, baseline: BaselineManifest, batchSize = 100) {
  const archive = readArchive(archiveDirectory, baseline);
  const archiveByTable = new Map(archive.manifest.tables.map((table) => [table.name, table]));
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dietdigidose:sqlite-import'))");
    for (const table of topologicalTableOrder(baseline.tables)) {
      const archived = archiveByTable.get(table.name);
      if (!archived) throw new Error(`Archive is missing table ${table.name}`);
      const rows = readNdjson(path.join(archive.root, archived.file));
      if (rows.length !== archived.rowCount) throw new Error(`Archive row count mismatch: ${table.name}`);
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const parameters = batch.flatMap((row) => table.columns.map((column) => postgresParameter(row[column.name], column)));
        await client.query(buildUpsertStatement(table, batch.length), parameters);
      }
      if (table.autoIncrement && table.primaryKey.length === 1) {
        const primaryKey = table.primaryKey[0]!;
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${quotePgIdentifier(primaryKey)}) FROM ${quotePgIdentifier(table.name)}), 1), EXISTS(SELECT 1 FROM ${quotePgIdentifier(table.name)}))`,
          [table.name, primaryKey],
        );
      }
    }
    await importLangGraphArchive(client, archive.root, archive.manifest.langgraph);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return archive.manifest;
}

async function targetTableChecksum(client: PoolClient, table: BaselineTable, expectedRows: number) {
  const hash = createHash("sha256");
  const columns = table.columns.map((column) => quotePgIdentifier(column.name)).join(", ");
  const order = table.primaryKey.map(quotePgIdentifier).join(", ");
  let rowCount = 0;
  const pageSize = 1000;
  while (rowCount < expectedRows) {
    const result = await client.query(`SELECT ${columns} FROM ${quotePgIdentifier(table.name)} ORDER BY ${order} LIMIT $1 OFFSET $2`, [pageSize, rowCount]);
    if (!result.rows.length) break;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      hash.update(`${canonicalJson(transformedRow(row, table))}\n`);
      rowCount += 1;
    }
  }
  return { rowCount, sha256: hash.digest("hex") };
}

async function criticalMetricsFromPostgres(client: PoolClient, names: Set<string>) {
  const entries: Array<[string, number]> = [];
  for (const metric of CRITICAL_METRICS.filter((candidate) => names.has(candidate.name))) {
    const result = await client.query(`SELECT COALESCE(SUM(${quotePgIdentifier(metric.column)}), 0)::double precision AS value FROM ${quotePgIdentifier(metric.table)}`);
    entries.push([metric.name, Number(result.rows[0]?.value)]);
  }
  return Object.fromEntries(entries);
}

async function normalizeCheckpointMetadata(value: CheckpointMetadata) {
  const [type, bytes] = await checkpointSerde.dumpsTyped(value);
  return checkpointSerde.loadsTyped(type, bytes);
}

async function validateLangGraphTarget(client: PoolClient, root: string, manifest: ArchiveManifest["langgraph"]) {
  const failures: string[] = [];
  const checkpoints = readNdjson(path.join(root, manifest.checkpoints.file)) as ArchivedCheckpoint[];
  const writes = readNdjson(path.join(root, manifest.writes.file)) as ArchivedCheckpointWrite[];
  const expectedBlobKeys = new Set<string>();
  for (const row of checkpoints) {
    const sourceCheckpoint = await loadArchivedValue(row.type, row.checkpoint_base64,
      `checkpoint ${row.thread_id}/${row.checkpoint_id}`) as Checkpoint;
    const sourceMetadata = await loadArchivedValue(row.type, row.metadata_base64,
      `checkpoint metadata ${row.thread_id}/${row.checkpoint_id}`) as CheckpointMetadata;
    const target = (await client.query<{ parent_checkpoint_id: string | null; checkpoint: Checkpoint; metadata: CheckpointMetadata }>(
      `SELECT parent_checkpoint_id,checkpoint,metadata FROM checkpoints
       WHERE thread_id=$1 AND checkpoint_ns=$2 AND checkpoint_id=$3`,
      [row.thread_id, row.checkpoint_ns, row.checkpoint_id],
    )).rows[0];
    if (!target) {
      failures.push(`missing LangGraph checkpoint ${row.thread_id}/${row.checkpoint_ns}/${row.checkpoint_id}`);
      continue;
    }
    const targetValues: Record<string, unknown> = {};
    for (const [channel, version] of Object.entries(sourceCheckpoint.channel_versions ?? {})) {
      expectedBlobKeys.add(canonicalJson([row.thread_id, row.checkpoint_ns, channel, String(version)]));
      const blob = (await client.query<{ type: string; blob: Buffer | null }>(`SELECT type,blob FROM checkpoint_blobs
        WHERE thread_id=$1 AND checkpoint_ns=$2 AND channel=$3 AND version=$4`,
      [row.thread_id, row.checkpoint_ns, channel, String(version)])).rows[0];
      if (!blob) {
        failures.push(`missing LangGraph blob ${row.thread_id}/${row.checkpoint_ns}/${channel}/${String(version)}`);
      } else if (blob.type !== "empty") {
        targetValues[channel] = await checkpointSerde.loadsTyped(blob.type, blob.blob ?? Buffer.alloc(0));
      }
    }
    const targetCheckpoint = { ...target.checkpoint, channel_values: targetValues };
    const expected = canonicalJson({
      checkpoint: sourceCheckpoint,
      metadata: await normalizeCheckpointMetadata(sourceMetadata),
      parent_checkpoint_id: row.parent_checkpoint_id,
    });
    const actual = canonicalJson({
      checkpoint: targetCheckpoint,
      metadata: await normalizeCheckpointMetadata(target.metadata),
      parent_checkpoint_id: target.parent_checkpoint_id,
    });
    if (actual !== expected) failures.push(`LangGraph checkpoint content differs: ${row.thread_id}/${row.checkpoint_ns}/${row.checkpoint_id}`);
  }
  for (const row of writes) {
    const target = (await client.query<{ channel: string; type: string | null; blob: Buffer }>(`SELECT channel,type,blob
      FROM checkpoint_writes WHERE thread_id=$1 AND checkpoint_ns=$2 AND checkpoint_id=$3 AND task_id=$4 AND idx=$5`,
    [row.thread_id, row.checkpoint_ns, row.checkpoint_id, row.task_id, row.idx])).rows[0];
    if (!target) failures.push(`missing LangGraph write ${row.thread_id}/${row.checkpoint_id}/${row.task_id}/${row.idx}`);
    else if (target.channel !== row.channel || String(target.type || "json") !== row.type
      || target.blob.toString("base64") !== row.value_base64) {
      failures.push(`LangGraph write content differs: ${row.thread_id}/${row.checkpoint_id}/${row.task_id}/${row.idx}`);
    }
  }
  const counts = (await client.query<{ checkpoints: number; blobs: number; writes: number }>(`SELECT
    (SELECT COUNT(*)::integer FROM checkpoints) AS checkpoints,
    (SELECT COUNT(*)::integer FROM checkpoint_blobs) AS blobs,
    (SELECT COUNT(*)::integer FROM checkpoint_writes) AS writes`)).rows[0]!;
  if (Number(counts.checkpoints) !== checkpoints.length) failures.push(`LangGraph checkpoints: expected ${checkpoints.length}, found ${counts.checkpoints}`);
  if (Number(counts.blobs) !== expectedBlobKeys.size) failures.push(`LangGraph blobs: expected ${expectedBlobKeys.size}, found ${counts.blobs}`);
  if (Number(counts.writes) !== writes.length) failures.push(`LangGraph writes: expected ${writes.length}, found ${counts.writes}`);
  return {
    failures,
    sourcePresent: manifest.sourcePresent,
    checkpointCount: checkpoints.length,
    checkpointBlobCount: expectedBlobKeys.size,
    checkpointWriteCount: writes.length,
  };
}

export async function validateMigrationTarget(client: PoolClient, archiveDirectory: string, baseline: BaselineManifest) {
  const archive = readArchive(archiveDirectory, baseline);
  const baselineByName = new Map(baseline.tables.map((table) => [table.name, table]));
  const failures: string[] = [];
  for (const archived of archive.manifest.tables) {
    const table = baselineByName.get(archived.name);
    if (!table) {
      failures.push(`unexpected archive table ${archived.name}`);
      continue;
    }
    const actual = await targetTableChecksum(client, table, archived.rowCount + 1);
    if (actual.rowCount !== archived.rowCount) failures.push(`${table.name}: expected ${archived.rowCount} rows, found ${actual.rowCount}`);
    if (actual.sha256 !== archived.sha256) failures.push(`${table.name}: canonical row checksum differs`);
    for (const foreignKey of table.foreignKeys) {
      const orphan = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM ${quotePgIdentifier(table.name)} child
        LEFT JOIN ${quotePgIdentifier(foreignKey.referencedTable)} parent
          ON child.${quotePgIdentifier(foreignKey.column)} = parent.${quotePgIdentifier(foreignKey.referencedColumn)}
        WHERE child.${quotePgIdentifier(foreignKey.column)} IS NOT NULL
          AND parent.${quotePgIdentifier(foreignKey.referencedColumn)} IS NULL
      `);
      if (Number(orphan.rows[0]?.count)) failures.push(`${table.name}.${foreignKey.column}: ${orphan.rows[0]?.count} orphan rows`);
    }
  }
  const targetMetrics = await criticalMetricsFromPostgres(client, new Set(Object.keys(archive.manifest.criticalMetrics)));
  for (const [name, expected] of Object.entries(archive.manifest.criticalMetrics)) {
    const actual = targetMetrics[name];
    if (actual === undefined || Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
      failures.push(`${name}: expected aggregate ${expected}, found ${String(actual)}`);
    }
  }
  const langgraph = await validateLangGraphTarget(client, archive.root, archive.manifest.langgraph);
  failures.push(...langgraph.failures);
  return {
    ok: failures.length === 0,
    failures,
    tableCount: archive.manifest.tables.length,
    rowCount: archive.manifest.tables.reduce((total, table) => total + table.rowCount, 0),
    criticalMetrics: targetMetrics,
    langgraph: {
      sourcePresent: langgraph.sourcePresent,
      checkpointCount: langgraph.checkpointCount,
      checkpointBlobCount: langgraph.checkpointBlobCount,
      checkpointWriteCount: langgraph.checkpointWriteCount,
    },
  };
}
