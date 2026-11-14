import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Image,
} from "react-native";
import { Screen } from "@/components/Screen";
import { Button, IconButton, ListRow, PageHeader, Panel, SectionLabel } from "@/components/ui";
import { useFocusEffect } from "expo-router";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { addLocalDays, parseDateKey, toAppDateKey, toLocalDateKey } from "@/utils/date";
import { communityApi, dietApi, healthApi, recipesApi } from "@/services/api";
import { ALLERGY_LABELS, hasSafetyProfile, type HealthProfile as SavedHealthProfile } from "@/utils/healthProfile";
import { formatNutritionSummary, summarizeNutrition } from "@/utils/nutritionSummary";

interface DietRecord {
  id: number;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  recorded_at: string;
}

interface UserLevel { level: number; title: string; xp: number; nextXp: number | null; progress: number; }

const SERVICE_LINKS = [
  { title: "餐单工作台", subtitle: "按日计划并衔接采购、烹饪与记录", path: "/meal-plans" },
  { title: "共餐忌口设置", subtitle: "管理家庭共享的饮食限制", path: "/household-dining" },
  { title: "库存结果周报", subtitle: "临期使用、浪费与趋势", path: "/inventory-insights" },
  { title: "烹饪队列", subtitle: "安排待做菜谱与开始顺序", path: "/cooking-queue" },
  { title: "我的收藏菜谱", subtitle: "灵感菜谱与配餐收藏", path: "/favorites" },
  { title: "健康数据记录", subtitle: "维护已保存的健康记录", path: "/health-data" },
  { title: "帮助与反馈", subtitle: "问题反馈与客服支持", path: "/feedback" },
  { title: "系统与隐私设置", subtitle: "主题、账号与版本", path: "/settings" },
] as const;

export default function ProfileScreen() {
  const { user } = useAuth();
  return <ProfileContent key={user?.id ?? "guest"} />;
}

function ProfileContent() {
  const router = useSafeRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const authFetch = useAuthFetch();

  const [healthProfile, setHealthProfile] = useState<SavedHealthProfile | null>(null);
  const [recentRecords, setRecentRecords] = useState<DietRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dietTrend, setDietTrend] = useState<{ date: string; calories: ReturnType<typeof summarizeNutrition>; count: number }[]>([]);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [waterMl, setWaterMl] = useState<number | null>(null);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [dietRecordCount, setDietRecordCount] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [userLevel, setUserLevel] = useState<UserLevel | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  const today = toAppDateKey();

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadWarning(null);
    const results = await Promise.allSettled([
      healthApi.latest(authFetch),
      healthApi.list(authFetch),
      healthApi.profile<SavedHealthProfile>(authFetch),
      dietApi.list(authFetch),
      recipesApi.favoriteCount(authFetch),
      communityApi.following<{ id: number }>(authFetch),
      communityApi.level<UserLevel>(authFetch),
    ]);
    const [healthResult, healthLogsResult, healthProfileResult, dietResult, favoriteResult, followingResult, levelResult] = results;
    const failedSections: string[] = [];

    if (favoriteResult.status === "fulfilled") setFavoriteCount(Number(favoriteResult.value?.count || 0));
    else failedSections.push("收藏");
    if (followingResult.status === "fulfilled") setFollowingCount(Array.isArray(followingResult.value) ? followingResult.value.length : 0);
    else failedSections.push("关注");
    if (levelResult.status === "fulfilled") setUserLevel(levelResult.value);
    else failedSections.push("等级");

    if (healthResult.status !== "fulfilled") failedSections.push("健康概览");
    if (healthProfileResult.status === "fulfilled") setHealthProfile(healthProfileResult.value);
    else failedSections.push("健康档案");
    if (healthLogsResult.status === "fulfilled") {
      const todayHealth = Array.isArray(healthLogsResult.value)
        ? healthLogsResult.value.find((entry) => entry.recorded_date === today)
        : null;
      setWaterMl(todayHealth?.water_ml ?? null);
    } else failedSections.push("饮水记录");

    if (dietResult.status === "fulfilled") {
      const dietList = Array.isArray(dietResult.value) ? dietResult.value : [];
      setRecentRecords(dietList);
      setDietRecordCount(dietList.length);
      const recordedDays = new Set(dietList.map((record: DietRecord) => String(record.recorded_at || "").slice(0, 10)));
      let streak = 0;
      const todayDate = parseDateKey(today) || new Date();
      for (let dayOffset = 0; recordedDays.has(toLocalDateKey(addLocalDays(-dayOffset, todayDate))); dayOffset += 1) streak += 1;
      setStreakDays(streak);

      const last7Days: typeof dietTrend = [];
      for (let i = 6; i >= 0; i--) {
        const d = addLocalDays(-i, todayDate);
        const dateStr = toLocalDateKey(d);
        const dayRecords = dietList.filter((r: DietRecord) => r.recorded_at === dateStr);
        last7Days.push({
          date: dateStr,
          count: dayRecords.length,
          calories: summarizeNutrition(dayRecords.map((record: DietRecord) => record.calories)),
        });
      }
      setDietTrend(last7Days);
    } else failedSections.push("饮食趋势");

    if (failedSections.length > 0) {
      console.warn("Profile partial fetch failure", failedSections);
      setLoadWarning(`${failedSections.join("、")}暂时无法加载，其他资料仍可使用`);
    }
    setLoading(false);
  }, [isAuthenticated, authFetch, today]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleAddWater = async (addAmount: number) => {
    const previousWater = waterMl;
    const newWater = (waterMl ?? 0) + addAmount;
    setWaterMl(newWater);

    if (!isAuthenticated) return;
    try {
      await healthApi.saveLog(authFetch, { recorded_date: today, water_ml: newWater });
    } catch (e) {
      setWaterMl(previousWater);
      console.error("Update water failed", e);
    }
  };

  const confirmLogout = async () => {
    setLogoutModalOpen(false);
    await logout();
    router.replace("/login");
  };

  const goLogin = () => router.push("/login");

  if (authLoading || (isAuthenticated && loading)) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" colorClassName="accent-brand" />
          <Text className="mt-2 text-xs text-copy-muted">载入个人档案中...</Text>
        </View>
      </Screen>
    );
  }

  if (!isAuthenticated) {
    return (
      <Screen safeAreaEdges={["top", "left", "right"]}>
        <PageHeader
          title="我的"
          right={<IconButton name="gear" accessibilityLabel="打开设置" onPress={() => router.push("/settings")} />}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          className="bg-canvas"
        >
          <View className="border-b border-line bg-surface px-4 py-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-lg border border-line bg-canvas">
                <FontAwesome6 name="user" size={14} colorClassName="accent-copy-muted" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold tracking-tight text-ink">未登录</Text>
                <Text className="mt-0.5 text-xs leading-4 text-copy-muted">
                  登录后同步饮食、健康与食材资料
                </Text>
              </View>
              <Button size="sm" onPress={goLogin} accessibilityLabel="登录">登录</Button>
            </View>
          </View>

          <View className="mx-4 mt-4">
            <Panel padded={false}>
              <View className="flex-row border-b border-line">
                {[
                  { value: "—", label: "连续打卡" },
                  { value: "—", label: "记录餐数" },
                  { value: "—", label: "收藏菜谱" },
                  { value: "—", label: "关注好友" },
                ].map((item, index) => (
                  <View
                    key={item.label}
                    className={`flex-1 items-center px-1 py-3 ${index < 3 ? "border-r border-line" : ""}`}
                  >
                    <Text className="text-base font-semibold tabular-nums text-copy-muted">{item.value}</Text>
                    <Text className="mt-0.5 text-[11px] text-copy-muted">{item.label}</Text>
                  </View>
                ))}
              </View>
              <ListRow title="登录后查看健康总览与饮食趋势" onPress={goLogin} last />
            </Panel>
          </View>

          <View className="mx-4 mt-5">
            <SectionLabel>服务入口</SectionLabel>
            <Panel padded={false}>
              {SERVICE_LINKS.map((item, index) => (
                <ListRow
                  key={item.path}
                  title={item.title}
                  subtitle={item.subtitle}
                  onPress={goLogin}
                  last={index === SERVICE_LINKS.length - 1}
                />
              ))}
            </Panel>
          </View>

          <View className="mx-4 mb-6 mt-4">
            <Button variant="outline" onPress={() => router.push("/register")} accessibilityLabel="创建账号">
              创建账号
            </Button>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const heightVal = healthProfile?.currentMeasurements?.height_cm?.value ?? null;
  const weightVal = healthProfile?.currentMeasurements?.weight?.value ?? null;
  const bodyFatVal = healthProfile?.currentMeasurements?.body_fat?.value ?? null;
  const calculatedBmi = weightVal != null && heightVal != null
    ? weightVal / Math.pow(heightVal / 100, 2)
    : null;
  const bmi = calculatedBmi;

  const bmiStatus =
    bmi === null
      ? "未设置"
      : bmi < 18.5
      ? "偏瘦"
      : bmi < 24
      ? "正常"
      : bmi < 28
      ? "偏胖"
      : "肥胖";
  const bmiColorClass =
    bmi === null
      ? "text-copy-muted"
      : bmi < 18.5
      ? "text-highlight"
      : bmi < 24
      ? "text-brand"
      : bmi < 28
      ? "text-highlight"
      : "text-critical";

  const todayRecords = recentRecords.filter((r) => r.recorded_at === today);
  const todayNutrition = summarizeNutrition(todayRecords.map(record => record.calories));
  const knownDays = dietTrend.filter(day => day.calories.total != null && !day.calories.incomplete);
  const avgCalories = knownDays.length
    ? Math.round(knownDays.reduce((sum, day) => sum + day.calories.total!, 0) / knownDays.length) : null;
  const maxCalories = Math.max(1, ...dietTrend.map(day => day.calories.total ?? 0));

  const waterPercent = Math.min(Math.round(((waterMl ?? 0) / 2000) * 100), 100);
  const safetyProfileSaved = hasSafetyProfile(healthProfile);
  const safetyHighlights = [
    ...(healthProfile?.allergies || []).map((item) => ({
      key: `allergy-${item.name}`,
      label: `${item.name} · ${ALLERGY_LABELS[item.severity]}`,
      danger: item.severity === "severe",
    })),
    ...(healthProfile?.medical_conditions || []).map((item) => ({ key: `condition-${item}`, label: item, danger: true })),
    ...(healthProfile?.medications?.trim() ? [{ key: "medications", label: "用药已记录", danger: true }] : []),
    ...(healthProfile?.dietary_restrictions || []).map((item) => ({ key: `restriction-${item}`, label: item, danger: false })),
  ];
  const visibleSafetyHighlights = safetyHighlights.slice(0, 5);

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <PageHeader
        title="我的"
        right={(
          <>
            <Button size="sm" variant="outline" onPress={() => router.push("/profile-edit")} accessibilityLabel="编辑个人资料">
              编辑
            </Button>
            <IconButton name="gear" accessibilityLabel="打开设置" onPress={() => router.push("/settings")} />
          </>
        )}
      />

      {loadWarning ? (
        <TouchableOpacity
          onPress={() => void fetchData()}
          className="border-b border-line bg-warm-soft px-4 py-2.5"
        >
          <Text className="text-xs text-warm">{loadWarning} · 点击重试</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        className="bg-canvas"
      >
        {/* Identity strip */}
        <TouchableOpacity
          onPress={() => user?.id && router.push("/user-profile", { userId: user.id })}
          className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-4 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel="查看我的个人主页"
        >
          <Image
            source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
            style={{ width: 52, height: 52, borderRadius: 26 }}
          />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="shrink text-[16px] font-semibold tracking-tight text-ink" numberOfLines={1}>
                {user?.username || "健康体验家"}
              </Text>
              <View className="rounded-full bg-brand-soft px-2 py-0.5">
                <Text className="text-[10px] font-medium text-brand-strong">
                  V{userLevel?.level ?? 1} · {userLevel?.title ?? "健康新芽"}
                </Text>
              </View>
            </View>
            {userLevel ? (
              <View className="mt-2">
                <View className="mb-1 flex-row items-center justify-between">
                  <Text className="text-[10px] text-copy-muted">{userLevel.xp} XP</Text>
                  <Text className="text-[10px] text-copy-muted">
                    {userLevel.nextXp ? `距升级 ${Math.max(0, userLevel.nextXp - userLevel.xp)}` : "满级"}
                  </Text>
                </View>
                <View className="h-1 overflow-hidden rounded-full bg-background-secondary">
                  <View
                    className="h-full rounded-full bg-brand-fill"
                    style={{ width: `${Math.max(4, Math.min(100, userLevel.progress || 0))}%` }}
                  />
                </View>
              </View>
            ) : null}
          </View>
          <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
        </TouchableOpacity>

        <View className="mx-4 mt-4">
          <Panel padded={false}>
            <View className="flex-row">
              <MetricCell
                value={String(streakDays)}
                label="连续打卡"
                onPress={() => router.push("/diet-record")}
                accessibilityLabel="查看连续打卡记录"
                bordered
              />
              <MetricCell
                value={String(dietRecordCount)}
                label="记录餐数"
                onPress={() => router.push("/diet-record")}
                accessibilityLabel="查看饮食记录"
                bordered
              />
              <MetricCell
                value={String(favoriteCount)}
                label="收藏菜谱"
                onPress={() => router.push("/favorites")}
                bordered
              />
              <MetricCell
                value={String(followingCount)}
                label="关注好友"
                onPress={() => router.push("/following")}
                accessibilityLabel="查看关注好友"
              />
            </View>
          </Panel>
        </View>

        <View className="mx-4 mt-5">
          <View className="mb-2 flex-row items-center justify-between px-1">
            <SectionLabel className="mb-0">健康</SectionLabel>
            <TouchableOpacity onPress={() => router.push("/profile-settings")} accessibilityLabel="我的资料与偏好">
              <Text className="text-xs font-medium text-brand">资料与偏好</Text>
            </TouchableOpacity>
          </View>

          <Panel padded={false}>
            <TouchableOpacity
              onPress={() => router.push("/health-profile", { section: "safety" })}
              className="border-b border-line px-4 py-3 active:bg-background-secondary"
              accessibilityRole="button"
              accessibilityLabel={safetyProfileSaved ? "查看饮食安全信息" : "完善饮食安全信息"}
            >
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className={`text-sm font-medium ${safetyProfileSaved ? "text-critical" : "text-ink"}`}>
                    {safetyProfileSaved ? "饮食安全提醒" : "完善饮食安全信息"}
                  </Text>
                  <Text className="mt-0.5 text-xs text-copy-muted">
                    {safetyProfileSaved ? "推荐时将优先避开以下风险" : "补充过敏、疾病或用药信息"}
                  </Text>
                </View>
                <FontAwesome6 name="chevron-right" size={11} colorClassName="accent-copy-muted" />
              </View>
              {safetyProfileSaved ? (
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {visibleSafetyHighlights.map((item) => (
                    <View
                      key={item.key}
                      className={`rounded-md border px-2 py-0.5 ${item.danger ? "border-critical/25 bg-danger-soft" : "border-line bg-canvas"}`}
                    >
                      <Text className={`text-[11px] ${item.danger ? "text-critical" : "text-copy-muted"}`}>{item.label}</Text>
                    </View>
                  ))}
                  {safetyHighlights.length > visibleSafetyHighlights.length ? (
                    <View className="rounded-md border border-line bg-canvas px-2 py-0.5">
                      <Text className="text-[11px] text-copy-muted">+{safetyHighlights.length - visibleSafetyHighlights.length}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </TouchableOpacity>

            <View className="flex-row items-center justify-between border-b border-line px-4 py-2">
              <Text className="text-xs text-copy-muted">身体数据</Text>
              <TouchableOpacity onPress={() => router.push("/health-data")} accessibilityLabel="更新身体数据">
                <Text className="text-xs font-medium text-brand">更新</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => router.push("/health-data")} className="flex-row border-b border-line active:opacity-80">
              <HealthStat className="border-r border-line" label="身高" value={heightVal == null ? "待完善" : `${heightVal}`} unit={heightVal == null ? "" : "cm"} colorClass={heightVal == null ? "text-copy-muted" : "text-ink"} />
              <HealthStat className="border-r border-line" label="体重" value={weightVal == null ? "待完善" : `${weightVal}`} unit={weightVal == null ? "" : "kg"} colorClass={weightVal == null ? "text-copy-muted" : "text-ink"} />
              <HealthStat className="border-r border-line" label="体脂" value={bodyFatVal == null ? "待完善" : `${bodyFatVal}`} unit={bodyFatVal == null ? "" : "%"} colorClass={bodyFatVal == null ? "text-copy-muted" : "text-ink"} />
              <HealthStat
                className=""
                label="BMI"
                value={bmi == null ? "待完善" : bmi.toFixed(1)}
                unit={bmi == null ? "" : bmiStatus}
                colorClass={bmi == null ? "text-copy-muted" : bmiColorClass}
              />
            </TouchableOpacity>

            <View className="px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-ink">今日饮水</Text>
                <Text className="text-xs tabular-nums text-copy-muted">
                  {waterMl == null ? "尚未记录" : `${waterMl} / 2000 ml`}
                </Text>
              </View>
              <View className="mt-2 h-1 overflow-hidden rounded-sm bg-background-secondary">
                <View className="h-full rounded-sm bg-brand-fill" style={{ width: `${waterPercent}%` }} />
              </View>
              <View className="mt-3 flex-row gap-2">
                <View className="flex-1">
                  <Button size="sm" variant="outline" onPress={() => handleAddWater(250)} accessibilityLabel="加水 250 毫升">
                    +250 ml
                  </Button>
                </View>
                <View className="flex-1">
                  <Button size="sm" onPress={() => handleAddWater(500)} accessibilityLabel="加水 500 毫升">
                    +500 ml
                  </Button>
                </View>
              </View>
            </View>
          </Panel>
        </View>

        <View className="mx-4 mt-5">
          <View className="mb-2 flex-row items-center justify-between px-1">
            <SectionLabel className="mb-0">饮食</SectionLabel>
            <TouchableOpacity onPress={() => router.push("/diet-record")}>
              <Text className="text-xs font-medium text-brand">查看全部</Text>
            </TouchableOpacity>
          </View>

          <Panel padded={false}>
            <View className="border-b border-line px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-ink">今日饮食小记</Text>
                <Text className="text-sm font-semibold tabular-nums text-ink">
                  {todayNutrition.total == null
                    ? todayRecords.length === 0 ? "—" : "热量未知"
                    : `${todayNutrition.total} kcal`}
                </Text>
              </View>
              {todayRecords.length > 0 ? (
                <Text className="mt-0.5 text-xs text-copy-muted">
                  {todayNutrition.incomplete ? "今日已知热量合计" : "今日已累计摄入"}
                </Text>
              ) : null}

              {todayRecords.length === 0 ? (
                <View className="mt-3 flex-row items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-3">
                  <Text className="flex-1 text-xs text-copy-muted">今天还没有饮食记录</Text>
                  <Button size="sm" onPress={() => router.push("/diet-record")} accessibilityLabel="去记录一餐">
                    去记录
                  </Button>
                </View>
              ) : (
                <View className="mt-2">
                  {todayRecords.slice(0, 3).map((record, index) => (
                    <View
                      key={record.id}
                      className={`flex-row items-center justify-between py-2 ${index < Math.min(todayRecords.length, 3) - 1 ? "border-b border-line" : ""}`}
                    >
                      <View className="min-w-0 flex-1 pr-3">
                        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                          {record.food_name}
                        </Text>
                        <Text className="mt-0.5 text-xs text-copy-muted">
                          {record.meal_type} · {record.amount}
                        </Text>
                      </View>
                      <Text className="text-xs font-medium tabular-nums text-copy-muted">
                        {record.calories == null ? "热量未知" : `${record.calories} kcal`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View className="px-4 py-3">
              <View className="mb-2 flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink">近 7 日热量趋势</Text>
                  <Text className="mt-0.5 text-xs text-copy-muted">仅统计已记录餐次，缺失日不计均值</Text>
                </View>
                {avgCalories != null ? (
                  <Text className="shrink-0 text-xs tabular-nums text-copy-muted">
                    热量齐全的 {knownDays.length} 天均值 {avgCalories} kcal
                  </Text>
                ) : null}
              </View>

              {dietTrend.map(day => (
                <View key={day.date} className="mb-2 flex-row items-center gap-3 last:mb-0">
                  <Text className="w-10 text-xs tabular-nums text-copy-muted">{day.date.slice(5)}</Text>
                  <View className="h-1 flex-1 overflow-hidden rounded-sm bg-background-secondary">
                    {day.calories.total != null && (
                      <View
                        className="h-full rounded-sm bg-brand-fill"
                        style={{ width: `${day.calories.total / maxCalories * 100}%` }}
                      />
                    )}
                  </View>
                  <Text className="min-w-[72px] text-right text-xs tabular-nums text-ink">
                    {day.count === 0 ? "未记录" : day.calories.total == null ? "热量未知"
                      : formatNutritionSummary(day.calories, " kcal")}
                  </Text>
                </View>
              ))}
              {dietTrend.some(day => day.calories.incomplete) ? (
                <Text className="mt-1 text-[11px] text-copy-muted">部分餐次热量未知，“已知”仅为小计</Text>
              ) : null}
            </View>
          </Panel>
        </View>

        <View className="mx-4 mt-5">
          <SectionLabel>服务与设置</SectionLabel>
          <Panel padded={false}>
            {SERVICE_LINKS.map((item, index) => (
              <ListRow
                key={item.path}
                title={item.title}
                subtitle={item.subtitle}
                onPress={() => router.push(item.path)}
                last={index === SERVICE_LINKS.length - 1}
              />
            ))}
          </Panel>
        </View>

        <View className="mx-4 mb-8 mt-4">
          <Button
            variant="outline"
            onPress={() => setLogoutModalOpen(true)}
            accessibilityLabel="退出登录"
            className="border-critical/30"
          >
            <Text className="text-sm font-medium text-critical">退出登录</Text>
          </Button>
        </View>
      </ScrollView>

      <Modal visible={logoutModalOpen} animationType="fade" transparent onRequestClose={() => setLogoutModalOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 p-6">
          <Panel padded={false} className="w-full max-w-sm">
            <View className="border-b border-line px-4 py-4">
              <Text className="text-base font-semibold text-ink">确认退出登录</Text>
              <Text className="mt-1.5 text-sm leading-5 text-copy-muted">
                退出后需要重新登录才能继续管理食材与饮食记录。
              </Text>
            </View>
            <View className="flex-row gap-2 p-3">
              <View className="flex-1">
                <Button variant="outline" onPress={() => setLogoutModalOpen(false)} accessibilityLabel="取消退出">
                  取消
                </Button>
              </View>
              <View className="flex-1">
                <Button variant="danger" onPress={confirmLogout} accessibilityLabel="确认退出">
                  确认退出
                </Button>
              </View>
            </View>
          </Panel>
        </View>
      </Modal>
    </Screen>
  );
}

function MetricCell({
  value,
  label,
  onPress,
  accessibilityLabel,
  bordered = false,
}: {
  value: string;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  bordered?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-1 items-center px-1 py-3 active:opacity-70 ${bordered ? "border-r border-line" : ""}`}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text className="text-base font-semibold tabular-nums tracking-tight text-ink">{value}</Text>
      <Text className="mt-0.5 text-[11px] text-copy-muted">{label}</Text>
    </TouchableOpacity>
  );
}

function HealthStat({
  className,
  label,
  value,
  unit,
  colorClass,
}: {
  className: string;
  label: string;
  value: string;
  unit: string;
  colorClass: string;
}) {
  return (
    <View className={`flex-1 px-2.5 py-3 ${className}`}>
      <Text className="text-[11px] text-copy-muted">{label}</Text>
      <Text className={`mt-1 text-base font-semibold tabular-nums tracking-tight ${colorClass}`} numberOfLines={1}>
        {value}
      </Text>
      <Text className="mt-0.5 text-[10px] text-copy-muted" numberOfLines={1}>{unit || "尚未记录"}</Text>
    </View>
  );
}
