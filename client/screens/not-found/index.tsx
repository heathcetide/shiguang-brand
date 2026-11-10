import { Text, TouchableOpacity, View } from "react-native";

import { Screen } from "@/components/Screen";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useSafeRouter } from "@/hooks/useSafeRouter";

export default function NotFoundScreen() {
  const router = useSafeRouter();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  };

  return (
    <Screen>
      <View className="relative flex-1 overflow-hidden px-6 py-10">
        <View className="absolute -right-14 top-8 h-44 w-44 rounded-full bg-brand-soft/70" />
        <View className="absolute -left-20 bottom-4 h-52 w-52 rounded-full bg-warm-soft/70" />

        <View className="flex-1 items-center justify-center">
          <View
            className="relative h-56 w-full max-w-[360px] items-center justify-center"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View className="absolute h-44 w-44 rounded-full border border-brand/15 bg-brand-soft" />
            <View className="absolute left-[12%] top-6 h-3 w-3 rounded-full bg-highlight" />
            <View className="absolute right-[13%] top-14 h-2.5 w-2.5 rounded-full bg-brand" />
            <View className="absolute bottom-7 right-[18%] h-4 w-4 rounded-full border-2 border-warm" />

            <View className="h-32 w-32 items-center justify-center rounded-full border-[10px] border-surface bg-canvas shadow-lg">
              <FontAwesome6 name="utensils" size={38} colorClassName="accent-brand" />
            </View>

            <View className="absolute right-[12%] top-3 flex-row items-center rounded-full border border-line bg-surface px-3 py-2 shadow-sm">
              <FontAwesome6 name="location-dot" size={11} colorClassName="accent-critical" />
              <Text className="ml-1.5 text-xs font-black text-ink">404</Text>
            </View>

            <View className="absolute bottom-3 left-[9%] flex-row items-center rounded-2xl border border-line bg-surface px-3 py-2 shadow-sm">
              <FontAwesome6 name="magnifying-glass" size={10} colorClassName="accent-warm" />
              <Text className="ml-1.5 text-[11px] font-bold text-copy-muted">没找到这一页</Text>
            </View>
          </View>

          <View className="mt-2 w-full max-w-[360px] items-center">
            <Text className="text-center text-[11px] font-black uppercase tracking-[3px] text-brand">Lost in the kitchen</Text>
            <Text className="mt-3 text-center text-[26px] font-black leading-9 text-ink">这道页面还没上桌</Text>
            <Text className="mt-3 max-w-[310px] text-center text-sm leading-6 text-copy-muted">
              你访问的地址可能写错了，或者这份内容已经被移走。先回到熟悉的地方继续逛逛吧。
            </Text>

            <TouchableOpacity
              onPress={() => router.replace("/")}
              accessibilityRole="button"
              accessibilityLabel="回到首页"
              className="mt-7 min-h-12 w-full flex-row items-center justify-center rounded-2xl bg-brand-fill px-5 py-3.5 shadow-md active:opacity-85"
            >
              <FontAwesome6 name="house" size={14} colorClassName="accent-on-brand" />
              <Text className="ml-2 text-sm font-black text-on-brand">回到首页</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="返回上一页"
              className="mt-3 min-h-11 flex-row items-center justify-center px-5 py-2.5 active:opacity-60"
            >
              <FontAwesome6 name="arrow-left" size={12} colorClassName="accent-brand" />
              <Text className="ml-2 text-sm font-bold text-brand">返回上一页</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Screen>
  );
}
