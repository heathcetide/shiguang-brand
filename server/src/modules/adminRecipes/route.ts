import { Router, type NextFunction, type Response } from "express";
import { recipeExecutionReviewSchema } from "@dietdigidose/contracts";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { adminRecipeQualitySchema, adminRecipeRejectSchema, recipeSubmissionSchema } from "../../validation/schemas.js";
import { adminRecipeUpdateSchema } from "./schema.js";
import { AdminRecipesError } from "./errors.js";
import type { AdminRecipesService } from "./service.js";

function context(req: AuthRequest) { return { adminUserId: req.userId!, ipAddress: req.ip, userAgent: req.get("user-agent") || null }; }
function handle(error: unknown, res: Response, next: NextFunction) {
  if (!(error instanceof AdminRecipesError)) return next(error);
  return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details || {}) });
}

export function createAdminRecipesRouter(service: AdminRecipesService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.get("/recipes", (req, res, next) => { void service.list(req.query).then((value) => res.json(value)).catch((error) => handle(error, res, next)); });
  router.post("/recipes", validateBody(recipeSubmissionSchema), (req: AuthRequest, res, next) => {
    void service.create(req.userId!, req.body, context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/recipes/:id", validateBody(adminRecipeUpdateSchema), (req: AuthRequest, res, next) => {
    void service.update(req.userId!, Number(req.params.id), req.body, context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/recipes/:id/kitchenware", (req: AuthRequest, res, next) => {
    void service.replaceKitchenware(req.userId!, Number(req.params.id), req.body || {}, context(req))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/recipes/:id/duplicates/scan", (req: AuthRequest, res, next) => {
    void service.scanDuplicates(req.userId!, Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/recipes/governance/coverage", (_req, res, next) => { void service.coverage().then((value) => res.json(value)).catch(next); });
  router.post("/recipes/:id/approve", (req: AuthRequest, res, next) => {
    void service.approve(req.userId!, Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/recipes/:id/quality", validateBody(adminRecipeQualitySchema), (req: AuthRequest, res, next) => {
    void service.reviewQuality(req.userId!, Number(req.params.id), req.body.status, String(req.body.reason).trim(), context(req))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/recipes/:id/execution", (req, res, next) => {
    void service.execution(Number(req.params.id)).then(value => res.json(value)).catch(error => handle(error, res, next));
  });
  router.put("/recipes/:id/execution", validateBody(recipeExecutionReviewSchema), (req: AuthRequest, res, next) => {
    void service.reviewExecution(req.userId!, Number(req.params.id), req.body, context(req)).then(value => res.json(value)).catch(error => handle(error, res, next));
  });
  router.post("/recipes/:id/reject", validateBody(adminRecipeRejectSchema), (req: AuthRequest, res, next) => {
    void service.reject(req.userId!, Number(req.params.id), String(req.body.reason).trim(), context(req))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/recipes/:id", (req: AuthRequest, res, next) => {
    void service.remove(req.userId!, Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  return router;
}
