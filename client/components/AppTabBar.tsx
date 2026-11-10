import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, Platform, DeviceEventEmitter, Alert } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCSSVariable } from "uniwind";

import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";
import { createAuthReturnTo } from "@/utils/authReturnTo";

type InventorySegment = "inventory" | "recipes" | "kitchenware";

export function AppTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const [muted, brand, onBrand] = useCSSVariable([
    "--color-copy-muted",
    "--color-brand",
    "--color-on-brand",
  ]) as string[];

  const currentRouteName = state.routes[state.index]?.name || "index";
  const [inventorySegment, setInventorySegment] = useState<InventorySegment>("inventory");

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      "inventory-segment-change",
      (segment: InventorySegment) => setInventorySegment(segment),
    );
    return () => subscription.remove();
  }, []);

  const handleQuickActionPress = () => {
    if (currentRouteName === "inventory" && !isAuthenticated) {
      const actionLabel = inventorySegment === "recipes" ? "食谱" : inventorySegment === "kitchenware" ? "厨具" : "食材";
      const returnTo = inventorySegment === "recipes"
        ? createAuthReturnTo("/recipe-submit")
        : createAuthReturnTo("/inventory", inventorySegment === "inventory" ? { action: "add" } : {});
      Alert.alert(`登录后保存${actionLabel}`, `登录后才能保存和管理你的${actionLabel}。`, [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login", returnTo ? { returnTo } : {}) },
      ]);
      return;
    }

    switch (currentRouteName) {
      case "index":
        router.push("/ai-assistant");
        break;
      case "inventory":
        if (inventorySegment === "recipes") {
          router.push("/recipe-submit");
        } else if (inventorySegment === "kitchenware") {
          DeviceEventEmitter.emit("open-add-kitchenware");
        } else {
          DeviceEventEmitter.emit("open-add-food");
        }
        break;
      case "community":
        DeviceEventEmitter.emit("open-community-post");
        break;
      case "profile":
        router.push("/diet-record");
        break;
      default:
        router.push("/ai-assistant");
        break;
    }
  };

  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    return (options as { href?: unknown }).href !== null;
  });

  const getTabConfig = (routeName: string) => {
    switch (routeName) {
      case "index":
        return { label: "首页", icon: "house" };
      case "inventory":
        return { label: "资产", icon: "boxes-stacked" };
      case "community":
        return { label: "社区", icon: "compass" };
      case "profile":
        return { label: "我的", icon: "user" };
      default:
        return { label: routeName, icon: "circle" };
    }
  };

  const quickAction = currentRouteName === "inventory"
    ? {
        inventory: { accessibilityLabel: "新增食材", icon: "plus" as const },
        recipes: { accessibilityLabel: "新增食谱", icon: "plus" as const },
        kitchenware: { accessibilityLabel: "新增厨具", icon: "plus" as const },
      }[inventorySegment]
    : currentRouteName === "community"
      ? { accessibilityLabel: "发布社区动态", icon: "pen" as const }
      : currentRouteName === "profile"
        ? { accessibilityLabel: "记录一餐", icon: "utensils" as const }
        : { accessibilityLabel: "打开食语 AI 助手", icon: "wand-magic-sparkles" as const };

  const bottomPad = Platform.OS === "web" ? 8 : Math.max(insets.bottom, 8);

  return (
    <View
      style={{
        position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99,
        paddingBottom: bottomPad,
      }}
      className="border-t border-line bg-surface"
    >
      <View className="h-[54px] flex-row items-center px-1">
        {visibleRoutes.map((route) => {
          const isFocused = state.routes[state.index].key === route.key;
          const config = getTabConfig(route.name);

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={config.label}
              accessibilityState={{ selected: isFocused }}
              className="h-full flex-1 items-center justify-center"
            >
              <FontAwesome6
                name={config.icon as any}
                size={18}
                color={isFocused ? brand : muted}
              />
              <Text
                numberOfLines={1}
                className={`mt-1 text-[10px] ${isFocused ? "font-semibold text-brand" : "font-medium text-copy-muted"}`}
              >
                {config.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <View className="mx-1 h-6 w-px bg-line" />

        <TouchableOpacity
          onPress={handleQuickActionPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={quickAction.accessibilityLabel}
          accessibilityHint={currentRouteName === "inventory" && !isAuthenticated ? "需要先登录" : undefined}
          className="mr-2 h-9 w-9 items-center justify-center rounded-full bg-brand-fill"
        >
          <FontAwesome6 name={quickAction.icon} size={14} color={onBrand || "#fff"} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
