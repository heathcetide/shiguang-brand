import test from "node:test";
import assert from "node:assert/strict";
import { buildWeek, nextBuildRelease } from "./prepare-build-release.mjs";

const release = { productVersion: "1.0.6", snapshot: "26w36a", buildNumber: 263601 };
const monday = new Date("2026-09-07T00:00:00+08:00");

test("uses ISO weeks in Shanghai, including year boundaries", () => {
  assert.equal(buildWeek(new Date("2026-09-06T15:59:59Z")), "26w36");
  assert.equal(buildWeek(monday), "26w37");
  assert.equal(buildWeek(new Date("2027-01-01T00:00:00+08:00")), "26w53");
});

test("increments each build in a week, including reserved builds from other revisions", () => {
  const first = nextBuildRelease(release, [], monday);
  assert.equal(first.snapshot, "26w37a");
  const second = nextBuildRelease(first, [], monday);
  assert.equal(second.snapshot, "26w37b");
  assert.equal(second.buildNumber, 263702);
  assert.equal(nextBuildRelease(release, [first.snapshot, second.snapshot], monday).snapshot, "26w37c");
  assert.equal(nextBuildRelease(second, [], new Date("2026-09-14T00:00:00+08:00")).snapshot, "26w38a");
});

test("never wraps or moves backwards to a reused version code", () => {
  assert.throws(() => nextBuildRelease(release, ["26w37z"], monday), /exhausted/);
  assert.throws(() => nextBuildRelease(release, [], new Date("2026-08-25")), /precedes/);
});

test("reserves different revisions when CI checks out the same old metadata again", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { prepareBuild } = await import("./prepare-build-release.mjs");
  const directory = mkdtempSync(join(tmpdir(), "weekly-build-test-"));
  const remote = join(directory, "remote.git");
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git("init");
    git("init", "--bare", remote);
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    git("commit", "--allow-empty", "-m", "Test source");
    git("remote", "add", "origin", remote);
    const old = { ...release, snapshot: "25w01a", buildNumber: 250101 };
    writeFileSync(join(directory, "release.json"), JSON.stringify(old));
    const first = prepareBuild({ publish: true, directory });
    writeFileSync(join(directory, "release.json"), JSON.stringify(old));
    const second = prepareBuild({ publish: true, directory });
    assert.equal(first.snapshot, `${buildWeek()}a`);
    assert.equal(second.snapshot, `${buildWeek()}b`);
    assert.equal(second.buildNumber, first.buildNumber + 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("explicit carryover reserves only the next unused revision without lowering version codes", () => {
  const nextWeek = new Date("2026-09-14T00:00:00+08:00");
  const used = ["26w37a", "26w37b", "26w37c"];
  assert.deepEqual(nextBuildRelease(release, used, nextWeek, "26w37d"), { ...release, snapshot: "26w37d", buildNumber: 263704 });
  assert.throws(() => nextBuildRelease(release, used, nextWeek, "26w37c"), /next unused/);
  assert.throws(() => nextBuildRelease(release, used, nextWeek, "26w37e"), /next unused/);
  assert.throws(() => nextBuildRelease(release, [...used, "26w38a"], nextWeek, "26w37d"), /precedes/);
  assert.throws(() => nextBuildRelease(release, used, nextWeek, "26w00d"), /Invalid/);
});
