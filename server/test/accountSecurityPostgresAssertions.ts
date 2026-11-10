import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";

/** Uses only the integration suite's isolated pool and cleans up its own fixtures. */
export async function verifyAccountSecurityPostgres(pool: Pool) {
  const repository = new PostgresAuthAccountRepository(pool);
  const account = new AuthAccountService(repository);
  const fixtureUsers: number[] = [];
  const suffix = randomUUID();
  const email = `security-${suffix}@example.test`;
  try {
    const created = await account.register(email, `security-${suffix}`, "InitialPass123");
    const id = Number(created.user.id);
    fixtureUsers.push(id);
    const before = await repository.getCredentials(id);
    await assert.rejects(account.login(email, "wrong", "127.0.0.1"), /密码错误/);
    await assert.rejects(account.deleteAccount(id, "wrong"), /当前密码不正确/);
    await assert.rejects(account.changePassword(id,"wrong","ChangedPass123"),/当前密码不正确/);
    assert.equal((await account.changePassword(id,"InitialPass123","ChangedPass123")).success,true);
    assert.equal((await pool.query("SELECT session_version FROM users WHERE id=$1",[id])).rows[0].session_version,2);
    assert.equal(await repository.recordSuccessfulLogin(id,new Date().toISOString(),"127.0.0.1",{passwordHash:before!.password_hash!,sessionVersion:1}),null);
    assert.equal((await account.login(email,"ChangedPass123","127.0.0.1")).user.id,id);
    assert.equal((await account.deleteAccount(id,"ChangedPass123")).success,true);
    assert.equal((await pool.query("SELECT id FROM users WHERE id=$1",[id])).rowCount,0);

    const passwordless = (await pool.query("INSERT INTO users(username,email,password_hash) VALUES($1,$2,NULL) RETURNING id",[`legacy-${suffix}`,`legacy-${suffix}@example.test`])).rows[0].id;
    fixtureUsers.push(passwordless);
    await assert.rejects(account.deleteAccount(passwordless,"anything"),/当前密码不正确/);
    assert.equal((await pool.query("SELECT id FROM users WHERE id=$1",[passwordless])).rowCount,1);
  } finally {
    if (fixtureUsers.length) await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])",[fixtureUsers]);
  }
}
