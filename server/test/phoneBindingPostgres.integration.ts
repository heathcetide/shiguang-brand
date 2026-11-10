import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { verifyAccountSecurityPostgres } from "./accountSecurityPostgresAssertions.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { PostgresAuthVerificationRepository } from "../src/modules/authVerification/postgresRepository.js";

const connectionString = process.env.PHONE_BINDING_TEST_PG_URL;
if (!connectionString) throw new Error("PHONE_BINDING_TEST_PG_URL required; only a new temporary database is migrated");
const admin = new Pool({connectionString});
const database = `phone_binding_test_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE DATABASE ${database}`);
const url = new URL(connectionString); url.pathname = `/${database}`;
const pool = new Pool({connectionString:url.toString()});
try {
  await migrate(drizzle(pool),{migrationsFolder:fileURLToPath(new URL("../drizzle",import.meta.url))});
  await verifyAccountSecurityPostgres(pool);
  const account = new AuthAccountService(new PostgresAuthAccountRepository(pool));
  const verification = new AuthVerificationService(new PostgresAuthVerificationRepository(pool));
  const created = await account.register("binding@example.invalid","binding-user","Password1234");
  const id = Number(created.user.id);
  await pool.query("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,is_available,expiration_date) VALUES($1,'synthetic stock','蔬菜','250g',250,'g',TRUE,'2026-12-31')",[id]);
  await pool.query("INSERT INTO diet_records(user_id,meal_type,food_name,amount,calories,recorded_at) VALUES($1,'lunch','synthetic meal','250g',45,'2026-10-22')",[id]);
  const snapshot = async () => Promise.all(["inventory_items","diet_records","user_health_profiles"].map(async table => (await pool.query(`SELECT * FROM ${table} WHERE user_id=$1`,[id])).rows));
  const before = await snapshot();
  const phone = "13800223999";
  const subject = await verification.findOrCreateSubject(phone);
  const challengeId = randomUUID();
  await verification.createChallenge({id:challengeId,subjectId:subject.id,purpose:"phone_bind",outId:challengeId,expiresAt:new Date(Date.now()+60_000).toISOString(),sourceIp:null,userAgent:null,reauthUserId:id,reauthSessionVersion:1});
  await verification.acceptChallenge(challengeId,subject.id,null,null);
  assert.equal(await verification.beginVerification(challengeId),true);
  assert.equal(await verification.bindPhone({userId:id,sessionVersion:1,challengeId,phone}),"bound");
  assert.equal((await verification.userByPhone(phone))?.id,id);
  assert.equal((await account.login(phone,"Password1234","127.0.0.1")).user.id,id);
  assert.deepEqual(await snapshot(),before);
  console.log("PASS: all PostgreSQL migrations, account-security regressions, original-user binding and retained inventory/diet/profile");
} finally {
  await pool.end(); await admin.query(`DROP DATABASE ${database}`); await admin.end();
}
