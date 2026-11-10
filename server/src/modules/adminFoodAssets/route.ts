import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { adminIngredientSchema, adminIngredientUpdateSchema } from "../../validation/schemas.js";
import { AdminFoodAssetsError } from "./errors.js";
import type { AdminFoodAssetsService } from "./service.js";

function context(req: AuthRequest) { return { adminUserId: req.userId!, ipAddress: req.ip, userAgent: req.get("user-agent") || null }; }
function handle(error: unknown, res: Response, next: NextFunction) {
  if (!(error instanceof AdminFoodAssetsError)) return next(error);
  return res.status(error.status).json({ error: error.message, ...(error.details || {}) });
}

export function createAdminFoodAssetsRouter(service: AdminFoodAssetsService) {
  const router = Router(); router.param("id", positiveIntegerParam);
  router.get("/ingredients", (req, res, next) => {
    void service.ingredients(req.query).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/ingredients", validateBody(adminIngredientSchema), (req: AuthRequest, res, next) => {
    void service.createIngredient(req.body, context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/ingredients/:id", validateBody(adminIngredientUpdateSchema), (req: AuthRequest, res, next) => {
    void service.updateIngredient(Number(req.params.id), req.body, context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/ingredients/:id", (req: AuthRequest, res, next) => {
    void service.removeIngredient(Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/ingredients/:id/aliases", (req: AuthRequest, res, next) => {
    void service.addAlias(Number(req.params.id), req.body || {}, context(req)).then((value) => res.status(201).json(value))
      .catch((error) => handle(error, res, next));
  });
  router.post("/ingredients/:id/merge", (req: AuthRequest, res, next) => {
    void service.mergeIngredient(Number(req.params.id), req.body || {}, context(req)).then((value) => res.json(value))
      .catch((error) => handle(error, res, next));
  });
  router.get("/ingredients/governance/coverage", (_req, res, next) => {
    void service.coverage().then((value) => res.json(value)).catch(next);
  });
  router.get("/custom-foods/pending", (_req, res, next) => {
    void service.pendingCustomFoods().then((value) => res.json(value)).catch(next);
  });
  router.post("/custom-foods/:id/approve", (req: AuthRequest, res, next) => {
    void service.approveCustomFood(Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/custom-foods/:id/reject", (req: AuthRequest, res, next) => {
    void service.rejectCustomFood(Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  return router;
}
