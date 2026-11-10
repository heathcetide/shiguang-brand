import type { NextFunction, Request, Response } from "express";
import { logger, requestLogContext } from "../utils/logger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info("http.request", {
      ...requestLogContext(req, res),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: (req as Request & { userId?: number }).userId,
      ip: req.ip,
    });
  });
  next();
}
