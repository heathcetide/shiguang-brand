import type { NextFunction, Request, Response } from "express";
import { rateLimitsService } from "../modules/rateLimits/index.js";

function normalizeIp(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function requestIdentifier(req: Request) {
  return req.body?.identifier ?? req.body?.username;
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  void rateLimitsService().loginStatus(requestIdentifier(req), normalizeIp(req)).then((status) => {
    if (!status.blocked) return next();
    res.setHeader("Retry-After", status.retryAfterSeconds);
    return res.status(429).json({
      error: "登录尝试过于频繁，请稍后再试", code: "LOGIN_RATE_LIMITED", retryAfterSeconds: status.retryAfterSeconds,
    });
  }).catch(next);
}

export function recordLoginFailure(req: Request) {
  return rateLimitsService().recordLoginFailure(requestIdentifier(req), normalizeIp(req));
}

export function clearLoginFailures(username: unknown) {
  return rateLimitsService().clearLoginFailures(username);
}
