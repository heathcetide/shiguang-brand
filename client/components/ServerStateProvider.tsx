import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { maintainApiCache } from "@/services/api/cache";
import { maintainInventorySnapshots } from "@/services/offlineInventory";

import { AppState, Platform } from "react-native";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function ServerStateProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);
  useEffect(() => {
    const maintain = () => { void Promise.all([maintainApiCache(), maintainInventorySnapshots()]).catch(() => undefined); };
    maintain();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") maintain(); });
    // Mobile timers pause in the background; foreground cleanup runs immediately.
    const timer = setInterval(() => { if (AppState.currentState === "active") maintain(); }, 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") maintain(); };
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (Platform.OS === "web") return;
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => { subscription.remove(); focusManager.setFocused(undefined); };
  }, []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
