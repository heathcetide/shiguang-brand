import { accountPasswordSchema, ACCOUNT_PASSWORD_REQUIREMENTS } from "@dietdigidose/contracts";
import bcrypt from "bcryptjs";
import {decodeCursor,encodeCursor} from "../../utils/cursor.js";
import {levelFrom,levelRuleFrom,type UserLevelRule} from "../community/level.js";
import {AdminUsersError} from "./errors.js";
import type {AdminUsersRepository} from "./repository.js";
import type {AuditContext,Row} from "./types.js";

const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,phone=/^1[3-9]\d{9}$/;
function json(value:unknown,fallback:unknown){if(value==null)return fallback;if(typeof value!=="string")return value;try{return JSON.parse(value);}catch{return fallback;}}
export class AdminUsersService {
  private readonly repository:AdminUsersRepository; constructor(repository:AdminUsersRepository){this.repository=repository;}
  async users(query:Row){const cursorMode=query.pageSize!==undefined||query.cursor!==undefined,pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||50));
    const cursor=query.cursor?decodeCursor(query.cursor):null,cursorId=cursor?Number(cursor.id):null;
    if(query.cursor&&(!cursor||cursor.v!==1||!Number.isInteger(cursorId)||cursorId!<=0))throw new AdminUsersError(400,"分页游标无效","INVALID_CURSOR");
    const rows=await this.repository.listUsers({cursorId,limit:cursorMode?pageSize+1:null});const page=cursorMode?rows.slice(0,pageSize):rows;
    const items=await Promise.all(page.map(async(user)=>({...user,is_verified_expert:Number(Boolean(user.is_verified_expert)),is_disabled:Number(Boolean(user.is_disabled)),
      has_health_profile:Number(Boolean(user.has_health_profile)),level:levelFrom(await this.repository.levelSource(Number(user.id)))})));
    if(!cursorMode)return items;return{items,nextCursor:rows.length>pageSize?encodeCursor({v:1,id:page.at(-1)!.id}):null};}
  async healthProfile(userId:number,context:AuditContext){const result=await this.repository.healthProfile(userId,context);if(!result)throw new AdminUsersError(404,"未找到该用户");
    const p=result.profile;return{user_id:userId,profile:p?{gender:p.gender,age:p.age,height:p.height,weight:p.weight,target_weight:p.target_weight,
      health_goal:p.health_goal,activity_level:p.activity_level,dietary_preference:p.dietary_preference,allergies:json(p.allergies_json,[]),medications:p.medications||"",
      medical_conditions:json(p.medical_conditions_json,[]),medical_notes:p.medical_notes||"",dietary_restrictions:json(p.dietary_restrictions_json,[]),
      disliked_foods:p.disliked_foods||"",kitchen_constraints:json(p.kitchen_constraints_json,{}),nutrition_targets:json(p.nutrition_targets_json,{}),
      tracking_enabled:Boolean(p.tracking_enabled),updated_at:p.updated_at}:null,latest_tracking:result.latest,tracking_count:result.count};}
  async adjustLevel(userId:number,xpDelta:number,reason:string,context:AuditContext){if(!await this.repository.adjustLevel(userId,xpDelta,reason,context))throw new AdminUsersError(404,"未找到该用户");
    return{success:true,level:levelFrom(await this.repository.levelSource(userId))};}
  async credentials(userId:number,body:Row,context:AuditContext){let emailValue:string|null=null,phoneValue:string|null=null,updated=false;
    if(body.identifier!==undefined){const value=String(body.identifier).trim().toLowerCase();if(email.test(value))emailValue=value;else if(phone.test(value))phoneValue=value;
      else throw new AdminUsersError(400,"账号必须是有效的邮箱或中国大陆手机号");updated=true;}
    if (body.newPassword !== undefined && !accountPasswordSchema.safeParse(body.newPassword).success) throw new AdminUsersError(400, ACCOUNT_PASSWORD_REQUIREMENTS, "INVALID_PASSWORD");
    const reset=body.newPassword!==undefined,passwordHash=reset?await bcrypt.hash(String(body.newPassword),12):null;
    const result=await this.repository.updateCredentials(userId,{email:emailValue,phone:phoneValue,identifierUpdated:updated,passwordHash,passwordReset:reset},context);
    if(result.kind==="not_found")throw new AdminUsersError(404,"未找到该用户");if(result.kind==="admin")throw new AdminUsersError(403,"管理员账号请通过修改密码页自行维护");
    if(result.kind==="duplicate")throw new AdminUsersError(409,"该邮箱或手机号已被其他账号使用");return{success:true,user:result.user};}
  async role(actorId:number,userId:number,role:string,context:AuditContext){if(role!=="admin"&&role!=="user")throw new AdminUsersError(400,"无效的角色类型");
    if(actorId===userId&&role!=="admin")throw new AdminUsersError(400,"不能取消自身的管理员权限");if((await this.repository.updateRole(userId,role,context)).kind==="not_found")throw new AdminUsersError(404,"未找到该用户");
    return{success:true,message:"角色更新成功"};}
  async expert(userId:number,value:boolean,context:AuditContext){if((await this.repository.updateExpert(userId,value,context)).kind==="not_found")throw new AdminUsersError(404,"未找到该用户");
    return{success:true,is_verified_expert:value};}
  async status(actorId:number,userId:number,value:boolean,context:AuditContext){if(actorId===userId&&value)throw new AdminUsersError(400,"不能停用当前的管理员账号");
    if((await this.repository.updateStatus(userId,value,context)).kind==="not_found")throw new AdminUsersError(404,"未找到该用户");return{success:true,is_disabled:value?1:0};}
  async levelRule(){return levelRuleFrom(await this.repository.levelRule());}
  async saveLevelRule(rule:UserLevelRule,context:AuditContext){await this.repository.saveLevelRule(rule,context);return{success:true,rule};}
}
