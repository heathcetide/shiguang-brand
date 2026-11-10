import AsyncStorage from "@react-native-async-storage/async-storage";

import { getUserStorageKey } from "./userStorage";

export const COOKING_QUEUE_STORAGE_KEY = "@dietdigidose:cooking_queue";
const COOKING_QUEUE_MIGRATION_KEY = "@dietdigidose:cooking_queue_server_migrated";
const MAX_QUEUE_ITEMS = 30;

export type CookingQueueItem = {
  queueItemId?: string;
  recipeId: number;
  title: string;
  imageUrl: string | null;
  cookTime: number | null;
  calories: number;
  difficulty: string;
  addedAt: number;
  ingredients: Array<{ name: string; amount: string }>;
  reminderAt?: number;
  reminderNotificationId?: string;
  shoppingListSyncedAt?: number;
  preparedIngredientNames: string[];
};

export function normalizeCookingQueue(value: unknown): CookingQueueItem[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const recipeId = Number(item.recipeId);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const queueItemId = typeof item.queueItemId === "string" && item.queueItemId.trim() ? item.queueItemId.trim() : undefined;
    const identity = queueItemId ? `queue:${queueItemId}` : `recipe:${recipeId}`;
    if (!Number.isInteger(recipeId) || recipeId <= 0 || !title || seen.has(identity)) return [];
    seen.add(identity);
    const minutes = typeof item.cookTime === "number" || typeof item.cookTime === "string" && item.cookTime.trim() !== "" ? Number(item.cookTime) : NaN;
    return [{
      ...(queueItemId ? { queueItemId } : {}),
      recipeId,
      title,
      imageUrl: typeof item.imageUrl === "string" && item.imageUrl.trim() ? item.imageUrl : null,
      cookTime: Number.isFinite(minutes) && minutes >= 0 ? minutes : null,
      calories: Math.max(0, Number(item.calories) || 0),
      difficulty: typeof item.difficulty === "string" && item.difficulty.trim() ? item.difficulty.trim() : "难度未知",
      addedAt: Number.isFinite(Number(item.addedAt)) ? Number(item.addedAt) : Date.now(),
      ingredients: Array.isArray(item.ingredients)
        ? item.ingredients.flatMap((rawIngredient) => {
          if (!rawIngredient || typeof rawIngredient !== "object") return [];
          const ingredient = rawIngredient as Record<string, unknown>;
          const name = typeof ingredient.name === "string" ? ingredient.name.trim() : "";
          if (!name) return [];
          return [{
            name,
            amount: typeof ingredient.amount === "string" && ingredient.amount.trim()
              ? ingredient.amount.trim()
              : "适量",
          }];
        })
        : [],
      reminderAt: Number.isFinite(Number(item.reminderAt)) && Number(item.reminderAt) > 0
        ? Number(item.reminderAt)
        : undefined,
      reminderNotificationId: typeof item.reminderNotificationId === "string" && item.reminderNotificationId
        ? item.reminderNotificationId
        : undefined,
      shoppingListSyncedAt: Number.isFinite(Number(item.shoppingListSyncedAt)) && Number(item.shoppingListSyncedAt) > 0
        ? Number(item.shoppingListSyncedAt)
        : undefined,
      preparedIngredientNames: Array.isArray(item.preparedIngredientNames)
        ? [...new Set(item.preparedIngredientNames
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean))]
        : [],
    }];
  }).slice(0, MAX_QUEUE_ITEMS);
}

function queueStorageKey(userId?: number | null) {
  return getUserStorageKey(COOKING_QUEUE_STORAGE_KEY, userId);
}

function queueMigrationKey(userId?: number | null) {
  return getUserStorageKey(COOKING_QUEUE_MIGRATION_KEY, userId);
}

export async function needsCookingQueueServerMigration(userId?: number | null) {
  const key = queueMigrationKey(userId);
  return key ? (await AsyncStorage.getItem(key)) !== "1" : false;
}

export async function markCookingQueueServerMigrated(userId?: number | null) {
  const key = queueMigrationKey(userId);
  if (key) await AsyncStorage.setItem(key, "1");
}

export async function getCookingQueue(userId?: number | null) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) return [];
  const saved = await AsyncStorage.getItem(storageKey);
  if (!saved) return [];
  try {
    return normalizeCookingQueue(JSON.parse(saved));
  } catch {
    return [];
  }
}

export async function saveCookingQueue(userId: number, items: CookingQueueItem[]) {
  const storageKey = queueStorageKey(userId);
  if (!storageKey) return [];
  const normalized = normalizeCookingQueue(items);
  await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

/** Legacy recipe-only reminders are recoverable only when the task is unambiguous. */
// ponytail: scan at most 30 queue items; index identities if that cap grows.
export function mergeCookingQueueRuntime<T extends { id: string; recipeId: number; plannedAt: string | null }>(items: T[], localItems: CookingQueueItem[]) {
  return items.map(item => {
    const exact = localItems.find(local => local.queueItemId === item.id);
    const legacy = localItems.filter(local => !local.queueItemId && local.recipeId === item.recipeId);
    const local = exact ?? (items.filter(candidate => candidate.recipeId === item.recipeId).length === 1 && legacy.length === 1 ? legacy[0] : undefined);
    const reminderAt = item.plannedAt ? Date.parse(item.plannedAt) : undefined;
    return { ...item, reminderAt, reminderNotificationId: reminderAt != null && local?.reminderAt === reminderAt ? local.reminderNotificationId : undefined };
  });
}
