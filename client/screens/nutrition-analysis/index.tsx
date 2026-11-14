import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { PercentRing } from "@/components/PercentRing";
import { Screen } from "@/components/Screen";
import { useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { dietApi, type DietNutritionSummary } from "@/services/api";

type RangeDays = 7 | 30;

function barHeight(value: number | null | undefined, max: number) {
  if (value == null || max <= 0) return 4;
  return Math.max(4, Math.round((value / max) * 88));
}

function fmt(value: number | null | undefined, unit = "") {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 10) / 10}${unit}`;
}

export default function NutritionAnalysisScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const [days, setDays] = useState<RangeDays>(7);
  const [summary, setSummary] = useState<DietNutritionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await dietApi.summary(authFetch, days));
    } catch (error) {
      Alert.alert("营养分析加载失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [authFetch, days]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const maxCalories = useMemo(() => {
    const values = (summary?.daily || []).map((d) => d.calories ?? 0);
    const target = summary?.targets.calories_kcal ?? 0;
    return Math.max(target, ...values, 1);
  }, [summary]);

  const avgCalories = summary && summary.totals.loggedDays > 0
    ? summary.totals.calories / summary.totals.loggedDays
    : null;
  const avgProtein = summary && summary.totals.loggedDays > 0
    ? summary.totals.protein / summary.totals.loggedDays
    : null;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-line px-4 py-3">
        <TouchableOpacity
          accessibilityLabel="返回"
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full bg-surface"
        >
          <FontAwesome6 name="arrow-left" size={16} colorClassName="accent-ink" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-lg font-bold text-ink">营养分析</Text>
          <Text className="text-xs text-copy-muted">按上海日历汇总摄入与目标达成</Text>
        </View>
      </View>

      <View className="flex-row gap-2 border-b border-line bg-canvas px-4 py-3">
        {([7, 30] as const).map((option) => (
          <TouchableOpacity
            key={option}
            onPress={() => setDays(option)}
            className={`rounded-xl px-4 py-2 ${days === option ? "bg-brand" : "bg-surface border border-line"}`}
          >
            <Text className={`text-sm font-bold ${days === option ? "text-white" : "text-ink"}`}>
              近 {option} 天
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator colorClassName="accent-brand" />
          <Text className="text-copy-muted">正在汇总饮食记录…</Text>
        </View>
      ) : !summary ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-critical">暂时无法加载分析</Text>
          <TouchableOpacity onPress={() => void load()} className="rounded-xl bg-brand px-4 py-2">
            <Text className="font-bold text-white">重试</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
          <View className="rounded-2xl border border-line bg-surface p-4">
            <Text className="text-base font-bold text-ink">区间概览</Text>
            <Text className="mt-1 text-xs text-copy-muted">{summary.from} — {summary.to}</Text>
            <View className="mt-4 flex-row">
              {[
                { label: "有记录天数", value: `${summary.totals.loggedDays}/${summary.days}` },
                { label: "记餐笔数", value: String(summary.totals.recordCount) },
                { label: "日均热量", value: fmt(avgCalories, " kcal") },
              ].map((item, index) => (
                <View key={item.label} className={`flex-1 items-center ${index < 2 ? "border-r border-line" : ""}`}>
                  <Text className="text-[10px] text-copy-muted">{item.label}</Text>
                  <Text className="mt-1 text-sm font-black text-ink">{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="rounded-2xl border border-line bg-surface p-4">
            <Text className="text-base font-bold text-ink">目标达成</Text>
            <View className="mt-4 flex-row items-center justify-around">
              <View className="items-center gap-2">
                <PercentRing percent={summary.adherence.calorieAdherencePct} size={64} strokeWidth={6} />
                <Text className="text-xs font-bold text-ink">热量控制</Text>
                <Text className="text-[10px] text-copy-muted">
                  {summary.adherence.calorieDaysMet}/{summary.adherence.calorieDaysTracked} 天达标
                </Text>
              </View>
              <View className="items-center gap-2">
                <PercentRing
                  percent={summary.adherence.proteinAdherencePct}
                  size={64}
                  strokeWidth={6}
                  progressColor="#C47A3A"
                />
                <Text className="text-xs font-bold text-ink">蛋白充足</Text>
                <Text className="text-[10px] text-copy-muted">
                  {summary.adherence.proteinDaysMet}/{summary.adherence.proteinDaysTracked} 天达标
                </Text>
              </View>
            </View>
            <View className="mt-4 gap-1 rounded-xl bg-canvas px-3 py-2">
              <Text className="text-xs text-copy-muted">
                目标：热量 {fmt(summary.targets.calories_kcal, " kcal")} · 蛋白 {fmt(summary.targets.protein_g, "g")} · 碳水 {fmt(summary.targets.carbs_g, "g")} · 脂肪 {fmt(summary.targets.fat_g, "g")}
              </Text>
              <Text className="text-xs text-copy-muted">
                合计：{fmt(summary.totals.calories, " kcal")} · 蛋白 {fmt(summary.totals.protein, "g")} · 碳水 {fmt(summary.totals.carbs, "g")} · 脂肪 {fmt(summary.totals.fat, "g")}
              </Text>
              {avgProtein != null ? (
                <Text className="text-xs text-copy-muted">有记录日均蛋白 {fmt(avgProtein, "g")}</Text>
              ) : null}
            </View>
          </View>

          <View className="rounded-2xl border border-line bg-surface p-4">
            <Text className="mb-3 text-base font-bold text-ink">每日热量趋势</Text>
            <View className="h-28 flex-row items-end justify-between gap-1">
              {summary.daily.map((day) => (
                <View key={day.date} className="flex-1 items-center justify-end">
                  <View
                    className={`w-full max-w-[14px] rounded-t-md ${day.calories == null ? "bg-line" : "bg-brand"}`}
                    style={{ height: barHeight(day.calories, maxCalories) }}
                  />
                </View>
              ))}
            </View>
            <View className="mt-2 flex-row justify-between">
              <Text className="text-[10px] text-copy-muted">{summary.from.slice(5)}</Text>
              <Text className="text-[10px] text-copy-muted">{summary.to.slice(5)}</Text>
            </View>
            {summary.targets.calories_kcal != null ? (
              <Text className="mt-2 text-[10px] text-copy-muted">
                参考目标线约 {Math.round(summary.targets.calories_kcal)} kcal/日
              </Text>
            ) : (
              <Text className="mt-2 text-[10px] text-copy-muted">尚未设置热量目标，可在健康档案补充</Text>
            )}
          </View>

          <View className="rounded-2xl border border-line bg-surface p-4">
            <Text className="mb-3 text-base font-bold text-ink">今日剩余额度</Text>
            <View className="flex-row">
              {[
                { label: "热量", value: summary.today.remainingCalories, unit: " kcal" },
                { label: "蛋白", value: summary.today.remainingProtein, unit: "g" },
                { label: "碳水", value: summary.today.remainingCarbs, unit: "g" },
                { label: "脂肪", value: summary.today.remainingFat, unit: "g" },
              ].map((item, index) => (
                <View key={item.label} className={`flex-1 items-center ${index < 3 ? "border-r border-line" : ""}`}>
                  <Text className="text-[10px] text-copy-muted">{item.label}</Text>
                  <Text className="mt-1 text-xs font-black text-brand">{fmt(item.value, item.unit)}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              onPress={() => router.push("/diet-record")}
              className="mt-4 flex-row items-center justify-center rounded-xl bg-brand-fill py-3"
            >
              <FontAwesome6 name="plus" size={12} colorClassName="accent-on-brand" />
              <Text className="ml-2 text-sm font-bold text-white">继续记一餐</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/health-profile", { section: "nutrition" })}
              className="mt-2 flex-row items-center justify-center py-2"
            >
              <Text className="text-xs font-bold text-brand">调整营养目标</Text>
              <FontAwesome6 name="chevron-right" size={10} colorClassName="accent-brand" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
