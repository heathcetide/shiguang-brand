import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProviderOperationError } from "../src/providers/contracts.js";
import { assertNoPublicServerSecrets, getProviderProfile, parseDeploymentProfile } from "../src/providers/profiles.js";
import { executeProviderOperation } from "../src/providers/runtime.js";

describe("deployment provider profiles", () => {
  it("selects complete, materially different China and Global provider sets", () => {
    const china = getProviderProfile("china");
    const global = getProviderProfile("global");
    assert.equal(china.id, "china");
    assert.equal(global.id, "global");
    assert.equal(china.providers.storage, "local-filesystem");
    assert.equal(global.providers.storage, "supabase-storage");
    assert.equal(china.providers.auth, "aliyun-pnvs");
    assert.equal(global.providers.auth, "password-jwt");
    for (const profile of [china, global]) {
      assert.deepEqual(Object.keys(profile.providers).sort(), ["analytics", "auth", "map", "notification", "payment", "storage"]);
      assert.equal(profile.capabilities.storage, true);
      assert.equal(profile.capabilities.map, false);
    }
  });

  it("rejects unknown profiles and publicly exposed server credentials", () => {
    assert.throws(() => parseDeploymentProfile("eu"), /must be china or global/);
    assert.throws(() => assertNoPublicServerSecrets({ EXPO_PUBLIC_JWT_SECRET: "leaked" }), /server-only/);
    assert.doesNotThrow(() => assertNoPublicServerSecrets({ JWT_SECRET: "server-side-only", EXPO_PUBLIC_DEPLOYMENT_PROFILE: "global" }));
  });

  it("uses the same operation path for either configured provider", async () => {
    for (const profileName of ["china", "global"] as const) {
      const profile = getProviderProfile(profileName);
      const result = await executeProviderOperation({
        providerId: profile.providers.storage,
        run: async () => ({ profile: profile.id, stored: true }),
      });
      assert.deepEqual(result.value, { profile: profile.id, stored: true });
      assert.equal(result.degraded, false);
    }
  });

  it("falls back only on retryable provider failures", async () => {
    const degraded = await executeProviderOperation({
      providerId: "primary",
      run: async () => { throw new ProviderOperationError("primary", "unavailable", "offline", true); },
      fallback: { providerId: "fallback", run: async () => "ok" },
    });
    assert.deepEqual(degraded, { value: "ok", providerId: "fallback", degraded: true });

    await assert.rejects(() => executeProviderOperation({
      providerId: "primary",
      run: async () => { throw new ProviderOperationError("primary", "rejected", "bad input", false); },
      fallback: { providerId: "fallback", run: async () => "must-not-run" },
    }), (error: unknown) => error instanceof ProviderOperationError && error.code === "rejected");
  });

  it("normalizes timeouts and then invokes the declared fallback", async () => {
    const result = await executeProviderOperation({
      providerId: "slow",
      timeoutMs: 100,
      run: async () => new Promise<string>(() => undefined),
      fallback: { providerId: "local", run: async () => "degraded" },
    });
    assert.deepEqual(result, { value: "degraded", providerId: "local", degraded: true });
  });
});
