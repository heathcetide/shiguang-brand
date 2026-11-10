jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/services/api", () => ({
  inventoryApi: {
    list: (fetcher: import("@/services/api/client").ApiFetch, fresh = false) =>
      jest.requireActual("@/services/api/client").requestJson(fetcher, "/api/v1/inventory", fresh ? { cache: "no-store" } : {}),
  },
  kitchenwareApi: { list: jest.fn(async () => []), catalog: jest.fn(async () => []) },
  recipesApi: {
    listPage: jest.fn(async () => ({ items: [], nextCursor: null })),
    librarySummary: jest.fn(async () => ({ official: 0, community: 0, personal: 0, favorites: 0 })),
  },
}));

import React from "react";
import renderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activatePrivateStorage, purgeUserPrivateStorage } from "@/utils/userStorage";
import { OFFLINE_INVENTORY_KEY, beginInventorySnapshot, saveInventorySnapshot } from "@/services/offlineInventory";
import { inventoryApi } from "@/services/api";
import { registerApiFetchScope, resetApiCacheForTests } from "@/services/api/cache";
import { buildRecipePageQuery, useInventoryData } from "./useInventoryData";

test("refresh shows remote inventory changes immediately and preserves the latest offline snapshot", async () => {
  resetApiCacheForTests();
  await AsyncStorage.clear();
  let version = 1;
  let offline = false;
  const apiFetch = jest.fn(async (url: string) => {
    if (offline) throw new Error("offline");
    return new Response(JSON.stringify(url.endsWith("/inventory") ? [{
      id: 1, food_name: "番茄", category: "蔬菜", quantity: `${version}个`,
      expiration_date: "2099-09-05", storage_location: "冷藏", image_url: null,
      is_available: true, version,
    }] : []), { status: 200 });
  });
  registerApiFetchScope(apiFetch, 1402);
  await inventoryApi.list(apiFetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let data!: ReturnType<typeof useInventoryData>;
  function Probe() {
    const value = useInventoryData(apiFetch, true, 1402);
    React.useLayoutEffect(() => { data = value; });
    return null;
  }
  let tree!: renderer.ReactTestRenderer;
  try {
    await act(async () => { tree = renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Probe))); });
    version = 2;
    await act(async () => { await data.refresh(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(data.items[0]?.version).toBe(2);
    offline = true;
    await act(async () => { await data.refresh(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(data.items[0]?.version).toBe(2);
    expect(data.sectionErrors.inventory).toContain("离线模式");
  } finally {
    await act(async () => { tree.unmount(); });
    client.clear();
  }
});

describe("recipe catalog pagination query", () => {
  it("keeps server count and pages on the same filter scope", () => {
    const query = buildRecipePageQuery({
      category: "减脂",
      search: "鸡胸肉",
      maxCookTime: 15,
    }, "opaque cursor");
    const params = new URLSearchParams(query.slice(1));

    expect(params.get("pageSize")).toBe("24");
    expect(params.get("category")).toBe("减脂");
    expect(params.get("search")).toBe("鸡胸肉");
    expect(params.get("maxCookTime")).toBe("15");
    expect(params.get("cursor")).toBe("opaque cursor");
  });

  it("omits inactive filters rather than changing the server total scope", () => {
    expect(buildRecipePageQuery({})).toBe("?pageSize=24");
  });
});

jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));

async function mountInventory(fetcher: import("@/services/api/client").ApiFetch, userId: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let data!: ReturnType<typeof useInventoryData>;
  function Probe() {
    const value = useInventoryData(fetcher, true, userId);
    React.useLayoutEffect(() => { data = value; });
    return null;
  }
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Probe))); });
  return { getData: () => data, cleanup: () => { act(() => tree.unmount()); client.clear(); } };
}

test("a production inventory request cannot save a snapshot after logout", async () => {
  activatePrivateStorage(1501);
  let finish!: (value: Response) => void;
  const fetcher = jest.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const mounted = await mountInventory(fetcher, 1501);
  try {
    await purgeUserPrivateStorage(1501);
    await act(async () => {
      finish(new Response(JSON.stringify([{ id: 1, food_name: "番茄", category: "蔬菜", quantity: "2个", expiration_date: "", storage_location: "冷藏", image_url: null, is_available: true, version: 1 }]), { status: 200 }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(await AsyncStorage.getItem(`${OFFLINE_INVENTORY_KEY}:user:1501`)).toBeNull();
  } finally { mounted.cleanup(); }
});

test.each([401, 403])("an inventory %s cannot be masked by the offline snapshot", async status => {
  activatePrivateStorage(1502);
  await saveInventorySnapshot(beginInventorySnapshot(1502), [{ id: 1, food_name: "番茄", category: "蔬菜", quantity: "2个", expiration_date: "", storage_location: "冷藏", image_url: null, is_available: true, version: 1 }]);
  const mounted = await mountInventory(async () => new Response(JSON.stringify({ error: "forbidden" }), { status }), 1502);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mounted.getData().items).toEqual([]);
    expect(mounted.getData().sectionErrors.inventory).not.toContain("离线模式");
  } finally { mounted.cleanup(); }
});
