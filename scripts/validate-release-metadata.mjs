import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const release = JSON.parse(await readFile(new URL("../release.json", import.meta.url), "utf8"));
const eas = JSON.parse(await readFile(new URL("../client/eas.json", import.meta.url), "utf8"));
const configureExpo = require("../client/app.config.js");
const expo = configureExpo({ config: { extra: {}, ios: {}, android: {} } });

assert.match(release.productVersion, /^\d+\.\d+\.\d+$/, "productVersion must be a release semver");
assert.equal(packageJson.version, release.productVersion, "package.json and release.json product versions diverged");
const snapshot = /^(\d{2})w(\d{2})([a-z])$/.exec(release.snapshot);
assert.ok(snapshot, "snapshot must use YYwWW revision format, for example 26w35a");
const expectedBuildNumber = Number(`${snapshot[1]}${snapshot[2]}${String(snapshot[3].charCodeAt(0) - 96).padStart(2, "0")}`);
assert.equal(release.buildNumber, expectedBuildNumber, "buildNumber does not match the release snapshot");
assert.equal(expo.version, release.productVersion, "Expo marketing version diverged");
assert.equal(expo.ios.buildNumber, String(release.buildNumber), "iOS buildNumber diverged");
assert.equal(expo.android.versionCode, release.buildNumber, "Android versionCode diverged");
assert.equal(expo.extra.releaseSnapshot, release.snapshot, "Expo snapshot metadata diverged");
assert.equal(expo.extra.buildNumber, release.buildNumber, "Expo extra build metadata diverged");
assert.equal(eas.cli?.appVersionSource, "local", "EAS must use release.json through the local Expo config");
assert.equal(eas.build?.candidate?.autoIncrement, false, "candidate builds must not mutate the shared build number");

console.log(`${release.productVersion} (${release.snapshot} · build ${release.buildNumber})`);
