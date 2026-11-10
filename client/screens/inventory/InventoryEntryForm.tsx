import type { ReactNode } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

import { SmartDateInput } from "@/components/SmartDateInput";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { dateKeyAfterDays } from "@/utils/date";
import type { InventoryItem, StorageLocation } from "./types";

const INVENTORY_ENTRY_CATEGORIES = ["蔬菜", "肉食", "水果", "乳制品", "粮油干货", "水产海鲜", "调味品", "休闲零食", "熟食面点"] as const;

export function InventoryEntryForm({
  editingItem,
  evidencePanel,
  foodName,
  category,
  categoryMenuOpen,
  quantity,
  storageLocation,
  expirationDate,
  imageUrl,
  suggestions,
  saving,
  locked = false,
  bottomInset,
  onFoodNameChange,
  onApplySuggestion,
  onToggleCategoryMenu,
  onCategoryChange,
  onQuantityChange,
  onStorageLocationChange,
  onExpirationDateChange,
  onEstimatedExpirationDateChange = onExpirationDateChange,
  onSelectPhoto,
  onRemovePhoto,
  onRequestAiRecipe,
  onDelete,
  onSave,
}: {
  editingItem: InventoryItem | null;
  evidencePanel?: ReactNode;
  foodName: string;
  category: string;
  categoryMenuOpen: boolean;
  quantity: string;
  storageLocation: string;
  expirationDate: string;
  imageUrl: string;
  suggestions: Array<{ name: string; category?: string }>;
  saving: boolean;
  locked?: boolean;
  bottomInset: number;
  onFoodNameChange: (value: string) => void;
  onApplySuggestion: (value: string) => void;
  onToggleCategoryMenu: () => void;
  onCategoryChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onStorageLocationChange: (value: StorageLocation) => void;
  onExpirationDateChange: (value: string) => void;
  onEstimatedExpirationDateChange?: (value: string) => void;
  onSelectPhoto: (source: "camera" | "library") => void;
  onRemovePhoto: () => void;
  onRequestAiRecipe: (item: InventoryItem) => void;
  onDelete: (id: number) => void;
  onSave: () => void;
}) {
  return (
    <>
      <ScrollView pointerEvents={locked || saving ? "none" : "auto"} className="flex-1" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        <View className="w-full max-w-[720px] self-center px-5 pb-4 pt-4">
          {evidencePanel}
          <View className="rounded-[24px] border border-line bg-surface p-4 shadow-xs">
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-xs font-black text-ink">食材名称 <Text className="text-critical">*</Text></Text>
              <Text className="text-[10px] text-copy-muted">输入后自动推荐分类和保质期</Text>
            </View>
            <View className="flex-row items-center rounded-2xl border border-line bg-canvas px-4">
              <View className="mr-3 h-8 w-8 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="leaf" size={12} colorClassName="accent-brand" /></View>
              <TextInput
                nativeID="inventory-food-name"
                value={foodName}
                editable={!locked && !saving}
                onChangeText={onFoodNameChange}
                placeholder="输入食材名称"
                autoFocus={!editingItem}
                returnKeyType="next"
                className="min-h-14 flex-1 py-3.5 text-[17px] font-bold text-ink outline-none"
              />
            </View>
            {suggestions.length > 0 && (
              <View className="mt-2 flex-row flex-wrap gap-1.5 rounded-2xl bg-brand-soft p-2.5">
                {suggestions.map((suggestion) => (
                  <TouchableOpacity key={suggestion.name} onPress={() => onApplySuggestion(suggestion.name)} className="flex-row items-center gap-1 rounded-xl bg-brand/10 px-2.5 py-1.5 active:bg-brand/20">
                    <FontAwesome6 name="plus" size={10} colorClassName="accent-brand" />
                    <Text className="text-xs font-bold text-brand">{suggestion.name}</Text>
                    {suggestion.category && <Text className="text-[10px] text-copy-muted">({suggestion.category})</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View className="mt-4 border-t border-line pt-4">
              <Text className="mb-1.5 text-xs font-bold text-copy-muted">分类</Text>
              <TouchableOpacity
                onPress={onToggleCategoryMenu}
                accessibilityRole="button"
                accessibilityLabel={`选择食材分类，当前为${category}`}
                accessibilityState={{ expanded: categoryMenuOpen }}
                className="flex-row items-center rounded-2xl border border-line bg-canvas px-4 py-3"
              >
                <View className="h-8 w-8 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="shapes" size={11} colorClassName="accent-brand" /></View>
                <Text className="ml-3 flex-1 text-sm font-bold text-ink">{category}</Text>
                <Text className="mr-2 text-[10px] text-copy-muted">选择分类</Text>
                <FontAwesome6 name={categoryMenuOpen ? "chevron-up" : "chevron-down"} size={10} colorClassName="accent-copy-muted" />
              </TouchableOpacity>
              {categoryMenuOpen && (
                <View className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
                  {INVENTORY_ENTRY_CATEGORIES.map((item, index) => {
                    const selected = category === item;
                    return (
                      <TouchableOpacity key={item} onPress={() => onCategoryChange(item)} className={`flex-row items-center px-4 py-3 ${index > 0 ? "border-t border-line" : ""} ${selected ? "bg-brand-soft" : "bg-surface"}`}>
                        <Text className={`flex-1 text-sm ${selected ? "font-black text-brand" : "font-medium text-ink"}`}>{item}</Text>
                        {selected && <FontAwesome6 name="check" size={11} colorClassName="accent-brand" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            <View className="mt-4 border-t border-line pt-4">
              <View className="mb-3 flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <View className="h-7 w-7 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="box" size={11} colorClassName="accent-brand" /></View>
                  <Text className="text-sm font-black text-ink">库存信息</Text>
                </View>
                <Text className="text-[10px] text-copy-muted">数量与保存方式</Text>
              </View>
              <View className="flex-row items-end gap-3">
                <View className="w-[42%]">
                  <Text className="mb-1.5 text-xs font-bold text-copy-muted">数量（可不填）</Text>
                  <TextInput nativeID="inventory-quantity" editable={!locked && !saving} value={quantity} onChangeText={onQuantityChange} placeholder="不确定可留空" className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-semibold text-ink outline-none" />
                </View>
                <View className="flex-1">
                  <Text className="mb-1.5 text-xs font-bold text-copy-muted">存放位置</Text>
                  <View className="flex-row rounded-2xl border border-line bg-canvas p-1">
                    {(["冷藏", "冷冻", "常温"] as const).map((location) => (
                      <TouchableOpacity key={location} onPress={() => onStorageLocationChange(location)} className={`flex-1 items-center rounded-xl py-2.5 ${storageLocation === location ? "bg-brand-fill shadow-xs" : "bg-transparent"}`}>
                        <Text className={`text-[11px] ${storageLocation === location ? "font-bold text-white" : "font-medium text-copy-muted"}`}>{location}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              <View className="mt-2 flex-row gap-1.5">
                {["100g", "1份", "2盒", "500g"].map((value) => (
                  <TouchableOpacity key={value} onPress={() => onQuantityChange(value)} className={`flex-1 items-center rounded-full border py-1.5 ${quantity === value ? "border-brand/20 bg-brand-soft" : "border-line bg-canvas"}`}>
                    <Text className={`text-[10px] font-bold ${quantity === value ? "text-brand" : "text-copy-muted"}`}>{value}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="mt-4 border-t border-line pt-4">
                <View className="mb-2.5 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2.5">
                    <View className="h-7 w-7 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="bell" size={11} colorClassName="accent-brand" /></View>
                    <Text className="text-sm font-black text-ink">到期日期</Text>
                  </View>
                  <View className="rounded-full bg-brand-soft px-2.5 py-1"><Text className="text-[10px] font-black text-brand">临期提醒</Text></View>
                </View>
                <View className="mb-2 flex-row gap-2">
                  {[{ label: "3 天", days: 3 }, { label: "7 天", days: 7 }, { label: "30 天", days: 30 }].map(({ label, days }) => {
                    const date = dateKeyAfterDays(days);
                    const selected = expirationDate === date;
                    return (
                      <TouchableOpacity key={label} onPress={() => onEstimatedExpirationDateChange(date)} className={`flex-1 items-center rounded-xl border py-2 ${selected ? "border-brand bg-brand-fill" : "border-line bg-canvas"}`}>
                        <Text className={`text-[11px] font-bold ${selected ? "text-white" : "text-copy-muted"}`}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <SmartDateInput accessibilityLabel="到期日期" value={expirationDate} onChange={onExpirationDateChange} containerStyle={{ marginBottom: 0 }} inputStyle={{ minHeight: 52, shadowOpacity: 0, elevation: 0 }} iconSize={16} />
              </View>
            </View>

            <View className="mt-4 border-t border-line pt-4">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 flex-row items-center gap-3">
                  {imageUrl ? <Image source={{ uri: imageUrl }} className="h-11 w-11 rounded-2xl bg-canvas" /> : <View className="h-11 w-11 items-center justify-center rounded-2xl bg-canvas"><FontAwesome6 name="image" size={15} colorClassName="accent-copy-muted" /></View>}
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-ink">食材照片 <Text className="font-medium text-copy-muted">（可选）</Text></Text>
                    <Text className="mt-0.5 text-[10px] text-copy-muted">{imageUrl ? "照片已添加" : "添加后更容易辨认"}</Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <TouchableOpacity accessibilityLabel="拍摄食材照片" onPress={() => onSelectPhoto("camera")} className="h-10 w-10 items-center justify-center rounded-xl bg-brand-soft"><FontAwesome6 name="camera" size={13} colorClassName="accent-brand" /></TouchableOpacity>
                  <TouchableOpacity accessibilityLabel="从相册选择食材照片" onPress={() => onSelectPhoto("library")} className="h-10 w-10 items-center justify-center rounded-xl bg-canvas"><FontAwesome6 name="images" size={13} colorClassName="accent-copy-muted" /></TouchableOpacity>
                  {imageUrl && <TouchableOpacity accessibilityLabel="移除食材照片" onPress={onRemovePhoto} className="h-10 w-10 items-center justify-center rounded-xl bg-danger-soft"><FontAwesome6 name="trash" size={12} colorClassName="accent-critical" /></TouchableOpacity>}
                </View>
              </View>
            </View>
          </View>

          {editingItem && (
            <View className="mt-3 flex-row gap-2.5">
              <TouchableOpacity onPress={() => onRequestAiRecipe(editingItem)} className="flex-1 items-center rounded-2xl border border-highlight/40 bg-highlight/20 py-3.5">
                <Text className="text-xs font-bold text-warm">AI 生成菜谱</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onDelete(editingItem.id)} className="flex-row items-center justify-center gap-1.5 rounded-2xl bg-danger-soft px-5 py-3">
                <FontAwesome6 name="trash-can" size={11} colorClassName="accent-critical" />
                <Text className="text-xs font-bold text-critical">移除</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      <View className="border-t border-line bg-surface px-5 pt-3" style={{ paddingBottom: Math.max(bottomInset, 12) }}>
        <TouchableOpacity onPress={onSave} disabled={saving} className="w-full max-w-[680px] self-center items-center rounded-2xl bg-brand-fill py-4 shadow-sm active:opacity-90 disabled:opacity-60">
          {saving ? <ActivityIndicator colorClassName="accent-on-brand" /> : (
            <View className="flex-row items-center gap-2">
              <FontAwesome6 name="check" size={13} colorClassName="accent-on-brand" />
              <Text className="text-base font-bold text-white">{editingItem ? "保存修改" : "加入食材库"}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </>
  );
}
