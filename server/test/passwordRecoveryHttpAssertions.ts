import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { setSmsProviderForTests } from "../src/services/smsVerificationProvider.js";
import { ACCOUNT_SECURITY_CAPABILITY } from "@dietdigidose/contracts";

type Api = (path:string,options?:RequestInit & {token?:string}) => Promise<{response:Response;body:unknown}>;
/** Uses the surrounding account-security suite's explicitly fake SMS provider. */
export async function verifyPasswordRecoveryHttp(api: Api, db: Database.Database) {
  const post = async (path:string,body:unknown,token?:string) => {
    const result = await api(`/api/v1/auth${path}`,{method:"POST",body:JSON.stringify(body),token});
    return {status:result.response.status,body:result.body as Record<string,any>};
  };
  const phone="13900419101";
  const oldHash=bcrypt.hashSync("OldRecovery1",4);
  const userId=Number(db.prepare("INSERT INTO users(username,phone,password_hash,phone_verified_at) VALUES('recovery-verified',?,?,CURRENT_TIMESTAMP)").run(phone,oldHash).lastInsertRowid);
  const oldLogin=await post("/login",{identifier:phone,password:"OldRecovery1"});assert.equal(oldLogin.status,200);
  const sent=await post("/password-recovery/send",{phone});assert.equal(sent.status,201);
  assert.equal((await post("/sms/verify",{challengeId:sent.body.challengeId,code:"123456"})).status,403);
  assert.equal((await post("/password-recovery/verify",{challengeId:sent.body.challengeId,code:"000000"})).status,400);
  const verified=await post("/password-recovery/verify",{challengeId:sent.body.challengeId,code:"123456"});assert.equal(verified.status,200);
  const recoveryToken=verified.body.recoveryToken as string;
  assert.equal(Number(recoveryToken.split(".")[0]),userId);
  assert.equal((await post("/password-recovery/reset",{recoveryToken:`${userId+1}.${recoveryToken.split(".")[1]}`,newPassword:"CrossUser1"})).status,403);
  for (const prefix of ["0","-1","01","9007199254740992"]) {
    assert.equal((await post("/password-recovery/reset",{recoveryToken:`${prefix}.${recoveryToken.split(".")[1]}`,newPassword:"BadId1"})).status,400);
  }
  assert.equal((await post("/password",{reauthToken:recoveryToken,newPassword:"CrossPurpose1"},oldLogin.body.token)).status,403);
  assert.equal((await post("/password-recovery/reset",{recoveryToken,newPassword:"short"})).status,400);
  // Invalid new passwords must be rejected before consuming the valid one-time grant.
  for (const newPassword of ["Aa1" + "x".repeat(70), "Aa1" + "界".repeat(24)]) {
    assert.equal((await post("/password-recovery/reset",{recoveryToken,newPassword})).status,400);
  }
  const resets=await Promise.all([post("/password-recovery/reset",{recoveryToken,newPassword:"NewRecovery2"}),post("/password-recovery/reset",{recoveryToken,newPassword:"NewRecovery2"})]);
  assert.deepEqual(resets.map(value => value.status).sort(),[200,403]);
  assert.equal((await post("/password-recovery/verify",{challengeId:sent.body.challengeId,code:"123456"})).status,409);
  assert.equal((await post("/login",{identifier:phone,password:"OldRecovery1"})).status,401);
  assert.equal((await post("/login",{identifier:phone,password:"NewRecovery2"})).status,200);
  assert.equal((await api("/api/v1/auth/me",{token:oldLogin.body.token,headers:{"X-Account-Security":ACCOUNT_SECURITY_CAPABILITY}})).response.status,401);
  assert.equal((db.prepare("SELECT session_version FROM users WHERE id=?").get(userId) as {session_version:number}).session_version,2);

  const emailAttempt = await post("/password-recovery/send", { phone: "user@example.com" });
  assert.equal(emailAttempt.status, 400);
  assert.equal(emailAttempt.body.code, "EMAIL_RECOVERY_UNSUPPORTED");

  const emailBodyAttempt = await post("/password-recovery/send", { email: "user@example.com" });
  assert.equal(emailBodyAttempt.status, 400);
  assert.equal(emailBodyAttempt.body.code, "EMAIL_RECOVERY_UNSUPPORTED");

  // Identical send envelopes for absent, unverified and disabled accounts; none may receive a recovery grant.
  db.prepare("INSERT INTO users(username,phone,password_hash) VALUES('recovery-unverified','13900419102',?)").run(oldHash);
  db.prepare("INSERT INTO users(username,phone,password_hash,phone_verified_at,is_disabled) VALUES('recovery-disabled','13900419103',?,CURRENT_TIMESTAMP,1)").run(oldHash);
  for (const target of ["13900419102","13900419103","13900419104"]) {
    const request=await post("/password-recovery/send",{phone:target});assert.equal(request.status,201);
    assert.deepEqual(Object.keys(request.body).sort(),Object.keys(sent.body).sort());
    const result=await post("/password-recovery/verify",{challengeId:request.body.challengeId,code:"123456"});
    assert.equal(result.status,400);assert.equal(result.body.code,"PASSWORD_RECOVERY_INVALID");
  }
  // Five wrong attempts consume this challenge's budget, without authorizing login or recovery.
  const retry=await post("/password-recovery/send",{phone});assert.equal(retry.status,201);
  for(let index=0;index<5;index++) assert.equal((await post("/password-recovery/verify",{challengeId:retry.body.challengeId,code:"000000"})).status,400);
  assert.equal((await post("/password-recovery/verify",{challengeId:retry.body.challengeId,code:"123456"})).status,429);
  const expired=await post("/password-recovery/send",{phone});assert.equal(expired.status,201);
  db.prepare("UPDATE auth_verification_challenges SET expires_at=datetime('now','-1 minute') WHERE id=?").run(expired.body.challengeId);
  assert.equal((await post("/password-recovery/verify",{challengeId:expired.body.challengeId,code:"123456"})).status,410);
  assert.equal((await post("/password-recovery/send",{phone})).status,429);
  setSmsProviderForTests({id:"recovery-failure-test",send:async (_phone,outId) => ({outId,success:false,code:"FAILED",message:"sensitive 123456",requestId:null,bizId:null}),
    verify:async () => {throw new Error("must not verify rejected send");}});
  const failed=await post("/password-recovery/send",{phone:"13900419105"});assert.equal(failed.status,502);
  assert.equal(db.prepare("SELECT id FROM auth_verification_events WHERE provider_message LIKE '%sensitive%'").get(),undefined);
}
