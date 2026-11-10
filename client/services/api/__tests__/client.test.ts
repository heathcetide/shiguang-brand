jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

import { ApiError, ApiTransportError, requestJson, type ApiFetch } from "../client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import {
  clearApiCacheScope,
  getApiCacheDiagnostics,
  registerApiFetchScope,
  resetApiCacheForTests,
  cachedApiGet,
  apiCachePolicy,
  invalidateApiCacheForMutation,
} from "../cache";

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
} as Response);

describe("API client", () => {
  beforeEach(async () => {
    resetApiCacheForTests();
    await AsyncStorage.clear();
  });

  it("types fetch transport errors without treating HTTP or schema failures as offline", async () => {
    await expect(requestJson(async () => { throw new TypeError("Network request failed"); }, "/voice"))
      .rejects.toBeInstanceOf(ApiTransportError);
    for (const status of [401, 403, 404, 409, 410, 503]) {
      await expect(requestJson(async () => jsonResponse({ error: "server error" }, status), "/voice"))
        .rejects.toBeInstanceOf(ApiError);
    }
    await expect(requestJson(async () => jsonResponse({}), "/voice", {}, z.object({ id: z.string() })))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    const error = new Error("authentication cleanup failed");
    await expect(requestJson(async () => { throw error; }, "/voice")).rejects.toBe(error);
  });

  it("distinguishes request timeout from caller cancellation", async () => {
    jest.useFakeTimers();
    const apiFetch: ApiFetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    try {
      const timeout = requestJson(apiFetch, "/voice", { timeoutMs: 100 });
      const check = expect(timeout).rejects.toBeInstanceOf(ApiTransportError);
      jest.advanceTimersByTime(100);
      await check;
      const caller = new AbortController();
      const cancelled = requestJson(apiFetch, "/voice", { signal: caller.signal });
      const checkCancel = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
      caller.abort();
      await checkCancel;
    } finally { jest.useRealTimers(); }
  });

  it("detects body transport failure after headers while preserving malformed JSON and HTTP errors", async () => {
    const brokenBody = (error: Error, status = 200): Response => ({
      ...jsonResponse({}, status), json: async () => { throw error; },
    });
    await expect(requestJson(async () => brokenBody(new TypeError("connection lost")), "/voice"))
      .rejects.toBeInstanceOf(ApiTransportError);
    await expect(requestJson(async () => brokenBody(new SyntaxError("invalid JSON")), "/voice", {}, z.object({ id: z.string() })))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    await expect(requestJson(async () => brokenBody(new TypeError("connection lost"), 503), "/voice"))
      .rejects.toMatchObject({ status: 503, name: "ApiError" });
  });

  it("detects timeout during body read after headers", async () => {
    jest.useFakeTimers();
    try {
      const apiFetch: ApiFetch = async (_url, init) => ({
        ...jsonResponse({}), json: async () => new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      });
      const request = requestJson(apiFetch, "/voice", { timeoutMs: 100 });
      const check = expect(request).rejects.toBeInstanceOf(ApiTransportError);
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      await check;
    } finally { jest.useRealTimers(); }
  });

  it.each(["write", "logout", "clear-all"])("drains queued persistent snapshots before %s finishes", async action => {
    const apiFetch: ApiFetch = jest.fn();
    registerApiFetchScope(apiFetch, 1401);
    const paths = ["/api/v1/inventory", "/api/v1/diet-records", "/api/v1/health-data", "/api/v1/meal-plans", "/api/v1/cooking-queue"];
    await Promise.all(paths.map(path => cachedApiGet(apiFetch, path, apiCachePolicy(path)!, async () => ({ data: { version: 1 } }))));
    if (action === "write") await invalidateApiCacheForMutation(apiFetch, "/api/v1/diet-records/cooking-completions");
    else await clearApiCacheScope(action === "logout" ? 1401 : undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    const fresh = jest.fn(async () => ({ data: { version: 2 } }));
    for (const path of paths) {
      await expect(cachedApiGet(apiFetch, path, apiCachePolicy(path)!, fresh)).resolves.toEqual({ version: 2 });
    }
    expect(fresh).toHaveBeenCalledTimes(paths.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it.each(["write", "logout", "clear-all"])("does not restore a disk snapshot whose read overlaps %s", async action => {
    let version = 1;
    const apiFetch: ApiFetch = jest.fn(async () => jsonResponse({ version }));
    registerApiFetchScope(apiFetch, 1403);
    await requestJson(apiFetch, "/api/v1/shopping-list");
    await new Promise(resolve => setTimeout(resolve, 0));
    const [key] = await AsyncStorage.getAllKeys();
    const snapshot = await AsyncStorage.getItem(key);
    resetApiCacheForTests();
    let finishRead!: (value: string | null) => void;
    const getItem = jest.mocked(AsyncStorage.getItem);
    const originalGetItem = getItem.getMockImplementation()!;
    getItem.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    try {
      const reading = requestJson(apiFetch, "/api/v1/shopping-list");
      await new Promise(resolve => setTimeout(resolve, 0));
      version = 2;
      if (action === "write") await invalidateApiCacheForMutation(apiFetch, "/api/v1/shopping-list/1");
      else await clearApiCacheScope(action === "logout" ? 1403 : undefined);
      finishRead(snapshot);
      await expect(reading).resolves.toEqual({ version: 2 });
      await expect(requestJson(apiFetch, "/api/v1/shopping-list")).resolves.toEqual({ version: 2 });
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      getItem.mockImplementation(originalGetItem);
    }
  });

  it("invalidates shopping and inventory caches together after atomic intake", async () => {
    let version = 1;
    const apiFetch: ApiFetch = jest.fn(async (_path, init) => {
      if (init?.method === "POST") version = 2;
      return jsonResponse({ version });
    });
    registerApiFetchScope(apiFetch, 42);
    for (const path of ["/api/v1/shopping-list", "/api/v1/inventory"]) {
      expect(await requestJson(apiFetch, path)).toEqual({ version: 1 });
    }
    await requestJson(apiFetch, "/api/v1/inventory/import-shopping-list", { method: "POST", body: "{}" });
    for (const path of ["/api/v1/shopping-list", "/api/v1/inventory"]) {
      expect(await requestJson(apiFetch, path)).toEqual({ version: 2 });
    }
  });

  it('replaces a previously persisted empty community category with newly published posts', async () => {
    const path = '/api/v1/community/posts?category=%E6%A6%9C%E5%8D%95&sort=recommended&pageSize=12';
    const published = {items:[{id:317,category:'榜单',content:'原料项数榜'}],nextCursor:null};
    const apiFetch: ApiFetch = jest.fn(async () => jsonResponse(published));
    await cachedApiGet(apiFetch,path,{ttlMs:600000,maxStaleMs:86400000,persistent:true},async()=>({data:{items:[],nextCursor:null}}));
    await new Promise(resolve=>setTimeout(resolve,0));
    resetApiCacheForTests();
    await expect(requestJson(apiFetch,path)).resolves.toEqual(published);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    await expect(requestJson(apiFetch,path)).resolves.toEqual(published);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["shopping", ["/api/v1/shopping-list"]],
    ["queue", ["/api/v1/cooking-queue"]],
    ["complete", ["/api/v1/diet-records/prepared-meals", "/api/v1/diet-records", "/api/v1/health-data", "/api/v1/inventory", "/api/v1/insights", "/api/v1/cooking-queue"]],
  ])("refreshes related data after meal-plan %s in memory and storage", async (action, relatedPaths) => {
    let version = 1;
    const fetchA: ApiFetch = jest.fn(async (_url, init) => {
      if (init?.method === "POST") { version = 2; return jsonResponse({ success: true }); }
      return jsonResponse({ version });
    });
    const fetchB: ApiFetch = jest.fn(async () => jsonResponse({ version: 1 }));
    registerApiFetchScope(fetchA, 1001);
    registerApiFetchScope(fetchB, 1002);
    const affected = ["/api/v1/meal-plans", ...relatedPaths];
    for (const path of [...affected, "/api/v1/recipes"]) {
      await requestJson(fetchA, path);
      await requestJson(fetchB, path);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    await requestJson(fetchA, `/api/v1/meal-plans/plan/items/item/${action}`, { method: "POST", body: "{}" });
    const persisted = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    for (const [, raw] of persisted) {
      const entry = JSON.parse(raw!);
      expect(entry.scope === "user:1001" && affected.includes(entry.path)).toBe(false);
    }
    for (const path of affected) await expect(requestJson(fetchA, path)).resolves.toEqual({ version: 2 });
    await expect(requestJson(fetchA, "/api/v1/recipes")).resolves.toEqual({ version: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    resetApiCacheForTests();
    for (const path of affected) {
      await expect(requestJson(fetchA, path)).resolves.toEqual({ version: 2 });
      await expect(requestJson(fetchB, path)).resolves.toEqual({ version: 1 });
    }
    const memoryOnly = affected.filter(path => !apiCachePolicy(path)?.persistent).length;
    expect(fetchA).toHaveBeenCalledTimes(affected.length * 2 + 2 + memoryOnly);
    expect(fetchB).toHaveBeenCalledTimes(affected.length + 1 + memoryOnly);
  });

  it.each([
    ["/api/v1/diet-records/cooking-completions", "POST", ["/api/v1/inventory", "/api/v1/cooking-queue", "/api/v1/meal-plans", "/api/v1/diet-records/prepared-meals", "/api/v1/health-data", "/api/v1/insights"]],
    ["/api/v1/insights/inventory-outcomes", "POST", ["/api/v1/inventory", "/api/v1/insights"]],
    ["/api/v1/meal-plans/plan/activate", "POST", ["/api/v1/diet-records/prepared-meals"]],
    ["/api/v1/meal-plans/plan", "PATCH", ["/api/v1/diet-records/prepared-meals"]],
    ["/api/v1/meal-plans/plan", "DELETE", ["/api/v1/diet-records/prepared-meals"]],
    ["/api/v1/cooking-queue/item", "DELETE", ["/api/v1/meal-plans"]],
    ["/api/v1/cooking-queue", "DELETE", ["/api/v1/meal-plans"]],
    ["/api/v1/cooking-queue/item", "PATCH", ["/api/v1/meal-plans"]],
  ])("refreshes related resources after %s %s", async (path, method, affected) => {
    let revision = 1;
    const apiFetch: ApiFetch = jest.fn(async (_url, init) => {
      if (init?.method === method) revision++;
      return jsonResponse({ revision });
    });
    registerApiFetchScope(apiFetch, 1101);
    for (const resource of affected) await requestJson(apiFetch, resource);
    await new Promise(resolve => setTimeout(resolve, 0));
    await requestJson(apiFetch, path, { method, body: "{}" });
    for (const resource of affected) await expect(requestJson(apiFetch, resource)).resolves.toEqual({ revision: 2 });
  });

  it.each(["write", "logout"])("does not reuse an old GET after %s invalidates it", async action => {
    let resolveOld!: (response: Response) => void;
    let gets = 0;
    const apiFetch: ApiFetch = jest.fn(async (_url, init) => {
      if (init?.method === "POST") return jsonResponse({ success: true });
      gets++;
      return gets === 1 ? new Promise(resolve => { resolveOld = resolve; }) : jsonResponse({ revision: 2 });
    });
    registerApiFetchScope(apiFetch, 1201);
    const old = requestJson(apiFetch, "/api/v1/inventory");
    await new Promise(resolve => setTimeout(resolve, 0));
    if (action === "write") await requestJson(apiFetch, "/api/v1/inventory", { method: "POST", body: "{}" });
    else await clearApiCacheScope();
    const fresh = requestJson(apiFetch, "/api/v1/inventory");
    await new Promise(resolve => setTimeout(resolve, 0));
    const getsBeforeOldResponse = gets;
    resolveOld(jsonResponse({ revision: 1 }));
    await old;
    await expect(fresh).resolves.toEqual({ revision: 2 });
    expect(getsBeforeOldResponse).toBe(2);
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ revision: 2 });
  });

  it.each(["no-store", "reload"] as const)("honors %s for confirmation reads even when inventory is cached", async cache => {
    let version = 1;
    const apiFetch: ApiFetch = jest.fn(async () => jsonResponse({ version }));
    registerApiFetchScope(apiFetch, 1301);
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    version = 2;
    await expect(requestJson(apiFetch, "/api/v1/inventory", { cache })).resolves.toEqual({ version: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent identical mutations", async () => {
    let calls = 0;
    let resolveResponse: ((value: Response) => void) | undefined;
    const apiFetch: ApiFetch = jest.fn(async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    });
    const options = { method: "POST", body: JSON.stringify({ food_name: "番茄" }) };

    const first = requestJson<{ id: number }>(apiFetch, "/api/v1/inventory", options);
    const second = requestJson<{ id: number }>(apiFetch, "/api/v1/inventory", options);
    expect(calls).toBe(1);

    resolveResponse?.({
      ok: true,
      status: 201,
      json: async () => ({ id: 42 }),
    } as Response);
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 42 }, { id: 42 }]);
    expect(calls).toBe(1);
  });

  it("never coalesces mutations across authenticated fetch contexts", async () => {
    const firstFetch: ApiFetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ owner: "first" }),
    } as Response));
    const secondFetch: ApiFetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ owner: "second" }),
    } as Response));
    const options = { method: "POST", body: JSON.stringify({ food_name: "番茄" }) };

    await expect(Promise.all([
      requestJson<{ owner: string }>(firstFetch, "/api/v1/inventory", options),
      requestJson<{ owner: string }>(secondFetch, "/api/v1/inventory", options),
    ])).resolves.toEqual([{ owner: "first" }, { owner: "second" }]);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent GETs and reuses the persistent cache", async () => {
    let calls = 0;
    let resolveResponse: ((value: Response) => void) | undefined;
    const apiFetch: ApiFetch = jest.fn(async () => {
      calls += 1;
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    });
    registerApiFetchScope(apiFetch, 101);

    const first = requestJson<{ value: number }>(apiFetch, "/api/v1/shopping-list");
    const second = requestJson<{ value: number }>(apiFetch, "/api/v1/shopping-list");
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveResponse?.(jsonResponse({ value: 1 }));
    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 1 }]);
    expect(calls).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    resetApiCacheForTests();
    await expect(requestJson<{ value: number }>(apiFetch, "/api/v1/shopping-list")).resolves.toEqual({ value: 1 });
    expect(calls).toBe(1);
    expect(getApiCacheDiagnostics().persistentHits).toBe(1);
  });

  it("isolates persisted GET data by user and clears only the selected account", async () => {
    const firstFetch: ApiFetch = jest.fn(async () => jsonResponse({ owner: "first" }));
    const secondFetch: ApiFetch = jest.fn(async () => jsonResponse({ owner: "second" }));
    registerApiFetchScope(firstFetch, 201);
    registerApiFetchScope(secondFetch, 202);

    await expect(Promise.all([
      requestJson(firstFetch, "/api/v1/shopping-list"),
      requestJson(secondFetch, "/api/v1/shopping-list"),
    ])).resolves.toEqual([{ owner: "first" }, { owner: "second" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await clearApiCacheScope(201);
    resetApiCacheForTests();

    await requestJson(firstFetch, "/api/v1/shopping-list");
    await requestJson(secondFetch, "/api/v1/shopping-list");
    expect(firstFetch).toHaveBeenCalledTimes(2);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  it("serves stale data immediately and revalidates it in the background", async () => {
    let now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ version: 2 }));
    registerApiFetchScope(apiFetch, 301);

    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(getApiCacheDiagnostics().staleFallbacks).toBe(1);
    jest.restoreAllMocks();
  });

  it("invalidates only affected resource keys after a successful write", async () => {
    const apiFetch: ApiFetch = jest.fn(async (input, init) => {
      const url = String(input);
      if ((init?.method || "GET") === "POST") return jsonResponse({ id: 1 }, 201);
      if (url.includes("/inventory")) return jsonResponse([{ id: 1 }]);
      return jsonResponse({ items: [{ id: 9 }], nextCursor: null });
    });
    registerApiFetchScope(apiFetch, 401);
    await requestJson(apiFetch, "/api/v1/inventory");
    await requestJson(apiFetch, "/api/v1/recipes?pageSize=10");
    await requestJson(apiFetch, "/api/v1/inventory", { method: "POST", body: "{}" });
    await requestJson(apiFetch, "/api/v1/inventory");
    await requestJson(apiFetch, "/api/v1/recipes?pageSize=10");

    const urls = (apiFetch as jest.Mock).mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes("/inventory"))).toHaveLength(3);
    expect(urls.filter((url) => url.includes("/recipes"))).toHaveLength(1);
  });

  it("does not let an in-flight stale refresh repopulate a cache invalidated by a write", async () => {
    let now = 2_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    let resolveRefresh: ((response: Response) => void) | undefined;
    let getCount = 0;
    const apiFetch: ApiFetch = jest.fn(async (_input, init) => {
      if ((init?.method || "GET") === "POST") return jsonResponse({ id: 1 }, 201);
      getCount += 1;
      if (getCount === 1) return jsonResponse({ version: 1 });
      if (getCount === 2) return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      return jsonResponse({ version: 3 });
    });
    registerApiFetchScope(apiFetch, 501);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 1 });
    await requestJson(apiFetch, "/api/v1/inventory", { method: "POST", body: "{}" });
    resolveRefresh?.(jsonResponse({ version: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ version: 3 });
    jest.restoreAllMocks();
  });

  it("purges a private cache after a background 401 and does not expose it to the next request", async () => {
    let now = 3_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ private: "cached" }))
      .mockResolvedValueOnce(jsonResponse({ error: "expired", code: "TOKEN_EXPIRED" }, 401))
      .mockResolvedValueOnce(jsonResponse({ private: "fresh" }));
    registerApiFetchScope(apiFetch, 601);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 61_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ private: "cached" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetApiCacheForTests();
    await expect(requestJson(apiFetch, "/api/v1/inventory")).resolves.toEqual({ private: "fresh" });
    expect(apiFetch).toHaveBeenCalledTimes(3);
    jest.restoreAllMocks();
  });

  it("refuses cache entries beyond the maximum offline age", async () => {
    let now = 4_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const apiFetch: ApiFetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ version: 1 }))
      .mockRejectedValueOnce(new Error("offline"));
    registerApiFetchScope(apiFetch, 701);
    await requestJson(apiFetch, "/api/v1/inventory");
    now += 8 * 86_400_000;
    await expect(requestJson(apiFetch, "/api/v1/inventory")).rejects.toThrow("offline");
    jest.restoreAllMocks();
  });

  it("rejects malformed runtime responses before they enter the API cache", async () => {
    const apiFetch: ApiFetch = jest.fn(async () => jsonResponse({ id: "not-a-number" }));
    registerApiFetchScope(apiFetch, 801);
    const responseSchema = z.object({ id: z.number() }).strict();

    await expect(requestJson(apiFetch, "/api/v1/inventory", {}, responseSchema)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      status: 0,
    });
    await expect(requestJson(apiFetch, "/api/v1/inventory", {}, responseSchema)).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
  it("refreshes personal plans and intake after household meal mutations without evicting another account",async () => {
    const fetchA: ApiFetch = jest.fn(async () => jsonResponse({ ok: true }));
    const fetchB: ApiFetch = jest.fn(async () => jsonResponse({ ok: true }));
    registerApiFetchScope(fetchA,901); registerApiFetchScope(fetchB,902);
    for (const path of ["/api/v1/meal-plans","/api/v1/diet-records"]) {
      await requestJson(fetchA,path); await requestJson(fetchB,path);
    }
    await requestJson(fetchA,"/api/v1/households/8/meals",{ method: "POST",body: "{}" });
    for (const path of ["/api/v1/meal-plans","/api/v1/diet-records"]) {
      await requestJson(fetchA,path); await requestJson(fetchB,path);
    }
    expect(fetchA).toHaveBeenCalledTimes(5);
    expect(fetchB).toHaveBeenCalledTimes(2);
  });

});
