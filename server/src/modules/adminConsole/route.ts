import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { AdminConsoleError } from "./errors.js";
import type { AdminConsoleService } from "./service.js";

function context(req: AuthRequest) { return { adminUserId: req.userId!, ipAddress: req.ip, userAgent: req.get("user-agent") || null }; }
function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof AdminConsoleError ? res.status(error.status).json({ error: error.message }) : next(error);
}

export function createAdminConsoleRouter(service: AdminConsoleService) {
  const router = Router();
  router.get("/core-loops", (req,res,next) => { void service.coreLoops(req.query).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/core-loops/settings", (_req,res,next) => { void service.coreLoopSettings().then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.put("/core-loops/settings", (req: AuthRequest,res,next) => { void service.configureCoreLoops(req.body,context(req)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/core-loops/actors/:userId", (req,res,next) => { void service.coreLoopActor(Number(req.params.userId)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.put("/core-loops/actors/:userId", (req: AuthRequest,res,next) => { void service.classifyCoreLoopActor(Number(req.params.userId),req.body,context(req)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/stats", (_req, res, next) => { void service.stats().then((value) => res.json(value)).catch(next); });
  router.get("/funnel", (req, res, next) => { void service.funnel(req.query).then((value) => res.json(value)).catch(next); });
  router.get("/audit-logs", (req, res, next) => { void service.auditLogs(req.query).then((value) => res.json(value)).catch(next); });
  router.get("/inventory-scan-jobs", (req, res, next) => { void service.scanJobs(req.query).then((value) => res.json(value)).catch(next); });
  router.get("/inventory-scan-jobs/:jobId", (req, res, next) => {
    void service.scanJob(String(req.params.jobId)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/chat-conversations", (req, res, next) => { void service.conversations(req.query).then((value) => res.json(value)).catch(next); });
  router.get("/chat-conversations/:userId/:sessionId", (req, res, next) => {
    void service.conversation(Number(req.params.userId), String(req.params.sessionId || ""))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/trash", (_req, res, next) => { void service.trash().then((value) => res.json(value)).catch(next); });
  router.post("/trash/:resource/:id/restore", (req: AuthRequest, res, next) => {
    void service.restore(String(req.params.resource), Number(req.params.id), context(req))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/ai-usage", (req, res, next) => {
    void service.usage(req.query).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/stats/trends", (_req, res, next) => { void service.trends().then((value) => res.json(value)).catch(next); });
  router.get("/stats/recent", (_req, res, next) => { void service.recent().then((value) => res.json(value)).catch(next); });
  return router;
}
