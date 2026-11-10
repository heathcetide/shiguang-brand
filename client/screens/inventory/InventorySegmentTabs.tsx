import { Text, TouchableOpacity, View } from "react-native";

import FontAwesome6 from "@/components/ThemedFontAwesome6";

export type InventorySegment = "inventory" | "recipes" | "kitchenware";

export function InventorySegmentTabs({
  active,
  counts,
  onChange,
}: {
  active: InventorySegment;
  counts: Record<InventorySegment, number>;
  onChange: (segment: InventorySegment) => void;
}) {
  const segments = [
    { key: "inventory" as const, label: "食材", icon: "boxes-stacked" },
    { key: "recipes" as const, label: "食谱", icon: "utensils" },
    { key: "kitchenware" as const, label: "厨具", icon: "fire-burner" },
  ];

  return (
    <View className="border-b border-line/70 bg-canvas/95 px-4 py-2">
      <View className="h-11 flex-row items-center gap-1">
        {segments.map((segment) => {
          const isActive = active === segment.key;
          return (
            <TouchableOpacity
              key={segment.key}
              onPress={() => onChange(segment.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2.5 ${
                isActive ? "bg-brand-fill shadow-xs" : "bg-transparent"
              }`}
            >
              <FontAwesome6 name={segment.icon} size={12} colorClassName={isActive ? "accent-on-brand" : "accent-copy-muted"} />
              <Text className={`text-xs ${isActive ? "font-black text-white" : "font-bold text-copy-muted"}`}>
                {segment.label}
              </Text>
              <View className={`min-w-5 items-center rounded-full px-1.5 py-0.5 ${isActive ? "bg-surface/20" : "bg-background-secondary"}`}>
                <Text className={`text-[9px] font-black ${isActive ? "text-white" : "text-copy-muted"}`}>
                  {counts[segment.key]}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
