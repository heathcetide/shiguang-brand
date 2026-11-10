import { preferenceLearningUpdateSchema, weeklyPlanRequestSchema, replaceCookingPlanItemSchema, mealPlanRequirementsSchema } from "@dietdigidose/contracts";
import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { recipeRecommendationEventSchema, recipeRecommendationSchema } from "../../validation/schemas.js";
import { RecommendationsError } from "./errors.js";
import type { RecommendationsService } from "./service.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof RecommendationsError ? sendError(res, error.status, error.message, error.code) : next(error);
}

export function createRecommendationsRouter(service: RecommendationsService) {
  const router = Router();
  router.use(authMiddleware);
  router.post("/weekly-plan", validateBody(weeklyPlanRequestSchema), (req: AuthRequest,res: Response,next: NextFunction) => {
    void service.weeklyPlan(req.userId!,req.body).then(value => res.json(value)).catch(error => handle(error,res,next));
  });
  router.get("/preferences",(req: AuthRequest,res,next) => { void service.learningState(req.userId!).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.patch("/preferences",validateBody(preferenceLearningUpdateSchema),(req: AuthRequest,res,next) => { void service.updateLearning(req.userId!,req.body).then(value => res.json(value)).catch(error => handle(error,res,next)); });
  router.get("/versions", (_req, res) => res.json(service.versions()));
  router.post("/plan-requirements", validateBody(mealPlanRequirementsSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.planRequirements(req.userId!, req.body).then(value => res.json(value)).catch((error: unknown) => handle(error, res, next));
  });
  router.post("/cooking-plan", validateBody(mealPlanRequirementsSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.cookingPlan(req.userId!, req.body).then(value => res.json(value)).catch((error: unknown) => handle(error, res, next));
  });
  router.post("/cooking-plan/replace", validateBody(replaceCookingPlanItemSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.replaceCookingItem(req.userId!, req.body).then(value => res.json(value)).catch((error: unknown) => handle(error, res, next));
  });
  router.post("/recipes", validateBody(recipeRecommendationSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.page(req.userId!, req.body).then((value) => res.json(value)).catch((error: unknown) => handle(error, res, next));
  });
  router.post("/events", validateBody(recipeRecommendationEventSchema), (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.event(req.userId!, req.body).then((value) => res.status(value.repeated ? 200 : 201).json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  return router;
}
