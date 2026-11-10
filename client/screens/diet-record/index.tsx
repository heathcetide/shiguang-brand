import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { usePendingDietSave } from "@/hooks/usePendingDietSave";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { addLocalDays, parseDateKey, toLocalDateKey } from "@/utils/date";
import { formatNutritionSummary, summarizeNutrition } from "@/utils/nutritionSummary";
import { aiApi, ApiError, dietApi, waitForAgentRun, type DietRecord } from "@/services/api";

import * as ImagePicker from "expo-image-picker";

interface PresetFood {
  name: string;
  amount: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

const QUICK_PRESETS: PresetFood[] = [
  { name: "水煮蛋", amount: "1个 (约50g)", calories: "70", protein: "6.5", carbs: "0.6", fat: "5" },
  { name: "煎鸡胸肉", amount: "150g", calories: "240", protein: "35", carbs: "0", fat: "4" },
  { name: "全麦面包", amount: "2片 (约70g)", calories: "160", protein: "6", carbs: "28", fat: "2" },
  { name: "无糖黑咖啡", amount: "1杯 (350ml)", calories: "10", protein: "0.5", carbs: "1", fat: "0" },
  { name: "鸡肉鲜蔬沙拉", amount: "1份 (300g)", calories: "320", protein: "25", carbs: "15", fat: "12" },
  { name: "牛奶燕麦粥", amount: "1碗 (250ml)", calories: "220", protein: "10", carbs: "30", fat: "6" },
  { name: "红富士苹果", amount: "1个 (约200g)", calories: "95", protein: "0.4", carbs: "25", fat: "0.3" },
  { name: "低脂无糖酸奶", amount: "1杯 (150g)", calories: "90", protein: "7.5", carbs: "9", fat: "1.5" },
];

const DAY_TIMELINE_HEIGHT = 264;

function currentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normalizeRecordedTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function DietRecordScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<any>();
  const { isAuthenticated, user, sessionGeneration } = useAuth();
  const authFetch = useAuthFetch();
  const pendingSave = usePendingDietSave(user?.id, authFetch);
  const { targetCalories: targetCal, targetLabel } = useHealthSummary();

  const todayStr = toLocalDateKey();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [weekOffset, setWeekOffset] = useState(0);
  const accountScope = useMemo(() => ({ userId: user?.id, isAuthenticated, authFetch, sessionGeneration }), [user?.id, isAuthenticated, authFetch, sessionGeneration]);
  const recordScope = useMemo(() => ({ accountScope, selectedDate }), [accountScope, selectedDate]);
  const weekScope = useMemo(() => ({ accountScope, weekOffset, todayStr }), [accountScope, weekOffset, todayStr]);
  const currentAccountScope = useRef(accountScope);
  const currentRecordScope = useRef(recordScope);
  const currentWeekScope = useRef(weekScope);
  currentAccountScope.current = accountScope;
  currentRecordScope.current = recordScope;
  currentWeekScope.current = weekScope;
  const recordRequest = useRef(0);
  const weekRequest = useRef(0);
  const mounted = useRef(true);
  const formRevision = useRef(0);
  const [recordState, setRecordState] = useState({ scope: recordScope, records: [] as DietRecord[], loading: true });
  const [weekState, setWeekState] = useState({ scope: weekScope, counts: {} as Record<string, number> });
  // Scope the rendered data too: a date/account change must hide old rows before effects run.
  const records = recordState.scope === recordScope ? recordState.records : [];
  const weeklyRecordCounts = weekState.scope === weekScope ? weekState.counts : {};
  const loading = recordState.scope !== recordScope || recordState.loading;
  const [modalVisible, setModalVisible] = useState(false);
  const [formAccountScope, setFormAccountScope] = useState(accountScope);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Form
  const [mealType, setMealType] = useState("");
  const [recordedTime, setRecordedTime] = useState(currentTimeValue);
  const [foodName, setFoodName] = useState("");
  const [amount, setAmount] = useState("1份");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    formRevision.current += 1;
    setSaving(false);
    setAiAnalyzing(false);
  }, [recordScope]);

  useEffect(() => {
    setModalVisible(false);
    setMealType("");
    setFoodName("");
    setAmount("1份");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setImageUrl("");
  }, [accountScope]);

  // 监听路由预填参数
  useEffect(() => {
    if (params.action === "add" && isAuthenticated) {
      setFormAccountScope(accountScope);
      setModalVisible(true);
      router.setParams({});
      return;
    }
    if (params.prefill_food) {
      setFormAccountScope(accountScope);
      setFoodName(String(params.prefill_food));
      if (params.prefill_calories !== undefined) setCalories(String(params.prefill_calories));
      if (params.prefill_protein !== undefined) setProtein(String(params.prefill_protein));
      if (params.prefill_carbs !== undefined) setCarbs(String(params.prefill_carbs));
      if (params.prefill_fat !== undefined) setFat(String(params.prefill_fat));
      if (params.prefill_amount) setAmount(String(params.prefill_amount));
      if (params.prefill_meal_type) setMealType(String(params.prefill_meal_type));
      if (params.recorded_at) setSelectedDate(String(params.recorded_at));
      setModalVisible(true);
      // 预填数据已经进入本地表单状态，立即消费掉一次性路由参数。
      router.setParams({});
    }
  }, [accountScope, isAuthenticated, params, router]);

  // 生成当前浏览周期的 7 天日期数组；weekOffset 为负数时查看更早周期。
  const pastSevenDays = Array.from({ length: 7 }).map((_, i) => {
    const d = addLocalDays(weekOffset * 7 - (6 - i));
    const dateStr = toLocalDateKey(d);
    const dayName = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const isToday = dateStr === todayStr;
    return { date: d, dateStr, dayNum: d.getDate(), dayName, isToday };
  });

  const calendarMonthStartOffset = (calendarMonth.getDay() + 6) % 7;
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(index - calendarMonthStartOffset, calendarMonth);
    const dateStr = toLocalDateKey(date);
    return {
      date,
      dateStr,
      isCurrentMonth: date.getMonth() === calendarMonth.getMonth(),
      isFuture: dateStr > todayStr,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    };
  });
  const now = new Date();
  const isCalendarCurrentMonth =
    calendarMonth.getFullYear() === now.getFullYear() && calendarMonth.getMonth() === now.getMonth();

  const changeWeek = (delta: -1 | 1) => {
    const nextOffset = Math.min(0, weekOffset + delta);
    setWeekOffset(nextOffset);
    setSelectedDate(toLocalDateKey(addLocalDays(nextOffset * 7)));
  };

  const goToToday = () => {
    setWeekOffset(0);
    setSelectedDate(todayStr);
  };

  const openCalendar = () => {
    const selected = parseDateKey(selectedDate) || new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarVisible(true);
  };

  const changeCalendarMonth = (delta: -1 | 1) => {
    setCalendarMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return next > currentMonth ? current : next;
    });
  };

  const selectCalendarDate = (date: Date) => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const selectedStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (selectedStart > todayStart) return;

    const daysAgo = Math.max(0, Math.round((todayStart.getTime() - selectedStart.getTime()) / 86400000));
    setWeekOffset(-Math.floor(daysAgo / 7));
    setSelectedDate(toLocalDateKey(selectedStart));
    setCalendarVisible(false);
  };

  const fetchRecords = useCallback(async () => {
    if (!mounted.current || currentRecordScope.current !== recordScope) return;
    const request = ++recordRequest.current;
    const isCurrent = () => mounted.current && currentRecordScope.current === recordScope && recordRequest.current === request;
    if (!accountScope.isAuthenticated || !accountScope.userId) {
      setRecordState({ scope: recordScope, records: [], loading: false });
      return;
    }
    try {
      setRecordState(current => ({ scope: recordScope, records: current.scope === recordScope ? current.records : [], loading: true }));
      const data = await dietApi.list(authFetch, selectedDate);
      if (isCurrent()) setRecordState({ scope: recordScope, records: Array.isArray(data) ? data : [], loading: false });
    } catch (e) {
      if (isCurrent()) console.error(e);
    } finally {
      if (isCurrent()) setRecordState(current => ({ ...current, loading: false }));
    }
  }, [accountScope, authFetch, recordScope, selectedDate]);

  const fetchWeeklyRecordCounts = useCallback(async () => {
    if (!mounted.current || currentWeekScope.current !== weekScope) return;
    const request = ++weekRequest.current;
    if (!accountScope.isAuthenticated || !accountScope.userId) {
      setWeekState({ scope: weekScope, counts: {} });
      return;
    }

    const days = Array.from(
      { length: 7 },
      (_, index) => toLocalDateKey(addLocalDays(weekOffset * 7 + index - 6))
    );
    const results = await Promise.allSettled(days.map((date) => dietApi.list(authFetch, date)));
    if (!mounted.current || currentWeekScope.current !== weekScope || weekRequest.current !== request) return;
    setWeekState({ scope: weekScope, counts: Object.fromEntries(results.map((result, index) => [
      days[index],
      result.status === "fulfilled" && Array.isArray(result.value)
        ? result.value.length
        : 0,
    ])) });
  }, [accountScope, authFetch, weekOffset, weekScope]);

  useFocusEffect(
    useCallback(() => {
      void fetchRecords();
      return () => { recordRequest.current += 1; };
    }, [fetchRecords])
  );

  useFocusEffect(
    useCallback(() => {
      void fetchWeeklyRecordCounts();
      return () => { weekRequest.current += 1; };
    }, [fetchWeeklyRecordCounts])
  );

  const currentRefresh = useRef({ selectedDate, fetchRecords, fetchWeeklyRecordCounts });
  currentRefresh.current = { selectedDate, fetchRecords, fetchWeeklyRecordCounts };
  const refreshAfterMutation = () => {
    if (!mounted.current || currentAccountScope.current !== accountScope) return;
    // A mutation can finish after leaving and returning to its date. Refresh the
    // current queries without letting its old callback alter a newer meal form.
    if (currentRefresh.current.selectedDate === selectedDate) void currentRefresh.current.fetchRecords();
    void currentRefresh.current.fetchWeeklyRecordCounts();
  };

  const openAddModal = (meal = "", time = currentTimeValue()) => {
    formRevision.current += 1;
    setFormAccountScope(accountScope);
    setSaving(false);
    setAiAnalyzing(false);
    setMealType(meal);
    setRecordedTime(time);
    setFoodName("");
    setAmount("1份");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setImageUrl("");
    setModalVisible(true);
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  };

  const applyPreset = (preset: PresetFood) => {
    setFoodName(preset.name);
    setAmount(preset.amount);
    setCalories(preset.calories);
    setProtein(preset.protein);
    setCarbs(preset.carbs);
    setFat(preset.fat);
  };

  const handlePickImageAndRecognize = async () => {
    const revision = formRevision.current;
    const isCurrent = () => mounted.current && currentRecordScope.current === recordScope && formRevision.current === revision;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });

      if (!isCurrent() || result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      if (asset.uri) setImageUrl(asset.uri);

      if (!asset.base64) {
        Alert.alert("提示", "图片编码失败，请重试");
        return;
      }

      setAiAnalyzing(true);
      const json = await aiApi.visionFood<{ data?: Record<string, number | string>; rawText?: string; run: { id: string; status: string; artifacts?: Array<{ type: string; data: unknown }>; reply?: string; error?: { message?: string } } }>(authFetch, asset.base64);
      if (!isCurrent()) return;
      const run = await waitForAgentRun(authFetch, json.run);
      if (!isCurrent()) return;
      const data = json.data || run.artifacts?.find((artifact) => artifact.type === "vision")?.data as Record<string, number | string> | undefined;
      if (data) {
          if (data.foodName) setFoodName(String(data.foodName));
          if (data.estimatedWeightGrams) setAmount(`${data.estimatedWeightGrams}g`);
          setCalories(data.calories == null ? "" : String(data.calories));
          setProtein(data.proteinGrams == null ? "" : String(data.proteinGrams));
          setCarbs(data.carbsGrams == null ? "" : String(data.carbsGrams));
          setFat(data.fatGrams == null ? "" : String(data.fatGrams));
          Alert.alert("AI 识别成功", `已自动识别【${data.foodName || "餐食"}】并估算营养成分！`);
      } else if (json.rawText || run.reply) {
        Alert.alert("AI 识别提示", json.rawText || run.reply);
      }
    } catch (e: any) {
      if (isCurrent()) Alert.alert("错误", e.message || "识图出现异常");
    } finally {
      if (isCurrent()) setAiAnalyzing(false);
    }
  };

  const openPhotoRecord = () => {
    openAddModal();
    void handlePickImageAndRecognize();
  };

  const handleSave = async () => {
    const revision = formRevision.current;
    const isCurrent = () => mounted.current && currentRecordScope.current === recordScope;
    const isCurrentForm = () => isCurrent() && formRevision.current === revision;
    if (!isCurrent() || !accountScope.isAuthenticated || !accountScope.userId || saving) return;
    if (!foodName.trim()) {
      Alert.alert("提示", "请输入食物名称");
      return;
    }
    const normalizedTime = normalizeRecordedTime(recordedTime);
    if (!normalizedTime) {
      Alert.alert("提示", "请填写有效时间，例如 08:30");
      return;
    }
    const parseNullableNumber = (value: string): number | null | "invalid" => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : "invalid";
    };
    const parsedCalories = parseNullableNumber(calories);
    const parsedProtein = parseNullableNumber(protein);
    const parsedCarbs = parseNullableNumber(carbs);
    const parsedFat = parseNullableNumber(fat);
    if (parsedCalories === "invalid" || parsedProtein === "invalid" || parsedCarbs === "invalid" || parsedFat === "invalid") {
      Alert.alert("提示", "热量和营养素数值必须为大于等于 0 的有效数字");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        meal_type: mealType.trim(),
        food_name: foodName,
        amount,
        calories: parsedCalories,
        protein: parsedProtein,
        carbs: parsedCarbs,
        fat: parsedFat,
        recorded_at: selectedDate,
        recorded_time: normalizedTime,
        image_url: imageUrl.trim() || null,
      };

      await pendingSave.save(payload);
      if (isCurrentForm()) setModalVisible(false);
      refreshAfterMutation();
    } catch (e) {
      if (isCurrentForm()) Alert.alert("错误", e instanceof ApiError ? e.message : "网络异常");
    } finally {
      if (isCurrentForm()) setSaving(false);
    }
  };

  const handleDelete = (id: number) => {
    const record = records.find(item => item.id === id);
    const isCurrent = () => mounted.current && currentRecordScope.current === recordScope;
    const remove = async (mode?: "undo_eating" | "delete_intake") => {
      if (!isCurrent()) return;
      try {
        await dietApi.remove(authFetch, id, mode);
        refreshAfterMutation();
      } catch (error) {
        if (isCurrent()) Alert.alert("未能处理记录", error instanceof Error ? error.message : "请稍后重试");
      }
    };
    if (record?.prepared_meal_id || record?.household_meal_id) {
      Alert.alert("处理关联食用记录", "撤销误记：恢复待吃份量并删除摄入，制作时消耗的原料不返还。仅删除摄入：仍保留食用事实，待吃份量不变。", [
        { text: "取消", style: "cancel" },
        { text: "仅删除摄入", style: "destructive", onPress: () => void remove("delete_intake") },
        { text: "撤销误记食用", onPress: () => void remove("undo_eating") },
      ]);
    } else {
      Alert.alert("确认删除", "要删除此打卡记录吗？", [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => void remove() },
      ]);
    }
  };

  const dayCalories = summarizeNutrition(records.map(r => r.calories));
  const dayProtein = summarizeNutrition(records.map(r => r.protein));
  const dayCarbs = summarizeNutrition(records.map(r => r.carbs));
  const dayFat = summarizeNutrition(records.map(r => r.fat));
  const sortedRecords = [...records].sort((a, b) => (a.recorded_time || "").localeCompare(b.recorded_time || ""));
  const timePosition = (time?: string | null) => {
    if (!time) return 0;
    const [hours, minutes] = time.split(":").map(Number);
    return Math.min(DAY_TIMELINE_HEIGHT - 12, Math.max(0, ((hours * 60 + minutes) / (24 * 60)) * DAY_TIMELINE_HEIGHT));
  };

  const completeCalories = !dayCalories.incomplete && dayCalories.total != null;
  const progressPercent = completeCalories ? Math.min(Math.round((dayCalories.total! / targetCal) * 100), 100) : null;
  const remainingCal = completeCalories ? Math.max(0, targetCal - dayCalories.total!) : null;
  const isSelectedToday = selectedDate === todayStr;

  const handleCloseModal = () => {
    formRevision.current += 1;
    setModalVisible(false);
    router.setParams({});
  };

  const formattedSelectedDateText = () => {
    const d = parseDateKey(selectedDate) || new Date();
    const m = d.getMonth() + 1;
    const dateNum = d.getDate();
    const dayName = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    return `${m}月${dateNum}日 ${dayName}`;
  };

  const formattedWeekRangeText = () => {
    const start = pastSevenDays[0].date;
    const end = pastSevenDays[pastSevenDays.length - 1].date;
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
    }
    return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  };

  if (!isAuthenticated) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-16 h-16 rounded-full bg-brand/10 items-center justify-center mb-4">
            <FontAwesome6 name="utensils" size={28} colorClassName="accent-brand" />
          </View>
          <Text className="text-xl font-bold text-ink">饮食打卡日志</Text>
          <Text className="text-sm text-copy-muted text-center mt-2 mb-6 px-4 leading-5">
            登录后精准管理每日卡路里、记录三餐摄入与三大营养素分配。
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login")}
            className="bg-brand-fill px-8 py-3.5 rounded-2xl active:opacity-90 shadow-sm"
          >
            <Text className="text-sm font-bold text-white">立即登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View className="flex-1">
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {pendingSave.pending ? <View className="mx-5 mb-4 gap-3 rounded-2xl bg-warm-soft p-4"><Text className="font-bold text-ink">上次记录尚未确认保存</Text><Text className="text-copy-muted">{pendingSave.pending.recorded_at} · {pendingSave.pending.food_name} · {pendingSave.pending.amount}</Text><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => {
            const scope = accountScope; setSaving(true);
            void pendingSave.save().then(record => { if (mounted.current && currentAccountScope.current === scope) { setSelectedDate(record.recorded_at); refreshAfterMutation(); } }).catch(reason => { if (mounted.current && currentAccountScope.current === scope) Alert.alert("保存失败", reason instanceof Error ? reason.message : "请重试"); }).finally(() => { if (mounted.current && currentAccountScope.current === scope) setSaving(false); });
          }}><Text className="font-bold text-brand">重试保存上次记录</Text></TouchableOpacity></View> : null}
          {pendingSave.error ? <Text accessibilityRole="alert" className="mx-5 mb-3 text-critical">{pendingSave.error}</Text> : null}
          {/* 顶部 Header */}
          <View className="flex-row items-center px-5 pb-2 pt-3">
            <TouchableOpacity
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="返回"
              className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface"
            >
              <FontAwesome6 name="chevron-left" size={13} colorClassName="accent-ink" />
            </TouchableOpacity>
            <View className="ml-3 flex-1">
              <Text className="text-lg font-black text-ink">饮食记录</Text>
              <TouchableOpacity onPress={() => router.push("/prepared-meals")}><Text className="text-brand text-sm">查看待吃餐</Text></TouchableOpacity>
              <Text className="mt-0.5 text-[11px] font-medium text-copy-muted">{formattedSelectedDateText()}</Text>
            </View>
            {selectedDate !== todayStr ? (
              <TouchableOpacity onPress={goToToday} className="mr-2 rounded-full bg-brand/10 px-3 py-2 active:opacity-80">
                <Text className="text-[11px] font-bold text-brand">今天</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => openAddModal()}
              accessibilityRole="button"
              accessibilityLabel="记录一餐"
              className="flex-row items-center gap-1.5 rounded-full bg-brand-fill px-3.5 py-2.5 active:opacity-90"
            >
              <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
              <Text className="text-xs font-bold text-white">记一餐</Text>
            </TouchableOpacity>
          </View>

          {!loading && sortedRecords.length === 0 ? (
            <View className="mx-5 mt-2 rounded-[24px] border border-line bg-surface p-4">
              <View className="flex-row items-center">
                <View className="mr-3.5 h-11 w-11 items-center justify-center rounded-2xl bg-brand/10">
                  <FontAwesome6 name="utensils" size={16} colorClassName="accent-brand" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-black text-ink">还没有饮食记录</Text>
                  <Text className="mt-1 text-[11px] leading-4 text-copy-muted">记下第一餐后，时间图会同步标记进食时刻</Text>
                </View>
              </View>
              <View className="mt-4 flex-row gap-2.5">
                <TouchableOpacity
                  onPress={() => openAddModal()}
                  accessibilityRole="button"
                  accessibilityLabel="手动记录第一餐"
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-brand-fill py-3 active:opacity-90"
                >
                  <FontAwesome6 name="plus" size={11} colorClassName="accent-on-brand" />
                  <Text className="text-xs font-bold text-white">手动记录</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={openPhotoRecord}
                  accessibilityRole="button"
                  accessibilityLabel="拍照识别第一餐"
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-brand/20 bg-brand/10 py-3 active:opacity-80"
                >
                  <FontAwesome6 name="camera" size={11} colorClassName="accent-brand" />
                  <Text className="text-xs font-bold text-brand">拍照识别</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* 日期与 24 小时饮食时间图 */}
          <View className="mx-5 mt-2 overflow-hidden rounded-[24px] border border-line bg-surface">
            <View className="flex-row items-center justify-between border-b border-line/70 px-3 py-2">
              <TouchableOpacity
                onPress={() => changeWeek(-1)}
                accessibilityRole="button"
                accessibilityLabel="查看更早七天"
                className="h-8 w-8 items-center justify-center rounded-xl bg-canvas active:opacity-70"
              >
                <FontAwesome6 name="chevron-left" size={11} colorClassName="accent-ink" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openCalendar}
                accessibilityRole="button"
                accessibilityLabel="打开月历选择日期"
                className="flex-row items-center gap-1.5 px-3 py-1 active:opacity-70"
              >
                <FontAwesome6 name="calendar-days" size={11} colorClassName="accent-brand" />
                <Text className="text-[11px] font-black text-ink">{formattedWeekRangeText()}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => changeWeek(1)}
                disabled={weekOffset === 0}
                accessibilityRole="button"
                accessibilityLabel="查看较新七天"
                accessibilityState={{ disabled: weekOffset === 0 }}
                className={`h-8 w-8 items-center justify-center rounded-xl ${
                  weekOffset === 0 ? "bg-background-secondary opacity-35" : "bg-background-secondary active:opacity-70"
                }`}
              >
                <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-ink" />
              </TouchableOpacity>
            </View>
            <View className="flex-row p-1.5">
              {pastSevenDays.map((item) => {
                const isSelected = item.dateStr === selectedDate;
                const hasRecord = (weeklyRecordCounts[item.dateStr] || 0) > 0;
                return (
                  <TouchableOpacity
                    key={item.dateStr}
                    onPress={() => setSelectedDate(item.dateStr)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${item.isToday ? "今天" : `周${item.dayName}`} ${item.dayNum}日`}
                    className={`h-13 flex-1 items-center justify-center rounded-2xl border ${isSelected ? "border-brand/20 bg-brand/10" : "border-transparent bg-surface"}`}
                  >
                    <Text
                      className={`text-[10px] ${
                        isSelected
                          ? "text-brand font-black"
                          : item.isToday
                          ? "text-brand font-black"
                          : "text-copy-muted"
                      }`}
                    >
                      {item.isToday ? "今天" : `周${item.dayName}`}
                    </Text>
                    <Text
                      className={`text-sm font-black mt-0.5 ${
                        isSelected
                          ? "text-brand"
                          : item.isToday
                          ? "text-brand"
                          : "text-ink"
                      }`}
                    >
                      {item.dayNum}
                    </Text>
                    <View
                      className={`absolute bottom-1 w-1 h-1 rounded-full ${
                        hasRecord
                          ? isSelected
                            ? "bg-brand-fill"
                            : "bg-brand-fill"
                          : "bg-transparent"
                      }`}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View className="border-t border-line/70 px-4 pb-4 pt-3">
              <View className="flex-row items-start justify-between">
                <View>
                  <Text className="text-sm font-black text-ink">24 小时饮食时间图</Text>
                  <Text className="mt-0.5 text-[10px] text-copy-muted">
                    {sortedRecords.length > 0 ? "餐点已按实际进食时间落位" : "记录后，餐点会出现在对应时间"}
                  </Text>
                </View>
                <View className="rounded-full bg-canvas px-2.5 py-1">
                  <Text className="text-[10px] font-bold text-copy-muted">00:00—24:00</Text>
                </View>
              </View>

              <View className="relative mt-4" style={{ height: DAY_TIMELINE_HEIGHT }}>
                {[
                  { label: "早餐", start: 6, end: 10 },
                  { label: "午餐", start: 11, end: 14 },
                  { label: "晚餐", start: 17, end: 21 },
                ].map((period) => (
                  <View
                    key={period.label}
                    className="absolute left-12 right-0 rounded-xl bg-background-secondary px-2 py-1"
                    style={{
                      top: (period.start / 24) * DAY_TIMELINE_HEIGHT,
                      height: ((period.end - period.start) / 24) * DAY_TIMELINE_HEIGHT,
                    }}
                  >
                    <Text className="text-right text-[9px] font-bold text-brand/35">{period.label}</Text>
                  </View>
                ))}

                {[0, 4, 8, 12, 16, 20, 24].map((hour) => {
                  const top = Math.min(DAY_TIMELINE_HEIGHT - 12, Math.max(0, (hour / 24) * DAY_TIMELINE_HEIGHT - 6));
                  return (
                    <View key={hour} className="absolute left-0 right-0 flex-row items-center" style={{ top }}>
                      <Text className="w-10 text-[9px] font-bold text-copy-muted/60">{String(hour).padStart(2, "0")}:00</Text>
                      <View className="ml-2 h-px flex-1 bg-line/70" />
                    </View>
                  );
                })}

                {isSelectedToday ? (
                  <View
                    className="absolute left-12 right-0 flex-row items-center"
                    style={{ top: timePosition(currentTimeValue()) }}
                  >
                    <View className="h-2 w-2 rounded-full bg-highlight" />
                    <View className="h-px flex-1 bg-highlight/70" />
                    <Text className="ml-1 text-[9px] font-black text-warm">现在</Text>
                  </View>
                ) : null}

                {sortedRecords.filter((record) => record.recorded_time).map((record) => (
                  <View
                    key={`timeline-${record.id}`}
                    className="absolute left-12 right-0 flex-row items-center"
                    style={{ top: timePosition(record.recorded_time) }}
                  >
                    <View className="h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-fill" />
                    <View className="h-px w-3 bg-brand/40" />
                    <View className="min-w-0 flex-1 rounded-full bg-brand-fill px-2.5 py-1.5">
                      <Text className="text-[9px] font-bold text-white" numberOfLines={1}>
                        {record.recorded_time} · {record.food_name}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* 按实际发生时间排列的饮食记录 */}
          <View className={loading || sortedRecords.length > 0 ? "px-5 pb-6 pt-4" : ""}>
          {loading ? (
            <View className="py-12 items-center justify-center">
              <ActivityIndicator size="large" colorClassName="accent-brand" />
              <Text className="text-xs text-copy-muted mt-2">读取饮食记录中...</Text>
            </View>
          ) : sortedRecords.length > 0 ? (
            <View>
              <View className="mb-3 flex-row items-end justify-between px-0.5">
                <View>
                  <Text className="text-base font-black text-ink">{isSelectedToday ? "今天吃了什么" : "这天吃了什么"}</Text>
                  <Text className="mt-0.5 text-[11px] text-copy-muted">
                    {sortedRecords.length > 0 ? `${sortedRecords.length} 条记录 · 按时间排列` : "手动记录，或让 AI 从照片识别"}
                  </Text>
                </View>
                {sortedRecords.length > 0 ? (
                  <TouchableOpacity onPress={openPhotoRecord} className="flex-row items-center gap-1.5 rounded-full bg-brand/10 px-3 py-2 active:opacity-80">
                    <FontAwesome6 name="camera" size={10} colorClassName="accent-brand" />
                    <Text className="text-[10px] font-bold text-brand">拍照记餐</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View className="gap-2.5">
                  {sortedRecords.map((record) => (
                    <View key={record.id} className="flex-row items-center rounded-[22px] border border-line bg-surface p-3">
                      <View className="mr-2.5 w-11 items-center rounded-xl bg-brand/10 px-1 py-2">
                        <Text className="text-[11px] font-black text-brand">{record.recorded_time || "—"}</Text>
                      </View>
                      {record.image_url ? (
                        <Image source={{ uri: record.image_url }} className="mr-2.5 h-11 w-11 rounded-xl" />
                      ) : (
                        <View className="mr-2.5 h-11 w-11 items-center justify-center rounded-xl bg-canvas">
                          <FontAwesome6 name="utensils" size={13} colorClassName="accent-brand" />
                        </View>
                      )}
                      <View className="min-w-0 flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Text className="shrink text-sm font-bold text-ink" numberOfLines={1}>{record.food_name}</Text>
                          {record.meal_type ? (
                            <View className="rounded-full bg-canvas px-2 py-0.5">
                              <Text className="text-[9px] font-bold text-copy-muted">{record.meal_type}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text className="mt-1 text-[10px] text-copy-muted">{record.amount}</Text>
                      </View>
                      <View className="ml-2 items-end">
                        <Text className="text-xs font-black text-brand">{record.calories == null ? "—" : record.calories}</Text>
                        <Text className="text-[9px] text-copy-muted">kcal</Text>
                        <TouchableOpacity
                          onPress={() => handleDelete(record.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`删除${record.food_name}`}
                          className="mt-1 h-7 w-7 items-center justify-center"
                        >
                          <FontAwesome6 name="trash-can" size={10} colorClassName="accent-copy-muted" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
              </View>
            </View>
          ) : null}
          </View>

          {!loading && sortedRecords.length > 0 ? (
            <View className="mx-5 mb-6 rounded-[28px] border border-line bg-brand-soft p-4">
              <View className="flex-row items-start justify-between">
                <View>
                  <Text className="text-[11px] font-bold text-brand">{isSelectedToday ? "今日营养汇总" : "当日营养汇总"}</Text>
                  <View className="mt-1 flex-row items-baseline gap-1.5">
                    <Text className="text-[30px] font-black text-ink">{formatNutritionSummary(dayCalories, "")}</Text>
                    <Text className="text-xs font-medium text-copy-muted">/ {targetCal} kcal · {targetLabel}</Text>
                  </View>
                </View>
                <View className="rounded-full bg-surface px-3 py-2">
                  <Text className="text-[10px] font-medium text-copy-muted">{remainingCal == null ? "热量数据不全" : remainingCal > 0 ? "剩余可摄入" : "今日状态"}</Text>
                  <Text className="mt-0.5 text-xs font-black text-brand">
                    {remainingCal == null ? "暂不计算剩余额度" : remainingCal > 0 ? formatNutritionSummary({ total: remainingCal, incomplete: false }, " kcal") : "目标已达成"}
                  </Text>
                </View>
              </View>

              {progressPercent != null ? <View className="mt-3 h-2 overflow-hidden rounded-full bg-brand/10">
                <View className="h-full rounded-full bg-brand-fill" style={{ width: `${progressPercent}%` }} />
              </View> : <Text className="mt-3 text-xs text-copy-muted">部分记录未填写热量，已知小计不代表全天总摄入。</Text>}

              <View className="mt-4 flex-row border-t border-brand/10 pt-3">
                {[
                  { label: "蛋白质", summary: dayProtein },
                  { label: "碳水", summary: dayCarbs },
                  { label: "脂肪", summary: dayFat },
                ].map((metric, index) => (
                  <View key={metric.label} className={`flex-1 ${index > 0 ? "border-l border-brand/10 pl-4" : ""}`}>
                    <Text className="text-[10px] text-copy-muted">{metric.label}</Text>
                    <Text className="mt-1 text-sm font-black text-ink">{formatNutritionSummary(metric.summary, " g")}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* 月历日期选择器 */}
        <Modal
          visible={calendarVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setCalendarVisible(false)}
        >
          <View className="flex-1 bg-black/40 justify-center px-5">
            <View className="bg-surface rounded-[28px] p-5 shadow-xl">
              <View className="flex-row items-center justify-between mb-4">
                <View>
                  <Text className="text-lg font-black text-ink">选择日期</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">可以直接跳转到任意历史记录</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setCalendarVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="关闭月历"
                  className="w-9 h-9 rounded-full bg-background-secondary items-center justify-center"
                >
                  <FontAwesome6 name="xmark" size={15} colorClassName="accent-copy-muted" />
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center justify-between mb-3">
                <TouchableOpacity
                  onPress={() => changeCalendarMonth(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="上一个月"
                  className="w-10 h-10 rounded-xl bg-background-secondary items-center justify-center active:opacity-70"
                >
                  <FontAwesome6 name="chevron-left" size={12} colorClassName="accent-ink" />
                </TouchableOpacity>
                <Text className="text-base font-black text-ink">
                  {calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月
                </Text>
                <TouchableOpacity
                  onPress={() => changeCalendarMonth(1)}
                  disabled={isCalendarCurrentMonth}
                  accessibilityRole="button"
                  accessibilityLabel="下一个月"
                  accessibilityState={{ disabled: isCalendarCurrentMonth }}
                  className={`w-10 h-10 rounded-xl bg-background-secondary items-center justify-center ${
                    isCalendarCurrentMonth ? "opacity-35" : "active:opacity-70"
                  }`}
                >
                  <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-ink" />
                </TouchableOpacity>
              </View>

              <View className="flex-row mb-1">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                  <View key={day} className="items-center py-1" style={{ width: "14.2857%" }}>
                    <Text className="text-[10px] font-bold text-copy-muted">{day}</Text>
                  </View>
                ))}
              </View>

              <View className="flex-row flex-wrap">
                {calendarDays.map((item) => (
                  <TouchableOpacity
                    key={item.dateStr}
                    onPress={() => selectCalendarDate(item.date)}
                    disabled={item.isFuture}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.date.getMonth() + 1}月${item.date.getDate()}日${item.isToday ? "，今天" : ""}`}
                    accessibilityState={{ selected: item.isSelected, disabled: item.isFuture }}
                    className="h-11 items-center justify-center"
                    style={{ width: "14.2857%" }}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        item.isSelected
                          ? "bg-brand-fill"
                          : item.isToday
                          ? "bg-brand/10 border border-brand"
                          : "bg-transparent"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${
                          item.isSelected
                            ? "text-white"
                            : item.isFuture
                            ? "text-copy-muted/25"
                            : item.isCurrentMonth
                            ? item.isToday
                              ? "text-brand"
                              : "text-ink"
                            : "text-copy-muted/45"
                        }`}
                      >
                        {item.date.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                onPress={() => selectCalendarDate(new Date())}
                accessibilityRole="button"
                accessibilityLabel="选择今天"
                className="mt-4 py-3 rounded-2xl bg-brand/10 items-center active:opacity-70"
              >
                <Text className="text-sm font-black text-brand">回到今天</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 打卡 Bottom Sheet Modal */}
        <Modal visible={modalVisible && formAccountScope === accountScope} animationType="slide" transparent onRequestClose={handleCloseModal}>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="max-h-[90%] rounded-t-[32px] bg-surface px-5 pb-6 pt-5 shadow-xl">
              {/* Modal Header */}
              <View className="mb-4 flex-row items-center justify-between border-b border-background-secondary pb-3">
                <View className="flex-row items-center gap-2.5">
                  <View className="h-9 w-9 items-center justify-center rounded-2xl bg-brand/10">
                    <FontAwesome6 name="utensils" size={14} colorClassName="accent-brand" />
                  </View>
                  <View>
                    <Text className="text-lg font-black text-ink">记一餐</Text>
                    <Text className="mt-0.5 text-[10px] text-copy-muted">记录到 {formattedSelectedDateText()}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={handleCloseModal}
                  accessibilityRole="button"
                  accessibilityLabel="关闭记餐弹层"
                  className="w-8 h-8 rounded-full bg-background-secondary items-center justify-center"
                >
                  <FontAwesome6 name="xmark" size={16} colorClassName="accent-copy-muted" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                <View className="flex-row gap-3">
                  <View className="w-28">
                    <Text className="text-xs font-bold text-copy-muted mb-1">进食时间 *</Text>
                    <TextInput value={recordedTime} onChangeText={setRecordedTime} placeholder="08:30" keyboardType="numbers-and-punctuation" className="bg-canvas px-3 py-3 rounded-2xl border border-line text-sm text-ink" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">餐别（可选）</Text>
                    <TextInput value={mealType} onChangeText={setMealType} placeholder="早餐 / 午餐 / 晚餐" className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink" />
                  </View>
                </View>
                <View className="flex-row gap-2">
                  {["早餐", "午餐", "晚餐", "加餐"].map((option) => {
                    const selected = mealType === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        onPress={() => setMealType(option)}
                        className={`flex-1 items-center rounded-xl border py-2 ${selected ? "border-brand bg-brand/10" : "border-line bg-surface"}`}
                      >
                        <Text className={`text-[11px] font-bold ${selected ? "text-brand" : "text-copy-muted"}`}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* AI 识图入口卡片 */}
                <TouchableOpacity
                  onPress={handlePickImageAndRecognize}
                  disabled={aiAnalyzing}
                  className="bg-brand/10 border border-brand/30 p-3.5 rounded-2xl flex-row items-center justify-between active:bg-brand/20"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-9 h-9 rounded-xl bg-brand-fill items-center justify-center shadow-xs">
                      <FontAwesome6 name="camera" size={15} colorClassName="accent-on-brand" />
                    </View>
                    <View>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-xs font-black text-brand">AI 智能拍照识菜</Text>
                        <View className="bg-highlight px-1.5 py-0.2 rounded-md">
                          <Text className="text-[9px] font-black text-ink">推荐</Text>
                        </View>
                      </View>
                      <Text className="text-[10px] text-copy-muted mt-0.5">
                        拍照或选图，智能评估菜名与三大营养成分
                      </Text>
                    </View>
                  </View>
                  {aiAnalyzing ? (
                    <ActivityIndicator size="small" colorClassName="accent-brand" />
                  ) : (
                    <FontAwesome6 name="wand-magic-sparkles" size={15} colorClassName="accent-brand" />
                  )}
                </TouchableOpacity>

                {/* 常用食物快捷 Preset Chips */}
                <View className="space-y-1.5">
                  <Text className="text-xs font-bold text-copy-muted">常用健康食物快捷填表</Text>
                  <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10, paddingRight: 4 }}
                    className="flex-row py-1"
                  >
                    {QUICK_PRESETS.map((preset) => (
                      <TouchableOpacity
                        key={preset.name}
                        onPress={() => applyPreset(preset)}
                        className="bg-canvas px-3 py-1.5 rounded-xl border border-line mr-2.5 active:bg-brand/10 active:border-brand"
                      >
                        <Text className="text-xs font-bold text-ink">
                          {preset.name}
                        </Text>
                        <Text className="text-[9px] text-copy-muted mt-0.5">
                          {preset.calories} kcal
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  </View>
                </View>

                {/* 食物名称 */}
                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">食物名称</Text>
                  <TextInput
                    value={foodName}
                    onChangeText={setFoodName}
                    placeholder="如: 煎鸡胸肉沙拉 / 燕麦水煮蛋"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                {/* 分量与卡路里 */}
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">分量</Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="1份 / 200g"
                      className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">卡路里 (kcal)</Text>
                    <TextInput
                      value={calories}
                      onChangeText={setCalories}
                      keyboardType="numeric"
                      className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                    />
                  </View>
                </View>

                {/* 三大营养素 */}
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">蛋白质 (g)</Text>
                    <TextInput
                      value={protein}
                      onChangeText={setProtein}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">碳水化合物 (g)</Text>
                    <TextInput
                      value={carbs}
                      onChangeText={setCarbs}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">脂肪 (g)</Text>
                    <TextInput
                      value={fat}
                      onChangeText={setFat}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                </View>

                {/* 打卡保存按钮 */}
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  className="mt-3 items-center rounded-2xl bg-brand-fill py-3.5 active:opacity-90"
                >
                  {saving ? (
                    <ActivityIndicator colorClassName="accent-on-brand" />
                  ) : (
                    <Text className="text-base font-bold text-white">保存这餐</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Screen>
  );
}
