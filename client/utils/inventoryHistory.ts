import AsyncStorage from "@react-native-async-storage/async-storage";
import { getUserStorageKey } from "./userStorage";

export type InventoryAction = "add" | "consume" | "expire_clear" | "edit";

export interface InventoryLogEntry {
  id: string;
  foodName: string;
  action: InventoryAction;
  quantity: string;
  storageLocation: string;
  timestamp: number;
}

const INVENTORY_HISTORY_STORAGE_KEY = "inventory_history_logs";
const MAX_HISTORY_ENTRIES = 100;

export async function getInventoryHistory(userId?: number): Promise<InventoryLogEntry[]> {
  try {
    const key = getUserStorageKey(INVENTORY_HISTORY_STORAGE_KEY, userId) || INVENTORY_HISTORY_STORAGE_KEY;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is InventoryLogEntry =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as InventoryLogEntry).id === "string" &&
        typeof (entry as InventoryLogEntry).foodName === "string" &&
        typeof (entry as InventoryLogEntry).action === "string"
    );
  } catch {
    return [];
  }
}

export async function addInventoryLog(
  entry: Omit<InventoryLogEntry, "id" | "timestamp">,
  userId?: number
): Promise<InventoryLogEntry[]> {
  try {
    const current = await getInventoryHistory(userId);
    const newEntry: InventoryLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...entry,
    };
    const updated = [newEntry, ...current].slice(0, MAX_HISTORY_ENTRIES);
    const key = getUserStorageKey(INVENTORY_HISTORY_STORAGE_KEY, userId) || INVENTORY_HISTORY_STORAGE_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export async function clearInventoryHistory(userId?: number): Promise<void> {
  try {
    const key = getUserStorageKey(INVENTORY_HISTORY_STORAGE_KEY, userId) || INVENTORY_HISTORY_STORAGE_KEY;
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore storage error
  }
}
