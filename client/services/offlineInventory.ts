import AsyncStorage from "@react-native-async-storage/async-storage";
import { inventoryItemSchema, type InventoryItem } from "@dietdigidose/contracts";
import { z } from "zod";

import { ScopedTaskCoordinator, type ScopedTaskTicket } from "./scopedTaskCoordinator";
import { getPrivateStorageGeneration, getUserStorageKey, isPrivateStorageCurrent, writeUserPrivateStorage } from "@/utils/userStorage";

export const OFFLINE_INVENTORY_KEY = "offline_cache_inventory_v2";
export const INVENTORY_RETENTION_MS = 7 * 86_400_000;
const INVENTORY_CACHE_KEY = /^offline_cache_inventory(?:_v\d+)?(?::user:[1-9]\d*)?$/;
const tasks = new ScopedTaskCoordinator();

// Explicit display/quantity-concurrency allowlist. Never retain photos, batch codes,
// evidence, free-form notes, owner details or future fields from the API response.
const itemSchema = inventoryItemSchema.pick({
  id: true, food_name: true, category: true, quantity: true,
  expiration_date: true, storage_location: true, is_available: true,
  quantity_value: true, quantity_unit: true, package_size_value: true,
  package_size_unit: true, version: true,
});
const snapshotSchema = z.object({
  version: z.literal(2), userId: z.number().int().positive(),
  savedAt: z.number().finite(), expiresAt: z.number().finite(), items: z.array(itemSchema.strict()),
}).strict();

type InventoryTicket = { userId: number; generation: number; task: ScopedTaskTicket };

export function beginInventorySnapshot(userId?: number | null): InventoryTicket | null {
  if (!getUserStorageKey(OFFLINE_INVENTORY_KEY, userId)) return null;
  return { userId: userId!, generation: getPrivateStorageGeneration(userId!), task: tasks.begin(String(userId)) };
}

function isCurrent(ticket: InventoryTicket) {
  return tasks.isCurrent(ticket.task) && isPrivateStorageCurrent(ticket.userId, ticket.generation);
}

function parseSnapshot(raw: string, key: string) {
  const snapshot = snapshotSchema.parse(JSON.parse(raw));
  const now = Date.now();
  if (key !== getUserStorageKey(OFFLINE_INVENTORY_KEY, snapshot.userId)
    || snapshot.savedAt > now || snapshot.expiresAt <= now
    || snapshot.expiresAt > snapshot.savedAt + INVENTORY_RETENTION_MS) return null;
  return snapshot;
}

export async function saveInventorySnapshot(ticket: InventoryTicket | null, items: InventoryItem[]) {
  if (!ticket || !isCurrent(ticket)) return;
  const savedAt = Date.now();
  const snapshot = {
    version: 2, userId: ticket.userId, savedAt, expiresAt: savedAt + INVENTORY_RETENTION_MS,
    items: z.array(itemSchema).parse(items),
  };
  await tasks.commit(ticket.task, async () => {
    if (!isCurrent(ticket) || Date.now() >= snapshot.expiresAt) return;
    await writeUserPrivateStorage(OFFLINE_INVENTORY_KEY, ticket.userId, ticket.generation, JSON.stringify(snapshot));
  });
}

export async function readInventorySnapshot(ticket: InventoryTicket | null): Promise<InventoryItem[] | null> {
  if (!ticket || !isCurrent(ticket)) return null;
  const result = await tasks.commit(ticket.task, async () => {
    if (!isCurrent(ticket)) return null;
    const key = getUserStorageKey(OFFLINE_INVENTORY_KEY, ticket.userId)!;
    const raw = await AsyncStorage.getItem(key);
    if (!isCurrent(ticket) || !raw) return null;
    try {
      const snapshot = parseSnapshot(raw, key);
      if (snapshot) return snapshot.items.map(item => ({ ...item, image_url: null }));
    } catch { /* Invalid or old snapshots are disposable, never user-authored work. */ }
    await AsyncStorage.removeItem(key);
    return null;
  });
  return result.status === "committed" && isCurrent(ticket) ? result.value : null;
}

async function sweepInventorySnapshots() {
  const keys = (await AsyncStorage.getAllKeys()).filter(key => INVENTORY_CACHE_KEY.test(key) || key === "offline_cache_recipes");
  const removals: string[] = [];
  for (const [key, raw] of await AsyncStorage.multiGet(keys)) {
    try {
      if (raw && parseSnapshot(raw, key)) continue;
    } catch { /* Legacy snapshots had no trustworthy retention/account metadata. */ }
    removals.push(key);
  }
  if (removals.length) await AsyncStorage.multiRemove(removals);
}

export function maintainInventorySnapshots() {
  return tasks.commit(tasks.begin("maintenance"), sweepInventorySnapshots);
}

export function clearInventorySnapshots(userId?: number | null) {
  const remove = async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => INVENTORY_CACHE_KEY.test(key)
      && (!userId || key.endsWith(`:user:${userId}`)));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  };
  return userId ? tasks.invalidate(String(userId), remove) : tasks.invalidateAll(remove);
}
