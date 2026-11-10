jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestJson, type ApiFetch } from "../client";
import { apiCachePolicy, cachedApiGet, clearApiCacheScope, maintainApiCache, registerApiFetchScope, resetApiCacheForTests } from "../cache";

const response = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body } as Response);
const disk = async () => AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
let now: number;
beforeEach(async () => {
  await maintainApiCache();
  resetApiCacheForTests();
  await AsyncStorage.clear();
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(async () => { await maintainApiCache(); jest.restoreAllMocks(); });

it.each(["health-data/profile", "health-data", "diet-records", "diet-records/prepared-meals", "inventory", "insights", "meal-plans", "households", "recipes/mine", "recipes/favorites", "recipes/library-summary", "recipes?pageSize=24"])("keeps authenticated %s responses only in memory", async resource => {
  const fetcher: ApiFetch = jest.fn(async () => response({ private: "sensitive" }));
  registerApiFetchScope(fetcher, 1);
  await requestJson(fetcher, `/api/v1/${resource}`);
  await requestJson(fetcher, `/api/v1/${resource}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await maintainApiCache();
  expect(await disk()).toEqual([]);
  resetApiCacheForTests();
  jest.mocked(fetcher).mockRejectedValue(new Error("offline"));
  await expect(requestJson(fetcher, `/api/v1/${resource}`)).rejects.toThrow("offline");
});

it("cannot opt health data into persistence with a caller-supplied policy", async () => {
  const fetcher: ApiFetch = jest.fn();
  registerApiFetchScope(fetcher, 1);
  await cachedApiGet(fetcher, "/api/v1/health-data/profile", { ttlMs: 1000, maxStaleMs: 10000, persistent: true }, async () => ({ data: { private: true } }));
  await maintainApiCache();
  expect(await disk()).toEqual([]);
});

it("removes every legacy query cache without sweeping drafts, shopping lists or pending mutations", async () => {
  const keep = ["@shiyu_shopping_list:user:1", "@pending_manual_diet_v1:user:1", "@recipe-draft:user:1", "offline_cache_other:user:1"];
  await AsyncStorage.multiSet([...keep.map(key => [key, "user work"] as [string, string]),
    ["offline_cache_query_v1:legacy:user:1", "private"], ["offline_cache_query_v2:legacy:user:2", "private"],
    ["offline_cache_query_v3:malformed", "{"],
  ]);
  await maintainApiCache();
  expect((await AsyncStorage.getAllKeys()).sort()).toEqual(keep.sort());
});

it("expires retained data even if never read again, and access does not slide retention", async () => {
  const fetcher: ApiFetch = jest.fn(async () => response(["bread"]));
  registerApiFetchScope(fetcher, 1);
  await requestJson(fetcher, "/api/v1/shopping-list");
  await maintainApiCache();
  const [[key, raw]] = await disk();
  const expiresAt = JSON.parse(raw!).maxStaleAt;
  now += 30_000;
  await requestJson(fetcher, "/api/v1/shopping-list");
  expect(JSON.parse((await AsyncStorage.getItem(key))!).maxStaleAt).toBe(expiresAt);
  now = expiresAt;
  await maintainApiCache();
  expect(await disk()).toEqual([]);
});

it("304 revalidation does not extend the absolute lifetime of the retained body", async () => {
  const fetcher: ApiFetch = jest.fn();
  registerApiFetchScope(fetcher, 1);
  const path = "/api/v1/shopping-list";
  const policy = apiCachePolicy(path)!;
  await cachedApiGet(fetcher, path, policy, async () => ({ data: ["bread"], etag: "v1" }));
  await maintainApiCache();
  const [[key, raw]] = await disk();
  const deadline = JSON.parse(raw!).maxStaleAt;
  now += policy.ttlMs + 1;
  await cachedApiGet(fetcher, path, policy, async () => ({ notModified: true }));
  await maintainApiCache();
  expect(JSON.parse((await AsyncStorage.getItem(key))!).maxStaleAt).toBe(deadline);
  now = deadline;
  await maintainApiCache();
  expect(await disk()).toEqual([]);
  const loader = jest.fn(async () => ({ data: ["fresh"] }));
  await cachedApiGet(fetcher, path, policy, loader);
  expect(loader).toHaveBeenCalledWith(undefined);
});

it("does not recreate a logged-out account from a response delayed behind a disk read", async () => {
  const fetcher: ApiFetch = jest.fn(async () => response({ old: true }));
  registerApiFetchScope(fetcher, 1);
  let finish!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = requestJson(fetcher, "/api/v1/shopping-list");
  await Promise.resolve(); await Promise.resolve();
  await clearApiCacheScope(1);
  finish(null);
  await pending;
  await maintainApiCache();
  expect(await disk()).toEqual([]);
  jest.mocked(fetcher).mockRejectedValue(new Error("offline"));
  await expect(requestJson(fetcher, "/api/v1/shopping-list")).rejects.toThrow("offline");
});


it("does not promote a different logical key with the same storage hash", async () => {
  const fetcher: ApiFetch = jest.fn(async () => response({ first: true }));
  registerApiFetchScope(fetcher);
  await requestJson(fetcher, "/api/v1/recipes?search=9rnw");
  await maintainApiCache();
  resetApiCacheForTests();
  jest.mocked(fetcher).mockResolvedValue(response({ second: true }));
  await expect(requestJson(fetcher, "/api/v1/recipes?search=apba")).resolves.toEqual({ second: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
