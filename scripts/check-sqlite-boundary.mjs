import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "server", "src");
const baselinePath = path.join(root, "scripts", "sqlite-boundary-baseline.json");
const update = process.argv.includes("--update");
// Forward schema migrations must issue DDL on both supported databases. They are
// validated by schema parity and migration tests, not the runtime-access freeze.
// Keep this explicit: services, import scripts and new storage helpers do not
// acquire a blanket exemption by living under storage/.
const schemaMigrationFiles = new Set([
  "server/src/storage/migrations.ts",
  "server/src/storage/baseDataMigration.ts",
  "server/src/storage/healthProfileMigration.ts",
  "server/src/storage/manualDietRequestMigration.ts",
  "server/src/storage/onboardingMigration.ts",
  "server/src/storage/passwordlessMigration.ts",
]);
const patterns = [
  /\bdb\.(?:prepare|exec|transaction|pragma)\s*\(/g,
  /\b(?:database|this\.database)\.(?:prepare|exec|transaction|pragma)\s*\(/g,
  /from\s+["'][^"']*storage\/db\.js["']/g,
  /from\s+["']better-sqlite3["']/g,
];

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  });
}

const counts = Object.fromEntries(filesBelow(sourceRoot)
  .filter((filePath) => filePath.endsWith(".ts"))
  .filter((filePath) => !schemaMigrationFiles.has(path.relative(root, filePath).split(path.sep).join("/")))
  .map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const count = patterns.reduce((total, pattern) => total + [...source.matchAll(pattern)].length, 0);
    return [path.relative(root, filePath).split(path.sep).join("/"), count];
  })
  .filter(([, count]) => count > 0)
  .sort(([left], [right]) => left.localeCompare(right)));

const payload = `${JSON.stringify({
  policy: "Runtime SQLite access is frozen. Counts may only decrease or move behind repository adapters. Explicit schema migration files are checked by migration tests and schema parity.",
  files: counts,
}, null, 2)}\n`;

if (update) {
  fs.writeFileSync(baselinePath, payload);
  console.log(`Updated SQLite boundary baseline (${Object.keys(counts).length} files).`);
} else {
  const current = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, "utf8") : "";
  if (current !== payload) {
    console.error("SQLite boundary changed. New direct access is forbidden; if access was removed, run pnpm -w database:boundary:update and commit the smaller baseline.");
    process.exitCode = 1;
  } else {
    console.log(`SQLite boundary is frozen at ${Object.keys(counts).length} legacy/infrastructure files.`);
  }
}
