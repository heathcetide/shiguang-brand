import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

// Only IDs generated here may be used for correlation. Neither an incoming
// header nor a later assignment to res.locals is a trusted diagnostic field.
const requestIds = new WeakMap<Response, string>();
const requestRouters = new WeakMap<Request, string>();

// Pass a code-declared mount template, never req.baseUrl or another input.
export function routerContext(template: string): RequestHandler {
  return (req, _res, next) => {
    requestRouters.set(req, template);
    next();
  };
}

export function requestRouter(req: Request): string {
  return requestRouters.get(req) ?? "[root]";
}

export function serverRequestId(res: Response): string {
  let requestId = requestIds.get(res);
  if (!requestId) {
    requestId = randomUUID();
    requestIds.set(res, requestId);
  }
  res.locals.requestId = requestId;
  if (!res.headersSent) res.setHeader("X-Request-Id", requestId);
  return requestId;
}

export function requestContext(_req: Request, res: Response, next: NextFunction) {
  serverRequestId(res);
  next();
}
