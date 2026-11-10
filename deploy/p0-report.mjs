import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const requiredChecks = {
  105: ["https-external", "cors", "isolation", "admin-password-rotated", "restart-persistence", "rollback-runbook"],
  106: ["empty-database", "previous-staging-upgrade", "backup-integrity", "restore-business-data", "restore-failure-protection", "rpo-rto", "offsite-retention"],
  107: ["same-candidate", "android-install-upgrade", "android-core-loop", "android-recovery-accessibility", "ios-install-upgrade", "ios-core-loop", "ios-recovery-accessibility"],
};

// This compiles operator-reviewed evidence. It does not perform or attest a drill.
export async function compileReport(input, directory) {
  if (!/^[a-f0-9]{40}$/.test(input.candidateSha || "")) throw new Error("Full candidateSha is required");
  if (!input.owner?.trim()) throw new Error("owner is required");
  const url = new URL(input.stagingUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Use a credential-free HTTPS stagingUrl");
  const checks = [];
  const known = new Set(Object.values(requiredChecks).flat());
  const seen = new Set();
  for (const entry of input.checks || []) {
    if (!known.has(entry.id) || seen.has(entry.id)) throw new Error(`Unknown or duplicate check: ${entry.id}`);
    seen.add(entry.id);
    if (!["passed", "failed", "blocked"].includes(entry.status)) throw new Error(`Invalid status: ${entry.id}`);
    if (entry.candidateSha !== input.candidateSha) throw new Error(`Candidate mismatch: ${entry.id}`);
    if (!entry.executor?.trim() || !Number.isFinite(Date.parse(entry.executedAt))) throw new Error(`Executor and timestamp required: ${entry.id}`);
    if (!["staging", "device", "local", "ci"].includes(entry.environment)) throw new Error(`Invalid environment: ${entry.id}`);
    const evidence = [];
    for (const file of entry.evidence || []) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("Evidence must be relative to the input directory");
      const content = await fs.readFile(path.resolve(directory, file));
      evidence.push({ file, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
    }
    if (entry.status === "passed" && !evidence.length) throw new Error(`Passed check requires evidence: ${entry.id}`);
    checks.push({ id: entry.id, status: entry.status, candidateSha: entry.candidateSha,
      executor: entry.executor, executedAt: entry.executedAt, environment: entry.environment, evidence });
  }
  const issues = Object.entries(requiredChecks).map(([issue, ids]) => {
    const incomplete = ids.filter(id => {
      const check = checks.find(item => item.id === id);
      const expectedEnvironment = id.startsWith("android-") || id.startsWith("ios-") ? "device" : "staging";
      return check?.status !== "passed" || check.environment !== expectedEnvironment;
    });
    return { issue: Number(issue), readyForReview: incomplete.length === 0, incomplete };
  });
  return { format: "dietdigidose-p0-evidence-v1", candidateSha: input.candidateSha, owner: input.owner,
    stagingUrl: url.href, generatedAt: new Date().toISOString(), issues, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error("Usage: node deploy/p0-report.mjs <input.json> <report.json>");
  const result = await compileReport(JSON.parse(await fs.readFile(source, "utf8")), path.dirname(path.resolve(source)));
  await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result.issues));
}
