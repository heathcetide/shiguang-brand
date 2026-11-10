import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { describe, test } from "node:test";
import type { AuthAccountRepository } from "../src/modules/authAccount/repository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";

function repository(overrides: Partial<AuthAccountRepository> = {}): AuthAccountRepository {
  return {
    createUser: async () => ({ status: "created", user: { id: 7, username: "tester", email: "test@example.com" }, sessionVersion: 3 }),
    findLoginUser: async () => null, recordSuccessfulLogin: async () => 1, recordFunnelEvent: async () => undefined,
    recordAdminAudit: async () => undefined, getMe: async () => null, getCredentials: async () => null,
    changePassword: async () => false, updateProfile: async () => ({ status: "updated", user: {} }),
    exportAiData: async () => ({ messages: [], scan_jobs: [], agent_runs: [], agent_events: [], agent_actions: [],
      agent_media_references: [], agent_checkpoints: [], agent_checkpoint_blobs: [], agent_checkpoint_writes: [] }),
    deleteAiData: async () => ({ messages: 0, scan_jobs: 0, usage_logs: 0, write_confirmations: 0,
      chat_session_deletions: 0, agent_runs: 0 }), accountMediaUrls: async () => [],
    deleteAccount: async () => ({ deleted: false, cleanupJobId: null }), ...overrides,
  };
}

describe("auth account module", () => {
  test("passwordless accounts fail password authentication normally and can authorize deletion with a reauth token",async () => {
    let proof: unknown;
    const service=new AuthAccountService(repository({
      findLoginUser:async () => ({id:9,username:"手机用户",password_hash:null,role:"user",session_version:1,is_disabled:false}),
      getCredentials:async () => ({role:"user",password_hash:null}),
      deleteAccount:async (_id,_actor,_urls,_objects,input) => {proof=input;return {deleted:true,cleanupJobId:null};},
    }));
    await assert.rejects(() => service.login("13800138000","anything","127.0.0.1"),/密码错误/);
    await assert.rejects(() => service.changePassword(9,"anything","NewPass1"),/当前密码不正确/);
    await assert.rejects(() => service.deleteAccount(9,"anything"),/当前密码不正确/);
    assert.equal((await service.deleteAccount(9,{reauthToken:"token-from-bound-phone"})).success,true);
    assert.ok(proof && typeof proof==="object" && "tokenHash" in proof);
  });
  test("preserves registration identifiers, conflicts and versioned session claims", async () => {
    let passwordHash = ""; let funnel = "";
    const service = new AuthAccountService(repository({
      createUser: async (input) => { passwordHash = input.passwordHash; return { status: "created",
        user: { id: 7, username: input.username, email: input.email }, sessionVersion: 3 }; },
      recordFunnelEvent: async (_userId,event) => { funnel = event; },
    }));
    const result = await service.register(" Test@Example.com ","tester","safePass1");
    assert.equal(result.user.email,"test@example.com"); assert.equal(await bcrypt.compare("safePass1",passwordHash),true);
    assert.equal(funnel,"account_registered");
    const payload = JSON.parse(Buffer.from(result.token.split(".")[1]!,"base64url").toString()) as Record<string,unknown>;
    assert.equal(payload.userId,7); assert.equal(payload.sessionVersion,3);
    await assert.rejects(() => service.register("13800138000","tester","safePass1"),/短信验证/);
    await assert.rejects(() => new AuthAccountService(repository({ createUser: async () => ({ status:"username_exists" }) }))
      .register("test@example.com","tester","safePass1"),/用户名/);
  });

  test("login refuses a session when credentials changed after password comparison",async () => {
    const passwordHash=bcrypt.hashSync("BeforeReset1",4);
    const service=new AuthAccountService(repository({
      findLoginUser:async () => ({id:8,username:"member",password_hash:passwordHash,session_version:4,is_disabled:false,role:"user"}),
      recordSuccessfulLogin:async (_id,_at,_ip,credentials) => {assert.deepEqual(credentials,{passwordHash,sessionVersion:4});return null;},
    }));
    await assert.rejects(service.login("member@example.com","BeforeReset1","127.0.0.1"),/密码错误/);
  });

  test("normalizes PostgreSQL booleans and keeps login telemetry non-authoritative", async () => {
    const hash = bcrypt.hashSync("safePass1",4); const events: string[] = [];
    const service = new AuthAccountService(repository({
      findLoginUser: async () => ({ id:8,username:"member",email:"member@example.com",password_hash:hash,role:"user",
        session_version:2,is_disabled:false,must_change_password:true,is_verified_expert:false }),
      recordSuccessfulLogin: async () => 2, recordFunnelEvent: async (_id,event) => { events.push(event); },
    }));
    const result = await service.login("MEMBER@EXAMPLE.COM","safePass1","127.0.0.1");
    assert.equal(result.rawIdentifier,"member@example.com"); assert.equal(result.user.must_change_password,1);
    assert.equal(result.user.is_verified_expert,0); assert.deepEqual(events,["login_succeeded"]);
    await assert.rejects(() => service.login("member@example.com","wrong","127.0.0.1"),(error: unknown) =>
      Boolean(error && typeof error === "object" && "recordLoginFailure" in error && error.recordLoginFailure));
  });

  test("changes passwords with session invalidation and audits administrators", async () => {
    const oldHash = bcrypt.hashSync("oldPass1",4); let nextHash = ""; let auditAction = "";
    const service = new AuthAccountService(repository({
      getCredentials: async () => ({ username:"admin",role:"admin",password_hash:oldHash }),
      changePassword: async (_id,hash) => { nextHash=hash; return true; },
      recordAdminAudit: async (audit) => { auditAction=audit.action; },
    }));
    assert.equal((await service.changePassword(1,"oldPass1","newPass2")).success,true);
    assert.equal(await bcrypt.compare("newPass2",nextHash),true); assert.equal(auditAction,"auth.password.change");
    await assert.rejects(() => service.changePassword(1,"oldPass1","oldPass1"),/不能与当前密码相同/);
  });

  test("queues only owned media and runs cleanup after account commit", async () => {
    const hash = bcrypt.hashSync("safePass1",4); let cleanup = 0; let receivedObjects: unknown[] = [];
    const service = new AuthAccountService(repository({
      getCredentials: async () => ({ role:"user",password_hash:hash }),
      accountMediaUrls: async () => ["/media/uploads/community/9/2026-09-01/photo.png","/media/uploads/community/99/private.png"],
      deleteAccount: async (_id,_hash,_urls,objects) => { receivedObjects=objects; return { deleted:true,cleanupJobId:41 }; },
    }),async (jobId) => { cleanup=jobId; });
    assert.equal((await service.deleteAccount(9,"safePass1")).success,true); assert.equal(cleanup,41);
    assert.deepEqual(receivedObjects,[{ backend:"local",path:"/media/uploads/community/9/2026-09-01/photo.png" }]);
  });
});

test("rejects truncating new passwords before writes while retaining legacy login", async () => {
  const prefix = "Aa1" + "x".repeat(69);
  const legacyPassword = prefix + "old";
  const legacyHash = bcrypt.hashSync(legacyPassword, 4);
  // Reproduction using synthetic data only: bcrypt cannot distinguish these suffixes.
  assert.equal(bcrypt.compareSync(prefix + "new", legacyHash), true);
  let writes = 0;
  const service = new AuthAccountService(repository({
    createUser: async () => { writes++; throw new Error("must not write"); },
    changePassword: async () => { writes++; return true; },
    findLoginUser: async () => ({id:8,username:"legacy",password_hash:legacyHash,session_version:1,is_disabled:false,role:"user"}),
    getCredentials: async () => ({password_hash:legacyHash,role:"user"}),
  }));
  for (const invalid of [prefix + "new", "Aa1" + "界".repeat(24)]) {
    await assert.rejects(service.register("test@example.com", "tester", invalid), /72/);
    await assert.rejects(service.changePassword(8, legacyPassword, invalid), /72/);
    await assert.rejects(service.setPassword(8, invalid, "synthetic-reauth-token"), /72/);
    await assert.rejects(service.recoverPassword("8." + "a".repeat(43), invalid), /72/);
  }
  assert.equal(writes, 0);
  assert.ok((await service.login("test@example.com", legacyPassword, "127.0.0.1")).token);
  assert.equal(writes, 0, "login must not silently migrate legacy hashes");
});

test("invalid recovery password leaves proof usable for a valid byte-boundary reset", async () => {
  let consumed = false;
  let storedHash = bcrypt.hashSync("OldRecovery1", 4);
  const service = new AuthAccountService(repository({
    changePassword: async (_id, hash) => {
      if (consumed) return false;
      consumed = true; storedHash = hash; return true;
    },
  }));
  const recoveryToken = "8." + "a".repeat(43);
  const newPassword = "Aa1" + "界".repeat(23);
  await assert.rejects(service.recoverPassword(recoveryToken, newPassword + "x"), /72/);
  assert.equal(consumed, false);
  assert.equal((await service.recoverPassword(recoveryToken, newPassword)).success, true);
  assert.equal(bcrypt.compareSync(newPassword, storedHash), true);
  assert.equal(bcrypt.compareSync("OldRecovery1", storedHash), false);
  await assert.rejects(service.recoverPassword(recoveryToken, "AnotherPassword1"), /恢复凭据已失效/);
});

test("HTTP password schemas bound new writes but not legacy password proofs", async () => {
  const { registerSchema, changePasswordSchema, adminUserCredentialsSchema, loginSchema, deleteAccountSchema } = await import("../src/validation/schemas.js");
  const longPassword = "Aa1" + "x".repeat(70);
  assert.equal(registerSchema.safeParse({identifier:"test@example.com",username:"tester",password:longPassword}).success, false);
  assert.equal(changePasswordSchema.safeParse({currentPassword:"OldPassword1",newPassword:longPassword}).success, false);
  assert.equal(adminUserCredentialsSchema.safeParse({newPassword:longPassword}).success, false);
  assert.equal(loginSchema.safeParse({identifier:"test@example.com",password:longPassword}).success, true);
  assert.equal(changePasswordSchema.safeParse({currentPassword:longPassword,newPassword:"NewPassword1"}).success, true);
  assert.equal(deleteAccountSchema.safeParse({password:longPassword,confirmation:"DELETE"}).success, true);
});
