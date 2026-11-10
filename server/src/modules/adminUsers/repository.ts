import type {UserLevelRule} from "../community/level.js";import type {AuditContext,CredentialsInput,CredentialsResult,HealthProfileResult,LevelSource,ListInput,Row,UpdateResult} from "./types.js";
export interface AdminUsersRepository {
  listUsers(input:ListInput):Promise<Row[]>;
  levelSource(userId:number):Promise<LevelSource>;
  healthProfile(userId:number,context:AuditContext):Promise<HealthProfileResult>;
  adjustLevel(userId:number,xpDelta:number,reason:string,context:AuditContext):Promise<boolean>;
  updateCredentials(userId:number,input:CredentialsInput,context:AuditContext):Promise<CredentialsResult>;
  updateRole(userId:number,role:"admin"|"user",context:AuditContext):Promise<UpdateResult>;
  updateExpert(userId:number,value:boolean,context:AuditContext):Promise<UpdateResult>;
  updateStatus(userId:number,value:boolean,context:AuditContext):Promise<UpdateResult>;
  levelRule():Promise<string|null>;
  saveLevelRule(rule:UserLevelRule,context:AuditContext):Promise<void>;
}
