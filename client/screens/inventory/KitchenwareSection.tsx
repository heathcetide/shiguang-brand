import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";

import FontAwesome6 from "@/components/ThemedFontAwesome6";
import type { KitchenwareItem } from "./types";

export type KitchenwareStarterKit = { name: string; items: readonly string[] };

export function KitchenwareSection({
  active,
  isAuthenticated,
  items,
  filteredItems,
  starterKits,
  addingStarterKit,
  activeCategory,
  loading,
  onLogin,
  onAddStarterKit,
  onCategoryChange,
  onOpenEditor,
  onDelete,
  onMaintain,
  onRequestRecipes,
}: {
  active: boolean;
  isAuthenticated: boolean;
  items: KitchenwareItem[];
  filteredItems: KitchenwareItem[];
  starterKits: readonly KitchenwareStarterKit[];
  addingStarterKit: string | null;
  activeCategory: string;
  loading: boolean;
  onLogin: () => void;
  onAddStarterKit: (kit: KitchenwareStarterKit) => void;
  onCategoryChange: (category: string) => void;
  onOpenEditor: (item?: KitchenwareItem) => void;
  onDelete: (item: KitchenwareItem) => void;
  onMaintain: (item: KitchenwareItem) => void;
  onRequestRecipes: (item: KitchenwareItem) => void;
}) {
  if (!active) return null;
  if (!isAuthenticated) {
    return (
      <View className="mx-5 mt-8 items-center rounded-[28px] border border-line bg-surface px-6 py-10">
        <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-brand/10">
          <FontAwesome6 name="fire-burner" size={22} colorClassName="accent-brand" />
        </View>
        <Text className="text-base font-black text-ink">登录后管理你的厨具</Text>
        <Text className="mt-2 text-center text-xs leading-5 text-copy-muted">记录锅具、刀具和小家电，获得更匹配的食谱与保养提醒。</Text>
        <TouchableOpacity onPress={onLogin} className="mt-5 rounded-2xl bg-brand-fill px-8 py-3">
          <Text className="text-sm font-black text-white">立即登录</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const attentionCount = items.filter((item) => item.status === "需保养" || item.status === "维修中").length;
  return (
    <View className="px-4 pt-4">
      <View className="mb-4 flex-row items-center gap-3 rounded-[22px] border border-brand bg-brand-soft p-4 shadow-2xs">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-fill shadow-xs">
          <FontAwesome6 name="plug" size={16} colorClassName="accent-on-brand" />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-black text-brand">装备状态管家</Text>
            <View className="rounded-full bg-surface/70 px-2 py-1"><Text className="text-[9px] font-black text-brand">自动提醒</Text></View>
          </View>
          <Text className="mt-1 text-[11px] text-copy-muted" numberOfLines={1}>
            {attentionCount ? `有 ${attentionCount} 件厨具需要关注` : items.length ? "当前装备状态良好，可随时记录保养" : "录入厨具后可获得状态与保养提醒"}
          </Text>
        </View>
      </View>

      <View className="mb-4 rounded-[24px] border border-line bg-surface p-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-[13px] font-black text-ink">按烹饪习惯快速配置</Text>
            <Text className="mt-1 text-[10px] text-copy-muted">选择一套常用装备，之后仍可逐件调整</Text>
          </View>
          <FontAwesome6 name="wand-magic-sparkles" size={15} colorClassName="accent-warm" />
        </View>
        <View className="mt-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2 pr-3">
              {starterKits.map((kit) => (
                <TouchableOpacity key={kit.name} disabled={Boolean(addingStarterKit)} onPress={() => onAddStarterKit(kit)} className="w-44 rounded-2xl border border-line bg-brand-soft px-3.5 py-3 disabled:opacity-50">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[12px] font-black text-brand">{addingStarterKit === kit.name ? "添加中…" : kit.name}</Text>
                    <FontAwesome6 name="plus" size={9} colorClassName="accent-brand" />
                  </View>
                  <Text numberOfLines={2} className="mt-1 text-[9px] leading-4 text-copy-muted">{kit.items.join(" · ")}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <View className="mb-3 flex-row items-center justify-between">
        <View>
          <Text className="text-[15px] font-black text-ink">我的厨具</Text>
          <Text className="mt-0.5 text-[10px] text-copy-muted">{items.length} 件装备 · 点卡片可查看与维护</Text>
        </View>
        <TouchableOpacity onPress={() => onOpenEditor()} className="flex-row items-center gap-1.5 rounded-full bg-brand-fill px-4 py-2.5 shadow-2xs active:scale-95">
          <FontAwesome6 name="plus" size={10} colorClassName="accent-on-brand" />
          <Text className="text-xs font-black text-white">录入厨具</Text>
        </TouchableOpacity>
      </View>

      <View className="mb-4 -mx-4">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4">
          {["全部", "小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((category) => (
            <TouchableOpacity
              key={category}
              onPress={() => onCategoryChange(category)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeCategory === category }}
              className={`rounded-full border px-3.5 py-2 ${activeCategory === category ? "bg-brand-fill border-brand" : "border-line bg-surface"}`}
            >
              <Text className={`text-xs font-bold ${activeCategory === category ? "text-white font-black" : "text-copy-muted"}`}>{category}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View className="items-center py-16">
          <ActivityIndicator colorClassName="accent-brand" />
          <Text className="mt-3 text-xs text-copy-muted">正在加载厨具装备...</Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <View className="items-center rounded-[26px] border border-dashed border-line bg-surface px-6 py-10">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-background-secondary">
            <FontAwesome6 name="kitchen-set" size={24} colorClassName="accent-copy-muted" />
          </View>
          <Text className="mt-4 text-sm font-black text-ink">{items.length === 0 ? "建立你的厨房装备库" : "这个分类还没有厨具"}</Text>
          <Text className="mt-1 max-w-64 text-center text-xs leading-5 text-copy-muted">
            {items.length === 0 ? "添加常用锅具或小家电，就能获得更准确的食谱与保养提醒。" : "切换其他分类查看，或录入一件新厨具。"}
          </Text>
          <TouchableOpacity onPress={() => onOpenEditor()} className="mt-5 rounded-full bg-brand-fill px-5 py-2.5">
            <Text className="text-xs font-black text-white">{items.length === 0 ? "录入第一件厨具" : "录入新厨具"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="flex-row flex-wrap justify-between gap-y-3.5">
          {filteredItems.map((item) => (
            <View key={item.id} style={{ width: "48.5%" }} className="bg-surface rounded-[24px] overflow-hidden border border-line shadow-xs flex-col justify-between p-3">
              <View>
                <View className="relative mb-2">
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} className="w-full h-28 rounded-2xl border border-line" resizeMode="cover" />
                  ) : (
                    <View className="h-28 w-full items-center justify-center rounded-2xl border border-line bg-background-secondary">
                      <FontAwesome6 name="kitchen-set" size={28} colorClassName="accent-copy-muted" />
                    </View>
                  )}
                  <View className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded-full"><Text className="text-[9px] font-bold text-white">{item.status}</Text></View>
                  <View className="absolute left-2 top-2 flex-row gap-1">
                    <TouchableOpacity onPress={() => onOpenEditor(item)} className="h-6 w-6 items-center justify-center rounded-full bg-surface/90">
                      <FontAwesome6 name="pen" size={8} colorClassName="accent-brand" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDelete(item)} className="h-6 w-6 items-center justify-center rounded-full bg-surface/90">
                      <FontAwesome6 name="trash" size={8} colorClassName="accent-critical" />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text numberOfLines={1} className="text-sm font-black text-ink">{item.name}</Text>
                <Text numberOfLines={2} className="text-[10px] text-copy-muted mt-0.5 font-medium">{item.note}</Text>
              </View>
              <View className="mt-2.5 pt-2 border-t border-background-secondary flex-row items-center justify-between gap-1">
                <TouchableOpacity onPress={() => onRequestRecipes(item)} className="bg-brand/10 border border-brand/20 flex-1 py-1 rounded-xl items-center flex-row justify-center gap-1 active:opacity-80">
                  <FontAwesome6 name="wand-magic-sparkles" size={8} colorClassName="accent-brand" />
                  <Text className="text-[9px] font-black text-brand">AI 菜谱</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => onMaintain(item)} className="bg-background-secondary px-2 py-1 rounded-xl items-center flex-row justify-center gap-1">
                  <FontAwesome6 name="wrench" size={8} colorClassName="accent-copy-muted" />
                  <Text className="text-[9px] font-bold text-copy-muted">保养</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
