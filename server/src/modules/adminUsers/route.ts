import{Router,type NextFunction,type Response}from"express";import type{AuthRequest}from"../../middleware/auth.js";import{validateBody}from"../../middleware/validate.js";
import{positiveIntegerParam}from"../../middleware/validateParam.js";import{sendError}from"../../utils/http.js";import{adminExpertSchema,adminLevelAdjustmentSchema,adminRoleSchema,adminUserCredentialsSchema,adminUserLevelRuleSchema,adminUserStatusSchema}from"../../validation/schemas.js";
import{AdminUsersError}from"./errors.js";import type{AdminUsersService}from"./service.js";
function context(req:AuthRequest){return{adminUserId:req.userId!,ipAddress:req.ip,userAgent:req.get("user-agent")||null};}
function handle(error:unknown,res:Response,next:NextFunction,message:string){if(error instanceof AdminUsersError)return error.code?sendError(res,error.status,error.message,error.code):res.status(error.status).json({error:error.message});console.error(message,error);return res.status(500).json({error:message});}
export function createAdminUsersRouter(service:AdminUsersService){const r=Router();r.param("id",positiveIntegerParam);
  r.get("/user-level-rule",(_req,res,next)=>{void service.levelRule().then(v=>res.json(v)).catch(next);});
  r.put("/user-level-rule",validateBody(adminUserLevelRuleSchema),(req:AuthRequest,res,next)=>{void service.saveLevelRule(req.body,context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"更新账户成长等级规则失败"));});
  r.get("/users",(req,res,next)=>{void service.users(req.query).then(v=>res.json(v)).catch(e=>handle(e,res,next,"获取用户列表失败"));});
  r.get("/users/:id/health-profile",(req:AuthRequest,res,next)=>{void service.healthProfile(Number(req.params.id),context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"获取用户健康与饮食档案失败"));});
  r.post("/users/:id/level-adjustments",validateBody(adminLevelAdjustmentSchema),(req:AuthRequest,res,next)=>{void service.adjustLevel(Number(req.params.id),req.body.xp_delta,req.body.reason,context(req)).then(v=>res.status(201).json(v)).catch(e=>handle(e,res,next,"调整用户等级失败"));});
  r.put("/users/:id/credentials",validateBody(adminUserCredentialsSchema),(req:AuthRequest,res,next)=>{void service.credentials(Number(req.params.id),req.body,context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"更新用户登录信息失败"));});
  r.put("/users/:id/role",validateBody(adminRoleSchema),(req:AuthRequest,res,next)=>{void service.role(req.userId!,Number(req.params.id),req.body.role,context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"更新用户角色失败"));});
  r.put("/users/:id/expert",validateBody(adminExpertSchema),(req:AuthRequest,res,next)=>{void service.expert(Number(req.params.id),req.body.is_verified_expert,context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"更新专业认证失败"));});
  r.put("/users/:id/status",validateBody(adminUserStatusSchema),(req:AuthRequest,res,next)=>{void service.status(req.userId!,Number(req.params.id),req.body.is_disabled,context(req)).then(v=>res.json(v)).catch(e=>handle(e,res,next,"更新用户状态失败"));});return r;}
