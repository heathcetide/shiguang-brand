import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  APP_UPDATE_MANIFEST_MAX_BYTES, appUpdateApplicationIdSchema, appUpdateChannelSchema, appUpdateManifestSchema, appUpdateReleaseSchema,
  type AppUpdateManifest, type AppUpdateRelease,
} from "@dietdigidose/contracts";

export async function hashApk(filename: string) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filename)) {
    sizeBytes += chunk.length;
    if (sizeBytes > 512 * 1024 * 1024) throw new Error("APK exceeds the 512 MiB update limit");
    hash.update(chunk);
  }
  if (!sizeBytes) throw new Error("APK is empty");
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function verifyHostedApk(release: AppUpdateRelease, request: typeof fetch = fetch) {
  // Only a directly accessible, complete HTTPS artifact may enter a channel manifest.
  const response = await request(release.url, {
    redirect: "manual", signal: AbortSignal.timeout(120_000), headers: { "Accept-Encoding": "identity" },
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error("Public APK must return HTTP 200 without login or redirects");
  }
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== release.sizeBytes) {
    await response.body.cancel();
    throw new Error("Public APK size differs from the signed local artifact");
  }
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > release.sizeBytes) throw new Error("Public APK exceeds the expected size");
    hash.update(chunk);
  }
  if (size !== release.sizeBytes || hash.digest("hex") !== release.sha256) throw new Error("Public APK checksum or size mismatch");
}

export function replaceRelease(previous: AppUpdateManifest, release: AppUpdateRelease) {
  const existing = previous.releases.find((item) => item.applicationId === release.applicationId && item.channel === release.channel);
  if (existing && (release.buildNumber < existing.buildNumber
    || (release.buildNumber === existing.buildNumber && JSON.stringify(release) !== JSON.stringify(existing)))) {
    throw new Error("A channel release cannot downgrade or replace an existing build; reserve a new snapshot");
  }
  return appUpdateManifestSchema.parse({ schemaVersion: 1, releases: [
    ...previous.releases.filter((item) => item.applicationId !== release.applicationId || item.channel !== release.channel), release,
  ] });
}

export function validateApkPublication(manifestXml: string, signatureOutput: string, expected: { channel: string; snapshot: string; certificate: string }) {
  const certificate = expected.certificate.replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(certificate)) throw new Error("Expected certificate SHA-256 must be a pinned 64-digit fingerprint");
  // Build Tools used for 26w41a label the sole v2 signer differently from older releases.
  const signers = [...signatureOutput.matchAll(/^(?:Signer #\d+|V2 Signer:) certificate SHA-256 digest: ([a-f0-9]+)\s*$/gim)].map((match) => match[1].toLowerCase());
  if (signers.length !== 1 || signers[0] !== certificate) throw new Error("APK signer does not match the channel certificate");
  const metadata = [...manifestXml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<meta-data\b[^>]*>/g)].map((match) => match[0]);
  for (const [key, value] of [["channel", expected.channel], ["snapshot", expected.snapshot]]) {
    const name = `com.dietdigidose.updates.${key}`;
    const tags = metadata.filter((tag) => /\bandroid:name\s*=\s*["']([^"']+)["']/.exec(tag)?.[1] === name);
    if (tags.length !== 1 || /\bandroid:value\s*=\s*["']([^"']+)["']/.exec(tags[0])?.[1] !== value) {
      throw new Error(`APK native ${key} differs from the requested release`);
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    apk: { type: "string" }, url: { type: "string" }, channel: { type: "string" },
    "application-id": { type: "string" }, "release-file": { type: "string" }, "notes-file": { type: "string" },
    previous: { type: "string" }, output: { type: "string" }, apkanalyzer: { type: "string" },
    apksigner: { type: "string" }, "certificate-sha256": { type: "string" },
    revoke: { type: "boolean", default: false },
  } });
  const applicationId = appUpdateApplicationIdSchema.parse(values["application-id"]);
  const channel = appUpdateChannelSchema.parse(values.channel);
  if (!values.output) throw new Error("--output must be a new manifest path");
  const previous = values.previous
    ? appUpdateManifestSchema.parse(JSON.parse(await readFile(values.previous, "utf8")))
    : { schemaVersion: 1 as const, releases: [] };
  let manifest: AppUpdateManifest;
  if (values.revoke) {
    if (!values.previous || values.apk || values.url) throw new Error("--revoke requires --previous and no APK or URL");
    manifest = { schemaVersion: 1, releases: previous.releases.filter((item) => item.applicationId !== applicationId || item.channel !== channel) };
  } else {
    if (!values.apk || !values.url || !values["release-file"] || !values["notes-file"] || !values["certificate-sha256"]) {
      throw new Error("Required: --apk --url --application-id --channel --release-file --notes-file --certificate-sha256 --output; use --previous to preserve other channels");
    }
    const metadata = JSON.parse(await readFile(values["release-file"], "utf8"));
    const apk = resolve(values.apk);
    const analyzer = values.apkanalyzer || process.env.APKANALYZER || "apkanalyzer";
    const nativeValue = (name: string) => execFileSync(analyzer, ["manifest", name, apk], { encoding: "utf8", timeout: 30_000 }).trim();
    if (nativeValue("application-id") !== applicationId || nativeValue("version-code") !== String(metadata.buildNumber)
      || nativeValue("version-name") !== metadata.productVersion) throw new Error("Signed APK identity does not match the requested release");
    const signature = execFileSync(values.apksigner || process.env.APKSIGNER || "apksigner", ["verify", "--print-certs", apk], { encoding: "utf8", timeout: 30_000 });
    validateApkPublication(nativeValue("print"), signature, { channel, snapshot: metadata.snapshot, certificate: values["certificate-sha256"] });
    const release = appUpdateReleaseSchema.parse({
      schemaVersion: 1, platform: "android", applicationId, channel,
      version: metadata.productVersion, snapshot: metadata.snapshot, buildNumber: metadata.buildNumber,
      url: values.url, ...await hashApk(apk), releaseNotes: await readFile(values["notes-file"], "utf8"), publishedAt: new Date().toISOString(),
    });
    manifest = replaceRelease(previous, release);
    await verifyHostedApk(release);
  }
  // Write a new file only after all checks; the operator atomically activates it.
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > APP_UPDATE_MANIFEST_MAX_BYTES) throw new Error("Update manifest exceeds the API size limit");
  await writeFile(values.output, serialized, { flag: "wx", mode: 0o600 });
  return { output: values.output, releases: manifest.releases.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Update manifest generation failed");
    process.exitCode = 1;
  });
}
