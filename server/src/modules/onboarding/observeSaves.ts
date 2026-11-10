import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import type { OnboardingService } from "./service.js";

/** Record only outcome and anonymous actor; no form values or transcripts enter telemetry. */
export function observeOnboardingSaves(service: Pick<OnboardingService, "get" | "saveFailed">): RequestHandler {
  return (req: AuthRequest, res, next) => {
    if (["POST", "PUT", "PATCH"].includes(req.method) && /^\/api\/v1\/(?:inventory|diet-records|meal-plans|health-data)(?:\/|$)/.test(req.path)) {
      res.once("finish", () => {
        if (!req.userId) return;
        // Completion always queries actual owned business objects. GET remains a recovery path
        // if the process stops after committing the business object but before this observer.
        const operation = res.statusCode >= 200 && res.statusCode < 300
          ? service.get(req.userId)
          : res.statusCode >= 400 ? service.saveFailed(req.userId, randomUUID()) : null;
        void operation?.catch(() => undefined);
      });
    }
    next();
  };
}
