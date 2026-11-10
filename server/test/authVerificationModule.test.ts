import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { SqliteAuthVerificationRepository } from "../src/modules/authVerification/sqliteRepository.js";
import { passwordlessMigration } from "../src/storage/passwordlessMigration.js";
import { consumeAccountProofSqlite } from "../src/modules/authAccount/reauthProof.js";
import { SqliteAuthAccountRepository } from "../src/modules/authAccount/sqliteRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { hashPasswordRecoveryToken } from "../src/services/authVerificationCrypto.js";
import bcrypt from "bcryptjs";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,email TEXT,phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,avatar_url TEXT,bio TEXT,role TEXT NOT NULL DEFAULT 'user',daily_calories_target INTEGER DEFAULT 2000,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,phone_verified_at TEXT,last_login_at TEXT,last_login_ip TEXT,is_disabled INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 1,must_change_password INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE user_health_profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE auth_verification_subjects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,channel TEXT NOT NULL,provider TEXT NOT NULL,
      subject_hmac TEXT NOT NULL,subject_ciphertext TEXT NOT NULL,subject_iv TEXT NOT NULL,subject_auth_tag TEXT NOT NULL,
      last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel,provider,subject_hmac));
    CREATE TABLE auth_verification_challenges(id TEXT PRIMARY KEY,subject_id INTEGER NOT NULL,purpose TEXT NOT NULL,out_id TEXT NOT NULL UNIQUE,
      biz_id TEXT,provider_request_id TEXT,status TEXT NOT NULL DEFAULT 'pending',attempt_count INTEGER NOT NULL DEFAULT 0,
      registration_token_hash TEXT UNIQUE,registration_expires_at TEXT,expires_at TEXT NOT NULL,verified_at TEXT,consumed_at TEXT,
      source_ip TEXT,user_agent TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE auth_verification_events(id INTEGER PRIMARY KEY AUTOINCREMENT,subject_id INTEGER NOT NULL,challenge_id TEXT,channel TEXT NOT NULL,
      provider TEXT NOT NULL,event_type TEXT NOT NULL,outcome TEXT NOT NULL,provider_code TEXT,provider_message TEXT,provider_request_id TEXT,
      biz_id TEXT,out_id TEXT,source_ip TEXT,user_agent TEXT,details_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE auth_verification_usage_daily(usage_date TEXT NOT NULL,channel TEXT NOT NULL,provider TEXT NOT NULL,
      send_requests INTEGER NOT NULL DEFAULT 0,send_api_calls INTEGER NOT NULL DEFAULT 0,accepted INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0,delivery_failed INTEGER NOT NULL DEFAULT 0,verify_api_calls INTEGER NOT NULL DEFAULT 0,
      verify_passed INTEGER NOT NULL DEFAULT 0,verify_failed INTEGER NOT NULL DEFAULT 0,local_rate_limited INTEGER NOT NULL DEFAULT 0,
      provider_errors INTEGER NOT NULL DEFAULT 0,delivery_units INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(usage_date,channel,provider));
  `);
  db.pragma("foreign_keys=OFF");passwordlessMigration.up(db);db.pragma("foreign_keys=ON");
  return db;
}

describe("auth verification module", () => {
  test("recovery grants reject expiry, disabled accounts, phone/session changes and cross-purpose use atomically",async () => {
    const db=database();const verification=new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const account=new AuthAccountService(new SqliteAuthAccountRepository(db));
    const phone="13800138991";
    db.prepare("INSERT INTO users(username,phone,password_hash,phone_verified_at) VALUES('recover',?,NULL,CURRENT_TIMESTAMP)").run(phone);
    const subject=await verification.findOrCreateSubject(phone);
    let sequence=0;
    const grant=async () => {
      const id=`recovery-${++sequence}`;const token=`1.${randomBytes(32).toString("base64url")}`;const tokenHash=hashPasswordRecoveryToken(token);
      const user=(await verification.reauthUser(1))!;const expiresAt=new Date(Date.now()+60_000).toISOString();
      await verification.createChallenge({id,subjectId:subject.id,purpose:"password_recovery",outId:id,expiresAt,sourceIp:null,userAgent:null,reauthUserId:1,reauthSessionVersion:user.session_version});
      assert.equal(await verification.beginVerification(id),true);
      assert.equal(await verification.issueReauthGrant({challengeId:id,challengePurpose:"password_recovery",userId:1,purpose:"password_update",phone,sessionVersion:user.session_version,tokenHash,expiresAt}),true);
      return {token,tokenHash};
    };
    const expired=await grant();db.prepare("UPDATE account_reauth_grants SET expires_at=datetime('now','-1 minute') WHERE token_hash=?").run(expired.tokenHash);
    await assert.rejects(account.recoverPassword(expired.token,"NewPassword1"),/已失效/);
    const disabled=await grant();db.prepare("UPDATE users SET is_disabled=1 WHERE id=1").run();
    await assert.rejects(account.recoverPassword(disabled.token,"NewPassword1"),/已失效/);
    db.prepare("UPDATE users SET is_disabled=0,session_version=session_version+1 WHERE id=1").run();
    await assert.rejects(account.recoverPassword(disabled.token,"NewPassword1"),/已失效/);
    const changedPhone=await grant();db.prepare("UPDATE users SET phone=NULL WHERE id=1").run();
    await assert.rejects(account.recoverPassword(changedPhone.token,"NewPassword1"),/已失效/);
    db.prepare("UPDATE users SET phone=? WHERE id=1").run(phone);
    const valid=await grant();
    const beforeReset=await new SqliteAuthAccountRepository(db).getCredentials(1);
    await assert.rejects(account.recoverPassword(`2.${valid.token.split(".")[1]}`,"NewPassword1"),/已失效/);
    for (const prefix of ["0", "-1", "1e0", "01", "9007199254740992"]) {
      await assert.rejects(account.recoverPassword(`${prefix}.${valid.token.split(".")[1]}`,"NewPassword1"),/已失效/);
    }
    await assert.rejects(account.setPassword(1,"NewPassword1",valid.token),/重新验证/);
    await assert.rejects(account.setPassword(1,"NewPassword1",`password-recovery:${valid.token}`),/重新验证/);
    assert.throws(() => consumeAccountProofSqlite(db,2,"password_update",{tokenHash:valid.tokenHash}),/重新验证/);
    assert.throws(() => consumeAccountProofSqlite(db,1,"account_delete",{tokenHash:valid.tokenHash}),/重新验证/);
    const results=await Promise.allSettled([account.recoverPassword(valid.token,"NewPassword1"),account.recoverPassword(valid.token,"NewPassword1")]);
    assert.equal(results.filter(value => value.status==="fulfilled").length,1);
    assert.equal((await verification.reauthUser(1))?.session_version,3);
    assert.equal(await new SqliteAuthAccountRepository(db).recordSuccessfulLogin(1,new Date().toISOString(),"127.0.0.1",{passwordHash:beforeReset!.password_hash ?? "",sessionVersion:2}),null);
    assert.equal(bcrypt.compareSync("NewPassword1",(await new SqliteAuthAccountRepository(db).getCredentials(1))!.password_hash!),true);
    db.close();
  });

  test("nullable-password migration preserves existing hashes, foreign keys, indexes, triggers and ID sequence",() => {
    const db=new Database(":memory:");
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
      CREATE UNIQUE INDEX users_casefold ON users(lower(username));
      CREATE TABLE linked(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE audit(value TEXT);
      CREATE TRIGGER user_audit AFTER INSERT ON users BEGIN INSERT INTO audit(value) VALUES(NEW.username); END;
      CREATE TABLE auth_verification_challenges(id TEXT PRIMARY KEY);
      INSERT INTO users(id,username,password_hash) VALUES(200,'deleted','old-hash');DELETE FROM users WHERE id=200;
      INSERT INTO users(id,username,password_hash) VALUES(7,'Existing','kept-hash');INSERT INTO linked VALUES(7);`);
    db.pragma("foreign_keys=OFF");db.transaction(() => passwordlessMigration.up(db))();db.pragma("foreign_keys=ON");
    assert.equal((db.prepare("SELECT password_hash FROM users WHERE id=7").get() as {password_hash:string}).password_hash,"kept-hash");
    assert.equal((db.prepare("SELECT COUNT(*) n FROM linked").get() as {n:number}).n,1);
    assert.deepEqual(db.pragma("foreign_key_check"),[]);
    const inserted=db.prepare("INSERT INTO users(username,password_hash) VALUES('New',NULL)").run();
    assert.equal(Number(inserted.lastInsertRowid),201);
    assert.throws(() => db.prepare("INSERT INTO users(username,password_hash) VALUES('EXISTING',NULL)").run(),/UNIQUE/);
    assert.equal((db.prepare("SELECT value FROM audit ORDER BY rowid DESC LIMIT 1").get() as {value:string}).value,"New");
    db.close();
  });
  test("creates a passwordless account and consumes scoped identity proof with the credential mutation",async () => {
    const db=database();const service=new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const subject=await service.findOrCreateSubject("13800138001");const expiresAt=new Date(Date.now()+60_000).toISOString();
    await service.createChallenge({id:"register-new",subjectId:subject.id,purpose:"login",outId:"register-new",expiresAt,sourceIp:null,userAgent:null});
    await service.markRegistrationRequired({challengeId:"register-new",at:new Date().toISOString(),tokenHash:"register-proof",expiresAt});
    const registration=await service.register({tokenHash:"register-proof",phone:"13800138001",username:"随机昵称",passwordHash:null,at:new Date().toISOString()});
    assert.equal(registration.status,"created");if(registration.status!=="created") return;
    const userId=registration.userId;
    assert.equal((await service.userResponse(userId))?.hasPassword,false);
    assert.equal((await service.userResponse(userId))?.daily_calories_target,null);
    await service.createChallenge({id:"password-proof",subjectId:subject.id,purpose:"password_update",outId:"password-proof",expiresAt,sourceIp:null,userAgent:null,reauthUserId:userId,reauthSessionVersion:1});
    await service.beginVerification("password-proof");
    assert.equal(await service.issueReauthGrant({challengeId:"password-proof",userId,purpose:"password_update",phone:"13800138001",sessionVersion:1,tokenHash:"grant",expiresAt}),true);
    assert.throws(() => consumeAccountProofSqlite(db,userId,"account_delete",{tokenHash:"grant"}),/重新验证/);
    assert.throws(() => consumeAccountProofSqlite(db,userId+1,"password_update",{tokenHash:"grant"}),/重新验证/);
    assert.throws(() => db.transaction(() => {consumeAccountProofSqlite(db,userId,"password_update",{tokenHash:"grant"});throw new Error("rollback");})(),/rollback/);
    const account=new SqliteAuthAccountRepository(db);
    assert.equal(await account.changePassword(userId,bcrypt.hashSync("FirstPass1",4),{tokenHash:"grant"}),true);
    assert.equal((await service.reauthUser(userId))?.session_version,2);
    assert.equal((await service.userResponse(userId))?.hasPassword,true);
    await assert.rejects(() => account.changePassword(userId,"other",{tokenHash:"grant"}),/重新验证/);
    assert.equal(await service.issueReauthGrant({challengeId:"password-proof",userId,purpose:"password_update",phone:"13800138001",sessionVersion:1,tokenHash:"second",expiresAt}),false);
    db.close();
  });

  test("separates login and account operation codes and rejects stale phone/session grants",async () => {
    const db=database();const service=new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    db.prepare("INSERT INTO users(username,phone,password_hash,phone_verified_at) VALUES('no-password','13800138002',NULL,CURRENT_TIMESTAMP)").run();
    const userId=1;const subject=await service.findOrCreateSubject("13800138002");const expiresAt=new Date(Date.now()+60_000).toISOString();
    for(const purpose of ["login","account_delete"] as const) {
      await service.createChallenge({id:purpose,subjectId:subject.id,purpose,outId:purpose,expiresAt,sourceIp:null,userAgent:null,reauthUserId:purpose==="login"?undefined:userId,reauthSessionVersion:purpose==="login"?undefined:1});
      await service.acceptChallenge(purpose,subject.id,null,null);
    }
    assert.equal((await service.challenge("login"))?.status,"accepted");
    await service.beginVerification("account_delete");
    assert.equal(await service.issueReauthGrant({challengeId:"account_delete",userId,purpose:"account_delete",phone:"13800138002",sessionVersion:1,tokenHash:"delete",expiresAt}),true);
    db.prepare("UPDATE users SET phone='13800138003' WHERE id=?").run(userId);
    assert.throws(() => consumeAccountProofSqlite(db,userId,"account_delete",{tokenHash:"delete"}),/重新验证/);
    db.prepare("UPDATE users SET phone='13800138002',session_version=2 WHERE id=?").run(userId);
    assert.throws(() => consumeAccountProofSqlite(db,userId,"account_delete",{tokenHash:"delete"}),/重新验证/);
    db.prepare("UPDATE users SET session_version=1 WHERE id=?").run(userId);
    db.transaction(() => consumeAccountProofSqlite(db,userId,"account_delete",{tokenHash:"delete"}))();
    assert.throws(() => consumeAccountProofSqlite(db,userId,"account_delete",{tokenHash:"delete"}),/重新验证/);
    db.close();
  });
  test("stores settings and encrypts a stable, reusable subject", async () => {
    const db = database();
    const repository = new SqliteAuthVerificationRepository(db);
    const service = new AuthVerificationService(repository);
    await service.saveSettings([{ key: "auth.sms.enabled", value: "1" }, { key: "auth.sms.limit.phone_hour", value: "7" }]);
    const config = await service.config();
    assert.equal(config.enabled, true);
    assert.equal(config.phoneHourlyLimit, 7);
    const first = await service.findOrCreateSubject("13800138000");
    const second = await service.findOrCreateSubject("13800138000");
    assert.equal(second.id, first.id);
    assert.equal(service.decryptPhone(first), "13800138000");
    assert.equal(service.maskedPhone(first), "138****8000");
    db.close();
  });

  test("applies send counters and compare-and-set verification attempts", async () => {
    const db = database();
    const repository = new SqliteAuthVerificationRepository(db);
    const service = new AuthVerificationService(repository);
    const subject = await service.findOrCreateSubject("13900139000");
    await service.createChallenge({ id: "challenge-1", subjectId: subject.id, purpose: "login", outId: "out-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: "203.0.113.9", userAgent: "test" });
    await service.recordEvent({ subjectId: subject.id, challengeId: "challenge-1", eventType: "send_api_called",
      outcome: "pending", sourceIp: "203.0.113.9" });
    assert.equal(await service.countSubjectSends(subject.id, new Date(Date.now() - 60_000).toISOString()), 1);
    assert.equal(await service.countIpSends("203.0.113.9", new Date(Date.now() - 60_000).toISOString()), 1);
    assert.equal(await service.beginVerification("challenge-1"), true);
    assert.equal(await service.beginVerification("challenge-1"), false);
    await service.restoreVerification("challenge-1");
    assert.equal((await service.challenge("challenge-1"))?.status, "accepted");
    db.close();
  });

  test("atomically consumes a registration token and initializes the account", async () => {
    const db = database();
    const service = new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const subject = await service.findOrCreateSubject("13700137000");
    await service.createChallenge({ id: "register-1", subjectId: subject.id, purpose: "login", outId: "register-out",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: null, userAgent: null });
    await service.markRegistrationRequired({ challengeId: "register-1", at: new Date().toISOString(), tokenHash: "token-hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const result = await service.register({ tokenHash: "token-hash", phone: "13700137000", username: "短信用户",
      passwordHash: "stored-hash", at: new Date().toISOString() });
    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    assert.equal((await service.userResponse(result.userId))?.phone, "13700137000");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_health_profiles WHERE user_id=?")
      .get(result.userId) as { count: number }).count, 1);
    assert.equal((await service.register({ tokenHash: "token-hash", phone: "13700137000", username: "另一个用户",
      passwordHash: "hash", at: new Date().toISOString() })).status, "invalid_token");
    db.close();
  });

  test("deduplicates delivery callbacks while updating usage and admin queries", async () => {
    const db = database();
    const service = new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const subject = await service.findOrCreateSubject("13600136000");
    await service.createChallenge({ id: "delivery-1", subjectId: subject.id, purpose: "login", outId: "delivery-out",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: "198.51.100.4", userAgent: null });
    await service.updateTestChallenge("delivery-1", "accepted", "biz-1", "request-1");
    const report = { bizId: "biz-1", outId: "delivery-out", providerCode: "OK", providerMessage: "sent to 13600136000",
      success: true, units: 2, usageDate: "2026-09-01", details: { smsSize: 2 } };
    assert.equal(await service.recordDeliveryReport(report), true);
    assert.equal(await service.recordDeliveryReport(report), false);
    const overview = await service.usageOverview("2026-09-01");
    assert.equal(overview.totals.delivered, 1);
    assert.equal(overview.totals.deliveryUnits, 2);
    const page = await service.events({ providerId: "biz-1" }, 1, 20);
    assert.equal(page.total, 1);
    assert.equal(page.rows[0]?.providerMessage, "sent to [phone]");
    db.close();
  });
});
