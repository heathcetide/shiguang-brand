import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { SqliteAuthVerificationRepository } from "../src/modules/authVerification/sqliteRepository.js";
import { PostgresAuthVerificationRepository } from "../src/modules/authVerification/postgresRepository.js";
import { SqliteAdminUsersRepository } from "../src/modules/adminUsers/sqliteRepository.js";
import { PostgresAdminUsersRepository } from "../src/modules/adminUsers/postgresRepository.js";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";

// PostgreSQL is opt-in and always creates/drops its own database; never migrates a supplied database.
for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: first phone binding is scoped, single-use and atomic`,
  { skip: backend === "postgres" && !process.env.PHONE_BINDING_TEST_PG_URL }, async () => {
  const sqlite = backend === "sqlite" ? new Database(":memory:") : null;
  const admin = backend === "postgres" ? new Pool({ connectionString: process.env.PHONE_BINDING_TEST_PG_URL }) : null;
  const name = `phone_binding_test_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool | null = null;
  if (admin) {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.PHONE_BINDING_TEST_PG_URL!); url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString() });
  }
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
    const timestamp = sqlite ? "TEXT" : "TIMESTAMPTZ";
    await exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT, phone TEXT UNIQUE, password_hash TEXT,
      role TEXT DEFAULT 'user', is_disabled ${sqlite ? "INTEGER DEFAULT 0" : "BOOLEAN DEFAULT FALSE"}, session_version INTEGER DEFAULT 1, phone_verified_at ${timestamp});
      CREATE TABLE auth_verification_subjects(id ${sqlite ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "SERIAL PRIMARY KEY"}, user_id INTEGER,
      channel TEXT, provider TEXT, subject_hmac TEXT, subject_ciphertext TEXT, subject_iv TEXT, subject_auth_tag TEXT,
      last_seen_at ${timestamp}, updated_at ${timestamp}, UNIQUE(channel,provider,subject_hmac));
      CREATE TABLE auth_verification_challenges(id TEXT PRIMARY KEY, subject_id INTEGER, purpose TEXT, out_id TEXT, status TEXT,
      expires_at ${timestamp}, source_ip TEXT,user_agent TEXT,reauth_user_id INTEGER,reauth_session_version INTEGER,
      attempt_count INTEGER DEFAULT 0, consumed_at ${timestamp}, verified_at ${timestamp},updated_at ${timestamp},biz_id TEXT,provider_request_id TEXT);
      CREATE TABLE auth_verification_events(id ${sqlite ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "SERIAL PRIMARY KEY"},subject_id INTEGER,challenge_id TEXT,channel TEXT,
      provider TEXT,event_type TEXT,outcome TEXT,provider_code TEXT,provider_message TEXT,provider_request_id TEXT,biz_id TEXT,out_id TEXT,source_ip TEXT,user_agent TEXT,details_json TEXT);
      CREATE TABLE admin_audit_logs(admin_user_id INTEGER,action TEXT,resource_type TEXT,resource_id TEXT,summary TEXT,details_json ${sqlite ? "TEXT" : "JSONB"},ip_address TEXT,user_agent TEXT);
      CREATE TABLE retained_data(user_id INTEGER, inventory TEXT, diet TEXT, preferences TEXT);
      INSERT INTO users(id,email,password_hash) VALUES(1,'one@example.invalid','synthetic-hash'),(2,'two@example.invalid','synthetic-hash');
      INSERT INTO retained_data VALUES(1,'stock','meals','preferences');`);
    const service = new AuthVerificationService(sqlite ? new SqliteAuthVerificationRepository(sqlite) : new PostgresAuthVerificationRepository(pool!));
    const phone = "13800223001";
    const subject = await service.findOrCreateSubject(phone);
    const challenge = async (userId = 1, purpose: "phone_bind" | "login" = "phone_bind") => {
      const id = randomUUID();
      await service.createChallenge({ id, subjectId: subject.id, purpose, outId: id, expiresAt: new Date(Date.now()+60_000).toISOString(),
        sourceIp: null, userAgent: null, reauthUserId: userId, reauthSessionVersion: 1 });
      await service.acceptChallenge(id,subject.id,null,null);
      assert.equal(await service.beginVerification(id),true);
      return { userId, sessionVersion: 1, challengeId: id, phone };
    };
    const intact = async () => {
      assert.equal((await query("SELECT phone FROM users WHERE id=1"))[0].phone,null);
      assert.equal((await query("SELECT user_id FROM auth_verification_subjects WHERE id=?",[subject.id]))[0].user_id,null);
    };
    const wrongPurpose = await challenge(1,"login");
    assert.equal(await service.bindPhone(wrongPurpose),"invalid");
    const proof = await challenge();
    assert.equal(await service.bindPhone({...proof,userId:2}),"invalid");
    assert.equal(await service.bindPhone({...proof,phone:"13800223002"}),"invalid");
    assert.equal(await service.bindPhone({...proof,sessionVersion:2}),"invalid");
    await run("UPDATE users SET session_version=2 WHERE id=1");
    assert.equal(await service.bindPhone(proof),"invalid");
    await run("UPDATE users SET session_version=1,is_disabled=? WHERE id=1",[sqlite ? 1 : true]);
    assert.equal(await service.bindPhone(proof),"invalid");
    await run("UPDATE users SET is_disabled=?,role='admin' WHERE id=1",[sqlite ? 0 : false]);
    assert.equal(await service.bindPhone(proof),"invalid");
    await run("UPDATE users SET role='user',password_hash=NULL WHERE id=1");
    assert.equal(await service.bindPhone(proof),"invalid");
    await run("UPDATE users SET password_hash='synthetic-hash',email=NULL WHERE id=1");
    assert.equal(await service.bindPhone(proof),"invalid");
    await run("UPDATE users SET email='one@example.invalid' WHERE id=1");
    await run("UPDATE auth_verification_challenges SET expires_at=? WHERE id=?",[new Date(Date.now()-1000).toISOString(),proof.challengeId]);
    assert.equal(await service.bindPhone(proof),"invalid");
    await intact();
    const disabled = await challenge();
    const adminRepo = sqlite ? new SqliteAdminUsersRepository(sqlite) : new PostgresAdminUsersRepository(pool!);
    await adminRepo.updateStatus(1,true,{adminUserId:2});
    await adminRepo.updateStatus(1,false,{adminUserId:2});
    assert.equal(await service.bindPhone(disabled),"invalid");
    assert.equal((await service.phoneBindingUser(1))?.session_version,2);
    await run("UPDATE users SET session_version=1 WHERE id=1");
    if (pool) {
      const expiresWhileWaiting = await challenge();
      const locker = await pool.connect();
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM auth_verification_subjects WHERE id=$1 FOR UPDATE",[subject.id]);
      await run("UPDATE auth_verification_challenges SET expires_at=? WHERE id=?",[new Date(Date.now()+100).toISOString(),expiresWhileWaiting.challengeId]);
      const binding = service.bindPhone(expiresWhileWaiting);
      await new Promise(resolve => setTimeout(resolve,200));
      await locker.query("COMMIT"); locker.release();
      assert.equal(await binding,"invalid");
      await intact();
    }
    const rollback = await challenge();
    if (sqlite) await exec("CREATE TRIGGER reject_binding BEFORE UPDATE OF user_id ON auth_verification_subjects BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    else await exec("CREATE FUNCTION reject_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER reject_binding BEFORE UPDATE OF user_id ON auth_verification_subjects FOR EACH ROW EXECUTE FUNCTION reject_binding();");
    await assert.rejects(service.bindPhone(rollback),/injected failure/);
    await intact();
    assert.equal((await service.challenge(rollback.challengeId))?.status,"verifying");
    await exec(sqlite ? "DROP TRIGGER reject_binding" : "DROP TRIGGER reject_binding ON auth_verification_subjects");
    // Failure after user, subject and challenge writes must roll all of them back, too.
    if (sqlite) await exec("CREATE TRIGGER reject_audit BEFORE INSERT ON auth_verification_events BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    else await exec("CREATE TRIGGER reject_audit BEFORE INSERT ON auth_verification_events FOR EACH ROW EXECUTE FUNCTION reject_binding();");
    await assert.rejects(service.bindPhone(rollback),/injected failure/);
    await intact();
    assert.equal((await service.challenge(rollback.challengeId))?.status,"verifying");
    await exec(sqlite ? "DROP TRIGGER reject_audit" : "DROP TRIGGER reject_audit ON auth_verification_events");
    // Two accounts racing for the same target; all related writes commit together.
    const other = await challenge(2);
    const results = await Promise.all([service.bindPhone(rollback),service.bindPhone(other)]);
    assert.equal(results.filter(value => value === "bound").length,1);
    const winner = results[0] === "bound" ? rollback : other;
    assert.equal(await service.bindPhone(winner),"invalid");
    assert.equal((await service.userByPhone(phone))?.id,winner.userId);
    assert.equal(Number((await query("SELECT user_id FROM auth_verification_subjects WHERE id=?",[subject.id]))[0].user_id),winner.userId);
    assert.equal((await query("SELECT COUNT(*) AS n FROM users"))[0].n,sqlite ? 2 : "2");
    assert.deepEqual(await query("SELECT * FROM retained_data"),[{user_id:1,inventory:"stock",diet:"meals",preferences:"preferences"}]);
  } finally {
    sqlite?.close(); await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE ${name}`); await admin.end(); }
  }
});

for (const backend of ["sqlite", "postgres"] as const) test(`${backend}: phone replacement severs old phone, binds new phone, and is atomic`,
  { skip: backend === "postgres" && !process.env.PHONE_BINDING_TEST_PG_URL }, async () => {
  const sqlite = backend === "sqlite" ? new Database(":memory:") : null;
  const admin = backend === "postgres" ? new Pool({ connectionString: process.env.PHONE_BINDING_TEST_PG_URL }) : null;
  const name = `phone_replace_test_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool | null = null;
  if (admin) {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.PHONE_BINDING_TEST_PG_URL!); url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString() });
  }
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
    const timestamp = sqlite ? "TEXT" : "TIMESTAMPTZ";
    await exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, email TEXT, phone TEXT UNIQUE, password_hash TEXT,
      role TEXT DEFAULT 'user', is_disabled ${sqlite ? "INTEGER DEFAULT 0" : "BOOLEAN DEFAULT FALSE"}, session_version INTEGER DEFAULT 1, phone_verified_at ${timestamp});
      CREATE TABLE auth_verification_subjects(id ${sqlite ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "SERIAL PRIMARY KEY"}, user_id INTEGER,
      channel TEXT, provider TEXT, subject_hmac TEXT, subject_ciphertext TEXT, subject_iv TEXT, subject_auth_tag TEXT,
      last_seen_at ${timestamp}, updated_at ${timestamp}, UNIQUE(channel,provider,subject_hmac));
      CREATE TABLE auth_verification_challenges(id TEXT PRIMARY KEY, subject_id INTEGER, purpose TEXT, out_id TEXT, status TEXT,
      expires_at ${timestamp}, source_ip TEXT,user_agent TEXT,reauth_user_id INTEGER,reauth_session_version INTEGER,
      attempt_count INTEGER DEFAULT 0, consumed_at ${timestamp}, verified_at ${timestamp},updated_at ${timestamp},biz_id TEXT,provider_request_id TEXT);
      CREATE TABLE auth_verification_events(id ${sqlite ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "SERIAL PRIMARY KEY"},subject_id INTEGER,challenge_id TEXT,channel TEXT,
      provider TEXT,event_type TEXT,outcome TEXT,provider_code TEXT,provider_message TEXT,provider_request_id TEXT,biz_id TEXT,out_id TEXT,source_ip TEXT,user_agent TEXT,details_json TEXT);
      CREATE TABLE account_reauth_grants(token_hash TEXT PRIMARY KEY, user_id INTEGER, purpose TEXT, phone TEXT, session_version INTEGER, expires_at ${timestamp}, consumed_at ${timestamp});
      CREATE TABLE retained_data(user_id INTEGER, inventory TEXT, diet TEXT, preferences TEXT);
      INSERT INTO users(id,email,phone,password_hash,phone_verified_at) VALUES(1,'one@example.invalid','13800223001','synthetic-hash',CURRENT_TIMESTAMP),(2,'two@example.invalid','13800223002','synthetic-hash',CURRENT_TIMESTAMP);
      INSERT INTO retained_data VALUES(1,'stock','meals','preferences');`);
    const service = new AuthVerificationService(sqlite ? new SqliteAuthVerificationRepository(sqlite) : new PostgresAuthVerificationRepository(pool!));
    const oldSubject1 = await service.findOrCreateSubject("13800223001");
    await run("UPDATE auth_verification_subjects SET user_id=1 WHERE id=?", [oldSubject1.id]);
    const oldSubject2 = await service.findOrCreateSubject("13800223002");
    await run("UPDATE auth_verification_subjects SET user_id=2 WHERE id=?", [oldSubject2.id]);
    await run("INSERT INTO account_reauth_grants(token_hash,user_id,purpose,phone,session_version,expires_at) VALUES('grant-1',1,'password_update','13800223001',1,?)",[new Date(Date.now()+60000).toISOString()]);

    const newPhone = "13800223009";
    const newSubject = await service.findOrCreateSubject(newPhone);
    const challenge = async (userId = 1, phone = newPhone, purpose: "phone_replace" | "phone_bind" = "phone_replace") => {
      const id = randomUUID();
      const subject = await service.findOrCreateSubject(phone);
      await service.createChallenge({ id, subjectId: subject.id, purpose, outId: id, expiresAt: new Date(Date.now()+60_000).toISOString(),
        sourceIp: null, userAgent: null, reauthUserId: userId, reauthSessionVersion: 1 });
      await service.acceptChallenge(id,subject.id,null,null);
      assert.equal(await service.beginVerification(id),true);
      return { userId, sessionVersion: 1, challengeId: id, phone };
    };

    const wrongPurpose = await challenge(1, newPhone, "phone_bind");
    assert.equal(await service.replacePhone(wrongPurpose), "invalid");

    const proof = await challenge();
    assert.equal(await service.replacePhone({...proof, userId: 2}), "invalid");
    assert.equal(await service.replacePhone({...proof, sessionVersion: 2}), "invalid");
    assert.equal(await service.replacePhone({...proof, phone: "13800223001"}), "invalid"); // same phone

    // Trying to replace with an already taken phone (13800223002)
    const takenProof = await challenge(1, "13800223002");
    assert.equal(await service.replacePhone(takenProof), "phone_exists");

    // Successful replacement
    assert.equal(await service.replacePhone(proof), "replaced");
    assert.equal(await service.replacePhone(proof), "invalid"); // already consumed

    // Verify user 1 phone updated
    assert.equal((await query("SELECT phone FROM users WHERE id=1"))[0].phone, newPhone);
    // Old subject for user 1 must have user_id severed
    assert.equal((await query("SELECT user_id FROM auth_verification_subjects WHERE id=?", [oldSubject1.id]))[0].user_id, null);
    // New subject has user_id = 1
    assert.equal((await query("SELECT user_id FROM auth_verification_subjects WHERE id=?", [newSubject.id]))[0].user_id, 1);
    // Old reauth grants cleared
    assert.notEqual((await query("SELECT consumed_at FROM account_reauth_grants WHERE user_id=1"))[0].consumed_at, null);
    // Retained business data intact
    assert.deepEqual(await query("SELECT * FROM retained_data WHERE user_id=1"), [{user_id:1,inventory:"stock",diet:"meals",preferences:"preferences"}]);
    // Old phone no longer found for user 1
    assert.equal(await service.userByPhone("13800223001"), null);
    // New phone found for user 1
    assert.equal((await service.userByPhone(newPhone))?.id, 1);
  } finally {
    sqlite?.close(); await pool?.end();
    if (admin) { await admin.query(`DROP DATABASE ${name}`); await admin.end(); }
  }
});
