import { Router, type NextFunction, type Response } from "express";
import { onboardingFailureSchema, onboardingUpdateSchema } from "@dietdigidose/contracts";
import { z } from "zod";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { sendError } from "../../utils/http.js";
import { OnboardingError } from "./domain.js";
import type { OnboardingService } from "./service.js";

export function createOnboardingRouter(service: OnboardingService) {
  const router = Router();
  router.use(authMiddleware);
  const route = (operation: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: AuthRequest, res: Response, next: NextFunction) => {
    void operation(req, res).catch(error => {
      if (error instanceof OnboardingError) { sendError(res, error.statusCode, error.message, error.code); return; }
      if (error instanceof z.ZodError) { sendError(res, 400, "首用进度请求格式无效", "VALIDATION_ERROR"); return; }
      next(error);
    });
  };
  router.get("/", route(async (req, res) => res.json(await service.get(req.userId!))));
  router.patch("/", route(async (req, res) => res.json(await service.update(req.userId!, onboardingUpdateSchema.parse(req.body)))));
  router.post("/save-failed", route(async (req, res) => res.json(await service.saveFailed(req.userId!, onboardingFailureSchema.parse(req.body).requestKey))));
  return router;
}
