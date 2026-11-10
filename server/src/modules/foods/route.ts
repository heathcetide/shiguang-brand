import { Router, type NextFunction, type Request, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { customFoodSchema } from "../../validation/schemas.js";
import { FoodDomainError } from "./errors.js";
import type { FoodService } from "./service.js";

export function createFoodRouter(service: FoodService) {
  const router = Router();
  const anonymousSearchRateLimit = sharedRateLimit({
    namespace: "food-search",
    limit: Math.max(1, Number(process.env.FOOD_SEARCH_RATE_LIMIT) || 60),
    windowMs: 15 * 60 * 1000,
    key: (req) => req.ip || req.socket.remoteAddress || "unknown",
    message: "食品查询过于频繁，请稍后重试",
    code: "FOOD_SEARCH_RATE_LIMITED",
  });

  router.get("/barcode/:barcode", anonymousSearchRateLimit, (req: Request, res: Response, next: NextFunction) => {
    const barcode = String(req.params.barcode || "").trim();
    if (!/^\d{8,14}$/.test(barcode)) return sendError(res, 400, "条码格式无效", "INVALID_BARCODE");
    void service.findByBarcode(barcode)
      .then((food) => food
        ? res.json(food)
        : sendError(res, 404, "食品库暂未收录该条码", "BARCODE_NOT_FOUND"))
      .catch(next);
  });

  router.get("/search", anonymousSearchRateLimit, (req: Request, res: Response) => {
    const query = req.query.query;
    if (!query || typeof query !== "string") return res.status(400).json({ error: "搜索词不能为空" });
    void service.search(query)
      .then((foods) => res.json(foods))
      .catch((error: unknown) => {
        if (error instanceof FoodDomainError) return sendError(res, 400, error.message, error.code);
        console.error("Food search error:", error);
        return res.status(500).json({ error: "搜索失败" });
      });
  });

  router.post("/custom", authMiddleware, validateBody(customFoodSchema), (req: AuthRequest, res: Response) => {
    void service.createCustom(req.userId!, req.body)
      .then((receipt) => res.json(receipt))
      .catch(() => res.status(500).json({ error: "提交自定义食材失败" }));
  });

  return router;
}
