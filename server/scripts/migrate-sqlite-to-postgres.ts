import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  exportMigrationArchive,
  importMigrationArchive,
  validateMigrationTarget,
  type BaselineManifest,
} from "../src/storage/database/postgres/migration.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(fs.readFileSync(
  path.join(serverRoot, "src", "storage", "database", "postgres", "baseline-manifest.json"),
  "utf8",
)) as BaselineManifest;
const args = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"));

function option(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new Error(`Missing required option ${name}`);
  return value;
}

function connectionString() {
  const value = option("--url")?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Set DATABASE_URL or pass --url");
  return value;
}

async function withPool<T>(callback: (pool: Pool) => Promise<T>) {
  const pool = new Pool({ connectionString: connectionString(), max: 4 });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function applySchema(pool: Pool) {
  await migrate(drizzle(pool), { migrationsFolder: path.join(serverRoot, "drizzle") });
}

function exportArchive() {
  const sqlitePath = path.resolve(requiredOption("--sqlite"));
  const outputDirectory = path.resolve(requiredOption("--out"));
  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    return exportMigrationArchive({ database, sqlitePath, outputDirectory, baseline });
  } finally {
    database.close();
  }
}

async function importArchive(pool: Pool, archiveDirectory: string) {
  const client = await pool.connect();
  try {
    return await importMigrationArchive(client, archiveDirectory, baseline);
  } finally {
    client.release();
  }
}

async function validate(pool: Pool, archiveDirectory: string) {
  const client = await pool.connect();
  try {
    return await validateMigrationTarget(client, archiveDirectory, baseline);
  } finally {
    client.release();
  }
}

async function main() {
  const command = args[0];
  if (command === "export") {
    const manifest = exportArchive();
    console.log(JSON.stringify({
      ok: true,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, table) => sum + table.rowCount, 0),
      checkpoints: manifest.langgraph.checkpoints.rowCount,
      checkpointWrites: manifest.langgraph.writes.rowCount,
    }, null, 2));
    return;
  }
  if (command === "apply-schema") {
    await withPool(async (pool) => applySchema(pool));
    console.log(JSON.stringify({ ok: true, schema: baseline.sourceSchemaSha256 }, null, 2));
    return;
  }
  if (command === "import") {
    const archiveDirectory = path.resolve(requiredOption("--archive"));
    await withPool(async (pool) => importArchive(pool, archiveDirectory));
    console.log(JSON.stringify({ ok: true }, null, 2));
    return;
  }
  if (command === "validate") {
    const archiveDirectory = path.resolve(requiredOption("--archive"));
    const report = await withPool(async (pool) => validate(pool, archiveDirectory));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "rehearse") {
    const startedAt = Date.now();
    const archiveDirectory = path.resolve(requiredOption("--out"));
    const manifest = exportArchive();
    const report = await withPool(async (pool) => {
      await applySchema(pool);
      await importArchive(pool, archiveDirectory);
      await importArchive(pool, archiveDirectory);
      return validate(pool, archiveDirectory);
    });
    const rehearsalReport = {
      ...report,
      sourceSchemaSha256: manifest.baselineSchemaSha256,
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
      repeatedImportVerified: true,
    };
    fs.writeFileSync(path.join(archiveDirectory, "migration-report.json"), `${JSON.stringify(rehearsalReport, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify(rehearsalReport, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: migrate-sqlite-to-postgres.ts <export|apply-schema|import|validate|rehearse> [options]");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
