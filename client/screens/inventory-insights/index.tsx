import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { householdApi, insightsApi, type Household, type InventoryOutcome, type InventoryOutcomeEvent, type InventoryWeeklyReport } from "@/services/api";
import { addLocalDays, parseDateKey, toLocalDateKey } from "@/utils/date";

const OUTCOME_LABELS: Record<InventoryOutcome, string> = {
  cooked: "烹饪消耗",
  used: "手动用完",
  discarded: "丢弃",
  expired: "过期",
  gifted: "赠送",
  transferred: "转移",
  unknown: "结果未知",
};

const CORRECTION_OPTIONS: InventoryOutcome[] = ["cooked", "used", "discarded", "expired", "gifted", "transferred", "unknown"];

function mondayKey(date = new Date()) {
  const weekday = (date.getDay() + 6) % 7;
  return toLocalDateKey(addLocalDays(-weekday, date));
}

function trendLabel(value: number, favorableWhenPositive = true) {
  if (value === 0) return "与上周持平";
  const good = favorableWhenPositive ? value > 0 : value < 0;
  return `${value > 0 ? "+" : ""}${value} 较上周${good ? "改善" : "变化"}`;
}

function quantityText(values: Record<string, number>) {
  const labels: Record<string, string> = { g: "g", kg: "kg", ml: "ml", l: "L", piece: "个", serving: "份", bag: "袋", box: "盒", bottle: "瓶", can: "罐" };
  const entries = Object.entries(values);
  return entries.length ? entries.map(([unit, value]) => `${value}${labels[unit] || unit}`).join("、") : "数量数据不足";
}

export default function InventoryInsightsScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);
  const [weekStart, setWeekStart] = useState(mondayKey());
  const [report, setReport] = useState<InventoryWeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const familyList = await householdApi.mine(authFetch);
      setHouseholds(familyList);
      const validHousehold = activeHousehold ? familyList.find((item) => item.id === activeHousehold.id) || null : null;
      if (activeHousehold && !validHousehold) setActiveHousehold(null);
      setReport(await insightsApi.weekly(authFetch, {
        weekStart,
        scope: validHousehold ? "household" : "personal",
        householdId: validHousehold?.id,
      }));
    } catch (error) {
      Alert.alert("周报加载失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [activeHousehold, authFetch, weekStart]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const weekLabel = useMemo(() => {
    const start = parseDateKey(weekStart);
    return start ? `${weekStart} — ${toLocalDateKey(addLocalDays(6, start))}` : weekStart;
  }, [weekStart]);

  const changeWeek = (days: number) => {
    const date = parseDateKey(weekStart);
    if (date) setWeekStart(toLocalDateKey(addLocalDays(days, date)));
  };

  const correct = (event: InventoryOutcomeEvent) => {
    if (event.traceType !== "outcome") {
      Alert.alert("系统闭环记录", "这条记录来自烹饪或结构化扣减日志，可回到对应库存历史核对原始变动。");
      return;
    }
    Alert.alert("修正结果分类", `“${event.foodName}”实际结果是？`, [
      ...CORRECTION_OPTIONS.slice(0, 3).map((outcome) => ({ text: OUTCOME_LABELS[outcome], onPress: () => void saveCorrection(event, outcome) })),
      { text: "更多选项", onPress: () => Alert.alert("其他结果", "请选择实际结果", [
        ...CORRECTION_OPTIONS.slice(3).map((outcome) => ({ text: OUTCOME_LABELS[outcome], onPress: () => void saveCorrection(event, outcome) })),
        { text: "取消", style: "cancel" as const },
      ]) },
      { text: "取消", style: "cancel" },
    ]);
  };

  const saveCorrection = async (event: InventoryOutcomeEvent, outcome: InventoryOutcome) => {
    try {
      await insightsApi.correctOutcome(authFetch, event.id, event.version, outcome);
      await load();
    } catch (error) {
      Alert.alert("修正失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between px-5 pb-4 pt-2">
          <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"><FontAwesome6 name="arrow-left" size={14} colorClassName="accent-ink" /></TouchableOpacity>
          <View className="items-center"><Text className="text-lg font-black text-ink">库存结果周报</Text><Text className="text-[10px] font-bold text-copy-muted">真实变动 · 可追溯 · 可修正</Text></View>
          <TouchableOpacity onPress={() => void load()} className="h-10 w-10 items-center justify-center rounded-full bg-brand-soft"><FontAwesome6 name="rotate" size={13} colorClassName="accent-brand" /></TouchableOpacity>
        </View>

        <View className="px-5">
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setActiveHousehold(null)} className={`rounded-full border px-4 py-2 ${!activeHousehold ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}><Text className={`text-xs font-black ${!activeHousehold ? "text-white" : "text-copy-muted"}`}>个人库存</Text></TouchableOpacity>
              {households.map((household) => <TouchableOpacity key={household.id} onPress={() => setActiveHousehold(household)} className={`rounded-full border px-4 py-2 ${activeHousehold?.id === household.id ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}><Text className={`text-xs font-black ${activeHousehold?.id === household.id ? "text-white" : "text-copy-muted"}`}>{household.name}</Text></TouchableOpacity>)}
            </ScrollView>
          </View>

          <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3">
            <TouchableOpacity onPress={() => changeWeek(-7)}><FontAwesome6 name="chevron-left" size={12} colorClassName="accent-brand" /></TouchableOpacity>
            <View className="items-center"><Text className="text-xs font-black text-ink">{weekLabel}</Text><Text className="mt-0.5 text-[9px] text-copy-muted">按设备本地周界统计</Text></View>
            <TouchableOpacity onPress={() => changeWeek(7)}><FontAwesome6 name="chevron-right" size={12} colorClassName="accent-brand" /></TouchableOpacity>
          </View>

          {loading ? <ActivityIndicator className="my-16" colorClassName="accent-brand" /> : report ? (
            <>
              <View className="mt-4 flex-row gap-2">
                <View className="flex-1 rounded-3xl bg-brand-soft p-4"><Text className="text-[10px] font-bold text-brand">及时使用临期</Text><Text className="mt-1 text-3xl font-black text-brand">{report.summary.timelyUsedCount}</Text><Text className="mt-1 text-[9px] text-brand">{trendLabel(report.trend.timelyUsedDelta)}</Text></View>
                <View className="flex-1 rounded-3xl bg-warm-soft p-4"><Text className="text-[10px] font-bold text-warm">过期或丢弃</Text><Text className="mt-1 text-3xl font-black text-warm">{report.summary.wastedCount}</Text><Text className="mt-1 text-[9px] text-warm">{trendLabel(report.trend.wastedDelta, false)}</Text></View>
              </View>
              <View className="mt-3 rounded-3xl border border-line bg-surface p-4">
                <Text className="text-xs font-black text-ink">本周真实闭环</Text>
                <Text className="mt-2 text-xs leading-5 text-copy-muted">已使用 {report.summary.usedCount} 次 · 提醒/菜谱促成 {report.summary.promptedUseCount} 次 · 赠送/转移 {report.summary.giftedOrTransferredCount} 次 · 结果未知 {report.summary.unknownCount} 次</Text>
                <Text className="mt-2 text-[10px] text-copy-muted">使用数量：{quantityText(report.summary.quantityTotals.used)}</Text>
                <Text className="mt-1 text-[10px] text-copy-muted">浪费数量：{quantityText(report.summary.quantityTotals.wasted)}</Text>
              </View>
              <View className="mt-3 rounded-3xl border border-brand/20 bg-brand-soft p-4"><Text className="text-xs font-black text-brand">下周建议</Text><Text className="mt-2 text-xs leading-5 text-brand">{report.advice}</Text></View>
              <View className="mt-3 rounded-3xl border border-line bg-background-secondary p-4"><Text className="text-[10px] font-black text-copy-muted">数据说明 · {report.dataQuality === "structured" ? "结构化数量完整" : report.dataQuality === "partial" ? "部分数量不可安全换算" : "本周暂无结果数据"}</Text><Text className="mt-1 text-[10px] leading-4 text-copy-muted">{report.moneyMessage} 未知结果不会计入节约或浪费。</Text></View>

              <Text className="mb-2 mt-5 text-sm font-black text-ink">可追溯结果</Text>
              {report.events.length ? report.events.map((event) => (
                <TouchableOpacity key={event.id} onPress={() => correct(event)} className="mb-2 rounded-2xl border border-line bg-surface p-4">
                  <View className="flex-row items-center justify-between gap-3"><Text className="min-w-0 flex-1 text-xs font-black text-ink">{event.foodName}</Text><Text className="text-[10px] font-black text-brand">{OUTCOME_LABELS[event.outcome]}</Text></View>
                  <Text className="mt-1 text-[10px] text-copy-muted">{event.quantityText || (event.quantityValue !== null ? `${event.quantityValue}${event.quantityUnit || ""}` : "数量未知")} · {new Date(event.occurredAt).toLocaleString()} · 来源 {event.source}</Text>
                  <Text className="mt-1 text-[9px] text-copy-muted">追溯 #{event.id}{event.corrected ? " · 已修正" : ""}{event.traceType === "outcome" ? " · 点击修正" : " · 结构化变动日志"}</Text>
                </TouchableOpacity>
              )) : <View className="items-center rounded-3xl border border-dashed border-line p-8"><Text className="text-xs font-bold text-copy-muted">本周暂无可统计结果</Text><Text className="mt-2 text-center text-[10px] leading-4 text-copy-muted">继续记录用完、烹饪、过期或转移；小样本不会生成夸大的结论。</Text></View>}
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
