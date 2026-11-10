import { Router, type Router as ExpressRouter } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/adminAuth.js";

export function createAdminRouter(routes: ExpressRouter[]) {
  const router = Router();
  router.use(authMiddleware);
  router.use(requireAdmin);
  for (const child of routes) router.use(child);
  return router;
}
