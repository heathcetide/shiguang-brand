import React from "react";
import renderer, { act } from "react-test-renderer";
import { useHomeData } from "./useHomeData";
import type { ApiFetch } from "@/services/api";
const mockInventory = jest.fn();
const mockDiet = jest.fn();
const mockHealth = jest.fn();
const mockRender = jest.fn();
jest.mock("@/services/api", () => ({
  recipesApi: { listPage: async () => ({ items: [] }), prefetchCovers: jest.fn() },
  communityApi: { postPage: async () => ({ items: [] }) },
  inventoryApi: { list: (...args: unknown[]) => mockInventory(...args) },
  dietApi: { list: (...args: unknown[]) => mockDiet(...args) },
  healthApi: { list: (...args: unknown[]) => mockHealth(...args) },
}));
jest.mock("@/services/api/cache", () => ({ recordCacheRender: (...args: unknown[]) => mockRender(...args) }));
let current: ReturnType<typeof useHomeData>;
let tree: renderer.ReactTestRenderer;
const accountA: ApiFetch = jest.fn(), accountB: ApiFetch = jest.fn();
function Harness({ fetcher = accountA, today = "2026-09-20", authenticated = true }: { fetcher?: ApiFetch; today?: string; authenticated?: boolean }) {
  const data = useHomeData(fetcher, authenticated, today);
  React.useLayoutEffect(() => { current = data; }, [data]);
  return null;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(async () => {
  jest.clearAllMocks(); mockInventory.mockReset().mockResolvedValue([]); mockHealth.mockReset().mockResolvedValue([]); mockDiet.mockReset().mockResolvedValue([]);
  await act(async () => { tree = renderer.create(<Harness />); });
});
afterEach(async () => { await act(async () => { tree.unmount(); }); jest.restoreAllMocks(); });

test("account changes hide all private sections immediately and ignore the previous response", async () => {
  mockDiet.mockResolvedValueOnce([{ food_name: "A meal" }]);
  mockHealth.mockResolvedValueOnce([{ weight: 60 }]);
  mockInventory.mockResolvedValueOnce([{ id: 1, food_name: "A tomato", expiration_date: "2099-01-01" }]);
  await act(async () => { await current.refresh(); });
  const late = deferred<unknown[]>(); mockDiet.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>; await act(async () => { pending = current.refresh(); });
  await act(async () => { tree.update(<Harness fetcher={accountB} />); });
  expect([current.todayRecords, current.healthLogs, current.inventoryItems, current.expiringItems]).toEqual([[], [], [], []]);
  mockDiet.mockResolvedValueOnce([{ food_name: "B meal" }]);
  await act(async () => { await current.refresh(); });
  await act(async () => { late.resolve([{ food_name: "A late meal" }]); await pending; });
  expect(current.todayRecords[0].food_name).toBe("B meal");
  expect(current.healthLogs).toEqual([]);
});

test("a newer refresh wins even when the older response arrives last", async () => {
  const late = deferred<unknown[]>(); mockDiet.mockReturnValueOnce(late.promise);
  let pending!: Promise<void>; await act(async () => { pending = current.refresh(); });
  mockDiet.mockResolvedValueOnce([{ food_name: "new meal" }]);
  await act(async () => { await current.refresh(); });
  await act(async () => { late.resolve([{ food_name: "old meal" }]); await pending; });
  expect(current.todayRecords[0].food_name).toBe("new meal"); expect(mockRender).toHaveBeenCalledTimes(1);
});

test("old failures cannot clear a newer loading state or show an error", async () => {
  const old = deferred<unknown[]>(), next = deferred<unknown[]>();
  mockDiet.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  let first!: Promise<void>, second!: Promise<void>;
  await act(async () => { first = current.refresh(); second = current.refresh(); });
  await act(async () => { old.reject(new Error("old failure")); await first; });
  expect(current.loading).toBe(true); expect(current.error).toBeNull();
  await act(async () => { next.resolve([]); await second; }); expect(current.loading).toBe(false);
});

test("date changes clear yesterday's records even if today's request fails", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  mockDiet.mockResolvedValueOnce([{ food_name: "yesterday" }]);
  await act(async () => { await current.refresh(); });
  await act(async () => { tree.update(<Harness today="2026-09-21" />); });
  expect(current.todayRecords).toEqual([]);
  mockDiet.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { await current.refresh(); });
  expect(current.todayRecords).toEqual([]); expect(current.error).toContain("饮食记录");
});

test("same-scope partial failures retain successful prior data", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  mockDiet.mockResolvedValueOnce([{ food_name: "saved meal" }]);
  await act(async () => { await current.refresh(); });
  mockDiet.mockRejectedValueOnce(new Error("offline")); mockHealth.mockResolvedValueOnce([{ weight: 61 }]);
  await act(async () => { await current.refresh(); });
  expect(current.todayRecords[0].food_name).toBe("saved meal"); expect(current.healthLogs[0].weight).toBe(61);
});

test("unmounted requests and obsolete refresh callbacks have no effects", async () => {
  const late = deferred<unknown[]>(); mockDiet.mockReturnValueOnce(late.promise);
  const oldRefresh = current.refresh;
  let pending!: Promise<void>; await act(async () => { pending = oldRefresh(); });
  await act(async () => { tree.unmount(); });
  await act(async () => { late.resolve([]); await pending; await oldRefresh(); });
  expect(mockDiet).toHaveBeenCalledTimes(1); expect(mockRender).not.toHaveBeenCalled();
});
