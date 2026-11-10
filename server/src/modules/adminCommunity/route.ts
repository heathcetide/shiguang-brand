import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { adminEventSchema, adminQuestionSchema } from "../../validation/schemas.js";
import { AdminCommunityError } from "./errors.js";
import type { AdminCommunityService } from "./service.js";

function context(req:AuthRequest) { return {adminUserId:req.userId!,ipAddress:req.ip,userAgent:req.get("user-agent")||null}; }
function handle(error:unknown,res:Response,next:NextFunction,fallback:string) { if(error instanceof AdminCommunityError) {
  return error.code?sendError(res,error.status,error.message,error.code):res.status(error.status).json({error:error.message}); }
  console.error(fallback,error); return res.status(500).json({error:fallback}); }

export function createAdminCommunityRouter(service:AdminCommunityService) {
  const router=Router(); router.param("id",positiveIntegerParam);
  router.get("/community",(req,res,next)=>{ void service.posts(req.query).then((value)=>res.json(value)).catch((error)=>handle(error,res,next,"获取社区帖子失败")); });
  router.delete("/community/:id",(req:AuthRequest,res,next)=>{ void service.deletePost(Number(req.params.id),context(req)).then((value)=>res.json(value))
    .catch((error)=>handle(error,res,next,"删除帖子失败")); });
  router.get("/community/:id/comments",(req,res,next)=>{ void service.comments(Number(req.params.id)).then((value)=>res.json(value))
    .catch((error)=>handle(error,res,next,"获取评论失败")); });
  router.delete("/community/comments/:id",(req:AuthRequest,res,next)=>{ void service.deleteComment(Number(req.params.id),context(req)).then((value)=>res.json(value))
    .catch((error)=>handle(error,res,next,"删除评论失败")); });
  router.put("/community/:id/event",validateBody(adminEventSchema),(req:AuthRequest,res,next)=>{ void service.updateEvent(Number(req.params.id),req.body,context(req))
    .then((value)=>res.json(value)).catch((error)=>handle(error,res,next,"更新活动失败")); });
  router.put("/community/:id/question",validateBody(adminQuestionSchema),(req:AuthRequest,res,next)=>{ void service.updateQuestion(Number(req.params.id),req.body,context(req))
    .then((value)=>res.json(value)).catch((error)=>handle(error,res,next,"更新问题状态失败")); });
  return router;
}
