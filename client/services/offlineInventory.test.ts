jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { activatePrivateStorage, purgeUserPrivateStorage } from "@/utils/userStorage";
import { beginInventorySnapshot, clearInventorySnapshots, INVENTORY_RETENTION_MS, maintainInventorySnapshots, OFFLINE_INVENTORY_KEY, readInventorySnapshot, saveInventorySnapshot } from "./offlineInventory";

const items = [{ id: 1, food_name: "番茄", category: "蔬菜", quantity: "2个", expiration_date: "2099-09-05", storage_location: "冷藏" as const, image_url: "data:image/private", is_available: true, version: 3, batch_code: "private batch", quantity_value: 2, quantity_unit: "piece" as const, unexpected: "medical note" }];
const key = `${OFFLINE_INVENTORY_KEY}:user:1`;
let now: number;
beforeEach(async () => {
  await clearInventorySnapshots();
  await AsyncStorage.clear();
  activatePrivateStorage(1); activatePrivateStorage(2);
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { jest.restoreAllMocks(); });

it("stores only display and quantity/version fields, retaining an account-scoped offline snapshot", async () => {
  const ticket = beginInventorySnapshot(1);
  await saveInventorySnapshot(ticket, items);
  const raw = (await AsyncStorage.getItem(key))!;
  expect(raw).not.toMatch(/private|medical|image_url|batch_code|unexpected/);
  const result = await readInventorySnapshot(ticket);
  expect(result?.[0]).toEqual({ id: 1, food_name: "番茄", category: "蔬菜", quantity: "2个", expiration_date: "2099-09-05", storage_location: "冷藏", image_url: null, is_available: true, version: 3, quantity_value: 2, quantity_unit: "piece" });
  expect(await readInventorySnapshot(beginInventorySnapshot(2))).toBeNull();
});

it("expires without being read and never extends retention on access", async () => {
  const ticket = beginInventorySnapshot(1);
  await saveInventorySnapshot(ticket, items);
  const original = await AsyncStorage.getItem(key);
  now += INVENTORY_RETENTION_MS - 1;
  expect(await readInventorySnapshot(ticket)).not.toBeNull();
  expect(await AsyncStorage.getItem(key)).toBe(original);
  now += 1;
  await maintainInventorySnapshots();
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(await readInventorySnapshot(ticket)).toBeNull();
});

it("removes legacy, unscoped, malformed and future-dated snapshots while preserving pending work", async () => {
  const keep = ["@shiyu_shopping_list:user:1", "@pending_manual_diet_v1:user:1", "@draft:user:1", "offline_cache_unrelated:user:1"];
  await AsyncStorage.multiSet([...keep.map(k => [k, "work"] as [string, string]),
    ["offline_cache_inventory", JSON.stringify(items)], ["offline_cache_inventory:user:1", JSON.stringify(items)],
    ["offline_cache_inventory:user:2", JSON.stringify(items)], ["offline_cache_recipes", "unscoped authenticated results"],
    [key, JSON.stringify({ version: 2, userId: 1, savedAt: now + 1, expiresAt: now + INVENTORY_RETENTION_MS, items: [] })],
  ]);
  await maintainInventorySnapshots();
  expect((await AsyncStorage.getAllKeys()).sort()).toEqual(keep.sort());
});

it("rejects a snapshot stored under another account's key", async () => {
  await saveInventorySnapshot(beginInventorySnapshot(1), items);
  await AsyncStorage.setItem(`${OFFLINE_INVENTORY_KEY}:user:2`, (await AsyncStorage.getItem(key))!);
  expect(await readInventorySnapshot(beginInventorySnapshot(2))).toBeNull();
});

it("does not let an old response overwrite a new session for the same account", async () => {
  const old = beginInventorySnapshot(1);
  await purgeUserPrivateStorage(1);
  activatePrivateStorage(1);
  const current = beginInventorySnapshot(1);
  await saveInventorySnapshot(current, [{ ...items[0], version: 4 }]);
  await saveInventorySnapshot(old, items);
  expect((await readInventorySnapshot(current))?.[0].version).toBe(4);
  expect(await readInventorySnapshot(old)).toBeNull();
});

it.each(["logout", "clear-cache"])("drains an in-flight snapshot write before %s completes", async action => {
  const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  let finish!: () => void;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce((k, value) => new Promise(resolve => {
    finish = () => { void originalSet(k, value).then(resolve); };
  }));
  const ticket = beginInventorySnapshot(1);
  const writing = saveInventorySnapshot(ticket, items);
  await Promise.resolve(); await Promise.resolve();
  const clearing = action === "logout" ? purgeUserPrivateStorage(1) : clearInventorySnapshots(1);
  finish();
  await Promise.all([writing, clearing]);
  await saveInventorySnapshot(ticket, items);
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

it("ignores a disk read that completes after logout", async () => {
  const ticket = beginInventorySnapshot(1);
  await saveInventorySnapshot(ticket, items);
  const raw = await AsyncStorage.getItem(key);
  let finish!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const reading = readInventorySnapshot(ticket);
  await Promise.resolve(); await Promise.resolve();
  await purgeUserPrivateStorage(1);
  finish(raw);
  expect(await reading).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBeNull();
});
