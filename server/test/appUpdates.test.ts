import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import express from "express";
import { APP_UPDATE_MANIFEST_MAX_BYTES, appUpdateManifestSchema, appUpdateReleaseSchema, type AppUpdateRelease } from "@dietdigidose/contracts";
import { createAppUpdatesRouter } from "../src/routes/app-updates.js";
import { hashApk, main, replaceRelease, validateApkPublication, verifyHostedApk } from "../scripts/app-update-manifest.js";

const bytes = Buffer.from("signed APK fixture");
const release: AppUpdateRelease = {
  schemaVersion: 1, platform: "android", applicationId: "com.dietdigidose.app.preview", channel: "preview",
  version: "1.0.6", snapshot: "26w41a", buildNumber: 264101,
  url: "https://downloads.example.com/releases/26w41a.apk", sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), releaseNotes: "修复与改进", publishedAt: "2026-10-07T00:00:00.000Z",
};
const manifest = { schemaVersion: 1 as const, releases: [release] };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "diet-app-updates-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function start(t: TestContext, options: Parameters<typeof createAppUpdatesRouter>[0]) {
  const app = express();
  app.use("/updates", createAppUpdatesRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return async (overrides: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}/updates?${new URLSearchParams({
    platform: "android", applicationId: release.applicationId, channel: "preview", buildNumber: "263801", ...overrides,
  })}`);
}

test("update endpoint isolates native identity/channel/build and reads channel withdrawal without stale cache", async (t) => {
  const path = join(await fixture(t), "updates.json");
  await writeFile(path, JSON.stringify(manifest));
  const get = await start(t, { manifestPath: path, allowedOrigins: "https://downloads.example.com" });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { update: release });
  const otherIdentities: Record<string, string>[] = [{ channel: "production" }, { applicationId: "com.dietdigidose.app" }, { buildNumber: "264101" }, { buildNumber: "264102" }];
  for (const query of otherIdentities) {
    assert.deepEqual(await (await get(query)).json(), { update: null });
  }
  const invalidQueries: Record<string, string>[] = [{ buildNumber: "NaN" }, { buildNumber: "-1" }, { buildNumber: "1e3" }, { channel: "unknown" }, { platform: "ios" }];
  for (const query of invalidQueries) {
    assert.equal((await get(query)).status, 400);
  }
  await writeFile(path, JSON.stringify({ schemaVersion: 1, releases: [] }));
  assert.deepEqual(await (await get()).json(), { update: null });
});

test("missing, malformed, oversized and untrusted update manifests fail unavailable, not up-to-date", async (t) => {
  const path = join(await fixture(t), "updates.json");
  const disabled = await start(t, { manifestPath: undefined, allowedOrigins: undefined });
  assert.equal((await disabled()).status, 503);
  const get = await start(t, { manifestPath: path, allowedOrigins: "https://downloads.example.com" });
  assert.equal((await get()).status, 503);
  for (const content of ["invalid", " ".repeat(APP_UPDATE_MANIFEST_MAX_BYTES + 1), JSON.stringify({ ...manifest, releases: [{ ...release, url: "https://attacker.example/app.apk" }] }), JSON.stringify({ ...manifest, releases: [release, release] })]) {
    await writeFile(path, content);
    assert.equal((await get()).status, 503);
  }
  await writeFile(path, JSON.stringify(manifest));
  const badOrigin = await start(t, { manifestPath: path, allowedOrigins: "http://downloads.example.com" });
  assert.equal((await badOrigin()).status, 503);
});

test("publication pins the actual APK signing identity, native channel and snapshot", () => {
  const certificate = "a".repeat(64);
  const xml = '<manifest><application><meta-data android:name="com.dietdigidose.updates.channel" android:value="candidate" /><meta-data android:name="com.dietdigidose.updates.snapshot" android:value="26w41a" /></application></manifest>';
  const signature = `Signer #1 certificate SHA-256 digest: ${certificate}\n`;
  const expected = { certificate, channel: "candidate", snapshot: "26w41a" };
  assert.doesNotThrow(() => validateApkPublication(xml, signature, expected));
  const v2Signature = `Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ${certificate}\n`;
  assert.doesNotThrow(() => validateApkPublication(xml, v2Signature, expected));
  assert.throws(() => validateApkPublication(xml, v2Signature, { ...expected, certificate: "b".repeat(64) }), /signer/);
  assert.throws(() => validateApkPublication(xml, `${v2Signature}V2 Signer: certificate SHA-256 digest: ${certificate}\n`, expected), /signer/);
  assert.throws(() => validateApkPublication(xml, `Source Stamp Signer certificate SHA-256 digest: ${certificate}\n`, expected), /signer/);
  assert.throws(() => validateApkPublication(xml, signature, { ...expected, channel: "production" }), /channel/);
  assert.throws(() => validateApkPublication(xml, signature, { ...expected, snapshot: "26w41b" }), /snapshot/);
  assert.throws(() => validateApkPublication(xml, signature, { ...expected, certificate: "b".repeat(64) }), /signer/);
  assert.throws(() => validateApkPublication(xml, `${signature}Signer #2 certificate SHA-256 digest: ${certificate}\n`, expected), /signer/);
});

test("API accepts the maximum release count with long Unicode release notes", async (t) => {
  const releases = Array.from({ length: 20 }, (_, index) => ({ ...release, applicationId: `com.example.app${index}`, releaseNotes: "中".repeat(4000) }));
  const serialized = JSON.stringify(appUpdateManifestSchema.parse({ schemaVersion: 1, releases }), null, 2);
  assert.ok(Buffer.byteLength(serialized) > 128 * 1024 && Buffer.byteLength(serialized) < APP_UPDATE_MANIFEST_MAX_BYTES);
  const path = join(await fixture(t), "large.json");
  await writeFile(path, serialized);
  const get = await start(t, { manifestPath: path, allowedOrigins: "https://downloads.example.com" });
  assert.deepEqual(await (await get({ applicationId: "com.example.app0" })).json(), { update: releases[0] });
});

test("release validation rejects unsafe URLs, inconsistent snapshots and channel build replacement", () => {
  for (const url of ["http://downloads.example.com/a.apk", "https://user:secret@downloads.example.com/a.apk", "https://downloads.example.com/a.apk#fragment"]) {
    assert.equal(appUpdateReleaseSchema.safeParse({ ...release, url }).success, false);
  }
  assert.equal(appUpdateReleaseSchema.safeParse({ ...release, buildNumber: 264102 }).success, false);
  assert.equal(appUpdateManifestSchema.safeParse({ ...manifest, releases: [release, release] }).success, false);
  assert.throws(() => replaceRelease(manifest, { ...release, sha256: "f".repeat(64) }), /replace/);
  assert.throws(() => replaceRelease(manifest, { ...release, snapshot: "26w38a", buildNumber: 263801 }), /downgrade/);
  const candidate = { ...release, applicationId: "com.dietdigidose.app", channel: "candidate" as const };
  assert.equal(replaceRelease(manifest, candidate).releases.length, 2);
});

test("publishing verifies streamed public artifact bytes and refuses redirects, partial/truncated/tampered downloads", async (t) => {
  const apk = join(await fixture(t), "fixture.apk");
  await writeFile(apk, bytes);
  assert.deepEqual(await hashApk(apk), { sha256: release.sha256, sizeBytes: bytes.length });
  const respond = (response: Response) => (async (_url: string | URL | Request, options?: RequestInit) => {
    assert.equal(options?.redirect, "manual");
    return response;
  }) as typeof fetch;
  await verifyHostedApk(release, respond(new Response(bytes)));
  for (const response of [new Response(null, { status: 302 }), new Response(bytes, { status: 206 }), new Response(bytes.subarray(1)), new Response(Buffer.alloc(bytes.length)), new Response(Buffer.alloc(bytes.length + 1)), new Response(bytes, { headers: { "content-length": "1" } })]) {
    await assert.rejects(verifyHostedApk(release, respond(response)));
  }
});

test("revoking creates a new manifest while preserving other channels and cannot overwrite evidence", async (t) => {
  const directory = await fixture(t);
  const previous = join(directory, "previous.json"), output = join(directory, "next.json");
  const candidate = { ...release, applicationId: "com.dietdigidose.app", channel: "candidate" as const };
  await writeFile(previous, JSON.stringify(replaceRelease(manifest, candidate)));
  const args = ["--revoke", "--application-id", release.applicationId, "--channel", release.channel, "--previous", previous, "--output", output];
  await main(args);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { schemaVersion: 1, releases: [candidate] });
  assert.equal(JSON.parse(await readFile(previous, "utf8")).releases.length, 2);
  await assert.rejects(main(args), /EEXIST/);
});
