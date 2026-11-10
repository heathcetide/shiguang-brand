import { InventoryQuantityError } from "../../services/inventoryQuantity.js";
import { householdMealReservationSchema, householdMealEatingSchema, householdMealProductionSchema, householdDiningAllocationSchema, householdDiningPreferencesSchema } from "@dietdigidose/contracts";
import crypto from "node:crypto";
import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import {
  householdShoppingCreateSchema, householdShoppingIntakeSchema, householdShoppingUpdateSchema,
  householdTransferOwnerSchema, inventoryUpdateSchema,
} from "../../validation/schemas.js";
import { HouseholdsError } from "./errors.js";
import type { HouseholdsService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof InventoryQuantityError) return sendError(res,409,error.message,error.code);
  return error instanceof HouseholdsError ? sendError(res, error.status, error.message, error.code) : next(error);
}
function householdId(req: AuthRequest) { return Number(req.params.id); }

export function createHouseholdsRouter(service: HouseholdsService) {
  const router = Router();
  router.use(authMiddleware);
  router.post("/", (req: AuthRequest, res, next) => {
    void service.create(req.userId!, req.body.name).then((value) => res.status(201).json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/mine", (req: AuthRequest, res, next) => {
    void service.mine(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.post("/join", (req: AuthRequest, res, next) => {
    void service.join(req.userId!, req.body.invite_code).then((value) => res.status(value.status).json(value.body))
      .catch((error) => handle(error, res, next));
  });
  router.post("/:id/leave", (req: AuthRequest, res, next) => {
    void service.leave(req.userId!, householdId(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/:id/transfer-owner", validateBody(householdTransferOwnerSchema), (req: AuthRequest, res, next) => {
    void service.transferOwner(req.userId!, householdId(req), req.body).then((value) => res.json(value))
      .catch((error) => handle(error, res, next));
  });
  router.post("/:id/dining-allocation-preview", validateBody(householdDiningAllocationSchema), (req: AuthRequest,res,next) => {
    void service.previewDiningAllocation(req.userId!,householdId(req),req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.put("/:id/meals/:mealId/reservation", validateBody(householdMealReservationSchema), (req: AuthRequest,res,next) => {
    void service.reserveMeal(req.userId!,householdId(req),String(req.params.mealId),req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.get("/:id/meals", (req: AuthRequest,res,next) => {
    void service.meals(req.userId!,householdId(req)).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.post("/:id/meals/:mealId/eat", validateBody(householdMealEatingSchema), (req: AuthRequest,res,next) => {
    void service.eatMeal(req.userId!,householdId(req),String(req.params.mealId),req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.post("/:id/meals", validateBody(householdMealProductionSchema), (req: AuthRequest,res,next) => {
    void service.produceMeal(req.userId!,householdId(req),req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.get("/:id/dining-members", (req: AuthRequest,res,next) => {
    void service.diningMembers(req.userId!,householdId(req)).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.get("/:id/dining-preferences", (req: AuthRequest,res,next) => {
    void service.diningPreferences(req.userId!,householdId(req)).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.put("/:id/dining-preferences", validateBody(householdDiningPreferencesSchema), (req: AuthRequest,res,next) => {
    void service.saveDiningPreferences(req.userId!,householdId(req),req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.get("/:id/shopping-list", (req: AuthRequest, res, next) => {
    void service.shoppingList(req.userId!, householdId(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/:id/shopping-list", validateBody(householdShoppingCreateSchema), (req: AuthRequest, res, next) => {
    void service.createShopping(req.userId!, householdId(req), crypto.randomUUID(), req.body)
      .then((value) => res.status(201).json(value)).catch((error) => handle(error, res, next));
  });
  router.patch("/:id/shopping-list/:itemId", validateBody(householdShoppingUpdateSchema), (req: AuthRequest, res, next) => {
    void service.updateShopping(req.userId!, householdId(req), String(req.params.itemId), req.body)
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/:id/shopping-list/:itemId", (req: AuthRequest, res, next) => {
    void service.removeShopping(req.userId!, householdId(req), String(req.params.itemId), Number(req.query.version))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/:id/shopping-list/intake", validateBody(householdShoppingIntakeSchema), (req: AuthRequest, res, next) => {
    void service.intake(req.userId!, householdId(req), crypto.randomUUID(), req.body)
      .then((value) => res.status(value.status).json(value.body)).catch((error) => handle(error, res, next));
  });
  router.get("/:id/inventory", (req: AuthRequest, res, next) => {
    void service.inventory(req.userId!, householdId(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.post("/:id/inventory", (req: AuthRequest, res, next) => {
    void service.createInventory(req.userId!, householdId(req), req.body)
      .then((value) => res.status(201).json(value)).catch((error) => handle(error, res, next));
  });
  router.put("/:id/inventory/:itemId", validateBody(inventoryUpdateSchema), (req: AuthRequest, res, next) => {
    void service.updateInventory(req.userId!, householdId(req), Number(req.params.itemId), req.body)
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.delete("/:id/inventory/:itemId", (req: AuthRequest, res, next) => {
    void service.removeInventory(req.userId!, householdId(req), Number(req.params.itemId), Number(req.query.version))
      .then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  router.get("/:id/history", (req: AuthRequest, res, next) => {
    void service.history(req.userId!, householdId(req)).then((value) => res.json(value)).catch((error) => handle(error, res, next));
  });
  return router;
}
