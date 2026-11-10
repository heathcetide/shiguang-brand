import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { setSmsProviderForTests } from "../src/services/smsVerificationProvider.js";
import { SqliteAdminUsersRepository } from "../src/modules/adminUsers/sqliteRepository.js";

type Api = (path:string,options?:RequestInit & {token?:string}) => Promise<{response:Response;body:unknown}>;
export async function verifyPhoneBindingHttp(api: Api, db: Database.Database) {
  let sends = 0;
  let duringVerify: (() => void) | undefined;
  const initialMaxEventId = (db.prepare("SELECT MAX(id) AS m FROM auth_verification_events").get() as { m: number | null }).m ?? 0;
  setSmsProviderForTests({id:"binding-test",send:async (_phone,outId) => { sends++; return {success:true,code:"OK",message:"accepted",outId,requestId:null,bizId:null}; },
    verify:async (_phone,outId,code) => { duringVerify?.(); return {success:true,passed:code==="123456",code:"OK",message:"secret 123456 must not be logged",outId}; }});
  const request=async (path:string,body:unknown,token?:string,method="POST") => {
    const result=await api(`/api/v1/auth${path}`,{method,body:JSON.stringify(body),token});
    return {status:result.response.status,body:result.body as Record<string,any>};
  };
  const register=async (n:number) => {
    const result=await request("/register",{identifier:`binding${n}@example.invalid`,username:`binding${n}`,password:"Password1234"});
    assert.equal(result.status,201);return result.body as {token:string;user:{id:number}};
  };
  const send=(token:string,phone:string,currentPassword="Password1234") => request("/phone-binding/send",{phone,currentPassword},token);
  const verify=(token:string,challengeId:string,code="123456") => request("/phone-binding/verify",{challengeId,code},token);
  // This helper runs after existing account-security assertions, using their isolated database and SMS settings.
  const savedLimits=db.prepare("SELECT key,value FROM system_settings WHERE key LIKE 'auth.sms.limit.%'").all() as {key:string;value:string}[];
  for (const key of ["phone_hour","phone_day","ip_hour","ip_day","global_day"]) db.prepare("INSERT INTO system_settings(key,value) VALUES(?,'10000') ON CONFLICT(key) DO UPDATE SET value='10000'").run(`auth.sms.limit.${key}`);
  try {
  const first=await register(1);const other=await register(2);const phone="13800223001";
  db.prepare("INSERT INTO inventory_items(user_id,food_name,category,quantity,quantity_value,quantity_unit,is_available,expiration_date) VALUES(?,'synthetic stock','蔬菜','250g',250,'g',1,'2026-12-31')").run(first.user.id);
  db.prepare("INSERT INTO diet_records(user_id,meal_type,food_name,amount,calories,recorded_at) VALUES(?,'lunch','synthetic meal','250g',45,'2026-10-22')").run(first.user.id);
  const inventory=db.prepare("SELECT * FROM inventory_items WHERE user_id=?").all(first.user.id);
  const diet=db.prepare("SELECT * FROM diet_records WHERE user_id=?").all(first.user.id);
  const retained=db.prepare("SELECT * FROM user_health_profiles WHERE user_id=?").get(first.user.id);
  assert.equal((await send("",phone)).status,401);
  assert.equal((await send(first.token,phone,"wrong")).status,403);assert.equal(sends,0);
  assert.equal((await send(first.token,"+14155550123")).status,400);
  const sent=await send(first.token,`+86${phone}`);assert.equal(sent.status,201);
  assert.equal((await verify(other.token,sent.body.challengeId)).status,403);
  assert.equal((await request("/sms/verify",{challengeId:sent.body.challengeId,code:"123456"})).status,403);
  assert.equal((await request("/reauth/sms/verify",{purpose:"password_update",challengeId:sent.body.challengeId,code:"123456"},first.token)).status,403);
  assert.equal((await verify(first.token,sent.body.challengeId,"000000")).status,400);
  const before=db.prepare("SELECT COUNT(*) n FROM users").get();
  assert.equal((await verify(first.token,sent.body.challengeId)).status,200);
  assert.equal((await verify(first.token,sent.body.challengeId)).status,403);
  assert.deepEqual(db.prepare("SELECT COUNT(*) n FROM users").get(),before);
  assert.deepEqual(db.prepare("SELECT * FROM user_health_profiles WHERE user_id=?").get(first.user.id),retained);
  assert.deepEqual(db.prepare("SELECT * FROM inventory_items WHERE user_id=?").all(first.user.id),inventory);
  assert.deepEqual(db.prepare("SELECT * FROM diet_records WHERE user_id=?").all(first.user.id),diet);
  const loginCode=await request("/sms/send",{phone});assert.equal(loginCode.status,201);
  const login=await request("/sms/verify",{challengeId:loginCode.body.challengeId,code:"123456"});
  assert.equal(login.status,200);assert.equal(login.body.user.id,first.user.id);assert.equal(login.body.isNewUser,false);
  assert.equal((await send(other.token,phone)).status,409);
  const ordinary=await request("/sms/send",{phone:"13800223002"});
  assert.equal((await verify(other.token,ordinary.body.challengeId)).status,403);
  const expired=await send(other.token,"13800223002");assert.equal(expired.status,201);
  db.prepare("UPDATE auth_verification_challenges SET expires_at=datetime('now','-1 minute') WHERE id=?").run(expired.body.challengeId);
  assert.equal((await verify(other.token,expired.body.challengeId)).status,410);
  const changing=await register(3);const stale=await send(changing.token,"13800223003");assert.equal(stale.status,201);
  duringVerify=() => { db.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").run(changing.user.id); };
  assert.equal((await verify(changing.token,stale.body.challengeId)).status,403);duringVerify=undefined;
  assert.equal((db.prepare("SELECT phone FROM users WHERE id=?").get(changing.user.id) as {phone:null}).phone,null);
  const disabled=await register(4);const disabledCode=await send(disabled.token,"13800223004");assert.equal(disabledCode.status,201);
  const adminId=(db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() as {id:number}).id;
  const adminRepo=new SqliteAdminUsersRepository(db);
  await adminRepo.updateStatus(disabled.user.id,true,{adminUserId:adminId});
  await adminRepo.updateStatus(disabled.user.id,false,{adminUserId:adminId});
  assert.equal((await verify(disabled.token,disabledCode.body.challengeId)).status,401);
  const renewed=await request("/login",{identifier:"binding4@example.invalid",password:"Password1234"});assert.equal(renewed.status,200);
  assert.equal((await verify(renewed.body.token,disabledCode.body.challengeId)).status,403);
  const changed=await register(5);const changedCode=await send(changed.token,"13800223005");assert.equal(changedCode.status,201);
  assert.equal((await request("/change-password",{currentPassword:"Password1234",newPassword:"NewPassword123"},changed.token)).status,200);
  assert.equal((await verify(changed.token,changedCode.body.challengeId)).status,401);
  const limited=await register(6);
  for (const key of ["phone_hour","ip_hour","global_day"]) {
    db.prepare("UPDATE system_settings SET value='1' WHERE key=?").run(`auth.sms.limit.${key}`);
    const sendsBefore: number=sends;
    const result=await send(limited.token,"13800223002");
    assert.equal(result.status,429);assert.equal(result.body.code,"SMS_RATE_LIMITED");assert.equal(sends,sendsBefore);
    db.prepare("UPDATE system_settings SET value='10000' WHERE key=?").run(`auth.sms.limit.${key}`);
  }
  const retry=await send(limited.token,"13800223006");assert.equal(retry.status,201);
  for(let attempt=0;attempt<5;attempt++) assert.equal((await verify(limited.token,retry.body.challengeId,"000000")).status,400);
  assert.equal((await verify(limited.token,retry.body.challengeId)).status,429);
  assert.equal((db.prepare("SELECT phone FROM users WHERE id=?").get(limited.user.id) as {phone:null}).phone,null);
  assert.equal(db.prepare("SELECT 1 FROM auth_verification_events WHERE provider_message LIKE '%123456%'").get(),undefined);
  assert.ok(db.prepare("SELECT 1 FROM auth_verification_events WHERE event_type='phone_bind' AND outcome='succeeded'").get());

  // Phone replacement assertions
  const replaceSend = (token: string, newPhone: string, currentPassword = "Password1234") =>
    request("/phone-binding/replace/send", { newPhone, currentPassword }, token);
  const replaceVerify = (token: string, challengeId: string, code = "123456") =>
    request("/phone-binding/replace/verify", { challengeId, code }, token);

  assert.equal((await replaceSend("", "13800223009")).status, 401);
  assert.equal((await replaceSend(other.token, "13800223009")).status, 403);
  assert.equal((await replaceSend(first.token, "13800223009", "wrong")).status, 403);
  assert.equal((await replaceSend(first.token, "+14155550123")).status, 400);
  assert.equal((await replaceSend(first.token, phone)).status, 400);

  const otherPhone = "13800223008";
  const otherSent = await send(other.token, otherPhone);
  assert.equal(otherSent.status, 201);
  assert.equal((await verify(other.token, otherSent.body.challengeId)).status, 200);
  assert.equal((await replaceSend(first.token, otherPhone)).status, 409);

  const newTargetPhone = "13800223009";
  const replaceSent = await replaceSend(first.token, `+86${newTargetPhone}`);
  assert.equal(replaceSent.status, 201);
  assert.ok(replaceSent.body.challengeId);

  assert.equal((await replaceVerify(other.token, replaceSent.body.challengeId)).status, 403);
  assert.equal((await request("/sms/verify", { challengeId: replaceSent.body.challengeId, code: "123456" })).status, 403);
  assert.equal((await replaceVerify(first.token, replaceSent.body.challengeId, "000000")).status, 400);

  const replaceResult = await replaceVerify(first.token, replaceSent.body.challengeId);
  assert.equal(replaceResult.status, 200);
  assert.equal(replaceResult.body.success, true);
  assert.equal((await replaceVerify(first.token, replaceSent.body.challengeId)).status, 409);

  assert.deepEqual(db.prepare("SELECT * FROM inventory_items WHERE user_id=?").all(first.user.id), inventory);
  assert.deepEqual(db.prepare("SELECT * FROM diet_records WHERE user_id=?").all(first.user.id), diet);

  const oldLoginCode = await request("/sms/send", { phone });
  assert.equal(oldLoginCode.status, 201);
  const oldLogin = await request("/sms/verify", { challengeId: oldLoginCode.body.challengeId, code: "123456" });
  assert.notEqual(oldLogin.body.user?.id, first.user.id);

  const newLoginCode = await request("/sms/send", { phone: newTargetPhone });
  assert.equal(newLoginCode.status, 201);
  const newLogin = await request("/sms/verify", { challengeId: newLoginCode.body.challengeId, code: "123456" });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body.user.id, first.user.id);
  assert.equal(newLogin.body.isNewUser, false);
  assert.ok(db.prepare("SELECT 1 FROM auth_verification_events WHERE event_type='phone_replace' AND outcome='succeeded'").get());
  } finally {
    db.prepare("DELETE FROM auth_verification_events WHERE id > ?").run(initialMaxEventId);
    db.prepare("DELETE FROM auth_verification_usage_daily WHERE provider='binding-test'").run();
    db.prepare("DELETE FROM system_settings WHERE key LIKE 'auth.sms.limit.%'").run();
    for (const row of savedLimits) db.prepare("INSERT INTO system_settings(key,value) VALUES(?,?)").run(row.key,row.value);
  }
}
