import type { NextFunction, Request, Response } from "express";
import { hashRateLimitKey, rateLimitsService } from "../modules/rateLimits/index.js";

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  key: (req: Request) => string;
  message: string;
  code: string;
};

export { hashRateLimitKey };

export function getRateLimitClientIp(req: Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown").trim() || "unknown";
}

export function sharedRateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    void rateLimitsService().consume(options.namespace, options.key(req), options.limit, options.windowMs).then((status) => {
      if (!status.blocked) return next();
      res.setHeader("Retry-After", status.retryAfterSeconds);
      return res.status(429).json({ error: options.message, code: options.code, retryAfterSeconds: status.retryAfterSeconds });
    }).catch(next);
  };
}
