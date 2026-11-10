import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { feedbackCreateSchema } from "../../validation/schemas.js";
import { FeedbackError } from "./domain.js";
import type { FeedbackService } from "./service.js";
const status = z.enum(["received", "processing", "waiting_user", "resolved", "closed"]);
const listQuery = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(20), category: z.enum(["issue", "suggestion", "support"]).optional(), status: status.optional() });
const userReply = z.object({ requestKey: z.string().uuid(), content: z.string().trim().min(1).max(2000), version: z.number().int().positive() }).strict();
const adminReply = userReply.extend({ visibility: z.enum(["public", "internal"]).default("public"), status: status.optional() }).strict();
const id = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
export function createFeedbackRouter(service: FeedbackService) {
  const router = Router();
  router.use(authMiddleware);
  const route = (operation: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: AuthRequest, res: Response, next: NextFunction) => {
    void operation(req, res).catch(error => {
      if (error instanceof FeedbackError) { res.status(error.statusCode).json({ error: error.message, code: error.code }); return; }
      if (error instanceof z.ZodError) { res.status(400).json({ error: "反馈请求格式无效", code: "VALIDATION_ERROR" }); return; }
      next(error);
    });
  };
  router.get("/admin", requireAdmin, route(async (req, res) => res.json(await service.list(null, listQuery.parse(req.query)))));
  router.get("/admin/:id", requireAdmin, route(async (req, res) => res.json(await service.detail(null, id(req)))));
  router.post("/admin/:id/replies", requireAdmin, validateBody(adminReply), route(async (req, res) => res.json(await service.reply(req.userId!, true, id(req), req.body))));
  router.get("/", route(async (req, res) => res.json(await service.list(req.userId!, listQuery.parse(req.query)))));
  router.get("/:id", route(async (req, res) => res.json(await service.detail(req.userId!, id(req)))));
  router.post("/:id/replies", validateBody(userReply), route(async (req, res) => res.json(await service.reply(req.userId!, false, id(req), req.body))));
  router.post("/", validateBody(feedbackCreateSchema), route(async (req, res) => res.status(201).json(await service.create(req.userId!, req.body))));
  return router;
}
