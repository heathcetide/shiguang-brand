import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { cancelCookingQueueRemindersForUser } from "./cookingReminders";
import { daysUntilDateKey } from "./inventory";
import { getPrivateStorageGeneration, isPrivateStorageCurrent, getUserStorageKey } from "./userStorage";

export type NotificationPreferences = {
  expiring_alert: boolean;
  meal_reminder: boolean;
  water_reminder: boolean;
  breakfast_time: string;
  lunch_time: string;
  dinner_time: string;
  water_start_time: string;
  water_end_time: string;
  water_interval_minutes: number;
  quiet_start_time: string;
  quiet_end_time: string;
  weekdays_enabled: boolean;
  weekends_enabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  expiring_alert: true,
  meal_reminder: true,
  water_reminder: true,
  breakfast_time: "08:00",
  lunch_time: "12:00",
  dinner_time: "18:00",
  water_start_time: "10:00",
  water_end_time: "18:00",
  water_interval_minutes: 120,
  quiet_start_time: "22:00",
  quiet_end_time: "07:00",
  weekdays_enabled: true,
  weekends_enabled: true,
};

export const NOTIFICATION_SCHEDULE_IDS_KEY = "@notification_schedule_ids";
export const EXPIRING_STOCK_ALERT_IDS_KEY = "@expiring_stock_alert_ids";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function getExpoPushToken() {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "默认通知",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  await Notifications.setNotificationCategoryAsync("inventory-expiring", [
    { identifier: "PLAN_RECIPE", buttonTitle: "安排食谱" },
    { identifier: "COMPLETE", buttonTitle: "已处理", options: { opensAppToForeground: false } },
  ]);
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
}

function parseStoredNotificationIds(saved: string | null) {
  if (!saved) return [];
  try {
    const value: unknown = JSON.parse(saved);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  } catch {
    return [];
  }
}

async function clearScheduledNotifications(storageKey: string, additionalIds: string[] = []) {
  const ids = [...new Set([...parseStoredNotificationIds(await AsyncStorage.getItem(storageKey)), ...additionalIds])];
  if (Platform.OS !== "web") {
    const results = await Promise.allSettled(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
    const remaining = ids.filter((_, index) => results[index].status === "rejected");
    if (remaining.length) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(remaining));
      throw new Error("部分本地提醒取消失败，请重试");
    }
  }
  await AsyncStorage.removeItem(storageKey);
}

async function clearRoutineSchedules(userId: number) {
  // Native ownership also recovers IDs lost after a storage failure or account-storage purge.
  const scheduled = Platform.OS === "web" ? [] : await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  const ids = scheduled.filter(item => item.content.data?.type === "routine_reminder"
    && String(item.content.data?.userId) === String(userId)).map(item => item.identifier);
  await clearScheduledNotifications(notificationStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, userId)!, ids);
}

function notificationStorageKey(baseKey: string, userId?: number | null) {
  return getUserStorageKey(baseKey, userId);
}

/** Removes schedules created by older builds because their owner cannot be identified safely. */
export async function cancelLegacyUnscopedLocalNotifications() {
  // Authentication must survive best-effort legacy cleanup; failed IDs remain stored for retry.
  await Promise.allSettled([
    clearScheduledNotifications(NOTIFICATION_SCHEDULE_IDS_KEY),
    clearScheduledNotifications(EXPIRING_STOCK_ALERT_IDS_KEY),
  ]);
}

function timeParts(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return { hour, minute, total: hour * 60 + minute };
}

function isQuietTime(total: number, preferences: NotificationPreferences) {
  const start = timeParts(preferences.quiet_start_time).total;
  const end = timeParts(preferences.quiet_end_time).total;
  if (start === end) return false;
  return start < end ? total >= start && total < end : total >= start || total < end;
}

function enabledWeekdays(preferences: NotificationPreferences) {
  const days: number[] = [];
  if (preferences.weekdays_enabled) days.push(2, 3, 4, 5, 6);
  if (preferences.weekends_enabled) days.push(1, 7);
  return days;
}

async function scheduleWeekly(
  title: string,
  body: string,
  time: string,
  weekdays: number[],
  data: Record<string, string>,
  ids: string[],
) {
  const { hour, minute } = timeParts(time);
  for (const weekday of weekdays) {
    ids.push(await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default", data: { ...data, sourceId: `${data.kind}:${weekday}:${time}` } },
      trigger: Platform.OS === "android"
        ? { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday, hour, minute }
        : { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, repeats: true, weekday, hour, minute },
    }));
  }
}

function minutesToTime(total: number) {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

// Serialize replacement and logout cleanup so an in-flight native schedule cannot escape cancellation.
const routineOperations = new Map<number, Promise<void>>();
function withRoutineSchedules(userId: number, operation: () => Promise<void>) {
  const pending = (routineOperations.get(userId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  routineOperations.set(userId, pending);
  void pending.finally(() => {
    if (routineOperations.get(userId) === pending) routineOperations.delete(userId);
  }).catch(() => undefined);
  return pending;
}

/** Keeps on-device meal and hydration reminders aligned with the saved preferences. */
export async function syncLocalNotificationSchedules(
  preferences: NotificationPreferences,
  userId?: number | null,
) {
  const storageKey = notificationStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, userId);
  if (!storageKey) return;
  const owner = userId!;
  const generation = getPrivateStorageGeneration(owner);
  return withRoutineSchedules(owner, async () => {
    if (!isPrivateStorageCurrent(owner, generation)) return;
    await clearRoutineSchedules(owner);
    if (!preferences.expiring_alert) await cancelExpiringStockAlerts(userId);
    if (Platform.OS === "web" || !Device.isDevice) return;
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted") return;
    const ids: string[] = [];
    const weekdays = enabledWeekdays(preferences);
    try {
      if (preferences.meal_reminder) {
        const meals = [
          ["早餐打卡提醒", "记下早餐，让今天的营养规划有个好开始。", preferences.breakfast_time, "breakfast"],
          ["午餐打卡提醒", "记下这一餐，食光会继续为你安排接下来的饮食。", preferences.lunch_time, "lunch"],
          ["晚餐打卡提醒", "晚餐后花一分钟记录，让今日营养更完整。", preferences.dinner_time, "dinner"],
        ] as const;
        for (const [title, body, time, meal] of meals) {
          if (!isQuietTime(timeParts(time).total, preferences)) {
            await scheduleWeekly(title, body, time, weekdays, {
              type: "routine_reminder",
              kind: "meal",
              meal,
              userId: String(userId),
            }, ids);
          }
        }
      }
      if (preferences.water_reminder) {
        const start = timeParts(preferences.water_start_time).total;
        const end = timeParts(preferences.water_end_time).total;
        for (let total = start; total <= end; total += preferences.water_interval_minutes) {
          if (!isQuietTime(total, preferences)) {
            const time = minutesToTime(total);
            await scheduleWeekly("补充一杯水", "该补充约 250ml 水分了。", time, weekdays, {
              type: "routine_reminder",
              kind: "water",
              userId: String(userId),
            }, ids);
          }
        }
      }
      await AsyncStorage.setItem(storageKey, JSON.stringify(ids));
      if (!isPrivateStorageCurrent(owner, generation)) await clearScheduledNotifications(storageKey);
    } catch (error) {
      await clearScheduledNotifications(storageKey, ids);
      throw error;
    }
  });
}

export async function cancelExpiringStockAlerts(userId?: number | null) {
  const storageKey = notificationStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, userId);
  if (storageKey) await clearScheduledNotifications(storageKey);
}

export function getNextExpiringAlertDate(now: Date = new Date()) {
  const date = new Date(now);
  date.setHours(9, 0, 0, 0);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return date;
}

export async function scheduleExpiringStockAlerts(
  inventoryItems: Array<{ food_name: string; expiration_date: string; is_available: boolean }>,
  userId?: number | null,
  enabled: boolean = true,
  now: Date = new Date(),
) {
  const storageKey = notificationStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, userId);
  if (!storageKey) return;
  await clearScheduledNotifications(storageKey);
  if (Platform.OS === "web" || !Device.isDevice || !enabled) return;

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;

  const urgentItems = inventoryItems.filter((item) => {
    if (!item.is_available) return false;
    const days = daysUntilDateKey(item.expiration_date);
    return days !== null && days >= 0 && days <= 2;
  });

  if (urgentItems.length === 0) return;

  const itemNames = urgentItems.slice(0, 3).map((i) => i.food_name).join("、");
  const title = "冰箱临期食用提醒";
  const body = `你有【${itemNames}】等 ${urgentItems.length} 种食材将在 1-2 天内到期，建议今天优先烹饪！`;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      categoryIdentifier: "inventory-expiring",
      data: {
        type: "inventory_expiring",
        userId,
        sourceId: `inventory:${userId}:${urgentItems.map((item) => item.expiration_date).sort()[0]}`,
      },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: getNextExpiringAlertDate(now) },
  });
  await AsyncStorage.setItem(storageKey, JSON.stringify([id]));
}

export async function cancelAllLocalNotificationsForUser(userId?: number | null) {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return;
  const results = await Promise.allSettled([
    withRoutineSchedules(userId!, () => clearRoutineSchedules(userId!)),
    clearScheduledNotifications(notificationStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, userId)!),
    cancelCookingQueueRemindersForUser(userId),
    Platform.OS === "web" ? Promise.resolve() : Notifications.getAllScheduledNotificationsAsync().catch(() => []).then(async items => {
      const cancellations = await Promise.allSettled(items.filter(item => item.content.data?.type === "cooking_timer" && item.content.data?.userId === userId)
        .map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
      if (cancellations.some(result => result.status === "rejected")) throw new Error("部分本地提醒取消失败，请重试");
    }),
  ]);
  // Wait for every stored-ID cancellation before callers purge account storage.
  if (results.some(result => result.status === "rejected")) throw new Error("部分本地提醒取消失败，请重试");
}
