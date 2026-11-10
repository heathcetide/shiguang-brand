import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { uuidParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import {
  cookingQueueCreateSchema, cookingQueueReorderSchema, cookingQueueUpdateSchema, cookingQueueVersionSchema,
} from "../../validation/schemas.js";
import { CookingQueueError } from "./errors.js";
import type { CookingQueueService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof InventoryQuantityError) return sendError(res, 409, error.message, error.code);
  if (error instanceof CookingQueueError) return sendError(res, error.status, error.message, error.code);
  return next(error);
}

export function createCookingQueueRouter(service: CookingQueueService) {
  const router = Router();
  router.use(authMiddleware);
  router.param("id", uuidParam);

  router.get("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.list(req.userId!, req.query.includeHistory === "true").then((rows) => res.json(rows)).catch(next);
  });
  router.post("/", validateBody(cookingQueueCreateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.create(req.userId!, req.body)
      .then((result) => res.status(result.added ? 201 : 200).json(result))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.patch("/:id", validateBody(cookingQueueUpdateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.update(String(req.params.id), req.userId!, req.body).then((item) => res.json(item))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.post("/reorder", validateBody(cookingQueueReorderSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.reorder(req.userId!, req.body.items).then((items) => res.json(items))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.post("/:id/start", validateBody(cookingQueueVersionSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.start(String(req.params.id), req.userId!, req.body.version).then((item) => res.json(item))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.post("/:id/complete", validateBody(cookingQueueVersionSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.complete(String(req.params.id), req.userId!, req.body.version).then((item) => res.json(item))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.delete("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.cancel(String(req.params.id), req.userId!).then((result) => res.json(result))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.delete("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.cancelAll(req.userId!).then((result) => res.json(result)).catch(next);
  });
  return router;
}
