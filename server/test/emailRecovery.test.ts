import { SqliteAdminUsersRepository } from "../src/modules/adminUsers/sqliteRepository.js";
import { PostgresAdminUsersRepository } from "../src/modules/adminUsers/postgresRepository.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { Pool } from "pg";
import express from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../src/config/security.js";
import { SqliteAuthAccountRepository } from "../src/modules/authAccount/sqliteRepository.js";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { EmailVerificationService, type EmailPurpose } from "../src/modules/authAccount/emailVerification.js";
import { createAuthAccountRouter } from "../src/modules/authAccount/route.js";
import { configureRateLimitsService, RateLimitsService } from "../src/modules/rateLimits/index.js";
import { SqliteRateLimitsRepository } from "../src/modules/rateLimits/sqliteRepository.js";
import { PostgresRateLimitsRepository } from "../src/modules/rateLimits/postgresRepository.js";
import { configureAccessControlService, AccessControlService } from "../src/modules/accessControl/index.js";
import { verificationMailer } from "../src/services/verificationMailer.js";

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: email verification and recovery enforce identity, expiry, replay and rollback`,
  { skip: backend === "postgres" && !process.env.EMAIL_RECOVERY_TEST_PG_URL }, async () => {
  const sqlite = backend === "sqlite" ? new Database(":memory:") : null;
  const admin = backend === "postgres" ? new Pool({ connectionString: process.env.EMAIL_RECOVERY_TEST_PG_URL }) : null;
  const name = `email_recovery_test_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool | null = null;
  let server: ReturnType<express.Express["listen"]> | undefined;
  const exec = async (sql: string) => { if (sqlite) sqlite.exec(sql); else await pool!.query(sql); };
  const query = async (sql: string, args: unknown[] = []) => {
    if (sqlite) return sqlite.prepare(sql).all(...args) as Record<string, any>[];
    let index = 0; return (await pool!.query(sql.replaceAll("?", () => `$${++index}`), args)).rows;
  };
  const run = async (sql: string, args: unknown[] = []) => {
    if (sqlite) sqlite.prepare(sql).run(...args);
    else { let index = 0; await pool!.query(sql.replaceAll("?", () => `$${++index}`), args); }
  };
  try {
    if (admin) {
      await admin.query(`CREATE DATABASE ${name}`);
      const url = new URL(process.env.EMAIL_RECOVERY_TEST_PG_URL!); url.pathname = `/${name}`;
      pool = new Pool({ connectionString: url.toString() });
    }
    const timestamp = sqlite ? "TEXT" : "TIMESTAMPTZ";
    await exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT UNIQUE, phone TEXT, password_hash TEXT,
      role TEXT DEFAULT 'user', is_disabled ${sqlite ? "INTEGER DEFAULT 0" : "BOOLEAN DEFAULT FALSE"}, session_version INTEGER DEFAULT 1,
      must_change_password ${sqlite ? "INTEGER DEFAULT 0" : "BOOLEAN DEFAULT FALSE"},phone_verified_at ${timestamp});
      CREATE TABLE admin_audit_logs(admin_user_id INTEGER,action TEXT,resource_type TEXT,resource_id TEXT,summary TEXT,
        details_json ${sqlite ? "TEXT" : "JSONB"},ip_address TEXT,user_agent TEXT);
      CREATE TABLE account_reauth_grants(token_hash TEXT PRIMARY KEY,user_id INTEGER,purpose TEXT,phone TEXT,session_version INTEGER,
        consumed_at ${timestamp},expires_at ${timestamp});
      CREATE TABLE rate_limit_buckets(bucket_key TEXT PRIMARY KEY,request_count INTEGER,window_started_at BIGINT,blocked_until BIGINT,updated_at ${timestamp});`);
    if (sqlite) {
      await exec(`ALTER TABLE users ADD COLUMN email_verified_at TEXT;
        CREATE TABLE email_auth_challenges(id TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,email TEXT,
        purpose TEXT,session_version INTEGER,code_hash TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,expires_at TEXT,
        recovery_hash TEXT UNIQUE,recovery_expires_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
      sqlite.pragma("foreign_keys = ON");
    } else {
      await exec(fs.readFileSync(new URL("../drizzle/0031_complex_masque.sql",import.meta.url),"utf8"));
    }
    const hash = await bcrypt.hash("OldPass123",4);
    await run("INSERT INTO users(id,username,email,password_hash) VALUES(1,'one','one@example.invalid',?),(2,'two','two@example.invalid',?)",[hash,hash]);
    const repository = sqlite ? new SqliteAuthAccountRepository(sqlite) : new PostgresAuthAccountRepository(pool!);
    const accounts = new AuthAccountService(repository);
    const deliveries: Array<{email: string; code: string; purpose: EmailPurpose}> = [];
    let failMail = false;
    const email = new EmailVerificationService(repository, { assertConfigured() {}, async send(address,code,purpose) {
      if (failMail) throw new Error("private SMTP credentials must not leak");
      deliveries.push({email:address,code,purpose});
    } });
    const latestCode = () => deliveries.at(-1)!.code;
    const verify = async () => {
      const sent = await email.sendVerification(1,"OldPass123");
      return email.verify(sent.challengeId,latestCode(),"email_verify",1);
    };
    const grant = async () => {
      const sent = await email.sendRecovery("one@example.invalid");
      const result = await email.verify(sent.challengeId,latestCode(),"email_recovery");
      assert.ok(result.recoveryToken); return result.recoveryToken;
    };
    await assert.rejects(() => email.sendVerification(1,"wrong"),/当前密码/);
    const unverified = await email.sendRecovery("one@example.invalid");
    await assert.rejects(() => email.verify(unverified.challengeId,latestCode(),"email_recovery"),/验证码/);
    const absent = await email.sendRecovery("absent@example.invalid");
    await assert.rejects(() => email.verify(absent.challengeId,latestCode(),"email_recovery"),/验证码/);
    assert.deepEqual(Object.keys(absent),Object.keys(unverified));
    const binding = await email.sendVerification(1,"OldPass123"); const bindingCode = latestCode();
    assert.notEqual((await query("SELECT code_hash FROM email_auth_challenges WHERE id=?",[binding.challengeId]))[0].code_hash,bindingCode);
    await assert.rejects(() => email.verify(binding.challengeId,bindingCode,"email_verify",2),/验证码/);
    await assert.rejects(() => email.verify(binding.challengeId,bindingCode,"email_recovery"),/验证码/);
    assert.deepEqual(await email.verify(binding.challengeId,bindingCode,"email_verify",1),{success:true});
    await assert.rejects(() => email.verify(binding.challengeId,bindingCode,"email_verify",1),/验证码/);
    assert.ok((await repository.emailUser({id:1}))!.email_verified_at);
    const expired = await email.sendRecovery("one@example.invalid");
    await run("UPDATE email_auth_challenges SET expires_at='2000-01-01' WHERE id=?",[expired.challengeId]);
    await assert.rejects(() => email.verify(expired.challengeId,latestCode(),"email_recovery"),/验证码/);
    const exhausted = await email.sendRecovery("one@example.invalid"); const correct = latestCode();
    const wrong = correct === "000000" ? "111111" : "000000";
    for (let i=0;i<5;i++) await assert.rejects(() => email.verify(exhausted.challengeId,wrong,"email_recovery"),/验证码/);
    await assert.rejects(() => email.verify(exhausted.challengeId,correct,"email_recovery"),/验证码/);
    failMail = true;
    await assert.rejects(() => email.sendRecovery("one@example.invalid"),error => String(error).includes("邮件发送失败") && !String(error).includes("private"));
    failMail = false;
    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM email_auth_challenges WHERE status='failed'"))[0].n),1);
    const stale = await email.sendVerification(1,"OldPass123"); const staleCode = latestCode();
    await run("UPDATE users SET session_version=2 WHERE id=1");
    await assert.rejects(() => email.verify(stale.challengeId,staleCode,"email_verify",1),/验证码/);
    await run("UPDATE users SET session_version=1 WHERE id=1");
    const disabled = await grant();
    await run("UPDATE users SET is_disabled=? WHERE id=1",[sqlite ? 1 : true]);
    await assert.rejects(() => accounts.recoverPassword(disabled,"NewPass123","email"),/恢复凭据/);
    await run("UPDATE users SET is_disabled=? WHERE id=1",[sqlite ? 0 : false]);
    const changedEmail = await grant();
    const adminUsers = sqlite ? new SqliteAdminUsersRepository(sqlite) : new PostgresAdminUsersRepository(pool!);
    await adminUsers.updateCredentials(1,{email:"new@example.invalid",phone:null,identifierUpdated:true,passwordHash:null,passwordReset:false},{adminUserId:2});
    assert.equal((await repository.emailUser({id:1}))!.email_verified_at,null);
    await adminUsers.updateCredentials(1,{email:"one@example.invalid",phone:null,identifierUpdated:true,passwordHash:null,passwordReset:false},{adminUserId:2});
    await assert.rejects(() => accounts.recoverPassword(changedEmail,"NewPass123","email"),/恢复凭据/);
    await run("UPDATE users SET session_version=1 WHERE id=1");
    await verify();
    await run("UPDATE users SET email='changed@example.invalid' WHERE id=1");
    await assert.rejects(() => accounts.recoverPassword(changedEmail,"NewPass123","email"),/恢复凭据/);
    await run("UPDATE users SET email='one@example.invalid' WHERE id=1");
    const expiredGrant = await grant();
    await exec("UPDATE email_auth_challenges SET recovery_expires_at='2000-01-01' WHERE status='verified'");
    await assert.rejects(() => accounts.recoverPassword(expiredGrant,"NewPass123","email"),/恢复凭据/);
    const once = await email.sendRecovery("one@example.invalid"); const onceCode=latestCode();
    const verifiedOnce = await Promise.allSettled([email.verify(once.challengeId,onceCode,"email_recovery"),email.verify(once.challengeId,onceCode,"email_recovery")]);
    assert.equal(verifiedOnce.filter(result => result.status === "fulfilled").length,1);
    const token = await grant();
    await assert.rejects(() => accounts.recoverPassword(token,"NewPass123"),/恢复凭据/);
    await assert.rejects(() => accounts.recoverPassword(token.replace(/^1\./,"2."),"NewPass123","email"),/恢复凭据/);
    // Failure of password update must roll back consumption of the one-use recovery proof.
    if (sqlite) await exec("CREATE TRIGGER reject_password BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    else await exec("CREATE FUNCTION reject_password() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_password BEFORE UPDATE OF password_hash ON users FOR EACH ROW EXECUTE FUNCTION reject_password();");
    await assert.rejects(() => accounts.recoverPassword(token,"NewPass123","email"),/synthetic failure/);
    await exec(sqlite ? "DROP TRIGGER reject_password" : "DROP TRIGGER reject_password ON users; DROP FUNCTION reject_password()");
    const parallel = await Promise.allSettled([accounts.recoverPassword(token,"NewPass123","email"),accounts.recoverPassword(token,"OtherPass123","email")]);
    assert.equal(parallel.filter(result => result.status === "fulfilled").length,1);
    assert.equal((await repository.emailUser({id:1}))!.session_version,2);
    await assert.rejects(() => accounts.recoverPassword(disabled,"NewPass123","email"),/恢复凭据/);
    const updated = (await query("SELECT password_hash FROM users WHERE id=1"))[0].password_hash;
    assert.equal(await bcrypt.compare("OldPass123",updated),false);
    assert.ok(await bcrypt.compare("NewPass123",updated) || await bcrypt.compare("OtherPass123",updated));
    await run("UPDATE users SET password_hash=?,session_version=1 WHERE id=1",[hash]);
    await verify();

    configureRateLimitsService(new RateLimitsService(sqlite ? new SqliteRateLimitsRepository(sqlite) : new PostgresRateLimitsRepository(pool!)));
    configureAccessControlService(new AccessControlService({ async user(id) {
      const u = await repository.emailUser({id}); return u ? {sessionVersion:u.session_version,isDisabled:!!u.is_disabled,role:"user",mustChangePassword:false} : null;
    }, async ensureUserInitialState() {}, async recordFunnelEvent() {} }));
    const app = express(); app.use(express.json()); app.use("/api/v1/auth",createAuthAccountRouter(accounts,email));
    server = app.listen(0,"127.0.0.1"); await new Promise<void>(resolve => server!.once("listening",resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/auth`;
    const auth = jwt.sign({userId:1,sessionVersion:1},JWT_SECRET);
    const post = (path:string,body:unknown,token?:string) => fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)});
    assert.equal((await post("/email-verification/send",{currentPassword:"OldPass123"})).status,401);
    assert.equal((await post("/email-recovery/send",{email:"one@example.invalid\r\nBcc:bad@example.invalid"})).status,400);
    const response = await post("/email-recovery/send",{email:" ONE@EXAMPLE.INVALID "});
    assert.equal(response.status,200); const sent = await response.json() as {challengeId:string}; const httpCode = latestCode();
    assert.equal((await post("/email-recovery/send",{email:"one@example.invalid"})).status,429);
    const result = await post("/email-recovery/verify",{challengeId:sent.challengeId,code:httpCode});
    assert.equal(result.status,200); const proof = await result.json() as {recoveryToken:string};
    const reset = await post("/password-recovery/reset",{recoveryToken:proof.recoveryToken,newPassword:"HttpNew123",channel:"email"});
    assert.equal(reset.status,200);
    assert.equal((await post("/email-verification/send",{currentPassword:"HttpNew123"},auth)).status,401);
    await exec("DELETE FROM users WHERE id=1");
    assert.equal(Number((await query("SELECT COUNT(*) AS n FROM email_auth_challenges WHERE user_id=1"))[0].n),0);
  } finally {
    if (server) await new Promise<void>((resolve,reject) => server!.close(error => error ? reject(error) : resolve()));
    sqlite?.close(); await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); }
  }
});

test("SMTP is unavailable rather than falsely successful without configuration", () => {
  const host = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
  try { assert.throws(() => verificationMailer.assertConfigured(),/尚未配置/); }
  finally { if (host !== undefined) process.env.SMTP_HOST=host; }
});
