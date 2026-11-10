import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";
import { useAppThemeColors } from "@/hooks/useAppThemeColors";

type NotificationFilter = "all" | "pending" | "system";
type NotificationItem = {
  id: number;
  interventionId?: string | null;
  feedbackId?: number;
  type: "feedback_reply" | "proactive_intervention" | "expiring_inventory" | "admin_campaign" | "meal_reminder" | "water_reminder" | "plan_maintenance";
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  inventoryItemId: number | null;
  category: "action_required" | "system" | "routine";
  priority: "urgent" | "high" | "normal" | "low";
  actionStatus: "pending" | "completed" | "info";
  snoozedUntil: string | null;
};
type HistoryResponse = { items: NotificationItem[]; nextCursor: number | null; hasMore: boolean };
type ListRow = { kind: "header"; id: string; label: string } | { kind: "item"; id: string; item: NotificationItem };

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "system", label: "系统公告" },
];

function dateGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startToday - startDate) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return "更早";
}

function itemVisual(item: NotificationItem) {
  if (item.type === "expiring_inventory") {
    return {
      icon: "clock" as const,
      colorClass: item.priority === "urgent" ? "accent-critical" : "accent-warm",
      textClass: item.priority === "urgent" ? "text-critical" : "text-warm",
      background: item.priority === "urgent" ? "bg-danger-soft" : "bg-highlight/25",
      label: item.priority === "urgent" ? "今天到期" : item.priority === "high" ? "高优先级" : "临期任务",
    };
  }
  if (item.type === "feedback_reply") return { icon: "comment-dots" as const, colorClass: "accent-brand", textClass: "text-brand", background: "bg-brand/10", label: "反馈进展" };
  if (item.type === "proactive_intervention") return { icon: "lightbulb" as const,colorClass: "accent-brand",textClass: "text-brand",background: "bg-brand/10",label: "食材与晚餐建议" };
  if (item.type === "plan_maintenance") return { icon: "clipboard-check" as const,colorClass: "accent-brand",textClass: "text-brand",background: "bg-brand/10",label: "计划检查" };
  if (item.type === "meal_reminder") return { icon: "utensils" as const, colorClass: "accent-brand", textClass: "text-brand", background: "bg-brand/10", label: "用餐习惯" };
  if (item.type === "water_reminder") return { icon: "droplet" as const, colorClass: "accent-info", textClass: "text-info", background: "bg-info-soft", label: "饮水习惯" };
  return { icon: "bullhorn" as const, colorClass: "accent-brand", textClass: "text-brand", background: "bg-brand/10", label: "系统公告" };
}

export default function NotificationsScreen() {
  const router = useSafeRouter();
  const { token, isAuthenticated } = useAuth();
  const colors = useAppThemeColors();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh" | "more" = "initial") => {
    if (!token) {
      setLoading(false);
      return;
    }
    if (mode === "more") setLoadingMore(true);
    else if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    try {
      const data = await authApi.notificationHistory<HistoryResponse>(token, {
        filter,
        cursor: mode === "more" ? nextCursor ?? undefined : undefined,
        limit: 20,
      });
      setItems((current) => mode === "more" ? [...current, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "通知暂时无法加载");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filter, nextCursor, token]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load("initial");
    // `load` also depends on the pagination cursor; filter/token are the reload triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, token]);

  const rows = useMemo<ListRow[]>(() => {
    const result: ListRow[] = [];
    let lastGroup = "";
    for (const item of items) {
      const group = dateGroup(item.createdAt);
      if (group !== lastGroup) {
        result.push({ kind: "header", id: `header-${group}`, label: group });
        lastGroup = group;
      }
      result.push({ kind: "item", id: `item-${item.id}`, item });
    }
    return result;
  }, [items]);

  const updateLocal = (id: number, changes: Partial<NotificationItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const runAction = async (item: NotificationItem, action: "open" | "complete" | "snooze_today" | "plan_recipe") => {
    if (!token) return;
    try {
      await authApi.notificationAction(token, item.id, action, { source: "notification_center" });
      if (action === "complete") {
        updateLocal(item.id, { isRead: true, actionStatus: "completed" });
        if (filter === "pending") setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        return;
      }
      if (action === "snooze_today") {
        setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        return;
      }
      updateLocal(item.id, { isRead: true });
      if (action === "plan_recipe") {
        router.push("/ai-assistant", { prompt: "请优先使用我即将到期的库存食材，安排一份今天能完成的餐单。" });
      } else if (item.type === "feedback_reply" && item.feedbackId) {
        router.push("/feedback-history", { id: item.feedbackId });
      } else if (item.type === "proactive_intervention" && item.interventionId) {
        router.push("/intervention",{ id: item.interventionId });
      } else if (item.type === "expiring_inventory") {
        router.push("/(tabs)/inventory", { highlightItemId: item.inventoryItemId });
      } else if (item.type === "plan_maintenance") {
        router.push("/maintenance-results");
      } else if (item.type === "meal_reminder") {
        router.push("/diet-record");
      }
    } catch (actionError) {
      Alert.alert("操作未完成", actionError instanceof Error ? actionError.message : "请稍后再试");
    }
  };

  const markAllRead = async () => {
    if (!token) return;
    try {
      await authApi.markAllNotificationsRead(token);
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    } catch (markError) {
      Alert.alert("操作未完成", markError instanceof Error ? markError.message : "请稍后再试");
    }
  };

  const renderItem = ({ item: row }: { item: ListRow }) => {
    if (row.kind === "header") {
      return <Text className="mb-2 mt-3 px-5 text-xs font-black text-copy-muted">{row.label}</Text>;
    }
    const item = row.item;
    const visual = itemVisual(item);
    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => void runAction(item, "open")}
        className={`mx-5 mb-3 rounded-2xl border bg-surface p-4 ${item.isRead ? "border-line" : "border-brand/30"}`}
      >
        <View className="flex-row items-start gap-3">
          <View className={`mt-0.5 h-10 w-10 items-center justify-center rounded-xl ${visual.background}`}>
            <FontAwesome6 name={visual.icon} size={15} colorClassName={visual.colorClass} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className={`flex-1 text-sm text-ink ${item.isRead ? "font-bold" : "font-black"}`}>{item.title}</Text>
              {!item.isRead && <View className="mt-1.5 h-2 w-2 rounded-full bg-brand-fill" />}
            </View>
            <Text className="mt-1 text-xs leading-5 text-copy-muted">{item.body}</Text>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className={`text-[10px] font-bold ${visual.textClass}`}>{visual.label}</Text>
              <Text className="text-[10px] text-copy-muted">{new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
            {item.type === "plan_maintenance" && item.actionStatus === "pending" && (
              <View className="mt-3 gap-2 border-t border-background-secondary pt-3">
                <TouchableOpacity onPress={() => void runAction(item,"complete")} className="rounded-lg bg-brand-fill px-3 py-2"><Text className="text-xs font-bold text-white">标记提醒已处理</Text></TouchableOpacity>
                <Text className="text-xs text-copy-muted">仅关闭这条提醒；接受或恢复安排请到餐次计划操作。</Text>
              </View>
            )}
            {item.type === "expiring_inventory" && item.actionStatus === "pending" && (
              <View className="mt-3 flex-row flex-wrap gap-2 border-t border-background-secondary pt-3">
                <TouchableOpacity onPress={() => void runAction(item, "plan_recipe")} className="rounded-lg bg-brand-fill px-3 py-2">
                  <Text className="text-[10px] font-black text-white">安排食谱</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert("处理提醒", "仅结束这条提醒。请在库存中记录实际使用或丢弃的食材。", [
                    { text: "取消", style: "cancel" },
                    { text: "确认", onPress: () => void runAction(item, "complete") },
                  ])}
                  className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2"
                >
                  <Text className="text-[10px] font-black text-brand">处理提醒</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void runAction(item, "snooze_today")} className="rounded-lg bg-background-secondary px-3 py-2">
                  <Text className="text-[10px] font-black text-copy-muted">今天不再提醒</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen safeAreaEdges={["top", "left", "right"]}>
      <View className="flex-row items-center justify-between border-b border-line bg-canvas px-5 pb-3 pt-4">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-line bg-surface">
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
        </TouchableOpacity>
        <Text className="text-lg font-black text-ink">通知中心</Text>
        <TouchableOpacity onPress={() => router.push("/settings")} className="h-10 w-10 items-center justify-center">
          <FontAwesome6 name="gear" size={16} colorClassName="accent-copy-muted" />
        </TouchableOpacity>
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="bell" size={28} colorClassName="accent-brand" />
          <Text className="mt-4 text-base font-black text-ink">登录后查看通知</Text>
          <TouchableOpacity onPress={() => router.push("/login")} className="mt-4 rounded-xl bg-brand-fill px-5 py-3">
            <Text className="font-bold text-white">去登录</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View className="flex-row items-center gap-2 px-5 pb-2 pt-4">
            {FILTERS.map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => setFilter(option.key)}
                className={`rounded-full border px-3 py-2 ${filter === option.key ? "border-brand bg-brand-fill" : "border-line bg-surface"}`}
              >
                <Text className={`text-xs font-black ${filter === option.key ? "text-white" : "text-copy-muted"}`}>{option.label}</Text>
              </TouchableOpacity>
            ))}
            <View className="flex-1" />
            {items.some((item) => !item.isRead) && (
              <TouchableOpacity onPress={() => void markAllRead()}><Text className="text-xs font-bold text-brand">全部已读</Text></TouchableOpacity>
            )}
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center"><ActivityIndicator colorClassName="accent-brand" /></View>
          ) : error && items.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <FontAwesome6 name="triangle-exclamation" size={26} colorClassName="accent-warm" />
              <Text className="mt-3 text-sm font-bold text-copy-muted">{error}</Text>
              <TouchableOpacity onPress={() => void load("initial")} className="mt-4 rounded-xl bg-brand-fill px-5 py-3"><Text className="text-xs font-black text-white">重新加载</Text></TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={rows}
              renderItem={renderItem}
              keyExtractor={(row) => row.id}
              contentContainerStyle={{ paddingBottom: 32, flexGrow: rows.length ? 0 : 1 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={colors.brand} />}
              onEndReached={() => { if (hasMore && !loadingMore) void load("more"); }}
              onEndReachedThreshold={0.35}
              ListFooterComponent={loadingMore ? <ActivityIndicator className="my-4" colorClassName="accent-brand" /> : null}
              ListEmptyComponent={(
                <View className="flex-1 items-center justify-center px-8">
                  <FontAwesome6 name="bell-slash" size={28} colorClassName="accent-copy-muted" />
                  <Text className="mt-4 text-sm font-bold text-copy-muted">{filter === "pending" ? "没有待处理提醒" : "暂时没有新通知"}</Text>
                  <Text className="mt-1 text-xs text-copy-muted">可以在设置中管理提醒偏好</Text>
                </View>
              )}
            />
          )}
        </>
      )}
    </Screen>
  );
}
