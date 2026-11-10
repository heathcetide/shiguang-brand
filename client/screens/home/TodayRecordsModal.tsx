import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { useCSSVariable } from "uniwind";

import type { DietRecord } from "./types";

interface TodayRecordsModalProps {
  visible: boolean;
  records: DietRecord[];
  onClose: () => void;
  onAddRecord: () => void;
}

export function TodayRecordsModal({ visible, records, onClose, onAddRecord }: TodayRecordsModalProps) {
  const [brand, ink] = useCSSVariable(["--color-brand", "--color-ink"]) as string[];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View
          className="bg-canvas rounded-t-3xl p-page max-h-[80%] border-t border-line shadow-2xl"
          accessibilityViewIsModal
        >
          <View className="flex-row items-center justify-between pb-3 border-b border-line">
            <View className="flex-row items-center gap-2 flex-1">
              <FontAwesome6 name="utensils" size={16} color={brand} />
              <Text className="text-base font-black text-ink" accessibilityRole="header">
                今日饮食打卡全纪录 ({records.length} 笔)
              </Text>
            </View>

            <TouchableOpacity
              onPress={onClose}
              className="min-w-touch min-h-touch rounded-full bg-surface items-center justify-center border border-line"
              accessibilityRole="button"
              accessibilityLabel="关闭今日饮食记录"
            >
              <FontAwesome6 name="xmark" size={14} color={ink} />
            </TouchableOpacity>
          </View>

          <ScrollView className="my-3 space-y-2.5 max-h-[450px]" accessibilityLiveRegion="polite">
            {records.map((item) => (
              <View
                key={item.id}
                className="bg-surface p-4 rounded-card border border-line my-1 shadow-xs flex-row items-center justify-between"
              >
                <View className="flex-1 mr-3">
                  <View className="flex-row items-center gap-2 mb-1">
                    <View className="bg-brand-fill px-2 py-0.5 rounded-pill">
                      <Text className="text-caption font-bold text-white">{item.meal_type}</Text>
                    </View>
                    <Text className="text-body font-black text-ink">{item.food_name}</Text>
                  </View>
                  <Text className="text-caption text-copy-muted">
                    {item.amount || "1份"} · 蛋白 {item.protein == null ? "—" : `${item.protein}g`} | 碳水 {item.carbs == null ? "—" : `${item.carbs}g`} | 脂肪 {item.fat == null ? "—" : `${item.fat}g`}
                  </Text>
                </View>

                <Text className="text-body font-black text-brand">
                  {item.calories == null ? "—" : `${item.calories} kcal`}
                </Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            onPress={onAddRecord}
            className="bg-brand-fill min-h-touch rounded-control items-center justify-center active:bg-accent-hover mt-1"
            accessibilityRole="button"
            accessibilityLabel="继续添加今日餐食"
          >
            <Text className="text-body font-bold text-white">+ 继续添加今日餐食</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
