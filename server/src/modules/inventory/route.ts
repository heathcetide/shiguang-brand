import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { InventoryDomainError } from "./errors.js";
import {
  inventoryBulkIntakeSchema,
  inventoryConsumptionPreviewSchema,
  inventoryConsumptionSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  shoppingInventoryImportSchema,
} from "./schema.js";
import type { InventoryService } from "./service.js";

type AsyncHandler = (req: AuthRequest, res: Response) => Promise<unknown>;

const handle = (handler: AsyncHandler) => (req: AuthRequest, res: Response, next: NextFunction) => {
  void handler(req, res).catch(next);
};

export function createInventoryRouter(service: InventoryService) {
  const router = Router();
  router.param("id", positiveIntegerParam);
  router.use(authMiddleware);

  router.post("/import-shopping-list", validateBody(shoppingInventoryImportSchema), handle(async (req, res) => {
    const response = await service.importShoppingList(req.userId!, req.body);
    return res.status(response.repeated ? 200 : 201).json(response);
  }));

  router.post("/bulk-intake", validateBody(inventoryBulkIntakeSchema), handle(async (req, res) => {
    const response = await service.bulkIntake(req.userId!, req.body);
    return res.status(response.repeated ? 200 : 201).json(response);
  }));

  router.post("/scan-jobs/:jobId/undo", handle(async (req, res) => res.json(await service.undoScan(req.userId!, String(req.params.jobId)))));

  router.post("/scan-jobs/:jobId/accept", handle(async (req, res) => res.json(await service.acceptScan(req.userId!, String(req.params.jobId)))));

  router.get("/scan-jobs/:jobId/review", handle(async (req, res) => res.json(await service.reviewScan(req.userId!, String(req.params.jobId)))));

  router.get("/", handle(async (req, res) => res.json(await service.list(req.userId!))));

  router.post("/", validateBody(inventoryCreateSchema), handle(async (req, res) => {
    return res.status(201).json(await service.create(req.userId!, req.body));
  }));

  router.post("/consumption-preview", validateBody(inventoryConsumptionPreviewSchema), handle(async (req, res) => {
    return res.json(await service.previewConsumption(req.userId!, req.body));
  }));

  router.post("/consume", validateBody(inventoryConsumptionSchema), handle(async (req, res) => {
    const response = await service.consume(req.userId!, req.body);
    return res.status(response.repeated ? 200 : 201).json(response);
  }));

  router.get("/:id/evidence", handle(async (req, res) => res.set("Cache-Control", "no-store").json(await service.evidence(req.userId!, Number(req.params.id)))));

  router.get("/:id/history", handle(async (req, res) => {
    return res.json(await service.history(req.userId!, Number(req.params.id)));
  }));

  router.put("/:id", validateBody(inventoryUpdateSchema), handle(async (req, res) => {
    return res.json(await service.update(req.userId!, Number(req.params.id), req.body));
  }));

  router.delete("/:id", handle(async (req, res) => {
    return res.json(await service.remove(req.userId!, Number(req.params.id)));
  }));

  router.use((error: unknown, _req: AuthRequest, res: Response, next: NextFunction) => {
    if (error instanceof InventoryDomainError) {
      const status = error.code === "INVENTORY_NOT_FOUND"
        ? 404
        : ["INVALID_STRUCTURED_QUANTITY", "INVENTORY_UNIT_MISMATCH", "STRUCTURED_QUANTITY_REQUIRED", "INVALID_CONSUMPTION_AMOUNT"].includes(error.code)
          ? 400
          : 409;
      return sendError(res, status, error.message, error.code);
    }
    return next(error);
  });

  return router;
}
