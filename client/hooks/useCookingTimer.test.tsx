import React, { useEffect } from "react";
import renderer, { act } from "react-test-renderer";
const mockStore = new Map<string, string>();
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
} }));
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "timer"),
}));
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { invalidatePrivateStorage } from "@/utils/userStorage";
import { useCookingTimer } from "./useCookingTimer";
let hook!: ReturnType<typeof useCookingTimer>;
function Harness({ user = 801, task = "queue:1" }: { user?: number; task?: string }) {
  const value = useCookingTimer(user, task, 180);
  useEffect(() => { hook = value; }); return null;
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100000); mockStore.clear(); jest.clearAllMocks(); });
afterEach(() => { jest.useRealTimers(); });
test("task countdown restores real time and one system reminder, pauses cancel it", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness />); });
  await act(async () => { hook.setIsTimerRunning(true); });
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(hook.timerSeconds).toBe(150);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
  jest.setSystemTime(160000);
  await act(async () => { tree = renderer.create(<Harness />); });
  expect(hook.timerSeconds).toBe(120);
  await act(async () => { hook.setIsTimerRunning(false); });
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(hook.timerSeconds).toBe(120);
  await act(async () => { tree.update(<Harness task="queue:2" />); });
  expect(hook.timerSeconds).toBe(180);
  expect(hook.isTimerRunning).toBe(false);
  act(() => tree.unmount());
});
test("logout while permission is pending cannot leave a reminder", async () => {
  let resolve!: (value: { status: string }) => void;
  (Notifications.getPermissionsAsync as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness user={802} />); });
  await act(async () => { hook.setIsTimerRunning(true); });
  invalidatePrivateStorage(802);
  await act(async () => { resolve({ status: "granted" }); });
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

test("a failed system cancellation cannot lose the persisted pause or extension", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness user={803} />); });
  await act(async () => { hook.setIsTimerRunning(true); });
  await act(async () => { jest.advanceTimersByTime(30000); });
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error("OS unavailable"));
  await act(async () => { hook.setIsTimerRunning(false); });
  expect(JSON.parse(mockStore.get("cooking-timer:queue:1:user:803")!).startedAt).toBeNull();
  expect(hook.notice).toContain("计时已保存");
  act(() => tree.unmount());
  jest.setSystemTime(160000);
  await act(async () => { tree = renderer.create(<Harness user={803} />); });
  expect(hook.timerSeconds).toBe(150);
  expect(hook.isTimerRunning).toBe(false);
  (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error("OS unavailable"));
  await act(async () => { hook.setTimerSeconds(value => value + 60); });
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<Harness user={803} />); });
  expect(hook.timerSeconds).toBe(210);
  act(() => tree.unmount());
});

test("a failed storage write leaves the prior notification intact and reports lost persistence", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness user={804} />); });
  await act(async () => { hook.setIsTimerRunning(true); });
  jest.clearAllMocks();
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => { hook.setIsTimerRunning(false); });
  expect(hook.notice).toContain("计时保存失败");
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  act(() => tree.unmount());
  await act(async () => { tree = renderer.create(<Harness user={804} />); });
  expect(hook.isTimerRunning).toBe(true);
  act(() => tree.unmount());
});

test("logout while a timer read is pending cannot restore the old account timer", async () => {
  let resolve!: (value: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<Harness user={805} />); });
  expect(hook.ready).toBe(false);
  invalidatePrivateStorage(805);
  await act(async () => { resolve(JSON.stringify({ mode: "countdown", seconds: 600, startedAt: 100000 })); });
  expect(hook.ready).toBe(false);
  expect(hook.isTimerRunning).toBe(false);
  act(() => tree.unmount());
});
