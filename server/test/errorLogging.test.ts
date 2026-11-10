import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test, { type TestContext } from "node:test";
import express, { type Request, type Response } from "express";
import { requestContext, routerContext } from "../src/middleware/requestContext.js";
import { requestLogger } from "../src/middleware/requestLogger.js";
import { errorHandler } from "../src/utils/http.js";
import { reportError } from "../src/utils/logger.js";

const token = "sk-fake-token-DO-NOT-LOG";
const phone = "13800138000";
const health = "private-diagnosis-and-medication";
const secret = `${token} ${phone} ${health}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function capture(t: TestContext, configured = true) {
  const entries: string[] = [];
  const requests: RequestInit[] = [];
  for (const method of ["error", "warn", "log"] as const) {
    t.mock.method(console, method, (entry: string) => entries.push(entry));
  }
  const original = process.env.ERROR_MONITOR_WEBHOOK_URL;
  if (configured) process.env.ERROR_MONITOR_WEBHOOK_URL = "https://monitor.invalid/events";
  else delete process.env.ERROR_MONITOR_WEBHOOK_URL;
  t.after(() => {
    if (original === undefined) delete process.env.ERROR_MONITOR_WEBHOOK_URL;
    else process.env.ERROR_MONITOR_WEBHOOK_URL = original;
  });
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return new globalThis.Response(null, { status: 204 });
  });
  return { entries, requests };
}

function context() {
  const headers: Record<string, string> = {};
  const req = {
    method: "POST", originalUrl: `/api/v1/health/${token}?phone=${phone}&notes=${health}`,
    path: `/${token}`, baseUrl: `/${phone}`, params: { id: secret }, query: { notes: secret },
    body: { health: secret }, headers: { authorization: `Bearer ${token}`, "x-request-id": secret },
    route: { path: "/:id" }, get: () => secret,
  } as unknown as Request;
  const res = {
    locals: { requestId: secret }, headersSent: false,
    setHeader(name: string, value: string) { headers[name] = value; },
  } as unknown as Response;
  return { req, res, headers };
}

function assertPrivate(entries: string[], requests: RequestInit[]) {
  for (const output of [...entries, ...requests.map((entry) => String(entry.body))]) {
    for (const value of [token, phone, health, "Bearer", "authorization"]) assert.ok(!output.includes(value), output);
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("one allowlisted event is reused verbatim for console and webhook", async (t) => {
  const { entries, requests } = capture(t);
  const { req, res, headers } = context();
  requestContext(req, res, () => {});
  const expectedId = res.locals.requestId;
  res.locals.requestId = secret;
  const error = Object.assign(new Error(secret), { cause: { body: secret }, detail: { token }, code: secret });
  error.stack = `Error: ${secret}\n    at ${health} (/server/src/${token}.ts:123:4)\n    at fake (/server/src/utils/http.ts:35:3)`;
  reportError(error, req, res);
  await flush();
  assert.equal(entries.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, entries[0]);
  assert.equal(requests[0].redirect, "error");
  const event = JSON.parse(entries[0]);
  assert.equal(event.event, "api.unhandled_error");
  assert.equal(event.code, "INTERNAL_ERROR");
  assert.equal(event.diagnosticCode, "UNHANDLED_EXCEPTION");
  assert.equal(event.route, "/:id");
  assert.equal(event.requestId, expectedId);
  assert.equal(event.requestId, headers["X-Request-Id"]);
  assert.match(event.requestId, uuid);
  assert.ok(event.reportingLocations.some((location: { file: string }) => location.file === "utils/logger.ts"));
  for (const location of event.reportingLocations) {
    assert.deepEqual(Object.keys(location).sort(), ["column", "file", "line"]);
    assert.ok(!location.file.startsWith("/") && !location.file.startsWith(".."));
    assert.ok(Number.isInteger(location.line) && Number.isInteger(location.column));
  }
  assert.equal("message" in event, false);
  assert.equal("stack" in event, false);
  assertPrivate(entries, requests);
});

test("unknown thrown values and hostile properties cannot be serialized or invoked", async (t) => {
  const { entries, requests } = capture(t);
  const hostile = Object.create(null);
  for (const key of ["code", "name", "message", "stack", "cause", "toString", "toJSON"]) {
    Object.defineProperty(hostile, key, { get() { throw new Error(secret); } });
  }
  for (const error of [secret, null, undefined, Symbol(secret), 13800138000, { nested: { health: secret } }, hostile,
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(secret); } })]) {
    const { req, res } = context();
    reportError(error, req, res);
  }
  await flush();
  assert.equal(entries.length, 8);
  assert.equal(requests.length, 8);
  assert.ok(entries.every((entry) => JSON.parse(entry).diagnosticCode === "UNHANDLED_EXCEPTION"));
  assertPrivate(entries, requests);
});

test("only exact known diagnostic codes are retained", async (t) => {
  const { entries, requests } = capture(t);
  for (const code of ["ECONNRESET", "SQLITE_BUSY", "ECONNRESET " + secret, { token }, "PATIENT_DIAGNOSIS"]) {
    const { req, res } = context();
    reportError(Object.assign(new Error(secret), { code }), req, res);
  }
  await flush();
  assert.deepEqual(entries.map((entry) => JSON.parse(entry).diagnosticCode), ["ECONNRESET", "SQLITE_BUSY", "UNHANDLED_EXCEPTION", "UNHANDLED_EXCEPTION", "UNHANDLED_EXCEPTION"]);
  assertPrivate(entries, requests);
});

test("requests without a matched string template never fall back to raw paths", async (t) => {
  const { entries, requests } = capture(t);
  for (const route of [undefined, { path: new RegExp(token) }, { path: ["/one", "/two"] }]) {
    const { req, res } = context();
    req.route = route;
    req.method = secret;
    reportError(new Error(secret), req, res);
  }
  await flush();
  assert.ok(entries.every((entry) => JSON.parse(entry).route === "[unmatched]" && JSON.parse(entry).method === "OTHER"));
  assertPrivate(entries, requests);
});

test("incoming IDs, including plausible UUIDs, never become the server correlation ID", (t) => {
  capture(t, false);
  const ids = new Set<string>();
  for (const incoming of [secret, "b0352602-6160-4e99-a074-32177b6c9156", "short", "a".repeat(10000)]) {
    const { req, res, headers } = context();
    req.get = (() => incoming) as unknown as Request["get"];
    requestContext(req, res, () => {});
    assert.notEqual(res.locals.requestId, incoming);
    assert.equal(res.locals.requestId, headers["X-Request-Id"]);
    assert.match(res.locals.requestId, uuid);
    ids.add(res.locals.requestId);
  }
  assert.equal(ids.size, 4);
});

test("unconfigured webhook emits only the safe console event", async (t) => {
  const { entries, requests } = capture(t, false);
  const { req, res } = context();
  reportError(new Error(secret), req, res);
  await flush();
  assert.equal(entries.length, 1);
  assert.equal(requests.length, 0);
  assertPrivate(entries, requests);
});

for (const mode of ["reject", "sync throw", "timeout", "http failure"] as const) {
  test(`webhook ${mode} retains correlation without leaking either error`, async (t) => {
    const { entries, requests } = capture(t);
    process.env.ERROR_MONITOR_WEBHOOK_URL = `https://monitor.invalid/${token}?phone=${phone}&notes=${health}`;
    const controller = new AbortController();
    if (mode === "timeout") {
      t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.equal(milliseconds, 3000);
        return controller.signal;
      });
    }
    t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => {
      requests.push(init);
      if (mode === "sync throw") throw new Error(secret);
      if (mode === "reject") return Promise.reject({ nested: { secret }, toString: () => secret });
      if (mode === "http failure") return Promise.resolve(new globalThis.Response(secret, { status: 503, statusText: secret }));
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error(secret))));
    });
    const { req, res } = context();
    reportError(new Error(secret), req, res);
    if (mode === "timeout") controller.abort();
    await flush();
    assert.equal(entries.length, 2);
    const event = JSON.parse(entries[0]);
    const warning = JSON.parse(entries[1]);
    assert.deepEqual(Object.keys(warning).sort(), ["code", "event", "level", "requestId", "timestamp"]);
    assert.equal(warning.event, "error_monitor.delivery_failed");
    assert.equal(warning.code, "ERROR_MONITOR_DELIVERY_FAILED");
    assert.equal(warning.requestId, event.requestId);
    assertPrivate(entries, requests);
  });
}

test("generic HTTP failures keep response, access log, console and webhook correlated and private", async (t) => {
  const { entries, requests } = capture(t);
  const app = express();
  app.use(requestContext, requestLogger, express.json());
  const router = express.Router();
  router.post("/records/:id", (_req, _res, next) => next(Object.assign(new Error(secret), { cause: { secret } })));
  app.use("/tenants/:tenant", routerContext("/tenants/:tenant"), router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: address.port, method: "POST",
      path: `/tenants/${token}/records/${phone}?notes=${health}`,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-request-id": secret },
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    });
    request.on("error", reject);
    request.end(JSON.stringify({ notes: secret }));
  });
  await flush();
  assert.equal(result.status, 500);
  const body = JSON.parse(result.body);
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.equal(body.requestId, result.headers["x-request-id"]);
  assert.match(body.requestId, uuid);
  assert.equal(requests.length, 1);
  for (const event of entries.map((entry) => JSON.parse(entry))) {
    assert.equal(event.requestId, body.requestId);
    assert.equal(event.route, "/records/:id");
    assert.equal(event.router, "/tenants/:tenant");
  }
  assert.ok(entries.some((entry) => JSON.parse(entry).event === "http.request"));
  assertPrivate([...entries, result.body], requests);
});


test("already-sent responses still report safely without writing headers", async (t) => {
  const { entries, requests } = capture(t);
  const { req, res } = context();
  res.headersSent = true;
  res.setHeader = () => { throw new Error("must not write headers"); };
  assert.equal(errorHandler(new Error(secret), req, res, () => {}), undefined);
  await flush();
  assert.equal(entries.length, 1);
  assert.equal(requests.length, 1);
  assertPrivate(entries, requests);
});

test("a failing warning sink cannot create an unhandled webhook rejection", async (t) => {
  const { entries, requests } = capture(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error(secret); });
  t.mock.method(console, "warn", () => { throw new Error(secret); });
  const { req, res } = context();
  reportError(new Error(secret), req, res);
  await flush();
  assert.equal(entries.length, 1);
  assertPrivate(entries, requests);
});


test("identical local routes retain code-controlled subsystem attribution", async (t) => {
  const { entries, requests } = capture(t);
  const app = express();
  app.use(requestContext);
  for (const template of ["/api/v1/inventory", "/api/v1/health-data"]) {
    const router = express.Router();
    router.get("/", (_req, _res, next) => next(new Error(secret)));
    app.use(template, routerContext(template), router);
  }
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const template of ["/api/v1/inventory", "/api/v1/health-data"]) {
    await new Promise<void>((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: address.port, path: `${template}/?token=${token}` }, (response) => {
        assert.equal(response.statusCode, 500);
        response.resume();
        response.on("end", resolve);
      }).on("error", reject);
    });
  }
  await flush();
  assert.deepEqual(entries.map((entry) => {
    const event = JSON.parse(entry);
    return { router: event.router, route: event.route };
  }), [{ router: "/api/v1/inventory", route: "/" }, { router: "/api/v1/health-data", route: "/" }]);
  assertPrivate(entries, requests);
});
