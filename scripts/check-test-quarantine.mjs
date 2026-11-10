import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "quality", "test-quarantine.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
const testFilePattern = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/;
const skippedPattern = /\b(?:describe|it|test)\.(?:skip|todo)\s*\(|\b(?:xdescribe|xit)\s*\(/g;
const focusedPattern = /\b(?:describe|it|test)\.only\s*\(|\b(?:fdescribe|fit)\s*\(/g;

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(entryPath);
    return testFilePattern.test(entry.name) ? [entryPath] : [];
  });
}

const files = ["client", "server", "admin"].flatMap((directory) => filesUnder(path.join(root, directory)));
const findings = [];
const focused = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const [pattern, target] of [[skippedPattern, findings], [focusedPattern, focused]]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      target.push({
        file: path.relative(root, file).replaceAll(path.sep, "/"),
        line: source.slice(0, match.index).split("\n").length,
        marker: match[0],
      });
    }
  }
}

const failures = focused.map((finding) => `${finding.file}:${finding.line} contains focused test ${finding.marker}`);
const today = new Date().toISOString().slice(0, 10);
const maximumExpiry = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const entriesByFile = new Map(entries.map((entry) => [entry.file, entry]));
if (entriesByFile.size !== entries.length) failures.push("quarantine entries must use unique file paths");
for (const finding of findings) {
  const entry = entriesByFile.get(finding.file);
  if (!entry) failures.push(`${finding.file}:${finding.line} is skipped without a quarantine entry`);
}
for (const entry of entries) {
  if (!findings.some((finding) => finding.file === entry.file)) failures.push(`${entry.file}: quarantine entry is stale`);
  if (!entry.owner || !entry.reason) failures.push(`${entry.file}: quarantine requires owner and reason`);
  if (!/^https:\/\/github\.com\/AdlinZ\/DietDigiDose\/issues\/\d+$/.test(entry.issue || "")) failures.push(`${entry.file}: quarantine requires an issue URL`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn || "") || entry.expiresOn < today) failures.push(`${entry.file}: quarantine is expired or has no valid expiresOn`);
  if (entry.expiresOn > maximumExpiry) failures.push(`${entry.file}: quarantine may not exceed 14 days`);
}

console.log(JSON.stringify({ success: failures.length === 0, scannedTestFiles: files.length, skipped: findings, focused, entries, failures }, null, 2));
if (failures.length) process.exitCode = 1;
