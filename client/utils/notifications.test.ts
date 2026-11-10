const mockStorage = new Map<string, string>();

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStorage.delete(key);
      return Promise.resolve();
    }),
  },
}));

jest.mock("expo-constants", () => ({ expoConfig: null, easConfig: null }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { CALENDAR: "calendar", WEEKLY: "weekly", DATE: "date", DAILY: "daily" },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("scheduled-id")),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("./inventory", () => ({ daysUntilDateKey: jest.fn(() => 1) }));
jest.mock("./cookingReminders", () => ({
  cancelCookingQueueRemindersForUser: jest.fn(() => Promise.resolve()),
}));

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { cancelCookingQueueRemindersForUser } from "./cookingReminders";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  EXPIRING_STOCK_ALERT_IDS_KEY,
  NOTIFICATION_SCHEDULE_IDS_KEY,
  cancelAllLocalNotificationsForUser,
  cancelLegacyUnscopedLocalNotifications,
  getNextExpiringAlertDate,
  scheduleExpiringStockAlerts,
  syncLocalNotificationSchedules,
} from "./notifications";
import { activatePrivateStorage, invalidatePrivateStorage, getUserStorageKey } from "./userStorage";

describe("user-scoped local notifications", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
    Platform.OS = "android";
    activatePrivateStorage(101);
    activatePrivateStorage(202);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: "granted" } as Notifications.NotificationPermissionsStatus);
    let id = 0;
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => `scheduled-${++id}`);
  });

  it("keeps failed legacy IDs for retry without rejecting authentication cleanup", async () => {
    mockStorage.set(NOTIFICATION_SCHEDULE_IDS_KEY, JSON.stringify(["legacy"]));
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockRejectedValueOnce(new Error("native unavailable"));
    await expect(cancelLegacyUnscopedLocalNotifications()).resolves.toBeUndefined();
    expect(JSON.parse(mockStorage.get(NOTIFICATION_SCHEDULE_IDS_KEY)!)).toEqual(["legacy"]);
    await cancelLegacyUnscopedLocalNotifications();
    expect(mockStorage.has(NOTIFICATION_SCHEDULE_IDS_KEY)).toBe(false);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it("waits for known routine IDs to cancel even when native enumeration fails", async () => {
    const key = getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!;
    mockStorage.set(key, JSON.stringify(["known"]));
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockRejectedValue(new Error("enumeration unavailable"));
    let release!: () => void;
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    let completed = false;
    const cleanup = cancelAllLocalNotificationsForUser(101).then(() => { completed = true; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("known");
    expect(completed).toBe(false);
    release(); await cleanup;
    expect(mockStorage.has(key)).toBe(false);
  });

  it("stores routine schedule ids under the current account only", async () => {
    const preferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      meal_reminder: false,
      water_reminder: false,
    };

    await syncLocalNotificationSchedules(preferences, 101);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101),
      "[]",
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 202),
      expect.anything(),
    );
  });

  it("cancels an account's previous expiring alert when the preference is off", async () => {
    const key = getUserStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, 101)!;
    mockStorage.set(key, JSON.stringify(["old-alert"]));

    await scheduleExpiringStockAlerts([], 101, false);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("old-alert");
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockStorage.has(key)).toBe(false);
  });

  it("uses a one-time dated trigger for expiring inventory", async () => {
    const now = new Date(2026, 7, 26, 8, 30);
    await scheduleExpiringStockAlerts([
      { food_name: "菠菜", expiration_date: "2026-08-27", is_available: true },
    ], 101, true, now);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        categoryIdentifier: "inventory-expiring",
        data: expect.objectContaining({ userId: 101 }),
      }),
      trigger: { type: "date", date: new Date(2026, 7, 26, 9, 0) },
    }));
  });

  it("moves the one-time alert to tomorrow after 09:00", () => {
    expect(getNextExpiringAlertDate(new Date(2026, 7, 26, 9, 1)))
      .toEqual(new Date(2026, 7, 27, 9, 0));
  });

  it("cancels routine, inventory, and cooking reminders before account cleanup", async () => {
    mockStorage.set(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!, JSON.stringify(["routine"]));
    mockStorage.set(getUserStorageKey(EXPIRING_STOCK_ALERT_IDS_KEY, 101)!, JSON.stringify(["inventory"]));

    await cancelAllLocalNotificationsForUser(101);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("routine");
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("inventory");
    expect(cancelCookingQueueRemindersForUser).toHaveBeenCalledWith(101);
  });
});


describe("weekly routine compatibility", () => {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, water_reminder: false };
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([]);
    Platform.OS = "android";
    activatePrivateStorage(101);
    activatePrivateStorage(202);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: "granted" } as Notifications.NotificationPermissionsStatus);
    let id = 0;
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => `scheduled-${++id}`);
  });
  it.each(["android", "ios"] as const)("maps all seven weekdays on %s", async platform => {
    Platform.OS = platform;
    await syncLocalNotificationSchedules(preferences, 101);
    const calls = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls;
    expect(calls).toHaveLength(21);
    expect(calls.slice(0, 7).map(([request]) => request.trigger)).toEqual([2, 3, 4, 5, 6, 1, 7].map(weekday => ({
      type: platform === "android" ? "weekly" : "calendar", weekday, hour: 8, minute: 0,
      ...(platform === "ios" ? { repeats: true } : {}),
    })));
  });
  it("filters weekends and respects overnight quiet hours for meals and water", async () => {
    await syncLocalNotificationSchedules({ ...preferences, weekends_enabled: false, breakfast_time: "06:59",
      dinner_time: "22:00", water_reminder: true, water_start_time: "06:00", water_end_time: "08:00", water_interval_minutes: 60 }, 101);
    const triggers = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([request]) => request.trigger);
    expect(triggers).toHaveLength(15);
    expect(triggers).toEqual(expect.arrayContaining([12, 7, 8].flatMap(hour => [2, 3, 4, 5, 6].map(weekday => ({ type: "weekly", weekday, hour, minute: 0 })))));
  });
  it("supports weekend-only schedules and daytime quiet windows", async () => {
    await syncLocalNotificationSchedules({ ...preferences, weekdays_enabled: false, quiet_start_time: "08:00", quiet_end_time: "18:00" }, 101);
    expect(jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([request]) => request.trigger))
      .toEqual([1, 7].map(weekday => ({ type: "weekly", weekday, hour: 18, minute: 0 })));
  });
  it("cancels old reminders but schedules nothing after permission denial", async () => {
    mockStorage.set(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!, '["old"]');
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: "denied" } as Notifications.NotificationPermissionsStatus);
    await syncLocalNotificationSchedules(preferences, 101);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("old");
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it("replaces old schedules, then cancels when disabled without touching another account", async () => {
    const key = getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!;
    mockStorage.set(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 202)!, '["other"]');
    await syncLocalNotificationSchedules(preferences, 101);
    const old: string[] = JSON.parse(mockStorage.get(key)!);
    await syncLocalNotificationSchedules({ ...preferences, breakfast_time: "09:30" }, 101);
    old.forEach(id => expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(id));
    expect(jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[21][0].trigger).toMatchObject({ hour: 9, minute: 30 });
    await syncLocalNotificationSchedules({ ...preferences, meal_reminder: false }, 101);
    expect(mockStorage.get(key)).toBe("[]");
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("other");
  });
  it("rolls back every successful schedule when a later weekday fails", async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValueOnce("first").mockResolvedValueOnce("second").mockRejectedValueOnce(new Error("native schedule failed"));
    await expect(syncLocalNotificationSchedules(preferences, 101)).rejects.toThrow("native schedule failed");
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("first");
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("second");
    expect(mockStorage.has(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!)).toBe(false);
  });
  it("retains failed rollback IDs so disabling reminders retries cancellation", async () => {
    const key = getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!;
    jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValueOnce("first").mockResolvedValueOnce("second").mockRejectedValueOnce(new Error("schedule failed"));
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockRejectedValueOnce(new Error("cancel failed"));
    await expect(syncLocalNotificationSchedules(preferences, 101)).rejects.toThrow("取消失败");
    expect(JSON.parse(mockStorage.get(key)!)).toEqual(["first"]);
    await syncLocalNotificationSchedules({ ...preferences, meal_reminder: false }, 101);
    expect(jest.mocked(Notifications.cancelScheduledNotificationAsync).mock.calls.filter(([id]) => id === "first")).toHaveLength(2);
    expect(mockStorage.get(key)).toBe("[]");
  });
  it("keeps previous IDs when cancellation fails and allows logout to retry", async () => {
    const key = getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!;
    mockStorage.set(key, '["old"]');
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockRejectedValueOnce(new Error("cancel failed"));
    await expect(syncLocalNotificationSchedules(preferences, 101)).rejects.toThrow("取消失败");
    expect(mockStorage.get(key)).toBe('["old"]');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    await cancelAllLocalNotificationsForUser(101);
    expect(mockStorage.has(key)).toBe(false);
    expect(jest.mocked(Notifications.cancelScheduledNotificationAsync).mock.calls.filter(([id]) => id === "old")).toHaveLength(2);
  });
  it.each(["disable", "logout"])("recovers untracked native routine reminders on %s without touching another user", async action => {
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      { identifier: "orphan", content: { data: { type: "routine_reminder", userId: "101" } } },
      { identifier: "other", content: { data: { type: "routine_reminder", userId: "202" } } },
    ] as Notifications.NotificationRequest[]);
    if (action === "disable") await syncLocalNotificationSchedules({ ...preferences, meal_reminder: false }, 101);
    else await cancelAllLocalNotificationsForUser(101);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("orphan");
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("other");
  });
  it("rolls back native schedules if persisting their IDs fails", async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("storage failed"));
    await expect(syncLocalNotificationSchedules(preferences, 101)).rejects.toThrow("storage failed");
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(21);
  });
  it("serializes concurrent edits so only the latest schedule remains", async () => {
    await Promise.all([
      syncLocalNotificationSchedules(preferences, 101),
      syncLocalNotificationSchedules({ ...preferences, meal_reminder: false }, 101),
    ]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(21);
    expect(mockStorage.get(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!)).toBe("[]");
  });
  it("waits for an in-flight native schedule before logout cleanup", async () => {
    let finish!: (id: string) => void;
    let started!: () => void;
    const scheduling = new Promise<void>(resolve => { started = resolve; });
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { finish = resolve; });
    });
    const pending = syncLocalNotificationSchedules(preferences, 101);
    await scheduling;
    invalidatePrivateStorage(101);
    const cleanup = cancelAllLocalNotificationsForUser(101);
    finish("late-id");
    await Promise.all([pending, cleanup]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("late-id");
    expect(mockStorage.has(getUserStorageKey(NOTIFICATION_SCHEDULE_IDS_KEY, 101)!)).toBe(false);
    jest.mocked(Notifications.scheduleNotificationAsync).mockClear();
    await syncLocalNotificationSchedules(preferences, 101);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
  it("waits for every cooking timer cancellation even when one fails", async () => {
    jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockResolvedValue([
      { identifier: "failed-timer", content: { data: { type: "cooking_timer", userId: 101 } } },
      { identifier: "slow-timer", content: { data: { type: "cooking_timer", userId: 101 } } },
    ] as Notifications.NotificationRequest[]);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(id => {
      if (id === "failed-timer") return Promise.reject(new Error("cancel failed"));
      if (id === "slow-timer") {
        started();
        return new Promise<void>(resolve => { release = resolve; });
      }
      return Promise.resolve();
    });
    let settled = false;
    const cleanup = cancelAllLocalNotificationsForUser(101).catch(error => { settled = true; return error; });
    await waiting;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect(await cleanup).toEqual(expect.objectContaining({ message: expect.stringContaining("取消失败") }));
  });

});
