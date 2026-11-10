import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCallSites } from "node:util";
import type { Request, Response } from "express";
import { requestRouter, serverRequestId } from "../middleware/requestContext.js";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(entry);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};

const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"]);
const diagnosticCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "SQLITE_BUSY", "SQLITE_CONSTRAINT"]);
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

export function requestLogContext(req: Request, res: Response) {
  // Express's declared, router-local template is code, unlike originalUrl,
  // baseUrl, path, params, query and body. Do not fall back to any of those.
  const route: unknown = req.route?.path;
  return {
    requestId: serverRequestId(res),
    method: methods.has(req.method) ? req.method : "OTHER",
    router: requestRouter(req),
    route: typeof route === "string" ? route : "[unmatched]",
  };
}

function diagnosticCode(error: unknown): string {
  // Do not invoke getters, toString, toJSON, or traverse causes/nested data.
  try {
    if (typeof error === "object" && error !== null) {
      const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && diagnosticCodes.has(code)) return code;
    }
  } catch { /* Even a hostile Proxy must not break the error handler. */ }
  return "UNHANDLED_EXCEPTION";
}

function reportingLocations() {
  // Capture our own reporting boundary, NOT error.stack: arbitrary exception
  // text can forge a plausible filename/frame. Omit names and absolute paths.
  return getCallSites(12).flatMap((frame) => {
    const script = frame.scriptName.startsWith("file:") ? fileURLToPath(frame.scriptName) : frame.scriptName;
    if (!path.isAbsolute(script)) return [];
    const file = path.relative(sourceRoot, script).replaceAll("\\", "/");
    if (file.startsWith("../") || path.isAbsolute(file) || !/\.(?:ts|m?js)$/.test(file)) return [];
    return [{ file, line: frame.lineNumber, column: frame.columnNumber }];
  }).slice(0, 5);
}

async function deliverErrorEvent(webhookUrl: string, entry: string, requestId: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: entry,
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    // Never read or log a remote response body or status text.
    await response.body?.cancel();
    if (!response.ok) throw new Error("delivery_failed");
  } catch {
    logger.warn("error_monitor.delivery_failed", {
      requestId,
      code: "ERROR_MONITOR_DELIVERY_FAILED",
    });
  }
}

export function reportError(error: unknown, req: Request, res: Response) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: "error",
    event: "api.unhandled_error",
    ...requestLogContext(req, res),
    code: "INTERNAL_ERROR",
    diagnosticCode: diagnosticCode(error),
    reportingLocations: reportingLocations(),
  };
  // Serialize once: console and the webhook receive exactly the same event.
  // Unknown messages, stacks, headers, and objects are never serialized.
  const entry = JSON.stringify(payload);
  console.error(entry);
  const webhookUrl = process.env.ERROR_MONITOR_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    // Also contain a logging failure: this fire-and-forget path must never
    // create an unhandled rejection or replace the original HTTP response.
    void deliverErrorEvent(webhookUrl, entry, payload.requestId).catch(() => {});
  }
}
