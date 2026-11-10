import { preparedMealEventSchema } from "@dietdigidose/contracts";
import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam, uuidParam } from "../../middleware/validateParam.js";
import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { sendError } from "../../utils/http.js";
import { cookingCompletionSchema, dietRecordCreateSchema } from "../../validation/schemas.js";
import type { DietRecordsService } from "./service.js";
import { DietRecordRequestError } from "./manualRequest.js";

function handleInventoryError(error: unknown, res: Response, next: NextFunction) {
  if (!(error instanceof InventoryQuantityError)) return next(error);
  const status = ["INVENTORY_UNIT_MISMATCH", "STRUCTURED_QUANTITY_REQUIRED", "INVALID_CONSUMPTION_AMOUNT"].includes(error.code) ? 400 : 409;
  return sendError(res, status, error.message, error.code);
}

export function createDietRecordsRouter(service: DietRecordsService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.param("mealId", uuidParam);
  router.use(authMiddleware);

  router.post("/cooking-completions", validateBody(cookingCompletionSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.completeCooking(req.userId!, req.body)
      .then((result) => res.status(result.repeated ? 200 : 201).json(result))
      .catch((error: unknown) => handleInventoryError(error, res, next));
  });
  router.get("/prepared-meals", (req: AuthRequest, res, next) => {
    void service.listPreparedMeals(req.userId!).then(value => res.json(value)).catch(next);
  });
  router.post("/prepared-meals/:mealId/events", validateBody(preparedMealEventSchema), (req: AuthRequest, res, next) => {
    void service.applyMealEvent(req.userId!, String(req.params.mealId), req.body)
      .then(value => res.status(value.repeated ? 200 : 201).json(value)).catch(error => handleInventoryError(error, res, next));
  });
  router.get("/", (req: AuthRequest, res: Response, next: NextFunction) => {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    void service.list(req.userId!, date).then((records) => res.json(records)).catch(next);
  });
  router.post("/", validateBody(dietRecordCreateSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.create(req.userId!, req.body).then((record) => res.status(record.repeated ? 200 : 201).json(record)).catch((error:unknown) => {
      if(error instanceof DietRecordRequestError) return sendError(res,error.status,error.message,error.code);
      return next(error);
    });
  });
  router.delete("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    const mode = req.query.mode;
    if (mode !== undefined && mode !== "undo_eating" && mode !== "delete_intake") {
      sendError(res, 400, "删除方式无效", "INVALID_DELETE_MODE"); return;
    }
    void service.remove(req.userId!, Number(req.params.id), mode)
      .then((removed) => removed ? res.json({ message: "删除成功" }) : sendError(res, 404, "记录不存在", "DIET_RECORD_NOT_FOUND"))
      .catch(error => handleInventoryError(error, res, next));
  });
  return router;
}
