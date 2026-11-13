#!/usr/bin/env node
/**
 * Prefer the Go migrator (uploads placeholders/CDN when remotes 403/404):
 *
 *   cd server-go && go run ./cmd/migrate-media -config configs/config.yaml -limit 500
 *
 * This Node helper is a thin wrapper that invokes migrate-media when built,
 * or falls back to remapping broken Unsplash/Picsum URLs onto existing CDN recipe images.
 *
 *   node scripts/rehost-unsplash-images.mjs [--dry-run]
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "server/data/dietdigidose.db");
const dryRun = process.argv.includes("--dry-run");
const helper = path.join(root, "server-go/bin/migrate-media");
const built = existsSync(helper) ? helper : null;

if (built && !dryRun) {
  const res = spawnSync(built, ["-config", "configs/config.yaml", "-limit", "1500", "-workers", "10"], {
    cwd: path.join(root, "server-go"),
    stdio: "inherit",
  });
  process.exit(res.status ?? 1);
}

function sql(query) {
  const res = spawnSync("sqlite3", ["-json", dbPath, query], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr || "sqlite3 failed");
  const raw = res.stdout.trim();
  return raw ? JSON.parse(raw) : [];
}

function execSql(query) {
  const res = spawnSync("sqlite3", [dbPath, query], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr || "sqlite3 exec failed");
}

const cdn = sql(
  `SELECT image_url AS url FROM recipes WHERE image_url LIKE 'https://cdn.lingecho.com/%' ORDER BY id LIMIT 200`,
).map((r) => r.url);
if (!cdn.length) {
  console.error("No CDN recipe URLs available; build migrate-media and re-run.");
  process.exit(1);
}

const targets = [
  ["community_posts", "image_url"],
  ["community_posts", "avatar_url"],
  ["inventory_items", "image_url"],
  ["kitchenware_catalog", "image_url"],
];

let updated = 0;
let i = 0;
for (const [table, col] of targets) {
  const rows = sql(
    `SELECT id FROM ${table} WHERE ${col} LIKE '%unsplash%' OR ${col} LIKE '%picsum.photos%'`,
  );
  for (const row of rows) {
    const url = cdn[i++ % cdn.length].replace(/'/g, "''");
    if (dryRun) {
      console.log(`[dry-run] ${table}.${col}#${row.id} -> ${url}`);
      continue;
    }
    execSql(`UPDATE ${table} SET ${col}='${url}' WHERE id=${Number(row.id)}`);
    updated += 1;
  }
  console.log(`${table}.${col} candidates=${rows.length}`);
}
console.log(`done updated=${updated} dryRun=${dryRun}`);
