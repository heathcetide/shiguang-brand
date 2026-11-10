import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresAuthVerificationRepository } from "../src/modules/authVerification/postgresRepository.js";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { PostgresAuthAccountRepository } from "../src/modules/authAccount/postgresRepository.js";
import { AuthAccountService } from "../src/modules/authAccount/service.js";
import { consumeAccountProofPostgres } from "../src/modules/authAccount/reauthProof.js";
import { hashPasswordRecoveryToken, hashRegistrationToken } from "../src/services/authVerificationCrypto.js";

/** Run only against the migration integration suite's isolated pool. Creates and removes its own users. */
export async function verifyAccountSecurityPostgres(pool: Pool) {
  const verification = new AuthVerificationService(new PostgresAuthVerificationRepository(pool));
  const account = new AuthAccountService(new PostgresAuthAccountRepository(pool));
  const fixtureUsers: number[] = [];
  const suffix = randomUUID().replace(/-/g, "").slice(0,12);
  const phone = `139${String(parseInt(suffix.slice(0,7),16)).padStart(8,"0").slice(-8)}`;
  const secondPhone = `138${phone.slice(3)}`;
  const expiresAt = () => new Date(Date.now()+300_000).toISOString();
  const create = async (value: string, name: string) => {
    const subject = await verification.findOrCreateSubject(value);
    const challengeId = randomUUID();
    await verification.createChallenge({id:challengeId,subjectId:subject.id,purpose:"login",outId:randomUUID(),expiresAt:expiresAt(),sourceIp:null,userAgent:"account-security-postgres"});
    const tokenHash = randomUUID();
    await verification.markRegistrationRequired({challengeId,at:new Date().toISOString(),tokenHash,expiresAt:expiresAt()});
    const result = await verification.register({tokenHash,phone:value,username:name,passwordHash:null,at:new Date().toISOString()});
    assert.equal(result.status,"created");if(result.status!=="created") throw new Error("FIXTURE_REGISTRATION_FAILED");
    fixtureUsers.push(result.userId);
    assert.equal((await verification.userResponse(result.userId))?.hasPassword,false);
    assert.equal((await verification.userResponse(result.userId))?.daily_calories_target,null);
    assert.equal((await verification.register({tokenHash,phone:value,username:name,passwordHash:null,at:new Date().toISOString()})).status,"invalid_token");
    return {id:result.userId,phone:value,subjectId:subject.id};
  };
  const grant = async (user: {id:number;phone:string;subjectId:number}, purpose:"password_update"|"account_delete"|"password_recovery") => {
    const current = await verification.reauthUser(user.id);assert.ok(current);
    const challengeId=randomUUID();const token=`${purpose === "password_recovery" ? `${user.id}.` : ""}${randomBytes(32).toString("base64url")}`;
    await verification.createChallenge({id:challengeId,subjectId:user.subjectId,purpose,outId:randomUUID(),expiresAt:expiresAt(),sourceIp:null,userAgent:"account-security-postgres",reauthUserId:user.id,reauthSessionVersion:current.session_version});
    assert.equal(await verification.beginVerification(challengeId),true);
    const proof={challengeId,userId:user.id,purpose:purpose === "password_recovery" ? "password_update" as const : purpose,
      ...(purpose === "password_recovery" ? {challengePurpose:"password_recovery" as const} : {}),phone:user.phone,sessionVersion:current.session_version,
      tokenHash:purpose === "password_recovery" ? hashPasswordRecoveryToken(token) : hashRegistrationToken(token),expiresAt:expiresAt()};
    assert.equal(await verification.issueReauthGrant(proof),true);
    assert.equal(await verification.issueReauthGrant({...proof,tokenHash:randomUUID()}),false);
    return {token,tokenHash:proof.tokenHash};
  };
  try {
    const first=await create(phone,`安全测试${suffix}`);
    const second=await create(secondPhone,`注销测试${suffix}`);
    await assert.rejects(account.login(phone,"NoSuchPass1","127.0.0.1"),/密码错误/);
    const initial=await grant(first,"password_update");
    await assert.rejects(account.deleteAccount(first.id,{reauthToken:initial.token}),/重新验证/);
    await assert.rejects(account.setPassword(second.id,"FirstPass1",initial.token),/重新验证/);
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await consumeAccountProofPostgres(client,first.id,"password_update",{tokenHash:initial.tokenHash});
      await client.query("ROLLBACK");
    } finally {client.release();}
    const attempts=await Promise.allSettled([account.setPassword(first.id,"FirstPass1",initial.token),account.setPassword(first.id,"OtherPass2",initial.token)]);
    assert.equal(attempts.filter((result) => result.status==="fulfilled").length,1);
    assert.equal((await verification.reauthUser(first.id))?.session_version,2);
    assert.equal((await account.me(first.id)).hasPassword,true);
    assert.equal((await account.me(second.id)).hasPassword,false);

    const beforeRecovery=await new PostgresAuthAccountRepository(pool).getCredentials(first.id);
    const recovery=await grant(first,"password_recovery");
    await assert.rejects(account.recoverPassword(`${second.id}.${recovery.token.split(".")[1]}`,"CrossUser1"),/已失效/);
    await assert.rejects(account.setPassword(first.id,"CrossPurpose1",recovery.token),/重新验证/);
    const reauth=await grant(first,"password_update");
    await assert.rejects(account.recoverPassword(reauth.token,"CrossPurpose1"),/已失效/);
    const recoveryAttempts=await Promise.allSettled([account.recoverPassword(recovery.token,"RecoveredPass1"),account.recoverPassword(recovery.token,"RecoveredPass1")]);
    assert.equal(recoveryAttempts.filter(result => result.status==="fulfilled").length,1);
    assert.equal((await verification.reauthUser(first.id))?.session_version,3);
    assert.equal(await new PostgresAuthAccountRepository(pool).recordSuccessfulLogin(first.id,new Date().toISOString(),"127.0.0.1",{passwordHash:beforeRecovery!.password_hash!,sessionVersion:2}),null);
    assert.equal((await account.login(first.phone,"RecoveredPass1","127.0.0.1")).user.id,first.id);
    const disabledRecovery=await grant(first,"password_recovery");
    await pool.query("UPDATE users SET is_disabled=TRUE WHERE id=$1",[first.id]);
    await assert.rejects(account.recoverPassword(disabledRecovery.token,"BlockedPass1"),/已失效/);
    await pool.query("UPDATE users SET is_disabled=FALSE WHERE id=$1",[first.id]);
    await pool.query("UPDATE account_reauth_grants SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE token_hash=$1",[disabledRecovery.tokenHash]);
    await assert.rejects(account.recoverPassword(disabledRecovery.token,"ExpiredPass1"),/已失效/);

    const expired=await grant(second,"account_delete");
    await pool.query("UPDATE account_reauth_grants SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute' WHERE token_hash=$1",[expired.tokenHash]);
    await assert.rejects(account.deleteAccount(second.id,{reauthToken:expired.token}),/重新验证/);
    const stale=await grant(second,"account_delete");
    await pool.query("UPDATE users SET session_version=session_version+1 WHERE id=$1",[second.id]);
    await assert.rejects(account.deleteAccount(second.id,{reauthToken:stale.token}),/重新验证/);
    const changedPhone=await grant(second,"account_delete");
    await pool.query("UPDATE users SET phone=NULL WHERE id=$1",[second.id]);
    await assert.rejects(account.deleteAccount(second.id,{reauthToken:changedPhone.token}),/重新验证/);
    await pool.query("UPDATE users SET phone=$1 WHERE id=$2",[second.phone,second.id]);
    const deletion=await grant(second,"account_delete");
    assert.equal((await account.deleteAccount(second.id,{reauthToken:deletion.token})).success,true);
    assert.equal((await pool.query("SELECT id FROM users WHERE id=$1",[second.id])).rowCount,0);
    assert.equal((await pool.query("SELECT token_hash FROM account_reauth_grants WHERE user_id=$1",[second.id])).rowCount,0);
    await assert.rejects(account.deleteAccount(second.id,{reauthToken:deletion.token}),/不存在/);
  } finally {
    if(fixtureUsers.length) await pool.query("DELETE FROM users WHERE id=ANY($1::integer[])",[fixtureUsers]);
  }
}
