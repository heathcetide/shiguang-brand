jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("new-notification"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
}));

import * as Notifications from "expo-notifications";
import { replaceCookingReminder } from "./cookingReminders";
import { formatCookingReminderTime, getCookingReminderPresets } from "./cookingReminders";

describe("cooking reminders", () => {
  const now = new Date(2026, 7, 23, 17, 45, 0);

  it("builds future reminder presets around the current time", () => {
    const presets = getCookingReminderPresets(now);
    expect(presets).toHaveLength(4);
    expect(presets.every((preset) => preset.date.getTime() > now.getTime())).toBe(true);
    expect(presets.find((preset) => preset.key === "dinner")?.detail).toBe("今天 18:00");
  });

  it("formats today, tomorrow and later dates", () => {
    expect(formatCookingReminderTime(new Date(2026, 7, 23, 20, 5), now)).toBe("今天 20:05");
    expect(formatCookingReminderTime(new Date(2026, 7, 24, 10, 0), now)).toBe("明天 10:00");
    expect(formatCookingReminderTime(new Date(2026, 7, 27, 9, 30), now)).toBe("8月27日 09:30");
  });
});


test("failed reminder persistence compensates only the new notification and retains the old one", async () => {
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
  const input = { recipeId: 8, queueItemId: "task-a", recipeTitle: "同菜谱", userId: 1, date: new Date(Date.now() + 60000) };
  expect(await replaceCookingReminder(input, "old-notification", async () => false)).toBeNull();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("new-notification");
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("old-notification");
  await expect(replaceCookingReminder(input, "old-notification", async () => { throw new Error("disk failure"); })).rejects.toThrow("disk failure");
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("old-notification");
});
test("successful reminders carry task identity and replace the old notification only after persistence", async () => {
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockClear();
  const input = { recipeId: 8, queueItemId: "task-b", recipeTitle: "同菜谱", userId: 1, date: new Date(Date.now() + 60000) };
  const persist = jest.fn(async () => {
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("old-notification");
    return true;
  });
  expect((await replaceCookingReminder(input, "old-notification", persist))?.notificationId).toBe("new-notification");
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("old-notification");
  const request = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.at(-1)[0];
  expect(request.content.data.queueItemId).toBe("task-b");
  expect(request.content.data.sourceId).toBe(`cooking:1:task-b:${input.date.getTime()}`);
});
