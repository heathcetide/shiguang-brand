import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { kitchenwareSchema } from "../../validation/schemas.js";
import { KitchenwareError } from "./errors.js";
import type { KitchenwareService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof KitchenwareError ? res.status(error.status).json({ error: error.message }) : next(error);
}

export function createKitchenwareRouter(service: KitchenwareService) {
  const router = Router();
  router.use(authMiddleware);
  router.param("id", positiveIntegerParam);
  router.param("recipeId", positiveIntegerParam);
  router.get("/", (req: AuthRequest, res, next) => {
    void service.list(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.get("/catalog", (req, res, next) => {
    void service.catalog(String(req.query.query || "").trim()).then((value) => res.json(value)).catch(next);
  });
  router.get("/capabilities", (_req, res, next) => {
    void service.capabilities().then((value) => res.json(value)).catch(next);
  });
  router.get("/recipes/:recipeId/compatibility", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.compatibility(req.userId!, Number(req.params.recipeId))
      .then((value) => res.json(value)).catch((error: unknown) => handle(error, res, next));
  });
  router.post("/", validateBody(kitchenwareSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.create(req.userId!, req.body || {}).then((value) => res.status(201).json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.put("/:id", validateBody(kitchenwareSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.update(req.userId!, Number(req.params.id), req.body || {}).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.post("/:id/maintain", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.maintain(req.userId!, Number(req.params.id)).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.delete("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.remove(req.userId!, Number(req.params.id)).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  return router;
}
