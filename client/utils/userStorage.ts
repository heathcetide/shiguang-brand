import AsyncStorage from "@react-native-async-storage/async-storage";
import { Paths } from "expo-file-system";

export const CHAT_SESSIONS_STORAGE_KEY = "@shiyu_ai_chat_sessions";
export const SHOPPING_LIST_STORAGE_KEY = "@shiyu_shopping_list";
export const INVENTORY_SCAN_JOB_STORAGE_KEY = "@inventory_scan_job";
export const AI_DATA_CONSENT_STORAGE_KEY = "@ai_data_consent_v1";
export const SEARCH_HISTORY_STORAGE_KEY = "@dietdigidose:global-search-history";

const LEGACY_UNSCOPED_PRIVATE_KEYS = [
  CHAT_SESSIONS_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SEARCH_HISTORY_STORAGE_KEY,
];
const CLEARABLE_CACHE_PREFIXES = ["offline_cache_"];
const privateStorageGenerations = new Map<number, number>();
const invalidatedPrivateStorage = new Set<number>();
const privateStorageWrites = new Map<number, Set<Promise<unknown>>>();

export function getPrivateStorageGeneration(userId: number) {
  return privateStorageGenerations.get(userId) ?? 0;
}

export function isPrivateStorageCurrent(userId: number, generation: number) {
  return !invalidatedPrivateStorage.has(userId) && generation === getPrivateStorageGeneration(userId);
}

export function invalidatePrivateStorage(userId?: number | null) {
  if (userId) {
    privateStorageGenerations.set(userId, getPrivateStorageGeneration(userId) + 1);
    invalidatedPrivateStorage.add(userId);
  }
}

export function activatePrivateStorage(userId: number) {
  invalidatedPrivateStorage.delete(userId);
}

/** Persist before sending a mutation; an expired account session cannot leave a retry behind. */
export async function writeUserPrivateStorage(baseKey: string, userId: number, generation: number, value: string) {
  const key = getUserStorageKey(baseKey, userId);
  if (!key || invalidatedPrivateStorage.has(userId) || generation !== getPrivateStorageGeneration(userId)) return false;
  const writes = privateStorageWrites.get(userId) ?? new Set<Promise<unknown>>();
  privateStorageWrites.set(userId, writes);
  const write = AsyncStorage.setItem(key, value);
  writes.add(write);
  try {
    await write;
    return generation === getPrivateStorageGeneration(userId);
  } finally {
    writes.delete(write);
  }
}

export async function removeUserPrivateStorage(baseKey: string, userId: number, generation: number) {
  const key = getUserStorageKey(baseKey, userId);
  if (!key || invalidatedPrivateStorage.has(userId) || generation !== getPrivateStorageGeneration(userId)) return false;
  const writes = privateStorageWrites.get(userId) ?? new Set<Promise<unknown>>();
  privateStorageWrites.set(userId, writes);
  const removal = AsyncStorage.removeItem(key);
  writes.add(removal);
  try {
    await removal;
    return generation === getPrivateStorageGeneration(userId);
  } finally { writes.delete(removal); }
}

export function getUserStorageKey(baseKey: string, userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return null;
  return `${baseKey}:user:${userId}`;
}

/**
 * Older builds stored private data under device-wide keys. Those records cannot
 * be attributed to a user safely, so they must not be migrated into any account.
 */
export async function purgeLegacyUnscopedPrivateStorage() {
  await AsyncStorage.multiRemove(LEGACY_UNSCOPED_PRIVATE_KEYS);
}

export async function purgeUserPrivateStorage(userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return;
  invalidatePrivateStorage(userId);
  await Promise.allSettled([...(privateStorageWrites.get(userId!) ?? [])]);
  const suffix = `:user:${userId}`;
  const keys = await AsyncStorage.getAllKeys();
  const userKeys = keys.filter((key) => key.endsWith(suffix) || key === `prepared-meal-pending:${userId}`);
  if (userKeys.length) await AsyncStorage.multiRemove(userKeys);
}

export function isClearableCacheKey(key: string, userId?: number | null) {
  if (!CLEARABLE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
  const userScopeIndex = key.lastIndexOf(":user:");
  if (userScopeIndex < 0) return true;
  return Number.isInteger(userId) && Number(userId) > 0 && key.endsWith(`:user:${userId}`);
}

const getClearableCacheKeys = async (userId?: number | null) => {
  return (await AsyncStorage.getAllKeys()).filter((key) => isClearableCacheKey(key, userId));
};

export async function purgeClearableCache(userId?: number | null) {
  const keys = await getClearableCacheKeys(userId);
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export async function getClearableCacheSize(userId?: number | null) {
  const keys = await getClearableCacheKeys(userId);
  if (!keys.length) return 0;
  const entries = await AsyncStorage.multiGet(keys);
  return entries.reduce((total, [key, value]) => total + key.length + (value?.length || 0), 0) * 2;
}

export function getNativeFileCacheSize() {
  try {
    return Math.max(0, Number(Paths.cache.size) || 0);
  } catch {
    return 0;
  }
}

export async function getTotalClearableCacheSize(userId?: number | null) {
  return (await getClearableCacheSize(userId)) + getNativeFileCacheSize();
}

export function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
