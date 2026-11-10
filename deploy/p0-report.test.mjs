import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileReport, requiredChecks } from "./p0-report.mjs";

test("local evidence and Android alone cannot close release gates", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "p0-report-"));
  try {
    await fs.writeFile(path.join(dir, "result.txt"), "synthetic evidence");
    const candidateSha = "a".repeat(40);
    const input = { candidateSha, owner: "tester", stagingUrl: "https://staging.example.com", checks:
      Object.values(requiredChecks).flat().map(id => ({ id, candidateSha, executor: "tester",
        executedAt: new Date().toISOString(), status: "passed", environment: "local", evidence: ["result.txt"] })) };
    assert.ok((await compileReport(input, dir)).issues.every(issue => !issue.readyForReview));
    for (const check of input.checks) check.environment = /^(android|ios)-/.test(check.id) ? "device" : "staging";
    input.checks = input.checks.filter(check => !check.id.startsWith("ios-"));
    const report = await compileReport(input, dir);
    assert.deepEqual(report.issues.map(issue => issue.readyForReview), [true, true, false]);
    input.checks[0].candidateSha = "b".repeat(40);
    await assert.rejects(compileReport(input, dir), /Candidate mismatch/);
    input.checks[0].candidateSha = candidateSha;
    input.checks[0].evidence = [];
    await assert.rejects(compileReport(input, dir), /requires evidence/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
