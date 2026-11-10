import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, optionalAuthMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { sendError } from "../../utils/http.js";
import { recipeSubmissionSchema } from "../../validation/schemas.js";
import { RecipesError } from "./errors.js";
import type { RecipesService } from "./service.js";
import type { Row } from "./types.js";

function handle(error: unknown, res: Response, next: NextFunction) {
  return error instanceof RecipesError
    ? sendError(res, error.status, error.message, error.code || "RECIPE_ERROR")
    : next(error);
}

function origin(req: AuthRequest) { return { protocol: req.protocol, host: req.get("host") }; }

export function createRecipesRouter(service: RecipesService) {
  const router = Router();
  router.param("id", positiveIntegerParam);

  router.get("/", optionalAuthMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.list(req.userId, req.query as unknown as Row, origin(req)).then((value) => {
      res.set("X-Pagination-Candidates", String(value.candidates));
      return res.json(value.body);
    }).catch((error: unknown) => handle(error, res, next));
  });
  router.get("/library-summary", optionalAuthMiddleware, (req: AuthRequest, res, next) => {
    void service.summary(req.userId).then((value) => res.json(value)).catch(next);
  });
  router.get("/mine", authMiddleware, (req: AuthRequest, res, next) => {
    void service.mine(req.userId!, origin(req)).then((value) => res.json(value)).catch(next);
  });
  router.get("/favorites", authMiddleware, (req: AuthRequest, res, next) => {
    void service.favorites(req.userId!, origin(req)).then((value) => res.json(value)).catch(next);
  });
  router.get("/favorites/count", authMiddleware, (req: AuthRequest, res, next) => {
    void service.favoriteCount(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.post("/submissions", authMiddleware, validateBody(recipeSubmissionSchema),
    (req: AuthRequest, res: Response, next: NextFunction) => {
      void service.createSubmission(req.userId!, req.body).then((value) => res.status(201).json(value))
        .catch((error: unknown) => handle(error, res, next));
    });
  router.put("/submissions/:id", authMiddleware, validateBody(recipeSubmissionSchema),
    (req: AuthRequest, res: Response, next: NextFunction) => {
      void service.updateSubmission(req.userId!, Number(req.params.id), req.body).then((value) => res.json(value))
        .catch((error: unknown) => handle(error, res, next));
    });
  router.delete("/submissions/:id", authMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.withdrawSubmission(req.userId!, Number(req.params.id)).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.get("/:id/favorite", authMiddleware, (req: AuthRequest, res, next) => {
    void service.favoriteStatus(req.userId!, Number(req.params.id)).then((value) => res.json(value)).catch(next);
  });
  router.post("/:id/favorite", authMiddleware, (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.addFavorite(req.userId!, Number(req.params.id)).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  router.delete("/:id/favorite", authMiddleware, (req: AuthRequest, res, next) => {
    void service.removeFavorite(req.userId!, Number(req.params.id)).then((value) => res.json(value)).catch(next);
  });
  router.get("/:id", (req: AuthRequest, res: Response, next: NextFunction) => {
    void service.detail(Number(req.params.id), origin(req)).then((value) => res.json(value))
      .catch((error: unknown) => handle(error, res, next));
  });
  return router;
}
