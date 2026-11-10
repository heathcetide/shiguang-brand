import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { uuidParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { inventoryOutcomeCreateSchema, inventoryOutcomeUpdateSchema } from "../../validation/schemas.js";
import { InsightsError } from "./errors.js";
import type { InsightsService } from "./service.js";

function handleError(error: unknown, res: Response, next: NextFunction) {
  return error instanceof InsightsError ? sendError(res, error.status, error.message, error.code) : next(error);
}

export function createInsightsRouter(service: InsightsService) {
  const router = Router();
  router.use(authMiddleware);
  router.param("eventId", uuidParam);

  router.post("/inventory-outcomes", validateBody(inventoryOutcomeCreateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.createOutcome(req.userId!, req.body)
      .then((result) => res.status(result.repeated ? 200 : 201).json(result))
      .catch((error: unknown) => handleError(error, res, next));
  });
  router.patch("/inventory-outcomes/:eventId", validateBody(inventoryOutcomeUpdateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.updateOutcome(req.userId!, String(req.params.eventId), req.body)
      .then((event) => res.json(event))
      .catch((error: unknown) => handleError(error, res, next));
  });
  router.get("/inventory-outcomes/weekly", (req: AuthRequest, res: Response, next: NextFunction) => {
    const scope = req.query.scope === "household" ? "household" : "personal";
    void service.weekly(req.userId!, {
      weekStart: typeof req.query.weekStart === "string" ? req.query.weekStart : "",
      timezoneOffsetMinutes: Number(req.query.timezoneOffsetMinutes) || 0,
      scope,
      householdId: scope === "household" ? Number(req.query.householdId) : undefined,
    }).then((report) => res.json(report)).catch((error: unknown) => handleError(error, res, next));
  });
  return router;
}
