import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import express from "express";
import { APP_UPDATE_MANIFEST_MAX_BYTES, type AppUpdateRelease } from "@dietdigidose/contracts";
import { createAdminAppUpdatesRouter } from "../src/routes/admin/app-updates.js";
import { createAppUpdatesRouter } from "../src/routes/app-updates.js";
import {
  mutateAppUpdateManifest,
  parseAllowedOrigins,
  readAppUpdateManifest,
  replaceManifestRelease,
  revokeManifestRelease,
  validateAllowedOrigins,
  writeAppUpdateManifest,
} from "../src/services/appUpdateManifestService.js";

const sampleBytes = Buffer.from("apk content preview");
const sampleRelease: AppUpdateRelease = {
  schemaVersion: 1,
  platform: "android",
  applicationId: "com.dietdigidose.app.preview",
  channel: "preview",
  version: "1.0.6",
  snapshot: "26w44a",
  buildNumber: 264401,
  url: "https://dietdigidose.top/downloads/26w44a.apk",
  sizeBytes: sampleBytes.length,
  sha256: createHash("sha256").update(sampleBytes).digest("hex"),
  releaseNotes: "26w44a preview 更新说明",
  publishedAt: "2026-10-27T00:00:00.000Z",
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "diet-admin-updates-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function startServer(t: TestContext, options: Parameters<typeof createAdminAppUpdatesRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, role: "admin", username: "AdminTester" };
    next();
  });
  app.use("/admin", createAdminAppUpdatesRouter(options));
  app.use("/admin/client-updates", createAppUpdatesRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return async (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${address.port}/admin${path}`, init);
}

test("validateAllowedOrigins and parseAllowedOrigins strictly validate HTTPS origins", () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(""), []);
  assert.deepEqual(
    parseAllowedOrigins("https://dietdigidose.top, https://cdn.dietdigidose.top"),
    ["https://dietdigidose.top", "https://cdn.dietdigidose.top"],
  );

  const invalidHttp = validateAllowedOrigins("https://dietdigidose.top, http://insecure.example.com");
  assert.ok(invalidHttp.error?.includes("非法的 HTTPS 域名白名单格式"));
  assert.deepEqual(parseAllowedOrigins("https://dietdigidose.top, http://insecure.example.com"), []);

  const trailingComma = validateAllowedOrigins("https://dietdigidose.top,");
  assert.ok(trailingComma.error?.includes("空条目"));
  assert.deepEqual(parseAllowedOrigins("https://dietdigidose.top,"), []);
});

test("mutateAppUpdateManifest serializes concurrent mutations without race conditions", async (t) => {
  const dir = await fixture(t);
  const manifestPath = join(dir, "manifest.json");
  await writeAppUpdateManifest(manifestPath, { schemaVersion: 1, releases: [] });

  const releaseA: AppUpdateRelease = {
    ...sampleRelease,
    channel: "preview",
    applicationId: "com.dietdigidose.app.preview",
    buildNumber: 264401,
  };
  const releaseB: AppUpdateRelease = {
    ...sampleRelease,
    channel: "candidate",
    applicationId: "com.dietdigidose.app",
    snapshot: "26w44b",
    buildNumber: 264402,
  };

  // Launch both concurrent writes simultaneously
  await Promise.all([
    mutateAppUpdateManifest(manifestPath, (current) => {
      const next = replaceManifestRelease(current, releaseA);
      return { result: next, manifest: next };
    }),
    mutateAppUpdateManifest(manifestPath, (current) => {
      const next = replaceManifestRelease(current, releaseB);
      return { result: next, manifest: next };
    }),
  ]);

  const finalManifest = await readAppUpdateManifest(manifestPath);
  assert.equal(finalManifest.manifest.releases.length, 2);
  assert.ok(finalManifest.manifest.releases.some((r) => r.channel === "preview"));
  assert.ok(finalManifest.manifest.releases.some((r) => r.channel === "candidate"));
});

test("readAppUpdateManifest handles unconfigured, missing, and existing manifests", async (t) => {
  const dir = await fixture(t);
  const unconfigured = await readAppUpdateManifest(undefined);
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(unconfigured.manifest.releases, []);

  const missingPath = join(dir, "manifest.json");
  const missing = await readAppUpdateManifest(missingPath);
  assert.equal(missing.configured, true);
  assert.equal(missing.missing, true);
  assert.deepEqual(missing.manifest.releases, []);

  await writeAppUpdateManifest(missingPath, { schemaVersion: 1, releases: [sampleRelease] });
  const loaded = await readAppUpdateManifest(missingPath);
  assert.equal(loaded.configured, true);
  assert.equal(loaded.manifest.releases.length, 1);
  assert.deepEqual(loaded.manifest.releases[0], sampleRelease);
});

test("replaceManifestRelease and revokeManifestRelease maintain integrity and reject downgrades", () => {
  const initial = { schemaVersion: 1 as const, releases: [] };
  const withRelease = replaceManifestRelease(initial, sampleRelease);
  assert.equal(withRelease.releases.length, 1);

  // Downgrade rejected
  const downgradeRelease: AppUpdateRelease = {
    ...sampleRelease,
    snapshot: "26w43a",
    buildNumber: 264301,
  };
  assert.throws(
    () => replaceManifestRelease(withRelease, downgradeRelease),
    /不能发布低于或重复且不一致的构建编号版本/,
  );

  // Upgrade accepted
  const upgradedRelease: AppUpdateRelease = {
    ...sampleRelease,
    snapshot: "26w44b",
    buildNumber: 264402,
  };
  const upgraded = replaceManifestRelease(withRelease, upgradedRelease);
  assert.equal(upgraded.releases.length, 1);
  assert.equal(upgraded.releases[0].buildNumber, 264402);

  // Revoke removes channel
  const revoked = revokeManifestRelease(upgraded, "com.dietdigidose.app.preview", "preview");
  assert.equal(revoked.releases.length, 0);
});

test("createAdminAppUpdatesRouter handles GET, publish, and revoke operations", async (t) => {
  const dir = await fixture(t);
  const manifestPath = join(dir, "manifest.json");
  const allowedOrigins = "https://dietdigidose.top";

  const request = await startServer(t, { manifestPath, allowedOrigins });

  // 1. GET initial state
  const getRes = await request("/app-updates");
  assert.equal(getRes.status, 200);
  const initialBody = (await getRes.json()) as Record<string, any>;
  assert.equal(initialBody.configured, false);
  assert.match(initialBody.error, /清单文件尚不存在/);
  assert.deepEqual(initialBody.allowedOrigins, ["https://dietdigidose.top"]);
  assert.deepEqual(initialBody.manifest.releases, []);

  // 2. Reject publication from untrusted origin
  const untrustedRes = await request("/app-updates/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...sampleRelease, url: "https://evil.attacker.com/app.apk" }),
  });
  assert.equal(untrustedRes.status, 400);

  // 3. Publish valid release
  const publishRes = await request("/app-updates/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sampleRelease),
  });
  assert.equal(publishRes.status, 200);
  const publishBody = (await publishRes.json()) as Record<string, any>;
  assert.equal(publishBody.success, true);
  assert.equal(publishBody.manifest.releases.length, 1);

  // 4. Verify file on disk
  const onDisk = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(onDisk.releases.length, 1);
  assert.equal(onDisk.releases[0].snapshot, "26w44a");
  const publishedState = await (await request("/app-updates")).json() as Record<string, any>;
  assert.equal(publishedState.configured, true);
  assert.equal(publishedState.error, null);

  // 5. Revoke release
  const revokeRes = await request("/app-updates/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: "com.dietdigidose.app.preview",
      channel: "preview",
    }),
  });
  assert.equal(revokeRes.status, 200);
  const revokeBody = (await revokeRes.json()) as Record<string, any>;
  assert.equal(revokeBody.success, true);
  assert.equal(revokeBody.manifest.releases.length, 0);

  // 6. Revoke non-existent returns 404
  const revokeNonExistent = await request("/app-updates/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: "com.dietdigidose.app.preview",
      channel: "preview",
    }),
  });
  assert.equal(revokeNonExistent.status, 404);
});

test("admin availability agrees with client checks for invalid manifests and recovers after repair", async (t) => {
  const manifestPath = join(await fixture(t), "manifest.json");
  const request = await startServer(t, { manifestPath, allowedOrigins: "https://dietdigidose.top" });
  const query = `/client-updates?${new URLSearchParams({
    platform: "android", applicationId: sampleRelease.applicationId, channel: "preview", buildNumber: "264301",
  })}`;
  for (const content of [undefined, "invalid", '{"schemaVersion":2}', " ".repeat(APP_UPDATE_MANIFEST_MAX_BYTES + 1)]) {
    if (content !== undefined) await writeFile(manifestPath, content);
    const state = await (await request("/app-updates")).json() as Record<string, any>;
    assert.equal(state.configured, false);
    assert.ok(state.error);
    assert.equal((await request(query)).status, 503);
  }
  await writeAppUpdateManifest(manifestPath, { schemaVersion: 1, releases: [] });
  const repaired = await (await request("/app-updates")).json() as Record<string, any>;
  assert.equal(repaired.configured, true);
  assert.equal(repaired.error, null);
  assert.deepEqual(await (await request(query)).json(), { update: null });
});

test("admin exposes untrusted stored releases and allows withdrawal to restore client checks", async (t) => {
  const manifestPath = join(await fixture(t), "manifest.json");
  const untrusted = { ...sampleRelease, url: "https://old-downloads.example.com/app.apk" };
  await writeAppUpdateManifest(manifestPath, { schemaVersion: 1, releases: [untrusted] });
  const request = await startServer(t, { manifestPath, allowedOrigins: "https://dietdigidose.top" });
  const state = await (await request("/app-updates")).json() as Record<string, any>;
  const query = `/client-updates?${new URLSearchParams({
    platform: "android", applicationId: sampleRelease.applicationId, channel: "preview", buildNumber: "264301",
  })}`;
  assert.equal(state.configured, false);
  assert.match(state.error, /未授权的 APK 下载源/);
  assert.deepEqual(state.manifest.releases, [untrusted]);
  assert.equal((await request(query)).status, 503);
  const response = await request("/app-updates/revoke", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: untrusted.applicationId, channel: untrusted.channel }),
  });
  assert.equal(response.status, 200);
  const recovered = await (await request("/app-updates")).json() as Record<string, any>;
  assert.equal(recovered.configured, true);
  assert.equal(recovered.error, null);
  assert.deepEqual(await (await request(query)).json(), { update: null });
});
