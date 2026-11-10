import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(serverRoot, "..");

async function readPackageJson(directory: string) {
  return JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

test("workspace start scripts avoid POSIX-only environment assignment syntax", async () => {
  const packages = await Promise.all([
    readPackageJson(workspaceRoot),
    readPackageJson(path.join(workspaceRoot, "client")),
    readPackageJson(serverRoot),
  ]);
  const startScripts = packages.flatMap(({ scripts = {} }) =>
    Object.entries(scripts).filter(([name]) => name === "start" || name.startsWith("dev")),
  );

  for (const [name, script] of startScripts) {
    assert.doesNotMatch(script, /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/, `${name}: ${script}`);
    assert.doesNotMatch(script, /\$\{[^}]+:-[^}]+\}/, `${name}: ${script}`);
  }
});

test("production defaults are applied inside the portable Node launcher", async () => {
  const serverPackage = await readPackageJson(serverRoot);
  assert.equal(serverPackage.scripts?.start, "node scripts/start-production.mjs");
  const launcher = await readFile(path.join(serverRoot, "scripts", "start-production.mjs"), "utf8");
  assert.match(launcher, /process\.env\.NODE_ENV \|\|= "production"/);
  assert.match(launcher, /process\.env\.PORT \|\|= "9090"/);
});

test("API and background worker have independent entry points", async () => {
  const serverPackage = await readPackageJson(serverRoot);
  assert.equal(serverPackage.scripts?.worker, "tsx src/worker.ts");
  assert.equal(serverPackage.scripts?.["worker:run"], "tsx src/worker.ts --once");
  const apiEntry = await readFile(path.join(serverRoot, "src", "index.ts"), "utf8");
  assert.doesNotMatch(apiEntry, /start(?:Notification|MediaCleanup)Scheduler/);
  const workerEntry = await readFile(path.join(serverRoot, "src", "worker.ts"), "utf8");
  assert.match(workerEntry, /runManagedWorkerTask/);
  assert.match(workerEntry, /--once/);
});

test("database operations expose inspectable and guarded backup commands", async () => {
  const serverPackage = await readPackageJson(serverRoot);
  assert.equal(serverPackage.scripts?.["db:inspect"], "tsx scripts/database-backup.ts inspect");
  assert.equal(serverPackage.scripts?.["db:rehearse"], "pnpm build && tsx scripts/database-rehearsal.ts");
  const script = await readFile(path.join(serverRoot, "scripts", "database-backup.ts"), "utf8");
  assert.match(script, /integrity_check/);
  assert.match(script, /before-restore/);
  assert.match(script, /backup destination already exists/);
});
