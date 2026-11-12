import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, TouchableOpacity } from "react-native";
import { Uniwind } from "uniwind";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));
jest.mock("uniwind", () => ({
  Uniwind: { setTheme: jest.fn() },
  useUniwind: () => ({ theme: "light", hasAdaptiveThemes: true }),
}));
jest.mock("expo-system-ui", () => ({ setBackgroundColorAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/components/ThemedFontAwesome6", () => () => null);
import { ThemeToggle } from "@/components/ThemeToggle";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  ThemeProvider,
  isThemePreference,
  useThemePreference,
} from "./ThemeContext";

const mockAsyncStorage = jest.mocked(AsyncStorage);
const mockSetTheme = jest.mocked(Uniwind.setTheme);

beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncStorage.getItem.mockReset().mockResolvedValue(null);
  mockAsyncStorage.setItem.mockReset().mockResolvedValue(undefined);
});

test("validates persisted theme preferences", () => {
  expect(isThemePreference("system")).toBe(true);
  expect(isThemePreference("light")).toBe(true);
  expect(isThemePreference("dark")).toBe(true);
  expect(isThemePreference("sepia")).toBe(false);
  expect(isThemePreference(null)).toBe(false);
});

test("restores and persists the selected theme", async () => {
  mockAsyncStorage.getItem.mockResolvedValueOnce("dark");
  mockAsyncStorage.setItem.mockResolvedValueOnce(undefined);
  function Probe() {
    const { setPreference } = useThemePreference();
    return <Pressable testID="theme-probe" onPress={() => setPreference("light")} />;
  }

  let tree: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });

  expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  expect(mockSetTheme).toHaveBeenCalledWith("dark");

  await act(async () => {
    await tree!.root.findByProps({ testID: "theme-probe" }).props.onPress();
  });

  expect(mockSetTheme).toHaveBeenLastCalledWith("light");
  expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
  act(() => tree!.unmount());
});

test("shortcut cycles system, light and dark and remembers the selected mode", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ThemeProvider><ThemeToggle /></ThemeProvider>); });
  for (const [before, after, value] of [
    ["跟随系统", "浅色", "light"], ["浅色", "深色", "dark"], ["深色", "跟随系统", "system"],
  ]) {
    expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(`外观：${before}`);
    await act(async () => { tree.root.findByType(TouchableOpacity).props.onPress(); });
    expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe(`外观：${after}`);
    expect(mockSetTheme).toHaveBeenLastCalledWith(value);
    expect(mockAsyncStorage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, value);
  }
  act(() => tree.unmount());
});

test("invalid stored values and failed storage fall back safely", async () => {
  for (const value of ["sepia", null]) {
    mockAsyncStorage.getItem.mockResolvedValueOnce(value);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<ThemeProvider><ThemeToggle /></ThemeProvider>); });
    expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe("外观：跟随系统");
    act(() => tree.unmount());
  }
  mockAsyncStorage.getItem.mockRejectedValueOnce(new Error("Storage disabled"));
  mockAsyncStorage.setItem.mockRejectedValueOnce(new Error("Storage disabled"));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ThemeProvider><ThemeToggle /></ThemeProvider>); });
  await act(async () => { tree.root.findByType(TouchableOpacity).props.onPress(); });
  expect(mockSetTheme).toHaveBeenLastCalledWith("light");
  act(() => tree.unmount());
});

test("rapid theme changes serialize storage writes so the final choice wins", async () => {
  let finish!: () => void;
  mockAsyncStorage.setItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  function Probe() {
    const { setPreference } = useThemePreference();
    return <Pressable testID="rapid-theme-probe" onPress={() => { void setPreference("light"); void setPreference("dark"); void setPreference("system"); }} />;
  }
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ThemeProvider><Probe /></ThemeProvider>); });
  await act(async () => { tree.root.findByProps({ testID: "rapid-theme-probe" }).props.onPress(); });
  expect(mockSetTheme).toHaveBeenLastCalledWith("system");
  expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(mockAsyncStorage.setItem.mock.calls.map(call => call[1])).toEqual(["light", "dark", "system"]);
  act(() => tree.unmount());
});

test("uses the system theme when storage is empty", async () => {
  mockAsyncStorage.getItem.mockResolvedValueOnce(null);
  await act(async () => {
    renderer.create(<ThemeProvider><React.Fragment /></ThemeProvider>);
  });
  expect(mockSetTheme).toHaveBeenLastCalledWith(DEFAULT_THEME);
});
