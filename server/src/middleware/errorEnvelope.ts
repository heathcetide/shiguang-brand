import type { NextFunction, Request, Response } from "express";

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

export function errorEnvelope(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (
      res.statusCode >= 400
      && body
      && typeof body === "object"
      && "error" in body
    ) {
      const value = body as Record<string, unknown>;
      body = {
        ...value,
        code: typeof value.code === "string"
          ? value.code
          : (DEFAULT_CODES[res.statusCode] || `HTTP_${res.statusCode}`),
        ...(res.locals.requestId && !value.requestId
          ? { requestId: String(res.locals.requestId) }
          : {}),
      };
    }
    return json(body);
  }) as Response["json"];
  next();
}
