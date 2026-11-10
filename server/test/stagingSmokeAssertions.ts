import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
export async function verifyStagingSmoke(baseUrl: string) {
  const smoke = fileURLToPath(new URL("../../deploy/staging-smoke.mjs",import.meta.url));
  const stdout = await new Promise<string>((resolve,reject) => {
    execFile(process.execPath,[smoke],{ env: { ...process.env,STAGING_BASE_URL: baseUrl,ALLOW_HTTP: "1" },timeout: 60_000 },(error,stdout,stderr) => {
      if (error) reject(new Error(`staging smoke failed: ${stderr}`)); else resolve(stdout);
    });
  });
  const result = JSON.parse(stdout);
  assert.equal(result.success,true);
  for (const name of ["inventory.create.3","cooking.produce","cooking.production-retry","prepared.eat","prepared.eating-retry","prepared.discard","cooking.old-retry","account.delete"])
    assert.ok(result.checks.some((check: { name: string }) => check.name===name),name);
}
