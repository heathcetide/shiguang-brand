import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable } from "react-native";
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

test("uses the system theme when storage is empty", async () => {
  mockAsyncStorage.getItem.mockResolvedValueOnce(null);
  await act(async () => {
    renderer.create(<ThemeProvider><React.Fragment /></ThemeProvider>);
  });
  expect(mockSetTheme).toHaveBeenLastCalledWith(DEFAULT_THEME);
});
