import { useEffect, useRef } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";

import { useSafeRouter } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { parseShareCode, parseSharedPostUrl } from "@/utils/shareLinks";

export function ShareLinkLifecycle() {
  const router = useSafeRouter();
  const lastCode = useRef("");

  useEffect(() => {
    const openUrl = (url: string) => {
      const id = parseSharedPostUrl(url);
      if (id) router.push("/post-detail", { id });
    };
    const subscription = Linking.addEventListener("url", ({ url }) => openUrl(url));
    void Linking.getInitialURL().then((url) => { if (url) openUrl(url); });
    return () => subscription.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const checkClipboard = async () => {
      const hasString = await Clipboard.hasStringAsync().catch(() => false);
      if (!hasString) return;
      const content = await Clipboard.getStringAsync().catch(() => "");
      const code = parseShareCode(content);
      if (!code || code === lastCode.current) return;
      lastCode.current = code;
      try {
        const resolved = await communityApi.resolveShare(code);
        Alert.alert("发现食光分享", "是否打开剪贴板中的社区帖子？", [
          { text: "暂不", style: "cancel" },
          { text: "打开", onPress: () => router.push("/post-detail", { id: resolved.post_id }) },
        ]);
      } catch { /* invalid or expired codes stay silent */ }
    };
    void checkClipboard();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkClipboard();
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}
