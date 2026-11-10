import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { uuidParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { shoppingListImportSchema, shoppingListItemCreateSchema, shoppingListItemUpdateSchema } from "../../validation/schemas.js";
import { ShoppingDomainError } from "./errors.js";
import type { ShoppingService } from "./service.js";

function handleDomainError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof ShoppingDomainError) return sendError(res, error.status, error.message, error.code);
  return next(error);
}

export function createShoppingRouter(service: ShoppingService) {
  const router = Router();
  router.use(authMiddleware);
  router.param("id", uuidParam);

  router.get("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.list(req.userId!).then((items) => res.json(items)).catch(next);
  });

  router.post("/", validateBody(shoppingListItemCreateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.create(req.userId!, req.body).then((item) => res.status(201).json(item)).catch(next);
  });

  router.patch("/:id", validateBody(shoppingListItemUpdateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.update(String(req.params.id), req.userId!, req.body)
      .then((item) => res.json(item))
      .catch((error: unknown) => handleDomainError(error, res, next));
  });

  router.delete("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.remove(String(req.params.id), req.userId!)
      .then((result) => res.json(result))
      .catch((error: unknown) => handleDomainError(error, res, next));
  });

  router.post("/import", validateBody(shoppingListImportSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.importItems(req.userId!, req.body).then((result) => res.json(result)).catch(next);
  });

  return router;
}
