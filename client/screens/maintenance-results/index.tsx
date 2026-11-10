import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { planMaintenanceRunsSchema, type PlanMaintenanceRun } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { requestJson } from "@/services/api/client";
const statusLabels = { queued: "等待检查",running: "正在检查",completed: "检查完成",failed: "检查失败" };
export default function MaintenanceResultsScreen() {
  const { user } = useAuth();
  return <AccountResults key={user?.id ?? "anonymous"} userId={user?.id} />;
}
function AccountResults({ userId }: { userId?: number }) {
  const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [data,setData] = useState<{ owner: number; items: PlanMaintenanceRun[] } | null>(null);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(Boolean(userId)); const [reload,setReload] = useState(0);
  const sequence = useRef(0);
  const items = data?.owner === userId ? data?.items : undefined;
  useEffect(() => {
    const id = userId; const ticket = ++sequence.current;
    if (id) void requestJson(authFetch,"/api/v1/plan-maintenance/runs",{},planMaintenanceRunsSchema)
      .then(value => { if (ticket === sequence.current) setData({ owner: id,items: value.items }); })
      .catch(() => { if (ticket === sequence.current) setError("未能读取检查结果，请重试。"); })
      .finally(() => { if (ticket === sequence.current) setBusy(false); });
    return () => { sequence.current++; };
  },[userId,authFetch,reload]);
  return <Screen className="flex-1 bg-background">
    <View className="flex-row gap-6 p-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">计划检查结果</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">最近20次检查。这里记录检查当时的结果；建议是否已接受，请以餐次计划中的当前状态为准。</Text>
      {!userId ? <Text className="text-ink">请登录后查看个人检查结果。</Text> : <>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { setData(null); setError(""); setBusy(true); setReload(value => value+1); }}><Text className="text-brand">{busy ? "正在读取…" : "刷新检查结果"}</Text></TouchableOpacity>
        {error ? <Text accessibilityLiveRegion="polite" className="text-danger">{error}</Text> : null}
        {items?.length === 0 ? <Text className="text-copy-muted">暂无检查记录。</Text> : items?.map(item => <View key={item.id} className="rounded-xl bg-surface p-4 gap-2">
          <Text className="font-bold text-ink">{statusLabels[item.status]}</Text><Text className="text-xs text-copy-muted">{item.createdAt} · 已尝试 {item.attempts} 次</Text>
          <Text className="text-ink">{item.message}</Text>
          {item.status === "completed" ? <Text className="text-copy-muted">已调整 {item.applied} 项 · 提出建议 {item.suggested} 项 · 受保护保留 {item.kept} 项</Text> : null}
          {item.retryAt ? <Text className="text-copy-muted">下次重试不早于 {item.retryAt}</Text> : null}
          {item.notes?.map((note,index) => <Text key={`note-${index}`} className="text-copy-muted">说明：{note}</Text>)}
          {item.checks.map((check,index) => <Text key={index} className="text-copy-muted">待核对：{check}</Text>)}
        </View>)}
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/meal-plans")}><Text className="font-bold text-brand">查看餐次计划与调整建议</Text></TouchableOpacity>
      </>}
    </ScrollView>
  </Screen>;
}
