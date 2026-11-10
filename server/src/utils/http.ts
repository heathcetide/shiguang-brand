import type { NextFunction, Request, Response } from "express";
import { reportError } from "./logger.js";

export type ApiErrorBody = {
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
};

export function sendError(
  res: Response,
  status: number,
  error: string,
  code: string,
  details?: unknown,
) {
  const body: ApiErrorBody = {
    error,
    code,
    ...(details === undefined ? {} : { details }),
    ...(res.locals.requestId ? { requestId: String(res.locals.requestId) } : {}),
  };
  return res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response) {
  return sendError(res, 404, "接口不存在", "NOT_FOUND", {
    method: req.method,
    path: req.path,
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  reportError(error, req, res);
  if (res.headersSent) return;
  return sendError(res, 500, "服务器内部错误", "INTERNAL_ERROR");
}
