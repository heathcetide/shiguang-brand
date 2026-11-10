import { verifyPhoneBindingHttp } from "./phoneBindingHttpAssertions.js";
import { verifyPasswordRecoveryHttp } from "./passwordRecoveryHttpAssertions.js";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { ACCOUNT_SECURITY_CAPABILITY } from "@dietdigidose/contracts";
import { setSmsProviderForTests } from "../src/services/smsVerificationProvider.js";

type Api = (path:string,options?:RequestInit & {token?:string}) => Promise<{response:Response;body:unknown}>;
export async function verifyAccountSecurityHttp(api: Api, db: Database.Database) {
  const previousKey=process.env.ALIYUN_ACCESS_KEY_ID;const previousSecret=process.env.ALIYUN_ACCESS_KEY_SECRET;
  const previousPasswordless=process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED;
  const previous=db.prepare("SELECT value FROM system_settings WHERE key='auth.sms.enabled'").get() as {value:string}|undefined;
  process.env.ALIYUN_ACCESS_KEY_ID="security-test-key";process.env.ALIYUN_ACCESS_KEY_SECRET="security-test-secret";
  process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED="1";
  db.prepare("INSERT INTO system_settings(key,value) VALUES('auth.sms.enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
  setSmsProviderForTests({id:"security-test",send:async (_phone,outId) => ({success:true,code:"OK",message:"accepted",outId,requestId:`request-${outId}`,bizId:`biz-${outId}`}),
    verify:async (_phone,outId,code) => ({success:true,passed:code==="123456",code:"OK",message:"checked",outId})});
  const headers={"X-Account-Security":ACCOUNT_SECURITY_CAPABILITY};
  const request=async (path:string,body:unknown,token?:string,method="POST",capability=true) => {
    const result=await api(`/api/v1/auth${path}`,{method,body:JSON.stringify(body),token,headers:capability?headers:undefined});
    return {status:result.response.status,body:result.body as Record<string,any>};
  };
  const signup=async (phone:string) => {
    const sent=await request("/sms/send",{phone});assert.equal(sent.status,201);
    const verified=await request("/sms/verify",{challengeId:sent.body.challengeId,code:"123456",passwordlessRegistration:true});
    assert.equal(verified.status,201);assert.equal(verified.body.isNewUser,true);assert.equal(verified.body.user.hasPassword,false);
    return verified.body as {token:string;user:{id:number}};
  };
  const proof=async (token:string,purpose:"password_update"|"account_delete") => {
    const sent=await request("/reauth/sms/send",{purpose},token);assert.equal(sent.status,201);
    const wrong=await request("/reauth/sms/verify",{purpose,challengeId:sent.body.challengeId,code:"000000"},token);
    assert.equal(wrong.status,400);assert.equal(wrong.body.code,"SMS_CODE_INVALID");
    const valid=await request("/reauth/sms/verify",{purpose,challengeId:sent.body.challengeId,code:"123456"},token);
    assert.equal(valid.status,200);return valid.body.reauthToken as string;
  };
  try {
    const account=await signup("13900419001");
    process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED="0";
    const rollbackSent=await request("/sms/send",{phone:"13900419003"});assert.equal(rollbackSent.status,201);
    const rollbackVerify=await request("/sms/verify",{challengeId:rollbackSent.body.challengeId,code:"123456",passwordlessRegistration:true});
    assert.equal(rollbackVerify.status,200);assert.equal(rollbackVerify.body.status,"registration_required");
    assert.equal(db.prepare("SELECT id FROM users WHERE phone='13900419003'").get(),undefined);
    assert.equal((await request("/sms/register",{registrationToken:rollbackVerify.body.registrationToken,username:"回滚兼容用户",password:"Aa1" + "界".repeat(24)})).status,400);
    const legacyRegistration=await request("/sms/register",{registrationToken:rollbackVerify.body.registrationToken,username:"回滚兼容用户",password:"LegacyPass123"});
    assert.equal(legacyRegistration.status,201);assert.equal(legacyRegistration.body.user.hasPassword,true);
    assert.equal((await request("/account",{password:"LegacyPass123",confirmation:"DELETE"},legacyRegistration.body.token,"DELETE")).status,200);
    assert.equal((await api("/api/v1/auth/me",{token:account.token})).response.status,426);
    assert.equal((await api("/api/v1/auth/me",{token:account.token,headers})).response.status,200);
    assert.equal((await request("/reauth/sms/send",{purpose:"account_delete",phone:"13900419002"},account.token)).status,400);
    const oldLoginCode=await request("/sms/send",{phone:"13900419001"});
    assert.equal((await request("/sms/verify",{challengeId:oldLoginCode.body.challengeId,code:"123456"},undefined,"POST",false)).status,426);
    const existingLogin=await request("/sms/verify",{challengeId:oldLoginCode.body.challengeId,code:"123456",passwordlessRegistration:true});
    assert.equal(existingLogin.status,200);assert.equal(existingLogin.body.isNewUser,false);assert.equal(existingLogin.body.user.hasPassword,false);
    const passwordProof=await proof(account.token,"password_update");
    assert.equal((await request("/account",{reauthToken:passwordProof,confirmation:"DELETE"},account.token,"DELETE")).status,403);
    assert.equal((await request("/password",{reauthToken:passwordProof,newPassword:"Aa1" + "x".repeat(70)},account.token)).status,400);
    const password=await request("/password",{reauthToken:passwordProof,newPassword:"NewPassword123"},account.token);assert.equal(password.status,200);
    assert.equal((await api("/api/v1/auth/me",{token:account.token,headers})).response.status,401);
    const login=await request("/login",{identifier:"13900419001",password:"NewPassword123"});assert.equal(login.status,200);assert.equal(login.body.user.hasPassword,true);
    const deletionProof=await proof(login.body.token,"account_delete");
    assert.equal((await request("/account",{reauthToken:deletionProof,confirmation:"DELETE"},login.body.token,"DELETE")).status,200);
    assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(account.user.id),undefined);

    process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED="1";
    const noPassword=await signup("13900419002");
    const directDelete=await proof(noPassword.token,"account_delete");
    assert.equal((await request("/account",{reauthToken:directDelete,confirmation:"DELETE"},noPassword.token,"DELETE")).status,200);
    assert.equal(db.prepare("SELECT id FROM users WHERE id=?").get(noPassword.user.id),undefined);
    await verifyPasswordRecoveryHttp(api,db);
    await verifyPhoneBindingHttp(api,db);
  } finally {
    setSmsProviderForTests(null);
    if(previousKey===undefined) delete process.env.ALIYUN_ACCESS_KEY_ID;else process.env.ALIYUN_ACCESS_KEY_ID=previousKey;
    if(previousSecret===undefined) delete process.env.ALIYUN_ACCESS_KEY_SECRET;else process.env.ALIYUN_ACCESS_KEY_SECRET=previousSecret;
    if(previousPasswordless===undefined) delete process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED;else process.env.SMS_PASSWORDLESS_REGISTRATION_ENABLED=previousPasswordless;
    if(previous) db.prepare("UPDATE system_settings SET value=? WHERE key='auth.sms.enabled'").run(previous.value);
    else db.prepare("DELETE FROM system_settings WHERE key='auth.sms.enabled'").run();
  }
}
