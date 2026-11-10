import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repeats = Number(process.env.TEST_STABILITY_REPEATS || 2);
if (!Number.isInteger(repeats) || repeats < 2 || repeats > 10) throw new Error("TEST_STABILITY_REPEATS must be an integer between 2 and 10");

const attempts = [];
const pnpmScript = process.env.npm_execpath;
const command = pnpmScript ? process.execPath : (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const commandPrefix = pnpmScript ? [pnpmScript] : [];
for (let attempt = 1; attempt <= repeats; attempt += 1) {
  const startedAt = new Date();
  const startedMs = performance.now();
  const result = spawnSync(command, [...commandPrefix, "-w", "test:all"], { cwd: root, env: process.env, stdio: "inherit" });
  attempts.push({
    attempt,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now() - startedMs),
    exitCode: result.status ?? 1,
    signal: result.signal,
    error: result.error?.message,
  });
}

const report = {
  success: attempts.every((attempt) => attempt.exitCode === 0),
  sourceSha: process.env.GITHUB_SHA || "local",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  repeats,
  attempts,
};
const reportDirectory = path.join(root, "artifacts", "quality");
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, "test-stability.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 1;
