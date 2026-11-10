// Launch the real Go executable against a new private database, never the app DB.
// --postgres also creates a private Unix-socket PostgreSQL cluster and a DML-only role.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const postgres = process.argv.includes("--postgres");
assert(process.argv.slice(2).every(arg => arg === "--postgres"), "Usage: node scripts/smoke-go-runtime.mjs [--postgres]");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ddd-go-http-"));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(APP_|DATABASE_|JWT_|ADMIN_|AI_|OPENAI_|PG|PROACTIVE_|CORS_|TRUST|REQUIRE_HTTPS|NODE_ENV|PORT$)/.test(key)) delete env[key];
}
const pgBin = process.env.PG_BIN || (fs.existsSync("/opt/homebrew/opt/postgresql@16/bin") ? "/opt/homebrew/opt/postgresql@16/bin" : "");
if (pgBin) env.PATH = `${pgBin}${path.delimiter}${env.PATH}`;
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: work, env, encoding: "utf8", timeout: 120_000, ...options });
const sha = run("git", ["-C", root, "rev-parse", "HEAD"]).trim();
const binary = path.join(work, process.platform === "win32" ? "server.exe" : "server");
let clusterStarted = false;
let api;
let worker;
let logs;
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try { await ended; } finally { clearTimeout(timer); }
}
try {
  run("go", ["-C", path.join(root, "server-go"), "build", "-trimpath", "-ldflags", `-X main.GitCommit=${sha}`, "-o", binary, "./cmd/server"], { env: { ...env, CGO_ENABLED: "0" } });
  const config = path.join(work, "config.yaml");
  fs.writeFileSync(config, `app:\n  environment: prod\nlogging:\n  filename: ${JSON.stringify(path.join(work, "app.log"))}\nstorage:\n  root: ${JSON.stringify(path.join(work, "uploads"))}\n`);
  Object.assign(env, {
    APP_APP_ENVIRONMENT: "prod", NODE_ENV: "production", APP_DATABASE_AUTO_MIGRATE: "0",
    APP_EMBEDDED_WORKER_ENABLED: "0", APP_SCAFFOLD_ENABLED: "0", APP_UPSTREAM_EXPRESS: "off",
    JWT_SECRET: `isolated-http-smoke-only-${randomUUID()}`, REQUIRE_HTTPS: "0",
    MEDIA_LOCAL_ROOT: path.join(work, "media"), PROACTIVE_INTERVENTIONS_ENABLED: "0",
  });
  let ownerURL;
  if (postgres) {
    run("initdb", ["-D", path.join(work, "pg"), "-U", "go_smoke", "-A", "trust", "--no-locale", "-E", "UTF8"]);
    run("pg_ctl", ["-D", path.join(work, "pg"), "-l", path.join(work, "pg.log"), "-o", `-k ${work} -p 55443 -c listen_addresses=''`, "-w", "start"]);
    clusterStarted = true;
    ownerURL = `postgresql://go_smoke@/postgres?host=${encodeURIComponent(work)}&port=55443`;
    Object.assign(env, { DATABASE_DRIVER: "postgresql", DATABASE_URL: ownerURL });
  } else {
    Object.assign(env, { DATABASE_DRIVER: "sqlite", DATABASE_PATH: path.join(work, "smoke.db") });
  }
  const initialPassword = `SmokeInitial9-${randomUUID()}`;
  run(binary, ["-config", config, "-migrate"], { env: { ...env, ADMIN_INITIAL_PASSWORD: initialPassword } });
  if (postgres) {
    const sql = "CREATE ROLE go_runtime LOGIN; GRANT USAGE ON SCHEMA public TO go_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO go_runtime; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO go_runtime;";
    run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", sql], { env: { ...env, PGHOST: work, PGPORT: "55443", PGUSER: "go_smoke", PGDATABASE: "postgres" } });
    env.DATABASE_URL = ownerURL.replace("go_smoke@", "go_runtime@");
    let ddlDenied = false;
    try { run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE TABLE ddl_must_be_denied(id integer)"], { env: { ...env, PGHOST: work, PGPORT: "55443", PGUSER: "go_runtime", PGDATABASE: "postgres" }, stdio: "pipe" }); }
    catch { ddlDenied = true; }
    assert(ddlDenied, "runtime role unexpectedly has DDL privileges");
  }
  run(binary, ["-config", config, "-check-schema"]);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  env.APP_SERVER_PORT = String(probe.address().port);
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const baseURL = `http://127.0.0.1:${env.APP_SERVER_PORT}`;
  logs = fs.openSync(path.join(work, "process.log"), "a");
  api = spawn(binary, ["-config", config], { cwd: work, env, stdio: ["ignore", logs, logs] });
  const deadline = Date.now() + 20_000;
  while (true) {
    assert(api.exitCode === null, "Go server exited before readiness");
    try { const response = await fetch(`${baseURL}/api/v1/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    assert(Date.now() < deadline, "Go server readiness timeout");
    await delay(100);
  }
  async function request(route, method = "GET", body, token) {
    const response = await fetch(baseURL + route, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    assert(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  }
  const loggedIn = await request("/api/v1/auth/login", "POST", { identifier: "admin", password: initialPassword });
  await request("/api/v1/admin/recipes", "POST", { title: "隔离烟测菜谱", summary: "synthetic data, not a nutrition source" }, loggedIn.token);
  const report = JSON.parse(run(process.execPath, [path.join(root, "deploy/staging-smoke.mjs")], { env: { ...env, STAGING_BASE_URL: baseURL, ALLOW_HTTP: "1", EXPECTED_SERVER_GIT_SHA: sha } }));
  assert(report.success, "staging smoke failed");
  const retiredEndpoints = [
    ["POST", "/auth/sms/send"], ["POST", "/auth/sms/verify"], ["POST", "/auth/sms/register"],
    ["POST", "/auth/phone-binding/send"], ["POST", "/auth/phone-binding/verify"],
    ["POST", "/auth/phone-binding/replace/send"], ["POST", "/auth/phone-binding/replace/verify"],
    ["POST", "/auth/reauth/sms/send"], ["POST", "/auth/reauth/sms/verify"],
    ["POST", "/auth/password-recovery/send"], ["POST", "/auth/password-recovery/verify"],
    ["POST", "/auth/password"], ["GET", "/admin/auth-services/sms/config"], ["PUT", "/admin/auth-services/sms/config"],
    ["GET", "/admin/auth-services/sms/overview"], ["GET", "/admin/auth-services/sms/events"],
    ["POST", "/admin/auth-services/sms/events/1/reveal-phone"],
    ["POST", "/admin/auth-services/sms/test-send"], ["POST", "/admin/auth-services/sms/package/reconcile"],
    ["POST", "/webhooks/sms"], ["POST", "/webhooks/aliyun/sms-delivery/retired"],
  ];
  for (const [method, route] of retiredEndpoints) {
    const response = await fetch(`${baseURL}/api/v1${route}`, { method,
      headers: { authorization: `Bearer ${loggedIn.token}`, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 404, `retired endpoint ${method} ${route}`);
    await response.arrayBuffer();
  }
  const stats = await request("/api/v1/admin/stats", "GET", undefined, loggedIn.token);
  assert.equal(stats.users, 1, "synthetic smoke account was not cleaned up");
  await stop(api);
  worker = spawn(binary, ["-config", config, "-worker"], { cwd: work, env: { ...env, PROACTIVE_INTERVENTIONS_ENABLED: "1" }, stdio: ["ignore", logs, logs] });
  const workerDeadline = Date.now() + 15_000;
  while (!fs.readFileSync(path.join(work, "process.log"), "utf8").includes("scan users=")) {
    assert(worker.exitCode === null, "worker exited before its first scan");
    assert(Date.now() < workerDeadline, "worker scan timeout");
    await delay(100);
  }
  await stop(worker);
  console.log(JSON.stringify({ success: true, database: postgres ? "postgresql" : "sqlite", dmlOnlyRole: postgres, smokeChecks: report.checks.length, retiredAuthEndpointChecks: retiredEndpoints.length, syntheticAccountCleanup: true, workerFirstScanAndShutdown: true, serverGitSha: report.serverVersion.serverGitSha }, null, 2));
} catch (error) {
  if (fs.existsSync(path.join(work, "process.log"))) console.error(fs.readFileSync(path.join(work, "process.log"), "utf8").slice(-8000));
  throw error;
} finally {
  await stop(worker);
  await stop(api);
  if (logs !== undefined) fs.closeSync(logs);
  if (clusterStarted) run("pg_ctl", ["-D", path.join(work, "pg"), "-m", "immediate", "-w", "stop"]);
  fs.rmSync(work, { recursive: true, force: true });
}
