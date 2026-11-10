import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import path from "node:path";

const CORE_TABLES = [
  "users",
  "inventory_items",
  "diet_records",
  "community_posts",
  "media_cleanup_jobs",
] as const;

export type DatabaseArtifactMetadata = {
  path: string;
  bytes: number;
  sha256: string;
  integrityCheck: "ok";
  migrationVersion: number;
  tableCounts: Record<string, number>;
};

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

function tableExists(database: Database.Database, tableName: string) {
  return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

export async function inspectDatabase(databasePath: string): Promise<DatabaseArtifactMetadata> {
  const resolvedPath = path.resolve(databasePath);
  const walPath = `${resolvedPath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    const snapshotPath = path.join(os.tmpdir(), `dietdigidose-inspect-${process.pid}-${randomUUID()}.db`);
    const source = new Database(resolvedPath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(snapshotPath);
      const snapshot = await inspectDatabase(snapshotPath);
      return { ...snapshot, path: resolvedPath };
    } finally {
      if (source.open) source.close();
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    }
  }
  const database = new Database(resolvedPath, { readonly: true, fileMustExist: true });
  try {
    const integrityRows = database.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") {
      throw new Error(`database integrity check failed: ${integrityRows.map((row) => row.integrity_check).join("; ")}`);
    }
    const migrationVersion = tableExists(database, "schema_migrations")
      ? (database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version
      : 0;
    const tableCounts = Object.fromEntries(CORE_TABLES.map((tableName) => [
      tableName,
      tableExists(database, tableName)
        ? (database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count
        : 0,
    ]));
    return {
      path: resolvedPath,
      bytes: fs.statSync(resolvedPath).size,
      sha256: await sha256File(resolvedPath),
      integrityCheck: "ok",
      migrationVersion,
      tableCounts,
    };
  } finally {
    database.close();
  }
}

export async function createDatabaseBackup(sourcePath: string, destinationPath: string) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error("backup destination must differ from the source database");
  if (fs.existsSync(destination)) throw new Error(`backup destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = `${destination}.partial-${process.pid}-${randomUUID()}`;
  const startedAt = Date.now();
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(partial);
    database.close();
    const metadata = await inspectDatabase(partial);
    fs.renameSync(partial, destination);
    return { ...metadata, path: destination, durationMs: Date.now() - startedAt };
  } catch (error) {
    if (database.open) database.close();
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
    throw error;
  }
}

function checkpointDatabase(databasePath: string) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    database.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}

export async function restoreDatabaseBackup(sourcePath: string, backupPath: string) {
  const source = path.resolve(sourcePath);
  const backup = path.resolve(backupPath);
  if (source === backup) throw new Error("restore source and destination must differ");
  const backupMetadata = await inspectDatabase(backup);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  const restoreId = `${timestamp()}-${randomUUID().slice(0, 8)}`;
  const partial = `${source}.restore-partial-${restoreId}`;
  const safetyPath = fs.existsSync(source) ? `${source}.before-restore-${restoreId}` : null;
  const startedAt = Date.now();
  fs.copyFileSync(backup, partial, fs.constants.COPYFILE_EXCL);

  const movedSidecars: Array<{ source: string; safety: string }> = [];
  let originalMoved = false;
  try {
    await inspectDatabase(partial);
    if (safetyPath) {
      checkpointDatabase(source);
      fs.renameSync(source, safetyPath);
      originalMoved = true;
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${source}${suffix}`;
        if (!fs.existsSync(sidecar)) continue;
        const safetySidecar = `${safetyPath}${suffix}`;
        fs.renameSync(sidecar, safetySidecar);
        movedSidecars.push({ source: sidecar, safety: safetySidecar });
      }
    }
    fs.renameSync(partial, source);
    const restored = await inspectDatabase(source);
    if (restored.sha256 !== backupMetadata.sha256) {
      throw new Error(`restored database checksum mismatch: expected ${backupMetadata.sha256}, received ${restored.sha256}`);
    }
    return {
      ...restored,
      durationMs: Date.now() - startedAt,
      backupSha256: backupMetadata.sha256,
      safetyPath,
    };
  } catch (error) {
    if (fs.existsSync(source) && originalMoved) {
      const failedRestore = `${source}.failed-restore-${restoreId}`;
      fs.renameSync(source, failedRestore);
    } else if (fs.existsSync(source) && !safetyPath) {
      fs.unlinkSync(source);
    }
    if (originalMoved && safetyPath && fs.existsSync(safetyPath)) fs.renameSync(safetyPath, source);
    for (const sidecar of movedSidecars) {
      if (fs.existsSync(sidecar.safety)) fs.renameSync(sidecar.safety, sidecar.source);
    }
    throw error;
  } finally {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
}

async function main() {
  const command = process.argv[2];
  const sourcePath = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), "data/dietdigidose.db"));
  if (command === "backup") {
    const destination = path.resolve(process.argv[3] || path.join(process.cwd(), `backups/dietdigidose-${timestamp()}.db`));
    console.log(JSON.stringify({ operation: "backup", ...(await createDatabaseBackup(sourcePath, destination)) }, null, 2));
    return;
  }
  if (command === "restore") {
    const backupPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
    if (!backupPath || process.argv[4] !== "--force") {
      throw new Error("Usage: pnpm db:restore <backup.db> --force (stop the server first)");
    }
    console.log(JSON.stringify({ operation: "restore", ...(await restoreDatabaseBackup(sourcePath, backupPath)) }, null, 2));
    return;
  }
  if (command === "inspect") {
    const inspectedPath = process.argv[3] ? path.resolve(process.argv[3]) : sourcePath;
    console.log(JSON.stringify({ operation: "inspect", ...(await inspectDatabase(inspectedPath)) }, null, 2));
    return;
  }
  throw new Error("Usage: pnpm db:backup [destination.db] | pnpm db:restore <backup.db> --force | pnpm db:inspect [database.db]");
}

const isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
