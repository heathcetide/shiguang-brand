import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const tagPrefix = "apk-build/";

// ISO week-year, using the Shanghai calendar even on UTC CI runners.
export function buildWeek(now = new Date()) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
  return `${String(year).slice(-2)}w${String(week).padStart(2, "0")}`;
}

export function nextBuildRelease(release, snapshots, now = new Date(), requestedSnapshot = "") {
  if (requestedSnapshot && !/^\d{2}w(0[1-9]|[1-4]\d|5[0-3])[a-z]$/.test(requestedSnapshot)) throw new Error("Invalid requested snapshot");
  const week = requestedSnapshot ? requestedSnapshot.slice(0, 5) : buildWeek(now);
  const used = [release.snapshot, ...snapshots].map((snapshot) => /^(\d{2}w\d{2})([a-z])$/.exec(snapshot));
  const revision = used.reduce((highest, match) => match?.[1] === week
    ? Math.max(highest, match[2].charCodeAt(0) - 96) : highest, 0) + 1;
  if (revision > 26) throw new Error(`Week ${week} has exhausted a–z build revisions`);
  const snapshot = `${week}${String.fromCharCode(96 + revision)}`;
  if (requestedSnapshot && snapshot !== requestedSnapshot) throw new Error(`Requested snapshot must be the next unused revision: ${snapshot}`);
  const buildNumber = Number(`${week.replace("w", "")}${String(revision).padStart(2, "0")}`);
  const highestReserved = used.reduce((highest, match) => match ? Math.max(highest, Number(`${match[1].replace("w", "")}${String(match[2].charCodeAt(0) - 96).padStart(2, "0")}`)) : highest, release.buildNumber);
  if (buildNumber <= highestReserved) throw new Error("Build date precedes the existing release; refusing to reuse a build number");
  return { ...release, snapshot, buildNumber };
}

export function prepareBuild({ publish = false, directory = root, requestedSnapshot = "" } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const releasePath = path.join(directory, "release.json");
  const release = JSON.parse(readFileSync(releasePath, "utf8"));
  // Reserve before compiling. Failed builds consume their identifier; retries get
  // a new one, so two distinct APKs can never share a weekly build revision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (publish) git("fetch", "origin", `refs/tags/${tagPrefix}*:refs/tags/${tagPrefix}*`);
    const snapshots = git("tag", "--list", `${tagPrefix}*`).split("\n").map((tag) => tag.slice(tagPrefix.length));
    const next = nextBuildRelease(release, snapshots, new Date(), requestedSnapshot);
    const tag = `${tagPrefix}${next.snapshot}`;
    // Annotated tags have a unique reservation object even for the same commit;
    // concurrent builds cannot both succeed by pushing an identical light tag.
    git("-c", "user.name=APK Build", "-c", "user.email=apk-build@users.noreply.github.com",
      "tag", "-a", tag, "-m", JSON.stringify({ ...next, reservation: randomUUID() }));
    if (publish) {
      try { git("push", "origin", `refs/tags/${tag}:refs/tags/${tag}`); }
      catch (error) {
        git("tag", "-d", tag);
        if (attempt === 4) throw error;
        continue;
      }
    }
    writeFileSync(releasePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${next.productVersion} (${next.snapshot} · build ${next.buildNumber})`);
    return next;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareBuild({ publish: process.argv.includes("--publish"), requestedSnapshot: process.env.APK_RELEASE_SNAPSHOT || "" });
}
