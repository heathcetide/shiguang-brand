import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SystemUI from "expo-system-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, View } from "react-native";
import { Uniwind, useUniwind } from "uniwind";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "@dietdigidose:theme-preference";
export const DEFAULT_THEME: ThemePreference = "system";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark";
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME);
  const [hydrated, setHydrated] = useState(false);
  const { theme } = useUniwind();
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((storedPreference) => {
        if (!mounted) return;
        const nextPreference = isThemePreference(storedPreference)
          ? storedPreference
          : DEFAULT_THEME;
        setPreferenceState(nextPreference);
        Uniwind.setTheme(nextPreference);
      })
      .catch(() => {
        if (mounted) Uniwind.setTheme(DEFAULT_THEME);
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    Uniwind.setTheme(nextPreference);
    // Apply immediately, but serialize persistence so rapid taps cannot save an older choice last.
    writes.current = writes.current.then(() => AsyncStorage.setItem(THEME_STORAGE_KEY, nextPreference)).catch(() => undefined);
    await writes.current;
  }, []);

  const resolvedTheme = theme === "dark" ? "dark" : "light";

  useEffect(() => {
    if (Platform.OS === "web") return;
    void SystemUI.setBackgroundColorAsync(
      resolvedTheme === "dark" ? "#111713" : "#FDF8F0",
    ).catch(() => undefined);
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme,
    setPreference,
  }), [preference, resolvedTheme, setPreference]);

  if (!hydrated) {
    return <View className="flex-1 bg-canvas" />;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemeProvider");
  }
  return context;
}
