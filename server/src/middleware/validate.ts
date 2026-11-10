import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { sendError } from "../utils/http.js";

export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return sendError(
        res,
        400,
        "请求参数不正确",
        "VALIDATION_ERROR",
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    req.body = result.data;
    next();
  };
}
