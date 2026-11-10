import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { adminKitchenwareCatalogSchema, adminKitchenwareStatusSchema } from "../../validation/schemas.js";
import { AdminKitchenwareError } from "./errors.js";
import type { AdminKitchenwareService } from "./service.js";

function context(req: AuthRequest) { return { adminUserId: req.userId!, ipAddress: req.ip, userAgent: req.get("user-agent") || null }; }
function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof AdminKitchenwareError ? res.status(error.status).json({ error: error.message }) : next(error);
}

export function createAdminKitchenwareRouter(service: AdminKitchenwareService) {
  const router = Router(); router.param("id", positiveIntegerParam);
  router.get("/kitchenware/mapping-reviews", (req,res,next) => { void service.mappingReviews(req.query).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.post("/kitchenware/mapping-reviews/:id", (req: AuthRequest,res,next) => { void service.decideMapping(Number(req.params.id),req.body,context(req)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/kitchenware/catalog/:id/capabilities", (req,res,next) => { void service.capabilityConfiguration(Number(req.params.id)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.put("/kitchenware/catalog/:id/capabilities", (req: AuthRequest,res,next) => { void service.updateCapabilities(Number(req.params.id),req.body,context(req)).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/kitchenware/catalog", (req, res, next) => { void service.catalog(req.query).then((value) => res.json(value)).catch(next); });
  router.post("/kitchenware/catalog", validateBody(adminKitchenwareCatalogSchema), (req: AuthRequest, res, next) => {
    void service.createCatalog(req.body, context(req)).then((value) => res.status(201).json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/kitchenware/catalog/:id", validateBody(adminKitchenwareCatalogSchema), (req: AuthRequest, res, next) => {
    void service.updateCatalog(Number(req.params.id), req.body, context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/kitchenware/catalog/:id", (req: AuthRequest, res, next) => {
    void service.removeCatalog(Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/kitchenware", (req, res, next) => { void service.assets(req.query).then((value) => res.json(value)).catch(next); });
  router.put("/kitchenware/:id/status", validateBody(adminKitchenwareStatusSchema), (req: AuthRequest, res, next) => {
    void service.updateAssetStatus(Number(req.params.id), String(req.body.status).trim(), context(req))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/kitchenware/:id", (req: AuthRequest, res, next) => {
    void service.removeAsset(Number(req.params.id), context(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  return router;
}
