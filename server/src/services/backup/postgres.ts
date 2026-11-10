import { createHash,randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { z } from "zod";

const manifestSchema = z.object({
  format: z.literal("dietdigidose-postgres-backup-v1"),archive: z.literal("database.dump"),sha256: z.string().regex(/^[a-f0-9]{64}$/),bytes: z.number().int().positive(),
  snapshotAt: z.string().datetime(),migrationVersion: z.number().int().nonnegative().nullable(),drizzleMigrationId: z.number().int().nonnegative().nullable(),startedAt: z.string().datetime(),completedAt: z.string().datetime(),durationMs: z.number().nonnegative(),owner: z.string().min(1),candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
  serverVersion: z.string(),tables: z.array(z.object({ schema: z.string(),name: z.string(),rows: z.string().regex(/^\d+$/) }).strict()),
}).strict();
const quote = (name: string) => `"${name.replaceAll('"','""')}"`;
async function hash(file: string) {
  const digest = createHash("sha256"); await pipeline(createReadStream(file),digest); return digest.digest("hex");
}
function connection(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Provide a valid PostgreSQL connection URL through the designated environment variable"); }
  if (!["postgres:","postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length<2) throw new Error("PostgreSQL URL requires a host and database");
  if ([...url.searchParams.keys()].some(key => key!=="sslmode")) throw new Error("Only sslmode is supported as a PostgreSQL URL query parameter");
  if (!/^[A-Za-z0-9_.-]+$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error("Backup and restore require a simple database name");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  Object.assign(env,{ PGHOST: url.hostname.replace(/^\[|\]$/g,""),PGPORT: url.port || "5432",PGDATABASE: decodeURIComponent(url.pathname.slice(1)),PGUSER: decodeURIComponent(url.username),PGPASSWORD: decodeURIComponent(url.password),PGSSLMODE: url.searchParams.get("sslmode") || "prefer",PGCONNECT_TIMEOUT: "15" });
  return { client: new Client({ connectionString: value,connectionTimeoutMillis: 15_000 }),env };
}
async function command(binary: string,args: string[],env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve,reject) => {
    const child = spawn(binary,args,{ env,stdio: ["ignore","ignore","pipe"] });
    let diagnostic = "";
    child.stderr.on("data",chunk => { diagnostic = (diagnostic+String(chunk)).slice(-4000); });
    child.once("error",() => reject(new Error(`${binary} could not start; install the PostgreSQL client tools`)));
    child.once("close",code => {
      // libpq may quote connection errors; never surface the connection URL or password.
      const safe = env.PGPASSWORD ? diagnostic.split(env.PGPASSWORD).join("[redacted]") : diagnostic;
      if (code===0) resolve(); else reject(new Error(`${binary} failed (${code}): ${safe}`));
    });
  });
}
async function tables(client: Client) {
  const result = await client.query<{ schema: string; name: string }>("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname");
  const counts = [];
  for (const row of result.rows.sort((a,b) => `${a.schema}\0${a.name}`.localeCompare(`${b.schema}\0${b.name}`))) {
    const count = await client.query(`SELECT COUNT(*)::text AS rows FROM ${quote(row.schema)}.${quote(row.name)}`);
    counts.push({ ...row,rows: String(count.rows[0].rows) });
  }
  return counts;
}
export async function inspectPostgresBackup(directory: string) {
  const root = path.resolve(directory);
  const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(path.join(root,"manifest.json"),"utf8")));
  const archive = path.join(root,manifest.archive);
  const info = await fs.lstat(archive);
  if (!info.isFile() || info.size!==manifest.bytes || await hash(archive)!==manifest.sha256) throw new Error("Backup archive checksum or size does not match its manifest");
  return manifest;
}
export async function createPostgresBackup(url: string,directory: string,metadata: { owner: string; candidateSha: string }) {
  if (!metadata.owner.trim() || !/^[a-f0-9]{40}$/.test(metadata.candidateSha)) throw new Error("Backup requires an owner and a full candidate Git SHA");
  const { client,env } = connection(url);
  const destination = path.resolve(directory);
  const staging = `${destination}.partial-${randomUUID()}`;
  const startedAt = new Date().toISOString(); const started = performance.now();
  // Exclusive final directory reservation prevents replacing any previous backup.
  await fs.mkdir(destination,{ mode: 0o700 });
  try {
    await fs.mkdir(staging,{ mode: 0o700 });
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = String((await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot);
    const snapshotAt = new Date((await client.query("SELECT CURRENT_TIMESTAMP AS at")).rows[0].at).toISOString();
    const serverVersion = String((await client.query("SHOW server_version")).rows[0].server_version);
    const archive = path.join(staging,"database.dump");
    await command("pg_dump",["--format=custom","--no-owner","--no-acl",`--snapshot=${snapshot}`,`--file=${archive}`],env);
    await fs.chmod(archive,0o600);
    const counts = await tables(client);
    const migrationVersion = counts.some(row => row.schema==="public" && row.name==="schema_migrations") ? Number((await client.query("SELECT COALESCE(MAX(version),0) AS version FROM public.schema_migrations")).rows[0].version) : null;
    const drizzleMigrationId = counts.some(row => row.schema==="drizzle" && row.name==="__drizzle_migrations") ? Number((await client.query("SELECT COALESCE(MAX(id),0) AS version FROM drizzle.__drizzle_migrations")).rows[0].version) : null;
    await client.query("COMMIT");
    const manifest = manifestSchema.parse({ format: "dietdigidose-postgres-backup-v1",archive: "database.dump",sha256: await hash(archive),bytes: (await fs.stat(archive)).size,startedAt,completedAt: new Date().toISOString(),durationMs: Math.round(performance.now()-started),...metadata,snapshotAt,migrationVersion,drizzleMigrationId,serverVersion,tables: counts });
    await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{ flag: "wx",mode: 0o600 });
    await fs.rename(archive,path.join(destination,"database.dump"));
    await fs.rename(path.join(staging,"manifest.json"),path.join(destination,"manifest.json"));
    return manifest;
  } catch (error) {
    await fs.rm(destination,{ recursive: true,force: true });
    throw error;
  } finally {
    await client.end();
    await fs.rm(staging,{ recursive: true,force: true });
  }
}
export async function restorePostgresBackup(url: string,directory: string) {
  const manifest = await inspectPostgresBackup(directory);
  const { client,env } = connection(url);
  const started = performance.now();
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock(hashtext('dietdigidose-isolated-restore'))");
    const existing = await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LIMIT 1");
    if (existing.rowCount) throw new Error("Restore target is not empty; use a new isolated database. Existing data will not be overwritten");
    await command("pg_restore",["--single-transaction","--exit-on-error","--no-owner","--no-acl",`--dbname=${env.PGDATABASE}`,path.join(path.resolve(directory),manifest.archive)],env);
    const restored = await tables(client);
    if (JSON.stringify(restored)!==JSON.stringify(manifest.tables)) throw new Error("Restored table counts differ from the backup snapshot; isolate this target for investigation");
    return { operation: "restore",verified: true,sha256: manifest.sha256,durationMs: Math.round(performance.now()-started),tables: restored };
  } finally { await client.end(); }
}
