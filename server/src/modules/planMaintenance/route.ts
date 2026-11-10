import { Router } from "express";
import { planMaintenanceSettingsSchema } from "@dietdigidose/contracts";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { MealPlansError } from "../mealPlans/errors.js";
import type { PlanMaintenanceService } from "./service.js";

export function createPlanMaintenanceRouter(service: PlanMaintenanceService) {
  const router = Router();
  router.use(authMiddleware);
  router.get("/runs", (req: AuthRequest,res,next) => {
    void service.runs(req.userId!).then(value => res.json(value)).catch(next);
  });
  router.get("/settings", (req: AuthRequest,res,next) => {
    void service.settings(req.userId!).then(value => res.json(value)).catch(next);
  });
  router.patch("/settings", validateBody(planMaintenanceSettingsSchema), (req: AuthRequest,res,next) => {
    void service.updateSettings(req.userId!,req.body).then(value => res.json(value)).catch(error => {
      if (error instanceof MealPlansError) return sendError(res,error.status,error.message,error.code);
      next(error);
    });
  });
  return router;
}
