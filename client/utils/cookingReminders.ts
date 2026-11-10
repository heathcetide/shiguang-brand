import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { getCookingQueue } from "./cookingQueue";

export type CookingReminderPreset = {
  key: string;
  label: string;
  detail: string;
  date: Date;
};

function nextClockTime(hour: number, minute: number, now: Date) {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return date;
}

export function getCookingReminderPresets(now: Date = new Date()): CookingReminderPreset[] {
  const inThirtyMinutes = new Date(now.getTime() + 30 * 60 * 1000);
  const lunch = nextClockTime(12, 0, now);
  const dinner = nextClockTime(18, 0, now);
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(10, 0, 0, 0);

  return [
    { key: "30m", label: "30 分钟后", detail: formatCookingReminderTime(inThirtyMinutes, now), date: inThirtyMinutes },
    { key: "lunch", label: lunch.getDate() === now.getDate() ? "今天午餐" : "明天午餐", detail: formatCookingReminderTime(lunch, now), date: lunch },
    { key: "dinner", label: dinner.getDate() === now.getDate() ? "今天晚餐" : "明天晚餐", detail: formatCookingReminderTime(dinner, now), date: dinner },
    { key: "tomorrow", label: "明天上午", detail: formatCookingReminderTime(tomorrowMorning, now), date: tomorrowMorning },
  ];
}

export function formatCookingReminderTime(value: Date | number, now: Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const dayOffset = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const dayLabel = dayOffset === 0 ? "今天" : dayOffset === 1 ? "明天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${dayLabel} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export async function scheduleCookingReminder(input: {
  queueItemId?: string;
  recipeId: number;
  recipeTitle: string;
  userId: number;
  date: Date;
}) {
  if (input.date.getTime() <= Date.now()) throw new Error("提醒时间必须晚于现在");
  if (Platform.OS === "web") return { notificationId: undefined, delivery: "in_app" as const };

  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === "granted" ? existing : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("请先在系统设置中允许通知权限");

  await Notifications.setNotificationCategoryAsync("cooking-reminder", [
    { identifier: "START_COOKING", buttonTitle: "核对并开火" },
  ]);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: "该准备做饭啦",
      body: `【${input.recipeTitle}】已在烹饪队列中，点击开始备料。`,
      sound: "default",
      categoryIdentifier: "cooking-reminder",
      data: {
        type: "cooking_reminder",
        ...(input.queueItemId ? { queueItemId: input.queueItemId } : {}),
        recipeId: input.recipeId,
        userId: input.userId,
        sourceId: `cooking:${input.userId}:${input.queueItemId ?? input.recipeId}:${input.date.getTime()}`,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: input.date,
    },
  });
  return { notificationId, delivery: "device" as const };
}

export async function cancelCookingReminder(notificationId?: string) {
  if (Platform.OS === "web" || !notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
}

export async function cancelCookingQueueRemindersForUser(userId?: number | null) {
  if (Platform.OS === "web" || !userId) return;
  const items = await getCookingQueue(userId);
  await Promise.all(items.map((item) => cancelCookingReminder(item.reminderNotificationId)));
}


/** Keep the prior reminder until the server/local commit succeeds; compensate new scheduling on failure. */
export async function replaceCookingReminder(input: Parameters<typeof scheduleCookingReminder>[0], previousId: string | undefined,
  persist: (scheduled: Awaited<ReturnType<typeof scheduleCookingReminder>>) => Promise<boolean>) {
  const scheduled = await scheduleCookingReminder(input);
  let saved = false;
  try { saved = await persist(scheduled); }
  finally { if (!saved) await cancelCookingReminder(scheduled.notificationId); }
  if (!saved) return null;
  await cancelCookingReminder(previousId);
  return scheduled;
}
