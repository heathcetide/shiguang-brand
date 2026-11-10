import type { RequestParamHandler } from "express";
import { sendError } from "../utils/http.js";

export const positiveIntegerParam: RequestParamHandler = (_req, res, next, value, name) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return void sendError(res, 400, `${name} 必须是正整数`, "INVALID_RESOURCE_ID");
  }
  next();
};

export const uuidParam: RequestParamHandler = (_req, res, next, value, name) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return void sendError(res, 400, `${name} 格式不正确`, "INVALID_RESOURCE_ID");
  }
  next();
};
