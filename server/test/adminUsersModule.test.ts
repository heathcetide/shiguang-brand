import assert from"node:assert/strict";import bcrypt from"bcryptjs";import{describe,test}from"node:test";
import type{AdminUsersRepository}from"../src/modules/adminUsers/repository.js";import{AdminUsersService}from"../src/modules/adminUsers/service.js";
const level={ruleJson:null,dietDates:[],dietRecordCount:0,favoriteCount:0,postCount:0,followerCount:0,checkInCount:0,adjustmentXp:0};
const ctx={adminUserId:1,ipAddress:"127.0.0.1",userAgent:"test"};
function repo(o:Partial<AdminUsersRepository>={}):AdminUsersRepository{return{listUsers:async()=>[],levelSource:async()=>level,healthProfile:async()=>null,adjustLevel:async()=>false,
  updateCredentials:async()=>({kind:"not_found"}),updateRole:async()=>({kind:"not_found"}),updateExpert:async()=>({kind:"not_found"}),updateStatus:async()=>({kind:"not_found"}),
  levelRule:async()=>null,saveLevelRule:async()=>undefined,...o};}
describe("admin users module",()=>{
  test("adds database-neutral levels and preserves cursor booleans",async()=>{const s=new AdminUsersService(repo({listUsers:async()=>[{id:3,is_disabled:false,is_verified_expert:true,has_health_profile:true},{id:2},{id:1}]}));
    const value=await s.users({pageSize:2});if(Array.isArray(value))throw new Error("cursor expected");assert.equal(value.items.length,2);assert.equal(value.items[0].is_verified_expert,1);assert.equal(value.items[1].is_disabled,0);assert.equal(value.items[0].level.level,1);assert.equal(typeof value.nextCursor,"string");});
  test("normalizes SQLite text JSON and PostgreSQL JSONB health profiles",async()=>{const s=new AdminUsersService(repo({healthProfile:async()=>({target:{id:7},profile:{allergies_json:[{name:"坚果"}],medical_conditions_json:'["高血压"]',dietary_restrictions_json:[],kitchen_constraints_json:{servings:2},nutrition_targets_json:"{}",tracking_enabled:true},latest:{id:2},count:4})}));
    const value=await s.healthProfile(7,ctx);assert.deepEqual(value.profile?.allergies,[{name:"坚果"}]);assert.deepEqual(value.profile?.medical_conditions,["高血压"]);assert.deepEqual(value.profile?.kitchen_constraints,{servings:2});assert.equal(value.tracking_count,4);});
  test("hashes reset passwords and maps account conflicts",async()=>{let hash="";const s=new AdminUsersService(repo({updateCredentials:async(_id,input)=>{hash=input.passwordHash||"";return{kind:"updated",user:{id:7,email:input.email}};}}));
    const value=await s.credentials(7,{identifier:" MEMBER@EXAMPLE.COM ",newPassword:"safePass1"},ctx);assert.equal(value.user.email,"member@example.com");assert.equal(await bcrypt.compare("safePass1",hash),true);
    await assert.rejects(()=>s.credentials(7,{identifier:"invalid"},ctx),/有效/);await assert.rejects(()=>new AdminUsersService(repo({updateCredentials:async()=>({kind:"duplicate"})})).credentials(7,{identifier:"x@y.com"},ctx),/已被/);});
  test("protects the acting administrator and maps missing writes",async()=>{const s=new AdminUsersService(repo());await assert.rejects(()=>s.role(1,1,"user",ctx),/不能取消/);await assert.rejects(()=>s.status(1,1,true,ctx),/不能停用/);await assert.rejects(()=>s.expert(9,true,ctx),/未找到/);});
  test("reads defaults and atomically saves a complete level rule",async()=>{let saved:unknown;const s=new AdminUsersService(repo({saveLevelRule:async rule=>{saved=rule;}}));const rule=await s.levelRule();assert.equal(rule.levels[0]?.requiredXp,0);
    assert.deepEqual(await s.saveLevelRule(rule,ctx),{success:true,rule});assert.deepEqual(saved,rule);});});

test("admin reset rejects overlong UTF-8 passwords before changing credentials", async () => {
  let writes = 0;
  const service = new AdminUsersService(repo({updateCredentials: async () => {
    writes++; return {kind:"updated",user:{id:7}};
  }}));
  for (const newPassword of ["Aa1" + "x".repeat(70), "Aa1" + "界".repeat(24)]) {
    await assert.rejects(service.credentials(7, {newPassword}, ctx), /72/);
  }
  assert.equal(writes, 0);
});
