jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { currentState: "active", addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { focusManager } from "@tanstack/react-query";
import { maintainApiCache } from "@/services/api/cache";
import { beginInventorySnapshot, INVENTORY_RETENTION_MS, maintainInventorySnapshots, OFFLINE_INVENTORY_KEY, saveInventorySnapshot } from "@/services/offlineInventory";
import { activatePrivateStorage } from "@/utils/userStorage";
import { ServerStateProvider } from "./ServerStateProvider";

const flush = async () => { await maintainApiCache(); await maintainInventorySnapshots(); };
beforeEach(async () => { await AsyncStorage.clear(); jest.useFakeTimers(); jest.setSystemTime(1_000_000); jest.clearAllMocks(); activatePrivateStorage(1); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it.each(["foreground", "timer"])("cleans up on mount and %s without requesting a cached entry", async trigger => {
  await AsyncStorage.setItem("offline_cache_query_v2:old:user:1", "private");
  await AsyncStorage.setItem("offline_cache_inventory:user:1", "private");
  await AsyncStorage.setItem("@pending_manual_diet_v1:user:1", "keep");
  const interval = jest.spyOn(global, "setInterval");
  const clear = jest.spyOn(global, "clearInterval");
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ServerStateProvider>{null}</ServerStateProvider>); await flush(); });
  expect(await AsyncStorage.getAllKeys()).toEqual(["@pending_manual_diet_v1:user:1"]);
  await saveInventorySnapshot(beginInventorySnapshot(1), []);
  jest.setSystemTime(Date.now() + INVENTORY_RETENTION_MS);
  await act(async () => {
    if (trigger === "foreground") {
      for (const [, listener] of jest.mocked(AppState.addEventListener).mock.calls) listener("active");
    } else jest.advanceTimersByTime(60_000);
    await flush();
  });
  expect(await AsyncStorage.getItem(`${OFFLINE_INVENTORY_KEY}:user:1`)).toBeNull();
  expect(await AsyncStorage.getItem("@pending_manual_diet_v1:user:1")).toBe("keep");
  act(() => tree.unmount());
  for (const result of jest.mocked(AppState.addEventListener).mock.results) expect(result.value.remove).toHaveBeenCalled();
  expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
});

test("forwards foreground transitions to queries and removes both listeners", async () => {
  const focused = jest.spyOn(focusManager, "setFocused");
  const remove = jest.fn();
  let notify: (state: "active" | "background") => void = () => undefined;
  jest.mocked(AppState.addEventListener).mockImplementation((_event, handler) => {
    notify = handler;
    return { remove };
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ServerStateProvider><React.Fragment /></ServerStateProvider>); await flush(); });
  act(() => notify("background"));
  expect(focused).toHaveBeenLastCalledWith(false);
  act(() => notify("active"));
  expect(focused).toHaveBeenLastCalledWith(true);
  act(() => tree.unmount());
  expect(remove).toHaveBeenCalledTimes(2);
});
