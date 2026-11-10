import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccessControlRepository } from "../src/modules/accessControl/repository.js";
import { AccessControlService } from "../src/modules/accessControl/service.js";

function repository(overrides: Partial<AccessControlRepository> = {}): AccessControlRepository {
  return {
    user: async () => null,
    ensureUserInitialState: async () => undefined,
    recordFunnelEvent: async () => undefined,
    ...overrides,
  };
}

describe("access control module", () => {
  test("normalizes SQLite and PostgreSQL access values", async () => {
    const sqlite = new AccessControlService(repository({
      user: async () => ({ sessionVersion: 3, isDisabled: 0, role: "admin", mustChangePassword: 1 }),
    }));
    assert.deepEqual(await sqlite.user(7), {
      sessionVersion: 3,
      isDisabled: false,
      role: "admin",
      mustChangePassword: true,
    });

    const postgres = new AccessControlService(repository({
      user: async () => ({ sessionVersion: "4", isDisabled: true, role: "user", mustChangePassword: false }),
    }));
    assert.deepEqual(await postgres.user(8), {
      sessionVersion: 4,
      isDisabled: true,
      role: "user",
      mustChangePassword: false,
    });
  });

  test("signs versioned sessions and rejects missing users", async () => {
    const service = new AccessControlService(repository({
      user: async () => ({ sessionVersion: 5, isDisabled: 0, role: "user", mustChangePassword: 0 }),
    }));
    const token = await service.signUserToken(9);
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    assert.equal(claims.userId, 9);
    assert.equal(claims.sessionVersion, 5);
    await assert.rejects(() => new AccessControlService(repository()).signUserToken(99), /USER_NOT_FOUND/);
  });

  test("writes only pseudonymous best-effort funnel events", async () => {
    const stored: Array<{ eventName: string; actorHash: string }> = [];
    const service = new AccessControlService(repository({
      recordFunnelEvent: async (eventName, actorHash) => { stored.push({ eventName, actorHash }); },
    }));
    await service.recordFunnelEvent(9, "login_succeeded");
    assert.equal(stored[0]?.eventName, "login_succeeded");
    assert.match(stored[0]?.actorHash || "", /^[a-f0-9]{64}$/);
    const originalWarn = console.warn;
    let warning = "";
    console.warn = (...values: unknown[]) => { warning = values.map(String).join(" "); };
    try {
      await new AccessControlService(repository({ recordFunnelEvent: async () => { throw new Error("telemetry unavailable"); } }))
        .recordFunnelEvent(9, "login_succeeded");
    } finally { console.warn = originalWarn; }
    assert.match(warning, /telemetry unavailable/);
  });

  test("validates and idempotently delegates account bootstrap", async () => {
    const userIds: number[] = [];
    const service = new AccessControlService(repository({
      ensureUserInitialState: async (userId) => { userIds.push(userId); },
    }));
    await service.ensureUserInitialState(12);
    await service.ensureUserInitialState(12);
    assert.deepEqual(userIds, [12, 12]);
    assert.throws(() => service.ensureUserInitialState(0), /INVALID_USER_ID/);
  });
});
