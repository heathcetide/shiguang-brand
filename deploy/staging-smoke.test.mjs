import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const script = fileURLToPath(new URL("./staging-smoke.mjs",import.meta.url));
const warningMessage = "injected runtime warning must remain visible";
const warningModule = `data:text/javascript,${encodeURIComponent(`process.emitWarning(${JSON.stringify(warningMessage)}, { code: "SMOKE_TEST_WARNING" });`)}`;
const run = (baseUrl, injectWarning = false, expectedSha = "") => new Promise(resolve => execFile(process.execPath,[...(injectWarning ? ["--import",warningModule] : []),script],{ env: { ...process.env,STAGING_BASE_URL: baseUrl,ALLOW_HTTP: "1",EXPECTED_SERVER_GIT_SHA: expectedSha },timeout: 10_000 },(error,stdout,stderr) => resolve({ error,stdout,stderr })));
for (const injectWarning of [false,true]) for (const cleanupFails of [false,true]) test(`failed login retains a cleanup credential and reports cleanup ${cleanupFails ? "failure" : "success"}${injectWarning ? " with a runtime warning" : ""}`,async () => {
  let deletions = 0;
  const server = createServer((req,res) => {
    req.resume();
    res.setHeader("content-type","application/json");
    if (req.url==="/api/v1/auth/login") { res.statusCode=401; res.end('{"error":"injected login failure"}'); }
    else if (req.url==="/api/v1/auth/register") { res.statusCode=201; res.end('{"token":"registration-cleanup-token"}'); }
    else if (req.url==="/api/v1/auth/account" && req.method==="DELETE") {
      deletions++;
      assert.equal(req.headers.authorization,"Bearer registration-cleanup-token");
      res.statusCode=cleanupFails ? 503 : 200; res.end('{}');
    } else res.end('{}');
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const result = await run(`http://127.0.0.1:${server.address().port}`,injectWarning);
    assert.equal(result.error?.code,1,`unexpected child failure: ${result.stderr}`);
    assert.equal(result.error.killed,false);
    const report = JSON.parse(result.stdout);
    assert.equal(report.success,false); assert.equal(report.cleanup.attempted,true);
    assert.equal(report.cleanup.success,!cleanupFails); assert.equal(deletions,1);
    assert.match(result.stderr,/Staging smoke failed: POST \/api\/v1\/auth\/login -> 401/);
    if (cleanupFails) assert.match(result.stderr,/Staging smoke cleanup failed: DELETE \/api\/v1\/auth\/account -> 503/);
    assert.match(report.error,/POST \/api\/v1\/auth\/login -> 401/);
    if (cleanupFails) assert.match(report.cleanup.error,/DELETE \/api\/v1\/auth\/account -> 503/);
    else assert.equal(report.cleanup.error,undefined);
    if (injectWarning) assert.match(result.stderr,/\[SMOKE_TEST_WARNING\] Warning: injected runtime warning must remain visible/);
    assert.equal(`${result.stdout}${result.stderr}`.includes("registration-cleanup-token"),false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("HTTP bypass is restricted to loopback drills",async () => {
  const result = await run("http://example.invalid");
  assert.equal(result.error?.code,1); assert.match(result.stderr,/loopback drills only/);
  assert.equal(result.stdout,"");
});

for (const actualSha of [null, "b".repeat(40), "a".repeat(40)]) test(`candidate identity ${actualSha === null ? "missing" : actualSha[0]} is recorded and checked before writes`, async () => {
  const expectedSha = "a".repeat(40);
  const writes = [];
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader("content-type", "application/json");
    if (req.method !== "GET") {
      writes.push(req.url);
      res.statusCode = 503;
      res.end('{"error":"stop after identity check"}');
    } else if (req.url === "/api/v1/version") {
      res.end(JSON.stringify({ serverVersion: "1.0.6", serverBuildTime: "2026-10-31T00:00:00Z", serverGitSha: actualSha }));
    } else res.end('{}');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await run(`http://127.0.0.1:${server.address().port}`, false, expectedSha);
    const report = JSON.parse(result.stdout);
    assert.equal(result.error?.code, 1);
    assert.equal(report.success, false);
    assert.equal(report.serverVersion.serverGitSha, actualSha);
    assert.equal(report.serverVersion.serverBuildTime, "2026-10-31T00:00:00Z");
    assert.equal(report.expectedServerGitSha, expectedSha);
    assert.ok(Number.isFinite(Date.parse(report.startedAt)));
    assert.deepEqual(writes, actualSha === expectedSha ? ["/api/v1/auth/register"] : []);
    assert.match(report.error, actualSha === expectedSha ? /stop after identity check/ : /Server commit does not match/);
    assert.equal(report.cleanup.attempted, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("malformed expected commit is rejected before making requests", async () => {
  const result = await run("http://127.0.0.1:1", false, "short-sha");
  assert.equal(result.error?.code, 1);
  assert.match(result.stderr, /EXPECTED_SERVER_GIT_SHA must be/);
  assert.equal(result.stdout, "");
});
