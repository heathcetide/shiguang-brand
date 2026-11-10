jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(),
    getAllKeys: jest.fn(),
    multiGet: jest.fn(),
    multiRemove: jest.fn(),
  },
}));

jest.mock("expo-file-system", () => ({
  Paths: { cache: { size: 4096 } },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  activatePrivateStorage,
  getPrivateStorageGeneration,
  writeUserPrivateStorage,
  AI_DATA_CONSENT_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SEARCH_HISTORY_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
  getClearableCacheSize,
  getTotalClearableCacheSize,
  isClearableCacheKey,
  purgeClearableCache,
  purgeLegacyUnscopedPrivateStorage,
  purgeUserPrivateStorage,
} from "./userStorage";

describe("user-scoped private storage", () => {
  const mockMultiRemove = AsyncStorage.multiRemove as jest.Mock;
  const mockGetAllKeys = AsyncStorage.getAllKeys as jest.Mock;
  const mockMultiGet = AsyncStorage.multiGet as jest.Mock;

  beforeEach(() => {
    mockMultiRemove.mockReset();
    mockMultiRemove.mockResolvedValue(undefined);
    mockGetAllKeys.mockReset();
    mockMultiGet.mockReset();
  });

  it("clears only recomputable caches for the current user", async () => {
    mockGetAllKeys.mockResolvedValue([
      "offline_cache_recipes",
      "@shiyu_ai_chat_sessions:user:101",
      "@shiyu_ai_chat_sessions:user:202",
      "unrelated_preference",
    ]);
    mockMultiGet.mockResolvedValue([
      ["offline_cache_recipes", "recipes"],
    ]);

    const size = await getClearableCacheSize(101);
    expect(size).toBeGreaterThan(0);
    await purgeClearableCache(101);
    expect(mockMultiRemove).toHaveBeenCalledWith([
      "offline_cache_recipes",
    ]);
  });

  it("keeps durable private data and another account's cache out of clear-cache", () => {
    expect(isClearableCacheKey("offline_cache_recipes", 101)).toBe(true);
    expect(isClearableCacheKey("offline_cache_inventory:user:101", 101)).toBe(true);
    expect(isClearableCacheKey("offline_cache_inventory:user:202", 101)).toBe(false);
    expect(isClearableCacheKey("@shiyu_ai_chat_sessions:user:101", 101)).toBe(false);
    expect(isClearableCacheKey("@shiyu_shopping_list:user:101", 101)).toBe(false);
    expect(isClearableCacheKey("@inventory_scan_job:user:101", 101)).toBe(false);
    expect(isClearableCacheKey("@ai_data_consent_v1:user:101", 101)).toBe(false);
  });

  it("includes the native file cache in the displayed total", async () => {
    mockGetAllKeys.mockResolvedValue([]);
    expect(await getTotalClearableCacheSize(101)).toBe(4096);
  });

  it("uses different storage keys for different users", () => {
    const firstUserKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, 101);
    const secondUserKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, 202);

    expect(firstUserKey).toBe("@shiyu_ai_chat_sessions:user:101");
    expect(secondUserKey).toBe("@shiyu_ai_chat_sessions:user:202");
    expect(firstUserKey).not.toBe(secondUserKey);
    expect(getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, null)).toBeNull();
    expect(getUserStorageKey(AI_DATA_CONSENT_STORAGE_KEY, 101)).toBe("@ai_data_consent_v1:user:101");
  });

  it("removes legacy device-wide private caches", async () => {
    await purgeLegacyUnscopedPrivateStorage();

    expect(mockMultiRemove).toHaveBeenCalledWith([
      CHAT_SESSIONS_STORAGE_KEY,
      SHOPPING_LIST_STORAGE_KEY,
      INVENTORY_SCAN_JOB_STORAGE_KEY,
      SEARCH_HISTORY_STORAGE_KEY,
    ]);
  });

  it("removes all private caches for the logged-out user", async () => {
    mockGetAllKeys.mockResolvedValue([
      "offline_cache_inventory:user:101",
      "@shiyu_shopping_list:user:101",
      "offline_cache_inventory:user:202",
    ]);

    await purgeUserPrivateStorage(101);

    expect(mockMultiRemove).toHaveBeenCalledWith([
      "offline_cache_inventory:user:101",
      "@shiyu_shopping_list:user:101",
    ]);
  });
});


test("logout drains in-flight retry writes and removes both key formats only for that account", async () => {
  activatePrivateStorage(301);
  const generation = getPrivateStorageGeneration(301);
  let finish!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
    "prepared-meal-pending:user:301", "prepared-meal-pending:301", "prepared-meal-pending:user:302", "prepared-meal-pending:302",
  ]);
  const writing = writeUserPrivateStorage("prepared-meal-pending", 301, generation, "private request");
  const purging = purgeUserPrivateStorage(301);
  finish();
  expect(await writing).toBe(false);
  await purging;
  expect(AsyncStorage.multiRemove).toHaveBeenLastCalledWith(["prepared-meal-pending:user:301", "prepared-meal-pending:301"]);
  expect(await writeUserPrivateStorage("prepared-meal-pending", 301, generation, "late request")).toBe(false);
  expect(await writeUserPrivateStorage("prepared-meal-pending", 301, getPrivateStorageGeneration(301), "during logout")).toBe(false);
  activatePrivateStorage(301);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  expect(await writeUserPrivateStorage("prepared-meal-pending", 301, generation, "old session")).toBe(false);
  expect(await writeUserPrivateStorage("prepared-meal-pending", 301, getPrivateStorageGeneration(301), "new session")).toBe(true);
  expect(isClearableCacheKey("prepared-meal-pending:user:301", 301)).toBe(false);
});
